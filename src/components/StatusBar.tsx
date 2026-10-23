import { useEffect, useState } from 'react';
import { basename } from '@/lib/paths';
import { languageLabel } from '@/lib/file-tree';
import { useProjectStore } from '@/store/projects';
import { useRuntimeStore } from '@/store/runtime';
import { useWorkspaceStore } from '@/store/workspace';

export function StatusBar() {
  const activeFile = useWorkspaceStore((state) => state.activeFile);
  const cursor = useWorkspaceStore((state) => state.cursor);
  const status = useRuntimeStore((state) => state.status);
  const lastHmrAt = useRuntimeStore((state) => state.lastHmrAt);
  const lastHmrPath = useRuntimeStore((state) => state.lastHmrPath);
  const serverOnline = useProjectStore((state) => state.serverOnline);
  const currentId = useProjectStore((state) => state.currentId);

  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setTick((value) => value + 1), 1500);
    return () => window.clearInterval(timer);
  }, []);

  const hmrRecent = lastHmrAt > 0 && Date.now() - lastHmrAt < 2600;

  return (
    <footer className="statusbar">
      <div className="statusbar-left">
        <span className="statusbar-brand">almostnode</span>
        <span className="statusbar-version">0.2.14</span>
        <span className="statusbar-divider" />
        <span className="statusbar-path">{activeFile ?? 'no file open'}</span>
        {activeFile ? <span className="statusbar-language">{languageLabel(activeFile)}</span> : null}
      </div>

      <div className="statusbar-right">
        <span className={`statusbar-item ${hmrRecent ? 'is-hot' : ''}`} title={lastHmrPath ?? undefined}>
          <span className={`mini-dot ${hmrRecent ? 'is-hot' : ''}`} />
          {hmrRecent && lastHmrPath ? `HMR · ${basename(lastHmrPath)}` : 'HMR listening'}
        </span>

        <span className="statusbar-item" title="Nitro persistence API">
          <span className={`mini-dot ${serverOnline ? 'is-online' : 'is-offline'}`} />
          Nitro {serverOnline === null ? '…' : serverOnline ? 'online' : 'offline'}
        </span>

        <span className="statusbar-item">{currentId ? 'synced' : 'local'}</span>
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
