import type { AgentToolCall, AgentToolDefinition } from "../../shared/types";
import { useUiStore } from "@/store/ui";
import { useWorkspaceStore } from "@/store/workspace";
import { buildFileTree, flattenLeaves } from "./file-tree";
import { joinPath, normalizePath } from "./paths";
import { runtime } from "./runtime";
import { runShellCommand } from "./shell";

const MAX_READ_CHARS = 40_000;
const MAX_WRITE_CHARS = 60_000;
const MAX_BASH_CHARS = 6_000;
const READ_ONLY_COMMANDS = new Set([
  "ls",
  "cat",
  "pwd",
  "help",
  "tree",
  "clear",
]);

export interface AgentToolOutcome {
  output: string;
  summary: string;
  detail?: string;
  status: "ok" | "error";
  changed: boolean;
  path?: string;
}

function fail(summary: string, output: string): AgentToolOutcome {
  return {
    output: `Error: ${output}`,
    summary,
    detail: output,
    status: "error",
    changed: false,
  };
}

function resolvePathArg(
  raw: unknown,
  allowRoot = false,
): { path: string } | { error: string } {
  if (typeof raw !== "string" || !raw.trim())
    return { error: "A path string is required" };
  if (!raw.startsWith("/"))
    return {
      error: `Path must be absolute and start with / (received "${raw}")`,
    };
  if (raw.includes("..") || raw.includes("\0"))
    return { error: "Path must not contain .. or null bytes" };
  if (raw.length > 300) return { error: "Path is too long" };
  const path = normalizePath(raw);
  if (!allowRoot && path === "/")
    return { error: "Expected a file path, not the project root" };
  if (path === "/node_modules" || path.startsWith("/node_modules/")) {
    return { error: "node_modules cannot be accessed" };
  }
  return { path };
}

function afterWrite(path: string, characters: number): void {
  const workspace = useWorkspaceStore.getState();
  workspace.refresh();
  workspace.syncBuffer(path);
  if (
    path === "/index.html" ||
    (path.endsWith(".html") && !path.startsWith("/src/"))
  ) {
    runtime.requestPreviewReload();
  }
  runtime.log("info", `Agent wrote ${path} (${characters} chars)`);
}

function truncate(text: string, limit: number): string {
  if (text.length <= limit) return text;
  return (
    text.slice(0, limit) + `\n… [truncated ${text.length - limit} characters]`
  );
}

function readFileTool(args: Record<string, unknown>): AgentToolOutcome {
  const resolved = resolvePathArg(args.path);
  if ("error" in resolved) return fail("Read failed", resolved.error);
  const { path } = resolved;

  const content = runtime.readFile(path);
  if (content === null) return fail(`Read ${path}`, `File not found: ${path}`);

  return {
    output: truncate(content, MAX_READ_CHARS),
    summary: `Read ${path}`,
    detail: `${content.length.toLocaleString()} chars`,
    status: "ok",
    changed: false,
    path,
  };
}

function writeFileTool(args: Record<string, unknown>): AgentToolOutcome {
  const resolved = resolvePathArg(args.path);
  if ("error" in resolved) return fail("Write failed", resolved.error);
  const { path } = resolved;

  if (typeof args.content !== "string")
    return fail(`Write ${path}`, "content must be a string");
  if (args.content.length > MAX_WRITE_CHARS) {
    return fail(
      `Write ${path}`,
      `File content is too large (max ${MAX_WRITE_CHARS} characters)`,
    );
  }
  if (runtime.isDirectory(path))
    return fail(`Write ${path}`, "That path is a directory");

  try {
    runtime.createFile(path, args.content);
    afterWrite(path, args.content.length);
    return {
      output: `Wrote ${path} (${args.content.length} characters).`,
      summary: `Wrote ${path}`,
      detail: `${args.content.length.toLocaleString()} chars`,
      status: "ok",
      changed: true,
      path,
    };
  } catch (error) {
    return fail(
      `Write ${path}`,
      error instanceof Error ? error.message : String(error),
    );
  }
}

function replaceInFileTool(args: Record<string, unknown>): AgentToolOutcome {
  const resolved = resolvePathArg(args.path);
  if ("error" in resolved) return fail("Edit failed", resolved.error);
  const { path } = resolved;

  if (typeof args.old_text !== "string" || !args.old_text) {
    return fail(`Edit ${path}`, "old_text must be a non-empty string");
  }
  if (typeof args.new_text !== "string")
    return fail(`Edit ${path}`, "new_text must be a string");

  const content = runtime.readFile(path);
  if (content === null) return fail(`Edit ${path}`, `File not found: ${path}`);
  if (!content.includes(args.old_text)) {
    return fail(
      `Edit ${path}`,
      "old_text was not found in the file. Read the file again and match it exactly.",
    );
  }

  const next = content.replace(args.old_text, args.new_text);
  if (next.length > MAX_WRITE_CHARS) {
    return fail(
      `Edit ${path}`,
      `Result would be too large (max ${MAX_WRITE_CHARS} characters)`,
    );
  }

  try {
    runtime.createFile(path, next);
    afterWrite(path, next.length);
    return {
      output: `Replaced 1 occurrence in ${path}.`,
      summary: `Edited ${path}`,
      detail: `+${args.new_text.length} / −${args.old_text.length} chars`,
      status: "ok",
      changed: true,
      path,
    };
  } catch (error) {
    return fail(
      `Edit ${path}`,
      error instanceof Error ? error.message : String(error),
    );
  }
}

function listFilesTool(args: Record<string, unknown>): AgentToolOutcome {
  const resolved = resolvePathArg(args.path ?? "/", true);
  if ("error" in resolved) return fail("List failed", resolved.error);
  const { path } = resolved;

  if (!runtime.exists(path))
    return fail(`List ${path}`, `Directory not found: ${path}`);
  if (!runtime.isDirectory(path))
    return fail(`List ${path}`, "That path is a file, not a directory");

  const entries = runtime.listDir(path).sort((a, b) => {
    const aDir = runtime.isDirectory(joinPath(path, a));
    const bDir = runtime.isDirectory(joinPath(path, b));
    if (aDir !== bDir) return aDir ? -1 : 1;
    return a.localeCompare(b);
  });

  const listing = entries.map((entry) => {
    const isDir = runtime.isDirectory(joinPath(path, entry));
    return isDir ? `${entry}/` : entry;
  });

  return {
    output: listing.join("\n") || "(empty directory)",
    summary: `Listed ${path}`,
    detail: `${entries.length} ${entries.length === 1 ? "entry" : "entries"}`,
    status: "ok",
    changed: false,
    path,
  };
}

async function runBashTool(
  args: Record<string, unknown>,
): Promise<AgentToolOutcome> {
  if (typeof args.command !== "string" || !args.command.trim()) {
    return fail("Run command", "command must be a non-empty string");
  }
  const command = args.command.trim();
  if (command.length > 500) return fail("Run command", "Command is too long");

  const ui = useUiStore.getState();
  ui.addTerminalLine("command", `/ $ ${command}`);

  try {
    const result = await runShellCommand(command, "/");
    const output = result.lines
      .map((line) => line.text)
      .join("\n")
      .trim();

    for (const line of result.lines) ui.addTerminalLine(line.kind, line.text);

    if (result.clear) ui.clearTerminal();

    const firstToken = command.split(/\s+/)[0]?.replace(/^[^a-z]+/i, "") ?? "";
    const changed =
      !READ_ONLY_COMMANDS.has(firstToken) ||
      command.includes(">") ||
      /\b(save|rm|mv|cp|mkdir|touch)\b/.test(command);

    return {
      output: truncate(output || "(no output)", MAX_BASH_CHARS),
      summary: `Ran ${command}`,
      detail: output
        ? truncate(output.split("\n")[0] ?? "", 90)
        : "(no output)",
      status: "ok",
      changed,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    ui.addTerminalLine("error", message);
    return fail(`Ran ${command}`, message);
  }
}

export const AGENT_TOOLS: AgentToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Read the contents of a file in the project.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Absolute path, e.g. /src/App.tsx",
          },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description:
        "Create or overwrite a file. Parent directories are created automatically. Use this for new files or full rewrites.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Absolute path, e.g. /src/components/Card.tsx",
          },
          content: { type: "string", description: "Complete file content" },
        },
        required: ["path", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "replace_in_file",
      description:
        "Replace the first exact occurrence of old_text with new_text. Prefer this for targeted edits instead of rewriting whole files.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Absolute path" },
          old_text: { type: "string", description: "Exact text to find" },
          new_text: { type: "string", description: "Replacement text" },
        },
        required: ["path", "old_text", "new_text"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_files",
      description:
        "List files and directories at a path. Directories end with a slash.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Absolute directory path, e.g. / or /src",
          },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "run_bash",
      description:
        "Run a command in the in-browser virtual shell (ls, cat, pwd, tree, touch, mkdir, mv, cp, rm, echo). Output is returned.",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "Shell command to run" },
        },
        required: ["command"],
      },
    },
  },
];

export async function executeAgentTool(
  name: string,
  rawArguments: string,
): Promise<AgentToolOutcome> {
  let args: Record<string, unknown>;
  try {
    const parsed = rawArguments.trim() ? JSON.parse(rawArguments) : {};
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      throw new Error("expected an object");
    args = parsed as Record<string, unknown>;
  } catch (error) {
    return fail(
      name,
      `Invalid JSON arguments: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  switch (name) {
    case "read_file":
      return readFileTool(args);
    case "write_file":
      return writeFileTool(args);
    case "replace_in_file":
      return replaceInFileTool(args);
    case "list_files":
      return listFilesTool(args);
    case "run_bash":
      return runBashTool(args);
    default:
      return fail(name, `Unknown tool: ${name}`);
  }
}

export interface ToolCallPreview {
  name: string;
  summary: string;
  path?: string;
}

/** A human-readable label for a tool call before it runs. */
export function describeToolCall(call: AgentToolCall): ToolCallPreview {
  const name = call.function?.name ?? "tool";
  let args: Record<string, unknown> = {};
  try {
    args = JSON.parse(call.function?.arguments || "{}") as Record<
      string,
      unknown
    >;
  } catch {
    // Fall through with an empty preview.
  }

  const path = typeof args.path === "string" ? args.path : undefined;
  switch (name) {
    case "read_file":
      return { name, summary: `Read ${path ?? "file"}`, path };
    case "write_file":
      return { name, summary: `Write ${path ?? "file"}`, path };
    case "replace_in_file":
      return { name, summary: `Edit ${path ?? "file"}`, path };
    case "list_files":
      return { name, summary: `List ${path ?? "/"}`, path };
    case "run_bash":
      return {
        name,
        summary: `Run ${typeof args.command === "string" ? args.command : "command"}`,
      };
    default:
      return { name, summary: name };
  }
}

export function buildAgentSystemPrompt(): string {
  const vfs = runtime.getVfs();
  const files = vfs
    ? flattenLeaves(buildFileTree(vfs)).map((node) => node.path)
    : [];
  const shown = files.slice(0, 200);
  const more =
    files.length > shown.length
      ? `\n… ${files.length - shown.length} more files`
      : "";
  const active = useWorkspaceStore.getState().activeFile;

  return `You are Forge Agent, a senior frontend engineer working inside a browser IDE. You change the user's project exclusively through tools, and you never claim a change you did not make with a tool.

The project is a React 18 + TypeScript app running in an in-browser Vite-compatible dev server. Saving a file triggers HMR, so the live preview updates as you work.

Project files:
${shown.join("\n")}${more}
${active ? `\nThe user is currently viewing ${active}.` : ""}

Tools:
- read_file(path): read a file. Read before making targeted edits.
- write_file(path, content): create or overwrite a file; parent folders are created.
- replace_in_file(path, old_text, new_text): replace the first exact occurrence. Prefer this for small edits.
- list_files(path): list a directory.
- run_bash(command): run a command in the virtual shell.

Rules:
- Paths are absolute (start with /). Never touch node_modules.
- Relative imports MUST include the file extension, e.g. import App from './App.tsx' and import './styles.css'. The in-browser server does not resolve extensionless imports.
- React comes from an import map. Do NOT import any other npm package and do not add dependencies; there is no npm install in the preview. Style with plain CSS in /src/styles.css or inline styles.
- Keep /index.html as the entry; do not replace its module script or add external scripts.
- Match the existing visual language. Make focused, working changes rather than large rewrites.
- If you create a component, create the file and update the file that imports it in the same turn.
- Run a read or list when you need to confirm the current state; do not guess file contents.
- Finish with 1–3 short sentences describing what changed. No headings, no bullet lists unless necessary.`;
}
