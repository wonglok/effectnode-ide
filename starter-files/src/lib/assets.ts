/**
 * Binary starter assets are stored as base64 text so they can live inside the
 * virtual project (and in the standalone starter) without a binary file API.
 * Fetch them relative to the importing module, then decode in memory.
 */
export async function loadBinaryAsset(url: URL | string): Promise<ArrayBuffer> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Could not load asset (HTTP ${response.status})`);
  }
  return decodeBase64(await response.text());
}

export function decodeBase64(encoded: string): ArrayBuffer {
  // Base64 payloads may be wrapped by editors; whitespace is not significant.
  const binary = atob(encoded.replace(/\s+/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
}
