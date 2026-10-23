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
export type MainView = "code" | "agent";

export interface TerminalLine {
  id: number;
  kind: "command" | "output" | "error" | "muted";
  text: string;
}

let toastSequence = 0;
let terminalSequence = 0;

interface UiState {
  explorerOpen: boolean;
  terminalOpen: boolean;
  terminalTab: TerminalTab;
  mainView: MainView;
  previewRatio: number;
  terminalHeight: number;
  projectsOpen: boolean;
  shortcutsOpen: boolean;
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
  setTerminalOpen: (open: boolean) => void;
  toggleTerminal: () => void;
  setTerminalTab: (tab: TerminalTab) => void;
  setMainView: (view: MainView) => void;
  setPreviewRatio: (ratio: number) => void;
  setTerminalHeight: (height: number) => void;
  setProjectsOpen: (open: boolean) => void;
  setShortcutsOpen: (open: boolean) => void;
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
      explorerOpen: true,
      terminalOpen: true,
      terminalTab: "console",
      mainView: "code",
      previewRatio: 0.42,
      terminalHeight: 176,
      projectsOpen: false,
      shortcutsOpen: false,
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
      setTerminalOpen: (open) => set({ terminalOpen: open }),
      toggleTerminal: () =>
        set((state) => ({
          terminalOpen: !state.terminalOpen,
          // The terminal lives in the code view, so reveal it either way.
          mainView: "code",
        })),
      setTerminalTab: (tab) =>
        set({ terminalTab: tab, terminalOpen: true, mainView: "code" }),
      setMainView: (view) => set({ mainView: view }),
      setPreviewRatio: (ratio) =>
        set({ previewRatio: clamp(ratio, 0.24, 0.72) }),
      setTerminalHeight: (height) =>
        set({ terminalHeight: clamp(height, 110, 420) }),
      setProjectsOpen: (open) => set({ projectsOpen: open }),
      setShortcutsOpen: (open) => set({ shortcutsOpen: open }),
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
      partialize: (state) => ({
        explorerOpen: state.explorerOpen,
        terminalOpen: state.terminalOpen,
        terminalTab: state.terminalTab,
        mainView: state.mainView,
        previewRatio: state.previewRatio,
        terminalHeight: state.terminalHeight,
      }),
    },
  ),
);
