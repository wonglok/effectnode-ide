/**
 * OAuth 2.1 (PKCE) for the Vercel MCP server.
 *
 * Vercel publishes protected-resource metadata for https://mcp.vercel.com and
 * supports dynamic client registration, so the browser registers itself as a
 * public client and never needs a pre-shared client secret. The authorization
 * code is delivered to a popup pointed at `/?mcp=callback`, which forwards it
 * to the opener; the opener exchanges it here.
 *
 * Tokens live in localStorage beside the Forge JWT. They are only sent to the
 * same-origin MCP proxy, which forwards them to mcp.vercel.com.
 */

export const VERCEL_MCP_URL = 'https://mcp.vercel.com/';

const REGISTER_URL = 'https://api.vercel.com/login/oauth/register';
const AUTHORIZE_URL = 'https://vercel.com/oauth/authorize';
const TOKEN_URL = 'https://api.vercel.com/login/oauth/token';
const REVOKE_URL = 'https://api.vercel.com/login/oauth/token/revoke';

const SCOPES = 'openid profile offline_access';
const CLIENT_NAME = 'Forge Sandbox';
const POPUP_NAME = 'forge-vercel-mcp';
const AUTH_TIMEOUT_MS = 5 * 60_000;

const CLIENT_KEY = 'forge.vercelMcpClient.v1';
const TOKENS_KEY = 'forge.vercelMcpTokens.v1';
const PENDING_KEY = 'forge.vercelMcpPending.v1';

/**
 * Vercel's authorize page sends COOP `restrict-properties`, which severs
 * `window.opener` before the popup returns to us. Same-origin channels still
 * work, so the callback reports through BroadcastChannel with a localStorage
 * fallback (its `storage` event reaches the opener too).
 */
const CALLBACK_CHANNEL = 'forge:mcp-oauth';
const CALLBACK_KEY = 'forge.vercelMcpCallback.v1';

export interface VercelMcpClient {
  client_id: string;
  redirect_uri: string;
  created_at: string;
}

export interface VercelMcpTokens {
  access_token: string;
  refresh_token?: string;
  token_type?: string;
  scope?: string;
  expires_at: number;
}

interface PendingAuth {
  verifier: string;
  state: string;
  redirectUri: string;
  clientId: string;
  createdAt: number;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  token_type?: string;
  scope?: string;
  expires_in?: number;
}

function storage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function sessionStorageSafe(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function readJson<T>(store: Storage | null, key: string): T | null {
  try {
    const raw = store?.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(store: Storage | null, key: string, value: unknown): void {
  try {
    store?.setItem(key, JSON.stringify(value));
  } catch {
    // Storage can be unavailable in private or hardened contexts.
  }
}

function removeKey(store: Storage | null, key: string): void {
  try {
    store?.removeItem(key);
  } catch {
    // Nothing to clear.
  }
}

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomToken(byteLength = 32): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(verifier),
  );
  return base64Url(new Uint8Array(digest));
}

function callbackUrl(): string {
  return `${window.location.origin}/?mcp=callback`;
}

function readClient(): VercelMcpClient | null {
  const client = readJson<VercelMcpClient>(storage(), CLIENT_KEY);
  if (
    !client ||
    typeof client.client_id !== 'string' ||
    typeof client.redirect_uri !== 'string'
  ) {
    return null;
  }
  return client;
}

function readTokens(): VercelMcpTokens | null {
  const tokens = readJson<VercelMcpTokens>(storage(), TOKENS_KEY);
  if (
    !tokens ||
    typeof tokens.access_token !== 'string' ||
    typeof tokens.expires_at !== 'number'
  ) {
    return null;
  }
  return tokens;
}

function writeTokens(tokens: TokenResponse): VercelMcpTokens {
  const stored: VercelMcpTokens = {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    token_type: tokens.token_type,
    scope: tokens.scope,
    expires_at:
      Date.now() + Math.max(30, tokens.expires_in ?? 3600) * 1000,
  };
  writeJson(storage(), TOKENS_KEY, stored);
  return stored;
}

/**
 * Register this origin as a public OAuth client once, then reuse it. Vercel
 * rotates redirect URIs per origin, so a cached client from another origin is
 * replaced.
 */
async function ensureClient(): Promise<VercelMcpClient> {
  const redirectUri = callbackUrl();
  const cached = readClient();
  if (cached && cached.redirect_uri === redirectUri) return cached;

  let response: Response;
  try {
    response = await fetch(REGISTER_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        client_name: CLIENT_NAME,
        redirect_uris: [redirectUri],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
        scope: SCOPES,
      }),
    });
  } catch {
    throw new Error(
      'Could not reach Vercel to register the MCP client. Check your connection and retry.',
    );
  }

  if (!response.ok) {
    throw new Error(
      `Vercel rejected the MCP client registration (HTTP ${response.status}).`,
    );
  }

  const data = (await response.json()) as { client_id?: unknown };
  if (typeof data.client_id !== 'string' || !data.client_id) {
    throw new Error('Vercel did not return a client id for the MCP client.');
  }

  const client: VercelMcpClient = {
    client_id: data.client_id,
    redirect_uri: redirectUri,
    created_at: new Date().toISOString(),
  };
  writeJson(storage(), CLIENT_KEY, client);
  return client;
}

function authorizationUrl(
  client: VercelMcpClient,
  state: string,
  challenge: string,
): string {
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', client.client_id);
  url.searchParams.set('redirect_uri', client.redirect_uri);
  url.searchParams.set('scope', SCOPES);
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('resource', VERCEL_MCP_URL);
  return url.toString();
}

async function postToken(
  body: Record<string, string>,
): Promise<VercelMcpTokens> {
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
  });

  const raw = await response.text();
  let parsed: unknown;
  try {
    parsed = raw ? JSON.parse(raw) : null;
  } catch {
    parsed = null;
  }

  if (!response.ok) {
    const detail =
      parsed && typeof parsed === 'object'
        ? String(
            (parsed as { error_description?: unknown }).error_description ??
              (parsed as { error?: unknown }).error ??
              '',
          )
        : '';
    throw new Error(
      detail
        ? `Vercel sign-in failed: ${detail}`
        : `Vercel sign-in failed (HTTP ${response.status}).`,
    );
  }

  if (
    !parsed ||
    typeof parsed !== 'object' ||
    typeof (parsed as TokenResponse).access_token !== 'string'
  ) {
    throw new Error('Vercel returned an unreadable token response.');
  }

  return writeTokens(parsed as TokenResponse);
}

let refreshPromise: Promise<VercelMcpTokens> | null = null;

async function refreshTokens(): Promise<VercelMcpTokens> {
  const tokens = readTokens();
  if (!tokens?.refresh_token) {
    removeKey(storage(), TOKENS_KEY);
    throw new Error('Your Vercel session expired. Reconnect Vercel MCP.');
  }
  const client = readClient();
  if (!client) {
    removeKey(storage(), TOKENS_KEY);
    throw new Error('Vercel MCP is not registered. Reconnect it.');
  }

  try {
    return await postToken({
      grant_type: 'refresh_token',
      refresh_token: tokens.refresh_token,
      client_id: client.client_id,
      resource: VERCEL_MCP_URL,
    });
  } catch (error) {
    removeKey(storage(), TOKENS_KEY);
    throw error instanceof Error
      ? new Error(
          `Your Vercel session expired. Reconnect Vercel MCP. (${error.message})`,
        )
      : new Error('Your Vercel session expired. Reconnect Vercel MCP.');
  }
}

/**
 * Return a usable access token. Refreshes shortly before expiry, or when the
 * caller forces it after a 401 from the MCP server.
 */
export async function getVercelMcpToken(
  forceRefresh = false,
): Promise<string> {
  const tokens = readTokens();
  if (!tokens) throw new Error('Vercel MCP is not connected.');

  const expiring = tokens.expires_at - Date.now() < 60_000;
  if (!forceRefresh && !expiring) return tokens.access_token;
  if (!tokens.refresh_token) {
    if (!forceRefresh) return tokens.access_token;
    removeKey(storage(), TOKENS_KEY);
    throw new Error('Your Vercel session expired. Reconnect Vercel MCP.');
  }

  refreshPromise ??= refreshTokens().finally(() => {
    refreshPromise = null;
  });
  return (await refreshPromise).access_token;
}

export function hasVercelMcpSession(): boolean {
  const tokens = readTokens();
  return Boolean(tokens?.access_token || tokens?.refresh_token);
}

let cancelActiveConnect: (() => void) | null = null;

/** Abort a pending sign-in popup (the chip turns into a cancel button). */
export function cancelVercelMcpConnect(): void {
  cancelActiveConnect?.();
}

/**
 * Run the interactive OAuth flow. Must be called from a user gesture so the
 * blank popup can be opened before the async client registration.
 */
export async function connectVercelMcp(): Promise<void> {
  if (typeof window === 'undefined') {
    throw new Error('Vercel MCP can only be connected in the browser.');
  }

  const popup = window.open(
    '',
    POPUP_NAME,
    'popup=yes,width=520,height=720,menubar=no,toolbar=no,location=yes',
  );
  if (!popup) {
    throw new Error(
      'The Vercel sign-in popup was blocked. Allow popups for this site and retry.',
    );
  }

  let client: VercelMcpClient;
  try {
    client = await ensureClient();
  } catch (error) {
    popup.close();
    throw error;
  }

  const verifier = randomToken(64);
  const challenge = await pkceChallenge(verifier);
  const state = randomToken(24);
  const pending: PendingAuth = {
    verifier,
    state,
    redirectUri: client.redirect_uri,
    clientId: client.client_id,
    createdAt: Date.now(),
  };
  writeJson(sessionStorageSafe(), PENDING_KEY, pending);

  const authUrl = authorizationUrl(client, state, challenge);
  popup.location.href = authUrl;

  removeKey(storage(), CALLBACK_KEY);

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    let received = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let poll: ReturnType<typeof setInterval> | null = null;
    let channel: BroadcastChannel | null = null;

    type CallbackPayload = {
      type?: unknown;
      code?: unknown;
      state?: unknown;
      error?: unknown;
      errorDescription?: unknown;
    };

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      if (poll) clearInterval(poll);
      window.removeEventListener('message', onMessage);
      window.removeEventListener('storage', onStorage);
      cancelActiveConnect = null;
      try {
        channel?.close();
      } catch {
        // Already closed.
      }
      removeKey(sessionStorageSafe(), PENDING_KEY);
      removeKey(storage(), CALLBACK_KEY);
    };

    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve();
    };

    // `popup.closed` is unusable here: COOP severs the opener reference while
    // the user is on vercel.com, so the opener sees a closed window. Offer an
    // explicit cancel through the chip instead.
    cancelActiveConnect = () =>
      finish(new Error('Vercel sign-in was cancelled.'));

    const handle = (data: CallbackPayload | null) => {
      if (settled || !data || data.type !== 'forge:mcp-oauth') return;
      if (data.state !== state) return;

      // The popup closes itself right after posting; from here on its state no
      // longer means the user cancelled.
      received = true;

      if (typeof data.error === 'string' && data.error) {
        finish(
          new Error(
            typeof data.errorDescription === 'string' && data.errorDescription
              ? data.errorDescription
              : `Vercel sign-in failed: ${data.error}`,
          ),
        );
        return;
      }
      if (typeof data.code !== 'string' || !data.code) {
        finish(new Error('Vercel did not return an authorization code.'));
        return;
      }

      void (async () => {
        try {
          await postToken({
            grant_type: 'authorization_code',
            code: data.code as string,
            redirect_uri: client.redirect_uri,
            client_id: client.client_id,
            code_verifier: verifier,
            resource: VERCEL_MCP_URL,
          });
          finish();
        } catch (error) {
          finish(
            error instanceof Error
              ? error
              : new Error('Could not exchange the Vercel authorization code.'),
          );
        }
      })();
    };

    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      handle(event.data as CallbackPayload | null);
    };

    const onStorage = (event: StorageEvent) => {
      if (event.key !== CALLBACK_KEY || !event.newValue) return;
      try {
        handle(JSON.parse(event.newValue) as CallbackPayload);
      } catch {
        // A malformed fallback payload is ignored.
      }
      removeKey(storage(), CALLBACK_KEY);
    };

    window.addEventListener('message', onMessage);
    window.addEventListener('storage', onStorage);

    try {
      channel = new BroadcastChannel(CALLBACK_CHANNEL);
      channel.onmessage = (event) =>
        handle(event.data as CallbackPayload | null);
    } catch {
      channel = null;
    }

    timer = setTimeout(() => {
      finish(new Error('Vercel sign-in timed out. Try connecting again.'));
    }, AUTH_TIMEOUT_MS);

    poll = setInterval(() => {
      // Third delivery path: some embeds suppress `storage` events even though
      // the value is visible, so read the fallback key directly.
      if (settled || received) return;
      try {
        const raw = window.localStorage.getItem(CALLBACK_KEY);
        if (raw) {
          window.localStorage.removeItem(CALLBACK_KEY);
          handle(JSON.parse(raw) as CallbackPayload);
        }
      } catch {
        // Storage may be unavailable; the other channels still apply.
      }
    }, 500);
  }).catch((error) => {
    try {
      popup.close();
    } catch {
      // The popup may already be gone.
    }
    throw error;
  });
}

/** Revoke both tokens when possible, then forget them locally. */
export async function disconnectVercelMcp(): Promise<void> {
  const tokens = readTokens();
  const client = readClient();
  removeKey(storage(), TOKENS_KEY);
  removeKey(sessionStorageSafe(), PENDING_KEY);
  if (!tokens || !client) return;

  const revoke = async (token: string, hint: string) => {
    try {
      await fetch(REVOKE_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          token,
          token_type_hint: hint,
          client_id: client.client_id,
        }).toString(),
      });
    } catch {
      // Best effort; local tokens are already gone.
    }
  };

  if (tokens.refresh_token) await revoke(tokens.refresh_token, 'refresh_token');
  await revoke(tokens.access_token, 'access_token');
}
