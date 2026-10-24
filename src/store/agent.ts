import { create } from 'zustand';
import type {
  AgentChatMessage,
  AgentEngine,
  AgentStatusResponse,
  AgentTodoItem,
  AgentTodoStatus,
} from '../../shared/types';
import { fetchAgentStatus, streamAgentChat } from '@/lib/agent-client';
import { streamClaudeChat } from '@/lib/claude-client';
import { autoCompactCharBudget } from '@/lib/claude-config';
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

const MAX_STEPS = 8;
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
  error: string | null;
  undoSnapshot: Record<string, string> | null;
  undoAvailable: boolean;

  init: () => Promise<void>;
  openSetup: () => void;
  closeSetup: () => void;
  send: (text: string) => Promise<void>;
  /** Resume the loop after the max-step guard without a new user message. */
  keepGoing: () => Promise<void>;
  stop: () => void;
  clear: () => void;
  restoreLastRun: () => Promise<void>;
}

let runSequence = 0;
let activeRun: { id: number; controller: AbortController } | null = null;
let initPromise: Promise<void> | null = null;

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
  }: RunLoopOptions): Promise<void> => {
    let history = baseHistory;
    let changed = false;

    const undoPatch = () =>
      changed && undoSnapshot ? { undoSnapshot, undoAvailable: true } : {};

    try {
      for (let step = 0; step < MAX_STEPS; step += 1) {
        if (controller.signal.aborted || runId !== runSequence) return;
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

        if (runId !== runSequence) return;

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
          if (runId !== runSequence) return;
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
          return;
        }
      }

      if (runId !== runSequence) return;

      if (controller.signal.aborted) {
        set({
          runStatus: 'idle',
          runStatusText: null,
          history: baseHistory,
          messages: finalizeStreaming(get().messages),
          ...undoPatch(),
        });
        addNotice('Stopped.');
        return;
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
    } catch (error) {
      if (runId !== runSequence) return;

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
    } finally {
      if (activeRun?.id === runId) activeRun = null;
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
      const state = get();
      if (!text || state.runStatus === 'running') return;

      if (!state.status?.configured) {
        set({ setupOpen: true });
        return;
      }

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

      await runLoop({ baseHistory, undoSnapshot: snapshot, controller, runId });
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

      await runLoop({ baseHistory: state.history, undoSnapshot: snapshot, controller, runId });
    },

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
        error: null,
        undoSnapshot: null,
        undoAvailable: false,
      });
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
  };
});

export const selectAgentConfigured = (state: AgentState): boolean =>
  state.engine === 'claude'
    ? Boolean(state.status?.claude?.configured)
    : Boolean(state.status?.configured);
