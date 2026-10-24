import * as THREE from "three/webgpu";
import {
  color as tslColor,
  float,
  mix,
  oneMinus,
  smoothstep,
  uv,
  vec2,
} from "three/tsl";
import {
  createChapterCamera,
  frameChapterCamera,
  glowPlane,
  type ChapterWorld,
} from "../shared.ts";

/* ── 01 Soft Room: a sunlit interior with soft window shadows ─────────────
 * TSL translation of the room-with-soft-shadows demo: a shoji window casts a
 * soft grid of sunlight across the room while pink spheres drift outside.
 */

const FLOOR_Y = -2.55;
const CEILING_Y = 3.35;
const BACK_Z = -3.15;
const FRONT_Z = 2.9;
const LEFT_X = -4.7;
const RIGHT_X = 4.7;

const WINDOW = {
  left: -1.55,
  right: 3.25,
  bottom: -1.05,
  top: 2.25,
  z: BACK_Z,
};

function standardMaterial(color: string, roughness = 0.9, metalness = 0) {
  const material = new THREE.MeshStandardNodeMaterial();
  material.color = new THREE.Color(color);
  material.roughness = roughness;
  material.metalness = metalness;
  return material;
}

function addBox(
  parent: THREE.Object3D,
  size: [number, number, number],
  position: [number, number, number],
  material: THREE.Material,
  castShadow = true,
  receiveShadow = true,
) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
  mesh.position.set(...position);
  mesh.castShadow = castShadow;
  mesh.receiveShadow = receiveShadow;
  parent.add(mesh);
  return mesh;
}

function addCylinder(
  parent: THREE.Object3D,
  radii: [number, number],
  height: number,
  segments: number,
  position: [number, number, number],
  material: THREE.Material,
  castShadow = true,
  receiveShadow = true,
) {
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(radii[0], radii[1], height, segments),
    material,
  );
  mesh.position.set(...position);
  mesh.castShadow = castShadow;
  mesh.receiveShadow = receiveShadow;
  parent.add(mesh);
  return mesh;
}

function buildSky() {
  const material = new THREE.MeshBasicNodeMaterial();
  const height = uv().y;
  const horizon = mix(
    tslColor("#d9a777"),
    tslColor("#5f82ab"),
    smoothstep(float(0.15), float(0.85), height),
  );
  const sunDistance = uv().sub(vec2(0.6, 0.56)).length();
  const sun = oneMinus(smoothstep(float(0.01), float(0.09), sunDistance));
  const haze = oneMinus(
    smoothstep(float(0.0), float(0.22), height.sub(0.3).abs()),
  ).mul(0.24);

  material.colorNode = horizon
    .add(tslColor("#ffe0b8").mul(sun).mul(1.1))
    .add(tslColor("#ffd9b3").mul(haze));

  const sky = new THREE.Mesh(new THREE.PlaneGeometry(16, 9), material);
  sky.position.set(0.4, 1.0, -7.4);
  return sky;
}

function buildWindow(frameMaterial: THREE.Material) {
  const group = new THREE.Group();
  const width = WINDOW.right - WINDOW.left;
  const height = WINDOW.top - WINDOW.bottom;
  const centerX = (WINDOW.left + WINDOW.right) / 2;
  const centerY = (WINDOW.bottom + WINDOW.top) / 2;
  const z = WINDOW.z + 0.04;
  const outer = 0.14;
  const inner = 0.08;

  // Outer frame.
  addBox(group, [outer, height + outer, 0.16], [WINDOW.left, centerY, z], frameMaterial);
  addBox(group, [outer, height + outer, 0.16], [WINDOW.right, centerY, z], frameMaterial);
  addBox(group, [width + outer, outer, 0.16], [centerX, WINDOW.top, z], frameMaterial);
  addBox(group, [width + outer, outer, 0.16], [centerX, WINDOW.bottom, z], frameMaterial);

  // Shoji mullions: these are what carve the soft grid of light.
  const columns = 5;
  const rows = 4;
  for (let index = 1; index < columns; index += 1) {
    const x = WINDOW.left + (width / columns) * index;
    addBox(group, [inner, height, 0.13], [x, centerY, z], frameMaterial);
  }
  for (let index = 1; index < rows; index += 1) {
    const y = WINDOW.bottom + (height / rows) * index;
    addBox(group, [width, inner, 0.13], [centerX, y, z], frameMaterial);
  }

  // Sill.
  addBox(
    group,
    [width + 0.36, 0.09, 0.42],
    [centerX, WINDOW.bottom - 0.04, WINDOW.z + 0.2],
    frameMaterial,
  );

  return group;
}

function buildChair(
  frameMaterial: THREE.Material,
  cushionMaterial: THREE.Material,
) {
  const chair = new THREE.Group();

  addCylinder(chair, [0.4, 0.44], 0.07, 32, [0, 0.035, 0], frameMaterial);
  addCylinder(chair, [0.14, 0.2], 0.34, 24, [0, 0.24, 0], frameMaterial);
  addCylinder(chair, [0.62, 0.62], 0.2, 32, [0, 0.5, 0], cushionMaterial);

  // Upholstered tub back, open towards the table.
  const backMaterial = cushionMaterial.clone();
  backMaterial.side = THREE.DoubleSide;
  const back = new THREE.Mesh(
    new THREE.CylinderGeometry(
      0.62,
      0.62,
      0.66,
      32,
      1,
      true,
      -Math.PI * 0.62,
      Math.PI * 1.24,
    ),
    backMaterial,
  );
  back.position.set(0, 0.9, 0.2);
  back.castShadow = true;
  back.receiveShadow = true;
  chair.add(back);

  // Thin wooden cap along the top of the back.
  const rimMaterial = frameMaterial.clone();
  rimMaterial.side = THREE.DoubleSide;
  const rim = new THREE.Mesh(
    new THREE.CylinderGeometry(
      0.632,
      0.632,
      0.045,
      32,
      1,
      true,
      -Math.PI * 0.62,
      Math.PI * 1.24,
    ),
    rimMaterial,
  );
  rim.position.set(0, 1.23, 0.2);
  rim.castShadow = true;
  chair.add(rim);

  return chair;
}

function buildLantern(frameMaterial: THREE.Material) {
  const group = new THREE.Group();
  const size = 0.52;
  const height = 1.05;

  for (const x of [-1, 1]) {
    for (const z of [-1, 1]) {
      addBox(
        group,
        [0.03, height, 0.03],
        [(x * size) / 2, height / 2, (z * size) / 2],
        frameMaterial,
      );
    }
  }
  addBox(group, [size + 0.05, 0.035, size + 0.05], [0, height, 0], frameMaterial);
  addBox(group, [size + 0.05, 0.035, size + 0.05], [0, 0.02, 0], frameMaterial);

  const shadeMaterial = new THREE.MeshBasicNodeMaterial();
  shadeMaterial.colorNode = tslColor("#ffd9a8");
  shadeMaterial.transparent = true;
  shadeMaterial.opacity = 0.42;
  shadeMaterial.depthWrite = false;
  shadeMaterial.blending = THREE.AdditiveBlending;
  shadeMaterial.side = THREE.DoubleSide;

  const shade = new THREE.Mesh(
    new THREE.BoxGeometry(size - 0.08, height - 0.18, size - 0.08),
    shadeMaterial,
  );
  shade.position.y = height / 2;
  group.add(shade);

  return group;
}

export function buildSoftRoom(accent: string): ChapterWorld {
  const group = new THREE.Group();

  const plaster = standardMaterial("#b3a491", 0.95);
  const plasterShadowed = standardMaterial("#6e6054", 0.98);
  const wood = standardMaterial("#7d563c", 0.72);
  const darkWood = standardMaterial("#3a2a21", 0.8);
  const frameMaterial = standardMaterial("#3a2b22", 0.62);
  const chairFrame = standardMaterial("#4a3a2f", 0.72);
  const cushion = standardMaterial("#c6ad86", 1);
  const rug = standardMaterial("#704c45", 0.98);
  const ceramic = standardMaterial("#d8c9ae", 0.55);

  // Sky and soft sun glow, visible through the window.
  group.add(buildSky());

  // Floor, ceiling and shell.
  addBox(group, [9.6, 0.2, 6.15], [0, FLOOR_Y - 0.1, -0.12], wood, false, true);
  const ceilingMaterial = standardMaterial("#6e6054", 1);
  ceilingMaterial.emissive = new THREE.Color("#241a12");
  ceilingMaterial.emissiveIntensity = 0.9;
  addBox(group, [9.6, 0.16, 6.05], [0, CEILING_Y + 0.08, -0.12], ceilingMaterial);

  addBox(
    group,
    [0.16, CEILING_Y - FLOOR_Y, 6.1],
    [LEFT_X - 0.08, (FLOOR_Y + CEILING_Y) / 2, -0.12],
    plaster,
  );
  addBox(
    group,
    [0.16, CEILING_Y - FLOOR_Y, 4.5],
    [RIGHT_X + 0.08, (FLOOR_Y + CEILING_Y) / 2, -0.9],
    plaster,
  );

  // Back wall built around the window opening.
  const wallHeight = CEILING_Y - FLOOR_Y;
  addBox(
    group,
    [WINDOW.left - LEFT_X, wallHeight, 0.18],
    [(LEFT_X + WINDOW.left) / 2, (FLOOR_Y + CEILING_Y) / 2, BACK_Z],
    plaster,
  );
  addBox(
    group,
    [RIGHT_X - WINDOW.right, wallHeight, 0.18],
    [(RIGHT_X + WINDOW.right) / 2, (FLOOR_Y + CEILING_Y) / 2, BACK_Z],
    plaster,
  );
  addBox(
    group,
    [WINDOW.right - WINDOW.left, WINDOW.bottom - FLOOR_Y, 0.18],
    [
      (WINDOW.left + WINDOW.right) / 2,
      (FLOOR_Y + WINDOW.bottom) / 2,
      BACK_Z,
    ],
    plaster,
  );
  addBox(
    group,
    [WINDOW.right - WINDOW.left, CEILING_Y - WINDOW.top, 0.18],
    [
      (WINDOW.left + WINDOW.right) / 2,
      (WINDOW.top + CEILING_Y) / 2,
      BACK_Z,
    ],
    plaster,
  );

  // Skirtings anchor the walls to the floor.
  addBox(group, [0.12, 0.28, 6.0], [LEFT_X + 0.06, FLOOR_Y + 0.14, -0.12], darkWood);
  addBox(
    group,
    [9.2, 0.28, 0.12],
    [0, FLOOR_Y + 0.14, BACK_Z + 0.08],
    darkWood,
  );

  group.add(buildWindow(frameMaterial));

  // A low rug softens the shadowed floor.
  const rugMesh = new THREE.Mesh(
    new THREE.CylinderGeometry(1, 1, 0.024, 64),
    rug,
  );
  rugMesh.scale.set(2.45, 1, 1.7);
  rugMesh.position.set(0.35, FLOOR_Y + 0.012, 0.8);
  rugMesh.receiveShadow = true;
  group.add(rugMesh);

  // Round table.
  addCylinder(group, [0.72, 0.78], 0.12, 40, [1.0, FLOOR_Y + 0.08, 0.35], darkWood);
  addCylinder(group, [0.24, 0.3], 1.34, 28, [1.0, FLOOR_Y + 0.72, 0.35], darkWood);
  addCylinder(group, [1.68, 1.68], 0.13, 64, [1.0, -1.12, 0.35], wood);

  // Low tray with candles.
  addBox(group, [1.0, 0.055, 0.55], [1.0, -1.02, 0.35], darkWood);
  addCylinder(group, [0.1, 0.1], 0.4, 20, [0.78, -0.8, 0.35], ceramic);
  addCylinder(group, [0.09, 0.09], 0.3, 20, [1.0, -0.85, 0.28], ceramic);
  addCylinder(group, [0.08, 0.08], 0.23, 20, [1.18, -0.89, 0.42], ceramic);

  // Chairs arranged around the table.
  const chairAngles = [160, 20, 270];
  for (const angle of chairAngles) {
    const radians = (angle * Math.PI) / 180;
    const radius = 2.25;
    const x = 1.0 + Math.cos(radians) * radius;
    const z = 0.35 + Math.sin(radians) * radius;
    const chair = buildChair(chairFrame, cushion);
    chair.position.set(x, FLOOR_Y, z);
    chair.scale.setScalar(0.9);
    chair.rotation.y = Math.atan2(x - 1.0, z - 0.35);
    group.add(chair);
  }

  // Lantern by the left wall.
  const lantern = buildLantern(frameMaterial);
  lantern.position.set(-3.5, FLOOR_Y, -1.7);
  group.add(lantern);

  const lanternLight = new THREE.PointLight("#ffbe7a", 9, 6.5, 2);
  lanternLight.position.set(-3.5, FLOOR_Y + 0.62, -1.7);
  group.add(lanternLight);

  const lanternGlow = glowPlane("#ffcf95", 2.6, 0.2);
  lanternGlow.position.set(-3.5, FLOOR_Y + 0.55, -1.78);
  group.add(lanternGlow);

  // Pink spheres floating beyond the shoji window.
  const sphereMaterial = new THREE.MeshBasicNodeMaterial();
  sphereMaterial.colorNode = tslColor(accent);

  const spheres = [
    { radius: 0.55, position: new THREE.Vector3(2.35, 1.5, -5.3), phase: 0.2 },
    { radius: 0.4, position: new THREE.Vector3(0.35, 1.95, -5.85), phase: 1.7 },
    { radius: 0.32, position: new THREE.Vector3(3.2, 0.62, -5.1), phase: 3.1 },
  ].map(({ radius, position, phase }) => {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(radius, 32, 32),
      sphereMaterial,
    );
    mesh.position.copy(position);
    group.add(mesh);

    const halo = glowPlane(accent, radius * 5.2, 0.22);
    halo.position.copy(position).add(new THREE.Vector3(0, 0, -0.05));
    group.add(halo);

    return { mesh, base: position.clone(), phase };
  });

  // Sunlight: low and warm, entering through the shoji grid.
  const sunTarget = new THREE.Object3D();
  sunTarget.position.set(0, 0, 0);

  const sunPivot = new THREE.Group();
  sunPivot.position.set(0.4, -0.7, 0.9);
  sunPivot.add(sunTarget);

  const sun = new THREE.DirectionalLight("#ffd6a8", 5.4);
  sun.position.set(3.8, 7.2, -9.2);
  sun.target = sunTarget;
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -8.5;
  sun.shadow.camera.right = 8.5;
  sun.shadow.camera.top = 8.5;
  sun.shadow.camera.bottom = -8.5;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 30;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.022;
  sun.shadow.radius = 10;
  sun.shadow.blurSamples = 16;
  sunPivot.add(sun);
  group.add(sunPivot);

  const hemisphere = new THREE.HemisphereLight("#c3d8ee", "#5a4333", 0.95);
  group.add(hemisphere);

  const fill = new THREE.DirectionalLight("#9ab9dc", 0.4);
  fill.position.set(-5, 3.5, 6);
  group.add(fill);

  // A soft pink bounce from the spheres keeps the shadow side readable.
  const bounce = new THREE.PointLight(accent, 2.2, 9, 2);
  bounce.position.set(1.2, 1.4, -3.8);
  group.add(bounce);

  let previousTime = 0;
  let sunYaw = 0;
  let sunPitch = 0;

  const camera = createChapterCamera(0);

  return {
    group,
    camera,
    update(time, pointer, phase) {
      const delta = Math.min(0.05, Math.max(0, time - previousTime));
      previousTime = time;

      const ease = 1 - Math.exp(-2.2 * delta);
      sunYaw += (pointer.x * 0.16 - sunYaw) * ease;
      sunPitch += (pointer.y * 0.08 - sunPitch) * ease;
      sunPivot.rotation.y = sunYaw;
      sunPivot.rotation.x = sunPitch;

      for (const sphere of spheres) {
        const bob = Math.sin(time * 0.55 + sphere.phase) * 0.07;
        const drift = Math.sin(time * 0.22 + sphere.phase * 2) * 0.05;
        sphere.mesh.position.y = sphere.base.y + bob;
        sphere.mesh.position.x = sphere.base.x + drift;
      }

      lanternLight.intensity =
        9 + Math.sin(time * 15) * 0.3 + Math.sin(time * 6.3) * 0.2;

      group.rotation.y = pointer.x * 0.022;
      group.rotation.x = pointer.y * 0.012;
      group.position.z = Math.sin(time * 0.22) * 0.03;

      frameChapterCamera(camera, 0, time, pointer, phase);
    },
  };
}
