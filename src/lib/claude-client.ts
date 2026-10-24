import Anthropic, { APIError, APIUserAbortError } from '@anthropic-ai/sdk';
import type {
  ContentBlockParam,
  MessageParam,
  Tool,
} from '@anthropic-ai/sdk/resources/messages/messages';
import type {
  AgentChatMessage,
  AgentToolCall,
  AgentToolDefinition,
} from '../../shared/types';
import { clearAuthToken, notifyAuthChanged, readAuthToken } from './auth-token';
import { CLAUDE_AGENT } from './claude-config';

/**
 * Frontend Claude agent transport.
 *
 * The official Anthropic SDK runs in the browser and calls the same-origin
 * Anthropic proxy with the Forge JWT. DeepSeek speaks the Anthropic Messages
 * API, so the streaming/tool/thinking shapes are the standard ones.
 */

let client: Anthropic | null = null;
let clientToken = '';

/** The SDK resolves request URLs against an absolute base. */
function proxyBaseUrl(): string {
  if (typeof window === 'undefined') return CLAUDE_AGENT.baseUrl;
  return `${window.location.origin}${CLAUDE_AGENT.baseUrl}`;
}

function anthropicClient(): Anthropic {
  const token = readAuthToken() ?? 'forge';
  if (!client || token !== clientToken) {
    clientToken = token;
    client = new Anthropic({
      baseURL: proxyBaseUrl(),
      // ANTHROPIC_AUTH_TOKEN is the Forge JWT here; the proxy swaps in the
      // server-side DeepSeek key.
      authToken: token,
      apiKey: null,
      dangerouslyAllowBrowser: true,
      maxRetries: 0,
      timeout: 240_000,
      defaultHeaders: {
        'anthropic-version': CLAUDE_AGENT.apiVersion,
      },
    });
  }
  return client;
}

export interface ClaudeStreamOptions {
  system: string;
  messages: AgentChatMessage[];
  tools: AgentToolDefinition[];
  signal: AbortSignal;
  onDelta: (chunk: string) => void;
  onReasoning?: (chunk: string) => void;
}

export interface ClaudeStreamResult {
  content: string;
  reasoning: string;
  reasoningSignature?: string;
  toolCalls: AgentToolCall[];
  finishReason: string | null;
}

function parseArguments(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/** Convert the shared OpenAI-shaped transcript to Anthropic Messages blocks. */
function toAnthropicMessages(history: AgentChatMessage[]): MessageParam[] {
  const messages: MessageParam[] = [];

  for (const message of history) {
    if (message.role === 'system') continue;

    if (message.role === 'user') {
      messages.push({ role: 'user', content: message.content ?? '' });
      continue;
    }

    if (message.role === 'assistant') {
      const blocks: ContentBlockParam[] = [];
      if (message.thinking?.trim()) {
        blocks.push({
          type: 'thinking',
          thinking: message.thinking,
          signature: message.thinking_signature ?? '',
        });
      }
      if (message.content) {
        blocks.push({ type: 'text', text: message.content });
      }
      for (const call of message.tool_calls ?? []) {
        blocks.push({
          type: 'tool_use',
          id: call.id,
          name: call.function.name,
          input: parseArguments(call.function.arguments),
        });
      }
      if (blocks.length > 0) messages.push({ role: 'assistant', content: blocks });
      continue;
    }

    if (message.role === 'tool' && message.tool_call_id) {
      const result: ContentBlockParam = {
        type: 'tool_result',
        tool_use_id: message.tool_call_id,
        content: message.content ?? '',
      };
      const last = messages[messages.length - 1];
      if (
        last?.role === 'user' &&
        Array.isArray(last.content) &&
        last.content.every((block) => block.type === 'tool_result')
      ) {
        last.content.push(result);
      } else {
        messages.push({ role: 'user', content: [result] });
      }
    }
  }

  return messages;
}

function toAnthropicTools(tools: AgentToolDefinition[]): Tool[] {
  return tools.map((definition) => ({
    name: definition.function.name,
    description: definition.function.description,
    input_schema: definition.function.parameters as Tool.InputSchema,
  }));
}

function normalizeError(error: unknown): Error {
  if (error instanceof APIUserAbortError) {
    return new DOMException('Aborted', 'AbortError');
  }
  if (error instanceof APIError) {
    if (error.headers?.get('x-forge-auth') === 'required') {
      clearAuthToken();
      notifyAuthChanged();
    }
    return new Error(error.message || `Claude request failed (${error.status})`);
  }
  return error instanceof Error ? error : new Error(String(error));
}

export async function streamClaudeChat(
  options: ClaudeStreamOptions
): Promise<ClaudeStreamResult> {
  const { system, messages, tools, signal, onDelta, onReasoning } = options;

  let streamedText = '';
  let streamedThinking = '';
  let streamedSignature = '';

  try {
    const params = {
      model: CLAUDE_AGENT.model,
      max_tokens: CLAUDE_AGENT.maxTokens,
      system,
      messages: toAnthropicMessages(messages),
      tools: toAnthropicTools(tools),
      tool_choice: { type: 'auto' as const },
      thinking: {
        type: 'enabled' as const,
        budget_tokens: CLAUDE_AGENT.thinkingBudget,
      },
      output_config: { effort: CLAUDE_AGENT.effort },
    };

    const stream = anthropicClient().messages.stream(params, { signal });

    stream.on('text', (delta) => {
      if (!delta) return;
      streamedText += delta;
      onDelta(delta);
    });
    stream.on('thinking', (delta) => {
      if (!delta) return;
      streamedThinking += delta;
      onReasoning?.(delta);
    });
    stream.on('signature', (signature) => {
      if (signature) streamedSignature = signature;
    });

    const message = await stream.finalMessage();

    const content =
      message.content
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('') || streamedText;

    const thinkingBlock = message.content.find(
      (block) => block.type === 'thinking'
    );
    const reasoning =
      (thinkingBlock?.type === 'thinking' ? thinkingBlock.thinking : '') ||
      streamedThinking;
    const reasoningSignature =
      thinkingBlock?.type === 'thinking' && thinkingBlock.signature
        ? thinkingBlock.signature
        : streamedSignature || undefined;

    const toolCalls: AgentToolCall[] = message.content
      .filter((block) => block.type === 'tool_use')
      .map((block) => ({
        id: block.id,
        type: 'function' as const,
        function: {
          name: block.name,
          arguments: JSON.stringify(block.input ?? {}),
        },
      }));

    return {
      content,
      reasoning,
      reasoningSignature,
      toolCalls,
      finishReason: message.stop_reason ?? null,
    };
  } catch (error) {
    throw normalizeError(error);
  }
}
