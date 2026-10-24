import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  CopyPlus,
  FolderKanban,
  Loader2,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-react';
import { formatRelative } from '@/lib/format';
import { useProjectStore } from '@/store/projects';
import { useUiStore } from '@/store/ui';

export function Modal({
  title,
  subtitle,
  onClose,
  children,
  footer,
  width = 460,
  bodyClassName,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
  bodyClassName?: string;
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
        <div className={`modal-body${bodyClassName ? ` ${bodyClassName}` : ''}`}>
          {children}
        </div>
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

export function ProjectsDialog() {
  const open = useUiStore((state) => state.projectsOpen);
  const setOpen = useUiStore((state) => state.setProjectsOpen);
  const openConfirm = useUiStore((state) => state.openConfirm);
  const closeConfirm = useUiStore((state) => state.closeConfirm);

  const projects = useProjectStore((state) => state.projects);
  const currentId = useProjectStore((state) => state.currentId);
  const name = useProjectStore((state) => state.name);
  const saving = useProjectStore((state) => state.saving);
  const openingId = useProjectStore((state) => state.openingId);
  const loadingList = useProjectStore((state) => state.loadingList);
  const serverOnline = useProjectStore((state) => state.serverOnline);
  const save = useProjectStore((state) => state.save);
  const openProject = useProjectStore((state) => state.open);
  const remove = useProjectStore((state) => state.remove);
  const loadProjects = useProjectStore((state) => state.loadProjects);
  const newProject = useProjectStore((state) => state.newProject);

  const [draftName, setDraftName] = useState(name);

  useEffect(() => {
    if (open) setDraftName(name);
  }, [open, name]);

  if (!open) return null;

  const close = () => setOpen(false);

  const confirmDelete = (id: string, projectName: string) => {
    openConfirm({
      title: 'Delete saved project?',
      message: `“${projectName}” will be removed from the Nitro data directory. The files in your editor stay open.`,
      confirmLabel: 'Delete saved copy',
      destructive: true,
      onConfirm: () => {
        closeConfirm();
        void remove(id);
      },
    });
  };

  const confirmNew = () => {
    openConfirm({
      title: 'Start a new project?',
      message:
        'The current virtual files will be replaced with the starter template. Save first if you want to keep them.',
      confirmLabel: 'Start new project',
      onConfirm: () => {
        closeConfirm();
        close();
        void newProject('untitled');
      },
    });
  };

  return (
    <Modal
      title="Projects"
      subtitle="Snapshots of the virtual file system, persisted by Nitro."
      onClose={close}
      width={620}
      footer={
        <>
          <button className="ghost-button" onClick={confirmNew}>
            <span className="inline-icon">＋</span> New from template
          </button>
          <button className="ghost-button" onClick={close}>
            Close
          </button>
        </>
      }
    >
      <div className="projects-current">
        <div className="projects-section-label">Current workspace</div>
        <div className="projects-current-row">
          <input
            className="field-input"
            value={draftName}
            onChange={(event) => setDraftName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && draftName.trim()) void save(draftName);
            }}
            placeholder="Project name"
            spellCheck={false}
            id="forge-project-name"
            name="project-name"
          />
          <button
            className="solid-button small"
            onClick={() => void save(draftName)}
            disabled={saving || !draftName.trim() || serverOnline === false}
          >
            {saving ? <Loader2 size={12} className="spin" /> : null}
            {currentId ? 'Save' : 'Save to Nitro'}
          </button>
          <button
            className="ghost-button"
            onClick={() => void save(draftName, { asNew: true })}
            disabled={saving || !draftName.trim() || serverOnline === false}
            title="Save a copy as a new project"
          >
            <CopyPlus size={13} />
            Save as
          </button>
        </div>
        <div className="projects-current-meta">
          {currentId ? 'Updates the saved snapshot' : 'Creates a new snapshot in data/projects'}
        </div>
      </div>

      <div className="projects-list-header">
        <span className="projects-section-label">
          <FolderKanban size={12} /> Saved projects
        </span>
        <button className="icon-button" onClick={() => void loadProjects()} title="Refresh saved projects">
          {loadingList ? <Loader2 size={13} className="spin" /> : <RefreshCw size={13} />}
        </button>
      </div>

      {serverOnline === false ? (
        <div className="projects-offline">
          The Nitro API is unreachable. Run the app with <code>npm run dev</code> so snapshots can be
          stored on disk.
        </div>
      ) : null}

      <div className="projects-list">
        {projects.length === 0 ? (
          <div className="projects-empty">
            {loadingList ? 'Loading saved projects…' : 'No saved projects yet. Save the workspace to create one.'}
          </div>
        ) : (
          projects.map((project) => (
            <div
              key={project.id}
              className={`project-row ${project.id === currentId ? 'is-current' : ''}`}
              onClick={() => {
                if (openingId) return;
                void openProject(project.id).then((ok) => {
                  if (ok) close();
                });
              }}
              role="button"
              tabIndex={0}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void openProject(project.id);
              }}
            >
              <div className="project-row-main">
                <span className="project-row-name">{project.name}</span>
                <span className="project-row-meta">
                  {project.fileCount} files · {formatRelative(project.updatedAt)}
                  {project.id === currentId ? ' · open' : ''}
                </span>
              </div>
              {openingId === project.id ? <Loader2 size={13} className="spin" /> : null}
              <button
                className="icon-button danger-hover"
                title="Delete saved project"
                onClick={(event) => {
                  event.stopPropagation();
                  confirmDelete(project.id, project.name);
                }}
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))
        )}
      </div>
    </Modal>
  );
}

const SHORTCUTS = [
  ['⌘S', 'Save the project to Nitro'],
  ['⌘B', 'Toggle the file explorer'],
  ['⌘J', 'Toggle the console / terminal'],
  ['⌘K', 'Open the projects dialog'],
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
            <strong>Nitro</strong> persists project snapshots as JSON under <code>data/projects</code> so
            work survives a reload.
          </li>
          <li>
            The IDE itself is React + Zustand; the shell runs against the same virtual file system.
          </li>
          <li>
            <strong>Forge Agent</strong> calls an OpenAI-compatible model through Nitro and applies
            tool calls (read, write, edit, list, shell) to the same VFS, so its edits hot-reload too.
          </li>
        </ul>
      </div>

      <div className="help-footnote">
        almostnode 0.2.14 · Vite 7 · Nitro 3 · React 19 · Zustand 5
      </div>
    </Modal>
  );
}
