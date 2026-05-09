import * as THREE from 'three';

import type { DirectorStageCameraShot } from '../domain/types';
import {
  fovToFocalLength,
  normalizeCameraShotLens,
} from '../domain/cameraLens';

export {
  clampDirectorStageFocalLength,
  DIRECTOR_STAGE_DEFAULT_FOCAL_LENGTH,
  DIRECTOR_STAGE_FOCAL_LENGTH_MAX,
  DIRECTOR_STAGE_FOCAL_LENGTH_MIN,
  DIRECTOR_STAGE_FOCAL_LENGTH_PRESETS,
  focalLengthToFov,
  fovToFocalLength,
  normalizeCameraShotLens,
} from '../domain/cameraLens';

export function applyCameraShot(
  camera: THREE.PerspectiveCamera,
  target: THREE.Vector3,
  shot: DirectorStageCameraShot
): void {
  const lens = normalizeCameraShotLens(shot);
  camera.position.set(shot.position.x, shot.position.y, shot.position.z);
  camera.fov = lens.fov;
  camera.updateProjectionMatrix();
  target.set(shot.target.x, shot.target.y, shot.target.z);
  camera.lookAt(target);
}

export function readCameraShot(
  camera: THREE.PerspectiveCamera,
  target: THREE.Vector3,
  shotId: string,
  name: string
): DirectorStageCameraShot {
  const now = Date.now();
  const fov = camera.fov;
  return {
    id: shotId,
    name,
    position: {
      x: camera.position.x,
      y: camera.position.y,
      z: camera.position.z,
    },
    target: {
      x: target.x,
      y: target.y,
      z: target.z,
    },
    fov,
    focalLengthMm: fovToFocalLength(fov),
    createdAt: now,
    updatedAt: now,
  };
}

export function frameObjectInCamera(
  camera: THREE.PerspectiveCamera,
  target: THREE.Vector3,
  object: THREE.Object3D
): boolean {
  object.updateWorldMatrix(true, true);
  const box = new THREE.Box3().setFromObject(object);
  if (box.isEmpty()) {
    return false;
  }

  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const maxDimension = Math.max(size.x, size.y, size.z);
  if (!Number.isFinite(maxDimension) || maxDimension <= 0) {
    return false;
  }

  const verticalFov = THREE.MathUtils.degToRad(camera.fov);
  const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * Math.max(camera.aspect, 0.1));
  const heightDistance = size.y / (2 * Math.tan(verticalFov / 2));
  const widthDistance = size.x / (2 * Math.tan(horizontalFov / 2));
  const distance = Math.max(heightDistance, widthDistance, maxDimension * 0.9, 2.8) * 1.65;
  const direction = camera.position.clone().sub(target);
  if (direction.lengthSq() < 0.0001) {
    direction.set(4, 2.2, 5);
  }

  direction.normalize();
  target.copy(center);
  camera.position.copy(center).addScaledVector(direction, distance);
  camera.far = Math.max(camera.far, distance * 8 + maxDimension * 4);
  camera.lookAt(center);
  camera.updateProjectionMatrix();
  return true;
}
