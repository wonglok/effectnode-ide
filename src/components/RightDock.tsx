import { useEffect, useState } from 'react';
import {
  ExternalLink,
  Globe2,
  Monitor,
  RotateCw,
  Zap,
} from 'lucide-react';
import { useRuntimeStore } from '@/store/runtime';
import { useUiStore } from '@/store/ui';
import { PreviewBody } from './PreviewPane';

export function RightDock() {
  const toast = useUiStore((state) => state.toast);

  const status = useRuntimeStore((state) => state.status);
  const previewUrl = useRuntimeStore((state) => state.previewUrl);
  const lastHmrAt = useRuntimeStore((state) => state.lastHmrAt);
  const reloadPreview = useRuntimeStore((state) => state.reloadPreview);

  const [hmrFlash, setHmrFlash] = useState(false);

  useEffect(() => {
    if (!lastHmrAt) return;
    setHmrFlash(true);
    const timer = window.setTimeout(() => setHmrFlash(false), 1100);
    return () => window.clearTimeout(timer);
  }, [lastHmrAt]);

  const openExternal = () => {
    if (!previewUrl) return;
    const opened = window.open(previewUrl, '_blank', 'noopener');
    if (!opened) toast('The browser blocked the new tab', 'error');
  };

  return (
    <section className="dock-pane">
      <div className="panel-header dock-header">
        <div className="dock-title">
          <Monitor size={12} />
          <span>Preview</span>
          <span className={`dock-status-dot status-${status}`} />
        </div>

        <div className="dock-actions">
          <span className={`hmr-badge ${hmrFlash ? 'is-flashing' : ''}`} title="Hot module replacement">
            <Zap size={10} />
            HMR
          </span>
          <div className="preview-address" title={previewUrl || 'Preview server is starting'}>
            <Globe2 size={11} />
            <span>{status === 'ready' ? '/__virtual__/3000/' : 'localhost:3000'}</span>
          </div>
          <button className="icon-button" onClick={reloadPreview} title="Reload preview">
            <RotateCw size={13} />
          </button>
          <button className="icon-button" onClick={openExternal} title="Open preview in a new tab">
            <ExternalLink size={13} />
          </button>
        </div>
      </div>

      <div className="dock-content">
        <div className="dock-view is-active">
          <PreviewBody />
        </div>
      </div>
    </section>
  );
}
