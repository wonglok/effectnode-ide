import type {
  ResponseData,
  ServerBridge,
  VirtualFS,
  ViteDevServer,
} from 'almostnode';
import { dirname, joinPath } from './paths';
import {
  PREVIEW_BRIDGE_ATTRIBUTE,
  PREVIEW_ERROR_BRIDGE,
} from './preview-bridge';

export const PREVIEW_PORT = 3000;

export type RuntimeStatus = 'idle' | 'booting' | 'ready' | 'error';
export type LogLevel = 'info' | 'success' | 'warn' | 'error' | 'hmr';

export interface LogEntry {
  id: number;
  time: number;
  level: LogLevel;
  message: string;
}

export type RuntimeEvent =
  | { type: 'status'; status: RuntimeStatus; message?: string }
  | { type: 'log'; entry: LogEntry }
  | { type: 'ready'; url: string; port: number }
  | { type: 'hmr'; path: string; kind: 'update' | 'full-reload' }
  | { type: 'restarted'; url: string }
  | { type: 'reload' }
  | { type: 'error'; message: string };

type RuntimeListener = (event: RuntimeEvent) => void;
type AlmostnodeModule = typeof import('almostnode');

/**
 * Optional durable mirror for VirtualFS mutations. The runtime never waits for
 * it, so a slow or unavailable backing store cannot block editing.
 */
export interface FileSink {
  write(path: string, content: string): void;
  mkdir(path: string): void;
  delete(path: string): void;
  rename(from: string, to: string): void;
  replaceAll(files: Record<string, string>): void | Promise<void>;
}

const IGNORED = new Set(['node_modules', '.git', '.cache', '.nitro']);

/**
 * Owns the almostnode VirtualFS + ViteDevServer + service worker. React state
 * lives in Zustand; this class only emits runtime events.
 */
export class IdeRuntime {
  status: RuntimeStatus = 'idle';
  statusMessage = '';

  private lib: AlmostnodeModule | null = null;
  private vfs: VirtualFS | null = null;
  private server: ViteDevServer | null = null;
  private bridge: ServerBridge | null = null;
  private listeners = new Set<RuntimeListener>();
  private bootPromise: Promise<void> | null = null;
  private logSequence = 0;
  private previewUrlValue = '';
  private fileSink: FileSink | null = null;
  /**
   * Binary public assets. They are visible in the explorer but stay out of the
   * text file map (snapshots, OPFS mirror, agent reads) because they are bytes.
   */
  private binaryAssetPaths = new Set<string>();
  /** Root URL → `public/` path, matching Vite's publicDir semantics. */
  private assetAliases = new Map<string, string>();

  /** Attach the durable project store (OPFS) or detach it with `null`. */
  setFileSink(sink: FileSink | null): void {
    this.fileSink = sink;
  }

  subscribe(listener: RuntimeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: RuntimeEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  log(level: LogLevel, message: string): void {
    const entry: LogEntry = {
      id: ++this.logSequence,
      time: Date.now(),
      level,
      message,
    };
    this.emit({ type: 'log', entry });
  }

  private setStatus(status: RuntimeStatus, message = ''): void {
    this.status = status;
    this.statusMessage = message;
    this.emit({ type: 'status', status, message });
  }

  get previewUrl(): string {
    return this.previewUrlValue;
  }

  get previewPort(): number {
    return PREVIEW_PORT;
  }

  get fileCount(): number {
    return Object.keys(this.snapshot()).length;
  }

  /** True for binary public assets that cannot be read as text. */
  isBinaryAsset(path: string): boolean {
    return this.binaryAssetPaths.has(path);
  }

  /** True when `path` is, or contains, a binary public asset. */
  containsBinaryAsset(path: string): boolean {
    const prefix = path === '/' ? '/' : path + '/';
    for (const asset of this.binaryAssetPaths) {
      if (asset === path || asset.startsWith(prefix)) return true;
    }
    return false;
  }

  async boot(
    files: Record<string, string>,
    assets: Record<string, Uint8Array> = {}
  ): Promise<void> {
    if (this.status === 'ready') return;
    if (this.bootPromise) return this.bootPromise;

    const bootPromise = (async () => {
      this.setStatus('booting', 'Starting almostnode');
      try {
        this.log('info', 'Loading almostnode runtime…');
        this.lib = await import('almostnode');

        // Mount the project first so the editor remains usable even if the
        // browser refuses to register a service worker.
        this.mount(files, assets);

        this.bridge = this.lib.getServerBridge();

        this.log('info', 'Connecting preview service worker…');
        await this.bridge.initServiceWorker({ swUrl: '/__sw__.js' });
        this.log('success', 'Service worker connected');

        this.startServer();

        this.setStatus('ready');
        this.emit({ type: 'ready', url: this.previewUrlValue, port: PREVIEW_PORT });
        this.log(
          'success',
          `Preview server ready — ${Object.keys(files).length} files on port ${PREVIEW_PORT}`
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.setStatus('error', message);
        this.log('error', message);
        this.emit({ type: 'error', message });
        throw error;
      } finally {
        this.bootPromise = null;
      }
    })();

    this.bootPromise = bootPromise;
    return bootPromise;
  }

  private mount(
    files: Record<string, string>,
    assets: Record<string, Uint8Array> = {}
  ): void {
    if (!this.lib) throw new Error('almostnode is not loaded');
    const vfs = new this.lib.VirtualFS();
    this.binaryAssetPaths = new Set(Object.keys(assets));
    this.assetAliases = new Map();
    for (const [path, content] of Object.entries(files)) {
      const parent = dirname(path);
      if (parent !== '/') vfs.mkdirSync(parent, { recursive: true });
      vfs.writeFileSync(path, content);
      // Vite serves everything under public/ at the site root, text included.
      this.registerPublicAlias(path);
    }
    // Public binaries are real files in the project tree, but they are bytes:
    // keep them out of the text file map and expose them at the root URL as a
    // Vite public directory would.
    for (const [path, data] of Object.entries(assets)) {
      const parent = dirname(path);
      if (parent !== '/') vfs.mkdirSync(parent, { recursive: true });
      vfs.writeFileSync(path, data);
      this.registerPublicAlias(path);
    }
    this.vfs = vfs;
  }

  private startServer(): void {
    if (!this.lib || !this.vfs || !this.bridge) {
      throw new Error('Cannot start the preview server before boot');
    }

    const server = new this.lib.ViteDevServer(this.vfs, {
      port: PREVIEW_PORT,
      root: '/',
      jsx: true,
    });

    // Vite serves files in `public/` from the site root. The virtual server
    // serves exact paths, so rewrite those root URLs before dispatching. HTML
    // responses also get the preview diagnostics bridge.
    const serveRequest = server.handleRequest.bind(server);
    server.handleRequest = async (method, url, headers, body) => {
      const [pathname, query] = url.split('?');
      const alias = this.assetAliases.get(pathname);
      const target = alias ? alias + (query ? `?${query}` : '') : url;
      const response = await serveRequest(method, target, headers, body);
      return method === 'HEAD'
        ? response
        : this.injectPreviewErrorBridge(response);
    };

    server.on('hmr-update', (payload: unknown) => {
      const update = payload as { type?: 'update' | 'full-reload'; path?: string };
      if (!update?.path) return;
      this.emit({
        type: 'hmr',
        path: update.path,
        kind: update.type === 'full-reload' ? 'full-reload' : 'update',
      });
    });

    this.server = server;
    this.bridge.registerServer(
      server as unknown as Parameters<ServerBridge['registerServer']>[0],
      PREVIEW_PORT
    );
    server.start();

    this.previewUrlValue = this.bridge.getServerUrl(PREVIEW_PORT) + '/';
  }

  /**
   * Add the diagnostics bridge to every HTML document the preview serves. It
   * is inserted right after `<head>` so it runs before the project's modules.
   */
  private injectPreviewErrorBridge(response: ResponseData): ResponseData {
    if (response.statusCode !== 200 || !this.lib) return response;

    const contentType =
      Object.entries(response.headers).find(
        ([key]) => key.toLowerCase() === 'content-type'
      )?.[1] ?? '';
    if (!contentType.toLowerCase().includes('text/html')) return response;

    let html: string;
    try {
      html = response.body.toString('utf8');
    } catch {
      return response;
    }

    // Older documents that already carry the bridge are left untouched.
    if (html.includes(PREVIEW_BRIDGE_ATTRIBUTE)) return response;

    const tag = `<script ${PREVIEW_BRIDGE_ATTRIBUTE}>${PREVIEW_ERROR_BRIDGE}</script>`;
    if (/<head[^>]*>/i.test(html)) {
      html = html.replace(/<head[^>]*>/i, (head) => head + tag);
    } else if (/<html[^>]*>/i.test(html)) {
      html = html.replace(/<html[^>]*>/i, (root) => root + tag);
    } else {
      html = tag + html;
    }

    const body = this.lib.stream.Buffer.from(html);
    const headers = { ...response.headers };
    for (const key of Object.keys(headers)) {
      if (key.toLowerCase() === 'content-length') {
        headers[key] = String(body.length);
      }
    }

    return { ...response, headers, body };
  }

  private teardownServer(): void {
    if (this.server) {
      this.server.stop();
      this.server = null;
    }
    this.bridge?.unregisterServer(PREVIEW_PORT);
  }

  /** Retry service-worker registration and the dev server without remounting files. */
  async retryPreview(): Promise<void> {
    if (!this.lib || !this.vfs) {
      throw new Error('The runtime has not been loaded yet');
    }
    try {
      this.setStatus('booting', 'Retrying preview');
      this.log('info', 'Retrying the preview service worker…');
      this.bridge = this.lib.getServerBridge();
      await this.bridge.initServiceWorker({ swUrl: '/__sw__.js' });
      if (this.server) this.teardownServer();
      this.startServer();
      this.setStatus('ready');
      this.emit({ type: 'ready', url: this.previewUrlValue, port: PREVIEW_PORT });
      this.log('success', 'Preview server is back online');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.setStatus('error', message);
      this.log('error', message);
      this.emit({ type: 'error', message });
      throw error;
    }
  }

  /** Replace the whole virtual project and restart the preview server. */
  async replaceProject(
    files: Record<string, string>,
    assets: Record<string, Uint8Array> = {}
  ): Promise<void> {
    if (!this.lib || this.status !== 'ready') {
      await this.boot(files, assets);
      void this.fileSink?.replaceAll(files);
      return;
    }

    this.log('info', 'Swapping virtual project…');
    this.teardownServer();
    this.mount(files, assets);
    this.startServer();
    this.emit({ type: 'restarted', url: this.previewUrlValue });
    this.log('success', 'Preview server restarted with new files');
    void this.fileSink?.replaceAll(files);
  }

  /** Hand the live iframe window to almostnode so HMR can postMessage into it. */
  attachPreview(target: Window | null): void {
    if (target && this.server) {
      this.server.setHMRTarget(target);
      this.log('info', 'Preview attached — hot reload is listening');
    }
  }

  requestPreviewReload(): void {
    this.emit({ type: 'reload' });
  }

  /** Expose the VFS to read-only view builders (file tree). */
  getVfs(): VirtualFS | null {
    return this.vfs;
  }

  private requireVfs(): VirtualFS {
    if (!this.vfs) throw new Error('Virtual file system is not ready');
    return this.vfs;
  }

  readFile(path: string): string | null {
    if (this.binaryAssetPaths.has(path)) return null;
    try {
      return this.requireVfs().readFileSync(path, 'utf8');
    } catch {
      return null;
    }
  }

  writeFile(path: string, content: string): void {
    if (this.binaryAssetPaths.has(path)) {
      throw new Error(`${path} is a read-only binary asset`);
    }
    this.requireVfs().writeFileSync(path, content);
    this.registerPublicAlias(path);
    this.fileSink?.write(path, content);
  }

  /** Write a binary file (e.g. an uploaded public asset) into the VFS. */
  writeAsset(path: string, data: Uint8Array): void {
    const vfs = this.requireVfs();
    const parent = dirname(path);
    if (parent !== '/') vfs.mkdirSync(parent, { recursive: true });
    vfs.writeFileSync(path, data);
    this.binaryAssetPaths.add(path);
    this.registerPublicAlias(path);
  }

  /** Remove a binary asset that was added at runtime. */
  deleteAsset(path: string): void {
    if (!this.binaryAssetPaths.has(path)) return;
    try {
      this.requireVfs().unlinkSync(path);
    } catch {
      // Already gone.
    }
    this.binaryAssetPaths.delete(path);
    if (path.startsWith('/public/')) {
      this.assetAliases.delete(path.slice('/public'.length));
    }
  }

  private registerPublicAlias(path: string): void {
    if (path.startsWith('/public/')) {
      this.assetAliases.set(path.slice('/public'.length), path);
    }
  }

  exists(path: string): boolean {
    try {
      return this.requireVfs().existsSync(path);
    } catch {
      return false;
    }
  }

  isDirectory(path: string): boolean {
    try {
      return this.requireVfs().statSync(path).isDirectory();
    } catch {
      return false;
    }
  }

  listDir(path: string): string[] {
    try {
      return this.requireVfs()
        .readdirSync(path)
        .filter(
          (name) =>
            !IGNORED.has(name) &&
            // Shell and agent listings stay text-only; the explorer builds its
            // own tree and shows the public binaries.
            !this.binaryAssetPaths.has(joinPath(path, name))
        );
    } catch {
      return [];
    }
  }

  createFolder(path: string): void {
    this.requireVfs().mkdirSync(path, { recursive: true });
    this.fileSink?.mkdir(path);
  }

  createFile(path: string, content = ''): void {
    const parent = dirname(path);
    if (parent !== '/') this.requireVfs().mkdirSync(parent, { recursive: true });
    this.requireVfs().writeFileSync(path, content);
    this.registerPublicAlias(path);
    this.fileSink?.write(path, content);
  }

  renameEntry(from: string, to: string): void {
    if (this.containsBinaryAsset(from)) {
      throw new Error('Starter binary assets are read-only');
    }
    const parent = dirname(to);
    if (parent !== '/') this.requireVfs().mkdirSync(parent, { recursive: true });
    this.requireVfs().renameSync(from, to);
    this.fileSink?.rename(from, to);
  }

  deleteEntry(path: string): void {
    if (path === '/') throw new Error('Refusing to delete the project root');
    if (this.containsBinaryAsset(path)) {
      throw new Error('Starter binary assets are read-only');
    }
    this.deleteEntryInternal(path);
    this.fileSink?.delete(path);
  }

  private deleteEntryInternal(path: string): void {
    const vfs = this.requireVfs();
    const stats = vfs.statSync(path);
    if (stats.isDirectory()) {
      for (const child of vfs.readdirSync(path)) {
        this.deleteEntryInternal(joinPath(path, child));
      }
      vfs.rmdirSync(path);
    } else {
      vfs.unlinkSync(path);
    }
  }

  /**
   * Export the project's binary `public/` files as a path → bytes map. They
   * are excluded from `snapshot()` because they cannot be read as text.
   */
  assetSnapshot(): Record<string, Uint8Array> {
    const assets: Record<string, Uint8Array> = {};
    if (!this.vfs) return assets;

    for (const path of this.binaryAssetPaths) {
      if (!path.startsWith('/public/')) continue;
      try {
        assets[path] = this.vfs.readFileSync(path);
      } catch {
        // The asset was removed between the set update and the read.
      }
    }

    return assets;
  }

  /** Export the entire VFS as a plain path → string map. */
  snapshot(): Record<string, string> {
    const files: Record<string, string> = {};
    if (!this.vfs) return files;

    const visit = (dir: string) => {
      let entries: string[];
      try {
        entries = this.vfs!.readdirSync(dir);
      } catch {
        return;
      }
      for (const name of entries) {
        if (IGNORED.has(name)) continue;
        const path = joinPath(dir, name);
        if (this.binaryAssetPaths.has(path)) continue;
        try {
          const stats = this.vfs!.statSync(path);
          if (stats.isDirectory()) visit(path);
          else files[path] = this.vfs!.readFileSync(path, 'utf8');
        } catch {
          // A file can disappear between readdir and stat (rare); skip it.
        }
      }
    };

    visit('/');
    return files;
  }
}

declare global {
  interface Window {
    __forgeRuntime?: IdeRuntime;
    __forgeErrorCapture?: boolean;
  }
}

function createRuntime(): IdeRuntime {
  if (typeof window === 'undefined') return new IdeRuntime();
  // Keep the runtime alive across Vite HMR updates of this module.
  const existing = window.__forgeRuntime;
  if (existing) return existing;
  const runtime = new IdeRuntime();
  window.__forgeRuntime = runtime;

  if (!window.__forgeErrorCapture) {
    window.__forgeErrorCapture = true;
    window.addEventListener('error', (event) => {
      if (!event.message) return;
      runtime.log('error', event.message);
    });
    window.addEventListener('unhandledrejection', (event) => {
      const reason = event.reason;
      runtime.log('error', reason instanceof Error ? reason.message : String(reason));
    });
  }

  return runtime;
}

export const runtime = createRuntime();
