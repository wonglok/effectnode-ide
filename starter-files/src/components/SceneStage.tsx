import { useEffect, useRef, useState } from "react";
import * as THREE from "three/webgpu";
import {
  abs,
  color as tslColor,
  dot,
  float,
  mix,
  normalView,
  oneMinus,
  pass,
  positionLocal,
  positionViewDirection,
  pow,
  sin,
  smoothstep,
  time as tslTime,
  uv,
  vec2,
  vec3,
} from "three/tsl";
import { TextGeometry } from "three/addons/geometries/TextGeometry.js";
import { Font, type FontData } from "three/addons/loaders/FontLoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { SECTIONS } from "../sections/registry.ts";
import { Helvetica } from "../lib/helvetica.ts";
import { SectionRenderPipeline } from "../lib/render-pipeline.ts";
import {
  getSectionPhaseAt,
  type SectionPhaseState,
} from "../lib/scroll-phases.ts";
import { useScrollerStore } from "../store/useScrollerStore.ts";

type Pointer = { x: number; y: number };

type ChapterWorld = {
  group: THREE.Group;
  resize?: (aspect: number) => void;
  update: (
    time: number,
    pointer: Pointer,
    phase?: SectionPhaseState,
  ) => void;
};

function glowPlane(accent: string, size: number, opacity: number) {
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

function addRing(
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
function createCenterText(accent: string) {
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
    geometry.translate(
      -(box.min.x + box.max.x) / 2,
      -index * LINE_STEP,
      -0.06,
    );
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

/* ── 01 Kinetic: instanced glints on slow orbits ─────────────────────────── */

function buildKinetic(accent: string): ChapterWorld {
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

  return {
    group,
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
    },
  };
}

/* ── 02 Flow Shield: displaced lines wrapping an outline ─────────────────── */

function buildFlow(accent: string): ChapterWorld {
  const group = new THREE.Group();

  const rows = 32;
  const segments = 100;
  const halfWidth = 9;
  const halfHeight = 5.4;
  const positions: number[] = [];

  for (let row = 0; row <= rows; row += 1) {
    const y = -halfHeight + (row / rows) * halfHeight * 2;
    for (let segment = 0; segment < segments; segment += 1) {
      const x0 = -halfWidth + (segment / segments) * halfWidth * 2;
      const x1 = -halfWidth + ((segment + 1) / segments) * halfWidth * 2;
      positions.push(x0, y, 0, x1, y, 0);
    }
  }

  const flowGeometry = new THREE.BufferGeometry();
  flowGeometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );

  const flowMaterial = new THREE.LineBasicNodeMaterial();
  flowMaterial.colorNode = tslColor(accent);
  flowMaterial.transparent = true;
  flowMaterial.opacity = 0.16;
  flowMaterial.depthWrite = false;
  flowMaterial.blending = THREE.AdditiveBlending;

  const wave = sin(positionLocal.x.mul(0.5).add(tslTime.mul(0.5)))
    .mul(0.3)
    .add(sin(positionLocal.y.mul(0.8).sub(tslTime.mul(0.32))).mul(0.18));
  const envelope = oneMinus(
    smoothstep(float(0), float(halfWidth), abs(positionLocal.x)),
  );
  flowMaterial.positionNode = positionLocal.add(vec3(0, 0, wave.mul(envelope)));

  const flowLines = new THREE.LineSegments(flowGeometry, flowMaterial);
  group.add(flowLines);

  const shieldPoints = [
    new THREE.Vector3(0, 2.55, 0),
    new THREE.Vector3(1.5, 1.7, 0),
    new THREE.Vector3(1.25, -0.95, 0),
    new THREE.Vector3(0, -2.65, 0),
    new THREE.Vector3(-1.25, -0.95, 0),
    new THREE.Vector3(-1.5, 1.7, 0),
  ];
  const shieldCurve = new THREE.CatmullRomCurve3(
    shieldPoints,
    true,
    "centripetal",
  );
  const shieldGeometry = new THREE.TubeGeometry(
    shieldCurve,
    200,
    0.018,
    6,
    true,
  );

  const shieldMaterial = new THREE.MeshBasicNodeMaterial();
  shieldMaterial.colorNode = tslColor(accent);
  shieldMaterial.transparent = true;
  shieldMaterial.opacity = 0.85;
  shieldMaterial.depthWrite = false;
  shieldMaterial.blending = THREE.AdditiveBlending;

  const shield = new THREE.Mesh(shieldGeometry, shieldMaterial);
  shield.position.z = 0.25;
  group.add(shield);

  const ghostMaterial = new THREE.MeshBasicNodeMaterial();
  ghostMaterial.colorNode = tslColor(accent);
  ghostMaterial.transparent = true;
  ghostMaterial.opacity = 0.22;
  ghostMaterial.depthWrite = false;
  ghostMaterial.blending = THREE.AdditiveBlending;

  const ghost = new THREE.Mesh(shieldGeometry, ghostMaterial);
  ghost.position.z = 0.25;
  ghost.scale.setScalar(1.14);
  group.add(ghost);

  const glow = glowPlane(accent, 9, 0.26);
  glow.position.z = -2.5;
  group.add(glow);

  return {
    group,
    update(time, pointer) {
      const breathe = 1 + Math.sin(time * 0.8) * 0.018;
      shield.scale.setScalar(breathe);
      ghost.scale.setScalar(1.14 + Math.sin(time * 0.6 + 1) * 0.03);
      shield.rotation.z = Math.sin(time * 0.18) * 0.04;
      ghost.rotation.z = -Math.sin(time * 0.14) * 0.06;
      group.rotation.y = pointer.x * 0.12;
      group.rotation.x = pointer.y * 0.06;
      group.position.z = Math.sin(time * 0.3) * 0.08;
    },
  };
}

/* ── 03 Live Env: wireframe city over a breathing grid ───────────────────── */

function buildLiveEnv(accent: string): ChapterWorld {
  const group = new THREE.Group();
  const floorY = -2.6;

  const positions: number[] = [];
  const half = 14;
  for (let step = -half; step <= half; step += 2) {
    positions.push(step, floorY, -half, step, floorY, half);
    positions.push(-half, floorY, step, half, floorY, step);
  }

  const gridGeometry = new THREE.BufferGeometry();
  gridGeometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );

  const gridMaterial = new THREE.LineBasicNodeMaterial();
  gridMaterial.colorNode = tslColor(accent);
  gridMaterial.transparent = true;
  gridMaterial.opacity = 0.18;
  gridMaterial.depthWrite = false;
  gridMaterial.blending = THREE.AdditiveBlending;
  gridMaterial.positionNode = positionLocal.add(
    vec3(0, sin(positionLocal.z.mul(0.7).add(tslTime.mul(0.5))).mul(0.045), 0),
  );

  const grid = new THREE.LineSegments(gridGeometry, gridMaterial);
  group.add(grid);

  const towerMaterial = new THREE.MeshBasicNodeMaterial();
  towerMaterial.colorNode = tslColor(accent);
  towerMaterial.wireframe = true;
  towerMaterial.transparent = true;
  towerMaterial.opacity = 0.15;
  towerMaterial.depthWrite = false;
  towerMaterial.blending = THREE.AdditiveBlending;

  const towers = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1, 1),
    towerMaterial,
    28,
  );
  const dummy = new THREE.Object3D();
  for (let index = 0; index < 28; index += 1) {
    const width = 0.35 + Math.random() * 0.65;
    const height = 0.6 + Math.random() * 3.6;
    const depth = 0.35 + Math.random() * 0.8;
    dummy.position.set(
      (Math.random() - 0.5) * 22,
      floorY + height / 2,
      -8 - Math.random() * 18,
    );
    dummy.scale.set(width, height, depth);
    dummy.updateMatrix();
    towers.setMatrixAt(index, dummy.matrix);
  }
  towers.instanceMatrix.needsUpdate = true;
  towers.frustumCulled = false;
  group.add(towers);

  const monolithMaterial = new THREE.MeshBasicNodeMaterial();
  monolithMaterial.colorNode = tslColor(accent);
  monolithMaterial.wireframe = true;
  monolithMaterial.transparent = true;
  monolithMaterial.opacity = 0.3;
  monolithMaterial.depthWrite = false;
  monolithMaterial.blending = THREE.AdditiveBlending;

  const monoliths: THREE.Mesh[] = [
    [-3.6, 0.1, -5.5],
    [3.9, 0.5, -8],
    [0.5, 0.9, -10.5],
  ].map(([x, y, z], index) => {
    const monolith = new THREE.Mesh(
      new THREE.BoxGeometry(1 + index * 0.2, 2 + index * 0.45, 0.7),
      monolithMaterial,
    );
    monolith.position.set(x, y, z);
    monolith.rotation.y = index * 0.7;
    group.add(monolith);
    return monolith;
  });

  const horizon = glowPlane(accent, 28, 0.28);
  horizon.position.set(0, 3.2, -18);
  group.add(horizon);

  return {
    group,
    update(time, pointer) {
      monoliths.forEach((monolith, index) => {
        monolith.rotation.y = index * 0.7 + time * (0.08 + index * 0.03);
        monolith.rotation.x = Math.sin(time * 0.25 + index) * 0.04;
      });
      group.rotation.y = pointer.x * 0.08 + Math.sin(time * 0.03) * 0.04;
      group.rotation.x = pointer.y * 0.04;
    },
  };
}

/* ── 04 Alpha 6: glass shards lit by a fresnel rim ───────────────────────── */

function buildAlpha(accent: string): ChapterWorld {
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

  return {
    group,
    update(time, pointer) {
      group.rotation.y = time * 0.045 + pointer.x * 0.16;
      group.rotation.x = pointer.y * 0.08;
      shards.forEach(({ mesh, spin }, index) => {
        mesh.rotation.x += spin.x * 0.004;
        mesh.rotation.y += spin.y * 0.004;
        mesh.rotation.z += spin.z * 0.004;
        mesh.position.y += Math.sin(time * 0.5 + index) * 0.0008;
      });
      rings.forEach(({ ring }, index) => {
        ring.rotation.z += 0.0008 + index * 0.0004;
      });
    },
  };
}

const BUILDERS = [buildKinetic, buildFlow, buildLiveEnv, buildAlpha];

export function SceneStage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const markReady = () => {
      const store = useScrollerStore.getState();
      store.setPreloadProgress(1);
      store.setBootPhase("ready");
    };

    if (!("gpu" in navigator)) {
      markReady();
      setFailed(true);
      return;
    }

    const worlds: ChapterWorld[] = SECTIONS.map((section, index) =>
      BUILDERS[index % BUILDERS.length](section.accent),
    );

    // Every chapter owns a scene and a camera. The compositor renders only the
    // active one — or the two chapters mid-handoff — into its own pass texture.
    const scenes = SECTIONS.map((section, index) => {
      const scene = new THREE.Scene();
      scene.background = new THREE.Color(section.surface);
      scene.add(worlds[index].group);
      return scene;
    });

    const cameras = SECTIONS.map(() => {
      const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 120);
      camera.position.set(0, 0, 9.6);
      return camera;
    });

    const passes = scenes.map((scene, index) => pass(scene, cameras[index]));

    const pointer: Pointer = { x: 0, y: 0 };
    const target: Pointer = { x: 0, y: 0 };

    const onPointerMove = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      target.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      target.y = ((event.clientY - rect.top) / rect.height) * 2 - 1;
    };
    window.addEventListener("pointermove", onPointerMove, { passive: true });

    let width = 1;
    let height = 1;
    let frame = 0;
    let renderer: THREE.WebGPURenderer | null = null;
    let pipeline: SectionRenderPipeline | null = null;
    let envTarget: THREE.RenderTarget | null = null;
    let roomEnv: RoomEnvironment | null = null;
    let disposed = false;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      width = Math.max(1, rect.width);
      height = Math.max(1, rect.height);
      const aspect = width / height;
      cameras.forEach((camera) => {
        camera.aspect = aspect;
        camera.updateProjectionMatrix();
      });
      worlds.forEach((world) => world.resize?.(aspect));
      renderer?.setSize(width, height, false);
    };

    resize();
    const observer =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(resize) : null;
    observer?.observe(canvas);
    window.addEventListener("resize", resize);

    const start = async () => {
      try {
        renderer = new THREE.WebGPURenderer({
          canvas,
          antialias: true,
          alpha: false,
          powerPreference: "high-performance",
        });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
        renderer.setSize(width, height, false);
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.06;
        await renderer.init();
      } catch (error) {
        console.warn("WebGPU unavailable, using the static stage:", error);
        if (!disposed) {
          markReady();
          setFailed(true);
        }
        return;
      }

      if (disposed || !renderer) return;

      // Prefilter a neutral room for the glass reflections.
      try {
        const pmrem = new THREE.PMREMGenerator(renderer);
        roomEnv = new RoomEnvironment();
        envTarget = pmrem.fromScene(roomEnv, 0.04);
        pmrem.dispose();
        scenes[0].environment = envTarget.texture;
        scenes[0].environmentIntensity = 0.9;
      } catch (error) {
        console.warn("Glass environment unavailable:", error);
      }

      try {
        pipeline = new SectionRenderPipeline(renderer, passes);
        pipeline.prewarm();
      } catch (error) {
        console.warn("Scene compositor unavailable, using the static stage:", error);
        pipeline = null;
        if (!disposed) {
          markReady();
          setFailed(true);
        }
        return;
      }

      let startedAt = performance.now();
      let firstFrame = true;

      const render = (now: number) => {
        frame = window.requestAnimationFrame(render);
        const time = (now - startedAt) / 1000;

        pointer.x += (target.x - pointer.x) * 0.05;
        pointer.y += (target.y - pointer.y) * 0.05;

        const state = useScrollerStore.getState();

        for (let index = 0; index < worlds.length; index += 1) {
          const world = worlds[index];
          const phase = getSectionPhaseAt(index, state.scrollProgress);
          const involved =
            index === state.fromIndex || index === state.toIndex;

          // Phase drives the handoff: scenes drift away as they leave and
          // settle back to full presence in their hold window.
          world.group.scale.setScalar(0.965 + phase.activity * 0.035);
          world.group.position.y = (1 - phase.activity) * -0.22;

          if (involved) {
            world.update(time, pointer, phase);
          }

          const camera = cameras[index];
          const lift =
            phase.phase === "enter"
              ? 1 - phase.progress
              : phase.phase === "exit"
                ? phase.progress
                : 0;

          camera.position.x = pointer.x * 0.45;
          camera.position.y = -pointer.y * 0.32;
          camera.position.z =
            9.6 + Math.sin(time * 0.24 + index) * 0.12 + lift * 0.9;
          camera.lookAt(0, 0, 0);
        }

        pipeline!.update(
          {
            fromIndex: state.fromIndex,
            toIndex: state.toIndex,
            isTransitioning: state.isTransitioning,
            progress: state.transitionProgress,
          },
          time,
        );
        pipeline!.render();

        if (firstFrame) {
          firstFrame = false;
          markReady();
        }
      };

      startedAt = performance.now();
      frame = window.requestAnimationFrame(render);
    };

    void start();

    return () => {
      disposed = true;
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onPointerMove);

      worlds.forEach((world) => {
        world.group.traverse((object) => {
          const mesh = object as THREE.Mesh;
          mesh.geometry?.dispose();
          const material = mesh.material;
          if (Array.isArray(material)) {
            material.forEach((entry) => entry.dispose());
          } else {
            material?.dispose();
          }
        });
      });

      try {
        pipeline?.dispose();
        passes.forEach((node) => node.dispose());
      } catch {
        // The compositor may not have finished compiling its first frame.
      }
      pipeline = null;

      envTarget?.dispose();
      envTarget = null;
      roomEnv?.dispose();
      roomEnv = null;

      try {
        renderer?.dispose();
      } catch {
        // The renderer may still be initialising during a hot remount.
      }
      renderer = null;
    };
  }, []);

  return (
    <div className="ef-stage" aria-hidden="true">
      {failed ? (
        <div className="ef-stage-fallback" />
      ) : (
        <canvas ref={canvasRef} className="ef-stage-canvas" />
      )}
    </div>
  );
}
