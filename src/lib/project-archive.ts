import { strFromU8, unzipSync } from 'fflate';
import packageJson from '../../package.json';

/**
 * Forge project archives are plain ZIP files with a root manifest:
 *
 *   forge.manifest.json
 *   <root>/index.html
 *   <root>/src/...
 *
 * The manifest makes it possible to reject archives from a newer format before
 * touching the virtual project.
 */
export const ARCHIVE_FORMAT = 'forge-project';
export const ARCHIVE_VERSION = 1;
export const MANIFEST_FILENAME = 'forge.manifest.json';
export const APP_VERSION = packageJson.version;

const MAX_ARCHIVE_BYTES = 25 * 1024 * 1024;
const MAX_EXTRACTED_BYTES = 20 * 1024 * 1024;
const MAX_FILES = 2000;
const MAX_FILE_BYTES = 4 * 1024 * 1024;

export interface ProjectArchiveManifest {
  format: typeof ARCHIVE_FORMAT;
  /** Bump when the archive layout changes; importers reject newer values. */
  version: number;
  appVersion: string;
  projectName: string;
  /** Folder that contains the project files. */
  root: string;
  exportedAt: string;
  fileCount: number;
}

export interface ImportedProject {
  name: string;
  files: Record<string, string>;
  manifest: ProjectArchiveManifest;
}

export class ProjectArchiveError extends Error {}

/** Archives are readable when their format version is this one or older. */
function assertCompatibleVersion(version: number): void {
  if (version > ARCHIVE_VERSION) {
    throw new ProjectArchiveError(
      `This project uses archive v${version}, but this Forge build supports up to ` +
        `v${ARCHIVE_VERSION}. Update Forge and try again.`,
    );
  }
}

function validateManifest(raw: unknown): ProjectArchiveManifest {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ProjectArchiveError('The archive manifest is not a JSON object.');
  }

  const manifest = raw as Partial<ProjectArchiveManifest>;
  if (manifest.format !== ARCHIVE_FORMAT) {
    throw new ProjectArchiveError('This ZIP is not a Forge project export.');
  }

  const version = manifest.version;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw new ProjectArchiveError('The archive manifest has an invalid format version.');
  }
  assertCompatibleVersion(version);

  if (typeof manifest.root !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(manifest.root)) {
    throw new ProjectArchiveError('The archive manifest has an unsafe project folder name.');
  }

  if (
    manifest.fileCount !== undefined &&
    (!Number.isInteger(manifest.fileCount) || manifest.fileCount < 1)
  ) {
    throw new ProjectArchiveError('The archive manifest has an invalid file count.');
  }

  return {
    format: ARCHIVE_FORMAT,
    version,
    appVersion: typeof manifest.appVersion === 'string' ? manifest.appVersion : 'unknown',
    projectName: typeof manifest.projectName === 'string' ? manifest.projectName : manifest.root,
    root: manifest.root,
    exportedAt: typeof manifest.exportedAt === 'string' ? manifest.exportedAt : '',
    fileCount: manifest.fileCount ?? 0,
  };
}

function assertSafeRelativePath(relative: string): void {
  if (relative.startsWith('/') || relative.includes('\\') || relative.includes('\0')) {
    throw new ProjectArchiveError(`The archive contains an unsafe path: ${relative}`);
  }
  const segments = relative.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new ProjectArchiveError(`The archive contains an unsafe path: ${relative}`);
  }
}

/**
 * Reads and validates a Forge ZIP without touching the workspace. Throws a
 * ProjectArchiveError with a user-facing message when the archive is invalid,
 * was made by a newer format, or is incomplete.
 */
export async function readProjectArchive(file: File): Promise<ImportedProject> {
  if (!/\.zip$/i.test(file.name)) {
    throw new ProjectArchiveError('Choose a .zip file exported from Forge.');
  }
  if (file.size > MAX_ARCHIVE_BYTES) {
    throw new ProjectArchiveError('That ZIP is larger than the 25 MB import limit.');
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  let manifestBytes: Uint8Array | undefined;
  try {
    // The first pass decompresses only the tiny manifest.
    const manifestOnly = unzipSync(bytes, {
      filter: (entry) => entry.name === MANIFEST_FILENAME && entry.originalSize <= 64 * 1024,
    });
    manifestBytes = manifestOnly[MANIFEST_FILENAME];
  } catch {
    throw new ProjectArchiveError('This ZIP could not be opened.');
  }

  if (!manifestBytes) {
    throw new ProjectArchiveError(
      'This ZIP has no forge.manifest.json. Re-export the project from a Forge build that includes versioned archives.',
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(strFromU8(manifestBytes));
  } catch {
    throw new ProjectArchiveError('The archive manifest is not valid JSON.');
  }

  const manifest = validateManifest(parsed);
  const prefix = `${manifest.root}/`;
  let extractedBytes = 0;
  let limitHit = false;

  let extracted: Record<string, Uint8Array>;
  try {
    extracted = unzipSync(bytes, {
      filter: (entry) => {
        if (entry.name.endsWith('/') || !entry.name.startsWith(prefix)) return false;
        if (entry.originalSize > MAX_FILE_BYTES) {
          limitHit = true;
          return false;
        }
        extractedBytes += entry.originalSize;
        if (extractedBytes > MAX_EXTRACTED_BYTES) {
          limitHit = true;
          return false;
        }
        return true;
      },
    });
  } catch {
    throw new ProjectArchiveError('Some files in this ZIP could not be extracted.');
  }

  if (limitHit) {
    throw new ProjectArchiveError(
      'This ZIP exceeds the import limits (20 MB total, 4 MB per file).',
    );
  }

  const files: Record<string, string> = {};
  for (const [name, data] of Object.entries(extracted)) {
    if (name.endsWith('/') || !name.startsWith(prefix)) continue;
    const relative = name.slice(prefix.length);
    assertSafeRelativePath(relative);
    files[`/${relative}`] = strFromU8(data);
    if (Object.keys(files).length > MAX_FILES) {
      throw new ProjectArchiveError(`This ZIP contains more than ${MAX_FILES} files.`);
    }
  }

  const fileCount = Object.keys(files).length;
  if (fileCount === 0) {
    throw new ProjectArchiveError('This archive contains no project files.');
  }
  if (manifest.fileCount && manifest.fileCount !== fileCount) {
    throw new ProjectArchiveError(
      `The archive is incomplete: the manifest lists ${manifest.fileCount} files but ` +
        `${fileCount} were found.`,
    );
  }

  const name =
    manifest.projectName.replace(/\(unsaved\)/gi, '').trim() || manifest.root || 'imported-project';

  return { name, files, manifest };
}
