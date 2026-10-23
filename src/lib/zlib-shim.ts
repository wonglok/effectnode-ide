/**
 * Browser zlib for just-bash's decompression helpers. Vite maps `node:zlib`
 * here so the dependency does not get externalised to an empty stub.
 *
 * Only the pako-backed subset is implemented; brotli is provided by
 * almostnode's own bundled shim when it is needed.
 */
import pako from 'pako';

type Binary = Uint8Array | ArrayBuffer | string;
type Callback = (error: Error | null, result: Uint8Array) => void;

function bytes(data: Binary): Uint8Array {
  if (typeof data === 'string') return new TextEncoder().encode(data);
  return data instanceof ArrayBuffer ? new Uint8Array(data) : data;
}

export function gzipSync(data: Binary): Uint8Array {
  return pako.gzip(bytes(data));
}

export function gunzipSync(data: Binary): Uint8Array {
  return pako.ungzip(bytes(data));
}

export function deflateSync(data: Binary): Uint8Array {
  return pako.deflate(bytes(data));
}

export function inflateSync(data: Binary): Uint8Array {
  return pako.inflate(bytes(data));
}

export function deflateRawSync(data: Binary): Uint8Array {
  return pako.deflateRaw(bytes(data));
}

export function inflateRawSync(data: Binary): Uint8Array {
  return pako.inflateRaw(bytes(data));
}

function callbackify(run: () => Uint8Array, callback?: Callback): void {
  try {
    callback?.(null, run());
  } catch (error) {
    callback?.(error instanceof Error ? error : new Error(String(error)), new Uint8Array());
  }
}

export function gzip(data: Binary, callback: Callback): void {
  callbackify(() => gzipSync(data), callback);
}

export function gunzip(data: Binary, callback: Callback): void {
  callbackify(() => gunzipSync(data), callback);
}

export function deflate(data: Binary, callback: Callback): void {
  callbackify(() => deflateSync(data), callback);
}

export function inflate(data: Binary, callback: Callback): void {
  callbackify(() => inflateSync(data), callback);
}

export function deflateRaw(data: Binary, callback: Callback): void {
  callbackify(() => deflateRawSync(data), callback);
}

export function inflateRaw(data: Binary, callback: Callback): void {
  callbackify(() => inflateRawSync(data), callback);
}

function unavailable(): never {
  throw new Error('brotli is not available in this browser shim');
}

export const brotliCompress = unavailable;
export const brotliCompressSync = unavailable;
export const brotliDecompress = unavailable;
export const brotliDecompressSync = unavailable;

export const constants = {
  Z_NO_FLUSH: 0,
  Z_PARTIAL_FLUSH: 1,
  Z_SYNC_FLUSH: 2,
  Z_FULL_FLUSH: 3,
  Z_FINISH: 4,
  Z_BLOCK: 5,
  Z_OK: 0,
  Z_STREAM_END: 1,
  Z_NEED_DICT: 2,
  Z_ERRNO: -1,
  Z_STREAM_ERROR: -2,
  Z_DATA_ERROR: -3,
  Z_MEM_ERROR: -4,
  Z_BUF_ERROR: -5,
  Z_VERSION_ERROR: -6,
  Z_NO_COMPRESSION: 0,
  Z_BEST_SPEED: 1,
  Z_BEST_COMPRESSION: 9,
  Z_DEFAULT_COMPRESSION: -1,
  Z_FILTERED: 1,
  Z_HUFFMAN_ONLY: 2,
  Z_RLE: 3,
  Z_FIXED: 4,
  Z_DEFAULT_STRATEGY: 0,
  ZLIB_VERNUM: 4784,
  Z_MIN_WINDOWBITS: 8,
  Z_MAX_WINDOWBITS: 15,
  Z_DEFAULT_WINDOWBITS: 15,
  Z_MIN_CHUNK: 64,
  Z_MAX_CHUNK: Infinity,
  Z_DEFAULT_CHUNK: 16384,
  Z_MIN_MEMLEVEL: 1,
  Z_MAX_MEMLEVEL: 9,
  Z_DEFAULT_MEMLEVEL: 8,
  Z_MIN_LEVEL: -1,
  Z_MAX_LEVEL: 9,
  Z_DEFAULT_LEVEL: -1,
} as const;

export default {
  gzip,
  gzipSync,
  gunzip,
  gunzipSync,
  deflate,
  deflateSync,
  inflate,
  inflateSync,
  deflateRaw,
  deflateRawSync,
  inflateRaw,
  inflateRawSync,
  constants,
};
