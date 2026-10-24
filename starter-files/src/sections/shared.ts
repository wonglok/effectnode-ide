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
   * Every chapter owns the camera it renders with. The compositor only reads
   * it; framing is the chapter's own business.
   */
  camera: THREE.PerspectiveCamera;
  resize?: (aspect: number) => void;
  /** Optional interaction hook; `point` is in world space. */
  onPointerDown?: (point: THREE.Vector3) => void;
  /** Release async resources (loaders, decoded assets) on unmount. */
  dispose?: () => void;
  update: (time: number, pointer: Pointer, phase?: SectionPhaseState) => void;
};

/**
 * Default framing for the exterior chapters: pointer parallax, a slow
 * breathing dolly, and a small lift while the chapter enters or leaves.
 */
export function frameChapterCamera(
  camera: THREE.PerspectiveCamera,
  index: number,
  time: number,
  pointer: Pointer,
  phase?: SectionPhaseState,
) {
  const lift =
    phase?.phase === "enter"
      ? 1 - phase.progress
      : phase?.phase === "exit"
        ? phase.progress
        : 0;
  camera.position.set(
    pointer.x * 0.45,
    -pointer.y * 0.32,
    9.6 + Math.sin(time * 0.24 + index) * 0.12 + lift * 0.9,
  );
  camera.lookAt(0, 0, 0);
}

/** A chapter's own camera, already placed at its resting framing. */
export function createChapterCamera(index: number) {
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 120);
  frameChapterCamera(camera, index, 0, { x: 0, y: 0 });
  return camera;
}

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
