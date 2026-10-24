import { create } from 'zustand';
import type { HarnessStatus } from '../../shared/types';
import { fetchAgentStatus } from '@/lib/agent-client';
import { runHarnessTurn } from '@/lib/harness-client';
import { playCompletionChime, primeCompletionAudio } from '@/lib/completion-chime';
import { runtime } from '@/lib/runtime';
import { useProjectStore } from './projects';
import { useUiStore } from './ui';
import { useWorkspaceStore } from './workspace';

export type AgentRunStatus = 'idle' | 'running';

export interface AgentToolEvent {
  name: string;
  summary: string;
  detail?: string;
  path?: string;
  status: 'running' | 'ok' | 'error';
}

export type AgentMessage =
  | { id: string; role: 'user'; content: string; at: number }
  | { id: string; role: 'assistant'; content: string; streaming: boolean; at: number }
  | { id: string; role: 'tool'; tool: AgentToolEvent; at: number }
  | { id: string; role: 'error'; content: string; at: number }
  | { id: string; role: 'notice'; content: string; at: number }
  | { id: string; role: 'refresh'; at: number };

export interface AgentState {
  /** DeepSeek Harness route reported by the Nitro server. */
  harness: HarnessStatus | null;
  statusLoaded: boolean;
  setupOpen: boolean;
  runStatus: AgentRunStatus;
  runStatusText: string | null;
  messages: AgentMessage[];
  error: string | null;
  undoSnapshot: Record<string, string> | null;
  undoAvailable: boolean;

  init: () => Promise<void>;
  openSetup: () => void;
  closeSetup: () => void;
  send: (text: string) => Promise<void>;
  stop: () => void;
  clear: () => void;
  restoreLastRun: () => Promise<void>;
}

let runSequence = 0;
let activeRun: { id: number; controller: AbortController } | null = null;
let initPromise: Promise<void> | null = null;

function makeId(prefix: string): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return `${prefix}_${crypto.randomUUID()}`;
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function finalizeStreaming(messages: AgentMessage[]): AgentMessage[] {
  return messages.map((message) =>
    message.role === 'assistant' && message.streaming ? { ...message, streaming: false } : message
  );
}

/**
 * Stable per-project conversation identity. The server maps it to one harness
 * session and one mirrored workspace directory.
 */
function conversationKey(): string {
  const project = useProjectStore.getState();
  const identity = project.currentId ?? `scratch:${project.name}`;
  let hash = 0x811c9dc5;
  for (let index = 0; index < identity.length; index += 1) {
    hash ^= identity.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `forge-${(hash >>> 0).toString(36).padStart(7, '0')}`;
}

/** Apply the harness's mirrored project to the in-page virtual file system. */
function applyHarnessFiles(files: Record<string, string>, changedPaths: string[]): void {
  if (changedPaths.length === 0) return;

  const workspace = useWorkspaceStore.getState();
  const deleted = new Set<string>();

  for (const path of changedPaths) {
    if (files[path] === undefined) {
      deleted.add(path);
      if (runtime.exists(path)) runtime.deleteEntry(path);
    } else {
      runtime.createFile(path, files[path]);
    }
  }

  const buffers: Record<string, string> = {};
  for (const [path, content] of Object.entries(workspace.buffers)) {
    if (deleted.has(path)) continue;
    buffers[path] = files[path] ?? content;
  }

  const openFiles = workspace.openFiles.filter((path) => !deleted.has(path));
  const activeFile =
    workspace.activeFile && openFiles.includes(workspace.activeFile)
      ? workspace.activeFile
      : openFiles[0] ?? null;

  useWorkspaceStore.setState({
    buffers,
    openFiles,
    activeFile,
    selectedPath: activeFile ?? workspace.selectedPath,
  });
  useWorkspaceStore.getState().refresh();
  runtime.requestPreviewReload();
}

export const useAgentStore = create<AgentState>((set, get) => ({
  harness: null,
  statusLoaded: false,
  setupOpen: false,
  runStatus: 'idle',
  runStatusText: null,
  messages: [],
  error: null,
  undoSnapshot: null,
  undoAvailable: false,

  init: () => {
    initPromise ??= (async () => {
      try {
        const status = await fetchAgentStatus();
        set({
          harness: status.harness,
          statusLoaded: true,
        });
      } catch (error) {
        set({ statusLoaded: true });
        runtime.log(
          'warn',
          `Harness status unavailable: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    })();
    return initPromise;
  },

  openSetup: () => set({ setupOpen: true }),
  closeSetup: () => set({ setupOpen: false }),

  send: async (rawText) => {
    const text = rawText.trim();
    const state = get();
    if (!text || state.runStatus === 'running') return;

    if (!state.harness?.configured) {
      set({ setupOpen: true });
      return;
    }

    // `send` runs from the composer's submit gesture; unlock audio now so the
    // completion chime is allowed when the model finishes some time later.
    primeCompletionAudio();

    useWorkspaceStore.getState().flush();
    const snapshot = runtime.snapshot();
    const controller = new AbortController();
    const runId = ++runSequence;
    activeRun = { id: runId, controller };

    const assistantDisplayId = makeId('assistant');
    set({
      runStatus: 'running',
      runStatusText: 'Syncing project…',
      error: null,
      messages: [
        ...state.messages,
        { id: makeId('user'), role: 'user', content: text, at: Date.now() },
        {
          id: assistantDisplayId,
          role: 'assistant',
          content: '',
          streaming: true,
          at: Date.now(),
        },
      ],
    });

    const toolMessages = new Map<string, string>();

    const addNotice = (content: string) => {
      set((current) => ({
        messages: [
          ...current.messages,
          { id: makeId('notice'), role: 'notice', content, at: Date.now() },
        ],
      }));
    };

    const addTool = (event: { id: string; name: string; summary: string; path?: string }) => {
      const displayId = makeId('tool');
      toolMessages.set(event.id, displayId);
      set((current) => ({
        messages: [
          ...current.messages,
          {
            id: displayId,
            role: 'tool',
            at: Date.now(),
            tool: {
              name: event.name,
              summary: event.summary,
              path: event.path,
              status: 'running',
            },
          },
        ],
      }));
    };

    const finishTool = (event: {
      id: string;
      name: string;
      status: 'ok' | 'error';
      detail?: string;
      path?: string;
    }) => {
      const displayId = toolMessages.get(event.id);
      if (!displayId) return;
      set((current) => ({
        messages: current.messages.map((message) =>
          message.role === 'tool' && message.id === displayId
            ? {
                ...message,
                tool: {
                  ...message.tool,
                  status: event.status,
                  detail: event.detail ?? message.tool.detail,
                  path: event.path ?? message.tool.path,
                },
              }
            : message
        ),
      }));
    };

    try {
      const result = await runHarnessTurn({
        prompt: text,
        conversationKey: conversationKey(),
        files: snapshot,
        signal: controller.signal,
        onEvent: (event) => {
          if (runId !== runSequence) return;
          if (event.type === 'status') {
            set({ runStatusText: event.message });
          } else if (event.type === 'tool') {
            addTool(event);
          } else if (event.type === 'tool-done') {
            finishTool(event);
          }
        },
      });

      if (runId !== runSequence) return;

      applyHarnessFiles(result.files, result.changedPaths);

      const changed = result.changedPaths.length > 0;
      const response =
        result.finalResponse.trim() ||
        (changed ? 'Done — the project has been updated.' : 'Done.');

      set((current) => ({
        runStatus: 'idle',
        runStatusText: null,
        messages: [
          ...finalizeStreaming(current.messages).map((message) => {
            if (message.role === 'assistant' && message.id === assistantDisplayId) {
              return { ...message, content: response, streaming: false };
            }
            if (message.role === 'tool' && message.tool.status === 'running') {
              return { ...message, tool: { ...message.tool, status: 'ok' as const } };
            }
            return message;
          }),
          { id: makeId('refresh'), role: 'refresh', at: Date.now() },
        ],
        ...(changed ? { undoSnapshot: snapshot, undoAvailable: true } : {}),
      }));

      if (result.skipped.length > 0) {
        addNotice(
          `Skipped ${result.skipped.length} non-text or oversized file${
            result.skipped.length === 1 ? '' : 's'
          } when mirroring back: ${result.skipped.slice(0, 3).join(', ')}${
            result.skipped.length > 3 ? '…' : ''
          }`
        );
      }

      if (result.changedPaths.length > 0) {
        runtime.log(
          'success',
          `Harness updated ${result.changedPaths.length} file${result.changedPaths.length === 1 ? '' : 's'}`
        );
      }
      playCompletionChime();
    } catch (error) {
      if (runId !== runSequence) return;

      const aborted =
        controller.signal.aborted ||
        (error instanceof DOMException && error.name === 'AbortError');
      const message = aborted
        ? 'Stopped.'
        : error instanceof Error
          ? error.message
          : String(error);

      set({
        runStatus: 'idle',
        runStatusText: null,
        error: aborted ? null : message,
        messages: finalizeStreaming(get().messages),
      });

      if (aborted) {
        addNotice('Stopped.');
      } else {
        set((current) => ({
          messages: [
            ...current.messages,
            { id: makeId('error'), role: 'error', content: message, at: Date.now() },
          ],
        }));
        runtime.log('error', `Harness: ${message}`);
      }
    } finally {
      if (activeRun?.id === runId) activeRun = null;
    }
  },

  stop: () => {
    activeRun?.controller.abort();
  },

  clear: () => {
    activeRun?.controller.abort();
    activeRun = null;
    runSequence += 1;
    set({
      runStatus: 'idle',
      runStatusText: null,
      messages: [],
      error: null,
      undoSnapshot: null,
      undoAvailable: false,
    });
  },

  restoreLastRun: async () => {
    const snapshot = get().undoSnapshot;
    if (!snapshot) return;

    activeRun?.controller.abort();
    activeRun = null;
    runSequence += 1;

    try {
      await runtime.replaceProject(snapshot);
      useWorkspaceStore.getState().loadFiles(snapshot);
      set((current) => ({
        undoSnapshot: null,
        undoAvailable: false,
        runStatus: 'idle',
        runStatusText: null,
        messages: [
          ...current.messages,
          {
            id: makeId('notice'),
            role: 'notice',
            content: 'Restored the project to its state before the last agent run.',
            at: Date.now(),
          },
        ],
      }));
      runtime.log('success', 'Agent changes reverted');
      useUiStore.getState().toast('Agent changes reverted');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      runtime.log('error', `Could not revert agent changes: ${message}`);
      useUiStore.getState().toast('Could not revert agent changes', 'error');
    }
  },
}));

export const selectAgentConfigured = (state: AgentState): boolean =>
  Boolean(state.harness?.configured);
