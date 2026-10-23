import { createError, defineEventHandler, getHeader, readBody } from 'h3';
import type { AgentProxyRequest } from '../../shared/types';

const MAX_MESSAGES = 80;
const MAX_MESSAGE_CHARS = 300_000;
const MAX_TOOLS = 12;
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

function resolveBaseUrl(raw: unknown): string {
  const value =
    (typeof raw === 'string' && raw.trim()) ||
    process.env.AGENT_BASE_URL ||
    'https://api.openai.com/v1';

  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: 'The agent base URL is not a valid URL',
    });
  }

  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLocalHostname(url.hostname))) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: 'The agent base URL must use HTTPS (HTTP is only allowed for localhost)',
    });
  }
  if (url.username || url.password) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: 'Credentials must not be embedded in the base URL',
    });
  }

  return url.toString().replace(/\/+$/, '');
}

function validateBody(body: AgentProxyRequest | undefined): AgentProxyRequest {
  if (!body || typeof body !== 'object') {
    throw createError({ statusCode: 400, statusMessage: 'Bad Request', message: 'Missing agent request body' });
  }
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'Bad Request', message: 'messages must be a non-empty array' });
  }
  if (body.messages.length > MAX_MESSAGES) {
    throw createError({ statusCode: 400, statusMessage: 'Bad Request', message: `At most ${MAX_MESSAGES} messages are allowed` });
  }
  if (!Array.isArray(body.tools) || body.tools.length === 0 || body.tools.length > MAX_TOOLS) {
    throw createError({ statusCode: 400, statusMessage: 'Bad Request', message: 'A valid tool list is required' });
  }

  let characters = 0;
  for (const message of body.messages) {
    if (!message || typeof message !== 'object' || typeof message.role !== 'string') {
      throw createError({ statusCode: 400, statusMessage: 'Bad Request', message: 'Invalid message in request' });
    }
    characters += (message.content ?? '').length;
    for (const call of message.tool_calls ?? []) {
      characters += (call.function?.arguments ?? '').length;
    }
  }
  if (characters > MAX_MESSAGE_CHARS) {
    throw createError({ statusCode: 400, statusMessage: 'Bad Request', message: 'Conversation is too large' });
  }

  return body;
}

export default defineEventHandler(async (event) => {
  const body = validateBody(await readBody<AgentProxyRequest>(event));

  const clientKey = (getHeader(event, 'x-agent-key') || '').trim();
  const envKey = (process.env.AGENT_API_KEY || process.env.OPENAI_API_KEY || '').trim();
  const apiKey = clientKey || envKey;
  const baseUrl = resolveBaseUrl(body.baseUrl);
  const model =
    (typeof body.model === 'string' && body.model.trim().slice(0, 120)) ||
    process.env.AGENT_MODEL ||
    'gpt-4o-mini';

  if (!apiKey && !isLocalHostname(new URL(baseUrl).hostname)) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Unauthorized',
      message: 'No API key configured. Add one in the agent settings or set AGENT_API_KEY on the server.',
    });
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({
        model,
        messages: body.messages,
        tools: body.tools,
        tool_choice: 'auto',
        temperature: 0.2,
        stream: true,
      }),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch (error) {
    const code = (error as { cause?: { code?: string } }).cause?.code;
    const name = (error as { name?: string }).name;
    let message: string;
    if (name === 'TimeoutError' || code === 'UND_ERR_CONNECT_TIMEOUT') {
      message = `The provider at ${baseUrl} took too long to respond.`;
    } else if (code === 'ECONNREFUSED') {
      message = `Could not connect to ${baseUrl}. Is the provider running?`;
    } else if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
      message = `Could not resolve ${baseUrl}. Check the base URL.`;
    } else {
      message = `Could not reach the provider at ${baseUrl}${code ? ` (${code})` : ''}.`;
    }
    throw createError({ statusCode: 502, statusMessage: 'Bad Gateway', message });
  }

  if (!upstream.ok || !upstream.body) {
    const raw = await upstream.text().catch(() => '');
    let message = raw.slice(0, 800) || `Provider responded with HTTP ${upstream.status}`;
    try {
      const parsed = JSON.parse(raw) as { error?: { message?: string }; message?: string };
      message = parsed.error?.message || parsed.message || message;
    } catch {
      // Keep the raw text.
    }
    throw createError({
      statusCode: upstream.status === 401 || upstream.status === 403 ? upstream.status : 502,
      statusMessage: 'Agent provider error',
      message,
    });
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      'Content-Type': upstream.headers.get('content-type') || 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    },
  });
});
