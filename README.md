# Forge — a browser-native project IDE

Forge is an IDE that runs its entire development environment in the browser.
The editor, file explorer, terminal, and live preview share an in-memory file
system provided by [almostnode]; a Vite-compatible dev server is mounted inside
the page and served through a service worker. A Nitro backend handles
authentication and proxies the model APIs; project files stay in the browser's
Origin Private File System.

Built with **Vite 7 · Nitro 3 · TypeScript · React 19 · Zustand 5 · Tailwind CSS 4 · almostnode 0.2.14**.

```
┌──────────────────────────────────────────────────────────────────────┐
│  Forge shell (React + Zustand)                                       │
│                                                                      │
│  Explorer ─▶ workspace store ─▶ IdeRuntime ──▶ VirtualFS             │
│  CodeMirror ── writes ───────────┘                 │                 │
│                                                   ▼                  │
│  Preview iframe ◀── service worker ◀── ViteDevServer (in browser)    │
│        │                        /__virtual__/3000/                   │
│        └── HMR via postMessage ──┘                                   │
│                                                                      │
│  Nitro API ◀── /api/auth + model proxies (JWT)                       │
│                                                                      │
│  Agent chat ── tools ──▶ VirtualFS ──▶ OPFS sandbox/<ide>/projects  │
│       └── /api/anthropic · /api/deepseek (JWT) ──▶ DeepSeek API     │
└──────────────────────────────────────────────────────────────────────┘
```

## Getting started

```bash
npm install
npm run dev        # Vite + Nitro on http://localhost:5173
```

`npm run dev` starts one server: Vite serves the React shell and, through the
Nitro Vite plugin, `/api/*` routes live in the same process. The almostnode
service worker is served from `/__sw__.js`.

Tailwind CSS v4 is wired through `@tailwindcss/vite` and loaded from
`src/tailwind.css`. Preflight is intentionally omitted so the IDE's existing
chassis reset and typography stay the baseline.

### Production

```bash
npm run build      # typecheck + client build + Nitro server bundle
npm start          # serves .output on http://localhost:3000
```

Set `PORT` to change the production port. Project files are stored in each
browser's OPFS; the server does not store project snapshots.

### UI password

Set `FORGE_PASSWORD` to require a password before the IDE mounts (the local
`.env` in this checkout uses `12123`). The server compares it in constant time
and, on `POST /api/auth`, returns a signed **JWT with no `exp` claim**. The
browser stores that token in `localStorage` under `sandbox-ide-jwt` and sends it
as `Authorization: Bearer <token>` on every REST request. All API routes except
`GET/POST /api/auth` reject requests without a valid token.

Leave `FORGE_PASSWORD` empty to disable the gate. The token is signed with
`FORGE_JWT_SECRET` when set; otherwise the secret is derived from the password,
so changing the password revokes existing tokens. Set an explicit secret if you
want to rotate the password without invalidating sessions. Because the token
lives in `localStorage`, prevent XSS as you would for any token-based client.
In the Vite dev server, rejected API calls use **403** instead of 401 because
Nitro 3's dev worker crashes on 401 POST responses; production keeps **401**.

### Deploying to Vercel

Nitro runs as one Vercel Function. Set `FORGE_PASSWORD` and the model
credentials in the project's environment variables; `.env` files are not
deployed. Project code stays in the browser, so the function needs no durable
project storage.

Handlers live in `server/routes/api` rather than a root `api/` directory, which
Vercel reserves. Build with the Nitro Vercel preset (Nitro detects Vercel
automatically during `npm run build`).

## What you can do

- **Edit files** in a CodeMirror editor with TS/TSX, JSX, CSS, HTML, JSON and
  Markdown support.
- **See changes instantly.** Writes go to the virtual file system and almostnode
  posts HMR updates into the preview iframe. Editing `src/App.tsx` updates the
  running app without a page reload.
- **Manage files** with the explorer: create, rename, delete, drag-free context
  menus, and a fuzzy name filter.
- **Run shell commands** against the same VFS: `ls`, `cd`, `cat`, `tree`,
  `echo "…" > file`, `mkdir`, `touch`, `rm -r`, `mv`, `cp`, `open`.
- **Keep your work automatically.** Every file change is mirrored into OPFS and
  the last active project is restored on refresh. Rename the project from the
  title bar; renaming only changes the local project.
- **Resize** the editor/preview and editor/terminal splits; layout preferences
  persist in `localStorage`.
- **Open the preview in a new tab** and reload it without restarting the runtime.
- **Download the project** with the top-bar **Download** button: every file in
  the virtual file system is zipped under a folder named after the project,
  alongside a `forge.manifest.json` describing the archive format and version.
- **Import a project** with **Import ZIP** next to Download. Forge reads and
  validates the manifest first, rejects newer archive versions, then starts a
  new local project from the archive's files. Archives exported before the
  manifest existed are rejected with an explanation.
- **Ask the agent to change the project.** The Agent workbench reads, writes and
  replaces files in the same VFS, runs shell commands, and streams its answer
  into the chat while the preview hot-reloads (see below).

Keyboard shortcuts: `⌘B` explorer · `⌘J` panel · `⌘⇧A` focus agent chat ·
`Esc` close dialog · `↑/↓` shell history.

## Agent workbench

The agent runs **in this tab**. The browser owns the conversation, the tool
loop, and every file operation; the only thing that leaves the tab is the model
request, sent to a same-origin REST proxy. Three frontend harnesses share the
same tools, thinking log, task plan, undo snapshot, and "Keep going" card:

```
pi (default) ── pi-agent-core + pi-ai ──▶ POST /api/anthropic/v1/messages (JWT)
claude ── Anthropic SDK ─────────────────▶ POST /api/anthropic/v1/messages (JWT)
                                             │
                                             ▼
                              https://api.deepseek.com/anthropic
                                             ▲
                                  key inserted server-side

deepseek ── SSE loop ──▶ POST /api/deepseek/chat/completions (JWT) ──▶ DeepSeek
      │                                                              ▲
      └── tools ──▶ VirtualFS ──▶ OPFS mirror             key inserted here
```

The **claude** engine is the frontend Claude agent: the official
`@anthropic-ai/sdk` runs in the browser (`dangerouslyAllowBrowser`), streams
Anthropic Messages events, and calls the JWT proxy. The Anthropic runtime is
configured from `shared/claude.ts`:

- `ANTHROPIC_MODEL=deepseek-flash[1m]`
- `ANTHROPIC_DEFAULT_OPUS_MODEL` / `ANTHROPIC_DEFAULT_SONNET_MODEL` =
  `deepseek-v4-pro[1m]`
- `ANTHROPIC_DEFAULT_HAIKU_MODEL` / `CLAUDE_CODE_SUBAGENT_MODEL` =
  `deepseek-flash`
- `CLAUDE_CODE_EFFORT_LEVEL=high`
- `CLAUDE_CODE_MAX_CONTEXT_TOKENS=500000`,
  `CLAUDE_CODE_AUTO_COMPACT_WINDOW=400000` (the browser loop drops the oldest
  turns past that budget)
- `CLAUDE_REMOTE_CONTROL_SESSION_NAME_PREFIX=claudetypscript`

`ANTHROPIC_AUTH_TOKEN` is the Forge JWT in the browser; the proxy swaps it for
`DEEPSEEK_API_KEY`, falling back to `AGENT_API_KEY`, and forwards to
`DEEPSEEK_ANTHROPIC_BASE_URL` (default `https://api.deepseek.com/anthropic`).
It accepts the JWT as either `Authorization: Bearer` or `x-api-key`, allows only
`v1/messages` and `v1/messages/count_tokens`, and never lets the caller choose
the upstream URL.

The **pi** engine (default) runs a browser build of Pi's coding-agent primitives:
`@earendil-works/pi-agent-core` owns the Agent/session loop, tool execution,
steering, and lifecycle events, while `@earendil-works/pi-ai` supplies the
Anthropic Messages transport. The harness creates a session from the persisted
transcript, subscribes to `message_update` / `tool_execution_*` / `agent_end`
events, and maps them into the same transcript UI. It uses the same tool
functions and JWT proxy as the other engines.

The published `@earendil-works/pi-coding-agent` SDK itself is Node/Bun-only:
`createAgentSession()` pulls in `node:fs`, file-backed JSONL sessions, and
native tool processes. Forge uses the browser-safe Pi packages behind the same
session shape (`subscribe`, `prompt`/`continue`, `abort`, `dispose`) so the
coding-agent workflow stays in the frontend without moving the loop server-side.

The **deepseek** engine is the original frontend loop against the
OpenAI-compatible proxy (`server/routes/api/deepseek/chat/completions.post.ts`).
Switch engines with the `claude` / `deepseek` / `pi` pills in the agent strip;
the choice persists in `localStorage`.

> Why not `@anthropic-ai/claude-agent-sdk`? Its `query()` spawns the Claude Code
> native binary, which is Node-only; the package's `/browser` entry only attaches
> to Anthropic's remote-session service. Running it here would move the loop back
> to the server, so the frontend uses the official Anthropic client instead.

The shared tool set is `read_file`, `write_file`, `replace_in_file`,
`list_files`, `search` (case-insensitive keyword search across all files),
`run_bash`, and `todo_write`.

Each turn:

1. The selected harness sends the system prompt, conversation, and tool schemas
   to the proxy (Pi does this through pi-ai's Anthropic transport).
2. Content streams into the assistant bubble while thinking deltas stream into a
   fixed-height, auto-scrolling **Thinking log** above it.
3. Tool calls are executed in order against the almostnode `VirtualFS`.
4. File tools write through `IdeRuntime`, which mirrors every mutation into OPFS.
5. `todo_write` updates the pinned task panel instead of producing a tool card.
6. The loop repeats until the model answers without tool calls (max 100 steps). If
   the limit is reached, a **Keep going** card appears with a 3-second countdown.
   If it is not cancelled, the harness clicks Keep going automatically and resumes
   from the saved history. **Cancel** stops the automatic resume; the Keep going
   button stays available for a manual retry.
7. The pre-turn snapshot powers **Undo run**; a chime marks completion.
8. If the model ends with an empty response, a 3-second countdown sends
   `keep going`. **Cancel** stops the automatic retry; the button disables once
   the prompt is sent or the retry is cancelled.

The chat lives in its **own column beside the editor**: drag the divider between
them to resize it, or press `⌘⇧A` to focus the composer. Tool calls appear as
colour-coded cards (read, write, shell, search) with status accents, file chips,
expandable output, and a running scan line. While a turn is active, an animated
SVG loader sits at the bottom of the chat column and reports the current step.

The composer is a **prompt queue**. Submitting while a turn runs adds the prompt
to the **Up next** tray (remove one with ×, clear all with the trash button)
instead of dropping it. Each successful turn automatically starts the next
queued prompt. **Stop**, an error, or the step limit pauses the queue; press
**Run queue** to continue with the oldest prompt. Pressing **Stop** also rolls
the current conversation back to its last completed message.

## OPFS project storage

Project code is persisted in the browser's Origin Private File System:

```
sandbox/<ide-sandbox-id>/projects/<project-id>/<project files…>
sandbox/<ide-sandbox-id>/projects/<project-id>/agent-state.json
sandbox/<ide-sandbox-id>/projects/<project-id>/.forge/project.json
```

- `<ide-sandbox-id>` is generated once per browser profile and stored in
  `localStorage` as `forge.sandboxId`.
- Each project gets a stable id; new projects use a `local-…` id stored as
  `forge.localProject`. The last active id is kept in `forge.currentProject`, so
  a reload restores the project you were working on.
- Boot hydrates OPFS first, so reloads restore work without a network request.
  If there is no project on disk, the starter template is created and seeded.
- Every `VirtualFS` write/create/rename/delete is mirrored through
  `IdeRuntime.setFileSink()`. On new, import, or undo, the whole folder is
  rewritten.
- The agent transcript lives at `projects/<project-id>/agent-state.json` and is
  excluded from the virtual file system, so it never appears in the explorer,
  the preview, or the agent's tools. It stores the messages, model history,
  task plan, queue, engine choice, and undo snapshot, is debounced while the
  agent runs, and is restored on reload or when importing a project. New
  projects start with an empty transcript.
- Browsers without OPFS fall back to the previous in-memory behaviour; the sink
  no-ops and the app still runs.

### Environment variables

| Variable                      | Purpose                                                                 |
| ----------------------------- | ----------------------------------------------------------------------- |
| `DEEPSEEK_API_KEY`            | Credential inserted by both proxies                                     |
| `AGENT_API_KEY`               | Credential fallback (also the `ANTHROPIC_AUTH_TOKEN` equivalent)        |
| `DEEPSEEK_MODEL`              | DeepSeek-loop model (default `deepseek-flash`)                          |
| `DEEPSEEK_BASE_URL`           | OpenAI-compatible upstream (default `https://api.deepseek.com`)         |
| `DEEPSEEK_ANTHROPIC_BASE_URL` | Anthropic-compatible upstream (default `https://api.deepseek.com/anthropic`) |
| `AGENT_MODEL`                 | Model fallback when `DEEPSEEK_MODEL` is empty                           |
| `AGENT_BASE_URL`              | Base URL fallback when `DEEPSEEK_BASE_URL` is empty                     |
| `FORGE_PASSWORD`              | Password that gates the UI and issues the proxy JWT                     |

### Security and privacy

- The proxy requires a valid Forge JWT; unauthenticated requests get `403`
  (development) or `401` (production) with `X-Forge-Auth: required`.
- The DeepSeek key is server-only. The browser never receives it.
- The upstream URL is server-configured; request bodies cannot redirect it.
- The OpenAI-compatible proxy caps conversations at 80 messages / 300k characters
  and tools at 16. The Anthropic proxy caps conversations at 200 messages and
  8 MB request bodies, and exposes only `v1/messages` and
  `v1/messages/count_tokens`.
- Tool paths must be absolute; `..`, null bytes, and `node_modules` are rejected.
- OPFS data is origin-scoped. The app requests persistent storage so the browser
  is less likely to evict it.

## How the almostnode integration works

The implementation follows the pattern used by almostnode's agent workbench demo:

1. **Mount a project.** `new VirtualFS()` is seeded with the source of a small
   React + TypeScript app (`src/lib/starter-project.ts`).
2. **Start a dev server in the tab.** `new ViteDevServer(vfs, { port: 3000 })`
   transforms TSX with esbuild-wasm and serves the files.
3. **Register a service worker.** `getServerBridge().initServiceWorker()` makes
   `/__virtual__/3000/*` resolve to the in-tab server. Remote requests from the
   preview are forwarded to the virtual server.
4. **Point an iframe at it.** The preview iframe navigates to
   `/__virtual__/3000/`. `server.setHMRTarget(iframe.contentWindow)` lets the
   dev server post HMR updates into the sandboxed document.
5. **Persist.** Every mutation is mirrored into OPFS; boot restarts the Vite dev
   server against a fresh `VirtualFS` loaded from those stored files.

The runtime lives outside React (`src/lib/runtime.ts`) and publishes events.
Zustand stores (`src/store/`) turn those events into UI state and own the file
tree, tabs, buffers, logs, project metadata, and layout.

## Project layout

```
├── index.html
├── vite.config.ts          # React + Nitro + almostnode SW middleware
├── src/
│   ├── App.tsx             # IDE shell and split layout
│   ├── components/         # title bar, explorer, editor, preview, terminal…
│   │   └── agent/          # AgentPanel, setup dialog, markdown renderer
│   ├── lib/
│   │   ├── runtime.ts      # VirtualFS + ViteDevServer + service worker
│   │   ├── starter-project.ts
│   │   ├── bootstrap.ts    # OPFS → starter hydration; binds the sink
│   │   ├── shell.ts        # in-browser shell over the VFS
│   │   ├── opfs.ts         # OPFS project store + runtime file sink
│   │   ├── agent-client.ts  # SSE client for the DeepSeek loop
│   │   ├── claude-client.ts # Anthropic SDK stream + message conversion
│   │   ├── claude-config.ts # re-exports shared Claude agent settings
│   │   ├── agent-tools.ts   # in-tab tool schemas + VFS/bash execution
│   │   └── api.ts           # authentication client
│   └── store/              # runtime · workspace · projects · ui · agent (Zustand)
├── server/
│   ├── routes/api/         # Nitro routes (/api/health, /api/deepseek,
│   │                       #   /api/anthropic, /api/auth)
│   └── utils/              # password gate
├── shared/
│   ├── types.ts            # API + agent types
│   └── claude.ts           # Claude agent model/effort/compaction settings
```

Project code and the agent transcript live in the browser's OPFS.

## API

| Method | Route               | Description                              |
| ------ | ------------------- | ---------------------------------------- |
| GET    | `/api/health`       | Service health                           |
| GET    | `/api/auth`         | Whether a password is required/unlocked  |
| POST   | `/api/auth`         | Exchange `{ password }` for a no-expiry JWT |
| GET    | `/api/agent/status` | Proxy route + credential status          |
| POST   | `/api/deepseek/chat/completions` | JWT-authenticated DeepSeek SSE proxy |
| POST   | `/api/anthropic/v1/messages` | JWT-authenticated Anthropic Messages proxy |
| POST   | `/api/anthropic/v1/messages/count_tokens` | Token-count passthrough |

All routes except `GET /api/auth` and `POST /api/auth` require
`Authorization: Bearer <token>` when `FORGE_PASSWORD` is configured. The
Anthropic proxy also accepts the JWT as `x-api-key`, which is how the official
Anthropic SDK authenticates.

Both agent proxies validate the Forge JWT, insert the server-side key, and
return the upstream stream unchanged; the browser agent executes tools locally
and mirrors files to OPFS. Project files are never uploaded to the server.

### Project archive format

ZIP exports contain a root `forge.manifest.json`, a root `agent-state.json`
(the project's agent transcript), and a single project folder:

```json
{
  "format": "forge-project",
  "version": 1,
  "appVersion": "0.1.0",
  "projectName": "MY COMPANY",
  "root": "my-company",
  "exportedAt": "2026-10-24T00:00:00.000Z",
  "fileCount": 19
}
```

Importers accept versions up to the one they support and reject newer archives
with an upgrade message. Bump `version` in `src/lib/project-archive.ts` when the
layout changes, and keep the importer able to read every older version.

## Notes and limitations

- The preview server emulates the subset of Vite that almostnode implements.
  React is resolved from a CDN import map; arbitrary npm dependencies in the
  preview project are not resolved. The shell explains this for `npm` commands.
- The preview iframe is sandboxed but **same-origin** (`allow-same-origin` is
  required for the service worker bridge). This is fine for editing your own
  code, but do not expose this IDE to untrusted users without moving the runtime
  to almostnode's cross-origin sandbox mode.
- Service workers require `localhost` or HTTPS. The preview shows an actionable
  error if registration fails.
- `almostnode` is pre-bundled by Vite's dependency optimizer because one of its
  dependencies (`just-bash`) ships CommonJS.

[almostnode]: https://github.com/macaly/almostnode
