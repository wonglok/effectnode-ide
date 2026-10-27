import { useEffect, useState } from 'react';
import { basename } from '@/lib/paths';
import { languageLabel } from '@/lib/file-tree';
import { useRuntimeStore } from '@/store/runtime';
import { useUiStore } from '@/store/ui';
import { useWorkspaceStore } from '@/store/workspace';

export function StatusBar() {
  const activeFile = useWorkspaceStore((state) => state.activeFile);
  const cursor = useWorkspaceStore((state) => state.cursor);
  const status = useRuntimeStore((state) => state.status);
  const setCreditsOpen = useUiStore((state) => state.setCreditsOpen);
  const lastHmrAt = useRuntimeStore((state) => state.lastHmrAt);
  const lastHmrPath = useRuntimeStore((state) => state.lastHmrPath);

  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setTick((value) => value + 1), 1500);
    return () => window.clearInterval(timer);
  }, []);

  const hmrRecent = lastHmrAt > 0 && Date.now() - lastHmrAt < 2600;

  return (
    <footer className="statusbar">
      <div className="statusbar-left">
        <button
          className="statusbar-credit"
          onClick={() => setCreditsOpen(true)}
          title="Open the credits"
        >
          CREDIT
        </button>
        <span className="statusbar-divider" />
        <span className="statusbar-path">{activeFile ?? 'no file open'}</span>
        {activeFile ? <span className="statusbar-language">{languageLabel(activeFile)}</span> : null}
      </div>

      <div className="statusbar-right">
        <span className={`statusbar-item ${hmrRecent ? 'is-hot' : ''}`} title={lastHmrPath ?? undefined}>
          <span className={`mini-dot ${hmrRecent ? 'is-hot' : ''}`} />
          {hmrRecent && lastHmrPath ? `HMR · ${basename(lastHmrPath)}` : 'HMR listening'}
        </span>

        <span
          className="statusbar-item"
          title="Project files are stored in the browser's Origin Private File System"
        >
          <span className="mini-dot is-online" />
          OPFS
        </span>

        <span className="statusbar-item statusbar-cursor">
          Ln {cursor.line}, Col {cursor.column}
        </span>
        <span className={`statusbar-item statusbar-state status-${status}`}>
          {status === 'ready' ? 'Live preview' : status === 'error' ? 'Preview offline' : 'Starting'}
        </span>
      </div>
    </footer>
  );
}
