import { create } from "zustand";
import { persist } from "zustand/middleware";

export type ToastTone = "info" | "success" | "error";

export interface Toast {
  id: number;
  message: string;
  tone: ToastTone;
}

export interface PromptRequest {
  title: string;
  label: string;
  initialValue: string;
  placeholder?: string;
  confirmLabel?: string;
  onConfirm: (value: string) => void;
}

export interface ConfirmRequest {
  title: string;
  message: string;
  confirmLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
}

export type TerminalTab = "terminal" | "console";

export interface TerminalLine {
  id: number;
  kind: "command" | "output" | "error" | "muted";
  text: string;
}

let toastSequence = 0;
let terminalSequence = 0;

interface UiState {
  explorerOpen: boolean;
  chatOpen: boolean;
  terminalOpen: boolean;
  terminalTab: TerminalTab;
  agentWidth: number;
  previewRatio: number;
  /** Preview share of the stage when only the chat column is open. */
  chatOnlyPreviewRatio: number;
  terminalHeight: number;
  shortcutsOpen: boolean;
  projectSwitcherOpen: boolean;
  prompt: PromptRequest | null;
  confirm: ConfirmRequest | null;
  toasts: Toast[];
  terminalLines: TerminalLine[];
  terminalCwd: string;
  commandHistory: string[];

  toast: (message: string, tone?: ToastTone) => void;
  dismissToast: (id: number) => void;
  setExplorerOpen: (open: boolean) => void;
  toggleExplorer: () => void;
  setChatOpen: (open: boolean) => void;
  toggleChat: () => void;
  setTerminalOpen: (open: boolean) => void;
  toggleTerminal: () => void;
  setTerminalTab: (tab: TerminalTab) => void;
  setAgentWidth: (width: number) => void;
  setPreviewRatio: (ratio: number) => void;
  setChatOnlyPreviewRatio: (ratio: number) => void;
  setTerminalHeight: (height: number) => void;
  setShortcutsOpen: (open: boolean) => void;
  setProjectSwitcherOpen: (open: boolean) => void;
  openPrompt: (request: PromptRequest) => void;
  closePrompt: () => void;
  openConfirm: (request: ConfirmRequest) => void;
  closeConfirm: () => void;
  addTerminalLine: (kind: TerminalLine["kind"], text: string) => void;
  clearTerminal: () => void;
  setTerminalCwd: (cwd: string) => void;
  pushCommandHistory: (command: string) => void;
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

export const useUiStore = create<UiState>()(
  persist(
    (set, get) => ({
      explorerOpen: false,
      chatOpen: true,
      terminalOpen: true,
      terminalTab: "console",
      agentWidth: 380,
      previewRatio: 0.42,
      chatOnlyPreviewRatio: 0.725,
      terminalHeight: 176,
      shortcutsOpen: false,
      projectSwitcherOpen: false,
      prompt: null,
      confirm: null,
      toasts: [],
      terminalLines: [
        {
          id: ++terminalSequence,
          kind: "muted",
          text: "Forge shell — type 'help' to see available commands.",
        },
      ],
      terminalCwd: "/",
      commandHistory: [],

      toast: (message, tone = "success") => {
        const id = ++toastSequence;
        set((state) => ({
          toasts: [...state.toasts.slice(-3), { id, message, tone }],
        }));
        window.setTimeout(() => get().dismissToast(id), 3400);
      },

      dismissToast: (id) => {
        set((state) => ({
          toasts: state.toasts.filter((toast) => toast.id !== id),
        }));
      },

      setExplorerOpen: (open) => set({ explorerOpen: open }),
      toggleExplorer: () =>
        set((state) => ({ explorerOpen: !state.explorerOpen })),
      setChatOpen: (open) => set({ chatOpen: open }),
      toggleChat: () => set((state) => ({ chatOpen: !state.chatOpen })),
      setTerminalOpen: (open) => set({ terminalOpen: open }),
      toggleTerminal: () =>
        set((state) => ({ terminalOpen: !state.terminalOpen })),
      setTerminalTab: (tab) => set({ terminalTab: tab, terminalOpen: true }),
      setAgentWidth: (width) =>
        set({ agentWidth: clamp(width, 280, 560) }),
      setPreviewRatio: (ratio) =>
        set({ previewRatio: clamp(ratio, 0.24, 0.72) }),
      setChatOnlyPreviewRatio: (ratio) =>
        set({ chatOnlyPreviewRatio: clamp(ratio, 0.4, 0.85) }),
      setTerminalHeight: (height) =>
        set({ terminalHeight: clamp(height, 110, 420) }),
      setShortcutsOpen: (open) => set({ shortcutsOpen: open }),
      setProjectSwitcherOpen: (open) => set({ projectSwitcherOpen: open }),
      openPrompt: (request) => set({ prompt: request }),
      closePrompt: () => set({ prompt: null }),
      openConfirm: (request) => set({ confirm: request }),
      closeConfirm: () => set({ confirm: null }),

      addTerminalLine: (kind, text) => {
        set((state) => ({
          terminalLines: [
            ...state.terminalLines.slice(-299),
            { id: ++terminalSequence, kind, text },
          ],
        }));
      },
      clearTerminal: () => set({ terminalLines: [] }),
      setTerminalCwd: (cwd) => set({ terminalCwd: cwd }),
      pushCommandHistory: (command) => {
        set((state) => ({
          commandHistory: [
            ...state.commandHistory
              .filter((entry) => entry !== command)
              .slice(-49),
            command,
          ],
        }));
      },
    }),
    {
      name: "forge.ui",
      // v2: the explorer + editor + terminal column starts collapsed.
      // v3: the default open view is chat-only, chat at ~27.5% width.
      version: 3,
      migrate: (persisted, version) => {
        const state = (persisted ?? {}) as Record<string, unknown>;
        if (version < 2) state.explorerOpen = false;
        if (version < 3) {
          state.explorerOpen = false;
          state.chatOpen = true;
          state.chatOnlyPreviewRatio = 0.725;
        }
        return state as unknown as UiState;
      },
      partialize: (state) => ({
        explorerOpen: state.explorerOpen,
        chatOpen: state.chatOpen,
        terminalOpen: state.terminalOpen,
        terminalTab: state.terminalTab,
        agentWidth: state.agentWidth,
        previewRatio: state.previewRatio,
        chatOnlyPreviewRatio: state.chatOnlyPreviewRatio,
        terminalHeight: state.terminalHeight,
      }),
    },
  ),
);
