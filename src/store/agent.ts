import { create } from 'zustand';
import type {
  AgentChatMessage,
  AgentStatusResponse,
  AgentTodoItem,
  AgentTodoStatus,
} from '../../shared/types';
import { fetchAgentStatus, streamAgentChat } from '@/lib/agent-client';
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
  | { id: string; role: 'assistant'; content: string; streaming: boolean; at: number }
  | { id: string; role: 'tool'; tool: AgentToolEvent; at: number }
  | { id: string; role: 'error'; content: string; at: number }
  | { id: string; role: 'notice'; content: string; at: number }
  | { id: string; role: 'refresh'; at: number };

export interface AgentState {
  /** DeepSeek proxy status reported by the Nitro server. */
  status: AgentStatusResponse | null;
  statusLoaded: boolean;
  setupOpen: boolean;
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

function trimHistory(history: AgentChatMessage[]): AgentChatMessage[] {
  const slice = history.slice(-MAX_HISTORY_MESSAGES);
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

export const useAgentStore = create<AgentState>((set, get) => ({
  status: null,
  statusLoaded: false,
  setupOpen: false,
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
    let history = baseHistory;
    let changed = false;

    set({
      runStatus: 'running',
      runStatusText: 'Thinking…',
      error: null,
      history,
      messages: [
        ...state.messages,
        { id: makeId('user'), role: 'user', content: text, at: Date.now() },
      ],
    });

    const addNotice = (content: string) => {
      set((current) => ({
        messages: [
          ...current.messages,
          { id: makeId('notice'), role: 'notice', content, at: Date.now() },
        ],
      }));
    };

    try {
      for (let step = 0; step < MAX_STEPS; step += 1) {
        if (controller.signal.aborted || runId !== runSequence) break;
        set({ runStatusText: `Thinking · step ${step + 1}` });

        const assistantDisplayId = makeId('assistant');
        set((current) => ({
          messages: [
            ...current.messages,
            {
              id: assistantDisplayId,
              role: 'assistant',
              content: '',
              streaming: true,
              at: Date.now(),
            },
          ],
        }));

        const result = await streamAgentChat({
          messages: [
            { role: 'system', content: buildAgentSystemPrompt() },
            ...trimHistory(history),
          ],
          tools: AGENT_TOOLS,
          signal: controller.signal,
          onDelta: (chunk) => {
            if (runId !== runSequence) return;
            set((current) => ({
              messages: current.messages.map((message) =>
                message.role === 'assistant' && message.id === assistantDisplayId
                  ? { ...message, content: message.content + chunk }
                  : message
              ),
            }));
          },
        });

        if (runId !== runSequence) return;

        const toolCalls = result.toolCalls;
        const hasTools = toolCalls.length > 0;

        set((current) => ({
          messages: current.messages.flatMap((message) => {
            if (message.role !== 'assistant' || message.id !== assistantDisplayId) return [message];
            if (!result.content.trim() && hasTools) return [];
            return [{ ...message, content: result.content, streaming: false }];
          }),
        }));

        const assistantMessage: AgentChatMessage = {
          role: 'assistant',
          content: result.content || null,
        };
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
                {
                  role: 'tool',
                  tool_call_id: call.id,
                  content: todoSummary(todos),
                },
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
          addNotice(`Stopped after ${MAX_STEPS} steps. Ask again to continue.`);
        }
      }

      if (runId !== runSequence) return;

      if (controller.signal.aborted) {
        set({
          runStatus: 'idle',
          runStatusText: null,
          history: baseHistory,
          messages: finalizeStreaming(get().messages),
          ...(changed ? { undoSnapshot: snapshot, undoAvailable: true } : {}),
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
        ...(changed ? { undoSnapshot: snapshot, undoAvailable: true } : {}),
      }));
      playCompletionChime();
    } catch (error) {
      if (runId !== runSequence) return;

      const aborted = controller.signal.aborted || (error instanceof DOMException && error.name === 'AbortError');
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
        ...(changed ? { undoSnapshot: snapshot, undoAvailable: true } : {}),
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
}));

export const selectAgentConfigured = (state: AgentState): boolean =>
  Boolean(state.status?.configured);
