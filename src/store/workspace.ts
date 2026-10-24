import { create } from 'zustand';
import { allDirectories, buildFileTree, type TreeNode } from '@/lib/file-tree';
import { dirname, normalizePath } from '@/lib/paths';
import { runtime } from '@/lib/runtime';
import { STARTER_ENTRY } from '@/lib/starter-project';
import { useUiStore } from './ui';

const WRITE_DELAY = 180;
const writeTimers = new Map<string, number>();

function cancelWrite(path: string) {
  const timer = writeTimers.get(path);
  if (timer !== undefined) {
    window.clearTimeout(timer);
    writeTimers.delete(path);
  }
}

function cancelWritesUnder(path: string) {
  for (const key of [...writeTimers.keys()]) {
    if (key === path || key.startsWith(path + '/')) cancelWrite(key);
  }
}

function remapPath(path: string, from: string, to: string): string {
  if (path === from) return to;
  if (path.startsWith(from + '/')) return to + path.slice(from.length);
  return path;
}

function ancestors(path: string): string[] {
  const result: string[] = [];
  let current = dirname(path);
  while (current !== '/') {
    result.push(current);
    current = dirname(current);
  }
  return result;
}

interface Cursor {
  line: number;
  column: number;
}

interface WorkspaceState {
  tree: TreeNode[];
  openFiles: string[];
  activeFile: string | null;
  buffers: Record<string, string>;
  expanded: Record<string, boolean>;
  selectedPath: string | null;
  search: string;
  cursor: Cursor;
  lastWriteAt: number;
  ready: boolean;

  refresh: () => void;
  loadFiles: (files: Record<string, string>, entry?: string | null) => void;
  openFile: (path: string) => void;
  closeFile: (path: string) => void;
  setActiveFile: (path: string) => void;
  setBuffer: (path: string, value: string) => void;
  syncBuffer: (path: string) => void;
  flush: (path?: string) => void;
  toggleDir: (path: string) => void;
  setExpanded: (path: string, expanded: boolean) => void;
  select: (path: string | null) => void;
  setSearch: (value: string) => void;
  setCursor: (cursor: Cursor) => void;
  createFile: (path: string, content?: string) => boolean;
  createFolder: (path: string) => boolean;
  renameEntry: (from: string, to: string) => boolean;
  deleteEntry: (path: string) => boolean;
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  tree: [],
  openFiles: [],
  activeFile: null,
  buffers: {},
  expanded: {},
  selectedPath: null,
  search: '',
  cursor: { line: 1, column: 1 },
  lastWriteAt: 0,
  ready: false,

  refresh: () => {
    const vfs = runtime.getVfs();
    if (!vfs) return;
    set({ tree: buildFileTree(vfs, (path) => runtime.isServedAsset(path)) });
  },

  loadFiles: (files, entry) => {
    for (const key of [...writeTimers.keys()]) cancelWrite(key);

    const vfs = runtime.getVfs();
    const tree = vfs
      ? buildFileTree(vfs, (path) => runtime.isServedAsset(path))
      : [];
    const expanded: Record<string, boolean> = {};
    for (const dir of allDirectories(tree)) expanded[dir] = true;

    const paths = Object.keys(files);
    let preferred = entry && files[entry] !== undefined ? entry : null;
    if (!preferred && files[STARTER_ENTRY] !== undefined) preferred = STARTER_ENTRY;
    if (!preferred) preferred = paths.find((path) => /\.(tsx|jsx|ts)$/.test(path)) ?? paths[0] ?? null;

    const buffers: Record<string, string> = {};
    for (const [path, content] of Object.entries(files)) buffers[path] = content;

    set({
      tree,
      buffers,
      expanded,
      openFiles: preferred ? [preferred] : [],
      activeFile: preferred,
      selectedPath: preferred,
      ready: true,
      cursor: { line: 1, column: 1 },
    });
  },

  openFile: (rawPath) => {
    const path = normalizePath(rawPath);
    if (runtime.isDirectory(path)) return;

    const state = get();
    const expanded = { ...state.expanded };
    for (const ancestor of ancestors(path)) expanded[ancestor] = true;

    const content = state.buffers[path] ?? runtime.readFile(path) ?? '';
    const openFiles = state.openFiles.includes(path) ? state.openFiles : [...state.openFiles, path];

    set({
      openFiles,
      activeFile: path,
      selectedPath: path,
      expanded,
      buffers: { ...state.buffers, [path]: content },
    });
  },

  closeFile: (path) => {
    const { openFiles, activeFile } = get();
    const index = openFiles.indexOf(path);
    if (index === -1) return;
    const remaining = openFiles.filter((file) => file !== path);
    let nextActive = activeFile;
    if (activeFile === path) {
      nextActive = remaining[index] ?? remaining[index - 1] ?? null;
    }
    cancelWrite(path);
    set({ openFiles: remaining, activeFile: nextActive });
  },

  setActiveFile: (path) => {
    if (!runtime.exists(path) || runtime.isDirectory(path)) return;
    const state = get();
    const content = state.buffers[path] ?? runtime.readFile(path) ?? '';
    set({
      activeFile: path,
      selectedPath: path,
      buffers: { ...state.buffers, [path]: content },
      openFiles: state.openFiles.includes(path) ? state.openFiles : [...state.openFiles, path],
    });
  },

  setBuffer: (path, value) => {
    set((state) => ({
      buffers: { ...state.buffers, [path]: value },
      lastWriteAt: Date.now(),
    }));

    cancelWrite(path);
    const timer = window.setTimeout(() => {
      writeTimers.delete(path);
      if (!runtime.exists(path)) return;
      try {
        runtime.writeFile(path, useWorkspaceStore.getState().buffers[path] ?? '');
        useWorkspaceStore.setState({ lastWriteAt: Date.now() });
      } catch (error) {
        runtime.log('error', `Could not write ${path}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }, WRITE_DELAY);
    writeTimers.set(path, timer);
  },

  syncBuffer: (path) => {
    const state = get();
    if (state.buffers[path] === undefined) return;
    const content = runtime.readFile(path);
    if (content === null) return;
    cancelWrite(path);
    set({ buffers: { ...state.buffers, [path]: content } });
  },

  flush: (path) => {
    const state = get();
    const targets = path ? [path] : Object.keys(state.buffers).filter((file) => writeTimers.has(file));
    for (const file of targets) {
      cancelWrite(file);
      if (!runtime.exists(file)) continue;
      const content = state.buffers[file];
      if (content === undefined) continue;
      runtime.writeFile(file, content);
    }
    set({ lastWriteAt: Date.now() });
  },

  toggleDir: (path) => {
    set((state) => ({ expanded: { ...state.expanded, [path]: !state.expanded[path] } }));
  },

  setExpanded: (path, expanded) => {
    set((state) => ({ expanded: { ...state.expanded, [path]: expanded } }));
  },

  select: (path) => set({ selectedPath: path }),

  setSearch: (value) => set({ search: value }),

  setCursor: (cursor) => {
    const current = get().cursor;
    if (current.line === cursor.line && current.column === cursor.column) return;
    set({ cursor });
  },

  createFile: (rawPath, content = '') => {
    const path = normalizePath(rawPath);
    if (!path || path === '/') return false;
    if (runtime.exists(path)) {
      useUiStore.getState().toast(`Already exists: ${path}`, 'error');
      return false;
    }
    try {
      runtime.createFile(path, content);
      get().refresh();
      const expanded = { ...get().expanded };
      for (const ancestor of ancestors(path)) expanded[ancestor] = true;
      set({ expanded });
      get().openFile(path);
      runtime.log('info', `Created ${path}`);
      useUiStore.getState().toast(`Created ${path}`);
      return true;
    } catch (error) {
      useUiStore.getState().toast(`Could not create ${path}`, 'error');
      runtime.log('error', error instanceof Error ? error.message : String(error));
      return false;
    }
  },

  createFolder: (rawPath) => {
    const path = normalizePath(rawPath);
    if (!path || path === '/') return false;
    if (runtime.exists(path)) {
      useUiStore.getState().toast(`Already exists: ${path}`, 'error');
      return false;
    }
    try {
      runtime.createFolder(path);
      get().refresh();
      set((state) => ({ expanded: { ...state.expanded, [path]: true }, selectedPath: path }));
      runtime.log('info', `Created folder ${path}`);
      useUiStore.getState().toast(`Created folder ${path}`);
      return true;
    } catch (error) {
      useUiStore.getState().toast(`Could not create ${path}`, 'error');
      runtime.log('error', error instanceof Error ? error.message : String(error));
      return false;
    }
  },

  renameEntry: (rawFrom, rawTo) => {
    const from = normalizePath(rawFrom);
    const to = normalizePath(rawTo);
    if (from === to) return true;
    if (!runtime.exists(from)) return false;
    if (runtime.exists(to)) {
      useUiStore.getState().toast(`Already exists: ${to}`, 'error');
      return false;
    }

    try {
      const state = get();
      cancelWritesUnder(from);
      runtime.renameEntry(from, to);

      const openFiles = state.openFiles.map((path) => remapPath(path, from, to));
      const buffers: Record<string, string> = {};
      for (const [path, content] of Object.entries(state.buffers)) {
        buffers[remapPath(path, from, to)] = content;
      }
      const expanded: Record<string, boolean> = {};
      for (const [path, value] of Object.entries(state.expanded)) {
        expanded[remapPath(path, from, to)] = value;
      }

      // Persist any buffer that was being edited when the rename happened.
      for (const path of openFiles) {
        if (path === to || path.startsWith(to + '/')) {
          if (buffers[path] !== undefined) runtime.writeFile(path, buffers[path]);
        }
      }

      set({
        openFiles,
        buffers,
        expanded,
        activeFile: state.activeFile ? remapPath(state.activeFile, from, to) : null,
        selectedPath: state.selectedPath ? remapPath(state.selectedPath, from, to) : null,
      });
      get().refresh();
      runtime.log('info', `Renamed ${from} → ${to}`);
      useUiStore.getState().toast(`Renamed to ${to.split('/').pop()}`);
      runtime.requestPreviewReload();
      return true;
    } catch (error) {
      useUiStore.getState().toast('Rename failed', 'error');
      runtime.log('error', error instanceof Error ? error.message : String(error));
      return false;
    }
  },

  deleteEntry: (rawPath) => {
    const path = normalizePath(rawPath);
    if (path === '/' || !runtime.exists(path)) return false;

    try {
      const state = get();
      cancelWritesUnder(path);
      runtime.deleteEntry(path);

      const openFiles = state.openFiles.filter((file) => file !== path && !file.startsWith(path + '/'));
      const buffers: Record<string, string> = {};
      for (const [file, content] of Object.entries(state.buffers)) {
        if (file !== path && !file.startsWith(path + '/')) buffers[file] = content;
      }
      const activeFile =
        state.activeFile && openFiles.includes(state.activeFile) ? state.activeFile : openFiles[0] ?? null;
      const expanded: Record<string, boolean> = {};
      for (const [file, value] of Object.entries(state.expanded)) {
        if (file !== path && !file.startsWith(path + '/')) expanded[file] = value;
      }

      set({ openFiles, buffers, activeFile, expanded, selectedPath: activeFile });
      get().refresh();
      runtime.log('warn', `Deleted ${path}`);
      useUiStore.getState().toast(`Deleted ${path.split('/').pop()}`);
      runtime.requestPreviewReload();
      return true;
    } catch (error) {
      useUiStore.getState().toast('Delete failed', 'error');
      runtime.log('error', error instanceof Error ? error.message : String(error));
      return false;
    }
  },
}));
