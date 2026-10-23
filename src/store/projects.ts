import { create } from 'zustand';
import type { ProjectMeta, ProjectSnapshot } from '../../shared/types';
import { projectApi } from '@/lib/api';
import { runtime } from '@/lib/runtime';
import { STARTER_FILES, STARTER_PROJECT_NAME } from '@/lib/starter-project';
import { restartWithFiles } from './runtime';
import { useUiStore } from './ui';
import { useWorkspaceStore } from './workspace';

export const CURRENT_PROJECT_KEY = 'forge.currentProject';

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
  importProject: (name: string, files: Record<string, string>) => Promise<void>;
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
  },

  save: async (name, options) => {
    if (get().saving) return false;
    useWorkspaceStore.getState().flush();
    const projectName = (name ?? get().name).trim() || 'untitled';
    const files = runtime.snapshot();
    if (Object.keys(files).length === 0) {
      useUiStore.getState().toast('The virtual project is empty', 'error');
      return false;
    }

    set({ saving: true });
    try {
      const meta = await projectApi.save({
        id: options?.asNew ? undefined : get().currentId ?? undefined,
        name: projectName,
        files,
      });
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
      runtime.log('success', `Saved “${meta.name}” · ${meta.fileCount} files → Nitro storage`);
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
    try {
      const snapshot: ProjectSnapshot = await projectApi.get(id);
      useWorkspaceStore.getState().flush();
      await restartWithFiles(snapshot.files);
      useWorkspaceStore.getState().loadFiles(snapshot.files);
      localStorage.setItem(CURRENT_PROJECT_KEY, snapshot.id);
      set({
        openingId: null,
        currentId: snapshot.id,
        name: snapshot.name,
        createdAt: snapshot.createdAt,
        updatedAt: snapshot.updatedAt,
      });
      runtime.log('success', `Opened “${snapshot.name}” · ${snapshot.fileCount} files`);
      useUiStore.getState().toast(`Opened “${snapshot.name}”`);
      return true;
    } catch (error) {
      set({ openingId: null });
      const message = error instanceof Error ? error.message : String(error);
      runtime.log('error', `Open failed: ${message}`);
      useUiStore.getState().toast('Could not open the project', 'error');
      return false;
    }
  },

  remove: async (id) => {
    try {
      await projectApi.remove(id);
      const project = get().projects.find((entry) => entry.id === id);
      set({
        projects: get().projects.filter((entry) => entry.id !== id),
        ...(get().currentId === id
          ? { currentId: null, createdAt: null, updatedAt: null, name: `${get().name} (unsaved)` }
          : {}),
      });
      if (localStorage.getItem(CURRENT_PROJECT_KEY) === id) {
        localStorage.removeItem(CURRENT_PROJECT_KEY);
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
    useWorkspaceStore.getState().flush();
    await restartWithFiles(STARTER_FILES);
    useWorkspaceStore.getState().loadFiles(STARTER_FILES);
    localStorage.removeItem(CURRENT_PROJECT_KEY);
    set({
      currentId: null,
      name: name?.trim() || 'untitled',
      createdAt: null,
      updatedAt: null,
    });
    runtime.log('info', 'Started a fresh project from the starter template');
    useUiStore.getState().toast('New project ready');
  },

  importProject: async (name, files) => {
    useWorkspaceStore.getState().flush();
    await restartWithFiles(files);
    useWorkspaceStore.getState().loadFiles(files);
    localStorage.removeItem(CURRENT_PROJECT_KEY);

    const projectName = name.trim() || 'imported-project';
    set({
      currentId: null,
      name: projectName,
      createdAt: null,
      updatedAt: null,
    });

    const fileCount = Object.keys(files).length;
    runtime.log('success', `Imported “${projectName}” · ${fileCount} files from ZIP`);
    useUiStore.getState().toast(`Imported “${projectName}”`);
  },
}));
