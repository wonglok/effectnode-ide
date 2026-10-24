import * as THREE from "three/webgpu";
import {
  abs,
  color as tslColor,
  float,
  oneMinus,
  positionLocal,
  sin,
  smoothstep,
  time as tslTime,
  vec3,
} from "three/tsl";
import { glowPlane, type ChapterWorld } from "../shared.ts";

/* ── 02 Flow Shield: displaced lines wrapping an outline ─────────────────── */

export function buildFlow(accent: string): ChapterWorld {
  const group = new THREE.Group();

  const rows = 32;
  const segments = 100;
  const halfWidth = 9;
  const halfHeight = 5.4;
  const positions: number[] = [];

  for (let row = 0; row <= rows; row += 1) {
    const y = -halfHeight + (row / rows) * halfHeight * 2;
    for (let segment = 0; segment < segments; segment += 1) {
      const x0 = -halfWidth + (segment / segments) * halfWidth * 2;
      const x1 = -halfWidth + ((segment + 1) / segments) * halfWidth * 2;
      positions.push(x0, y, 0, x1, y, 0);
    }
  }

  const flowGeometry = new THREE.BufferGeometry();
  flowGeometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );

  const flowMaterial = new THREE.LineBasicNodeMaterial();
  flowMaterial.colorNode = tslColor(accent);
  flowMaterial.transparent = true;
  flowMaterial.opacity = 0.16;
  flowMaterial.depthWrite = false;
  flowMaterial.blending = THREE.AdditiveBlending;

  const wave = sin(positionLocal.x.mul(0.5).add(tslTime.mul(0.5)))
    .mul(0.3)
    .add(sin(positionLocal.y.mul(0.8).sub(tslTime.mul(0.32))).mul(0.18));
  const envelope = oneMinus(
    smoothstep(float(0), float(halfWidth), abs(positionLocal.x)),
  );
  flowMaterial.positionNode = positionLocal.add(vec3(0, 0, wave.mul(envelope)));

  const flowLines = new THREE.LineSegments(flowGeometry, flowMaterial);
  group.add(flowLines);

  const shieldPoints = [
    new THREE.Vector3(0, 2.55, 0),
    new THREE.Vector3(1.5, 1.7, 0),
    new THREE.Vector3(1.25, -0.95, 0),
    new THREE.Vector3(0, -2.65, 0),
    new THREE.Vector3(-1.25, -0.95, 0),
    new THREE.Vector3(-1.5, 1.7, 0),
  ];
  const shieldCurve = new THREE.CatmullRomCurve3(
    shieldPoints,
    true,
    "centripetal",
  );
  const shieldGeometry = new THREE.TubeGeometry(
    shieldCurve,
    200,
    0.018,
    6,
    true,
  );

  const shieldMaterial = new THREE.MeshBasicNodeMaterial();
  shieldMaterial.colorNode = tslColor(accent);
  shieldMaterial.transparent = true;
  shieldMaterial.opacity = 0.85;
  shieldMaterial.depthWrite = false;
  shieldMaterial.blending = THREE.AdditiveBlending;

  const shield = new THREE.Mesh(shieldGeometry, shieldMaterial);
  shield.position.z = 0.25;
  group.add(shield);

  const ghostMaterial = new THREE.MeshBasicNodeMaterial();
  ghostMaterial.colorNode = tslColor(accent);
  ghostMaterial.transparent = true;
  ghostMaterial.opacity = 0.22;
  ghostMaterial.depthWrite = false;
  ghostMaterial.blending = THREE.AdditiveBlending;

  const ghost = new THREE.Mesh(shieldGeometry, ghostMaterial);
  ghost.position.z = 0.25;
  ghost.scale.setScalar(1.14);
  group.add(ghost);

  const glow = glowPlane(accent, 9, 0.26);
  glow.position.z = -2.5;
  group.add(glow);

  return {
    group,
    update(time, pointer) {
      const breathe = 1 + Math.sin(time * 0.8) * 0.018;
      shield.scale.setScalar(breathe);
      ghost.scale.setScalar(1.14 + Math.sin(time * 0.6 + 1) * 0.03);
      shield.rotation.z = Math.sin(time * 0.18) * 0.04;
      ghost.rotation.z = -Math.sin(time * 0.14) * 0.06;
      group.rotation.y = pointer.x * 0.12;
      group.rotation.x = pointer.y * 0.06;
      group.position.z = Math.sin(time * 0.3) * 0.08;
    },
  };
}
