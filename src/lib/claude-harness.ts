/**
 * Browser Claude Messages harness.
 *
 * The official `@anthropic-ai/sdk` runs the request/stream loop in this tab.
 * Every tool executes against Forge's almostnode VirtualFS, so the agent never
 * leaves the browser. Requests go through the same-origin JWT route; the Nitro
 * server inserts the provider key before forwarding the stream upstream.
 */
import Anthropic from "@anthropic-ai/sdk";
import type {
  AgentChatMessage,
  AgentThinkingBlock,
  AgentTodoItem,
  AgentToolCall,
} from "../../shared/types";
import {
  CLAUDE_AGENT,
  usesAdaptiveThinking,
} from "../../shared/agent";
import { authHeaders, handleUnauthorized, readAuthToken } from "./auth-token";
import {
  AGENT_TOOLS,
  executeAgentTool,
  type AgentToolOutcome,
} from "./agent-tools";

const TODO_STATUSES = new Set(["pending", "in_progress", "completed"]);

export interface ClaudeSessionOptions {
  history: AgentChatMessage[];
  systemPrompt: string;
  maxSteps: number;
  model?: string;
  onTodos: (todos: AgentTodoItem[]) => void;
}

type AssistantBlock =
  | { type: "text"; text: string }
  | { type: "thinking"; thinking: string; thinkingSignature?: string }
  | {
      type: "toolCall";
      id: string;
      name: string;
      arguments: Record<string, unknown>;
    };

type AssistantUpdate =
  | { type: "text_delta"; delta: string }
  | { type: "thinking_start" }
  | { type: "thinking_delta"; delta: string }
  | { type: "thinking_end"; content: string };

export type ClaudeSessionEvent =
  | { type: "turn_start" }
  | { type: "message_start"; message: { role: "assistant" } }
  | {
      type: "message_update";
      message: { role: "assistant" };
      assistantMessageEvent: AssistantUpdate;
    }
  | {
      type: "message_end";
      message: {
        role: "assistant";
        content: AssistantBlock[];
        stopReason: Anthropic.Message["stop_reason"];
      };
    }
  | {
      type: "tool_execution_start";
      toolCallId: string;
      toolName: string;
      args: Record<string, unknown>;
    }
  | {
      type: "tool_execution_end";
      toolCallId: string;
      toolName: string;
      isError: boolean;
      result: {
        details: {
          summary: string;
          detail?: string;
          path?: string;
          status: "ok" | "error";
          changed: boolean;
        };
      };
    };

export interface ClaudeSession {
  subscribe: (listener: (event: ClaudeSessionEvent) => void) => () => void;
  continue: () => Promise<void>;
  abort: () => void;
  dispose: () => void;
  readonly hitLimit: boolean;
  toHistory: () => AgentChatMessage[];
}

function parseJsonObject(value: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function textFromToolResult(
  content: Anthropic.ToolResultBlockParam["content"],
): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) =>
      block && typeof block === "object" && "text" in block
        ? String((block as { text?: unknown }).text ?? "")
        : "",
    )
    .filter(Boolean)
    .join("\n");
}

/**
 * Convert Forge's replay format into Messages API parameters. Thinking blocks
 * are passed back exactly as received (including their signatures), and all
 * tool results that follow one assistant turn are grouped into one user turn.
 */
function historyToMessages(
  history: AgentChatMessage[],
): Anthropic.MessageParam[] {
  const messages: Anthropic.MessageParam[] = [];
  let toolResults: Anthropic.ToolResultBlockParam[] = [];

  const flushToolResults = () => {
    if (toolResults.length === 0) return;
    messages.push({ role: "user", content: toolResults });
    toolResults = [];
  };

  for (const message of history) {
    if (message.role === "tool") {
      if (!message.tool_call_id) continue;
      toolResults.push({
        type: "tool_result",
        tool_use_id: message.tool_call_id,
        content: message.content ?? "",
        ...(message.is_error ? { is_error: true } : {}),
      });
      continue;
    }

    flushToolResults();
    if (message.role === "system") continue;

    if (message.role === "user") {
      if (message.content) messages.push({ role: "user", content: message.content });
      continue;
    }

    const content: Anthropic.ContentBlockParam[] = [];
    const thinkingBlocks: AgentThinkingBlock[] =
      message.thinking_blocks ??
      (message.thinking?.trim()
        ? [
            {
              thinking: message.thinking,
              signature: message.thinking_signature,
            },
          ]
        : []);
    for (const block of thinkingBlocks) {
      if (!block.signature) continue;
      content.push({
        type: "thinking",
        thinking: block.thinking,
        signature: block.signature,
      });
    }
    if (message.content?.trim()) {
      content.push({ type: "text", text: message.content });
    }
    for (const call of message.tool_calls ?? []) {
      content.push({
        type: "tool_use",
        id: call.id,
        name: call.function.name,
        input: parseJsonObject(call.function.arguments),
      });
    }
    if (content.length > 0) {
      messages.push({ role: "assistant", content });
    }
  }

  flushToolResults();

  const last = messages[messages.length - 1];
  if (!last || last.role === "assistant") {
    messages.push({
      role: "user",
      content: "Continue from where you left off.",
    });
  }

  return messages;
}

/** Convert Messages API parameters back into Forge's replay format. */
export function messagesToHistory(
  messages: readonly Anthropic.MessageParam[],
): AgentChatMessage[] {
  const history: AgentChatMessage[] = [];
  const toolNames = new Map<string, string>();

  for (const message of messages) {
    if (message.role === "assistant") {
      const blocks = Array.isArray(message.content)
        ? message.content
        : [{ type: "text" as const, text: message.content }];
      const text: string[] = [];
      const thinkingBlocks: AgentThinkingBlock[] = [];
      const toolCalls: AgentToolCall[] = [];

      for (const block of blocks) {
        if (block.type === "text") {
          text.push(block.text);
        } else if (block.type === "thinking") {
          thinkingBlocks.push({
            thinking: block.thinking,
            signature: block.signature,
          });
        } else if (block.type === "tool_use") {
          toolCalls.push({
            id: block.id,
            type: "function",
            function: {
              name: block.name,
              arguments: JSON.stringify(block.input ?? {}),
            },
          });
          toolNames.set(block.id, block.name);
        }
      }

      if (text.length === 0 && thinkingBlocks.length === 0 && toolCalls.length === 0) {
        continue;
      }

      const thinking = thinkingBlocks
        .map((block) => block.thinking)
        .join("\n");
      history.push({
        role: "assistant",
        content: text.join("\n") || null,
        ...(thinking ? { thinking } : {}),
        ...(thinkingBlocks.length > 0
          ? {
              thinking_blocks: thinkingBlocks,
              thinking_signature: thinkingBlocks[0]?.signature,
            }
          : {}),
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
      });
      continue;
    }

    if (typeof message.content === "string") {
      if (message.content) {
        history.push({ role: "user", content: message.content });
      }
      continue;
    }

    const text: string[] = [];
    for (const block of message.content) {
      if (block.type === "text") {
        text.push(block.text);
      } else if (block.type === "tool_result") {
        history.push({
          role: "tool",
          tool_call_id: block.tool_use_id,
          name: toolNames.get(block.tool_use_id),
          content: textFromToolResult(block.content),
          ...(block.is_error ? { is_error: true } : {}),
        });
      }
    }
    if (text.length > 0) {
      history.push({ role: "user", content: text.join("\n") });
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

function buildTools(): Anthropic.Tool[] {
  return AGENT_TOOLS.map((definition) => ({
    name: definition.function.name,
    description: definition.function.description,
    input_schema:
      definition.function.parameters as Anthropic.Tool["input_schema"],
  }));
}

function createClient(): Anthropic {
  const token = readAuthToken();
  return new Anthropic({
    apiKey: token ?? "forge-local-session",
    baseURL: `${window.location.origin}${CLAUDE_AGENT.baseUrl}`,
    dangerouslyAllowBrowser: true,
    defaultHeaders: {
      "anthropic-dangerous-direct-browser-access": "true",
      ...authHeaders(),
    },
    fetch: async (input, init) => {
      const response = await fetch(input, init);
      handleUnauthorized(response);
      return response;
    },
  });
}

function sanitizeAssistantContent(
  content: Anthropic.ContentBlock[],
): Anthropic.ContentBlockParam[] {
  const blocks: Anthropic.ContentBlockParam[] = [];
  for (const block of content) {
    if (block.type === "thinking") {
      blocks.push({
        type: "thinking",
        thinking: block.thinking,
        signature: block.signature,
      });
    } else if (block.type === "redacted_thinking") {
      blocks.push({ type: "redacted_thinking", data: block.data });
    } else if (block.type === "text") {
      blocks.push({ type: "text", text: block.text });
    } else if (block.type === "tool_use") {
      blocks.push({
        type: "tool_use",
        id: block.id,
        name: block.name,
        input: block.input,
      });
    }
  }
  return blocks;
}

function assistantBlocks(content: Anthropic.ContentBlock[]): AssistantBlock[] {
  const blocks: AssistantBlock[] = [];
  for (const block of content) {
    if (block.type === "text") {
      blocks.push({ type: "text", text: block.text });
    } else if (block.type === "thinking") {
      blocks.push({
        type: "thinking",
        thinking: block.thinking,
        thinkingSignature: block.signature,
      });
    } else if (block.type === "tool_use") {
      blocks.push({
        type: "toolCall",
        id: block.id,
        name: block.name,
        arguments:
          block.input && typeof block.input === "object"
            ? (block.input as Record<string, unknown>)
            : {},
      });
    }
  }
  return blocks;
}

/** Create one browser Claude session over the Forge JWT transport. */
export function createClaudeSession(
  options: ClaudeSessionOptions,
): ClaudeSession {
  const client = createClient();
  const messages = historyToMessages(options.history);
  const tools = buildTools();
  const model = options.model || CLAUDE_AGENT.model;
  const adaptiveThinking = usesAdaptiveThinking(model);
  const controller = new AbortController();
  const listeners = new Set<(event: ClaudeSessionEvent) => void>();

  let activeStream: ReturnType<typeof client.messages.stream> | null = null;
  let hitLimit = false;
  let turns = 0;

  const emit = (event: ClaudeSessionEvent) => {
    for (const listener of listeners) listener(event);
  };

  // Permission mode is allow-all: sending the prompt authorizes every tool in
  // this run, so reads, writes, edits, listing, search, shell and the task plan
  // execute immediately without a second confirmation dialog.
  const runTool = async (
    name: string,
    input: Record<string, unknown>,
  ): Promise<AgentToolOutcome> => {
    if (name === "todo_write") {
      const todos = parseTodos(input);
      if (!todos) {
        return {
          output:
            "Error: todos must be an array of { content, status } items.",
          summary: "Update the task plan",
          status: "error",
          changed: false,
        };
      }
      options.onTodos(todos);
      const summary = todoSummary(todos);
      return {
        output: summary,
        summary: "Update the task plan",
        detail: summary,
        status: "ok",
        changed: false,
      };
    }

    return executeAgentTool(name, JSON.stringify(input));
  };

  const run = async (): Promise<void> => {
    while (!controller.signal.aborted) {
      emit({ type: "turn_start" });
      turns += 1;

      let announced = false;
      let currentBlock: "thinking" | "text" | "tool" | null = null;
      let thinkingBuffer = "";

      const announce = () => {
        if (announced) return;
        announced = true;
        emit({ type: "message_start", message: { role: "assistant" } });
      };

      const thinking = adaptiveThinking
        ? { type: "adaptive" as const, display: "summarized" as const }
        : {
            type: "enabled" as const,
            budget_tokens: Math.min(
              CLAUDE_AGENT.thinkingBudgetTokens,
              CLAUDE_AGENT.maxTokens - 1024,
            ),
            display: "summarized" as const,
          };

      const stream = client.messages.stream(
        {
          model,
          max_tokens: CLAUDE_AGENT.maxTokens,
          system: options.systemPrompt,
          messages,
          tools,
          thinking,
          ...(adaptiveThinking
            ? { output_config: { effort: CLAUDE_AGENT.effort } }
            : {}),
        },
        { signal: controller.signal },
      );
      activeStream = stream;

      try {
        for await (const event of stream) {
          if (controller.signal.aborted) break;
          announce();

          if (event.type === "content_block_start") {
            const type = event.content_block.type;
            currentBlock =
              type === "thinking" ? "thinking" : type === "text" ? "text" : "tool";
            if (currentBlock === "thinking") {
              thinkingBuffer = "";
              emit({
                type: "message_update",
                message: { role: "assistant" },
                assistantMessageEvent: { type: "thinking_start" },
              });
            }
            continue;
          }

          if (event.type === "content_block_delta") {
            if (event.delta.type === "text_delta") {
              emit({
                type: "message_update",
                message: { role: "assistant" },
                assistantMessageEvent: {
                  type: "text_delta",
                  delta: event.delta.text,
                },
              });
            } else if (event.delta.type === "thinking_delta") {
              thinkingBuffer += event.delta.thinking;
              emit({
                type: "message_update",
                message: { role: "assistant" },
                assistantMessageEvent: {
                  type: "thinking_delta",
                  delta: event.delta.thinking,
                },
              });
            }
            continue;
          }

          if (event.type === "content_block_stop") {
            if (currentBlock === "thinking") {
              emit({
                type: "message_update",
                message: { role: "assistant" },
                assistantMessageEvent: {
                  type: "thinking_end",
                  content: thinkingBuffer,
                },
              });
              thinkingBuffer = "";
            }
            currentBlock = null;
          }
        }

        const final = await stream.finalMessage();
        activeStream = null;
        if (controller.signal.aborted) {
          throw new DOMException("Stopped", "AbortError");
        }

        announce();
        emit({
          type: "message_end",
          message: {
            role: "assistant",
            content: assistantBlocks(final.content),
            stopReason: final.stop_reason,
          },
        });

        if (final.stop_reason === "refusal") {
          const explanation = final.stop_details?.explanation;
          throw new Error(
            explanation
              ? `Claude declined this request: ${explanation}`
              : "Claude declined this request.",
          );
        }
        if (final.stop_reason === "model_context_window_exceeded") {
          throw new Error(
            "The conversation exceeded the model's context window. Clear the chat or start a new project.",
          );
        }

        const assistantContent = sanitizeAssistantContent(final.content);
        messages.push({ role: "assistant", content: assistantContent });

        const toolUses = final.content.filter(
          (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
        );

        if (toolUses.length === 0) {
          if (final.stop_reason === "pause_turn") {
            messages.push({
              role: "user",
              content: "Continue from where you left off.",
            });
            if (turns >= options.maxSteps) {
              hitLimit = true;
              break;
            }
            continue;
          }
          break;
        }

        if (final.stop_reason === "max_tokens") {
          throw new Error(
            "The tool call was cut off at max_tokens. Try a smaller edit or retry.",
          );
        }

        const results: Anthropic.ToolResultBlockParam[] = [];
        for (const toolUse of toolUses) {
          if (controller.signal.aborted) {
            throw new DOMException("Stopped", "AbortError");
          }

          const args =
            toolUse.input && typeof toolUse.input === "object"
              ? (toolUse.input as Record<string, unknown>)
              : {};

          emit({
            type: "tool_execution_start",
            toolCallId: toolUse.id,
            toolName: toolUse.name,
            args,
          });

          let outcome: AgentToolOutcome;
          try {
            outcome = await runTool(toolUse.name, args);
          } catch (error) {
            outcome = {
              output: `Error: ${error instanceof Error ? error.message : String(error)}`,
              summary: `${toolUse.name} failed`,
              status: "error",
              changed: false,
            };
          }

          const isError = outcome.status === "error";
          emit({
            type: "tool_execution_end",
            toolCallId: toolUse.id,
            toolName: toolUse.name,
            isError,
            result: {
              details: {
                summary: outcome.summary,
                detail: outcome.detail,
                path: outcome.path,
                status: outcome.status,
                changed: outcome.changed,
              },
            },
          });

          results.push({
            type: "tool_result",
            tool_use_id: toolUse.id,
            content: outcome.output,
            ...(isError ? { is_error: true } : {}),
          });
        }

        messages.push({ role: "user", content: results });

        if (turns >= options.maxSteps) {
          hitLimit = true;
          break;
        }
      } finally {
        activeStream = null;
      }
    }
  };

  return {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    continue: run,
    abort: () => {
      activeStream?.abort();
      controller.abort();
    },
    dispose: () => {
      activeStream?.abort();
      controller.abort();
      listeners.clear();
    },
    get hitLimit() {
      return hitLimit;
    },
    toHistory: () => messagesToHistory(messages),
  };
}
