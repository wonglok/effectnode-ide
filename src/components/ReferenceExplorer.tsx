import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type ReactNode,
} from 'react';
import {
  ChevronDown,
  ChevronRight,
  Download,
  File,
  FileArchive,
  FileCode,
  FileImage,
  FileText,
  FileType,
  Folder,
  FolderOpen,
  LoaderCircle,
  RefreshCw,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { useProjectStore } from '@/store/projects';
import {
  useReferenceStore,
  type ReferenceTreeNode,
} from '@/store/references';
import { useUiStore } from '@/store/ui';

const CODE_EXTENSIONS = new Set([
  'js',
  'jsx',
  'mjs',
  'cjs',
  'ts',
  'tsx',
  'css',
  'scss',
  'sass',
  'less',
  'html',
  'htm',
  'json',
  'jsonc',
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
  'vue',
  'svelte',
  'astro',
]);

function extensionOf(name: string): string {
  const index = name.lastIndexOf('.');
  return index <= 0 ? '' : name.slice(index + 1).toLowerCase();
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fileIcon(name: string) {
  const ext = extensionOf(name);
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'svg', 'bmp', 'ico'].includes(ext)) {
    return <FileImage size={13} />;
  }
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) {
    return <FileArchive size={13} />;
  }
  if (CODE_EXTENSIONS.has(ext)) {
    return <FileCode size={13} />;
  }
  if (['txt', 'md', 'markdown', 'csv', 'tsv', 'log'].includes(ext)) {
    return <FileText size={13} />;
  }
  if (ext === 'pdf' || ext === 'doc' || ext === 'docx') {
    return <FileType size={13} />;
  }
  return <File size={13} />;
}

export function ReferenceExplorer() {
  const tree = useReferenceStore((state) => state.tree);
  const entries = useReferenceStore((state) => state.entries);
  const expanded = useReferenceStore((state) => state.expanded);
  const selectedPath = useReferenceStore((state) => state.selectedPath);
  const preview = useReferenceStore((state) => state.preview);
  const loading = useReferenceStore((state) => state.loading);
  const uploading = useReferenceStore((state) => state.uploading);
  const error = useReferenceStore((state) => state.error);
  const load = useReferenceStore((state) => state.load);
  const uploadZip = useReferenceStore((state) => state.uploadZip);
  const select = useReferenceStore((state) => state.select);
  const toggleDir = useReferenceStore((state) => state.toggleDir);
  const closePreview = useReferenceStore((state) => state.closePreview);
  const remove = useReferenceStore((state) => state.remove);
  const clearAll = useReferenceStore((state) => state.clearAll);

  const openConfirm = useUiStore((state) => state.openConfirm);
  const closeConfirm = useUiStore((state) => state.closeConfirm);
  const toast = useUiStore((state) => state.toast);

  const projectStamp = useProjectStore(
    (state) => `${state.name}:${state.createdAt ?? ''}`,
  );

  const inputRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const [dragActive, setDragActive] = useState(false);

  useEffect(() => {
    void load(true);
  }, [projectStamp, load]);

  // Release a preview object URL when the panel is swapped out.
  useEffect(
    () => () => {
      useReferenceStore.getState().closePreview();
    },
    [],
  );

  const totals = useMemo(() => {
    let files = 0;
    let bytes = 0;
    for (const entry of entries) {
      if (entry.kind !== 'file') continue;
      files += 1;
      bytes += entry.size;
    }
    return { files, bytes };
  }, [entries]);

  const openPicker = () => inputRef.current?.click();

  const ingest = async (files: FileList | File[]) => {
    const zips = Array.from(files).filter((file) => /\.zip$/i.test(file.name));
    if (zips.length === 0) {
      toast('Choose a .zip file to upload', 'error');
      return;
    }
    for (const zip of zips) {
      await uploadZip(zip);
    }
  };

  const onDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    dragDepth.current = 0;
    setDragActive(false);
    void ingest(event.dataTransfer.files);
  };

  const onDragEnter = (event: DragEvent<HTMLElement>) => {
    if (!Array.from(event.dataTransfer.types).includes('Files')) return;
    event.preventDefault();
    dragDepth.current += 1;
    setDragActive(true);
  };

  const onDragLeave = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragActive(false);
  };

  const downloadPreview = () => {
    if (!preview) return;
    const anchor = document.createElement('a');
    anchor.href = preview.url;
    anchor.download = preview.name;
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  };

  const confirmRemove = () => {
    if (!preview) return;
    openConfirm({
      title: 'Remove reference file?',
      message: `${preview.path} will be removed from the project's reference folder.`,
      confirmLabel: 'Remove',
      destructive: true,
      onConfirm: () => {
        closeConfirm();
        void remove(preview.path);
      },
    });
  };

  const confirmClear = () => {
    if (entries.length === 0) return;
    openConfirm({
      title: 'Clear reference folder?',
      message:
        'Every uploaded reference file will be removed from this project’s OPFS. Project code is not affected.',
      confirmLabel: 'Clear references',
      destructive: true,
      onConfirm: () => {
        closeConfirm();
        void clearAll();
      },
    });
  };

  const renderNodes = (nodes: ReferenceTreeNode[], depth: number): ReactNode =>
    nodes.map((node) => {
      if (node.kind === 'dir') {
        const isExpanded = expanded[node.path] ?? true;
        return (
          <div key={node.path}>
            <button
              className={`tree-row tree-folder ${
                selectedPath === node.path ? 'is-selected' : ''
              }`}
              style={{ paddingLeft: 8 + depth * 12 }}
              onClick={() => {
                void select(node.path);
                toggleDir(node.path);
              }}
              title={node.path}
            >
              <span className="tree-caret">
                {isExpanded ? (
                  <ChevronDown size={12} />
                ) : (
                  <ChevronRight size={12} />
                )}
              </span>
              {isExpanded ? (
                <FolderOpen size={13} className="tree-folder-icon" />
              ) : (
                <Folder size={13} className="tree-folder-icon" />
              )}
              <span className="tree-label">{node.name}</span>
            </button>
            {isExpanded && node.children
              ? renderNodes(node.children, depth + 1)
              : null}
          </div>
        );
      }

      return (
        <button
          key={node.path}
          className={`tree-row reference-file ${
            selectedPath === node.path ? 'is-active' : ''
          }`}
          style={{ paddingLeft: 8 + depth * 12 + 16 }}
          onClick={() => void select(node.path)}
          title={`${node.path} · ${formatSize(node.size)}`}
        >
          <span className="reference-file-icon">{fileIcon(node.name)}</span>
          <span className="tree-label">{node.name}</span>
          <span className="reference-size">{formatSize(node.size)}</span>
        </button>
      );
    });

  return (
    <aside
      className={`explorer reference-explorer ${dragActive ? 'is-dragging' : ''}`}
      onDragEnter={onDragEnter}
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
      }}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div className="panel-header">
        <span className="panel-title">References</span>
        <div className="panel-actions">
          <button
            className="icon-button"
            onClick={openPicker}
            title="Upload reference ZIP"
            disabled={uploading}
          >
            {uploading ? (
              <LoaderCircle size={14} className="spin" />
            ) : (
              <Upload size={14} />
            )}
          </button>
          <button
            className="icon-button"
            onClick={() => void load(true)}
            title="Refresh reference tree"
            disabled={loading}
          >
            <RefreshCw size={13} className={loading ? 'spin' : undefined} />
          </button>
          <button
            className="icon-button danger-hover"
            onClick={confirmClear}
            title="Clear references"
            disabled={entries.length === 0}
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      <button
        className="reference-upload"
        onClick={openPicker}
        disabled={uploading}
        title="Extract a ZIP into the project's OPFS reference folder"
      >
        <Upload size={13} />
        <span>{uploading ? 'Extracting ZIP…' : 'Upload ZIP'}</span>
        <span className="reference-upload-hint">.zip</span>
      </button>

      <input
        ref={inputRef}
        className="reference-file-input"
        type="file"
        accept=".zip,application/zip"
        multiple
        aria-label="Upload reference ZIP"
        onChange={(event) => {
          const files = event.target.files;
          if (files && files.length > 0) void ingest(files);
          event.target.value = '';
        }}
      />

      <div className="explorer-tree reference-tree" role="tree" aria-label="Reference files">
        {tree.length > 0 ? (
          renderNodes(tree, 0)
        ) : (
          <div className="explorer-empty">
            {loading
              ? 'Reading the reference folder…'
              : error
                ? error
                : 'No references yet. Upload a ZIP or drop one here — files are extracted into the project’s OPFS reference folder.'}
          </div>
        )}
      </div>

      {preview ? (
        <div className="reference-preview">
          <div className="reference-preview-head">
            <span className="reference-preview-name" title={preview.path}>
              {preview.name}
            </span>
            <button
              className="icon-button subtle"
              onClick={downloadPreview}
              title="Download file"
            >
              <Download size={12} />
            </button>
            <button
              className="icon-button subtle danger-hover"
              onClick={confirmRemove}
              title="Remove file"
            >
              <Trash2 size={12} />
            </button>
            <button
              className="icon-button subtle"
              onClick={closePreview}
              title="Close preview"
            >
              <X size={12} />
            </button>
          </div>
          <div className="reference-preview-body">
            {preview.kind === 'image' ? (
              <img src={preview.url} alt={preview.name} />
            ) : preview.kind === 'text' ? (
              <pre>{preview.text || '(empty file)'}</pre>
            ) : (
              <div className="reference-preview-none">
                <FileType size={18} />
                <span>{preview.mime || 'No inline preview'}</span>
              </div>
            )}
          </div>
          <div className="reference-preview-meta">
            {formatSize(preview.size)} · {preview.path}
          </div>
        </div>
      ) : null}

      <div className="explorer-footer">
        <span>
          {totals.files} {totals.files === 1 ? 'file' : 'files'} ·{' '}
          {formatSize(totals.bytes)}
        </span>
        <span
          className="explorer-footer-badge"
          title="Stored in the project's OPFS folder"
        >
          OPFS
        </span>
      </div>

      {dragActive ? (
        <div className="reference-drop-overlay">
          <FileArchive size={22} />
          <span>Drop ZIP to extract into /reference</span>
        </div>
      ) : null}
    </aside>
  );
}
