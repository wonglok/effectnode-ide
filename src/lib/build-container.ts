/**
 * In-browser build runner backed by almostnode's container API.
 *
 * The live IDE keeps its own VirtualFS + Vite dev server. A build needs a
 * throwaway Node environment with npm scripts, so this module mirrors the
 * project into an almostnode container and runs the real command there:
 *
 *   const container = createContainer();
 *   await container.npm.installFromPackageJson({ includeDev: true });
 *   const result = await container.run("npm run build");
 *
 * The container is cached so `node_modules` survives between builds; project
 * files are re-synced every run. Build output stays in the container and is
 * never written back to the project.
 */
import type { VirtualFS } from "almostnode";
import { runtime } from "./runtime";

type AlmostnodeModule = typeof import("almostnode");
type BuildContainer = ReturnType<AlmostnodeModule["createContainer"]>;

export interface ProjectBuildOptions {
  /** Command to run after the optional install. Defaults to the build script. */
  command?: string;
  /** true = install now, false = skip install, undefined = install if needed. */
  install?: boolean;
  /** Abort long installs/builds. */
  signal?: AbortSignal;
}

export interface ProjectBuildResult {
  ok: boolean;
  exitCode: number;
  command: string;
  phase: "install" | "command";
  installed: boolean;
  installOutput: string;
  output: string;
  durationMs: number;
  fileCount: number;
  timedOut: boolean;
}

const DEFAULT_COMMAND = "npm run build";
const BINDING_PROBE = "/__forge_build_probe";

let container: BuildContainer | null = null;
let containerPromise: Promise<BuildContainer> | null = null;
let lastPackageJson: string | null = null;
let buildQueue: Promise<unknown> = Promise.resolve();

function removeEntry(vfs: VirtualFS, path: string): void {
  const stats = vfs.statSync(path);
  if (!stats.isDirectory()) {
    vfs.unlinkSync(path);
    return;
  }
  for (const name of vfs.readdirSync(path)) {
    removeEntry(vfs, `${path}/${name}`.replace(/\/+/g, "/"));
  }
  vfs.rmdirSync(path);
}

function parentOf(path: string): string {
  const index = path.lastIndexOf("/");
  return index <= 0 ? "/" : path.slice(0, index);
}

function ensureContainer(): Promise<BuildContainer> {
  if (container) return Promise.resolve(container);
  if (containerPromise) return containerPromise;

  containerPromise = (async () => {
    const { createContainer } = await import("almostnode");
    container = createContainer({ cwd: "/" });
    lastPackageJson = null;
    return container;
  })().finally(() => {
    containerPromise = null;
  });

  return containerPromise;
}

/** Replace the container's project tree with the live project's files. */
function syncProject(target: BuildContainer): {
  fileCount: number;
  packageJson: string;
} {
  const vfs = target.vfs;

  for (const name of vfs.readdirSync("/")) {
    if (name === "node_modules") continue;
    removeEntry(vfs, `/${name}`);
  }

  const files = runtime.snapshot();
  const assets = runtime.assetSnapshot();
  let fileCount = 0;

  for (const [path, content] of Object.entries(files)) {
    const parent = parentOf(path);
    if (parent !== "/") vfs.mkdirSync(parent, { recursive: true });
    vfs.writeFileSync(path, content);
    fileCount += 1;
  }
  for (const [path, data] of Object.entries(assets)) {
    const parent = parentOf(path);
    if (parent !== "/") vfs.mkdirSync(parent, { recursive: true });
    vfs.writeFileSync(path, data);
    fileCount += 1;
  }

  return {
    fileCount,
    packageJson: files["/package.json"] ?? "",
  };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Registry specs for the project's direct dependencies. almostnode resolves
 * the whole tree with a flat node_modules and can pick a transitive version
 * that does not satisfy a direct range (for example plugin-react's peer range
 * pulls the latest Vite before the project's `^5.0.0` is seen). Installing the
 * direct specs afterwards restores the versions package.json asks for.
 */
function directDependencySpecs(packageJson: string): string[] {
  try {
    const parsed = JSON.parse(packageJson) as {
      dependencies?: Record<string, unknown>;
      devDependencies?: Record<string, unknown>;
    };
    const specs: string[] = [];
    for (const group of [parsed.dependencies, parsed.devDependencies]) {
      for (const [name, range] of Object.entries(group ?? {})) {
        if (typeof range !== "string") continue;
        const value = range.trim();
        if (
          !value ||
          /^(?:file:|link:|workspace:|git\+|git:|github:|https?:|\.{0,2}\/)/i.test(
            value,
          )
        ) {
          continue;
        }
        specs.push(`${name}@${value}`);
      }
    }
    return specs;
  } catch {
    return [];
  }
}

function specName(spec: string): string {
  const at = spec.lastIndexOf("@");
  return at > 0 ? spec.slice(0, at) : spec;
}

function readText(vfs: VirtualFS, path: string): string {
  const contents = vfs.readFileSync(path);
  return typeof contents === "string"
    ? contents
    : new TextDecoder().decode(contents);
}

/** Direct or transitive packages that other installed packages peer onto. */
function collectPeerNames(vfs: VirtualFS): Set<string> {
  const peers = new Set<string>();
  const readPeers = (path: string) => {
    try {
      const pkg = JSON.parse(readText(vfs, path)) as {
        peerDependencies?: Record<string, unknown>;
      };
      for (const name of Object.keys(pkg.peerDependencies ?? {})) {
        peers.add(name);
      }
    } catch {
      // A malformed package.json cannot contribute peers.
    }
  };

  let root: string[];
  try {
    root = vfs.readdirSync("/node_modules");
  } catch {
    return peers;
  }

  for (const entry of root) {
    if (entry.startsWith(".")) continue;
    if (entry.startsWith("@")) {
      let scoped: string[];
      try {
        scoped = vfs.readdirSync(`/node_modules/${entry}`);
      } catch {
        continue;
      }
      for (const child of scoped) {
        readPeers(`/node_modules/${entry}/${child}/package.json`);
      }
    } else {
      readPeers(`/node_modules/${entry}/package.json`);
    }
  }
  return peers;
}

/**
 * almostnode's shell reads a module-level VFS set by the most recently created
 * Runtime. If another Runtime appears, `container.run` would target a different
 * tree (potentially the live project). A cheap probe detects that and rebuilds
 * the container binding before any command runs.
 */
async function prepareContainer(): Promise<BuildContainer> {
  let target = await ensureContainer();
  const token = `probe-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  target.vfs.writeFileSync(BINDING_PROBE, token);

  try {
    const probe = await target.run(`cat ${BINDING_PROBE}`);
    if (probe.exitCode === 0 && probe.stdout.trim() === token) return target;
  } catch {
    // Fall through and rebuild the binding.
  }

  resetBuildContainer();
  target = await ensureContainer();
  target.vfs.writeFileSync(BINDING_PROBE, token);
  const retry = await target.run(`cat ${BINDING_PROBE}`);
  if (retry.exitCode !== 0 || retry.stdout.trim() !== token) {
    throw new Error(
      "The in-browser build container could not be started. Reload the IDE and retry.",
    );
  }
  return target;
}

async function runBuild(
  options: ProjectBuildOptions,
): Promise<ProjectBuildResult> {
  const command = options.command?.trim() || DEFAULT_COMMAND;
  const started = Date.now();
  const target = await prepareContainer();
  const { fileCount, packageJson } = syncProject(target);

  if (fileCount === 0) {
    throw new Error("The project has no files to build yet.");
  }

  const vfs = target.vfs;
  const missingModules = !vfs.existsSync("/node_modules");
  const packageChanged = lastPackageJson !== packageJson;
  const shouldInstall =
    options.install === true ||
    (options.install !== false && (missingModules || packageChanged));

  let installed = false;
  let installOutput = "";

  if (shouldInstall) {
    if (packageChanged && !missingModules) {
      removeEntry(vfs, "/node_modules");
    }
    const progress: string[] = [];
    const note = (message: string) => {
      progress.push(message);
      if (progress.length > 400) progress.splice(0, progress.length - 400);
    };
    installed = true;
    try {
      // The shell's `npm install` omits devDependencies. A frontend build needs
      // tsc/vite, so install from package.json with dev dependencies included.
      const result = await target.npm.installFromPackageJson({
        includeDev: true,
        onProgress: note,
      });
      note(`added ${result.added.length} packages`);

      // Reinstall direct dependencies, with packages that others peer onto
      // (react, react-dom, vite) last. A peer range such as react-router's
      // `react >= 18` otherwise upgrades the project's React major again.
      const specs = directDependencySpecs(packageJson);
      const peerNames = collectPeerNames(vfs);
      const peers = specs.filter((spec) => peerNames.has(specName(spec)));
      const plain = specs.filter((spec) => !peerNames.has(specName(spec)));
      for (const spec of [...plain, ...peers.reverse()]) {
        const pinned = await target.npm.install(spec, { onProgress: note });
        if (pinned.added.length > 0) {
          note(`pinned ${spec}`);
        }
      }

      installOutput = progress.join("\n").trim();
      lastPackageJson = packageJson;
    } catch (error) {
      installOutput = [...progress, `npm ERR! ${messageOf(error)}`]
        .join("\n")
        .trim();
      return {
        ok: false,
        exitCode: 1,
        command: "npm install",
        phase: "install",
        installed,
        installOutput,
        output: installOutput || "npm install failed with no output.",
        durationMs: Date.now() - started,
        fileCount,
        timedOut: Boolean(options.signal?.aborted),
      };
    }
  }

  if (options.signal?.aborted) {
    return {
      ok: false,
      exitCode: 130,
      command,
      phase: "command",
      installed,
      installOutput,
      output: "The build was cancelled.",
      durationMs: Date.now() - started,
      fileCount,
      timedOut: true,
    };
  }

  const result = await target.run(command, {
    cwd: "/",
    signal: options.signal,
  });
  const output = [result.stdout, result.stderr]
    .filter(Boolean)
    .join("\n")
    .trim();

  return {
    ok: result.exitCode === 0,
    exitCode: result.exitCode,
    command,
    phase: "command",
    installed,
    installOutput,
    output: output || "(the command printed nothing)",
    durationMs: Date.now() - started,
    fileCount,
    timedOut: Boolean(options.signal?.aborted),
  };
}

/**
 * Build the current project. Builds are serialised because the container keeps
 * one shell and one node_modules between runs.
 */
export function buildProject(
  options: ProjectBuildOptions = {},
): Promise<ProjectBuildResult> {
  const run = buildQueue.then(() => runBuild(options));
  buildQueue = run.catch(() => undefined);
  return run;
}

/** Drop the cached container (for example after a very large dependency change). */
export function resetBuildContainer(): void {
  container = null;
  containerPromise = null;
  lastPackageJson = null;
}

export { messageOf as buildErrorMessage };
