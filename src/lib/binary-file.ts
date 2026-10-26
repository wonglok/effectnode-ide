/**
 * Projects mix editable text with binary files in `public/` (models, textures,
 * uploads). Archives are untrusted input, so known binary extensions are
 * decisive; anything else is treated as text only when it is valid UTF-8.
 */
export type ClassifiedFile =
  | { kind: 'text'; text: string }
  | { kind: 'binary'; bytes: Uint8Array };

const BINARY_EXTENSIONS = new Set([
  '7z',
  'avif',
  'bin',
  'bmp',
  'drc',
  'exr',
  'gif',
  'glb',
  'gltf',
  'gz',
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
  'rar',
  'tif',
  'tiff',
  'ttf',
  'wasm',
  'wav',
  'webm',
  'webp',
  'woff',
  'woff2',
  'zip',
]);

const decoder = new TextDecoder('utf-8', { fatal: true });

function extensionOf(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? '' : name.slice(dot + 1).toLowerCase();
}

export function classifyFile(path: string, bytes: Uint8Array): ClassifiedFile {
  if (!BINARY_EXTENSIONS.has(extensionOf(path))) {
    try {
      return { kind: 'text', text: decoder.decode(bytes) };
    } catch {
      // Not valid UTF-8, so treat it as a binary asset.
    }
  }
  return { kind: 'binary', bytes };
}
