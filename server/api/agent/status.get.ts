import { defineEventHandler } from 'h3';
import type { AgentStatusResponse } from '../../../shared/types';

export default defineEventHandler((): AgentStatusResponse => ({
  configured: Boolean(process.env.AGENT_API_KEY || process.env.OPENAI_API_KEY),
  defaultBaseUrl: process.env.AGENT_BASE_URL || 'https://api.openai.com/v1',
  defaultModel: process.env.AGENT_MODEL || 'gpt-4o-mini',
}));
