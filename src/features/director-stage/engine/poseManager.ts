import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';

import {
  DIRECTOR_STAGE_LIMB_POSE_KEYS,
  type DirectorStageEntity,
  type DirectorStageLimbPose,
  type DirectorStageLimbPoseKey,
  type DirectorStagePosePreset,
} from '../domain/types';
import { resolveDirectorStageModelUrl } from '../application/modelUrl';

const poseLoader = new FBXLoader();
const BASE_POSE_TRANSFORMS_KEY = 'directorStageBasePoseTransforms';
const LIMB_POSE_BASE_QUATERNIONS_KEY = 'directorStageLimbPoseBaseQuaternions';
const poseSourceCache = new Map<string, Promise<THREE.Group>>();
const LIMB_CONTROL_ASSET_IDS = new Set(['lily', 'xbot', 'mannequin']);

const LIMB_BONE_SUFFIXES: Record<DirectorStageLimbPoseKey, string[]> = {
  leftUpperArm: ['LeftArm'],
  leftForeArm: ['LeftForeArm'],
  rightUpperArm: ['RightArm'],
  rightForeArm: ['RightForeArm'],
  leftUpperLeg: ['LeftUpLeg'],
  leftLowerLeg: ['LeftLeg'],
  rightUpperLeg: ['RightUpLeg'],
  rightLowerLeg: ['RightLeg'],
};

type BasePoseTransform = {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  scale: THREE.Vector3;
};

type LimbPoseBaseQuaternions = Partial<Record<DirectorStageLimbPoseKey, {
  bone: THREE.Bone;
  quaternion: THREE.Quaternion;
}>>;

function isBone(object: THREE.Object3D): object is THREE.Bone {
  return object instanceof THREE.Bone || (object as THREE.Bone).isBone === true;
}

function normalizeBoneName(name: string): string {
  const withoutNamespace = name.includes(':') ? name.slice(name.lastIndexOf(':') + 1) : name;
  return withoutNamespace.replace(/_skin$/i, '').replace(/_end$/i, '');
}

function findBoneBySuffix(object: THREE.Object3D, suffixes: string[]): THREE.Bone | null {
  let matchedBone: THREE.Bone | null = null;
  object.traverse((child) => {
    if (matchedBone || !isBone(child)) {
      return;
    }
    const normalizedName = normalizeBoneName(child.name);
    if (suffixes.some((suffix) => normalizedName === suffix || normalizedName.endsWith(suffix))) {
      matchedBone = child;
    }
  });
  return matchedBone;
}

function captureLimbPoseBaseQuaternions(object: THREE.Object3D): LimbPoseBaseQuaternions {
  const bases = DIRECTOR_STAGE_LIMB_POSE_KEYS.reduce<LimbPoseBaseQuaternions>((result, key) => {
    const bone = findBoneBySuffix(object, LIMB_BONE_SUFFIXES[key]);
    if (bone) {
      result[key] = {
        bone,
        quaternion: bone.quaternion.clone(),
      };
    }
    return result;
  }, {});
  object.userData[LIMB_POSE_BASE_QUATERNIONS_KEY] = bases;
  return bases;
}

function getLimbPoseBaseQuaternions(object: THREE.Object3D): LimbPoseBaseQuaternions {
  const cached = object.userData[LIMB_POSE_BASE_QUATERNIONS_KEY] as LimbPoseBaseQuaternions | undefined;
  return cached ?? captureLimbPoseBaseQuaternions(object);
}

function getLimbRotation(limbPose: DirectorStageLimbPose | undefined, key: DirectorStageLimbPoseKey) {
  return limbPose?.[key] ?? { x: 0, y: 0, z: 0 };
}

export function supportsDirectorStageLimbControls(entity: DirectorStageEntity | null | undefined): boolean {
  return Boolean(
    entity
      && entity.source === 'a3d'
      && entity.kind === 'character'
      && LIMB_CONTROL_ASSET_IDS.has(entity.assetId)
  );
}

export function rememberDirectorStageBasePose(object: THREE.Object3D): void {
  const transforms = new Map<string, BasePoseTransform>();
  object.traverse((child) => {
    if (!isBone(child)) {
      return;
    }
    transforms.set(child.uuid, {
      position: child.position.clone(),
      quaternion: child.quaternion.clone(),
      scale: child.scale.clone(),
    });
  });
  object.userData[BASE_POSE_TRANSFORMS_KEY] = transforms;
}

function restoreDirectorStageBasePose(object: THREE.Object3D): void {
  const transforms = object.userData[BASE_POSE_TRANSFORMS_KEY] as
    | Map<string, BasePoseTransform>
    | undefined;
  if (!transforms) {
    return;
  }
  object.traverse((child) => {
    const transform = transforms.get(child.uuid);
    if (!transform) {
      return;
    }
    child.position.copy(transform.position);
    child.quaternion.copy(transform.quaternion);
    child.scale.copy(transform.scale);
    child.updateMatrix();
  });
  object.updateMatrixWorld(true);
  captureLimbPoseBaseQuaternions(object);
}

export function clearPoseFromObject(object: THREE.Object3D): void {
  const mixer = object.userData.poseMixer as THREE.AnimationMixer | undefined;
  const action = object.userData.poseAction as THREE.AnimationAction | undefined;
  action?.stop();
  mixer?.stopAllAction();
  restoreDirectorStageBasePose(object);
  delete object.userData.poseMixer;
  delete object.userData.poseAction;
  captureLimbPoseBaseQuaternions(object);
}

export async function applyPosePresetToObject(
  object: THREE.Object3D,
  posePreset: DirectorStagePosePreset
): Promise<boolean> {
  const poseSource = await loadPoseSource(posePreset.animationPath);
  const clip = poseSource.animations[0];
  if (!clip) {
    return false;
  }

  clearPoseFromObject(object);
  const mixer = new THREE.AnimationMixer(object);
  const action = mixer.clipAction(clip);
  action.play();
  mixer.setTime(Math.max(0, Math.min(clip.duration, clip.duration * posePreset.sampleRatio)));
  mixer.update(0);
  action.paused = true;
  object.userData.poseMixer = mixer;
  object.userData.poseAction = action;
  captureLimbPoseBaseQuaternions(object);
  return true;
}

export function applyDirectorStageLimbPoseToObject(
  object: THREE.Object3D,
  entity: DirectorStageEntity
): boolean {
  if (!supportsDirectorStageLimbControls(entity)) {
    return false;
  }

  const bases = getLimbPoseBaseQuaternions(object);
  const deltaEuler = new THREE.Euler(0, 0, 0, 'XYZ');
  const deltaQuaternion = new THREE.Quaternion();

  DIRECTOR_STAGE_LIMB_POSE_KEYS.forEach((key) => {
    const base = bases[key];
    if (!base) {
      return;
    }
    const rotation = getLimbRotation(entity.limbPose, key);
    deltaEuler.set(rotation.x, rotation.y, rotation.z, 'XYZ');
    deltaQuaternion.setFromEuler(deltaEuler);
    base.bone.quaternion.copy(base.quaternion).multiply(deltaQuaternion);
    base.bone.updateMatrix();
  });

  object.updateMatrixWorld(true);
  return true;
}

function loadPoseSource(animationPath: string): Promise<THREE.Group> {
  const cached = poseSourceCache.get(animationPath);
  if (cached) {
    return cached;
  }
  const promise = poseLoader.loadAsync(resolveDirectorStageModelUrl(animationPath));
  poseSourceCache.set(animationPath, promise);
  return promise;
}
