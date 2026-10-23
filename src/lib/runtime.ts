import type { ServerBridge, VirtualFS, ViteDevServer } from 'almostnode';
import { dirname, joinPath } from './paths';

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

  async boot(files: Record<string, string>): Promise<void> {
    if (this.status === 'ready') return;
    if (this.bootPromise) return this.bootPromise;

    const bootPromise = (async () => {
      this.setStatus('booting', 'Starting almostnode');
      try {
        this.log('info', 'Loading almostnode runtime…');
        this.lib = await import('almostnode');

        // Mount the project first so the editor remains usable even if the
        // browser refuses to register a service worker.
        this.mount(files);

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

  private mount(files: Record<string, string>): void {
    if (!this.lib) throw new Error('almostnode is not loaded');
    const vfs = new this.lib.VirtualFS();
    for (const [path, content] of Object.entries(files)) {
      const parent = dirname(path);
      if (parent !== '/') vfs.mkdirSync(parent, { recursive: true });
      vfs.writeFileSync(path, content);
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
  async replaceProject(files: Record<string, string>): Promise<void> {
    if (!this.lib || this.status !== 'ready') {
      await this.boot(files);
      return;
    }

    this.log('info', 'Swapping virtual project…');
    this.teardownServer();
    this.mount(files);
    this.startServer();
    this.emit({ type: 'restarted', url: this.previewUrlValue });
    this.log('success', 'Preview server restarted with new files');
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
    try {
      return this.requireVfs().readFileSync(path, 'utf8');
    } catch {
      return null;
    }
  }

  writeFile(path: string, content: string): void {
    this.requireVfs().writeFileSync(path, content);
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
      return this.requireVfs().readdirSync(path).filter((name) => !IGNORED.has(name));
    } catch {
      return [];
    }
  }

  createFolder(path: string): void {
    this.requireVfs().mkdirSync(path, { recursive: true });
  }

  createFile(path: string, content = ''): void {
    const parent = dirname(path);
    if (parent !== '/') this.requireVfs().mkdirSync(parent, { recursive: true });
    this.requireVfs().writeFileSync(path, content);
  }

  renameEntry(from: string, to: string): void {
    const parent = dirname(to);
    if (parent !== '/') this.requireVfs().mkdirSync(parent, { recursive: true });
    this.requireVfs().renameSync(from, to);
  }

  deleteEntry(path: string): void {
    if (path === '/') throw new Error('Refusing to delete the project root');
    const vfs = this.requireVfs();
    const stats = vfs.statSync(path);
    if (stats.isDirectory()) {
      for (const child of vfs.readdirSync(path)) {
        this.deleteEntry(joinPath(path, child));
      }
      vfs.rmdirSync(path);
    } else {
      vfs.unlinkSync(path);
    }
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
