import { useAgentStore } from '@/store/agent';
import { useProjectStore, CURRENT_PROJECT_KEY } from '@/store/projects';
import { useRuntimeStore } from '@/store/runtime';
import { useWorkspaceStore } from '@/store/workspace';
import {
  bindOpfsProject,
  createLocalProject,
  opfsFileSink,
  opfsProjectStore,
  readLocalProject,
  requestPersistentStorage,
  type LocalProjectMeta,
  type OpfsProject,
} from './opfs';
import { runtime } from './runtime';
import {
  loadStarterAssets,
  STARTER_ASSET_ENTRY,
  STARTER_FILES,
  STARTER_PROJECT_NAME,
} from './starter-project';

let bootstrapPromise: Promise<void> | null = null;

/**
 * Hydrate the IDE from OPFS (fast and offline-capable), falling back to the
 * starter template. Every path binds the runtime's file sink so subsequent
 * edits land in `sandbox/<sandbox-id>/projects/<project-id>/**`.
 */
export function bootstrap(): Promise<void> {
  bootstrapPromise ??= run();
  return bootstrapPromise;
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

/** Load the binary starter assets only for projects that use chapter 4. */
async function assetsFor(
  files: Record<string, string>
): Promise<Record<string, Uint8Array>> {
  if (files[STARTER_ASSET_ENTRY] === undefined) return {};
  try {
    return await loadStarterAssets();
  } catch (error) {
    runtime.log(
      'warn',
      `Could not load binary starter assets: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    return {};
  }
}

async function hydrate(
  files: Record<string, string>,
  meta: LocalProjectMeta,
  seedOpfs: boolean,
  assets: Record<string, Uint8Array> = {}
): Promise<void> {
  const projectId = meta.id;
  const name = meta.name;

  bindOpfsProject(projectId, name);
  runtime.setFileSink(opfsFileSink);
  localStorage.setItem(CURRENT_PROJECT_KEY, projectId);

  if (seedOpfs) {
    try {
      await opfsProjectStore.replaceAll(projectId, files, {
        name,
        createdAt: meta.createdAt,
        updatedAt: meta.updatedAt,
      });
    } catch (error) {
      runtime.log(
        'warn',
        `Could not seed OPFS storage: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  await useRuntimeStore.getState().boot(files, assets);
  useWorkspaceStore.getState().loadFiles(files);
  await useAgentStore.getState().loadPersisted();

  useProjectStore.getState().setCurrent(meta);
  runtime.log(
    'info',
    seedOpfs ? `Seeded “${name}” into OPFS` : `Restored “${name}” from OPFS`
  );
}

/** Rebuild a project identity from an OPFS folder that predates this boot. */
function metaFromOpfs(
  id: string,
  cached: OpfsProject,
  fallbackName: string
): LocalProjectMeta {
  const epoch = new Date(0).toISOString();
  return {
    id,
    name: cached.manifest?.name || fallbackName,
    createdAt: cached.manifest?.createdAt || epoch,
    updatedAt: cached.manifest?.updatedAt || epoch,
  };
}

async function run(): Promise<void> {
  void requestPersistentStorage();

  const activeId = localStorage.getItem(CURRENT_PROJECT_KEY);
  if (activeId) {
    const cached = await readCached(activeId);
    if (cached && Object.keys(cached.files).length > 0) {
      await hydrate(
        cached.files,
        metaFromOpfs(activeId, cached, 'Saved project'),
        false,
        await assetsFor(cached.files)
      );
      return;
    }
    localStorage.removeItem(CURRENT_PROJECT_KEY);
  }

  const local = readLocalProject();
  if (local) {
    const cached = await readCached(local.id);
    if (cached && Object.keys(cached.files).length > 0) {
      await hydrate(
        cached.files,
        local,
        false,
        await assetsFor(cached.files)
      );
      return;
    }
  }

  const starter = createLocalProject(STARTER_PROJECT_NAME);
  await hydrate(
    STARTER_FILES,
    starter,
    true,
    await assetsFor(STARTER_FILES)
  );
}
