/**
 * Minimal MCP client for https://mcp.vercel.com.
 *
 * The browser speaks JSON-RPC 2.0 over the Streamable HTTP transport to the
 * same-origin `/api/mcp/vercel` proxy (the upstream does not send CORS
 * headers). Tools are exposed to the Claude harness with a `vercel__` prefix so
 * they cannot collide with the built-in project tools.
 */
import { authHeaders, handleUnauthorized } from "./auth-token";
import {
  getVercelMcpToken,
  hasVercelMcpSession,
} from "./mcp-oauth";

const PREFIX = "vercel__";
const PROTOCOL_VERSION = "2025-06-18";
const CLIENT_NAME = "forge-sandbox";
const CLIENT_VERSION = "0.1.0";
const REQUEST_TIMEOUT_MS = 120_000;
const MAX_TOOL_OUTPUT_CHARS = 40_000;
const MAX_TOOLS = 200;

export const VERCEL_MCP_TOOL_PREFIX = PREFIX;

export interface VercelMcpTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export interface VercelAnthropicTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface VercelMcpToolResult {
  name: string;
  text: string;
  isError: boolean;
}

interface JsonRpcMessage {
  jsonrpc?: unknown;
  id?: number | string | null;
  result?: unknown;
  error?: { code?: number; message?: string; data?: unknown };
}

class McpAuthError extends Error {}
class McpSessionExpiredError extends Error {}

let sessionId: string | null = null;
let protocolVersion = PROTOCOL_VERSION;
let initialized = false;
let initPromise: Promise<void> | null = null;
let toolsCache: VercelMcpTool[] | null = null;
let nextId = 1;

const anthropicNameByRaw = new Map<string, string>();
const rawNameByAnthropic = new Map<string, string>();

function parseMessages(text: string): JsonRpcMessage[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      return Array.isArray(parsed)
        ? (parsed as JsonRpcMessage[])
        : [parsed as JsonRpcMessage];
    } catch {
      // Fall through to SSE parsing.
    }
  }

  const messages: JsonRpcMessage[] = [];
  for (const block of trimmed.split(/\r?\n\r?\n/)) {
    const data = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (!data) continue;
    try {
      const parsed: unknown = JSON.parse(data);
      if (Array.isArray(parsed)) messages.push(...(parsed as JsonRpcMessage[]));
      else messages.push(parsed as JsonRpcMessage);
    } catch {
      // Keep the other events; a malformed one is not fatal.
    }
  }
  return messages;
}

interface SendOptions {
  initialize?: boolean;
  notification?: boolean;
  forceRefresh?: boolean;
}

async function sendRpc(
  payload: Record<string, unknown>,
  options: SendOptions = {},
): Promise<unknown> {
  try {
    return await sendRpcOnce(payload, options, Boolean(options.forceRefresh));
  } catch (error) {
    if (!(error instanceof McpAuthError)) throw error;
    // The cached token was rejected; refresh once and replay the request.
    return await sendRpcOnce(payload, options, true);
  }
}

async function sendRpcOnce(
  payload: Record<string, unknown>,
  options: SendOptions,
  forceRefresh: boolean,
): Promise<unknown> {
  const token = await getVercelMcpToken(forceRefresh);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch("/api/mcp/vercel", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        ...authHeaders(),
        "x-mcp-token": token,
        ...(sessionId ? { "mcp-session-id": sessionId } : {}),
        ...(options.initialize
          ? {}
          : { "mcp-protocol-version": protocolVersion }),
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch (error) {
    throw new Error(
      controller.signal.aborted
        ? "The Vercel MCP server timed out."
        : `Could not reach the Vercel MCP proxy: ${
            error instanceof Error ? error.message : String(error)
          }`,
    );
  } finally {
    clearTimeout(timer);
  }

  handleUnauthorized(response);

  const nextSession = response.headers.get("mcp-session-id");
  if (nextSession) sessionId = nextSession;

  const text = await response.text();

  const authFailure =
    response.status === 401 ||
    (response.status === 403 &&
      (response.headers.get("x-mcp-auth") === "invalid-token" ||
        response.headers.get("x-mcp-auth") === "required"));
  if (authFailure) {
    throw new McpAuthError(
      "Vercel rejected the MCP token. Reconnect Vercel MCP.",
    );
  }
  if (response.status === 404 && initialized && !options.initialize) {
    throw new McpSessionExpiredError("The Vercel MCP session expired.");
  }
  if (!response.ok) {
    let detail = text.trim();
    try {
      const parsed = JSON.parse(text) as { error?: unknown; message?: unknown };
      detail = String(parsed.message ?? parsed.error ?? detail);
    } catch {
      // Keep the raw body.
    }
    throw new Error(
      `Vercel MCP error (HTTP ${response.status}): ${detail.slice(0, 400)}`,
    );
  }

  if (options.notification) return null;

  const messages = parseMessages(text);
  const reply = messages.find(
    (message) => message.id === payload.id && message.id !== undefined,
  );
  if (!reply) {
    throw new Error("The Vercel MCP server returned no JSON-RPC reply.");
  }
  if (reply.error) {
    throw new Error(
      reply.error.message
        ? `Vercel MCP: ${reply.error.message}`
        : "The Vercel MCP server returned an error.",
    );
  }
  return reply.result;
}

/** Re-initialise an expired session and replay the request once. */
async function withRecovery<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof McpSessionExpiredError) {
      resetVercelMcp();
      await ensureInitialized();
      return await operation();
    }
    throw error;
  }
}

async function initialize(): Promise<void> {
  const result = (await sendRpc(
    {
      jsonrpc: "2.0",
      id: nextId++,
      method: "initialize",
      params: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: CLIENT_NAME, version: CLIENT_VERSION },
      },
    },
    { initialize: true, forceRefresh: false },
  )) as { protocolVersion?: unknown } | null;

  if (result && typeof result.protocolVersion === "string") {
    protocolVersion = result.protocolVersion;
  }

  try {
    await sendRpc(
      { jsonrpc: "2.0", method: "notifications/initialized", params: {} },
      { notification: true },
    );
  } catch {
    // Some servers answer 202/204 with an empty body; a failure here is not
    // fatal because tools/list is the operation that matters.
  }
}

async function ensureInitialized(): Promise<void> {
  if (initialized) return;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    await initialize();
    initialized = true;
  })().finally(() => {
    initPromise = null;
  });

  return initPromise;
}

async function fetchTools(): Promise<VercelMcpTool[]> {
  const tools: VercelMcpTool[] = [];
  let cursor: string | undefined;

  for (let page = 0; page < 10; page += 1) {
    const result = (await sendRpc({
      jsonrpc: "2.0",
      id: nextId++,
      method: "tools/list",
      params: cursor ? { cursor } : {},
    })) as {
      tools?: unknown;
      nextCursor?: unknown;
    } | null;

    const list = Array.isArray(result?.tools) ? result.tools : [];
    for (const entry of list) {
      if (!entry || typeof entry !== "object") continue;
      const tool = entry as {
        name?: unknown;
        description?: unknown;
        inputSchema?: unknown;
      };
      if (typeof tool.name !== "string" || !tool.name) continue;
      tools.push({
        name: tool.name,
        description:
          typeof tool.description === "string" ? tool.description : undefined,
        inputSchema:
          tool.inputSchema && typeof tool.inputSchema === "object"
            ? (tool.inputSchema as Record<string, unknown>)
            : undefined,
      });
      if (tools.length >= MAX_TOOLS) break;
    }

    if (tools.length >= MAX_TOOLS) break;
    if (typeof result?.nextCursor !== "string" || !result.nextCursor) break;
    cursor = result.nextCursor;
  }

  buildNameMap(tools);
  return tools;
}

function buildNameMap(tools: VercelMcpTool[]): void {
  anthropicNameByRaw.clear();
  rawNameByAnthropic.clear();
  const used = new Set<string>();

  for (const tool of tools) {
    const cleaned = tool.name.replace(/[^A-Za-z0-9_-]/g, "_") || "tool";
    const base = `${PREFIX}${cleaned}`.slice(0, 64);
    let name = base;
    let suffix = 2;
    while (used.has(name)) {
      const tail = `_${suffix++}`;
      name = `${base.slice(0, 64 - tail.length)}${tail}`;
    }
    used.add(name);
    anthropicNameByRaw.set(tool.name, name);
    rawNameByAnthropic.set(name, tool.name);
  }
}

function normalizeSchema(
  schema: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!schema || schema.type !== "object") {
    return { type: "object", properties: {} };
  }
  return schema;
}

/** Tools in the Messages API shape. Empty when Vercel is not connected. */
export async function getVercelMcpAnthropicTools(): Promise<
  VercelAnthropicTool[]
> {
  if (!hasVercelMcpSession()) return [];

  const tools = await loadVercelMcpTools();
  return tools.map((tool) => ({
    name: anthropicNameByRaw.get(tool.name) ?? `${PREFIX}${tool.name}`.slice(0, 64),
    description: tool.description ?? `Vercel tool: ${tool.name}`,
    input_schema: normalizeSchema(tool.inputSchema),
  }));
}

export async function loadVercelMcpTools(): Promise<VercelMcpTool[]> {
  if (!hasVercelMcpSession()) return [];
  if (toolsCache) return toolsCache;

  await ensureInitialized();
  toolsCache = await withRecovery(fetchTools);
  return toolsCache;
}

function blockText(block: unknown): string | null {
  if (!block || typeof block !== "object") return null;
  const entry = block as {
    type?: unknown;
    text?: unknown;
    data?: unknown;
    mimeType?: unknown;
    resource?: unknown;
  };
  if (entry.type === "text" && typeof entry.text === "string") {
    return entry.text;
  }
  if (entry.type === "image") {
    return `[image${typeof entry.mimeType === "string" ? ` ${entry.mimeType}` : ""}]`;
  }
  if (entry.type === "resource") {
    const resource = entry.resource as
      | { uri?: unknown; text?: unknown; mimeType?: unknown }
      | undefined;
    if (resource && typeof resource.text === "string") return resource.text;
    if (resource && typeof resource.uri === "string") {
      return `[resource ${resource.uri}]`;
    }
    return "[resource]";
  }
  if (entry.type === "audio") return "[audio]";
  return JSON.stringify(block);
}

function formatResult(result: {
  content?: unknown;
  structuredContent?: unknown;
}): string {
  const parts: string[] = [];
  if (Array.isArray(result.content)) {
    for (const block of result.content) {
      const text = blockText(block);
      if (text) parts.push(text);
    }
  }
  if (parts.length === 0 && result.structuredContent !== undefined) {
    try {
      parts.push(JSON.stringify(result.structuredContent, null, 2));
    } catch {
      parts.push(String(result.structuredContent));
    }
  }

  const text = parts.join("\n\n").trim() || "(no output)";
  if (text.length <= MAX_TOOL_OUTPUT_CHARS) return text;
  return `${text.slice(0, MAX_TOOL_OUTPUT_CHARS)}\n… [truncated ${
    text.length - MAX_TOOL_OUTPUT_CHARS
  } chars]`;
}

export async function callVercelMcpTool(
  anthropicName: string,
  input: Record<string, unknown>,
): Promise<VercelMcpToolResult> {
  await loadVercelMcpTools();
  const rawName =
    rawNameByAnthropic.get(anthropicName) ??
    anthropicName.slice(PREFIX.length);

  const result = (await withRecovery(() =>
    sendRpc({
      jsonrpc: "2.0",
      id: nextId++,
      method: "tools/call",
      params: { name: rawName, arguments: input ?? {} },
    }),
  )) as {
    content?: unknown;
    structuredContent?: unknown;
    isError?: unknown;
  } | null;

  return {
    name: rawName,
    text: formatResult(result ?? {}),
    isError: Boolean(result?.isError),
  };
}

/** Forget the session and tool cache, e.g. after disconnecting Vercel. */
export function resetVercelMcp(): void {
  sessionId = null;
  protocolVersion = PROTOCOL_VERSION;
  initialized = false;
  initPromise = null;
  toolsCache = null;
  anthropicNameByRaw.clear();
  rawNameByAnthropic.clear();
}
