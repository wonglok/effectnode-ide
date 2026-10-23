import {
  Code2,
  Loader2,
  Settings2,
  Sparkles,
  Trash2,
  Undo2,
} from 'lucide-react';
import { selectAgentConfigured, useAgentStore } from '@/store/agent';
import { useUiStore } from '@/store/ui';

export function MainHeader() {
  const mainView = useUiStore((state) => state.mainView);
  const setMainView = useUiStore((state) => state.setMainView);
  const openConfirm = useUiStore((state) => state.openConfirm);
  const closeConfirm = useUiStore((state) => state.closeConfirm);

  const configured = useAgentStore(selectAgentConfigured);
  const hasServerKey = useAgentStore((state) => state.hasServerKey);
  const model = useAgentStore((state) => state.config.model);
  const baseUrl = useAgentStore((state) => state.config.baseUrl);
  const runStatus = useAgentStore((state) => state.runStatus);
  const step = useAgentStore((state) => state.step);
  const undoAvailable = useAgentStore((state) => state.undoAvailable);
  const messageCount = useAgentStore((state) => state.messages.length);
  const openSetup = useAgentStore((state) => state.openSetup);
  const clear = useAgentStore((state) => state.clear);
  const restoreLastRun = useAgentStore((state) => state.restoreLastRun);

  const running = runStatus === 'running';

  const confirmUndo = () => {
    openConfirm({
      title: 'Undo the last agent run?',
      message:
        'The whole virtual project will return to its state before the last agent run. Manual edits made after that run will also be lost.',
      confirmLabel: 'Revert project',
      destructive: true,
      onConfirm: () => {
        closeConfirm();
        void restoreLastRun();
      },
    });
  };

  const confirmClear = () => {
    if (messageCount === 0) return;
    openConfirm({
      title: 'Clear the agent chat?',
      message: 'This clears the conversation only. Your project files stay as they are.',
      confirmLabel: 'Clear chat',
      destructive: true,
      onConfirm: () => {
        closeConfirm();
        clear();
      },
    });
  };

  return (
    <div className="main-header">
      <div className="main-tabs" role="tablist" aria-label="Workbench view">
        <button
          className={`main-tab ${mainView === 'code' ? 'is-active' : ''}`}
          role="tab"
          aria-selected={mainView === 'code'}
          onClick={() => setMainView('code')}
        >
          <Code2 size={12} />
          <span>Code</span>
        </button>
        <button
          className={`main-tab ${mainView === 'agent' ? 'is-active' : ''}`}
          role="tab"
          aria-selected={mainView === 'agent'}
          onClick={() => setMainView('agent')}
        >
          <Sparkles size={12} />
          <span>Agent</span>
          {running ? <span className="main-running-dot" /> : null}
        </button>
      </div>

      {mainView === 'agent' ? (
        <div className="main-actions">
          <span className="main-agent-status">
            <span className={`mini-dot ${configured ? 'is-online' : 'is-offline'}`} />
            {configured ? (hasServerKey && !model ? 'server key' : 'agent ready') : 'not connected'}
          </span>
          {running ? (
            <span className="agent-working">
              <Loader2 size={10} className="spin" /> step {step}/8
            </span>
          ) : null}
          {undoAvailable && !running ? (
            <button className="agent-undo" onClick={confirmUndo} title="Revert the last agent run">
              <Undo2 size={11} /> undo run
            </button>
          ) : null}
          <span className="agent-model-chip" title={baseUrl || 'No provider configured'}>
            {model || 'no model'}
          </span>
          <button className="icon-button" onClick={openSetup} title="Agent settings">
            <Settings2 size={13} />
          </button>
          <button
            className="icon-button"
            onClick={confirmClear}
            disabled={messageCount === 0}
            title="Clear agent chat"
          >
            <Trash2 size={13} />
          </button>
        </div>
      ) : (
        <div className="main-actions">
          <span className="main-header-hint">
            <kbd>⇧⌘A</kbd> agent
          </span>
        </div>
      )}
    </div>
  );
}
