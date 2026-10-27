import { useEffect, useRef } from 'react';
import { Bug, Sparkles, Trash2, X } from 'lucide-react';
import {
  buildPreviewFixPrompt,
  type PreviewIssueLevel,
} from '@/lib/preview-errors';
import { PREVIEW_MESSAGE_SOURCE } from '@/lib/preview-bridge';
import { useAgentStore } from '@/store/agent';
import {
  usePreviewErrorsStore,
  type PreviewIssue,
} from '@/store/preview-errors';
import { useProjectStore } from '@/store/projects';
import { useRuntimeStore } from '@/store/runtime';
import { useUiStore } from '@/store/ui';

const LEVELS = new Set<PreviewIssueLevel>([
  'error',
  'unhandledrejection',
  'console',
  'warn',
  'resource',
  'network',
]);

const LEVEL_LABELS: Record<PreviewIssueLevel, string> = {
  error: 'Error',
  unhandledrejection: 'Promise',
  console: 'Console',
  warn: 'Warning',
  resource: 'Resource',
  network: 'Network',
};

function asLevel(value: unknown): PreviewIssueLevel | null {
  return typeof value === 'string' && LEVELS.has(value as PreviewIssueLevel)
    ? (value as PreviewIssueLevel)
    : null;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/**
 * Receives diagnostics from the preview iframe. Messages are only accepted
 * from the iframe that renders the virtual preview.
 */
export function usePreviewErrorListener(): void {
  const addIssue = usePreviewErrorsStore((state) => state.addIssue);
  const clearIssues = usePreviewErrorsStore((state) => state.clearIssues);
  const previewKey = useRuntimeStore((state) => state.previewKey);
  const previewUrl = useRuntimeStore((state) => state.previewUrl);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;

      const frame = document.querySelector<HTMLIFrameElement>(
        'iframe.preview-frame'
      );
      if (!frame || event.source !== frame.contentWindow) return;

      const data = event.data;
      if (!data || typeof data !== 'object') return;
      const payload = data as Record<string, unknown>;
      if (
        payload.source !== PREVIEW_MESSAGE_SOURCE ||
        payload.type !== 'preview-error'
      ) {
        return;
      }

      const level = asLevel(payload.level);
      const message = asString(payload.message);
      if (!level || !message?.trim()) return;

      addIssue({
        level,
        message,
        stack: asString(payload.stack),
        source: asString(payload.file),
        line: asNumber(payload.line),
        column: asNumber(payload.column),
      });
    };

    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [addIssue]);

  // A restarted/reloaded preview is a new document; old issues no longer apply.
  useEffect(() => {
    clearIssues();
  }, [previewKey, previewUrl, clearIssues]);
}

export function PreviewDebugButton() {
  const issues = usePreviewErrorsStore((state) => state.issues);
  const open = usePreviewErrorsStore((state) => state.open);
  const setOpen = usePreviewErrorsStore((state) => state.setOpen);

  if (issues.length === 0) return null;

  const occurrences = issues.reduce((total, issue) => total + issue.count, 0);

  return (
    <button
      className={`icon-button preview-debug-trigger ${open ? 'is-open' : ''}`}
      onClick={() => setOpen(!open)}
      aria-label={`Preview errors (${issues.length})`}
      aria-expanded={open}
      title={`Preview errors — ${issues.length} issue${
        issues.length === 1 ? '' : 's'
      }, ${occurrences} occurrence${occurrences === 1 ? '' : 's'}`}
    >
      <Bug size={13} />
      <span className="preview-debug-badge">
        {issues.length > 99 ? '99+' : issues.length}
      </span>
    </button>
  );
}

function locationOf(issue: PreviewIssue): string {
  if (!issue.source) return '';
  const path = issue.source.replace(/^https?:\/\/[^/]+/i, '');
  const suffix = [
    issue.line ? String(issue.line) : '',
    issue.column ? String(issue.column) : '',
  ]
    .filter(Boolean)
    .join(':');
  return suffix ? `${path}:${suffix}` : path;
}

function IssueRow({ issue }: { issue: PreviewIssue }) {
  const location = locationOf(issue);

  return (
    <div className={`preview-debug-item is-${issue.level}`}>
      <div className="preview-debug-meta">
        <span className="preview-debug-level">{LEVEL_LABELS[issue.level]}</span>
        <span className="preview-debug-time">
          {new Date(issue.at).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
          })}
        </span>
        {issue.count > 1 ? (
          <span className="preview-debug-count">×{issue.count}</span>
        ) : null}
      </div>
      <div className="preview-debug-message">{issue.message}</div>
      {location ? <div className="preview-debug-source">{location}</div> : null}
      {issue.stack ? (
        <details className="preview-debug-stack">
          <summary>Stack trace</summary>
          <pre>{issue.stack}</pre>
        </details>
      ) : null}
    </div>
  );
}

export function PreviewDebugPanel() {
  const issues = usePreviewErrorsStore((state) => state.issues);
  const open = usePreviewErrorsStore((state) => state.open);
  const setOpen = usePreviewErrorsStore((state) => state.setOpen);
  const clearIssues = usePreviewErrorsStore((state) => state.clearIssues);
  const agentRunning = useAgentStore((state) => state.runStatus === 'running');
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [issues, open]);

  if (!open || issues.length === 0) return null;

  const occurrences = issues.reduce((total, issue) => total + issue.count, 0);

  const fixWithAi = () => {
    const prompt = buildPreviewFixPrompt(issues, {
      projectName: useProjectStore.getState().name,
      previewUrl: useRuntimeStore.getState().previewUrl,
    });
    useUiStore.getState().setChatOpen(true);
    setOpen(false);
    void useAgentStore.getState().send(prompt);
  };

  return (
    <div className="preview-debug" role="dialog" aria-label="Preview errors">
      <div className="preview-debug-head">
        <div className="preview-debug-title">
          <Bug size={12} />
          <span>Preview errors</span>
          <span className="preview-debug-total">
            {issues.length} issue{issues.length === 1 ? '' : 's'} · {occurrences}{' '}
            occurrence{occurrences === 1 ? '' : 's'}
          </span>
        </div>
        <button
          className="icon-button"
          onClick={() => setOpen(false)}
          title="Close diagnostics"
        >
          <X size={13} />
        </button>
      </div>

      <div className="preview-debug-list" ref={listRef}>
        {issues.map((issue) => (
          <IssueRow key={issue.id} issue={issue} />
        ))}
      </div>

      <div className="preview-debug-actions">
        <button className="ghost-button small" onClick={clearIssues}>
          <Trash2 size={12} />
          Clear
        </button>
        <button
          className="solid-button small"
          onClick={fixWithAi}
          disabled={agentRunning}
          title={
            agentRunning
              ? 'The agent is already working'
              : 'Send these errors to the agent'
          }
        >
          <Sparkles size={12} />
          {agentRunning ? 'Agent working…' : 'Fix with AI'}
        </button>
      </div>
    </div>
  );
}
