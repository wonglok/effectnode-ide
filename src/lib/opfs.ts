import { AGENT_STATE_FILENAME } from '../../shared/agent-state';
import type { FileSink } from './runtime';

/**
 * Origin Private File System storage for sandbox project code.
 *
 * Layout (inside the browser's OPFS root):
 *
 *   sandbox/<ide-sandbox-id>/projects/<project-id>/<project files…>
 *   sandbox/<ide-sandbox-id>/projects/<project-id>/agent-state.json
 *   sandbox/<ide-sandbox-id>/projects/<project-id>/.forge/project.json
 *
 * The almostnode VirtualFS stays the live working tree; every mutation is
 * mirrored here, and boot hydrates from here before falling back to the starter
 * template.
 */

const SANDBOX_ID_KEY = 'forge.sandboxId';
const LOCAL_PROJECT_KEY = 'forge.localProject';
const META_DIR = '.forge';
const META_FILE = 'project.json';

/**
 * Reserved folder for uploaded reference material. It lives inside the same
 * OPFS project folder as the code but never enters the almostnode VFS, so
 * binary files stay byte-for-byte intact and are excluded from exports.
 */
export const REFERENCE_DIR = 'reference';

export interface ReferenceEntry {
  /** Path relative to the reference root, always starting with `/`. */
  path: string;
  name: string;
  kind: 'file' | 'dir';
  size: number;
  modified: number;
}

export interface ReferenceFile {
  /** Path relative to the reference root, without a leading slash. */
  path: string;
  data: Uint8Array;
}

export interface LocalProjectMeta {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectManifest {
  name?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface OpfsProject {
  files: Record<string, string>;
  manifest: ProjectManifest | null;
}

function randomSegment(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID().replace(/-/g, '').slice(0, 12);
  }
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function validId(value: string | null | undefined): value is string {
  return Boolean(value && /^[a-zA-Z0-9_-]{4,64}$/.test(value));
}

function readJson<T>(value: string | null): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

/** Stable id for this browser's IDE sandbox; one OPFS folder per browser profile. */
export function getSandboxId(): string {
  try {
    const existing = localStorage.getItem(SANDBOX_ID_KEY);
    if (validId(existing)) return existing;
    const created = `ide-${randomSegment()}`;
    localStorage.setItem(SANDBOX_ID_KEY, created);
    return created;
  } catch {
    return `ide-${randomSegment()}`;
  }
}

export function readLocalProject(): LocalProjectMeta | null {
  try {
    const parsed = readJson<LocalProjectMeta>(localStorage.getItem(LOCAL_PROJECT_KEY));
    if (!parsed || !validId(parsed.id) || typeof parsed.name !== 'string') return null;
    const now = new Date(0).toISOString();
    return {
      id: parsed.id,
      name: parsed.name || 'untitled',
      createdAt: typeof parsed.createdAt === 'string' ? parsed.createdAt : now,
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : now,
    };
  } catch {
    return null;
  }
}

export function writeLocalProject(meta: LocalProjectMeta): void {
  try {
    localStorage.setItem(LOCAL_PROJECT_KEY, JSON.stringify(meta));
  } catch {
    // Storage unavailable; the in-memory session still works.
  }
}

export function clearLocalProject(): void {
  try {
    localStorage.removeItem(LOCAL_PROJECT_KEY);
  } catch {
    // Nothing to clear.
  }
}

/** Mint a new OPFS-backed project identity (unsaved projects included). */
export function createLocalProject(name: string): LocalProjectMeta {
  const now = new Date().toISOString();
  const meta: LocalProjectMeta = {
    id: `local-${randomSegment()}`,
    name: name.trim() || 'untitled',
    createdAt: now,
    updatedAt: now,
  };
  writeLocalProject(meta);
  return meta;
}

/** Reuse the remembered local project, or mint one when there is none. */
export function ensureLocalProject(name: string): LocalProjectMeta {
  return readLocalProject() ?? createLocalProject(name);
}

/** Split `/src/App.tsx` into safe OPFS segments. */
function safeSegments(virtualPath: string): string[] | null {
  if (typeof virtualPath !== 'string' || !virtualPath.startsWith('/')) return null;
  const segments = virtualPath.split('/').filter(Boolean);
  if (segments.length === 0) return null;
  if (
    segments.some(
      (segment) => segment === '.' || segment === '..' || segment.includes('\0')
    )
  ) {
    return null;
  }
  return segments;
}

async function ensureSubdir(
  base: FileSystemDirectoryHandle,
  segments: string[],
  create: boolean
): Promise<FileSystemDirectoryHandle> {
  let current = base;
  for (const segment of segments) {
    current = await current.getDirectoryHandle(segment, { create });
  }
  return current;
}

class OpfsProjectStore {
  private readonly sandboxId = getSandboxId();
  private rootPromise: Promise<FileSystemDirectoryHandle | null> | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  get available(): boolean {
    return (
      typeof navigator !== 'undefined' &&
      typeof navigator.storage?.getDirectory === 'function'
    );
  }

  private root(): Promise<FileSystemDirectoryHandle | null> {
    this.rootPromise ??= (async () => {
      if (!this.available) return null;
      try {
        return await navigator.storage.getDirectory();
      } catch {
        return null;
      }
    })();
    return this.rootPromise;
  }

  private async projectsDir(create: boolean): Promise<FileSystemDirectoryHandle | null> {
    const root = await this.root();
    if (!root) return null;
    try {
      const sandbox = await root.getDirectoryHandle('sandbox', { create });
      const ide = await sandbox.getDirectoryHandle(this.sandboxId, { create });
      return await ide.getDirectoryHandle('projects', { create });
    } catch {
      return null;
    }
  }

  private async projectDir(
    projectId: string,
    create: boolean
  ): Promise<FileSystemDirectoryHandle | null> {
    if (!validId(projectId)) return null;
    const projects = await this.projectsDir(create);
    if (!projects) return null;
    try {
      return await projects.getDirectoryHandle(projectId, { create });
    } catch {
      return null;
    }
  }

  private run<T>(work: () => Promise<T>): Promise<T> {
    const result = this.queue.then(work);
    this.queue = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }

  private enqueue(work: () => Promise<void>): void {
    void this.run(work).catch((error) => {
      console.warn('[opfs] project storage write failed', error);
    });
  }

  writeFile(projectId: string, virtualPath: string, content: string): void {
    const segments = safeSegments(virtualPath);
    if (!segments) return;
    this.enqueue(async () => {
      const project = await this.projectDir(projectId, true);
      if (!project) return;
      const name = segments.pop();
      if (!name) return;
      const parent = await ensureSubdir(project, segments, true);
      const file = await parent.getFileHandle(name, { create: true });
      const writable = await file.createWritable();
      await writable.write(content);
      await writable.close();
    });
  }

  mkdir(projectId: string, virtualPath: string): void {
    const segments = safeSegments(virtualPath);
    if (!segments) return;
    this.enqueue(async () => {
      const project = await this.projectDir(projectId, true);
      if (!project) return;
      await ensureSubdir(project, segments, true);
    });
  }

  deleteEntry(projectId: string, virtualPath: string): void {
    const segments = safeSegments(virtualPath);
    if (!segments) return;
    this.enqueue(async () => {
      const project = await this.projectDir(projectId, false);
      if (!project) return;
      const name = segments.pop();
      if (!name) return;
      let parent: FileSystemDirectoryHandle;
      try {
        parent = await ensureSubdir(project, segments, false);
      } catch {
        return;
      }
      try {
        await parent.removeEntry(name, { recursive: true });
      } catch {
        // Already gone.
      }
    });
  }

  renameEntry(projectId: string, from: string, to: string): void {
    const fromSegments = safeSegments(from);
    const toSegments = safeSegments(to);
    if (!fromSegments || !toSegments) return;
    this.enqueue(async () => {
      const project = await this.projectDir(projectId, true);
      if (!project) return;
      const fromName = fromSegments.pop();
      const toName = toSegments.pop();
      if (!fromName || !toName) return;

      let fromParent: FileSystemDirectoryHandle;
      try {
        fromParent = await ensureSubdir(project, fromSegments, false);
      } catch {
        return;
      }
      const toParent = await ensureSubdir(project, toSegments, true);

      await copyEntry(fromParent, fromName, toParent, toName);
      try {
        await fromParent.removeEntry(fromName, { recursive: true });
      } catch {
        // Already gone.
      }
    });
  }

  /** Read the agent transcript stored beside the project code. */
  readAgentState(projectId: string): Promise<string | null> {
    return this.run(async () => {
      const project = await this.projectDir(projectId, false);
      if (!project) return null;
      return readAgentStateHandle(project);
    });
  }

  /** Persist the agent transcript beside the project code. */
  writeAgentState(projectId: string, raw: string): void {
    this.enqueue(async () => {
      const project = await this.projectDir(projectId, true);
      if (!project) return;
      await writeAgentStateHandle(project, raw);
    });
  }

  /**
   * Rewrite a whole project folder from a snapshot (used on open/new/undo).
   *
   * `agentState` is undefined to preserve the existing transcript, null to drop
   * it, or a raw JSON string to replace it.
   */
  replaceAll(
    projectId: string,
    files: Record<string, string>,
    manifest?: ProjectManifest,
    agentState?: string | null
  ): Promise<void> {
    return this.run(async () => {
      const projects = await this.projectsDir(true);
      if (!projects || !validId(projectId)) return;

      let project: FileSystemDirectoryHandle;
      try {
        project = await projects.getDirectoryHandle(projectId, { create: false });
      } catch {
        project = await projects.getDirectoryHandle(projectId, { create: true });
      }

      let preservedState = agentState;
      if (preservedState === undefined) {
        preservedState = await readAgentStateHandle(project);
      }

      // Clear only the project code. Reserved entries survive so reference
      // uploads and the transcript are not lost when the project is replaced.
      const keep = new Set([REFERENCE_DIR, META_DIR, AGENT_STATE_FILENAME]);
      const entries: string[] = [];
      for await (const [name] of project) entries.push(name);
      for (const name of entries) {
        if (keep.has(name)) continue;
        try {
          await project.removeEntry(name, { recursive: true });
        } catch {
          // Already gone.
        }
      }
      if (preservedState === null) {
        try {
          await project.removeEntry(AGENT_STATE_FILENAME);
        } catch {
          // There was no transcript.
        }
      }

      for (const [virtualPath, content] of Object.entries(files)) {
        const segments = safeSegments(virtualPath);
        if (!segments) continue;
        const name = segments.pop();
        if (!name) continue;
        const parent = await ensureSubdir(project, segments, true);
        const file = await parent.getFileHandle(name, { create: true });
        const writable = await file.createWritable();
        await writable.write(content);
        await writable.close();
      }

      if (manifest) await writeManifestHandle(project, manifest);
      if (preservedState) await writeAgentStateHandle(project, preservedState);
    });
  }

  /** Read every text file plus the optional manifest for one project. */
  read(projectId: string): Promise<OpfsProject | null> {
    return this.run(async () => {
      const project = await this.projectDir(projectId, false);
      if (!project) return null;
      const files: Record<string, string> = {};
      await readTree(project, '', files);
      let manifest: ProjectManifest | null = null;
      try {
        const metaDir = await project.getDirectoryHandle(META_DIR, { create: false });
        const metaFile = await metaDir.getFileHandle(META_FILE, { create: false });
        const raw = await (await metaFile.getFile()).text();
        manifest = readJson<ProjectManifest>(raw);
      } catch {
        // No manifest yet.
      }
      return { files, manifest };
    });
  }

  writeManifest(projectId: string, manifest: ProjectManifest): void {
    this.enqueue(async () => {
      const project = await this.projectDir(projectId, true);
      if (!project) return;
      await writeManifestHandle(project, manifest);
    });
  }

  /** Move a local project to the server-assigned id after the first save. */
  async moveProject(fromId: string, toId: string): Promise<void> {
    if (fromId === toId || !validId(toId)) return;
    const source = await this.read(fromId);
    if (!source) return;
    const agentState = await this.readAgentState(fromId);
    await this.replaceAll(
      toId,
      source.files,
      source.manifest ?? { name: 'saved project' },
      agentState
    );

    // Carry the OPFS reference folder across the id change.
    const sourceRoot = await this.referenceDir(fromId, false);
    if (sourceRoot) {
      const references: ReferenceFile[] = [];
      const collect = async (
        directory: FileSystemDirectoryHandle,
        prefix: string
      ): Promise<void> => {
        for await (const [name, handle] of directory) {
          const path = `${prefix}/${name}`;
          if (handle.kind === 'file') {
            try {
              const file = await (handle as FileSystemFileHandle).getFile();
              references.push({
                path,
                data: new Uint8Array(await file.arrayBuffer()),
              });
            } catch {
              // Skip unreadable files.
            }
          } else {
            await collect(handle as FileSystemDirectoryHandle, path);
          }
        }
      };
      await collect(sourceRoot, '');
      if (references.length > 0) {
        await this.writeReferences(toId, references);
      }
    }

    await this.deleteProject(fromId);
  }

  /* ── Reference folder ─────────────────────────────────────
   * Lives at `projects/<projectId>/reference/**` and is deliberately outside
   * the VFS: uploads can be images, PDFs, models, or any other binary.
   */

  private async referenceDir(
    projectId: string,
    create: boolean
  ): Promise<FileSystemDirectoryHandle | null> {
    const project = await this.projectDir(projectId, create);
    if (!project) return null;
    try {
      return await project.getDirectoryHandle(REFERENCE_DIR, { create });
    } catch {
      return null;
    }
  }

  /** Flat list of the reference folder; the UI builds a tree from it. */
  readReferences(projectId: string): Promise<ReferenceEntry[]> {
    return this.run(async () => {
      const root = await this.referenceDir(projectId, false);
      if (!root) return [];
      const entries: ReferenceEntry[] = [];

      const walk = async (
        directory: FileSystemDirectoryHandle,
        prefix: string
      ): Promise<void> => {
        for await (const [name, handle] of directory) {
          const path = `${prefix}/${name}`;
          if (handle.kind === 'file') {
            try {
              const file = await (handle as FileSystemFileHandle).getFile();
              entries.push({
                path,
                name,
                kind: 'file',
                size: file.size,
                modified: file.lastModified,
              });
            } catch {
              // Skip unreadable entries.
            }
          } else {
            entries.push({
              path,
              name,
              kind: 'dir',
              size: 0,
              modified: 0,
            });
            await walk(handle as FileSystemDirectoryHandle, path);
          }
        }
      };

      await walk(root, '');
      entries.sort((a, b) => a.path.localeCompare(b.path));
      return entries;
    });
  }

  /** Extract writes into the reference folder without touching the VFS. */
  writeReferences(projectId: string, files: ReferenceFile[]): Promise<number> {
    return this.run(async () => {
      const root = await this.referenceDir(projectId, true);
      if (!root) throw new Error('OPFS reference storage is unavailable');

      let written = 0;
      for (const file of files) {
        const segments = safeSegments(`/${file.path}`);
        if (!segments) continue;
        const name = segments.pop();
        if (!name) continue;
        const parent = await ensureSubdir(root, segments, true);
        const handle = await parent.getFileHandle(name, { create: true });
        const writable = await handle.createWritable();
        // Copy into a plain ArrayBuffer so the write stream sees no
        // SharedArrayBuffer widening from the unzip output.
        const buffer = file.data.buffer.slice(
          file.data.byteOffset,
          file.data.byteOffset + file.data.byteLength,
        ) as ArrayBuffer;
        await writable.write(buffer);
        await writable.close();
        written += 1;
      }
      return written;
    });
  }

  readReferenceFile(projectId: string, path: string): Promise<File | null> {
    return this.run(async () => {
      const root = await this.referenceDir(projectId, false);
      if (!root) return null;
      const segments = safeSegments(path);
      if (!segments) return null;
      const name = segments.pop();
      if (!name) return null;
      try {
        const parent = await ensureSubdir(root, segments, false);
        const handle = await parent.getFileHandle(name, { create: false });
        return await handle.getFile();
      } catch {
        return null;
      }
    });
  }

  deleteReference(projectId: string, path: string): Promise<void> {
    return this.run(async () => {
      const root = await this.referenceDir(projectId, false);
      if (!root) return;
      const segments = safeSegments(path);
      if (!segments) return;
      const name = segments.pop();
      if (!name) return;
      try {
        const parent = await ensureSubdir(root, segments, false);
        await parent.removeEntry(name, { recursive: true });
      } catch {
        // Already gone.
      }
    });
  }

  clearReferences(projectId: string): Promise<void> {
    return this.run(async () => {
      const project = await this.projectDir(projectId, false);
      if (!project) return;
      try {
        await project.removeEntry(REFERENCE_DIR, { recursive: true });
      } catch {
        // Nothing to clear.
      }
    });
  }

  deleteProject(projectId: string): Promise<void> {
    return this.run(async () => {
      const projects = await this.projectsDir(false);
      if (!projects || !validId(projectId)) return;
      try {
        await projects.removeEntry(projectId, { recursive: true });
      } catch {
        // Already gone.
      }
    });
  }
}

async function writeManifestHandle(
  project: FileSystemDirectoryHandle,
  manifest: ProjectManifest
): Promise<void> {
  const metaDir = await project.getDirectoryHandle(META_DIR, { create: true });
  const metaFile = await metaDir.getFileHandle(META_FILE, { create: true });
  const writable = await metaFile.createWritable();
  await writable.write(JSON.stringify(manifest, null, 2));
  await writable.close();
}

async function readAgentStateHandle(
  project: FileSystemDirectoryHandle
): Promise<string | null> {
  try {
    const file = await project.getFileHandle(AGENT_STATE_FILENAME, { create: false });
    return await (await file.getFile()).text();
  } catch {
    return null;
  }
}

async function writeAgentStateHandle(
  project: FileSystemDirectoryHandle,
  raw: string
): Promise<void> {
  const file = await project.getFileHandle(AGENT_STATE_FILENAME, { create: true });
  const writable = await file.createWritable();
  await writable.write(raw);
  await writable.close();
}

async function copyEntry(
  sourceParent: FileSystemDirectoryHandle,
  sourceName: string,
  targetParent: FileSystemDirectoryHandle,
  targetName: string
): Promise<void> {
  try {
    const file = await sourceParent.getFileHandle(sourceName, { create: false });
    const content = await (await file.getFile()).text();
    const target = await targetParent.getFileHandle(targetName, { create: true });
    const writable = await target.createWritable();
    await writable.write(content);
    await writable.close();
    return;
  } catch {
    // Not a file; try a directory below.
  }

  try {
    const directory = await sourceParent.getDirectoryHandle(sourceName, { create: false });
    const target = await targetParent.getDirectoryHandle(targetName, { create: true });
    for await (const [name, handle] of directory) {
      if (handle.kind === 'file') {
        const file = handle as FileSystemFileHandle;
        const content = await (await file.getFile()).text();
        const targetFile = await target.getFileHandle(name, { create: true });
        const writable = await targetFile.createWritable();
        await writable.write(content);
        await writable.close();
      } else {
        await copyEntry(
          directory,
          name,
          target,
          name
        );
      }
    }
  } catch {
    // Source vanished mid-copy.
  }
}

async function readTree(
  directory: FileSystemDirectoryHandle,
  prefix: string,
  files: Record<string, string>
): Promise<void> {
  for await (const [name, handle] of directory) {
    if (
      !prefix &&
      (name === META_DIR ||
        name === AGENT_STATE_FILENAME ||
        name === REFERENCE_DIR)
    ) {
      continue;
    }
    const virtualPath = `${prefix}/${name}`;
    if (handle.kind === 'file') {
      try {
        const file = handle as FileSystemFileHandle;
        files[virtualPath] = await (await file.getFile()).text();
      } catch {
        // Skip unreadable entries.
      }
    } else {
      const child = await directory.getDirectoryHandle(name, { create: false });
      await readTree(child, virtualPath, files);
    }
  }
}

export const opfsProjectStore = new OpfsProjectStore();

/** Ask the browser not to evict this origin's storage under pressure. */
export async function requestPersistentStorage(): Promise<void> {
  try {
    await navigator.storage?.persist?.();
  } catch {
    // Best effort.
  }
}

/* ── Runtime sink ─────────────────────────────────────────── */

let bound: { projectId: string; name: string } | null = null;

/** Point the runtime sink at the active OPFS project. */
export function bindOpfsProject(projectId: string | null, name = ''): void {
  bound = validId(projectId) ? { projectId, name } : null;
  if (bound) {
    opfsProjectStore.writeManifest(bound.projectId, { name: bound.name });
  }
}

export function getBoundProjectId(): string | null {
  return bound?.projectId ?? null;
}

export function updateOpfsProjectName(name: string): void {
  if (!bound) return;
  bound = { ...bound, name };
  opfsProjectStore.writeManifest(bound.projectId, { name });
}

export const opfsFileSink: FileSink = {
  write(path, content) {
    if (bound) opfsProjectStore.writeFile(bound.projectId, path, content);
  },
  mkdir(path) {
    if (bound) opfsProjectStore.mkdir(bound.projectId, path);
  },
  delete(path) {
    if (bound) opfsProjectStore.deleteEntry(bound.projectId, path);
  },
  rename(from, to) {
    if (bound) opfsProjectStore.renameEntry(bound.projectId, from, to);
  },
  replaceAll(files) {
    if (bound) {
      void opfsProjectStore.replaceAll(bound.projectId, files, {
        name: bound.name,
      });
    }
  },
};
