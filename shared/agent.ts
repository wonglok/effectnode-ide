/**
 * Browser Claude Messages harness settings shared by the frontend and the
 * Nitro transport.
 *
 * The agent loop and every tool run in this tab through the official
 * `@anthropic-ai/sdk`. The SDK sends Anthropic Messages requests through the
 * same-origin JWT route; the Nitro server inserts the provider credential and
 * forwards the stream, so no API key reaches the browser.
 */
export const CLAUDE_AGENT = {
  provider: 'anthropic',
  api: 'anthropic-messages',
  harness: 'claude-messages-sdk',
  /** Same-origin JWT proxy; the browser never talks to DeepSeek directly. */
  baseUrl: '/api/anthropic',
  /** Every tool call is auto-approved; a run never pauses for permission. */
  permissionMode: 'allow-all',
  apiVersion: '2023-06-01',
  model: 'deepseek-flash[1m]',
  /** Adaptive-thinking models map this to output_config.effort. */
  effort: 'high',
  /** Budget-based providers use this share of the response cap for thinking. */
  thinkingBudgetTokens: 7168,
  maxContextTokens: 500_000,
  /** Start dropping the oldest turns once the transcript passes this budget. */
  autoCompactWindow: 400_000,
  /** Response cap per step; the thinking budget must fit inside it. */
  maxTokens: 8192,
  maxSteps: 100,
} as const;

/** DeepSeek's Anthropic-compatible endpoint. */
export const CLAUDE_ANTHROPIC_UPSTREAM = 'https://api.deepseek.com/anthropic';

/** Claude 4.6+ models use adaptive thinking instead of a token budget. */
export function usesAdaptiveThinking(model: string): boolean {
  return /^claude-(fable|mythos|opus-(?:4\.[678]|5)|sonnet-(?:4\.6|5)|haiku-5)/.test(
    model,
  );
}

/** Rough chars-per-token used for the client-side compaction guard. */
const CHARS_PER_TOKEN = 4;

export function autoCompactCharBudget(): number {
  return CLAUDE_AGENT.autoCompactWindow * CHARS_PER_TOKEN;
}
