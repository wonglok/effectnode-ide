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

/* ── 03 Live Env: wireframe city over a breathing grid ───────────────────── */

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

  const towerMaterial = new THREE.MeshBasicNodeMaterial();
  towerMaterial.colorNode = tslColor(accent);
  towerMaterial.wireframe = true;
  towerMaterial.transparent = true;
  towerMaterial.opacity = 0.15;
  towerMaterial.depthWrite = false;
  towerMaterial.blending = THREE.AdditiveBlending;

  const towers = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1, 1),
    towerMaterial,
    28,
  );
  const dummy = new THREE.Object3D();
  for (let index = 0; index < 28; index += 1) {
    const width = 0.35 + Math.random() * 0.65;
    const height = 0.6 + Math.random() * 3.6;
    const depth = 0.35 + Math.random() * 0.8;
    dummy.position.set(
      (Math.random() - 0.5) * 22,
      floorY + height / 2,
      -8 - Math.random() * 18,
    );
    dummy.scale.set(width, height, depth);
    dummy.updateMatrix();
    towers.setMatrixAt(index, dummy.matrix);
  }
  towers.instanceMatrix.needsUpdate = true;
  towers.frustumCulled = false;
  group.add(towers);

  const monolithMaterial = new THREE.MeshBasicNodeMaterial();
  monolithMaterial.colorNode = tslColor(accent);
  monolithMaterial.wireframe = true;
  monolithMaterial.transparent = true;
  monolithMaterial.opacity = 0.3;
  monolithMaterial.depthWrite = false;
  monolithMaterial.blending = THREE.AdditiveBlending;

  const monoliths: THREE.Mesh[] = [
    [-3.6, 0.1, -5.5],
    [3.9, 0.5, -8],
    [0.5, 0.9, -10.5],
  ].map(([x, y, z], index) => {
    const monolith = new THREE.Mesh(
      new THREE.BoxGeometry(1 + index * 0.2, 2 + index * 0.45, 0.7),
      monolithMaterial,
    );
    monolith.position.set(x, y, z);
    monolith.rotation.y = index * 0.7;
    group.add(monolith);
    return monolith;
  });

  const horizon = glowPlane(accent, 28, 0.28);
  horizon.position.set(0, 3.2, -18);
  group.add(horizon);

  const camera = createChapterCamera(4);

  return {
    group,
    camera,
    update(time, pointer, phase) {
      monoliths.forEach((monolith, index) => {
        monolith.rotation.y = index * 0.7 + time * (0.08 + index * 0.03);
        monolith.rotation.x = Math.sin(time * 0.25 + index) * 0.04;
      });
      group.rotation.y = pointer.x * 0.08 + Math.sin(time * 0.03) * 0.04;
      group.rotation.x = pointer.y * 0.04;

      frameChapterCamera(camera, 4, time, pointer, phase);
    },
  };
}
