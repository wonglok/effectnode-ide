import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  ChevronDown,
  ChevronRight,
  FilePlus,
  Folder,
  FolderOpen,
  FolderPlus,
  Pencil,
  RefreshCw,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { countLeaves, filterTree, languageColor, type TreeNode } from '@/lib/file-tree';
import { dirname, joinPath, normalizePath } from '@/lib/paths';
import { runtime } from '@/lib/runtime';
import { useUiStore } from '@/store/ui';
import { useWorkspaceStore } from '@/store/workspace';

interface MenuState {
  x: number;
  y: number;
  node: TreeNode | null;
}

export function FileExplorer() {
  const tree = useWorkspaceStore((state) => state.tree);
  const expanded = useWorkspaceStore((state) => state.expanded);
  const selectedPath = useWorkspaceStore((state) => state.selectedPath);
  const activeFile = useWorkspaceStore((state) => state.activeFile);
  const search = useWorkspaceStore((state) => state.search);
  const setSearch = useWorkspaceStore((state) => state.setSearch);
  const toggleDir = useWorkspaceStore((state) => state.toggleDir);
  const openFile = useWorkspaceStore((state) => state.openFile);
  const select = useWorkspaceStore((state) => state.select);
  const refresh = useWorkspaceStore((state) => state.refresh);
  const createFile = useWorkspaceStore((state) => state.createFile);
  const createFolder = useWorkspaceStore((state) => state.createFolder);
  const renameEntry = useWorkspaceStore((state) => state.renameEntry);
  const deleteEntry = useWorkspaceStore((state) => state.deleteEntry);

  const openPrompt = useUiStore((state) => state.openPrompt);
  const openConfirm = useUiStore((state) => state.openConfirm);
  const closeConfirm = useUiStore((state) => state.closeConfirm);
  const setMainView = useUiStore((state) => state.setMainView);

  // Opening a file from the tree should reveal it in the code view.
  const openInEditor = (path: string) => {
    openFile(path);
    setMainView('code');
  };

  const [menu, setMenu] = useState<MenuState | null>(null);

  const visibleTree = useMemo(() => filterTree(tree, search), [tree, search]);
  const fileCount = useMemo(() => countLeaves(tree), [tree]);
  const isSearching = search.trim().length > 0;

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenu(null);
    };
    window.addEventListener('pointerdown', close);
    window.addEventListener('resize', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('resize', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [menu]);

  const baseDir = (path: string | null): string => {
    if (!path) return '/';
    return runtime.isDirectory(path) ? path : dirname(path);
  };

  const promptNewFile = (dir: string) => {
    openPrompt({
      title: 'New file',
      label: `File path — relative to ${dir === '/' ? '/' : dir + '/'}`,
      initialValue: '',
      placeholder: 'components/Card.tsx',
      confirmLabel: 'Create file',
      onConfirm: (value) => {
        const trimmed = value.trim();
        if (!trimmed) return;
        const target = trimmed.startsWith('/') ? normalizePath(trimmed) : joinPath(dir, trimmed);
        createFile(target);
      },
    });
  };

  const promptNewFolder = (dir: string) => {
    openPrompt({
      title: 'New folder',
      label: `Folder path — relative to ${dir === '/' ? '/' : dir + '/'}`,
      initialValue: '',
      placeholder: 'components',
      confirmLabel: 'Create folder',
      onConfirm: (value) => {
        const trimmed = value.trim();
        if (!trimmed) return;
        const target = trimmed.startsWith('/') ? normalizePath(trimmed) : joinPath(dir, trimmed);
        createFolder(target);
      },
    });
  };

  const promptRename = (node: TreeNode) => {
    openPrompt({
      title: 'Rename',
      label: 'New path',
      initialValue: node.path,
      confirmLabel: 'Rename',
      onConfirm: (value) => {
        const trimmed = value.trim();
        if (!trimmed) return;
        renameEntry(node.path, trimmed.startsWith('/') ? normalizePath(trimmed) : joinPath(dirname(node.path), trimmed));
      },
    });
  };

  const promptDelete = (node: TreeNode) => {
    const kind = node.type === 'dir' ? 'folder' : 'file';
    openConfirm({
      title: `Delete ${kind}?`,
      message: `${node.path} will be removed from the virtual file system. This cannot be undone.`,
      confirmLabel: 'Delete',
      destructive: true,
      onConfirm: () => {
        closeConfirm();
        deleteEntry(node.path);
      },
    });
  };

  const openMenu = (event: React.MouseEvent, node: TreeNode | null) => {
    event.preventDefault();
    event.stopPropagation();
    if (node) select(node.path);
    setMenu({
      x: Math.min(event.clientX, window.innerWidth - 196),
      y: Math.min(event.clientY, window.innerHeight - 220),
      node,
    });
  };

  const renderNodes = (nodes: TreeNode[], depth: number): ReactNode =>
    nodes.map((node) => {
      if (node.type === 'dir') {
        const isExpanded = isSearching ? true : !!expanded[node.path];
        return (
          <div key={node.path}>
            <button
              className={`tree-row tree-folder ${selectedPath === node.path ? 'is-selected' : ''}`}
              style={{ paddingLeft: 8 + depth * 12 }}
              onClick={() => {
                select(node.path);
                toggleDir(node.path);
              }}
              onContextMenu={(event) => openMenu(event, node)}
              title={node.path}
            >
              <span className="tree-caret">
                {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              </span>
              {isExpanded ? (
                <FolderOpen size={13} className="tree-folder-icon" />
              ) : (
                <Folder size={13} className="tree-folder-icon" />
              )}
              <span className="tree-label">{node.name}</span>
            </button>
            {isExpanded && node.children ? renderNodes(node.children, depth + 1) : null}
          </div>
        );
      }

      return (
        <button
          key={node.path}
          className={`tree-row ${activeFile === node.path ? 'is-active' : ''} ${
            selectedPath === node.path ? 'is-selected' : ''
          }`}
          style={{ paddingLeft: 8 + depth * 12 + 16 }}
          onClick={() => {
            select(node.path);
            openInEditor(node.path);
          }}
          onContextMenu={(event) => openMenu(event, node)}
          title={node.path}
        >
          <span className="tree-dot" style={{ background: languageColor(node.path) }} />
          <span className="tree-label">{node.name}</span>
        </button>
      );
    });

  return (
    <aside className="explorer">
      <div className="panel-header">
        <span className="panel-title">Explorer</span>
        <div className="panel-actions">
          <button className="icon-button" onClick={() => promptNewFile(baseDir(selectedPath))} title="New file">
            <FilePlus size={14} />
          </button>
          <button className="icon-button" onClick={() => promptNewFolder(baseDir(selectedPath))} title="New folder">
            <FolderPlus size={14} />
          </button>
          <button className="icon-button" onClick={refresh} title="Refresh file tree">
            <RefreshCw size={13} />
          </button>
        </div>
      </div>

      <div className="explorer-search">
        <Search size={13} />
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Filter files"
          spellCheck={false}
          id="file-filter"
          name="file-filter"
          aria-label="Filter files"
        />
        {search ? (
          <button className="icon-button subtle" onClick={() => setSearch('')} title="Clear filter">
            <X size={12} />
          </button>
        ) : null}
      </div>

      <div
        className="explorer-tree"
        onContextMenu={(event) => openMenu(event, null)}
        role="tree"
        aria-label="Project files"
      >
        {visibleTree.length > 0 ? (
          renderNodes(visibleTree, 0)
        ) : (
          <div className="explorer-empty">
            {isSearching ? 'No files match your filter.' : 'The virtual project is empty.'}
          </div>
        )}
      </div>

      <div className="explorer-footer">
        <span>{fileCount} files</span>
        <span className="explorer-footer-badge">VFS</span>
      </div>

      {menu ? (
        <div
          className="context-menu"
          style={{ left: menu.x, top: menu.y }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          {menu.node?.type === 'file' ? (
            <button
              onClick={() => {
                openInEditor(menu.node!.path);
                setMenu(null);
              }}
            >
              <span>Open</span>
              <span className="menu-hint">↵</span>
            </button>
          ) : null}

          {menu.node?.type === 'dir' ? (
            <>
              <button
                onClick={() => {
                  promptNewFile(menu.node!.path);
                  setMenu(null);
                }}
              >
                <FilePlus size={13} />
                <span>New file here</span>
              </button>
              <button
                onClick={() => {
                  promptNewFolder(menu.node!.path);
                  setMenu(null);
                }}
              >
                <FolderPlus size={13} />
                <span>New folder here</span>
              </button>
            </>
          ) : null}

          {!menu.node ? (
            <>
              <button
                onClick={() => {
                  promptNewFile('/');
                  setMenu(null);
                }}
              >
                <FilePlus size={13} />
                <span>New file</span>
              </button>
              <button
                onClick={() => {
                  promptNewFolder('/');
                  setMenu(null);
                }}
              >
                <FolderPlus size={13} />
                <span>New folder</span>
              </button>
              <button
                onClick={() => {
                  refresh();
                  setMenu(null);
                }}
              >
                <RefreshCw size={13} />
                <span>Refresh</span>
              </button>
            </>
          ) : null}

          {menu.node ? (
            <>
              <div className="context-separator" />
              <button
                onClick={() => {
                  promptRename(menu.node!);
                  setMenu(null);
                }}
              >
                <Pencil size={13} />
                <span>Rename</span>
              </button>
              <button
                className="danger"
                onClick={() => {
                  promptDelete(menu.node!);
                  setMenu(null);
                }}
              >
                <Trash2 size={13} />
                <span>Delete</span>
              </button>
            </>
          ) : null}
        </div>
      ) : null}
    </aside>
  );
}
