import * as THREE from "three/webgpu";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { ChapterWorld } from "../shared.ts";

/* ── 04 Apartment: photo-studio IBL over a scanned interior ──────────────── */

const DRACO_DECODER_PATH =
  "https://www.gstatic.com/draco/versioned/decoders/1.5.7/";

function disposeTree(root: THREE.Object3D) {
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry?.dispose();
    const materials = Array.isArray(mesh.material)
      ? mesh.material
      : mesh.material
        ? [mesh.material]
        : [];
    for (const material of materials) {
      for (const value of Object.values(material)) {
        if (value && (value as THREE.Texture).isTexture) {
          (value as THREE.Texture).dispose();
        }
      }
      material.dispose();
    }
  });
}

export function buildApartment(accent: string): ChapterWorld {
  const group = new THREE.Group();

  // The HDR gives the room its soft ambience; this key light restores enough
  // directional contrast to read the architecture.
  const key = new THREE.DirectionalLight(0xfff1dd, 2.4);
  key.position.set(6.5, 9, 7);
  key.target.position.set(0, 0, 0);
  group.add(key);
  group.add(key.target);

  // The fill carries the chapter accent into the interior — visible as a cool
  // edge on the stair and glass — without overriding the HDR.
  const accentTint = new THREE.Color(accent).lerp(
    new THREE.Color(0xffffff),
    0.55,
  );
  const fill = new THREE.DirectionalLight(accentTint, 0.7);
  fill.position.set(-7, 4, 6);
  fill.target.position.set(0, 0, 0);
  group.add(fill);
  group.add(fill.target);

  const roomLamp = new THREE.PointLight(0xffd7a3, 26, 18, 2);
  roomLamp.position.set(0.4, 2.6, 0.6);
  group.add(roomLamp);

  // The GLB uses Draco-compressed geometry and AVIF textures. Draco needs its
  // decoder; both the loader and the decoder are only used by this chapter.
  const draco = new DRACOLoader();
  draco.setDecoderPath(DRACO_DECODER_PATH);
  const loader = new GLTFLoader();
  loader.setDRACOLoader(draco);

  let model: THREE.Group | null = null;
  let disposed = false;

  // Interior camera rig, in the normalized model space the GLB is fitted to
  // (7.4 units across). It stands on the ground floor at eye height in the
  // open half of the plan, looking past the armchair into the stair spiral.
  const restPosition = new THREE.Vector3(2.5, -2.45, 2.9);
  const restTarget = new THREE.Vector3(-1.2, -2.5, 1.5);
  const cameraPosition = restPosition.clone();
  const cameraTarget = restTarget.clone();

  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 120);
  camera.position.copy(restPosition);
  camera.lookAt(restTarget);
  const lookAt = new THREE.Vector3();

  // Relative URLs resolve against the preview's own base (which sits under the
  // virtual server prefix) and against the site root in a standalone build.
  void loader
    .loadAsync("apartment.glb")
    .then((gltf) => {
      if (disposed) {
        disposeTree(gltf.scene);
        return;
      }

      const root = gltf.scene;
      root.updateMatrixWorld(true);

      root.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (!mesh.isMesh) return;
        // The scan includes a photographic exterior backdrop; dropping it
        // keeps the cutaway silhouette clean against the site background.
        if (mesh.name.toLowerCase().startsWith("outside")) {
          mesh.visible = false;
          return;
        }
        const materials = Array.isArray(mesh.material)
          ? mesh.material
          : [mesh.material];
        for (const material of materials) {
          if (material && "envMapIntensity" in material) {
            const standard = material as THREE.MeshStandardMaterial;
            standard.envMapIntensity = 1.15;
            // The scan ships with baked emissive room light; tone it down so
            // the HDR environment and key light define the illumination.
            standard.emissiveIntensity = 0.28;
          }
        }
      });

      // Fit only the visible shell; the hidden backdrop would otherwise
      // off-center the model and shrink it inside the frame.
      const box = new THREE.Box3();
      root.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (mesh.isMesh && mesh.visible) box.expandByObject(mesh);
      });
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      const span = Math.max(size.x, size.y, size.z, 0.001);
      const scale = 7.4 / span;

      root.scale.setScalar(scale);
      root.position.set(
        -center.x * scale,
        -center.y * scale,
        -center.z * scale,
      );

      group.add(root);
      model = root;
    })
    .catch((error) => {
      console.warn("Apartment model unavailable:", error);
    })
    .finally(() => {
      draco.dispose();
    });

  return {
    group,
    camera,
    dispose() {
      disposed = true;
      if (model) {
        disposeTree(model);
        model = null;
      }
      draco.dispose();
    },
    update(time, pointer) {
      // Keep the body still and look around from inside the room. The small
      // drift keeps the still frame alive without feeling like a turntable.
      cameraPosition.set(
        restPosition.x + Math.sin(time * 0.21) * 0.035,
        restPosition.y + Math.sin(time * 0.3) * 0.025,
        restPosition.z,
      );
      cameraTarget.set(
        restTarget.x + pointer.x * 0.85 + Math.sin(time * 0.17) * 0.05,
        restTarget.y - pointer.y * 0.55 + Math.sin(time * 0.23) * 0.04,
        restTarget.z,
      );

      // The rig is in group-local space; anchor it through the group matrix so
      // the interior view stays with the chapter during handoffs.
      group.updateMatrixWorld(true);
      camera.position.copy(cameraPosition).applyMatrix4(group.matrixWorld);
      lookAt.copy(cameraTarget).applyMatrix4(group.matrixWorld);
      camera.lookAt(lookAt);
    },
  };
}
