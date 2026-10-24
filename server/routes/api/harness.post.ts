import { createError, defineEventHandler, readBody } from 'h3';
import type {
  HarnessStreamEvent,
  HarnessTurnRequest,
} from '../../../shared/types';
import { authGuard } from '../../utils/auth';
import {
  HARNESS_LIMITS,
  harnessConfig,
  runHarnessTurn,
} from '../../utils/harness';

const MAX_PROMPT_CHARS = 100_000;
const CONVERSATION_KEY = /^[a-zA-Z0-9_-]{4,64}$/;

function bad(message: string): never {
  throw createError({ statusCode: 400, statusMessage: 'Bad Request', message });
}

function validate(body: HarnessTurnRequest | undefined): HarnessTurnRequest {
  if (!body || typeof body !== 'object') bad('Missing harness request body');

  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
  if (!prompt) bad('prompt must be a non-empty string');
  if (prompt.length > MAX_PROMPT_CHARS) {
    bad(`prompt must be under ${MAX_PROMPT_CHARS} characters`);
  }

  const conversationKey =
    typeof body.conversationKey === 'string' ? body.conversationKey.trim() : '';
  if (!CONVERSATION_KEY.test(conversationKey)) {
    bad('conversationKey must be 4–64 letters, digits, underscores, or hyphens');
  }

  if (!body.files || typeof body.files !== 'object' || Array.isArray(body.files)) {
    bad('files must be an object of absolute path → text content');
  }

  const entries = Object.entries(body.files);
  if (entries.length === 0) bad('The project has no files to send');
  if (entries.length > HARNESS_LIMITS.maxFiles) {
    bad(`A project can hold at most ${HARNESS_LIMITS.maxFiles} files`);
  }

  let totalBytes = 0;
  const files: Record<string, string> = {};
  for (const [path, content] of entries) {
    if (!path.startsWith('/') || path.includes('..') || path.includes('\0')) {
      bad(`Unsafe project path: ${path}`);
    }
    if (typeof content !== 'string') bad(`File content must be text: ${path}`);
    const bytes = Buffer.byteLength(content, 'utf8');
    if (bytes > HARNESS_LIMITS.maxFileBytes) {
      bad(`File is too large for the harness mirror: ${path}`);
    }
    totalBytes += bytes;
    files[path] = content;
  }
  if (totalBytes > HARNESS_LIMITS.maxTotalBytes) {
    bad('The project is too large to mirror into the harness workspace');
  }

  return { prompt, conversationKey, files };
}

export default defineEventHandler(async (event) => {
  const denied = await authGuard(event);
  if (denied) return denied;

  const config = harnessConfig();
  if (!config.apiKey) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Unauthorized',
      message:
        'No DeepSeek API key configured. Set DEEPSEEK_API_KEY (or AGENT_API_KEY) in .env.local.',
    });
  }

  const body = validate(await readBody<HarnessTurnRequest>(event));

  const controller = new AbortController();
  const nodeResponse = event.node?.res;
  const onClose = () => {
    if (nodeResponse && !nodeResponse.writableEnded) controller.abort();
  };
  nodeResponse?.on('close', onClose);

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(streamController) {
      const send = (payload: HarnessStreamEvent) => {
        if (controller.signal.aborted) return;
        try {
          streamController.enqueue(encoder.encode(`${JSON.stringify(payload)}\n`));
        } catch {
          // The browser disconnected; aborting the run is handled by onClose.
        }
      };

      try {
        const result = await runHarnessTurn(body, {
          onEvent: send,
          signal: controller.signal,
        });
        send({ type: 'result', ...result });
      } catch (error) {
        const aborted =
          controller.signal.aborted ||
          (error instanceof Error && error.name === 'AbortError');
        send({
          type: 'error',
          message: aborted
            ? 'Stopped.'
            : error instanceof Error
              ? error.message
              : String(error),
        });
      } finally {
        nodeResponse?.off('close', onClose);
        try {
          streamController.close();
        } catch {
          // Already closed by a disconnected client.
        }
      }
    },
    cancel() {
      controller.abort();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    },
  });
});
