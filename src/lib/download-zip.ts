import { strToU8, zipSync } from 'fflate';
import { AGENT_STATE_FILENAME } from '../../shared/agent-state';
import { runtime } from './runtime';
import {
  APP_VERSION,
  ARCHIVE_FORMAT,
  ARCHIVE_VERSION,
  MANIFEST_FILENAME,
  type ProjectArchiveManifest,
} from './project-archive';
import { serializeAgentState } from './agent-state';
import {
  flushAgentStatePersistence,
  useAgentStore,
} from '@/store/agent';
import { useProjectStore } from '@/store/projects';
import { useUiStore } from '@/store/ui';
import { useWorkspaceStore } from '@/store/workspace';

/** Folder name inside the archive: kebab-case, without the "unsaved" suffix. */
function archiveName(projectName: string): string {
  const slug = projectName
    .replace(/\(unsaved\)/gi, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'forge-project';
}

/**
 * Downloads the whole virtual project as a ZIP. Pending editor buffers are
 * flushed first so the archive matches what is on screen, then every text file
 * and binary `public/` asset is nested under a folder named after the project.
 */
export function downloadProjectZip(): void {
  useWorkspaceStore.getState().flush();
  flushAgentStatePersistence();

  const files = runtime.snapshot();
  const assets = runtime.assetSnapshot();
  const paths = Object.keys(files).sort();
  const assetPaths = Object.keys(assets).sort();
  const total = paths.length + assetPaths.length;
  const toast = useUiStore.getState().toast;

  if (total === 0) {
    toast('Nothing to download — the project is empty', 'error');
    return;
  }

  const projectName = useProjectStore.getState().name;
  const folder = archiveName(projectName);
  const entries: Record<string, Uint8Array> = {};

  const manifest: ProjectArchiveManifest = {
    format: ARCHIVE_FORMAT,
    version: ARCHIVE_VERSION,
    appVersion: APP_VERSION,
    projectName: projectName.replace(/\(unsaved\)/gi, '').trim() || folder,
    root: folder,
    exportedAt: new Date().toISOString(),
    fileCount: total,
  };
  entries[MANIFEST_FILENAME] = strToU8(JSON.stringify(manifest, null, 2));

  // The transcript sits at the archive root, outside the project folder, so it
  // never becomes a virtual project file.
  try {
    entries[AGENT_STATE_FILENAME] = strToU8(
      serializeAgentState(useAgentStore.getState())
    );
  } catch (error) {
    runtime.log(
      'warn',
      `Agent state was not exported: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }

  for (const path of paths) {
    const relative = path.replace(/^\/+/, '');
    if (!relative) continue;
    entries[`${folder}/${relative}`] = strToU8(files[path]);
  }

  // Public binaries (models, HDRIs, uploads) travel beside the text files.
  for (const path of assetPaths) {
    const relative = path.replace(/^\/+/, '');
    if (!relative) continue;
    entries[`${folder}/${relative}`] = assets[path];
  }

  let archive: Uint8Array;
  try {
    archive = zipSync(entries, { level: 6 });
  } catch (error) {
    toast(
      `Could not build the archive: ${error instanceof Error ? error.message : String(error)}`,
      'error'
    );
    return;
  }

  const blob = new Blob([archive as unknown as BlobPart], {
    type: 'application/zip',
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');

  anchor.href = url;
  anchor.download = `${folder}.zip`;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);

  runtime.log(
    'success',
    `Downloaded ${total} files${
      assetPaths.length > 0
        ? ` (${assetPaths.length} public asset${assetPaths.length === 1 ? '' : 's'})`
        : ''
    } as ${folder}.zip`
  );
  toast(`Downloaded ${total} files`);
}
