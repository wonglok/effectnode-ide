/** The browser-stored JWT issued after the FORGE_PASSWORD check. */
export const AUTH_TOKEN_KEY = 'sandbox-ide-jwt';

/** Fired when an API rejects the token so the UI can return to the gate. */
export const AUTH_CHANGED_EVENT = 'forge:auth-changed';

function storage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readAuthToken(): string | null {
  try {
    const token = storage()?.getItem(AUTH_TOKEN_KEY)?.trim();
    return token ? token : null;
  } catch {
    return null;
  }
}

export function writeAuthToken(token: string): void {
  const value = token.trim();
  if (!value) return;
  try {
    storage()?.setItem(AUTH_TOKEN_KEY, value);
  } catch {
    // Storage can be unavailable in private or hardened browser contexts.
  }
}

export function clearAuthToken(): void {
  try {
    storage()?.removeItem(AUTH_TOKEN_KEY);
  } catch {
    // Nothing to clear.
  }
}

/** Authorization header for every protected REST request. */
export function authHeaders(): Record<string, string> {
  const token = readAuthToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export function notifyAuthChanged(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(AUTH_CHANGED_EVENT));
}

/**
 * Clear an invalid token and let the auth gate re-check the session.
 *
 * The header matters: an upstream provider can also answer 401/403, and that
 * must not log the user out of Forge.
 */
export function handleUnauthorized(response: Response): void {
  if (response.headers.get('x-forge-auth') !== 'required') return;
  clearAuthToken();
  notifyAuthChanged();
}
