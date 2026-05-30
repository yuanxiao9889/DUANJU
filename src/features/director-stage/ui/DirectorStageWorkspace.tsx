import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { open } from '@tauri-apps/plugin-dialog';
import { openUrl } from '@tauri-apps/plugin-opener';
import {
  Aperture,
  Box,
  Camera,
  Check,
  ChevronDown,
  ChevronRight,
  Clapperboard,
  Cone,
  Cuboid,
  Cylinder,
  Download,
  Eye,
  EyeOff,
  ExternalLink,
  Grid3X3,
  Lightbulb,
  Loader2,
  Lock,
  Maximize2,
  Move3D,
  Package,
  Rotate3D,
  Save,
  Scale3D,
  Circle,
  Square,
  Sun,
  Torus,
  Trash2,
  Unlock,
  Upload,
  Users,
  X,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { UiButton, UiInput, UiSelect } from '@/components/ui';
import type { DirectorStageNodeData } from '@/features/canvas/domain/canvasNodes';
import { resolveImageDisplayUrl } from '@/features/canvas/application/imageData';
import { prepareNodeVideoFromSource } from '@/features/canvas/application/videoData';
import { createCurrentProjectMediaContext } from '@/features/canvas/application/mediaPersistenceContext';
import { transcodeDirectorStageRecordingToMp4 } from '@/commands/directorStage';
import { useAssetStore } from '@/stores/assetStore';
import { useCanvasStore } from '@/stores/canvasStore';
import { useProjectStore } from '@/stores/projectStore';
import {
  DIRECTOR_STAGE_ADD_EXPORT_NODE_EVENT,
  DIRECTOR_STAGE_ADD_VIDEO_NODE_EVENT,
  DIRECTOR_STAGE_UPDATE_NODE_EVENT,
  emitToMainWindow,
  type DirectorStageAddExportNodePayload,
  type DirectorStageAddVideoNodePayload,
  type DirectorStageUpdateNodePayload,
} from '../application/directorStageWindowBridge';
import type { AssetCategory, AssetItemRecord, AssetMetadata } from '@/features/assets/domain/types';
import {
  DIRECTOR_STAGE_ASSET_PACKS,
  DIRECTOR_STAGE_BUILT_IN_GEOMETRIES,
  DIRECTOR_STAGE_BUILT_IN_POSE_PRESETS,
  DIRECTOR_STAGE_SKYBOX_PRESETS,
  getDirectorStageCharacterAsset,
  getDirectorStagePosePreset,
} from '../assets/directorStageAssetRegistry';
import { DirectorStageNumberInput } from './DirectorStageNumberInput';
import {
  createStageVector3,
  clampDirectorStageScale,
  DIRECTOR_STAGE_CAMERA_PATH_MAX_DURATION_MS,
  DIRECTOR_STAGE_CAMERA_PATH_CLIP_MAX_DURATION_MS,
  DIRECTOR_STAGE_CAMERA_PATH_SAMPLE_RATE,
  DIRECTOR_STAGE_LIMB_POSE_KEYS,
  DIRECTOR_STAGE_LIMB_ROTATION_MAX,
  DIRECTOR_STAGE_LIMB_ROTATION_MIN,
  DIRECTOR_STAGE_MAX_SCALE,
  DIRECTOR_STAGE_MIN_SCALE,
  DIRECTOR_STAGE_PLANE_ASPECT_RATIO_MAX,
  DIRECTOR_STAGE_PLANE_ASPECT_RATIO_MIN,
  DIRECTOR_STAGE_SNAPSHOT_ASPECT_RATIOS,
  DIRECTOR_STAGE_SNAPSHOT_HELPER_USER_DATA_KEY,
  normalizeDirectorStageProject,
  type DirectorStageBuiltInAsset,
  type DirectorStageCameraPathSegmentEasing,
  type DirectorStageCameraKeyframe,
  type DirectorStageCameraPath,
  type DirectorStageCameraShot,
  type DirectorStageConnectedEnvironment,
  type DirectorStageCrowdGroup,
  type DirectorStageEntity,
  type DirectorStageLimbPose,
  type DirectorStageLimbPoseKey,
  type DirectorStageLight,
  type DirectorStagePlaneAspectRatioPreset,
  type DirectorStagePlaneSurface,
  type DirectorStagePlaneSurfaceFitMode,
  type DirectorStagePosePreset,
  type DirectorStageProject,
  type DirectorStageSnapshotAspectRatio,
  type DirectorStageTransformMode,
} from '../domain/types';
import {
  applyEntityMaterial,
  applyEntityTransform,
  disposeDirectorStageObject,
  loadDirectorStageModel,
  normalizeDirectorStageObjectContent,
  readEntityTransform,
} from '../engine/objectManager';
import {
  applyDirectorStageLimbPoseToObject,
  applyPosePresetToObject,
  clearPoseFromObject,
  supportsDirectorStageLimbControls,
} from '../engine/poseManager';
import {
  applyCameraShot,
  clampDirectorStageFocalLength,
  DIRECTOR_STAGE_FOCAL_LENGTH_MAX,
  DIRECTOR_STAGE_FOCAL_LENGTH_MIN,
  DIRECTOR_STAGE_FOCAL_LENGTH_PRESETS,
  focalLengthToFov,
  fovToFocalLength,
  frameObjectInCamera,
  readCameraShot,
} from '../engine/cameraManager';
import {
  applyCameraPathKeyframe,
  calculateDirectorStageRecordingSize,
  createDirectorStageCameraPath,
  createDirectorStageCameraPathSegmentKey,
  DIRECTOR_STAGE_CAMERA_PATH_DEFAULT_EASING,
  DIRECTOR_STAGE_CAMERA_PATH_EASING_PRESETS,
  getDirectorStageMotionKeyframes,
  normalizeDirectorStageCameraPathSegmentEasings,
  readCameraPathKeyframe,
  resolveDirectorStageCameraPathSegmentEasing,
  resolveDirectorStageRecordingMimeType,
  sampleDirectorStageCameraPath,
  sampleDirectorStageCameraPathClipFrame,
  sampleDirectorStageCameraPathPoints,
  sampleDirectorStageCameraPathSourceTime,
} from '../engine/cameraPath';
import { buildDirectorStageLight, disposeDirectorStageLightObject } from '../engine/lightManager';
import {
  calculateDirectorStageSnapshotFrame,
  exportDirectorStageCanvasPng,
} from '../engine/snapshotManager';
import {
  createDirectorStageEntityFromBuiltInAsset,
  createDirectorStageEntityFromModelAsset,
  patchDirectorStageEntity,
} from '../engine/projectManager';
import {
  clampDirectorStageCrowdCenterRadius,
  createDirectorStageGridCenterCrowdPlacement,
  createDirectorStageCrowdPlacement,
  createDirectorStageFormationGroup,
  deleteDirectorStageCrowdGroup,
  DIRECTOR_STAGE_CROWD_CENTER_RADIUS_MAX,
  DIRECTOR_STAGE_CROWD_CENTER_RADIUS_MIN,
  DIRECTOR_STAGE_CROWD_DEFAULT_CENTER_RADIUS,
  DIRECTOR_STAGE_CROWD_MAX_COUNT,
  patchDirectorStageCrowdGroup,
  replaceDirectorStageCrowdGroupCount,
  upsertDirectorStageCrowdGroup,
} from '../engine/crowdManager';
import { DirectorStageCameraEasingEditor } from './DirectorStageCameraEasingEditor';
import { DirectorStageCameraTimeline } from './DirectorStageCameraTimeline';
import {
  disposeDirectorStageCrowdLodGroup,
  loadDirectorStageCrowdLodGroup,
  type DirectorStageCrowdLodProgress,
} from '../engine/crowdLodManager';
import {
  buildDirectorStageGround,
  createDirectorStageDefaultGroundAppearance,
  createDirectorStageGroundAppearanceFromEnvironmentColor,
  createDirectorStageRenderer,
  createDirectorStageScene,
  disposeDirectorStageGround,
  updateDirectorStageGroundAppearance,
} from '../engine/sceneManager';
import {
  findDirectorStageCrowdGroupId,
  findDirectorStageEntityId,
} from '../engine/selectionManager';
import { isSupportedDirectorStageModelPath } from '../application/modelUrl';
import { CrowdModeDialog } from './CrowdModeDialog';

interface DirectorStageWorkspaceProps {
  nodeId: string;
  data: DirectorStageNodeData;
  connectedEnvironments?: DirectorStageConnectedEnvironment[];
}

type WorkspaceTab = 'a3d' | 'library';
type DirectorStagePoseOption = DirectorStagePosePreset & {
  origin: 'builtin' | 'user';
  assetItem?: AssetItemRecord;
};

type DirectorStageCommitOptions = {
  history?: 'push' | 'skip';
};

type DirectorStageDeferredProjectEdit = {
  baseProject: DirectorStageProject;
};

type CrowdRenderProgressItem = DirectorStageCrowdLodProgress & {
  groupId: string;
  groupName: string;
  renderKey: string;
  startedAt: number;
};

interface CameraLensPanelState {
  shotId: string;
  left: number;
  top: number;
}

interface CameraPathRecordingState {
  shotId: string;
  startedAt: number;
  elapsedMs: number;
}

interface CameraPathPlaybackState {
  shotId: string;
  startedAt: number;
  durationMs: number;
  elapsedMs: number;
  speed: number;
  clipStartMs: number;
}

interface CameraPathTimelineState {
  shotId: string;
  selectedKeyframeIndex: number | null;
  playheadMs: number;
}

const DIRECTOR_STAGE_CROWD_RENDER_STRATEGY_VERSION = 'static-full-v2';
const DIRECTOR_STAGE_MODEL_LIBRARY_URL = 'https://sketchfab.com/feed';
const DIRECTOR_STAGE_USER_POSE_PRESET_PREFIX = 'asset:';
const DIRECTOR_STAGE_USER_ANIMATION_SAMPLE_RATIO = 0.2;
const DIRECTOR_STAGE_TRANSFORM_SHORTCUTS: Record<DirectorStageTransformMode, string> = {
  translate: 'W',
  rotate: 'E',
  scale: 'R',
};
const DIRECTOR_STAGE_FRAME_SELECTED_SHORTCUT = 'F';
const DIRECTOR_STAGE_GROUND_GRID_SHORTCUT = 'G';
const DIRECTOR_STAGE_GROUND_SAMPLE_SIZE = 32;
const CAMERA_LENS_PANEL_WIDTH = 260;
const CAMERA_LENS_PANEL_HEIGHT = 206;
const DIRECTOR_STAGE_RECORDING_PREVIEW_UPDATE_MS = 80;

const SNAPSHOT_ASPECT_RATIO_LABEL_KEYS: Record<DirectorStageSnapshotAspectRatio, string> = {
  '16:9': 'directorStage.snapshot.ratios.r16x9',
  '9:16': 'directorStage.snapshot.ratios.r9x16',
  '1:1': 'directorStage.snapshot.ratios.r1x1',
  '4:5': 'directorStage.snapshot.ratios.r4x5',
  '3:4': 'directorStage.snapshot.ratios.r3x4',
  '2:1': 'directorStage.snapshot.ratios.r2x1',
  '21:9': 'directorStage.snapshot.ratios.r21x9',
};

const DIRECTOR_STAGE_PLANE_ASPECT_RATIO_PRESETS: DirectorStagePlaneAspectRatioPreset[] = [
  '1:1',
  '4:3',
  '16:9',
  '9:16',
  'custom',
];

const DIRECTOR_STAGE_PLANE_ASPECT_RATIO_VALUES: Record<Exclude<DirectorStagePlaneAspectRatioPreset, 'custom'>, number> = {
  '1:1': 1,
  '4:3': 4 / 3,
  '16:9': 16 / 9,
  '9:16': 9 / 16,
};

const DIRECTOR_STAGE_GEOMETRY_ICON_BY_ID: Record<string, typeof Box> = {
  'geometry-box': Cuboid,
  'geometry-sphere': Circle,
  'geometry-cylinder': Cylinder,
  'geometry-cone': Cone,
  'geometry-plane': Square,
  'geometry-torus': Torus,
};

function loadImageForGroundSampling(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Failed to load ground sample image'));
    image.src = source;
  });
}

function readImageAspectRatio(source: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => {
      if (image.naturalWidth > 0 && image.naturalHeight > 0) {
        resolve(image.naturalWidth / image.naturalHeight);
        return;
      }
      reject(new Error('Image has no readable dimensions'));
    };
    image.onerror = () => reject(new Error('Failed to load image dimensions'));
    image.src = source;
  });
}

async function sampleDirectorStageGroundColor(source: string): Promise<THREE.Color> {
  const image = await loadImageForGroundSampling(source);
  const canvas = document.createElement('canvas');
  canvas.width = DIRECTOR_STAGE_GROUND_SAMPLE_SIZE;
  canvas.height = DIRECTOR_STAGE_GROUND_SAMPLE_SIZE;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) {
    throw new Error('Failed to create ground sample canvas');
  }

  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const imageData = context.getImageData(0, Math.floor(canvas.height * 0.45), canvas.width, Math.ceil(canvas.height * 0.55));
  const pixels = imageData.data;
  let red = 0;
  let green = 0;
  let blue = 0;
  let samples = 0;

  for (let index = 0; index < pixels.length; index += 4) {
    const alpha = pixels[index + 3] / 255;
    if (alpha <= 0.05) {
      continue;
    }
    red += pixels[index] * alpha;
    green += pixels[index + 1] * alpha;
    blue += pixels[index + 2] * alpha;
    samples += alpha;
  }

  if (samples <= 0) {
    throw new Error('Ground sample image is empty');
  }

  return new THREE.Color(red / samples / 255, green / samples / 255, blue / samples / 255);
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isDirectorStageShortcutEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  const tagName = target.tagName.toLowerCase();
  return target.isContentEditable
    || tagName === 'input'
    || tagName === 'textarea'
    || tagName === 'select';
}

function shortcutTitle(label: string, shortcut: string): string {
  return `${label} (${shortcut})`;
}

function getDirectorStageAssetMetadata(item: AssetItemRecord): Record<string, unknown> | null {
  const metadata = item.metadata;
  if (!isObjectRecord(metadata)) {
    return null;
  }
  const directorStage = metadata.directorStage;
  return isObjectRecord(directorStage) ? directorStage : null;
}

function isDirectorStageAnimationAsset(item: AssetItemRecord): boolean {
  const directorStage = getDirectorStageAssetMetadata(item);
  return item.mediaType === 'model'
    && item.category === 'character'
    && directorStage?.kind === 'animation'
    && /\.fbx(?:[?#].*)?$/i.test(item.sourcePath.trim());
}

function isModelAsset(item: AssetItemRecord): boolean {
  return item.mediaType === 'model'
    && ['character', 'scene', 'prop'].includes(item.category)
    && !isDirectorStageAnimationAsset(item);
}

function categoryToEntityKind(category: AssetCategory): DirectorStageEntity['kind'] {
  if (category === 'character' || category === 'scene' || category === 'prop') {
    return category;
  }
  return 'model';
}

function extensionToMime(path: string): string | null {
  const lower = path.toLowerCase();
  if (/\.(png|jpe?g|webp|gif|bmp|avif)$/i.test(lower)) {
    return `image/${lower.endsWith('.jpg') ? 'jpeg' : lower.split('.').pop()}`;
  }
  if (lower.endsWith('.glb')) {
    return 'model/gltf-binary';
  }
  if (lower.endsWith('.gltf')) {
    return 'model/gltf+json';
  }
  if (lower.endsWith('.fbx')) {
    return 'application/octet-stream';
  }
  return null;
}

function toUserPosePresetId(assetItemId: string): string {
  return `${DIRECTOR_STAGE_USER_POSE_PRESET_PREFIX}${assetItemId}`;
}

function getDirectorStageAnimationCompatibleAssetId(item: AssetItemRecord): string | null {
  const directorStage = getDirectorStageAssetMetadata(item);
  const compatibleAssetId = directorStage?.compatibleAssetId;
  return typeof compatibleAssetId === 'string' && compatibleAssetId.trim()
    ? compatibleAssetId.trim()
    : null;
}

function getDirectorStageAnimationSampleRatio(item: AssetItemRecord): number {
  const directorStage = getDirectorStageAssetMetadata(item);
  const sampleRatio = directorStage?.sampleRatio;
  return typeof sampleRatio === 'number' && Number.isFinite(sampleRatio)
    ? Math.max(0, Math.min(1, sampleRatio))
    : DIRECTOR_STAGE_USER_ANIMATION_SAMPLE_RATIO;
}

function createUserPosePresetFromAsset(item: AssetItemRecord): DirectorStagePoseOption | null {
  const compatibleAssetId = getDirectorStageAnimationCompatibleAssetId(item);
  if (!compatibleAssetId || !isDirectorStageAnimationAsset(item)) {
    return null;
  }
  return {
    id: toUserPosePresetId(item.id),
    labelKey: item.name,
    animationPath: item.sourcePath,
    sampleRatio: getDirectorStageAnimationSampleRatio(item),
    compatibleAssetIds: [compatibleAssetId],
    origin: 'user',
    assetItem: item,
  };
}

function createStoredEntityPosePreset(entity: DirectorStageEntity): DirectorStagePosePreset | null {
  if (!entity.posePath) {
    return null;
  }
  return {
    id: entity.posePresetId ?? `path:${entity.posePath}`,
    labelKey: entity.name,
    animationPath: entity.posePath,
    sampleRatio: DIRECTOR_STAGE_USER_ANIMATION_SAMPLE_RATIO,
    compatibleAssetIds: [entity.assetId],
  };
}

function buildDirectorStageAnimationMetadata(params: {
  entity: DirectorStageEntity;
  sourcePath: string;
  fileName: string;
  existingMetadata?: AssetMetadata | null;
}): AssetMetadata {
  const baseMetadata = isObjectRecord(params.existingMetadata)
    ? { ...params.existingMetadata }
    : {};
  const existingDirectorStage = isObjectRecord(baseMetadata.directorStage)
    ? baseMetadata.directorStage
    : {};
  return {
    ...baseMetadata,
    directorStage: {
      ...existingDirectorStage,
      kind: 'animation',
      compatibleAssetId: params.entity.assetId,
      compatibleSource: params.entity.source,
      sampleRatio: DIRECTOR_STAGE_USER_ANIMATION_SAMPLE_RATIO,
      importedAt: Date.now(),
      originalSourcePath: params.sourcePath,
      originalFileName: params.fileName,
    },
  };
}

function basename(path: string): string {
  return path.replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? 'model';
}

function withoutExtension(name: string): string {
  return name.replace(/\.[^.]+$/, '');
}

function isDirectorStagePlaneEntity(entity: DirectorStageEntity | null | undefined): entity is DirectorStageEntity {
  return Boolean(entity?.source === 'geometry' && entity.modelPath === 'primitive://plane');
}

function clampPlaneAspectRatio(value: number): number {
  if (!Number.isFinite(value)) {
    return 1;
  }
  return Math.max(DIRECTOR_STAGE_PLANE_ASPECT_RATIO_MIN, Math.min(DIRECTOR_STAGE_PLANE_ASPECT_RATIO_MAX, Math.abs(value)));
}

function resolvePlaneAspectRatio(
  preset: DirectorStagePlaneAspectRatioPreset,
  customAspectRatio: number
): number {
  return preset === 'custom'
    ? clampPlaneAspectRatio(customAspectRatio)
    : DIRECTOR_STAGE_PLANE_ASPECT_RATIO_VALUES[preset];
}

function createDefaultPlaneSurface(): DirectorStagePlaneSurface {
  return {
    imagePath: null,
    imageName: null,
    imageAspectRatio: null,
    fitMode: 'contain',
    aspectRatioPreset: '1:1',
    customAspectRatio: 1,
  };
}

function resolvePlaneSurface(entity: DirectorStageEntity): DirectorStagePlaneSurface {
  return {
    ...createDefaultPlaneSurface(),
    ...entity.planeSurface,
  };
}

function createProjectNodePatch(project: DirectorStageProject) {
  const activeCameraShotName =
    project.cameraShots.find((shot) => shot.id === project.activeCameraShotId)?.name ?? null;
  const visibleObjectCount =
    project.entities.filter((entity) => !entity.crowdGroupId).length + project.crowdGroups.length;
  return {
    project,
    objectCount: visibleObjectCount,
    cameraShotCount: project.cameraShots.length,
    activeCameraShotName,
  };
}

function createCameraPathKeyframeId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `motion-${crypto.randomUUID()}`;
  }
  return `motion-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function ensureCameraPathKeyframeId(keyframe: DirectorStageCameraKeyframe): DirectorStageCameraKeyframe {
  return keyframe.id ? keyframe : { ...keyframe, id: createCameraPathKeyframeId() };
}

function pushCameraPathRecordingKeyframe(
  recording: { keyframes: DirectorStageCameraKeyframe[]; lastSampleAt: number },
  keyframe: DirectorStageCameraKeyframe,
  sampleAt: number
): void {
  const previous = recording.keyframes[recording.keyframes.length - 1];
  if (previous && Math.abs(previous.timeMs - keyframe.timeMs) < 1) {
    recording.keyframes[recording.keyframes.length - 1] = keyframe;
  } else {
    recording.keyframes.push(keyframe);
  }
  recording.lastSampleAt = sampleAt;
}

function collectDirectorStageLightMarkerObjects(
  lightGroup: THREE.Group | null
): THREE.Object3D[] {
  const markers: THREE.Object3D[] = [];
  lightGroup?.traverse((object) => {
    if (object.userData[DIRECTOR_STAGE_SNAPSHOT_HELPER_USER_DATA_KEY] === true) {
      markers.push(object);
    }
  });
  return markers;
}

function hideDirectorStageObjects(
  objects: Array<THREE.Object3D | null | undefined>
): Array<{ object: THREE.Object3D; visible: boolean }> {
  const previousVisibility: Array<{ object: THREE.Object3D; visible: boolean }> = [];
  const seen = new Set<THREE.Object3D>();
  objects.forEach((object) => {
    if (!object || seen.has(object)) {
      return;
    }
    seen.add(object);
    previousVisibility.push({ object, visible: object.visible });
    object.visible = false;
  });
  return previousVisibility;
}

function restoreDirectorStageObjectVisibility(
  previousVisibility: Array<{ object: THREE.Object3D; visible: boolean }>
): void {
  previousVisibility.forEach(({ object, visible }) => {
    object.visible = visible;
  });
}

function createCrowdGroupRenderKey(group: DirectorStageCrowdGroup): string {
  return [
    DIRECTOR_STAGE_CROWD_RENDER_STRATEGY_VERSION,
    group.id,
    group.mode,
    group.assetId,
    group.layout.count,
    group.layout.seed,
    group.layout.columns ?? '',
    group.layout.rows ?? '',
    group.layout.centerRadius ?? '',
  ].join('|');
}

function numericInputValue(value: number): string {
  return Number.isFinite(value) ? String(Math.round(value * 1000) / 1000) : '0';
}

function degreeInputValue(value: number): string {
  return Number.isFinite(value) ? String(Math.round(value)) : '0';
}

function rangeInputValue(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function radiansToDegrees(value: number): number {
  return Number.isFinite(value) ? value * 180 / Math.PI : 0;
}

function degreesToRadians(value: number): number {
  return Number.isFinite(value) ? value * Math.PI / 180 : 0;
}

function clampLimbRotationRadians(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(DIRECTOR_STAGE_LIMB_ROTATION_MIN, Math.min(DIRECTOR_STAGE_LIMB_ROTATION_MAX, value));
}

function lightIntensitySliderMax(value: number): number {
  return Math.max(10, Math.ceil(rangeInputValue(value)));
}

function compactNumber(value: number): string {
  return Number.isFinite(value) ? String(Math.round(value * 10) / 10) : '0';
}

function cameraShotPositionSummary(shot: DirectorStageCameraShot): string {
  return `X ${compactNumber(shot.position.x)} / Y ${compactNumber(shot.position.y)} / Z ${compactNumber(shot.position.z)}`;
}

function cameraShotFocalLengthValue(shot: DirectorStageCameraShot): number {
  return clampDirectorStageFocalLength(shot.focalLengthMm);
}

function formatCameraPathSeconds(timeMs: number): string {
  return (Math.max(0, timeMs) / 1000).toFixed(1);
}

function cameraPathDurationSeconds(cameraPath: DirectorStageCameraPath): string {
  return formatCameraPathSeconds(cameraPath.durationMs);
}

function clampCameraPathClipRange(
  durationMs: number,
  clipStartMs: number,
  clipDurationMs: number
): { clipStartMs: number; clipDurationMs: number } {
  const safeDurationMs = Math.max(1, durationMs);
  const safeClipDurationMs = Math.max(
    1,
    Math.min(DIRECTOR_STAGE_CAMERA_PATH_CLIP_MAX_DURATION_MS, clipDurationMs, safeDurationMs)
  );
  const safeClipStartMs = Math.max(
    0,
    Math.min(safeDurationMs - safeClipDurationMs, clipStartMs)
  );
  return {
    clipStartMs: safeClipStartMs,
    clipDurationMs: safeClipDurationMs,
  };
}

const CAMERA_PATH_PRESET_TIMING_SPEED: Record<DirectorStageCameraPathSegmentEasing['preset'], number> = {
  linear: 1,
  easeIn: 0.9,
  easeOut: 0.9,
  easeInOut: 0.85,
  accelerate: 1.5,
  decelerate: 0.65,
  custom: 1,
};

function resolveCameraPathCurveTimingSpeed(
  preset: DirectorStageCameraPathSegmentEasing['preset'],
  curve: DirectorStageCameraPathSegmentEasing['curve']
): number {
  if (preset !== 'custom') {
    return CAMERA_PATH_PRESET_TIMING_SPEED[preset] ?? 1;
  }

  const progressBias = ((curve[1] + curve[3]) / 2) - 0.5;
  return Math.max(0.45, Math.min(1.8, 1 + progressBias * 1.4));
}

function sanitizeRecordingFileName(name: string): string {
  const sanitized = name
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
    .trim()
    .replace(/[. ]+$/g, '');
  return `${sanitized || 'director-stage-recording'}.mp4`;
}

function resolveCameraLensPanelPosition(rect: DOMRect): Omit<CameraLensPanelState, 'shotId'> {
  const margin = 12;
  const left = Math.max(
    margin,
    Math.min(rect.right - CAMERA_LENS_PANEL_WIDTH, window.innerWidth - CAMERA_LENS_PANEL_WIDTH - margin)
  );
  const top = Math.max(
    margin,
    Math.min(rect.top - CAMERA_LENS_PANEL_HEIGHT - 8, window.innerHeight - CAMERA_LENS_PANEL_HEIGHT - margin)
  );
  return { left, top };
}

function progressPercent(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round(value * 100)));
}

function hasCameraShotViewChanged(
  current: DirectorStageCameraShot,
  next: DirectorStageCameraShot
): boolean {
  const epsilon = 0.001;
  return Math.abs(current.position.x - next.position.x) > epsilon
    || Math.abs(current.position.y - next.position.y) > epsilon
    || Math.abs(current.position.z - next.position.z) > epsilon
    || Math.abs(current.target.x - next.target.x) > epsilon
    || Math.abs(current.target.y - next.target.y) > epsilon
    || Math.abs(current.target.z - next.target.z) > epsilon
    || Math.abs(current.fov - next.fov) > epsilon
    || Math.abs(cameraShotFocalLengthValue(current) - cameraShotFocalLengthValue(next)) > epsilon;
}

function createVector3FromStageVector(value: DirectorStageCameraShot['position']): THREE.Vector3 {
  return new THREE.Vector3(value.x, value.y, value.z);
}

function isCameraInsideCameraShotMarker(
  camera: THREE.PerspectiveCamera,
  shot: DirectorStageCameraShot
): boolean {
  return camera.position.distanceTo(createVector3FromStageVector(shot.position)) < 0.45;
}

function positionFreeViewCameraAroundShot(
  camera: THREE.PerspectiveCamera,
  orbit: OrbitControls,
  shot: DirectorStageCameraShot
): void {
  const shotPosition = createVector3FromStageVector(shot.position);
  const shotTarget = createVector3FromStageVector(shot.target);
  const forward = shotTarget.sub(shotPosition);
  if (forward.lengthSq() < 0.0001) {
    forward.set(0, 0, -1);
  } else {
    forward.normalize();
  }

  const worldUp = new THREE.Vector3(0, 1, 0);
  const right = new THREE.Vector3().crossVectors(forward, worldUp);
  if (right.lengthSq() < 0.0001) {
    right.set(1, 0, 0);
  } else {
    right.normalize();
  }

  const shotDistance = createVector3FromStageVector(shot.position)
    .distanceTo(createVector3FromStageVector(shot.target));
  const distance = Math.max(2.4, Math.min(6, shotDistance * 0.65));
  camera.position
    .copy(shotPosition)
    .addScaledVector(forward, -distance)
    .addScaledVector(worldUp, Math.max(0.75, distance * 0.28))
    .addScaledVector(right, Math.max(0.55, distance * 0.22));
  orbit.target.copy(shotPosition);
  camera.lookAt(orbit.target);
  orbit.update();
}

function disposeCameraShotMarkers(group: THREE.Group): void {
  group.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.isMesh) {
      mesh.geometry.dispose();
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      materials.forEach((material) => material.dispose());
    }
    const line = child as THREE.Line;
    if (line.isLine) {
      line.geometry.dispose();
      const material = line.material;
      if (Array.isArray(material)) {
        material.forEach((item) => item.dispose());
      } else {
        material.dispose();
      }
    }
  });
  group.clear();
}

function buildCameraPathWorldGroup(
  shot: DirectorStageCameraShot,
  isActive: boolean,
  selectedKeyframeIndex: number | null
): THREE.Group | null {
  if (!shot.cameraPath) {
    return null;
  }

  const motionKeyframes = getDirectorStageMotionKeyframes(shot.cameraPath);
  const sampledPath = sampleDirectorStageCameraPathPoints(shot.cameraPath, 120);
  const pathPoints = sampledPath.map(
    (keyframe) => new THREE.Vector3(
      keyframe.position.x,
      keyframe.position.y,
      keyframe.position.z
    )
  );
  if (pathPoints.length < 2) {
    return null;
  }

  const group = new THREE.Group();
  group.name = `camera-path-world-${shot.id}`;
  group.userData.cameraShotId = shot.id;

  const pathLine = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(pathPoints),
    new THREE.LineBasicMaterial({
      color: 0xfbbf24,
      transparent: true,
      opacity: isActive ? 0.86 : 0.5,
    })
  );
  pathLine.raycast = () => undefined;
  group.add(pathLine);

  motionKeyframes.forEach((keyframe, index) => {
    const isSelectedKeyframe = selectedKeyframeIndex === index;
    const keyframeDot = new THREE.Mesh(
      new THREE.SphereGeometry(isSelectedKeyframe ? 0.095 : 0.062, 12, 12),
      new THREE.MeshStandardMaterial({
        color: isSelectedKeyframe ? 0x34d399 : 0xfbbf24,
        emissive: isSelectedKeyframe ? 0x10b981 : 0xf59e0b,
        emissiveIntensity: 0.55,
        roughness: 0.5,
      })
    );
    keyframeDot.position.set(keyframe.position.x, keyframe.position.y, keyframe.position.z);
    keyframeDot.userData.cameraShotId = shot.id;
    group.add(keyframeDot);
  });

  return group;
}

function buildCameraShotMarker(
  shot: DirectorStageCameraShot,
  isActive: boolean
): THREE.Group {
  const marker = new THREE.Group();
  marker.name = `camera-shot-marker-${shot.id}`;
  marker.userData.cameraShotId = shot.id;
  marker.position.set(shot.position.x, shot.position.y, shot.position.z);

  const target = new THREE.Vector3(shot.target.x, shot.target.y, shot.target.z);
  const position = new THREE.Vector3(shot.position.x, shot.position.y, shot.position.z);
  const direction = target.clone().sub(position);
  const distance = direction.length();
  if (direction.lengthSq() > 0.0001) {
    marker.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), direction.normalize());
  }

  const color = isActive ? 0x34d399 : 0x93c5fd;
  const bodyMaterial = new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: 0.35,
    roughness: 0.55,
  });
  const lineMaterial = new THREE.LineBasicMaterial({
    color,
    transparent: true,
    opacity: isActive ? 0.72 : 0.42,
  });

  const body = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.12, 0.1), bodyMaterial);
  body.userData.cameraShotId = shot.id;
  marker.add(body);

  const lens = new THREE.Mesh(new THREE.ConeGeometry(0.055, 0.14, 16), bodyMaterial);
  lens.rotation.x = -Math.PI / 2;
  lens.position.z = -0.12;
  lens.userData.cameraShotId = shot.id;
  marker.add(lens);

  const targetLine = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 0, -distance),
    ]),
    lineMaterial
  );
  targetLine.raycast = () => undefined;
  marker.add(targetLine);

  const targetDot = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 12), bodyMaterial);
  targetDot.position.set(0, 0, -distance);
  targetDot.userData.cameraShotId = shot.id;
  marker.add(targetDot);

  return marker;
}

function findCameraShotMarkerId(object: THREE.Object3D | null): string | null {
  let current = object;
  while (current) {
    if (typeof current.userData.cameraShotId === 'string') {
      return current.userData.cameraShotId;
    }
    current = current.parent;
  }
  return null;
}

function findDirectorStageLightId(object: THREE.Object3D | null): string | null {
  let current = object;
  while (current) {
    if (typeof current.userData.lightId === 'string') {
      return current.userData.lightId;
    }
    current = current.parent;
  }
  return null;
}

export function DirectorStageWorkspace({
  nodeId,
  data,
  connectedEnvironments = [],
}: DirectorStageWorkspaceProps) {
  const { t } = useTranslation();
  const updateNodeData = useCanvasStore((state) => state.updateNodeData);
  const addDerivedExportNode = useCanvasStore((state) => state.addDerivedExportNode);
  const addDerivedVideoNode = useCanvasStore((state) => state.addDerivedVideoNode);
  const hydrateAssets = useAssetStore((state) => state.hydrate);
  const libraries = useAssetStore((state) => state.libraries);
  const createLibrary = useAssetStore((state) => state.createLibrary);
  const createItem = useAssetStore((state) => state.createItem);
  const updateItem = useAssetStore((state) => state.updateItem);
  const deleteItem = useAssetStore((state) => state.deleteItem);
  const currentProject = useProjectStore((state) => state.currentProject);
  const setCurrentProjectAssetLibrary = useProjectStore(
    (state) => state.setCurrentProjectAssetLibrary
  );
  const flushCurrentProjectToDisk = useProjectStore((state) => state.flushCurrentProjectToDisk);

  const [project, setProject] = useState(() => normalizeDirectorStageProject(data.project));
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('a3d');
  const [statusText, setStatusText] = useState<string | null>(null);
  const [crowdRenderProgress, setCrowdRenderProgress] = useState<Record<string, CrowdRenderProgressItem>>({});
  const [isCapturing, setIsCapturing] = useState(false);
  const [isImportingModel, setIsImportingModel] = useState(false);
  const [isImportingAnimation, setIsImportingAnimation] = useState(false);
  const [deletingModelAssetIds, setDeletingModelAssetIds] = useState<Set<string>>(() => new Set());
  const [deletingAnimationAssetIds, setDeletingAnimationAssetIds] = useState<Set<string>>(() => new Set());
  const [isScaleLocked, setIsScaleLocked] = useState(true);
  const [isPoseControlsOpen, setIsPoseControlsOpen] = useState(true);
  const [isBodyControlsOpen, setIsBodyControlsOpen] = useState(false);
  const [isGeometryPanelOpen, setIsGeometryPanelOpen] = useState(true);
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const [crowdDialogAsset, setCrowdDialogAsset] = useState<DirectorStageBuiltInAsset | null>(null);
  const [cameraLensPanel, setCameraLensPanel] = useState<CameraLensPanelState | null>(null);
  const [cameraPathRecording, setCameraPathRecording] = useState<CameraPathRecordingState | null>(null);
  const [cameraPathPlayback, setCameraPathPlayback] = useState<CameraPathPlaybackState | null>(null);
  const [cameraPathTimeline, setCameraPathTimeline] = useState<CameraPathTimelineState | null>(null);
  const [isCameraPathTimelineCollapsed, setIsCameraPathTimelineCollapsed] = useState(false);
  const [exportingCameraPathShotId, setExportingCameraPathShotId] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const orbitRef = useRef<OrbitControls | null>(null);
  const transformRef = useRef<TransformControls | null>(null);
  const groundGroupRef = useRef<THREE.Group | null>(null);
  const entityGroupRef = useRef<THREE.Group | null>(null);
  const lightGroupRef = useRef<THREE.Group | null>(null);
  const cameraShotGroupRef = useRef<THREE.Group | null>(null);
  const entityObjectsRef = useRef(new Map<string, THREE.Object3D>());
  const crowdGroupObjectsRef = useRef(new Map<string, THREE.Group>());
  const crowdGroupRenderKeysRef = useRef(new Map<string, string>());
  const loadingCrowdGroupRenderKeysRef = useRef(new Map<string, string>());
  const lightObjectsRef = useRef(new Map<string, THREE.Object3D>());
  const loadingEntityIdsRef = useRef(new Set<string>());
  const lastPoseByEntityRef = useRef(new Map<string, string | null>());
  const pendingFrameEntityIdsRef = useRef(new Set<string>());
  const pendingFrameCrowdGroupIdsRef = useRef(new Set<string>());
  const isScaleLockedRef = useRef(true);
  const isApplyingCameraShotViewRef = useRef(false);
  const cameraPathRecordingRef = useRef<{
    shotId: string;
    startedAt: number;
    lastSampleAt: number;
    keyframes: DirectorStageCameraKeyframe[];
    animationFrame: number;
    statusTimer: number | null;
    hiddenLightMarkers: Array<{ object: THREE.Object3D; visible: boolean }>;
  } | null>(null);
  const cameraPathPlaybackRef = useRef<{
    shotId: string;
    startedAt: number;
    durationMs: number;
    elapsedMs: number;
    speed: number;
    clipStartMs: number;
    animationFrame: number;
  } | null>(null);
  const isTransformDraggingRef = useRef(false);
  const pendingExternalProjectRef = useRef<DirectorStageProject | null>(null);
  const syncedNodeIdRef = useRef(nodeId);
  const requestRenderRef = useRef<(durationMs?: number) => void>(() => undefined);
  const deferredProjectEditRef = useRef<DirectorStageDeferredProjectEdit | null>(null);
  const cameraViewBindingRef = useRef<{ shotId: string | null; isFreeView: boolean }>({
    shotId: null,
    isFreeView: true,
  });
  const projectRef = useRef(project);
  const commitProjectRef = useRef<(
    nextProject: DirectorStageProject,
    options?: DirectorStageCommitOptions
  ) => void>(() => undefined);
  const commitActiveCameraShotFromViewRef = useRef<() => boolean>(() => false);

  useEffect(() => {
    void hydrateAssets();
  }, [hydrateAssets]);

  useEffect(() => {
    const normalized = normalizeDirectorStageProject(data.project);
    const nodeChanged = syncedNodeIdRef.current !== nodeId;
    const current = projectRef.current;
    if (!nodeChanged && current.updatedAt === normalized.updatedAt) {
      return;
    }
    if (isTransformDraggingRef.current) {
      pendingExternalProjectRef.current = normalized;
      return;
    }
    syncedNodeIdRef.current = nodeId;
    pendingExternalProjectRef.current = null;
    deferredProjectEditRef.current = null;
    setProject(normalized);
    projectRef.current = normalized;
    requestRenderRef.current();
  }, [data.project, nodeId]);

  const selectedEntity = useMemo(
    () => project.entities.find((entity) => entity.id === project.selectedEntityId) ?? null,
    [project.entities, project.selectedEntityId]
  );
  const selectedCrowdGroup = useMemo(
    () => project.crowdGroups.find((group) => group.id === project.selectedCrowdGroupId) ?? null,
    [project.crowdGroups, project.selectedCrowdGroupId]
  );
  const selectedLight = useMemo(
    () => project.lights.find((light) => light.id === project.selectedLightId) ?? null,
    [project.lights, project.selectedLightId]
  );
  const visibleObjectItems = useMemo(
    () => [
      ...project.crowdGroups.map((group) => ({ kind: 'crowdGroup' as const, group })),
      ...project.entities
        .filter((entity) => !entity.crowdGroupId)
        .map((entity) => ({ kind: 'entity' as const, entity })),
    ],
    [project.crowdGroups, project.entities]
  );
  const existingCrowdGroup = useMemo(
    () => project.crowdGroups.find((group) => group.mode === 'crowd') ?? null,
    [project.crowdGroups]
  );
  const crowdRenderProgressItems = useMemo(
    () => Object.values(crowdRenderProgress).sort((left, right) => left.startedAt - right.startedAt),
    [crowdRenderProgress]
  );
  const activeCrowdRenderProgress = crowdRenderProgressItems[0] ?? null;
  const activeCameraShot = useMemo(
    () => project.cameraShots.find((shot) => shot.id === project.activeCameraShotId) ?? null,
    [project.activeCameraShotId, project.cameraShots]
  );
  const resolveCameraShotDisplayName = useCallback((shot: DirectorStageCameraShot): string => {
    return shot.name === 'Shot 1' ? t('directorStage.camera.defaultShotName') : shot.name;
  }, [t]);
  const cameraLensPanelShot = useMemo(
    () => cameraLensPanel
      ? project.cameraShots.find((shot) => shot.id === cameraLensPanel.shotId) ?? null
      : null,
    [cameraLensPanel, project.cameraShots]
  );
  const userModelAssets = useMemo(
    () => libraries
      .flatMap((library) => library.items.filter(isModelAsset))
      .sort((left, right) => {
        const nameCompare = left.name.localeCompare(right.name, 'zh-Hans-CN', {
          sensitivity: 'base',
        });
        return nameCompare || right.updatedAt - left.updatedAt;
      }),
    [libraries]
  );
  const userAnimationAssets = useMemo(
    () => libraries
      .flatMap((library) => library.items.filter(isDirectorStageAnimationAsset))
      .sort((left, right) => {
        const nameCompare = left.name.localeCompare(right.name, 'zh-Hans-CN', {
          sensitivity: 'base',
        });
        return nameCompare || right.updatedAt - left.updatedAt;
      }),
    [libraries]
  );
  const userPosePresets = useMemo(
    () => userAnimationAssets
      .map(createUserPosePresetFromAsset)
      .filter((preset): preset is DirectorStagePoseOption => preset !== null),
    [userAnimationAssets]
  );
  const resolvePosePresetById = useCallback((posePresetId: string | null | undefined): DirectorStagePoseOption | null => {
    const builtInPreset = getDirectorStagePosePreset(posePresetId);
    if (builtInPreset) {
      return {
        ...builtInPreset,
        origin: 'builtin',
      };
    }
    return userPosePresets.find((preset) => preset.id === posePresetId) ?? null;
  }, [userPosePresets]);
  const resolveEntityPosePreset = useCallback((entity: DirectorStageEntity): DirectorStagePosePreset | null => {
    return resolvePosePresetById(entity.posePresetId) ?? createStoredEntityPosePreset(entity);
  }, [resolvePosePresetById]);
  const snapshotFrameStyle = useMemo<CSSProperties | null>(() => {
    if (!project.snapshot.showMask || viewportSize.width <= 0 || viewportSize.height <= 0) {
      return null;
    }
    const frame = calculateDirectorStageSnapshotFrame(
      viewportSize,
      project.snapshot.aspectRatio
    );
    return {
      left: frame.left,
      top: frame.top,
      width: frame.width,
      height: frame.height,
    };
  }, [project.snapshot.aspectRatio, project.snapshot.showMask, viewportSize]);
  const timelineCameraShot = useMemo(
    () => {
      if (cameraPathTimeline) {
        return project.cameraShots.find((shot) => shot.id === cameraPathTimeline.shotId) ?? activeCameraShot;
      }
      return project.isFreeView ? null : activeCameraShot;
    },
    [activeCameraShot, cameraPathTimeline, project.cameraShots, project.isFreeView]
  );
  const timelineCameraPath = timelineCameraShot?.cameraPath ?? null;
  const timelineMotionKeyframes = useMemo(
    () => timelineCameraPath ? getDirectorStageMotionKeyframes(timelineCameraPath) : [],
    [timelineCameraPath]
  );
  const showCameraPathTimeline = Boolean(timelineCameraShot);
  const showExpandedCameraPathTimeline = showCameraPathTimeline && !isCameraPathTimelineCollapsed;
  const selectedCameraPathSegment = useMemo(() => {
    if (!timelineCameraPath || timelineMotionKeyframes.length < 2) {
      return null;
    }

    const currentTimeline = cameraPathTimeline;
    const selectedIndex = currentTimeline && currentTimeline.shotId === timelineCameraShot?.id
      ? currentTimeline.selectedKeyframeIndex
      : null;
    const segmentIndex = Math.max(
      0,
      Math.min(
        timelineMotionKeyframes.length - 2,
        selectedIndex ?? 0
      )
    );
    const left = timelineMotionKeyframes[segmentIndex];
    const right = timelineMotionKeyframes[segmentIndex + 1];
    if (!left || !right) {
      return null;
    }

    return {
      index: segmentIndex,
      left,
      right,
      key: createDirectorStageCameraPathSegmentKey(left, right),
      easing: resolveDirectorStageCameraPathSegmentEasing(timelineCameraPath, left, right),
    };
  }, [cameraPathTimeline, timelineCameraPath, timelineCameraShot?.id, timelineMotionKeyframes]);

  const commitProject = useCallback((
    nextProject: DirectorStageProject,
    options: DirectorStageCommitOptions = {}
  ) => {
    const normalized = normalizeDirectorStageProject(nextProject);
    projectRef.current = normalized;
    setProject(normalized);
    const historyMode = options.history === 'skip' ? 'skip' : 'push';
    const patch = createProjectNodePatch(normalized);
    updateNodeData(nodeId, patch, { historyMode });
    void emitToMainWindow<DirectorStageUpdateNodePayload>(
      DIRECTOR_STAGE_UPDATE_NODE_EVENT,
      {
        nodeId,
        data: patch,
        historyMode,
      }
    ).catch((error) => {
      console.warn('Failed to sync director stage project to main window', error);
    });
  }, [nodeId, updateNodeData]);

  const previewProjectEdit = useCallback((nextProject: DirectorStageProject) => {
    if (!deferredProjectEditRef.current) {
      deferredProjectEditRef.current = {
        baseProject: projectRef.current,
      };
    }
    commitProject(nextProject, { history: 'skip' });
  }, [commitProject]);

  const commitDeferredProjectEdit = useCallback(() => {
    const deferredEdit = deferredProjectEditRef.current;
    if (!deferredEdit) {
      return;
    }

    deferredProjectEditRef.current = null;
    const finalProject = projectRef.current;
    if (finalProject === deferredEdit.baseProject) {
      return;
    }

    commitProject(deferredEdit.baseProject, { history: 'skip' });
    commitProject(finalProject);
  }, [commitProject]);

  useEffect(() => {
    commitProjectRef.current = commitProject;
  }, [commitProject]);

  useEffect(() => {
    isScaleLockedRef.current = isScaleLocked;
  }, [isScaleLocked]);

  const applyCameraShotToView = useCallback((shot: DirectorStageCameraShot): boolean => {
    const camera = cameraRef.current;
    const orbit = orbitRef.current;
    if (!camera || !orbit) {
      return false;
    }

    isApplyingCameraShotViewRef.current = true;
    applyCameraShot(camera, orbit.target, shot);
    orbit.update();
    requestRenderRef.current(180);
    cameraViewBindingRef.current = {
      shotId: shot.id,
      isFreeView: false,
    };
    window.requestAnimationFrame(() => {
      isApplyingCameraShotViewRef.current = false;
    });
    return true;
  }, []);

  const stopCameraPathPlayback = useCallback(() => {
    const playback = cameraPathPlaybackRef.current;
    if (!playback) {
      return;
    }
    window.cancelAnimationFrame(playback.animationFrame);
    cameraPathPlaybackRef.current = null;
    setCameraPathPlayback(null);
    isApplyingCameraShotViewRef.current = false;
    const orbit = orbitRef.current;
    if (orbit) {
      orbit.enabled = !isTransformDraggingRef.current;
    }
  }, []);

  const commitCameraPathRecording = useCallback((recording: NonNullable<typeof cameraPathRecordingRef.current>) => {
    const cameraPath = createDirectorStageCameraPath(
      recording.keyframes,
      performance.now() - recording.startedAt
    );
    const current = projectRef.current;
    const shot = current.cameraShots.find((item) => item.id === recording.shotId);
    if (!shot || !cameraPath) {
      isApplyingCameraShotViewRef.current = false;
      setStatusText(t('directorStage.camera.recordingTooShort'));
      return;
    }
    const firstKeyframe = getDirectorStageMotionKeyframes(cameraPath)[0];
    const nextShot: DirectorStageCameraShot = {
      ...shot,
      position: firstKeyframe.position,
      target: firstKeyframe.target,
      fov: firstKeyframe.fov,
      focalLengthMm: fovToFocalLength(firstKeyframe.fov),
      cameraPath,
      updatedAt: Date.now(),
    };
    commitProjectRef.current({
      ...current,
      cameraShots: current.cameraShots.map((item) => (item.id === shot.id ? nextShot : item)),
      activeCameraShotId: shot.id,
      isFreeView: false,
      updatedAt: Date.now(),
    });
    applyCameraShotToView(nextShot);
    setCameraPathTimeline({
      shotId: shot.id,
      selectedKeyframeIndex: 0,
      playheadMs: 0,
    });
    setStatusText(t('directorStage.camera.recordingSaved', {
      seconds: cameraPathDurationSeconds(cameraPath),
    }));
  }, [applyCameraShotToView, t]);

  const stopCameraPathRecording = useCallback((shouldCommit = true) => {
    const recording = cameraPathRecordingRef.current;
    if (!recording) {
      return;
    }
    const camera = cameraRef.current;
    const orbit = orbitRef.current;
    if (shouldCommit && camera && orbit) {
      const now = performance.now();
      pushCameraPathRecordingKeyframe(
        recording,
        readCameraPathKeyframe(camera, orbit.target, Math.max(0, now - recording.startedAt)),
        now
      );
    }
    window.cancelAnimationFrame(recording.animationFrame);
    if (recording.statusTimer !== null) {
      window.clearInterval(recording.statusTimer);
    }
    restoreDirectorStageObjectVisibility(recording.hiddenLightMarkers);
    cameraPathRecordingRef.current = null;
    setCameraPathRecording(null);
    if (orbit) {
      orbit.enabled = !isTransformDraggingRef.current;
    }
    if (shouldCommit) {
      commitCameraPathRecording(recording);
    } else {
      isApplyingCameraShotViewRef.current = false;
    }
  }, [commitCameraPathRecording]);

  const startCameraPathRecording = useCallback((shot: DirectorStageCameraShot) => {
    const camera = cameraRef.current;
    const orbit = orbitRef.current;
    if (!camera || !orbit) {
      return;
    }
    stopCameraPathPlayback();
    stopCameraPathRecording(false);
    commitActiveCameraShotFromViewRef.current();
    isApplyingCameraShotViewRef.current = true;
    orbit.enabled = true;
    const startedAt = performance.now();
    const firstKeyframe = readCameraPathKeyframe(camera, orbit.target, 0);
    const recording = {
      shotId: shot.id,
      startedAt,
      lastSampleAt: startedAt,
      keyframes: [firstKeyframe],
      animationFrame: 0,
      statusTimer: null as number | null,
      hiddenLightMarkers: hideDirectorStageObjects(
        collectDirectorStageLightMarkerObjects(lightGroupRef.current)
      ),
    };

    const sampleFrame = () => {
      const currentRecording = cameraPathRecordingRef.current;
      if (!currentRecording || currentRecording.shotId !== shot.id) {
        return;
      }
      const now = performance.now();
      const elapsedMs = Math.max(0, now - currentRecording.startedAt);
      const sampleIntervalMs = 1000 / DIRECTOR_STAGE_CAMERA_PATH_SAMPLE_RATE;
      if (now - currentRecording.lastSampleAt >= sampleIntervalMs) {
        pushCameraPathRecordingKeyframe(
          currentRecording,
          readCameraPathKeyframe(camera, orbit.target, elapsedMs),
          now
        );
      }
      requestRenderRef.current(120);
      currentRecording.animationFrame = window.requestAnimationFrame(sampleFrame);
    };

    recording.statusTimer = window.setInterval(() => {
      const currentRecording = cameraPathRecordingRef.current;
      if (!currentRecording) {
        return;
      }
      setCameraPathRecording({
        shotId: currentRecording.shotId,
        startedAt: currentRecording.startedAt,
        elapsedMs: Math.max(0, performance.now() - currentRecording.startedAt),
      });
    }, DIRECTOR_STAGE_RECORDING_PREVIEW_UPDATE_MS);
    cameraPathRecordingRef.current = recording;
    setCameraPathRecording({ shotId: shot.id, startedAt, elapsedMs: 0 });
    setStatusText(t('directorStage.camera.recordingStarted'));
    recording.animationFrame = window.requestAnimationFrame(sampleFrame);
  }, [stopCameraPathPlayback, stopCameraPathRecording, t]);

  const playCameraPath = useCallback((shot: DirectorStageCameraShot) => {
    const cameraPath = shot.cameraPath;
    if (!cameraPath) {
      return;
    }
    const camera = cameraRef.current;
    const orbit = orbitRef.current;
    if (!camera || !orbit) {
      return;
    }
    stopCameraPathRecording(false);
    stopCameraPathPlayback();
    const timelinePlayheadMs = cameraPathTimeline?.shotId === shot.id
      ? cameraPathTimeline.playheadMs
      : cameraPath.clipStartMs;
    const clipEndMs = cameraPath.clipStartMs + cameraPath.clipDurationMs;
    const startElapsedMs = timelinePlayheadMs > cameraPath.clipStartMs && timelinePlayheadMs < clipEndMs
      ? timelinePlayheadMs - cameraPath.clipStartMs
      : 0;
    isApplyingCameraShotViewRef.current = true;
    orbit.enabled = false;
    const startedAt = performance.now();
    const playback = {
      shotId: shot.id,
      startedAt: startedAt - startElapsedMs,
      durationMs: cameraPath.clipDurationMs,
      speed: 1,
      elapsedMs: startElapsedMs,
      clipStartMs: cameraPath.clipStartMs,
      animationFrame: 0,
    };

    const runFrame = () => {
      const currentPlayback = cameraPathPlaybackRef.current;
      if (!currentPlayback || currentPlayback.shotId !== shot.id || !shot.cameraPath) {
        return;
      }
      const elapsedMs = Math.min(
        cameraPath.clipDurationMs,
        (performance.now() - currentPlayback.startedAt) * currentPlayback.speed
      );
      applyCameraPathKeyframe(
        camera,
        orbit.target,
        sampleDirectorStageCameraPath(cameraPath, cameraPath.clipStartMs + elapsedMs)
      );
      orbit.update();
      requestRenderRef.current();
      setCameraPathPlayback({
        shotId: shot.id,
        startedAt: currentPlayback.startedAt,
        durationMs: currentPlayback.durationMs,
        elapsedMs,
        speed: currentPlayback.speed,
        clipStartMs: currentPlayback.clipStartMs,
      });
      setCameraPathTimeline((current) => (
        current?.shotId === shot.id
          ? { ...current, playheadMs: cameraPath.clipStartMs + elapsedMs }
          : current
      ));
      if (elapsedMs >= cameraPath.clipDurationMs) {
        isApplyingCameraShotViewRef.current = false;
        stopCameraPathPlayback();
        return;
      }
      currentPlayback.animationFrame = window.requestAnimationFrame(runFrame);
    };

    cameraPathPlaybackRef.current = playback;
    setCameraPathPlayback(playback);
    runFrame();
  }, [cameraPathTimeline, stopCameraPathPlayback, stopCameraPathRecording]);

  const toggleCameraPathPlayback = useCallback((shot: DirectorStageCameraShot) => {
    if (cameraPathPlaybackRef.current?.shotId === shot.id) {
      stopCameraPathPlayback();
      return;
    }
    playCameraPath(shot);
  }, [playCameraPath, stopCameraPathPlayback]);

  const commitActiveCameraShotFromView = useCallback((): boolean => {
    if (isApplyingCameraShotViewRef.current) {
      return false;
    }
    const camera = cameraRef.current;
    const orbit = orbitRef.current;
    if (!camera || !orbit) {
      return false;
    }

    const current = projectRef.current;
    if (current.isFreeView || !current.activeCameraShotId) {
      return false;
    }
    const activeShot = current.cameraShots.find((shot) => shot.id === current.activeCameraShotId);
    if (!activeShot) {
      return false;
    }

    const nextShot = {
      ...readCameraShot(camera, orbit.target, activeShot.id, activeShot.name),
      createdAt: activeShot.createdAt,
    };
    if (!hasCameraShotViewChanged(activeShot, nextShot)) {
      return false;
    }

    const preservedPath = activeShot.cameraPath;
    if (preservedPath) {
      (nextShot as DirectorStageCameraShot).cameraPath = preservedPath;
    }
    cameraViewBindingRef.current = {
      shotId: activeShot.id,
      isFreeView: false,
    };
    commitProjectRef.current({
      ...current,
      cameraShots: current.cameraShots.map((shot) => (shot.id === activeShot.id ? nextShot : shot)),
      updatedAt: Date.now(),
    });
    return true;
  }, []);

  useEffect(() => {
    commitActiveCameraShotFromViewRef.current = commitActiveCameraShotFromView;
  }, [commitActiveCameraShotFromView]);

  const frameEntityObjectInView = useCallback((entityId: string): boolean => {
    const camera = cameraRef.current;
    const orbit = orbitRef.current;
    const object = entityObjectsRef.current.get(entityId);
    if (!camera || !orbit || !object) {
      return false;
    }

    const framed = frameObjectInCamera(camera, orbit.target, object);
    if (framed) {
      orbit.update();
      requestRenderRef.current(180);
    }
    return framed;
  }, []);

  const frameCrowdGroupObjectInView = useCallback((groupId: string): boolean => {
    const camera = cameraRef.current;
    const orbit = orbitRef.current;
    const object = crowdGroupObjectsRef.current.get(groupId);
    if (!camera || !orbit || !object) {
      return false;
    }

    const framed = frameObjectInCamera(camera, orbit.target, object);
    if (framed) {
      orbit.update();
      requestRenderRef.current(180);
    }
    return framed;
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const scene = createDirectorStageScene();
    const renderer = createDirectorStageRenderer();
    const camera = new THREE.PerspectiveCamera(42, 16 / 9, 0.05, 200);
    const orbit = new OrbitControls(camera, renderer.domElement);
    const transform = new TransformControls(camera, renderer.domElement);
    const groundGroup = buildDirectorStageGround();
    const entityGroup = new THREE.Group();
    const lightGroup = new THREE.Group();
    const cameraShotGroup = new THREE.Group();
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let animationFrame = 0;
    let continuousRenderUntil = 0;
    let isRenderingFrame = false;
    let isDisposed = false;
    let pointerDownCameraShotId: string | null = null;
    let pointerDownPosition: { x: number; y: number } | null = null;

    camera.position.set(4, 2.4, 5);
    orbit.target.set(0, 1.2, 0);
    orbit.enableDamping = true;
    orbit.dampingFactor = 0.08;
    orbit.enablePan = true;
    orbit.enableRotate = true;
    orbit.enableZoom = true;
    orbit.minDistance = 0.35;
    orbit.maxDistance = 80;
    orbit.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.PAN,
    };
    orbit.update();
    groundGroup.visible = projectRef.current.showGroundGrid;
    scene.add(groundGroup, entityGroup, lightGroup, cameraShotGroup, transform.getHelper());
    renderer.domElement.className = 'h-full w-full touch-none';
    container.appendChild(renderer.domElement);

    sceneRef.current = scene;
    rendererRef.current = renderer;
    cameraRef.current = camera;
    orbitRef.current = orbit;
    transformRef.current = transform;
    groundGroupRef.current = groundGroup;
    entityGroupRef.current = entityGroup;
    lightGroupRef.current = lightGroup;
    cameraShotGroupRef.current = cameraShotGroup;

    const resize = () => {
      const rect = container.getBoundingClientRect();
      const width = Math.max(1, Math.floor(rect.width));
      const height = Math.max(1, Math.floor(rect.height));
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      setViewportSize((current) =>
        current.width === width && current.height === height ? current : { width, height }
      );
      requestRender();
    };

    const renderFrame = () => {
      animationFrame = 0;
      if (isDisposed) {
        return;
      }
      isRenderingFrame = true;
      orbit.update();
      renderer.render(scene, camera);
      isRenderingFrame = false;
      if (performance.now() < continuousRenderUntil) {
        animationFrame = window.requestAnimationFrame(renderFrame);
      }
    };

    const requestRender = (durationMs = 0) => {
      if (isDisposed) {
        return;
      }
      if (durationMs > 0) {
        continuousRenderUntil = Math.max(continuousRenderUntil, performance.now() + durationMs);
      }
      if (isRenderingFrame) {
        return;
      }
      if (animationFrame === 0) {
        animationFrame = window.requestAnimationFrame(renderFrame);
      }
    };

    requestRenderRef.current = requestRender;

    let activeTransformEntityId: string | null = null;
    let activeTransformCrowdGroupId: string | null = null;
    let activeTransformLightId: string | null = null;

    const readObjectTransformForCommit = (object: THREE.Object3D) => {
      const crowdGroupId = findDirectorStageCrowdGroupId(object);
      if (crowdGroupId) {
        const crowdGroup = projectRef.current.crowdGroups.find((item) => item.id === crowdGroupId);
        let nextTransform = readEntityTransform(object);
        if (crowdGroup && projectRef.current.transformMode === 'scale' && isScaleLockedRef.current) {
          const scaleAxis = (['x', 'y', 'z'] as const).reduce((bestAxis, axis) => {
            const bestDelta = Math.abs(nextTransform.scale[bestAxis] - crowdGroup.transform.scale[bestAxis]);
            const axisDelta = Math.abs(nextTransform.scale[axis] - crowdGroup.transform.scale[axis]);
            return axisDelta > bestDelta ? axis : bestAxis;
          }, 'x');
          const uniformScale = clampDirectorStageScale(
            nextTransform.scale[scaleAxis],
            crowdGroup.transform.scale[scaleAxis]
          );
          nextTransform = {
            ...nextTransform,
            scale: createStageVector3(uniformScale, uniformScale, uniformScale),
          };
          object.scale.set(uniformScale, uniformScale, uniformScale);
          object.updateMatrixWorld(true);
        } else if (projectRef.current.transformMode === 'scale') {
          const fallbackScale = crowdGroup?.transform.scale ?? createStageVector3(1, 1, 1);
          nextTransform = {
            ...nextTransform,
            scale: createStageVector3(
              clampDirectorStageScale(nextTransform.scale.x, fallbackScale.x),
              clampDirectorStageScale(nextTransform.scale.y, fallbackScale.y),
              clampDirectorStageScale(nextTransform.scale.z, fallbackScale.z)
            ),
          };
          object.scale.set(nextTransform.scale.x, nextTransform.scale.y, nextTransform.scale.z);
          object.updateMatrixWorld(true);
        }
        return { kind: 'crowdGroup' as const, crowdGroupId, nextTransform };
      }

      const entityId = findDirectorStageEntityId(object);
      if (!entityId) {
        return null;
      }
      const entity = projectRef.current.entities.find((item) => item.id === entityId);
      let nextTransform = readEntityTransform(object);
      if (entity && projectRef.current.transformMode === 'scale' && isScaleLockedRef.current) {
        const scaleAxis = (['x', 'y', 'z'] as const).reduce((bestAxis, axis) => {
          const bestDelta = Math.abs(nextTransform.scale[bestAxis] - entity.transform.scale[bestAxis]);
          const axisDelta = Math.abs(nextTransform.scale[axis] - entity.transform.scale[axis]);
          return axisDelta > bestDelta ? axis : bestAxis;
        }, 'x');
        const uniformScale = clampDirectorStageScale(
          nextTransform.scale[scaleAxis],
          entity.transform.scale[scaleAxis]
        );
        nextTransform = {
          ...nextTransform,
          scale: createStageVector3(uniformScale, uniformScale, uniformScale),
        };
        object.scale.set(uniformScale, uniformScale, uniformScale);
        object.updateMatrixWorld(true);
      } else if (projectRef.current.transformMode === 'scale') {
        const fallbackScale = entity?.transform.scale ?? createStageVector3(1, 1, 1);
        nextTransform = {
          ...nextTransform,
          scale: createStageVector3(
            clampDirectorStageScale(nextTransform.scale.x, fallbackScale.x),
            clampDirectorStageScale(nextTransform.scale.y, fallbackScale.y),
            clampDirectorStageScale(nextTransform.scale.z, fallbackScale.z)
          ),
        };
        object.scale.set(nextTransform.scale.x, nextTransform.scale.y, nextTransform.scale.z);
        object.updateMatrixWorld(true);
      }
      return { kind: 'entity' as const, entityId, nextTransform };
    };

    const commitObjectTransform = (object: THREE.Object3D) => {
      const result = readObjectTransformForCommit(object);
      if (!result) {
        return;
      }
      if (result.kind === 'crowdGroup') {
        commitProjectRef.current(
          patchDirectorStageCrowdGroup(projectRef.current, result.crowdGroupId, {
            transform: result.nextTransform,
          })
        );
        return;
      }
      commitProjectRef.current(
        patchDirectorStageEntity(projectRef.current, result.entityId, {
          transform: result.nextTransform,
        })
      );
    };

    const commitLightTransform = (object: THREE.Object3D) => {
      const lightId = findDirectorStageLightId(object);
      if (!lightId) {
        return;
      }
      const current = projectRef.current;
      const light = current.lights.find((item) => item.id === lightId);
      if (!light || light.kind === 'ambient') {
        return;
      }

      const nextPosition = createStageVector3(object.position.x, object.position.y, object.position.z);
      commitProjectRef.current({
        ...current,
        lights: current.lights.map((item) =>
          item.id === lightId ? { ...item, position: nextPosition } : item
        ),
        updatedAt: Date.now(),
      });
    };

    const handleDraggingChanged = (event: { value: unknown }) => {
      const isDragging = event.value === true;
      isTransformDraggingRef.current = isDragging;
      orbit.enabled = !isDragging;
      requestRender(isDragging ? 1000 : 180);
      const object = transform.object;
      if (isDragging) {
        activeTransformEntityId = object ? findDirectorStageEntityId(object) : null;
        activeTransformCrowdGroupId = object ? findDirectorStageCrowdGroupId(object) : null;
        activeTransformLightId = object ? findDirectorStageLightId(object) : null;
        return;
      }

      const pendingExternalProject = pendingExternalProjectRef.current;
      if (pendingExternalProject) {
        pendingExternalProjectRef.current = null;
        activeTransformEntityId = null;
        activeTransformCrowdGroupId = null;
        activeTransformLightId = null;
        syncedNodeIdRef.current = nodeId;
        projectRef.current = pendingExternalProject;
        setProject(pendingExternalProject);
        return;
      }

      if (object && (activeTransformCrowdGroupId || findDirectorStageCrowdGroupId(object))) {
        commitObjectTransform(object);
      } else if (object && (activeTransformEntityId || findDirectorStageEntityId(object))) {
        commitObjectTransform(object);
      } else if (object && (activeTransformLightId || findDirectorStageLightId(object))) {
        commitLightTransform(object);
      }
      activeTransformEntityId = null;
      activeTransformCrowdGroupId = null;
      activeTransformLightId = null;
    };

    const handleObjectChange = () => {
      const object = transform.object;
      if (!object) {
        return;
      }
      if (findDirectorStageLightId(object)) {
        requestRender(transform.dragging ? 1000 : 180);
        if (!transform.dragging) {
          commitLightTransform(object);
        }
        return;
      }
      readObjectTransformForCommit(object);
      requestRender(transform.dragging ? 1000 : 180);
      if (!transform.dragging) {
        commitObjectTransform(object);
      }
    };

    let cameraShotCommitTimer: number | null = null;
    const scheduleActiveCameraShotCommit = () => {
      if (
        isApplyingCameraShotViewRef.current
        || cameraPathRecordingRef.current
        || cameraPathPlaybackRef.current
        || projectRef.current.isFreeView
      ) {
        return;
      }
      if (cameraShotCommitTimer !== null) {
        return;
      }
      cameraShotCommitTimer = window.setTimeout(() => {
        cameraShotCommitTimer = null;
        commitActiveCameraShotFromView();
      }, 120);
    };

    const flushActiveCameraShotCommit = () => {
      if (cameraShotCommitTimer !== null) {
        window.clearTimeout(cameraShotCommitTimer);
        cameraShotCommitTimer = null;
      }
      commitActiveCameraShotFromView();
    };

    const handleOrbitChange = () => {
      scheduleActiveCameraShotCommit();
      requestRender(220);
    };

    const handleOrbitEnd = () => {
      flushActiveCameraShotCommit();
      requestRender(180);
    };

    const handlePointerDown = (event: PointerEvent) => {
      requestRender(220);
      if (event.button !== 0 || transform.dragging) {
        return;
      }
      pointerDownCameraShotId = null;
      pointerDownPosition = { x: event.clientX, y: event.clientY };
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const current = projectRef.current;
      if (current.isFreeView) {
        const cameraShotGroup = cameraShotGroupRef.current;
        const cameraShotHits = cameraShotGroup
          ? raycaster.intersectObjects(cameraShotGroup.children, true)
          : [];
        const cameraShotId = findCameraShotMarkerId(cameraShotHits[0]?.object ?? null);
        const cameraShot = current.cameraShots.find((shot) => shot.id === cameraShotId);
        if (cameraShot) {
          pointerDownCameraShotId = cameraShot.id;
          return;
        }
      }
      const lightHits = raycaster.intersectObjects([...lightObjectsRef.current.values()], true);
      const lightId = findDirectorStageLightId(lightHits[0]?.object ?? null);
      if (lightId) {
        if (lightId === current.selectedLightId) {
          return;
        }
        commitProjectRef.current({
          ...current,
          selectedEntityId: null,
          selectedCrowdGroupId: null,
          selectedLightId: lightId,
          updatedAt: Date.now(),
        }, { history: 'skip' });
        return;
      }
      const intersections = raycaster.intersectObjects([
        ...crowdGroupObjectsRef.current.values(),
        ...entityObjectsRef.current.values(),
      ], true);
      const hitObject = intersections[0]?.object ?? null;
      const crowdGroupId = findDirectorStageCrowdGroupId(hitObject);
      const entityId = crowdGroupId ? null : findDirectorStageEntityId(hitObject);
      if (
        (crowdGroupId && crowdGroupId === current.selectedCrowdGroupId)
        || (!crowdGroupId && entityId === current.selectedEntityId)
      ) {
        return;
      }
      commitProjectRef.current({
        ...current,
        selectedEntityId: crowdGroupId ? null : entityId,
        selectedCrowdGroupId: crowdGroupId,
        selectedLightId: null,
        updatedAt: Date.now(),
      }, { history: 'skip' });
    };

    const handlePointerUp = (event: PointerEvent) => {
      requestRender(180);
      if (!pointerDownPosition || !pointerDownCameraShotId || transform.dragging) {
        pointerDownCameraShotId = null;
        pointerDownPosition = null;
        return;
      }

      const movedDistance = Math.hypot(
        event.clientX - pointerDownPosition.x,
        event.clientY - pointerDownPosition.y
      );
      const cameraShotId = pointerDownCameraShotId;
      pointerDownCameraShotId = null;
      pointerDownPosition = null;
      if (movedDistance > 5 || !projectRef.current.isFreeView) {
        return;
      }

      const current = projectRef.current;
      const cameraShot = current.cameraShots.find((shot) => shot.id === cameraShotId);
      if (!cameraShot) {
        return;
      }

      applyCameraShotToView(cameraShot);
      setCameraPathTimeline({
        shotId: cameraShot.id,
        selectedKeyframeIndex: 0,
        playheadMs: 0,
      });
      commitProjectRef.current({
        ...current,
        activeCameraShotId: cameraShot.id,
        isFreeView: false,
        selectedEntityId: null,
        selectedCrowdGroupId: null,
        selectedLightId: null,
        updatedAt: Date.now(),
      }, { history: 'skip' });
    };

    transform.addEventListener('dragging-changed', handleDraggingChanged);
    transform.addEventListener('objectChange', handleObjectChange);
    orbit.addEventListener('change', handleOrbitChange);
    orbit.addEventListener('end', handleOrbitEnd);
    renderer.domElement.addEventListener('pointerdown', handlePointerDown);
    renderer.domElement.addEventListener('pointerup', handlePointerUp);
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    resize();
    requestRender();

    return () => {
      isDisposed = true;
      window.cancelAnimationFrame(animationFrame);
      observer.disconnect();
      if (cameraShotCommitTimer !== null) {
        window.clearTimeout(cameraShotCommitTimer);
      }
      transform.removeEventListener('dragging-changed', handleDraggingChanged);
      transform.removeEventListener('objectChange', handleObjectChange);
      orbit.removeEventListener('change', handleOrbitChange);
      orbit.removeEventListener('end', handleOrbitEnd);
      renderer.domElement.removeEventListener('pointerdown', handlePointerDown);
      renderer.domElement.removeEventListener('pointerup', handlePointerUp);
      transform.dispose();
      orbit.dispose();
      entityObjectsRef.current.forEach(disposeDirectorStageObject);
      entityObjectsRef.current.clear();
      crowdGroupObjectsRef.current.forEach(disposeDirectorStageCrowdLodGroup);
      crowdGroupObjectsRef.current.clear();
      crowdGroupRenderKeysRef.current.clear();
      loadingCrowdGroupRenderKeysRef.current.clear();
      lightObjectsRef.current.forEach(disposeDirectorStageLightObject);
      lightObjectsRef.current.clear();
      disposeCameraShotMarkers(cameraShotGroup);
      disposeDirectorStageGround(groundGroup);
      renderer.dispose();
      renderer.domElement.remove();
      sceneRef.current = null;
      rendererRef.current = null;
      cameraRef.current = null;
      orbitRef.current = null;
      transformRef.current = null;
      groundGroupRef.current = null;
      entityGroupRef.current = null;
      lightGroupRef.current = null;
      cameraShotGroupRef.current = null;
      requestRenderRef.current = () => undefined;
    };
  }, []);

  useEffect(() => {
    const entityGroup = entityGroupRef.current;
    if (!entityGroup) {
      return;
    }

    const currentCrowdGroupIds = new Set(project.crowdGroups.map((group) => group.id));
    const removedCrowdGroupIds: string[] = [];
    crowdGroupObjectsRef.current.forEach((object, groupId) => {
      if (currentCrowdGroupIds.has(groupId)) {
        return;
      }
      entityGroup.remove(object);
      disposeDirectorStageCrowdLodGroup(object);
      crowdGroupObjectsRef.current.delete(groupId);
      crowdGroupRenderKeysRef.current.delete(groupId);
      loadingCrowdGroupRenderKeysRef.current.delete(groupId);
      removedCrowdGroupIds.push(groupId);
      requestRenderRef.current();
    });
    if (removedCrowdGroupIds.length > 0) {
      setCrowdRenderProgress((current) => {
        const next = { ...current };
        removedCrowdGroupIds.forEach((groupId) => {
          delete next[groupId];
        });
        return next;
      });
    }
    loadingCrowdGroupRenderKeysRef.current.forEach((_, groupId) => {
      if (!currentCrowdGroupIds.has(groupId)) {
        loadingCrowdGroupRenderKeysRef.current.delete(groupId);
      }
    });

    const tryFramePendingCrowdGroup = (groupId: string | null | undefined) => {
      if (!groupId || !pendingFrameCrowdGroupIdsRef.current.has(groupId)) {
        return;
      }
      const object = crowdGroupObjectsRef.current.get(groupId);
      if (!object) {
        return;
      }
      pendingFrameCrowdGroupIdsRef.current.delete(groupId);
      frameCrowdGroupObjectInView(groupId);
    };

    const attachSelectedCrowdGroupObject = (groupId: string, object: THREE.Group) => {
      if (projectRef.current.selectedCrowdGroupId !== groupId) {
        return;
      }
      const transform = transformRef.current;
      if (!transform) {
        return;
      }
      transform.attach(object);
      transform.setMode(projectRef.current.transformMode);
      transform.enabled = true;
      transform.getHelper().visible = true;
    };

    project.crowdGroups.forEach((group) => {
      const asset = getDirectorStageCharacterAsset(group.assetId);
      if (!asset) {
        return;
      }
      const renderKey = createCrowdGroupRenderKey(group);
      const existing = crowdGroupObjectsRef.current.get(group.id);
      if (existing) {
        existing.name = group.name;
        existing.userData.crowdGroupId = group.id;
        applyEntityTransform(existing, group.transform);
        requestRenderRef.current();
      }
      if (existing && crowdGroupRenderKeysRef.current.get(group.id) === renderKey) {
        tryFramePendingCrowdGroup(group.id);
        return;
      }
      if (loadingCrowdGroupRenderKeysRef.current.get(group.id) === renderKey) {
        return;
      }

      loadingCrowdGroupRenderKeysRef.current.set(group.id, renderKey);
      setCrowdRenderProgress((current) => ({
        ...current,
        [group.id]: {
          groupId: group.id,
          groupName: group.name,
          renderKey,
          phase: 'queued',
          progress: 0.02,
          completed: 0,
          total: Math.max(1, group.layout.count),
          startedAt: current[group.id]?.startedAt ?? Date.now(),
        },
      }));
      void loadDirectorStageCrowdLodGroup({
        group,
        asset,
        onProgress: (progress) => {
          if (loadingCrowdGroupRenderKeysRef.current.get(group.id) !== renderKey) {
            return;
          }
          setCrowdRenderProgress((current) => ({
            ...current,
            [group.id]: {
              groupId: group.id,
              groupName: projectRef.current.crowdGroups.find((item) => item.id === group.id)?.name ?? group.name,
              renderKey,
              ...progress,
              startedAt: current[group.id]?.startedAt ?? Date.now(),
            },
          }));
        },
      })
        .then((object) => {
          if (loadingCrowdGroupRenderKeysRef.current.get(group.id) !== renderKey) {
            disposeDirectorStageCrowdLodGroup(object);
            return;
          }

          const currentGroup = projectRef.current.crowdGroups.find((item) => item.id === group.id);
          if (!currentGroup) {
            loadingCrowdGroupRenderKeysRef.current.delete(group.id);
            setCrowdRenderProgress((current) => {
              const next = { ...current };
              delete next[group.id];
              return next;
            });
            disposeDirectorStageCrowdLodGroup(object);
            return;
          }

          if (createCrowdGroupRenderKey(currentGroup) !== renderKey) {
            loadingCrowdGroupRenderKeysRef.current.delete(group.id);
            disposeDirectorStageCrowdLodGroup(object);
            return;
          }

          loadingCrowdGroupRenderKeysRef.current.delete(group.id);
          const previous = crowdGroupObjectsRef.current.get(group.id);
          if (previous) {
            entityGroup.remove(previous);
            disposeDirectorStageCrowdLodGroup(previous);
          }

          object.name = currentGroup.name;
          object.userData.crowdGroupId = currentGroup.id;
          applyEntityTransform(object, currentGroup.transform);
          crowdGroupObjectsRef.current.set(currentGroup.id, object);
          crowdGroupRenderKeysRef.current.set(currentGroup.id, renderKey);
          entityGroup.add(object);
          attachSelectedCrowdGroupObject(currentGroup.id, object);
          tryFramePendingCrowdGroup(currentGroup.id);
          requestRenderRef.current();
          setCrowdRenderProgress((current) => ({
            ...current,
            [currentGroup.id]: {
              groupId: currentGroup.id,
              groupName: currentGroup.name,
              renderKey,
              phase: 'ready',
              progress: 1,
              completed: Math.max(1, currentGroup.layout.count),
              total: Math.max(1, currentGroup.layout.count),
              startedAt: current[currentGroup.id]?.startedAt ?? Date.now(),
            },
          }));
          window.setTimeout(() => {
            setCrowdRenderProgress((current) => {
              if (current[currentGroup.id]?.renderKey !== renderKey) {
                return current;
              }
              const next = { ...current };
              delete next[currentGroup.id];
              return next;
            });
          }, 450);
          setStatusText(null);
        })
        .catch(() => {
          if (loadingCrowdGroupRenderKeysRef.current.get(group.id) === renderKey) {
            loadingCrowdGroupRenderKeysRef.current.delete(group.id);
          }
          setCrowdRenderProgress((current) => {
            if (current[group.id]?.renderKey !== renderKey) {
              return current;
            }
            const next = { ...current };
            delete next[group.id];
            return next;
          });
          setStatusText(t('directorStage.status.modelLoadFailed'));
        });
    });

    const currentEntityIds = new Set(
      project.entities
        .filter((entity) => !entity.crowdGroupId)
        .map((entity) => entity.id)
    );
    entityObjectsRef.current.forEach((object, entityId) => {
      if (currentEntityIds.has(entityId)) {
        return;
      }
      object.parent?.remove(object);
      disposeDirectorStageObject(object);
      entityObjectsRef.current.delete(entityId);
      lastPoseByEntityRef.current.delete(entityId);
      requestRenderRef.current();
    });

    project.entities.forEach((entity) => {
      if (entity.crowdGroupId) {
        return;
      }

      const existing = entityObjectsRef.current.get(entity.id);
      if (existing) {
        existing.name = entity.name;
        existing.userData.entityId = entity.id;
        if (existing.parent !== entityGroup) {
          existing.parent?.remove(existing);
          entityGroup.add(existing);
        }
        normalizeDirectorStageObjectContent(existing);
        applyEntityTransform(existing, entity.transform);
        applyEntityMaterial(existing, entity);
        requestRenderRef.current();
        return;
      }

      if (entity.loadError || loadingEntityIdsRef.current.has(entity.id)) {
        return;
      }

      loadingEntityIdsRef.current.add(entity.id);
      void loadDirectorStageModel(entity)
        .then((object) => {
          loadingEntityIdsRef.current.delete(entity.id);
          if (!projectRef.current.entities.some((item) => item.id === entity.id)) {
            disposeDirectorStageObject(object);
            return;
          }
          const currentEntity = projectRef.current.entities.find((item) => item.id === entity.id);
          if (!currentEntity || currentEntity.crowdGroupId) {
            disposeDirectorStageObject(object);
            return;
          }
          entityObjectsRef.current.set(entity.id, object);
          entityGroup.add(object);
          normalizeDirectorStageObjectContent(object);
          applyEntityTransform(object, currentEntity.transform);
          applyEntityMaterial(object, currentEntity);
          if (projectRef.current.selectedEntityId === entity.id) {
            const transform = transformRef.current;
            if (transform) {
              transform.attach(object);
              transform.setMode(projectRef.current.transformMode);
              transform.enabled = true;
              transform.getHelper().visible = true;
            }
          }
          if (pendingFrameEntityIdsRef.current.delete(entity.id)) {
            frameEntityObjectInView(entity.id);
          }
          requestRenderRef.current();
          const posePreset = resolveEntityPosePreset(currentEntity);
          if (posePreset) {
            lastPoseByEntityRef.current.set(entity.id, posePreset.id);
            void applyPosePresetToObject(object, posePreset)
              .then((compatible) => {
                normalizeDirectorStageObjectContent(object);
                const latestEntity = projectRef.current.entities.find((item) => item.id === entity.id);
                if (latestEntity && projectRef.current.selectedEntityId === latestEntity.id) {
                  applyDirectorStageLimbPoseToObject(object, latestEntity);
                }
                requestRenderRef.current();
                if (!compatible) {
                  commitProjectRef.current(
                    patchDirectorStageEntity(projectRef.current, entity.id, {
                      skeletonCompatible: false,
                    }),
                    { history: 'skip' }
                  );
                }
              })
              .catch(() => {
                commitProjectRef.current(
                  patchDirectorStageEntity(projectRef.current, entity.id, {
                    skeletonCompatible: false,
                  }),
                  { history: 'skip' }
                );
              });
          } else {
            if (projectRef.current.selectedEntityId === currentEntity.id) {
              applyDirectorStageLimbPoseToObject(object, currentEntity);
            }
            requestRenderRef.current();
          }
          setStatusText(null);
        })
        .catch((error) => {
          loadingEntityIdsRef.current.delete(entity.id);
          const message = error instanceof Error ? error.message : String(error);
          setStatusText(t('directorStage.status.modelLoadFailed'));
          commitProjectRef.current(
            patchDirectorStageEntity(projectRef.current, entity.id, {
              loadError: message,
            }),
            { history: 'skip' }
          );
        });
    });
    Array.from(pendingFrameCrowdGroupIdsRef.current).forEach(tryFramePendingCrowdGroup);
  }, [
    frameCrowdGroupObjectInView,
    frameEntityObjectInView,
    project.crowdGroups,
    project.entities,
    resolveEntityPosePreset,
    t,
  ]);

  useEffect(() => {
    const selectedEntityId = project.selectedEntityId;
    project.entities.forEach((entity) => {
      if (entity.crowdGroupId || entity.id !== selectedEntityId) {
        return;
      }
      const object = entityObjectsRef.current.get(entity.id);
      const posePreset = resolveEntityPosePreset(entity);
      const lastPoseId = lastPoseByEntityRef.current.get(entity.id) ?? null;
      if (!object) {
        return;
      }
      if (!posePreset) {
        if (lastPoseId) {
          clearPoseFromObject(object);
          normalizeDirectorStageObjectContent(object);
          lastPoseByEntityRef.current.delete(entity.id);
        }
        applyDirectorStageLimbPoseToObject(object, entity);
        requestRenderRef.current();
        return;
      }
      if (lastPoseId === posePreset.id) {
        applyDirectorStageLimbPoseToObject(object, entity);
        requestRenderRef.current();
        return;
      }
      lastPoseByEntityRef.current.set(entity.id, posePreset.id);
      void applyPosePresetToObject(object, posePreset)
        .then((compatible) => {
          normalizeDirectorStageObjectContent(object);
          const latestEntity = projectRef.current.entities.find((item) => item.id === entity.id);
          if (latestEntity) {
            applyDirectorStageLimbPoseToObject(object, latestEntity);
          }
          requestRenderRef.current();
          if (!compatible) {
            commitProjectRef.current(
              patchDirectorStageEntity(projectRef.current, entity.id, {
                skeletonCompatible: false,
              }),
              { history: 'skip' }
            );
          }
        })
        .catch(() => {
          commitProjectRef.current(
            patchDirectorStageEntity(projectRef.current, entity.id, {
              skeletonCompatible: false,
            }),
            { history: 'skip' }
          );
        });
    });
  }, [project.entities, project.selectedEntityId, resolveEntityPosePreset]);

  useEffect(() => {
    const lightGroup = lightGroupRef.current;
    if (!lightGroup) {
      return;
    }
    lightObjectsRef.current.forEach(disposeDirectorStageLightObject);
    lightObjectsRef.current.clear();
    lightGroup.clear();
    project.lights.forEach((light) => {
      const lightObject = buildDirectorStageLight(light);
      lightObjectsRef.current.set(light.id, lightObject);
      lightGroup.add(lightObject);
    });
    requestRenderRef.current();
  }, [project.lights]);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) {
      return;
    }
    if (!project.environment.backgroundPath) {
      scene.background = new THREE.Color('#15171b');
      scene.environment = null;
      requestRenderRef.current();
      return;
    }
    const loader = new THREE.TextureLoader();
    const texture = loader.load(resolveImageDisplayUrl(project.environment.backgroundPath));
    texture.mapping = THREE.EquirectangularReflectionMapping;
    texture.colorSpace = THREE.SRGBColorSpace;
    scene.background = texture;
    scene.environment = texture;
    requestRenderRef.current();
    return () => {
      texture.dispose();
    };
  }, [project.environment.backgroundPath]);

  useEffect(() => {
    const groundGroup = groundGroupRef.current;
    if (!groundGroup) {
      return;
    }

    updateDirectorStageGroundAppearance(
      groundGroup,
      createDirectorStageDefaultGroundAppearance()
    );
    requestRenderRef.current();

    const sampleSource = project.environment.previewPath ?? project.environment.backgroundPath;
    if (!sampleSource) {
      return;
    }

    let isCancelled = false;
    void sampleDirectorStageGroundColor(resolveImageDisplayUrl(sampleSource))
      .then((color) => {
        if (isCancelled) {
          return;
        }
        updateDirectorStageGroundAppearance(
          groundGroup,
          createDirectorStageGroundAppearanceFromEnvironmentColor(color)
        );
        requestRenderRef.current();
      })
      .catch(() => {
        if (isCancelled) {
          return;
        }
        updateDirectorStageGroundAppearance(
          groundGroup,
          createDirectorStageDefaultGroundAppearance()
        );
        requestRenderRef.current();
      });

    return () => {
      isCancelled = true;
    };
  }, [project.environment.backgroundPath, project.environment.previewPath]);

  useEffect(() => {
    const transform = transformRef.current;
    if (!transform) {
      return;
    }
    const object = project.selectedCrowdGroupId
      ? crowdGroupObjectsRef.current.get(project.selectedCrowdGroupId) ?? null
      : project.selectedEntityId
        ? entityObjectsRef.current.get(project.selectedEntityId) ?? null
        : null;
    if (object) {
      transform.attach(object);
      transform.setMode(project.transformMode);
      transform.enabled = true;
      transform.getHelper().visible = true;
      requestRenderRef.current();
    } else if (selectedLight && selectedLight.kind !== 'ambient') {
      const lightObject = lightObjectsRef.current.get(selectedLight.id) ?? null;
      if (lightObject) {
        transform.attach(lightObject);
        transform.setMode('translate');
        transform.enabled = true;
        transform.getHelper().visible = true;
        requestRenderRef.current();
      } else {
        transform.detach();
        transform.enabled = false;
        transform.getHelper().visible = false;
        requestRenderRef.current();
      }
    } else {
      transform.detach();
      transform.enabled = false;
      transform.getHelper().visible = false;
      requestRenderRef.current();
    }
  }, [
    project.entities.length,
    project.crowdGroups,
    project.lights,
    project.selectedCrowdGroupId,
    project.selectedEntityId,
    project.transformMode,
    selectedLight,
  ]);

  useEffect(() => {
    const groundGroup = groundGroupRef.current;
    if (!groundGroup) {
      return;
    }
    groundGroup.visible = project.showGroundGrid;
    requestRenderRef.current();
  }, [project.showGroundGrid]);

  useEffect(() => {
    const camera = cameraRef.current;
    const orbit = orbitRef.current;
    if (!camera || !orbit || project.isFreeView || !activeCameraShot) {
      if (project.isFreeView) {
        if (camera && orbit && activeCameraShot && (
          cameraViewBindingRef.current.shotId !== activeCameraShot.id
          || isCameraInsideCameraShotMarker(camera, activeCameraShot)
        )) {
          positionFreeViewCameraAroundShot(camera, orbit, activeCameraShot);
          requestRenderRef.current(180);
        }
        cameraViewBindingRef.current = {
          shotId: project.activeCameraShotId,
          isFreeView: true,
        };
      }
      return;
    }

    const previousBinding = cameraViewBindingRef.current;
    const shouldApplyShot =
      previousBinding.isFreeView || previousBinding.shotId !== activeCameraShot.id;
    cameraViewBindingRef.current = {
      shotId: activeCameraShot.id,
      isFreeView: false,
    };
    if (shouldApplyShot) {
      applyCameraShotToView(activeCameraShot);
    }
  }, [activeCameraShot?.id, applyCameraShotToView, project.activeCameraShotId, project.isFreeView]);

  useEffect(() => {
    const markerGroup = cameraShotGroupRef.current;
    if (!markerGroup) {
      return;
    }

    disposeCameraShotMarkers(markerGroup);
    markerGroup.visible = project.isFreeView;
    if (!project.isFreeView) {
      requestRenderRef.current();
      return;
    }

    project.cameraShots.forEach((shot) => {
      markerGroup.add(buildCameraShotMarker(
        shot,
        shot.id === project.activeCameraShotId
      ));
      const pathGroup = buildCameraPathWorldGroup(
        shot,
        shot.id === project.activeCameraShotId,
        cameraPathTimeline?.shotId === shot.id ? cameraPathTimeline.selectedKeyframeIndex : null
      );
      if (pathGroup) {
        markerGroup.add(pathGroup);
      }
    });
    requestRenderRef.current();
  }, [
    cameraPathTimeline?.selectedKeyframeIndex,
    cameraPathTimeline?.shotId,
    project.activeCameraShotId,
    project.cameraShots,
    project.isFreeView,
  ]);

  useEffect(() => {
    requestRenderRef.current();
  }, [project]);

  useEffect(() => {
    if (!cameraLensPanel) {
      return;
    }
    if (!project.cameraShots.some((shot) => shot.id === cameraLensPanel.shotId)) {
      setCameraLensPanel(null);
    }
  }, [cameraLensPanel, project.cameraShots]);

  const patchProject = useCallback((
    patch: Partial<DirectorStageProject>,
    options?: DirectorStageCommitOptions
  ) => {
    if (options?.history !== 'skip') {
      commitDeferredProjectEdit();
    }
    commitProject({
      ...projectRef.current,
      ...patch,
      updatedAt: Date.now(),
    }, options);
  }, [commitDeferredProjectEdit, commitProject]);

  const setSnapshotAspectRatio = useCallback((aspectRatio: DirectorStageSnapshotAspectRatio) => {
    patchProject({
      snapshot: {
        ...projectRef.current.snapshot,
        aspectRatio,
      },
    });
  }, [patchProject]);

  const toggleSnapshotMask = useCallback(() => {
    patchProject({
      snapshot: {
        ...projectRef.current.snapshot,
        showMask: !projectRef.current.snapshot.showMask,
      },
    });
  }, [patchProject]);

  const toggleGroundGrid = useCallback(() => {
    patchProject({
      showGroundGrid: !projectRef.current.showGroundGrid,
    });
  }, [patchProject]);

  useEffect(() => {
    const currentEnvironment = projectRef.current.environment;
    const connectedEnvironment = connectedEnvironments.find((item) => item.id === currentEnvironment.id);
    if (!connectedEnvironment) {
      return;
    }
    if (
      currentEnvironment.name === connectedEnvironment.name
      && currentEnvironment.backgroundPath === connectedEnvironment.backgroundPath
      && currentEnvironment.previewPath === connectedEnvironment.previewPath
    ) {
      return;
    }

    patchProject({
      environment: {
        id: connectedEnvironment.id,
        name: connectedEnvironment.name,
        backgroundPath: connectedEnvironment.backgroundPath,
        previewPath: connectedEnvironment.previewPath,
      },
    }, { history: 'skip' });
  }, [connectedEnvironments, patchProject]);

  const addBuiltInAsset = useCallback((asset: DirectorStageBuiltInAsset) => {
    const entity = createDirectorStageEntityFromBuiltInAsset(
      asset,
      t(asset.labelKey),
      projectRef.current.entities.length
    );
    pendingFrameEntityIdsRef.current.add(entity.id);
    commitProject({
      ...projectRef.current,
      entities: [...projectRef.current.entities, entity],
      selectedEntityId: entity.id,
      selectedCrowdGroupId: null,
      selectedLightId: null,
      isFreeView: true,
      updatedAt: Date.now(),
    });
  }, [commitProject, t]);

  const addUserModelAsset = useCallback((item: AssetItemRecord) => {
    const entity = createDirectorStageEntityFromModelAsset({
      assetId: item.id,
      name: item.name,
      modelPath: item.sourcePath,
      previewPath: item.previewPath,
      kind: categoryToEntityKind(item.category),
      index: projectRef.current.entities.length,
    });
    pendingFrameEntityIdsRef.current.add(entity.id);
    commitProject({
      ...projectRef.current,
      entities: [...projectRef.current.entities, entity],
      selectedEntityId: entity.id,
      selectedCrowdGroupId: null,
      selectedLightId: null,
      isFreeView: true,
      updatedAt: Date.now(),
    });
  }, [commitProject]);

  const openCrowdModeDialog = useCallback((asset: DirectorStageBuiltInAsset) => {
    setCrowdDialogAsset(asset);
  }, []);

  const resolveCrowdPlacement = useCallback((mode: 'formation' | 'crowd') => {
    const camera = cameraRef.current;
    const orbit = orbitRef.current;
    const cameraPosition = camera?.position.clone() ?? new THREE.Vector3(4, 2.4, 5);
    const orbitTarget = orbit?.target.clone() ?? new THREE.Vector3(0, 1.2, 0);
    return mode === 'crowd'
      ? createDirectorStageGridCenterCrowdPlacement(cameraPosition)
      : createDirectorStageCrowdPlacement(cameraPosition, orbitTarget);
  }, []);

  const createCrowdGroupFromDialog = useCallback((payload: {
    mode: 'formation' | 'crowd';
    columns: number;
    rows: number;
    count: number;
    centerRadius: number;
  }) => {
    const asset = crowdDialogAsset;
    if (!asset) {
      return;
    }
    commitActiveCameraShotFromView();
    const current = projectRef.current;
    const placement = resolveCrowdPlacement(payload.mode);
    const result = payload.mode === 'formation'
      ? createDirectorStageFormationGroup({
          project: current,
          asset,
          groupName: t('directorStage.crowd.formationName', {
            count: current.crowdGroups.filter((group) => group.mode === 'formation').length + 1,
          }),
          columns: payload.columns,
          rows: payload.rows,
          placement,
        })
      : upsertDirectorStageCrowdGroup({
          project: current,
          asset,
          groupName: t('directorStage.crowd.crowdName'),
          count: payload.count,
          centerRadius: payload.centerRadius,
          placement,
        });

    pendingFrameCrowdGroupIdsRef.current.add(result.group.id);
    const renderKey = createCrowdGroupRenderKey(result.group);
    setCrowdRenderProgress((currentProgress) => ({
      ...currentProgress,
      [result.group.id]: {
        groupId: result.group.id,
        groupName: result.group.name,
        renderKey,
        phase: 'queued',
        progress: 0.02,
        completed: 0,
        total: Math.max(1, result.group.layout.count),
        startedAt: Date.now(),
      },
    }));
    commitProject(result.project);
    setCrowdDialogAsset(null);
  }, [
    commitActiveCameraShotFromView,
    commitProject,
    crowdDialogAsset,
    resolveCrowdPlacement,
    t,
  ]);

  const importModelToLibrary = useCallback(async () => {
    if (isImportingModel) {
      return;
    }
    setIsImportingModel(true);
    try {
      const selected = await open({
        multiple: false,
        directory: false,
        filters: [
          {
            name: t('directorStage.modelLibrary.modelFilter'),
            extensions: ['glb', 'gltf', 'fbx'],
          },
        ],
      });
      const path = Array.isArray(selected) ? selected[0] : selected;
      if (!path || !isSupportedDirectorStageModelPath(path)) {
        return;
      }

      let libraryId = currentProject?.assetLibraryId ?? null;
      if (!libraryId || !libraries.some((library) => library.id === libraryId)) {
        const defaultLibraryName = t('directorStage.modelLibrary.defaultLibraryName');
        const library = libraries.find((item) => item.name.trim() === defaultLibraryName)
          ?? await createLibrary(defaultLibraryName);
        libraryId = library.id;
        setCurrentProjectAssetLibrary(library.id);
      }

      const fileName = basename(path);
      const existingItemIds = new Set(libraries.flatMap((library) => library.items.map((item) => item.id)));
      const item = await createItem({
        libraryId,
        category: 'prop',
        mediaType: 'model',
        subcategoryId: null,
        name: withoutExtension(fileName),
        description: '',
        tags: ['3d'],
        sourcePath: path,
        previewPath: null,
        mimeType: extensionToMime(path),
        durationMs: null,
        aspectRatio: '1:1',
        metadata: {
          directorStage: {
            importedAt: Date.now(),
            originalSourcePath: path,
            originalFileName: fileName,
          },
        },
      });
      addUserModelAsset(item);
      setActiveTab('library');
      await flushCurrentProjectToDisk();
      if (existingItemIds.has(item.id)) {
        setStatusText(t('directorStage.modelLibrary.alreadyImported'));
      }
    } finally {
      setIsImportingModel(false);
    }
  }, [
    addUserModelAsset,
    createItem,
    createLibrary,
    currentProject?.assetLibraryId,
    flushCurrentProjectToDisk,
    isImportingModel,
    libraries,
    setCurrentProjectAssetLibrary,
    t,
  ]);

  const openSketchfabModelFeed = useCallback(() => {
    void openUrl(DIRECTOR_STAGE_MODEL_LIBRARY_URL).catch((error) => {
      console.error('Failed to open Sketchfab model feed', error);
      setStatusText(t('directorStage.modelLibrary.openSketchfabFailed'));
    });
  }, [t]);

  const deleteModelAssetFromLibrary = useCallback(async (item: AssetItemRecord) => {
    if (deletingModelAssetIds.has(item.id)) {
      return;
    }

    setDeletingModelAssetIds((current) => {
      const next = new Set(current);
      next.add(item.id);
      return next;
    });

    try {
      commitProject(projectRef.current, { history: 'skip' });
      await flushCurrentProjectToDisk();
      await deleteItem(item.id);
      setStatusText(t('directorStage.modelLibrary.deleted'));
    } catch (error) {
      console.error('Failed to delete director stage model asset', error);
      setStatusText(t('directorStage.modelLibrary.deleteFailed'));
    } finally {
      setDeletingModelAssetIds((current) => {
        const next = new Set(current);
        next.delete(item.id);
        return next;
      });
    }
  }, [
    commitProject,
    deleteItem,
    deletingModelAssetIds,
    flushCurrentProjectToDisk,
    t,
  ]);

  const updateEntity = useCallback((
    entityId: string,
    patch: Partial<DirectorStageEntity>,
    options: DirectorStageCommitOptions = {}
  ) => {
    const nextProject = patchDirectorStageEntity(projectRef.current, entityId, patch);
    if (options.history === 'skip') {
      previewProjectEdit(nextProject);
      return;
    }
    commitDeferredProjectEdit();
    commitProject(nextProject);
  }, [commitDeferredProjectEdit, commitProject, previewProjectEdit]);

  const updateCrowdGroup = useCallback((
    groupId: string,
    patch: Partial<DirectorStageCrowdGroup>,
    options: DirectorStageCommitOptions = {}
  ) => {
    const nextProject = patchDirectorStageCrowdGroup(projectRef.current, groupId, patch);
    if (options.history === 'skip') {
      previewProjectEdit(nextProject);
      return;
    }
    commitDeferredProjectEdit();
    commitProject(nextProject);
  }, [commitDeferredProjectEdit, commitProject, previewProjectEdit]);

  const selectEntityPosePreset = useCallback((entityId: string, posePresetId: string | null) => {
    const preset = resolvePosePresetById(posePresetId);
    updateEntity(entityId, {
      posePresetId: preset?.id ?? null,
      posePath: preset?.animationPath ?? null,
      skeletonCompatible: true,
    });
  }, [resolvePosePresetById, updateEntity]);

  const importAnimationForSelectedEntity = useCallback(async () => {
    const entity = projectRef.current.entities.find((item) => item.id === projectRef.current.selectedEntityId);
    if (!entity || isImportingAnimation) {
      return;
    }

    setIsImportingAnimation(true);
    try {
      const selected = await open({
        multiple: false,
        directory: false,
        filters: [
          {
            name: t('directorStage.animationLibrary.animationFilter'),
            extensions: ['fbx'],
          },
        ],
      });
      const path = Array.isArray(selected) ? selected[0] : selected;
      if (!path || !/\.fbx(?:[?#].*)?$/i.test(path.trim())) {
        return;
      }

      let libraryId = currentProject?.assetLibraryId ?? null;
      if (!libraryId || !libraries.some((library) => library.id === libraryId)) {
        const defaultLibraryName = t('directorStage.modelLibrary.defaultLibraryName');
        const library = libraries.find((item) => item.name.trim() === defaultLibraryName)
          ?? await createLibrary(defaultLibraryName);
        libraryId = library.id;
        setCurrentProjectAssetLibrary(library.id);
      }

      const fileName = basename(path);
      let item = await createItem({
        libraryId,
        category: 'character',
        mediaType: 'model',
        subcategoryId: null,
        name: withoutExtension(fileName),
        description: '',
        tags: ['3d', 'animation'],
        sourcePath: path,
        previewPath: null,
        mimeType: extensionToMime(path),
        durationMs: null,
        aspectRatio: '1:1',
        metadata: buildDirectorStageAnimationMetadata({
          entity,
          sourcePath: path,
          fileName,
        }),
      });

      const compatibleAssetId = getDirectorStageAnimationCompatibleAssetId(item);
      if (!isDirectorStageAnimationAsset(item) || compatibleAssetId !== entity.assetId) {
        item = await updateItem({
          id: item.id,
          libraryId: item.libraryId,
          category: item.category,
          mediaType: item.mediaType,
          subcategoryId: item.subcategoryId,
          name: item.name,
          description: item.description,
          tags: Array.from(new Set([...item.tags, '3d', 'animation'])),
          sourcePath: item.sourcePath,
          previewPath: item.previewPath,
          mimeType: item.mimeType,
          durationMs: item.durationMs,
          aspectRatio: item.aspectRatio,
          metadata: buildDirectorStageAnimationMetadata({
            entity,
            sourcePath: path,
            fileName,
            existingMetadata: item.metadata,
          }),
        });
      }

      updateEntity(entity.id, {
        posePresetId: toUserPosePresetId(item.id),
        posePath: item.sourcePath,
        skeletonCompatible: true,
      });
      await flushCurrentProjectToDisk();
      setStatusText(t('directorStage.animationLibrary.imported'));
    } catch (error) {
      console.error('Failed to import director stage animation', error);
      setStatusText(t('directorStage.animationLibrary.importFailed'));
    } finally {
      setIsImportingAnimation(false);
    }
  }, [
    createItem,
    createLibrary,
    currentProject?.assetLibraryId,
    flushCurrentProjectToDisk,
    isImportingAnimation,
    libraries,
    setCurrentProjectAssetLibrary,
    t,
    updateEntity,
    updateItem,
  ]);

  const deleteAnimationAssetFromLibrary = useCallback(async (item: AssetItemRecord) => {
    if (deletingAnimationAssetIds.has(item.id)) {
      return;
    }

    setDeletingAnimationAssetIds((current) => {
      const next = new Set(current);
      next.add(item.id);
      return next;
    });

    try {
      commitProject(projectRef.current, { history: 'skip' });
      await flushCurrentProjectToDisk();
      await deleteItem(item.id);
      setStatusText(t('directorStage.animationLibrary.deleted'));
    } catch (error) {
      console.error('Failed to delete director stage animation asset', error);
      setStatusText(t('directorStage.animationLibrary.deleteFailed'));
    } finally {
      setDeletingAnimationAssetIds((current) => {
        const next = new Set(current);
        next.delete(item.id);
        return next;
      });
    }
  }, [
    commitProject,
    deleteItem,
    deletingAnimationAssetIds,
    flushCurrentProjectToDisk,
    t,
  ]);

  const updateSelectedEntityLimbPose = useCallback((
    limbKey: DirectorStageLimbPoseKey,
    axis: 'x' | 'y' | 'z',
    value: number
  ) => {
    const entity = projectRef.current.entities.find((item) => item.id === projectRef.current.selectedEntityId);
    if (!entity || !supportsDirectorStageLimbControls(entity)) {
      return;
    }

    const currentLimbPose = entity.limbPose ?? {};
    const currentRotation = currentLimbPose[limbKey] ?? createStageVector3(0, 0, 0);
    const nextLimbPose: DirectorStageLimbPose = {
      ...currentLimbPose,
      [limbKey]: {
        ...currentRotation,
        [axis]: clampLimbRotationRadians(value),
      },
    };
    const nextEntity = { ...entity, limbPose: nextLimbPose };
    const object = entityObjectsRef.current.get(entity.id);
    if (object) {
      applyDirectorStageLimbPoseToObject(object, nextEntity);
      requestRenderRef.current();
    }
    updateEntity(entity.id, { limbPose: nextLimbPose }, { history: 'skip' });
  }, [updateEntity]);

  const resetSelectedEntityLimbPose = useCallback(() => {
    const entity = projectRef.current.entities.find((item) => item.id === projectRef.current.selectedEntityId);
    if (!entity || !supportsDirectorStageLimbControls(entity)) {
      return;
    }
    const nextEntity = { ...entity, limbPose: {} };
    const object = entityObjectsRef.current.get(entity.id);
    if (object) {
      applyDirectorStageLimbPoseToObject(object, nextEntity);
      requestRenderRef.current();
    }
    updateEntity(entity.id, { limbPose: {} });
  }, [updateEntity]);

  const updateSelectedObjectTransform = useCallback((
    axis: 'x' | 'y' | 'z',
    group: 'position' | 'rotation' | 'scale',
    value: number
  ) => {
    const crowdGroup = projectRef.current.crowdGroups.find(
      (item) => item.id === projectRef.current.selectedCrowdGroupId
    );
    if (crowdGroup) {
      const nextValue = group === 'scale'
        ? clampDirectorStageScale(value, crowdGroup.transform.scale[axis])
        : value;
      updateCrowdGroup(crowdGroup.id, {
        transform: {
          ...crowdGroup.transform,
          [group]: group === 'scale' && isScaleLocked
            ? createStageVector3(nextValue, nextValue, nextValue)
            : {
                ...crowdGroup.transform[group],
                [axis]: nextValue,
              },
        },
      }, { history: 'skip' });
      return;
    }

    const entity = projectRef.current.entities.find((item) => item.id === projectRef.current.selectedEntityId);
    if (!entity) {
      return;
    }
    const nextValue = group === 'scale'
      ? clampDirectorStageScale(value, entity.transform.scale[axis])
      : value;
    updateEntity(entity.id, {
      transform: {
        ...entity.transform,
        [group]: group === 'scale' && isScaleLocked
          ? createStageVector3(nextValue, nextValue, nextValue)
          : {
              ...entity.transform[group],
              [axis]: nextValue,
            },
      },
    }, { history: 'skip' });
  }, [isScaleLocked, updateCrowdGroup, updateEntity]);

  const updatePlaneSurface = useCallback((
    entity: DirectorStageEntity,
    patch: Partial<DirectorStagePlaneSurface>,
    options: DirectorStageCommitOptions = {}
  ) => {
    if (!isDirectorStagePlaneEntity(entity)) {
      return;
    }
    updateEntity(entity.id, {
      planeSurface: {
        ...resolvePlaneSurface(entity),
        ...patch,
      },
    }, options);
  }, [updateEntity]);

  const applyPlaneAspectRatio = useCallback((
    entity: DirectorStageEntity,
    aspectRatio: number,
    planeSurfacePatch: Partial<DirectorStagePlaneSurface>
  ) => {
    if (!isDirectorStagePlaneEntity(entity)) {
      return;
    }
    const nextAspectRatio = clampPlaneAspectRatio(aspectRatio);
    const baseScale = Math.max(entity.transform.scale.x, entity.transform.scale.z, 0.001);
    const nextScale = nextAspectRatio >= 1
      ? createStageVector3(baseScale, entity.transform.scale.y, baseScale / nextAspectRatio)
      : createStageVector3(baseScale * nextAspectRatio, entity.transform.scale.y, baseScale);
    updateEntity(entity.id, {
      planeSurface: {
        ...resolvePlaneSurface(entity),
        ...planeSurfacePatch,
      },
      transform: {
        ...entity.transform,
        scale: nextScale,
      },
    });
  }, [updateEntity]);

  const selectPlaneAspectRatioPreset = useCallback((
    entity: DirectorStageEntity,
    preset: DirectorStagePlaneAspectRatioPreset
  ) => {
    const surface = resolvePlaneSurface(entity);
    applyPlaneAspectRatio(entity, resolvePlaneAspectRatio(preset, surface.customAspectRatio), {
      aspectRatioPreset: preset,
    });
  }, [applyPlaneAspectRatio]);

  const updatePlaneCustomAspectRatio = useCallback((entity: DirectorStageEntity, value: number) => {
    const customAspectRatio = clampPlaneAspectRatio(value);
    applyPlaneAspectRatio(entity, customAspectRatio, {
      aspectRatioPreset: 'custom',
      customAspectRatio,
    });
  }, [applyPlaneAspectRatio]);

  const choosePlaneSurfaceImage = useCallback(async (entity: DirectorStageEntity) => {
    if (!isDirectorStagePlaneEntity(entity)) {
      return;
    }
    const selected = await open({
      multiple: false,
      directory: false,
      filters: [
        {
          name: t('directorStage.planeSurface.imageFilter'),
          extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif'],
        },
      ],
    });
    const path = Array.isArray(selected) ? selected[0] : selected;
    if (!path) {
      return;
    }

    let imageAspectRatio: number | null = null;
    try {
      imageAspectRatio = clampPlaneAspectRatio(
        await readImageAspectRatio(resolveImageDisplayUrl(path))
      );
    } catch (error) {
      console.error('Failed to read plane image dimensions', error);
      setStatusText(t('directorStage.planeSurface.imageLoadFailed'));
    }

    updatePlaneSurface(entity, {
      imagePath: path,
      imageName: basename(path),
      imageAspectRatio,
      fitMode: entity.planeSurface?.fitMode ?? 'contain',
    });
  }, [t, updatePlaneSurface]);

  const removePlaneSurfaceImage = useCallback((entity: DirectorStageEntity) => {
    updatePlaneSurface(entity, {
      imagePath: null,
      imageName: null,
      imageAspectRatio: null,
    });
  }, [updatePlaneSurface]);

  const setTransformMode = useCallback((mode: DirectorStageTransformMode) => {
    patchProject({ transformMode: mode }, { history: 'skip' });
  }, [patchProject]);

  const toggleScaleLock = useCallback(() => {
    setIsScaleLocked((current) => !current);
  }, []);

  const frameSelectedEntityInView = useCallback(() => {
    const crowdGroupId = projectRef.current.selectedCrowdGroupId;
    if (crowdGroupId) {
      commitActiveCameraShotFromView();
      if (frameCrowdGroupObjectInView(crowdGroupId)) {
        patchProject({ isFreeView: true }, { history: 'skip' });
      }
      return;
    }
    const entityId = projectRef.current.selectedEntityId;
    if (!entityId) {
      return;
    }
    commitActiveCameraShotFromView();
    if (frameEntityObjectInView(entityId)) {
      patchProject({ isFreeView: true }, { history: 'skip' });
    }
  }, [commitActiveCameraShotFromView, frameCrowdGroupObjectInView, frameEntityObjectInView, patchProject]);

  useEffect(() => {
    const handleStageShortcut = (event: KeyboardEvent) => {
      if (
        event.ctrlKey
        || event.metaKey
        || event.altKey
        || isDirectorStageShortcutEditableTarget(event.target)
      ) {
        return;
      }

      const key = event.key.toLowerCase();
      if (key === 'w') {
        event.preventDefault();
        setTransformMode('translate');
        return;
      }
      if (key === 'e') {
        event.preventDefault();
        setTransformMode('rotate');
        return;
      }
      if (key === 'r') {
        event.preventDefault();
        setTransformMode('scale');
        return;
      }
      if (key === 'f' && !event.repeat) {
        event.preventDefault();
        frameSelectedEntityInView();
        return;
      }
      if (key === 'g' && !event.repeat) {
        event.preventDefault();
        toggleGroundGrid();
        return;
      }
      if (event.code === 'Space' && !event.repeat) {
        const shot = timelineCameraShot ?? activeCameraShot;
        if (!shot?.cameraPath || cameraPathRecordingRef.current || exportingCameraPathShotId) {
          return;
        }
        event.preventDefault();
        toggleCameraPathPlayback(shot);
      }
    };

    window.addEventListener('keydown', handleStageShortcut);
    return () => window.removeEventListener('keydown', handleStageShortcut);
  }, [
    activeCameraShot,
    exportingCameraPathShotId,
    frameSelectedEntityInView,
    setTransformMode,
    timelineCameraShot,
    toggleCameraPathPlayback,
    toggleGroundGrid,
  ]);

  useEffect(() => {
    return () => {
      stopCameraPathRecording(false);
      stopCameraPathPlayback();
    };
  }, [stopCameraPathPlayback, stopCameraPathRecording]);

  const addLight = useCallback((kind: DirectorStageLight['kind']) => {
    const now = Date.now();
    const light: DirectorStageLight = {
      id: `light-${kind}-${now}`,
      kind,
      name: t(`directorStage.lightKinds.${kind}`),
      color: kind === 'ambient' ? '#ffffff' : '#fff0d2',
      intensity: kind === 'ambient' ? 0.45 : kind === 'spot' ? 2.2 : 1.8,
      enabled: true,
      position: createStageVector3(2.5, 3.5, 2.5),
      target: createStageVector3(0, 1, 0),
      distance: 0,
      angle: kind === 'spot' ? Math.PI / 5 : Math.PI / 4,
      penumbra: kind === 'spot' ? 0.35 : 0.25,
    };
    patchProject({
      lights: [...projectRef.current.lights, light],
      selectedLightId: light.id,
      selectedEntityId: null,
      selectedCrowdGroupId: null,
    });
  }, [patchProject, t]);

  const updateLight = useCallback((
    lightId: string,
    patch: Partial<DirectorStageLight>,
    options: DirectorStageCommitOptions = {}
  ) => {
    const nextProject = {
      ...projectRef.current,
      lights: projectRef.current.lights.map((light) =>
        light.id === lightId ? { ...light, ...patch } : light
      ),
      updatedAt: Date.now(),
    };
    if (options.history === 'skip') {
      previewProjectEdit(nextProject);
      return;
    }
    commitDeferredProjectEdit();
    commitProject(nextProject);
  }, [commitDeferredProjectEdit, commitProject, previewProjectEdit]);

  const updateSelectedLightPosition = useCallback((axis: 'x' | 'y' | 'z', value: number) => {
    if (!selectedLight || selectedLight.kind === 'ambient') {
      return;
    }
    updateLight(selectedLight.id, {
      position: {
        ...selectedLight.position,
        [axis]: value,
      },
    }, { history: 'skip' });
  }, [selectedLight, updateLight]);

  const updateSelectedLightTarget = useCallback((axis: 'x' | 'y' | 'z', value: number) => {
    if (!selectedLight || selectedLight.kind !== 'spot') {
      return;
    }
    updateLight(selectedLight.id, {
      target: {
        ...selectedLight.target,
        [axis]: value,
      },
    }, { history: 'skip' });
  }, [selectedLight, updateLight]);

  const deleteLight = useCallback((lightId: string) => {
    patchProject({
      lights: projectRef.current.lights.filter((light) => light.id !== lightId),
      selectedLightId:
        projectRef.current.selectedLightId === lightId ? null : projectRef.current.selectedLightId,
    });
  }, [patchProject]);

  const deleteEntity = useCallback((entityId: string) => {
    patchProject({
      entities: projectRef.current.entities.filter((entity) => entity.id !== entityId),
      selectedEntityId:
        projectRef.current.selectedEntityId === entityId ? null : projectRef.current.selectedEntityId,
      selectedCrowdGroupId: null,
    });
  }, [patchProject]);

  const deleteCrowdGroup = useCallback((groupId: string) => {
    commitProject(deleteDirectorStageCrowdGroup(projectRef.current, groupId));
  }, [commitProject]);

  const updateCrowdGroupLayout = useCallback((
    groupId: string,
    patch: { count?: number; centerRadius?: number }
  ) => {
    const group = projectRef.current.crowdGroups.find((item) => item.id === groupId);
    if (!group || group.mode !== 'crowd') {
      return;
    }
    const asset = getDirectorStageCharacterAsset(group.assetId);
    if (!asset) {
      return;
    }
    const result = replaceDirectorStageCrowdGroupCount({
      project: projectRef.current,
      group,
      asset,
      count: patch.count ?? group.layout.count,
      centerRadius: patch.centerRadius ?? group.layout.centerRadius ?? DIRECTOR_STAGE_CROWD_DEFAULT_CENTER_RADIUS,
    });
    pendingFrameCrowdGroupIdsRef.current.add(result.group.id);
    commitProject(result.project);
  }, [commitProject]);

  const enterFreeView = useCallback(() => {
    commitActiveCameraShotFromView();
    const camera = cameraRef.current;
    const orbit = orbitRef.current;
    const current = projectRef.current;
    const activeShot = current.cameraShots.find((shot) => shot.id === current.activeCameraShotId);
    if (camera && orbit && activeShot) {
      positionFreeViewCameraAroundShot(camera, orbit, activeShot);
    }
    cameraViewBindingRef.current = {
      shotId: current.activeCameraShotId,
      isFreeView: true,
    };
    patchProject({ isFreeView: true }, { history: 'skip' });
  }, [commitActiveCameraShotFromView, patchProject]);

  const captureCameraShot = useCallback(() => {
    commitActiveCameraShotFromView();
    const camera = cameraRef.current;
    const orbit = orbitRef.current;
    if (!camera || !orbit) {
      return;
    }
    const nextIndex = projectRef.current.cameraShots.length + 1;
    const shot = readCameraShot(
      camera,
      orbit.target,
      `shot-${Date.now()}`,
      t('directorStage.camera.newShotName', { count: nextIndex })
    );
    patchProject({
      cameraShots: [...projectRef.current.cameraShots, shot],
      activeCameraShotId: shot.id,
      isFreeView: false,
    });
  }, [commitActiveCameraShotFromView, patchProject, t]);

  const selectCameraShot = useCallback((shot: DirectorStageCameraShot) => {
    const current = projectRef.current;
    const shouldApplyShot = current.isFreeView || current.activeCameraShotId !== shot.id;
    if (shouldApplyShot) {
      commitActiveCameraShotFromView();
      applyCameraShotToView(shot);
    } else {
      commitActiveCameraShotFromView();
    }
    patchProject({
      activeCameraShotId: shot.id,
      isFreeView: false,
    }, { history: 'skip' });
    setCameraPathTimeline({
      shotId: shot.id,
      selectedKeyframeIndex: 0,
      playheadMs: 0,
    });
  }, [applyCameraShotToView, commitActiveCameraShotFromView, patchProject]);

  const deleteCameraShot = useCallback((shotId: string) => {
    commitActiveCameraShotFromView();
    const current = projectRef.current;
    if (current.cameraShots.length <= 1) {
      return;
    }

    const deleteIndex = current.cameraShots.findIndex((shot) => shot.id === shotId);
    if (deleteIndex < 0) {
      return;
    }

    const nextShots = current.cameraShots.filter((shot) => shot.id !== shotId);
    const activeShotWasDeleted = !nextShots.some((shot) => shot.id === current.activeCameraShotId);
    const replacementShot = activeShotWasDeleted
      ? (nextShots[Math.min(deleteIndex, nextShots.length - 1)] ?? null)
      : null;
    const nextActiveCameraShotId = activeShotWasDeleted
      ? replacementShot?.id ?? null
      : current.activeCameraShotId;
    const nextIsFreeView = current.isFreeView || (activeShotWasDeleted && !replacementShot);

    if (!nextIsFreeView && activeShotWasDeleted && replacementShot) {
      applyCameraShotToView(replacementShot);
    }

    patchProject({
      cameraShots: nextShots,
      activeCameraShotId: nextActiveCameraShotId,
      isFreeView: nextIsFreeView,
    });
  }, [applyCameraShotToView, commitActiveCameraShotFromView, patchProject]);

  const clearCameraPath = useCallback((shotId: string) => {
    stopCameraPathRecording(false);
    stopCameraPathPlayback();
    const current = projectRef.current;
    const shot = current.cameraShots.find((item) => item.id === shotId);
    if (!shot?.cameraPath) {
      return;
    }
    const nextShot: DirectorStageCameraShot = {
      ...shot,
      cameraPath: undefined,
      updatedAt: Date.now(),
    };
    patchProject({
      cameraShots: current.cameraShots.map((item) => (item.id === shotId ? nextShot : item)),
    });
    setCameraPathTimeline((currentTimeline) =>
      currentTimeline?.shotId === shotId ? null : currentTimeline
    );
  }, [patchProject, stopCameraPathPlayback, stopCameraPathRecording]);

  const updateCameraPathMotionKeyframes = useCallback((
    shotId: string,
    motionKeyframes: DirectorStageCameraKeyframe[],
    selectedKeyframeIndex: number | null,
    playheadMs: number,
    segmentEasings?: Record<string, DirectorStageCameraPathSegmentEasing>
  ) => {
    const current = projectRef.current;
    const shot = current.cameraShots.find((item) => item.id === shotId);
    if (!shot?.cameraPath || motionKeyframes.length < 2) {
      return;
    }
    const maxTimelineMs = DIRECTOR_STAGE_CAMERA_PATH_MAX_DURATION_MS;
    const sortedKeyframes = motionKeyframes
      .map((keyframe) => ({
        ...ensureCameraPathKeyframeId(keyframe),
        timeMs: Math.max(0, Math.min(maxTimelineMs, keyframe.timeMs)),
      }))
      .sort((left, right) => left.timeMs - right.timeMs);
    const nextDurationMs = Math.max(
      1,
      Math.min(
        DIRECTOR_STAGE_CAMERA_PATH_MAX_DURATION_MS,
        sortedKeyframes[sortedKeyframes.length - 1]?.timeMs ?? shot.cameraPath.durationMs
      )
    );
    const nextClipRange = clampCameraPathClipRange(
      nextDurationMs,
      shot.cameraPath.clipStartMs,
      shot.cameraPath.clipDurationMs
    );
    const nextShot: DirectorStageCameraShot = {
      ...shot,
      position: sortedKeyframes[0].position,
      target: sortedKeyframes[0].target,
      fov: sortedKeyframes[0].fov,
      focalLengthMm: fovToFocalLength(sortedKeyframes[0].fov),
      cameraPath: {
        ...shot.cameraPath,
        durationMs: nextDurationMs,
        clipStartMs: nextClipRange.clipStartMs,
        clipDurationMs: nextClipRange.clipDurationMs,
        motionKeyframes: sortedKeyframes,
        segmentEasings: normalizeDirectorStageCameraPathSegmentEasings(
          sortedKeyframes,
          segmentEasings ?? shot.cameraPath.segmentEasings
        ),
      },
      updatedAt: Date.now(),
    };
    patchProject({
      cameraShots: current.cameraShots.map((item) => (item.id === shotId ? nextShot : item)),
    });
    setCameraPathTimeline({
      shotId,
      selectedKeyframeIndex,
      playheadMs: Math.max(0, Math.min(nextDurationMs, playheadMs)),
    });
  }, [patchProject]);

  const jumpCameraPathTimeline = useCallback((shot: DirectorStageCameraShot, timeMs: number) => {
    if (!shot.cameraPath) {
      return;
    }
    const camera = cameraRef.current;
    const orbit = orbitRef.current;
    if (!camera || !orbit) {
      return;
    }
    stopCameraPathPlayback();
    const clampedTime = Math.max(0, Math.min(shot.cameraPath.durationMs, timeMs));
    isApplyingCameraShotViewRef.current = true;
    applyCameraPathKeyframe(
      camera,
      orbit.target,
      sampleDirectorStageCameraPath(shot.cameraPath, clampedTime)
    );
    orbit.update();
    requestRenderRef.current(160);
    window.requestAnimationFrame(() => {
      isApplyingCameraShotViewRef.current = false;
    });
    setCameraPathTimeline((current) => ({
      shotId: shot.id,
      selectedKeyframeIndex: current?.shotId === shot.id ? current.selectedKeyframeIndex : null,
      playheadMs: clampedTime,
    }));
  }, [stopCameraPathPlayback]);

  const addCameraPathKeyframeAtPlayhead = useCallback((shot: DirectorStageCameraShot) => {
    if (!shot.cameraPath) {
      return;
    }
    const camera = cameraRef.current;
    const orbit = orbitRef.current;
    if (!camera || !orbit) {
      return;
    }
    const playheadMs = cameraPathTimeline?.shotId === shot.id
      ? cameraPathTimeline.playheadMs
      : 0;
    const nextKeyframe = ensureCameraPathKeyframeId({
      ...readCameraPathKeyframe(camera, orbit.target, playheadMs),
      sourceTimeMs: sampleDirectorStageCameraPathSourceTime(shot.cameraPath, playheadMs),
    });
    const sourceKeyframes = getDirectorStageMotionKeyframes(shot.cameraPath);
    const inheritedSegmentIndex = sourceKeyframes.findIndex((keyframe, index) => {
      const next = sourceKeyframes[index + 1];
      return Boolean(next && playheadMs > keyframe.timeMs && playheadMs < next.timeMs);
    });
    const inheritedLeft = inheritedSegmentIndex >= 0 ? sourceKeyframes[inheritedSegmentIndex] : null;
    const inheritedRight = inheritedSegmentIndex >= 0 ? sourceKeyframes[inheritedSegmentIndex + 1] : null;
    const inheritedEasing = inheritedLeft && inheritedRight
      ? resolveDirectorStageCameraPathSegmentEasing(shot.cameraPath, inheritedLeft, inheritedRight)
      : null;
    const keyframes = sourceKeyframes.filter((keyframe) => Math.abs(keyframe.timeMs - playheadMs) > 80);
    const nextKeyframes = [...keyframes, nextKeyframe].sort((left, right) => left.timeMs - right.timeMs);
    const nextSegmentEasings = normalizeDirectorStageCameraPathSegmentEasings(
      nextKeyframes,
      shot.cameraPath.segmentEasings
    );
    if (inheritedEasing) {
      const insertedIndex = nextKeyframes.findIndex((keyframe) => keyframe.id === nextKeyframe.id);
      const previous = nextKeyframes[insertedIndex - 1];
      const inserted = nextKeyframes[insertedIndex];
      if (previous && inserted && nextSegmentEasings) {
        nextSegmentEasings[createDirectorStageCameraPathSegmentKey(previous, inserted)] = inheritedEasing;
        nextSegmentEasings[createDirectorStageCameraPathSegmentKey(inserted)] = inheritedEasing;
      }
    }
    const selectedIndex = nextKeyframes.findIndex((keyframe) => keyframe === nextKeyframe);
    updateCameraPathMotionKeyframes(shot.id, nextKeyframes, selectedIndex, playheadMs, nextSegmentEasings);
  }, [cameraPathTimeline, updateCameraPathMotionKeyframes]);

  const deleteSelectedCameraPathKeyframe = useCallback((shot: DirectorStageCameraShot) => {
    if (!shot.cameraPath || cameraPathTimeline?.shotId !== shot.id) {
      return;
    }
    const selectedIndex = cameraPathTimeline.selectedKeyframeIndex;
    if (selectedIndex === null) {
      return;
    }
    const keyframes = getDirectorStageMotionKeyframes(shot.cameraPath);
    if (keyframes.length <= 2) {
      return;
    }
    const nextKeyframes = keyframes.filter((_, index) => index !== selectedIndex);
    const nextIndex = Math.min(selectedIndex, nextKeyframes.length - 1);
    updateCameraPathMotionKeyframes(
      shot.id,
      nextKeyframes,
      nextIndex,
      nextKeyframes[nextIndex]?.timeMs ?? 0
    );
  }, [cameraPathTimeline, updateCameraPathMotionKeyframes]);

  const moveCameraPathKeyframe = useCallback((
    shot: DirectorStageCameraShot,
    keyframeIndex: number,
    timeMs: number
  ) => {
    if (!shot.cameraPath) {
      return;
    }
    const keyframes = getDirectorStageMotionKeyframes(shot.cameraPath);
    const keyframe = keyframes[keyframeIndex];
    if (!keyframe) {
      return;
    }
    const previous = keyframes[keyframeIndex - 1];
    const next = keyframes[keyframeIndex + 1];
    const minGapMs = 100;
    const minTime = keyframeIndex === 0 ? 0 : (previous?.timeMs ?? 0) + minGapMs;
    const maxTime = next
      ? next.timeMs - minGapMs
      : DIRECTOR_STAGE_CAMERA_PATH_MAX_DURATION_MS;
    const clampedTime = keyframeIndex === 0
      ? 0
      : Math.max(minTime, Math.min(maxTime, timeMs));
    const nextKeyframes = keyframes.map((item, index) =>
      index === keyframeIndex ? { ...item, timeMs: clampedTime } : item
    );
    const sortedKeyframes = nextKeyframes.sort((left, right) => left.timeMs - right.timeMs);
    const nextSelectedIndex = sortedKeyframes.findIndex((item) => item === nextKeyframes[keyframeIndex]);
    updateCameraPathMotionKeyframes(
      shot.id,
      sortedKeyframes,
      nextSelectedIndex >= 0 ? nextSelectedIndex : keyframeIndex,
      clampedTime
    );
  }, [updateCameraPathMotionKeyframes]);

  const updateCameraPathClipRange = useCallback((
    shot: DirectorStageCameraShot,
    clipStartMs: number,
    clipDurationMs: number
  ) => {
    if (!shot.cameraPath) {
      return;
    }
    const current = projectRef.current;
    const nextClipRange = clampCameraPathClipRange(
      shot.cameraPath.durationMs,
      clipStartMs,
      clipDurationMs
    );
    const nextShot: DirectorStageCameraShot = {
      ...shot,
      cameraPath: {
        ...shot.cameraPath,
        clipStartMs: nextClipRange.clipStartMs,
        clipDurationMs: nextClipRange.clipDurationMs,
      },
      updatedAt: Date.now(),
    };
    patchProject({
      cameraShots: current.cameraShots.map((item) => (item.id === shot.id ? nextShot : item)),
    }, { history: 'skip' });
    setCameraPathTimeline((currentTimeline) => {
      if (currentTimeline?.shotId !== shot.id) {
        return currentTimeline;
      }
      return {
        ...currentTimeline,
        playheadMs: Math.max(
          nextClipRange.clipStartMs,
          Math.min(nextClipRange.clipStartMs + nextClipRange.clipDurationMs, currentTimeline.playheadMs)
        ),
      };
    });
  }, [patchProject]);

  const updateCameraPathSegmentSpeed = useCallback((
    shot: DirectorStageCameraShot,
    segmentIndex: number,
    speed: number,
    easingPatch?: Omit<DirectorStageCameraPathSegmentEasing, 'speed'>
  ) => {
    if (!shot.cameraPath) {
      return;
    }
    const keyframes = getDirectorStageMotionKeyframes(shot.cameraPath);
    const left = keyframes[segmentIndex];
    const right = keyframes[segmentIndex + 1];
    if (!left || !right) {
      return;
    }
    const safeSpeed = Math.max(0.1, Math.min(5, Number.isFinite(speed) ? speed : 1));
    const currentEasing = resolveDirectorStageCameraPathSegmentEasing(shot.cameraPath, left, right);
    const currentSpeed = Math.max(0.1, Math.min(5, currentEasing.speed ?? 1));
    const currentDurationMs = Math.max(100, right.timeMs - left.timeMs);
    const requestedDurationMs = Math.max(100, Math.round(currentDurationMs * currentSpeed / safeSpeed));
    const lastKeyframe = keyframes[keyframes.length - 1];
    const maxPositiveDelta = Math.max(0, DIRECTOR_STAGE_CAMERA_PATH_MAX_DURATION_MS - (lastKeyframe?.timeMs ?? 0));
    const requestedDelta = requestedDurationMs - currentDurationMs;
    const deltaMs = requestedDelta > 0
      ? Math.min(requestedDelta, maxPositiveDelta)
      : requestedDelta;
    const nextKeyframes = keyframes.map((keyframe, index) => (
      index <= segmentIndex
        ? keyframe
        : { ...keyframe, timeMs: Math.max(0, keyframe.timeMs + deltaMs) }
    ));
    const shiftedLeft = nextKeyframes[segmentIndex];
    const shiftedRight = nextKeyframes[segmentIndex + 1];
    if (!shiftedLeft || !shiftedRight) {
      return;
    }
    const nextSegmentEasings = normalizeDirectorStageCameraPathSegmentEasings(
      nextKeyframes,
      shot.cameraPath.segmentEasings
    ) ?? {};
    nextSegmentEasings[createDirectorStageCameraPathSegmentKey(shiftedLeft, shiftedRight)] = {
      ...currentEasing,
      ...(easingPatch ?? {}),
      speed: safeSpeed,
    };
    updateCameraPathMotionKeyframes(
      shot.id,
      nextKeyframes,
      segmentIndex,
      shiftedLeft.timeMs,
      nextSegmentEasings
    );
  }, [updateCameraPathMotionKeyframes]);

  const openCameraLensPanel = useCallback((
    shotId: string,
    event: ReactMouseEvent<HTMLButtonElement>
  ) => {
    event.stopPropagation();
    const position = resolveCameraLensPanelPosition(event.currentTarget.getBoundingClientRect());
    setCameraLensPanel((current) =>
      current?.shotId === shotId ? null : { shotId, ...position }
    );
  }, []);

  const updateCameraShotFocalLength = useCallback((
    shotId: string,
    value: number,
    options: DirectorStageCommitOptions = {}
  ) => {
    const current = projectRef.current;
    const shot = current.cameraShots.find((item) => item.id === shotId);
    if (!shot) {
      return;
    }

    const focalLengthMm = clampDirectorStageFocalLength(value, shot.focalLengthMm);
    const nextShot: DirectorStageCameraShot = {
      ...shot,
      focalLengthMm,
      fov: focalLengthToFov(focalLengthMm),
      updatedAt: Date.now(),
    };
    if (current.activeCameraShotId === shotId && !current.isFreeView) {
      applyCameraShotToView(nextShot);
    }
    const nextProject = {
      ...current,
      cameraShots: current.cameraShots.map((item) => (item.id === shotId ? nextShot : item)),
      updatedAt: Date.now(),
    };
    if (options.history === 'skip') {
      previewProjectEdit(nextProject);
      return;
    }
    commitDeferredProjectEdit();
    commitProject(nextProject);
  }, [applyCameraShotToView, commitDeferredProjectEdit, commitProject, previewProjectEdit]);

  const setBuiltInEnvironment = useCallback((skyboxId: string) => {
    const skybox = DIRECTOR_STAGE_SKYBOX_PRESETS.find((item) => item.id === skyboxId);
    if (!skybox) {
      patchProject({
        environment: {
          id: 'studio-grid',
          name: t('directorStage.skyboxes.grid'),
          backgroundPath: null,
          previewPath: null,
        },
      });
      return;
    }
    patchProject({
      environment: {
        id: skybox.id,
        name: t(skybox.labelKey),
        backgroundPath: skybox.backgroundPath,
        previewPath: skybox.previewPath,
      },
    });
  }, [patchProject, t]);

  const setConnectedEnvironment = useCallback((environment: DirectorStageConnectedEnvironment) => {
    patchProject({
      environment: {
        id: environment.id,
        name: environment.name,
        backgroundPath: environment.backgroundPath,
        previewPath: environment.previewPath,
      },
    });
  }, [patchProject]);

  const saveProject = useCallback(async () => {
    commitDeferredProjectEdit();
    commitProject(projectRef.current, { history: 'skip' });
    await flushCurrentProjectToDisk();
    setStatusText(t('directorStage.status.saved'));
  }, [commitDeferredProjectEdit, commitProject, flushCurrentProjectToDisk, t]);

  const captureToCanvas = useCallback(async () => {
    const renderer = rendererRef.current;
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    if (!renderer || !scene || !camera || isCapturing) {
      return;
    }
    setIsCapturing(true);
    try {
      const rect = renderer.domElement.getBoundingClientRect();
      const snapshotAspectRatio = projectRef.current.snapshot.aspectRatio;
      const result = await exportDirectorStageCanvasPng({
        scene,
        camera,
        aspectRatio: snapshotAspectRatio,
        hiddenObjects: [
          transformRef.current?.getHelper(),
          cameraShotGroupRef.current,
        ],
        viewport: {
          width: rect.width || renderer.domElement.clientWidth || renderer.domElement.width,
          height: rect.height || renderer.domElement.clientHeight || renderer.domElement.height,
        },
      });
      const snapshotProject = {
        ...projectRef.current,
        updatedAt: Date.now(),
      };
      const snapshotPatch = {
        ...createProjectNodePatch(snapshotProject),
        lastSnapshotUrl: result.imagePath,
        lastSnapshotPreviewUrl: result.previewImagePath,
        lastSnapshotAt: Date.now(),
      };
      updateNodeData(nodeId, snapshotPatch, { historyMode: 'skip' });
      void emitToMainWindow<DirectorStageUpdateNodePayload>(
        DIRECTOR_STAGE_UPDATE_NODE_EVENT,
        {
          nodeId,
          data: snapshotPatch,
          historyMode: 'skip',
        }
      ).catch((error) => {
        console.warn('Failed to sync director stage snapshot to main window', error);
      });
      addDerivedExportNode(
        nodeId,
        result.imagePath,
        snapshotAspectRatio,
        result.previewImagePath,
        {
          defaultTitle: t('directorStage.snapshot.exportNodeTitle'),
          resultKind: 'generic',
          connectToSource: true,
          sizeStrategy: 'generated',
        }
      );
      void emitToMainWindow<DirectorStageAddExportNodePayload>(
        DIRECTOR_STAGE_ADD_EXPORT_NODE_EVENT,
        {
          sourceNodeId: nodeId,
          imageUrl: result.imagePath,
          aspectRatio: snapshotAspectRatio,
          previewImageUrl: result.previewImagePath,
          options: {
            defaultTitle: t('directorStage.snapshot.exportNodeTitle'),
            resultKind: 'generic',
            connectToSource: true,
            sizeStrategy: 'generated',
          },
        }
      ).catch((error) => {
        console.warn('Failed to ask main window to add director stage snapshot node', error);
      });
      setStatusText(t('directorStage.status.snapshotSent'));
    } catch (error) {
      console.error('Failed to capture director stage snapshot to canvas', error);
      setStatusText(t('directorStage.status.snapshotFailed'));
    } finally {
      setIsCapturing(false);
    }
  }, [addDerivedExportNode, isCapturing, nodeId, t, updateNodeData]);

  const renderCameraPathToWebm = useCallback(async (
    cameraPath: DirectorStageCameraPath,
    aspectRatio: DirectorStageSnapshotAspectRatio
  ): Promise<Uint8Array> => {
    const scene = sceneRef.current;
    const sourceCamera = cameraRef.current;
    if (!scene || !sourceCamera) {
      throw new Error('Director stage scene is not ready');
    }
    if (typeof MediaRecorder === 'undefined') {
      throw new Error('MediaRecorder is not supported in this runtime');
    }

    const size = calculateDirectorStageRecordingSize(aspectRatio);
    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      preserveDrawingBuffer: true,
    });
    renderer.setClearColor(0x15171b, 1);
    renderer.setPixelRatio(1);
    renderer.setSize(size.width, size.height, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;

    const exportCamera = sourceCamera.clone() as THREE.PerspectiveCamera;
    exportCamera.aspect = size.width / size.height;
    exportCamera.updateProjectionMatrix();
    const exportTarget = new THREE.Vector3();
    const hiddenObjects: THREE.Object3D[] = [];
    const transformHelper = transformRef.current?.getHelper();
    if (transformHelper) {
      hiddenObjects.push(transformHelper);
    }
    if (cameraShotGroupRef.current) {
      hiddenObjects.push(cameraShotGroupRef.current);
    }
    hiddenObjects.push(...collectDirectorStageLightMarkerObjects(lightGroupRef.current));
    const previousVisibility = hideDirectorStageObjects(hiddenObjects);

    const stream = renderer.domElement.captureStream(DIRECTOR_STAGE_CAMERA_PATH_SAMPLE_RATE);
    const chunks: Blob[] = [];
    const recorder = new MediaRecorder(stream, {
      mimeType: resolveDirectorStageRecordingMimeType(),
      videoBitsPerSecond: 6_000_000,
    });

    try {
      scene.updateMatrixWorld(true);
      const recorderDone = new Promise<Blob>((resolve, reject) => {
        recorder.ondataavailable = (event) => {
          if (event.data.size > 0) {
            chunks.push(event.data);
          }
        };
        recorder.onerror = () => reject(new Error('Failed to record director stage video'));
        recorder.onstop = () => resolve(new Blob(chunks, { type: 'video/webm' }));
      });

      recorder.start(100);
      const totalFrames = Math.max(
        2,
        Math.round(cameraPath.clipDurationMs / 1000 * DIRECTOR_STAGE_CAMERA_PATH_SAMPLE_RATE) + 1
      );
      const frameInterval = 1000 / DIRECTOR_STAGE_CAMERA_PATH_SAMPLE_RATE;
      await new Promise<void>((resolve) => {
        let frameIndex = 0;
        const startedAt = performance.now();
        const renderNextFrame = () => {
          const sampleFrameIndex = Math.min(frameIndex, totalFrames - 1);
          applyCameraPathKeyframe(
            exportCamera,
            exportTarget,
            sampleDirectorStageCameraPathClipFrame(cameraPath, sampleFrameIndex)
          );
          renderer.render(scene, exportCamera);
          frameIndex += 1;
          if (performance.now() - startedAt >= cameraPath.clipDurationMs && frameIndex >= totalFrames) {
            resolve();
            return;
          }
          window.setTimeout(renderNextFrame, frameInterval);
        };
        renderNextFrame();
      });

      recorder.stop();
      const blob = await recorderDone;
      return new Uint8Array(await blob.arrayBuffer());
    } finally {
      stream.getTracks().forEach((track) => track.stop());
      restoreDirectorStageObjectVisibility(previousVisibility);
      renderer.dispose();
      requestRenderRef.current();
    }
  }, []);

  const exportCameraPathVideo = useCallback(async (shot: DirectorStageCameraShot) => {
    if (!shot.cameraPath || exportingCameraPathShotId) {
      return;
    }
    stopCameraPathRecording(false);
    stopCameraPathPlayback();
    const defaultFileName = sanitizeRecordingFileName(resolveCameraShotDisplayName(shot));

    setExportingCameraPathShotId(shot.id);
    setStatusText(t('directorStage.camera.exporting'));
    try {
      const webmBytes = await renderCameraPathToWebm(
        shot.cameraPath,
        projectRef.current.snapshot.aspectRatio
      );
      const result = await transcodeDirectorStageRecordingToMp4({
        webmBytes,
        outputPath: null,
        outputFileName: defaultFileName,
        targetDurationMs: shot.cameraPath.clipDurationMs,
        mediaContext: createCurrentProjectMediaContext('video'),
      });
      const recordingSize = calculateDirectorStageRecordingSize(projectRef.current.snapshot.aspectRatio);
      const clipDurationSeconds = shot.cameraPath.clipDurationMs / 1000;
      const preparedVideo = await prepareNodeVideoFromSource(
        result.videoUrl,
        createCurrentProjectMediaContext('video')
      )
        .then((video) => ({
          ...video,
          duration: clipDurationSeconds,
        }))
        .catch(() => ({
          videoUrl: result.videoUrl,
          previewImageUrl: null,
          aspectRatio: recordingSize.aspectRatioText,
          duration: clipDurationSeconds,
        }));
      addDerivedVideoNode(
        nodeId,
        preparedVideo.videoUrl,
        preparedVideo.previewImageUrl,
        preparedVideo.aspectRatio,
        preparedVideo.duration,
        {
          defaultTitle: t('directorStage.camera.recordingNodeTitle', {
            name: resolveCameraShotDisplayName(shot),
          }),
          videoFileName: result.outputFileName,
          connectToSource: true,
        }
      );
      void emitToMainWindow<DirectorStageAddVideoNodePayload>(
        DIRECTOR_STAGE_ADD_VIDEO_NODE_EVENT,
        {
          sourceNodeId: nodeId,
          videoUrl: preparedVideo.videoUrl,
          previewImageUrl: preparedVideo.previewImageUrl,
          aspectRatio: preparedVideo.aspectRatio,
          duration: preparedVideo.duration,
          options: {
            defaultTitle: t('directorStage.camera.recordingNodeTitle', {
              name: resolveCameraShotDisplayName(shot),
            }),
            videoFileName: result.outputFileName,
            connectToSource: true,
          },
        }
      ).catch((error) => {
        console.warn('Failed to ask main window to add director stage recording node', error);
      });
      setStatusText(t('directorStage.camera.nodeCreated'));
    } catch (error) {
      console.error('Failed to export director stage camera recording', error);
      setStatusText(t('directorStage.camera.nodeCreateFailed'));
    } finally {
      setExportingCameraPathShotId(null);
    }
  }, [
    addDerivedVideoNode,
    exportingCameraPathShotId,
    nodeId,
    renderCameraPathToWebm,
    stopCameraPathPlayback,
    stopCameraPathRecording,
    t,
  ]);

  const compatiblePosePresets = selectedEntity
    ? [
        ...DIRECTOR_STAGE_BUILT_IN_POSE_PRESETS
          .filter((preset) => preset.compatibleAssetIds.includes(selectedEntity.assetId))
          .map((preset): DirectorStagePoseOption => ({
            ...preset,
            origin: 'builtin',
          })),
        ...userPosePresets.filter((preset) => preset.compatibleAssetIds.includes(selectedEntity.assetId)),
      ]
    : [];
  const showPoseControls = Boolean(selectedEntity && selectedEntity.source !== 'geometry');
  const selectedObjectTransform = selectedCrowdGroup?.transform ?? selectedEntity?.transform ?? null;
  const resolveLightDisplayName = useCallback((light: DirectorStageLight): string => {
    if (light.id === 'light-ambient' && light.name === 'Ambient') {
      return t('directorStage.lightKinds.ambient');
    }
    if (light.id === 'light-key' && light.name === 'Key Light') {
      return t('directorStage.lightKinds.directional');
    }
    return light.name;
  }, [t]);
  const cameraLensPanelFocalLength = cameraLensPanelShot
    ? cameraShotFocalLengthValue(cameraLensPanelShot)
    : null;
  const showBodyControls = supportsDirectorStageLimbControls(selectedEntity);

  const renderCameraPathTimeline = () => {
    if (!timelineCameraShot) {
      return null;
    }
    const activeTimelinePath = timelineCameraPath && timelineMotionKeyframes.length >= 2
      ? timelineCameraPath
      : null;
    const hasTimelinePath = Boolean(activeTimelinePath);
    const selectedIndex = cameraPathTimeline?.shotId === timelineCameraShot.id
      ? cameraPathTimeline.selectedKeyframeIndex
      : null;
    const playheadMs = cameraPathTimeline?.shotId === timelineCameraShot.id
      ? cameraPathTimeline.playheadMs
      : 0;

    return (
      <DirectorStageCameraTimeline
        durationMs={timelineCameraPath?.durationMs ?? DIRECTOR_STAGE_CAMERA_PATH_CLIP_MAX_DURATION_MS}
        motionKeyframes={timelineMotionKeyframes}
        selectedKeyframeIndex={selectedIndex}
        playheadMs={playheadMs}
        clipStartMs={timelineCameraPath?.clipStartMs ?? 0}
        clipDurationMs={
          timelineCameraPath
            ? timelineCameraPath.clipDurationMs
            : DIRECTOR_STAGE_CAMERA_PATH_CLIP_MAX_DURATION_MS
        }
        segmentEasings={timelineCameraPath?.segmentEasings}
        labels={{
          title: t('directorStage.camera.timelineTitle'),
          summary: activeTimelinePath
            ? t('directorStage.camera.timelineSummary', {
                motion: timelineMotionKeyframes.length,
                seconds: cameraPathDurationSeconds(activeTimelinePath),
              })
            : t('directorStage.camera.timelineEmptySummary'),
          emptyTitle: t('directorStage.camera.timelineEmptyTitle'),
          emptyHint: t('directorStage.camera.timelineEmptyHint'),
          motionTrack: t('directorStage.camera.motionTrack'),
          addKeyframe: t('directorStage.camera.addKeyframe'),
          deleteKeyframe: t('directorStage.camera.deleteKeyframe'),
          previousKeyframe: t('directorStage.camera.previousKeyframe'),
          nextKeyframe: t('directorStage.camera.nextKeyframe'),
          seconds: t('directorStage.camera.seconds'),
          selected: t('directorStage.camera.selectedKeyframe'),
          locked: t('directorStage.camera.lockedKeyframe'),
          recordPath: t('directorStage.camera.recordPath'),
          stopRecording: t('directorStage.camera.stopRecording'),
          recording: t('directorStage.camera.recording'),
          playPath: t('directorStage.camera.playPath'),
          pausePlayback: t('directorStage.camera.pausePlayback'),
          exportPath: t('directorStage.camera.createVideoNode'),
          clearPath: t('directorStage.camera.clearPath'),
          totalDuration: t('directorStage.camera.totalDuration'),
          maxDurationHint: t('directorStage.camera.maxDurationHint'),
          clipRange: t('directorStage.camera.clipRange'),
        }}
        onPlayheadChange={(timeMs) => {
          if (hasTimelinePath) {
            jumpCameraPathTimeline(timelineCameraShot, timeMs);
          }
        }}
        onSelectKeyframe={(index) => {
          const keyframe = timelineMotionKeyframes[index];
          setCameraPathTimeline({
            shotId: timelineCameraShot.id,
            selectedKeyframeIndex: index,
            playheadMs: keyframe?.timeMs ?? playheadMs,
          });
        }}
        onMoveKeyframe={(index, timeMs) => {
          if (hasTimelinePath) {
            moveCameraPathKeyframe(timelineCameraShot, index, timeMs);
          }
        }}
        onAddKeyframe={() => hasTimelinePath && addCameraPathKeyframeAtPlayhead(timelineCameraShot)}
        onDeleteKeyframe={() => hasTimelinePath && deleteSelectedCameraPathKeyframe(timelineCameraShot)}
        onRecordToggle={() => {
          if (cameraPathRecording?.shotId === timelineCameraShot.id) {
            stopCameraPathRecording(true);
            return;
          }
          startCameraPathRecording(timelineCameraShot);
        }}
        onPlayToggle={() => {
          if (!hasTimelinePath) {
            return;
          }
          toggleCameraPathPlayback(timelineCameraShot);
        }}
        onExport={() => {
          if (hasTimelinePath) {
            void exportCameraPathVideo(timelineCameraShot);
          }
        }}
        onClear={() => {
          if (hasTimelinePath) {
            clearCameraPath(timelineCameraShot.id);
          }
        }}
        onClipRangeChange={(clipStartMs, clipDurationMs) => {
          if (hasTimelinePath) {
            updateCameraPathClipRange(timelineCameraShot, clipStartMs, clipDurationMs);
          }
        }}
        hasCameraPath={hasTimelinePath}
        isRecording={cameraPathRecording?.shotId === timelineCameraShot.id}
        isPlaying={cameraPathPlayback?.shotId === timelineCameraShot.id}
        isExporting={exportingCameraPathShotId === timelineCameraShot.id}
      />
    );
  };

  const renderCameraPathEasingEditor = () => {
    if (!timelineCameraShot || !timelineCameraPath || !selectedCameraPathSegment) {
      return null;
    }

    return (
      <DirectorStageCameraEasingEditor
        preset={selectedCameraPathSegment.easing.preset}
        curve={selectedCameraPathSegment.easing.curve}
        speed={selectedCameraPathSegment.easing.speed ?? 1}
        labels={{
          title: t('directorStage.camera.easing.title'),
          subtitle: t('directorStage.camera.easing.subtitle', {
            from: formatCameraPathSeconds(selectedCameraPathSegment.left.timeMs),
            to: formatCameraPathSeconds(selectedCameraPathSegment.right.timeMs),
          }),
          customHint: t('directorStage.camera.easing.customHint'),
          curveLabel: t('directorStage.camera.easing.curveLabel'),
          speedLabel: t('directorStage.camera.easing.speedLabel'),
          speedHint: t('directorStage.camera.easing.speedHint'),
          presets: {
            linear: t('directorStage.camera.easing.presets.linear'),
            easeIn: t('directorStage.camera.easing.presets.easeIn'),
            easeOut: t('directorStage.camera.easing.presets.easeOut'),
            easeInOut: t('directorStage.camera.easing.presets.easeInOut'),
            accelerate: t('directorStage.camera.easing.presets.accelerate'),
            decelerate: t('directorStage.camera.easing.presets.decelerate'),
            custom: t('directorStage.camera.easing.presets.custom'),
          },
        }}
        onChange={(preset, curve) => {
          const presetCurve = preset === 'custom'
            ? curve
            : DIRECTOR_STAGE_CAMERA_PATH_EASING_PRESETS[preset] ?? DIRECTOR_STAGE_CAMERA_PATH_DEFAULT_EASING.curve;
          const timingSpeed = resolveCameraPathCurveTimingSpeed(preset, presetCurve);
          updateCameraPathSegmentSpeed(
            timelineCameraShot,
            selectedCameraPathSegment.index,
            timingSpeed,
            {
              preset,
              curve: presetCurve,
            }
          );
        }}
        onSpeedChange={(speed) => {
          updateCameraPathSegmentSpeed(
            timelineCameraShot,
            selectedCameraPathSegment.index,
            speed
          );
        }}
      />
    );
  };

  const renderPoseControls = () => {
    if (!selectedEntity || !showPoseControls) {
      return null;
    }

    return (
      <div className="space-y-2 rounded-md border border-white/10 bg-white/[0.03] p-2.5">
        <div className="flex h-7 items-center justify-between gap-2">
          <button
            type="button"
            className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-xs font-semibold uppercase text-white/45"
            aria-expanded={isPoseControlsOpen}
            onClick={() => setIsPoseControlsOpen((current) => !current)}
          >
            {isPoseControlsOpen
              ? <ChevronDown className="h-3.5 w-3.5 shrink-0" />
              : <ChevronRight className="h-3.5 w-3.5 shrink-0" />}
            <span className="truncate">{t('directorStage.poses.title')}</span>
          </button>
          <button
            type="button"
            className="flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-white/10 bg-black/24 px-2 text-[11px] text-white/58 transition-colors hover:border-emerald-300/40 hover:bg-emerald-300/10 hover:text-emerald-100 disabled:cursor-not-allowed disabled:opacity-45"
            disabled={isImportingAnimation}
            onClick={() => void importAnimationForSelectedEntity()}
          >
            {isImportingAnimation ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Upload className="h-3.5 w-3.5" />
            )}
            {isImportingAnimation
              ? t('directorStage.animationLibrary.importing')
              : t('directorStage.animationLibrary.import')}
          </button>
        </div>
        {isPoseControlsOpen ? (
          compatiblePosePresets.length > 0 ? (
            <div
              className="grid grid-cols-2 gap-1.5"
              role="radiogroup"
              aria-label={t('directorStage.poses.title')}
            >
              <button
                type="button"
                role="radio"
                aria-checked={!selectedEntity.posePresetId}
                className={`flex h-8 min-w-0 items-center justify-between gap-1 rounded-md border px-2 text-left text-xs transition-colors ${
                  !selectedEntity.posePresetId
                    ? 'border-emerald-300/50 bg-emerald-300/12 text-emerald-100'
                    : 'border-white/10 bg-black/24 text-white/58 hover:bg-white/[0.07] hover:text-white'
                }`}
                onClick={() => selectEntityPosePreset(selectedEntity.id, null)}
              >
                <span className="min-w-0 truncate">{t('directorStage.poses.none')}</span>
                {!selectedEntity.posePresetId ? <Check className="h-3.5 w-3.5 shrink-0" /> : null}
              </button>
              {compatiblePosePresets.map((preset) => {
                const isSelectedPose = selectedEntity.posePresetId === preset.id;
                const animationAssetItem = preset.assetItem;
                const isDeletingAnimationAsset = animationAssetItem
                  ? deletingAnimationAssetIds.has(animationAssetItem.id)
                  : false;
                return (
                  <div
                    key={preset.id}
                    className={`flex h-8 min-w-0 items-center justify-between gap-1 rounded-md border px-2 text-left text-xs transition-colors ${
                      isSelectedPose
                        ? 'border-emerald-300/50 bg-emerald-300/12 text-emerald-100'
                        : 'border-white/10 bg-black/24 text-white/58 hover:bg-white/[0.07] hover:text-white'
                    }`}
                  >
                    <button
                      type="button"
                      role="radio"
                      aria-checked={isSelectedPose}
                      className="min-w-0 flex-1 truncate text-left"
                      onClick={() => selectEntityPosePreset(selectedEntity.id, preset.id)}
                    >
                      {preset.origin === 'user' ? preset.labelKey : t(preset.labelKey)}
                    </button>
                    {isSelectedPose ? <Check className="h-3.5 w-3.5 shrink-0" /> : null}
                    {animationAssetItem ? (
                      <button
                        type="button"
                        className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-white/35 transition-colors hover:bg-red-400/12 hover:text-red-200 disabled:cursor-not-allowed disabled:opacity-45"
                        disabled={isDeletingAnimationAsset}
                        title={isDeletingAnimationAsset
                          ? t('directorStage.animationLibrary.deleting')
                          : t('directorStage.animationLibrary.delete')}
                        aria-label={isDeletingAnimationAsset
                          ? t('directorStage.animationLibrary.deleting')
                          : t('directorStage.animationLibrary.delete')}
                        onClick={(event) => {
                          event.stopPropagation();
                          void deleteAnimationAssetFromLibrary(animationAssetItem);
                        }}
                      >
                        {isDeletingAnimationAsset ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="h-3.5 w-3.5" />
                        )}
                      </button>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="rounded-md border border-white/10 bg-black/24 p-3 text-xs text-white/45">
              {selectedEntity.source === 'user'
                ? t('directorStage.poses.userModelHint')
                : t('directorStage.poses.incompatible')}
            </div>
          )
        ) : null}
      </div>
    );
  };

  const renderBodyControls = () => {
    if (!selectedEntity || !showBodyControls) {
      return null;
    }

    return (
      <div className="space-y-2 rounded-md border border-white/10 bg-white/[0.03] p-2.5">
        <button
          type="button"
          className="flex h-7 w-full items-center justify-between gap-2 text-left"
          aria-expanded={isBodyControlsOpen}
          onClick={() => setIsBodyControlsOpen((current) => !current)}
        >
          <span className="flex min-w-0 items-center gap-1.5 text-xs font-semibold uppercase text-white/45">
            {isBodyControlsOpen
              ? <ChevronDown className="h-3.5 w-3.5 shrink-0" />
              : <ChevronRight className="h-3.5 w-3.5 shrink-0" />}
            <span className="truncate">{t('directorStage.bodyControls.title')}</span>
          </span>
        </button>
        {isBodyControlsOpen ? (
          <div className="space-y-2.5">
            <div className="flex justify-end">
              <button
                type="button"
                className="flex h-6 items-center rounded-md border border-white/10 bg-black/24 px-2 text-[11px] text-white/50 transition-colors hover:bg-white/[0.07] hover:text-white"
                onClick={resetSelectedEntityLimbPose}
              >
                {t('directorStage.bodyControls.reset')}
              </button>
            </div>
            {DIRECTOR_STAGE_LIMB_POSE_KEYS.map((limbKey) => {
              const rotation = selectedEntity.limbPose?.[limbKey] ?? createStageVector3(0, 0, 0);
              return (
                <div key={limbKey} className="space-y-1.5">
                  <div className="text-[11px] text-white/50">
                    {t(`directorStage.bodyControls.${limbKey}`)}
                  </div>
                  <div className="grid grid-cols-3 gap-1.5">
                    {(['x', 'y', 'z'] as const).map((axis) => {
                      const degreeValue = radiansToDegrees(rotation[axis]);
                      return (
                        <label key={axis} className="min-w-0 space-y-1 text-[10px] uppercase text-white/38">
                          {axis}
                          <input
                            type="range"
                            min={-90}
                            max={90}
                            step={1}
                            value={Math.round(degreeValue)}
                            onChange={(event) =>
                              updateSelectedEntityLimbPose(
                                limbKey,
                                axis,
                                degreesToRadians(Number(event.target.value))
                              )
                            }
                            onPointerUp={commitDeferredProjectEdit}
                            onBlur={commitDeferredProjectEdit}
                            onKeyUp={commitDeferredProjectEdit}
                            className="h-4 w-full accent-emerald-300"
                          />
                          <DirectorStageNumberInput
                            min={-90}
                            max={90}
                            step={1}
                            value={degreeValue}
                            formatValue={degreeInputValue}
                            onValueChange={(value) =>
                              updateSelectedEntityLimbPose(limbKey, axis, degreesToRadians(value))
                            }
                            onBlur={commitDeferredProjectEdit}
                            className="h-7 rounded-md border-white/10 bg-black/24 px-1 text-center text-[11px]"
                          />
                        </label>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        ) : null}
      </div>
    );
  };

  const renderTransformInputs = (
    group: 'position' | 'rotation' | 'scale',
    labelKey: string
  ) => {
    if (!selectedObjectTransform) {
      return null;
    }
    return (
      <div className="space-y-2">
        <div className="flex h-6 items-center justify-between gap-2">
          <div className="text-xs font-semibold uppercase text-white/45">{t(labelKey)}</div>
          {group === 'scale' ? (
            <button
              type="button"
              className={`flex h-6 w-6 items-center justify-center rounded-md border transition-colors ${
                isScaleLocked
                  ? 'border-emerald-300/40 bg-emerald-300/10 text-emerald-100'
                  : 'border-white/10 bg-black/24 text-white/45 hover:bg-white/[0.07] hover:text-white'
              }`}
              aria-pressed={isScaleLocked}
              aria-label={isScaleLocked
                ? t('directorStage.transform.unlockScale')
                : t('directorStage.transform.lockScale')}
              title={isScaleLocked
                ? t('directorStage.transform.unlockScale')
                : t('directorStage.transform.lockScale')}
              onClick={toggleScaleLock}
            >
              {isScaleLocked ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5" />}
            </button>
          ) : null}
        </div>
        <div className="grid grid-cols-3 gap-2">
          {(['x', 'y', 'z'] as const).map((axis) => (
            <label key={axis} className="space-y-1 text-[11px] uppercase text-white/42">
              {axis}
              <DirectorStageNumberInput
                min={group === 'scale' ? DIRECTOR_STAGE_MIN_SCALE : undefined}
                max={group === 'scale' ? DIRECTOR_STAGE_MAX_SCALE : undefined}
                step={group === 'rotation' ? 0.05 : group === 'scale' ? 0.01 : 0.1}
                value={selectedObjectTransform[group][axis]}
                formatValue={numericInputValue}
                onValueChange={(value) => updateSelectedObjectTransform(axis, group, value)}
                onBlur={commitDeferredProjectEdit}
                className="h-8 rounded-md border-white/10 bg-black/24 text-xs"
              />
            </label>
          ))}
        </div>
      </div>
    );
  };

  const renderPlaneSurfaceControls = () => {
    if (!isDirectorStagePlaneEntity(selectedEntity)) {
      return null;
    }
    const surface = resolvePlaneSurface(selectedEntity);
    return (
      <div className="space-y-3 rounded-md border border-white/10 bg-white/[0.03] p-3">
        <div className="text-xs font-semibold uppercase text-white/45">
          {t('directorStage.planeSurface.title')}
        </div>
        <label className="block space-y-1 text-xs text-white/55">
          {t('directorStage.planeSurface.aspectRatio')}
          <UiSelect
            value={surface.aspectRatioPreset}
            aria-label={t('directorStage.planeSurface.aspectRatio')}
            className="h-8 rounded-md !border-white/10 !bg-black/24 !text-xs !text-white [&>span]:!text-white [&_svg]:!text-white"
            onChange={(event) =>
              selectPlaneAspectRatioPreset(
                selectedEntity,
                event.target.value as DirectorStagePlaneAspectRatioPreset
              )}
          >
            {DIRECTOR_STAGE_PLANE_ASPECT_RATIO_PRESETS.map((preset) => (
              <option key={preset} value={preset}>
                {preset === 'custom' ? t('directorStage.planeSurface.customAspectRatio') : preset}
              </option>
            ))}
          </UiSelect>
        </label>
        {surface.aspectRatioPreset === 'custom' ? (
          <label className="block space-y-1 text-xs text-white/55">
            {t('directorStage.planeSurface.customAspectRatio')}
            <DirectorStageNumberInput
              min={DIRECTOR_STAGE_PLANE_ASPECT_RATIO_MIN}
              max={DIRECTOR_STAGE_PLANE_ASPECT_RATIO_MAX}
              step={0.05}
              value={surface.customAspectRatio}
              formatValue={numericInputValue}
              onValueChange={(value) => updatePlaneCustomAspectRatio(selectedEntity, value)}
              className="h-8 rounded-md border-white/10 bg-black/24 text-xs"
            />
          </label>
        ) : null}
        <div className="space-y-1.5">
          <div className="text-xs text-white/55">{t('directorStage.planeSurface.image')}</div>
          <div className="flex items-center gap-2">
            <UiButton
              type="button"
              variant="muted"
              size="sm"
              className="shrink-0 gap-1.5 !border !border-white/10 !bg-black/24 !text-white/70 hover:!bg-white/[0.08] hover:!text-white [&_svg]:!text-white"
              onClick={() => void choosePlaneSurfaceImage(selectedEntity)}
            >
              <Upload className="h-3.5 w-3.5" />
              {t('directorStage.planeSurface.chooseImage')}
            </UiButton>
            {surface.imagePath ? (
              <button
                type="button"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-white/10 bg-black/24 text-white/42 transition-colors hover:border-red-300/40 hover:bg-red-400/10 hover:text-red-100"
                title={t('directorStage.planeSurface.removeImage')}
                aria-label={t('directorStage.planeSurface.removeImage')}
                onClick={() => removePlaneSurfaceImage(selectedEntity)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>
          {surface.imageName ? (
            <div className="truncate rounded-md border border-white/10 bg-black/24 px-2 py-1.5 text-xs text-white/55">
              {surface.imageName}
            </div>
          ) : (
            <div className="rounded-md border border-dashed border-white/12 px-2 py-1.5 text-xs text-white/38">
              {t('directorStage.planeSurface.noImage')}
            </div>
          )}
        </div>
        <label className="block space-y-1 text-xs text-white/55">
          {t('directorStage.planeSurface.fitMode')}
          <UiSelect
            value={surface.fitMode}
            aria-label={t('directorStage.planeSurface.fitMode')}
            className="h-8 rounded-md !border-white/10 !bg-black/24 !text-xs !text-white [&>span]:!text-white [&_svg]:!text-white"
            onChange={(event) =>
              updatePlaneSurface(selectedEntity, {
                fitMode: event.target.value as DirectorStagePlaneSurfaceFitMode,
              })}
          >
            <option value="contain">{t('directorStage.planeSurface.fitContain')}</option>
            <option value="stretch">{t('directorStage.planeSurface.fitStretch')}</option>
          </UiSelect>
        </label>
      </div>
    );
  };

  const activeCrowdProgressPercent = activeCrowdRenderProgress
    ? progressPercent(activeCrowdRenderProgress.progress)
    : 0;
  const activeCrowdProgressPhaseLabel = activeCrowdRenderProgress
    ? t(`directorStage.crowd.progressPhases.${activeCrowdRenderProgress.phase}`)
    : '';

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-[#0f1012] text-white">
      <header
        className="flex h-14 shrink-0 items-center justify-between border-b border-white/10 bg-[#17191d] px-4"
      >
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-md border border-white/10 bg-white/[0.04]">
            <Clapperboard className="h-4.5 w-4.5 text-white/78" />
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">{t('directorStage.title')}</div>
            <div className="truncate text-xs text-white/48">
              {cameraPathRecording
                ? t('directorStage.camera.recordingStatus', {
                    seconds: (cameraPathRecording.elapsedMs / 1000).toFixed(1),
                  })
                : cameraPathPlayback
                  ? t('directorStage.camera.playingStatus')
                  : t('directorStage.headerMeta', {
                      objects: visibleObjectItems.length,
                      shots: project.cameraShots.length,
                    })}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2" data-ui-modal-drag-ignore="true">
          {statusText ? <div className="text-xs text-emerald-300">{statusText}</div> : null}
          <UiButton
            type="button"
            variant="muted"
            size="sm"
            className="gap-1.5 !border !border-white/10 !bg-white/[0.06] !text-white hover:!bg-white/[0.1] hover:!text-white [&_svg]:!text-white"
            onClick={saveProject}
          >
            <Save className="h-3.5 w-3.5" />
            {t('common.save')}
          </UiButton>
          <div className="flex h-8 items-center gap-2 rounded-md border border-white/10 bg-white/[0.03] pl-2 pr-1 text-xs text-white">
            <button
              type="button"
              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition-colors ${
                project.snapshot.showMask
                  ? 'bg-emerald-300/12 text-emerald-100'
                  : 'text-white/45 hover:bg-white/[0.08] hover:text-white'
              }`}
              aria-pressed={project.snapshot.showMask}
              aria-label={project.snapshot.showMask
                ? t('directorStage.snapshot.hideMask')
                : t('directorStage.snapshot.showMask')}
              title={project.snapshot.showMask
                ? t('directorStage.snapshot.hideMask')
                : t('directorStage.snapshot.showMask')}
              onClick={toggleSnapshotMask}
            >
              {project.snapshot.showMask ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
            </button>
            <span>{t('directorStage.snapshot.aspectRatio')}</span>
            <UiSelect
              value={project.snapshot.aspectRatio}
              aria-label={t('directorStage.snapshot.aspectRatio')}
              className="h-7 w-[86px] !border-white/10 !bg-white/[0.06] !text-white [&>span]:!text-white [&_svg]:!text-white"
              onChange={(event) => {
                setSnapshotAspectRatio(event.target.value as DirectorStageSnapshotAspectRatio);
              }}
            >
              {DIRECTOR_STAGE_SNAPSHOT_ASPECT_RATIOS.map((aspectRatio) => (
                <option key={aspectRatio} value={aspectRatio}>
                  {t(SNAPSHOT_ASPECT_RATIO_LABEL_KEYS[aspectRatio])}
                </option>
              ))}
            </UiSelect>
          </div>
          <UiButton
            type="button"
            variant="primary"
            size="sm"
            className="gap-1.5 !text-white [&_svg]:!text-white"
            disabled={isCapturing}
            onClick={captureToCanvas}
          >
            <Download className="h-3.5 w-3.5" />
            {isCapturing ? t('directorStage.snapshot.capturing') : t('directorStage.snapshot.send')}
          </UiButton>
        </div>
      </header>

      <main
        className={`grid min-h-0 flex-1 grid-cols-[280px_minmax(0,1fr)_320px] ${
          showExpandedCameraPathTimeline
            ? 'grid-rows-[minmax(0,1fr)_136px_112px]'
            : 'grid-rows-[minmax(0,1fr)_112px]'
        }`}
      >
        <aside className={`${showExpandedCameraPathTimeline ? 'row-span-3' : 'row-span-2'} flex min-h-0 flex-col border-r border-white/10 bg-[#15171a]`}>
          <div className="grid grid-cols-2 gap-1 border-b border-white/10 p-2">
            {(['a3d', 'library'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                className={`h-9 rounded-md text-xs font-medium transition-colors ${
                  activeTab === tab
                    ? 'bg-white/12 text-white'
                    : 'text-white/48 hover:bg-white/[0.06] hover:text-white/78'
                }`}
                onClick={() => setActiveTab(tab)}
              >
                {t(`directorStage.tabs.${tab}`)}
              </button>
            ))}
          </div>

          <div className="ui-scrollbar min-h-0 flex-1 overflow-y-auto p-3">
            {activeTab === 'a3d' ? (
              <div className="space-y-3">
                <div className="rounded-md border border-white/10 bg-white/[0.025] p-2">
                  <button
                    type="button"
                    className="flex h-7 w-full items-center justify-between gap-2 text-left"
                    aria-expanded={isGeometryPanelOpen}
                    onClick={() => setIsGeometryPanelOpen((current) => !current)}
                  >
                    <span className="flex min-w-0 items-center gap-1.5 text-xs font-semibold uppercase text-white/45">
                      {isGeometryPanelOpen
                        ? <ChevronDown className="h-3.5 w-3.5 shrink-0" />
                        : <ChevronRight className="h-3.5 w-3.5 shrink-0" />}
                      <span className="truncate">{t('directorStage.assetPack.geometry')}</span>
                    </span>
                  </button>
                  {isGeometryPanelOpen ? (
                    <div className="mt-2 grid grid-cols-2 gap-1.5">
                      {DIRECTOR_STAGE_BUILT_IN_GEOMETRIES.map((asset) => {
                        const GeometryIcon = DIRECTOR_STAGE_GEOMETRY_ICON_BY_ID[asset.id] ?? Box;
                        return (
                          <button
                            key={asset.id}
                            type="button"
                            className="flex h-[68px] min-w-0 flex-col items-center justify-center gap-1.5 rounded-md border border-white/10 bg-black/24 px-2 text-center text-xs text-white/62 transition-colors hover:border-emerald-300/40 hover:bg-emerald-300/10 hover:text-emerald-100"
                            title={t(asset.labelKey)}
                            onClick={() => addBuiltInAsset(asset)}
                          >
                            <GeometryIcon className="h-5 w-5 shrink-0" />
                            <span className="max-w-full truncate">{t(asset.labelKey)}</span>
                          </button>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
                {DIRECTOR_STAGE_ASSET_PACKS.map((pack) => (
                  <div key={pack.id} className="space-y-2">
                    <div className="text-xs font-semibold uppercase text-white/45">
                      {t(pack.labelKey)}
                    </div>
                    {pack.characters.map((asset) => (
                      <div
                        key={asset.id}
                        className="flex w-full items-center gap-2 rounded-md border border-white/10 bg-white/[0.035] p-2 text-left transition-colors hover:border-white/18 hover:bg-white/[0.06]"
                      >
                        <button
                          type="button"
                          className="flex min-w-0 flex-1 items-center gap-3 text-left"
                          onClick={() => addBuiltInAsset(asset)}
                        >
                          <div className="h-14 w-14 shrink-0 overflow-hidden rounded-md bg-black/30">
                            {asset.previewPath ? (
                              <img
                                src={asset.previewPath}
                                alt={t(asset.labelKey)}
                                className="h-full w-full object-cover"
                              />
                            ) : (
                              <Box className="m-auto h-6 w-6 text-white/45" />
                            )}
                          </div>
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium">{t(asset.labelKey)}</div>
                            <div className="mt-1 text-xs text-white/45">
                              {t('directorStage.assetCard.poseCount', {
                                count: asset.posePresetIds.length,
                              })}
                            </div>
                          </div>
                        </button>
                        <button
                          type="button"
                          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-white/10 bg-black/24 text-white/52 transition-colors hover:border-emerald-300/40 hover:bg-emerald-300/10 hover:text-emerald-100"
                          title={t('directorStage.crowd.open')}
                          aria-label={t('directorStage.crowd.open')}
                          onClick={() => openCrowdModeDialog(asset)}
                        >
                          <Users className="h-4 w-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                ))}

                <div className="pt-2">
                  <div className="mb-2 text-xs font-semibold uppercase text-white/45">
                    {t('directorStage.environment.title')}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      className={`overflow-hidden rounded-md border text-left ${
                        project.environment.id === 'studio-grid'
                          ? 'border-emerald-300/55'
                          : 'border-white/10'
                      }`}
                      onClick={() => setBuiltInEnvironment('studio-grid')}
                    >
                      <div className="flex aspect-video items-center justify-center bg-[#202329]">
                        <Eye className="h-5 w-5 text-white/52" />
                      </div>
                      <div className="truncate px-2 py-1.5 text-xs text-white/68">
                        {t('directorStage.skyboxes.grid')}
                      </div>
                    </button>
                    {DIRECTOR_STAGE_SKYBOX_PRESETS.map((skybox) => (
                      <button
                        key={skybox.id}
                        type="button"
                        className={`overflow-hidden rounded-md border text-left ${
                          project.environment.id === skybox.id
                            ? 'border-emerald-300/55'
                            : 'border-white/10'
                        }`}
                        onClick={() => setBuiltInEnvironment(skybox.id)}
                      >
                        <img
                          src={skybox.previewPath}
                          alt={t(skybox.labelKey)}
                          className="aspect-video w-full object-cover"
                        />
                        <div className="truncate px-2 py-1.5 text-xs text-white/68">
                          {t(skybox.labelKey)}
                        </div>
                      </button>
                    ))}
                  </div>
                  {connectedEnvironments.length > 0 ? (
                    <div className="mt-3">
                      <div className="mb-2 text-[11px] font-semibold uppercase text-white/36">
                        {t('directorStage.environment.canvasInputs')}
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        {connectedEnvironments.map((environment) => (
                          <button
                            key={environment.id}
                            type="button"
                            className={`overflow-hidden rounded-md border text-left transition-colors ${
                              project.environment.id === environment.id
                                ? 'border-emerald-300/55'
                                : 'border-white/10 hover:border-white/18'
                            }`}
                            onClick={() => setConnectedEnvironment(environment)}
                          >
                            <img
                              src={resolveImageDisplayUrl(environment.previewPath ?? environment.backgroundPath)}
                              alt={environment.name}
                              className="aspect-video w-full object-cover"
                            />
                            <div className="truncate px-2 py-1.5 text-xs text-white/68">
                              {environment.name}
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <UiButton
                  type="button"
                  variant="primary"
                  className="w-full gap-2"
                  disabled={isImportingModel}
                  onClick={importModelToLibrary}
                >
                  <Upload className="h-4 w-4" />
                  {isImportingModel
                    ? t('directorStage.modelLibrary.importing')
                    : t('directorStage.modelLibrary.import')}
                </UiButton>
                {userModelAssets.length > 0 ? (
                  <div className="space-y-2">
                    {userModelAssets.map((item) => {
                      const isDeletingModelAsset = deletingModelAssetIds.has(item.id);
                      return (
                        <div
                          key={item.id}
                          className="flex w-full items-center gap-2 rounded-md border border-white/10 bg-white/[0.035] p-2 text-left transition-colors hover:border-white/18 hover:bg-white/[0.06]"
                        >
                          <button
                            type="button"
                            className="flex min-w-0 flex-1 items-center gap-3 text-left"
                            onClick={() => addUserModelAsset(item)}
                          >
                            <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-md bg-black/30">
                              {item.previewPath ? (
                                <img
                                  src={resolveImageDisplayUrl(item.previewPath)}
                                  alt={item.name}
                                  className="h-full w-full object-cover"
                                />
                              ) : (
                                <Package className="h-5 w-5 text-white/48" />
                              )}
                            </div>
                            <div className="min-w-0">
                              <div className="truncate text-sm font-medium">{item.name}</div>
                              <div className="mt-1 text-xs text-white/45">
                                {t(`assets.categories.${item.category}`)}
                              </div>
                            </div>
                          </button>
                          <button
                            type="button"
                            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-white/10 bg-black/24 text-white/42 transition-colors hover:border-red-300/40 hover:bg-red-400/10 hover:text-red-100 disabled:cursor-not-allowed disabled:opacity-45"
                            disabled={isDeletingModelAsset}
                            title={isDeletingModelAsset
                              ? t('directorStage.modelLibrary.deleting')
                              : t('directorStage.modelLibrary.delete')}
                            aria-label={isDeletingModelAsset
                              ? t('directorStage.modelLibrary.deleting')
                              : t('directorStage.modelLibrary.delete')}
                            onClick={() => void deleteModelAssetFromLibrary(item)}
                          >
                            {isDeletingModelAsset ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Trash2 className="h-4 w-4" />
                            )}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="rounded-md border border-dashed border-white/12 p-4 text-center">
                    <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-md bg-white/[0.04] text-white/45">
                      <Package className="h-5 w-5" />
                    </div>
                    <div className="mt-3 text-sm font-medium text-white/78">
                      {t('directorStage.modelLibrary.empty')}
                    </div>
                    <div className="mt-1 text-xs leading-5 text-white/45">
                      {t('directorStage.modelLibrary.emptyHint')}
                    </div>
                    <div className="mt-4 grid grid-cols-1 gap-2">
                      <UiButton
                        type="button"
                        variant="primary"
                        className="w-full gap-2"
                        disabled={isImportingModel}
                        onClick={importModelToLibrary}
                      >
                        <Upload className="h-4 w-4" />
                        {isImportingModel
                          ? t('directorStage.modelLibrary.importing')
                          : t('directorStage.modelLibrary.import')}
                      </UiButton>
                      <UiButton
                        type="button"
                        variant="muted"
                        className="w-full gap-2 !border !border-white/10 !bg-white/[0.06] !text-white hover:!bg-white/[0.1] hover:!text-white [&_svg]:!text-white"
                        onClick={openSketchfabModelFeed}
                      >
                        <ExternalLink className="h-4 w-4" />
                        {t('directorStage.modelLibrary.browseSketchfab')}
                      </UiButton>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </aside>

        <section className="relative min-h-0 overflow-hidden bg-[#101114]">
          <div ref={containerRef} className="absolute inset-0" />
          {showCameraPathTimeline ? (
            <button
              type="button"
              className="absolute bottom-0 left-1/2 z-40 flex h-5 w-28 -translate-x-1/2 translate-y-px items-center justify-center rounded-t-md border border-b-0 border-white/12 bg-[#17191d]/95 text-white/38 shadow-lg shadow-black/25 transition-colors hover:border-emerald-300/35 hover:bg-[#1f2425] hover:text-emerald-100"
              title={isCameraPathTimelineCollapsed
                ? t('directorStage.camera.expandTimeline')
                : t('directorStage.camera.collapseTimeline')}
              aria-label={isCameraPathTimelineCollapsed
                ? t('directorStage.camera.expandTimeline')
                : t('directorStage.camera.collapseTimeline')}
              aria-expanded={!isCameraPathTimelineCollapsed}
              onClick={() => setIsCameraPathTimelineCollapsed((current) => !current)}
            >
              {isCameraPathTimelineCollapsed
                ? <ChevronDown className="h-3.5 w-3.5" />
                : <ChevronDown className="h-3.5 w-3.5 rotate-180" />}
            </button>
          ) : null}
          {cameraPathRecording ? (
            <div className="pointer-events-none absolute left-1/2 top-4 z-30 w-[280px] -translate-x-1/2 rounded-md border border-red-300/25 bg-red-950/70 px-3 py-2 shadow-xl shadow-black/35 backdrop-blur">
              <div className="flex items-center justify-between text-xs text-red-50">
                <span>{t('directorStage.camera.recording')}</span>
                <span className="font-mono">{(cameraPathRecording.elapsedMs / 1000).toFixed(1)}s</span>
              </div>
            </div>
          ) : null}
          {snapshotFrameStyle ? (
            <div
              className="pointer-events-none absolute z-10 border border-emerald-200/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.46)] ring-1 ring-black/35"
              style={snapshotFrameStyle}
            >
              <div className="absolute inset-y-0 left-1/3 border-l border-white/[0.055]" />
              <div className="absolute inset-y-0 left-2/3 border-l border-white/[0.055]" />
              <div className="absolute inset-x-0 top-1/3 border-t border-white/[0.055]" />
              <div className="absolute inset-x-0 top-2/3 border-t border-white/[0.055]" />
            </div>
          ) : null}
          <div className="pointer-events-none absolute left-4 top-4 z-20 flex gap-2">
            {(['translate', 'rotate', 'scale'] as const).map((mode) => {
              const Icon = mode === 'translate' ? Move3D : mode === 'rotate' ? Rotate3D : Scale3D;
              const shortcut = DIRECTOR_STAGE_TRANSFORM_SHORTCUTS[mode];
              const label = t(`directorStage.transformModes.${mode}`);
              return (
                <button
                  key={mode}
                  type="button"
                  className={`pointer-events-auto flex h-9 w-9 items-center justify-center rounded-md border transition-colors ${
                    project.transformMode === mode
                      ? 'border-emerald-300/50 bg-emerald-300/12 text-emerald-100'
                      : 'border-white/10 bg-black/35 text-white/55 hover:bg-white/[0.08]'
                  }`}
                  onClick={() => setTransformMode(mode)}
                  title={shortcutTitle(label, shortcut)}
                  aria-label={shortcutTitle(label, shortcut)}
                  aria-keyshortcuts={shortcut}
                >
                  <Icon className="h-4 w-4" />
                </button>
              );
            })}
            <button
              type="button"
              className={`pointer-events-auto flex h-9 w-9 items-center justify-center rounded-md border transition-colors ${
                selectedEntity || selectedCrowdGroup
                  ? 'border-white/10 bg-black/35 text-white/55 hover:bg-white/[0.08] hover:text-white'
                  : 'cursor-not-allowed border-white/5 bg-black/20 text-white/22'
              }`}
              disabled={!selectedEntity && !selectedCrowdGroup}
              onClick={frameSelectedEntityInView}
              title={shortcutTitle(t('directorStage.camera.frameSelected'), DIRECTOR_STAGE_FRAME_SELECTED_SHORTCUT)}
              aria-label={shortcutTitle(t('directorStage.camera.frameSelected'), DIRECTOR_STAGE_FRAME_SELECTED_SHORTCUT)}
              aria-keyshortcuts={DIRECTOR_STAGE_FRAME_SELECTED_SHORTCUT}
            >
              <Maximize2 className="h-4 w-4" />
            </button>
            <button
              type="button"
              className={`pointer-events-auto flex h-9 w-9 items-center justify-center rounded-md border transition-colors ${
                project.showGroundGrid
                  ? 'border-emerald-300/50 bg-emerald-300/12 text-emerald-100'
                  : 'border-white/10 bg-black/35 text-white/45 hover:bg-white/[0.08] hover:text-white'
              }`}
              aria-pressed={project.showGroundGrid}
              onClick={toggleGroundGrid}
              title={shortcutTitle(
                project.showGroundGrid
                  ? t('directorStage.viewport.hideGroundGrid')
                  : t('directorStage.viewport.showGroundGrid'),
                DIRECTOR_STAGE_GROUND_GRID_SHORTCUT
              )}
              aria-label={shortcutTitle(
                project.showGroundGrid
                  ? t('directorStage.viewport.hideGroundGrid')
                  : t('directorStage.viewport.showGroundGrid'),
                DIRECTOR_STAGE_GROUND_GRID_SHORTCUT
              )}
              aria-keyshortcuts={DIRECTOR_STAGE_GROUND_GRID_SHORTCUT}
            >
              <Grid3X3 className="h-4 w-4" />
            </button>
          </div>
          {activeCrowdRenderProgress ? (
            <div
              className="pointer-events-none absolute bottom-5 left-1/2 z-30 w-[min(380px,calc(100%-32px))] -translate-x-1/2 rounded-md border border-white/12 bg-[#17191d]/92 p-3 shadow-2xl shadow-black/35 backdrop-blur"
              role="status"
              aria-live="polite"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2">
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin text-emerald-200" />
                  <div className="min-w-0">
                    <div className="truncate text-xs font-semibold text-white/86">
                      {t('directorStage.crowd.progressTitle')}
                    </div>
                    <div className="mt-0.5 truncate text-[11px] text-white/48">
                      {activeCrowdRenderProgress.groupName} / {activeCrowdProgressPhaseLabel}
                    </div>
                  </div>
                </div>
                <div className="shrink-0 text-xs font-medium text-emerald-200">
                  {activeCrowdProgressPercent}%
                </div>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-emerald-300 transition-[width] duration-200 ease-out"
                  style={{ width: `${activeCrowdProgressPercent}%` }}
                />
              </div>
              <div className="mt-2 flex items-center justify-between gap-3 text-[11px] text-white/42">
                <span className="truncate">{t('directorStage.crowd.progressHint')}</span>
                {crowdRenderProgressItems.length > 1 ? (
                  <span className="shrink-0">
                    {t('directorStage.crowd.progressQueue', { count: crowdRenderProgressItems.length })}
                  </span>
                ) : null}
              </div>
            </div>
          ) : null}
        </section>

        <aside className={`${showExpandedCameraPathTimeline ? 'row-span-3' : 'row-span-2'} flex min-h-0 flex-col border-l border-white/10 bg-[#15171a]`}>
          <div className="border-b border-white/10 p-3">
            <div className="text-sm font-semibold">{t('directorStage.properties.title')}</div>
            <div className="mt-1 truncate text-xs text-white/45">
              {selectedCrowdGroup?.name
                ?? selectedEntity?.name
                ?? (selectedLight ? resolveLightDisplayName(selectedLight) : t('directorStage.properties.none'))}
            </div>
          </div>

          <div className="ui-scrollbar min-h-0 flex-1 space-y-5 overflow-y-auto p-3">
            <section className="space-y-3">
              <div className="text-xs font-semibold uppercase text-white/45">
                {t('directorStage.objects.title')}
              </div>
              <div className="space-y-1">
                {visibleObjectItems.map((item) => {
                  if (item.kind === 'crowdGroup') {
                    const group = item.group;
                    const isSelected = project.selectedCrowdGroupId === group.id;
                    return (
                      <div
                        key={group.id}
                        className={`group flex items-center rounded-md transition-colors ${
                          isSelected
                            ? 'bg-emerald-300/10 text-white'
                            : 'text-white/58 hover:bg-white/[0.06]'
                        }`}
                      >
                        <button
                          type="button"
                          className="min-w-0 flex-1 px-2 py-2 text-left text-sm"
                          onClick={() => patchProject({
                            selectedEntityId: null,
                            selectedCrowdGroupId: group.id,
                            selectedLightId: null,
                          }, { history: 'skip' })}
                        >
                          <span className="block truncate">{group.name}</span>
                          <span className="block truncate text-[11px] text-white/36">
                            {group.mode === 'formation'
                              ? t('directorStage.crowd.formationSummary', {
                                  columns: group.layout.columns ?? 0,
                                  rows: group.layout.rows ?? 0,
                                  count: group.layout.count,
                                })
                              : t('directorStage.crowd.memberCount', { count: group.layout.count })}
                          </span>
                        </button>
                        <button
                          type="button"
                          className="mr-1 flex h-6 w-6 shrink-0 items-center justify-center rounded text-white/35 transition-colors hover:bg-red-400/12 hover:text-red-200"
                          onClick={(event) => {
                            event.stopPropagation();
                            deleteCrowdGroup(group.id);
                          }}
                          title={t('common.delete')}
                          aria-label={t('common.delete')}
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    );
                  }
                  const entity = item.entity;
                  return (
                    <div
                      key={entity.id}
                      className={`group flex items-center rounded-md transition-colors ${
                        project.selectedEntityId === entity.id
                          ? 'bg-emerald-300/10 text-white'
                          : 'text-white/58 hover:bg-white/[0.06]'
                      }`}
                    >
                      <button
                        type="button"
                        className="min-w-0 flex-1 px-2 py-2 text-left text-sm"
                        onClick={() => patchProject({
                          selectedEntityId: entity.id,
                          selectedCrowdGroupId: null,
                          selectedLightId: null,
                        }, { history: 'skip' })}
                      >
                        <span className="truncate">{entity.name}</span>
                      </button>
                      {entity.loadError ? <X className="mr-1 h-3.5 w-3.5 shrink-0 text-red-300" /> : null}
                      <button
                        type="button"
                        className="mr-1 flex h-6 w-6 shrink-0 items-center justify-center rounded text-white/35 transition-colors hover:bg-red-400/12 hover:text-red-200"
                        onClick={(event) => {
                          event.stopPropagation();
                          deleteEntity(entity.id);
                        }}
                        title={t('common.delete')}
                        aria-label={t('common.delete')}
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  );
                })}
                {visibleObjectItems.length === 0 ? (
                  <div className="rounded-md border border-dashed border-white/12 p-3 text-xs text-white/42">
                    {t('directorStage.objects.empty')}
                  </div>
                ) : null}
              </div>
            </section>

            {selectedCrowdGroup ? (
              <section className="space-y-3">
                <div className="rounded-md border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-white/55">
                  {selectedCrowdGroup.mode === 'formation'
                    ? t('directorStage.crowd.formationSummary', {
                        columns: selectedCrowdGroup.layout.columns ?? 0,
                        rows: selectedCrowdGroup.layout.rows ?? 0,
                        count: selectedCrowdGroup.layout.count,
                      })
                    : t('directorStage.crowd.memberCount', { count: selectedCrowdGroup.layout.count })}
                </div>
                {selectedCrowdGroup.mode === 'crowd' ? (
                  <div className="grid grid-cols-2 gap-2">
                    <label className="block space-y-1 text-xs text-white/55">
                      {t('directorStage.crowd.count')}
                      <DirectorStageNumberInput
                        min={1}
                        max={DIRECTOR_STAGE_CROWD_MAX_COUNT}
                        value={selectedCrowdGroup.layout.count}
                        onValueChange={(value) => updateCrowdGroupLayout(selectedCrowdGroup.id, { count: value })}
                        className="h-8 rounded-md border-white/10 bg-black/24 text-xs"
                      />
                    </label>
                    <label className="block space-y-1 text-xs text-white/55">
                      {t('directorStage.crowd.centerRadius')}
                      <DirectorStageNumberInput
                        min={DIRECTOR_STAGE_CROWD_CENTER_RADIUS_MIN}
                        max={DIRECTOR_STAGE_CROWD_CENTER_RADIUS_MAX}
                        step={0.5}
                        value={selectedCrowdGroup.layout.centerRadius ?? DIRECTOR_STAGE_CROWD_DEFAULT_CENTER_RADIUS}
                        onValueChange={(value) =>
                          updateCrowdGroupLayout(selectedCrowdGroup.id, {
                            centerRadius: clampDirectorStageCrowdCenterRadius(
                              value,
                              selectedCrowdGroup.layout.centerRadius ?? DIRECTOR_STAGE_CROWD_DEFAULT_CENTER_RADIUS
                            ),
                          })
                        }
                        className="h-8 rounded-md border-white/10 bg-black/24 text-xs"
                      />
                    </label>
                  </div>
                ) : null}
                {renderTransformInputs('position', 'directorStage.transform.position')}
                {renderTransformInputs('rotation', 'directorStage.transform.rotation')}
                {renderTransformInputs('scale', 'directorStage.transform.scale')}
              </section>
            ) : null}

            {selectedEntity ? (
              <section className="space-y-3">
                <div className="flex items-center gap-2">
                  <label className="inline-flex w-fit items-center gap-2 text-xs text-white/55">
                    <span>{t('directorStage.properties.color')}</span>
                    <span
                      className="relative h-6 w-6 overflow-hidden rounded-full border border-white/18 shadow-[inset_0_0_0_2px_rgba(0,0,0,0.25)]"
                      style={{ backgroundColor: selectedEntity.color }}
                    >
                      <input
                        type="color"
                        value={selectedEntity.color}
                        onChange={(event) =>
                          updateEntity(selectedEntity.id, { color: event.target.value }, { history: 'skip' })
                        }
                        onBlur={commitDeferredProjectEdit}
                        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                      />
                    </span>
                  </label>
                </div>
                {renderPlaneSurfaceControls()}
                {renderPoseControls()}
                {renderBodyControls()}
                {renderTransformInputs('position', 'directorStage.transform.position')}
                {renderTransformInputs('rotation', 'directorStage.transform.rotation')}
                {renderTransformInputs('scale', 'directorStage.transform.scale')}
              </section>
            ) : null}

            {renderCameraPathEasingEditor()}

            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-xs font-semibold uppercase text-white/45">
                  {t('directorStage.lights.title')}
                </div>
                <div className="flex gap-1">
                  <button
                    type="button"
                    className="flex h-7 w-7 items-center justify-center rounded-md bg-white/[0.06] text-white/58 hover:text-white"
                    onClick={() => addLight('directional')}
                    title={t('directorStage.lightKinds.directional')}
                  >
                    <Sun className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    className="flex h-7 w-7 items-center justify-center rounded-md bg-white/[0.06] text-white/58 hover:text-white"
                    onClick={() => addLight('point')}
                    title={t('directorStage.lightKinds.point')}
                  >
                    <Lightbulb className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
              <div className="space-y-1">
                {project.lights.map((light) => (
                  <div
                    key={light.id}
                    className={`group flex items-center rounded-md transition-colors ${
                      project.selectedLightId === light.id
                        ? 'bg-emerald-300/10 text-white'
                        : 'text-white/58 hover:bg-white/[0.06]'
                    }`}
                  >
                    <button
                      type="button"
                      className="min-w-0 flex-1 px-2 py-2 text-left text-sm"
                      onClick={() => patchProject({
                        selectedLightId: light.id,
                        selectedEntityId: null,
                        selectedCrowdGroupId: null,
                      }, { history: 'skip' })}
                    >
                      <span className="truncate">{resolveLightDisplayName(light)}</span>
                    </button>
                    {light.enabled ? <Check className="mr-1 h-3.5 w-3.5 shrink-0 text-emerald-300" /> : null}
                    <button
                      type="button"
                      className="mr-1 flex h-6 w-6 shrink-0 items-center justify-center rounded text-white/35 transition-colors hover:bg-red-400/12 hover:text-red-200"
                      onClick={(event) => {
                        event.stopPropagation();
                        deleteLight(light.id);
                      }}
                      title={t('common.delete')}
                      aria-label={t('common.delete')}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
              {selectedLight ? (
                <div className="space-y-3 rounded-md border border-white/10 bg-white/[0.03] p-3">
                  <UiInput
                    value={selectedLight.name}
                    onChange={(event) => updateLight(selectedLight.id, { name: event.target.value }, { history: 'skip' })}
                    onBlur={commitDeferredProjectEdit}
                    className="h-8 rounded-md border-white/10 bg-black/24 text-xs"
                  />
                  <label className="flex items-center justify-between gap-3 text-xs text-white/55">
                    {t('directorStage.lights.enabled')}
                    <input
                      type="checkbox"
                      checked={selectedLight.enabled}
                      onChange={(event) => updateLight(selectedLight.id, { enabled: event.target.checked })}
                    />
                  </label>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-3 text-xs text-white/55">
                      <span>{t('directorStage.lights.intensity')}</span>
                      <span className="rounded-full border border-white/10 bg-black/24 px-2 py-0.5 font-mono text-[11px] text-white/75">
                        {numericInputValue(selectedLight.intensity)}
                      </span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={lightIntensitySliderMax(selectedLight.intensity)}
                      step={0.05}
                      value={rangeInputValue(selectedLight.intensity)}
                      aria-label={t('directorStage.lights.intensity')}
                      onChange={(event) =>
                        updateLight(selectedLight.id, { intensity: Number(event.target.value) }, { history: 'skip' })
                      }
                      onPointerUp={commitDeferredProjectEdit}
                      onBlur={commitDeferredProjectEdit}
                      onKeyUp={commitDeferredProjectEdit}
                      className="h-2 w-full cursor-pointer accent-emerald-300"
                    />
                  </div>
                  {selectedLight.kind !== 'ambient' ? (
                    <div className="space-y-2">
                      <div className="text-xs font-semibold uppercase text-white/45">
                        {t('directorStage.transform.position')}
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        {(['x', 'y', 'z'] as const).map((axis) => (
                          <label key={axis} className="space-y-1 text-[11px] uppercase text-white/42">
                            {axis}
                            <DirectorStageNumberInput
                              step={0.1}
                              value={selectedLight.position[axis]}
                              formatValue={numericInputValue}
                              onValueChange={(value) => updateSelectedLightPosition(axis, value)}
                              onBlur={commitDeferredProjectEdit}
                              className="h-8 rounded-md border-white/10 bg-black/24 text-xs"
                            />
                          </label>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  {selectedLight.kind === 'spot' ? (
                    <>
                      <div className="space-y-2">
                        <div className="text-xs font-semibold uppercase text-white/45">
                          {t('directorStage.lights.target')}
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                          {(['x', 'y', 'z'] as const).map((axis) => (
                            <label key={axis} className="space-y-1 text-[11px] uppercase text-white/42">
                              {axis}
                              <DirectorStageNumberInput
                                step={0.1}
                                value={selectedLight.target[axis]}
                                formatValue={numericInputValue}
                                onValueChange={(value) => updateSelectedLightTarget(axis, value)}
                                onBlur={commitDeferredProjectEdit}
                                className="h-8 rounded-md border-white/10 bg-black/24 text-xs"
                              />
                            </label>
                          ))}
                        </div>
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <label className="space-y-1 text-[11px] text-white/42">
                          {t('directorStage.lights.distance')}
                          <DirectorStageNumberInput
                            min={0}
                            step={0.5}
                            value={selectedLight.distance ?? 0}
                            formatValue={numericInputValue}
                            onValueChange={(value) =>
                              updateLight(selectedLight.id, { distance: Math.max(0, value) }, { history: 'skip' })
                            }
                            onBlur={commitDeferredProjectEdit}
                            className="h-8 rounded-md border-white/10 bg-black/24 text-xs"
                          />
                        </label>
                        <label className="space-y-1 text-[11px] text-white/42">
                          {t('directorStage.lights.angle')}
                          <DirectorStageNumberInput
                            min={0.05}
                            max={Math.PI / 2}
                            step={0.05}
                            value={selectedLight.angle ?? Math.PI / 5}
                            formatValue={numericInputValue}
                            onValueChange={(value) =>
                              updateLight(selectedLight.id, {
                                angle: Math.max(0.05, Math.min(Math.PI / 2, value)),
                              }, { history: 'skip' })
                            }
                            onBlur={commitDeferredProjectEdit}
                            className="h-8 rounded-md border-white/10 bg-black/24 text-xs"
                          />
                        </label>
                        <label className="space-y-1 text-[11px] text-white/42">
                          {t('directorStage.lights.penumbra')}
                          <DirectorStageNumberInput
                            min={0}
                            max={1}
                            step={0.05}
                            value={selectedLight.penumbra ?? 0.35}
                            formatValue={numericInputValue}
                            onValueChange={(value) =>
                              updateLight(selectedLight.id, {
                                penumbra: Math.max(0, Math.min(1, value)),
                              }, { history: 'skip' })
                            }
                            onBlur={commitDeferredProjectEdit}
                            className="h-8 rounded-md border-white/10 bg-black/24 text-xs"
                          />
                        </label>
                      </div>
                    </>
                  ) : null}
                </div>
              ) : null}
            </section>
          </div>
        </aside>

        {showExpandedCameraPathTimeline ? renderCameraPathTimeline() : null}

        <footer className={`col-start-2 flex min-w-0 items-center gap-3 border-t border-white/10 bg-[#17191d] px-3 ${showExpandedCameraPathTimeline ? 'row-start-3' : 'row-start-2'}`}>
          <UiButton
            type="button"
            variant={project.isFreeView ? 'primary' : 'muted'}
            size="sm"
            className="shrink-0 gap-1.5 !text-white [&_svg]:!text-white"
            onClick={enterFreeView}
          >
            <Eye className="h-3.5 w-3.5" />
            {t('directorStage.camera.freeView')}
          </UiButton>
          <UiButton
            type="button"
            variant="muted"
            size="sm"
            className="shrink-0 gap-1.5 !border !border-white/10 !bg-white/[0.06] !text-white hover:!bg-white/[0.1] hover:!text-white [&_svg]:!text-white"
            onClick={captureCameraShot}
          >
            <Camera className="h-3.5 w-3.5" />
            {t('directorStage.camera.addShot')}
          </UiButton>
          <div className="ui-scrollbar flex min-w-0 flex-1 gap-2 overflow-x-auto py-3">
            {project.cameraShots.map((shot) => {
              const isActiveShot = !project.isFreeView && project.activeCameraShotId === shot.id;
              const canDeleteShot = project.cameraShots.length > 1;
              const isLensPanelOpen = cameraLensPanel?.shotId === shot.id;
              const hasCameraPath = Boolean(shot.cameraPath);
              const focalLength = cameraShotFocalLengthValue(shot);
              return (
                <div
                  key={shot.id}
                  className={`group flex min-w-[220px] items-start rounded-md border transition-colors ${
                    isActiveShot
                      ? 'border-emerald-300/50 bg-emerald-300/10 text-white'
                      : 'border-white/10 bg-white/[0.035] text-white/58 hover:text-white'
                  }`}
                >
                  <button
                    type="button"
                    className="min-w-0 flex-1 px-3 py-2 text-left"
                    onClick={() => selectCameraShot(shot)}
                  >
                    <div className="truncate text-sm font-medium">{resolveCameraShotDisplayName(shot)}</div>
                    <div className="mt-1 text-[11px] text-white/42">
                      {t('directorStage.camera.focalWithFovValue', {
                        focal: focalLength,
                        fov: Math.round(shot.fov),
                      })}
                    </div>
                    <div className="mt-0.5 truncate text-[10px] text-white/32">
                      {shot.cameraPath
                        ? t('directorStage.camera.pathSummary', {
                            seconds: cameraPathDurationSeconds(shot.cameraPath),
                          })
                        : cameraShotPositionSummary(shot)}
                    </div>
                  </button>
                  <button
                    type="button"
                    disabled={!hasCameraPath || Boolean(cameraPathRecording) || Boolean(exportingCameraPathShotId)}
                    className="mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded text-white/42 transition-colors hover:bg-red-400/12 hover:text-red-200 disabled:cursor-not-allowed disabled:opacity-35"
                    onClick={(event) => {
                      event.stopPropagation();
                      clearCameraPath(shot.id);
                    }}
                    title={t('directorStage.camera.clearPath')}
                    aria-label={t('directorStage.camera.clearPath')}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    className={`mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded text-white/42 transition-colors ${
                      isLensPanelOpen
                        ? 'bg-emerald-300/14 text-emerald-100'
                        : 'hover:bg-white/[0.08] hover:text-white'
                    }`}
                    onClick={(event) => openCameraLensPanel(shot.id, event)}
                    title={t('directorStage.camera.lensSettings')}
                    aria-label={t('directorStage.camera.lensSettings')}
                    aria-pressed={isLensPanelOpen}
                  >
                    <Aperture className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    disabled={!canDeleteShot}
                    className={`m-1 flex h-6 w-6 shrink-0 items-center justify-center rounded text-white/42 transition-colors ${
                      canDeleteShot
                        ? 'hover:bg-red-400/12 hover:text-red-200'
                        : 'cursor-not-allowed opacity-0'
                    }`}
                    onClick={(event) => {
                      event.stopPropagation();
                      deleteCameraShot(shot.id);
                    }}
                    title={t('directorStage.camera.deleteShot')}
                    aria-label={t('directorStage.camera.deleteShot')}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        </footer>
      </main>
      {cameraLensPanel && cameraLensPanelShot && cameraLensPanelFocalLength !== null ? (
        <div
          className="fixed z-[100080] w-[260px] rounded-md border border-white/12 bg-[#171a1f]/96 p-3 shadow-2xl shadow-black/40 backdrop-blur"
          style={{
            left: cameraLensPanel.left,
            top: cameraLensPanel.top,
          }}
          role="dialog"
          aria-label={t('directorStage.camera.lensSettings')}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-xs font-semibold uppercase text-white/45">
                {t('directorStage.camera.lensSettings')}
              </div>
              <div className="mt-1 truncate text-sm font-medium text-white">
                {resolveCameraShotDisplayName(cameraLensPanelShot)}
              </div>
            </div>
            <button
              type="button"
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-white/42 transition-colors hover:bg-white/[0.08] hover:text-white"
              onClick={() => setCameraLensPanel(null)}
              title={t('common.close')}
              aria-label={t('common.close')}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="mt-3 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs text-white/55">{t('directorStage.camera.focalLength')}</span>
              <span className="rounded-full border border-white/10 bg-black/24 px-2 py-0.5 font-mono text-[11px] text-white/78">
                {t('directorStage.camera.focalValue', { value: cameraLensPanelFocalLength })}
              </span>
            </div>
            <input
              type="range"
              min={DIRECTOR_STAGE_FOCAL_LENGTH_MIN}
              max={DIRECTOR_STAGE_FOCAL_LENGTH_MAX}
              step={1}
              value={cameraLensPanelFocalLength}
              aria-label={t('directorStage.camera.focalLength')}
              onChange={(event) =>
                updateCameraShotFocalLength(
                  cameraLensPanelShot.id,
                  Number(event.target.value),
                  { history: 'skip' }
                )
              }
              onPointerUp={commitDeferredProjectEdit}
              onBlur={commitDeferredProjectEdit}
              onKeyUp={commitDeferredProjectEdit}
              className="h-2 w-full cursor-pointer accent-emerald-300"
            />
            <div className="grid grid-cols-[88px_minmax(0,1fr)] items-center gap-2">
              <DirectorStageNumberInput
                min={DIRECTOR_STAGE_FOCAL_LENGTH_MIN}
                max={DIRECTOR_STAGE_FOCAL_LENGTH_MAX}
                step={1}
                value={cameraLensPanelFocalLength}
                onValueChange={(value) =>
                  updateCameraShotFocalLength(cameraLensPanelShot.id, value, { history: 'skip' })
                }
                onBlur={commitDeferredProjectEdit}
                className="h-8 rounded-md border-white/10 bg-black/24 text-xs"
              />
              <div className="truncate text-right text-[11px] text-white/42">
                {t('directorStage.camera.fovValue', { value: Math.round(cameraLensPanelShot.fov) })}
              </div>
            </div>
            <div className="grid grid-cols-6 gap-1">
              {DIRECTOR_STAGE_FOCAL_LENGTH_PRESETS.map((preset) => {
                const isSelected = cameraLensPanelFocalLength === preset;
                return (
                  <button
                    key={preset}
                    type="button"
                    className={`h-7 rounded-md border text-[11px] transition-colors ${
                      isSelected
                        ? 'border-emerald-300/50 bg-emerald-300/12 text-emerald-100'
                        : 'border-white/10 bg-black/20 text-white/52 hover:bg-white/[0.07] hover:text-white'
                    }`}
                    onClick={() => updateCameraShotFocalLength(cameraLensPanelShot.id, preset)}
                  >
                    {preset}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}
      <CrowdModeDialog
        asset={crowdDialogAsset}
        isOpen={Boolean(crowdDialogAsset)}
        existingCrowdCount={existingCrowdGroup?.layout.count ?? null}
        existingCrowdCenterRadius={existingCrowdGroup?.layout.centerRadius ?? null}
        onClose={() => setCrowdDialogAsset(null)}
        onSubmit={createCrowdGroupFromDialog}
      />
    </div>
  );
}
