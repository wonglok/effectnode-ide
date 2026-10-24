import { defineEventHandler } from 'h3';
import { authGuard } from '../../../utils/auth';
import { harnessStatus } from '../../../utils/harness';

export default defineEventHandler(async (event) => {
  const denied = await authGuard(event);
  if (denied) return denied;

  const harness = harnessStatus();

  return {
    // The browser agent now runs through the DeepSeek Harness SDK; this flag
    // tells the UI whether the server can launch it.
    configured: harness.configured,
    defaultBaseUrl: process.env.AGENT_BASE_URL || 'https://api.deepseek.com',
    defaultModel: harness.model,
    harness,
  };
});
