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

export interface ClaudeAgentStatus {
  configured: boolean;
  model: string;
  /** Anthropic-style endpoint the frontend agent calls with its Forge JWT. */
  proxyUrl: string;
  /** Upstream Anthropic-compatible base URL (server-side only). */
  upstreamBaseUrl: string;
  effort: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
}

export interface AgentStatusResponse {
  configured: boolean;
  provider: string;
  model: string;
  /** Same-origin REST proxy the browser agent calls with its Forge JWT. */
  proxyUrl: string;
  keySource: 'DEEPSEEK_API_KEY' | 'AGENT_API_KEY' | null;
  /** Legacy aliases kept for older clients. */
  defaultBaseUrl: string;
  defaultModel: string;
  /** Frontend Claude agent (Anthropic Messages API via the JWT proxy). */
  claude: ClaudeAgentStatus;
}

export type AgentEngine = 'claude' | 'deepseek';

/** Body accepted by POST /api/deepseek/chat/completions. */
export interface DeepSeekChatRequest {
  messages: AgentChatMessage[];
  tools?: AgentToolDefinition[];
  tool_choice?: 'auto' | 'none' | 'required';
  model?: string;
  temperature?: number;
  stream?: boolean;
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

