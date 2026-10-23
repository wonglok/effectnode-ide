import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { ProjectMeta, ProjectSnapshot, SaveProjectPayload } from '../../shared/types';

const DATA_DIR = resolve(process.env.FORGE_DATA_DIR || 'data/projects');
const ID_PATTERN = /^[a-zA-Z0-9_-]{6,64}$/;
const MAX_FILES = 500;
const MAX_TOTAL_BYTES = 2 * 1024 * 1024;
const MAX_NAME_LENGTH = 80;

interface StoredProject extends ProjectSnapshot {
  version: 1;
}

export class ProjectValidationError extends Error {}

async function ensureDataDir(): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
}

function fileFor(id: string): string {
  return join(DATA_DIR, `${id}.json`);
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

async function readProject(id: string): Promise<StoredProject | null> {
  try {
    const raw = await readFile(fileFor(id), 'utf8');
    const parsed = JSON.parse(raw) as StoredProject;
    if (!parsed || typeof parsed !== 'object' || !parsed.files) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function listProjects(): Promise<ProjectMeta[]> {
  await ensureDataDir();
  const names = await readdir(DATA_DIR);
  const projects = await Promise.all(
    names
      .filter((name) => name.endsWith('.json'))
      .map((name) => readProject(name.slice(0, -'.json'.length)))
  );
  return projects
    .filter((project): project is StoredProject => !!project)
    .map(toMeta)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getProject(id: string): Promise<ProjectSnapshot | null> {
  assertValidId(id);
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
  await ensureDataDir();

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

  await writeFile(fileFor(id), JSON.stringify(stored), 'utf8');
  return toMeta(stored);
}

export async function deleteProject(id: string): Promise<boolean> {
  assertValidId(id);
  try {
    await unlink(fileFor(id));
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return false;
    throw error;
  }
}
