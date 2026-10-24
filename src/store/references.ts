import { create } from 'zustand';
import {
  getBoundProjectId,
  opfsProjectStore,
  type ReferenceEntry,
} from '@/lib/opfs';
import { readReferenceArchive } from '@/lib/reference-archive';
import { runtime } from '@/lib/runtime';
import { useUiStore } from './ui';

export type ReferenceTreeNode = ReferenceEntry & {
  children?: ReferenceTreeNode[];
};

export type ReferencePreviewKind = 'image' | 'text' | 'pdf' | 'other';

export interface ReferencePreview {
  path: string;
  name: string;
  size: number;
  mime: string;
  kind: ReferencePreviewKind;
  url: string;
  text: string | null;
}

interface ReferenceState {
  projectId: string | null;
  entries: ReferenceEntry[];
  tree: ReferenceTreeNode[];
  expanded: Record<string, boolean>;
  selectedPath: string | null;
  preview: ReferencePreview | null;
  loading: boolean;
  uploading: boolean;
  loaded: boolean;
  error: string | null;

  load: (force?: boolean) => Promise<void>;
  uploadZip: (file: File) => Promise<void>;
  select: (path: string) => Promise<void>;
  toggleDir: (path: string) => void;
  closePreview: () => void;
  remove: (path: string) => Promise<void>;
  clearAll: () => Promise<void>;
}

let activePreviewUrl: string | null = null;
let previewSequence = 0;

function revokePreview(): void {
  if (!activePreviewUrl) return;
  URL.revokeObjectURL(activePreviewUrl);
  activePreviewUrl = null;
}

function buildTree(entries: ReferenceEntry[]): ReferenceTreeNode[] {
  const root: ReferenceTreeNode = {
    path: '/',
    name: '',
    kind: 'dir',
    size: 0,
    modified: 0,
    children: [],
  };
  const nodes = new Map<string, ReferenceTreeNode>([['/', root]]);

  const ensureDir = (path: string): ReferenceTreeNode => {
    const existing = nodes.get(path);
    if (existing) return existing;
    const segments = path.split('/').filter(Boolean);
    const name = segments[segments.length - 1] ?? path;
    const parentPath = `/${segments.slice(0, -1).join('/')}`;
    const parent = parentPath === '/' ? root : ensureDir(parentPath);
    const node: ReferenceTreeNode = {
      path,
      name,
      kind: 'dir',
      size: 0,
      modified: 0,
      children: [],
    };
    nodes.set(path, node);
    parent.children!.push(node);
    return node;
  };

  for (const entry of entries) {
    if (entry.kind === 'dir') {
      ensureDir(entry.path);
      continue;
    }
    const segments = entry.path.split('/').filter(Boolean);
    const parentPath = `/${segments.slice(0, -1).join('/')}`;
    const parent = parentPath === '/' ? root : ensureDir(parentPath);
    const node: ReferenceTreeNode = {
      ...entry,
      kind: 'file',
      children: undefined,
    };
    nodes.set(entry.path, node);
    parent.children!.push(node);
  }

  const sort = (nodesToSort: ReferenceTreeNode[]): void => {
    nodesToSort.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1;
      return a.name.localeCompare(b.name, undefined, { numeric: true });
    });
    for (const node of nodesToSort) {
      if (node.children) sort(node.children);
    }
  };
  sort(root.children!);

  return root.children!;
}

function extension(path: string): string {
  const name = path.split('/').pop() ?? path;
  const index = name.lastIndexOf('.');
  return index <= 0 ? '' : name.slice(index + 1).toLowerCase();
}

const IMAGE_EXTENSIONS = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'avif',
  'svg',
  'bmp',
  'ico',
]);

const TEXT_EXTENSIONS = new Set([
  'txt',
  'md',
  'markdown',
  'json',
  'jsonc',
  'csv',
  'tsv',
  'html',
  'htm',
  'css',
  'scss',
  'sass',
  'less',
  'js',
  'jsx',
  'mjs',
  'cjs',
  'ts',
  'tsx',
  'vue',
  'svelte',
  'astro',
  'xml',
  'yaml',
  'yml',
  'toml',
  'ini',
  'conf',
  'log',
  'glsl',
  'frag',
  'vert',
  'wgsl',
  'tsl',
  'py',
  'rb',
  'go',
  'rs',
  'java',
  'kt',
  'c',
  'h',
  'cpp',
  'hpp',
  'cs',
  'php',
  'sh',
  'bash',
  'zsh',
  'sql',
  'graphql',
  'gql',
  'env',
]);

function previewKind(path: string): ReferencePreviewKind {
  const ext = extension(path);
  if (IMAGE_EXTENSIONS.has(ext)) return 'image';
  if (TEXT_EXTENSIONS.has(ext)) return 'text';
  if (ext === 'pdf') return 'pdf';
  return 'other';
}

const MIME_BY_EXTENSION: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  pdf: 'application/pdf',
  json: 'application/json',
  csv: 'text/csv',
  html: 'text/html',
  htm: 'text/html',
  css: 'text/css',
  md: 'text/markdown',
  markdown: 'text/markdown',
  txt: 'text/plain',
};

function mimeFor(path: string, file: File): string {
  const ext = extension(path);
  return MIME_BY_EXTENSION[ext] || file.type || 'application/octet-stream';
}

async function buildPreview(
  id: string,
  path: string,
  entry: ReferenceEntry,
): Promise<ReferencePreview | null> {
  const file = await opfsProjectStore.readReferenceFile(id, path);
  if (!file) return null;

  const url = URL.createObjectURL(file);
  try {
    const kind = previewKind(path);
    const text =
      kind === 'text'
        ? await file.slice(0, 128 * 1024).text()
        : null;

    return {
      path,
      name: entry.name,
      size: file.size,
      mime: mimeFor(path, file),
      kind,
      url,
      text,
    };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

export const useReferenceStore = create<ReferenceState>((set, get) => ({
  projectId: null,
  entries: [],
  tree: [],
  expanded: {},
  selectedPath: null,
  preview: null,
  loading: false,
  uploading: false,
  loaded: false,
  error: null,

  load: async (force = false) => {
    const id = getBoundProjectId();
    if (!id) {
      revokePreview();
      set({
        projectId: null,
        entries: [],
        tree: [],
        selectedPath: null,
        preview: null,
        loaded: true,
        loading: false,
        error: 'OPFS reference storage is unavailable.',
      });
      return;
    }
    if (get().loading) return;
    if (!force && get().loaded && get().projectId === id) return;

    const changed = get().projectId !== id;
    set({ loading: true, error: null, projectId: id });

    try {
      const entries = await opfsProjectStore.readReferences(id);
      const tree = buildTree(entries);
      const expanded: Record<string, boolean> = changed
        ? {}
        : { ...get().expanded };
      for (const entry of entries) {
        if (entry.kind === 'dir' && expanded[entry.path] === undefined) {
          expanded[entry.path] = true;
        }
      }

      let selectedPath = changed ? null : get().selectedPath;
      let preview = changed ? null : get().preview;
      if (changed) {
        previewSequence += 1;
        revokePreview();
      }
      if (
        selectedPath &&
        !entries.some((entry) => entry.path === selectedPath)
      ) {
        selectedPath = null;
        preview = null;
        revokePreview();
      }

      set({
        entries,
        tree,
        expanded,
        selectedPath,
        preview,
        loaded: true,
        loading: false,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);
      set({ loading: false, loaded: true, error: message });
      runtime.log('error', `Could not read reference files: ${message}`);
    }
  },

  uploadZip: async (file) => {
    const id = getBoundProjectId();
    if (!id) {
      useUiStore
        .getState()
        .toast('Reference storage is unavailable in this browser', 'error');
      return;
    }
    if (get().uploading) return;

    set({ uploading: true, error: null });
    try {
      const files = await readReferenceArchive(file);
      const written = await opfsProjectStore.writeReferences(id, files);
      await get().load(true);
      const message = `Extracted ${written} ${
        written === 1 ? 'file' : 'files'
      } into /reference`;
      useUiStore.getState().toast(message);
      runtime.log('success', `${message} from ${file.name}`);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);
      set({ error: message });
      useUiStore.getState().toast(message, 'error');
      runtime.log('error', `Reference upload failed: ${message}`);
    } finally {
      set({ uploading: false });
    }
  },

  select: async (path) => {
    const entry = get().entries.find((item) => item.path === path);
    if (!entry) return;

    if (entry.kind === 'dir') {
      previewSequence += 1;
      revokePreview();
      set({ selectedPath: path, preview: null });
      return;
    }

    const id = get().projectId ?? getBoundProjectId();
    if (!id) return;

    const sequence = ++previewSequence;
    try {
      const preview = await buildPreview(id, path, entry);
      if (!preview) return;
      if (sequence !== previewSequence) {
        URL.revokeObjectURL(preview.url);
        return;
      }
      revokePreview();
      activePreviewUrl = preview.url;
      set({ selectedPath: path, preview });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);
      set({ error: message });
      useUiStore.getState().toast(`Could not open ${entry.name}`, 'error');
      runtime.log('error', message);
    }
  },

  toggleDir: (path) => {
    set((state) => {
      const current = state.expanded[path] ?? true;
      return {
        expanded: {
          ...state.expanded,
          [path]: !current,
        },
      };
    });
  },

  closePreview: () => {
    previewSequence += 1;
    revokePreview();
    set((state) => ({
      preview: null,
      selectedPath:
        state.selectedPath && state.entries.some(
          (entry) =>
            entry.path === state.selectedPath && entry.kind === 'dir',
        )
          ? state.selectedPath
          : null,
    }));
  },

  remove: async (path) => {
    const id = get().projectId ?? getBoundProjectId();
    if (!id) return;
    previewSequence += 1;
    await opfsProjectStore.deleteReference(id, path);
    const state = get();
    if (
      state.selectedPath === path ||
      state.selectedPath?.startsWith(`${path}/`)
    ) {
      revokePreview();
      set({ selectedPath: null, preview: null });
    }
    await get().load(true);
    useUiStore.getState().toast(`Removed ${path}`);
  },

  clearAll: async () => {
    const id = get().projectId ?? getBoundProjectId();
    if (!id) return;
    previewSequence += 1;
    await opfsProjectStore.clearReferences(id);
    revokePreview();
    set({ selectedPath: null, preview: null });
    await get().load(true);
    useUiStore.getState().toast('Reference folder cleared');
  },
}));
