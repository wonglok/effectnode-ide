import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useUiStore } from '@/store/ui';

export function Modal({
  title,
  subtitle,
  onClose,
  children,
  footer,
  width = 460,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="modal" style={{ width }} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-header">
          <div>
            <h2>{title}</h2>
            {subtitle ? <p className="modal-subtitle">{subtitle}</p> : null}
          </div>
          <button className="icon-button" onClick={onClose} title="Close">
            <X size={15} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer ? <div className="modal-footer">{footer}</div> : null}
      </div>
    </div>,
    document.body
  );
}

export function PromptDialog() {
  const request = useUiStore((state) => state.prompt);
  const closePrompt = useUiStore((state) => state.closePrompt);
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!request) return;
    setValue(request.initialValue);
    const timer = window.setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 20);
    return () => window.clearTimeout(timer);
  }, [request]);

  if (!request) return null;

  const submit = () => {
    if (!value.trim()) return;
    const callback = request.onConfirm;
    closePrompt();
    callback(value);
  };

  return (
    <Modal
      title={request.title}
      onClose={closePrompt}
      footer={
        <>
          <button className="ghost-button" onClick={closePrompt}>
            Cancel
          </button>
          <button className="solid-button small" onClick={submit} disabled={!value.trim()}>
            {request.confirmLabel ?? 'Confirm'}
          </button>
        </>
      }
    >
      <label className="field">
        <span className="field-label">{request.label}</span>
        <input
          ref={inputRef}
          className="field-input"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              submit();
            }
          }}
          placeholder={request.placeholder}
          spellCheck={false}
          id="forge-prompt-input"
          name="prompt-value"
        />
      </label>
    </Modal>
  );
}

export function ConfirmDialog() {
  const request = useUiStore((state) => state.confirm);
  const closeConfirm = useUiStore((state) => state.closeConfirm);

  if (!request) return null;

  return (
    <Modal
      title={request.title}
      onClose={closeConfirm}
      width={430}
      footer={
        <>
          <button className="ghost-button" onClick={closeConfirm}>
            Cancel
          </button>
          <button
            className={`solid-button small ${request.destructive ? 'is-destructive' : ''}`}
            onClick={() => {
              const callback = request.onConfirm;
              closeConfirm();
              callback();
            }}
          >
            {request.confirmLabel ?? 'Confirm'}
          </button>
        </>
      }
    >
      <p className="modal-copy">{request.message}</p>
    </Modal>
  );
}

const SHORTCUTS = [
  ['⌘B', 'Toggle the file explorer'],
  ['⌘J', 'Toggle the console / terminal'],
  ['⇧⌘A', 'Focus the agent chat'],
  ['↑ / ↓', 'Navigate shell history'],
  ['Esc', 'Close a dialog'],
];

export function ShortcutsDialog() {
  const open = useUiStore((state) => state.shortcutsOpen);
  const setOpen = useUiStore((state) => state.setShortcutsOpen);

  if (!open) return null;

  return (
    <Modal
      title="Forge"
      subtitle="A browser-native IDE running a virtual Node environment."
      onClose={() => setOpen(false)}
      width={560}
      footer={
        <button className="ghost-button" onClick={() => setOpen(false)}>
          Close
        </button>
      }
    >
      <div className="shortcut-grid">
        {SHORTCUTS.map(([keys, description]) => (
          <div key={keys} className="shortcut-row">
            <kbd>{keys}</kbd>
            <span>{description}</span>
          </div>
        ))}
      </div>

      <div className="help-section">
        <div className="projects-section-label">How it works</div>
        <ul className="help-list">
          <li>
            <strong>almostnode</strong> mounts an in-memory virtual file system and a Vite-compatible dev
            server in this tab.
          </li>
          <li>
            A service worker intercepts <code>/__virtual__/3000/</code> and serves your app in the preview
            iframe. Saves trigger HMR.
          </li>
          <li>
            Project files are mirrored into the browser's <strong>Origin Private File System</strong> so
            work survives a reload.
          </li>
          <li>
            The IDE itself is React + Zustand; the shell runs against the same virtual file system.
          </li>
          <li>
            <strong>Forge Agent</strong> calls the model through the authenticated Nitro proxy and applies
            tool calls (read, write, edit, list, search, shell) to the same VFS, so its edits hot-reload too.
          </li>
        </ul>
      </div>

      <div className="help-footnote">
        almostnode 0.2.14 · Vite 7 · Nitro 3 · React 19 · Zustand 5
      </div>
    </Modal>
  );
}
