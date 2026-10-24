/** Types shared by the React client and the Nitro API routes. */

export interface ProjectMeta {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  fileCount: number;
}

export interface ProjectSnapshot extends ProjectMeta {
  files: Record<string, string>;
}

export interface ProjectListResponse {
  projects: ProjectMeta[];
}

export interface SaveProjectPayload {
  id?: string;
  name: string;
  files: Record<string, string>;
}

export interface HealthResponse {
  ok: boolean;
  service: string;
  version: string;
  time: string;
}

export interface DeleteResponse {
  ok: boolean;
  id: string;
}

/* ── Agent ─────────────────────────────────────────────────── */

export type AgentRole = 'system' | 'user' | 'assistant' | 'tool';

export interface AgentToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface AgentChatMessage {
  role: AgentRole;
  content: string | null;
  name?: string;
  tool_calls?: AgentToolCall[];
  tool_call_id?: string;
}

export interface AgentToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface AgentProxyRequest {
  messages: AgentChatMessage[];
  tools: AgentToolDefinition[];
  model?: string;
  baseUrl?: string;
}

export interface HarnessStatus {
  configured: boolean;
  provider: string;
  model: string;
  reasoningEffort: string | null;
  maxTokens: number | null;
  /** Server env var the runtime will read the credential from. */
  keySource: 'DEEPSEEK_API_KEY' | 'AGENT_API_KEY' | 'OPENAI_API_KEY' | null;
}

export interface AgentStatusResponse {
  configured: boolean;
  defaultBaseUrl: string;
  defaultModel: string;
  /** DeepSeek Harness SDK runtime (server-side subprocess) settings. */
  harness: HarnessStatus;
}

/* ── DeepSeek Harness SDK turns ─────────────────────────────── */

export interface HarnessTurnRequest {
  /** The user's new instruction for this turn. */
  prompt: string;
  /**
   * Stable conversation identity (derived from the project). The server maps it
   * to one harness session and one mirrored workspace directory.
   */
  conversationKey: string;
  /** The whole virtual project, as absolute virtual paths. */
  files: Record<string, string>;
}

export interface HarnessTurnResult {
  finalResponse: string;
  /** The project after the agent's tools ran, as absolute virtual paths. */
  files: Record<string, string>;
  changedPaths: string[];
  /** Paths the server could not mirror back (binary or over the size cap). */
  skipped: string[];
  sessionId: string;
}

export type HarnessTodoStatus = 'pending' | 'in_progress' | 'completed';

export interface HarnessTodoItem {
  content: string;
  status: HarnessTodoStatus;
}

/** One newline-delimited progress frame from POST /api/harness. */
export type HarnessStreamEvent =
  | { type: 'status'; message: string }
  | { type: 'tool'; id: string; name: string; summary: string; path?: string }
  | {
      type: 'tool-done';
      id: string;
      name: string;
      status: 'ok' | 'error';
      detail?: string;
      path?: string;
    }
  | { type: 'todo'; todos: HarnessTodoItem[] }
  | ({ type: 'result' } & HarnessTurnResult)
  | { type: 'error'; message: string };

/** Whether the UI needs a password and whether this browser has unlocked it. */
export interface AuthStatusResponse {
  required: boolean;
  unlocked: boolean;
  /** Present when an unlock attempt was rejected. */
  message?: string;
  /** Issued by a successful POST /api/auth; stored by the client. */
  token?: string;
}

