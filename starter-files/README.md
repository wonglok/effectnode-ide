# MY COMPANY — starter

A six-chapter, scroll-driven landing page that runs entirely inside the Forge
preview. The scenes are real-time three.js WebGPURenderer worlds shaded with
TSL (chapter 4 adds a scanned apartment GLB and a studio HDRI), the story is
steered by a small Zustand store, and React Router's `HashRouter` keeps the URL
in step with the chapter.

`three` (runtime) and `@types/three` (types) are installed and mapped through
the import map, so `three`, `three/webgpu`, `three/tsl`, and
`three/addons/...` all resolve in the preview. Tailwind CSS v4 runs through its
official browser build (`@tailwindcss/browser`), and Zustand powers the scroll
store. WebGPU is required; if the browser cannot start it, SceneStage switches
to a static CSS stage instead of falling back to Canvas 2D.

## The experience

- **01 Soft Room** — a sunlit interior with a shoji window casting a soft
  grid of light, drifting pink spheres, and a warm lantern.
- **02 Force Shield** — a TSL force-field sphere with a triplanar hex grid,
  flowing noise, dissolving reveal, and click/auto impact rings.
- **03 Kinetic** — a field of orbiting particles and a multiline
  “Welcome to my template” title drawn with `TextGeometry` in transmission
  glass.
- **04 Apartment** — a scanned interior lit by a studio HDRI, with a
  Draco-compressed GLB and AVIF textures. The camera sits inside the room.
- **05 Live Env** — a wireframe skyline, receding grid, and floating monoliths.
- **06 Alpha 6** — glass shards built from gradients and geometry.

Scroll (or drag on touch) to move between chapters. The numbered circles on the
right jump directly to a chapter with a deliberately slower spring than wheel
scrolling; the top line shows progress. Each chapter
hands over to the next with a real shader transition — a liquid-glass wipe, a
page curl, or a cross zoom — rather than a plain opacity fade. The hash mirrors
the active chapter (`#/scene-02`), and reloading resumes at that chapter.

## How it works

- `src/store/useScrollerStore.ts` — Zustand store plus the wheel/touch inertia
  engine. It publishes a continuous scroll position; `goTo` eases toward a
  chapter with a critically damped spring.
- `src/lib/scroll-phases.ts` — the chapter timeline: hold, blend, anchors.
- `src/components/StoryRouter.tsx` — bridges `HashRouter` and the scroll store:
  an active-chapter change rewrites the hash, and a `/scene-02` URL (including
  the legacy `#scene-02` form) snaps the engine to that chapter on load.
- `src/components/SceneStage.tsx` — the WebGPURenderer and six chapter worlds.
  Each scene folder owns its drawing code:
  - `src/sections/soft-room/index.ts` — sunlit room, shoji grid shadows, and
    floating spheres.
  - `src/sections/force-shield/index.ts` — TSL force-field sphere with hex grid,
    flow noise, reveal dissolve, and impact rings.
  - `src/sections/kinetic/index.ts` — instanced glints plus the glass title.
  - `src/sections/apartment/index.ts` — scanned apartment GLB (Draco + AVIF),
    normalized into the frame, lit by the studio HDRI, and viewed from an
    interior camera at ground level.
  - `src/sections/live-env/index.ts` — wireframe city over a breathing grid.
  - `src/sections/alpha6/index.ts` — fresnel-lit glass shards.
  Each world owns its scene, camera instance, and render pass (the camera is
  created and framed in the chapter module); the scroll phase drifts
  and scales the world as it enters or leaves. The kinetic title uses
  `MeshPhysicalNodeMaterial` transmission, dispersion and clearcoat with a
  prefiltered room environment. Chapter 4 prefilters `public/studio.hdr` with
  `PMREMGenerator` and assigns it as that scene's environment.
- `public/studio.hdr` — the chapter 4 environment map.
- `public/apartment.glb` — the chapter 4 apartment model (Draco + AVIF).
  Both are requested with relative URLs (`studio.hdr`, `apartment.glb`) so they
  resolve at the site root and under the IDE preview's virtual-server prefix.
- `src/sections/shared.ts` — shared scene types and TSL helpers (glow plane,
  orbit rings).
- `src/sections/kinetic/helvetica.ts` — the Helvetiker outline bundled for
  `TextGeometry`, so the title needs no font request at runtime.
- `src/sections/kinetic/center-text.ts` — the extruded kinetic title.
- `src/lib/render-pipeline.ts` — composes the active pass through a
  `RenderPipeline`, or blends the outgoing and incoming passes with a TSL
  transition chosen per chapter pair. A shared finish adds the vignette and
  animated film grain, and every handoff is prewarmed during the splash.
- `src/components/Landing.tsx` — the fixed chrome: header, progress line,
  numbered HUD, scroll cue, and footer.
- `src/components/SplashScreen.tsx` — boot overlay; it leaves once the canvas
  has painted its first frames.
- `src/lib/audio-engine.ts` — synthesised click and ambient pad (no audio files).
- `src/sections/registry.ts` — the six chapters: metadata, accents, surfaces.

## Styling

Tailwind CSS v4 is available through its browser build: `src/main.tsx` imports
`@tailwindcss/browser`, and `src/tailwind-theme.ts` creates the
`<style type="text/tailwindcss">` block with the theme and utilities. There is
no PostCSS step in the in-browser preview. Preflight is intentionally omitted
so it does not override the starter's own reset and typography.

The primary color is Tiffany Blue (`#0abab5`), exposed as `--ef-primary` in
plain CSS and as `--color-primary` in Tailwind (`bg-primary`, `text-primary`,
`border-primary`).

## Editing

- Change the chapter accents and surface colours in `src/sections/registry.ts`.
- Change a scene's drawing code in its folder under `src/sections/<scene>/`.
- Change the chrome styling in `src/components/landing.css`.
- Use Tailwind utilities for new UI; no build step is required.

Every save hot-reloads the preview through the almostnode dev server.

Imports include explicit `.ts` / `.tsx` extensions because the in-browser Vite
server resolves modules from the virtual file system instead of running the real
bundler resolver. React, Zustand, React Router, Tailwind, and three.js resolve
from esm.sh through the import map in `index.html`.
