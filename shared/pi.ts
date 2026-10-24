/**
 * Browser Pi harness settings shared by the frontend and the Nitro transport.
 *
 * `@earendil-works/pi-coding-agent` embeds Pi in a Node/Bun process; its SDK
 * creates file-backed sessions and executes native tools. Forge runs the
 * browser-safe Pi primitives instead — `@earendil-works/pi-agent-core` for the
 * Agent loop/session and `@earendil-works/pi-ai` for the Anthropic-style
 * transport. The server inserts the provider key behind this JWT route.
 */
export const PI_AGENT = {
  provider: 'pi',
  api: 'anthropic-messages',
  harness: 'pi-agent-core',
  /** Relative to the app origin; pi-ai appends /v1/messages. */
  baseUrl: '/api/anthropic',
  apiVersion: '2023-06-01',
  model: 'deepseek-flash[1m]',
  thinkingLevel: 'medium',
  maxContextTokens: 500_000,
  /** Start dropping the oldest turns once the transcript passes this budget. */
  autoCompactWindow: 400_000,
  /** Response cap per step; the thinking budget must fit inside it. */
  maxTokens: 8192,
  maxSteps: 100,
} as const;

/** DeepSeek's Anthropic-compatible endpoint. */
export const PI_ANTHROPIC_UPSTREAM = 'https://api.deepseek.com/anthropic';

/** Rough chars-per-token used for the client-side compaction guard. */
const CHARS_PER_TOKEN = 4;

export function autoCompactCharBudget(): number {
  return PI_AGENT.autoCompactWindow * CHARS_PER_TOKEN;
}
