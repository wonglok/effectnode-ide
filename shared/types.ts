/** Types shared by the React client and the Nitro API routes. */

export interface HealthResponse {
  ok: boolean;
  service: string;
  version: string;
  time: string;
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
  /** Anthropic extended-thinking text replayed on the next tool turn. */
  thinking?: string;
  /** Opaque signature DeepSeek attaches to a thinking block, when present. */
  thinking_signature?: string;
}

export interface AgentToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface AgentStatusResponse {
  configured: boolean;
  provider: 'pi';
  api: 'anthropic-messages';
  harness: 'pi-agent-core';
  model: string;
  thinkingLevel: string;
  keySource: 'DEEPSEEK_API_KEY' | 'AGENT_API_KEY' | null;
}

/* ── Frontend agent plan ────────────────────────────────────── */

export type AgentTodoStatus = 'pending' | 'in_progress' | 'completed';

export interface AgentTodoItem {
  content: string;
  status: AgentTodoStatus;
}

/** Whether the UI needs a password and whether this browser has unlocked it. */
export interface AuthStatusResponse {
  required: boolean;
  unlocked: boolean;
  /** Present when an unlock attempt was rejected. */
  message?: string;
  /** Issued by a successful POST /api/auth; stored by the client. */
  token?: string;
}

