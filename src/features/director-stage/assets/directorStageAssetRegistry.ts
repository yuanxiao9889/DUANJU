import type {
  DirectorStageBuiltInAsset,
  DirectorStagePosePreset,
  DirectorStageSkyboxPreset,
} from '../domain/types';
import { A3D_ASSET_PACK } from './a3dAssetPack';

export const DIRECTOR_STAGE_ASSET_PACKS = [
  A3D_ASSET_PACK,
];

export const DIRECTOR_STAGE_BUILT_IN_GEOMETRIES: DirectorStageBuiltInAsset[] = [
  {
    id: 'geometry-box',
    labelKey: 'directorStage.assets.box',
    kind: 'prop',
    source: 'geometry',
    modelPath: 'primitive://box',
    previewPath: null,
    defaultColor: '#d8dde6',
    posePresetIds: [],
  },
  {
    id: 'geometry-sphere',
    labelKey: 'directorStage.assets.sphere',
    kind: 'prop',
    source: 'geometry',
    modelPath: 'primitive://sphere',
    previewPath: null,
    defaultColor: '#d7e5df',
    posePresetIds: [],
  },
  {
    id: 'geometry-cylinder',
    labelKey: 'directorStage.assets.cylinder',
    kind: 'prop',
    source: 'geometry',
    modelPath: 'primitive://cylinder',
    previewPath: null,
    defaultColor: '#e4dccf',
    posePresetIds: [],
  },
  {
    id: 'geometry-cone',
    labelKey: 'directorStage.assets.cone',
    kind: 'prop',
    source: 'geometry',
    modelPath: 'primitive://cone',
    previewPath: null,
    defaultColor: '#e4d3d3',
    posePresetIds: [],
  },
  {
    id: 'geometry-plane',
    labelKey: 'directorStage.assets.plane',
    kind: 'prop',
    source: 'geometry',
    modelPath: 'primitive://plane',
    previewPath: null,
    defaultColor: '#d6d9cf',
    posePresetIds: [],
  },
  {
    id: 'geometry-torus',
    labelKey: 'directorStage.assets.torus',
    kind: 'prop',
    source: 'geometry',
    modelPath: 'primitive://torus',
    previewPath: null,
    defaultColor: '#d9d5e8',
    posePresetIds: [],
  },
];

export const DIRECTOR_STAGE_BUILT_IN_CHARACTERS: DirectorStageBuiltInAsset[] =
  DIRECTOR_STAGE_ASSET_PACKS.flatMap((pack) => pack.characters);

export const DIRECTOR_STAGE_BUILT_IN_POSE_PRESETS: DirectorStagePosePreset[] =
  DIRECTOR_STAGE_ASSET_PACKS.flatMap((pack) => pack.posePresets);

export const DIRECTOR_STAGE_SKYBOX_PRESETS: DirectorStageSkyboxPreset[] =
  DIRECTOR_STAGE_ASSET_PACKS.flatMap((pack) => pack.skyboxes);

export function getDirectorStagePosePreset(
  posePresetId: string | null | undefined
): DirectorStagePosePreset | null {
  if (!posePresetId) {
    return null;
  }
  return DIRECTOR_STAGE_BUILT_IN_POSE_PRESETS.find((preset) => preset.id === posePresetId) ?? null;
}

export function getDirectorStageCharacterAsset(
  assetId: string | null | undefined
): DirectorStageBuiltInAsset | null {
  if (!assetId) {
    return null;
  }
  return DIRECTOR_STAGE_BUILT_IN_CHARACTERS.find((asset) => asset.id === assetId) ?? null;
}
