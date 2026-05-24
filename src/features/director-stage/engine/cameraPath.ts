import * as THREE from 'three';

import {
  createStageVector3,
  DIRECTOR_STAGE_CAMERA_PATH_MAX_DURATION_MS,
  DIRECTOR_STAGE_CAMERA_PATH_SAMPLE_RATE,
  type DirectorStageCameraKeyframe,
  type DirectorStageCameraPath,
  type DirectorStageSnapshotAspectRatio,
  type DirectorStageVector3,
} from '../domain/types';

export const DIRECTOR_STAGE_RECORDING_MIME_TYPE = 'video/webm;codecs=vp9';
export const DIRECTOR_STAGE_RECORDING_FALLBACK_MIME_TYPE = 'video/webm';
export const DIRECTOR_STAGE_EXPORT_SHORT_EDGE = 720;

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

export function readCameraPathKeyframe(
  camera: THREE.PerspectiveCamera,
  target: THREE.Vector3,
  timeMs: number
): DirectorStageCameraKeyframe {
  return {
    timeMs: Math.max(0, Math.min(DIRECTOR_STAGE_CAMERA_PATH_MAX_DURATION_MS, timeMs)),
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
    Math.min(DIRECTOR_STAGE_CAMERA_PATH_MAX_DURATION_MS, durationMs)
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

  return {
    durationMs: normalizedDuration,
    sampleRate: DIRECTOR_STAGE_CAMERA_PATH_SAMPLE_RATE,
    keyframes: cappedKeyframes,
  };
}

export function sampleDirectorStageCameraPath(
  cameraPath: DirectorStageCameraPath,
  timeMs: number
): DirectorStageCameraKeyframe {
  const keyframes = cameraPath.keyframes;
  const fallback = keyframes[0];
  if (!fallback || keyframes.length === 1) {
    return fallback ?? {
      timeMs: 0,
      position: createStageVector3(4, 2.4, 5),
      target: createStageVector3(0, 1.2, 0),
      fov: 42,
    };
  }

  const clampedTime = Math.max(0, Math.min(cameraPath.durationMs, timeMs));
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
    const amount = Math.max(0, Math.min(1, (clampedTime - left.timeMs) / span));
    return {
      timeMs: clampedTime,
      position: lerpVector3(left.position, right.position, amount),
      target: lerpVector3(left.target, right.target, amount),
      fov: lerpNumber(left.fov, right.fov, amount),
    };
  }

  return keyframes[keyframes.length - 1];
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

