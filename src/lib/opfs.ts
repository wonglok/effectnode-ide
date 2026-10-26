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
const VERSIONS_DIR = 'versions';
const VERSION_INDEX = 'index.json';
const UPLOADS_DIR = 'uploads';
/** Oldest snapshots beyond this are pruned when a new version is saved. */
const MAX_VERSIONS = 40;

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

/** One row in the project library. */
export interface ProjectCatalogEntry extends LocalProjectMeta {
  fileCount: number;
  versionCount: number;
  latestVersionAt: string | null;
}

/** Indexed metadata for one saved snapshot. */
export interface ProjectVersionMeta {
  id: string;
  label: string;
  createdAt: string;
  fileCount: number;
  bytes: number;
  hasAgentState: boolean;
}

export interface ProjectVersion extends ProjectVersionMeta {
  files: Record<string, string>;
  agentState: string | null;
}

interface VersionIndex {
  versions: ProjectVersionMeta[];
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

/** Mint a project identity without touching the "last local project" pointer. */
export function mintProject(name: string): LocalProjectMeta {
  const now = new Date().toISOString();
  return {
    id: `local-${randomSegment()}`,
    name: name.trim().slice(0, 120) || 'untitled',
    createdAt: now,
    updatedAt: now,
  };
}

/** Mint a new OPFS-backed project identity (unsaved projects included). */
export function createLocalProject(name: string): LocalProjectMeta {
  const meta = mintProject(name);
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
   * Binary public assets live beside the manifest rather than in the text
   * working tree: `.forge/uploads/public/<name>`. `replaceAll` preserves
   * `.forge`, so attachments survive project reloads and switches.
   */
  writeUpload(
    projectId: string,
    virtualPath: string,
    data: Uint8Array
  ): Promise<void> {
    return this.run(async () => {
      const segments = safeSegments(virtualPath);
      if (!segments) return;
      const project = await this.projectDir(projectId, true);
      if (!project) throw new Error('Project storage is unavailable');
      const metaDir = await project.getDirectoryHandle(META_DIR, { create: true });
      const uploadsDir = await metaDir.getDirectoryHandle(UPLOADS_DIR, { create: true });
      const name = segments.pop();
      if (!name) return;
      const parent = await ensureSubdir(uploadsDir, segments, true);
      const file = await parent.getFileHandle(name, { create: true });
      const writable = await file.createWritable();
      // Copy into an ArrayBuffer-backed view; OPFS write types reject
      // SharedArrayBuffer-backed views.
      const copy = new Uint8Array(data.byteLength);
      copy.set(data);
      await writable.write(copy);
      await writable.close();
    });
  }

  deleteUpload(projectId: string, virtualPath: string): Promise<void> {
    return this.run(async () => {
      const segments = safeSegments(virtualPath);
      if (!segments) return;
      const project = await this.projectDir(projectId, false);
      if (!project) return;
      const name = segments.pop();
      if (!name) return;
      try {
        const metaDir = await project.getDirectoryHandle(META_DIR, { create: false });
        const uploadsDir = await metaDir.getDirectoryHandle(UPLOADS_DIR, { create: false });
        const parent = await ensureSubdir(uploadsDir, segments, false);
        await parent.removeEntry(name);
      } catch {
        // Already gone.
      }
    });
  }

  /** Read every binary upload as a `path → bytes` map. */
  readUploads(projectId: string): Promise<Record<string, Uint8Array>> {
    return this.run(async () => {
      const uploads: Record<string, Uint8Array> = {};
      const project = await this.projectDir(projectId, false);
      if (!project) return uploads;
      try {
        const metaDir = await project.getDirectoryHandle(META_DIR, { create: false });
        const uploadsDir = await metaDir.getDirectoryHandle(UPLOADS_DIR, { create: false });
        await readBinaryTree(uploadsDir, '', uploads);
      } catch {
        // No uploads yet.
      }
      return uploads;
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

      let preservedState = agentState;
      let preservedManifest: ProjectManifest | null = null;
      try {
        const existing = await projects.getDirectoryHandle(projectId, { create: false });
        preservedManifest = await readManifestHandle(existing);
        if (preservedState === undefined) {
          preservedState = await readAgentStateHandle(existing);
        }
      } catch {
        // First write for this project.
      }

      const project = await projects.getDirectoryHandle(projectId, { create: true });

      // Clear the working tree but keep `.forge` (manifest + version history),
      // which lives beside the code inside the project folder.
      const stale: string[] = [];
      for await (const [name] of project) {
        if (name === META_DIR) continue;
        stale.push(name);
      }
      for (const name of stale) {
        try {
          await project.removeEntry(name, { recursive: true });
        } catch {
          // Already gone.
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

      const nextManifest = manifest ?? preservedManifest ?? undefined;
      if (nextManifest) await writeManifestHandle(project, nextManifest);
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
      return { files, manifest: await readManifestHandle(project) };
    });
  }

  writeManifest(projectId: string, manifest: ProjectManifest): void {
    this.enqueue(async () => {
      const project = await this.projectDir(projectId, true);
      if (!project) return;
      await writeManifestHandle(project, manifest);
    });
  }

  /** Every project stored in this browser, newest activity first. */
  listProjects(): Promise<ProjectCatalogEntry[]> {
    return this.run(async () => {
      const projects = await this.projectsDir(false);
      if (!projects) return [] as ProjectCatalogEntry[];

      const entries: ProjectCatalogEntry[] = [];
      for await (const [name, handle] of projects) {
        if (handle.kind !== 'directory' || !validId(name)) continue;
        try {
          const project = handle as FileSystemDirectoryHandle;
          const manifest = await readManifestHandle(project);
          const stats = await scanProjectStats(project);
          const versions = (await readVersionIndexHandle(project)).versions;
          entries.push({
            id: name,
            name: manifest?.name || 'untitled',
            createdAt: manifest?.createdAt || stats.createdAt,
            updatedAt: maxIso(manifest?.updatedAt, stats.updatedAt),
            fileCount: stats.fileCount,
            versionCount: versions.length,
            latestVersionAt: versions[0]?.createdAt ?? null,
          });
        } catch {
          // Skip folders that cannot be read.
        }
      }

      entries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      return entries;
    });
  }

  /** Rename a project without switching to it. */
  renameProject(projectId: string, name: string): Promise<boolean> {
    return this.run(async () => {
      const project = await this.projectDir(projectId, false);
      if (!project) return false;
      const existing = (await readManifestHandle(project)) ?? {};
      await writeManifestHandle(project, {
        ...existing,
        name: name.trim().slice(0, 120) || 'untitled',
        updatedAt: new Date().toISOString(),
      });
      return true;
    });
  }

  /** Copy the current code (not history) into a brand-new project folder. */
  async duplicateProject(sourceId: string, name: string): Promise<LocalProjectMeta | null> {
    const source = await this.read(sourceId);
    if (!source || Object.keys(source.files).length === 0) return null;
    const agentState = await this.readAgentState(sourceId);
    const uploads = await this.readUploads(sourceId);
    const now = new Date().toISOString();
    const meta = mintProject(name);
    await this.replaceAll(
      meta.id,
      source.files,
      { name: meta.name, createdAt: now, updatedAt: now },
      agentState
    );
    for (const [virtualPath, data] of Object.entries(uploads)) {
      await this.writeUpload(meta.id, virtualPath, data);
    }
    return { ...meta, createdAt: now, updatedAt: now };
  }

  /* ── Version history ─────────────────────────────────────── */

  listVersions(projectId: string): Promise<ProjectVersionMeta[]> {
    return this.run(async () => {
      const project = await this.projectDir(projectId, false);
      if (!project) return [];
      return (await readVersionIndexHandle(project)).versions;
    });
  }

  /** Snapshot every text file in a project plus its agent transcript. */
  createVersion(
    projectId: string,
    label: string,
    files: Record<string, string>,
    agentState: string | null
  ): Promise<ProjectVersionMeta> {
    return this.run(async () => {
      const project = await this.projectDir(projectId, true);
      if (!project) throw new Error('Project storage is unavailable');

      const versionsDir = await projectVersionsDir(project, true);
      // Make sure the index has been read before writing a new snapshot.
      const index = await readVersionIndexHandle(project);
      const versionId = makeVersionId();
      const versionDir = await versionsDir.getDirectoryHandle(versionId, { create: true });

      let bytes = 0;
      let fileCount = 0;
      for (const [virtualPath, content] of Object.entries(files)) {
        const segments = safeSegments(virtualPath);
        if (!segments) continue;
        const name = segments.pop();
        if (!name) continue;
        const parent = await ensureSubdir(versionDir, segments, true);
        const file = await parent.getFileHandle(name, { create: true });
        const writable = await file.createWritable();
        await writable.write(content);
        await writable.close();
        bytes += new TextEncoder().encode(content).length;
        fileCount += 1;
      }

      if (agentState) {
        const file = await versionDir.getFileHandle(AGENT_STATE_FILENAME, { create: true });
        const writable = await file.createWritable();
        await writable.write(agentState);
        await writable.close();
      }

      const meta: ProjectVersionMeta = {
        id: versionId,
        label: label.trim().slice(0, 120) || defaultVersionLabel(),
        createdAt: new Date().toISOString(),
        fileCount,
        bytes,
        hasAgentState: Boolean(agentState),
      };

      const versions = [meta, ...index.versions].sort((a, b) =>
        b.createdAt.localeCompare(a.createdAt)
      );
      for (const stale of versions.slice(MAX_VERSIONS)) {
        try {
          await versionsDir.removeEntry(stale.id, { recursive: true });
        } catch {
          // Already gone.
        }
      }
      await writeVersionIndexHandle(project, { versions: versions.slice(0, MAX_VERSIONS) });

      const manifest = (await readManifestHandle(project)) ?? {};
      await writeManifestHandle(project, { ...manifest, updatedAt: meta.createdAt });
      return meta;
    });
  }

  readVersion(projectId: string, versionId: string): Promise<ProjectVersion | null> {
    return this.run(async () => {
      if (!validId(versionId)) return null;
      const project = await this.projectDir(projectId, false);
      if (!project) return null;
      const index = await readVersionIndexHandle(project);
      const meta = index.versions.find((entry) => entry.id === versionId);
      if (!meta) return null;

      let versionDir: FileSystemDirectoryHandle;
      try {
        const versionsDir = await projectVersionsDir(project, false);
        versionDir = await versionsDir.getDirectoryHandle(versionId, { create: false });
      } catch {
        return null;
      }

      const files: Record<string, string> = {};
      await readTree(versionDir, '', files);
      const agentState = await readAgentStateHandle(versionDir);
      return { ...meta, files, agentState };
    });
  }

  deleteVersion(projectId: string, versionId: string): Promise<void> {
    return this.run(async () => {
      if (!validId(versionId)) return;
      const project = await this.projectDir(projectId, false);
      if (!project) return;
      try {
        const versionsDir = await projectVersionsDir(project, false);
        await versionsDir.removeEntry(versionId, { recursive: true });
      } catch {
        // Already gone.
      }
      const index = await readVersionIndexHandle(project);
      await writeVersionIndexHandle(project, {
        versions: index.versions.filter((entry) => entry.id !== versionId),
      });
    });
  }

  /** Move a local project to the server-assigned id after the first save. */
  async moveProject(fromId: string, toId: string): Promise<void> {
    if (fromId === toId || !validId(toId)) return;
    const source = await this.read(fromId);
    if (!source) return;
    const agentState = await this.readAgentState(fromId);
    const uploads = await this.readUploads(fromId);
    await this.replaceAll(
      toId,
      source.files,
      source.manifest ?? { name: 'saved project' },
      agentState
    );
    for (const [virtualPath, data] of Object.entries(uploads)) {
      await this.writeUpload(toId, virtualPath, data);
    }
    await this.deleteProject(fromId);
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

function makeVersionId(): string {
  return `v-${Date.now().toString(36)}-${randomSegment().slice(0, 6)}`;
}

function defaultVersionLabel(): string {
  return new Date().toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function maxIso(manifestIso: string | undefined, fileIso: string): string {
  if (!manifestIso) return fileIso;
  const manifestTime = Date.parse(manifestIso);
  const fileTime = Date.parse(fileIso);
  if (!Number.isFinite(manifestTime)) return fileIso;
  if (!Number.isFinite(fileTime)) return manifestIso;
  return manifestTime >= fileTime ? manifestIso : fileIso;
}

function isValidVersionMeta(value: unknown): value is ProjectVersionMeta {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Partial<ProjectVersionMeta>;
  return (
    typeof entry.id === 'string' &&
    validId(entry.id) &&
    typeof entry.label === 'string' &&
    typeof entry.createdAt === 'string' &&
    typeof entry.fileCount === 'number' &&
    typeof entry.bytes === 'number' &&
    typeof entry.hasAgentState === 'boolean'
  );
}

async function readManifestHandle(
  project: FileSystemDirectoryHandle
): Promise<ProjectManifest | null> {
  try {
    const metaDir = await project.getDirectoryHandle(META_DIR, { create: false });
    const metaFile = await metaDir.getFileHandle(META_FILE, { create: false });
    return readJson<ProjectManifest>(await (await metaFile.getFile()).text());
  } catch {
    return null;
  }
}

async function projectVersionsDir(
  project: FileSystemDirectoryHandle,
  create: boolean
): Promise<FileSystemDirectoryHandle> {
  const metaDir = await project.getDirectoryHandle(META_DIR, { create });
  return metaDir.getDirectoryHandle(VERSIONS_DIR, { create });
}

async function readVersionIndexHandle(
  project: FileSystemDirectoryHandle
): Promise<VersionIndex> {
  try {
    const versionsDir = await projectVersionsDir(project, false);
    const indexFile = await versionsDir.getFileHandle(VERSION_INDEX, { create: false });
    const parsed = readJson<VersionIndex>(await (await indexFile.getFile()).text());
    if (!parsed || !Array.isArray(parsed.versions)) return { versions: [] };
    return {
      versions: parsed.versions
        .filter(isValidVersionMeta)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    };
  } catch {
    return { versions: [] };
  }
}

async function writeVersionIndexHandle(
  project: FileSystemDirectoryHandle,
  index: VersionIndex
): Promise<void> {
  const versionsDir = await projectVersionsDir(project, true);
  const indexFile = await versionsDir.getFileHandle(VERSION_INDEX, { create: true });
  const writable = await indexFile.createWritable();
  await writable.write(JSON.stringify(index, null, 2));
  await writable.close();
}

interface ProjectStats {
  fileCount: number;
  createdAt: string;
  updatedAt: string;
}

/** Count files and derive timestamps without reading file contents. */
async function scanProjectStats(
  project: FileSystemDirectoryHandle
): Promise<ProjectStats> {
  let fileCount = 0;
  let newest = 0;
  let oldest = Number.POSITIVE_INFINITY;

  const visit = async (directory: FileSystemDirectoryHandle, root: boolean) => {
    for await (const [name, handle] of directory) {
      if (root && (name === META_DIR || name === AGENT_STATE_FILENAME)) continue;
      if (handle.kind === 'file') {
        try {
          const file = await (handle as FileSystemFileHandle).getFile();
          fileCount += 1;
          if (file.lastModified > newest) newest = file.lastModified;
          if (file.lastModified < oldest) oldest = file.lastModified;
        } catch {
          // Unreadable file metadata.
        }
      } else {
        await visit(handle as FileSystemDirectoryHandle, false);
      }
    }
  };

  await visit(project, true);
  const fallback = new Date().toISOString();
  return {
    fileCount,
    createdAt:
      Number.isFinite(oldest) && oldest > 0 ? new Date(oldest).toISOString() : fallback,
    updatedAt: newest > 0 ? new Date(newest).toISOString() : fallback,
  };
}

async function writeManifestHandle(
  project: FileSystemDirectoryHandle,
  manifest: ProjectManifest
): Promise<void> {
  const metaDir = await project.getDirectoryHandle(META_DIR, { create: true });
  const metaFile = await metaDir.getFileHandle(META_FILE, { create: true });
  // Merge so a name-only update never drops createdAt/updatedAt.
  const existing = await readManifestHandle(project);
  const writable = await metaFile.createWritable();
  await writable.write(JSON.stringify({ ...existing, ...manifest }, null, 2));
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

async function readBinaryTree(
  directory: FileSystemDirectoryHandle,
  prefix: string,
  files: Record<string, Uint8Array>
): Promise<void> {
  for await (const [name, handle] of directory) {
    const virtualPath = `${prefix}/${name}`;
    if (handle.kind === 'file') {
      try {
        const file = handle as FileSystemFileHandle;
        files[virtualPath] = new Uint8Array(await (await file.getFile()).arrayBuffer());
      } catch {
        // Skip unreadable entries.
      }
    } else {
      const child = await directory.getDirectoryHandle(name, { create: false });
      await readBinaryTree(child, virtualPath, files);
    }
  }
}

async function readTree(
  directory: FileSystemDirectoryHandle,
  prefix: string,
  files: Record<string, string>
): Promise<void> {
  for await (const [name, handle] of directory) {
    if (!prefix && (name === META_DIR || name === AGENT_STATE_FILENAME)) continue;
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
