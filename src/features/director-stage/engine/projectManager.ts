import type {
  DirectorStageBuiltInAsset,
  DirectorStageEntity,
  DirectorStageEntityKind,
  DirectorStageProject,
} from '../domain/types';
import { createDefaultDirectorStageTransform } from '../domain/types';

export function createDirectorStageEntityFromBuiltInAsset(
  asset: DirectorStageBuiltInAsset,
  name: string,
  index: number
): DirectorStageEntity {
  const now = Date.now();
  const transform = createDefaultDirectorStageTransform();

  return {
    id: `${asset.id}-${now}-${index}`,
    kind: asset.kind,
    source: asset.source,
    assetId: asset.id,
    name,
    modelPath: asset.modelPath,
    previewPath: asset.previewPath,
    transform,
    color: asset.defaultColor,
    posePresetId: asset.source === 'geometry' ? null : asset.posePresetIds[0] ?? null,
    posePath: null,
    limbPose: {},
    crowdGroupId: null,
    crowdMemberIndex: null,
    skeletonCompatible: asset.source === 'geometry' ? false : true,
    loadError: null,
    createdAt: now,
    updatedAt: now,
  };
}

export function createDirectorStageEntityFromModelAsset(params: {
  assetId: string;
  name: string;
  modelPath: string;
  previewPath?: string | null;
  kind?: DirectorStageEntityKind;
  index: number;
}): DirectorStageEntity {
  const now = Date.now();
  const transform = createDefaultDirectorStageTransform();

  return {
    id: `model-${now}-${params.index}`,
    kind: params.kind ?? 'model',
    source: 'user',
    assetId: params.assetId,
    name: params.name,
    modelPath: params.modelPath,
    previewPath: params.previewPath ?? null,
    transform,
    color: '#ffffff',
    posePresetId: null,
    posePath: null,
    limbPose: {},
    crowdGroupId: null,
    crowdMemberIndex: null,
    skeletonCompatible: null,
    loadError: null,
    createdAt: now,
    updatedAt: now,
  };
}

export function patchDirectorStageEntity(
  project: DirectorStageProject,
  entityId: string,
  patch: Partial<DirectorStageEntity>
): DirectorStageProject {
  const now = Date.now();
  return {
    ...project,
    entities: project.entities.map((entity) =>
      entity.id === entityId
        ? {
            ...entity,
            ...patch,
            updatedAt: now,
          }
        : entity
    ),
    updatedAt: now,
  };
}
