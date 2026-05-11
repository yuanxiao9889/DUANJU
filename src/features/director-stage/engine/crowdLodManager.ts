import * as THREE from 'three';
import { SimplifyModifier } from 'three/examples/jsm/modifiers/SimplifyModifier.js';
import { clone as cloneSkeletonObject } from 'three/examples/jsm/utils/SkeletonUtils.js';

import { getDirectorStagePosePreset } from '../assets/directorStageAssetRegistry';
import type {
  DirectorStageBuiltInAsset,
  DirectorStageCrowdGroup,
  DirectorStageEntity,
  DirectorStageTransform,
} from '../domain/types';
import { createDirectorStageCrowdMemberEntities } from './crowdManager';
import {
  applyEntityTransform,
  loadDirectorStageModelSource,
  normalizeDirectorStageObjectContent,
  refreshDirectorStageObjectContentRoot,
} from './objectManager';
import { applyPosePresetToObject, rememberDirectorStageBasePose } from './poseManager';

export type DirectorStageCrowdLodProgressPhase =
  | 'queued'
  | 'loading'
  | 'posing'
  | 'baking'
  | 'preparing'
  | 'instancing'
  | 'ready';

export interface DirectorStageCrowdLodProgress {
  phase: DirectorStageCrowdLodProgressPhase;
  progress: number;
  completed: number;
  total: number;
}

type CrowdLodProgressCallback = (progress: DirectorStageCrowdLodProgress) => void;

interface BakedCrowdGeometryPart {
  name: string;
  geometry: THREE.BufferGeometry;
}

interface CrowdMemberBucket {
  key: string;
  modelPath: string;
  posePresetId: string | null;
  color: string;
  entities: DirectorStageEntity[];
}

const DEFAULT_CROWD_COLOR = '#d9c6ad';
const bakedGeometryCache = new Map<string, Promise<BakedCrowdGeometryPart[]>>();
const simplifyModifier = new SimplifyModifier();

function clampProgress(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}

function notifyCrowdLodProgress(
  onProgress: CrowdLodProgressCallback | undefined,
  progress: DirectorStageCrowdLodProgress
): void {
  onProgress?.({
    ...progress,
    progress: clampProgress(progress.progress),
  });
}

function yieldToBrowser(): Promise<void> {
  if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => resolve());
  });
}

function isMesh(object: THREE.Object3D): object is THREE.Mesh {
  return (object as THREE.Mesh).isMesh === true;
}

function isInstancedMesh(object: THREE.Object3D): object is THREE.InstancedMesh {
  return (object as THREE.InstancedMesh).isInstancedMesh === true;
}

function createCrowdMaterial(color: string): THREE.MeshStandardMaterial {
  const resolvedColor = new THREE.Color(DEFAULT_CROWD_COLOR);
  try {
    resolvedColor.set(color);
  } catch {
    resolvedColor.set(DEFAULT_CROWD_COLOR);
  }

  return new THREE.MeshStandardMaterial({
    color: resolvedColor,
    roughness: 0.78,
    metalness: 0,
    envMapIntensity: 0.14,
  });
}

function createTransformMatrix(transform: DirectorStageTransform): THREE.Matrix4 {
  const position = new THREE.Vector3(
    transform.position.x,
    transform.position.y,
    transform.position.z
  );
  const quaternion = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(transform.rotation.x, transform.rotation.y, transform.rotation.z)
  );
  const scale = new THREE.Vector3(
    transform.scale.x,
    transform.scale.y,
    transform.scale.z
  );
  return new THREE.Matrix4().compose(position, quaternion, scale);
}

function createAttributeVector2(
  attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute | undefined,
  index: number,
  target: THREE.Vector2
): THREE.Vector2 {
  if (!attribute || attribute.itemSize < 2) {
    return target.set(0, 0);
  }
  return target.set(attribute.getX(index), attribute.getY(index));
}

function copyGeometryIndex(
  sourceGeometry: THREE.BufferGeometry,
  targetGeometry: THREE.BufferGeometry
): void {
  const sourceIndex = sourceGeometry.getIndex();
  if (!sourceIndex) {
    return;
  }

  const indices: number[] = [];
  for (let index = 0; index < sourceIndex.count; index += 1) {
    indices.push(sourceIndex.getX(index));
  }
  targetGeometry.setIndex(indices);
}

function bakeMeshGeometry(mesh: THREE.Mesh, rootInverseMatrix: THREE.Matrix4): THREE.BufferGeometry | null {
  const sourceGeometry = mesh.geometry;
  const positionAttribute = sourceGeometry.getAttribute('position');
  if (!positionAttribute || positionAttribute.count < 3) {
    return null;
  }

  const uvAttribute = sourceGeometry.getAttribute('uv');
  const positions = new Float32Array(positionAttribute.count * 3);
  const uvs = uvAttribute ? new Float32Array(positionAttribute.count * 2) : null;
  const vertex = new THREE.Vector3();
  const uv = new THREE.Vector2();

  for (let index = 0; index < positionAttribute.count; index += 1) {
    mesh.getVertexPosition(index, vertex);
    vertex.applyMatrix4(mesh.matrixWorld).applyMatrix4(rootInverseMatrix);
    positions[index * 3] = vertex.x;
    positions[index * 3 + 1] = vertex.y;
    positions[index * 3 + 2] = vertex.z;

    if (uvs) {
      createAttributeVector2(uvAttribute, index, uv);
      uvs[index * 2] = uv.x;
      uvs[index * 2 + 1] = uv.y;
    }
  }

  const bakedGeometry = new THREE.BufferGeometry();
  bakedGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  if (uvs) {
    bakedGeometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  }
  copyGeometryIndex(sourceGeometry, bakedGeometry);
  bakedGeometry.computeVertexNormals();
  bakedGeometry.computeBoundingBox();
  bakedGeometry.computeBoundingSphere();
  return bakedGeometry;
}

function hasUsablePositionAttribute(geometry: THREE.BufferGeometry): boolean {
  const positionAttribute = geometry.getAttribute('position');
  return Boolean(positionAttribute && positionAttribute.count >= 3);
}

function resolveCrowdGeometryQuality(memberCount: number): number {
  if (memberCount <= 500) {
    return 1;
  }
  if (memberCount <= 2000) {
    return 0.92;
  }
  if (memberCount <= 5000) {
    return 0.86;
  }
  return 0.8;
}

function getCrowdGeometryQualityKey(quality: number): string {
  if (quality >= 0.995) {
    return 'full';
  }
  return `q${Math.round(quality * 100)}`;
}

function isSimplifiedGeometryAcceptable(
  source: THREE.BufferGeometry,
  simplified: THREE.BufferGeometry,
  quality: number
): boolean {
  const sourcePosition = source.getAttribute('position');
  const simplifiedPosition = simplified.getAttribute('position');
  if (!sourcePosition || !simplifiedPosition || simplifiedPosition.count < 24) {
    return false;
  }

  const minimumVertexCount = Math.max(24, Math.floor(sourcePosition.count * quality * 0.65));
  if (simplifiedPosition.count < minimumVertexCount) {
    return false;
  }

  source.computeBoundingBox();
  simplified.computeBoundingBox();
  const sourceBox = source.boundingBox;
  const simplifiedBox = simplified.boundingBox;
  if (!sourceBox || !simplifiedBox || sourceBox.isEmpty() || simplifiedBox.isEmpty()) {
    return false;
  }

  const sourceSize = sourceBox.getSize(new THREE.Vector3());
  const simplifiedSize = simplifiedBox.getSize(new THREE.Vector3());
  const sourceMaxAxis = Math.max(sourceSize.x, sourceSize.y, sourceSize.z);
  const simplifiedMaxAxis = Math.max(simplifiedSize.x, simplifiedSize.y, simplifiedSize.z);
  return sourceMaxAxis <= 0 || simplifiedMaxAxis / sourceMaxAxis > 0.82;
}

function simplifyBakedGeometry(
  geometry: THREE.BufferGeometry,
  quality: number
): THREE.BufferGeometry {
  if (quality >= 0.995) {
    return geometry;
  }

  const positionAttribute = geometry.getAttribute('position');
  if (!positionAttribute || positionAttribute.count < 200) {
    return geometry;
  }

  const removeCount = Math.floor(positionAttribute.count * (1 - quality));
  if (removeCount <= 0) {
    return geometry;
  }

  try {
    const simplified = simplifyModifier.modify(geometry, removeCount);
    if (!hasUsablePositionAttribute(simplified) || !isSimplifiedGeometryAcceptable(geometry, simplified, quality)) {
      simplified.dispose();
      return geometry;
    }
    simplified.computeVertexNormals();
    simplified.computeBoundingBox();
    simplified.computeBoundingSphere();
    return simplified;
  } catch {
    return geometry;
  }
}

function updateSkinnedMeshSkeletons(object: THREE.Object3D): void {
  object.traverse((child) => {
    const skinnedMesh = child as THREE.SkinnedMesh;
    if (skinnedMesh.isSkinnedMesh === true) {
      skinnedMesh.skeleton.update();
    }
  });
}

async function bakeCrowdGeometryParts(
  modelPath: string,
  posePresetId: string | null,
  geometryQuality: number,
  onProgress?: CrowdLodProgressCallback
): Promise<BakedCrowdGeometryPart[]> {
  notifyCrowdLodProgress(onProgress, {
    phase: 'loading',
    progress: 0.08,
    completed: 0,
    total: 1,
  });
  await yieldToBrowser();
  const source = await loadDirectorStageModelSource(modelPath);
  const workingObject = cloneSkeletonObject(source) as THREE.Group;
  refreshDirectorStageObjectContentRoot(workingObject);
  rememberDirectorStageBasePose(workingObject);

  const posePreset = getDirectorStagePosePreset(posePresetId);
  if (posePreset) {
    notifyCrowdLodProgress(onProgress, {
      phase: 'posing',
      progress: 0.2,
      completed: 0,
      total: 1,
    });
    await yieldToBrowser();
    await applyPosePresetToObject(workingObject, posePreset);
  }

  notifyCrowdLodProgress(onProgress, {
    phase: 'baking',
    progress: 0.32,
    completed: 0,
    total: 1,
  });
  await yieldToBrowser();
  normalizeDirectorStageObjectContent(workingObject);
  workingObject.updateWorldMatrix(true, true);
  updateSkinnedMeshSkeletons(workingObject);

  const rootInverseMatrix = workingObject.matrixWorld.clone().invert();
  const parts: BakedCrowdGeometryPart[] = [];
  const meshes: THREE.Mesh[] = [];
  let partIndex = 0;

  workingObject.traverse((child) => {
    if (!isMesh(child) || child.visible === false) {
      return;
    }
    meshes.push(child);
  });

  const totalMeshes = Math.max(1, meshes.length);
  for (const child of meshes) {
    notifyCrowdLodProgress(onProgress, {
      phase: 'baking',
      progress: 0.32 + (partIndex / totalMeshes) * 0.2,
      completed: partIndex,
      total: totalMeshes,
    });
    await yieldToBrowser();
    const bakedGeometry = bakeMeshGeometry(child, rootInverseMatrix);
    if (!bakedGeometry) {
      continue;
    }
    const finalGeometry = simplifyBakedGeometry(bakedGeometry, geometryQuality);

    notifyCrowdLodProgress(onProgress, {
      phase: 'preparing',
      progress: 0.56 + (partIndex / totalMeshes) * 0.28,
      completed: partIndex,
      total: totalMeshes,
    });
    await yieldToBrowser();

    if (!hasUsablePositionAttribute(finalGeometry)) {
      finalGeometry.dispose();
      if (finalGeometry !== bakedGeometry) {
        bakedGeometry.dispose();
      }
      continue;
    }

    parts.push({
      name: child.name || `part-${partIndex + 1}`,
      geometry: finalGeometry,
    });
    if (finalGeometry !== bakedGeometry) {
      bakedGeometry.dispose();
    }
    partIndex += 1;
  }

  workingObject.clear();
  return parts;
}

function getBakedGeometryParts(
  modelPath: string,
  posePresetId: string | null,
  geometryQuality: number,
  onProgress?: CrowdLodProgressCallback
): Promise<BakedCrowdGeometryPart[]> {
  const cacheKey = [
    modelPath,
    posePresetId ?? 'base',
    'static-baked',
    getCrowdGeometryQualityKey(geometryQuality),
    'v2',
  ].join('|');
  const cached = bakedGeometryCache.get(cacheKey);
  if (cached) {
    notifyCrowdLodProgress(onProgress, {
      phase: 'preparing',
      progress: 0.86,
      completed: 1,
      total: 1,
    });
    return cached;
  }

  const promise = bakeCrowdGeometryParts(modelPath, posePresetId, geometryQuality, onProgress).catch((error) => {
    bakedGeometryCache.delete(cacheKey);
    throw error;
  });
  bakedGeometryCache.set(cacheKey, promise);
  return promise;
}

function createCrowdMemberBuckets(entities: DirectorStageEntity[]): CrowdMemberBucket[] {
  const buckets = new Map<string, CrowdMemberBucket>();
  entities.forEach((entity) => {
    const posePresetId = entity.posePresetId ?? null;
    const color = entity.color || DEFAULT_CROWD_COLOR;
    const key = [entity.modelPath, posePresetId ?? 'base', color].join('|');
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = {
        key,
        modelPath: entity.modelPath,
        posePresetId,
        color,
        entities: [],
      };
      buckets.set(key, bucket);
    }
    bucket.entities.push(entity);
  });
  return [...buckets.values()].sort((left, right) => left.key.localeCompare(right.key));
}

export async function loadDirectorStageCrowdLodGroup(params: {
  group: DirectorStageCrowdGroup;
  asset?: DirectorStageBuiltInAsset | null;
  entities?: DirectorStageEntity[];
  onProgress?: CrowdLodProgressCallback;
}): Promise<THREE.Group> {
  const sourceEntities = params.entities && params.entities.length > 0
    ? params.entities
    : params.asset
      ? createDirectorStageCrowdMemberEntities(params.group, params.asset)
      : [];
  const entityById = new Map(sourceEntities.map((entity) => [entity.id, entity]));
  const orderedEntities = params.group.entityIds.length > 0
    ? params.group.entityIds
        .map((entityId) => entityById.get(entityId) ?? null)
        .filter((entity): entity is DirectorStageEntity => entity !== null)
    : sourceEntities;
  notifyCrowdLodProgress(params.onProgress, {
    phase: 'queued',
    progress: 0.02,
    completed: 0,
    total: Math.max(1, orderedEntities.length),
  });
  await yieldToBrowser();
  const groupObject = new THREE.Group();
  groupObject.name = params.group.name;
  groupObject.userData.crowdGroupId = params.group.id;
  groupObject.userData.directorStageCrowdLod = true;

  const buckets = createCrowdMemberBuckets(orderedEntities);
  const totalBuckets = Math.max(1, buckets.length);
  const geometryQuality = resolveCrowdGeometryQuality(orderedEntities.length);
  const shouldReceiveShadow = orderedEntities.length <= 500;
  for (const [bucketIndex, bucket] of buckets.entries()) {
    const bucketStartProgress = 0.04 + (bucketIndex / totalBuckets) * 0.78;
    const bucketEndProgress = 0.04 + ((bucketIndex + 1) / totalBuckets) * 0.78;
    const bucketProgressSpan = bucketEndProgress - bucketStartProgress;
    const bakedParts = await getBakedGeometryParts(
      bucket.modelPath,
      bucket.posePresetId,
      geometryQuality,
      (progress) => {
        notifyCrowdLodProgress(params.onProgress, {
          ...progress,
          progress: bucketStartProgress + progress.progress * bucketProgressSpan * 0.8,
        });
      }
    );
    notifyCrowdLodProgress(params.onProgress, {
      phase: 'instancing',
      progress: bucketStartProgress + bucketProgressSpan * 0.82,
      completed: bucketIndex,
      total: totalBuckets,
    });
    await yieldToBrowser();
    bakedParts.forEach((part, partIndex) => {
      const material = createCrowdMaterial(bucket.color);
      const instancedMesh = new THREE.InstancedMesh(part.geometry, material, bucket.entities.length);
      instancedMesh.name = `${params.group.name} ${part.name}`;
      instancedMesh.userData.crowdGroupId = params.group.id;
      instancedMesh.userData.directorStageCrowdLod = true;
      instancedMesh.userData.directorStageCrowdPartIndex = partIndex;
      instancedMesh.castShadow = false;
      instancedMesh.receiveShadow = shouldReceiveShadow;
      instancedMesh.frustumCulled = true;

      bucket.entities.forEach((entity, instanceIndex) => {
        instancedMesh.setMatrixAt(instanceIndex, createTransformMatrix(entity.transform));
      });
      instancedMesh.instanceMatrix.needsUpdate = true;
      instancedMesh.computeBoundingBox();
      instancedMesh.computeBoundingSphere();
      groupObject.add(instancedMesh);
      notifyCrowdLodProgress(params.onProgress, {
        phase: 'instancing',
        progress: bucketStartProgress + bucketProgressSpan * (0.84 + ((partIndex + 1) / bakedParts.length) * 0.16),
        completed: bucketIndex + 1,
        total: totalBuckets,
      });
    });
  }

  applyEntityTransform(groupObject, params.group.transform);
  notifyCrowdLodProgress(params.onProgress, {
    phase: 'ready',
    progress: 1,
    completed: totalBuckets,
    total: totalBuckets,
  });
  return groupObject;
}

export function disposeDirectorStageCrowdLodGroup(group: THREE.Object3D): void {
  const disposedMaterials = new WeakSet<THREE.Material>();
  group.traverse((child) => {
    if (!isMesh(child) && !isInstancedMesh(child)) {
      return;
    }
    const material = (child as THREE.Mesh).material;
    const materials = Array.isArray(material) ? material : [material];
    materials.forEach((item) => {
      if (!item || disposedMaterials.has(item)) {
        return;
      }
      item.dispose();
      disposedMaterials.add(item);
    });
  });
  group.clear();
}
