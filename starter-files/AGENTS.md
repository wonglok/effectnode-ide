# AGENTS.md

Guidance for AI agents working on this starter project. Forge's agent workbench
and external coding agents should follow these rules when changing the project.

## React

- Use Zustand for shared React state. Local UI state may stay in `useState`.
  Do not introduce another state library.
- Keep the hash-based navigation intact: `StoryRouter.tsx` connects
  `HashRouter` (`#/scene-01` through `#/scene-04`) to the scroll store. Do not
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
- The chapter 1 title uses per-line `TextGeometry` with
  `MeshPhysicalNodeMaterial` transmission. Keep that path WebGPU-compatible.
- Each chapter owns its scene, camera, and render pass. `RenderPipeline`
  composes them and applies the shared finish and transitions.
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

- `src/components/SceneStage.tsx` — renderer, chapter worlds, glass title.
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
