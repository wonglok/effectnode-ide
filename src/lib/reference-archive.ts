import { unzipSync } from 'fflate';
import type { ReferenceFile } from './opfs';

/**
 * Reference ZIPs are plain archives extracted into the project's OPFS
 * `reference/` folder. Unlike project imports they may contain binaries, so
 * the bytes are passed through untouched.
 */
const MAX_ARCHIVE_BYTES = 50 * 1024 * 1024;
const MAX_EXTRACTED_BYTES = 150 * 1024 * 1024;
const MAX_FILES = 2000;
const MAX_FILE_BYTES = 30 * 1024 * 1024;

export class ReferenceArchiveError extends Error {}

/** Normalize an archive name and reject anything that could escape the root. */
function normalizeName(raw: string): string | null {
  const name = raw.replace(/\\/g, '/').replace(/^\.\/+/, '');
  if (!name || name.endsWith('/') || name.startsWith('/')) return null;

  const segments = name
    .split('/')
    .filter((segment) => segment.length > 0 && segment !== '.');
  if (
    segments.length === 0 ||
    segments.some((segment) => segment === '..' || segment.includes('\0'))
  ) {
    return null;
  }
  return segments.join('/');
}

function isWanted(path: string): boolean {
  const segments = path.split('/');
  if (segments[0] === '__MACOSX') return false;
  const name = segments[segments.length - 1] ?? '';
  return (
    Boolean(name) &&
    name !== '.DS_Store' &&
    name !== 'Thumbs.db' &&
    !name.startsWith('._')
  );
}

/**
 * Read a user-selected ZIP into a flat list of safe, binary reference files.
 * The archive's own folder structure is preserved below `reference/`.
 */
export async function readReferenceArchive(file: File): Promise<ReferenceFile[]> {
  if (!/\.zip$/i.test(file.name)) {
    throw new ReferenceArchiveError('Choose a .zip file.');
  }
  if (file.size > MAX_ARCHIVE_BYTES) {
    throw new ReferenceArchiveError('That ZIP is larger than the 50 MB limit.');
  }

  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch {
    throw new ReferenceArchiveError('This ZIP could not be read.');
  }

  // First pass: only enumerate names. This makes it possible to reject
  // oversized archives before allocating their contents.
  const names: string[] = [];
  try {
    unzipSync(bytes, {
      filter: (entry) => {
        names.push(entry.name);
        return false;
      },
    });
  } catch {
    throw new ReferenceArchiveError('This ZIP could not be opened.');
  }

  const usable = names
    .map(normalizeName)
    .filter((name): name is string => Boolean(name))
    .filter(isWanted);

  if (usable.length === 0) {
    throw new ReferenceArchiveError('This ZIP contains no usable files.');
  }
  if (usable.length > MAX_FILES) {
    throw new ReferenceArchiveError(
      `This ZIP contains more than ${MAX_FILES} files.`,
    );
  }

  let totalBytes = 0;
  let limitHit = false;
  let extracted: Record<string, Uint8Array>;
  try {
    extracted = unzipSync(bytes, {
      filter: (entry) => {
        const path = normalizeName(entry.name);
        if (!path || !isWanted(path)) return false;
        if (entry.originalSize > MAX_FILE_BYTES) {
          limitHit = true;
          return false;
        }
        totalBytes += entry.originalSize;
        if (totalBytes > MAX_EXTRACTED_BYTES) {
          limitHit = true;
          return false;
        }
        return true;
      },
    });
  } catch {
    throw new ReferenceArchiveError(
      'Some files in this ZIP could not be extracted.',
    );
  }

  if (limitHit) {
    throw new ReferenceArchiveError(
      'This ZIP exceeds the reference limits (150 MB extracted, 30 MB per file).',
    );
  }

  const files: ReferenceFile[] = [];
  for (const [rawName, data] of Object.entries(extracted)) {
    const path = normalizeName(rawName);
    if (!path || !isWanted(path)) continue;
    files.push({ path, data });
  }

  if (files.length === 0) {
    throw new ReferenceArchiveError('This ZIP contains no usable files.');
  }

  files.sort((a, b) => a.path.localeCompare(b.path));
  return files;
}
