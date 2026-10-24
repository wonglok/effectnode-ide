# AGENTS.md

Guidance for AI agents working on this starter project. Forge's agent workbench
and external coding agents should follow these rules when changing the project.

## React

- Use Zustand for shared React state. Local UI state may stay in `useState`.
  Do not introduce another state library.
- Keep the hash-based navigation intact: `StoryRouter.tsx` connects
  `HashRouter` (`#/scene-01` through `#/scene-06`) to the scroll store. Do not
  add a second router or bypass the store when changing chapters.
- Preserve the chapter order and IDs in `src/sections/registry.ts`. Scroll
  anchors, HUD labels, transitions, and routes all depend on them.
- Prefer Tailwind utilities for new UI. The primary color is Tiffany Blue
  (`#0abab5`), available as `--ef-primary` in CSS and `bg-primary` /
  `text-primary` in Tailwind.

## Planning

- Before changing the project, produce a short Gantt chart that separates the
  critical path (run sequentially) from non-critical work (run in parallel).
- Update the plan if the critical path changes while you work.
- When all work is done, the host workbench plays a completion sound three
  times. Do not add project audio code just to satisfy this rule.

## three.js

- This project renders with `WebGPURenderer` and TSL, not `WebGLRenderer` or
  GLSL. Translate supplied GLSL, WebGL, or `THREE.WebGLRenderer` code to
  `three/webgpu` and `three/tsl` before adding it.
- The chapter 3 title uses per-line `TextGeometry` with
  `MeshPhysicalNodeMaterial` transmission. Keep that path WebGPU-compatible.
- Each chapter owns its scene, camera, and render pass. Scene drawing code lives
  in `src/sections/<scene>/index.ts`; `RenderPipeline` composes the scenes and
  applies the shared finish and transitions.
- Dispose of geometries, materials, render targets, and PMREM resources when
  removing a scene or effect.

## Runtime constraints

- Imports must include explicit file extensions because the in-browser Vite
  server cannot resolve extensionless imports: `./App.tsx`, `../lib/foo.ts`,
  `./styles.css`.
- React, React DOM, React Router, Zustand, Tailwind (`@tailwindcss/browser`),
  and three resolve from the import map in `index.html`. Do not add npm
  dependencies or import packages that are not mapped; the browser preview has
  no install step.
- Tailwind's theme and utilities are created by `src/tailwind-theme.ts` in a
  `<style type="text/tailwindcss">` block. Preflight is omitted on purpose; do
  not add it without checking the existing design.
- Keep `index.html` as the entry point. Do not replace its module script or add
  external scripts.
- Match the existing visual language and keep changes focused.

## Layout

- `src/components/SceneStage.tsx` — renderer and chapter orchestration.
- `src/sections/soft-room/` — chapter 1 sunlit room with soft window shadows.
- `src/sections/force-shield/` — chapter 2 TSL force-field scene.
- `src/sections/kinetic/` — chapter 3 scene, glass title, and bundled font.
- `src/sections/apartment/` — chapter 4 HDR-lit apartment GLB scene.
- `src/sections/live-env/` — chapter 5 scene.
- `src/sections/alpha6/` — chapter 6 scene.
- `src/sections/shared.ts` — shared chapter types and TSL scene helpers.
- `src/lib/render-pipeline.ts` — pass composition and shader transitions.
- `src/store/useScrollerStore.ts` — Zustand scroll engine and chapter state.
- `src/components/StoryRouter.tsx` — hash route and active-chapter bridge.
- `src/sections/registry.ts` — chapter metadata; order matters.
- `src/lib/scroll-phases.ts` — anchors, holds, and blend timing.
- `src/components/Landing.tsx` — fixed chrome and scroll input.
- `src/tailwind-theme.ts` — Tailwind v4 browser theme and primary token.

## Verification

- Typecheck with `npx tsc --noEmit -p starter-files/tsconfig.json` from the
  repository root, or run `npm run build` inside this folder when dependencies
  are installed.
- Check the result in the Forge preview: a live WebGPU canvas and a clean
  console are the acceptance criteria.
- Write scratch files under `.claude/temp`, never in the project tree.

# Three.js Content

if user provided any glsl code or webgl code or webgl 2.0 code or threeJS WebGLRenderer code please translate to ThreeJS WebGPURenderer Code with TSL (threejs shader language) for the current project's threejs to use.
