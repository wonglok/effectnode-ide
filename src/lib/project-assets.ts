import { opfsProjectStore } from './opfs';
import { runtime } from './runtime';
import {
  detectStarterTemplate,
  loadStarterAssets,
  STARTER_ASSET_ENTRY,
} from './starter-project';

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Assets a project needs at boot: the starter's chapter-4 binaries plus any
 * uploaded public files persisted under `.forge/uploads`.
 */
export async function loadProjectAssets(
  files: Record<string, string>,
  projectId: string | null | undefined
): Promise<Record<string, Uint8Array>> {
  let assets: Record<string, Uint8Array> = {};

  if (files[STARTER_ASSET_ENTRY] !== undefined) {
    try {
      // The project's files reveal which starter (and therefore which asset
      // set) it came from, so movie projects restore their video after reload.
      assets = await loadStarterAssets(detectStarterTemplate(files));
    } catch (error) {
      runtime.log(
        'warn',
        `Could not load binary starter assets: ${messageOf(error)}`
      );
    }
  }

  if (projectId) {
    try {
      assets = { ...assets, ...(await opfsProjectStore.readUploads(projectId)) };
    } catch (error) {
      runtime.log('warn', `Could not load uploaded assets: ${messageOf(error)}`);
    }
  }

  return assets;
}
