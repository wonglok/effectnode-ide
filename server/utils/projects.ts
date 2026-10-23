import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { BlobNotFoundError, del, get, list, put } from '@vercel/blob';
import type { ProjectMeta, ProjectSnapshot, SaveProjectPayload } from '../../shared/types';

const DATA_DIR = resolve(process.env.FORGE_DATA_DIR || 'data/projects');
const BLOB_PREFIX = 'projects/';
const ID_PATTERN = /^[a-zA-Z0-9_-]{6,64}$/;
const MAX_FILES = 500;
const MAX_TOTAL_BYTES = 2 * 1024 * 1024;
const MAX_NAME_LENGTH = 80;

interface StoredProject extends ProjectSnapshot {
  version: 1;
}

export class ProjectValidationError extends Error {}

/** Vercel Blob is used when a store token (or OIDC credentials) is present. */
function usesBlobStorage(): boolean {
  return Boolean(
    process.env.BLOB_READ_WRITE_TOKEN ||
      (process.env.VERCEL_OIDC_TOKEN && process.env.BLOB_STORE_ID)
  );
}

/**
 * Serverless hosts have a read-only filesystem outside /tmp. Fail with an
 * actionable message instead of an opaque EROFS when Blob is not connected.
 */
function assertStorageReady(): void {
  if (usesBlobStorage()) return;
  if (process.env.VERCEL && !process.env.FORGE_DATA_DIR) {
    throw new Error(
      'Project storage is not configured for Vercel. Connect a Vercel Blob store ' +
        '(BLOB_READ_WRITE_TOKEN) or set FORGE_DATA_DIR to a writable path.'
    );
  }
}

function storageFailure(error: unknown): Error {
  const code = (error as NodeJS.ErrnoException)?.code;
  if (code === 'EROFS' || code === 'EACCES') {
    return new Error(
      'Project storage is read-only on this host. Connect a Vercel Blob store ' +
        '(BLOB_READ_WRITE_TOKEN) or set FORGE_DATA_DIR to a writable path.'
    );
  }
  return error instanceof Error ? error : new Error(String(error));
}

async function ensureDataDir(): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
}

function fileFor(id: string): string {
  return join(DATA_DIR, `${id}.json`);
}

function blobPath(id: string): string {
  return `${BLOB_PREFIX}${id}.json`;
}

function parseStored(raw: string): StoredProject | null {
  try {
    const parsed = JSON.parse(raw) as StoredProject;
    if (!parsed || typeof parsed !== 'object' || !parsed.files) return null;
    return parsed;
  } catch {
    return null;
  }
}

function toMeta(project: ProjectSnapshot): ProjectMeta {
  return {
    id: project.id,
    name: project.name,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    fileCount: Object.keys(project.files).length,
  };
}

function assertValidId(id: string): void {
  if (!ID_PATTERN.test(id)) {
    throw new ProjectValidationError('Invalid project id');
  }
}

function validateName(raw: unknown): string {
  if (typeof raw !== 'string') throw new ProjectValidationError('Project name must be a string');
  const name = raw.trim();
  if (!name) throw new ProjectValidationError('Project name cannot be empty');
  if (name.length > MAX_NAME_LENGTH) {
    throw new ProjectValidationError(`Project name must be under ${MAX_NAME_LENGTH} characters`);
  }
  return name;
}

function validateFiles(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ProjectValidationError('files must be an object of path → content');
  }

  const entries = Object.entries(raw as Record<string, unknown>);
  if (entries.length === 0) throw new ProjectValidationError('A project needs at least one file');
  if (entries.length > MAX_FILES) {
    throw new ProjectValidationError(`A project can hold at most ${MAX_FILES} files`);
  }

  let totalBytes = 0;
  const files: Record<string, string> = {};

  for (const [rawPath, content] of entries) {
    if (typeof rawPath !== 'string' || !rawPath.startsWith('/')) {
      throw new ProjectValidationError(`File paths must be absolute: ${rawPath}`);
    }
    if (rawPath.includes('..') || rawPath.includes('\0')) {
      throw new ProjectValidationError(`Unsafe file path: ${rawPath}`);
    }
    if (rawPath.startsWith('/node_modules')) {
      throw new ProjectValidationError('node_modules cannot be saved');
    }
    if (typeof content !== 'string') {
      throw new ProjectValidationError(`File content must be text: ${rawPath}`);
    }
    totalBytes += Buffer.byteLength(content, 'utf8');
    if (totalBytes > MAX_TOTAL_BYTES) {
      throw new ProjectValidationError('Project is larger than 2 MB');
    }
    files[rawPath] = content;
  }

  return files;
}

async function readFileProject(id: string): Promise<StoredProject | null> {
  try {
    return parseStored(await readFile(fileFor(id), 'utf8'));
  } catch {
    return null;
  }
}

async function readBlobProject(id: string): Promise<StoredProject | null> {
  try {
    const result = await get(blobPath(id), { access: 'private', useCache: false });
    if (!result || result.statusCode !== 200 || !result.stream) return null;
    return parseStored(await new Response(result.stream).text());
  } catch (error) {
    if (error instanceof BlobNotFoundError) return null;
    throw error;
  }
}

async function readProject(id: string): Promise<StoredProject | null> {
  return usesBlobStorage() ? readBlobProject(id) : readFileProject(id);
}

async function listFileProjects(): Promise<StoredProject[]> {
  try {
    await ensureDataDir();
    const names = await readdir(DATA_DIR);
    const projects = await Promise.all(
      names
        .filter((name) => name.endsWith('.json'))
        .map((name) => readFileProject(name.slice(0, -'.json'.length)))
    );
    return projects.filter((project): project is StoredProject => !!project);
  } catch (error) {
    throw storageFailure(error);
  }
}

async function listBlobProjects(): Promise<StoredProject[]> {
  const { blobs } = await list({ prefix: BLOB_PREFIX, limit: 1000 });
  const projects = await Promise.all(
    blobs
      .filter((blob) => blob.pathname.endsWith('.json'))
      .map((blob) => {
        const id = blob.pathname.slice(BLOB_PREFIX.length, -'.json'.length);
        return ID_PATTERN.test(id) ? readBlobProject(id) : null;
      })
  );
  return projects.filter((project): project is StoredProject => !!project);
}

async function writeProject(id: string, project: StoredProject): Promise<void> {
  const body = JSON.stringify(project);

  if (usesBlobStorage()) {
    await put(blobPath(id), body, {
      access: 'private',
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: 'application/json',
      cacheControlMaxAge: 60,
    });
    return;
  }

  try {
    await ensureDataDir();
    await writeFile(fileFor(id), body, 'utf8');
  } catch (error) {
    throw storageFailure(error);
  }
}

export async function listProjects(): Promise<ProjectMeta[]> {
  assertStorageReady();
  const projects = usesBlobStorage()
    ? await listBlobProjects()
    : await listFileProjects();

  return projects
    .map(toMeta)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getProject(id: string): Promise<ProjectSnapshot | null> {
  assertValidId(id);
  assertStorageReady();

  const project = await readProject(id);
  if (!project) return null;
  return {
    id: project.id,
    name: project.name,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    fileCount: Object.keys(project.files).length,
    files: project.files,
  };
}

export async function saveProject(payload: SaveProjectPayload): Promise<ProjectMeta> {
  assertStorageReady();

  const name = validateName(payload?.name);
  const files = validateFiles(payload?.files);
  const now = new Date().toISOString();

  let id: string;
  let createdAt = now;

  if (payload.id) {
    assertValidId(payload.id);
    id = payload.id;
    const existing = await readProject(id);
    if (existing) createdAt = existing.createdAt;
  } else {
    id = randomUUID();
  }

  const stored: StoredProject = {
    version: 1,
    id,
    name,
    createdAt,
    updatedAt: now,
    fileCount: Object.keys(files).length,
    files,
  };

  await writeProject(id, stored);
  return toMeta(stored);
}

export async function deleteProject(id: string): Promise<boolean> {
  assertValidId(id);
  assertStorageReady();

  if (usesBlobStorage()) {
    if (!(await readBlobProject(id))) return false;
    await del(blobPath(id));
    return true;
  }

  try {
    await unlink(fileFor(id));
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return false;
    throw storageFailure(error);
  }
}
