import * as THREE from 'three';

export function findDirectorStageEntityId(object: THREE.Object3D | null): string | null {
  let current: THREE.Object3D | null = object;
  while (current) {
    const entityId = current.userData.entityId;
    if (typeof entityId === 'string') {
      return entityId;
    }
    current = current.parent;
  }
  return null;
}

export function findDirectorStageCrowdGroupId(object: THREE.Object3D | null): string | null {
  let current: THREE.Object3D | null = object;
  while (current) {
    const groupId = current.userData.crowdGroupId;
    if (typeof groupId === 'string') {
      return groupId;
    }
    current = current.parent;
  }
  return null;
}
