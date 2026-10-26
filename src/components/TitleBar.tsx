import { useRef, type ChangeEvent } from 'react';
import {
  ChevronsUpDown,
  CircleHelp,
  Download,
  FilePlus2,
  History,
  LogOut,
  RotateCw,
  Upload,
} from 'lucide-react';
import { downloadProjectZip } from '@/lib/download-zip';
import { readProjectArchive } from '@/lib/project-archive';
import { runtime } from '@/lib/runtime';
import {
  flushAgentStatePersistence,
  pauseAgentStatePersistence,
  resumeAgentStatePersistence,
} from '@/store/agent';
import { useAuthStore } from '@/store/auth';
import { useProjectLibraryStore } from '@/store/library';
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
  const status = useRuntimeStore((state) => state.status);
  const reloadPreview = useRuntimeStore((state) => state.reloadPreview);
  const newProject = useProjectStore((state) => state.newProject);
  const importProject = useProjectStore((state) => state.importProject);

  const openConfirm = useUiStore((state) => state.openConfirm);
  const closeConfirm = useUiStore((state) => state.closeConfirm);
  const openPrompt = useUiStore((state) => state.openPrompt);
  const setProjectSwitcherOpen = useUiStore(
    (state) => state.setProjectSwitcherOpen
  );
  const setShortcutsOpen = useUiStore((state) => state.setShortcutsOpen);
  const setTerminalTab = useUiStore((state) => state.setTerminalTab);
  const toast = useUiStore((state) => state.toast);
  const authRequired = useAuthStore((state) => state.required);
  const logout = useAuthStore((state) => state.logout);

  const importInputRef = useRef<HTMLInputElement>(null);

  const onImportChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    try {
      const archive = await readProjectArchive(file);
      const assetCount = Object.keys(archive.assets).length;
      const fileCount = Object.keys(archive.files).length + assetCount;
      openConfirm({
        title: `Import “${archive.name}”?`,
        message: `This replaces the current virtual files with ${fileCount} files${
          assetCount > 0
            ? ` (including ${assetCount} public asset${assetCount === 1 ? '' : 's'})`
            : ''
        } from the ZIP (archive v${archive.manifest.version}). The archived agent chat is restored too. Download first if you want to keep them.`,
        confirmLabel: 'Import project',
        onConfirm: () => {
          closeConfirm();
          void importProject(
            archive.name,
            archive.files,
            archive.assets,
            archive.agentStateRaw
          ).then(() => {
            void useProjectLibraryStore.getState().refresh();
          }).catch((error) => {
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
    openPrompt({
      title: 'New project',
      label: 'Project name',
      initialValue: 'untitled',
      placeholder: 'e.g. landing-page-v2',
      confirmLabel: 'Create project',
      onConfirm: (name) => {
        const projectName = name.trim();
        if (!projectName) return;
        void newProject(projectName).then(async () => {
          const library = useProjectLibraryStore.getState();
          await library.refresh();
          const createdId = useProjectStore.getState().id;
          if (createdId) await library.select(createdId);
        });
      },
    });
  };

  const onLogout = () => {
    // Save the transcript and abort any running agent; locking must not wipe it.
    flushAgentStatePersistence();
    pauseAgentStatePersistence();
    logout();
    // The IDE can re-unlock without a full reload; resume saving then.
    resumeAgentStatePersistence();
  };

  return (
    <header className="titlebar">
      <div className="titlebar-left">
        <div className="brand">
          <span className="brand-forge">F</span>
          <span className="brand-name">Forge</span>
        </div>
        <span className="titlebar-divider" />
        <button
          className="project-chip"
          onClick={() => setProjectSwitcherOpen(true)}
          title="Switch project & browse versions (⇧⌘O)"
        >
          <span className="project-chip-name">{name}</span>
          <ChevronsUpDown size={12} className="project-chip-caret" />
        </button>
      </div>

      <div className="titlebar-right">
        <button
          className="tool-button"
          onClick={() => setProjectSwitcherOpen(true)}
          title="Projects & versions (⇧⌘O)"
        >
          <History size={13} />
          <span className="tool-label">Versions</span>
        </button>

        <button className="tool-button" onClick={onNew} title="New project">
          <FilePlus2 size={13} />
          <span className="tool-label">New</span>
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

        {authRequired ? (
          <>
            <span className="titlebar-divider" />
            <button
              className="tool-button tool-logout"
              onClick={onLogout}
              title="Lock the session and return to the unlock screen"
            >
              <LogOut size={13} />
              <span className="tool-label">Logout</span>
            </button>
          </>
        ) : null}
      </div>
    </header>
  );
}
