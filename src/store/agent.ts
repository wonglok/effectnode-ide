import { create } from "zustand";
import type {
  AgentChatMessage,
  AgentStatusResponse,
  AgentTodoItem,
  AgentToolCall,
} from "../../shared/types";
import { autoCompactCharBudget, PI_AGENT } from "../../shared/pi";
import { fetchAgentStatus } from "@/lib/agent-client";
import {
  readPersistedAgentState,
  serializeAgentState,
  writePersistedAgentState,
} from "@/lib/agent-state";
import { createPiSession } from "@/lib/pi-harness";
import { getBoundProjectId } from "@/lib/opfs";
import { loadProjectAssets } from "@/lib/project-assets";
import {
  buildAgentSystemPrompt,
  describeToolCall,
} from "@/lib/agent-tools";
import {
  playCompletionChime,
  primeCompletionAudio,
} from "@/lib/completion-chime";
import { runtime } from "@/lib/runtime";
import { useRuntimeStore } from "./runtime";
import { useUiStore } from "./ui";
import { useWorkspaceStore } from "./workspace";

const MAX_STEPS = PI_AGENT.maxSteps;
const MAX_HISTORY_MESSAGES = 40;
const EMPTY_RETRY_SECONDS = 3;
const EMPTY_RETRY_PROMPT = "keep going";
const LIMIT_CONTINUE_SECONDS = 3;

export type AgentRunStatus = "idle" | "running";

export interface AgentToolEvent {
  name: string;
  summary: string;
  detail?: string;
  path?: string;
  status: "running" | "ok" | "error";
}

export type AgentMessage =
  | { id: string; role: "user"; content: string; at: number }
  | {
      id: string;
      role: "assistant";
      content: string;
      /** DeepSeek's separate `reasoning_content` stream for this step. */
      reasoning?: string;
      streaming: boolean;
      at: number;
    }
  | { id: string; role: "tool"; tool: AgentToolEvent; at: number }
  | { id: string; role: "error"; content: string; at: number }
  | { id: string; role: "notice"; content: string; at: number }
  | { id: string; role: "refresh"; at: number }
  | { id: string; role: "limit"; steps: number; at: number };

export interface AgentQueueItem {
  id: string;
  text: string;
  at: number;
}

/** Transient countdown shown beside an empty-response notice. */
export interface AgentEmptyResponseRetry {
  messageId: string;
  secondsLeft: number;
  status: "countdown" | "sent" | "cancelled";
}

/** Transient countdown that auto-resumes after the step limit card appears. */
export interface AgentLimitCountdown {
  messageId: string;
  secondsLeft: number;
  status: "countdown" | "sent" | "cancelled";
}

export interface AgentState {
  /** Pi harness status reported by the Nitro server. */
  status: AgentStatusResponse | null;
  statusLoaded: boolean;
  runStatus: AgentRunStatus;
  runStatusText: string | null;
  messages: AgentMessage[];
  todos: AgentTodoItem[];
  history: AgentChatMessage[];
  /** Prompts scheduled while the current turn is running. */
  queue: AgentQueueItem[];
  error: string | null;
  /** Auto-retry prompt scheduled after the model answers with nothing. */
  emptyResponseRetry: AgentEmptyResponseRetry | null;
  /** Auto continue scheduled after the step limit is reached. */
  limitCountdown: AgentLimitCountdown | null;
  undoSnapshot: Record<string, string> | null;
  undoAvailable: boolean;

  init: () => Promise<void>;
  send: (text: string) => Promise<void>;
  /** Resume the loop after the max-step guard without a new user message. */
  keepGoing: () => Promise<void>;
  /** Run the oldest queued prompt now (after a stop/limit/error). */
  resumeQueue: () => Promise<void>;
  removeQueued: (id: string) => void;
  clearQueue: () => void;
  /** Stop the pending 3-second retry without sending anything. */
  cancelEmptyResponseRetry: () => void;
  /** Stop the pending 3-second automatic continue after a step limit. */
  cancelLimitCountdown: () => void;
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

type RunOutcome = "complete" | "limit" | "stopped" | "error";

function clearPersistTimer(): void {
  if (persistTimer === null) return;
  clearTimeout(persistTimer);
  persistTimer = null;
}

function isConfigured(state: AgentState): boolean {
  return Boolean(state.status?.configured);
}

function makeId(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto)
    return `${prefix}_${crypto.randomUUID()}`;
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function messageChars(message: AgentChatMessage): number {
  return (
    (message.content ?? "").length +
    (message.thinking ?? "").length +
    (message.tool_calls ?? []).reduce(
      (total, call) => total + call.function.arguments.length,
      0,
    )
  );
}

function trimHistory(history: AgentChatMessage[]): AgentChatMessage[] {
  let slice = history.slice(-MAX_HISTORY_MESSAGES);
  while (slice.length > 0 && slice[0].role === "tool") slice.shift();

  // Drop the oldest turns once the transcript grows past the Pi harness's
  // auto-compact budget (rough chars-per-token estimate).
  let characters = slice.reduce(
    (total, message) => total + messageChars(message),
    0,
  );
  while (characters > autoCompactCharBudget() && slice.length > 1) {
    characters -= messageChars(slice[0]);
    slice.shift();
  }
  while (slice.length > 0 && slice[0].role === "tool") slice.shift();

  return slice;
}

function finalizeStreaming(messages: AgentMessage[]): AgentMessage[] {
  return messages.map((message) =>
    message.role === "assistant" && message.streaming
      ? { ...message, streaming: false }
      : message,
  );
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
    const id = makeId("notice");
    set((current) => ({
      messages: [
        ...current.messages,
        { id, role: "notice", content, at: Date.now() },
      ],
    }));
    return id;
  };

  let emptyRetryTimer: ReturnType<typeof setTimeout> | null = null;

  const clearEmptyRetryTimer = () => {
    if (emptyRetryTimer === null) return;
    clearTimeout(emptyRetryTimer);
    emptyRetryTimer = null;
  };

  const sendEmptyRetry = () => {
    const current = get().emptyResponseRetry;
    if (!current || current.status !== "countdown") return;
    clearEmptyRetryTimer();

    if (!isConfigured(get())) {
      set({
        emptyResponseRetry: { ...current, secondsLeft: 0, status: "cancelled" },
      });
      addNotice(
        "The Pi harness is not configured. Set DEEPSEEK_API_KEY (or AGENT_API_KEY) in .env.local and restart the server.",
      );
      return;
    }

    set({
      emptyResponseRetry: { ...current, secondsLeft: 0, status: "sent" },
    });
    void get().send(EMPTY_RETRY_PROMPT);
  };

  const scheduleEmptyResponseRetry = (messageId: string) => {
    clearEmptyRetryTimer();
    set({
      emptyResponseRetry: {
        messageId,
        secondsLeft: EMPTY_RETRY_SECONDS,
        status: "countdown",
      },
    });

    const tick = () => {
      const current = get().emptyResponseRetry;
      if (
        !current ||
        current.messageId !== messageId ||
        current.status !== "countdown"
      ) {
        clearEmptyRetryTimer();
        return;
      }

      if (current.secondsLeft <= 1) {
        sendEmptyRetry();
        return;
      }

      set({
        emptyResponseRetry: {
          ...current,
          secondsLeft: current.secondsLeft - 1,
        },
      });
      emptyRetryTimer = setTimeout(tick, 1000);
    };

    emptyRetryTimer = setTimeout(tick, 1000);
  };

  const cancelEmptyResponseRetry = () => {
    const current = get().emptyResponseRetry;
    if (!current || current.status !== "countdown") return;
    clearEmptyRetryTimer();
    set({
      emptyResponseRetry: { ...current, secondsLeft: 0, status: "cancelled" },
    });
  };

  let limitCountdownTimer: ReturnType<typeof setTimeout> | null = null;

  const clearLimitCountdownTimer = () => {
    if (limitCountdownTimer === null) return;
    clearTimeout(limitCountdownTimer);
    limitCountdownTimer = null;
  };

  /** Drop the countdown, e.g. when a new run starts or the project resets. */
  const clearLimitCountdown = () => {
    clearLimitCountdownTimer();
    if (get().limitCountdown) set({ limitCountdown: null });
  };

  const sendLimitContinue = () => {
    const current = get().limitCountdown;
    if (!current || current.status !== "countdown") return;
    clearLimitCountdownTimer();

    if (!isConfigured(get())) {
      set({
        limitCountdown: { ...current, secondsLeft: 0, status: "cancelled" },
      });
      addNotice(
        "The Pi harness is not configured. Set DEEPSEEK_API_KEY (or AGENT_API_KEY) in .env.local and restart the server.",
      );
      return;
    }

    set({
      limitCountdown: { ...current, secondsLeft: 0, status: "sent" },
    });
    void get().keepGoing();
  };

  /** Auto-click Keep going three seconds after the limit card appears. */
  const scheduleLimitContinue = (messageId: string) => {
    clearLimitCountdownTimer();
    set({
      limitCountdown: {
        messageId,
        secondsLeft: LIMIT_CONTINUE_SECONDS,
        status: "countdown",
      },
    });

    const tick = () => {
      const current = get().limitCountdown;
      if (
        !current ||
        current.messageId !== messageId ||
        current.status !== "countdown"
      ) {
        clearLimitCountdownTimer();
        return;
      }

      if (current.secondsLeft <= 1) {
        sendLimitContinue();
        return;
      }

      set({
        limitCountdown: {
          ...current,
          secondsLeft: current.secondsLeft - 1,
        },
      });
      limitCountdownTimer = setTimeout(tick, 1000);
    };

    limitCountdownTimer = setTimeout(tick, 1000);
  };

  const cancelLimitCountdown = () => {
    const current = get().limitCountdown;
    if (!current || current.status !== "countdown") return;
    clearLimitCountdownTimer();
    set({
      limitCountdown: { ...current, secondsLeft: 0, status: "cancelled" },
    });
  };

  /**
   * Pi harness path. Pi's Agent owns the multi-turn loop and tool execution;
   * this adapter streams its lifecycle events into the same transcript UI.
   */
  const runPiLoop = async ({
    baseHistory,
    undoSnapshot,
    controller,
    runId,
  }: RunLoopOptions): Promise<RunOutcome> => {
    let changed = false;
    let finalError: string | null = null;
    let currentAssistantId: string | null = null;
    let streamedText = "";
    let streamedReasoning = "";
    let turns = 0;
    const toolCards = new Map<string, string>();

    const undoPatch = () =>
      changed && undoSnapshot ? { undoSnapshot, undoAvailable: true } : {};

    const session = createPiSession({
      history: trimHistory(baseHistory),
      systemPrompt: buildAgentSystemPrompt(),
      maxSteps: MAX_STEPS,
      onTodos: (todos) => set({ todos }),
    });

    const onAbort = () => session.abort();
    controller.signal.addEventListener("abort", onAbort, { once: true });

    const unsubscribe = session.subscribe((event) => {
      if (runId !== runSequence) return;

      if (event.type === "turn_start") {
        turns += 1;
        set({ runStatusText: `Thinking · step ${turns}` });
        return;
      }

      if (event.type === "message_start") {
        if (event.message.role !== "assistant") return;
        const assistantId = makeId("assistant");
        currentAssistantId = assistantId;
        streamedText = "";
        streamedReasoning = "";
        set((current) => ({
          messages: [
            ...current.messages,
            {
              id: assistantId,
              role: "assistant",
              content: "",
              reasoning: "",
              streaming: true,
              at: Date.now(),
            },
          ],
        }));
        return;
      }

      if (event.type === "message_update") {
        if (event.message.role !== "assistant" || !currentAssistantId) return;
        const assistantId = currentAssistantId;
        const update = event.assistantMessageEvent;
        if (update.type === "text_delta") {
          const delta = update.delta;
          streamedText += delta;
          set((current) => ({
            messages: current.messages.map((message) =>
              message.role === "assistant" && message.id === assistantId
                ? { ...message, content: message.content + delta }
                : message,
            ),
          }));
        } else if (update.type === "thinking_delta") {
          const delta = update.delta;
          streamedReasoning += delta;
          set((current) => ({
            messages: current.messages.map((message) =>
              message.role === "assistant" && message.id === assistantId
                ? { ...message, reasoning: (message.reasoning ?? "") + delta }
                : message,
            ),
          }));
        }
        return;
      }

      if (event.type === "message_end") {
        if (event.message.role !== "assistant" || !currentAssistantId) return;
        const assistantId = currentAssistantId;
        const blocks = event.message.content;
        const text = blocks
          .map((block) => (block.type === "text" ? block.text : ""))
          .filter(Boolean)
          .join("\n");
        const thinking = blocks
          .map((block) => (block.type === "thinking" ? block.thinking : ""))
          .filter(Boolean)
          .join("\n");
        const finalText = text || streamedText;
        const finalThinking = thinking || streamedReasoning;
        const hasToolCalls = blocks.some((block) => block.type === "toolCall");
        // A later successful retry clears an earlier provider error.
        finalError = event.message.errorMessage || null;

        set((current) => ({
          messages: current.messages.flatMap((message) => {
            if (message.role !== "assistant" || message.id !== assistantId) {
              return [message];
            }
            if (!finalText.trim() && !finalThinking.trim() && hasToolCalls) {
              return [];
            }
            return [
              {
                ...message,
                content: finalText,
                reasoning: finalThinking,
                streaming: false,
              },
            ];
          }),
        }));
        currentAssistantId = null;
        return;
      }

      if (event.type === "tool_execution_start") {
        if (event.toolName === "todo_write") {
          set({ runStatusText: "Updating the task plan…" });
          return;
        }

        const call: AgentToolCall = {
          id: event.toolCallId,
          type: "function",
          function: {
            name: event.toolName,
            arguments: JSON.stringify(event.args ?? {}),
          },
        };
        const preview = describeToolCall(call);
        const displayId = makeId("tool");
        toolCards.set(event.toolCallId, displayId);
        set((current) => ({
          runStatusText: preview.summary,
          messages: [
            ...current.messages,
            {
              id: displayId,
              role: "tool",
              at: Date.now(),
              tool: {
                name: preview.name,
                summary: preview.summary,
                path: preview.path,
                status: "running",
              },
            },
          ],
        }));
        return;
      }

      if (event.type === "tool_execution_end") {
        if (event.toolName === "todo_write") return;
        const displayId = toolCards.get(event.toolCallId);
        if (!displayId) return;

        const details = (event.result?.details ?? {}) as {
          summary?: string;
          detail?: string;
          path?: string;
          status?: "ok" | "error";
          changed?: boolean;
        };
        changed = changed || Boolean(details.changed);
        const status: "ok" | "error" =
          event.isError || details.status === "error" ? "error" : "ok";

        set((current) => ({
          runStatusText: details.summary ?? `Ran ${event.toolName}`,
          messages: current.messages.map((message) =>
            message.role === "tool" && message.id === displayId
              ? {
                  ...message,
                  tool: {
                    name: event.toolName,
                    summary: details.summary ?? message.tool.summary,
                    detail: details.detail,
                    path: details.path ?? message.tool.path,
                    status,
                  },
                }
              : message,
          ),
        }));
      }
    });

    try {
      await session.continue();
      if (runId !== runSequence) return "stopped";

      if (controller.signal.aborted) {
        set({
          runStatus: "idle",
          runStatusText: null,
          history: baseHistory,
          messages: finalizeStreaming(get().messages),
          ...undoPatch(),
        });
        addNotice("Stopped.");
        return "stopped";
      }

      if (finalError) throw new Error(finalError);

      const nextHistory = session.toHistory();
      set({ history: nextHistory });

      if (session.hitLimit) {
        const limitId = makeId("limit");
        set((current) => ({
          runStatus: "idle",
          runStatusText: null,
          messages: [
            ...finalizeStreaming(current.messages),
            { id: limitId, role: "limit", steps: MAX_STEPS, at: Date.now() },
          ],
          ...undoPatch(),
        }));
        scheduleLimitContinue(limitId);
        runtime.log("warn", `Agent stopped at the ${MAX_STEPS}-step limit`);
        return "limit";
      }

      const lastAssistant = [...nextHistory]
        .reverse()
        .find((message) => message.role === "assistant");
      if (
        !lastAssistant?.tool_calls?.length &&
        !(lastAssistant?.content ?? "").trim()
      ) {
        const noticeId = addNotice("The model returned an empty response.");
        scheduleEmptyResponseRetry(noticeId);
      }

      set((current) => ({
        runStatus: "idle",
        runStatusText: null,
        messages: [
          ...finalizeStreaming(current.messages),
          { id: makeId("refresh"), role: "refresh", at: Date.now() },
        ],
        ...undoPatch(),
      }));
      // Task complete: reload the preview so the user sees the final state.
      useRuntimeStore.getState().reloadPreview();
      playCompletionChime(3);
      return "complete";
    } catch (error) {
      if (runId !== runSequence) return "stopped";

      const aborted =
        controller.signal.aborted ||
        (error instanceof DOMException && error.name === "AbortError");
      const message = aborted
        ? "Stopped."
        : error instanceof Error
          ? error.message
          : String(error);

      set({
        runStatus: "idle",
        runStatusText: null,
        history: baseHistory,
        error: aborted ? null : message,
        messages: finalizeStreaming(get().messages),
        ...undoPatch(),
      });

      if (aborted) {
        addNotice("Stopped.");
      } else {
        set((current) => ({
          messages: [
            ...current.messages,
            {
              id: makeId("error"),
              role: "error",
              content: message,
              at: Date.now(),
            },
          ],
        }));
        runtime.log("error", `Agent: ${message}`);
      }
      return aborted ? "stopped" : "error";
    } finally {
      controller.signal.removeEventListener("abort", onAbort);
      unsubscribe();
      session.dispose();
      if (activeRun?.id === runId) activeRun = null;
    }
  };

  /** Start one prompt. Callers must ensure the loop is idle. */
  const startPrompt = async (text: string): Promise<RunOutcome> => {
    const state = get();
    clearLimitCountdown();

    // `send` runs from the composer's submit gesture; unlock audio now so the
    // completion chime is allowed when the model finishes some time later.
    primeCompletionAudio();

    const snapshot = runtime.snapshot();
    const controller = new AbortController();
    const runId = ++runSequence;
    activeRun = { id: runId, controller };

    const userMessage: AgentChatMessage = { role: "user", content: text };
    const baseHistory = [...state.history, userMessage];

    set({
      runStatus: "running",
      runStatusText: "Thinking…",
      error: null,
      history: baseHistory,
      messages: [
        ...state.messages.filter((message) => message.role !== "limit"),
        { id: makeId("user"), role: "user", content: text, at: Date.now() },
      ],
    });

    return runPiLoop({
      baseHistory,
      undoSnapshot: snapshot,
      controller,
      runId,
    });
  };

  /** Run queued prompts in order until the queue empties or a turn pauses. */
  const drainQueue = async (): Promise<void> => {
    if (queueProcessing) return;
    queueProcessing = true;
    try {
      while (true) {
        const state = get();
        if (state.runStatus === "running") break;
        const next = state.queue[0];
        if (!next) break;

        set((current) => ({
          queue: current.queue.filter((item) => item.id !== next.id),
        }));
        const outcome = await startPrompt(next.text);
        if (outcome !== "complete") break;
      }
    } finally {
      queueProcessing = false;
    }
  };

  return {
    status: null,
    statusLoaded: false,
    runStatus: "idle",
    runStatusText: null,
    messages: [],
    todos: [],
    history: [],
    queue: [],
    error: null,
    emptyResponseRetry: null,
    limitCountdown: null,
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
            "warn",
            `Agent status unavailable: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      })();
      return initPromise;
    },

    send: async (rawText) => {
      const text = rawText.trim();
      if (!text) return;

      const state = get();
      if (!isConfigured(state)) {
        addNotice(
          "The Pi harness is not configured. Set DEEPSEEK_API_KEY (or AGENT_API_KEY) in .env.local and restart the server.",
        );
        return;
      }

      // Always schedule, then let the drain decide whether it can start now.
      // This is what lets the composer accept prompts while a turn is running.
      set((current) => ({
        queue: [
          ...current.queue,
          { id: makeId("prompt"), text, at: Date.now() },
        ],
      }));

      await drainQueue();
    },

    keepGoing: async () => {
      const state = get();
      if (state.runStatus === "running" || state.history.length === 0) return;

      clearLimitCountdown();
      primeCompletionAudio();

      const snapshot = state.undoSnapshot ?? runtime.snapshot();
      const controller = new AbortController();
      const runId = ++runSequence;
      activeRun = { id: runId, controller };

      set((current) => ({
        runStatus: "running",
        runStatusText: "Continuing…",
        error: null,
        messages: current.messages.filter(
          (message) => message.role !== "limit",
        ),
      }));

      const outcome = await runPiLoop({
        baseHistory: state.history,
        undoSnapshot: snapshot,
        controller,
        runId,
      });
      if (outcome === "complete") await drainQueue();
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

    cancelEmptyResponseRetry,
    cancelLimitCountdown,

    stop: () => {
      activeRun?.controller.abort();
    },

    clear: () => {
      activeRun?.controller.abort();
      activeRun = null;
      runSequence += 1;
      clearEmptyRetryTimer();
      clearLimitCountdownTimer();
      set({
        runStatus: "idle",
        runStatusText: null,
        messages: [],
        todos: [],
        history: [],
        queue: [],
        error: null,
        emptyResponseRetry: null,
        limitCountdown: null,
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
      clearEmptyRetryTimer();
      clearLimitCountdownTimer();

      try {
        await runtime.replaceProject(
          snapshot,
          await loadProjectAssets(snapshot, getBoundProjectId())
        );
        useWorkspaceStore.getState().loadFiles(snapshot);
        set((current) => ({
          undoSnapshot: null,
          undoAvailable: false,
          runStatus: "idle",
          runStatusText: null,
          emptyResponseRetry: null,
          limitCountdown: null,
          history: [],
          messages: [
            ...current.messages,
            {
              id: makeId("notice"),
              role: "notice",
              content:
                "Restored the project to its state before the last agent run.",
              at: Date.now(),
            },
          ],
        }));
        runtime.log("success", "Agent changes reverted");
        useUiStore.getState().toast("Agent changes reverted");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        runtime.log("error", `Could not revert agent changes: ${message}`);
        useUiStore.getState().toast("Could not revert agent changes", "error");
      }
    },

    loadPersisted: async () => {
      persistEnabled = false;
      clearPersistTimer();
      activeRun?.controller.abort();
      activeRun = null;
      runSequence += 1;
      clearEmptyRetryTimer();
      clearLimitCountdownTimer();
      set({ emptyResponseRetry: null, limitCountdown: null });

      const projectId = getBoundProjectId();
      let persisted: Awaited<ReturnType<typeof readPersistedAgentState>> = null;
      if (projectId) {
        try {
          persisted = await readPersistedAgentState(projectId);
        } catch (error) {
          runtime.log(
            "warn",
            `Could not read the saved agent state: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }

      if (persisted) {
        set({
          messages: persisted.messages,
          history: persisted.history,
          todos: persisted.todos,
          queue: persisted.queue,
          undoSnapshot: persisted.undoSnapshot,
          undoAvailable: persisted.undoAvailable,
          runStatus: "idle",
          runStatusText: null,
          error: null,
        });
      } else {
        set({
          messages: [],
          history: [],
          todos: [],
          queue: [],
          undoSnapshot: null,
          undoAvailable: false,
          runStatus: "idle",
          runStatusText: null,
          error: null,
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
      clearEmptyRetryTimer();
      clearLimitCountdownTimer();
      set({
        messages: [],
        history: [],
        todos: [],
        queue: [],
        emptyResponseRetry: null,
        limitCountdown: null,
        undoSnapshot: null,
        undoAvailable: false,
        runStatus: "idle",
        runStatusText: null,
        error: null,
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
    writePersistedAgentState(
      projectId,
      serializeAgentState(useAgentStore.getState()),
    );
  } catch (error) {
    runtime.log(
      "warn",
      `Could not save the agent state: ${
        error instanceof Error ? error.message : String(error)
      }`,
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
  if (!persistEnabled || typeof window === "undefined") return;
  clearPersistTimer();
  persistTimer = setTimeout(() => {
    persistTimer = null;
    flushAgentStatePersistence();
  }, 350);
}

useAgentStore.subscribe((state, previous) => {
  if (!persistEnabled) return;
  if (
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

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", flushAgentStatePersistence);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushAgentStatePersistence();
  });
}

export const selectAgentConfigured = (state: AgentState): boolean =>
  isConfigured(state);
