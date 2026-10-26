/**
 * The project that lives inside almostnode's virtual file system the first time
 * the IDE is opened.
 *
 * The sources are stored in `public/samples/starter-files.zip`, with the
 * project root at the archive root (`package.json`, `src/...`, `public/...`).
 * Loading the zip at runtime keeps the starter out of the main JavaScript
 * bundle while preserving its folder structure, including the binary public
 * assets that used to need separate `?url` imports.
 *
 * The starter is a six-chapter, scroll-driven landing page for MY COMPANY:
 * a Zustand scroll store, a chapter timeline, and one canvas that draws every
 * scene. Each chapter's drawing code lives in its own `src/sections/<scene>/`
 * folder. The in-browser ViteDevServer compiles the TSX with esbuild-wasm and
 * maps React/Zustand to esm.sh.
 */
import { unzipSync } from 'fflate';

/** Vite serves `public/` from the site root in dev and copies it on build. */
const STARTER_ZIP_URL = `${import.meta.env.BASE_URL}samples/starter-files.zip`;

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

/** Split the archive into editable text files and binary public assets. */
function readStarterZip(archive: Uint8Array): StarterBundle {
  const entries = unzipSync(archive, {
    filter: (file) =>
      !file.name.endsWith('/') &&
      !file.name.startsWith('__MACOSX/') &&
      !file.name.endsWith('.DS_Store'),
  });
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const files: Record<string, string> = {};
  const assets: Record<string, Uint8Array> = {};

  for (const [name, bytes] of Object.entries(entries)) {
    // Zip entry names are untrusted input; keep them inside the project root.
    if (!name || name.startsWith('/') || name.includes('../')) continue;
    const path = `/${name}`;

    if (!BINARY_EXTENSIONS.has(extensionOf(name))) {
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
        `Could not load the starter archive (HTTP ${response.status})`
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
