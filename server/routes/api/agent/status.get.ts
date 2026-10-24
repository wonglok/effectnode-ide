import { defineEventHandler } from 'h3';
import { PI_AGENT } from '../../../../shared/pi';
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
    provider: PI_AGENT.provider,
    api: PI_AGENT.api,
    harness: PI_AGENT.harness,
    model: PI_AGENT.model,
    thinkingLevel: PI_AGENT.thinkingLevel,
    keySource,
  } satisfies AgentStatusResponse;
});
