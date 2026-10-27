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
  /** Build-only packages added to the container, not to the project. */
  typePackages: string[];
}

const DEFAULT_COMMAND = "npm run build";
const BINDING_PROBE = "/__forge_build_probe";
const VITE_PUBLIC_UTILS = "/node_modules/vite/dist/node-cjs/publicUtils.cjs";
const VITE_INDEX_CJS = "/node_modules/vite/index.cjs";
const VITE_BIN = "/node_modules/vite/bin/vite.js";

/**
 * Vite's CLI is written for Node: its bin has top-level `await`, its CJS entry
 * dynamically imports the ESM build, and its config loader natively imports a
 * temp module whose bare `vite` import cannot resolve in the page. This shim
 * replaces the CLI in the build container and calls Vite's build API with the
 * project's own config loaded through almostnode's module loader instead.
 */
const VITE_CLI_SHIM = `process.env.VITE_CJS_IGNORE_WARNING = 'true';
const fs = require('node:fs');
if (typeof fs.unlink !== 'function' && typeof fs.unlinkSync === 'function') {
  fs.unlink = function (path, callback) {
    try {
      fs.unlinkSync(path);
      if (callback) callback(null);
    } catch (error) {
      if (callback) callback(error);
      else throw error;
    }
  };
}
[process.stdout, process.stderr].forEach(function (stream) {
  if (!stream) return;
  if (typeof stream.clearLine !== 'function') stream.clearLine = function () {};
  if (typeof stream.cursorTo !== 'function') stream.cursorTo = function () {};
  if (typeof stream.moveCursor !== 'function') stream.moveCursor = function () {};
});

const CONFIG_FILES = [
  '/vite.config.js',
  '/vite.config.mjs',
  '/vite.config.cjs',
  '/vite.config.ts',
  '/vite.config.mts',
  '/vite.config.cts',
];

function requireConfig(path) {
  if (/\\.(ts|mts|cts)$/.test(path)) {
    const esbuild = require('esbuild');
    const source = fs.readFileSync(path, 'utf8');
    const output = esbuild.transformSync(source, {
      loader: 'ts',
      format: 'cjs',
      target: 'es2020',
    });
    const temporary = '/__forge/vite.config.cjs';
    fs.writeFileSync(temporary, output.code);
    const mod = require(temporary);
    return mod && mod.default ? mod.default : mod;
  }
  const mod = require(path);
  return mod && mod.default ? mod.default : mod;
}

function detectPlugins(path) {
  const source = fs.readFileSync(path, 'utf8');
  const plugins = [];
  if (/@vitejs\\/plugin-react/.test(source)) {
    const react = require('@vitejs/plugin-react');
    plugins.push((react.default || react)());
  }
  return plugins;
}

function loadConfig() {
  for (const path of CONFIG_FILES) {
    if (!fs.existsSync(path)) continue;
    try {
      return requireConfig(path);
    } catch (error) {
      console.error('[forge-vite] config load failed: ' + (error && error.message));
      const plugins = detectPlugins(path);
      return plugins.length ? { plugins: plugins } : {};
    }
  }
  return {};
}

function parseArgs(args) {
  const options = { build: {} };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];
    if ((arg === '--outDir' || arg === '--out-dir') && next) {
      options.build.outDir = next;
      index += 1;
    } else if (arg === '--base' && next) {
      options.base = next;
      index += 1;
    } else if (arg === '--mode' && next) {
      options.mode = next;
      index += 1;
    } else if (arg === '--minify') {
      options.build.minify = true;
    } else if (arg === '--sourcemap') {
      options.build.sourcemap = true;
    } else if (arg === '--emptyOutDir') {
      options.build.emptyOutDir = true;
    }
  }
  return options;
}

function copyDirectory(source, target) {
  if (!fs.existsSync(source)) return;
  fs.mkdirSync(target, { recursive: true });
  for (const name of fs.readdirSync(source)) {
    const from = source + '/' + name;
    const to = target + '/' + name;
    if (fs.statSync(from).isDirectory()) copyDirectory(from, to);
    else fs.writeFileSync(to, fs.readFileSync(from));
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const command = argv[0] === 'build' || argv[0] === 'b' ? 'build' : argv[0];
  if (command !== 'build') {
    console.error('[forge-vite] only "vite build" runs in the browser build container');
    process.exit(1);
  }

  const cli = parseArgs(argv.slice(1));
  let userConfig = loadConfig() || {};
  const mode = cli.mode || 'production';
  if (typeof userConfig === 'function') {
    userConfig = userConfig({ command: 'build', mode: mode });
  }

  const config = Object.assign({}, userConfig, {
    configFile: false,
    mode: mode,
    build: Object.assign({}, userConfig.build || {}, cli.build, {
      emptyOutDir: true,
      // @rollup/browser cannot write to disk, so Vite returns the bundle and
      // this shim writes it into the container VFS below.
      write: false,
      copyPublicDir: false,
      modulePreload: Object.assign(
        { polyfill: false },
        (userConfig.build && userConfig.build.modulePreload) || {},
      ),
    }),
  });
  if (cli.base) config.base = cli.base;

  const outDir = config.build.outDir || 'dist';
  const outRoot = outDir.startsWith('/') ? outDir : '/' + outDir;
  const vite = require('/node_modules/vite/dist/node/index.js');
  const result = await vite.build(config);

  const outputs = Array.isArray(result.output)
    ? result.output.reduce(function (all, item) { return all.concat(item.output || []); }, [])
    : result.output || [];
  for (const file of outputs) {
    const target = outRoot + '/' + file.fileName;
    const slash = target.lastIndexOf('/');
    if (slash > 0) fs.mkdirSync(target.slice(0, slash), { recursive: true });
    if (file.type === 'chunk') fs.writeFileSync(target, file.code);
    else fs.writeFileSync(target, file.source);
  }
  copyDirectory('/public', outRoot);

  console.log('[forge-vite] build complete');
  process.exit(0);
}

main().catch(function (error) {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});`;

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

function installedVersion(vfs: VirtualFS, name: string): string | null {
  const path = `/node_modules/${name}/package.json`;
  if (!vfs.existsSync(path)) return null;
  try {
    const pkg = JSON.parse(readText(vfs, path)) as { version?: unknown };
    return typeof pkg.version === "string" ? pkg.version : null;
  } catch {
    return null;
  }
}

function summarizeOutputDir(vfs: VirtualFS, root: string): {
  files: number;
  bytes: number;
} {
  let files = 0;
  let bytes = 0;
  const walk = (dir: string) => {
    let names: string[] = [];
    try {
      names = vfs.readdirSync(dir);
    } catch {
      return;
    }
    for (const name of names) {
      const path = `${dir}/${name}`;
      try {
        const stats = vfs.statSync(path);
        if (stats.isDirectory()) walk(path);
        else {
          files += 1;
          bytes += stats.size;
        }
      } catch {
        // Skip entries that disappear mid-walk.
      }
    }
  };
  walk(root);
  return { files, bytes };
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

/**
 * Make the installed Vite usable inside almostnode:
 * - publicUtils.cjs detects the browser `document` and builds an http:// URL,
 *   which the VFS fs cannot read. Force its Node branch.
 * - index.cjs turns `build()` into a native dynamic import of the ESM entry,
 *   which the page cannot resolve. Require it through the container runtime.
 * - bin/vite.js becomes the build-API shim, so `vite build` (including inside
 *   npm scripts) works without Vite's Node-only CLI.
 */
function prepareVite(vfs: VirtualFS): void {
  if (!vfs.existsSync("/node_modules/vite")) return;

  if (vfs.existsSync(VITE_PUBLIC_UTILS)) {
    const source = readText(vfs, VITE_PUBLIC_UTILS);
    const browserBranch =
      "(typeof document === 'undefined' ? require('u' + 'rl').pathToFileURL(__filename).href : (_documentCurrentScript && _documentCurrentScript.src || new URL('node-cjs/publicUtils.cjs', document.baseURI).href))";
    const nodeBranch = "require('u' + 'rl').pathToFileURL(__filename).href";
    if (source.includes(browserBranch)) {
      vfs.writeFileSync(
        VITE_PUBLIC_UTILS,
        source.split(browserBranch).join(nodeBranch),
      );
    }
  }

  if (vfs.existsSync(VITE_INDEX_CJS)) {
    const source = readText(vfs, VITE_INDEX_CJS);
    const nativeImport = "import('./dist/node/index.js')";
    if (source.includes(nativeImport)) {
      vfs.writeFileSync(
        VITE_INDEX_CJS,
        source.replace(
          nativeImport,
          "Promise.resolve(require('./dist/node/index.js'))",
        ),
      );
    }
  }

  if (vfs.existsSync(VITE_BIN)) {
    vfs.writeFileSync(VITE_BIN, VITE_CLI_SHIM);
  }
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
  const typePackages: string[] = [];

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
        // Keep published ESM entry points intact so Rollup can see their
        // exports. almostnode's default transform rewrites them to CJS.
        transform: false,
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
        const pinned = await target.npm.install(spec, {
          transform: false,
          onProgress: note,
        });
        if (pinned.added.length > 0) {
          note(`pinned ${spec}`);
        }
      }

      // React projects need their type packages for `tsc`, but the starter's
      // package.json does not list them. Add them to the container only, never
      // to the project, so a normal `npm run build` can typecheck.
      for (const name of ["react", "react-dom"]) {
        const reactVersion = installedVersion(vfs, name);
        if (!reactVersion) continue;
        const typesName = `/node_modules/@types/${name}`;
        if (vfs.existsSync(typesName)) continue;
        const major = reactVersion.split(".")[0];
        try {
          // almostnode's range parser needs a full x.y.z after the caret.
          await target.npm.install(`@types/${name}@^${major}.0.0`, {
            transform: false,
            onProgress: note,
          });
          typePackages.push(`@types/${name}@${major}`);
          note(`added @types/${name}@${major} for typechecking`);
        } catch (error) {
          // A missing type package should not fail the whole build.
          note(`could not add @types/${name}: ${messageOf(error)}`);
        }
      }

      // Rollup needs the project's dependencies as published ESM, but Vite
      // itself runs inside almostnode's Node runtime and must be transformed
      // to CJS there. Re-install only Vite with transformation enabled.
      const vitePackageJson = vfs.existsSync("/node_modules/vite/package.json")
        ? (JSON.parse(
            readText(vfs, "/node_modules/vite/package.json"),
          ) as { version?: unknown })
        : null;
      if (typeof vitePackageJson?.version === "string") {
        removeEntry(vfs, "/node_modules/vite");
        await target.npm.install(`vite@${vitePackageJson.version}`, {
          transform: true,
          onProgress: note,
        });
        note(`prepared vite@${vitePackageJson.version} for the build runtime`);
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
        typePackages,
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
      typePackages,
    };
  }

  prepareVite(vfs);

  const result = await target.run(command, {
    cwd: "/",
    signal: options.signal,
  });
  let output = [result.stdout, result.stderr]
    .filter(Boolean)
    .join("\n")
    .trim();

  const dist = summarizeOutputDir(vfs, "/dist");
  if (result.exitCode === 0 && dist.files > 0) {
    output += `\n\nOutput: /dist (${dist.files} files, ${(
      dist.bytes / 1024
    ).toFixed(1)} kB)`;
  }

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
    typePackages,
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
