import { create } from "zustand";
import {
  cancelVercelMcpConnect,
  connectVercelMcp,
  disconnectVercelMcp,
  hasVercelMcpSession,
} from "@/lib/mcp-oauth";
import {
  loadVercelMcpTools,
  resetVercelMcp,
  type VercelMcpTool,
} from "@/lib/mcp-client";
import { useUiStore } from "./ui";

export type McpStatus = "disconnected" | "connecting" | "connected" | "error";

interface McpState {
  status: McpStatus;
  tools: VercelMcpTool[];
  error: string | null;
  initialized: boolean;
  /** Restore a stored Vercel session and load its tool list once per page. */
  init: () => Promise<void>;
  /** Run the interactive OAuth flow and connect the MCP session. */
  connect: () => Promise<void>;
  /** Abort a sign-in that is waiting on the Vercel popup. */
  cancelConnect: () => void;
  disconnect: () => Promise<void>;
  refreshTools: () => Promise<void>;
}

let initPromise: Promise<void> | null = null;
let connectPromise: Promise<void> | null = null;

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export const useMcpStore = create<McpState>((set, get) => ({
  status: "disconnected",
  tools: [],
  error: null,
  initialized: false,

  init: async () => {
    if (get().initialized) return;
    if (initPromise) return initPromise;

    set({ initialized: true });
    if (!hasVercelMcpSession()) return;

    initPromise = (async () => {
      set({ status: "connecting", error: null });
      try {
        const tools = await loadVercelMcpTools();
        set({ status: "connected", tools, error: null });
      } catch (error) {
        set({ status: "error", error: messageOf(error) });
      }
    })().finally(() => {
      initPromise = null;
    });

    return initPromise;
  },

  connect: async () => {
    if (connectPromise) return connectPromise;
    if (get().status === "connected") return;

    set({ status: "connecting", error: null });

    connectPromise = (async () => {
      try {
        resetVercelMcp();
        await connectVercelMcp();
        const tools = await loadVercelMcpTools();
        set({ status: "connected", tools, error: null });
        useUiStore
          .getState()
          .toast(
            `Vercel MCP connected · ${tools.length} tool${
              tools.length === 1 ? "" : "s"
            }`,
          );
      } catch (error) {
        const message = messageOf(error);
        const cancelled = message.toLowerCase().includes("cancelled");
        resetVercelMcp();
        set({
          status: cancelled ? "disconnected" : "error",
          error: cancelled ? null : message,
          tools: [],
        });
        if (!cancelled) useUiStore.getState().toast(message, "error");
      }
    })().finally(() => {
      connectPromise = null;
    });

    return connectPromise;
  },

  cancelConnect: () => {
    cancelVercelMcpConnect();
  },

  disconnect: async () => {
    resetVercelMcp();
    set({ status: "disconnected", tools: [], error: null });
    await disconnectVercelMcp();
    useUiStore.getState().toast("Vercel MCP disconnected");
  },

  refreshTools: async () => {
    if (!hasVercelMcpSession()) return;
    try {
      const tools = await loadVercelMcpTools();
      set({ status: "connected", tools, error: null });
    } catch (error) {
      set({ status: "error", error: messageOf(error) });
    }
  },
}));
