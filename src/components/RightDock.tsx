import { useEffect, useState } from 'react';
import {
  ExternalLink,
  Globe2,
  Loader2,
  Monitor,
  RotateCw,
  Zap,
} from 'lucide-react';
import { useAgentStore } from '@/store/agent';
import { useRuntimeStore } from '@/store/runtime';
import { useUiStore } from '@/store/ui';
import { PreviewBody } from './PreviewPane';

export function RightDock() {
  const toast = useUiStore((state) => state.toast);

  const status = useRuntimeStore((state) => state.status);
  const previewUrl = useRuntimeStore((state) => state.previewUrl);
  const lastHmrAt = useRuntimeStore((state) => state.lastHmrAt);
  const reloadPreview = useRuntimeStore((state) => state.reloadPreview);
  const agentRunning = useAgentStore((state) => state.runStatus === 'running');
  const agentStatusText = useAgentStore((state) => state.runStatusText);

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
          <button
            className="icon-button"
            onClick={reloadPreview}
            title={agentRunning ? 'Preview paused while the agent works' : 'Reload preview'}
            disabled={agentRunning}
          >
            <RotateCw size={13} />
          </button>
          <button
            className="icon-button"
            onClick={openExternal}
            title={agentRunning ? 'Preview paused while the agent works' : 'Open preview in a new tab'}
            disabled={agentRunning}
          >
            <ExternalLink size={13} />
          </button>
        </div>
      </div>

      <div className="dock-content">
        <div
          className={`dock-view is-active ${agentRunning ? 'is-preview-locked' : ''}`}
          aria-busy={agentRunning}
        >
          <PreviewBody />
          {agentRunning ? (
            <div className="preview-busy" role="status" aria-live="polite">
              <div className="preview-busy-orbit">
                <Loader2 size={20} className="spin" />
              </div>
              <h3>Agent is working</h3>
              <p>{agentStatusText || 'Applying changes to your project…'}</p>
              <div className="preview-busy-bars" aria-hidden="true">
                <i />
                <i />
                <i />
              </div>
              <span className="preview-busy-note">
                Preview resumes when the run finishes
              </span>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
