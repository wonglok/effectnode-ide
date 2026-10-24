import { useEffect, useRef, useState } from 'react';
import {
  ArrowUp,
  Check,
  CircleAlert,
  ExternalLink,
  FileText,
  FolderOpen,
  Loader2,
  Pencil,
  Settings2,
  Sparkles,
  Square,
  SquareTerminal,
  Trash2,
  Undo2,
} from 'lucide-react';
import { selectAgentConfigured, useAgentStore, type AgentToolEvent } from '@/store/agent';
import { useUiStore } from '@/store/ui';
import { useWorkspaceStore } from '@/store/workspace';
import { RichText } from './RichText';

const SUGGESTIONS = [
  'Add a fifth chapter to the MY COMPANY landing page.',
  'Add a contact panel that appears after the last chapter.',
  'please update the "MY COMPANY" branding placeholder to my own:',
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

function toolIcon(name: string) {
  if (name === 'read_file') return <FileText size={13} />;
  if (name === 'write_file' || name === 'replace_in_file') return <Pencil size={13} />;
  if (name === 'list_files') return <FolderOpen size={13} />;
  if (name === 'run_bash') return <SquareTerminal size={13} />;
  return <Sparkles size={13} />;
}

function ToolCard({ tool }: { tool: AgentToolEvent }) {
  const openFile = useWorkspaceStore((state) => state.openFile);
  const canOpen = Boolean(tool.path) && tool.name !== 'list_files' && tool.status !== 'running';

  return (
    <div className={`agent-tool is-${tool.status}`}>
      <span className="agent-tool-icon">{toolIcon(tool.name)}</span>
      <div className="agent-tool-body">
        <div className="agent-tool-summary">{tool.summary}</div>
        {tool.detail ? <div className="agent-tool-detail">{tool.detail}</div> : null}
      </div>
      <span className="agent-tool-state">
        {tool.status === 'running' ? <Loader2 size={12} className="spin" /> : null}
        {tool.status === 'ok' ? <Check size={12} /> : null}
        {tool.status === 'error' ? <CircleAlert size={12} /> : null}
      </span>
      {canOpen ? (
        <button
          className="agent-tool-open"
          title={`Open ${tool.path}`}
          onClick={() => tool.path && openFile(tool.path)}
        >
          <ExternalLink size={11} />
        </button>
      ) : null}
    </div>
  );
}

export function AgentPanel() {
  const messages = useAgentStore((state) => state.messages);
  const runStatus = useAgentStore((state) => state.runStatus);
  const step = useAgentStore((state) => state.step);
  const error = useAgentStore((state) => state.error);
  const undoAvailable = useAgentStore((state) => state.undoAvailable);
  const statusLoaded = useAgentStore((state) => state.statusLoaded);
  const hasServerKey = useAgentStore((state) => state.hasServerKey);
  const model = useAgentStore((state) => state.config.model);
  const baseUrl = useAgentStore((state) => state.config.baseUrl);
  const configured = useAgentStore(selectAgentConfigured);
  const send = useAgentStore((state) => state.send);
  const stop = useAgentStore((state) => state.stop);
  const init = useAgentStore((state) => state.init);
  const openSetup = useAgentStore((state) => state.openSetup);
  const clear = useAgentStore((state) => state.clear);
  const restoreLastRun = useAgentStore((state) => state.restoreLastRun);
  const openConfirm = useUiStore((state) => state.openConfirm);
  const closeConfirm = useUiStore((state) => state.closeConfirm);

  const [draft, setDraft] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  const running = runStatus === 'running';

  useEffect(() => {
    void init();
  }, [init]);

  useEffect(() => {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${Math.min(element.scrollHeight, 148)}px`;
  }, [draft]);

  useEffect(() => {
    if (!stickToBottom.current) return;
    endRef.current?.scrollIntoView({ block: 'end' });
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
    setDraft('');
    stickToBottom.current = true;
    void send(text);
  };

  const confirmUndo = () => {
    openConfirm({
      title: 'Undo the last agent run?',
      message:
        'The whole virtual project will return to its state before the last agent run. Manual edits made after that run will also be lost.',
      confirmLabel: 'Revert project',
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
      title: 'Clear the agent chat?',
      message: 'This clears the conversation only. Your project files stay as they are.',
      confirmLabel: 'Clear chat',
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
        <span className={`mini-dot ${configured ? 'is-online' : 'is-offline'}`} />
        <span className="agent-strip-label">
          {configured ? (hasServerKey && !model ? 'server key' : 'agent ready') : 'not connected'}
        </span>
        {running ? (
          <span className="agent-working">
            <Loader2 size={10} className="spin" /> step {step}/8
          </span>
        ) : null}
        {undoAvailable && !running ? (
          <button className="agent-undo" onClick={confirmUndo} title="Revert the last agent run">
            <Undo2 size={11} /> undo run
          </button>
        ) : null}

        <div className="agent-strip-actions">
          <span className="agent-model-chip" title={baseUrl || 'No provider configured'}>
            {model || 'no model'}
          </span>
          <button className="icon-button" onClick={openSetup} title="Agent settings">
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
                I can read and edit this project with tools, and the preview hot-reloads as I work.
                Ask for a feature, a fix, or a redesign.
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
                <code>{model}</code>
                <span>·</span>
                <span>tools: read · write · edit · list · shell</span>
              </div>
            </div>
          ) : (
            <div className="agent-welcome">
              <div className="agent-welcome-mark">
                <Sparkles size={20} />
              </div>
              <h3>Connect a model</h3>
              <p>
                The agent uses any OpenAI-compatible API — OpenAI, DeepSeek, OpenRouter, or a local
                Ollama server. It can read files, edit code, and run shell commands against this
                project.
              </p>
              <button className="solid-button small" onClick={openSetup}>
                Configure agent
              </button>
              <div className="agent-welcome-meta">
                {statusLoaded ? (
                  <>
                    <span>key kept in this tab</span>
                    <span>·</span>
                    <span>no server storage</span>
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
              if (message.role === 'user') {
                return (
                  <div key={message.id} className="agent-row agent-row-user">
                    <div className="agent-user-bubble">{message.content}</div>
                  </div>
                );
              }
              if (message.role === 'assistant') {
                return (
                  <div key={message.id} className="agent-row agent-row-assistant">
                    <div className="agent-avatar">
                      <Sparkles size={13} />
                    </div>
                    <div className="agent-assistant">
                      {message.content ? <RichText text={message.content} /> : null}
                      {message.streaming && !message.content ? <TypingDots /> : null}
                      {message.streaming && message.content ? <span className="agent-caret" /> : null}
                    </div>
                  </div>
                );
              }
              if (message.role === 'tool') {
                return <ToolCard key={message.id} tool={message.tool} />;
              }
              if (message.role === 'error') {
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
            {error && !messages.some((message) => message.role === 'error') ? (
              <div className="agent-error">
                <CircleAlert size={13} />
                <span>{error}</span>
              </div>
            ) : null}
          </div>
        )}
        <div ref={endRef} />
      </div>

      <div className={`agent-composer ${running ? 'is-running' : ''}`}>
        <textarea
          ref={textareaRef}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              submit();
            }
          }}
          placeholder={
            running
              ? 'Agent is working…'
              : configured
                ? 'Ask for a change to this project…'
                : 'Configure a model to start…'
          }
          rows={1}
          id="agent-input"
          name="agent-input"
          spellCheck={false}
          aria-label="Message the agent"
        />
        {running ? (
          <button className="agent-send is-stop" onClick={stop} title="Stop the agent">
            <Square size={12} />
          </button>
        ) : (
          <button
            className="agent-send"
            onClick={submit}
            disabled={!draft.trim() && configured}
            title={configured ? 'Send (Enter)' : 'Configure the agent'}
          >
            <ArrowUp size={14} />
          </button>
        )}
      </div>
      <div className="agent-composer-meta">
        <span>
          <kbd>Enter</kbd> send · <kbd>Shift</kbd> + <kbd>Enter</kbd> newline
        </span>
        <span className="agent-composer-model">{model || 'no model'}</span>
      </div>
    </section>
  );
}
