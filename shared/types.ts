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

export interface AgentThinkingBlock {
  thinking: string;
  signature?: string;
}

export interface AgentChatMessage {
  role: AgentRole;
  content: string | null;
  name?: string;
  tool_calls?: AgentToolCall[];
  tool_call_id?: string;
  /** Anthropic extended-thinking text replayed on the next tool turn. */
  thinking?: string;
  /** Opaque signature the provider attaches to a thinking block, when present. */
  thinking_signature?: string;
  /** Full ordered thinking blocks, including each block's signature. */
  thinking_blocks?: AgentThinkingBlock[];
  /** Whether a persisted tool result was an error. */
  is_error?: boolean;
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
  provider: 'anthropic';
  api: 'anthropic-messages';
  harness: 'claude-messages-sdk';
  model: string;
  effort: string;
  permissionMode: 'allow-all';
  proxy: string;
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

