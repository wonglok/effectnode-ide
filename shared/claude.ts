/**
 * Claude agent settings shared by the browser loop and the Nitro proxy.
 *
 * Mirrors the Claude Code environment block:
 *   ANTHROPIC_BASE_URL              → this app's JWT proxy
 *   ANTHROPIC_MODEL                 → deepseek-flash[1m]
 *   ANTHROPIC_DEFAULT_OPUS_MODEL    → deepseek-v4-pro[1m]
 *   ANTHROPIC_DEFAULT_SONNET_MODEL  → deepseek-v4-pro[1m]
 *   ANTHROPIC_DEFAULT_HAIKU_MODEL   → deepseek-flash
 *   CLAUDE_CODE_SUBAGENT_MODEL      → deepseek-flash
 *   CLAUDE_CODE_EFFORT_LEVEL        → high
 *   CLAUDE_CODE_MAX_CONTEXT_TOKENS  → 500000
 *   CLAUDE_CODE_AUTO_COMPACT_WINDOW → 400000
 *   CLAUDE_REMOTE_CONTROL_SESSION_NAME_PREFIX → claudetypscript
 *
 * The agent itself runs in the browser. The proxy holds ANTHROPIC_AUTH_TOKEN
 * (the DeepSeek credential) and accepts the Forge JWT instead.
 */
export const CLAUDE_AGENT = {
  /** Relative to the app origin; the Anthropic SDK appends /v1/messages. */
  baseUrl: '/api/anthropic',
  proxyUrl: '/api/anthropic/v1/messages',
  apiVersion: '2023-06-01',
  model: 'deepseek-flash[1m]',
  opusModel: 'deepseek-v4-pro[1m]',
  sonnetModel: 'deepseek-v4-pro[1m]',
  haikuModel: 'deepseek-flash',
  subagentModel: 'deepseek-flash',
  effort: 'high' as const,
  maxContextTokens: 500_000,
  /** Start dropping the oldest turns once the transcript passes this budget. */
  autoCompactWindow: 400_000,
  sessionNamePrefix: 'claudetypscript',
  /** Response cap per step; the thinking budget must fit inside it. */
  maxTokens: 8192,
  thinkingBudget: 4096,
} as const;

/** DeepSeek's Anthropic-compatible endpoint. */
export const CLAUDE_ANTHROPIC_UPSTREAM = 'https://api.deepseek.com/anthropic';

/** Rough chars-per-token used for the client-side compaction guard. */
const CHARS_PER_TOKEN = 4;

export function autoCompactCharBudget(): number {
  return CLAUDE_AGENT.autoCompactWindow * CHARS_PER_TOKEN;
}
