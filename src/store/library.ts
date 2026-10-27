import { create } from 'zustand';
import {
  serializeAgentState,
  writePersistedAgentState,
} from '@/lib/agent-state';
import {
  getBoundProjectId,
  opfsProjectStore,
  type ProjectCatalogEntry,
  type ProjectVersionMeta,
} from '@/lib/opfs';
import { loadProjectAssets } from '@/lib/project-assets';
import { runtime } from '@/lib/runtime';
import type { StarterTemplateId } from '@/lib/starter-project';
import { flushAgentStatePersistence, useAgentStore } from './agent';
import { useProjectStore } from './projects';
import { restartWithFiles } from './runtime';
import { useUiStore } from './ui';
import { useWorkspaceStore } from './workspace';

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface LibraryState {
  projects: ProjectCatalogEntry[];
  loading: boolean;
  selectedId: string | null;
  versions: ProjectVersionMeta[];
  versionsLoading: boolean;
  /** Key of the action currently running, e.g. `open:local-abc`. */
  busy: string | null;

  refresh: () => Promise<void>;
  select: (id: string) => Promise<void>;
  openProject: (id: string) => Promise<void>;
  createProject: (
    name: string,
    template?: StarterTemplateId
  ) => Promise<void>;
  duplicateProject: (id: string, name: string) => Promise<void>;
  renameProject: (id: string, name: string) => Promise<void>;
  deleteProject: (id: string) => Promise<void>;
  saveVersion: (projectId: string, label: string) => Promise<void>;
  restoreVersion: (projectId: string, versionId: string) => Promise<void>;
  deleteVersion: (projectId: string, versionId: string) => Promise<void>;
}

function activeProjectId(): string | null {
  return getBoundProjectId() ?? useProjectStore.getState().id;
}

export const useProjectLibraryStore = create<LibraryState>((set, get) => ({
  projects: [],
  loading: false,
  selectedId: null,
  versions: [],
  versionsLoading: false,
  busy: null,

  refresh: async () => {
    set({ loading: true });
    try {
      const projects = await opfsProjectStore.listProjects();
      const activeId = activeProjectId();
      const current = get().selectedId;
      let nextSelected = current;
      if (!nextSelected || !projects.some((project) => project.id === nextSelected)) {
        nextSelected =
          (activeId && projects.some((project) => project.id === activeId)
            ? activeId
            : projects[0]?.id) ?? null;
      }
      set({ projects, loading: false, selectedId: nextSelected });
      if (nextSelected) await get().select(nextSelected);
      else set({ versions: [] });
    } catch (error) {
      set({ loading: false });
      useUiStore
        .getState()
        .toast(`Could not read project storage: ${messageOf(error)}`, 'error');
    }
  },

  select: async (id) => {
    set({ selectedId: id, versions: [], versionsLoading: true });
    try {
      const versions = await opfsProjectStore.listVersions(id);
      // Ignore a slow read for a project the user already left.
      if (get().selectedId === id) set({ versions, versionsLoading: false });
    } catch {
      if (get().selectedId === id) set({ versions: [], versionsLoading: false });
    }
  },

  openProject: async (id) => {
    if (get().busy) return;
    if (id === activeProjectId()) return;
    set({ busy: `open:${id}` });
    try {
      await useProjectStore.getState().openProject(id);
      await get().refresh();
    } catch (error) {
      runtime.log('error', `Could not open the project: ${messageOf(error)}`);
      useUiStore.getState().toast(messageOf(error), 'error');
    } finally {
      set({ busy: null });
    }
  },

  createProject: async (name, template) => {
    if (get().busy) return;
    const projectName = name.trim() || 'untitled';
    set({ busy: 'create' });
    try {
      await useProjectStore.getState().newProject(projectName, template);
      const createdId = activeProjectId();
      await get().refresh();
      if (createdId) await get().select(createdId);
    } catch (error) {
      useUiStore.getState().toast(messageOf(error), 'error');
    } finally {
      set({ busy: null });
    }
  },

  duplicateProject: async (id, name) => {
    if (get().busy) return;
    set({ busy: `duplicate:${id}` });
    try {
      const source = get().projects.find((project) => project.id === id);
      const duplicated = await opfsProjectStore.duplicateProject(
        id,
        name.trim() || `${source?.name ?? 'project'} copy`
      );
      if (!duplicated) throw new Error('That project has no files to duplicate.');
      await get().refresh();
      await get().select(duplicated.id);
      runtime.log('success', `Duplicated into “${duplicated.name}”`);
      useUiStore.getState().toast(`Duplicated as “${duplicated.name}”`);
    } catch (error) {
      useUiStore.getState().toast(messageOf(error), 'error');
    } finally {
      set({ busy: null });
    }
  },

  renameProject: async (id, name) => {
    if (get().busy) return;
    const projectName = name.trim();
    if (!projectName) return;
    set({ busy: `rename:${id}` });
    try {
      if (id === activeProjectId()) {
        useProjectStore.getState().renameProject(projectName);
      } else {
        const renamed = await opfsProjectStore.renameProject(id, projectName);
        if (!renamed) throw new Error('That project no longer exists.');
      }
      await get().refresh();
      useUiStore.getState().toast(`Renamed to “${projectName}”`);
    } catch (error) {
      useUiStore.getState().toast(messageOf(error), 'error');
    } finally {
      set({ busy: null });
    }
  },

  deleteProject: async (id) => {
    if (get().busy) return;
    set({ busy: `delete:${id}` });
    try {
      const wasActive = id === activeProjectId();
      // Switch to a fresh starter project before removing the live folder, so
      // the runtime never points at a deleted project.
      if (wasActive) await useProjectStore.getState().newProject('untitled');
      await opfsProjectStore.deleteProject(id);
      await get().refresh();
      useUiStore.getState().toast('Project deleted');
    } catch (error) {
      useUiStore.getState().toast(messageOf(error), 'error');
    } finally {
      set({ busy: null });
    }
  },

  saveVersion: async (projectId, label) => {
    if (get().busy) return;
    set({ busy: `version:${projectId}` });
    try {
      let files: Record<string, string>;
      let agentState: string | null;

      if (projectId === activeProjectId()) {
        useWorkspaceStore.getState().flush();
        flushAgentStatePersistence();
        files = runtime.snapshot();
        agentState = serializeAgentState(useAgentStore.getState());
      } else {
        const stored = await opfsProjectStore.read(projectId);
        files = stored?.files ?? {};
        agentState = await opfsProjectStore.readAgentState(projectId);
      }

      if (Object.keys(files).length === 0) {
        throw new Error('There are no files to snapshot yet.');
      }

      const version = await opfsProjectStore.createVersion(
        projectId,
        label,
        files,
        agentState
      );
      await get().refresh();
      if (get().selectedId === projectId) await get().select(projectId);
      runtime.log(
        'success',
        `Saved “${version.label}” · ${version.fileCount} files`
      );
      useUiStore.getState().toast(`Saved version “${version.label}”`);
    } catch (error) {
      useUiStore.getState().toast(messageOf(error), 'error');
    } finally {
      set({ busy: null });
    }
  },

  restoreVersion: async (projectId, versionId) => {
    if (get().busy) return;
    set({ busy: `restore:${projectId}:${versionId}` });
    try {
      // Validate the snapshot before switching away from the live project.
      const version = await opfsProjectStore.readVersion(projectId, versionId);
      if (!version || Object.keys(version.files).length === 0) {
        throw new Error('That version is empty or missing.');
      }

      if (projectId !== activeProjectId()) {
        await useProjectStore.getState().openProject(projectId);
      }

      // Keep the current work as a safety snapshot before replacing it.
      useWorkspaceStore.getState().flush();
      flushAgentStatePersistence();
      await opfsProjectStore.createVersion(
        projectId,
        'Auto · before restore',
        runtime.snapshot(),
        serializeAgentState(useAgentStore.getState())
      );

      await restartWithFiles(
        version.files,
        await loadProjectAssets(version.files, projectId)
      );
      useWorkspaceStore.getState().loadFiles(version.files);

      if (version.agentState) {
        // Write first, then hydrate; the OPFS queue preserves the ordering.
        writePersistedAgentState(projectId, version.agentState);
        await useAgentStore.getState().loadPersisted();
        // The transcript's old "undo last run" snapshot no longer matches the
        // files we just restored.
        useAgentStore.setState({ undoSnapshot: null, undoAvailable: false });
      }

      await get().refresh();
      if (get().selectedId === projectId) await get().select(projectId);
      runtime.log(
        'success',
        `Restored “${version.label}” · ${version.fileCount} files`
      );
      useUiStore.getState().toast(`Restored “${version.label}”`);
    } catch (error) {
      runtime.log('error', `Could not restore the version: ${messageOf(error)}`);
      useUiStore.getState().toast(messageOf(error), 'error');
    } finally {
      set({ busy: null });
    }
  },

  deleteVersion: async (projectId, versionId) => {
    if (get().busy) return;
    set({ busy: `unversion:${projectId}:${versionId}` });
    try {
      await opfsProjectStore.deleteVersion(projectId, versionId);
      if (get().selectedId === projectId) await get().select(projectId);
      await get().refresh();
      useUiStore.getState().toast('Version deleted');
    } catch (error) {
      useUiStore.getState().toast(messageOf(error), 'error');
    } finally {
      set({ busy: null });
    }
  },
}));
