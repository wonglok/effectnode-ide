import {
  AGENT_STATE_MAX_BYTES,
  AGENT_STATE_VERSION,
} from '../../shared/agent-state';
import type {
  AgentChatMessage,
  AgentTodoItem,
  AgentTodoStatus,
} from '../../shared/types';
import type { AgentMessage, AgentQueueItem } from '@/store/agent';
import { opfsProjectStore } from './opfs';

/**
 * Durable agent transcript.
 *
 * The file lives beside the project files in OPFS
 * (`projects/<project-id>/agent-state.json`) but is deliberately excluded from
 * the virtual file system, so it never shows up in the editor tree, the preview,
 * or the agent's own file tools. ZIP export/import handles it explicitly.
 */

export interface PersistedAgentState {
  version: typeof AGENT_STATE_VERSION;
  savedAt: string;
  messages: AgentMessage[];
  history: AgentChatMessage[];
  todos: AgentTodoItem[];
  queue: AgentQueueItem[];
  undoSnapshot: Record<string, string> | null;
  undoAvailable: boolean;
}

export interface PersistableAgentState {
  messages: AgentMessage[];
  history: AgentChatMessage[];
  todos: AgentTodoItem[];
  queue: AgentQueueItem[];
  undoSnapshot: Record<string, string> | null;
  undoAvailable: boolean;
}

const MESSAGE_ROLES = new Set([
  'user',
  'assistant',
  'tool',
  'error',
  'notice',
  'refresh',
  'limit',
]);
const HISTORY_ROLES = new Set(['system', 'user', 'assistant', 'tool']);
const TODO_STATUSES = new Set<AgentTodoStatus>([
  'pending',
  'in_progress',
  'completed',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function normalizeToolCalls(value: unknown) {
  if (!Array.isArray(value)) return undefined;
  const calls = value
    .filter(isRecord)
    .filter(
      (call) =>
        typeof call.id === 'string' &&
        isRecord(call.function) &&
        typeof call.function.name === 'string' &&
        typeof call.function.arguments === 'string'
    )
    .map((call) => ({
      id: call.id as string,
      type: 'function' as const,
      function: {
        name: (call.function as Record<string, unknown>).name as string,
        arguments: (call.function as Record<string, unknown>).arguments as string,
      },
    }));
  return calls.length > 0 ? calls : undefined;
}

function normalizeMessages(value: unknown): AgentMessage[] {
  if (!Array.isArray(value)) return [];
  const messages: AgentMessage[] = [];

  for (const raw of value) {
    if (
      !isRecord(raw) ||
      typeof raw.id !== 'string' ||
      typeof raw.role !== 'string' ||
      !MESSAGE_ROLES.has(raw.role) ||
      typeof raw.at !== 'number'
    ) {
      continue;
    }
    const id = raw.id;
    const at = raw.at;

    if (raw.role === 'user') {
      if (typeof raw.content === 'string') {
        messages.push({ id, role: 'user', content: raw.content, at });
      }
      continue;
    }

    if (raw.role === 'assistant') {
      if (typeof raw.content !== 'string') continue;
      messages.push({
        id,
        role: 'assistant',
        content: raw.content,
        reasoning: optionalString(raw.reasoning),
        // A reload must never leave an infinite typing indicator.
        streaming: false,
        at,
      });
      continue;
    }

    if (raw.role === 'tool') {
      const tool = raw.tool;
      if (!isRecord(tool)) continue;
      if (
        typeof tool.name !== 'string' ||
        typeof tool.summary !== 'string' ||
        (tool.status !== 'running' && tool.status !== 'ok' && tool.status !== 'error')
      ) {
        continue;
      }
      messages.push({
        id,
        role: 'tool',
        at,
        tool: {
          name: tool.name,
          summary: tool.summary,
          status: tool.status,
          detail: optionalString(tool.detail),
          path: optionalString(tool.path),
        },
      });
      continue;
    }

    if (raw.role === 'error' || raw.role === 'notice') {
      if (typeof raw.content === 'string') {
        messages.push({ id, role: raw.role, content: raw.content, at });
      }
      continue;
    }

    if (raw.role === 'limit') {
      if (typeof raw.steps === 'number') {
        messages.push({ id, role: 'limit', steps: raw.steps, at });
      }
      continue;
    }

    messages.push({ id, role: 'refresh', at });
  }

  return messages;
}

function normalizeHistory(value: unknown): AgentChatMessage[] {
  if (!Array.isArray(value)) return [];
  const history: AgentChatMessage[] = [];

  for (const raw of value) {
    if (
      !isRecord(raw) ||
      typeof raw.role !== 'string' ||
      !HISTORY_ROLES.has(raw.role) ||
      (raw.content !== null && typeof raw.content !== 'string')
    ) {
      continue;
    }
    const message: AgentChatMessage = {
      role: raw.role as AgentChatMessage['role'],
      content: raw.content as string | null,
    };
    const name = optionalString(raw.name);
    if (name) message.name = name;
    const toolCallId = optionalString(raw.tool_call_id);
    if (toolCallId) message.tool_call_id = toolCallId;
    const toolCalls = normalizeToolCalls(raw.tool_calls);
    if (toolCalls) message.tool_calls = toolCalls;
    const thinking = optionalString(raw.thinking);
    if (thinking) message.thinking = thinking;
    const signature = optionalString(raw.thinking_signature);
    if (signature) message.thinking_signature = signature;
    history.push(message);
  }

  return history;
}

function normalizeTodos(value: unknown): AgentTodoItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isRecord)
    .filter(
      (todo) =>
        typeof todo.content === 'string' &&
        typeof todo.status === 'string' &&
        TODO_STATUSES.has(todo.status as AgentTodoStatus)
    )
    .map((todo) => ({
      content: todo.content as string,
      status: todo.status as AgentTodoStatus,
    }));
}

function normalizeQueue(value: unknown): AgentQueueItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isRecord)
    .filter(
      (item) =>
        typeof item.id === 'string' &&
        typeof item.text === 'string' &&
        typeof item.at === 'number'
    )
    .map((item) => ({
      id: item.id as string,
      text: item.text as string,
      at: item.at as number,
    }));
}

function normalizeUndoSnapshot(value: unknown): Record<string, string> | null {
  if (!isRecord(value)) return null;
  const files: Record<string, string> = {};
  for (const [path, content] of Object.entries(value)) {
    if (typeof content !== 'string') return null;
    files[path] = content;
  }
  return files;
}

/** Serialize the in-memory transcript, dropping only in pathological sizes. */
export function serializeAgentState(state: PersistableAgentState): string {
  const payload: PersistedAgentState = {
    version: AGENT_STATE_VERSION,
    savedAt: new Date().toISOString(),
    messages: state.messages.map((message) =>
      message.role === 'assistant' ? { ...message, streaming: false } : message
    ),
    history: state.history,
    todos: state.todos,
    queue: state.queue,
    undoSnapshot: state.undoSnapshot,
    undoAvailable: state.undoAvailable && Boolean(state.undoSnapshot),
  };

  let raw = JSON.stringify(payload, null, 2);
  if (raw.length > AGENT_STATE_MAX_BYTES && payload.undoSnapshot) {
    // The undo snapshot can duplicate the whole project; drop it before
    // sacrificing conversation state.
    payload.undoSnapshot = null;
    payload.undoAvailable = false;
    raw = JSON.stringify(payload, null, 2);
  }
  if (raw.length > AGENT_STATE_MAX_BYTES) {
    payload.messages = payload.messages.slice(-80);
    payload.history = payload.history.slice(-40);
    raw = JSON.stringify(payload, null, 2);
  }
  return raw;
}

/** Validate an on-disk or imported transcript; never trust it blindly. */
export function parseAgentState(raw: string | null): PersistedAgentState | null {
  if (!raw || raw.length > AGENT_STATE_MAX_BYTES) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(parsed) || parsed.version !== AGENT_STATE_VERSION) return null;

  const undoSnapshot = normalizeUndoSnapshot(parsed.undoSnapshot);
  return {
    version: AGENT_STATE_VERSION,
    savedAt:
      typeof parsed.savedAt === 'string' ? parsed.savedAt : new Date(0).toISOString(),
    messages: normalizeMessages(parsed.messages),
    history: normalizeHistory(parsed.history),
    todos: normalizeTodos(parsed.todos),
    queue: normalizeQueue(parsed.queue),
    undoSnapshot,
    undoAvailable: parsed.undoAvailable === true && Boolean(undoSnapshot),
  };
}

export async function readPersistedAgentState(
  projectId: string
): Promise<PersistedAgentState | null> {
  const raw = await opfsProjectStore.readAgentState(projectId);
  return parseAgentState(raw);
}

export async function readPersistedAgentStateRaw(
  projectId: string
): Promise<string | null> {
  return opfsProjectStore.readAgentState(projectId);
}

export function writePersistedAgentState(projectId: string, raw: string): void {
  opfsProjectStore.writeAgentState(projectId, raw);
}
