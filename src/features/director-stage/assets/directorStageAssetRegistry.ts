import type {
  DirectorStageBuiltInAsset,
  DirectorStagePosePreset,
  DirectorStageSkyboxPreset,
} from '../domain/types';
import { A3D_ASSET_PACK } from './a3dAssetPack';

export const DIRECTOR_STAGE_ASSET_PACKS = [
  A3D_ASSET_PACK,
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
