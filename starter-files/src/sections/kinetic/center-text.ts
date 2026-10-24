import * as THREE from "three/webgpu";
import { TextGeometry } from "three/addons/geometries/TextGeometry.js";
import { Font, type FontData } from "three/addons/loaders/FontLoader.js";
import { Helvetica } from "./helvetica.ts";

/* ── Centre title: extruded type, fitted to the viewport ─────────────────── */

const CENTER_TEXT = "Welcome to\nmy template";
const LINE_STEP = 1.18;
const CENTER_FONT = new Font(Helvetica as unknown as FontData);
const HOME_Z = 9.6;
const CENTER_FOV = 42;

function textWidthFor(aspect: number) {
  const visibleHeight = 2 * Math.tan((CENTER_FOV * Math.PI) / 360) * HOME_Z;
  return Math.min(visibleHeight * aspect, visibleHeight) * 0.68;
}

/**
 * Builds the first chapter's centrepiece with TextGeometry. The Helvetiker
 * outline ships with the starter (helvetica.ts), so no font is fetched.
 */
export function createCenterText(accent: string) {
  // Glass parameters follow the honey-text chapter: thin, clear, dispersive,
  // with a clearcoat and an environment for the bevel highlights.
  const material = new THREE.MeshPhysicalNodeMaterial({
    color: new THREE.Color(accent).lerp(new THREE.Color("#ffffff"), 0.62),
    roughness: 0.055,
    metalness: 0,
    ior: 1.46,
    transmission: 1,
    thickness: 0.85,
    dispersion: 3,
    clearcoat: 0.6,
    clearcoatRoughness: 0.05,
    attenuationColor: new THREE.Color(accent),
    attenuationDistance: 0.6,
    emissive: new THREE.Color(accent),
    emissiveIntensity: 0.06,
    envMapIntensity: 1.2,
    side: THREE.FrontSide,
  });

  const mount = new THREE.Group();
  const fit = new THREE.Group();
  mount.add(fit);

  const geometries: THREE.BufferGeometry[] = [];
  const bounds = new THREE.Box3();

  CENTER_TEXT.split("\n").forEach((line, index) => {
    const geometry = new TextGeometry(line, {
      font: CENTER_FONT,
      size: 1,
      depth: 0.12,
      curveSegments: 14,
      bevelEnabled: true,
      bevelThickness: 0.06,
      bevelSize: 0.0245,
      bevelSegments: 5,
    });
    geometry.computeBoundingBox();
    const box = geometry.boundingBox!;
    // Center each line on the block's axis, then stack by line height.
    geometry.translate(-(box.min.x + box.max.x) / 2, -index * LINE_STEP, -0.06);
    geometry.computeBoundingBox();
    bounds.union(geometry.boundingBox!);
    geometries.push(geometry);
    fit.add(new THREE.Mesh(geometry, material));
  });

  // Center the whole block vertically, not just each line's baseline.
  const centerY = (bounds.min.y + bounds.max.y) / 2;
  for (const geometry of geometries) {
    geometry.translate(0, -centerY, 0);
  }
  const naturalWidth = bounds.max.x - bounds.min.x;

  const fitToView = (aspect: number) => {
    fit.scale.setScalar(textWidthFor(aspect) / naturalWidth);
  };
  fitToView(1.6);

  return { mount, fitToView };
}
