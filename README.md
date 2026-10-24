# Forge — a browser-native project IDE

Forge is an IDE that runs its entire development environment in the browser.
The editor, file explorer, terminal, and live preview share an in-memory file
system provided by [almostnode]; a Vite-compatible dev server is mounted inside
the page and served through a service worker. A Nitro backend persists project
snapshots to disk.

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
│  Nitro API ◀── /api/projects ─── snapshot (path → text)              │
│       └── data/projects/*.json                                       │
│                                                                      │
│  Agent chat ── /api/harness ──▶ DeepSeek Harness SDK subprocess     │
│       └── mirrored workspace ──▶ snapshot diff ──▶ VirtualFS        │
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

Set `PORT` to change the production port. Saved projects live in
`data/projects/` by default; override with `FORGE_DATA_DIR`.

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

The agent is a **DeepSeek Harness runtime** driven by
[`@deepseek-ai/dsh-sdk-client`](https://www.npmjs.com/package/@deepseek-ai/dsh-sdk-client).
The SDK spawns a `dsh --profile sdk` subprocess inside the Nitro server and
speaks newline-delimited JSON-RPC over stdio. The browser keeps the virtual
project; the server owns the agent.

Each turn works like this:

1. The client flushes open buffers and snapshots the `VirtualFS`.
2. `POST /api/harness` streams progress as NDJSON. The server writes the
   snapshot into `data/harness-workspaces/<conversation>/` and points the
   harness session at that directory.
3. The harness agent uses its real `read`, `write`, `edit`, `grep`, `glob`, and
   `bash` tools inside the mirrored workspace.
4. The server collects the text files back, diffs them against the input, and
   sends a final `result` frame with the full project plus `changedPaths`.
5. The client applies the diff to the `VirtualFS`, so open buffers, the file
   tree, and the preview update like a manual edit. The pre-turn snapshot stays
   available for **Undo run**.

The chat lives in its **own column beside the editor**: drag the divider between
them to resize it, or press `⌘⇧A` to focus the composer. When a run finishes
successfully, a three-note chime signals that the task is done.

The chat UI renders the harness's own plan: `todo_write` snapshots feed a pinned
task panel with live progress, per-item status, and auto-collapse on completion.
Tool calls appear as colour-coded cards (read, write, shell, search) with status
accents, file chips, expandable output, and a running scan line. While a turn is
active, an animated SVG loader sits at the bottom of the chat column and reports
the current harness step.

The SDK has no mid-turn cancel. Pressing **Stop** closes the runtime subprocess
(the documented way to abandon a turn); the next turn spawns a fresh one.
Conversation history lives in that subprocess, so restarting the dev server
starts fresh harness sessions — the mirrored project files are unaffected.

The launch overlay is [`automation.cordis.yml`](automation.cordis.yml); it is
empty today and exists as the project's own dsh patch hook.

### Environment variables

| Variable               | Purpose                                                            |
| ---------------------- | ------------------------------------------------------------------ |
| `DEEPSEEK_API_KEY`     | Credential read by the harness subprocess                          |
| `AGENT_API_KEY`        | Fallback credential (also used by the legacy proxy)                |
| `OPENAI_API_KEY`       | Last fallback credential                                           |
| `DSH_PROVIDER`         | Route provider (default `deepseek-official`)                       |
| `DSH_MODEL`            | Route model (falls back to `AGENT_MODEL`, then `deepseek-v4-flash`) |
| `DSH_REASONING_EFFORT` | Adapter effort (default `max`; empty string uses the model default) |
| `DSH_MAX_TOKENS`       | Output cap (default `49152`; empty string uses the model default)   |
| `DSH_HOME`             | Harness home (default `data/dsh-home`)                             |
| `AGENT_MODEL`          | Model fallback when `DSH_MODEL` is unset                           |

The harness credential is read only on the server. The browser never receives
it, and the settings dialog shows which env var supplied it.

### Security and privacy

- The harness runs with the shipped `sdk` profile and its `workspace-write`
  sandbox. Its edits are confined to the mirrored workspace.
- Only UTF-8 text files are mirrored back. Binary files, symlinks, and files
  over the mirror caps are listed in `skipped` and left untouched in the IDE.
- The workspace is wiped and re-created from the current project before every
  turn, so stale files cannot leak between turns.
- Request size is validated server-side (500 files, 1 MB per file, 2 MB total,
  100k-character prompt).

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
│   │   ├── harness-client.ts # NDJSON client for /api/harness
│   │   ├── agent-client.ts # status client + legacy SSE proxy client
│   │   ├── agent-config.ts # legacy provider presets (kept for the proxy)
│   │   ├── agent-tools.ts  # legacy in-tab tool schemas + VFS/bash execution
│   │   └── api.ts          # Nitro client
│   └── store/              # runtime · workspace · projects · ui · agent (Zustand)
├── server/
│   ├── routes/api/         # Nitro routes (/api/health, /api/projects, /api/harness, /api/auth)
│   └── utils/
│       ├── harness.ts      # SDK runtime, workspace mirror, turn queue
│       └── projects.ts     # project validation/storage
├── shared/types.ts
├── automation.cordis.yml   # per-launch dsh profile patch (empty by default)
├── scripts/harness-smoke.mjs # SDK boot/diagnostic script
├── data/projects/          # created at runtime, git-ignored
└── data/harness-workspaces/ # per-conversation mirror, git-ignored
```

## API

| Method | Route               | Description                              |
| ------ | ------------------- | ---------------------------------------- |
| GET    | `/api/health`       | Service health                           |
| GET    | `/api/auth`         | Whether a password is required/unlocked  |
| POST   | `/api/auth`         | Exchange `{ password }` for a no-expiry JWT |
| GET    | `/api/projects`     | List project metadata                    |
| POST   | `/api/projects`     | Create/update `{ id?, name, files }`     |
| GET    | `/api/projects/:id` | Fetch a full snapshot                    |
| DELETE | `/api/projects/:id` | Delete a saved project                   |
| GET    | `/api/agent/status` | Harness route + whether a credential is configured |
| POST   | `/api/harness`      | Mirror the project, run one DeepSeek Harness turn (NDJSON) |

All routes except `GET /api/auth` and `POST /api/auth` require
`Authorization: Bearer <token>` when `FORGE_PASSWORD` is configured.

Snapshots are capped at 500 files / 2 MB, paths must be absolute, and
`node_modules` is rejected. Project JSON is stored on disk locally and in Vercel
Blob when `BLOB_READ_WRITE_TOKEN` is present. `/api/harness` streams one JSON
object per line (`status`, `tool`, `tool-done`, then `result` or `error`) and
reports failures as a terminal `error` frame with a readable message.

### Project archive format

ZIP exports contain a root `forge.manifest.json` and a single project folder:

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
