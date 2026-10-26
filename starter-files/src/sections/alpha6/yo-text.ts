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
import { TextGeometry } from "three/addons/geometries/TextGeometry.js";
import { Font, type FontData } from "three/addons/loaders/FontLoader.js";
import { Helvetica } from "../kinetic/helvetica.ts";
import type { SectionPhaseState } from "../../lib/scroll-phases.ts";
import type { Pointer } from "../shared.ts";

/* ── 06 Alpha 6: the word "Yo", cut from the same glass as the shards ────── */

const WORD = "Yo";
const TRACKING = 0.07;
const TEXT_Z = 0.6;
const HOME_Y = 0.05;
const CENTER_FOV = 42;
// The exterior chapters park their camera at z = 9.6 (see frameChapterCamera).
const CAMERA_HOME_Z = 9.6;

// Same bundled outline as chapters 1, 3 and 5, so nothing is fetched.
const FONT = new Font(Helvetica as unknown as FontData);

/** How much of the viewport the word may span at its own depth. */
function visibleWidth(aspect: number) {
  const distance = CAMERA_HOME_Z - TEXT_Z;
  const visibleHeight = 2 * Math.tan((CENTER_FOV * Math.PI) / 360) * distance;
  return visibleHeight * aspect;
}

/**
 * Two extruded glyphs with a fresnel rim: the fill picks up the white edge
 * highlight exactly like the glass shards, and an EdgesGeometry outline keeps
 * the silhouette crisp. No lights — this chapter is unlit glow by design.
 */
export function createYoText(accent: string) {
  const mount = new THREE.Group();
  mount.position.set(0, HOME_Y, TEXT_Z);

  const fit = new THREE.Group();
  mount.add(fit);

  const facing = abs(dot(normalView, positionViewDirection));
  const rim = pow(oneMinus(facing), float(1.7));

  const glassMaterial = new THREE.MeshBasicNodeMaterial();
  glassMaterial.colorNode = mix(
    tslColor(accent).mul(0.4),
    tslColor("#ffffff"),
    rim.mul(0.9),
  );
  glassMaterial.transparent = true;
  glassMaterial.opacity = 0.42;
  glassMaterial.depthWrite = false;
  glassMaterial.blending = THREE.AdditiveBlending;
  glassMaterial.side = THREE.DoubleSide;

  // A LineBasicNodeMaterial keeps the silhouette crisp; a wireframe pass over
  // the extrude would also draw the cap triangulation.
  const edgeMaterial = new THREE.LineBasicNodeMaterial();
  edgeMaterial.colorNode = tslColor(accent).mul(1.05);
  edgeMaterial.transparent = true;
  edgeMaterial.opacity = 0.5;
  edgeMaterial.depthWrite = false;
  edgeMaterial.blending = THREE.AdditiveBlending;

  const geometries: THREE.BufferGeometry[] = [];
  const widths: number[] = [];

  for (const glyph of WORD) {
    const geometry = new TextGeometry(glyph, {
      font: FONT,
      size: 1,
      depth: 0.22,
      curveSegments: 16,
      bevelEnabled: true,
      bevelThickness: 0.05,
      bevelSize: 0.028,
      bevelSegments: 4,
    });
    geometry.computeBoundingBox();
    const box = geometry.boundingBox!;
    // Centre each glyph on its own axis so it can rock independently.
    geometry.translate(-(box.min.x + box.max.x) / 2, 0, -0.11);
    geometry.computeBoundingBox();
    widths.push(geometry.boundingBox!.max.x - geometry.boundingBox!.min.x);
    geometries.push(geometry);
  }

  const totalWidth =
    widths.reduce((sum, width) => sum + width, 0) +
    TRACKING * (widths.length - 1);

  // Centre the word as a block: "Yo" shares one baseline, so the cap of the Y
  // and the bowl of the o line up the way they would in real type.
  const bounds = new THREE.Box3();
  for (const geometry of geometries) bounds.union(geometry.boundingBox!);
  const centerY = (bounds.min.y + bounds.max.y) / 2;
  for (const geometry of geometries) geometry.translate(0, -centerY, 0);

  const letters: THREE.Group[] = [];
  const homes: number[] = [];
  let cursor = -totalWidth / 2;

  geometries.forEach((geometry, index) => {
    const glyph = new THREE.Group();
    const homeX = cursor + widths[index] / 2;
    glyph.position.set(homeX, 0, 0);

    // Glass fill plus a crisp outline of the very same silhouette.
    glyph.add(new THREE.Mesh(geometry, glassMaterial));
    glyph.add(
      new THREE.LineSegments(
        new THREE.EdgesGeometry(geometry, 28),
        edgeMaterial,
      ),
    );

    fit.add(glyph);
    letters.push(glyph);
    homes.push(homeX);
    cursor += widths[index] + TRACKING;
  });

  const fitToView = (aspect: number) => {
    // Stay inside the shard ring (radius 3) with a little air.
    const target = THREE.MathUtils.clamp(visibleWidth(aspect) * 0.42, 2, 3.6);
    fit.scale.setScalar(target / totalWidth);
  };
  fitToView(1.6);

  const update = (
    time: number,
    pointer: Pointer,
    phase?: SectionPhaseState,
    /** The chapter spins its group forever; pass that yaw so the word can
     *  cancel it and stay legible while the shards keep orbiting. */
    yaw = 0,
  ) => {
    const leaving = phase?.phase === "exit" ? phase.progress : 0;
    const arriving = phase?.phase === "enter" ? 1 - phase.progress : 0;

    letters.forEach((letter, index) => {
      const offset = index * 1.15;
      const scatter = (index - (letters.length - 1) / 2) * 0.55;

      letter.position.x = homes[index] + scatter * leaving;
      letter.position.y =
        Math.sin(time * 0.85 + offset) * 0.045 +
        arriving * 0.32 -
        leaving * 0.8;
      letter.position.z = Math.sin(time * 0.6 + offset) * 0.06 - leaving * 0.6;

      letter.rotation.y =
        Math.sin(time * 0.5 + offset) * 0.12 + pointer.x * 0.06 - leaving * 0.9;
      letter.rotation.x =
        Math.sin(time * 0.7 + offset) * 0.05 + pointer.y * 0.04;
      letter.rotation.z = Math.sin(time * 0.45 + offset) * 0.02;
    });

    mount.position.y = HOME_Y + Math.sin(time * 0.5) * 0.04 - leaving * 0.3;
    mount.rotation.y =
      -yaw + Math.sin(time * 0.32) * 0.1 + pointer.x * 0.08 + leaving * 0.9;
    mount.rotation.z = Math.sin(time * 0.9) * 0.012;
  };

  return { mount, fitToView, update };
}
