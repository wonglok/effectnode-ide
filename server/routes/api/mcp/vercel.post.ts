import {
  createError,
  defineEventHandler,
  getHeader,
  readBody,
  setResponseHeader,
} from 'h3';
import { authGuardAny } from '../../../utils/auth';

/**
 * JSON-RPC transport for the Vercel MCP server.
 *
 *   browser MCP client (Forge JWT + Vercel access token)
 *     → POST /api/mcp/vercel
 *       → https://mcp.vercel.com
 *
 * mcp.vercel.com does not send CORS headers, so the browser cannot call it
 * directly. The Forge JWT authorises this same-origin route; the Vercel token
 * arrives separately in `x-mcp-token` and is only ever sent to the fixed
 * upstream, never logged.
 */

const VERCEL_MCP_URL = 'https://mcp.vercel.com/';
const MAX_BODY_CHARS = 2 * 1024 * 1024;
const MAX_RESPONSE_CHARS = 4 * 1024 * 1024;
const UPSTREAM_TIMEOUT_MS = 120_000;
const PROTOCOL_VERSIONS = new Set([
  '2025-06-18',
  '2025-03-26',
  '2024-11-05',
]);
const SESSION_ID_PATTERN = /^[A-Za-z0-9._~+/=-]{1,256}$/;

/**
 * Nitro 3's Vite dev worker crashes when a POST receives a 401, so development
 * uses 403 with an explicit header (the same workaround as the auth guard).
 */
function unauthorizedStatus(): 401 | 403 {
  return process.env.NODE_ENV === 'production' ? 401 : 403;
}

export default defineEventHandler(async (event) => {
  const denied = await authGuardAny(event);
  if (denied) return denied;

  if (event.req.method.toUpperCase() !== 'POST') {
    throw createError({
      statusCode: 405,
      statusMessage: 'Method Not Allowed',
      message: 'The Vercel MCP proxy accepts POST only',
    });
  }

  // Drain the request body before any early rejection: Nitro 3's dev worker
  // crashes when a POST with an unread body receives an error response.
  const body = await readBody(event);
  if (
    !body ||
    typeof body !== 'object' ||
    Array.isArray(body) ||
    (body as { jsonrpc?: unknown }).jsonrpc !== '2.0'
  ) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: 'Expected a JSON-RPC 2.0 message',
    });
  }

  const token = (getHeader(event, 'x-mcp-token') ?? '').trim();
  if (!token || token.length > 4096) {
    setResponseHeader(event, 'x-mcp-auth', 'required');
    throw createError({
      statusCode: unauthorizedStatus(),
      statusMessage: 'Vercel MCP is not connected',
      message: 'Connect Vercel MCP in the agent panel first',
    });
  }

  const sessionId = (getHeader(event, 'mcp-session-id') ?? '').trim();
  if (sessionId && !SESSION_ID_PATTERN.test(sessionId)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: 'Invalid MCP session id',
    });
  }

  const requestedVersion = (
    getHeader(event, 'mcp-protocol-version') ?? ''
  ).trim();
  const protocolVersion = PROTOCOL_VERSIONS.has(requestedVersion)
    ? requestedVersion
    : '2025-06-18';

  const serialized = JSON.stringify(body);
  if (serialized.length > MAX_BODY_CHARS) {
    throw createError({
      statusCode: 413,
      statusMessage: 'Payload Too Large',
      message: 'The MCP request body is too large',
    });
  }

  const headers: Record<string, string> = {
    'content-type': 'application/json',
    accept:
      getHeader(event, 'accept') ?? 'application/json, text/event-stream',
    authorization: `Bearer ${token}`,
    'mcp-protocol-version': protocolVersion,
    'user-agent': 'forge-sandbox-ide/vercel-mcp',
  };
  if (sessionId) headers['mcp-session-id'] = sessionId;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  timer.unref?.();

  let upstream: Response;
  try {
    upstream = await fetch(VERCEL_MCP_URL, {
      method: 'POST',
      headers,
      body: serialized,
      signal: controller.signal,
    });
  } catch (error) {
    const aborted = controller.signal.aborted;
    console.warn(
      `[vercel-mcp] upstream ${aborted ? 'timed out' : 'failed'}:`,
      error instanceof Error ? error.message : String(error),
    );
    throw createError({
      statusCode: 502,
      statusMessage: 'Bad Gateway',
      message: aborted
        ? 'The Vercel MCP server timed out'
        : 'Could not reach the Vercel MCP server',
    });
  }

  // MCP replies are finite (an SSE body for a single response); buffering lets
  // the whole exchange share one timeout and one size cap.
  let text: string;
  try {
    text = await upstream.text();
  } catch (error) {
    throw createError({
      statusCode: 502,
      statusMessage: 'Bad Gateway',
      message:
        error instanceof Error
          ? `Could not read the Vercel MCP response: ${error.message}`
          : 'Could not read the Vercel MCP response',
    });
  } finally {
    clearTimeout(timer);
  }

  if (text.length > MAX_RESPONSE_CHARS) {
    throw createError({
      statusCode: 502,
      statusMessage: 'Bad Gateway',
      message: 'The Vercel MCP response is too large',
    });
  }

  const responseHeaders: Record<string, string> = {
    'content-type':
      upstream.headers.get('content-type') ?? 'application/json',
    'cache-control': 'no-store',
    'x-forge-proxy': 'vercel-mcp',
  };
  const nextSession = upstream.headers.get('mcp-session-id');
  if (nextSession) responseHeaders['mcp-session-id'] = nextSession;

  if (upstream.status === 401) {
    responseHeaders['x-mcp-auth'] = 'invalid-token';
    return new Response(text, {
      // Keep the dev worker alive; the client treats this header as auth.
      status: unauthorizedStatus(),
      headers: responseHeaders,
    });
  }

  return new Response(text, {
    status: upstream.status,
    headers: responseHeaders,
  });
});
