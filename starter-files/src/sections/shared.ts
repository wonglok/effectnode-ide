import * as THREE from "three/webgpu";
import {
  color as tslColor,
  float,
  oneMinus,
  smoothstep,
  uv,
  vec2,
} from "three/tsl";
import type { SectionPhaseState } from "../lib/scroll-phases.ts";

export type Pointer = { x: number; y: number };

export type ChapterWorld = {
  group: THREE.Group;
  /**
   * Camera distance for scenes scaled differently from the default 9.6. A
   * function lets a scene fit its geometry to the current aspect ratio.
   */
  cameraDistance?: number | ((aspect: number) => number);
  resize?: (aspect: number) => void;
  /** Optional interaction hook; `point` is in world space. */
  onPointerDown?: (point: THREE.Vector3) => void;
  /** Release async resources (loaders, decoded assets) on unmount. */
  dispose?: () => void;
  update: (time: number, pointer: Pointer, phase?: SectionPhaseState) => void;
};

export function glowPlane(accent: string, size: number, opacity: number) {
  const material = new THREE.MeshBasicNodeMaterial();
  const distance = uv().sub(vec2(0.5, 0.5)).length();
  const glow = oneMinus(smoothstep(float(0), float(0.52), distance));

  material.colorNode = tslColor(accent).mul(glow).mul(0.32);
  material.transparent = true;
  material.opacity = opacity;
  material.depthWrite = false;
  material.blending = THREE.AdditiveBlending;
  material.side = THREE.DoubleSide;

  return new THREE.Mesh(new THREE.PlaneGeometry(size, size), material);
}

export function addRing(
  group: THREE.Group,
  radius: number,
  accent: string,
  opacity: number,
  rotation: [number, number, number] = [0, 0, 0],
) {
  const material = new THREE.MeshBasicNodeMaterial();
  material.colorNode = tslColor(accent);
  material.transparent = true;
  material.opacity = opacity;
  material.depthWrite = false;
  material.blending = THREE.AdditiveBlending;

  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(radius, 0.006, 6, 240),
    material,
  );
  ring.rotation.set(...rotation);
  group.add(ring);
  return { ring, material };
}
