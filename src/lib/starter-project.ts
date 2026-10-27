/**
 * Starter projects copied into the virtual file system when a new project is
 * created (or when the IDE has no project to restore).
 *
 * The sources are stored as zipped Forge project exports in
 * `public/starter/`. Each archive carries `forge.manifest.json`, which names
 * the project folder (`simple-template/`), plus `package.json`, `src/...`, and
 * any `public/` binaries. Loading a zip on demand keeps the templates out of
 * the main JavaScript bundle while preserving their folder structure.
 *
 * Both starters are six-chapter, scroll-driven landing pages with a Zustand
 * store, a chapter timeline, and a canvas that draws every scene. The movie
 * variant adds movie controls, a final-movie section, and a video asset.
 */
import { unzipSync } from 'fflate';
import { classifyFile } from './binary-file';

const STARTER_BASE_URL = `${import.meta.env.BASE_URL}starter/`;

const MANIFEST_FILENAME = 'forge.manifest.json';
const AGENT_STATE_FILENAME = 'agent-state.json';
const ROOT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export const STARTER_PROJECT_NAME = 'MY COMPANY';

/** Files opened as tabs on first boot. */
export const STARTER_ENTRY = '/src/components/Landing.tsx';

/** A project only needs the starter binaries when chapter 4 is present. */
export const STARTER_ASSET_ENTRY = '/src/sections/apartment/index.ts';

export type StarterTemplateId = 'simple' | 'movie';

export interface StarterTemplate {
  id: StarterTemplateId;
  label: string;
  description: string;
  meta: string;
  url: string;
}

/** The templates offered by the new-project dialog, in display order. */
export const STARTER_TEMPLATES: readonly StarterTemplate[] = [
  {
    id: 'simple',
    label: 'Simple',
    description:
      'The six-chapter scroll story with WebGPU scenes and a lightweight asset set.',
    meta: '41 files · 3 public assets',
    url: `${STARTER_BASE_URL}simple-template.zip`,
  },
  {
    id: 'movie',
    label: 'Movie',
    description:
      'The same story with movie controls, a final-movie clip and motion transitions.',
    meta: '43 files · 4 public assets',
    url: `${STARTER_BASE_URL}movie-template.zip`,
  },
];

export const DEFAULT_STARTER_TEMPLATE: StarterTemplateId = 'simple';

/**
 * The movie starter is the simple project plus this component. Projects keep
 * their binary template assets available across reloads by checking for it.
 */
const MOVIE_TEMPLATE_MARKER = '/src/components/MovieControls.tsx';

export function detectStarterTemplate(
  files: Record<string, string>
): StarterTemplateId {
  return files[MOVIE_TEMPLATE_MARKER] !== undefined
    ? 'movie'
    : DEFAULT_STARTER_TEMPLATE;
}

export interface StarterBundle {
  files: Record<string, string>;
  assets: Record<string, Uint8Array>;
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
    const file = classifyFile(relative, bytes);
    if (file.kind === 'text') files[path] = file.text;
    else assets[path] = file.bytes;
  }

  return { files, assets };
}

const starterPromises = new Map<StarterTemplateId, Promise<StarterBundle>>();

/**
 * Fetch and unpack a starter once, then reuse the decoded contents. Simple and
 * movie have independent caches, so switching between them never re-downloads
 * the same archive twice in one session.
 */
export function loadStarter(
  templateId: StarterTemplateId = DEFAULT_STARTER_TEMPLATE
): Promise<StarterBundle> {
  const cached = starterPromises.get(templateId);
  if (cached) return cached;

  const template =
    STARTER_TEMPLATES.find((entry) => entry.id === templateId) ??
    STARTER_TEMPLATES[0];
  const promise = (async () => {
    const response = await fetch(template.url);
    if (!response.ok) {
      throw new Error(
        `Could not load the ${template.label.toLowerCase()} template (HTTP ${response.status})`
      );
    }
    return readStarterZip(new Uint8Array(await response.arrayBuffer()));
  })().catch((error) => {
    starterPromises.delete(template.id);
    throw error;
  });

  starterPromises.set(template.id, promise);
  return promise;
}

export async function loadStarterFiles(
  templateId: StarterTemplateId = DEFAULT_STARTER_TEMPLATE
): Promise<Record<string, string>> {
  return (await loadStarter(templateId)).files;
}

/** A template's public binaries, ready to mount beside a project's files. */
export async function loadStarterAssets(
  templateId: StarterTemplateId = DEFAULT_STARTER_TEMPLATE
): Promise<Record<string, Uint8Array>> {
  return (await loadStarter(templateId)).assets;
}
