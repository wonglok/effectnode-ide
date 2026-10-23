import { useRef, type ChangeEvent } from 'react';
import {
  CircleHelp,
  Download,
  FilePlus2,
  FolderKanban,
  Loader2,
  RotateCw,
  Save,
  Upload,
} from 'lucide-react';
import { saveProject } from '@/lib/actions';
import { downloadProjectZip } from '@/lib/download-zip';
import { readProjectArchive } from '@/lib/project-archive';
import { runtime } from '@/lib/runtime';
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
  const importProject = useProjectStore((state) => state.importProject);

  const openConfirm = useUiStore((state) => state.openConfirm);
  const closeConfirm = useUiStore((state) => state.closeConfirm);
  const setProjectsOpen = useUiStore((state) => state.setProjectsOpen);
  const setShortcutsOpen = useUiStore((state) => state.setShortcutsOpen);
  const setTerminalTab = useUiStore((state) => state.setTerminalTab);
  const toast = useUiStore((state) => state.toast);

  const importInputRef = useRef<HTMLInputElement>(null);

  const onImportChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    try {
      const archive = await readProjectArchive(file);
      const fileCount = Object.keys(archive.files).length;
      openConfirm({
        title: `Import “${archive.name}”?`,
        message: `This replaces the current virtual files with ${fileCount} files from the ZIP (archive v${archive.manifest.version}). Save first if you want to keep them.`,
        confirmLabel: 'Import project',
        onConfirm: () => {
          closeConfirm();
          void importProject(archive.name, archive.files).catch((error) => {
            const message = error instanceof Error ? error.message : String(error);
            runtime.log('error', `Import failed: ${message}`);
            toast('Could not import the project', 'error');
          });
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      runtime.log('error', `Import failed: ${message}`);
      toast(message, 'error');
    }
  };

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

        <button
          className="tool-button"
          onClick={() => importInputRef.current?.click()}
          title="Import a Forge ZIP as a new project"
        >
          <Upload size={13} />
          <span className="tool-label">Import ZIP</span>
        </button>
        <input
          ref={importInputRef}
          hidden
          type="file"
          accept=".zip,application/zip"
          onChange={onImportChange}
        />

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
