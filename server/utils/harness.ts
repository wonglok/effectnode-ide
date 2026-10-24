import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { lstat, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { SessionEventNotification } from '@deepseek-ai/dsh-sdk-protocol';
import {
  DeepSeekHarness,
  type HarnessNotification,
} from '@deepseek-ai/dsh-sdk-client';
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm';
import type {
  HarnessStatus,
  HarnessStreamEvent,
  HarnessTodoItem,
  HarnessTodoStatus,
  HarnessTurnRequest,
  HarnessTurnResult,
} from '../../shared/types';

/**
 * Server-side owner of the DeepSeek Harness SDK runtime.
 *
 * One `dsh --profile sdk` subprocess is started lazily and reused across
 * turns. Each turn mirrors the browser project into a per-conversation
 * workspace directory, lets the harness agent work there with its real tools,
 * then mirrors the resulting text files back to the client.
 */

const PROJECT_ROOT = process.cwd();
const WORKSPACES_ROOT = resolve(PROJECT_ROOT, 'data/harness-workspaces');
const DSH_HOME = process.env.DSH_HOME
  ? resolve(PROJECT_ROOT, process.env.DSH_HOME)
  : resolve(PROJECT_ROOT, 'data/dsh-home');
const AUTOMATION_PATCH = resolve(PROJECT_ROOT, 'automation.cordis.yml');

const MAX_FILES = 500;
const MAX_FILE_BYTES = 1_000_000;
const MAX_TOTAL_BYTES = 2_000_000;
const REQUEST_TIMEOUT_MS = 30 * 60_000;
const IGNORED_ENTRIES = new Set([
  'node_modules',
  '.git',
  '.DS_Store',
  '.cache',
  '.nitro',
  '.output',
  '.dsh-home',
]);

const BOOT_ID = randomUUID().replace(/-/g, '').slice(0, 12);
/**
 * Session ids are scoped to one spawned runtime. Closing the runtime (Stop) or
 * letting it die leaves persisted session logs behind; reusing the same id in a
 * new subprocess makes the session store reject it as "already exists".
 */
let runtimeTag = randomUUID().replace(/-/g, '').slice(0, 8);

export class HarnessNotConfiguredError extends Error {
  constructor() {
    super(
      'No DeepSeek API key configured. Set DEEPSEEK_API_KEY (or AGENT_API_KEY) on the server.'
    );
  }
}

interface HarnessRuntimeConfig extends HarnessStatus {
  apiKey: string;
}

function readReasoningEffort(): string | null {
  const raw = process.env.DSH_REASONING_EFFORT;
  if (raw === undefined) return 'max';
  return raw.trim() || null;
}

function readMaxTokens(): number | null {
  const raw = process.env.DSH_MAX_TOKENS;
  if (raw === undefined) return 49_152;
  if (!raw.trim()) return null;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : null;
}

function readApiKey(): {
  apiKey: string;
  keySource: HarnessStatus['keySource'];
} {
  const candidates: Array<[HarnessStatus['keySource'], string | undefined]> = [
    ['DEEPSEEK_API_KEY', process.env.DEEPSEEK_API_KEY],
    ['AGENT_API_KEY', process.env.AGENT_API_KEY],
    ['OPENAI_API_KEY', process.env.OPENAI_API_KEY],
  ];
  for (const [keySource, value] of candidates) {
    const apiKey = (value ?? '').trim();
    if (apiKey) return { apiKey, keySource };
  }
  return { apiKey: '', keySource: null };
}

/** Effective SDK route, read per turn so `.env` edits apply on restart. */
export function harnessConfig(): HarnessRuntimeConfig {
  const { apiKey, keySource } = readApiKey();
  return {
    configured: Boolean(apiKey),
    provider: process.env.DSH_PROVIDER?.trim() || 'deepseek-official',
    model:
      process.env.DSH_MODEL?.trim() ||
      process.env.AGENT_MODEL?.trim() ||
      'deepseek-v4-flash',
    reasoningEffort: readReasoningEffort(),
    maxTokens: readMaxTokens(),
    keySource,
    apiKey,
  };
}

/** Status payload without the credential itself. */
export function harnessStatus(): HarnessStatus {
  const { configured, provider, model, reasoningEffort, maxTokens, keySource } =
    harnessConfig();
  return { configured, provider, model, reasoningEffort, maxTokens, keySource };
}

let instance: DeepSeekHarness | null = null;
let instanceGeneration = 0;
let starting:
  | {
      harness: DeepSeekHarness;
      generation: number;
      promise: Promise<DeepSeekHarness>;
    }
  | null = null;

function createHarness(): DeepSeekHarness {
  const config = harnessConfig();
  if (!config.apiKey) throw new HarnessNotConfiguredError();

  runtimeTag = randomUUID().replace(/-/g, '').slice(0, 8);

  return new DeepSeekHarness({
    profile: 'sdk',
    ...(existsSync(AUTOMATION_PATCH) ? { patches: [AUTOMATION_PATCH] } : {}),
    provider: config.provider,
    model: config.model,
    ...(config.reasoningEffort
      ? { reasoningEffort: ReasoningEffortId(config.reasoningEffort) }
      : {}),
    ...(config.maxTokens ? { maxTokens: config.maxTokens } : {}),
    cwd: PROJECT_ROOT,
    dshHome: DSH_HOME,
    env: { ...process.env, DEEPSEEK_API_KEY: config.apiKey },
    initializeTimeoutMs: 60_000,
    requestTimeoutMs: REQUEST_TIMEOUT_MS,
  });
}

async function getHarness(): Promise<DeepSeekHarness> {
  if (instance) return instance;
  if (starting) return starting.promise;

  const harness = createHarness();
  const generation = instanceGeneration;
  const promise = harness.start().then(() => {
    if (generation !== instanceGeneration) {
      void harness.close().catch(() => undefined);
      throw new Error('The harness runtime was stopped while starting.');
    }
    instance = harness;
    return harness;
  });

  const record = { harness, generation, promise };
  starting = record;
  promise
    .finally(() => {
      if (starting === record) starting = null;
    })
    .catch(() => undefined);

  return promise;
}

/**
 * Close the runtime (the only way the SDK can abandon a turn) and forget it,
 * so the next turn spawns a fresh subprocess.
 */
export async function resetHarness(): Promise<void> {
  instanceGeneration += 1;
  const current = instance;
  const pending = starting;
  instance = null;
  starting = null;
  if (pending) await pending.harness.close().catch(() => undefined);
  if (current && current !== pending?.harness) {
    await current.close().catch(() => undefined);
  }
}

/* ── Workspace mirror ─────────────────────────────────────── */

function workspaceDir(conversationKey: string): string {
  return join(WORKSPACES_ROOT, conversationKey);
}

function sessionId(conversationKey: string): string {
  return `forge-${BOOT_ID}-${runtimeTag}-${conversationKey}`;
}

/** Map an absolute virtual path (`/src/App.tsx`) to a safe relative path. */
function virtualToRelative(virtualPath: string): string | null {
  if (typeof virtualPath !== 'string' || !virtualPath.startsWith('/')) return null;
  const segments = virtualPath.slice(1).split('/').filter(Boolean);
  if (segments.length === 0) return null;
  if (segments.some((segment) => segment === '.' || segment === '..' || segment.includes('\0'))) {
    return null;
  }
  return segments.join('/');
}

function toVirtualPath(absolutePath: string, workspace: string): string | undefined {
  if (absolutePath === workspace) return '/';
  if (!absolutePath.startsWith(workspace + sep)) return undefined;
  return `/${relative(workspace, absolutePath).split(sep).join('/')}`;
}

async function materializeWorkspace(
  workspace: string,
  files: Record<string, string>
): Promise<void> {
  await rm(workspace, { recursive: true, force: true });
  await mkdir(workspace, { recursive: true });

  for (const [virtualPath, content] of Object.entries(files)) {
    const relativePath = virtualToRelative(virtualPath);
    if (!relativePath) continue;
    const target = resolve(workspace, relativePath);
    if (target !== workspace && !target.startsWith(workspace + sep)) continue;
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content, 'utf8');
  }
}

interface CollectedWorkspace {
  files: Record<string, string>;
  skipped: string[];
}

async function collectWorkspace(workspace: string): Promise<CollectedWorkspace> {
  const files: Record<string, string> = {};
  const skipped: string[] = [];
  let totalBytes = 0;

  const walk = async (directory: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (IGNORED_ENTRIES.has(entry.name)) continue;
      const fullPath = join(directory, entry.name);
      const virtualPath = toVirtualPath(fullPath, workspace) ?? fullPath;

      if (entry.isSymbolicLink()) {
        skipped.push(virtualPath);
        continue;
      }
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;

      try {
        const info = await lstat(fullPath);
        if (info.size > MAX_FILE_BYTES || totalBytes + info.size > MAX_TOTAL_BYTES) {
          skipped.push(virtualPath);
          continue;
        }
        const buffer = await readFile(fullPath);
        if (buffer.subarray(0, Math.min(buffer.length, 8192)).includes(0)) {
          skipped.push(virtualPath);
          continue;
        }
        files[virtualPath] = buffer.toString('utf8');
        totalBytes += buffer.length;
      } catch {
        skipped.push(virtualPath);
      }
    }
  };

  await walk(workspace);
  return { files, skipped };
}

function diffPaths(
  before: Record<string, string>,
  after: Record<string, string>
): string[] {
  const changed: string[] = [];
  for (const [path, content] of Object.entries(after)) {
    if (before[path] !== content) changed.push(path);
  }
  for (const path of Object.keys(before)) {
    if (after[path] === undefined) changed.push(path);
  }
  return changed.sort();
}

/* ── Live tool cards ──────────────────────────────────────── */

function firstString(
  args: Record<string, unknown>,
  keys: string[]
): string | undefined {
  for (const key of keys) {
    const value = args[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return undefined;
}

function parseArguments(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // The model can emit partial or non-JSON arguments; fall back to no detail.
  }
  return {};
}

function truncate(value: string, max: number): string {
  const singleLine = value.split('\n')[0]?.trim() ?? '';
  return singleLine.length > max ? `${singleLine.slice(0, max - 1)}…` : singleLine;
}

function summarizeTool(
  name: string,
  rawArguments: string,
  workspace: string
): { summary: string; path?: string } {
  const args = parseArguments(rawArguments);
  const rawPath = firstString(args, ['path', 'file_path', 'filePath', 'file', 'filename']);
  let path: string | undefined;
  if (rawPath) {
    const absolute = isAbsolute(rawPath) ? resolve(rawPath) : resolve(workspace, rawPath);
    path = toVirtualPath(absolute, workspace);
  }

  switch (name) {
    case 'read':
      return { summary: `Read ${path ?? 'a file'}`, path };
    case 'read_image':
      return { summary: `Viewed image ${path ?? ''}`.trim(), path };
    case 'write':
      return { summary: `Wrote ${path ?? 'a file'}`, path };
    case 'edit':
      return { summary: `Edited ${path ?? 'a file'}`, path };
    case 'bash': {
      const command = firstString(args, ['command', 'cmd']) ?? '';
      return { summary: `Ran ${truncate(command, 72) || 'a shell command'}` };
    }
    case 'grep': {
      const pattern = firstString(args, ['pattern', 'query', 'regex']) ?? '';
      return { summary: `Searched ${truncate(pattern, 48) || 'the project'}` };
    }
    case 'glob': {
      const pattern = firstString(args, ['pattern', 'glob']) ?? '';
      return { summary: `Listed ${truncate(pattern, 48) || 'files'}` };
    }
    default:
      return { summary: name };
  }
}

const TODO_STATUSES = new Set<HarnessTodoStatus>([
  'pending',
  'in_progress',
  'completed',
]);

/** Validate the plugin-extended `todo/write` snapshot before it reaches the UI. */
function parseTodos(raw: unknown): HarnessTodoItem[] | null {
  if (!Array.isArray(raw)) return null;
  const todos: HarnessTodoItem[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const content = (entry as { content?: unknown }).content;
    const status = (entry as { status?: unknown }).status;
    if (typeof content !== 'string' || !content.trim()) continue;
    if (typeof status !== 'string' || !TODO_STATUSES.has(status as HarnessTodoStatus)) {
      continue;
    }
    todos.push({ content: content.trim(), status: status as HarnessTodoStatus });
  }
  return todos;
}

function resultDetail(
  event: SessionEventNotification['event'],
  workspace?: string
): string | undefined {
  if (event.type !== 'tool/result') return undefined;
  const reason = event.data.error?.reason;
  if (reason) return truncate(reason, 180);

  const content = event.data.message.content;
  if (!Array.isArray(content)) return undefined;
  let text = content
    .flatMap((block) =>
      block.type === 'text' && typeof block.text === 'string' ? [block.text] : []
    )
    .join('\n')
    .trim();

  // Tools often answer with an absolute path wrapped in <path> tags; show the
  // project-relative path in the tool card instead.
  if (workspace && text) {
    text = text.split(`${workspace}${sep}`).join('/').split(workspace).join('');
  }
  text = text.replaceAll('<path>', '').replaceAll('</path>', '');
  return text ? truncate(text, 180) : undefined;
}

/* ── Turn execution ───────────────────────────────────────── */

let turnQueue: Promise<unknown> = Promise.resolve();

export interface HarnessTurnHandlers {
  onEvent: (event: HarnessStreamEvent) => void;
  signal: AbortSignal;
}

function abortError(): Error {
  const error = new Error('Stopped.');
  error.name = 'AbortError';
  return error;
}

/**
 * Queue one harness turn. Turns are serialized because one subprocess owns the
 * runtime and `run()` waits for the whole agent to become idle.
 */
export function runHarnessTurn(
  request: HarnessTurnRequest,
  handlers: HarnessTurnHandlers
): Promise<HarnessTurnResult> {
  const task = turnQueue.then(() => executeWithRetry(request, handlers));
  turnQueue = task.then(
    () => undefined,
    () => undefined
  );
  return task;
}

/**
 * A runtime can disappear between turns (crash, external kill, or an aborted
 * turn). Those failures are not the user's prompt's fault: reset the runtime
 * and try the turn once against a fresh subprocess and fresh session ids.
 */
async function executeWithRetry(
  request: HarnessTurnRequest,
  handlers: HarnessTurnHandlers
): Promise<HarnessTurnResult> {
  try {
    return await executeTurn(request, handlers);
  } catch (error) {
    if (handlers.signal.aborted) throw error;
    const message = error instanceof Error ? error.message : String(error);
    const recoverable =
      /already exists/i.test(message) ||
      /transport closed/i.test(message) ||
      /runtime is gone/i.test(message) ||
      /closed/i.test(message);
    if (!recoverable) throw error;

    await resetHarness();
    if (handlers.signal.aborted) throw abortError();
    return executeTurn(request, handlers);
  }
}

async function executeTurn(
  request: HarnessTurnRequest,
  { onEvent, signal }: HarnessTurnHandlers
): Promise<HarnessTurnResult> {
  if (signal.aborted) throw abortError();

  const config = harnessConfig();
  if (!config.apiKey) throw new HarnessNotConfiguredError();

  const workspace = workspaceDir(request.conversationKey);
  onEvent({ type: 'status', message: 'Syncing project into a harness workspace…' });
  await materializeWorkspace(workspace, request.files);
  if (signal.aborted) throw abortError();

  onEvent({
    type: 'status',
    message: `Launching harness · ${config.provider}/${config.model}`,
  });

  const harness = await getHarness();
  const session = harness.session(sessionId(request.conversationKey));
  await session.setWorkingDirectory(workspace);
  if (signal.aborted) throw abortError();

  const pending = new Map<string, { name: string; path?: string }>();

  const onAbort = () => {
    // The SDK has no prompt-cancel; closing the runtime is the documented way
    // to abandon a turn. The next turn spawns a fresh subprocess.
    void resetHarness();
  };
  signal.addEventListener('abort', onAbort, { once: true });

  try {
    const result = await session.run(request.prompt, {
      onNotification: (notification: HarnessNotification) => {
        if (notification.method !== 'session.event') return;
        const params = notification.params as unknown as SessionEventNotification;
        if (params.sessionId !== session.id) return;
        const event = params.event;
        if (!event) return;

        // `todo_write` appends a plugin-extended `todo/write` snapshot on every
        // whole-list update. Stream it directly so the UI can render the plan.
        if ((event.type as string) === 'todo/write') {
          const data = (event as unknown as { data?: { todos?: unknown } }).data;
          const todos = parseTodos(data?.todos);
          if (todos) onEvent({ type: 'todo', todos });
          return;
        }

        if (event.type === 'tool/call') {
          const callId = String(event.data.callId);
          const name = event.data.name;
          const { summary, path } = summarizeTool(
            name,
            event.data.arguments,
            workspace
          );
          pending.set(callId, { name, path });
          onEvent({ type: 'tool', id: callId, name, summary, ...(path ? { path } : {}) });
        } else if (event.type === 'tool/result') {
          const callId = String(event.data.message.toolCallId);
          const known = pending.get(callId);
          pending.delete(callId);
          const name = known?.name ?? 'tool';
          const detail = resultDetail(event, workspace);
          onEvent({
            type: 'tool-done',
            id: callId,
            name,
            status: event.data.error || event.data.message.isError ? 'error' : 'ok',
            ...(detail ? { detail } : {}),
            ...(known?.path ? { path: known.path } : {}),
          });
        }
      },
    });

    if (signal.aborted) throw abortError();

    onEvent({ type: 'status', message: 'Collecting workspace changes…' });
    const collected = await collectWorkspace(workspace);
    const changedPaths = diffPaths(request.files, collected.files);

    return {
      finalResponse: result.finalResponse,
      files: collected.files,
      changedPaths,
      skipped: collected.skipped,
      sessionId: result.sessionId,
    };
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}

/** Number of harness-visible path limits, exported for route validation. */
export const HARNESS_LIMITS = {
  maxFiles: MAX_FILES,
  maxFileBytes: MAX_FILE_BYTES,
  maxTotalBytes: MAX_TOTAL_BYTES,
} as const;
