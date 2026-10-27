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
          maxLength={120}
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
  ['⇧⌘O', 'Projects & versions'],
  ['⌘B', 'Toggle the explorer + editor column'],
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
            <strong>Forge</strong> mounts an in-memory virtual file system and a Vite-compatible dev
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
            <strong>Projects & versions</strong> keeps every project in OPFS; each project has its own
            snapshot timeline with restore and delete.
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
        Built with open source · CREDIT in the status bar lists every project
      </div>
    </Modal>
  );
}

interface Credit {
  name: string;
  version: string;
  license: string;
  role: string;
  href: string;
}

const CREDIT_GROUPS: { label: string; items: Credit[] }[] = [
  {
    label: 'Runtime & build',
    items: [
      {
        name: 'almostnode',
        version: '0.2.14',
        license: 'MIT',
        role: 'In-browser virtual file system and Vite dev server',
        href: 'https://github.com/macaly/almostnode',
      },
      {
        name: 'Vite',
        version: '7.3.7',
        license: 'MIT',
        role: 'Module graph, transforms and HMR',
        href: 'https://vite.dev',
      },
      {
        name: 'Nitro',
        version: '3.0.0',
        license: 'MIT',
        role: 'Local API server and model proxy',
        href: 'https://nitro.build',
      },
      {
        name: 'esbuild',
        version: '0.25.12',
        license: 'MIT',
        role: 'Fast JavaScript and TypeScript transforms',
        href: 'https://esbuild.github.io',
      },
      {
        name: 'h3',
        version: '2.0.1-rc.2',
        license: 'MIT',
        role: 'HTTP server primitives',
        href: 'https://h3.dev',
      },
    ],
  },
  {
    label: 'Interface',
    items: [
      {
        name: 'React',
        version: '19.3.1',
        license: 'MIT',
        role: 'UI runtime and DOM renderer',
        href: 'https://react.dev',
      },
      {
        name: 'Zustand',
        version: '5.0.16',
        license: 'MIT',
        role: 'Application state',
        href: 'https://github.com/pmndrs/zustand',
      },
      {
        name: 'Tailwind CSS',
        version: '4.3.3',
        license: 'MIT',
        role: 'Design tokens and utilities',
        href: 'https://tailwindcss.com',
      },
      {
        name: 'CodeMirror',
        version: '6.0.2',
        license: 'MIT',
        role: 'Code editor and language modes',
        href: 'https://codemirror.net',
      },
      {
        name: '@uiw/react-codemirror',
        version: '4.25.12',
        license: 'MIT',
        role: 'React bindings for CodeMirror',
        href: 'https://github.com/uiwjs/react-codemirror',
      },
      {
        name: 'Lucide',
        version: '1.61.0',
        license: 'ISC',
        role: 'Icon set',
        href: 'https://lucide.dev',
      },
    ],
  },
  {
    label: 'Agent',
    items: [
      {
        name: '@anthropic-ai/sdk',
        version: '1.3.0',
        license: 'Apache-2.0',
        role: 'Browser agent loop and Messages API streaming',
        href: 'https://github.com/anthropics/anthropic-sdk-typescript',
      },
    ],
  },
  {
    label: 'Preview & utilities',
    items: [
      {
        name: 'Three.js',
        version: '0.186.1',
        license: 'MIT',
        role: '3D rendering in starter scenes',
        href: 'https://threejs.org',
      },
      {
        name: 'fflate',
        version: '0.8.3',
        license: 'MIT',
        role: 'ZIP compression for templates and exports',
        href: 'https://github.com/101arrowz/fflate',
      },
      {
        name: 'pako',
        version: '2.2.0',
        license: 'MIT',
        role: 'Gzip and deflate streams',
        href: 'https://github.com/nodeca/pako',
      },
      {
        name: 'TypeScript',
        version: '5.9.3',
        license: 'Apache-2.0',
        role: 'Type checking and language tooling',
        href: 'https://www.typescriptlang.org',
      },
    ],
  },
];

export function CreditsDialog() {
  const open = useUiStore((state) => state.creditsOpen);
  const setOpen = useUiStore((state) => state.setCreditsOpen);

  if (!open) return null;

  return (
    <Modal
      title="Credits"
      subtitle="Forge is built on the work of these open-source projects."
      onClose={() => setOpen(false)}
      width={620}
      footer={
        <button className="ghost-button" onClick={() => setOpen(false)}>
          Close
        </button>
      }
    >
      <p className="credits-intro">
        Thank you to the maintainers and contributors behind every project listed here, and to the
        transitive dependencies they build upon.
      </p>

      <div className="credits-groups">
        {CREDIT_GROUPS.map((group) => (
          <section className="credits-group" key={group.label}>
            <div className="projects-section-label">{group.label}</div>
            <ul className="credits-list">
              {group.items.map((item) => (
                <li className="credit-item" key={item.name}>
                  <div className="credit-line">
                    <a
                      className="credit-name"
                      href={item.href}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {item.name}
                    </a>
                    <span className="credit-version">{item.version}</span>
                    <span className="credit-license">{item.license}</span>
                  </div>
                  <div className="credit-role">{item.role}</div>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <div className="help-footnote">
        Licenses are reproduced by their respective projects. Versions reflect this build.
      </div>
    </Modal>
  );
}
