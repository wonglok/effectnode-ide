import { create } from 'zustand';
import { runtime, type LogEntry, type LogLevel, type RuntimeStatus } from '@/lib/runtime';

interface RuntimeState {
  status: RuntimeStatus;
  statusMessage: string;
  logs: LogEntry[];
  previewUrl: string;
  previewPort: number;
  previewKey: number;
  lastHmrPath: string | null;
  lastHmrAt: number;
  boot: (files: Record<string, string>) => Promise<void>;
  retryPreview: () => Promise<void>;
  addLog: (level: LogLevel, message: string) => void;
  clearLogs: () => void;
  reloadPreview: () => void;
  attachPreview: (target: Window | null) => void;
}

const MAX_LOGS = 400;

export const useRuntimeStore = create<RuntimeState>((set) => ({
  status: 'idle',
  statusMessage: '',
  logs: [],
  previewUrl: '',
  previewPort: runtime.previewPort,
  previewKey: 0,
  lastHmrPath: null,
  lastHmrAt: 0,

  boot: async (files) => {
    try {
      await runtime.boot(files);
      set({ previewUrl: runtime.previewUrl });
    } catch {
      // The runtime emits a status + log event; nothing else to do here.
    }
  },

  retryPreview: async () => {
    try {
      await runtime.retryPreview();
      set({ previewUrl: runtime.previewUrl });
    } catch {
      // Status and logs are emitted by the runtime.
    }
  },

  addLog: (level, message) => {
    set((state) => ({
      logs: [
        ...state.logs.slice(-(MAX_LOGS - 1)),
        { id: Date.now() + Math.random(), time: Date.now(), level, message },
      ],
    }));
  },

  clearLogs: () => set({ logs: [] }),

  reloadPreview: () => {
    runtime.requestPreviewReload();
  },

  attachPreview: (target) => {
    runtime.attachPreview(target);
  },
}));

function pushLog(entry: LogEntry) {
  useRuntimeStore.setState((state) => ({
    logs: [...state.logs.slice(-(MAX_LOGS - 1)), entry],
  }));
}

let lastHmrLogAt = 0;

const unsubscribe = runtime.subscribe((event) => {
  switch (event.type) {
    case 'status': {
      useRuntimeStore.setState({ status: event.status, statusMessage: event.message ?? '' });
      break;
    }
    case 'log': {
      pushLog(event.entry);
      break;
    }
    case 'ready': {
      useRuntimeStore.setState({
        status: 'ready',
        statusMessage: '',
        previewUrl: event.url,
        previewKey: useRuntimeStore.getState().previewKey + 1,
      });
      break;
    }
    case 'restarted': {
      useRuntimeStore.setState({
        previewUrl: event.url,
        previewKey: useRuntimeStore.getState().previewKey + 1,
      });
      break;
    }
    case 'reload': {
      useRuntimeStore.setState({ previewKey: useRuntimeStore.getState().previewKey + 1 });
      break;
    }
    case 'hmr': {
      const now = Date.now();
      useRuntimeStore.setState({ lastHmrPath: event.path, lastHmrAt: now });
      if (event.kind === 'full-reload' || now - lastHmrLogAt > 900) {
        lastHmrLogAt = now;
        pushLog({
          id: now + Math.random(),
          time: now,
          level: 'hmr',
          message: `${event.kind === 'full-reload' ? 'Full reload' : 'HMR update'} · ${event.path}`,
        });
      }
      break;
    }
    case 'error': {
      useRuntimeStore.setState({ status: 'error', statusMessage: event.message });
      break;
    }
  }
});

if (import.meta.hot) {
  import.meta.hot.dispose(() => unsubscribe());
}

// A tiny helper used by the top bar's "restart" action.
export async function restartWithFiles(files: Record<string, string>): Promise<void> {
  // replaceProject emits 'restarted', which updates previewUrl + previewKey.
  await runtime.replaceProject(files);
}

