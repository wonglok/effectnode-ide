import * as THREE from "three/webgpu";
import {
  color as tslColor,
  float,
  mix,
  sin,
  time as tslTime,
  vec3,
} from "three/tsl";
import { TextGeometry } from "three/addons/geometries/TextGeometry.js";
import { Font, type FontData } from "three/addons/loaders/FontLoader.js";
import { Helvetica } from "../kinetic/helvetica.ts";
import type { SectionPhaseState } from "../../lib/scroll-phases.ts";
import type { Pointer } from "../shared.ts";

/* ── 05 Live Env: a neon "haha" floating over the wireframe city ─────────── */

const HAHA = "haha";
const TRACKING = 0.09;
const TEXT_Z = 1.1;
const HOME_Y = 1.25;
const CENTER_FOV = 42;
// The exterior chapters park their camera at z = 9.6 (see frameChapterCamera).
const CAMERA_HOME_Z = 9.6;

// Same bundled outline as the chapter 3 title, so nothing is fetched.
const FONT = new Font(Helvetica as unknown as FontData);

/** How much of the viewport the word may span at its own depth. */
function visibleWidth(aspect: number) {
  const distance = CAMERA_HOME_Z - TEXT_Z;
  const visibleHeight = 2 * Math.tan((CENTER_FOV * Math.PI) / 360) * distance;
  return visibleHeight * aspect;
}

/**
 * Four extruded glyphs with a per-letter bounce. The material is an emissive
 * additive `MeshBasicNodeMaterial` because this chapter owns no lights: the
 * city itself is unlit glow, so the word reads as another light source.
 */
export function createHahaText(accent: string) {
  const mount = new THREE.Group();
  mount.position.set(0, HOME_Y, TEXT_Z);

  const fit = new THREE.Group();
  mount.add(fit);

  const material = new THREE.MeshBasicNodeMaterial();
  material.colorNode = mix(tslColor(accent), vec3(1, 1, 1), float(0.24));
  // A slow flicker keeps the letters alive without stealing the scene.
  material.opacityNode = float(0.74).add(sin(tslTime.mul(1.15)).mul(0.1));
  material.transparent = true;
  material.depthWrite = false;
  material.blending = THREE.AdditiveBlending;
  material.side = THREE.FrontSide;

  const geometries: THREE.BufferGeometry[] = [];
  const widths: number[] = [];

  for (const glyph of HAHA) {
    const geometry = new TextGeometry(glyph, {
      font: FONT,
      size: 1,
      depth: 0.14,
      curveSegments: 12,
      bevelEnabled: true,
      bevelThickness: 0.03,
      bevelSize: 0.022,
      bevelSegments: 3,
    });
    geometry.computeBoundingBox();
    const box = geometry.boundingBox!;
    // Centre each glyph on its own axis so the bounce reads per letter.
    geometry.translate(-(box.min.x + box.max.x) / 2, 0, -0.07);
    geometry.computeBoundingBox();
    widths.push(geometry.boundingBox!.max.x - geometry.boundingBox!.min.x);
    geometries.push(geometry);
  }

  const totalWidth =
    widths.reduce((sum, width) => sum + width, 0) +
    TRACKING * (widths.length - 1);

  // Centre the word vertically rather than sitting it on the baseline.
  const bounds = new THREE.Box3();
  for (const geometry of geometries) bounds.union(geometry.boundingBox!);
  const centerY = (bounds.min.y + bounds.max.y) / 2;
  for (const geometry of geometries) geometry.translate(0, -centerY, 0);

  const letters: THREE.Mesh[] = [];
  const homes: number[] = [];
  let cursor = -totalWidth / 2;

  geometries.forEach((geometry, index) => {
    const mesh = new THREE.Mesh(geometry, material);
    const homeX = cursor + widths[index] / 2;
    mesh.position.set(homeX, 0, 0);
    fit.add(mesh);
    letters.push(mesh);
    homes.push(homeX);
    cursor += widths[index] + TRACKING;
  });

  const fitToView = (aspect: number) => {
    const target = THREE.MathUtils.clamp(
      visibleWidth(aspect) * 0.55,
      2.1,
      4.2,
    );
    fit.scale.setScalar(target / totalWidth);
  };
  fitToView(1.6);

  const update = (time: number, pointer: Pointer, phase?: SectionPhaseState) => {
    const leaving = phase?.phase === "exit" ? phase.progress : 0;
    const arriving = phase?.phase === "enter" ? 1 - phase.progress : 0;

    letters.forEach((letter, index) => {
      // Staggered phase per glyph gives the word its giggling rhythm.
      const offset = index * 0.62;
      const lift = Math.sin(time * 1.9 + offset) * 0.085;
      const scatter = (index - (letters.length - 1) / 2) * 0.28;

      letter.position.x =
        homes[index] +
        Math.sin(time * 1.15 + offset) * 0.03 +
        scatter * leaving;
      letter.position.y = lift + arriving * 0.42 - leaving * 1.05;
      letter.position.z = -leaving * 0.5;

      letter.rotation.z = Math.sin(time * 1.35 + offset) * 0.06;
      letter.rotation.x =
        Math.sin(time * 0.85 + offset) * 0.16 + pointer.y * 0.05;
      letter.rotation.y = pointer.x * 0.08 + Math.sin(time * 0.6 + offset) * 0.05;
    });

    mount.position.y = HOME_Y + Math.sin(time * 0.6) * 0.05 - leaving * 0.35;
    mount.rotation.z = Math.sin(time * 1.1) * 0.014 + pointer.x * 0.02;
  };

  return { mount, fitToView, update };
}
