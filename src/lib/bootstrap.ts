import type { ProjectMeta, ProjectSnapshot } from '../../shared/types';
import { useAgentStore } from '@/store/agent';
import { useProjectStore, CURRENT_PROJECT_KEY } from '@/store/projects';
import { useRuntimeStore } from '@/store/runtime';
import { useWorkspaceStore } from '@/store/workspace';
import { projectApi } from './api';
import {
  bindOpfsProject,
  createLocalProject,
  opfsFileSink,
  opfsProjectStore,
  readLocalProject,
  requestPersistentStorage,
  type LocalProjectMeta,
  type OpfsProject,
  type ProjectManifest,
} from './opfs';
import { runtime } from './runtime';
import { STARTER_FILES, STARTER_PROJECT_NAME } from './starter-project';

let bootstrapPromise: Promise<void> | null = null;

/**
 * Hydrate the IDE from OPFS first (fast and offline-capable), then from the
 * Nitro snapshot, then the starter template. Every path binds the runtime's
 * file sink so subsequent edits land in
 * `sandbox/<sandbox-id>/projects/<project-id>/**`.
 */
export function bootstrap(): Promise<void> {
  bootstrapPromise ??= run();
  return bootstrapPromise;
}

type HydrationTarget =
  | { kind: 'saved'; meta: ProjectMeta }
  | { kind: 'local'; meta: LocalProjectMeta };

function metaFromSnapshot(snapshot: ProjectSnapshot): ProjectMeta {
  return {
    id: snapshot.id,
    name: snapshot.name,
    createdAt: snapshot.createdAt,
    updatedAt: snapshot.updatedAt,
    fileCount: snapshot.fileCount,
  };
}

function savedMetaFor(
  id: string,
  manifest: ProjectManifest | null,
  files: Record<string, string>
): ProjectMeta {
  const known = useProjectStore.getState().projects.find((project) => project.id === id);
  if (known) return known;
  const epoch = new Date(0).toISOString();
  return {
    id,
    name: manifest?.name ?? 'Saved project',
    createdAt: manifest?.createdAt ?? epoch,
    updatedAt: manifest?.updatedAt ?? epoch,
    fileCount: Object.keys(files).length,
  };
}

async function readCached(projectId: string): Promise<OpfsProject | null> {
  try {
    return await opfsProjectStore.read(projectId);
  } catch (error) {
    runtime.log(
      'warn',
      `Could not read OPFS project ${projectId}: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    return null;
  }
}

async function hydrate(
  files: Record<string, string>,
  target: HydrationTarget,
  seedOpfs: boolean
): Promise<void> {
  const projectId = target.meta.id;
  const name = target.meta.name;

  bindOpfsProject(projectId, name);
  runtime.setFileSink(opfsFileSink);

  if (seedOpfs) {
    try {
      await opfsProjectStore.replaceAll(projectId, files, {
        name,
        createdAt: target.meta.createdAt,
        updatedAt: target.meta.updatedAt,
      });
    } catch (error) {
      runtime.log(
        'warn',
        `Could not seed OPFS storage: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  await useRuntimeStore.getState().boot(files);
  useWorkspaceStore.getState().loadFiles(files);
  await useAgentStore.getState().loadPersisted();

  if (target.kind === 'saved') {
    useProjectStore.getState().setCurrent(target.meta);
    runtime.log(
      'info',
      `Restored “${name}” from ${seedOpfs ? 'the Nitro server' : 'OPFS'}`
    );
  } else {
    useProjectStore.setState({
      currentId: null,
      name,
      createdAt: target.meta.createdAt,
      updatedAt: target.meta.updatedAt,
    });
    runtime.log('info', `Restored “${name}” from OPFS`);
  }
}

async function run(): Promise<void> {
  await useProjectStore.getState().loadProjects();
  void requestPersistentStorage();

  const savedId = localStorage.getItem(CURRENT_PROJECT_KEY);
  if (savedId) {
    const cached = await readCached(savedId);
    if (cached && Object.keys(cached.files).length > 0) {
      await hydrate(
        cached.files,
        { kind: 'saved', meta: savedMetaFor(savedId, cached.manifest, cached.files) },
        false
      );
      return;
    }

    try {
      const snapshot = await projectApi.get(savedId);
      await hydrate(snapshot.files, { kind: 'saved', meta: metaFromSnapshot(snapshot) }, true);
      return;
    } catch (error) {
      runtime.log(
        'warn',
        `Could not restore the last project: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      localStorage.removeItem(CURRENT_PROJECT_KEY);
    }
  }

  const local = readLocalProject();
  if (local) {
    const cached = await readCached(local.id);
    if (cached && Object.keys(cached.files).length > 0) {
      await hydrate(cached.files, { kind: 'local', meta: local }, false);
      return;
    }
  }

  const starter = createLocalProject(STARTER_PROJECT_NAME);
  await hydrate(STARTER_FILES, { kind: 'local', meta: starter }, true);
}
