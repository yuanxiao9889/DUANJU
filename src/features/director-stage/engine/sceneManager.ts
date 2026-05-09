import * as THREE from 'three';

const DIRECTOR_STAGE_GROUND_SIZE = 160;
const DIRECTOR_STAGE_GROUND_TEXTURE_SIZE = 1024;
const DIRECTOR_STAGE_GROUND_COMPONENTS_KEY = 'directorStageGroundComponents';

interface DirectorStageGroundComponents {
  floor: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>;
  grid: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  xAxis: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  zAxis: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>;
}

export interface DirectorStageGroundAppearance {
  floorColor: THREE.ColorRepresentation;
  gridColor: THREE.ColorRepresentation;
  xAxisColor: THREE.ColorRepresentation;
  zAxisColor: THREE.ColorRepresentation;
  floorOpacity: number;
}

export function createDirectorStageScene(): THREE.Scene {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#15171b');
  return scene;
}

export function createDirectorStageRenderer(): THREE.WebGLRenderer {
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: false,
    preserveDrawingBuffer: true,
  });
  renderer.setClearColor(0x15171b, 1);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  return renderer;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}

function colorToRgba(color: THREE.Color, alpha: number): string {
  const r = Math.round(clamp01(color.r) * 255);
  const g = Math.round(clamp01(color.g) * 255);
  const b = Math.round(clamp01(color.b) * 255);
  return `rgba(${r}, ${g}, ${b}, ${clamp01(alpha)})`;
}

export function createDirectorStageDefaultGroundAppearance(): DirectorStageGroundAppearance {
  return {
    floorColor: '#20242a',
    gridColor: '#a8b3c0',
    xAxisColor: '#b9a27c',
    zAxisColor: '#8ea8c8',
    floorOpacity: 0.88,
  };
}

export function createDirectorStageGroundAppearanceFromEnvironmentColor(
  color: THREE.ColorRepresentation
): DirectorStageGroundAppearance {
  const base = new THREE.Color(color);
  const hsl = { h: 0, s: 0, l: 0 };
  base.getHSL(hsl);
  hsl.s = clamp01(hsl.s * 0.34);
  hsl.l = Math.max(0.08, Math.min(0.26, hsl.l * 0.34 + 0.055));

  const floorColor = new THREE.Color().setHSL(hsl.h, hsl.s, hsl.l);
  const gridColor = floorColor.clone().lerp(new THREE.Color('#e6edf5'), 0.46);
  const xAxisColor = floorColor.clone().lerp(new THREE.Color('#e3bb7c'), 0.6);
  const zAxisColor = floorColor.clone().lerp(new THREE.Color('#92b8e6'), 0.56);

  return {
    floorColor,
    gridColor,
    xAxisColor,
    zAxisColor,
    floorOpacity: 0.9,
  };
}

function createDirectorStageGroundGridTexture(gridColor: THREE.ColorRepresentation): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = DIRECTOR_STAGE_GROUND_TEXTURE_SIZE;
  canvas.height = DIRECTOR_STAGE_GROUND_TEXTURE_SIZE;
  const context = canvas.getContext('2d');
  if (!context) {
    return new THREE.CanvasTexture(canvas);
  }

  const color = new THREE.Color(gridColor);
  const textureSize = DIRECTOR_STAGE_GROUND_TEXTURE_SIZE;
  const halfGround = DIRECTOR_STAGE_GROUND_SIZE / 2;
  const worldToPixel = (value: number) => ((value + halfGround) / DIRECTOR_STAGE_GROUND_SIZE) * textureSize;

  context.clearRect(0, 0, textureSize, textureSize);
  context.lineCap = 'square';

  for (let coordinate = -halfGround; coordinate <= halfGround; coordinate += 1) {
    const isMajor = Math.abs(coordinate % 5) < 0.001;
    const pixel = worldToPixel(coordinate);
    context.beginPath();
    context.strokeStyle = colorToRgba(color, isMajor ? 0.24 : 0.1);
    context.lineWidth = isMajor ? 1.15 : 0.7;
    context.moveTo(pixel, 0);
    context.lineTo(pixel, textureSize);
    context.moveTo(0, pixel);
    context.lineTo(textureSize, pixel);
    context.stroke();
  }

  const gradient = context.createRadialGradient(
    textureSize / 2,
    textureSize / 2,
    textureSize * 0.12,
    textureSize / 2,
    textureSize / 2,
    textureSize * 0.5
  );
  gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
  gradient.addColorStop(0.62, 'rgba(255, 255, 255, 0.88)');
  gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
  context.globalCompositeOperation = 'destination-in';
  context.fillStyle = gradient;
  context.fillRect(0, 0, textureSize, textureSize);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

function createDirectorStageAxisLine(
  start: THREE.Vector3,
  end: THREE.Vector3,
  color: THREE.ColorRepresentation
): THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial> {
  const geometry = new THREE.BufferGeometry().setFromPoints([start, end]);
  const material = new THREE.LineBasicMaterial({
    color,
    transparent: true,
    opacity: 0.58,
    depthWrite: false,
  });
  const line = new THREE.Line(geometry, material);
  line.renderOrder = 3;
  return line;
}

function getDirectorStageGroundComponents(group: THREE.Group): DirectorStageGroundComponents | null {
  const components = group.userData[DIRECTOR_STAGE_GROUND_COMPONENTS_KEY] as DirectorStageGroundComponents | undefined;
  return components ?? null;
}

export function buildDirectorStageGround(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'Director Stage Ground';

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(DIRECTOR_STAGE_GROUND_SIZE, DIRECTOR_STAGE_GROUND_SIZE),
    new THREE.MeshStandardMaterial({
      color: '#20242a',
      roughness: 0.94,
      metalness: 0,
      transparent: true,
      opacity: 0.88,
    })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  floor.renderOrder = 1;
  group.add(floor);

  const gridTexture = createDirectorStageGroundGridTexture('#a8b3c0');
  const grid = new THREE.Mesh(
    new THREE.PlaneGeometry(DIRECTOR_STAGE_GROUND_SIZE, DIRECTOR_STAGE_GROUND_SIZE),
    new THREE.MeshBasicMaterial({
      map: gridTexture,
      transparent: true,
      opacity: 0.82,
      depthWrite: false,
    })
  );
  grid.rotation.x = -Math.PI / 2;
  grid.position.y = 0.006;
  grid.renderOrder = 2;
  group.add(grid);

  const halfGround = DIRECTOR_STAGE_GROUND_SIZE / 2;
  const xAxis = createDirectorStageAxisLine(
    new THREE.Vector3(-halfGround, 0.012, 0),
    new THREE.Vector3(halfGround, 0.012, 0),
    '#b9a27c'
  );
  const zAxis = createDirectorStageAxisLine(
    new THREE.Vector3(0, 0.014, -halfGround),
    new THREE.Vector3(0, 0.014, halfGround),
    '#8ea8c8'
  );
  group.add(xAxis, zAxis);

  group.userData[DIRECTOR_STAGE_GROUND_COMPONENTS_KEY] = {
    floor,
    grid,
    xAxis,
    zAxis,
  } satisfies DirectorStageGroundComponents;
  return group;
}

export function updateDirectorStageGroundAppearance(
  group: THREE.Group,
  appearance: DirectorStageGroundAppearance,
  visible?: boolean
): void {
  const components = getDirectorStageGroundComponents(group);
  if (!components) {
    group.visible = visible ?? group.visible;
    return;
  }

  components.floor.material.color.set(appearance.floorColor);
  components.floor.material.opacity = clamp01(appearance.floorOpacity);
  components.floor.material.needsUpdate = true;

  const previousGridTexture = components.grid.material.map;
  components.grid.material.map = createDirectorStageGroundGridTexture(appearance.gridColor);
  components.grid.material.needsUpdate = true;
  previousGridTexture?.dispose();

  components.xAxis.material.color.set(appearance.xAxisColor);
  components.zAxis.material.color.set(appearance.zAxisColor);
  components.xAxis.material.needsUpdate = true;
  components.zAxis.material.needsUpdate = true;

  if (typeof visible === 'boolean') {
    group.visible = visible;
  }
}

export function disposeDirectorStageGround(group: THREE.Group): void {
  const components = getDirectorStageGroundComponents(group);
  if (!components) {
    return;
  }

  components.floor.geometry.dispose();
  components.floor.material.dispose();
  components.grid.geometry.dispose();
  components.grid.material.map?.dispose();
  components.grid.material.dispose();
  components.xAxis.geometry.dispose();
  components.xAxis.material.dispose();
  components.zAxis.geometry.dispose();
  components.zAxis.material.dispose();
  group.userData[DIRECTOR_STAGE_GROUND_COMPONENTS_KEY] = null;
}
