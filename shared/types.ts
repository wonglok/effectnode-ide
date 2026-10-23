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

export interface AgentStatusResponse {
  configured: boolean;
  defaultBaseUrl: string;
  defaultModel: string;
}

/** Whether the UI needs a password and whether this browser has unlocked it. */
export interface AuthStatusResponse {
  required: boolean;
  unlocked: boolean;
  /** Present when an unlock attempt was rejected. */
  message?: string;
}

