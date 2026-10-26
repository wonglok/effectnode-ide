import * as THREE from "three/webgpu";
import { color as tslColor, texture as tslTexture } from "three/tsl";
import type { SectionPhaseState } from "../../lib/scroll-phases.ts";
import type { Pointer } from "../shared.ts";

/* ── 05 Live Env: the city's big screen, running one-per-scene.png ───────── */

/**
 * The public file is tried relatively first, so it resolves under the virtual
 * preview's URL prefix, then absolutely for a plain root-served build.
 */
const SOURCES = [
  "attachments/one-per-scene.png",
  "/attachments/one-per-scene.png",
];

// Hung under the neon "haha" (y 0.7 → 1.8 at z 1.1), so the panel tops out
// below it in screen space even though it sits further back.
const HOME = new THREE.Vector3(0, -0.62, -3.4);
const MAX_WIDTH = 4.8;
const MAX_HEIGHT = 2.6;
const CENTER_FOV = 42;
// The exterior chapters park their camera at z = 9.6 (see frameChapterCamera).
const CAMERA_HOME_Z = 9.6;

/** How wide the viewport is at the screen's own depth. */
function visibleWidth(aspect: number) {
  const distance = CAMERA_HOME_Z - HOME.z;
  const visibleHeight = 2 * Math.tan((CENTER_FOV * Math.PI) / 360) * distance;
  return visibleHeight * aspect;
}

async function loadTexture() {
  const loader = new THREE.TextureLoader();

  for (const source of SOURCES) {
    try {
      const texture = await loader.loadAsync(source);
      // The photo owns its own values in this unlit chapter.
      texture.colorSpace = THREE.SRGBColorSpace;
      // Straight sampling: no mip chain to wait on for a non-power-of-two PNG.
      texture.generateMipmaps = false;
      texture.minFilter = THREE.LinearFilter;
      texture.magFilter = THREE.LinearFilter;
      return texture;
    } catch {
      // Fall through to the next candidate.
    }
  }

  return null;
}

/**
 * A single framed panel hanging under the neon "haha", carrying the photo at
 * full fidelity (an unlit `texture()` node, untinted) so it reads as a real
 * display inside the wireframe city. The accent frame and halo are the only
 * glow, which keeps the chapter's material language intact.
 *
 * The panel mesh is built once the PNG has decoded: the node graph is then
 * compiled a single time, so nothing mutates a live material mid-flight.
 */
export function createOnePerScene(accent: string) {
  const mount = new THREE.Group();
  mount.position.copy(HOME);

  // Everything inside `rect` shares one scale, so the frame always hugs the
  // screen whatever aspect the image turns out to be.
  const rect = new THREE.Group();
  mount.add(rect);

  // Standby frame: the screen's outline is already part of the city while the
  // photo is still in flight.
  const frameMaterial = new THREE.LineBasicNodeMaterial();
  frameMaterial.colorNode = tslColor(accent);
  frameMaterial.transparent = true;
  frameMaterial.opacity = 0.6;
  frameMaterial.depthWrite = false;
  frameMaterial.blending = THREE.AdditiveBlending;

  const outline = new THREE.PlaneGeometry(1, 1);
  const frame = new THREE.LineSegments(
    new THREE.EdgesGeometry(outline, 28),
    frameMaterial,
  );
  outline.dispose();
  // Nudge the outline toward the camera so it never z-fights the panel it hugs.
  frame.position.z = 0.012;
  rect.add(frame);

  // Halo sits behind the panel; the glow plane is sized to bleed past it.
  const glowMaterial = new THREE.MeshBasicNodeMaterial();
  glowMaterial.colorNode = tslColor(accent);
  glowMaterial.transparent = true;
  glowMaterial.opacity = 0.3;
  glowMaterial.depthWrite = false;
  glowMaterial.blending = THREE.AdditiveBlending;
  glowMaterial.side = THREE.DoubleSide;

  const glow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), glowMaterial);
  glow.position.z = -0.15;
  mount.add(glow);

  let screenMaterial: THREE.MeshBasicNodeMaterial | null = null;
  let natural = { width: 16, height: 9 };
  let viewportAspect = 1.6;

  const fitToView = (aspect: number) => {
    viewportAspect = aspect;
    // Stay under the "haha" and inside the city's framing.
    const maxWidth = THREE.MathUtils.clamp(
      visibleWidth(aspect) * 0.44,
      2.2,
      MAX_WIDTH,
    );
    const scale = Math.min(
      maxWidth / natural.width,
      MAX_HEIGHT / natural.height,
    );
    const width = natural.width * scale;
    const height = natural.height * scale;

    rect.scale.set(width, height, 1);
    glow.scale.set(width * 1.7, height * 1.7, 1);
  };
  fitToView(viewportAspect);

  let texture: THREE.Texture | null = null;

  void loadTexture()
    .then((loaded) => {
      if (!loaded) {
        console.warn("one-per-scene.png unavailable; the screen stays dark.");
        return;
      }

      texture = loaded;
      const image = loaded.image as
        | { width?: number; height?: number }
        | undefined;
      if (image?.width && image?.height) {
        natural = { width: image.width, height: image.height };
      }

      const material = new THREE.MeshBasicNodeMaterial();
      // Sample the photo straight into the unlit material. A touch of gain
      // offsets the compositor's ACES curve so the panel keeps its punch.
      material.colorNode = tslTexture(loaded).rgb.mul(1.12);
      material.transparent = true;
      material.opacity = 0.95;
      material.depthWrite = false;
      material.side = THREE.FrontSide;

      screenMaterial = material;
      rect.add(new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material));
      fitToView(viewportAspect);
    })
    .catch(() => {
      // The screen simply stays dark; the chapter still renders.
    });

  const update = (time: number, pointer: Pointer, phase?: SectionPhaseState) => {
    const leaving = phase?.phase === "exit" ? phase.progress : 0;
    const arriving = phase?.phase === "enter" ? 1 - phase.progress : 0;

    mount.position.y =
      HOME.y + Math.sin(time * 0.55) * 0.05 + arriving * 0.35 - leaving * 0.7;
    mount.rotation.y = pointer.x * 0.14 + Math.sin(time * 0.21) * 0.025;
    mount.rotation.x = -pointer.y * 0.07 + Math.sin(time * 0.29) * 0.02;

    if (screenMaterial) {
      screenMaterial.opacity = 0.95 - leaving * 0.5;
    }
    frameMaterial.opacity = 0.6 - leaving * 0.32;
    glowMaterial.opacity = 0.3 + Math.sin(time * 0.8) * 0.05 - leaving * 0.14;
  };

  const dispose = () => {
    texture?.dispose();
    texture = null;
  };

  return { mount, fitToView, update, dispose };
}
