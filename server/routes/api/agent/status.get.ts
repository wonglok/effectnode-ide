import { defineEventHandler } from 'h3';
import { CLAUDE_AGENT, CLAUDE_ANTHROPIC_UPSTREAM } from '../../../../shared/claude';
import type { AgentStatusResponse } from '../../../../shared/types';
import { authGuard } from '../../../utils/auth';

function credential(): {
  key: string;
  keySource: AgentStatusResponse['keySource'];
} {
  const candidates: Array<[AgentStatusResponse['keySource'], string | undefined]> = [
    ['DEEPSEEK_API_KEY', process.env.DEEPSEEK_API_KEY],
    ['AGENT_API_KEY', process.env.AGENT_API_KEY],
  ];
  for (const [keySource, value] of candidates) {
    const key = (value ?? '').trim();
    if (key) return { key, keySource };
  }
  return { key: '', keySource: null };
}

export default defineEventHandler(async (event) => {
  const denied = await authGuard(event);
  if (denied) return denied;

  const { key, keySource } = credential();
  const model =
    process.env.DEEPSEEK_MODEL?.trim() ||
    process.env.AGENT_MODEL?.trim() ||
    'deepseek-flash';

  return {
    configured: Boolean(key),
    provider: 'deepseek',
    model,
    proxyUrl: '/api/deepseek/chat/completions',
    keySource,
    defaultBaseUrl: '/api/deepseek/chat/completions',
    defaultModel: model,
    claude: {
      // The Anthropic proxy deliberately does not use the OpenAI fallback.
      configured: Boolean(
        process.env.DEEPSEEK_API_KEY?.trim() ||
          process.env.AGENT_API_KEY?.trim()
      ),
      model: CLAUDE_AGENT.model,
      proxyUrl: CLAUDE_AGENT.proxyUrl,
      upstreamBaseUrl:
        process.env.DEEPSEEK_ANTHROPIC_BASE_URL?.trim() ||
        CLAUDE_ANTHROPIC_UPSTREAM,
      effort: CLAUDE_AGENT.effort,
    },
  };
});
