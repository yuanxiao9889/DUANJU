import * as THREE from 'three';

import type {
  DirectorStageBuiltInAsset,
  DirectorStageCrowdGroup,
  DirectorStageCrowdGroupMode,
  DirectorStageEntity,
  DirectorStageProject,
  DirectorStageTransform,
  DirectorStageVector3,
} from '../domain/types';
import {
  DIRECTOR_STAGE_CROWD_CENTER_RADIUS_MAX,
  DIRECTOR_STAGE_CROWD_CENTER_RADIUS_MIN,
  DIRECTOR_STAGE_CROWD_DEFAULT_CENTER_RADIUS,
  DIRECTOR_STAGE_CROWD_MAX_COUNT,
  createStageVector3,
} from '../domain/types';

export {
  DIRECTOR_STAGE_CROWD_CENTER_RADIUS_MAX,
  DIRECTOR_STAGE_CROWD_CENTER_RADIUS_MIN,
  DIRECTOR_STAGE_CROWD_DEFAULT_CENTER_RADIUS,
  DIRECTOR_STAGE_CROWD_MAX_COUNT,
} from '../domain/types';

const FORMATION_SPACING = 0.95;
const CROWD_RADIUS_MAX = 18;
const CROWD_RADIUS_BASE_COUNT = 320;
const CROWD_RADIUS_MAX_SCALE = 8.5;
const CROWD_CORE_SHARE = 0.72;
const CROWD_CORE_RADIUS_RATIO = 0.46;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

export interface DirectorStageCrowdPlacement {
  center: DirectorStageVector3;
  yaw: number;
}

export interface DirectorStageCrowdBuildResult {
  project: DirectorStageProject;
  group: DirectorStageCrowdGroup;
}

function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.max(min, Math.min(max, Math.floor(value)));
}

export function clampDirectorStageCrowdCount(value: number, fallback = 1): number {
  return clampInteger(Number.isFinite(value) ? value : fallback, 1, DIRECTOR_STAGE_CROWD_MAX_COUNT);
}

export function clampDirectorStageCrowdCenterRadius(
  value: number,
  fallback = DIRECTOR_STAGE_CROWD_DEFAULT_CENTER_RADIUS
): number {
  const numericValue = Number.isFinite(value) ? value : fallback;
  const clampedValue = Math.max(
    DIRECTOR_STAGE_CROWD_CENTER_RADIUS_MIN,
    Math.min(DIRECTOR_STAGE_CROWD_CENTER_RADIUS_MAX, numericValue)
  );
  return Math.round(clampedValue * 10) / 10;
}

export function createDirectorStageCrowdPlacement(
  cameraPosition: THREE.Vector3,
  orbitTarget: THREE.Vector3
): DirectorStageCrowdPlacement {
  const center = createStageVector3(orbitTarget.x, 0, orbitTarget.z);
  const directionToCamera = cameraPosition.clone().sub(orbitTarget);
  directionToCamera.y = 0;
  if (directionToCamera.lengthSq() < 0.0001) {
    directionToCamera.set(0, 0, 1);
  } else {
    directionToCamera.normalize();
  }
  return {
    center,
    yaw: Math.atan2(directionToCamera.x, directionToCamera.z),
  };
}

export function createDirectorStageGridCenterCrowdPlacement(
  cameraPosition: THREE.Vector3
): DirectorStageCrowdPlacement {
  return createDirectorStageCrowdPlacement(cameraPosition, new THREE.Vector3(0, 0, 0));
}

function createGroupTransform(placement: DirectorStageCrowdPlacement): DirectorStageTransform {
  return {
    position: placement.center,
    rotation: createStageVector3(0, placement.yaw, 0),
    scale: createStageVector3(1, 1, 1),
  };
}

function createMemberTransform(
  position: DirectorStageVector3,
  rotationY = 0,
  scale = 1
): DirectorStageTransform {
  return {
    position,
    rotation: createStageVector3(0, rotationY, 0),
    scale: createStageVector3(scale, scale, scale),
  };
}

function seededRandom(seed: number, index: number): number {
  const value = Math.sin(seed * 12.9898 + index * 78.233) * 43758.5453;
  return value - Math.floor(value);
}

function findPosePresetId(asset: DirectorStageBuiltInAsset, matcher: (value: string) => boolean): string | null {
  return asset.posePresetIds.find((id) => matcher(id.toLowerCase())) ?? null;
}

function resolveCrowdPosePresetPool(asset: DirectorStageBuiltInAsset): Array<string | null> {
  const pool: Array<string | null> = [];
  const pushUnique = (posePresetId: string | null) => {
    if (!pool.includes(posePresetId)) {
      pool.push(posePresetId);
    }
  };

  pushUnique(findPosePresetId(asset, (id) => id.includes('idle')) ?? null);
  const walkingPoseId = findPosePresetId(asset, (id) => id.includes('walking'));
  if (walkingPoseId) {
    pushUnique(walkingPoseId);
  }
  const fastPoseId = findPosePresetId((asset), (id) =>
    id.includes('fast-run')
    || id.includes('fast_run')
    || id.includes('fastrun')
    || id.includes('running')
  );
  if (fastPoseId) {
    pushUnique(fastPoseId);
  }

  return pool.length > 0 ? pool : [asset.posePresetIds[0] ?? null];
}

function resolvePosePresetId(
  asset: DirectorStageBuiltInAsset,
  mode: DirectorStageCrowdGroupMode,
  seed: number,
  memberIndex: number
): string | null {
  if (mode !== 'crowd') {
    return asset.posePresetIds[0] ?? null;
  }
  const pool = resolveCrowdPosePresetPool(asset);
  const poseIndex = Math.floor(seededRandom(seed, memberIndex * 5 + 11) * pool.length);
  return pool[Math.max(0, Math.min(pool.length - 1, poseIndex))];
}

function createCrowdMemberEntity(params: {
  asset: DirectorStageBuiltInAsset;
  groupId: string;
  groupName: string;
  memberIndex: number;
  transform: DirectorStageTransform;
  posePresetId: string | null;
  now: number;
}): DirectorStageEntity {
  return {
    id: `${params.asset.id}-${params.groupId}-${params.now}-${params.memberIndex}`,
    kind: params.asset.kind,
    source: params.asset.source,
    assetId: params.asset.id,
    name: `${params.groupName} ${params.memberIndex + 1}`,
    modelPath: params.asset.modelPath,
    previewPath: params.asset.previewPath,
    transform: params.transform,
    color: params.asset.defaultColor,
    posePresetId: params.posePresetId,
    posePath: null,
    crowdGroupId: params.groupId,
    crowdMemberIndex: params.memberIndex,
    skeletonCompatible: true,
    loadError: null,
    createdAt: params.now,
    updatedAt: params.now,
  };
}

function resolveCrowdRadiusRange(count: number, centerRadius: number): { min: number; max: number } {
  const densityScale = Math.sqrt(Math.max(1, count) / CROWD_RADIUS_BASE_COUNT);
  const radiusScale = Math.max(1, Math.min(CROWD_RADIUS_MAX_SCALE, densityScale));
  return {
    min: centerRadius,
    max: centerRadius + CROWD_RADIUS_MAX * radiusScale,
  };
}

function createFormationTransforms(columns: number, rows: number): DirectorStageTransform[] {
  const transforms: DirectorStageTransform[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      transforms.push(
        createMemberTransform(
          createStageVector3(
            (column - (columns - 1) / 2) * FORMATION_SPACING,
            0,
            (row - (rows - 1) / 2) * FORMATION_SPACING
          )
        )
      );
    }
  }
  return transforms;
}

function createCrowdTransforms(count: number, seed: number, centerRadius: number): DirectorStageTransform[] {
  const radiusRange = resolveCrowdRadiusRange(count, centerRadius);
  return Array.from({ length: count }, (_, index) => {
    const radialSlot = (index + seededRandom(seed, index * 7 + 2)) / Math.max(1, count);
    const baseRadiusRatio = radialSlot < CROWD_CORE_SHARE
      ? Math.pow(radialSlot / CROWD_CORE_SHARE, 0.68) * CROWD_CORE_RADIUS_RATIO
      : CROWD_CORE_RADIUS_RATIO
        + Math.pow((radialSlot - CROWD_CORE_SHARE) / (1 - CROWD_CORE_SHARE), 1.55)
          * (1 - CROWD_CORE_RADIUS_RATIO);
    const radiusJitter = (seededRandom(seed, index * 7 + 3) - 0.5) * (0.035 + baseRadiusRatio * 0.045);
    const radiusRatio = Math.max(0, Math.min(1, baseRadiusRatio + radiusJitter));
    const radius = radiusRange.min + (radiusRange.max - radiusRange.min) * radiusRatio;
    const angleJitter = (seededRandom(seed, index * 7 + 1) - 0.5) * (0.18 + radiusRatio * 0.22);
    const angle = index * GOLDEN_ANGLE + angleJitter;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    const directionToCenter = new THREE.Vector2(-x, -z);
    const rotationJitter = (seededRandom(seed, index * 7 + 4) - 0.5) * 0.36;
    const scale = 0.92 + seededRandom(seed, index * 7 + 5) * 0.16;
    return createMemberTransform(
      createStageVector3(x, 0, z),
      Math.atan2(directionToCenter.x, directionToCenter.y) + rotationJitter,
      scale
    );
  });
}

function createCrowdMembers(params: {
  asset: DirectorStageBuiltInAsset;
  groupId: string;
  groupName: string;
  mode: DirectorStageCrowdGroupMode;
  transforms: DirectorStageTransform[];
  now: number;
}): DirectorStageEntity[] {
  return params.transforms.map((transform, memberIndex) =>
    createCrowdMemberEntity({
      asset: params.asset,
      groupId: params.groupId,
      groupName: params.groupName,
      memberIndex,
      transform,
      posePresetId: resolvePosePresetId(params.asset, params.mode, params.now, memberIndex),
      now: params.now,
    })
  );
}

export function createDirectorStageCrowdMemberEntities(
  group: DirectorStageCrowdGroup,
  asset: DirectorStageBuiltInAsset
): DirectorStageEntity[] {
  const count = clampDirectorStageCrowdCount(group.layout.count);
  const transforms = group.mode === 'formation'
    ? createFormationTransforms(
        group.layout.columns ?? count,
        group.layout.rows ?? Math.max(1, Math.ceil(count / Math.max(1, group.layout.columns ?? count)))
      ).slice(0, count)
    : createCrowdTransforms(
        count,
        group.layout.seed,
        group.layout.centerRadius ?? DIRECTOR_STAGE_CROWD_DEFAULT_CENTER_RADIUS
      );
  return createCrowdMembers({
    asset,
    groupId: group.id,
    groupName: group.name,
    mode: group.mode,
    transforms,
    now: group.layout.seed,
  });
}

export function createDirectorStageFormationGroup(params: {
  project: DirectorStageProject;
  asset: DirectorStageBuiltInAsset;
  groupName: string;
  columns: number;
  rows: number;
  placement: DirectorStageCrowdPlacement;
}): DirectorStageCrowdBuildResult {
  const now = Date.now();
  const columns = clampInteger(params.columns, 1, DIRECTOR_STAGE_CROWD_MAX_COUNT);
  const rows = clampInteger(params.rows, 1, Math.max(1, Math.floor(DIRECTOR_STAGE_CROWD_MAX_COUNT / columns)));
  const transforms = createFormationTransforms(columns, rows);
  const groupId = `formation-${params.asset.id}-${now}`;
  const group: DirectorStageCrowdGroup = {
    id: groupId,
    mode: 'formation',
    name: params.groupName,
    assetId: params.asset.id,
    entityIds: [],
    transform: createGroupTransform(params.placement),
    layout: {
      count: transforms.length,
      spacing: FORMATION_SPACING,
      seed: now,
      columns,
      rows,
    },
    createdAt: now,
    updatedAt: now,
  };

  return {
    project: {
      ...params.project,
      entities: params.project.entities,
      crowdGroups: [...params.project.crowdGroups, group],
      selectedEntityId: null,
      selectedCrowdGroupId: group.id,
      selectedLightId: null,
      isFreeView: true,
      updatedAt: now,
    },
    group,
  };
}

export function upsertDirectorStageCrowdGroup(params: {
  project: DirectorStageProject;
  asset: DirectorStageBuiltInAsset;
  groupName: string;
  count: number;
  centerRadius?: number;
  placement: DirectorStageCrowdPlacement;
}): DirectorStageCrowdBuildResult {
  const now = Date.now();
  const count = clampDirectorStageCrowdCount(params.count);
  const centerRadius = clampDirectorStageCrowdCenterRadius(
    params.centerRadius ?? Number.NaN,
    DIRECTOR_STAGE_CROWD_DEFAULT_CENTER_RADIUS
  );
  const existingGroup = params.project.crowdGroups.find((group) => group.mode === 'crowd') ?? null;
  const groupId = existingGroup?.id ?? `crowd-${params.asset.id}-${now}`;
  const seed = existingGroup?.layout.seed ?? now;
  const radiusRange = resolveCrowdRadiusRange(count, centerRadius);
  const groupTransform = existingGroup?.transform ?? createGroupTransform(params.placement);
  const group: DirectorStageCrowdGroup = {
    id: groupId,
    mode: 'crowd',
    name: existingGroup?.name ?? params.groupName,
    assetId: params.asset.id,
    entityIds: [],
    transform: groupTransform,
    layout: {
      count,
      spacing: FORMATION_SPACING,
      seed,
      radiusMin: radiusRange.min,
      radiusMax: radiusRange.max,
      centerRadius,
    },
    createdAt: existingGroup?.createdAt ?? now,
    updatedAt: now,
  };
  const nextGroups = existingGroup
    ? params.project.crowdGroups.map((item) => (item.id === existingGroup.id ? group : item))
    : [...params.project.crowdGroups, group];

  return {
    project: {
      ...params.project,
      entities: params.project.entities.filter((entity) => entity.crowdGroupId !== groupId),
      crowdGroups: nextGroups,
      selectedEntityId: null,
      selectedCrowdGroupId: group.id,
      selectedLightId: null,
      isFreeView: true,
      updatedAt: now,
    },
    group,
  };
}

export function patchDirectorStageCrowdGroup(
  project: DirectorStageProject,
  groupId: string,
  patch: Partial<DirectorStageCrowdGroup>
): DirectorStageProject {
  const now = Date.now();
  return {
    ...project,
    crowdGroups: project.crowdGroups.map((group) =>
      group.id === groupId
        ? {
            ...group,
            ...patch,
            updatedAt: now,
          }
        : group
    ),
    updatedAt: now,
  };
}

export function deleteDirectorStageCrowdGroup(
  project: DirectorStageProject,
  groupId: string
): DirectorStageProject {
  const group = project.crowdGroups.find((item) => item.id === groupId);
  if (!group) {
    return project;
  }
  const now = Date.now();
  return {
    ...project,
    entities: project.entities.filter((entity) => entity.crowdGroupId !== groupId),
    crowdGroups: project.crowdGroups.filter((item) => item.id !== groupId),
    selectedCrowdGroupId:
      project.selectedCrowdGroupId === groupId ? null : project.selectedCrowdGroupId,
    updatedAt: now,
  };
}

export function replaceDirectorStageCrowdGroupCount(params: {
  project: DirectorStageProject;
  group: DirectorStageCrowdGroup;
  asset: DirectorStageBuiltInAsset;
  count: number;
  centerRadius?: number;
}): DirectorStageCrowdBuildResult {
  return upsertDirectorStageCrowdGroup({
    project: params.project,
    asset: params.asset,
    groupName: params.group.name,
    count: params.count,
    centerRadius: params.centerRadius ?? params.group.layout.centerRadius,
    placement: {
      center: createStageVector3(0, 0, 0),
      yaw: params.group.transform.rotation.y,
    },
  });
}
