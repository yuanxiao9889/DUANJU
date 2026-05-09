import type { DirectorStageAssetPack } from '../domain/types';

const A3D_ROOT = '/vendor/a3d';
const CHARACTERS_ROOT = `${A3D_ROOT}/characters`;
const SKYBOX_ROOT = `${A3D_ROOT}/demoAssets/skybox`;

export const A3D_ASSET_PACK: DirectorStageAssetPack = {
  id: 'a3d',
  labelKey: 'directorStage.assetPack.a3d',
  sourceUrl: 'https://github.com/n0neye/A3D',
  sourceCommit: 'fc396833aebcb4fea785c587caad1b314f6cf8f8',
  licensePath: `${A3D_ROOT}/LICENSE-AGPL-3.0.txt`,
  noticePath: `${A3D_ROOT}/NOTICE.md`,
  characters: [
    {
      id: 'lily',
      labelKey: 'directorStage.assets.lily',
      kind: 'character',
      source: 'a3d',
      modelPath: `${CHARACTERS_ROOT}/lily/lily_Breathing%20Idle_w_skin.fbx`,
      previewPath: `${CHARACTERS_ROOT}/thumbs/lily.webp`,
      defaultColor: '#e0bca2',
      posePresetIds: [
        'lily-idle',
        'lily-walking',
        'lily-fast-run',
        'lily-jump',
        'lily-sitting-idle',
        'lily-female-laying',
        'lily-male-laying',
      ],
    },
    {
      id: 'xbot',
      labelKey: 'directorStage.assets.xbot',
      kind: 'character',
      source: 'a3d',
      modelPath: `${CHARACTERS_ROOT}/xbot/xbot_Idle.fbx`,
      previewPath: `${CHARACTERS_ROOT}/thumbs/xbot.webp`,
      defaultColor: '#b7c7d8',
      posePresetIds: [
        'xbot-walking',
        'xbot-fast-run',
        'xbot-jump',
        'xbot-sitting',
        'xbot-female-dance',
      ],
    },
    {
      id: 'mannequin',
      labelKey: 'directorStage.assets.mannequin',
      kind: 'character',
      source: 'a3d',
      modelPath: `${CHARACTERS_ROOT}/mannequin_man_idle/mannequin_embeded_1024_white.fbx`,
      previewPath: `${CHARACTERS_ROOT}/thumbs/mannequin.webp`,
      defaultColor: '#d8d8d8',
      posePresetIds: [
        'mixamo-walking',
        'mixamo-running',
        'mixamo-sitting-idle',
        'mixamo-sitting',
        'mixamo-male-sitting',
        'mixamo-jump',
      ],
    },
  ],
  posePresets: [
    {
      id: 'lily-idle',
      labelKey: 'directorStage.poses.idle',
      animationPath: `${CHARACTERS_ROOT}/lily/animations/Idle.fbx`,
      sampleRatio: 0.15,
      compatibleAssetIds: ['lily'],
    },
    {
      id: 'lily-walking',
      labelKey: 'directorStage.poses.walking',
      animationPath: `${CHARACTERS_ROOT}/lily/animations/Walking.fbx`,
      sampleRatio: 0.35,
      compatibleAssetIds: ['lily'],
    },
    {
      id: 'lily-fast-run',
      labelKey: 'directorStage.poses.fastRun',
      animationPath: `${CHARACTERS_ROOT}/lily/animations/Fast%20Run.fbx`,
      sampleRatio: 0.28,
      compatibleAssetIds: ['lily'],
    },
    {
      id: 'lily-jump',
      labelKey: 'directorStage.poses.jump',
      animationPath: `${CHARACTERS_ROOT}/lily/animations/Jump.fbx`,
      sampleRatio: 0.45,
      compatibleAssetIds: ['lily'],
    },
    {
      id: 'lily-sitting-idle',
      labelKey: 'directorStage.poses.sittingIdle',
      animationPath: `${CHARACTERS_ROOT}/lily/animations/Sitting%20Idle.fbx`,
      sampleRatio: 0.2,
      compatibleAssetIds: ['lily'],
    },
    {
      id: 'lily-female-laying',
      labelKey: 'directorStage.poses.femaleLaying',
      animationPath: `${CHARACTERS_ROOT}/lily/animations/Female%20Laying%20Pose.fbx`,
      sampleRatio: 0.2,
      compatibleAssetIds: ['lily'],
    },
    {
      id: 'lily-male-laying',
      labelKey: 'directorStage.poses.maleLaying',
      animationPath: `${CHARACTERS_ROOT}/lily/animations/Male%20Laying%20Pose.fbx`,
      sampleRatio: 0.2,
      compatibleAssetIds: ['lily'],
    },
    {
      id: 'xbot-walking',
      labelKey: 'directorStage.poses.walking',
      animationPath: `${CHARACTERS_ROOT}/xbot/animations/Walking.fbx`,
      sampleRatio: 0.35,
      compatibleAssetIds: ['xbot'],
    },
    {
      id: 'xbot-fast-run',
      labelKey: 'directorStage.poses.fastRun',
      animationPath: `${CHARACTERS_ROOT}/xbot/animations/Fast%20Run.fbx`,
      sampleRatio: 0.28,
      compatibleAssetIds: ['xbot'],
    },
    {
      id: 'xbot-jump',
      labelKey: 'directorStage.poses.jump',
      animationPath: `${CHARACTERS_ROOT}/xbot/animations/Jump.fbx`,
      sampleRatio: 0.45,
      compatibleAssetIds: ['xbot'],
    },
    {
      id: 'xbot-sitting',
      labelKey: 'directorStage.poses.sitting',
      animationPath: `${CHARACTERS_ROOT}/xbot/animations/Sitting.fbx`,
      sampleRatio: 0.2,
      compatibleAssetIds: ['xbot'],
    },
    {
      id: 'xbot-female-dance',
      labelKey: 'directorStage.poses.femaleDance',
      animationPath: `${CHARACTERS_ROOT}/xbot/animations/Female%20Dance%20Pose.fbx`,
      sampleRatio: 0.25,
      compatibleAssetIds: ['xbot'],
    },
    {
      id: 'mixamo-walking',
      labelKey: 'directorStage.poses.walking',
      animationPath: `${CHARACTERS_ROOT}/_mixamo_animations/Walking.fbx`,
      sampleRatio: 0.35,
      compatibleAssetIds: ['mannequin'],
    },
    {
      id: 'mixamo-running',
      labelKey: 'directorStage.poses.running',
      animationPath: `${CHARACTERS_ROOT}/_mixamo_animations/Running.fbx`,
      sampleRatio: 0.28,
      compatibleAssetIds: ['mannequin'],
    },
    {
      id: 'mixamo-sitting-idle',
      labelKey: 'directorStage.poses.sittingIdle',
      animationPath: `${CHARACTERS_ROOT}/_mixamo_animations/Sitting%20Idle.fbx`,
      sampleRatio: 0.2,
      compatibleAssetIds: ['mannequin'],
    },
    {
      id: 'mixamo-sitting',
      labelKey: 'directorStage.poses.sitting',
      animationPath: `${CHARACTERS_ROOT}/_mixamo_animations/Sitting.fbx`,
      sampleRatio: 0.2,
      compatibleAssetIds: ['mannequin'],
    },
    {
      id: 'mixamo-male-sitting',
      labelKey: 'directorStage.poses.maleSitting',
      animationPath: `${CHARACTERS_ROOT}/_mixamo_animations/Male%20Sitting%20Pose.fbx`,
      sampleRatio: 0.2,
      compatibleAssetIds: ['mannequin'],
    },
    {
      id: 'mixamo-jump',
      labelKey: 'directorStage.poses.jump',
      animationPath: `${CHARACTERS_ROOT}/_mixamo_animations/Jump.fbx`,
      sampleRatio: 0.45,
      compatibleAssetIds: ['mannequin'],
    },
  ],
  skyboxes: [
    {
      id: 'skybox-1',
      labelKey: 'directorStage.skyboxes.studio',
      backgroundPath: `${SKYBOX_ROOT}/1.jpg`,
      previewPath: `${SKYBOX_ROOT}/1_thumb.webp`,
    },
    {
      id: 'skybox-6',
      labelKey: 'directorStage.skyboxes.sunset',
      backgroundPath: `${SKYBOX_ROOT}/6.jpg`,
      previewPath: `${SKYBOX_ROOT}/6_thumb.webp`,
    },
    {
      id: 'skybox-8',
      labelKey: 'directorStage.skyboxes.city',
      backgroundPath: `${SKYBOX_ROOT}/8.jpg`,
      previewPath: `${SKYBOX_ROOT}/8_thumb.webp`,
    },
    {
      id: 'skybox-hdri-21',
      labelKey: 'directorStage.skyboxes.hdri21',
      backgroundPath: `${SKYBOX_ROOT}/HDRI2_21_output.jpg`,
      previewPath: `${SKYBOX_ROOT}/HDRI2_21_output_thumb.webp`,
    },
  ],
};

export function getA3dPosePreset(posePresetId: string | null | undefined) {
  if (!posePresetId) {
    return null;
  }
  return A3D_ASSET_PACK.posePresets.find((preset) => preset.id === posePresetId) ?? null;
}

export function getA3dCharacterAsset(assetId: string | null | undefined) {
  if (!assetId) {
    return null;
  }
  return A3D_ASSET_PACK.characters.find((asset) => asset.id === assetId) ?? null;
}
