import { useEffect, useRef, useState } from 'react';
import { ChevronDown, SquareTerminal, Trash2 } from 'lucide-react';
import { formatClockTime } from '@/lib/format';
import type { LogLevel } from '@/lib/runtime';
import { runShellCommand } from '@/lib/shell';
import { useRuntimeStore } from '@/store/runtime';
import { useUiStore, type TerminalTab } from '@/store/ui';

const LEVEL_GLYPH: Record<LogLevel, string> = {
  info: '·',
  success: '✓',
  warn: '!',
  error: '✕',
  hmr: '⚡',
};

function ConsoleView() {
  const logs = useRuntimeStore((state) => state.logs);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [logs.length]);

  return (
    <div className="console-view">
      {logs.length === 0 ? (
        <div className="console-empty">Runtime messages will appear here.</div>
      ) : (
        logs.map((log) => (
          <div key={log.id} className={`console-line level-${log.level}`}>
            <span className="console-time">{formatClockTime(log.time)}</span>
            <span className="console-glyph">{LEVEL_GLYPH[log.level]}</span>
            <span className="console-message">{log.message}</span>
          </div>
        ))
      )}
      <div ref={endRef} />
    </div>
  );
}

function TerminalView() {
  const lines = useUiStore((state) => state.terminalLines);
  const cwd = useUiStore((state) => state.terminalCwd);
  const history = useUiStore((state) => state.commandHistory);
  const addTerminalLine = useUiStore((state) => state.addTerminalLine);
  const clearTerminal = useUiStore((state) => state.clearTerminal);
  const setTerminalCwd = useUiStore((state) => state.setTerminalCwd);
  const pushCommandHistory = useUiStore((state) => state.pushCommandHistory);

  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const historyIndex = useRef<number | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [lines.length]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const submit = async () => {
    const command = input.trim();
    if (!command || busy) return;
    setInput('');
    historyIndex.current = null;
    pushCommandHistory(command);
    addTerminalLine('command', `${cwd} $ ${command}`);
    setBusy(true);
    try {
      const result = await runShellCommand(command, cwd);
      if (result.clear) {
        clearTerminal();
      } else {
        for (const line of result.lines) addTerminalLine(line.kind, line.text);
      }
      setTerminalCwd(result.cwd);
    } catch (error) {
      addTerminalLine('error', error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void submit();
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (history.length === 0) return;
      const current = historyIndex.current ?? history.length;
      const next = Math.max(0, current - 1);
      historyIndex.current = next;
      setInput(history[next] ?? '');
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (historyIndex.current === null) return;
      const next = historyIndex.current + 1;
      if (next >= history.length) {
        historyIndex.current = null;
        setInput('');
      } else {
        historyIndex.current = next;
        setInput(history[next] ?? '');
      }
    }
  };

  return (
    <div className="terminal-view" onClick={() => inputRef.current?.focus()}>
      <div className="terminal-output">
        {lines.map((line) => (
          <div key={line.id} className={`terminal-line kind-${line.kind}`}>
            {line.text}
          </div>
        ))}
        <div ref={endRef} />
      </div>
      <div className="terminal-prompt">
        <span className="terminal-cwd">{cwd}</span>
        <span className="terminal-symbol">$</span>
        <input
          ref={inputRef}
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder={busy ? 'running…' : 'type a command'}
          spellCheck={false}
          autoComplete="off"
          id="forge-shell-input"
          name="shell-command"
          aria-label="Shell command"
        />
      </div>
    </div>
  );
}

export function TerminalPane({ height }: { height: number }) {
  const tab = useUiStore((state) => state.terminalTab);
  const setTab = useUiStore((state) => state.setTerminalTab);
  const setOpen = useUiStore((state) => state.setTerminalOpen);
  const clearTerminal = useUiStore((state) => state.clearTerminal);
  const clearLogs = useRuntimeStore((state) => state.clearLogs);
  const logCount = useRuntimeStore((state) => state.logs.length);

  const clearCurrent = () => {
    if (tab === 'console') clearLogs();
    else clearTerminal();
  };

  const tabs: Array<{ id: TerminalTab; label: string; badge?: number }> = [
    { id: 'console', label: 'Console', badge: logCount || undefined },
    { id: 'terminal', label: 'Terminal' },
  ];

  return (
    <section className="terminal-pane" style={{ height }}>
      <div className="terminal-header">
        <div className="terminal-tabs">
          <SquareTerminal size={12} className="terminal-icon" />
          {tabs.map((entry) => (
            <button
              key={entry.id}
              className={`terminal-tab ${tab === entry.id ? 'is-active' : ''}`}
              onClick={() => setTab(entry.id)}
            >
              {entry.label}
              {entry.badge ? <span className="terminal-badge">{entry.badge}</span> : null}
            </button>
          ))}
        </div>
        <div className="panel-actions">
          <button className="icon-button" onClick={clearCurrent} title={`Clear ${tab}`}>
            <Trash2 size={13} />
          </button>
          <button className="icon-button" onClick={() => setOpen(false)} title="Hide panel (⌘J)">
            <ChevronDown size={14} />
          </button>
        </div>
      </div>
      <div className="terminal-body">{tab === 'console' ? <ConsoleView /> : <TerminalView />}</div>
    </section>
  );
}
