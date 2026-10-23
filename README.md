# Forge — a browser-native project IDE

Forge is an IDE that runs its entire development environment in the browser.
The editor, file explorer, terminal, and live preview share an in-memory file
system provided by [almostnode]; a Vite-compatible dev server is mounted inside
the page and served through a service worker. A Nitro backend persists project
snapshots to disk.

Built with **Vite 7 · Nitro 3 · TypeScript · React 19 · Zustand 5 · almostnode 0.2.14**.

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
│  Nitro API ◀── /api/projects ─── snapshot (path → text)              │
│       └── data/projects/*.json                                       │
│                                                                      │
│  Agent chat ── tools ──▶ workspace store ──▶ VirtualFS               │
│       └── /api/agent ──▶ OpenAI-compatible provider (SSE proxy)      │
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

### Production

```bash
npm run build      # typecheck + client build + Nitro server bundle
npm start          # serves .output on http://localhost:3000
```

Set `PORT` to change the production port. Saved projects live in
`data/projects/` by default; override with `FORGE_DATA_DIR`.

### UI password

Set `FORGE_PASSWORD` to require a password before the IDE mounts (the local
`.env` in this checkout uses `12123`). The server compares it in constant time,
sets an HttpOnly `forge_unlock` cookie for 30 days, and exposes the gate through
`GET/POST /api/auth`. Leave the variable empty to disable the gate. This is a
simple shared-secret UI lock, not a multi-user account system — API routes are
not individually authenticated.

### Deploying to Vercel

Nitro runs as one Vercel Function. Set `FORGE_PASSWORD` in the project's
environment variables; `.env` files are not deployed.

Project snapshots need durable storage because a serverless filesystem is
read-only and ephemeral. Connect a **Vercel Blob** store to the project; Vercel
injects `BLOB_READ_WRITE_TOKEN` and the API stores each project at
`projects/<id>.json` in the store. Without a token, `/api/projects` returns an
actionable error instead of writing to a read-only disk. (You can also set
`FORGE_DATA_DIR` to a writable mounted volume, but `/tmp` is not persistent.)

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
  `echo "…" > file`, `mkdir`, `touch`, `rm -r`, `mv`, `cp`, `open`, `save`.
- **Save and restore projects** through the Nitro API. Snapshots are JSON files
  under `data/projects/` (or Vercel Blob in production), and the last opened
  project is restored on refresh.
- **Resize** the editor/preview and editor/terminal splits; layout preferences
  persist in `localStorage`.
- **Open the preview in a new tab** and reload it without restarting the runtime.
- **Download the project** with the top-bar **Download** button: every file in
  the virtual file system is zipped under a folder named after the project,
  alongside a `forge.manifest.json` describing the archive format and version.
- **Import a project** with **Import ZIP** next to Download. Forge reads and
  validates the manifest first, rejects newer archive versions, then starts a
  new unsaved project from the archive's files. Archives exported before the
  manifest existed are rejected with an explanation.
- **Ask the agent to change the project.** The Agent workbench reads, writes and
  replaces files in the same VFS, runs shell commands, and streams its answer
  into the chat while the preview hot-reloads (see below).

Keyboard shortcuts: `⌘S` save project · `⌘B` explorer · `⌘J` panel ·
`⌘K` projects · `⌘⇧A` focus agent chat · `Esc` close dialog · `↑/↓` shell history.

## Agent workbench

The agent is a tool-calling loop that runs **in the tab**: the model only
proposes calls, and Forge executes them against the `VirtualFS`. Every edit goes
through the workspace store, so open buffers reload, the file tree refreshes,
and HMR updates the preview just like a manual edit.

The chat lives in its **own column beside the editor**: drag the divider between
them to resize it, or press `⌘⇧A` to focus the composer. The preview stays
visible on the right while the agent works, so code, chat, and the running app
are on screen together.

Tools exposed to the model:

| Tool              | What it does                                             |
| ----------------- | -------------------------------------------------------- |
| `read_file`       | Read a UTF-8 file (40k-char output cap)                  |
| `write_file`      | Create or overwrite a file (60k-char cap)                |
| `replace_in_file` | Replace the first exact occurrence of a snippet         |
| `list_files`      | List the project tree                                    |
| `run_bash`        | Run the in-browser shell over the VFS (6k output cap)    |

Paths must be absolute; `..`, null bytes, and `node_modules` are rejected. Each
run is capped at 8 model steps. The project snapshot is captured before a run
starts, so **Undo run** reverts every change if at least one tool wrote anything.
Stopping a run aborts the stream and rolls the conversation back to the last
completed message.

### Connecting a provider

Forge talks to any **OpenAI-compatible** `/chat/completions` endpoint. Click the
gear in the Agent tab header (or the settings button in the welcome panel) and fill in:

- **Base URL** — must be HTTPS; plain HTTP is allowed only for `localhost`.
- **Model** — e.g. `gpt-4o-mini`, `deepseek-chat`, `openrouter/auto`.
- **API key** — optional when a server key is configured or the URL is local
  (e.g. Ollama at `http://localhost:11434/v1`).

Presets for OpenAI, DeepSeek, OpenRouter and Ollama are built in.

### Environment variables

| Variable         | Purpose                                                   |
| ---------------- | --------------------------------------------------------- |
| `AGENT_API_KEY`  | Server-side key used when the browser sends none          |
| `OPENAI_API_KEY` | Fallback for `AGENT_API_KEY`                              |
| `AGENT_BASE_URL` | Default provider URL (default `https://api.openai.com/v1`) |
| `AGENT_MODEL`    | Default model (default `gpt-4o-mini`)                      |

These can also be set in `.env` (see `.env.example`); Nitro loads it in dev and
`npm start` reads it in production.

### Security and privacy

- A key typed in the browser lives in `sessionStorage` for that tab only. It is
  sent to the local Nitro server in the `x-agent-key` header and forwarded to the
  provider; it is never written to disk or to project snapshots.
- The proxy rejects non-HTTPS base URLs (except localhost), rejects URLs with
  embedded credentials, caps request size (300k chars, 80 messages, 12 tools),
  and times out after 180 seconds.
- The model never touches the filesystem directly — it can only call the five
  tools above against the in-memory VFS.

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
5. **Persist.** Nitro stores `{ path: content }` snapshots; loading one restarts
   the Vite dev server against a fresh `VirtualFS`.

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
│   │   ├── bootstrap.ts    # restore project → boot runtime → hydrate stores
│   │   ├── shell.ts        # in-browser shell over the VFS
│   │   ├── agent-client.ts # SSE streaming client for /api/agent
│   │   ├── agent-config.ts # provider presets + storage
│   │   ├── agent-tools.ts  # tool schemas + VFS/bash execution
│   │   └── api.ts          # Nitro client
│   └── store/              # runtime · workspace · projects · ui · agent (Zustand)
├── server/
│   ├── routes/api/         # Nitro routes (/api/health, /api/projects, /api/agent, /api/auth)
│   └── utils/              # password gate + project validation/storage
├── shared/types.ts
└── data/projects/          # created at runtime, git-ignored
```

## API

| Method | Route               | Description                              |
| ------ | ------------------- | ---------------------------------------- |
| GET    | `/api/health`       | Service health                           |
| GET    | `/api/auth`         | Whether a password is required/unlocked  |
| POST   | `/api/auth`         | Exchange `{ password }` for an unlock cookie |
| GET    | `/api/projects`     | List project metadata                    |
| POST   | `/api/projects`     | Create/update `{ id?, name, files }`     |
| GET    | `/api/projects/:id` | Fetch a full snapshot                    |
| DELETE | `/api/projects/:id` | Delete a saved project                   |
| GET    | `/api/agent/status` | Whether a server key is configured       |
| POST   | `/api/agent`        | Stream a chat completion from the provider |

Snapshots are capped at 500 files / 2 MB, paths must be absolute, and
`node_modules` is rejected. Project JSON is stored on disk locally and in Vercel
Blob when `BLOB_READ_WRITE_TOKEN` is present. `/api/agent` returns the provider's
SSE stream verbatim and reports upstream failures as JSON with a readable
message.

### Project archive format

ZIP exports contain a root `forge.manifest.json` and a single project folder:

```json
{
  "format": "forge-project",
  "version": 1,
  "appVersion": "0.1.0",
  "projectName": "easy-fancy",
  "root": "easy-fancy",
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
