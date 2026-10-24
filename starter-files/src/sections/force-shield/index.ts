import * as THREE from "three/webgpu";
import type { Node } from "three/webgpu";
import {
  abs,
  acos,
  attribute,
  clamp,
  color as tslColor,
  dot,
  float,
  floor,
  fract,
  max,
  min,
  mix,
  mx_fractal_noise_float,
  mx_noise_float,
  normalView,
  oneMinus,
  positionLocal,
  positionViewDirection,
  pow,
  select,
  sin,
  smoothstep,
  step,
  uniform,
  uniformArray,
  vec2,
  vec3,
} from "three/tsl";
import { glowPlane, type ChapterWorld } from "../shared.ts";

/* ── 01 Force Shield: TSL port of the flow-shield demo ───────────────────── */

const MAX_HITS = 6;
const SHIELD_RADIUS = 1.8;

/** Demo Presets › default, expressed in the TSL scene's own language. */
const PRESET = {
  hexScale: 3.0,
  hexOpacity: 0.08,
  edgeWidth: 0.06,
  fresnelPower: 1.8,
  fresnelStrength: 1.8,
  opacity: 0.68,
  fadeStart: -0.95,
  flashSpeed: 0.6,
  flashIntensity: 0.03,
  noiseScale: 1.3,
  noiseEdgeWidth: 0.02,
  noiseEdgeIntensity: 10.0,
  noiseEdgeSmoothness: 0.5,
  flowScale: 2.4,
  flowSpeed: 1.13,
  flowIntensity: 3,
  hitDuration: 1.8,
  hitIntensity: 5.2,
  hitImpactRadius: 0.3,
  hitDamage: 0.16,
  hitRingSpeed: 1.75,
  hitMaxRadius: 0.85,
};

/** Seconds for one click shockwave to expand and fade. */
const RING_LIFETIME = PRESET.hitDuration;

/** Ribbon resolution and cross-section profile for the surface shockwave. */
const RING_SEGMENTS = 96;
const RING_OFFSETS = [-0.13, -0.1, -0.07, -0.04, -0.01];
const RING_ALPHAS = [0, 0.5, 1, 0.5, 0];

const IMPACT_POINTS = [
  new THREE.Vector3(0.68, 0.52, 0.55),
  new THREE.Vector3(-0.62, 0.42, 0.7),
  new THREE.Vector3(0.18, -0.78, 0.6),
  new THREE.Vector3(-0.5, -0.56, -0.65),
  new THREE.Vector3(0.7, -0.2, -0.6),
  new THREE.Vector3(-0.72, 0.6, -0.25),
].map((point) => point.normalize().multiplyScalar(SHIELD_RADIUS));

const HEX_S = vec2(1, 1.7320508);

/**
 * Two-offset hex lattice from the demo's `hexPattern`. Returns 1 on a cell
 * edge and 0 in the cell interior.
 */
function hexPattern(faceUV: Node<"vec2">, edgeWidth: number) {
  const p = faceUV.mul(PRESET.hexScale);
  const hC1 = floor(p.div(HEX_S)).add(0.5);
  const hC2 = floor(p.sub(vec2(0.5, 1)).div(HEX_S)).add(0.5);
  const h1 = p.sub(hC1.mul(HEX_S));
  const h2 = p.sub(hC2.add(0.5).mul(HEX_S));
  const cell = select(h1.dot(h1).lessThan(h2.dot(h2)), h1, h2);
  const absolute = abs(cell);
  const d = max(absolute.dot(HEX_S.mul(0.5)), absolute.x);
  return smoothstep(float(0.5).sub(edgeWidth), float(0.5), d);
}

/** Cell id used by the per-cell twinkle. */
function hexCellId(faceUV: Node<"vec2">) {
  const p = faceUV.mul(PRESET.hexScale);
  const hC1 = floor(p.div(HEX_S)).add(0.5);
  const hC2 = floor(p.sub(vec2(0.5, 1)).div(HEX_S)).add(0.5);
  const h1 = p.sub(hC1.mul(HEX_S));
  const h2 = p.sub(hC2.add(0.5).mul(HEX_S));
  return select(h1.dot(h1).lessThan(h2.dot(h2)), hC1, hC2.add(0.5));
}

export function buildForceShield(accent: string): ChapterWorld {
  const group = new THREE.Group();
  const stage = new THREE.Group();
  stage.scale.setScalar(0.9);
  group.add(stage);

  const timeUniform = uniform(0);
  const reveal = uniform(1);
  const life = uniform(1);
  const hitPositionValues = IMPACT_POINTS.map((point) => point.clone());
  const hitTimeValues = Array.from({ length: MAX_HITS }, () => -999);
  const hitPositions = uniformArray<"vec3">(hitPositionValues, "vec3");
  const hitTimes = uniformArray<"float">(hitTimeValues, "float");

  const accentColor = tslColor(accent).rgb;
  const hotColor = tslColor("#ff1b0a").rgb;
  const lifeColor = mix(hotColor, accentColor, life);

  // Object-space sphere normal; the mesh is centred on its group origin.
  const objectNormal = positionLocal.normalize();
  const absNormal = abs(objectNormal);
  const dominance = max(
    absNormal.x,
    max(absNormal.y, absNormal.z),
  );
  const hexFade = smoothstep(float(0.65), float(0.85), dominance);

  // Pick one cube-face projection per fragment. hexFade fades the seam so the
  // switch between projections never shows as a hard grid discontinuity.
  const useX = absNormal.x
    .greaterThanEqual(absNormal.y)
    .and(absNormal.x.greaterThanEqual(absNormal.z));
  const useY = absNormal.y.greaterThanEqual(absNormal.z);
  const faceUV = select(
    useX,
    positionLocal.yz,
    select(useY, positionLocal.xz, positionLocal.xy),
  );

  const hex = hexPattern(faceUV, PRESET.edgeWidth).mul(hexFade);
  const cellId = hexCellId(faceUV);
  const random = fract(
    sin(dot(cellId, vec2(127.1, 311.7))).mul(float(43758.5453)),
  );
  const flashPhase = random.mul(6.2831);
  const flashSpeed = random.mul(1.5).add(0.5);
  const flash = smoothstep(
    0.6,
    1,
    sin(timeUniform.mul(PRESET.flashSpeed).mul(flashSpeed).add(flashPhase)),
  )
    .mul(PRESET.flashIntensity)
    .mul(hexFade);

  const fresnel = pow(
    oneMinus(clamp(dot(normalView, positionViewDirection), 0, 1)),
    PRESET.fresnelPower,
  ).mul(PRESET.fresnelStrength);

  const flowTime = timeUniform.mul(PRESET.flowSpeed);
  const flowPosition = positionLocal.mul(PRESET.flowScale);
  const flow1 = mx_noise_float(
    flowPosition.add(vec3(flowTime, flowTime.mul(0.6), flowTime.mul(0.4))),
  );
  const flow2 = mx_noise_float(
    flowPosition
      .mul(2.1)
      .add(vec3(flowTime.mul(-0.5), flowTime.mul(0.9), flowTime.mul(0.3))),
  );
  const flowNoise = flow1.mul(0.6).add(flow2.mul(0.4)).mul(0.5).add(0.5);

  // Reveal / dissolve edge, matching the demo's noisy threshold.
  const noise = mx_fractal_noise_float(
    positionLocal.mul(PRESET.noiseScale),
    3,
    2,
    0.5,
  )
    .mul(0.5)
    .add(0.5);
  const revealMask = smoothstep(
    reveal.sub(PRESET.noiseEdgeWidth),
    reveal,
    noise,
  );
  const innerFade = mix(
    float(0.98),
    float(0.15),
    float(PRESET.noiseEdgeSmoothness),
  );
  const edgeLow = smoothstep(
    reveal.sub(PRESET.noiseEdgeWidth),
    reveal.sub(innerFade.mul(PRESET.noiseEdgeWidth)),
    noise,
  );
  const edgeHigh = smoothstep(
    reveal.sub(PRESET.noiseEdgeWidth * 0.15),
    reveal,
    noise,
  );
  const revealEdge = edgeLow.mul(oneMinus(edgeHigh));

  // Hex cells near an impact light up. The expanding shockwave itself is a
  // pooled mesh (below), so it stays legible over the additive sphere.
  let hexHitBoost: Node<"float"> = float(0);
  for (let index = 0; index < MAX_HITS; index += 1) {
    const hitTime = hitTimes.element(index);
    const elapsed = timeUniform.sub(hitTime);
    const active = step(float(0), hitTime)
      .mul(step(float(0), elapsed))
      .mul(step(elapsed, PRESET.hitDuration));
    const distance = acos(
      clamp(
        dot(objectNormal, hitPositions.element(index).normalize()),
        -1,
        1,
      ),
    );
    const zone = oneMinus(smoothstep(0, PRESET.hitImpactRadius, distance));
    const zoneFade = oneMinus(
      smoothstep(0, PRESET.hitDuration * 0.35, elapsed),
    );
    hexHitBoost = hexHitBoost.add(zone.mul(zoneFade).mul(active));
  }
  const hitHex = min(hexHitBoost, 1);

  const effectiveHexOpacity = hitHex.mul(PRESET.hitIntensity).add(
    PRESET.hexOpacity,
  );
  const intensity = hex
    .mul(effectiveHexOpacity)
    .mul(fresnel.mul(0.7).add(0.3))
    .add(fresnel.mul(0.4))
    .add(flash);

  const shieldColor = lifeColor.mul(intensity).mul(2);
  const flowingColor = lifeColor.mul(flowNoise).mul(fresnel).mul(
    PRESET.flowIntensity,
  );
  const edgeColor = mix(accentColor, lifeColor, oneMinus(life));
  const edgeGlow = edgeColor.mul(revealEdge).mul(PRESET.noiseEdgeIntensity);

  const bottomFade = smoothstep(
    -1,
    PRESET.fadeStart,
    positionLocal.y.div(SHIELD_RADIUS),
  );
  const alpha = clamp(
    intensity
      .mul(PRESET.opacity)
      .mul(revealMask)
      .add(revealEdge.mul(PRESET.noiseEdgeIntensity))
      .add(hitHex.mul(0.2)),
    0,
    1,
  ).mul(bottomFade);

  const material = new THREE.MeshBasicNodeMaterial();
  material.colorNode = shieldColor.add(flowingColor).add(edgeGlow);
  material.opacityNode = alpha;
  material.transparent = true;
  material.depthWrite = false;
  material.blending = THREE.AdditiveBlending;
  material.side = THREE.FrontSide;

  const shield = new THREE.Mesh(
    new THREE.SphereGeometry(SHIELD_RADIUS, 64, 64),
    material,
  );
  stage.add(shield);

  const glow = glowPlane(accent, 10, 0.3);
  glow.position.z = -3.5;
  stage.add(glow);

  // The demo grounds the shield on a perspective grid.
  const floorY = -2.55;
  const gridLines: number[] = [];
  const gridExtent = 16;
  const gridStep = 1.6;
  for (let x = -gridExtent; x <= gridExtent; x += gridStep) {
    gridLines.push(x, floorY, -gridExtent, x, floorY, gridExtent);
  }
  for (let z = -gridExtent; z <= gridExtent; z += gridStep) {
    gridLines.push(-gridExtent, floorY, z, gridExtent, floorY, z);
  }

  const gridGeometry = new THREE.BufferGeometry();
  gridGeometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(gridLines, 3),
  );
  const gridMaterial = new THREE.LineBasicNodeMaterial();
  gridMaterial.colorNode = tslColor(accent);
  gridMaterial.transparent = true;
  gridMaterial.opacity = 0.12;
  gridMaterial.depthWrite = false;
  gridMaterial.blending = THREE.AdditiveBlending;
  gridMaterial.positionNode = positionLocal.add(
    vec3(
      0,
      sin(positionLocal.z.mul(0.45).add(timeUniform.mul(0.35))).mul(0.015),
      0,
    ),
  );
  const grid = new THREE.LineSegments(gridGeometry, gridMaterial);
  stage.add(grid);

  const floorGlow = glowPlane(accent, 8, 0.22);
  floorGlow.rotation.x = -Math.PI / 2;
  floorGlow.position.set(0, floorY + 0.01, 0);
  stage.add(floorGlow);

  // Click shockwaves are ribbons laid on the sphere surface, matching the
  // demo's geodesic ring: it expands from the impact, breaks up with noise,
  // and fades before it reaches the cap radius.
  const ringColor = uniform(new THREE.Color(accent));
  const ringMaterial = new THREE.MeshBasicNodeMaterial();
  ringMaterial.colorNode = ringColor.mul(3.0);
  ringMaterial.opacityNode = attribute("aAlpha", "float");
  ringMaterial.transparent = true;
  ringMaterial.depthWrite = false;
  ringMaterial.blending = THREE.AdditiveBlending;
  ringMaterial.side = THREE.DoubleSide;

  const RING_COLUMNS = RING_SEGMENTS + 1;
  const RING_ACROSS = RING_OFFSETS.length;
  const RING_RADIUS = SHIELD_RADIUS * 1.004;
  const RING_VERTICES = RING_COLUMNS * RING_ACROSS;
  const ringIndices: number[] = [];
  for (let i = 0; i < RING_SEGMENTS; i += 1) {
    for (let j = 0; j < RING_ACROSS - 1; j += 1) {
      const a = i * RING_ACROSS + j;
      const b = (i + 1) * RING_ACROSS + j;
      ringIndices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }

  const buildRingGeometry = () => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(RING_VERTICES * 3), 3)
        .setUsage(THREE.DynamicDrawUsage),
    );
    geometry.setAttribute(
      "aAlpha",
      new THREE.BufferAttribute(new Float32Array(RING_VERTICES), 1)
        .setUsage(THREE.DynamicDrawUsage),
    );
    geometry.setIndex(ringIndices);
    return geometry;
  };

  const impactRings = Array.from({ length: MAX_HITS }, () => {
    const geometry = buildRingGeometry();
    const mesh = new THREE.Mesh(geometry, ringMaterial);
    mesh.visible = false;
    mesh.frustumCulled = false;
    mesh.renderOrder = 5;
    mesh.raycast = () => {};
    stage.add(mesh);

    return {
      mesh,
      geometry,
      startedAt: -999,
      normal: new THREE.Vector3(0, 1, 0),
      tangentU: new THREE.Vector3(1, 0, 0),
      tangentV: new THREE.Vector3(0, 0, 1),
    };
  });

  const accentColorThree = new THREE.Color(accent);
  const smoothstep01 = (from: number, to: number, value: number) => {
    const t = Math.min(1, Math.max(0, (value - from) / (to - from)));
    return t * t * (3 - 2 * t);
  };

  const writeRing = (
    ring: (typeof impactRings)[number],
    ringRadius: number,
    elapsed: number,
    alphaScale: number,
  ) => {
    const position = ring.geometry.getAttribute("position") as THREE.BufferAttribute;
    const alpha = ring.geometry.getAttribute("aAlpha") as THREE.BufferAttribute;
    const positions = position.array as Float32Array;
    const alphas = alpha.array as Float32Array;

    let offset = 0;
    for (let i = 0; i < RING_COLUMNS; i += 1) {
      const angle = (i / RING_SEGMENTS) * Math.PI * 2;
      const cosAngle = Math.cos(angle);
      const sinAngle = Math.sin(angle);
      const tangentX =
        ring.tangentU.x * cosAngle + ring.tangentV.x * sinAngle;
      const tangentY =
        ring.tangentU.y * cosAngle + ring.tangentV.y * sinAngle;
      const tangentZ =
        ring.tangentU.z * cosAngle + ring.tangentV.z * sinAngle;

      // The demo perturbs the geodesic radius with noise as the ring travels.
      const noise =
        (Math.sin(angle * 5 + elapsed * 2) * 0.6 +
          Math.sin(angle * 11 - elapsed * 1.4) * 0.4) *
        0.05;

      for (let j = 0; j < RING_ACROSS; j += 1) {
        const theta = ringRadius + noise + RING_OFFSETS[j];
        const cosTheta = Math.cos(theta);
        const sinTheta = Math.sin(theta);
        const x =
          ring.normal.x * cosTheta + tangentX * sinTheta;
        const y =
          ring.normal.y * cosTheta + tangentY * sinTheta;
        const z =
          ring.normal.z * cosTheta + tangentZ * sinTheta;

        positions[offset] = x * RING_RADIUS;
        positions[offset + 1] = y * RING_RADIUS;
        positions[offset + 2] = z * RING_RADIUS;
        alphas[offset / 3] = RING_ALPHAS[j] * alphaScale;
        offset += 3;
      }
    }

    position.needsUpdate = true;
    alpha.needsUpdate = true;
  };

  const hotColorThree = new THREE.Color("#ff1b0a");

  let latestTime = 0;
  let previousTime = 0;
  let hitCursor = 0;
  let autoCursor = 0;
  let lastAutoHit = 0;

  const spawnHit = (localPoint: THREE.Vector3, at: number) => {
    const slot = hitCursor % MAX_HITS;
    hitCursor += 1;
    hitPositionValues[slot].copy(localPoint);
    hitTimeValues[slot] = at;
    life.value = Math.max(0.2, life.value - PRESET.hitDamage);

    const ring = impactRings[slot];
    const normal = localPoint.clone().normalize();
    const helper =
      Math.abs(normal.y) > 0.9
        ? new THREE.Vector3(1, 0, 0)
        : new THREE.Vector3(0, 1, 0);

    ring.normal.copy(normal);
    ring.tangentU.crossVectors(helper, normal).normalize();
    ring.tangentV.crossVectors(normal, ring.tangentU).normalize();
    ring.startedAt = at;
    writeRing(ring, 0, 0, 0.95);
    ring.mesh.visible = true;
  };

  return {
    group,
    onPointerDown(point) {
      const localPoint = shield.worldToLocal(point.clone());
      if (localPoint.length() > SHIELD_RADIUS * 1.08) return;
      spawnHit(localPoint, latestTime);
    },
    update(time, pointer, phase) {
      const delta = Math.min(0.05, Math.max(0, time - previousTime));
      previousTime = time;
      latestTime = time;
      timeUniform.value = time;

      const targetReveal = 1 - (phase?.activity ?? 1);
      reveal.value += (targetReveal - reveal.value) * (1 - Math.exp(-4.5 * delta));

      life.value = Math.min(1, life.value + delta * 0.05);
      ringColor.value.lerpColors(hotColorThree, accentColorThree, life.value);

      for (const ring of impactRings) {
        if (!ring.mesh.visible) continue;
        const elapsed = time - ring.startedAt;
        if (elapsed < 0 || elapsed > RING_LIFETIME) {
          ring.mesh.visible = false;
          continue;
        }
        const ringRadius = Math.min(
          elapsed * PRESET.hitRingSpeed,
          PRESET.hitMaxRadius,
        );
        const fade =
          1 -
          smoothstep01(
            PRESET.hitDuration * 0.5,
            PRESET.hitDuration,
            elapsed,
          );
        const radialFade =
          1 -
          smoothstep01(
            PRESET.hitMaxRadius * 0.75,
            PRESET.hitMaxRadius,
            ringRadius,
          );
        writeRing(ring, ringRadius, elapsed, fade * radialFade * 0.95);
      }

      // Automatic strikes keep the shield alive between pointer taps.
      if (time - lastAutoHit > 4.8 && reveal.value < 0.35) {
        const point = IMPACT_POINTS[autoCursor % IMPACT_POINTS.length];
        autoCursor += 1;
        spawnHit(point, time);
        lastAutoHit = time;
      }

      const breathe = 1 + Math.sin(time * 0.8) * 0.012;
      shield.scale.setScalar(breathe);
      group.rotation.y = pointer.x * 0.24 + Math.sin(time * 0.1) * 0.08;
      group.rotation.x = pointer.y * 0.1;
      group.position.z = Math.sin(time * 0.32) * 0.08;
    },
  };
}
