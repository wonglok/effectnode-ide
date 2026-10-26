/**
 * The project that lives inside almostnode's virtual file system the first time
 * the IDE is opened. The sources live in `/starter-files` and are embedded at
 * build time with Vite's `?raw` imports, so they stay readable and editable
 * while the browser receives plain strings.
 *
 * Binary public assets (the chapter 4 HDRI and GLB) are kept out of that text
 * map. They live in `starter-files/public` and are fetched as bytes when a
 * project needs them, then mounted at `public/` in the virtual file system.
 * The explorer shows that folder; the runtime also serves the files from the
 * site root, matching Vite's public-directory behaviour.
 *
 * The starter is a six-chapter, scroll-driven landing page for MY COMPANY:
 * a Zustand scroll store, a chapter timeline, and one canvas that draws every
 * scene. Each chapter's drawing code lives in its own `src/sections/<scene>/`
 * folder. The in-browser ViteDevServer compiles the TSX with esbuild-wasm and
 * maps React/Zustand to esm.sh.
 */
import packageJson from '../../starter-files/package.json?raw';
import viteConfig from '../../starter-files/vite.config.js?raw';
import tsconfig from '../../starter-files/tsconfig.json?raw';
import indexHtml from '../../starter-files/index.html?raw';
import readme from '../../starter-files/README.md?raw';
import agentsMd from '../../starter-files/AGENTS.md?raw';
import mainTsx from '../../starter-files/src/main.tsx?raw';
import tailwindThemeTs from '../../starter-files/src/tailwind-theme.ts?raw';
import typesDts from '../../starter-files/src/types.d.ts?raw';
import appTsx from '../../starter-files/src/App.tsx?raw';
import stylesCss from '../../starter-files/src/styles.css?raw';
import registryTs from '../../starter-files/src/sections/registry.ts?raw';
import sharedSceneTs from '../../starter-files/src/sections/shared.ts?raw';
import softRoomSceneTs from '../../starter-files/src/sections/soft-room/index.ts?raw';
import forceShieldSceneTs from '../../starter-files/src/sections/force-shield/index.ts?raw';
import kineticSceneTs from '../../starter-files/src/sections/kinetic/index.ts?raw';
import kineticCenterTextTs from '../../starter-files/src/sections/kinetic/center-text.ts?raw';
import kineticHelveticaTs from '../../starter-files/src/sections/kinetic/helvetica.ts?raw';
import apartmentSceneTs from '../../starter-files/src/sections/apartment/index.ts?raw';
import liveEnvSceneTs from '../../starter-files/src/sections/live-env/index.ts?raw';
import liveEnvHahaTextTs from '../../starter-files/src/sections/live-env/haha-text.ts?raw';
import liveEnvOnePerSceneTs from '../../starter-files/src/sections/live-env/one-per-scene.ts?raw';
import alpha6SceneTs from '../../starter-files/src/sections/alpha6/index.ts?raw';
import alpha6YoTextTs from '../../starter-files/src/sections/alpha6/yo-text.ts?raw';
// `.glb`/`.hdr` are registered in Vite's `assetsInclude`, so these resolve to
// asset URLs in dev (served by Vite's asset middleware, ahead of Nitro's SPA
// fallback) and to hashed files in the production build.
import apartmentGlbUrl from '../../starter-files/public/apartment.glb?url';
import studioHdrUrl from '../../starter-files/public/studio.hdr?url';
import scrollPhasesTs from '../../starter-files/src/lib/scroll-phases.ts?raw';
import renderPipelineTs from '../../starter-files/src/lib/render-pipeline.ts?raw';
import transitionIndexTs from '../../starter-files/src/transitions/index.ts?raw';
import transitionTypesTs from '../../starter-files/src/transitions/types.ts?raw';
import transitionLiquidTs from '../../starter-files/src/transitions/liquid.ts?raw';
import transitionPageCurlTs from '../../starter-files/src/transitions/page-curl.ts?raw';
import transitionCrossZoomTs from '../../starter-files/src/transitions/cross-zoom.ts?raw';
import audioEngineTs from '../../starter-files/src/lib/audio-engine.ts?raw';
import scrollerStoreTs from '../../starter-files/src/store/useScrollerStore.ts?raw';
import landingTsx from '../../starter-files/src/components/Landing.tsx?raw';
import storyRouterTsx from '../../starter-files/src/components/StoryRouter.tsx?raw';
import landingCss from '../../starter-files/src/components/landing.css?raw';
import sceneStageTsx from '../../starter-files/src/components/SceneStage.tsx?raw';
import sceneStageCss from '../../starter-files/src/components/scene-stage.css?raw';
import splashTsx from '../../starter-files/src/components/SplashScreen.tsx?raw';
import splashCss from '../../starter-files/src/components/splash.css?raw';

export const STARTER_PROJECT_NAME = 'MY COMPANY';

export const STARTER_FILES: Record<string, string> = {
  '/package.json': packageJson,
  '/vite.config.js': viteConfig,
  '/tsconfig.json': tsconfig,
  '/index.html': indexHtml,
  '/README.md': readme,
  '/AGENTS.md': agentsMd,
  '/src/main.tsx': mainTsx,
  '/src/tailwind-theme.ts': tailwindThemeTs,
  '/src/types.d.ts': typesDts,
  '/src/App.tsx': appTsx,
  '/src/styles.css': stylesCss,
  '/src/sections/registry.ts': registryTs,
  '/src/sections/shared.ts': sharedSceneTs,
  '/src/sections/soft-room/index.ts': softRoomSceneTs,
  '/src/sections/force-shield/index.ts': forceShieldSceneTs,
  '/src/sections/kinetic/index.ts': kineticSceneTs,
  '/src/sections/kinetic/center-text.ts': kineticCenterTextTs,
  '/src/sections/kinetic/helvetica.ts': kineticHelveticaTs,
  '/src/sections/apartment/index.ts': apartmentSceneTs,
  '/src/sections/live-env/index.ts': liveEnvSceneTs,
  '/src/sections/live-env/haha-text.ts': liveEnvHahaTextTs,
  '/src/sections/live-env/one-per-scene.ts': liveEnvOnePerSceneTs,
  '/src/sections/alpha6/index.ts': alpha6SceneTs,
  '/src/sections/alpha6/yo-text.ts': alpha6YoTextTs,
  '/src/lib/scroll-phases.ts': scrollPhasesTs,
  '/src/lib/render-pipeline.ts': renderPipelineTs,
  '/src/transitions/index.ts': transitionIndexTs,
  '/src/transitions/types.ts': transitionTypesTs,
  '/src/transitions/liquid.ts': transitionLiquidTs,
  '/src/transitions/page-curl.ts': transitionPageCurlTs,
  '/src/transitions/cross-zoom.ts': transitionCrossZoomTs,
  '/src/lib/audio-engine.ts': audioEngineTs,
  '/src/store/useScrollerStore.ts': scrollerStoreTs,
  '/src/components/Landing.tsx': landingTsx,
  '/src/components/StoryRouter.tsx': storyRouterTsx,
  '/src/components/landing.css': landingCss,
  '/src/components/SceneStage.tsx': sceneStageTsx,
  '/src/components/scene-stage.css': sceneStageCss,
  '/src/components/SplashScreen.tsx': splashTsx,
  '/src/components/splash.css': splashCss,
};

/** Files opened as tabs on first boot. */
export const STARTER_ENTRY = '/src/components/Landing.tsx';

/**
 * Binary public assets, keyed by their path inside the project. They live in
 * `public/` like a normal Vite project (and show up in the explorer), while
 * the virtual server also serves them from the root URL the starter requests.
 * Vite gives us the URL for the file in both dev and the production build.
 */
export const STARTER_ASSETS: Record<string, string> = {
  '/public/apartment.glb': apartmentGlbUrl,
  '/public/studio.hdr': studioHdrUrl,
};

/** A project only needs the starter binaries when chapter 4 is present. */
export const STARTER_ASSET_ENTRY = '/src/sections/apartment/index.ts';

let starterAssetsPromise: Promise<Record<string, Uint8Array>> | null = null;

/** Fetch the public binaries once, then reuse the decoded bytes. */
export function loadStarterAssets(): Promise<Record<string, Uint8Array>> {
  starterAssetsPromise ??= (async () => {
    const entries = await Promise.all(
      Object.entries(STARTER_ASSETS).map(async ([path, url]) => {
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(
            `Could not load starter asset ${path} (HTTP ${response.status})`
          );
        }
        return [path, new Uint8Array(await response.arrayBuffer())] as const;
      })
    );
    return Object.fromEntries(entries);
  })().catch((error) => {
    starterAssetsPromise = null;
    throw error;
  });

  return starterAssetsPromise;
}
