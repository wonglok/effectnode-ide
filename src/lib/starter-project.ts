/**
 * The project that lives inside almostnode's virtual file system the first time
 * the IDE is opened. The sources live in `/starter-files` and are embedded at
 * build time with Vite's `?raw` imports, so they stay readable and editable
 * while the browser receives plain strings.
 *
 * The starter is a four-chapter, scroll-driven landing page for MY COMPANY:
 * a Zustand scroll store, a chapter timeline, and one
 * canvas that draws every scene. The in-browser ViteDevServer compiles the TSX
 * with esbuild-wasm and maps React/Zustand to esm.sh.
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
import scrollPhasesTs from '../../starter-files/src/lib/scroll-phases.ts?raw';
import renderPipelineTs from '../../starter-files/src/lib/render-pipeline.ts?raw';
import helveticaTs from '../../starter-files/src/lib/helvetica.ts?raw';
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
  '/src/lib/scroll-phases.ts': scrollPhasesTs,
  '/src/lib/render-pipeline.ts': renderPipelineTs,
  '/src/lib/helvetica.ts': helveticaTs,
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
