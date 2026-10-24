import { create } from 'zustand';
import type { ProjectMeta, ProjectSnapshot } from '../../shared/types';
import { projectApi } from '@/lib/api';
import { writePersistedAgentState } from '@/lib/agent-state';
import {
  bindOpfsProject,
  clearLocalProject,
  createLocalProject,
  opfsProjectStore,
  readLocalProject,
  updateOpfsProjectName,
} from '@/lib/opfs';
import { runtime } from '@/lib/runtime';
import { STARTER_FILES, STARTER_PROJECT_NAME } from '@/lib/starter-project';
import {
  flushAgentStatePersistence,
  pauseAgentStatePersistence,
  resumeAgentStatePersistence,
  useAgentStore,
} from './agent';
import { restartWithFiles } from './runtime';
import { useUiStore } from './ui';
import { useWorkspaceStore } from './workspace';

export const CURRENT_PROJECT_KEY = 'forge.currentProject';

function metaOf(snapshot: ProjectSnapshot): ProjectMeta {
  return {
    id: snapshot.id,
    name: snapshot.name,
    createdAt: snapshot.createdAt,
    updatedAt: snapshot.updatedAt,
    fileCount: snapshot.fileCount,
  };
}

interface ProjectState {
  projects: ProjectMeta[];
  currentId: string | null;
  name: string;
  createdAt: string | null;
  updatedAt: string | null;
  loadingList: boolean;
  saving: boolean;
  openingId: string | null;
  serverOnline: boolean | null;

  loadProjects: () => Promise<void>;
  setCurrent: (meta: ProjectMeta | null) => void;
  save: (name?: string, options?: { asNew?: boolean }) => Promise<boolean>;
  open: (id: string) => Promise<boolean>;
  remove: (id: string) => Promise<boolean>;
  newProject: (name?: string) => Promise<void>;
  /** Replace the workspace with files from a validated Forge ZIP archive. */
  importProject: (
    name: string,
    files: Record<string, string>,
    agentStateRaw?: string | null
  ) => Promise<void>;
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  projects: [],
  currentId: null,
  name: STARTER_PROJECT_NAME,
  createdAt: null,
  updatedAt: null,
  loadingList: false,
  saving: false,
  openingId: null,
  serverOnline: null,

  loadProjects: async () => {
    set({ loadingList: true });
    try {
      const projects = await projectApi.list();
      set({ projects, loadingList: false, serverOnline: true });
    } catch (error) {
      set({ loadingList: false, serverOnline: false });
      runtime.log(
        'warn',
        `Project storage unavailable: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  },

  setCurrent: (meta) => {
    if (!meta) {
      set({ currentId: null, createdAt: null, updatedAt: null });
      return;
    }
    set({
      currentId: meta.id,
      name: meta.name,
      createdAt: meta.createdAt,
      updatedAt: meta.updatedAt,
    });
    updateOpfsProjectName(meta.name);
  },

  save: async (name, options) => {
    if (get().saving) return false;
    flushAgentStatePersistence();
    useWorkspaceStore.getState().flush();
    const projectName = (name ?? get().name).trim() || 'untitled';
    const files = runtime.snapshot();
    if (Object.keys(files).length === 0) {
      useUiStore.getState().toast('The virtual project is empty', 'error');
      return false;
    }

    set({ saving: true });
    try {
      const localProject = get().currentId ? null : readLocalProject();
      const meta = await projectApi.save({
        id: options?.asNew ? undefined : get().currentId ?? undefined,
        name: projectName,
        files,
      });

      // A local project becomes a server project: move its OPFS folder from
      // the local id to the server-assigned id before rebinding.
      if (localProject) {
        pauseAgentStatePersistence();
        try {
          await opfsProjectStore.moveProject(localProject.id, meta.id);
          clearLocalProject();
        } catch (error) {
          runtime.log(
            'warn',
            `Could not move the OPFS project folder: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
        }
      }

      bindOpfsProject(meta.id, meta.name);
      try {
        await opfsProjectStore.replaceAll(meta.id, files, {
          name: meta.name,
          createdAt: meta.createdAt,
          updatedAt: meta.updatedAt,
        });
      } catch (error) {
        runtime.log(
          'warn',
          `Could not persist the project to OPFS: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }

      if (localProject) {
        // Keep the live transcript under the server-assigned project id.
        resumeAgentStatePersistence();
        flushAgentStatePersistence();
      }

      localStorage.setItem(CURRENT_PROJECT_KEY, meta.id);
      set({
        saving: false,
        serverOnline: true,
        currentId: meta.id,
        name: meta.name,
        createdAt: meta.createdAt,
        updatedAt: meta.updatedAt,
        projects: [meta, ...get().projects.filter((project) => project.id !== meta.id)],
      });
      runtime.log('success', `Saved “${meta.name}” · ${meta.fileCount} files → Nitro + OPFS`);
      useUiStore.getState().toast(`Saved “${meta.name}”`);
      return true;
    } catch (error) {
      set({ saving: false, serverOnline: false });
      const message = error instanceof Error ? error.message : String(error);
      runtime.log('error', `Save failed: ${message}`);
      useUiStore.getState().toast('Could not save the project', 'error');
      return false;
    }
  },

  open: async (id) => {
    if (get().openingId) return false;
    set({ openingId: id });
    flushAgentStatePersistence();
    pauseAgentStatePersistence();
    try {
      const known = get().projects.find((project) => project.id === id);
      let cached: Awaited<ReturnType<typeof opfsProjectStore.read>> = null;
      try {
        cached = await opfsProjectStore.read(id);
      } catch {
        // OPFS unavailable; fall back to the Nitro snapshot below.
      }

      let files: Record<string, string>;
      let meta: ProjectMeta;
      let source: 'OPFS' | 'Nitro';

      if (cached && Object.keys(cached.files).length > 0) {
        files = cached.files;
        const epoch = new Date(0).toISOString();
        meta = known ?? {
          id,
          name: cached.manifest?.name ?? 'Saved project',
          createdAt: cached.manifest?.createdAt ?? epoch,
          updatedAt: cached.manifest?.updatedAt ?? epoch,
          fileCount: Object.keys(cached.files).length,
        };
        source = 'OPFS';
      } else {
        const snapshot: ProjectSnapshot = await projectApi.get(id);
        files = snapshot.files;
        meta = metaOf(snapshot);
        source = 'Nitro';
      }

      useWorkspaceStore.getState().flush();
      bindOpfsProject(meta.id, meta.name);
      // replaceProject mirrors the opened files into OPFS via the bound sink.
      await restartWithFiles(files);
      useWorkspaceStore.getState().loadFiles(files);
      await useAgentStore.getState().loadPersisted();
      clearLocalProject();
      localStorage.setItem(CURRENT_PROJECT_KEY, meta.id);
      set({
        openingId: null,
        currentId: meta.id,
        name: meta.name,
        createdAt: meta.createdAt,
        updatedAt: meta.updatedAt,
      });
      runtime.log('success', `Opened “${meta.name}” · ${meta.fileCount} files from ${source}`);
      useUiStore.getState().toast(`Opened “${meta.name}”`);
      return true;
    } catch (error) {
      set({ openingId: null });
      resumeAgentStatePersistence();
      const message = error instanceof Error ? error.message : String(error);
      runtime.log('error', `Open failed: ${message}`);
      useUiStore.getState().toast('Could not open the project', 'error');
      return false;
    }
  },

  remove: async (id) => {
    try {
      await projectApi.remove(id);
      try {
        await opfsProjectStore.deleteProject(id);
      } catch {
        // Best effort; the server copy is already gone.
      }

      const project = get().projects.find((entry) => entry.id === id);
      const wasCurrent = get().currentId === id;
      set({ projects: get().projects.filter((entry) => entry.id !== id) });

      if (localStorage.getItem(CURRENT_PROJECT_KEY) === id) {
        localStorage.removeItem(CURRENT_PROJECT_KEY);
      }

      if (wasCurrent) {
        // Keep the files and transcript the user is looking at as a new
        // OPFS-backed local project instead of discarding them.
        flushAgentStatePersistence();
        pauseAgentStatePersistence();
        const local = createLocalProject(`${get().name} (unsaved)`);
        const files = runtime.snapshot();
        bindOpfsProject(local.id, local.name);
        try {
          await opfsProjectStore.replaceAll(local.id, files, { name: local.name });
        } catch {
          // OPFS is optional.
        }
        resumeAgentStatePersistence();
        flushAgentStatePersistence();
        set({
          currentId: null,
          name: local.name,
          createdAt: local.createdAt,
          updatedAt: local.updatedAt,
        });
      }

      runtime.log('info', `Deleted saved project “${project?.name ?? id}”`);
      useUiStore.getState().toast('Saved project deleted');
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      runtime.log('error', `Delete failed: ${message}`);
      useUiStore.getState().toast('Could not delete the project', 'error');
      return false;
    }
  },

  newProject: async (name) => {
    flushAgentStatePersistence();
    pauseAgentStatePersistence();
    useWorkspaceStore.getState().flush();
    const projectName = name?.trim() || 'untitled';
    const local = createLocalProject(projectName);
    localStorage.removeItem(CURRENT_PROJECT_KEY);
    bindOpfsProject(local.id, local.name);
    // replaceProject mirrors the starter files into the new OPFS folder.
    await restartWithFiles(STARTER_FILES);
    useWorkspaceStore.getState().loadFiles(STARTER_FILES);
    set({
      currentId: null,
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
    localStorage.removeItem(CURRENT_PROJECT_KEY);
    bindOpfsProject(local.id, local.name);
    await restartWithFiles(files);
    useWorkspaceStore.getState().loadFiles(files);
    set({
      currentId: null,
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
