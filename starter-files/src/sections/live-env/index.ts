import * as THREE from "three/webgpu";
import {
  color as tslColor,
  positionLocal,
  sin,
  time as tslTime,
  vec3,
} from "three/tsl";
import {
  createChapterCamera,
  frameChapterCamera,
  glowPlane,
  type ChapterWorld,
} from "../shared.ts";
import { createHahaText } from "./haha-text.ts";
import { createOnePerScene } from "./one-per-scene.ts";

/* ── 05 Live Env: open grid horizon with the city's display ──────────────── */

export function buildLiveEnv(accent: string): ChapterWorld {
  const group = new THREE.Group();
  const floorY = -2.6;

  const positions: number[] = [];
  const half = 14;
  for (let step = -half; step <= half; step += 2) {
    positions.push(step, floorY, -half, step, floorY, half);
    positions.push(-half, floorY, step, half, floorY, step);
  }

  const gridGeometry = new THREE.BufferGeometry();
  gridGeometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );

  const gridMaterial = new THREE.LineBasicNodeMaterial();
  gridMaterial.colorNode = tslColor(accent);
  gridMaterial.transparent = true;
  gridMaterial.opacity = 0.18;
  gridMaterial.depthWrite = false;
  gridMaterial.blending = THREE.AdditiveBlending;
  gridMaterial.positionNode = positionLocal.add(
    vec3(0, sin(positionLocal.z.mul(0.7).add(tslTime.mul(0.5))).mul(0.045), 0),
  );

  const grid = new THREE.LineSegments(gridGeometry, gridMaterial);
  group.add(grid);

  const horizon = glowPlane(accent, 28, 0.28);
  horizon.position.set(0, 3.2, -18);
  group.add(horizon);

  // A neon "haha" hangs over the horizon, bobbing letter by letter.
  const haha = createHahaText(accent);
  group.add(haha.mount);

  // The city's display: one-per-scene.png, framed and hung under the word.
  const display = createOnePerScene(accent);
  group.add(display.mount);

  const camera = createChapterCamera(4);

  return {
    group,
    camera,
    resize(aspect) {
      haha.fitToView(aspect);
      display.fitToView(aspect);
    },
    update(time, pointer, phase) {
      haha.update(time, pointer, phase);
      display.update(time, pointer, phase);
      group.rotation.y = pointer.x * 0.08 + Math.sin(time * 0.03) * 0.04;
      group.rotation.x = pointer.y * 0.04;

      frameChapterCamera(camera, 4, time, pointer, phase);
    },
    // Release the decoded PNG with the chapter (SceneStage calls this).
    dispose() {
      display.dispose();
    },
  };
}
