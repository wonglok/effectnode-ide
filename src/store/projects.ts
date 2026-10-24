import { create } from 'zustand';
import { writePersistedAgentState } from '@/lib/agent-state';
import {
  bindOpfsProject,
  createLocalProject,
  getBoundProjectId,
  readLocalProject,
  updateOpfsProjectName,
  writeLocalProject,
} from '@/lib/opfs';
import { runtime } from '@/lib/runtime';
import { STARTER_FILES, STARTER_PROJECT_NAME } from '@/lib/starter-project';
import {
  flushAgentStatePersistence,
  pauseAgentStatePersistence,
  useAgentStore,
} from './agent';
import { restartWithFiles } from './runtime';
import { useUiStore } from './ui';
import { useWorkspaceStore } from './workspace';

/** Last active OPFS project id, kept under the historical key for reloads. */
export const CURRENT_PROJECT_KEY = 'forge.currentProject';

export interface ProjectMetaState {
  name: string;
  createdAt: string | null;
  updatedAt: string | null;
}

interface ProjectState extends ProjectMetaState {
  setCurrent: (meta: ProjectMetaState | null) => void;
  renameProject: (name: string) => void;
  newProject: (name?: string) => Promise<void>;
  /** Replace the workspace with files from a validated Forge ZIP archive. */
  importProject: (
    name: string,
    files: Record<string, string>,
    agentStateRaw?: string | null
  ) => Promise<void>;
}

export const useProjectStore = create<ProjectState>((set) => ({
  name: STARTER_PROJECT_NAME,
  createdAt: null,
  updatedAt: null,

  setCurrent: (meta) => {
    if (!meta) {
      set({ createdAt: null, updatedAt: null });
      return;
    }
    set({
      name: meta.name,
      createdAt: meta.createdAt,
      updatedAt: meta.updatedAt,
    });
    updateOpfsProjectName(meta.name);
  },

  renameProject: (name) => {
    const projectName = name.trim();
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

  newProject: async (name) => {
    flushAgentStatePersistence();
    pauseAgentStatePersistence();
    useWorkspaceStore.getState().flush();
    const projectName = name?.trim() || 'untitled';
    const local = createLocalProject(projectName);
    localStorage.setItem(CURRENT_PROJECT_KEY, local.id);
    bindOpfsProject(local.id, local.name);
    // replaceProject mirrors the starter files into the new OPFS folder.
    await restartWithFiles(STARTER_FILES);
    useWorkspaceStore.getState().loadFiles(STARTER_FILES);
    set({
      name: local.name,
      createdAt: local.createdAt,
      updatedAt: local.updatedAt,
    });
    useAgentStore.getState().resetForProject();
    runtime.log('info', `Started “${local.name}” in OPFS`);
    useUiStore.getState().toast('New project ready');
  },

  importProject: async (name, files, agentStateRaw = null) => {
    flushAgentStatePersistence();
    pauseAgentStatePersistence();
    useWorkspaceStore.getState().flush();
    const projectName = name.trim() || 'imported-project';
    const local = createLocalProject(projectName);
    localStorage.setItem(CURRENT_PROJECT_KEY, local.id);
    bindOpfsProject(local.id, local.name);
    await restartWithFiles(files);
    useWorkspaceStore.getState().loadFiles(files);
    set({
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
    runtime.log('success', `Imported “${local.name}” · ${fileCount} files into OPFS`);
    useUiStore.getState().toast(`Imported “${local.name}”`);
  },
}));
