import * as THREE from "three/webgpu";
import {
  abs,
  color as tslColor,
  dot,
  float,
  mix,
  normalView,
  oneMinus,
  positionViewDirection,
  pow,
} from "three/tsl";
import {
  addRing,
  createChapterCamera,
  frameChapterCamera,
  glowPlane,
  type ChapterWorld,
} from "../shared.ts";
import { createYoText } from "./yo-text.ts";

/* ── 04 Alpha 6: glass shards lit by a fresnel rim ───────────────────────── */

export function buildAlpha(accent: string): ChapterWorld {
  const group = new THREE.Group();

  const glassMaterial = new THREE.MeshBasicNodeMaterial();
  const facing = abs(dot(normalView, positionViewDirection));
  const rim = pow(oneMinus(facing), float(2));
  glassMaterial.colorNode = mix(
    tslColor(accent).mul(0.35),
    tslColor("#ffffff"),
    rim.mul(0.85),
  );
  glassMaterial.transparent = true;
  glassMaterial.opacity = 0.24;
  glassMaterial.depthWrite = false;
  glassMaterial.blending = THREE.AdditiveBlending;
  glassMaterial.side = THREE.DoubleSide;

  const edgeMaterial = new THREE.MeshBasicNodeMaterial();
  edgeMaterial.colorNode = tslColor(accent);
  edgeMaterial.wireframe = true;
  edgeMaterial.transparent = true;
  edgeMaterial.opacity = 0.28;
  edgeMaterial.depthWrite = false;
  edgeMaterial.blending = THREE.AdditiveBlending;

  const shards: Array<{ mesh: THREE.Mesh; spin: THREE.Vector3 }> = [];

  for (let index = 0; index < 13; index += 1) {
    const geometry =
      index % 2 === 0
        ? new THREE.TetrahedronGeometry(1, 0)
        : new THREE.OctahedronGeometry(1, 0);

    const mesh = new THREE.Mesh(
      geometry,
      index % 3 === 0 ? edgeMaterial : glassMaterial,
    );

    // Ring the type instead of crossing it.
    const theta = (index / 13) * Math.PI * 2 + Math.random() * 0.35;
    const radius = 3 + Math.random() * 2.2;

    mesh.position.set(
      Math.cos(theta) * radius,
      Math.sin(theta) * radius * 0.62,
      -1.5 - Math.random() * 4,
    );
    mesh.scale.set(
      0.32 + Math.random() * 0.62,
      0.26 + Math.random() * 0.7,
      0.32 + Math.random() * 0.55,
    );
    mesh.rotation.set(
      Math.random() * Math.PI,
      Math.random() * Math.PI,
      Math.random() * Math.PI,
    );

    group.add(mesh);
    shards.push({
      mesh,
      spin: new THREE.Vector3(
        (Math.random() - 0.5) * 0.3,
        (Math.random() - 0.5) * 0.36,
        (Math.random() - 0.5) * 0.22,
      ),
    });
  }

  const rings = [
    addRing(group, 3.1, accent, 0.22, [1.2, 0.3, 0]),
    addRing(group, 4.2, accent, 0.12, [0.4, 1.1, 0.5]),
  ];

  const glow = glowPlane(accent, 9, 0.3);
  glow.position.z = -3;
  group.add(glow);

  // The shards ring this glass "Yo" instead of crossing it.
  const yo = createYoText(accent);
  group.add(yo.mount);

  const camera = createChapterCamera(5);

  return {
    group,
    camera,
    resize(aspect) {
      yo.fitToView(aspect);
    },
    update(time, pointer, phase) {
      group.rotation.y = time * 0.045 + pointer.x * 0.16;
      group.rotation.x = pointer.y * 0.08;
      yo.update(time, pointer, phase, group.rotation.y);
      shards.forEach(({ mesh, spin }, index) => {
        mesh.rotation.x += spin.x * 0.004;
        mesh.rotation.y += spin.y * 0.004;
        mesh.rotation.z += spin.z * 0.004;
        mesh.position.y += Math.sin(time * 0.5 + index) * 0.0008;
      });
      rings.forEach(({ ring }, index) => {
        ring.rotation.z += 0.0008 + index * 0.0004;
      });

      frameChapterCamera(camera, 5, time, pointer, phase);
    },
  };
}
