import {
  createError,
  defineEventHandler,
  getHeader,
  readBody,
  type H3Event,
} from 'h3';
import { CLAUDE_AGENT, CLAUDE_ANTHROPIC_UPSTREAM } from '../../../../shared/claude';
import { authGuardAny } from '../../../utils/auth';

/**
 * Anthropic-style proxy for the frontend Claude agent.
 *
 *   browser (Anthropic SDK + Forge JWT)
 *     → POST /api/anthropic/v1/messages
 *       → https://api.deepseek.com/anthropic/v1/messages
 *
 * Only `x-api-key`/`Authorization` carrying a valid Forge JWT is accepted; the
 * real DeepSeek credential is inserted here and never reaches the browser.
 * The upstream URL is fixed by configuration, so callers cannot repoint it.
 */

const ALLOWED_PATHS = new Set(['v1/messages', 'v1/messages/count_tokens']);
const MAX_BODY_CHARS = 8 * 1024 * 1024;
const MAX_MESSAGES = 200;
const MAX_MODEL_CHARS = 120;
const UPSTREAM_TIMEOUT_MS = 300_000;

function isLocalHostname(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '0.0.0.0' ||
    hostname === '::1' ||
    hostname === '[::1]'
  );
}

function upstreamBaseUrl(): string {
  const raw = (process.env.DEEPSEEK_ANTHROPIC_BASE_URL ?? CLAUDE_ANTHROPIC_UPSTREAM).trim();

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw createError({
      statusCode: 500,
      statusMessage: 'Proxy misconfigured',
      message: 'DEEPSEEK_ANTHROPIC_BASE_URL is not a valid URL',
    });
  }

  if (
    url.protocol !== 'https:' &&
    !(url.protocol === 'http:' && isLocalHostname(url.hostname))
  ) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Proxy misconfigured',
      message:
        'The Anthropic base URL must use HTTPS (HTTP is only allowed for localhost)',
    });
  }
  if (url.username || url.password) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Proxy misconfigured',
      message: 'Credentials must not be embedded in the base URL',
    });
  }

  return url.toString().replace(/\/+$/, '');
}

/** AGENT_API_KEY is the documented fallback for ANTHROPIC_AUTH_TOKEN. */
function upstreamKey(): string {
  return (
    process.env.DEEPSEEK_API_KEY?.trim() ||
    process.env.AGENT_API_KEY?.trim() ||
    ''
  );
}

function routePath(event: H3Event): string {
  const raw = (event.path ?? '').split('?')[0] ?? '';
  const marker = '/api/anthropic/';
  const index = raw.indexOf(marker);
  if (index === -1) return '';
  return raw.slice(index + marker.length).replace(/\/+$/, '');
}

function validateBody(
  body: unknown,
  requireMaxTokens: boolean
): Record<string, unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: 'Missing Anthropic Messages request body',
    });
  }

  const request = body as Record<string, unknown>;
  if (!Array.isArray(request.messages) || request.messages.length === 0) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: 'messages must be a non-empty array',
    });
  }
  if (request.messages.length > MAX_MESSAGES) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: `At most ${MAX_MESSAGES} messages are allowed`,
    });
  }
  if (
    requireMaxTokens &&
    (typeof request.max_tokens !== 'number' || request.max_tokens <= 0)
  ) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: 'max_tokens must be a positive number',
    });
  }
  if (request.model !== undefined) {
    if (typeof request.model !== 'string' || !request.model.trim()) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Bad Request',
        message: 'model must be a non-empty string',
      });
    }
    if (request.model.length > MAX_MODEL_CHARS) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Bad Request',
        message: 'model is too long',
      });
    }
  }

  return {
    ...request,
    model:
      typeof request.model === 'string' && request.model.trim()
        ? request.model.trim()
        : CLAUDE_AGENT.model,
  };
}

export default defineEventHandler(async (event) => {
  const denied = await authGuardAny(event);
  if (denied) return denied;

  if (event.req.method.toUpperCase() !== 'POST') {
    throw createError({
      statusCode: 405,
      statusMessage: 'Method Not Allowed',
      message: 'The Anthropic proxy accepts POST only',
    });
  }

  const path = routePath(event);
  if (!ALLOWED_PATHS.has(path)) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      message: 'Unsupported Anthropic endpoint',
    });
  }

  const key = upstreamKey();
  if (!key) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Agent not configured',
      message: 'DEEPSEEK_API_KEY or AGENT_API_KEY must be set on the server',
    });
  }

  const body = validateBody(await readBody(event), path === 'v1/messages');
  const serialized = JSON.stringify(body);
  if (serialized.length > MAX_BODY_CHARS) {
    throw createError({
      statusCode: 413,
      statusMessage: 'Payload Too Large',
      message: 'The request body is too large',
    });
  }

  // Anthropic clients identify themselves with x-api-key; the SDK's browser
  // mode also sends anthropic-dangerous-direct-browser-access, which is
  // harmless here because the key it carries is the Forge JWT.
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    accept: getHeader(event, 'accept') ?? 'text/event-stream',
    'anthropic-version': getHeader(event, 'anthropic-version') ?? '2023-06-01',
    'x-api-key': key,
    'user-agent': 'forge-sandbox-ide/anthropic-proxy',
  };
  const beta = getHeader(event, 'anthropic-beta');
  if (beta) headers['anthropic-beta'] = beta;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  timer.unref?.();

  // Stop paying for the upstream stream when the browser aborts a run.
  const nodeResponse = event.node?.res;
  nodeResponse?.once('close', () => {
    if (!nodeResponse.writableEnded) controller.abort();
  });

  let upstream: Response;
  try {
    upstream = await fetch(`${upstreamBaseUrl()}/${path}`, {
      method: 'POST',
      headers,
      body: serialized,
      signal: controller.signal,
    });
  } catch (error) {
    const aborted = controller.signal.aborted;
    console.warn(
      `[anthropic-proxy] upstream ${aborted ? 'timed out' : 'failed'}:`,
      error instanceof Error ? error.message : String(error)
    );
    throw createError({
      statusCode: 502,
      statusMessage: 'Bad Gateway',
      message: aborted
        ? 'The Anthropic upstream timed out'
        : 'Could not reach the Anthropic upstream',
    });
  }

  const contentType = upstream.headers.get('content-type') ?? 'application/json';
  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      'content-type': contentType,
      'cache-control': 'no-store',
      'x-forge-proxy': 'deepseek-anthropic-jwt',
    },
  });
});
