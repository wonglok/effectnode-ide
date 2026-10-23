import type { ProjectSnapshot } from '../../shared/types';
import { useProjectStore, CURRENT_PROJECT_KEY } from '@/store/projects';
import { useRuntimeStore } from '@/store/runtime';
import { useWorkspaceStore } from '@/store/workspace';
import { projectApi } from './api';
import { runtime } from './runtime';
import { STARTER_FILES } from './starter-project';

let bootstrapPromise: Promise<void> | null = null;

/**
 * Fetch saved projects, restore the last one (if any), boot almostnode and
 * hydrate the editor stores. Safe to call more than once.
 */
export function bootstrap(): Promise<void> {
  bootstrapPromise ??= run();
  return bootstrapPromise;
}

async function run(): Promise<void> {
  await useProjectStore.getState().loadProjects();

  let files: Record<string, string> = STARTER_FILES;
  let restored: ProjectSnapshot | null = null;

  const savedId = localStorage.getItem(CURRENT_PROJECT_KEY);
  if (savedId) {
    try {
      const snapshot = await projectApi.get(savedId);
      files = snapshot.files;
      restored = snapshot;
    } catch (error) {
      runtime.log(
        'warn',
        `Could not restore the last project: ${error instanceof Error ? error.message : String(error)}`
      );
      localStorage.removeItem(CURRENT_PROJECT_KEY);
    }
  }

  await useRuntimeStore.getState().boot(files);

  // The editor should work even when the preview runtime failed to start.
  useWorkspaceStore.getState().loadFiles(files);

  if (restored) {
    useProjectStore.getState().setCurrent(restored);
    runtime.log('info', `Restored “${restored.name}” from the Nitro server`);
  } else {
    useProjectStore.getState().setCurrent(null);
    runtime.log('info', 'Loaded the Easy Fancy starter project');
  }
}
