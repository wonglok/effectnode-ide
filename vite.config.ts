import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { almostnodePlugin } from 'almostnode/vite';
import { nitro } from 'nitro/vite';
import { defineConfig, type Plugin } from 'vite';

const root = path.dirname(fileURLToPath(import.meta.url));
const swFile = path.resolve(root, 'node_modules/almostnode/dist/__sw__.js');

/**
 * almostnodePlugin serves the service worker in dev. Vite only copies files in
 * `public/`, so emit the same file from node_modules into the build output.
 */
function almostnodeServiceWorker(): Plugin {
  return {
    name: 'forge:almostnode-service-worker',
    apply: 'build',
    generateBundle() {
      if (!fs.existsSync(swFile)) {
        this.error(`almostnode service worker not found at ${swFile}`);
      }
      this.emitFile({
        type: 'asset',
        fileName: '__sw__.js',
        source: fs.readFileSync(swFile),
      });
    },
  };
}

/**
 * almostnode ships a WorkerRuntime that points at a prebuilt worker asset in
 * its public directory. We only use the synchronous in-page runtime, but
 * Rollup's worker plugin still tries to resolve that URL during a production
 * build and fails (or pulls in a 3.6 MB worker). Neutralise the constructor;
 * Forge never instantiates it.
 */
function almostnodeWorkerPatch(): Plugin {
  return {
    name: 'forge:almostnode-worker-patch',
    enforce: 'pre',
    transform(code, id) {
      if (!id.includes('almostnode/')) return null;

      let next = code;

      if (id.includes('almostnode/dist/index.mjs')) {
        next = next.replace(
          /new Worker\(\s*new URL\(\s*\/\* @vite-ignore \*\/\s*["']\/assets\/runtime-worker-[^"']+["'],\s*import\.meta\.url\s*\),\s*\{\s*type:\s*["']module["']\s*\}\s*\)/g,
          '(() => { throw new Error("almostnode WorkerRuntime is not available in Forge"); })()'
        );
      }

      // The Buffer polyfill subclasses Uint8Array and declares a static
      // BYTES_PER_ELEMENT. Uint8Array already has a non-writable inherited
      // property of that name, so esbuild's minifier (which rewrites the
      // static field into a static init block assignment) makes the bundle
      // throw at import time. The inherited value is already 1, so drop the
      // redundant declaration.
      next = next
        .replace(/__publicField\(_BufferPolyfill,\s*"BYTES_PER_ELEMENT",\s*1\);/g, '')
        .replace(/^\s*static readonly BYTES_PER_ELEMENT = 1;\s*$/gm, '');

      if (next === code) return null;
      return { code: next, map: null };
    },
  };
}

// almostnode boots a browser-side Node runtime, which uses SharedArrayBuffer
// when it is available. These headers match upstream's dev server.
const crossOriginHeaders = {
  'Cross-Origin-Embedder-Policy': 'credentialless',
  'Cross-Origin-Opener-Policy': 'same-origin',
};

export default defineConfig({
  // almostnodePlugin must register its /__sw__.js middleware before Nitro's
  // catch-all SPA middleware, otherwise the worker route gets index.html.
  plugins: [
    almostnodePlugin(),
    react(),
    tailwindcss(),
    nitro(),
    almostnodeServiceWorker(),
    almostnodeWorkerPatch(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(root, 'src'),
      // just-bash imports node:zlib for gzip/gunzip helpers.
      'node:zlib': path.resolve(root, 'src/lib/zlib-shim.ts'),
      zlib: path.resolve(root, 'src/lib/zlib-shim.ts'),
    },
  },
  optimizeDeps: {
    // almostnode pulls in CommonJS packages (just-bash → sprintf-js) that the
    // browser cannot import raw. Pre-bundle the runtime and its externals.
    include: ['almostnode', 'just-bash', 'sprintf-js', 'pako', 'comlink', 'resolve.exports'],
  },
  define: {
    global: 'globalThis',
  },
  worker: {
    format: 'es',
  },
  server: {
    port: 5173,
    strictPort: true,
    headers: crossOriginHeaders,
    // The harness mirrors projects into data/harness-workspaces and writes its
    // dsh home under data/. Those files are runtime state, not app source, and
    // watching them would force page reloads mid-turn.
    watch: {
      ignored: ['**/data/**'],
    },
  },
  preview: {
    port: 4173,
    headers: crossOriginHeaders,
  },
  build: {
    target: 'esnext',
    assetsInlineLimit: 0,
    // almostnode is a large, lazily imported runtime; it is not on the
    // critical initial-load path.
    chunkSizeWarningLimit: 2000,
  },
  nitro: {
    compatibilityDate: '2026-10-23',
    // Vercel reserves a root `/api` directory, so handlers live under
    // `server/routes/api` and Nitro emits them as normal /api routes.
    routesDir: 'server/routes',
    routeRules: {
      '/**': { headers: crossOriginHeaders },
      '/api/**': { cors: false },
    },
  },
});
