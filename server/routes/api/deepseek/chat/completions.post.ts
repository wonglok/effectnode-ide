import { createError, defineEventHandler, readBody } from 'h3';
import type { DeepSeekChatRequest } from '../../../../../shared/types';
import { authGuard } from '../../../../utils/auth';

/**
 * JWT-authenticated REST proxy for the DeepSeek chat completions API.
 *
 * The browser agent sends the Forge JWT (`Authorization: Bearer <jwt>`); this
 * route validates it with the shared auth guard, then inserts the server-side
 * DeepSeek credential. The key never reaches the browser, and callers cannot
 * choose an arbitrary upstream URL.
 */

const MAX_MESSAGES = 80;
const MAX_MESSAGE_CHARS = 300_000;
const MAX_TOOLS = 16;
const MAX_MODEL_CHARS = 120;
const UPSTREAM_TIMEOUT_MS = 180_000;

function isLocalHostname(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '0.0.0.0' ||
    hostname === '::1' ||
    hostname === '[::1]'
  );
}

function providerBaseUrl(): string {
  const raw =
    process.env.DEEPSEEK_BASE_URL ||
    process.env.AGENT_BASE_URL ||
    'https://api.deepseek.com';

  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw createError({
      statusCode: 500,
      statusMessage: 'Proxy misconfigured',
      message: 'DEEPSEEK_BASE_URL / AGENT_BASE_URL is not a valid URL',
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
        'The DeepSeek base URL must use HTTPS (HTTP is only allowed for localhost)',
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

function completionsUrl(): string {
  const base = providerBaseUrl();
  return base.endsWith('/chat/completions') ? base : `${base}/chat/completions`;
}

function validate(body: DeepSeekChatRequest | undefined): DeepSeekChatRequest {
  if (!body || typeof body !== 'object') {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: 'Missing chat request body',
    });
  }
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: 'messages must be a non-empty array',
    });
  }
  if (body.messages.length > MAX_MESSAGES) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: `At most ${MAX_MESSAGES} messages are allowed`,
    });
  }
  if (body.tools !== undefined && (!Array.isArray(body.tools) || body.tools.length > MAX_TOOLS)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: `tools must be an array of at most ${MAX_TOOLS} definitions`,
    });
  }

  let characters = 0;
  for (const message of body.messages) {
    if (!message || typeof message !== 'object' || typeof message.role !== 'string') {
      throw createError({
        statusCode: 400,
        statusMessage: 'Bad Request',
        message: 'Invalid message in request',
      });
    }
    characters += (message.content ?? '').length;
    for (const call of message.tool_calls ?? []) {
      characters += (call.function?.arguments ?? '').length;
    }
  }
  if (characters > MAX_MESSAGE_CHARS) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: 'Conversation is too large',
    });
  }

  return body;
}

export default defineEventHandler(async (event) => {
  // The Forge JWT is the only accepted credential for this proxy.
  const denied = await authGuard(event);
  if (denied) return denied;

  const apiKey = (
    process.env.DEEPSEEK_API_KEY ||
    process.env.AGENT_API_KEY ||
    ''
  ).trim();
  if (!apiKey) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Unauthorized',
      message:
        'No DeepSeek API key configured. Set DEEPSEEK_API_KEY (or AGENT_API_KEY) on the server.',
    });
  }

  const body = validate(await readBody<DeepSeekChatRequest>(event));
  const model =
    (typeof body.model === 'string' && body.model.trim().slice(0, MAX_MODEL_CHARS)) ||
    process.env.DEEPSEEK_MODEL ||
    process.env.AGENT_MODEL ||
    'deepseek-flash';

  let upstream: Response;
  try {
    upstream = await fetch(completionsUrl(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        Authorization: `Bearer ${apiKey}`,
        'X-Forge-Proxy': 'deepseek-jwt',
      },
      body: JSON.stringify({
        model,
        messages: body.messages,
        ...(body.tools?.length ? { tools: body.tools, tool_choice: body.tool_choice ?? 'auto' } : {}),
        temperature:
          typeof body.temperature === 'number' ? body.temperature : 0.2,
        stream: body.stream !== false,
      }),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch (error) {
    const code = (error as { cause?: { code?: string } }).cause?.code;
    const name = (error as { name?: string }).name;
    let message: string;
    if (name === 'TimeoutError' || code === 'UND_ERR_CONNECT_TIMEOUT') {
      message = 'The DeepSeek API took too long to respond.';
    } else if (code === 'ECONNREFUSED') {
      message = 'Could not connect to the DeepSeek API.';
    } else if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
      message = 'Could not resolve the DeepSeek API host.';
    } else {
      message = `Could not reach the DeepSeek API${code ? ` (${code})` : ''}.`;
    }
    throw createError({ statusCode: 502, statusMessage: 'Bad Gateway', message });
  }

  if (!upstream.ok || !upstream.body) {
    const raw = await upstream.text().catch(() => '');
    let message = raw.slice(0, 800) || `DeepSeek responded with HTTP ${upstream.status}`;
    try {
      const parsed = JSON.parse(raw) as {
        error?: { message?: string };
        message?: string;
      };
      message = parsed.error?.message || parsed.message || message;
    } catch {
      // Keep the raw text.
    }
    throw createError({
      statusCode:
        upstream.status === 401 || upstream.status === 403 ? upstream.status : 502,
      statusMessage: 'DeepSeek provider error',
      message,
    });
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      'Content-Type':
        upstream.headers.get('content-type') || 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
      'X-Forge-Proxy': 'deepseek-jwt',
    },
  });
});
