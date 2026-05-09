import * as THREE from 'three';

import {
  DIRECTOR_STAGE_SNAPSHOT_HELPER_USER_DATA_KEY,
  type DirectorStageLight,
} from '../domain/types';

function assignLightId(object: THREE.Object3D, lightId: string): void {
  object.userData.lightId = lightId;
  object.traverse((child) => {
    child.userData.lightId = lightId;
  });
}

function createLightMarker(light: DirectorStageLight, color: THREE.Color): THREE.Object3D {
  const markerGroup = new THREE.Group();
  markerGroup.name = `${light.name} Marker`;
  markerGroup.userData[DIRECTOR_STAGE_SNAPSHOT_HELPER_USER_DATA_KEY] = true;

  const marker = new THREE.Mesh(
    light.kind === 'directional'
      ? new THREE.OctahedronGeometry(0.16, 0)
      : new THREE.SphereGeometry(0.13, 16, 12),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: light.enabled ? 0.95 : 0.38,
      depthTest: false,
      toneMapped: false,
    })
  );
  marker.renderOrder = 8;
  markerGroup.add(marker);

  if (light.kind === 'directional' || light.kind === 'spot') {
    const target = new THREE.Vector3(
      light.target.x - light.position.x,
      light.target.y - light.position.y,
      light.target.z - light.position.z
    );
    if (target.lengthSq() > 0.0001) {
      const length = Math.min(Math.max(target.length(), 0.65), 2.4);
      target.normalize().multiplyScalar(length);
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), target]),
        new THREE.LineBasicMaterial({
          color,
          transparent: true,
          opacity: light.enabled ? 0.62 : 0.24,
          depthTest: false,
          toneMapped: false,
        })
      );
      line.renderOrder = 7;
      markerGroup.add(line);
    }
  }

  assignLightId(markerGroup, light.id);
  markerGroup.traverse((child) => {
    child.userData[DIRECTOR_STAGE_SNAPSHOT_HELPER_USER_DATA_KEY] = true;
  });
  return markerGroup;
}

function resolveLocalTarget(light: DirectorStageLight): THREE.Object3D {
  const target = new THREE.Object3D();
  target.position.set(
    light.target.x - light.position.x,
    light.target.y - light.position.y,
    light.target.z - light.position.z
  );
  if (target.position.lengthSq() < 0.0001) {
    target.position.set(0, -1, 0);
  }
  return target;
}

export function buildDirectorStageLight(light: DirectorStageLight): THREE.Object3D {
  const intensity = light.enabled ? light.intensity : 0;
  const color = new THREE.Color(light.color);

  if (light.kind === 'ambient') {
    const ambient = new THREE.AmbientLight(color, intensity);
    ambient.name = light.name;
    ambient.userData.lightId = light.id;
    return ambient;
  }

  const group = new THREE.Group();
  group.name = light.name;
  group.position.set(light.position.x, light.position.y, light.position.z);
  group.userData.lightId = light.id;

  if (light.kind === 'point') {
    const point = new THREE.PointLight(color, intensity, light.distance ?? 0);
    point.name = light.name;
    point.castShadow = false;
    point.userData.lightId = light.id;
    group.add(point, createLightMarker(light, color));
    return group;
  }

  if (light.kind === 'spot') {
    const spot = new THREE.SpotLight(
      color,
      intensity,
      light.distance ?? 0,
      light.angle ?? Math.PI / 4,
      light.penumbra ?? 0.25
    );
    spot.name = light.name;
    const target = resolveLocalTarget(light);
    spot.target = target;
    spot.castShadow = true;
    spot.shadow.mapSize.width = 1024;
    spot.shadow.mapSize.height = 1024;
    spot.userData.lightId = light.id;
    group.add(spot, target, createLightMarker(light, color));
    return group;
  }

  const directional = new THREE.DirectionalLight(color, intensity);
  directional.name = light.name;
  const target = resolveLocalTarget(light);
  directional.target = target;
  directional.castShadow = true;
  directional.shadow.mapSize.width = 1024;
  directional.shadow.mapSize.height = 1024;
  directional.userData.lightId = light.id;
  group.add(directional, target, createLightMarker(light, color));
  return group;
}

export function disposeDirectorStageLightObject(object: THREE.Object3D): void {
  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.isMesh) {
      mesh.geometry.dispose();
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      materials.forEach((material) => material.dispose());
    }

    const line = child as THREE.Line;
    if (line.isLine) {
      line.geometry.dispose();
      const materials = Array.isArray(line.material) ? line.material : [line.material];
      materials.forEach((material) => material.dispose());
    }
  });
}
