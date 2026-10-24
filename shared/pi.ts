import { CLAUDE_AGENT } from './claude';

/**
 * Browser Pi harness settings.
 *
 * `@earendil-works/pi-coding-agent` embeds Pi in a Node/Bun process; its SDK
 * creates file-backed sessions and executes native tools. Forge runs the
 * browser-safe Pi primitives instead — `@earendil-works/pi-agent-core` for the
 * Agent loop/session and `@earendil-works/pi-ai` for the Anthropic-style
 * transport — against the same JWT proxy as the Claude engine.
 */
export const PI_AGENT = {
  provider: 'pi',
  api: 'anthropic-messages',
  harness: 'pi-agent-core',
  model: CLAUDE_AGENT.model,
  thinkingLevel: 'medium',
  proxyUrl: CLAUDE_AGENT.proxyUrl,
  baseUrl: CLAUDE_AGENT.baseUrl,
  maxSteps: 100,
} as const;
