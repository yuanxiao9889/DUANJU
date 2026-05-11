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
  head: ['Head'],
  leftUpperArm: ['LeftArm'],
  leftForeArm: ['LeftForeArm'],
  rightUpperArm: ['RightArm'],
  rightForeArm: ['RightForeArm'],
  leftUpperLeg: ['LeftUpLeg'],
  leftLowerLeg: ['LeftLeg'],
  rightUpperLeg: ['RightUpLeg'],
  rightLowerLeg: ['RightLeg'],
};

const CC_BASE_BONE_ALIASES: Record<string, string> = {
  hip: 'hips',
  pelvis: 'pelvis',
  waist: 'spine',
  spine01: 'spine1',
  spine02: 'spine2',
  necktwist01: 'neck',
  head: 'head',
  thigh: 'upleg',
  calf: 'leg',
  foot: 'foot',
  toebase: 'toebase',
  clavicle: 'shoulder',
  upperarm: 'arm',
  forearm: 'forearm',
  hand: 'hand',
  thumb1: 'handthumb1',
  thumb2: 'handthumb2',
  thumb3: 'handthumb3',
  index1: 'handindex1',
  index2: 'handindex2',
  index3: 'handindex3',
  mid1: 'handmiddle1',
  mid2: 'handmiddle2',
  mid3: 'handmiddle3',
  ring1: 'handring1',
  ring2: 'handring2',
  ring3: 'handring3',
  pinky1: 'handpinky1',
  pinky2: 'handpinky2',
  pinky3: 'handpinky3',
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

function normalizeCanonicalBoneToken(value: string): string {
  return value.replace(/[^a-z0-9]/gi, '').toLowerCase();
}

function canonicalizeCcBaseBoneName(name: string): string | null {
  const match = /^CC_Base_(?:(L|R)_)?(.+)$/i.exec(name);
  if (!match) {
    return null;
  }

  const side = match[1]?.toUpperCase();
  const rawToken = normalizeCanonicalBoneToken(match[2] ?? '');
  if (
    rawToken.includes('sharebone')
    || rawToken.includes('twist')
    || rawToken.includes('breast')
    || rawToken.includes('eye')
    || rawToken.includes('teeth')
    || rawToken.includes('tongue')
    || rawToken.includes('jaw')
    || rawToken.includes('facial')
  ) {
    return null;
  }
  const alias = CC_BASE_BONE_ALIASES[rawToken] ?? rawToken;
  if (side === 'L') {
    return `left${alias}`;
  }
  if (side === 'R') {
    return `right${alias}`;
  }
  return alias;
}

function canonicalizePoseBoneName(name: string): string | null {
  const normalized = normalizeBoneName(name);
  const ccBaseName = canonicalizeCcBaseBoneName(normalized);
  if (ccBaseName) {
    return ccBaseName;
  }
  return normalizeCanonicalBoneToken(normalized.replace(/^mixamorig/i, ''));
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
    const restSource = posePreset.restPosePath
      ? await loadPoseSource(posePreset.restPosePath)
      : null;
    clearPoseFromObject(object);
    return copyStaticPoseBoneTransforms(object, poseSource, restSource);
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

function collectPoseBonesByCanonicalName(object: THREE.Object3D): Map<string, THREE.Bone> {
  const bones = new Map<string, THREE.Bone>();
  object.traverse((child) => {
    if (!isBone(child)) {
      return;
    }
    const canonicalName = canonicalizePoseBoneName(child.name);
    if (!canonicalName || bones.has(canonicalName)) {
      return;
    }
    bones.set(canonicalName, child);
  });
  return bones;
}

function collectTargetPoseBones(object: THREE.Object3D): Array<{ bone: THREE.Bone; canonicalName: string }> {
  const usedCanonicalNames = new Set<string>();
  const bones: Array<{ bone: THREE.Bone; canonicalName: string }> = [];
  object.traverse((child) => {
    if (!isBone(child)) {
      return;
    }
    const canonicalName = canonicalizePoseBoneName(child.name);
    if (!canonicalName || usedCanonicalNames.has(canonicalName)) {
      return;
    }
    usedCanonicalNames.add(canonicalName);
    bones.push({ bone: child, canonicalName });
  });
  return bones;
}

function copyStaticPoseBoneTransforms(
  object: THREE.Object3D,
  poseSource: THREE.Object3D,
  restSource: THREE.Object3D | null
): boolean {
  const sourceBones = collectPoseBonesByCanonicalName(poseSource);
  const restBones = restSource ? collectPoseBonesByCanonicalName(restSource) : null;
  const targetBones = collectTargetPoseBones(object);
  let appliedCount = 0;

  targetBones.forEach(({ bone, canonicalName }) => {
    const sourceBone = sourceBones.get(canonicalName);
    if (!sourceBone) {
      return;
    }

    const restBone = restBones?.get(canonicalName) ?? null;
    if (restBone) {
      const deltaQuaternion = restBone.quaternion.clone().invert().multiply(sourceBone.quaternion);
      bone.quaternion.multiply(deltaQuaternion);
    } else {
      bone.quaternion.copy(sourceBone.quaternion);
    }
    bone.updateMatrix();
    appliedCount += 1;
  });

  if (appliedCount <= 0) {
    return false;
  }

  object.updateMatrixWorld(true);
  captureLimbPoseBaseQuaternions(object);
  return true;
}
