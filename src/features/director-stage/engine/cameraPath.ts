import * as THREE from 'three';
import BezierEasing from 'bezier-easing';

import {
  createStageVector3,
  DIRECTOR_STAGE_CAMERA_PATH_CLIP_MAX_DURATION_MS,
  DIRECTOR_STAGE_CAMERA_PATH_MAX_DURATION_MS,
  DIRECTOR_STAGE_CAMERA_PATH_SAMPLE_RATE,
  type DirectorStageCameraPathEasingCurve,
  type DirectorStageCameraPathEasingPreset,
  type DirectorStageCameraPathSegmentEasing,
  type DirectorStageCameraKeyframe,
  type DirectorStageCameraPath,
  type DirectorStageSnapshotAspectRatio,
  type DirectorStageVector3,
} from '../domain/types';

export const DIRECTOR_STAGE_RECORDING_MIME_TYPE = 'video/webm;codecs=vp9';
export const DIRECTOR_STAGE_RECORDING_FALLBACK_MIME_TYPE = 'video/webm';
export const DIRECTOR_STAGE_EXPORT_SHORT_EDGE = 720;
export const DIRECTOR_STAGE_MIN_MOTION_KEYFRAMES = 2;
export const DIRECTOR_STAGE_CAMERA_PATH_TIMELINE_MAX_SECONDS =
  DIRECTOR_STAGE_CAMERA_PATH_MAX_DURATION_MS / 1000;
export const DIRECTOR_STAGE_CAMERA_PATH_MAX_STORED_DURATION_MS = DIRECTOR_STAGE_CAMERA_PATH_MAX_DURATION_MS;

export const DIRECTOR_STAGE_CAMERA_PATH_EASING_PRESETS: Record<
  DirectorStageCameraPathEasingPreset,
  DirectorStageCameraPathEasingCurve
> = {
  linear: [0, 0, 1, 1],
  easeIn: [0.42, 0, 1, 1],
  easeOut: [0, 0, 0.58, 1],
  easeInOut: [0.42, 0, 0.58, 1],
  accelerate: [0.3, 0, 0.9, 0.45],
  decelerate: [0.1, 0.55, 0.7, 1],
  custom: [0.42, 0, 0.58, 1],
};

export const DIRECTOR_STAGE_CAMERA_PATH_DEFAULT_EASING: DirectorStageCameraPathSegmentEasing = {
  preset: 'linear',
  curve: DIRECTOR_STAGE_CAMERA_PATH_EASING_PRESETS.linear,
  speed: 1,
};

function lerpNumber(left: number, right: number, amount: number): number {
  return left + (right - left) * amount;
}

function lerpVector3(
  left: DirectorStageVector3,
  right: DirectorStageVector3,
  amount: number
): DirectorStageVector3 {
  return createStageVector3(
    lerpNumber(left.x, right.x, amount),
    lerpNumber(left.y, right.y, amount),
    lerpNumber(left.z, right.z, amount)
  );
}

function vectorToThree(value: DirectorStageVector3): THREE.Vector3 {
  return new THREE.Vector3(value.x, value.y, value.z);
}

function threeToStageVector(value: THREE.Vector3): DirectorStageVector3 {
  return createStageVector3(value.x, value.y, value.z);
}

function sampleLocalCurvePoint(
  points: THREE.Vector3[],
  index: number,
  amount: number
): THREE.Vector3 {
  const leftIndex = Math.max(0, index - 1);
  const rightIndex = Math.min(points.length - 1, index + 2);
  const segmentPoints = points.slice(leftIndex, rightIndex + 1);
  if (segmentPoints.length < 2) {
    return points[index]?.clone() ?? new THREE.Vector3();
  }
  const curve = new THREE.CatmullRomCurve3(segmentPoints, false, 'centripetal');
  const localSegmentIndex = index - leftIndex;
  const localStart = localSegmentIndex / (segmentPoints.length - 1);
  const localEnd = (localSegmentIndex + 1) / (segmentPoints.length - 1);
  return curve.getPoint(lerpNumber(localStart, localEnd, amount));
}

export function easeInOutCubic(value: number): number {
  const amount = Math.max(0, Math.min(1, value));
  return amount < 0.5
    ? 4 * amount * amount * amount
    : 1 - Math.pow(-2 * amount + 2, 3) / 2;
}

function clampEasingCurve(curve: DirectorStageCameraPathEasingCurve): DirectorStageCameraPathEasingCurve {
  return [
    Math.max(0, Math.min(1, curve[0])),
    Math.max(-2, Math.min(2, curve[1])),
    Math.max(0, Math.min(1, curve[2])),
    Math.max(-2, Math.min(2, curve[3])),
  ];
}

export function createDirectorStageCameraPathSegmentKey(
  left: DirectorStageCameraKeyframe,
  right?: DirectorStageCameraKeyframe
): string {
  if (left.id) {
    return left.id;
  }
  return right
    ? `${Math.round(left.timeMs)}:${Math.round(right.timeMs)}`
    : `${Math.round(left.timeMs)}`;
}

export function resolveDirectorStageCameraPathSegmentEasing(
  cameraPath: DirectorStageCameraPath,
  left: DirectorStageCameraKeyframe,
  right: DirectorStageCameraKeyframe
): DirectorStageCameraPathSegmentEasing {
  const segmentKey = createDirectorStageCameraPathSegmentKey(left, right);
  const easing = cameraPath.segmentEasings?.[segmentKey];
  if (!easing) {
    return DIRECTOR_STAGE_CAMERA_PATH_DEFAULT_EASING;
  }

  const presetCurve = DIRECTOR_STAGE_CAMERA_PATH_EASING_PRESETS[easing.preset]
    ?? DIRECTOR_STAGE_CAMERA_PATH_DEFAULT_EASING.curve;
  return {
    preset: easing.preset in DIRECTOR_STAGE_CAMERA_PATH_EASING_PRESETS
      ? easing.preset
      : DIRECTOR_STAGE_CAMERA_PATH_DEFAULT_EASING.preset,
    curve: clampEasingCurve(easing.curve ?? presetCurve),
    speed: Math.max(0.1, Math.min(5, easing.speed ?? 1)),
  };
}

function createCameraPathKeyframeId(index: number, timeMs: number): string {
  return `motion-${Date.now().toString(36)}-${index}-${Math.round(timeMs)}`;
}

function withCameraPathKeyframeIds(
  keyframes: DirectorStageCameraKeyframe[]
): DirectorStageCameraKeyframe[] {
  return keyframes.map((keyframe, index) => ({
    ...keyframe,
    id: keyframe.id ?? createCameraPathKeyframeId(index, keyframe.timeMs),
  }));
}

export function normalizeDirectorStageCameraPathSegmentEasings(
  motionKeyframes: DirectorStageCameraKeyframe[],
  segmentEasings?: Record<string, DirectorStageCameraPathSegmentEasing>
): Record<string, DirectorStageCameraPathSegmentEasing> | undefined {
  if (motionKeyframes.length < DIRECTOR_STAGE_MIN_MOTION_KEYFRAMES) {
    return undefined;
  }

  const result: Record<string, DirectorStageCameraPathSegmentEasing> = {};
  motionKeyframes.slice(0, -1).forEach((left, index) => {
    const right = motionKeyframes[index + 1];
    if (!right) {
      return;
    }
    const key = createDirectorStageCameraPathSegmentKey(left, right);
    const legacyKey = `${Math.round(left.timeMs)}:${Math.round(right.timeMs)}`;
    result[key] = segmentEasings?.[key]
      ?? segmentEasings?.[legacyKey]
      ?? DIRECTOR_STAGE_CAMERA_PATH_DEFAULT_EASING;
  });

  return Object.keys(result).length > 0 ? result : undefined;
}

function sampleCameraPathEasing(
  easing: DirectorStageCameraPathSegmentEasing,
  amount: number
): number {
  const curve = clampEasingCurve(easing.curve);
  try {
    return Math.max(0, Math.min(1, BezierEasing(...curve)(amount)));
  } catch {
    return easeInOutCubic(amount);
  }
}

export function readCameraPathKeyframe(
  camera: THREE.PerspectiveCamera,
  target: THREE.Vector3,
  timeMs: number
): DirectorStageCameraKeyframe {
  return {
    timeMs: Math.max(0, Math.min(DIRECTOR_STAGE_CAMERA_PATH_MAX_STORED_DURATION_MS, timeMs)),
    position: createStageVector3(camera.position.x, camera.position.y, camera.position.z),
    target: createStageVector3(target.x, target.y, target.z),
    fov: camera.fov,
  };
}

export function createDirectorStageCameraPath(
  keyframes: DirectorStageCameraKeyframe[],
  durationMs: number
): DirectorStageCameraPath | null {
  const normalizedKeyframes = keyframes
    .filter((keyframe) => Number.isFinite(keyframe.timeMs))
    .sort((left, right) => left.timeMs - right.timeMs);
  if (normalizedKeyframes.length < 2) {
    return null;
  }

  const normalizedDuration = Math.max(
    1,
    Math.min(DIRECTOR_STAGE_CAMERA_PATH_MAX_STORED_DURATION_MS, durationMs)
  );
  const first = normalizedKeyframes[0];
  const last = normalizedKeyframes[normalizedKeyframes.length - 1];
  const cappedKeyframes = normalizedKeyframes.map((keyframe) => ({
    ...keyframe,
    timeMs: Math.max(0, Math.min(normalizedDuration, keyframe.timeMs)),
  }));

  if (first.timeMs > 0) {
    cappedKeyframes.unshift({ ...first, timeMs: 0 });
  }
  if (last.timeMs < normalizedDuration) {
    cappedKeyframes.push({ ...last, timeMs: normalizedDuration });
  }

  const draftKeyframes = cappedKeyframes;
  const motionKeyframes = withCameraPathKeyframeIds(
    extractMotionKeyframesFromDraft(draftKeyframes, normalizedDuration)
  );

  return {
    mode: 'keyframe',
    durationMs: normalizedDuration,
    clipStartMs: 0,
    clipDurationMs: Math.min(DIRECTOR_STAGE_CAMERA_PATH_CLIP_MAX_DURATION_MS, normalizedDuration),
    sampleRate: DIRECTOR_STAGE_CAMERA_PATH_SAMPLE_RATE,
    smoothingPreset: 'easeInOutCubic',
    draftKeyframes,
    motionKeyframes,
    segmentEasings: normalizeDirectorStageCameraPathSegmentEasings(motionKeyframes),
  };
}

export function extractMotionKeyframesFromDraft(
  draftKeyframes: DirectorStageCameraKeyframe[],
  durationMs: number
): DirectorStageCameraKeyframe[] {
  const normalizedKeyframes = draftKeyframes
    .filter((keyframe) => Number.isFinite(keyframe.timeMs))
    .sort((left, right) => left.timeMs - right.timeMs);

  if (normalizedKeyframes.length === 0) {
    return [];
  }

  const totalDurationMs = Math.max(1, Math.min(DIRECTOR_STAGE_CAMERA_PATH_MAX_STORED_DURATION_MS, durationMs));
  if (normalizedKeyframes.length === 1) {
    return [{
      ...normalizedKeyframes[0],
      sourceTimeMs: normalizedKeyframes[0].sourceTimeMs ?? normalizedKeyframes[0].timeMs,
      timeMs: 0,
    }];
  }

  const firstSourceKeyframe = normalizedKeyframes[0];
  const lastSourceKeyframe = normalizedKeyframes[normalizedKeyframes.length - 1];
  return [
    {
      ...firstSourceKeyframe,
      sourceTimeMs: firstSourceKeyframe.sourceTimeMs ?? firstSourceKeyframe.timeMs,
      timeMs: 0,
    },
    {
      ...lastSourceKeyframe,
      sourceTimeMs: lastSourceKeyframe.sourceTimeMs ?? lastSourceKeyframe.timeMs,
      timeMs: totalDurationMs,
    },
  ];
}

export function sampleDirectorStageKeyframes(
  keyframes: DirectorStageCameraKeyframe[],
  durationMs: number,
  timeMs: number,
  cameraPath?: DirectorStageCameraPath
): DirectorStageCameraKeyframe {
  const fallback = keyframes[0];
  if (!fallback || keyframes.length === 1) {
    return fallback ?? {
      timeMs: 0,
      position: createStageVector3(4, 2.4, 5),
      target: createStageVector3(0, 1.2, 0),
      fov: 42,
    };
  }

  const clampedTime = Math.max(0, Math.min(durationMs, timeMs));
  if (clampedTime <= keyframes[0].timeMs) {
    return keyframes[0];
  }

  for (let index = 1; index < keyframes.length; index += 1) {
    const right = keyframes[index];
    if (clampedTime > right.timeMs) {
      continue;
    }
    const left = keyframes[index - 1];
    const span = Math.max(1, right.timeMs - left.timeMs);
    const rawAmount = (clampedTime - left.timeMs) / span;
    const easing = cameraPath
      ? resolveDirectorStageCameraPathSegmentEasing(cameraPath, left, right)
      : DIRECTOR_STAGE_CAMERA_PATH_DEFAULT_EASING;
    const amount = sampleCameraPathEasing(easing, rawAmount);
    if (keyframes.length >= 3) {
      const curvePoints = keyframes.map((keyframe) => vectorToThree(keyframe.position));
      const targetCurvePoints = keyframes.map((keyframe) => vectorToThree(keyframe.target));
      const position = sampleLocalCurvePoint(curvePoints, index - 1, amount);
      const target = sampleLocalCurvePoint(targetCurvePoints, index - 1, amount);
      return {
        timeMs: clampedTime,
        position: threeToStageVector(position),
        target: threeToStageVector(target),
        fov: lerpNumber(left.fov, right.fov, amount),
      };
    }
    return {
      timeMs: clampedTime,
      position: lerpVector3(left.position, right.position, amount),
      target: lerpVector3(left.target, right.target, amount),
      fov: lerpNumber(left.fov, right.fov, amount),
    };
  }

  return keyframes[keyframes.length - 1];
}

function cameraPathDraftSegmentDistance(
  left: DirectorStageCameraKeyframe,
  right: DirectorStageCameraKeyframe
): number {
  const positionDistance = vectorToThree(left.position).distanceTo(vectorToThree(right.position));
  const targetDistance = vectorToThree(left.target).distanceTo(vectorToThree(right.target));
  const lensDistance = Math.abs(left.fov - right.fov);
  return positionDistance + targetDistance * 0.65 + lensDistance * 0.03;
}

function sampleDirectorStageDraftKeyframes(
  keyframes: DirectorStageCameraKeyframe[],
  timeMs: number
): DirectorStageCameraKeyframe {
  const sortedKeyframes = keyframes
    .filter((keyframe) => Number.isFinite(keyframe.timeMs))
    .sort((left, right) => left.timeMs - right.timeMs);
  const fallback = sortedKeyframes[0];
  if (!fallback || sortedKeyframes.length === 1) {
    return fallback ?? {
      timeMs: 0,
      position: createStageVector3(4, 2.4, 5),
      target: createStageVector3(0, 1.2, 0),
      fov: 42,
    };
  }

  const firstSourceTimeMs = sortedKeyframes[0].timeMs;
  const lastSourceTimeMs = sortedKeyframes[sortedKeyframes.length - 1].timeMs;
  const sourceSpanMs = Math.max(1, lastSourceTimeMs - firstSourceTimeMs);
  const routeProgress = Math.max(0, Math.min(1, (timeMs - firstSourceTimeMs) / sourceSpanMs));
  const segmentDistances = sortedKeyframes.slice(0, -1).map((keyframe, index) =>
    cameraPathDraftSegmentDistance(keyframe, sortedKeyframes[index + 1])
  );
  const totalDistance = segmentDistances.reduce((total, distance) => total + distance, 0);
  if (totalDistance <= 0.0001) {
    return sampleDirectorStageKeyframes(sortedKeyframes, lastSourceTimeMs, timeMs);
  }

  const targetDistance = totalDistance * routeProgress;
  let accumulatedDistance = 0;
  for (let index = 0; index < segmentDistances.length; index += 1) {
    const segmentDistance = segmentDistances[index];
    if (targetDistance > accumulatedDistance + segmentDistance && index < segmentDistances.length - 1) {
      accumulatedDistance += segmentDistance;
      continue;
    }
    const left = sortedKeyframes[index];
    const right = sortedKeyframes[index + 1];
    const amount = segmentDistance <= 0.0001
      ? 0
      : Math.max(0, Math.min(1, (targetDistance - accumulatedDistance) / segmentDistance));
    return {
      timeMs,
      position: lerpVector3(left.position, right.position, amount),
      target: lerpVector3(left.target, right.target, amount),
      fov: lerpNumber(left.fov, right.fov, amount),
    };
  }

  return sortedKeyframes[sortedKeyframes.length - 1];
}

export function sampleDirectorStageCameraPathSourceTime(
  cameraPath: DirectorStageCameraPath,
  timeMs: number
): number {
  const keyframes = getDirectorStageMotionKeyframes(cameraPath);
  const fallback = keyframes[0];
  if (!fallback || keyframes.length === 1) {
    return fallback?.sourceTimeMs ?? fallback?.timeMs ?? 0;
  }

  const clampedTime = Math.max(0, Math.min(cameraPath.durationMs, timeMs));
  if (clampedTime <= keyframes[0].timeMs) {
    return keyframes[0].sourceTimeMs ?? 0;
  }

  for (let index = 1; index < keyframes.length; index += 1) {
    const right = keyframes[index];
    if (clampedTime > right.timeMs) {
      continue;
    }
    const left = keyframes[index - 1];
    const span = Math.max(1, right.timeMs - left.timeMs);
    const rawAmount = (clampedTime - left.timeMs) / span;
    const easing = resolveDirectorStageCameraPathSegmentEasing(cameraPath, left, right);
    const amount = sampleCameraPathEasing(easing, rawAmount);
    return lerpNumber(
      left.sourceTimeMs ?? left.timeMs,
      right.sourceTimeMs ?? right.timeMs,
      amount
    );
  }

  const last = keyframes[keyframes.length - 1];
  return last.sourceTimeMs ?? last.timeMs;
}

export function getDirectorStageMotionKeyframes(
  cameraPath: DirectorStageCameraPath
): DirectorStageCameraKeyframe[] {
  if (cameraPath.motionKeyframes.length >= DIRECTOR_STAGE_MIN_MOTION_KEYFRAMES) {
    return cameraPath.motionKeyframes;
  }
  return withCameraPathKeyframeIds(
    extractMotionKeyframesFromDraft(cameraPath.draftKeyframes, cameraPath.durationMs)
  );
}

export function sampleDirectorStageCameraPath(
  cameraPath: DirectorStageCameraPath,
  timeMs: number
): DirectorStageCameraKeyframe {
  if (cameraPath.draftKeyframes.length >= DIRECTOR_STAGE_MIN_MOTION_KEYFRAMES) {
    const sourceTimeMs = sampleDirectorStageCameraPathSourceTime(cameraPath, timeMs);
    return {
      ...sampleDirectorStageDraftKeyframes(cameraPath.draftKeyframes, sourceTimeMs),
      timeMs,
      sourceTimeMs,
    };
  }
  return sampleDirectorStageKeyframes(
    getDirectorStageMotionKeyframes(cameraPath),
    cameraPath.durationMs,
    timeMs,
    cameraPath
  );
}

export function sampleDirectorStageCameraPathPoints(
  cameraPath: DirectorStageCameraPath,
  sampleCount = 80
): DirectorStageCameraKeyframe[] {
  const count = Math.max(2, sampleCount);
  return Array.from({ length: count }, (_, index) => {
    const amount = count <= 1 ? 0 : index / (count - 1);
    return sampleDirectorStageCameraPath(cameraPath, cameraPath.durationMs * amount);
  });
}

export function sampleDirectorStageCameraPathFrame(
  cameraPath: DirectorStageCameraPath,
  frameIndex: number,
  fps = DIRECTOR_STAGE_CAMERA_PATH_SAMPLE_RATE
): DirectorStageCameraKeyframe {
  return sampleDirectorStageCameraPath(cameraPath, frameIndex / fps * 1000);
}

export function sampleDirectorStageCameraPathClipFrame(
  cameraPath: DirectorStageCameraPath,
  frameIndex: number,
  fps = DIRECTOR_STAGE_CAMERA_PATH_SAMPLE_RATE
): DirectorStageCameraKeyframe {
  return sampleDirectorStageCameraPath(
    cameraPath,
    cameraPath.clipStartMs + frameIndex / fps * 1000
  );
}

export function applyCameraPathKeyframe(
  camera: THREE.PerspectiveCamera,
  target: THREE.Vector3,
  keyframe: DirectorStageCameraKeyframe
): void {
  camera.position.set(keyframe.position.x, keyframe.position.y, keyframe.position.z);
  target.set(keyframe.target.x, keyframe.target.y, keyframe.target.z);
  camera.fov = keyframe.fov;
  camera.updateProjectionMatrix();
  camera.lookAt(target);
}

export function resolveDirectorStageRecordingMimeType(): string {
  if (typeof MediaRecorder === 'undefined') {
    return DIRECTOR_STAGE_RECORDING_FALLBACK_MIME_TYPE;
  }
  if (MediaRecorder.isTypeSupported(DIRECTOR_STAGE_RECORDING_MIME_TYPE)) {
    return DIRECTOR_STAGE_RECORDING_MIME_TYPE;
  }
  return DIRECTOR_STAGE_RECORDING_FALLBACK_MIME_TYPE;
}

export function calculateDirectorStageRecordingSize(
  aspectRatio: DirectorStageSnapshotAspectRatio
): { width: number; height: number; aspectRatioText: string } {
  const [rawWidth, rawHeight] = aspectRatio.split(':').map((part) => Number(part));
  const ratio = rawWidth > 0 && rawHeight > 0 ? rawWidth / rawHeight : 16 / 9;
  if (ratio >= 1) {
    const width = Math.max(1, Math.round(DIRECTOR_STAGE_EXPORT_SHORT_EDGE * ratio));
    return {
      width,
      height: DIRECTOR_STAGE_EXPORT_SHORT_EDGE,
      aspectRatioText: aspectRatio,
    };
  }
  const height = Math.max(1, Math.round(DIRECTOR_STAGE_EXPORT_SHORT_EDGE / ratio));
  return {
    width: DIRECTOR_STAGE_EXPORT_SHORT_EDGE,
    height,
    aspectRatioText: aspectRatio,
  };
}
