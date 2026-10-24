import type {
  AgentChatMessage,
  AgentStatusResponse,
  AgentToolCall,
  AgentToolDefinition,
} from '../../shared/types';
import { authHeaders, handleUnauthorized } from './auth-token';

export interface AgentStreamOptions {
  messages: AgentChatMessage[];
  tools: AgentToolDefinition[];
  signal: AbortSignal;
  onDelta: (chunk: string) => void;
  /** DeepSeek's separate reasoning stream (`reasoning_content`). */
  onReasoning?: (chunk: string) => void;
}

export interface AgentStreamResult {
  content: string;
  /** Full reasoning text, for replaying on the next tool turn. */
  reasoning?: string;
  /** Anthropic thinking signature, when the provider sends one. */
  reasoningSignature?: string;
  toolCalls: AgentToolCall[];
  finishReason: string | null;
}

interface ToolCallAccumulator {
  id: string;
  name: string;
  args: string;
}

export async function errorFromResponse(response: Response): Promise<Error> {
  let message = `Agent request failed (${response.status})`;
  try {
    const text = await response.text();
    try {
      const data = JSON.parse(text) as { message?: string; statusMessage?: string; error?: { message?: string } };
      message = data.message || data.error?.message || data.statusMessage || message;
    } catch {
      if (text && text.length < 500) message = text;
    }
  } catch {
    // Keep the generic message.
  }
  return new Error(message);
}

export async function fetchAgentStatus(): Promise<AgentStatusResponse> {
  const response = await fetch('/api/agent/status', {
    headers: { Accept: 'application/json', ...authHeaders() },
  });
  handleUnauthorized(response);
  if (!response.ok) throw await errorFromResponse(response);
  return (await response.json()) as AgentStatusResponse;
}

function finalizeToolCalls(accumulators: Map<number, ToolCallAccumulator>): AgentToolCall[] {
  return [...accumulators.entries()]
    .sort(([a], [b]) => a - b)
    .map(([index, entry]) => ({
      id: entry.id || `call_${Date.now()}_${index}`,
      type: 'function' as const,
      function: { name: entry.name, arguments: entry.args || '{}' },
    }))
    .filter((call) => Boolean(call.function.name));
}

export async function streamAgentChat(options: AgentStreamOptions): Promise<AgentStreamResult> {
  const { messages, tools, signal, onDelta, onReasoning } = options;

  const response = await fetch('/api/deepseek/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      // The proxy accepts only the Forge JWT; it inserts the DeepSeek key.
      ...authHeaders(),
    },
    body: JSON.stringify({ messages, tools, temperature: 0.2, stream: true }),
    signal,
  });

  handleUnauthorized(response);

  if (!response.ok) throw await errorFromResponse(response);

  const contentType = response.headers.get('content-type') ?? '';

  // Some OpenAI-compatible servers ignore `stream: true` and send JSON.
  if (contentType.includes('application/json')) {
    const data = (await response.json()) as {
      choices?: Array<{
        message?: {
          content?: string | null;
          reasoning?: string | null;
          reasoning_content?: string | null;
          tool_calls?: AgentToolCall[];
        };
        finish_reason?: string | null;
      }>;
      error?: { message?: string };
    };
    if (data.error?.message) throw new Error(data.error.message);
    const choice = data.choices?.[0];
    const content = choice?.message?.content ?? '';
    const reasoning =
      choice?.message?.reasoning_content ?? choice?.message?.reasoning ?? '';
    if (reasoning) onReasoning?.(reasoning);
    if (content) onDelta(content);
    return {
      content,
      reasoning,
      toolCalls: choice?.message?.tool_calls ?? [],
      finishReason: choice?.finish_reason ?? null,
    };
  }

  if (!response.body) throw new Error('The agent response has no body');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  let reasoningText = '';
  let finishReason: string | null = null;
  let streamError: Error | null = null;
  const accumulators = new Map<number, ToolCallAccumulator>();

  const handleEvent = (block: string) => {
    const dataLines = block
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.replace(/^data:\s?/, ''));

    if (dataLines.length === 0) return;
    const payload = dataLines.join('\n').trim();
    if (!payload || payload === '[DONE]') return;

    let json: {
      error?: { message?: string };
      choices?: Array<{
        delta?: {
          content?: string | null;
          reasoning?: string | null;
          reasoning_content?: string | null;
          tool_calls?: Array<{
            index?: number;
            id?: string;
            type?: string;
            function?: { name?: string; arguments?: string };
          }>;
        };
        finish_reason?: string | null;
      }>;
    };

    try {
      json = JSON.parse(payload);
    } catch {
      return; // Ignore keep-alives and malformed fragments.
    }

    if (json.error?.message) {
      streamError = new Error(json.error.message);
      return;
    }

    const choice = json.choices?.[0];
    if (!choice) return;
    const delta = choice.delta;

    const reasoning = delta?.reasoning_content ?? delta?.reasoning;
    if (typeof reasoning === 'string' && reasoning) {
      reasoningText += reasoning;
      onReasoning?.(reasoning);
    }

    if (typeof delta?.content === 'string' && delta.content) {
      content += delta.content;
      onDelta(delta.content);
    }

    for (const part of delta?.tool_calls ?? []) {
      const index = typeof part.index === 'number' ? part.index : 0;
      const entry = accumulators.get(index) ?? { id: '', name: '', args: '' };
      if (part.id) entry.id = part.id;
      if (part.function?.name) entry.name = part.function.name;
      if (part.function?.arguments) entry.args += part.function.arguments;
      accumulators.set(index, entry);
    }

    if (choice.finish_reason) finishReason = choice.finish_reason;
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      buffer = buffer.replace(/\r\n/g, '\n');

      let boundary = buffer.indexOf('\n\n');
      while (boundary !== -1) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        handleEvent(block);
        boundary = buffer.indexOf('\n\n');
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) handleEvent(buffer.replace(/\r\n/g, '\n'));
  } finally {
    reader.releaseLock();
  }

  if (streamError) throw streamError;

  return {
    content,
    reasoning: reasoningText,
    toolCalls: finalizeToolCalls(accumulators),
    finishReason,
  };
}
