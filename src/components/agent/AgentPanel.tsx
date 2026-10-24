import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowUp,
  Check,
  ChevronDown,
  CircleAlert,
  FileText,
  FolderOpen,
  Image,
  ListChecks,
  Loader2,
  Pencil,
  RefreshCw,
  Search,
  Settings2,
  Sparkles,
  Square,
  SquareTerminal,
  Trash2,
  Undo2,
} from "lucide-react";
import {
  selectAgentConfigured,
  useAgentStore,
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
          Reload the preview to see the latest changes.
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
          {refreshed ? "Refreshed" : "Refresh web"}
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
  if (name === "grep" || name === "glob" || name === "list_files") {
    return { icon: <Search size={13} />, kind: "search", label: name };
  }
  if (name === "todo_write") {
    return { icon: <ListChecks size={13} />, kind: "todo", label: "plan" };
  }
  return { icon: <Sparkles size={13} />, kind: "other", label: name };
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

function HarnessLoader({ label }: { label: string }) {
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
        <span>DeepSeek Harness is running its tools</span>
      </span>
      <span className="agent-loader-bars" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
    </div>
  );
}

export function AgentPanel() {
  const messages = useAgentStore((state) => state.messages);
  const runStatus = useAgentStore((state) => state.runStatus);
  const runStatusText = useAgentStore((state) => state.runStatusText);
  const error = useAgentStore((state) => state.error);
  const undoAvailable = useAgentStore((state) => state.undoAvailable);
  const statusLoaded = useAgentStore((state) => state.statusLoaded);
  const harness = useAgentStore((state) => state.harness);
  const model = harness?.model ?? "";
  const provider = harness?.provider ?? "";
  const configured = useAgentStore(selectAgentConfigured);
  const send = useAgentStore((state) => state.send);
  const stop = useAgentStore((state) => state.stop);
  const init = useAgentStore((state) => state.init);
  const openSetup = useAgentStore((state) => state.openSetup);
  const clear = useAgentStore((state) => state.clear);
  const restoreLastRun = useAgentStore((state) => state.restoreLastRun);
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
    if (running) return;
    if (!configured) {
      openSetup();
      return;
    }
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    stickToBottom.current = true;
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
          {configured ? "harness ready" : "not connected"}
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
          <span
            className="agent-model-chip"
            title={provider || "No harness provider configured"}
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
              <h3>DeepSeek Harness</h3>
              <p>
                I run in a server-side harness with real tools. Your project is
                mirrored into my workspace, I edit it there, and the changes are
                applied back to this IDE with a hot-reloaded preview.
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
                <span>tools: read · write · edit · grep · bash</span>
              </div>
            </div>
          ) : (
            <div className="agent-welcome">
              <div className="agent-welcome-mark">
                <Sparkles size={20} />
              </div>
              <h3>Connect DeepSeek Harness</h3>
              <p>
                The harness runs as a server-side subprocess and needs a DeepSeek
                API key in the Nitro server environment.
              </p>
              <button className="solid-button small" onClick={openSetup}>
                Harness settings
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
                      {message.content ? (
                        <RichText text={message.content} />
                      ) : null}
                      {message.streaming && !message.content ? (
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
        {running ? <HarnessLoader label={runStatusText ?? ""} /> : null}
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
              ? "Agent is working…"
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
          <button
            className="agent-send is-stop"
            onClick={stop}
            title="Stop the agent"
          >
            <Square size={12} />
          </button>
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
          <kbd>Enter</kbd> send · <kbd>Shift</kbd> + <kbd>Enter</kbd> newline
        </span>
        <span className="agent-composer-model">{model || "no model"}</span>
      </div>
    </section>
  );
}
