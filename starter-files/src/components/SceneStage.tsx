import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three/webgpu';
import {
  abs,
  color as tslColor,
  dot,
  float,
  mix,
  normalView,
  oneMinus,
  positionLocal,
  positionViewDirection,
  pow,
  sin,
  smoothstep,
  time as tslTime,
  uv,
  vec2,
  vec3,
} from 'three/tsl';
import { SECTIONS } from '../sections/registry.ts';
import { getSectionPhaseAt } from '../lib/scroll-phases.ts';
import { useScrollerStore } from '../store/useScrollerStore.ts';

type Pointer = { x: number; y: number };
type Fade = { material: THREE.Material; base: number };

type ChapterWorld = {
  group: THREE.Group;
  fades: Fade[];
  update: (time: number, pointer: Pointer) => void;
};

/** One registry per chapter, so a shared material is only faded once. */
function fadeRegistry() {
  const seen = new Set<THREE.Material>();
  const fades: Fade[] = [];
  return {
    fades,
    track(material: THREE.Material, base = material.opacity) {
      if (seen.has(material)) return;
      seen.add(material);
      material.transparent = true;
      fades.push({ material, base });
    },
  };
}

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
  rotation: [number, number, number] = [0, 0, 0]
) {
  const material = new THREE.MeshBasicNodeMaterial();
  material.colorNode = tslColor(accent);
  material.transparent = true;
  material.opacity = opacity;
  material.depthWrite = false;
  material.blending = THREE.AdditiveBlending;

  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(radius, 0.006, 6, 240),
    material
  );
  ring.rotation.set(...rotation);
  group.add(ring);
  return { ring, material };
}

/* ── 01 Kinetic: instanced glints on slow orbits ─────────────────────────── */

function buildKinetic(accent: string): ChapterWorld {
  const registry = fadeRegistry();
  const group = new THREE.Group();

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
    count
  );
  mesh.frustumCulled = false;
  group.add(mesh);
  registry.track(material, 0.45);

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
  rings.forEach(({ material: ringMaterial }) => registry.track(ringMaterial));

  const glow = glowPlane(accent, 10, 0.4);
  glow.position.z = -3.5;
  group.add(glow);
  registry.track(glow.material as THREE.Material, 0.4);

  const dummy = new THREE.Object3D();

  return {
    group,
    fades: registry.fades,
    update(time, pointer) {
      particles.forEach((particle, index) => {
        const angle =
          particle.angle + time * particle.speed + pointer.x * 0.12;
        dummy.position.set(
          Math.cos(angle) * particle.radius,
          particle.height +
            Math.sin(time * 0.7 + particle.phase) * 0.28,
          Math.sin(angle) * particle.radius * 0.55
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
    },
  };
}

/* ── 02 Flow Shield: displaced lines wrapping an outline ─────────────────── */

function buildFlow(accent: string): ChapterWorld {
  const registry = fadeRegistry();
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
    'position',
    new THREE.Float32BufferAttribute(positions, 3)
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
    smoothstep(float(0), float(halfWidth), abs(positionLocal.x))
  );
  flowMaterial.positionNode = positionLocal.add(
    vec3(0, 0, wave.mul(envelope))
  );

  const flowLines = new THREE.LineSegments(flowGeometry, flowMaterial);
  group.add(flowLines);
  registry.track(flowMaterial, 0.16);

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
    'centripetal'
  );
  const shieldGeometry = new THREE.TubeGeometry(
    shieldCurve,
    200,
    0.018,
    6,
    true
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
  registry.track(shieldMaterial, 0.85);

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
  registry.track(ghostMaterial, 0.22);

  const glow = glowPlane(accent, 9, 0.26);
  glow.position.z = -2.5;
  group.add(glow);
  registry.track(glow.material as THREE.Material, 0.26);

  return {
    group,
    fades: registry.fades,
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
  const registry = fadeRegistry();
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
    'position',
    new THREE.Float32BufferAttribute(positions, 3)
  );

  const gridMaterial = new THREE.LineBasicNodeMaterial();
  gridMaterial.colorNode = tslColor(accent);
  gridMaterial.transparent = true;
  gridMaterial.opacity = 0.18;
  gridMaterial.depthWrite = false;
  gridMaterial.blending = THREE.AdditiveBlending;
  gridMaterial.positionNode = positionLocal.add(
    vec3(
      0,
      sin(positionLocal.z.mul(0.7).add(tslTime.mul(0.5))).mul(0.045),
      0
    )
  );

  const grid = new THREE.LineSegments(gridGeometry, gridMaterial);
  group.add(grid);
  registry.track(gridMaterial, 0.18);

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
    28
  );
  const dummy = new THREE.Object3D();
  for (let index = 0; index < 28; index += 1) {
    const width = 0.35 + Math.random() * 0.65;
    const height = 0.6 + Math.random() * 3.6;
    const depth = 0.35 + Math.random() * 0.8;
    dummy.position.set(
      (Math.random() - 0.5) * 22,
      floorY + height / 2,
      -8 - Math.random() * 18
    );
    dummy.scale.set(width, height, depth);
    dummy.updateMatrix();
    towers.setMatrixAt(index, dummy.matrix);
  }
  towers.instanceMatrix.needsUpdate = true;
  towers.frustumCulled = false;
  group.add(towers);
  registry.track(towerMaterial, 0.15);

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
      monolithMaterial
    );
    monolith.position.set(x, y, z);
    monolith.rotation.y = index * 0.7;
    group.add(monolith);
    return monolith;
  });
  registry.track(monolithMaterial, 0.3);

  const horizon = glowPlane(accent, 28, 0.28);
  horizon.position.set(0, 3.2, -18);
  group.add(horizon);
  registry.track(horizon.material as THREE.Material, 0.28);

  return {
    group,
    fades: registry.fades,
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
  const registry = fadeRegistry();
  const group = new THREE.Group();

  const glassMaterial = new THREE.MeshBasicNodeMaterial();
  const facing = abs(dot(normalView, positionViewDirection));
  const rim = pow(oneMinus(facing), float(2));
  glassMaterial.colorNode = mix(
    tslColor(accent).mul(0.35),
    tslColor('#ffffff'),
    rim.mul(0.85)
  );
  glassMaterial.transparent = true;
  glassMaterial.opacity = 0.24;
  glassMaterial.depthWrite = false;
  glassMaterial.blending = THREE.AdditiveBlending;
  glassMaterial.side = THREE.DoubleSide;
  registry.track(glassMaterial, 0.24);

  const edgeMaterial = new THREE.MeshBasicNodeMaterial();
  edgeMaterial.colorNode = tslColor(accent);
  edgeMaterial.wireframe = true;
  edgeMaterial.transparent = true;
  edgeMaterial.opacity = 0.28;
  edgeMaterial.depthWrite = false;
  edgeMaterial.blending = THREE.AdditiveBlending;
  registry.track(edgeMaterial, 0.28);

  const shards: Array<{ mesh: THREE.Mesh; spin: THREE.Vector3 }> = [];

  for (let index = 0; index < 13; index += 1) {
    const geometry =
      index % 2 === 0
        ? new THREE.TetrahedronGeometry(1, 0)
        : new THREE.OctahedronGeometry(1, 0);

    const mesh = new THREE.Mesh(
      geometry,
      index % 3 === 0 ? edgeMaterial : glassMaterial
    );

    // Ring the type instead of crossing it.
    const theta = (index / 13) * Math.PI * 2 + Math.random() * 0.35;
    const radius = 3 + Math.random() * 2.2;

    mesh.position.set(
      Math.cos(theta) * radius,
      Math.sin(theta) * radius * 0.62,
      -1.5 - Math.random() * 4
    );
    mesh.scale.set(
      0.32 + Math.random() * 0.62,
      0.26 + Math.random() * 0.7,
      0.32 + Math.random() * 0.55
    );
    mesh.rotation.set(
      Math.random() * Math.PI,
      Math.random() * Math.PI,
      Math.random() * Math.PI
    );

    group.add(mesh);
    shards.push({
      mesh,
      spin: new THREE.Vector3(
        (Math.random() - 0.5) * 0.3,
        (Math.random() - 0.5) * 0.36,
        (Math.random() - 0.5) * 0.22
      ),
    });
  }

  const rings = [
    addRing(group, 3.1, accent, 0.22, [1.2, 0.3, 0]),
    addRing(group, 4.2, accent, 0.12, [0.4, 1.1, 0.5]),
  ];
  rings.forEach(({ material }) => registry.track(material));

  const glow = glowPlane(accent, 9, 0.3);
  glow.position.z = -3;
  group.add(glow);
  registry.track(glow.material as THREE.Material, 0.3);

  return {
    group,
    fades: registry.fades,
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
      store.setBootPhase('ready');
    };

    if (!('gpu' in navigator)) {
      markReady();
      setFailed(true);
      return;
    }

    const scenes: ChapterWorld[] = SECTIONS.map((section, index) =>
      BUILDERS[index % BUILDERS.length](section.accent)
    );

    const scene = new THREE.Scene();
    const background = new THREE.Color(SECTIONS[0].surface);
    scene.background = background;

    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 120);
    camera.position.set(0, 0, 9.6);

    scenes.forEach((world) => scene.add(world.group));

    const palette = SECTIONS.map((section) => new THREE.Color(section.surface));
    const blends = new THREE.Color();

    const pointer: Pointer = { x: 0, y: 0 };
    const target: Pointer = { x: 0, y: 0 };

    const onPointerMove = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      target.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      target.y = ((event.clientY - rect.top) / rect.height) * 2 - 1;
    };
    window.addEventListener('pointermove', onPointerMove, { passive: true });

    let width = 1;
    let height = 1;
    let frame = 0;
    let renderer: THREE.WebGPURenderer | null = null;
    let disposed = false;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      width = Math.max(1, rect.width);
      height = Math.max(1, rect.height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer?.setSize(width, height, false);
    };

    resize();
    const observer =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(resize)
        : null;
    observer?.observe(canvas);
    window.addEventListener('resize', resize);

    const start = async () => {
      try {
        renderer = new THREE.WebGPURenderer({
          canvas,
          antialias: true,
          alpha: false,
          powerPreference: 'high-performance',
        });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
        renderer.setSize(width, height, false);
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.06;
        await renderer.init();
      } catch (error) {
        console.warn('WebGPU unavailable, using the static stage:', error);
        if (!disposed) {
          markReady();
          setFailed(true);
        }
        return;
      }

      if (disposed || !renderer) return;

      let startedAt = performance.now();
      let firstFrame = true;

      const render = (now: number) => {
        frame = window.requestAnimationFrame(render);
        const time = (now - startedAt) / 1000;

        pointer.x += (target.x - pointer.x) * 0.05;
        pointer.y += (target.y - pointer.y) * 0.05;

        const state = useScrollerStore.getState();

        // Camera breathes and follows the pointer.
        camera.position.x = pointer.x * 0.45;
        camera.position.y = -pointer.y * 0.32;
        camera.position.z = 9.6 + Math.sin(time * 0.24) * 0.12;
        camera.lookAt(0, 0, 0);

        // Chapter crossfade.
        for (let index = 0; index < scenes.length; index += 1) {
          const world = scenes[index];
          const phase = getSectionPhaseAt(index, state.scrollProgress);
          const activity = phase.activity;

          world.group.visible = activity > 0.002;
          for (const fade of world.fades) {
            fade.material.opacity = fade.base * activity;
          }
          if (world.group.visible) {
            world.update(time, pointer);
          }
        }

        // Background follows the chapter surfaces.
        blends.copy(palette[state.fromIndex]);
        blends.lerp(palette[state.toIndex], state.transitionProgress);
        background.copy(blends);

        renderer?.render(scene, camera);

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
      window.removeEventListener('resize', resize);
      window.removeEventListener('pointermove', onPointerMove);

      scenes.forEach((world) => {
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
