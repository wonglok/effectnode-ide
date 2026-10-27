import { create } from 'zustand';
import { writePersistedAgentState } from '@/lib/agent-state';
import {
  bindOpfsProject,
  createLocalProject,
  getBoundProjectId,
  opfsProjectStore,
  readLocalProject,
  updateOpfsProjectName,
  writeLocalProject,
  type OpfsProject,
} from '@/lib/opfs';
import { loadProjectAssets } from '@/lib/project-assets';
import { runtime } from '@/lib/runtime';
import {
  DEFAULT_STARTER_TEMPLATE,
  loadStarter,
  STARTER_PROJECT_NAME,
  type StarterTemplateId,
} from '@/lib/starter-project';
import {
  flushAgentStatePersistence,
  pauseAgentStatePersistence,
  resumeAgentStatePersistence,
  useAgentStore,
} from './agent';
import { restartWithFiles } from './runtime';
import { useUiStore } from './ui';
import { useWorkspaceStore } from './workspace';

/** Last active OPFS project id, kept under the historical key for reloads. */
export const CURRENT_PROJECT_KEY = 'forge.currentProject';

export interface ProjectMetaState {
  id: string | null;
  name: string;
  createdAt: string | null;
  updatedAt: string | null;
}

interface ProjectState extends ProjectMetaState {
  setCurrent: (meta: ProjectMetaState | null) => void;
  renameProject: (name: string) => void;
  /** Open an existing OPFS project, replacing the live workspace. */
  openProject: (id: string) => Promise<void>;
  newProject: (name?: string, template?: StarterTemplateId) => Promise<void>;
  /** Replace the workspace with files from a validated Forge ZIP archive. */
  importProject: (
    name: string,
    files: Record<string, string>,
    assets: Record<string, Uint8Array>,
    agentStateRaw?: string | null
  ) => Promise<void>;
}

export const useProjectStore = create<ProjectState>((set) => ({
  id: getBoundProjectId(),
  name: STARTER_PROJECT_NAME,
  createdAt: null,
  updatedAt: null,

  setCurrent: (meta) => {
    if (!meta) {
      set({ id: null, createdAt: null, updatedAt: null });
      return;
    }
    set({
      id: meta.id,
      name: meta.name,
      createdAt: meta.createdAt,
      updatedAt: meta.updatedAt,
    });
    updateOpfsProjectName(meta.name);
  },

  renameProject: (name) => {
    const projectName = name.trim().slice(0, 120);
    if (!projectName) return;
    const updatedAt = new Date().toISOString();
    set({ name: projectName, updatedAt });
    updateOpfsProjectName(projectName);

    // Keep the remembered local project in sync so a reload without the
    // active-project pointer still restores the new name.
    const local = readLocalProject();
    if (local && local.id === getBoundProjectId()) {
      writeLocalProject({ ...local, name: projectName, updatedAt });
    }
  },

  openProject: async (id) => {
    const currentId = getBoundProjectId();
    if (!id || id === currentId) return;

    flushAgentStatePersistence();
    pauseAgentStatePersistence();
    useWorkspaceStore.getState().flush();

    let cached: OpfsProject | null;
    try {
      cached = await opfsProjectStore.read(id);
    } catch (error) {
      resumeAgentStatePersistence();
      throw error;
    }
    const files = cached?.files ?? {};
    if (!cached || Object.keys(files).length === 0) {
      resumeAgentStatePersistence();
      throw new Error('That project is empty or missing from OPFS.');
    }

    const manifest = cached.manifest ?? {};
    const epoch = new Date(0).toISOString();
    const meta: ProjectMetaState = {
      id,
      name: manifest.name || 'untitled',
      createdAt: manifest.createdAt || epoch,
      updatedAt: manifest.updatedAt || epoch,
    };

    localStorage.setItem(CURRENT_PROJECT_KEY, id);
    bindOpfsProject(id, meta.name);

    try {
      // replaceProject mirrors the loaded files back into this project's folder,
      // preserving `.forge` (manifest and version history).
      await restartWithFiles(files, await loadProjectAssets(files, id));
      useWorkspaceStore.getState().loadFiles(files);
      set({ ...meta });
      await useAgentStore.getState().loadPersisted();
    } catch (error) {
      resumeAgentStatePersistence();
      throw error;
    }

    runtime.log('info', `Opened “${meta.name}” from OPFS`);
    useUiStore.getState().toast(`Opened “${meta.name}”`);
  },

  newProject: async (name, templateId = DEFAULT_STARTER_TEMPLATE) => {
    // Load the archive before pausing persistence so a failed fetch leaves the
    // current project untouched.
    const bundle = await loadStarter(templateId);
    flushAgentStatePersistence();
    pauseAgentStatePersistence();
    useWorkspaceStore.getState().flush();
    const projectName = name?.trim() || 'untitled';
    const local = createLocalProject(projectName);
    localStorage.setItem(CURRENT_PROJECT_KEY, local.id);
    bindOpfsProject(local.id, local.name);
    // replaceProject mirrors the starter files into the new OPFS folder. Mount
    // the selected template's binaries directly; they are reloaded from the
    // same zip (see project-assets) after a refresh.
    await restartWithFiles(bundle.files, bundle.assets);
    useWorkspaceStore.getState().loadFiles(bundle.files);
    set({
      id: local.id,
      name: local.name,
      createdAt: local.createdAt,
      updatedAt: local.updatedAt,
    });
    useAgentStore.getState().resetForProject();
    runtime.log('info', `Started “${local.name}” in OPFS`);
    useUiStore.getState().toast('New project ready');
  },

  importProject: async (name, files, assets, agentStateRaw = null) => {
    flushAgentStatePersistence();
    pauseAgentStatePersistence();
    useWorkspaceStore.getState().flush();
    const projectName = name.trim() || 'imported-project';
    const local = createLocalProject(projectName);
    localStorage.setItem(CURRENT_PROJECT_KEY, local.id);
    bindOpfsProject(local.id, local.name);

    // Binary public files live in `.forge/uploads`, which survives replaceAll
    // and is reloaded alongside the text tree.
    for (const [path, data] of Object.entries(assets)) {
      await opfsProjectStore.writeUpload(local.id, path, data);
    }

    const projectAssets = await loadProjectAssets(files, local.id);
    await restartWithFiles(files, { ...projectAssets, ...assets });
    useWorkspaceStore.getState().loadFiles(files);
    set({
      id: local.id,
      name: local.name,
      createdAt: local.createdAt,
      updatedAt: local.updatedAt,
    });

    if (agentStateRaw) {
      // Write first, then hydrate; the OPFS queue preserves the ordering.
      writePersistedAgentState(local.id, agentStateRaw);
      await useAgentStore.getState().loadPersisted();
    } else {
      useAgentStore.getState().resetForProject();
    }

    const fileCount = Object.keys(files).length;
    const assetCount = Object.keys(assets).length;
    runtime.log(
      'success',
      `Imported “${local.name}” · ${fileCount} files${
        assetCount > 0
          ? ` + ${assetCount} public asset${assetCount === 1 ? '' : 's'}`
          : ''
      } into OPFS`
    );
    useUiStore.getState().toast(`Imported “${local.name}”`);
  },
}));
