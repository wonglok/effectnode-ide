import { defineEventHandler } from 'h3';
import { CLAUDE_AGENT } from '../../../../shared/agent';
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

  return {
    configured: Boolean(key),
    provider: CLAUDE_AGENT.provider,
    api: CLAUDE_AGENT.api,
    harness: CLAUDE_AGENT.harness,
    model: CLAUDE_AGENT.model,
    effort: CLAUDE_AGENT.effort,
    permissionMode: CLAUDE_AGENT.permissionMode,
    proxy: CLAUDE_AGENT.baseUrl,
    keySource,
  } satisfies AgentStatusResponse;
});
