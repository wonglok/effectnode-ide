import type {
  HarnessStreamEvent,
  HarnessTurnRequest,
  HarnessTurnResult,
} from '../../shared/types';
import { errorFromResponse } from './agent-client';
import { authHeaders, handleUnauthorized } from './auth-token';

export interface HarnessTurnOptions {
  prompt: string;
  conversationKey: string;
  files: Record<string, string>;
  signal: AbortSignal;
  onEvent?: (event: HarnessStreamEvent) => void;
}

/**
 * Drive one server-side DeepSeek Harness turn.
 *
 * The server mirrors the project into a real workspace, runs the harness agent
 * there, and streams progress as newline-delimited JSON. The final `result`
 * frame carries the mirrored files back.
 */
export async function runHarnessTurn(
  options: HarnessTurnOptions
): Promise<HarnessTurnResult> {
  const body: HarnessTurnRequest = {
    prompt: options.prompt,
    conversationKey: options.conversationKey,
    files: options.files,
  };

  const response = await fetch('/api/harness', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/x-ndjson',
      ...authHeaders(),
    },
    body: JSON.stringify(body),
    signal: options.signal,
  });

  handleUnauthorized(response);
  if (!response.ok) throw await errorFromResponse(response);
  if (!response.body) throw new Error('The harness response has no body');

  const outcome: { result?: HarnessTurnResult; error?: Error } = {};

  const handleFrame = (line: string) => {
    if (!line.trim()) return;

    let frame: HarnessStreamEvent;
    try {
      frame = JSON.parse(line) as HarnessStreamEvent;
    } catch {
      return; // Ignore malformed or keep-alive lines.
    }
    if (!frame || typeof frame !== 'object' || typeof frame.type !== 'string') return;

    if (frame.type === 'result') {
      outcome.result = frame;
      return;
    }
    if (frame.type === 'error') {
      outcome.error = new Error(frame.message || 'The harness turn failed');
      return;
    }
    options.onEvent?.(frame);
  };

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let boundary = buffer.indexOf('\n');
      while (boundary !== -1) {
        handleFrame(buffer.slice(0, boundary));
        buffer = buffer.slice(boundary + 1);
        boundary = buffer.indexOf('\n');
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) handleFrame(buffer);
  } finally {
    reader.releaseLock();
  }

  if (outcome.error) throw outcome.error;
  if (!outcome.result) {
    throw new Error('The harness stream ended without a result');
  }
  return outcome.result;
}
