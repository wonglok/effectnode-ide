import * as THREE from "three/webgpu";
import { color as tslColor } from "three/tsl";
import {
  addRing,
  createChapterCamera,
  frameChapterCamera,
  glowPlane,
  type ChapterWorld,
} from "../shared.ts";
import { createCenterText } from "./center-text.ts";

/* ── 01 Kinetic: instanced glints on slow orbits ─────────────────────────── */

export function buildKinetic(accent: string): ChapterWorld {
  const group = new THREE.Group();

  // Glass needs light for its bevels and specular highlights.
  const keyLight = new THREE.DirectionalLight("#e8f4ff", 3.4);
  keyLight.position.set(3, 4, 6);
  group.add(keyLight);
  const rimLight = new THREE.DirectionalLight(accent, 1.8);
  rimLight.position.set(-4, -1.5, 4);
  group.add(rimLight);

  // WebGPU only draws point primitives at 1px, so the glints are instanced
  // planes instead of THREE.Points.
  const count = 620;
  const material = new THREE.MeshBasicNodeMaterial();
  material.colorNode = tslColor(accent);
  material.transparent = true;
  material.opacity = 0.45;
  material.depthWrite = false;
  material.blending = THREE.AdditiveBlending;
  material.side = THREE.DoubleSide;

  const mesh = new THREE.InstancedMesh(
    new THREE.CircleGeometry(0.024, 8),
    material,
    count,
  );
  mesh.frustumCulled = false;
  group.add(mesh);

  // The inner radius keeps a calm pocket in the middle for the chapter copy.
  const particles = Array.from({ length: count }, () => ({
    angle: Math.random() * Math.PI * 2,
    radius: 2.6 + Math.pow(Math.random(), 1.35) * 4.2,
    height: (Math.random() - 0.5) * 4.6,
    speed: 0.08 + Math.random() * 0.22,
    scale: 0.4 + Math.random() * 0.9,
    spin: (Math.random() - 0.5) * 2,
    phase: Math.random() * Math.PI * 2,
  }));

  const rings = [
    addRing(group, 2.5, accent, 0.24),
    addRing(group, 3.9, accent, 0.16),
    addRing(group, 5.3, accent, 0.1),
  ];

  const glow = glowPlane(accent, 10, 0.4);
  glow.position.z = -3.5;
  group.add(glow);

  // The glints orbit outside this calm centre pocket.
  const centerText = createCenterText(accent);
  centerText.mount.position.z = 0.55;
  group.add(centerText.mount);

  const dummy = new THREE.Object3D();
  const camera = createChapterCamera(2);

  return {
    group,
    camera,
    resize(aspect) {
      centerText.fitToView(aspect);
    },
    update(time, pointer, phase) {
      particles.forEach((particle, index) => {
        const angle = particle.angle + time * particle.speed + pointer.x * 0.12;
        dummy.position.set(
          Math.cos(angle) * particle.radius,
          particle.height + Math.sin(time * 0.7 + particle.phase) * 0.28,
          Math.sin(angle) * particle.radius * 0.55,
        );
        dummy.rotation.set(0, 0, time * particle.spin + particle.phase);
        dummy.scale.setScalar(particle.scale);
        dummy.updateMatrix();
        mesh.setMatrixAt(index, dummy.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;

      group.rotation.y = Math.sin(time * 0.06) * 0.08 + pointer.x * 0.07;
      group.rotation.x = pointer.y * 0.05;

      rings.forEach(({ ring }, index) => {
        ring.rotation.z = time * (0.03 + index * 0.01);
      });

      // The title holds during the scene and sinks flat as the chapter leaves.
      const leaving = phase?.phase === "exit" ? phase.progress : 0;
      const arriving = phase?.phase === "enter" ? 1 - phase.progress : 0;
      centerText.mount.position.y =
        Math.sin(time * 0.55) * 0.045 + arriving * 0.35 - leaving * 1.5;
      centerText.mount.position.z = 0.55 - leaving * 0.9;
      centerText.mount.rotation.x = -leaving * 1.1;
      centerText.mount.rotation.y =
        Math.sin(time * 0.18) * 0.025 + pointer.x * 0.04;
      centerText.mount.scale.setScalar(1 + leaving * 0.18);

      frameChapterCamera(camera, 2, time, pointer, phase);
    },
  };
}
