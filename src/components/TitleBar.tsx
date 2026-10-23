import {
  CircleHelp,
  Download,
  FilePlus2,
  FolderKanban,
  Loader2,
  RotateCw,
  Save,
} from 'lucide-react';
import { saveProject } from '@/lib/actions';
import { downloadProjectZip } from '@/lib/download-zip';
import { useProjectStore } from '@/store/projects';
import { useRuntimeStore } from '@/store/runtime';
import { useUiStore } from '@/store/ui';

const STATUS_LABEL: Record<string, string> = {
  idle: 'Booting',
  booting: 'Booting',
  ready: 'Live',
  error: 'Offline',
};

export function TitleBar() {
  const name = useProjectStore((state) => state.name);
  const currentId = useProjectStore((state) => state.currentId);
  const saving = useProjectStore((state) => state.saving);
  const status = useRuntimeStore((state) => state.status);
  const reloadPreview = useRuntimeStore((state) => state.reloadPreview);
  const newProject = useProjectStore((state) => state.newProject);

  const openConfirm = useUiStore((state) => state.openConfirm);
  const closeConfirm = useUiStore((state) => state.closeConfirm);
  const setProjectsOpen = useUiStore((state) => state.setProjectsOpen);
  const setShortcutsOpen = useUiStore((state) => state.setShortcutsOpen);
  const setTerminalTab = useUiStore((state) => state.setTerminalTab);

  const onNew = () => {
    openConfirm({
      title: 'Start a new project?',
      message:
        'The current virtual files will be replaced with the starter template. Save first if you want to keep them.',
      confirmLabel: 'Start new project',
      onConfirm: () => {
        closeConfirm();
        void newProject('untitled');
      },
    });
  };

  return (
    <header className="titlebar">
      <div className="titlebar-left">
        <div className="brand">
          <span className="brand-forge">F</span>
          <span className="brand-name">Forge</span>
        </div>
        <span className="titlebar-divider" />
        <button className="project-chip" onClick={() => setProjectsOpen(true)} title="Open projects (⌘K)">
          <span className="project-chip-name">{name}</span>
          <span className={`project-chip-state ${currentId ? 'is-saved' : ''}`}>
            {currentId ? 'saved' : 'unsaved'}
          </span>
        </button>
      </div>

      <div className="titlebar-right">
        <button className="tool-button" onClick={onNew} title="New project">
          <FilePlus2 size={13} />
          <span className="tool-label">New</span>
        </button>

        <button className="tool-button" onClick={saveProject} disabled={saving} title="Save project (⌘S)">
          {saving ? <Loader2 size={13} className="spin" /> : <Save size={13} />}
          <span className="tool-label">Save</span>
          <kbd>⌘S</kbd>
        </button>

        <button className="tool-button" onClick={() => setProjectsOpen(true)} title="Projects (⌘K)">
          <FolderKanban size={14} />
          <span className="tool-label">Projects</span>
        </button>

        <button
          className="tool-button"
          onClick={downloadProjectZip}
          title="Download all project files as a ZIP archive"
        >
          <Download size={13} />
          <span className="tool-label">Download</span>
        </button>

        <span className="titlebar-divider" />

        <button
          className="icon-button"
          onClick={() => {
            reloadPreview();
          }}
          title="Reload preview"
        >
          <RotateCw size={14} />
        </button>
        <button className="icon-button" onClick={() => setShortcutsOpen(true)} title="Keyboard shortcuts">
          <CircleHelp size={15} />
        </button>

        <button
          className={`status-pill status-${status}`}
          onClick={() => setTerminalTab('console')}
          title="Show runtime console"
        >
          <span className="status-dot" />
          {STATUS_LABEL[status] ?? status}
        </button>
      </div>
    </header>
  );
}
