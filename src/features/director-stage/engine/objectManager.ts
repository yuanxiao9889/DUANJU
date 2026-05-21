import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkeletonObject } from 'three/examples/jsm/utils/SkeletonUtils.js';

import {
  clampDirectorStageScale,
  type DirectorStageEntity,
  type DirectorStageTransform,
} from '../domain/types';
import { resolveDirectorStageModelUrl } from '../application/modelUrl';
import { resolveImageDisplayUrl } from '@/features/canvas/application/imageData';
import { rememberDirectorStageBasePose } from './poseManager';

const BLANK_TEXTURE_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';
const textureSkippingLoadingManager = new THREE.LoadingManager();
textureSkippingLoadingManager.setURLModifier((url) =>
  /\.(?:png|jpe?g|webp|bmp|gif|tga|tiff?|ktx2?|dds)(?:[?#].*)?$/i.test(url)
    ? BLANK_TEXTURE_DATA_URL
    : url
);
const gltfLoader = new GLTFLoader(textureSkippingLoadingManager);
const modelSourceCache = new Map<string, Promise<THREE.Group>>();
const CONTENT_ROOT_KEY = 'directorStageContentRoot';
const MATERIAL_TEXTURE_KEYS = [
  'map',
  'emissiveMap',
  'aoMap',
  'alphaMap',
  'normalMap',
  'roughnessMap',
  'metalnessMap',
  'bumpMap',
  'displacementMap',
  'specularMap',
  'lightMap',
  'envMap',
  'matcap',
  'gradientMap',
  'clearcoatMap',
  'clearcoatNormalMap',
  'clearcoatRoughnessMap',
  'sheenColorMap',
  'sheenRoughnessMap',
  'transmissionMap',
  'thicknessMap',
  'iridescenceMap',
  'iridescenceThicknessMap',
  'specularIntensityMap',
  'specularColorMap',
  'anisotropyMap',
] as const;

type MaterialWithColor = THREE.Material & {
  color?: THREE.Color;
};

type MaterialWithTextureSlots = THREE.Material & Record<string, unknown>;

type DirectorStagePrimitiveKind = 'box' | 'sphere' | 'cylinder' | 'cone' | 'plane' | 'torus';

const PLANE_SURFACE_TEXTURE_KEY = 'directorStagePlaneSurfaceTexture';
const PLANE_SURFACE_TEXTURE_SOURCE_KEY = 'directorStagePlaneSurfaceTextureSource';
const PLANE_SURFACE_TEXTURE_STYLE_KEY = 'directorStagePlaneSurfaceTextureStyle';
const PLANE_SURFACE_TEXTURE_SIZE = 1024;

function isMesh(value: THREE.Object3D): value is THREE.Mesh {
  return (value as THREE.Mesh).isMesh === true;
}

function isThreeColor(value: unknown): value is THREE.Color {
  return value instanceof THREE.Color;
}

function isThreeTexture(value: unknown): value is THREE.Texture {
  return value instanceof THREE.Texture;
}

function disposeMaterialWithTextures(material: THREE.Material, disposedTextures: WeakSet<THREE.Texture>): void {
  const textureMaterial = material as MaterialWithTextureSlots;
  MATERIAL_TEXTURE_KEYS.forEach((key) => {
    const texture = textureMaterial[key];
    if (!isThreeTexture(texture)) {
      return;
    }
    textureMaterial[key] = null;
    if (!disposedTextures.has(texture)) {
      texture.dispose();
      disposedTextures.add(texture);
    }
  });
  material.dispose();
}

function createClayMaterial(color = '#f2f2ee'): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: 0.72,
    metalness: 0,
    envMapIntensity: 0.18,
  });
}

function parseDirectorStagePrimitivePath(modelPath: string): DirectorStagePrimitiveKind | null {
  if (!modelPath.startsWith('primitive://')) {
    return null;
  }
  const kind = modelPath.slice('primitive://'.length);
  return kind === 'box'
    || kind === 'sphere'
    || kind === 'cylinder'
    || kind === 'cone'
    || kind === 'plane'
    || kind === 'torus'
    ? kind
    : null;
}

function createDirectorStagePrimitiveGeometry(kind: DirectorStagePrimitiveKind): THREE.BufferGeometry {
  switch (kind) {
    case 'box':
      return new THREE.BoxGeometry(1, 1, 1);
    case 'sphere':
      return new THREE.SphereGeometry(0.5, 48, 24);
    case 'cylinder':
      return new THREE.CylinderGeometry(0.45, 0.45, 1.4, 48);
    case 'cone':
      return new THREE.ConeGeometry(0.5, 1.4, 48);
    case 'plane':
      return new THREE.PlaneGeometry(1.6, 1.6);
    case 'torus':
      return new THREE.TorusGeometry(0.45, 0.12, 20, 56);
    default:
      return new THREE.BoxGeometry(1, 1, 1);
  }
}

function createDirectorStagePrimitiveModel(kind: DirectorStagePrimitiveKind): THREE.Group {
  const group = new THREE.Group();
  const mesh = new THREE.Mesh(createDirectorStagePrimitiveGeometry(kind), createClayMaterial());
  mesh.name = kind;
  if (kind === 'plane') {
    mesh.rotation.x = -Math.PI / 2;
  }
  group.add(mesh);
  group.userData[CONTENT_ROOT_KEY] = mesh;
  normalizeDirectorStageObjectContent(group);
  rememberDirectorStageBasePose(group);
  enableEntityShadows(group);
  return group;
}

function getObjectBoxInParentSpace(object: THREE.Object3D): THREE.Box3 {
  object.updateWorldMatrix(true, true);
  const box = new THREE.Box3().setFromObject(object);
  const parent = object.parent;
  if (parent) {
    box.applyMatrix4(parent.matrixWorld.clone().invert());
  }
  return box;
}

function normalizeModelScale(object: THREE.Object3D): void {
  const box = getObjectBoxInParentSpace(object);
  if (box.isEmpty()) {
    return;
  }

  const size = box.getSize(new THREE.Vector3());
  const maxDimension = Math.max(size.x, size.y, size.z);
  if (!Number.isFinite(maxDimension) || maxDimension <= 0) {
    return;
  }

  const targetHeight = size.y > 0 ? 1.85 : 2;
  const targetMaxDimension = 2.4;
  const heightScale = size.y > 0 ? targetHeight / Math.max(size.y, 0.001) : Number.POSITIVE_INFINITY;
  const maxDimensionScale = targetMaxDimension / maxDimension;
  const scale = maxDimension > 8 || size.y > 4 ? Math.min(heightScale, maxDimensionScale) : 1;
  if (Math.abs(scale - 1) > 0.0001) {
    object.scale.multiplyScalar(scale);
    object.updateMatrixWorld(true);
  }

  const normalizedBox = getObjectBoxInParentSpace(object);
  const center = normalizedBox.getCenter(new THREE.Vector3());
  object.position.x -= center.x;
  object.position.z -= center.z;
  object.position.y -= normalizedBox.min.y;
}

export function normalizeDirectorStageObjectContent(object: THREE.Object3D): void {
  const contentRoot = object.userData[CONTENT_ROOT_KEY] instanceof THREE.Object3D
    ? object.userData[CONTENT_ROOT_KEY] as THREE.Object3D
    : object.children[0] ?? object;
  normalizeModelScale(contentRoot);
}

export function refreshDirectorStageObjectContentRoot(object: THREE.Object3D): void {
  object.userData[CONTENT_ROOT_KEY] = object.children[0] ?? object;
}

export async function loadDirectorStageModel(entity: DirectorStageEntity): Promise<THREE.Group> {
  const source = await loadDirectorStageModelSource(entity.modelPath);
  const group = cloneSkeletonObject(source) as THREE.Group;
  group.name = entity.name;
  group.userData.entityId = entity.id;
  refreshDirectorStageObjectContentRoot(group);
  cloneDirectorStageMaterials(group);
  rememberDirectorStageBasePose(group);
  applyEntityTransform(group, entity.transform);
  applyEntityMaterial(group, entity);
  enableEntityShadows(group);
  return group;
}

export async function loadDirectorStageModelSource(modelPath: string): Promise<THREE.Group> {
  const cached = modelSourceCache.get(modelPath);
  if (cached) {
    return cached;
  }
  const promise = loadDirectorStageModelSourceUncached(modelPath);
  modelSourceCache.set(modelPath, promise);
  return promise;
}

async function loadDirectorStageModelSourceUncached(modelPath: string): Promise<THREE.Group> {
  const primitiveKind = parseDirectorStagePrimitivePath(modelPath);
  if (primitiveKind) {
    return createDirectorStagePrimitiveModel(primitiveKind);
  }

  const url = resolveDirectorStageModelUrl(modelPath);
  const lowerUrl = url.toLowerCase();
  const loaded = lowerUrl.includes('.fbx')
    ? await loadFbxDirectorStageModel(url, modelPath)
    : (await gltfLoader.loadAsync(url)).scene;
  const group = new THREE.Group();
  group.add(loaded);
  group.userData[CONTENT_ROOT_KEY] = loaded;
  normalizeDirectorStageObjectContent(group);
  rememberDirectorStageBasePose(group);
  applyDirectorStageClayMaterials(group, '#f2f2ee');
  enableEntityShadows(group);
  return group;
}

async function loadFbxDirectorStageModel(url: string, source: string): Promise<THREE.Group> {
  void source;
  const loader = new FBXLoader(textureSkippingLoadingManager);
  return await loader.loadAsync(url);
}

export function enableEntityShadows(object: THREE.Object3D): void {
  object.traverse((child) => {
    if (!isMesh(child)) {
      return;
    }
    child.castShadow = true;
    child.receiveShadow = true;
  });
}

export function applyEntityTransform(
  object: THREE.Object3D,
  transform: DirectorStageTransform
): void {
  object.position.set(transform.position.x, transform.position.y, transform.position.z);
  object.rotation.set(transform.rotation.x, transform.rotation.y, transform.rotation.z);
  object.scale.set(
    clampDirectorStageScale(transform.scale.x),
    clampDirectorStageScale(transform.scale.y),
    clampDirectorStageScale(transform.scale.z)
  );
  object.updateMatrixWorld(true);
}

export function readEntityTransform(object: THREE.Object3D): DirectorStageTransform {
  return {
    position: {
      x: object.position.x,
      y: object.position.y,
      z: object.position.z,
    },
    rotation: {
      x: object.rotation.x,
      y: object.rotation.y,
      z: object.rotation.z,
    },
    scale: {
      x: object.scale.x,
      y: object.scale.y,
      z: object.scale.z,
    },
  };
}

export function applyEntityMaterial(object: THREE.Object3D, entity: DirectorStageEntity): void {
  if (isDirectorStagePlaneSurfaceEntity(entity)) {
    applyPlaneSurfaceMaterial(object, entity);
    return;
  }
  applyEntityColor(object, entity.color);
}

function isDirectorStagePlaneSurfaceEntity(entity: DirectorStageEntity): boolean {
  return entity.source === 'geometry' && entity.modelPath === 'primitive://plane';
}

function disposePlaneSurfaceTexture(material: THREE.Material): void {
  const texturedMaterial = material as MaterialWithTextureSlots;
  const texture = texturedMaterial[PLANE_SURFACE_TEXTURE_KEY];
  if (isThreeTexture(texture)) {
    texture.dispose();
  }
  texturedMaterial[PLANE_SURFACE_TEXTURE_KEY] = null;
  texturedMaterial[PLANE_SURFACE_TEXTURE_SOURCE_KEY] = null;
  texturedMaterial[PLANE_SURFACE_TEXTURE_STYLE_KEY] = null;
}

function resetPlaneSurfaceMaterial(material: THREE.Material, color: string): void {
  disposePlaneSurfaceTexture(material);
  const texturedMaterial = material as MaterialWithTextureSlots;
  if (isThreeTexture(texturedMaterial.map)) {
    texturedMaterial.map.dispose();
  }
  texturedMaterial.map = null;
  const coloredMaterial = material as MaterialWithColor;
  if (isThreeColor(coloredMaterial.color)) {
    coloredMaterial.color.set(color);
  }
  material.needsUpdate = true;
}

function buildPlaneSurfaceStyleKey(entity: DirectorStageEntity): string {
  const surface = entity.planeSurface;
  return [
    entity.color,
    surface?.fitMode ?? 'contain',
    surface?.imageAspectRatio ?? 'unknown',
    entity.transform.scale.x,
    entity.transform.scale.z,
  ].join('|');
}

function createPlaneSurfaceTexture(
  sourceTexture: THREE.Texture,
  entity: DirectorStageEntity
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = PLANE_SURFACE_TEXTURE_SIZE;
  canvas.height = PLANE_SURFACE_TEXTURE_SIZE;
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Failed to create plane surface canvas');
  }

  context.fillStyle = entity.color;
  context.fillRect(0, 0, canvas.width, canvas.height);

  const image = sourceTexture.image as CanvasImageSource | undefined;
  if (!image) {
    return new THREE.CanvasTexture(canvas);
  }

  const fitMode = entity.planeSurface?.fitMode ?? 'contain';
  const imageAspectRatio = entity.planeSurface?.imageAspectRatio ?? 1;
  const planeAspectRatio = entity.transform.scale.x / Math.max(entity.transform.scale.z, 0.001);
  let drawWidth = canvas.width;
  let drawHeight = canvas.height;
  let drawX = 0;
  let drawY = 0;

  if (fitMode === 'contain' && Number.isFinite(imageAspectRatio) && Number.isFinite(planeAspectRatio)) {
    if (imageAspectRatio > planeAspectRatio) {
      drawHeight = canvas.width / imageAspectRatio * planeAspectRatio;
      drawY = (canvas.height - drawHeight) / 2;
    } else {
      drawWidth = canvas.height * imageAspectRatio / planeAspectRatio;
      drawX = (canvas.width - drawWidth) / 2;
    }
  }

  context.drawImage(image, drawX, drawY, drawWidth, drawHeight);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function applyPlaneSurfaceMaterial(object: THREE.Object3D, entity: DirectorStageEntity): void {
  const imagePath = entity.planeSurface?.imagePath?.trim() ?? '';
  object.traverse((child) => {
    if (!isMesh(child)) {
      return;
    }

    const material = Array.isArray(child.material)
      ? child.material[0] ?? createClayMaterial(entity.color)
      : child.material;
    child.material = material;
    material.side = THREE.DoubleSide;

    if (!imagePath) {
      resetPlaneSurfaceMaterial(material, entity.color);
      return;
    }

    const texturedMaterial = material as MaterialWithTextureSlots;
    const existingSource = typeof texturedMaterial[PLANE_SURFACE_TEXTURE_SOURCE_KEY] === 'string'
      ? texturedMaterial[PLANE_SURFACE_TEXTURE_SOURCE_KEY]
      : null;
    const styleKey = buildPlaneSurfaceStyleKey(entity);
    const existingStyle = typeof texturedMaterial[PLANE_SURFACE_TEXTURE_STYLE_KEY] === 'string'
      ? texturedMaterial[PLANE_SURFACE_TEXTURE_STYLE_KEY]
      : null;
    const existingTexture = texturedMaterial[PLANE_SURFACE_TEXTURE_KEY];
    if (existingSource === imagePath && existingStyle === styleKey && isThreeTexture(existingTexture)) {
      texturedMaterial.map = existingTexture;
      const coloredMaterial = material as MaterialWithColor;
      if (isThreeColor(coloredMaterial.color)) {
        coloredMaterial.color.set('#ffffff');
      }
      material.needsUpdate = true;
      return;
    }

    disposePlaneSurfaceTexture(material);
    texturedMaterial[PLANE_SURFACE_TEXTURE_SOURCE_KEY] = imagePath;
    texturedMaterial[PLANE_SURFACE_TEXTURE_STYLE_KEY] = styleKey;
    const loader = new THREE.TextureLoader();
    loader.load(
      resolveImageDisplayUrl(imagePath),
      (sourceTexture) => {
        if (
          texturedMaterial[PLANE_SURFACE_TEXTURE_SOURCE_KEY] !== imagePath
          || texturedMaterial[PLANE_SURFACE_TEXTURE_STYLE_KEY] !== styleKey
        ) {
          sourceTexture.dispose();
          return;
        }
        const texture = createPlaneSurfaceTexture(sourceTexture, entity);
        sourceTexture.dispose();
        texturedMaterial.map = texture;
        texturedMaterial[PLANE_SURFACE_TEXTURE_KEY] = texture;
        const coloredMaterial = material as MaterialWithColor;
        if (isThreeColor(coloredMaterial.color)) {
          coloredMaterial.color.set('#ffffff');
        }
        material.needsUpdate = true;
      },
      undefined,
      () => {
        if (texturedMaterial[PLANE_SURFACE_TEXTURE_SOURCE_KEY] === imagePath) {
          resetPlaneSurfaceMaterial(material, entity.color);
        }
      }
    );
  });
}

export function applyDirectorStageClayMaterials(object: THREE.Object3D, color: string): void {
  const disposedTextures = new WeakSet<THREE.Texture>();
  const disposedMaterials = new WeakSet<THREE.Material>();
  object.traverse((child) => {
    if (!isMesh(child)) {
      return;
    }

    const materials = Array.isArray(child.material) ? child.material : [child.material];
    materials.forEach((material) => {
      if (material && !disposedMaterials.has(material)) {
        disposeMaterialWithTextures(material, disposedTextures);
        disposedMaterials.add(material);
      }
    });
    child.material = Array.isArray(child.material)
      ? child.material.map(() => createClayMaterial(color))
      : createClayMaterial(color);
  });
}

function cloneDirectorStageMaterials(object: THREE.Object3D): void {
  object.traverse((child) => {
    if (!isMesh(child)) {
      return;
    }
    child.material = Array.isArray(child.material)
      ? child.material.map((material) => material.clone())
      : child.material.clone();
  });
}

export function applyEntityColor(object: THREE.Object3D, color: string): void {
  const nextColor = new THREE.Color(color);
  object.traverse((child) => {
    if (!isMesh(child)) {
      return;
    }

    const materials = Array.isArray(child.material) ? child.material : [child.material];
    materials.forEach((material) => {
      if (!material) {
        return;
      }
      const coloredMaterial = material as MaterialWithColor;
      if (!isThreeColor(coloredMaterial.color)) {
        return;
      }
      coloredMaterial.color.copy(nextColor);
      coloredMaterial.needsUpdate = true;
    });
  });
}

export function disposeDirectorStageObject(object: THREE.Object3D): void {
  object.traverse((child) => {
    if (!isMesh(child)) {
      return;
    }
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    materials.forEach((material) => {
      disposePlaneSurfaceTexture(material);
      material.dispose();
    });
  });
}
