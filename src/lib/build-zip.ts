import { zipSync } from 'fflate';
import { useProjectStore } from '@/store/projects';
import { useUiStore } from '@/store/ui';
import { useWorkspaceStore } from '@/store/workspace';
import { buildErrorMessage, buildProject } from './build-container';
import { runtime } from './runtime';

/**
 * Compile the current project in almostnode's browser build container, then
 * download the contents of `/dist` as a ZIP. The archive is flat (index.html
 * and assets at the root) so it can be dropped straight onto a static host.
 */

export interface BuildZipResult {
  ok: boolean;
  fileCount: number;
  archiveBytes: number;
  durationMs: number;
  installed: boolean;
  cancelled: boolean;
  /** Every dist file included in the archive, relative to the dist root. */
  files: string[];
  /** Progress emitted by the dependency install, when one ran. */
  installOutput: string;
  /** Full command output, useful when the build fails. */
  output: string;
  error?: string;
}

export interface BuildZipOptions {
  signal?: AbortSignal;
  onProgress?: (message: string) => void;
}

const BUILD_TIMEOUT_MS = 8 * 60_000;

/** Folder/file name inside the archive: kebab-case, no "unsaved" suffix. */
function archiveName(projectName: string): string {
  const slug = projectName
    .replace(/\(unsaved\)/gi, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'forge-project';
}

function download(archive: Uint8Array, filename: string): void {
  const blob = new Blob([archive as unknown as BlobPart], {
    type: 'application/zip',
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');

  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function buildAndDownloadDistZip(
  options: BuildZipOptions = {},
): Promise<BuildZipResult> {
  const { onProgress } = options;
  const toast = useUiStore.getState().toast;

  // Build from what is on screen, not the last persisted buffer.
  useWorkspaceStore.getState().flush();

  // Caller signals and an internal timeout share one controller so a
  // cancel and the 8-minute cap both abort the container command.
  const controller = new AbortController();
  const forwardAbort = () => controller.abort();
  if (options.signal?.aborted) controller.abort();
  options.signal?.addEventListener('abort', forwardAbort, { once: true });
  const timer = window.setTimeout(() => controller.abort(), BUILD_TIMEOUT_MS);

  try {
    const result = await buildProject({
      signal: controller.signal,
      captureDist: true,
      onProgress,
    });

    const base = {
      fileCount: 0,
      archiveBytes: 0,
      durationMs: result.durationMs,
      installed: result.installed,
      cancelled: result.timedOut,
      files: [] as string[],
      installOutput: result.installOutput,
      output: result.output,
    };

    if (!result.ok) {
      const error = result.timedOut
        ? 'The build was cancelled or timed out.'
        : result.output || `Build failed with exit code ${result.exitCode}.`;
      runtime.log(
        result.timedOut ? 'warn' : 'error',
        `Build failed: ${result.command} exited ${result.exitCode}`,
      );
      toast(result.timedOut ? 'Build cancelled' : 'Build failed', 'error');
      return { ...base, ok: false, error };
    }

    const files = result.distFiles ?? {};
    const paths = Object.keys(files).sort();
    if (paths.length === 0) {
      const error =
        'The build passed but the dist folder is empty. Check the build output.';
      runtime.log('warn', error);
      toast('Build finished with an empty dist folder', 'error');
      return { ...base, ok: false, error };
    }

    onProgress?.(`Compressing ${paths.length} dist files`);
    const entries: Record<string, Uint8Array> = {};
    for (const path of paths) entries[path] = files[path];

    let archive: Uint8Array;
    try {
      archive = zipSync(entries, { level: 6 });
    } catch (error) {
      const message = `Could not create the ZIP: ${buildErrorMessage(error)}`;
      runtime.log('error', message);
      toast('Could not create the ZIP', 'error');
      return { ...base, ok: false, error: message };
    }

    const filename = `${archiveName(useProjectStore.getState().name)}-dist.zip`;
    onProgress?.(`Starting download · ${filename}`);
    download(archive, filename);

    runtime.log(
      'success',
      `Built ${paths.length} files and downloaded ${filename}`,
    );
    toast(`Downloaded ${filename}`);

    return {
      ...base,
      ok: true,
      fileCount: paths.length,
      archiveBytes: archive.length,
      files: paths,
    };
  } catch (error) {
    const message = buildErrorMessage(error);
    runtime.log('error', `Build failed: ${message}`);
    toast('Build failed', 'error');
    return {
      ok: false,
      fileCount: 0,
      archiveBytes: 0,
      durationMs: 0,
      installed: false,
      cancelled: controller.signal.aborted,
      files: [],
      installOutput: '',
      output: '',
      error: message,
    };
  } finally {
    window.clearTimeout(timer);
    options.signal?.removeEventListener('abort', forwardAbort);
  }
}
