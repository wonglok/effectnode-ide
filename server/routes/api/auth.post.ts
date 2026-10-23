import { defineEventHandler, readBody } from 'h3';
import { authStatus, grantUnlock, isAuthRequired, verifyPassword } from '../../utils/auth';

export default defineEventHandler(async (event) => {
  if (!isAuthRequired()) return authStatus(event);

  const body = await readBody<{ password?: unknown }>(event).catch(() => null);
  const candidate = body && typeof body.password === 'string' ? body.password : '';

  if (!verifyPassword(candidate)) {
    // A small pause blunts trivial guessing without needing a throttle store.
    await new Promise((resolve) => setTimeout(resolve, 300));
    // Deliberately a 200 with a rejected status: Nitro 3's Vite dev layer
    // re-dispatches an already-read POST body on non-2xx responses and crashes.
    return { required: true, unlocked: false, message: 'Incorrect password' };
  }

  grantUnlock(event);
  // The request's cookies do not include the one just set, so report it here.
  return { required: true, unlocked: true };
});
