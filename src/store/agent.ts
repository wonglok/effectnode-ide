import { create } from 'zustand';
import type {
  AgentChatMessage,
  AgentEngine,
  AgentStatusResponse,
  AgentTodoItem,
  AgentTodoStatus,
} from '../../shared/types';
import { fetchAgentStatus, streamAgentChat } from '@/lib/agent-client';
import {
  readPersistedAgentState,
  serializeAgentState,
  writePersistedAgentState,
} from '@/lib/agent-state';
import { streamClaudeChat } from '@/lib/claude-client';
import { autoCompactCharBudget } from '@/lib/claude-config';
import { getBoundProjectId } from '@/lib/opfs';
import {
  AGENT_TOOLS,
  buildAgentSystemPrompt,
  describeToolCall,
  executeAgentTool,
} from '@/lib/agent-tools';
import { playCompletionChime, primeCompletionAudio } from '@/lib/completion-chime';
import { runtime } from '@/lib/runtime';
import { useUiStore } from './ui';
import { useWorkspaceStore } from './workspace';

const MAX_STEPS = 100;
const MAX_HISTORY_MESSAGES = 40;
const ENGINE_STORAGE_KEY = 'forge.agent.engine';

/** The frontend Claude agent is the default; the browser DeepSeek loop stays
 * available as a fallback and for the existing OpenAI-compatible proxy. */
function loadEngine(): AgentEngine {
  if (typeof window === 'undefined') return 'claude';
  try {
    return window.localStorage.getItem(ENGINE_STORAGE_KEY) === 'deepseek'
      ? 'deepseek'
      : 'claude';
  } catch {
    return 'claude';
  }
}

const TODO_STATUSES = new Set<AgentTodoStatus>([
  'pending',
  'in_progress',
  'completed',
]);

export type AgentRunStatus = 'idle' | 'running';

export interface AgentToolEvent {
  name: string;
  summary: string;
  detail?: string;
  path?: string;
  status: 'running' | 'ok' | 'error';
}

export type AgentMessage =
  | { id: string; role: 'user'; content: string; at: number }
  | {
      id: string;
      role: 'assistant';
      content: string;
      /** DeepSeek's separate `reasoning_content` stream for this step. */
      reasoning?: string;
      streaming: boolean;
      at: number;
    }
  | { id: string; role: 'tool'; tool: AgentToolEvent; at: number }
  | { id: string; role: 'error'; content: string; at: number }
  | { id: string; role: 'notice'; content: string; at: number }
  | { id: string; role: 'refresh'; at: number }
  | { id: string; role: 'limit'; steps: number; at: number };

export interface AgentQueueItem {
  id: string;
  text: string;
  at: number;
}

export interface AgentState {
  /** DeepSeek proxy status reported by the Nitro server. */
  status: AgentStatusResponse | null;
  statusLoaded: boolean;
  setupOpen: boolean;
  /** Which frontend loop drives the agent. Both run in the browser. */
  engine: AgentEngine;
  setEngine: (engine: AgentEngine) => void;
  runStatus: AgentRunStatus;
  runStatusText: string | null;
  messages: AgentMessage[];
  todos: AgentTodoItem[];
  history: AgentChatMessage[];
  /** Prompts scheduled while the current turn is running. */
  queue: AgentQueueItem[];
  error: string | null;
  undoSnapshot: Record<string, string> | null;
  undoAvailable: boolean;

  init: () => Promise<void>;
  openSetup: () => void;
  closeSetup: () => void;
  send: (text: string) => Promise<void>;
  /** Resume the loop after the max-step guard without a new user message. */
  keepGoing: () => Promise<void>;
  /** Run the oldest queued prompt now (after a stop/limit/error). */
  resumeQueue: () => Promise<void>;
  removeQueued: (id: string) => void;
  clearQueue: () => void;
  stop: () => void;
  clear: () => void;
  restoreLastRun: () => Promise<void>;
  /** Hydrate the transcript saved beside the active project in OPFS. */
  loadPersisted: () => Promise<void>;
  /** Start a new/imported project with an empty transcript. */
  resetForProject: () => void;
}

let runSequence = 0;
let activeRun: { id: number; controller: AbortController } | null = null;
let initPromise: Promise<void> | null = null;
let queueProcessing = false;
let persistEnabled = false;
let persistTimer: ReturnType<typeof setTimeout> | null = null;

type RunOutcome = 'complete' | 'limit' | 'stopped' | 'error';

function clearPersistTimer(): void {
  if (persistTimer === null) return;
  clearTimeout(persistTimer);
  persistTimer = null;
}

function isConfigured(state: AgentState): boolean {
  return state.engine === 'claude'
    ? Boolean(state.status?.claude?.configured)
    : Boolean(state.status?.configured);
}

function makeId(prefix: string): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return `${prefix}_${crypto.randomUUID()}`;
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function messageChars(message: AgentChatMessage): number {
  return (
    (message.content ?? '').length +
    (message.thinking ?? '').length +
    (message.tool_calls ?? []).reduce(
      (total, call) => total + call.function.arguments.length,
      0
    )
  );
}

function trimHistory(history: AgentChatMessage[]): AgentChatMessage[] {
  let slice = history.slice(-MAX_HISTORY_MESSAGES);
  while (slice.length > 0 && slice[0].role === 'tool') slice.shift();

  // CLAUDE_CODE_AUTO_COMPACT_WINDOW: drop the oldest turns once the transcript
  // grows past the configured budget (rough chars-per-token estimate).
  let characters = slice.reduce((total, message) => total + messageChars(message), 0);
  while (characters > autoCompactCharBudget() && slice.length > 1) {
    characters -= messageChars(slice[0]);
    slice.shift();
  }
  while (slice.length > 0 && slice[0].role === 'tool') slice.shift();

  return slice;
}

function finalizeStreaming(messages: AgentMessage[]): AgentMessage[] {
  return messages.map((message) =>
    message.role === 'assistant' && message.streaming ? { ...message, streaming: false } : message
  );
}

function parseTodos(rawArguments: string): AgentTodoItem[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawArguments);
  } catch {
    return null;
  }
  const raw = (parsed as { todos?: unknown } | null)?.todos;
  if (!Array.isArray(raw)) return null;

  const todos: AgentTodoItem[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const content = (entry as { content?: unknown }).content;
    const status = (entry as { status?: unknown }).status;
    if (typeof content !== 'string' || !content.trim()) continue;
    if (typeof status !== 'string' || !TODO_STATUSES.has(status as AgentTodoStatus)) continue;
    todos.push({ content: content.trim(), status: status as AgentTodoStatus });
  }
  return todos;
}

function todoSummary(todos: AgentTodoItem[]): string {
  const count = (status: AgentTodoStatus) =>
    todos.filter((todo) => todo.status === status).length;
  return `Updated todo list: ${count('pending')} pending, ${count('in_progress')} in progress, ${count('completed')} completed.`;
}

interface RunLoopOptions {
  /** Conversation at the start of this loop; restored on abort/error. */
  baseHistory: AgentChatMessage[];
  /** Snapshot to offer as undo if this loop (or the run it continues) writes. */
  undoSnapshot: Record<string, string> | null;
  controller: AbortController;
  runId: number;
}

export const useAgentStore = create<AgentState>((set, get) => {
  const addNotice = (content: string) => {
    set((current) => ({
      messages: [
        ...current.messages,
        { id: makeId('notice'), role: 'notice', content, at: Date.now() },
      ],
    }));
  };

  const runLoop = async ({
    baseHistory,
    undoSnapshot,
    controller,
    runId,
  }: RunLoopOptions): Promise<RunOutcome> => {
    let history = baseHistory;
    let changed = false;

    const undoPatch = () =>
      changed && undoSnapshot ? { undoSnapshot, undoAvailable: true } : {};

    try {
      for (let step = 0; step < MAX_STEPS; step += 1) {
        if (controller.signal.aborted || runId !== runSequence) return 'stopped';
        set({ runStatusText: `Thinking · step ${step + 1}` });

        const assistantDisplayId = makeId('assistant');
        set((current) => ({
          messages: [
            ...current.messages,
            {
              id: assistantDisplayId,
              role: 'assistant',
              content: '',
              reasoning: '',
              streaming: true,
              at: Date.now(),
            },
          ],
        }));

        let stepReasoning = '';

        const onDelta = (chunk: string) => {
          if (runId !== runSequence) return;
          set((current) => ({
            messages: current.messages.map((message) =>
              message.role === 'assistant' && message.id === assistantDisplayId
                ? { ...message, content: message.content + chunk }
                : message
            ),
          }));
        };

        const onReasoning = (chunk: string) => {
          stepReasoning += chunk;
          if (runId !== runSequence) return;
          set((current) => ({
            messages: current.messages.map((message) =>
              message.role === 'assistant' && message.id === assistantDisplayId
                ? { ...message, reasoning: (message.reasoning ?? '') + chunk }
                : message
            ),
          }));
        };

        const engine = get().engine;
        const result =
          engine === 'claude'
            ? await streamClaudeChat({
                system: buildAgentSystemPrompt(),
                messages: trimHistory(history),
                tools: AGENT_TOOLS,
                signal: controller.signal,
                onDelta,
                onReasoning,
              })
            : await streamAgentChat({
                messages: [
                  { role: 'system', content: buildAgentSystemPrompt() },
                  ...trimHistory(history),
                ],
                tools: AGENT_TOOLS,
                signal: controller.signal,
                onDelta,
                onReasoning,
              });

        if (runId !== runSequence) return 'stopped';

        const toolCalls = result.toolCalls;
        const hasTools = toolCalls.length > 0;

        set((current) => ({
          messages: current.messages.flatMap((message) => {
            if (message.role !== 'assistant' || message.id !== assistantDisplayId) return [message];
            // Keep a tool-only step when it produced a thinking log.
            if (!result.content.trim() && !(message.reasoning ?? '').trim() && hasTools) {
              return [];
            }
            return [{ ...message, content: result.content, streaming: false }];
          }),
        }));

        const assistantMessage: AgentChatMessage = {
          role: 'assistant',
          content: result.content || null,
        };
        // Claude requires thinking blocks to be replayed alongside tool calls.
        if (engine === 'claude') {
          const thinking = (result.reasoning ?? stepReasoning).trim();
          if (thinking) {
            assistantMessage.thinking = thinking;
            if (result.reasoningSignature) {
              assistantMessage.thinking_signature = result.reasoningSignature;
            }
          }
        }
        if (hasTools) assistantMessage.tool_calls = toolCalls;
        history = [...history, assistantMessage];
        set({ history });

        if (!hasTools) {
          if (!result.content.trim()) addNotice('The model returned an empty response.');
          break;
        }

        for (const call of toolCalls) {
          if (controller.signal.aborted || runId !== runSequence) break;

          // The plan has its own panel; keep it out of the tool-card stream.
          if (call.function.name === 'todo_write') {
            const todos = parseTodos(call.function.arguments);
            if (todos) {
              set({ todos, runStatusText: 'Updating the task plan…' });
              history = [
                ...history,
                { role: 'tool', tool_call_id: call.id, content: todoSummary(todos) },
              ];
            } else {
              history = [
                ...history,
                {
                  role: 'tool',
                  tool_call_id: call.id,
                  content: 'Error: todos must be an array of { content, status } items.',
                },
              ];
            }
            set({ history });
            continue;
          }

          const preview = describeToolCall(call);
          const displayId = makeId('tool');
          set({ runStatusText: preview.summary });

          set((current) => ({
            messages: [
              ...current.messages,
              {
                id: displayId,
                role: 'tool',
                at: Date.now(),
                tool: {
                  name: preview.name,
                  summary: preview.summary,
                  path: preview.path,
                  status: 'running',
                },
              },
            ],
          }));

          const outcome = await executeAgentTool(preview.name, call.function.arguments);
          if (runId !== runSequence) return 'stopped';
          changed = changed || outcome.changed;

          set((current) => ({
            messages: current.messages.map((message) =>
              message.role === 'tool' && message.id === displayId
                ? {
                    ...message,
                    tool: {
                      name: preview.name,
                      summary: outcome.summary,
                      detail: outcome.detail,
                      path: outcome.path ?? preview.path,
                      status: outcome.status,
                    },
                  }
                : message
            ),
          }));

          history = [
            ...history,
            { role: 'tool', tool_call_id: call.id, content: outcome.output },
          ];
          set({ history });
        }

        if (controller.signal.aborted) break;

        if (step === MAX_STEPS - 1) {
          set((current) => ({
            runStatus: 'idle',
            runStatusText: null,
            messages: [
              ...finalizeStreaming(current.messages),
              { id: makeId('limit'), role: 'limit', steps: MAX_STEPS, at: Date.now() },
            ],
            ...undoPatch(),
          }));
          runtime.log('warn', `Agent stopped at the ${MAX_STEPS}-step limit`);
          return 'limit';
        }
      }

      if (runId !== runSequence) return 'stopped';

      if (controller.signal.aborted) {
        set({
          runStatus: 'idle',
          runStatusText: null,
          history: baseHistory,
          messages: finalizeStreaming(get().messages),
          ...undoPatch(),
        });
        addNotice('Stopped.');
        return 'stopped';
      }

      set((current) => ({
        runStatus: 'idle',
        runStatusText: null,
        messages: [
          ...finalizeStreaming(current.messages),
          { id: makeId('refresh'), role: 'refresh', at: Date.now() },
        ],
        ...undoPatch(),
      }));
      playCompletionChime();
      return 'complete';
    } catch (error) {
      if (runId !== runSequence) return 'stopped';

      const aborted =
        controller.signal.aborted ||
        (error instanceof DOMException && error.name === 'AbortError');
      const message = aborted
        ? 'Stopped.'
        : error instanceof Error
          ? error.message
          : String(error);

      set({
        runStatus: 'idle',
        runStatusText: null,
        history: baseHistory,
        error: aborted ? null : message,
        messages: finalizeStreaming(get().messages),
        ...undoPatch(),
      });

      if (aborted) {
        addNotice('Stopped.');
      } else {
        set((current) => ({
          messages: [
            ...current.messages,
            { id: makeId('error'), role: 'error', content: message, at: Date.now() },
          ],
        }));
        runtime.log('error', `Agent: ${message}`);
      }
      return aborted ? 'stopped' : 'error';
    } finally {
      if (activeRun?.id === runId) activeRun = null;
    }
  };

  /** Start one prompt. Callers must ensure the loop is idle. */
  const startPrompt = async (text: string): Promise<RunOutcome> => {
    const state = get();

    // `send` runs from the composer's submit gesture; unlock audio now so the
    // completion chime is allowed when the model finishes some time later.
    primeCompletionAudio();

    const snapshot = runtime.snapshot();
    const controller = new AbortController();
    const runId = ++runSequence;
    activeRun = { id: runId, controller };

    const userMessage: AgentChatMessage = { role: 'user', content: text };
    const baseHistory = [...state.history, userMessage];

    set({
      runStatus: 'running',
      runStatusText: 'Thinking…',
      error: null,
      history: baseHistory,
      messages: [
        ...state.messages.filter((message) => message.role !== 'limit'),
        { id: makeId('user'), role: 'user', content: text, at: Date.now() },
      ],
    });

    return runLoop({ baseHistory, undoSnapshot: snapshot, controller, runId });
  };

  /** Run queued prompts in order until the queue empties or a turn pauses. */
  const drainQueue = async (): Promise<void> => {
    if (queueProcessing) return;
    queueProcessing = true;
    try {
      while (true) {
        const state = get();
        if (state.runStatus === 'running') break;
        const next = state.queue[0];
        if (!next) break;

        set((current) => ({
          queue: current.queue.filter((item) => item.id !== next.id),
        }));
        const outcome = await startPrompt(next.text);
        if (outcome !== 'complete') break;
      }
    } finally {
      queueProcessing = false;
    }
  };

  return {
    status: null,
    statusLoaded: false,
    setupOpen: false,
    engine: loadEngine(),
    runStatus: 'idle',
    runStatusText: null,
    messages: [],
    todos: [],
    history: [],
    queue: [],
    error: null,
    undoSnapshot: null,
    undoAvailable: false,

    init: () => {
      initPromise ??= (async () => {
        try {
          const status = await fetchAgentStatus();
          set({ status, statusLoaded: true });
        } catch (error) {
          set({ statusLoaded: true });
          runtime.log(
            'warn',
            `Agent status unavailable: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      })();
      return initPromise;
    },

    openSetup: () => set({ setupOpen: true }),
    closeSetup: () => set({ setupOpen: false }),

    setEngine: (engine) => {
      if (get().runStatus === 'running' || get().engine === engine) return;
      try {
        window.localStorage.setItem(ENGINE_STORAGE_KEY, engine);
      } catch {
        // Storage can be unavailable in private contexts.
      }
      set({ engine });
    },

    send: async (rawText) => {
      const text = rawText.trim();
      if (!text) return;

      const state = get();
      if (!isConfigured(state)) {
        set({ setupOpen: true });
        return;
      }

      // Always schedule, then let the drain decide whether it can start now.
      // This is what lets the composer accept prompts while a turn is running.
      set((current) => ({
        queue: [
          ...current.queue,
          { id: makeId('prompt'), text, at: Date.now() },
        ],
      }));

      await drainQueue();
    },

    keepGoing: async () => {
      const state = get();
      if (state.runStatus === 'running' || state.history.length === 0) return;

      primeCompletionAudio();

      const snapshot = state.undoSnapshot ?? runtime.snapshot();
      const controller = new AbortController();
      const runId = ++runSequence;
      activeRun = { id: runId, controller };

      set((current) => ({
        runStatus: 'running',
        runStatusText: 'Continuing…',
        error: null,
        messages: current.messages.filter((message) => message.role !== 'limit'),
      }));

      const outcome = await runLoop({
        baseHistory: state.history,
        undoSnapshot: snapshot,
        controller,
        runId,
      });
      if (outcome === 'complete') await drainQueue();
    },

    resumeQueue: async () => {
      await drainQueue();
    },

    removeQueued: (id) => {
      set((current) => ({
        queue: current.queue.filter((item) => item.id !== id),
      }));
    },

    clearQueue: () => set({ queue: [] }),

    stop: () => {
      activeRun?.controller.abort();
    },

    clear: () => {
      activeRun?.controller.abort();
      activeRun = null;
      runSequence += 1;
      set({
        runStatus: 'idle',
        runStatusText: null,
        messages: [],
        todos: [],
        history: [],
        queue: [],
        error: null,
        undoSnapshot: null,
        undoAvailable: false,
      });
      // Clearing is an explicit user action; persist the empty transcript now.
      flushAgentStatePersistence();
    },

    restoreLastRun: async () => {
      const snapshot = get().undoSnapshot;
      if (!snapshot) return;

      activeRun?.controller.abort();
      activeRun = null;
      runSequence += 1;

      try {
        await runtime.replaceProject(snapshot);
        useWorkspaceStore.getState().loadFiles(snapshot);
        set((current) => ({
          undoSnapshot: null,
          undoAvailable: false,
          runStatus: 'idle',
          runStatusText: null,
          history: [],
          messages: [
            ...current.messages,
            {
              id: makeId('notice'),
              role: 'notice',
              content: 'Restored the project to its state before the last agent run.',
              at: Date.now(),
            },
          ],
        }));
        runtime.log('success', 'Agent changes reverted');
        useUiStore.getState().toast('Agent changes reverted');
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        runtime.log('error', `Could not revert agent changes: ${message}`);
        useUiStore.getState().toast('Could not revert agent changes', 'error');
      }
    },

    loadPersisted: async () => {
      persistEnabled = false;
      clearPersistTimer();
      activeRun?.controller.abort();
      activeRun = null;
      runSequence += 1;

      const projectId = getBoundProjectId();
      let persisted: Awaited<ReturnType<typeof readPersistedAgentState>> = null;
      if (projectId) {
        try {
          persisted = await readPersistedAgentState(projectId);
        } catch (error) {
          runtime.log(
            'warn',
            `Could not read the saved agent state: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
        }
      }

      if (persisted) {
        try {
          window.localStorage.setItem(ENGINE_STORAGE_KEY, persisted.engine);
        } catch {
          // Storage can be unavailable in private contexts.
        }
        set({
          engine: persisted.engine,
          messages: persisted.messages,
          history: persisted.history,
          todos: persisted.todos,
          queue: persisted.queue,
          undoSnapshot: persisted.undoSnapshot,
          undoAvailable: persisted.undoAvailable,
          runStatus: 'idle',
          runStatusText: null,
          error: null,
          setupOpen: false,
        });
      } else {
        set({
          messages: [],
          history: [],
          todos: [],
          queue: [],
          undoSnapshot: null,
          undoAvailable: false,
          runStatus: 'idle',
          runStatusText: null,
          error: null,
          setupOpen: false,
        });
      }

      persistEnabled = true;
    },

    resetForProject: () => {
      persistEnabled = false;
      clearPersistTimer();
      activeRun?.controller.abort();
      activeRun = null;
      runSequence += 1;
      set({
        messages: [],
        history: [],
        todos: [],
        queue: [],
        undoSnapshot: null,
        undoAvailable: false,
        runStatus: 'idle',
        runStatusText: null,
        error: null,
        setupOpen: false,
      });
      persistEnabled = true;
    },
  };
});

/** Write the live transcript to the bound project without waiting for the debounce. */
export function flushAgentStatePersistence(): void {
  clearPersistTimer();
  const projectId = getBoundProjectId();
  if (!projectId) return;
  try {
    writePersistedAgentState(projectId, serializeAgentState(useAgentStore.getState()));
  } catch (error) {
    runtime.log(
      'warn',
      `Could not save the agent state: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

/**
 * Stop writing while the workspace switches projects, and abort an in-flight
 * run so it cannot write into the newly bound project.
 */
export function pauseAgentStatePersistence(): void {
  persistEnabled = false;
  clearPersistTimer();
  activeRun?.controller.abort();
  activeRun = null;
  runSequence += 1;
}

export function resumeAgentStatePersistence(): void {
  persistEnabled = true;
}

function scheduleAgentStatePersistence(): void {
  if (!persistEnabled || typeof window === 'undefined') return;
  clearPersistTimer();
  persistTimer = setTimeout(() => {
    persistTimer = null;
    flushAgentStatePersistence();
  }, 350);
}

useAgentStore.subscribe((state, previous) => {
  if (!persistEnabled) return;
  if (
    state.engine === previous.engine &&
    state.messages === previous.messages &&
    state.history === previous.history &&
    state.todos === previous.todos &&
    state.queue === previous.queue &&
    state.undoSnapshot === previous.undoSnapshot &&
    state.undoAvailable === previous.undoAvailable
  ) {
    return;
  }
  scheduleAgentStatePersistence();
});

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', flushAgentStatePersistence);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushAgentStatePersistence();
  });
}

export const selectAgentConfigured = (state: AgentState): boolean =>
  isConfigured(state);
