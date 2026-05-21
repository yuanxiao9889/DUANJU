import {
  fovToFocalLength,
  normalizeCameraShotLens,
} from './cameraLens';

export type DirectorStageEntityKind = 'character' | 'model' | 'prop' | 'scene';
export type DirectorStageEntitySource = 'a3d' | 'user' | 'geometry';
export type DirectorStageLightKind = 'ambient' | 'directional' | 'point' | 'spot';
export type DirectorStageTransformMode = 'translate' | 'rotate' | 'scale';
export type DirectorStageCrowdGroupMode = 'formation' | 'crowd';
export type DirectorStagePlaneSurfaceFitMode = 'contain' | 'stretch';
export type DirectorStagePlaneAspectRatioPreset = '1:1' | '4:3' | '16:9' | '9:16' | 'custom';
export type DirectorStageSnapshotAspectRatio = typeof DIRECTOR_STAGE_SNAPSHOT_ASPECT_RATIOS[number];
export type DirectorStageLimbPoseKey = typeof DIRECTOR_STAGE_LIMB_POSE_KEYS[number];

export interface DirectorStageVector3 {
  x: number;
  y: number;
  z: number;
}

export interface DirectorStageTransform {
  position: DirectorStageVector3;
  rotation: DirectorStageVector3;
  scale: DirectorStageVector3;
}

export type DirectorStageLimbPose = Partial<Record<DirectorStageLimbPoseKey, DirectorStageVector3>>;

export interface DirectorStagePlaneSurface {
  imagePath: string | null;
  imageName: string | null;
  imageAspectRatio: number | null;
  fitMode: DirectorStagePlaneSurfaceFitMode;
  aspectRatioPreset: DirectorStagePlaneAspectRatioPreset;
  customAspectRatio: number;
}

export interface DirectorStageEntity {
  id: string;
  kind: DirectorStageEntityKind;
  source: DirectorStageEntitySource;
  assetId: string;
  name: string;
  modelPath: string;
  previewPath?: string | null;
  transform: DirectorStageTransform;
  color: string;
  posePresetId?: string | null;
  posePath?: string | null;
  limbPose?: DirectorStageLimbPose;
  crowdGroupId?: string | null;
  crowdMemberIndex?: number | null;
  skeletonCompatible?: boolean | null;
  planeSurface?: DirectorStagePlaneSurface;
  loadError?: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface DirectorStageCrowdLayout {
  count: number;
  spacing: number;
  seed: number;
  columns?: number;
  rows?: number;
  radiusMin?: number;
  radiusMax?: number;
  centerRadius?: number;
}

export interface DirectorStageCrowdGroup {
  id: string;
  mode: DirectorStageCrowdGroupMode;
  name: string;
  assetId: string;
  entityIds: string[];
  transform: DirectorStageTransform;
  layout: DirectorStageCrowdLayout;
  createdAt: number;
  updatedAt: number;
}

export interface DirectorStageLight {
  id: string;
  kind: DirectorStageLightKind;
  name: string;
  color: string;
  intensity: number;
  enabled: boolean;
  position: DirectorStageVector3;
  target: DirectorStageVector3;
  distance?: number;
  angle?: number;
  penumbra?: number;
}

export interface DirectorStageCameraShot {
  id: string;
  name: string;
  position: DirectorStageVector3;
  target: DirectorStageVector3;
  fov: number;
  focalLengthMm: number;
  createdAt: number;
  updatedAt: number;
}

export interface DirectorStageEnvironment {
  id: string;
  name: string;
  backgroundPath: string | null;
  previewPath: string | null;
}

export interface DirectorStageSnapshotSettings {
  aspectRatio: DirectorStageSnapshotAspectRatio;
  showMask: boolean;
}

export interface DirectorStageConnectedEnvironment {
  id: string;
  name: string;
  backgroundPath: string;
  previewPath: string | null;
  sourceNodeId: string;
  sourceEdgeId: string;
}

export interface DirectorStageProject {
  version: 1;
  entities: DirectorStageEntity[];
  crowdGroups: DirectorStageCrowdGroup[];
  lights: DirectorStageLight[];
  cameraShots: DirectorStageCameraShot[];
  activeCameraShotId: string | null;
  isFreeView: boolean;
  selectedEntityId: string | null;
  selectedCrowdGroupId: string | null;
  selectedLightId: string | null;
  transformMode: DirectorStageTransformMode;
  showGroundGrid: boolean;
  environment: DirectorStageEnvironment;
  snapshot: DirectorStageSnapshotSettings;
  updatedAt: number;
}

export interface DirectorStagePosePreset {
  id: string;
  labelKey: string;
  animationPath: string;
  restPosePath?: string;
  sampleRatio: number;
  compatibleAssetIds: string[];
}

export interface DirectorStageBuiltInAsset {
  id: string;
  labelKey: string;
  kind: DirectorStageEntityKind;
  source: DirectorStageEntitySource;
  modelPath: string;
  previewPath: string | null;
  defaultColor: string;
  posePresetIds: string[];
}

export interface DirectorStageSkyboxPreset {
  id: string;
  labelKey: string;
  backgroundPath: string;
  previewPath: string;
}

export interface DirectorStageAssetPack {
  id: string;
  labelKey: string;
  sourceUrl: string;
  sourceCommit: string;
  licensePath: string;
  noticePath: string;
  characters: DirectorStageBuiltInAsset[];
  posePresets: DirectorStagePosePreset[];
  skyboxes: DirectorStageSkyboxPreset[];
}

export const DIRECTOR_STAGE_PROJECT_VERSION = 1 as const;
export const DIRECTOR_STAGE_DEFAULT_ENVIRONMENT_ID = 'studio-grid';
export const DIRECTOR_STAGE_CROWD_MAX_COUNT = 20000;
export const DIRECTOR_STAGE_CROWD_CENTER_RADIUS_MIN = 0;
export const DIRECTOR_STAGE_CROWD_CENTER_RADIUS_MAX = 30;
export const DIRECTOR_STAGE_CROWD_DEFAULT_CENTER_RADIUS = 4.5;
export const DIRECTOR_STAGE_MIN_SCALE = 0.02;
export const DIRECTOR_STAGE_MAX_SCALE = 8;
export const DIRECTOR_STAGE_SNAPSHOT_HELPER_USER_DATA_KEY = 'directorStageSnapshotHelper';
export const DIRECTOR_STAGE_SNAPSHOT_ASPECT_RATIOS = [
  '16:9',
  '9:16',
  '1:1',
  '4:5',
  '3:4',
  '2:1',
  '21:9',
] as const;
export const DIRECTOR_STAGE_DEFAULT_SNAPSHOT_ASPECT_RATIO: DirectorStageSnapshotAspectRatio = '16:9';
export const DIRECTOR_STAGE_LIMB_POSE_KEYS = [
  'head',
  'neck',
  'leftUpperArm',
  'leftForeArm',
  'rightUpperArm',
  'rightForeArm',
  'leftUpperLeg',
  'leftLowerLeg',
  'rightUpperLeg',
  'rightLowerLeg',
] as const;
export const DIRECTOR_STAGE_LIMB_ROTATION_MIN = -Math.PI / 2;
export const DIRECTOR_STAGE_LIMB_ROTATION_MAX = Math.PI / 2;
export const DIRECTOR_STAGE_DEFAULT_PLANE_ASPECT_RATIO = 1;
export const DIRECTOR_STAGE_PLANE_ASPECT_RATIO_MIN = 0.1;
export const DIRECTOR_STAGE_PLANE_ASPECT_RATIO_MAX = 10;

export function createStageVector3(x: number, y: number, z: number): DirectorStageVector3 {
  return { x, y, z };
}

export function createDefaultDirectorStageTransform(): DirectorStageTransform {
  return {
    position: createStageVector3(0, 0, 0),
    rotation: createStageVector3(0, 0, 0),
    scale: createStageVector3(1, 1, 1),
  };
}

export function createDefaultDirectorStageCameraShot(now = Date.now()): DirectorStageCameraShot {
  const fov = 42;
  return {
    id: `shot-${now}`,
    name: 'Shot 1',
    position: createStageVector3(4, 2.4, 5),
    target: createStageVector3(0, 1.2, 0),
    fov,
    focalLengthMm: fovToFocalLength(fov),
    createdAt: now,
    updatedAt: now,
  };
}

export function createDefaultDirectorStageLights(): DirectorStageLight[] {
  return [
    {
      id: 'light-ambient',
      kind: 'ambient',
      name: 'Ambient',
      color: '#ffffff',
      intensity: 0.55,
      enabled: true,
      position: createStageVector3(0, 3, 0),
      target: createStageVector3(0, 0, 0),
    },
    {
      id: 'light-key',
      kind: 'directional',
      name: 'Key Light',
      color: '#fff2d8',
      intensity: 2.4,
      enabled: true,
      position: createStageVector3(3.8, 5.2, 3.2),
      target: createStageVector3(0, 1, 0),
    },
  ];
}

export function createDefaultDirectorStageProject(now = Date.now()): DirectorStageProject {
  const firstShot = createDefaultDirectorStageCameraShot(now);
  return {
    version: DIRECTOR_STAGE_PROJECT_VERSION,
    entities: [],
    crowdGroups: [],
    lights: createDefaultDirectorStageLights(),
    cameraShots: [firstShot],
    activeCameraShotId: firstShot.id,
    isFreeView: true,
    selectedEntityId: null,
    selectedCrowdGroupId: null,
    selectedLightId: null,
    transformMode: 'translate',
    showGroundGrid: true,
    environment: {
      id: DIRECTOR_STAGE_DEFAULT_ENVIRONMENT_ID,
      name: 'Studio Grid',
      backgroundPath: null,
      previewPath: null,
    },
    snapshot: {
      aspectRatio: DIRECTOR_STAGE_DEFAULT_SNAPSHOT_ASPECT_RATIO,
      showMask: true,
    },
    updatedAt: now,
  };
}

function normalizeNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function normalizeVector3(value: unknown, fallback: DirectorStageVector3): DirectorStageVector3 {
  const candidate = value && typeof value === 'object' ? value as Partial<DirectorStageVector3> : {};
  return {
    x: normalizeNumber(candidate.x, fallback.x),
    y: normalizeNumber(candidate.y, fallback.y),
    z: normalizeNumber(candidate.z, fallback.z),
  };
}

export function clampDirectorStageScale(value: unknown, fallback = 1): number {
  const numericValue = typeof value === 'number' && Number.isFinite(value) ? Math.abs(value) : fallback;
  if (!Number.isFinite(numericValue)) {
    return 1;
  }
  return Math.max(DIRECTOR_STAGE_MIN_SCALE, Math.min(DIRECTOR_STAGE_MAX_SCALE, numericValue));
}

function normalizeScaleVector(value: unknown, fallback: DirectorStageVector3): DirectorStageVector3 {
  const candidate = value && typeof value === 'object' ? value as Partial<DirectorStageVector3> : {};
  return {
    x: clampDirectorStageScale(candidate.x, fallback.x),
    y: clampDirectorStageScale(candidate.y, fallback.y),
    z: clampDirectorStageScale(candidate.z, fallback.z),
  };
}

function normalizeTransform(value: unknown): DirectorStageTransform {
  const fallback = createDefaultDirectorStageTransform();
  const candidate = value && typeof value === 'object' ? value as Partial<DirectorStageTransform> : {};
  return {
    position: normalizeVector3(candidate.position, fallback.position),
    rotation: normalizeVector3(candidate.rotation, fallback.rotation),
    scale: normalizeScaleVector(candidate.scale, fallback.scale),
  };
}

function clampLimbRotation(value: unknown, fallback = 0): number {
  const numericValue = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  if (!Number.isFinite(numericValue)) {
    return 0;
  }
  return Math.max(DIRECTOR_STAGE_LIMB_ROTATION_MIN, Math.min(DIRECTOR_STAGE_LIMB_ROTATION_MAX, numericValue));
}

function normalizeLimbPose(value: unknown): DirectorStageLimbPose {
  const candidate = value && typeof value === 'object'
    ? value as Partial<Record<DirectorStageLimbPoseKey, Partial<DirectorStageVector3>>>
    : {};
  return DIRECTOR_STAGE_LIMB_POSE_KEYS.reduce<DirectorStageLimbPose>((pose, key) => {
    const rawRotation = candidate[key];
    if (!rawRotation || typeof rawRotation !== 'object') {
      return pose;
    }
    pose[key] = {
      x: clampLimbRotation(rawRotation.x),
      y: clampLimbRotation(rawRotation.y),
      z: clampLimbRotation(rawRotation.z),
    };
    return pose;
  }, {});
}

function repairA3dCharacterTransform(
  transform: DirectorStageTransform,
  source: DirectorStageEntitySource,
  kind: DirectorStageEntityKind
): DirectorStageTransform {
  if (source !== 'a3d' || kind !== 'character') {
    return transform;
  }
  const maxScale = Math.max(
    Math.abs(transform.scale.x),
    Math.abs(transform.scale.y),
    Math.abs(transform.scale.z)
  );
  if (maxScale <= DIRECTOR_STAGE_MAX_SCALE) {
    return transform;
  }
  return {
    ...transform,
    scale: createStageVector3(1, 1, 1),
  };
}

function normalizeText(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback;
}

function normalizeNullableText(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function normalizeSnapshotAspectRatio(value: unknown): DirectorStageSnapshotAspectRatio {
  return DIRECTOR_STAGE_SNAPSHOT_ASPECT_RATIOS.includes(value as DirectorStageSnapshotAspectRatio)
    ? value as DirectorStageSnapshotAspectRatio
    : DIRECTOR_STAGE_DEFAULT_SNAPSHOT_ASPECT_RATIO;
}

function clampPlaneAspectRatio(value: unknown, fallback = DIRECTOR_STAGE_DEFAULT_PLANE_ASPECT_RATIO): number {
  const numericValue = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  if (!Number.isFinite(numericValue)) {
    return DIRECTOR_STAGE_DEFAULT_PLANE_ASPECT_RATIO;
  }
  return Math.max(
    DIRECTOR_STAGE_PLANE_ASPECT_RATIO_MIN,
    Math.min(DIRECTOR_STAGE_PLANE_ASPECT_RATIO_MAX, Math.abs(numericValue))
  );
}

function normalizePlaneSurface(value: unknown): DirectorStagePlaneSurface | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const candidate = value as Partial<DirectorStagePlaneSurface>;
  const fitMode: DirectorStagePlaneSurfaceFitMode = candidate.fitMode === 'stretch' ? 'stretch' : 'contain';
  const aspectRatioPreset: DirectorStagePlaneAspectRatioPreset =
    candidate.aspectRatioPreset === '4:3'
    || candidate.aspectRatioPreset === '16:9'
    || candidate.aspectRatioPreset === '9:16'
    || candidate.aspectRatioPreset === 'custom'
      ? candidate.aspectRatioPreset
      : '1:1';

  return {
    imagePath: normalizeNullableText(candidate.imagePath),
    imageName: normalizeNullableText(candidate.imageName),
    imageAspectRatio:
      typeof candidate.imageAspectRatio === 'number' && Number.isFinite(candidate.imageAspectRatio)
        ? clampPlaneAspectRatio(candidate.imageAspectRatio)
        : null,
    fitMode,
    aspectRatioPreset,
    customAspectRatio: clampPlaneAspectRatio(candidate.customAspectRatio),
  };
}

function isDirectorStagePlaneEntity(
  source: DirectorStageEntitySource,
  modelPath: string
): boolean {
  return source === 'geometry' && modelPath === 'primitive://plane';
}

export function normalizeDirectorStageProject(
  value: unknown,
  fallback = createDefaultDirectorStageProject()
): DirectorStageProject {
  if (!value || typeof value !== 'object') {
    return fallback;
  }

  const raw = value as Partial<DirectorStageProject>;
  const now = Date.now();
  const entities = Array.isArray(raw.entities)
    ? raw.entities
        .map((entity): DirectorStageEntity | null => {
          if (!entity || typeof entity !== 'object') {
            return null;
          }
          const candidate = entity as Partial<DirectorStageEntity>;
          const id = normalizeText(candidate.id);
          const modelPath = normalizeText(candidate.modelPath);
          if (!id || !modelPath) {
            return null;
          }
          const kind: DirectorStageEntityKind =
            candidate.kind === 'scene' || candidate.kind === 'prop' || candidate.kind === 'model'
              ? candidate.kind
              : 'character';
          const source: DirectorStageEntitySource =
            candidate.source === 'user' || candidate.source === 'geometry'
              ? candidate.source
              : 'a3d';
          return {
            id,
            kind,
            source,
            assetId: normalizeText(candidate.assetId, id),
            name: normalizeText(candidate.name, id),
            modelPath,
            previewPath: typeof candidate.previewPath === 'string' ? candidate.previewPath : null,
            transform: repairA3dCharacterTransform(normalizeTransform(candidate.transform), source, kind),
            color: normalizeText(
              candidate.color,
              source === 'user' ? '#ffffff' : source === 'geometry' ? '#d8dde6' : '#d9c6ad'
            ),
            posePresetId: typeof candidate.posePresetId === 'string' ? candidate.posePresetId : null,
            posePath: typeof candidate.posePath === 'string' ? candidate.posePath : null,
            limbPose: normalizeLimbPose(candidate.limbPose),
            crowdGroupId: typeof candidate.crowdGroupId === 'string' ? candidate.crowdGroupId : null,
            crowdMemberIndex:
              typeof candidate.crowdMemberIndex === 'number' && Number.isFinite(candidate.crowdMemberIndex)
                ? Math.max(0, Math.floor(candidate.crowdMemberIndex))
                : null,
            skeletonCompatible:
              typeof candidate.skeletonCompatible === 'boolean' ? candidate.skeletonCompatible : null,
            planeSurface: isDirectorStagePlaneEntity(source, modelPath)
              ? normalizePlaneSurface(candidate.planeSurface)
              : undefined,
            loadError: typeof candidate.loadError === 'string' ? candidate.loadError : null,
            createdAt: normalizeNumber(candidate.createdAt, now),
            updatedAt: normalizeNumber(candidate.updatedAt, now),
          };
        })
        .filter((entity): entity is DirectorStageEntity => entity !== null)
    : [];

  const entityIds = new Set(entities.map((entity) => entity.id));
  const crowdGroups = Array.isArray(raw.crowdGroups)
    ? raw.crowdGroups
        .map((group): DirectorStageCrowdGroup | null => {
          if (!group || typeof group !== 'object') {
            return null;
          }
          const candidate = group as Partial<DirectorStageCrowdGroup>;
          const id = normalizeText(candidate.id);
          if (!id) {
            return null;
          }
          const groupEntityIds = Array.isArray(candidate.entityIds)
            ? candidate.entityIds
                .filter((entityId): entityId is string => typeof entityId === 'string' && entityIds.has(entityId))
                .slice(0, DIRECTOR_STAGE_CROWD_MAX_COUNT)
            : [];
          const rawLayout = candidate.layout && typeof candidate.layout === 'object'
            ? candidate.layout as Partial<DirectorStageCrowdLayout>
            : {};
          const mode: DirectorStageCrowdGroupMode = candidate.mode === 'crowd' ? 'crowd' : 'formation';
          const count = Math.min(
            DIRECTOR_STAGE_CROWD_MAX_COUNT,
            Math.floor(normalizeNumber(rawLayout.count, groupEntityIds.length))
          );
          if (count <= 0) {
            return null;
          }
          return {
            id,
            mode,
            name: normalizeText(candidate.name, mode === 'crowd' ? 'Crowd' : 'Formation'),
            assetId: normalizeText(candidate.assetId, id),
            entityIds: [],
            transform: normalizeTransform(candidate.transform),
            layout: {
              count,
              spacing: Math.max(0.2, Math.min(4, normalizeNumber(rawLayout.spacing, 0.95))),
              seed: Math.floor(normalizeNumber(rawLayout.seed, now)),
              columns:
                typeof rawLayout.columns === 'number' && Number.isFinite(rawLayout.columns)
                  ? Math.max(1, Math.floor(rawLayout.columns))
                  : undefined,
              rows:
                typeof rawLayout.rows === 'number' && Number.isFinite(rawLayout.rows)
                  ? Math.max(1, Math.floor(rawLayout.rows))
                  : undefined,
              radiusMin:
                typeof rawLayout.radiusMin === 'number' && Number.isFinite(rawLayout.radiusMin)
                  ? Math.max(0.5, rawLayout.radiusMin)
                  : undefined,
              radiusMax:
                typeof rawLayout.radiusMax === 'number' && Number.isFinite(rawLayout.radiusMax)
                  ? Math.max(1, rawLayout.radiusMax)
                  : undefined,
              centerRadius:
                mode === 'crowd'
                  ? Math.max(
                      DIRECTOR_STAGE_CROWD_CENTER_RADIUS_MIN,
                      Math.min(
                        DIRECTOR_STAGE_CROWD_CENTER_RADIUS_MAX,
                        normalizeNumber(rawLayout.centerRadius, DIRECTOR_STAGE_CROWD_DEFAULT_CENTER_RADIUS)
                      )
                    )
                  : undefined,
            },
            createdAt: normalizeNumber(candidate.createdAt, now),
            updatedAt: normalizeNumber(candidate.updatedAt, now),
          };
        })
        .filter((group): group is DirectorStageCrowdGroup => group !== null)
    : [];
  const crowdGroupIds = new Set(crowdGroups.map((group) => group.id));
  const normalizedEntities = entities
    .filter((entity) => !entity.crowdGroupId || !crowdGroupIds.has(entity.crowdGroupId))
    .map((entity) =>
      entity.crowdGroupId && !crowdGroupIds.has(entity.crowdGroupId)
      ? {
          ...entity,
          crowdGroupId: null,
          crowdMemberIndex: null,
        }
      : entity
    );

  const lights = Array.isArray(raw.lights)
    ? raw.lights
        .map((light): DirectorStageLight | null => {
          if (!light || typeof light !== 'object') {
            return null;
          }
          const candidate = light as Partial<DirectorStageLight>;
          const id = normalizeText(candidate.id);
          if (!id) {
            return null;
          }
          return {
            id,
            kind: candidate.kind === 'point' || candidate.kind === 'directional'
              ? candidate.kind
              : candidate.kind === 'spot'
                ? 'point'
                : 'ambient',
            name: normalizeText(candidate.name, id),
            color: normalizeText(candidate.color, '#ffffff'),
            intensity: normalizeNumber(candidate.intensity, 1),
            enabled: candidate.enabled !== false,
            position: normalizeVector3(candidate.position, createStageVector3(0, 3, 0)),
            target: normalizeVector3(candidate.target, createStageVector3(0, 0, 0)),
            distance: normalizeNumber(candidate.distance, 0),
            angle: normalizeNumber(candidate.angle, Math.PI / 4),
            penumbra: normalizeNumber(candidate.penumbra, 0.25),
          };
        })
        .filter((light): light is DirectorStageLight => light !== null)
    : createDefaultDirectorStageLights();

  const cameraShots = Array.isArray(raw.cameraShots)
    ? raw.cameraShots
        .map((shot): DirectorStageCameraShot | null => {
          if (!shot || typeof shot !== 'object') {
            return null;
          }
          const candidate = shot as Partial<DirectorStageCameraShot>;
          const id = normalizeText(candidate.id);
          if (!id) {
            return null;
          }
          const lens = normalizeCameraShotLens(candidate);
          return {
            id,
            name: normalizeText(candidate.name, id),
            position: normalizeVector3(candidate.position, createStageVector3(4, 2.4, 5)),
            target: normalizeVector3(candidate.target, createStageVector3(0, 1.2, 0)),
            fov: lens.fov,
            focalLengthMm: lens.focalLengthMm,
            createdAt: normalizeNumber(candidate.createdAt, now),
            updatedAt: normalizeNumber(candidate.updatedAt, now),
          };
        })
        .filter((shot): shot is DirectorStageCameraShot => shot !== null)
    : [];

  const normalizedShots = cameraShots.length > 0 ? cameraShots : [createDefaultDirectorStageCameraShot(now)];
  const activeCameraShotId =
    typeof raw.activeCameraShotId === 'string'
      && normalizedShots.some((shot) => shot.id === raw.activeCameraShotId)
      ? raw.activeCameraShotId
      : normalizedShots[0]?.id ?? null;

  const environment = raw.environment && typeof raw.environment === 'object'
    ? raw.environment as Partial<DirectorStageEnvironment>
    : fallback.environment;
  const snapshot = raw.snapshot && typeof raw.snapshot === 'object'
    ? raw.snapshot as Partial<DirectorStageSnapshotSettings>
    : fallback.snapshot;

  return {
    version: DIRECTOR_STAGE_PROJECT_VERSION,
    entities: normalizedEntities,
    crowdGroups,
    lights,
    cameraShots: normalizedShots,
    activeCameraShotId,
    isFreeView: raw.isFreeView !== false,
    selectedEntityId:
      typeof raw.selectedEntityId === 'string'
        && normalizedEntities.some((entity) => entity.id === raw.selectedEntityId && !entity.crowdGroupId)
        ? raw.selectedEntityId
        : null,
    selectedCrowdGroupId:
      typeof raw.selectedCrowdGroupId === 'string'
        && crowdGroups.some((group) => group.id === raw.selectedCrowdGroupId)
        ? raw.selectedCrowdGroupId
        : null,
    selectedLightId:
      typeof raw.selectedLightId === 'string'
        && lights.some((light) => light.id === raw.selectedLightId)
        ? raw.selectedLightId
        : null,
    transformMode:
      raw.transformMode === 'rotate' || raw.transformMode === 'scale' ? raw.transformMode : 'translate',
    showGroundGrid: raw.showGroundGrid !== false,
    environment: {
      id: normalizeText(environment.id, DIRECTOR_STAGE_DEFAULT_ENVIRONMENT_ID),
      name: normalizeText(environment.name, 'Studio Grid'),
      backgroundPath: typeof environment.backgroundPath === 'string' ? environment.backgroundPath : null,
      previewPath: typeof environment.previewPath === 'string' ? environment.previewPath : null,
    },
    snapshot: {
      aspectRatio: normalizeSnapshotAspectRatio(snapshot.aspectRatio),
      showMask: snapshot.showMask !== false,
    },
    updatedAt: normalizeNumber(raw.updatedAt, now),
  };
}
