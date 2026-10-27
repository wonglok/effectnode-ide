import { useEffect, useState, type FormEvent } from 'react';
import {
  Clock3,
  Copy,
  FolderOpen,
  HardDrive,
  History,
  Pencil,
  Plus,
  RotateCcw,
  Save,
  Search,
  Trash2,
} from 'lucide-react';
import { formatRelative } from '@/lib/format';
import { getBoundProjectId, opfsProjectStore } from '@/lib/opfs';
import { useProjectLibraryStore } from '@/store/library';
import { useProjectStore } from '@/store/projects';
import { useUiStore } from '@/store/ui';
import { Modal } from './Dialogs';

function bytesLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function ProjectSwitcher() {
  const open = useUiStore((state) => state.projectSwitcherOpen);
  const setOpen = useUiStore((state) => state.setProjectSwitcherOpen);
  const openPrompt = useUiStore((state) => state.openPrompt);
  const openConfirm = useUiStore((state) => state.openConfirm);
  const openNewProject = useUiStore((state) => state.openNewProject);

  const projects = useProjectLibraryStore((state) => state.projects);
  const loading = useProjectLibraryStore((state) => state.loading);
  const selectedId = useProjectLibraryStore((state) => state.selectedId);
  const versions = useProjectLibraryStore((state) => state.versions);
  const versionsLoading = useProjectLibraryStore(
    (state) => state.versionsLoading
  );
  const busy = useProjectLibraryStore((state) => state.busy);
  const refresh = useProjectLibraryStore((state) => state.refresh);
  const select = useProjectLibraryStore((state) => state.select);
  const openProject = useProjectLibraryStore((state) => state.openProject);
  const duplicateProject = useProjectLibraryStore(
    (state) => state.duplicateProject
  );
  const renameProject = useProjectLibraryStore((state) => state.renameProject);
  const deleteProject = useProjectLibraryStore((state) => state.deleteProject);
  const saveVersion = useProjectLibraryStore((state) => state.saveVersion);
  const restoreVersion = useProjectLibraryStore(
    (state) => state.restoreVersion
  );
  const deleteVersion = useProjectLibraryStore((state) => state.deleteVersion);

  const activeId = useProjectStore((state) => state.id);

  const [query, setQuery] = useState('');
  const [versionLabel, setVersionLabel] = useState('');

  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);

  useEffect(() => {
    setVersionLabel('');
  }, [selectedId, open]);

  if (!open) return null;

  const selected =
    projects.find((project) => project.id === selectedId) ?? null;
  const isActive = (id: string) => id === (activeId ?? getBoundProjectId());
  const isBusy = Boolean(busy);
  const filtered = projects.filter((project) =>
    project.name.toLowerCase().includes(query.trim().toLowerCase())
  );
  const totalVersionBytes = versions.reduce(
    (total, version) => total + version.bytes,
    0
  );
  const totalVersions = projects.reduce(
    (sum, project) => sum + project.versionCount,
    0
  );

  const onSaveVersion = (event: FormEvent) => {
    event.preventDefault();
    if (!selected || isBusy) return;
    const label = versionLabel.trim();
    setVersionLabel('');
    void saveVersion(selected.id, label);
  };

  const onRename = (id: string, currentName: string) => {
    openPrompt({
      title: 'Rename project',
      label: 'Project name',
      initialValue: currentName,
      confirmLabel: 'Rename',
      onConfirm: (value) => void renameProject(id, value),
    });
  };

  const onDeleteProject = (id: string, name: string) => {
    openConfirm({
      title: `Delete “${name}”?`,
      message:
        'The project folder and every saved version are removed from this browser. Download it first if you want to keep a copy.',
      confirmLabel: 'Delete project',
      destructive: true,
      onConfirm: () => void deleteProject(id),
    });
  };

  const onRestore = (
    projectId: string,
    versionId: string,
    label: string
  ) => {
    openConfirm({
      title: `Restore “${label}”?`,
      message:
        'The current files and agent transcript are replaced by this snapshot. A safety version of the current state is saved first.',
      confirmLabel: 'Restore version',
      onConfirm: () => void restoreVersion(projectId, versionId),
    });
  };

  const onDeleteVersion = (
    projectId: string,
    versionId: string,
    label: string
  ) => {
    openConfirm({
      title: `Delete “${label}”?`,
      message: 'This removes the snapshot permanently. The project files are not affected.',
      confirmLabel: 'Delete version',
      destructive: true,
      onConfirm: () => void deleteVersion(projectId, versionId),
    });
  };

  return (
    <Modal
      title="Projects & versions"
      subtitle="Every project and snapshot is stored in this browser's Origin Private File System (OPFS)."
      onClose={() => setOpen(false)}
      width={900}
      footer={
        <div className="library-footer">
          <span className="library-footer-stat">
            <HardDrive size={11} />
            {projects.length} project{projects.length === 1 ? '' : 's'} ·{' '}
            {totalVersions} version{totalVersions === 1 ? '' : 's'}
          </span>
          <span className="library-footer-note">
            {opfsProjectStore.available
              ? 'Local · survives reloads'
              : 'OPFS is unavailable in this browser'}
          </span>
        </div>
      }
    >
      <div className="library">
        <aside className="library-projects">
          <div className="library-search">
            <Search size={12} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search projects"
              spellCheck={false}
              aria-label="Search projects"
            />
          </div>

          <div className="library-project-list">
            {loading && projects.length === 0 ? (
              <p className="library-empty">Reading OPFS…</p>
            ) : null}
            {!loading && filtered.length === 0 ? (
              <p className="library-empty">
                {projects.length === 0
                  ? 'No projects yet.'
                  : 'No project matches that search.'}
              </p>
            ) : null}
            {filtered.map((project) => (
              <button
                key={project.id}
                className={`library-project ${
                  project.id === selectedId ? 'is-selected' : ''
                } ${isActive(project.id) ? 'is-active' : ''}`}
                onClick={() => void select(project.id)}
                title={project.name}
              >
                <FolderOpen size={14} className="library-project-icon" />
                <span className="library-project-main">
                  <span className="library-project-name">
                    {project.name}
                    {isActive(project.id) ? (
                      <span className="library-live-chip">live</span>
                    ) : null}
                  </span>
                  <span className="library-project-meta">
                    {project.fileCount} file{project.fileCount === 1 ? '' : 's'} ·{' '}
                    {project.versionCount} version
                    {project.versionCount === 1 ? '' : 's'}
                  </span>
                </span>
                <span className="library-project-time">
                  {formatRelative(project.updatedAt)}
                </span>
              </button>
            ))}
          </div>

          <div className="library-new">
            <button
              className="solid-button small library-new-button"
              onClick={() => {
                setOpen(false);
                openNewProject();
              }}
              disabled={isBusy}
              title="Create a project from a starter template"
            >
              <Plus size={12} />
              New project
            </button>
          </div>
        </aside>

        <section className="library-detail">
          {!selected ? (
            <div className="library-empty-detail">
              <History size={20} />
              <p>Select a project to browse its versions.</p>
            </div>
          ) : (
            <>
              <header className="library-detail-head">
                <div className="library-detail-title">
                  <div className="library-detail-name">{selected.name}</div>
                  <div className="library-detail-meta">
                    <span>
                      {selected.fileCount} file
                      {selected.fileCount === 1 ? '' : 's'}
                    </span>
                    <span>·</span>
                    <span>updated {formatRelative(selected.updatedAt)}</span>
                    {selected.latestVersionAt ? (
                      <>
                        <span>·</span>
                        <span>
                          last snapshot{' '}
                          {formatRelative(selected.latestVersionAt)}
                        </span>
                      </>
                    ) : null}
                  </div>
                </div>

                <div className="library-detail-actions">
                  {isActive(selected.id) ? (
                    <span className="library-active-label">
                      <span className="library-active-dot" />
                      Live project
                    </span>
                  ) : (
                    <button
                      className="solid-button small"
                      onClick={() => void openProject(selected.id)}
                      disabled={isBusy}
                    >
                      <FolderOpen size={12} />
                      Open
                    </button>
                  )}
                  <button
                    className="icon-button"
                    onClick={() => onRename(selected.id, selected.name)}
                    title="Rename project"
                    disabled={isBusy}
                  >
                    <Pencil size={13} />
                  </button>
                  <button
                    className="icon-button"
                    onClick={() =>
                      void duplicateProject(selected.id, `${selected.name} copy`)
                    }
                    title="Duplicate project (code only, no versions)"
                    disabled={isBusy}
                  >
                    <Copy size={13} />
                  </button>
                  <button
                    className="icon-button danger-hover"
                    onClick={() => onDeleteProject(selected.id, selected.name)}
                    title="Delete project"
                    disabled={isBusy}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </header>

              <form className="library-version-create" onSubmit={onSaveVersion}>
                <div className="library-version-label">
                  <History size={12} />
                  <span>Version history</span>
                  {versions.length > 0 ? (
                    <span
                      className="library-version-total"
                      title="Total space these snapshots use in browser storage"
                    >
                      {versions.length} snapshot
                      {versions.length === 1 ? '' : 's'} ·{' '}
                      {bytesLabel(totalVersionBytes)}
                    </span>
                  ) : null}
                </div>
                <div className="library-version-create-controls">
                  <input
                    value={versionLabel}
                    onChange={(event) => setVersionLabel(event.target.value)}
                    placeholder="Label (optional)"
                    spellCheck={false}
                    maxLength={120}
                    aria-label="Version label"
                  />
                  <button
                    className="ghost-button"
                    type="submit"
                    disabled={isBusy || selected.fileCount === 0}
                    title="Snapshot the files and agent transcript"
                  >
                    <Save size={12} />
                    Save version
                  </button>
                </div>
              </form>

              <div className="library-version-list">
                {versionsLoading ? (
                  <p className="library-empty">Loading versions…</p>
                ) : null}
                {!versionsLoading && versions.length === 0 ? (
                  <div className="library-empty-detail is-compact">
                    <Clock3 size={16} />
                    <p>
                      No versions yet. Save one before a big change so you can
                      return to it.
                    </p>
                  </div>
                ) : null}
                {!versionsLoading &&
                  versions.map((version, index) => (
                    <div className="library-version" key={version.id}>
                      <span
                        className={`library-version-dot ${
                          index === 0 ? 'is-latest' : ''
                        }`}
                      />
                      <div className="library-version-main">
                        <div className="library-version-name">
                          {version.label}
                          {index === 0 ? (
                            <span className="library-version-chip">latest</span>
                          ) : null}
                          {version.hasAgentState ? (
                            <span
                              className="library-version-chat"
                              title={`Includes the agent transcript${
                                version.agentStateBytes
                                  ? ` (${bytesLabel(version.agentStateBytes)})`
                                  : ''
                              }`}
                            >
                              + chat
                            </span>
                          ) : null}
                        </div>
                        <div
                          className="library-version-meta"
                          title={`Stored in OPFS — files ${bytesLabel(
                            version.bytes - (version.agentStateBytes ?? 0)
                          )}${
                            version.agentStateBytes
                              ? ` · transcript ${bytesLabel(
                                  version.agentStateBytes
                                )}`
                              : ''
                          }`}
                        >
                          {formatRelative(version.createdAt)} ·{' '}
                          {version.fileCount} file
                          {version.fileCount === 1 ? '' : 's'} ·{' '}
                          {bytesLabel(version.bytes)} stored
                        </div>
                      </div>
                      <div className="library-version-actions">
                        <button
                          className="icon-button"
                          onClick={() =>
                            onRestore(selected.id, version.id, version.label)
                          }
                          title="Restore this version"
                          disabled={isBusy}
                        >
                          <RotateCcw size={13} />
                        </button>
                        <button
                          className="icon-button danger-hover"
                          onClick={() =>
                            onDeleteVersion(
                              selected.id,
                              version.id,
                              version.label
                            )
                          }
                          title="Delete this version"
                          disabled={isBusy}
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                  ))}
              </div>
            </>
          )}
        </section>
      </div>
    </Modal>
  );
}
