import { defineEventHandler } from 'h3';
import { authGuard } from '../../utils/auth';

export default defineEventHandler(async (event) => {
  const denied = await authGuard(event);
  if (denied) return denied;

  return {
    ok: true,
    service: 'forge',
    version: '0.1.0',
    time: new Date().toISOString(),
  };
});
