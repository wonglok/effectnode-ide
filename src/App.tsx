import { useEffect, useRef } from 'react';
import { ActivityRail } from '@/components/ActivityRail';
import {
  ConfirmDialog,
  PromptDialog,
  ProjectsDialog,
  ShortcutsDialog,
} from '@/components/Dialogs';
import { EditorPane } from '@/components/EditorPane';
import { FileExplorer } from '@/components/FileExplorer';
import { RightDock } from '@/components/RightDock';
import { StatusBar } from '@/components/StatusBar';
import { TerminalPane } from '@/components/TerminalPane';
import { TitleBar } from '@/components/TitleBar';
import { Toasts } from '@/components/Toasts';
import { AgentPanel } from '@/components/agent/AgentPanel';
import { AgentSetupDialog } from '@/components/agent/AgentSetupDialog';
import { saveProject } from '@/lib/actions';
import { bootstrap } from '@/lib/bootstrap';
import { useAgentStore } from '@/store/agent';
import { useProjectStore } from '@/store/projects';
import { useUiStore } from '@/store/ui';

export default function App() {
  const explorerOpen = useUiStore((state) => state.explorerOpen);
  const terminalOpen = useUiStore((state) => state.terminalOpen);
  const agentWidth = useUiStore((state) => state.agentWidth);
  const previewRatio = useUiStore((state) => state.previewRatio);
  const terminalHeight = useUiStore((state) => state.terminalHeight);
  const setPreviewRatio = useUiStore((state) => state.setPreviewRatio);
  const setTerminalHeight = useUiStore((state) => state.setTerminalHeight);
  const setAgentWidth = useUiStore((state) => state.setAgentWidth);
  const name = useProjectStore((state) => state.name);

  const stageRef = useRef<HTMLElement>(null);
  const editingRef = useRef<HTMLElement>(null);

  useEffect(() => {
    void bootstrap();
    void useAgentStore.getState().init();
  }, []);

  useEffect(() => {
    document.title = `${name} — Forge`;
  }, [name]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const meta = event.metaKey || event.ctrlKey;
      if (!meta) return;
      const key = event.key.toLowerCase();
      const ui = useUiStore.getState();

      if (event.shiftKey && key === 'a') {
        event.preventDefault();
        const input = document.getElementById('agent-input') as HTMLTextAreaElement | null;
        input?.focus();
        input?.scrollIntoView({ block: 'nearest' });
      } else if (key === 's') {
        event.preventDefault();
        saveProject();
      } else if (key === 'b') {
        event.preventDefault();
        ui.toggleExplorer();
      } else if (key === 'j') {
        event.preventDefault();
        ui.toggleTerminal();
      } else if (key === 'k') {
        event.preventDefault();
        ui.setProjectsOpen(!ui.projectsOpen);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const startPreviewDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const stage = stageRef.current;
    if (!stage) return;
    const rect = stage.getBoundingClientRect();
    document.body.classList.add('is-resizing');

    const move = (moveEvent: PointerEvent) => {
      setPreviewRatio((rect.right - moveEvent.clientX) / rect.width);
    };
    const stop = () => {
      document.body.classList.remove('is-resizing');
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
  };

  const startTerminalDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const editing = editingRef.current;
    if (!editing) return;
    const rect = editing.getBoundingClientRect();
    document.body.classList.add('is-resizing');

    const move = (moveEvent: PointerEvent) => {
      setTerminalHeight(rect.bottom - moveEvent.clientY);
    };
    const stop = () => {
      document.body.classList.remove('is-resizing');
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
  };

  const startAgentDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const editing = editingRef.current;
    if (!editing) return;
    const rect = editing.getBoundingClientRect();
    document.body.classList.add('is-resizing');

    const move = (moveEvent: PointerEvent) => {
      const maximum = Math.max(280, Math.min(560, rect.width - 280));
      setAgentWidth(Math.min(maximum, rect.right - moveEvent.clientX));
    };
    const stop = () => {
      document.body.classList.remove('is-resizing');
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
  };

  return (
    <div className="ide">
      <TitleBar />

      <div className="workspace">
        <ActivityRail />
        {explorerOpen ? <FileExplorer /> : null}

        <main className="stage" ref={stageRef}>
          <section className="editing" ref={editingRef}>
            <div className="code-column">
              <EditorPane />
              {terminalOpen ? (
                <div
                  className="splitter splitter-horizontal"
                  onPointerDown={startTerminalDrag}
                  role="separator"
                  aria-orientation="horizontal"
                  title="Drag to resize the panel"
                />
              ) : null}
              {terminalOpen ? <TerminalPane height={terminalHeight} /> : null}
            </div>

            <div
              className="splitter splitter-vertical agent-splitter"
              onPointerDown={startAgentDrag}
              role="separator"
              aria-orientation="vertical"
              title="Drag to resize the agent chat"
            />

            <div className="agent-column" style={{ flexBasis: `${agentWidth}px` }}>
              <AgentPanel />
            </div>
          </section>

          <div
            className="splitter splitter-vertical"
            onPointerDown={startPreviewDrag}
            role="separator"
            aria-orientation="vertical"
            title="Drag to resize the preview"
          />

          <div className="preview-slot" style={{ flexBasis: `${previewRatio * 100}%` }}>
            <RightDock />
          </div>
        </main>
      </div>

      <StatusBar />

      <PromptDialog />
      <ConfirmDialog />
      <ProjectsDialog />
      <ShortcutsDialog />
      <AgentSetupDialog />
      <Toasts />
    </div>
  );
}
