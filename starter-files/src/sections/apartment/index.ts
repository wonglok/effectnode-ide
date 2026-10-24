import * as THREE from "three/webgpu";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { loadBinaryAsset } from "../../lib/assets.ts";
import { glowPlane, type ChapterWorld } from "../shared.ts";

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

  // A faint accent bloom sits behind the model, so the chapter still carries
  // its blue accent while the studio HDR does the actual lighting.
  const halo = glowPlane(accent, 22, 0.14);
  halo.position.set(0, 0.6, -7);
  group.add(halo);

  // The HDR gives the room its soft ambience; this key light restores enough
  // directional contrast to read the architecture.
  const key = new THREE.DirectionalLight(0xfff1dd, 2.4);
  key.position.set(6.5, 9, 7);
  key.target.position.set(0, 0, 0);
  group.add(key);
  group.add(key.target);

  const fill = new THREE.DirectionalLight(0x9fc2ff, 0.7);
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
  let restY: number | null = null;
  let disposed = false;
  let fitDistance: (aspect: number) => number = () => 14.6;

  void loadBinaryAsset(
    new URL("../../assets/apartment.glb.b64", import.meta.url),
  )
    .then((buffer) => loader.parseAsync(buffer, ""))
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

      // Keep the whole cutaway in frame on both wide previews and the narrow
      // IDE pane. The camera uses a 42° vertical field of view.
      const halfFov = (42 * Math.PI) / 360;
      const margin = 1.22;
      const heightDistance =
        (size.y * scale * margin) / (2 * Math.tan(halfFov));
      const widthDistance = (size.x * scale * margin) / (2 * Math.tan(halfFov));
      const depth = size.z * scale;
      fitDistance = (aspect) =>
        Math.max(heightDistance, widthDistance / Math.max(aspect, 0.35)) +
        depth * 0.35;

      restY = root.position.y;
      group.add(root);
      model = root;
    })
    .catch((error) => {
      console.warn("Apartment model unavailable:", error);
    })
    .finally(() => {
      draco.dispose();
    });

  const restYaw = -0.42;
  group.rotation.y = restYaw;

  return {
    group,
    cameraDistance: (aspect) => fitDistance(aspect),
    dispose() {
      disposed = true;
      if (model) {
        disposeTree(model);
        model = null;
      }
      draco.dispose();
    },
    update(time, pointer) {
      const yaw = restYaw + pointer.x * 0.24 + Math.sin(time * 0.08) * 0.09;
      group.rotation.y += (yaw - group.rotation.y) * 0.035;
      group.rotation.x += (pointer.y * 0.045 - group.rotation.x) * 0.035;
      if (model && restY !== null) {
        model.position.y = restY + Math.sin(time * 0.35) * 0.035;
      }
    },
  };
}
