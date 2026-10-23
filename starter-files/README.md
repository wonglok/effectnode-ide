# Easy Fancy — starter

A four-chapter, scroll-driven landing page that runs entirely inside the Forge
preview. No video and no image assets: the scenes are real-time three.js
WebGPURenderer worlds shaded with TSL, and the story is steered by a small
Zustand store.

`three` (runtime) and `@types/three` (types) are installed and mapped through
the import map, so `three`, `three/webgpu`, `three/tsl`, and
`three/addons/...` all resolve in the preview. WebGPU is required; if the
browser cannot start it, SceneStage switches to a static CSS stage instead of
falling back to Canvas 2D.

## The experience

- **01 Kinetic** — a field of orbiting particles and a multiline
  “Welcome to my template” title drawn with `TextGeometry` in transmission
  glass.
- **02 Flow Shield** — force lines bending around a silhouette.
- **03 Live Env** — a wireframe skyline, receding grid, and floating monoliths.
- **04 Alpha 6** — glass shards built from gradients and geometry.

Scroll (or drag on touch) to move between chapters. The numbered circles on the
right jump directly to a chapter; the top line shows progress. Each chapter
hands over to the next with a real shader transition — a liquid-glass wipe, a
page curl, or a cross zoom — rather than a plain opacity fade.

## How it works

- `src/store/useScrollerStore.ts` — Zustand store plus the wheel/touch inertia
  engine. It publishes a continuous scroll position; `goTo` eases toward a
  chapter with a critically damped spring.
- `src/lib/scroll-phases.ts` — the chapter timeline: hold, blend, anchors.
- `src/components/SceneStage.tsx` — one WebGPURenderer and four chapter
  worlds (instanced glints plus the glass title, displaced flow lines,
  wireframe city, fresnel shards). Each world has its own scene, camera, and
  render pass; the scroll phase drifts and scales the world as it enters or
  leaves. The title lines use `MeshPhysicalNodeMaterial` transmission,
  dispersion and clearcoat with a prefiltered room environment.
- `src/lib/helvetica.ts` — the Helvetiker outline bundled for `TextGeometry`,
  so the title needs no font request at runtime.
- `src/lib/render-pipeline.ts` — composes the active pass through a
  `RenderPipeline`, or blends the outgoing and incoming passes with a TSL
  transition chosen per chapter pair. A shared finish adds the vignette and
  animated film grain, and every handoff is prewarmed during the splash.
- `src/components/Landing.tsx` — the fixed chrome: header, progress line,
  numbered HUD, scroll cue, and footer.
- `src/components/SplashScreen.tsx` — boot overlay; it leaves once the canvas
  has painted its first frames.
- `src/lib/audio-engine.ts` — synthesised click and ambient pad (no audio files).
- `src/sections/registry.ts` — the four chapters: metadata, accents, surfaces.

## Editing

- Change the chapter accents and surface colours in `src/sections/registry.ts`.
- Change a scene's drawing code in `src/components/SceneStage.tsx`.
- Change the chrome styling in `src/components/landing.css`.

Every save hot-reloads the preview through the almostnode dev server.

Imports include explicit `.ts` / `.tsx` extensions because the in-browser Vite
server resolves modules from the virtual file system instead of running the real
bundler resolver. React, Zustand, and three.js resolve from esm.sh through the
import map in `index.html`.
