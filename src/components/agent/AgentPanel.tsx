import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowUp,
  Brain,
  Check,
  ChevronDown,
  CircleAlert,
  FileText,
  FolderOpen,
  Image,
  ListChecks,
  ListPlus,
  Loader2,
  Pencil,
  Play,
  RefreshCw,
  Search,
  Settings2,
  Sparkles,
  Square,
  SquareTerminal,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import type { AgentEngine } from "../../../shared/types";
import {
  selectAgentConfigured,
  useAgentStore,
  type AgentEmptyResponseRetry,
  type AgentToolEvent,
} from "@/store/agent";
import { useRuntimeStore } from "@/store/runtime";
import { useUiStore } from "@/store/ui";
import { useWorkspaceStore } from "@/store/workspace";
import { RichText } from "./RichText";

const SUGGESTIONS = [
  "Add a new scene at the end: life is good with prism glass material.",
  "Add a new transition visaul effect for the last scene: like a new water ripple , keep aspect ratio of water droplet",
  'Please update the "MY COMPANY" branding placeholder to my own brand:',
];

function TypingDots() {
  return (
    <span className="agent-typing" aria-label="Agent is typing">
      <span />
      <span />
      <span />
    </span>
  );
}

function RefreshBubble() {
  const reloadPreview = useRuntimeStore((state) => state.reloadPreview);
  const [refreshed, setRefreshed] = useState(false);

  useEffect(() => {
    if (!refreshed) return;
    const timer = window.setTimeout(() => setRefreshed(false), 1600);
    return () => window.clearTimeout(timer);
  }, [refreshed]);

  return (
    <div className="agent-row agent-row-refresh">
      <div className="agent-refresh-bubble">
        <span className="agent-refresh-icon">
          <RefreshCw size={13} />
        </span>
        <span className="agent-refresh-copy">
          <strong>Task complete</strong>
          The preview refreshed with the latest changes.
        </span>
        <button
          type="button"
          className="agent-refresh-button"
          onClick={() => {
            reloadPreview();
            setRefreshed(true);
          }}
        >
          {refreshed ? <Check size={12} /> : <RefreshCw size={12} />}
          {refreshed ? "Refreshed" : "Refresh again"}
        </button>
      </div>
    </div>
  );
}

type ToolKind = "read" | "write" | "shell" | "search" | "todo" | "other";

function toolVisual(name: string): {
  icon: ReactNode;
  kind: ToolKind;
  label: string;
} {
  if (name === "read" || name === "read_file") {
    return { icon: <FileText size={13} />, kind: "read", label: "read" };
  }
  if (name === "read_image") {
    return { icon: <Image size={13} />, kind: "read", label: "image" };
  }
  if (
    name === "write" ||
    name === "edit" ||
    name === "write_file" ||
    name === "replace_in_file" ||
    name === "str_replace_editor"
  ) {
    return { icon: <Pencil size={13} />, kind: "write", label: name };
  }
  if (name === "bash" || name === "pwsh" || name === "run_bash") {
    return { icon: <SquareTerminal size={13} />, kind: "shell", label: "bash" };
  }
  if (name === "search" || name === "glob" || name === "list_files") {
    return { icon: <Search size={13} />, kind: "search", label: name };
  }
  if (name === "todo_write") {
    return { icon: <ListChecks size={13} />, kind: "todo", label: "plan" };
  }
  return { icon: <Sparkles size={13} />, kind: "other", label: name };
}

function ThinkingLog({ text, streaming }: { text: string; streaming: boolean }) {
  const [open, setOpen] = useState(true);
  const bodyRef = useRef<HTMLDivElement>(null);
  const trimmed = text.trim();

  useEffect(() => {
    const element = bodyRef.current;
    if (!element) return;
    element.scrollTop = element.scrollHeight;
  }, [trimmed, open]);

  if (!trimmed) return null;

  return (
    <div className={`agent-thinking ${streaming ? "is-streaming" : ""}`}>
      <button
        type="button"
        className="agent-thinking-head"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="agent-thinking-mark">
          {streaming ? <Loader2 size={11} className="spin" /> : <Brain size={11} />}
        </span>
        <span className="agent-thinking-title">Thinking log</span>
        <span className="agent-thinking-meta">
          {streaming ? "streaming" : `${trimmed.split(/\n+/).length} lines`}
        </span>
        <ChevronDown
          size={12}
          className={`agent-thinking-chevron ${open ? "" : "is-collapsed"}`}
        />
      </button>
      {open ? (
        <div
          className="agent-thinking-body"
          ref={bodyRef}
          role="log"
          aria-live="polite"
        >
          <pre>{trimmed}</pre>
        </div>
      ) : null}
    </div>
  );
}

function ToolCard({ tool }: { tool: AgentToolEvent }) {
  const openFile = useWorkspaceStore((state) => state.openFile);
  const [expanded, setExpanded] = useState(false);
  const visual = toolVisual(tool.name);
  const path = tool.path;
  const detail = tool.detail ?? "";
  const expandable = detail.length > 72;

  return (
    <div className={`agent-tool is-${tool.status} agent-tool-kind-${visual.kind}`}>
      <span className="agent-tool-icon">{visual.icon}</span>
      <div className="agent-tool-body">
        <div className="agent-tool-headline">
          <span className="agent-tool-name">{visual.label}</span>
          <span className="agent-tool-summary">{tool.summary}</span>
        </div>
        {detail ? (
          <div className={`agent-tool-detail ${expanded ? "is-expanded" : ""}`}>
            {detail}
          </div>
        ) : null}
      </div>
      <div className="agent-tool-actions">
        {path && tool.status !== "running" ? (
          <button
            className="agent-tool-path"
            title={`Open ${path}`}
            onClick={() => openFile(path)}
          >
            <FolderOpen size={10} />
            <span>{path.split("/").pop()}</span>
          </button>
        ) : null}
        {expandable ? (
          <button
            className={`agent-tool-expand ${expanded ? "is-open" : ""}`}
            title={expanded ? "Collapse output" : "Expand output"}
            onClick={() => setExpanded((value) => !value)}
          >
            <ChevronDown size={12} />
          </button>
        ) : null}
        <span className="agent-tool-state">
          {tool.status === "running" ? (
            <Loader2 size={12} className="spin" />
          ) : null}
          {tool.status === "ok" ? <Check size={12} /> : null}
          {tool.status === "error" ? <CircleAlert size={12} /> : null}
        </span>
      </div>
    </div>
  );
}

function TodoPanel() {
  const todos = useAgentStore((state) => state.todos);
  const running = useAgentStore((state) => state.runStatus === "running");
  const [collapsed, setCollapsed] = useState(false);
  const wasDone = useRef(false);

  const completed = todos.filter((todo) => todo.status === "completed").length;
  const active = todos.filter((todo) => todo.status === "in_progress").length;
  const allDone = todos.length > 0 && completed === todos.length;
  const percent = todos.length ? Math.round((completed / todos.length) * 100) : 0;

  useEffect(() => {
    // Fold away once everything is done, and reopen when a new plan starts.
    if (allDone && !wasDone.current) setCollapsed(true);
    if (!allDone && wasDone.current) setCollapsed(false);
    wasDone.current = allDone;
  }, [allDone]);

  if (todos.length === 0) return null;

  return (
    <section
      className={`agent-todos ${allDone ? "is-complete" : ""} ${
        collapsed ? "is-collapsed" : ""
      }`}
      aria-label="Task plan"
    >
      <button
        type="button"
        className="agent-todos-head"
        aria-expanded={!collapsed}
        onClick={() => setCollapsed((value) => !value)}
      >
        <span className="agent-todos-mark">
          <ListChecks size={13} />
        </span>
        <span className="agent-todos-title">
          <strong>{allDone ? "All tasks complete" : "Task plan"}</strong>
          <span>
            {allDone
              ? `${todos.length} of ${todos.length} done`
              : active > 0
                ? `${active} in progress`
                : running
                  ? "Working through the plan"
                  : "Current plan"}
          </span>
        </span>
        <span className="agent-todos-count">
          {completed}
          <em>/{todos.length}</em>
        </span>
        <ChevronDown
          size={13}
          className={`agent-todos-chevron ${collapsed ? "is-collapsed" : ""}`}
        />
      </button>
      <div className="agent-todos-progress" aria-hidden="true">
        <span style={{ width: `${percent}%` }} />
      </div>
      {!collapsed ? (
        <ol className="agent-todos-list">
          {todos.map((todo, index) => (
            <li
              key={`${index}-${todo.content}`}
              className={`agent-todo is-${todo.status}`}
            >
              <span className="agent-todo-bullet">
                {todo.status === "completed" ? <Check size={10} /> : null}
                {todo.status === "in_progress" ? (
                  <span className="agent-todo-pulse" />
                ) : null}
              </span>
              <span className="agent-todo-text">{todo.content}</span>
              {todo.status === "in_progress" ? (
                <span className="agent-todo-tag">active</span>
              ) : null}
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}

function PromptQueue({ running }: { running: boolean }) {
  const queue = useAgentStore((state) => state.queue);
  const removeQueued = useAgentStore((state) => state.removeQueued);
  const clearQueue = useAgentStore((state) => state.clearQueue);
  const resumeQueue = useAgentStore((state) => state.resumeQueue);

  if (queue.length === 0) return null;

  return (
    <section className="agent-queue" aria-label="Queued prompts">
      <div className="agent-queue-head">
        <span className="agent-queue-mark">
          <ListPlus size={12} />
        </span>
        <span className="agent-queue-title">
          <strong>Up next</strong>
          <span>
            {queue.length} {queue.length === 1 ? "prompt" : "prompts"} ·{" "}
            {running ? "runs after this task" : "ready to run"}
          </span>
        </span>
        {!running ? (
          <button
            type="button"
            className="agent-queue-run"
            onClick={() => void resumeQueue()}
            title="Run the oldest queued prompt now"
          >
            <Play size={10} /> Run queue
          </button>
        ) : null}
        <button
          type="button"
          className="agent-queue-clear"
          onClick={clearQueue}
          title="Clear the queue"
          aria-label="Clear the queue"
        >
          <Trash2 size={11} />
        </button>
      </div>
      <ol className="agent-queue-list">
        {queue.map((item, index) => (
          <li key={item.id} className="agent-queue-item">
            <span className="agent-queue-index">
              {String(index + 1).padStart(2, "0")}
            </span>
            <span className="agent-queue-text" title={item.text}>
              {item.text}
            </span>
            <button
              type="button"
              className="agent-queue-remove"
              onClick={() => removeQueued(item.id)}
              title="Remove from the queue"
              aria-label={`Remove queued prompt ${index + 1}`}
            >
              <X size={11} />
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}

function AgentLoader({
  label,
  engine,
}: {
  label: string;
  engine: AgentEngine;
}) {
  return (
    <div className="agent-loader" role="status" aria-live="polite">
      <svg
        className="agent-loader-svg"
        viewBox="0 0 32 32"
        width="30"
        height="30"
        aria-hidden="true"
      >
        <defs>
          <linearGradient
            id="forge-loader-gradient"
            x1="4"
            y1="4"
            x2="28"
            y2="28"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0%" stopColor="#b7f34b" />
            <stop offset="100%" stopColor="#6db6ff" />
          </linearGradient>
        </defs>
        <circle className="agent-loader-track" cx="16" cy="16" r="11" />
        <circle className="agent-loader-arc" cx="16" cy="16" r="11" />
        <circle className="agent-loader-dot" cx="16" cy="5" r="2.2" />
      </svg>
      <span className="agent-loader-copy">
        <strong>{label || "Working…"}</strong>
        <span>
          {engine === "claude"
            ? "Frontend Claude agent · Anthropic proxy · JWT auth"
            : engine === "pi"
              ? "Pi agent harness · pi-agent-core · JWT proxy"
              : "Frontend agent · DeepSeek proxy · JWT auth"}
        </span>
      </span>
      <span className="agent-loader-bars" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
    </div>
  );
}

function EmptyResponseRetryCard({
  retry,
  onCancel,
}: {
  retry: AgentEmptyResponseRetry;
  onCancel: () => void;
}) {
  const counting = retry.status === "countdown";
  const stateLabel =
    retry.status === "countdown"
      ? `Sending “keep going” in ${retry.secondsLeft}s…`
      : retry.status === "sent"
        ? "Sent “keep going” to the agent."
        : "Automatic retry cancelled.";

  return (
    <div className={`agent-retry is-${retry.status}`} role="status" aria-live="polite">
      <span className="agent-retry-icon">
        <RefreshCw size={13} className={counting ? "spin" : undefined} />
      </span>
      <div className="agent-retry-copy">
        <strong>The model returned an empty response.</strong>
        <span>{stateLabel}</span>
      </div>
      <button
        type="button"
        className="agent-retry-cancel"
        onClick={onCancel}
        disabled={!counting}
        title={counting ? "Cancel the automatic retry" : undefined}
      >
        {retry.status === "cancelled" ? "Cancelled" : "Cancel"}
      </button>
    </div>
  );
}

export function AgentPanel() {
  const messages = useAgentStore((state) => state.messages);
  const runStatus = useAgentStore((state) => state.runStatus);
  const runStatusText = useAgentStore((state) => state.runStatusText);
  const error = useAgentStore((state) => state.error);
  const queue = useAgentStore((state) => state.queue);
  const emptyResponseRetry = useAgentStore((state) => state.emptyResponseRetry);
  const cancelEmptyResponseRetry = useAgentStore(
    (state) => state.cancelEmptyResponseRetry
  );
  const limitCountdown = useAgentStore((state) => state.limitCountdown);
  const cancelLimitCountdown = useAgentStore(
    (state) => state.cancelLimitCountdown
  );
  const undoAvailable = useAgentStore((state) => state.undoAvailable);
  const statusLoaded = useAgentStore((state) => state.statusLoaded);
  const status = useAgentStore((state) => state.status);
  const engine = useAgentStore((state) => state.engine);
  const setEngine = useAgentStore((state) => state.setEngine);
  const model =
    engine === "claude"
      ? status?.claude?.model ?? ""
      : engine === "pi"
        ? status?.pi?.model ?? ""
        : status?.model ?? "";
  const provider =
    engine === "claude"
      ? "anthropic"
      : engine === "pi"
        ? status?.pi?.provider ?? "pi"
        : status?.provider ?? "";
  const proxyUrl =
    engine === "claude"
      ? status?.claude?.proxyUrl
      : engine === "pi"
        ? status?.pi?.proxyUrl
        : status?.proxyUrl;
  const configured = useAgentStore(selectAgentConfigured);
  const send = useAgentStore((state) => state.send);
  const stop = useAgentStore((state) => state.stop);
  const init = useAgentStore((state) => state.init);
  const openSetup = useAgentStore((state) => state.openSetup);
  const clear = useAgentStore((state) => state.clear);
  const restoreLastRun = useAgentStore((state) => state.restoreLastRun);
  const keepGoing = useAgentStore((state) => state.keepGoing);
  const openConfirm = useUiStore((state) => state.openConfirm);
  const closeConfirm = useUiStore((state) => state.closeConfirm);

  const [draft, setDraft] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  const running = runStatus === "running";

  useEffect(() => {
    void init();
  }, [init]);

  useEffect(() => {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, 148)}px`;
  }, [draft]);

  useEffect(() => {
    if (!stickToBottom.current) return;
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  const onScroll = () => {
    const element = scrollRef.current;
    if (!element) return;
    stickToBottom.current =
      element.scrollHeight - element.scrollTop - element.clientHeight < 90;
  };

  const submit = () => {
    if (!configured) {
      openSetup();
      return;
    }
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    stickToBottom.current = true;
    // While a turn is active this schedules the prompt; otherwise it starts now.
    void send(text);
  };

  const confirmUndo = () => {
    openConfirm({
      title: "Undo the last agent run?",
      message:
        "The whole virtual project will return to its state before the last agent run. Manual edits made after that run will also be lost.",
      confirmLabel: "Revert project",
      destructive: true,
      onConfirm: () => {
        closeConfirm();
        void restoreLastRun();
      },
    });
  };

  const confirmClear = () => {
    if (messages.length === 0) return;
    openConfirm({
      title: "Clear the agent chat?",
      message:
        "This clears the conversation only. Your project files stay as they are.",
      confirmLabel: "Clear chat",
      destructive: true,
      onConfirm: () => {
        closeConfirm();
        clear();
      },
    });
  };

  return (
    <section className="agent-panel">
      <div className="agent-strip">
        <span
          className={`mini-dot ${configured ? "is-online" : "is-offline"}`}
        />
        <span className="agent-strip-label">
          {configured ? "agent ready" : "not connected"}
        </span>
        {running ? (
          <span className="agent-working">
            <Loader2 size={10} className="spin" /> {runStatusText || "working…"}
          </span>
        ) : null}
        {undoAvailable && !running ? (
          <button
            className="agent-undo"
            onClick={confirmUndo}
            title="Revert the last agent run"
          >
            <Undo2 size={11} /> undo run
          </button>
        ) : null}

        <div className="agent-strip-actions">
          <div
            className="agent-engine-switch"
            role="group"
            aria-label="Agent engine"
          >
            <button
              type="button"
              className={engine === "pi" ? "is-active" : ""}
              aria-pressed={engine === "pi"}
              disabled={running}
              onClick={() => setEngine("pi")}
              title="Pi agent harness · pi-agent-core · Anthropic proxy (default)"
            >
              pi
            </button>
            <button
              type="button"
              className={engine === "claude" ? "is-active" : ""}
              aria-pressed={engine === "claude"}
              disabled={running}
              onClick={() => setEngine("claude")}
              title="Frontend Claude agent · Anthropic Messages proxy"
            >
              claude
            </button>
            <button
              type="button"
              className={engine === "deepseek" ? "is-active" : ""}
              aria-pressed={engine === "deepseek"}
              disabled={running}
              onClick={() => setEngine("deepseek")}
              title="Frontend loop · OpenAI-compatible DeepSeek proxy"
            >
              deepseek
            </button>
          </div>
          <span
            className="agent-model-chip"
            title={proxyUrl || "No agent proxy configured"}
          >
            {model || "no model"}
          </span>
          <button
            className="icon-button"
            onClick={openSetup}
            title="Agent settings"
          >
            <Settings2 size={12} />
          </button>
          <button
            className="icon-button"
            onClick={confirmClear}
            disabled={messages.length === 0}
            title="Clear agent chat"
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>

      <div className="agent-scroll" ref={scrollRef} onScroll={onScroll}>
        {messages.length === 0 ? (
          configured ? (
            <div className="agent-welcome">
              <div className="agent-welcome-mark">
                <Sparkles size={20} />
              </div>
              <h3>Forge Agent</h3>
              <p>
                I run in this tab with tools against your project, and the preview
                hot-reloads as I work. My model calls go through the server's
                JWT-authenticated{" "}
                {engine === "claude"
                  ? "Anthropic-style"
                  : engine === "pi"
                    ? "Pi harness"
                    : "DeepSeek"}{" "}
                proxy, so the API key stays server-side.
              </p>
              <div className="agent-suggestions">
                {SUGGESTIONS.map((suggestion) => (
                  <button
                    key={suggestion}
                    onClick={() => {
                      setDraft(suggestion);
                      textareaRef.current?.focus();
                    }}
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
              <div className="agent-welcome-meta">
                <code>{provider}/{model}</code>
                <span>·</span>
                <span>
                  {engine === "pi" ? "pi-agent-core · " : ""}tools: read · write
                  · edit · list · shell · plan
                </span>
              </div>
            </div>
          ) : (
            <div className="agent-welcome">
              <div className="agent-welcome-mark">
                <Sparkles size={20} />
              </div>
              <h3>Connect the DeepSeek proxy</h3>
              <p>
                The browser agent calls a same-origin REST proxy with your Forge
                JWT. The DeepSeek API key stays in the Nitro server environment.
              </p>
              <button className="solid-button small" onClick={openSetup}>
                Proxy settings
              </button>
              <div className="agent-welcome-meta">
                {statusLoaded ? (
                  <>
                    <span>set DEEPSEEK_API_KEY</span>
                    <span>·</span>
                    <span>restart the dev server</span>
                  </>
                ) : (
                  <span>checking server…</span>
                )}
              </div>
            </div>
          )
        ) : (
          <div className="agent-messages">
            {messages.map((message) => {
              if (message.role === "user") {
                return (
                  <div key={message.id} className="agent-row agent-row-user">
                    <div className="agent-user-bubble">{message.content}</div>
                  </div>
                );
              }
              if (message.role === "assistant") {
                return (
                  <div
                    key={message.id}
                    className="agent-row agent-row-assistant"
                  >
                    <div className="agent-avatar">
                      <Sparkles size={13} />
                    </div>
                    <div className="agent-assistant">
                      <ThinkingLog
                        text={message.reasoning ?? ""}
                        streaming={message.streaming}
                      />
                      {message.content ? (
                        <RichText text={message.content} />
                      ) : null}
                      {message.streaming &&
                      !message.content &&
                      !(message.reasoning ?? "").trim() ? (
                        <TypingDots />
                      ) : null}
                      {message.streaming && message.content ? (
                        <span className="agent-caret" />
                      ) : null}
                    </div>
                  </div>
                );
              }
              if (message.role === "tool") {
                return <ToolCard key={message.id} tool={message.tool} />;
              }
              if (message.role === "refresh") {
                return <RefreshBubble key={message.id} />;
              }
              if (message.role === "error") {
                return (
                  <div key={message.id} className="agent-error">
                    <CircleAlert size={13} />
                    <span>{message.content}</span>
                  </div>
                );
              }
              if (message.role === "limit") {
                const countdown =
                  limitCountdown?.messageId === message.id
                    ? limitCountdown
                    : null;
                const counting = countdown?.status === "countdown";
                return (
                  <div key={message.id} className="agent-limit">
                    <span className="agent-limit-icon">
                      <CircleAlert size={13} />
                    </span>
                    <div className="agent-limit-copy">
                      <strong>Step limit reached</strong>
                      <span>
                        The agent used {message.steps}{" "}
                        {message.steps === 1 ? "step" : "steps"} and may still
                        have work left.
                      </span>
                      {counting ? (
                        <span className="agent-limit-countdown">
                          Continuing automatically in {countdown.secondsLeft}s…
                        </span>
                      ) : countdown?.status === "cancelled" ? (
                        <span className="agent-limit-countdown">
                          Automatic continue cancelled.
                        </span>
                      ) : null}
                    </div>
                    {counting || countdown?.status === "cancelled" ? (
                      <button
                        type="button"
                        className="agent-limit-cancel"
                        onClick={cancelLimitCountdown}
                        disabled={!counting}
                        title={
                          counting
                            ? "Cancel the automatic continue"
                            : undefined
                        }
                      >
                        {counting ? "Cancel" : "Cancelled"}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="agent-limit-button"
                      onClick={() => void keepGoing()}
                    >
                      <Play size={11} /> Keep going
                    </button>
                  </div>
                );
              }
              if (
                message.role === "notice" &&
                emptyResponseRetry?.messageId === message.id
              ) {
                return (
                  <EmptyResponseRetryCard
                    key={message.id}
                    retry={emptyResponseRetry}
                    onCancel={cancelEmptyResponseRetry}
                  />
                );
              }
              return (
                <div key={message.id} className="agent-notice">
                  {message.content}
                </div>
              );
            })}
            {error && !messages.some((message) => message.role === "error") ? (
              <div className="agent-error">
                <CircleAlert size={13} />
                <span>{error}</span>
              </div>
            ) : null}
          </div>
        )}
        <div ref={endRef} />
      </div>

      <div className="agent-dock">
        <TodoPanel />
        {running ? (
          <AgentLoader label={runStatusText ?? ""} engine={engine} />
        ) : null}
        <PromptQueue running={running} />
      </div>

      <div className={`agent-composer ${running ? "is-running" : ""}`}>
        <textarea
          ref={textareaRef}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (
              event.key === "Enter" &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault();
              submit();
            }
          }}
          placeholder={
            running
              ? "Agent is working — type to queue the next prompt…"
              : configured
                ? "Ask for a change to this project…"
                : "Configure a model to start…"
          }
          rows={1}
          id="agent-input"
          name="agent-input"
          spellCheck={false}
          aria-label="Message the agent"
        />
        {running ? (
          <>
            <button
              className="agent-send agent-send-queue"
              onClick={submit}
              disabled={!draft.trim()}
              title="Queue prompt (Enter)"
            >
              <ListPlus size={14} />
            </button>
            <button
              className="agent-send is-stop"
              onClick={stop}
              title="Stop the agent"
            >
              <Square size={12} />
            </button>
          </>
        ) : (
          <button
            className="agent-send"
            onClick={submit}
            disabled={!draft.trim() && configured}
            title={configured ? "Send (Enter)" : "Configure the agent"}
          >
            <ArrowUp size={14} />
          </button>
        )}
      </div>
      <div className="agent-composer-meta">
        <span>
          <kbd>Enter</kbd> {running ? "queue" : "send"} · <kbd>Shift</kbd> +{" "}
          <kbd>Enter</kbd> newline
        </span>
        <span className="agent-composer-model">
          {queue.length > 0 ? `${queue.length} queued · ` : ""}
          {model || "no model"}
        </span>
      </div>
    </section>
  );
}
