/**
 * Browser Pi coding-agent harness.
 *
 * Reference: `@earendil-works/pi-coding-agent` and its
 * `examples/sdk/02-custom-model.ts` (`ModelRuntime.getModel` +
 * `createAgentSession({ model, thinkingLevel, modelRuntime })`).
 *
 * The published coding-agent SDK embeds Pi in Node/Bun (`node:fs`, native
 * tools, JSONL session files), so it cannot run in the browser. This adapter
 * keeps the same session contract — select the model up front, subscribe to
 * Agent events, `prompt`/`continue`, `abort`, then dispose — while running the
 * browser-safe `@earendil-works/pi-agent-core` loop and the
 * `@earendil-works/pi-ai` Anthropic transport. Tools still operate on Forge's
 * almostnode VirtualFS, and the API key stays behind the JWT proxy.
 */
import {
  Agent,
  type AgentEvent,
  type AgentMessage,
  type AgentTool,
  type AgentToolResult,
  type StreamFn,
  type ThinkingLevel,
} from "@earendil-works/pi-agent-core";
import type {
  AssistantMessage,
  JsonObject,
  Message,
  Model,
  TextContent,
  ThinkingContent,
  ToolCall,
  ToolResultMessage,
  TSchema,
  Usage,
} from "@earendil-works/pi-ai";
import { streamSimple } from "@earendil-works/pi-ai/api/anthropic-messages";
import type {
  AgentChatMessage,
  AgentToolCall,
  AgentTodoItem,
} from "../../shared/types";
import { PI_AGENT } from "../../shared/pi";
import { CLAUDE_AGENT } from "./claude-config";
import { authHeaders } from "./auth-token";
import {
  AGENT_TOOLS,
  executeAgentTool,
  type AgentToolOutcome,
} from "./agent-tools";

const EMPTY_USAGE: Usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

const TODO_STATUSES = new Set(["pending", "in_progress", "completed"]);

export interface PiSessionOptions {
  history: AgentChatMessage[];
  systemPrompt: string;
  maxSteps: number;
  onTodos: (todos: AgentTodoItem[]) => void;
}

export interface PiSession {
  subscribe: (listener: (event: AgentEvent) => void) => () => void;
  continue: () => Promise<void>;
  abort: () => void;
  dispose: () => void;
  readonly hitLimit: boolean;
  toHistory: () => AgentChatMessage[];
}

function model(): Model<"anthropic-messages"> {
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  return {
    id: PI_AGENT.model,
    name: PI_AGENT.model,
    api: PI_AGENT.api,
    provider: PI_AGENT.provider,
    baseUrl: `${origin}${PI_AGENT.baseUrl}`,
    input: ["text"],
    reasoning: true,
    contextWindow: CLAUDE_AGENT.maxContextTokens,
    maxTokens: CLAUDE_AGENT.maxTokens,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  };
}

/**
 * Pi's Anthropic provider is browser-safe (`dangerouslyAllowBrowser`). The
 * Forge JWT travels as an Authorization header and the proxy swaps in the
 * DeepSeek credential server-side.
 */
const streamFn: StreamFn = (selectedModel, context, options) => {
  const headers = {
    ...options?.headers,
    ...authHeaders(),
    "anthropic-version": CLAUDE_AGENT.apiVersion,
  };
  return streamSimple(
    selectedModel as Model<"anthropic-messages">,
    context,
    { ...options, headers },
  );
};

function parseArguments(value: string): JsonObject {
  try {
    const parsed: unknown = JSON.parse(value || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as JsonObject)
      : {};
  } catch {
    return {};
  }
}

function textFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter(
      (block): block is TextContent =>
        Boolean(block) &&
        typeof block === "object" &&
        (block as { type?: unknown }).type === "text",
    )
    .map((block) => block.text)
    .join("\n");
}

function thinkingFromContent(content: unknown): {
  thinking: string;
  signature?: string;
} {
  if (!Array.isArray(content)) return { thinking: "" };
  const blocks = content.filter(
    (block): block is ThinkingContent =>
      Boolean(block) &&
      typeof block === "object" &&
      (block as { type?: unknown }).type === "thinking",
  );
  return {
    thinking: blocks.map((block) => block.thinking).join("\n"),
    signature: blocks.find((block) => block.thinkingSignature)
      ?.thinkingSignature,
  };
}

/** Convert Forge's replay format into Pi transcript messages. */
function historyToPiMessages(history: AgentChatMessage[]): AgentMessage[] {
  const messages: Message[] = [];
  const toolNames = new Map<string, string>();

  for (const message of history) {
    if (message.role === "system") continue;

    if (message.role === "user") {
      const text = message.content ?? "";
      if (text) {
        messages.push({ role: "user", content: text, timestamp: Date.now() });
      }
      continue;
    }

    if (message.role === "assistant") {
      const content: (TextContent | ThinkingContent | ToolCall)[] = [];
      if (message.thinking?.trim()) {
        content.push({
          type: "thinking",
          thinking: message.thinking,
          thinkingSignature: message.thinking_signature,
        });
      }
      if (message.content?.trim()) {
        content.push({ type: "text", text: message.content });
      }
      for (const call of message.tool_calls ?? []) {
        const args = parseArguments(call.function.arguments);
        content.push({
          type: "toolCall",
          id: call.id,
          name: call.function.name,
          arguments: args,
        });
        toolNames.set(call.id, call.function.name);
      }
      if (content.length === 0) continue;
      messages.push({
        role: "assistant",
        content,
        api: PI_AGENT.api,
        provider: PI_AGENT.provider,
        model: PI_AGENT.model,
        usage: EMPTY_USAGE,
        stopReason: message.tool_calls?.length ? "toolUse" : "stop",
        timestamp: Date.now(),
      } satisfies AssistantMessage);
      continue;
    }

    if (message.role === "tool" && message.tool_call_id) {
      messages.push({
        role: "toolResult",
        toolCallId: message.tool_call_id,
        toolName:
          message.name ?? toolNames.get(message.tool_call_id) ?? "tool",
        content: [{ type: "text", text: message.content ?? "" }],
        isError: false,
        timestamp: Date.now(),
      } satisfies ToolResultMessage);
    }
  }

  // Pi's continue() needs a user or tool result at the end of the transcript.
  const last = messages[messages.length - 1];
  if (!last || last.role === "assistant") {
    messages.push({
      role: "user",
      content: "Continue from where you left off.",
      timestamp: Date.now(),
    });
  }

  return messages;
}

/** Convert Pi's transcript back into the shape Forge persists and replays. */
export function piMessagesToHistory(
  messages: readonly AgentMessage[],
): AgentChatMessage[] {
  const history: AgentChatMessage[] = [];

  for (const message of messages) {
    if (message.role === "system") continue;

    if (message.role === "user") {
      const content = textFromContent(message.content);
      history.push({ role: "user", content });
      continue;
    }

    if (message.role === "assistant") {
      const text = textFromContent(message.content);
      const { thinking, signature } = thinkingFromContent(message.content);
      const toolCalls: AgentToolCall[] = message.content
        .filter((block): block is ToolCall => block.type === "toolCall")
        .map((call) => ({
          id: call.id,
          type: "function",
          function: {
            name: call.name,
            arguments: JSON.stringify(call.arguments ?? {}),
          },
        }));

      history.push({
        role: "assistant",
        content: text || null,
        ...(thinking ? { thinking } : {}),
        ...(signature ? { thinking_signature: signature } : {}),
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
      });
      continue;
    }

    if (message.role === "toolResult") {
      history.push({
        role: "tool",
        tool_call_id: message.toolCallId,
        name: message.toolName,
        content: textFromContent(message.content),
      });
    }
  }

  return history;
}

function parseTodos(value: unknown): AgentTodoItem[] | null {
  if (!value || typeof value !== "object") return null;
  const raw = (value as { todos?: unknown }).todos;
  if (!Array.isArray(raw)) return null;

  const todos: AgentTodoItem[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const content = (entry as { content?: unknown }).content;
    const status = (entry as { status?: unknown }).status;
    if (typeof content !== "string" || !content.trim()) continue;
    if (typeof status !== "string" || !TODO_STATUSES.has(status)) continue;
    todos.push({
      content: content.trim(),
      status: status as AgentTodoItem["status"],
    });
  }
  return todos.length > 0 ? todos : null;
}

function todoSummary(todos: AgentTodoItem[]): string {
  const done = todos.filter((todo) => todo.status === "completed").length;
  return `Task plan updated: ${done}/${todos.length} complete.`;
}

function resultFromOutcome(outcome: AgentToolOutcome): AgentToolResult {
  return {
    content: [{ type: "text", text: outcome.output }],
    details: {
      summary: outcome.summary,
      status: outcome.status,
      changed: outcome.changed,
      ...(outcome.detail !== undefined ? { detail: outcome.detail } : {}),
      ...(outcome.path !== undefined ? { path: outcome.path } : {}),
    },
    isError: outcome.status === "error",
  };
}

function buildPiTools(onTodos: (todos: AgentTodoItem[]) => void): AgentTool[] {
  return AGENT_TOOLS.map((definition) => {
    const name = definition.function.name;
    return {
      name,
      description: definition.function.description,
      parameters: definition.function.parameters as unknown as TSchema,
      label: name,
      execute: async (_toolCallId, params) => {
        if (name === "todo_write") {
          const todos = parseTodos(params);
          if (!todos) {
            const text =
              "Error: todos must be an array of { content, status } items.";
            return {
              content: [{ type: "text", text }],
              details: { summary: "Update the task plan", status: "error" },
              isError: true,
            };
          }
          onTodos(todos);
          return {
            content: [{ type: "text", text: todoSummary(todos) }],
            details: {
              summary: "Update the task plan",
              detail: todoSummary(todos),
              status: "ok",
              changed: false,
            },
          };
        }

        const outcome = await executeAgentTool(name, JSON.stringify(params));
        return resultFromOutcome(outcome);
      },
    } satisfies AgentTool;
  });
}

/**
 * Create one browser Pi session. The caller seeds it with the persisted
 * transcript, subscribes to events, calls continue(), then disposes it.
 */
export function createPiSession(options: PiSessionOptions): PiSession {
  let hitLimit = false;
  let turns = 0;

  const agent = new Agent({
    initialState: {
      systemPrompt: options.systemPrompt,
      model: model(),
      thinkingLevel: PI_AGENT.thinkingLevel as ThinkingLevel,
      tools: buildPiTools(options.onTodos),
      messages: historyToPiMessages(options.history),
    },
    streamFn,
    toolExecution: "sequential",
    sessionId:
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : undefined,
    finishTurn: () => {
      turns += 1;
      if (turns >= options.maxSteps) {
        hitLimit = true;
        return { action: "end" as const };
      }
      return undefined;
    },
  });

  return {
    subscribe: (listener) => agent.subscribe((event) => listener(event)),
    continue: () => agent.continue(),
    abort: () => agent.abort(),
    dispose: () => agent.abort(),
    get hitLimit() {
      return hitLimit;
    },
    toHistory: () => piMessagesToHistory(agent.state.messages),
  };
}
