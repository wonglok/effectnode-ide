import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  Cloud,
  Diamond,
  ExternalLink,
  Hammer,
  LoaderCircle,
  Triangle,
  X,
} from 'lucide-react';
import { buildAndDownloadDistZip } from '@/lib/build-zip';
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

type BuildPhase = 'idle' | 'building' | 'success' | 'error';

interface BuildStats {
  files: number;
  bytes: number;
  seconds: number;
  installed: boolean;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function BuildDialog() {
  const open = useUiStore((state) => state.buildOpen);
  const setOpen = useUiStore((state) => state.setBuildOpen);
  const [phase, setPhase] = useState<BuildPhase>('idle');
  const [message, setMessage] = useState('');
  const [output, setOutput] = useState('');
  const [files, setFiles] = useState<string[]>([]);
  const [stats, setStats] = useState<BuildStats | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  if (!open) return null;

  const building = phase === 'building';

  const start = async () => {
    if (building) return;

    const controller = new AbortController();
    controllerRef.current = controller;
    setPhase('building');
    setMessage('Preparing the in-browser build…');
    setOutput('');
    setFiles([]);
    setStats(null);

    const result = await buildAndDownloadDistZip({
      signal: controller.signal,
      onProgress: setMessage,
    });

    controllerRef.current = null;
    setOutput(
      [
        result.installOutput
          ? `── npm install ──\n${result.installOutput}`
          : '',
        result.output,
      ]
        .filter(Boolean)
        .join('\n\n'),
    );
    setFiles(result.files);

    if (result.ok) {
      setPhase('success');
      setMessage('Build complete');
      setStats({
        files: result.fileCount,
        bytes: result.archiveBytes,
        seconds: result.durationMs / 1000,
        installed: result.installed,
      });
    } else if (result.cancelled) {
      setPhase('idle');
      setMessage('Build cancelled.');
    } else {
      setPhase('error');
      setMessage(result.error ?? 'Build failed.');
    }
  };

  const cancel = () => {
    controllerRef.current?.abort();
    setMessage('Cancelling…');
  };

  const statusTitle =
    phase === 'building'
      ? message
      : phase === 'success'
        ? 'Build complete'
        : phase === 'error'
          ? 'Build failed'
          : 'Ready to build';

  const statusDetail =
    phase === 'building'
      ? 'almostnode is compiling the project in this tab.'
      : phase === 'success' && stats
        ? `${stats.files} files · ${formatBytes(stats.bytes)} · ${stats.seconds.toFixed(
            1,
          )}s${stats.installed ? ' · dependencies installed' : ''}`
        : phase === 'error'
          ? message
          : message ||
            'The first build installs dependencies in this tab and can take a minute.';

  return (
    <Modal
      title="Build"
      subtitle="Compile the Vite project with almostnode and download dist/."
      onClose={() => setOpen(false)}
      width={540}
      footer={
        <button className="ghost-button" onClick={() => setOpen(false)}>
          Close
        </button>
      }
    >
      <p className="build-intro">
        Runs <code>npm run build</code> in almostnode&apos;s browser container,
        then downloads the compiled HTML, JS, CSS and public assets from{" "}
        <code>dist/</code> at the archive root — ready for a static host or
        Vercel Drop.
      </p>

      <div className={`build-status is-${phase}`} role="status" aria-live="polite">
        <span className="build-status-icon">
          {building ? (
            <LoaderCircle size={15} className="spin" />
          ) : (
            <Hammer size={15} />
          )}
        </span>
        <div className="build-status-copy">
          <strong>{statusTitle}</strong>
          <p>{statusDetail}</p>
        </div>
      </div>

      {files.length > 0 ? (
        <div className="build-files">
          <div className="build-files-label">
            Included files ({files.length})
          </div>
          <ul className="build-files-list">
            {files.map((file) => (
              <li key={file}>
                <code>{file}</code>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {output ? (
        <pre className="build-log" aria-label="Build output">
          {output}
        </pre>
      ) : null}

      <div className="build-actions">
        <button
          className="solid-button small"
          onClick={() => void start()}
          disabled={building}
        >
          {building ? (
            <LoaderCircle size={14} className="spin" />
          ) : (
            <Hammer size={14} />
          )}
          {building ? 'Building…' : 'Build & download ZIP'}
        </button>
        {building ? (
          <button className="ghost-button" onClick={cancel}>
            Cancel
          </button>
        ) : null}
      </div>

      <div className="build-deploy">
        <div className="build-deploy-label">Deployment to cloud</div>
        <p className="build-deploy-copy">
          Download the ZIP above, then drop it on a static host — no CLI or
          account setup required.
        </p>
        <div className="build-deploy-actions">
          <a
            className="ghost-button build-deploy-link is-vercel"
            href="https://vercel.com/drop"
            target="_blank"
            rel="noreferrer"
            title="Open Vercel Drop in a new tab"
          >
            <Triangle size={13} />
            Vercel Drop
            <ExternalLink size={11} className="build-deploy-external" />
          </a>
          <a
            className="ghost-button build-deploy-link is-netlify"
            href="https://app.netlify.com/drop"
            target="_blank"
            rel="noreferrer"
            title="Open Netlify Drop in a new tab"
          >
            <Diamond size={13} />
            Netlify Drop
            <ExternalLink size={11} className="build-deploy-external" />
          </a>
          <a
            className="ghost-button build-deploy-link is-cloudflare"
            href="https://www.cloudflare.com/drop/"
            target="_blank"
            rel="noreferrer"
            title="Open Cloudflare Drop in a new tab"
          >
            <Cloud size={13} />
            Cloudflare Drop
            <ExternalLink size={11} className="build-deploy-external" />
          </a>
        </div>
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
