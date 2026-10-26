/**
 * The project that lives inside almostnode's virtual file system the first time
 * the IDE is opened.
 *
 * The sources are stored in `public/starter/template-001.zip`. The archive is
 * a Forge project export: `forge.manifest.json` names the project folder
 * (`template-001/`), which holds `package.json`, `src/...`, and any `public/`
 * binaries. Loading the zip at runtime keeps the template out of the main
 * JavaScript bundle while preserving its folder structure.
 *
 * The starter is a six-chapter, scroll-driven landing page for MY COMPANY:
 * a Zustand scroll store, a chapter timeline, and one canvas that draws every
 * scene. Each chapter's drawing code lives in its own `src/sections/<scene>/`
 * folder. The in-browser ViteDevServer compiles the TSX with esbuild-wasm and
 * maps React/Zustand to esm.sh.
 */
import { unzipSync } from 'fflate';

/** Vite serves `public/` from the site root in dev and copies it on build. */
const STARTER_ZIP_URL = `${import.meta.env.BASE_URL}starter/template-001.zip`;

const MANIFEST_FILENAME = 'forge.manifest.json';
const AGENT_STATE_FILENAME = 'agent-state.json';
const ROOT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export const STARTER_PROJECT_NAME = 'MY COMPANY';

/** Files opened as tabs on first boot. */
export const STARTER_ENTRY = '/src/components/Landing.tsx';

/** A project only needs the starter binaries when chapter 4 is present. */
export const STARTER_ASSET_ENTRY = '/src/sections/apartment/index.ts';

export interface StarterBundle {
  files: Record<string, string>;
  assets: Record<string, Uint8Array>;
}

/**
 * Extensions that are always stored as bytes. A file outside this list is
 * still treated as binary when it is not valid UTF-8.
 */
const BINARY_EXTENSIONS = new Set([
  'avif',
  'bin',
  'bmp',
  'drc',
  'exr',
  'gif',
  'glb',
  'gltf',
  'hdr',
  'ico',
  'jpeg',
  'jpg',
  'ktx',
  'ktx2',
  'mp3',
  'mp4',
  'ogg',
  'otf',
  'pdf',
  'png',
  'ttf',
  'wav',
  'webm',
  'webp',
  'woff',
  'woff2',
  'zip',
]);

function extensionOf(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? '' : name.slice(dot + 1).toLowerCase();
}

/**
 * Forge exports live under a manifest-named folder. A plain folder zip (no
 * manifest) is also accepted when it has the project files at the root.
 */
function archiveRoot(entries: Record<string, Uint8Array>): string {
  const manifestBytes = entries[MANIFEST_FILENAME];
  if (!manifestBytes) return '';

  let root: unknown;
  try {
    const manifest = JSON.parse(new TextDecoder().decode(manifestBytes)) as {
      root?: unknown;
    };
    root = manifest.root;
  } catch {
    throw new Error('The starter template has an unreadable manifest.');
  }

  if (typeof root !== 'string' || !ROOT_PATTERN.test(root)) {
    throw new Error('The starter template has an invalid project folder.');
  }
  return `${root}/`;
}

function isSafeRelativePath(path: string): boolean {
  return (
    path.length > 0 &&
    !path.startsWith('/') &&
    !path.includes('\\') &&
    !path.includes('\0') &&
    path.split('/').every((segment) => segment && segment !== '.' && segment !== '..')
  );
}

/** Split the archive into editable text files and binary public assets. */
function readStarterZip(archive: Uint8Array): StarterBundle {
  const entries = unzipSync(archive, {
    filter: (file) =>
      !file.name.endsWith('/') &&
      !file.name.startsWith('__MACOSX/') &&
      !file.name.endsWith('.DS_Store'),
  });
  const root = archiveRoot(entries);
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const files: Record<string, string> = {};
  const assets: Record<string, Uint8Array> = {};

  for (const [name, bytes] of Object.entries(entries)) {
    if (name === MANIFEST_FILENAME) continue;
    if (root && !name.startsWith(root)) continue;

    const relative = root ? name.slice(root.length) : name;
    // The transcript belongs to the archive, not to a fresh project.
    if (!root && relative === AGENT_STATE_FILENAME) continue;
    if (!isSafeRelativePath(relative)) continue;

    const path = `/${relative}`;
    if (!BINARY_EXTENSIONS.has(extensionOf(relative))) {
      try {
        files[path] = decoder.decode(bytes);
        continue;
      } catch {
        // Not valid UTF-8, so treat it as a binary asset.
      }
    }

    assets[path] = bytes;
  }

  return { files, assets };
}

let starterPromise: Promise<StarterBundle> | null = null;

/** Fetch and unpack the starter once, then reuse the decoded contents. */
export function loadStarter(): Promise<StarterBundle> {
  starterPromise ??= (async () => {
    const response = await fetch(STARTER_ZIP_URL);
    if (!response.ok) {
      throw new Error(
        `Could not load the starter template (HTTP ${response.status})`
      );
    }
    return readStarterZip(new Uint8Array(await response.arrayBuffer()));
  })().catch((error) => {
    starterPromise = null;
    throw error;
  });

  return starterPromise;
}

export async function loadStarterFiles(): Promise<Record<string, string>> {
  return (await loadStarter()).files;
}

/** The starter's public binaries, ready to mount beside a project's files. */
export async function loadStarterAssets(): Promise<Record<string, Uint8Array>> {
  return (await loadStarter()).assets;
}
