import {
  AUTO_REQUEST_ASPECT_RATIO,
  CANVAS_NODE_TYPES,
  DEFAULT_ASPECT_RATIO,
  JIMENG_ASPECT_RATIOS,
  JIMENG_DURATION_SECONDS,
  JIMENG_IMAGE_MODEL_VERSIONS,
  JIMENG_IMAGE_RESOLUTION_TYPES,
  MIDJOURNEY_ASPECT_RATIOS,
  MIDJOURNEY_VERSION_PRESETS,
  type ImageSize,
  JIMENG_REFERENCE_MODES,
  JIMENG_VIDEO_MODEL_IDS,
  JIMENG_VIDEO_RESOLUTIONS,
  SEEDANCE_ASPECT_RATIOS,
  SEEDANCE_DURATION_SECONDS,
  SEEDANCE_INPUT_MODES,
  SEEDANCE_MODEL_IDS,
  SEEDANCE_RESOLUTIONS,
  VIDU_ASPECT_RATIOS,
  VIDU_DURATION_SECONDS,
  VIDU_INPUT_MODES,
  VIDU_MODEL_IDS,
  VIDU_RESOLUTIONS,
  type CanvasNodeData,
  type CanvasNodeType,
  type ExportImageNodeData,
  type ImageCompareNodeData,
  type DirectorStageNodeData,
  type GroupNodeData,
  type BackgroundRemoveNodeData,
  type Seedvr2ImageUpscaleNodeData,
  type Seedvr2VideoUpscaleNodeData,
  type LegacyNodeData,
  type ImageEditNodeData,
  type MultiAngleImageNodeData,
  type ImageCollageNodeData,
  type Panorama360NodeData,
  type JimengImageNodeData,
  type MjNodeData,
  type MjResultNodeData,
  type JimengImageResultNodeData,
  type JimengNodeData,
  type JimengVideoResultNodeData,
  type SeedanceNodeData,
  type SeedanceVideoResultNodeData,
  type GptBestVideoNodeData,
  type GptBestVideoResultNodeData,
  type ViduNodeData,
  type ViduVideoResultNodeData,
  type StoryboardSplitNodeData,
  type StoryboardSplitResultNodeData,
  type StoryboardGenNodeData,
  type AssetMaterialNodeData,
  type TextAnnotationNodeData,
  type LlmLogicNodeData,
  type TtsTextNodeData,
  type TtsSavedVoiceNodeData,
  type TtsVoiceDesignNodeData,
  type VoxCpmVoiceDesignNodeData,
  type VoxCpmVoiceCloneNodeData,
  type VoxCpmUltimateCloneNodeData,
  type UploadImageNodeData,
  type AudioNodeData,
  type AdProjectRootNodeData,
  type CommerceBatchGenerateNodeData,
  type CommerceBriefNodeData,
  type CommerceProductNodeData,
  type CommerceResultGroupNodeData,
  type VideoNodeData,
  type ScriptRootNodeData,
  type ScriptChapterNodeData,
  type ScriptSceneNodeData,
  type ShootingScriptNodeData,
  type ScriptAssetExtractNodeData,
  type SmartDirectorStoryboardNodeData,
  type ScriptStoryboardTableNodeData,
  type DirectorStoryboardReferenceNodeData,
  type ScriptReferenceNodeData,
  type AdScriptReferenceNodeData,
  type ScriptCharacterReferenceNodeData,
  type ScriptLocationReferenceNodeData,
  type ScriptItemReferenceNodeData,
  type ScriptCharacterNodeData,
  type ScriptLocationNodeData,
  type ScriptItemNodeData,
  type ScriptPlotLineNodeData,
  type ScriptStoryNoteNodeData,
  type ScriptPlotPointNodeData,
  type ScriptWorldviewNodeData,
  createDefaultSceneCard,
  createEmptyAssetBatchQueueState,
  createEmptyDirectorStoryboardOverrides,
  createEmptyProductionQueueState,
} from './canvasNodes';
import { createDefaultAdProjectRootState } from '@/features/ad/types';
import {
  createDefaultCommerceAdBatchGenerateState,
  createDefaultCommerceAdBriefState,
  createDefaultCommerceAdProductState,
  createDefaultCommerceAdResultGroupState,
} from '@/features/commerce-ad/types';
import { createDefaultDirectorStageProject } from '@/features/director-stage/domain/types';
import { DEFAULT_NODE_DISPLAY_NAME } from './nodeDisplay';
import { DEFAULT_IMAGE_MODEL_ID } from '../models';
import {
  QWEN_TTS_COMPLETE_EXTENSION_ID,
  QWEN_TTS_SIMPLE_EXTENSION_ID,
  RMBG2_COMPLETE_EXTENSION_ID,
  SEEDVR2_COMPLETE_EXTENSION_ID,
  VOXCPM2_COMPLETE_EXTENSION_ID,
} from '@/features/extensions/domain/types';

export type MenuIconKey =
  | 'upload'
  | 'sparkles'
  | 'layout'
  | 'text'
  | 'video'
  | 'audio'
  | 'link'
  | 'package';
export type NodeMenuProjectType = 'storyboard' | 'script' | 'ad' | 'commerceAd';
export type NodeMenuGroupKey =
  | 'imageGeneration'
  | 'jimeng'
  | 'midjourney'
  | 'storyboard'
  | 'media'
  | 'upscale'
  | 'text'
  | 'extensionPackage'
  | 'scriptReference';

export interface CanvasNodeMenuGroupDefinition {
  id: NodeMenuGroupKey;
  labelKey: string;
  menuIcon: MenuIconKey;
}

export interface CanvasNodeCapabilities {
  toolbar: boolean;
  promptInput: boolean;
}

export interface CanvasNodeConnectivity {
  sourceHandle: boolean;
  targetHandle: boolean;
  branchHandle?: boolean;
  connectMenu: {
    fromSource: boolean;
    fromTarget: boolean;
    fromBranch?: boolean;
  };
}

export interface CanvasNodeDefinition<TData extends CanvasNodeData = CanvasNodeData> {
  type: CanvasNodeType;
  menuLabelKey: string;
  menuIcon: MenuIconKey;
  menuGroup?: NodeMenuGroupKey;
  visibleInMenu: boolean;
  menuProjectTypes: NodeMenuProjectType[];
  capabilities: CanvasNodeCapabilities;
  connectivity: CanvasNodeConnectivity;
  requiredExtensionId?: string;
  requiredExtensionIds?: string[];
  createDefaultData: () => TData;
}

export interface NodeMenuAvailabilityOptions {
  linkedScriptProjectId?: string | null;
  linkedAdProjectId?: string | null;
}

export const canvasNodeMenuGroups: Record<NodeMenuGroupKey, CanvasNodeMenuGroupDefinition> = {
  imageGeneration: {
    id: 'imageGeneration',
    labelKey: 'node.menuGroup.imageGeneration',
    menuIcon: 'sparkles',
  },
  jimeng: {
    id: 'jimeng',
    labelKey: 'node.menuGroup.jimeng',
    menuIcon: 'sparkles',
  },
  midjourney: {
    id: 'midjourney',
    labelKey: 'node.menuGroup.midjourney',
    menuIcon: 'sparkles',
  },
  storyboard: {
    id: 'storyboard',
    labelKey: 'node.menuGroup.storyboard',
    menuIcon: 'layout',
  },
  media: {
    id: 'media',
    labelKey: 'node.menuGroup.media',
    menuIcon: 'video',
  },
  upscale: {
    id: 'upscale',
    labelKey: 'node.menuGroup.upscale',
    menuIcon: 'sparkles',
  },
  text: {
    id: 'text',
    labelKey: 'node.menuGroup.text',
    menuIcon: 'text',
  },
  extensionPackage: {
    id: 'extensionPackage',
    labelKey: 'node.menuGroup.extensionPackage',
    menuIcon: 'package',
  },
  scriptReference: {
    id: 'scriptReference',
    labelKey: 'node.menuGroup.scriptReference',
    menuIcon: 'link',
  },
};

const uploadNodeDefinition: CanvasNodeDefinition<UploadImageNodeData> = {
  type: CANVAS_NODE_TYPES.upload,
  menuLabelKey: 'node.menu.uploadImage',
  menuIcon: 'upload',
  visibleInMenu: true,
  menuProjectTypes: ['storyboard'],
  capabilities: {
    toolbar: true,
    promptInput: false,
  },
  connectivity: {
    sourceHandle: true,
    targetHandle: true,
    connectMenu: {
      fromSource: false,
      fromTarget: true,
    },
  },
  createDefaultData: () => ({
    displayName: DEFAULT_NODE_DISPLAY_NAME[CANVAS_NODE_TYPES.upload],
    imageUrl: null,
    previewImageUrl: null,
    aspectRatio: '1:1',
    isSizeManuallyAdjusted: false,
    sourceFileName: null,
  }),
};

const imageEditNodeDefinition: CanvasNodeDefinition<ImageEditNodeData> = {
  type: CANVAS_NODE_TYPES.imageEdit,
  menuLabelKey: 'node.menu.aiImageGeneration',
  menuIcon: 'sparkles',
  menuGroup: 'imageGeneration',
  visibleInMenu: true,
  menuProjectTypes: ['storyboard'],
  capabilities: {
    toolbar: true,
    promptInput: false,
  },
  connectivity: {
    sourceHandle: true,
    targetHandle: true,
    connectMenu: {
      fromSource: true,
      fromTarget: false,
    },
  },
  createDefaultData: () => ({
    displayName: DEFAULT_NODE_DISPLAY_NAME[CANVAS_NODE_TYPES.imageEdit],
    imageUrl: null,
    previewImageUrl: null,
    aspectRatio: DEFAULT_ASPECT_RATIO,
    isSizeManuallyAdjusted: false,
    requestAspectRatio: AUTO_REQUEST_ASPECT_RATIO,
    prompt: '',
    model: DEFAULT_IMAGE_MODEL_ID,
    size: '2K' as ImageSize,
    cameraParams: null,
    extraParams: {},
    isGenerating: false,
    generationStartedAt: null,
    generationDurationMs: 60000,
  }),
};

const multiAngleImageNodeDefinition: CanvasNodeDefinition<MultiAngleImageNodeData> = {
  type: CANVAS_NODE_TYPES.multiAngleImage,
  menuLabelKey: 'node.menu.multiAngleImage',
  menuIcon: 'sparkles',
  menuGroup: 'imageGeneration',
  visibleInMenu: true,
  menuProjectTypes: ['storyboard'],
  capabilities: {
    toolbar: true,
    promptInput: false,
  },
  connectivity: {
    sourceHandle: true,
    targetHandle: true,
    connectMenu: {
      fromSource: true,
      fromTarget: false,
    },
  },
  createDefaultData: () => ({
    displayName: DEFAULT_NODE_DISPLAY_NAME[CANVAS_NODE_TYPES.multiAngleImage],
    model: DEFAULT_IMAGE_MODEL_ID,
    size: '2K' as ImageSize,
    requestAspectRatio: AUTO_REQUEST_ASPECT_RATIO,
    horizontalAngle: 0,
    verticalAngle: 0,
    zoom: 5,
    cameraView: false,
    extraParams: {},
    isGenerating: false,
    generationStartedAt: null,
    generationDurationMs: 60000,
    lastError: null,
  }),
};

const panorama360NodeDefinition: CanvasNodeDefinition<Panorama360NodeData> = {
  type: CANVAS_NODE_TYPES.panorama360,
  menuLabelKey: 'node.menu.panorama360',
  menuIcon: 'video',
  menuGroup: 'imageGeneration',
  visibleInMenu: true,
  menuProjectTypes: ['storyboard'],
  capabilities: {
    toolbar: true,
    promptInput: false,
  },
  connectivity: {
    sourceHandle: true,
    targetHandle: true,
    connectMenu: {
      fromSource: true,
      fromTarget: false,
    },
  },
  createDefaultData: () => ({
    displayName: DEFAULT_NODE_DISPLAY_NAME[CANVAS_NODE_TYPES.panorama360],
    imageUrl: null,
    previewImageUrl: null,
    aspectRatio: DEFAULT_ASPECT_RATIO,
    isSizeManuallyAdjusted: false,
    viewerYaw: 0,
    viewerPitch: 0,
    viewerFov: 75,
  }),
};

const directorStageNodeDefinition: CanvasNodeDefinition<DirectorStageNodeData> = {
  type: CANVAS_NODE_TYPES.directorStage,
  menuLabelKey: 'node.menu.directorStage',
  menuIcon: 'package',
  menuGroup: 'storyboard',
  visibleInMenu: true,
  menuProjectTypes: ['storyboard'],
  capabilities: {
    toolbar: true,
    promptInput: false,
  },
  connectivity: {
    sourceHandle: true,
    targetHandle: true,
    connectMenu: {
      fromSource: true,
      fromTarget: true,
    },
  },
  createDefaultData: () => ({
    displayName: DEFAULT_NODE_DISPLAY_NAME[CANVAS_NODE_TYPES.directorStage],
    project: createDefaultDirectorStageProject(),
    lastSnapshotUrl: null,
    lastSnapshotPreviewUrl: null,
    lastSnapshotAt: null,
    objectCount: 0,
    cameraShotCount: 1,
    activeCameraShotName: null,
  }),
};

const backgroundRemoveNodeDefinition: CanvasNodeDefinition<BackgroundRemoveNodeData> = {
  type: CANVAS_NODE_TYPES.backgroundRemove,
  menuLabelKey: 'node.menu.backgroundRemove',
  menuIcon: 'sparkles',
  menuGroup: 'extensionPackage',
  visibleInMenu: true,
  menuProjectTypes: ['storyboard'],
  requiredExtensionId: RMBG2_COMPLETE_EXTENSION_ID,
  capabilities: {
    toolbar: true,
    promptInput: false,
  },
  connectivity: {
    sourceHandle: true,
    targetHandle: true,
    connectMenu: {
      fromSource: true,
      fromTarget: false,
    },
  },
  createDefaultData: () => ({
    displayName: DEFAULT_NODE_DISPLAY_NAME[CANVAS_NODE_TYPES.backgroundRemove],
    statusText: null,
    lastError: null,
    lastGeneratedAt: null,
  }),
};

const seedvr2ImageUpscaleNodeDefinition: CanvasNodeDefinition<Seedvr2ImageUpscaleNodeData> = {
  type: CANVAS_NODE_TYPES.seedvr2ImageUpscale,
  menuLabelKey: 'node.menu.seedvr2ImageUpscale',
  menuIcon: 'sparkles',
  menuGroup: 'extensionPackage',
  visibleInMenu: true,
  menuProjectTypes: ['storyboard'],
  requiredExtensionId: SEEDVR2_COMPLETE_EXTENSION_ID,
  capabilities: {
    toolbar: true,
    promptInput: false,
  },
  connectivity: {
    sourceHandle: true,
    targetHandle: true,
    connectMenu: {
      fromSource: true,
      fromTarget: false,
    },
  },
  createDefaultData: () => ({
    displayName: DEFAULT_NODE_DISPLAY_NAME[CANVAS_NODE_TYPES.seedvr2ImageUpscale],
    targetResolution: 1440,
    isProcessing: false,
    statusText: null,
    lastError: null,
    lastGeneratedAt: null,
  }),
};

const seedvr2VideoUpscaleNodeDefinition: CanvasNodeDefinition<Seedvr2VideoUpscaleNodeData> = {
  type: CANVAS_NODE_TYPES.seedvr2VideoUpscale,
  menuLabelKey: 'node.menu.seedvr2VideoUpscale',
  menuIcon: 'sparkles',
  menuGroup: 'extensionPackage',
  visibleInMenu: true,
  menuProjectTypes: ['storyboard'],
  requiredExtensionId: SEEDVR2_COMPLETE_EXTENSION_ID,
  capabilities: {
    toolbar: true,
    promptInput: false,
  },
  connectivity: {
    sourceHandle: true,
    targetHandle: true,
    connectMenu: {
      fromSource: true,
      fromTarget: false,
    },
  },
  createDefaultData: () => ({
    displayName: DEFAULT_NODE_DISPLAY_NAME[CANVAS_NODE_TYPES.seedvr2VideoUpscale],
    targetResolution: 1080,
    statusText: null,
    lastError: null,
    lastGeneratedAt: null,
  }),
};

const jimengNodeDefinition: CanvasNodeDefinition<JimengNodeData> = {
  type: CANVAS_NODE_TYPES.jimeng,
  menuLabelKey: 'node.menu.jimengVideo',
  menuIcon: 'sparkles',
  menuGroup: 'jimeng',
  visibleInMenu: true,
  menuProjectTypes: ['storyboard'],
  capabilities: {
    toolbar: true,
    promptInput: false,
  },
  connectivity: {
    sourceHandle: true,
    targetHandle: true,
    connectMenu: {
      fromSource: true,
      fromTarget: false,
    },
  },
  createDefaultData: () => ({
    displayName: DEFAULT_NODE_DISPLAY_NAME[CANVAS_NODE_TYPES.jimeng],
    prompt: '',
    referenceImageOrder: [],
    model: JIMENG_VIDEO_MODEL_IDS[1],
    referenceMode: JIMENG_REFERENCE_MODES[0],
    aspectRatio: JIMENG_ASPECT_RATIOS[1],
    durationSeconds: JIMENG_DURATION_SECONDS[1],
    videoResolution: JIMENG_VIDEO_RESOLUTIONS[0],
    suggestedDurationSeconds: null,
    suggestedDurationEstimatedSeconds: null,
    suggestedDurationExceedsLimit: false,
    suggestedDurationReason: null,
    isSubmitting: false,
    lastSubmittedAt: null,
    lastError: null,
  }),
};

const gptBestSeedanceNodeDefinition: CanvasNodeDefinition<GptBestVideoNodeData> = {
  type: CANVAS_NODE_TYPES.gptBestSeedance,
  menuLabelKey: 'node.menu.gptBestSeedanceVideo',
  menuIcon: 'sparkles',
  menuGroup: 'media',
  visibleInMenu: false,
  menuProjectTypes: ['storyboard'],
  capabilities: {
    toolbar: true,
    promptInput: false,
  },
  connectivity: {
    sourceHandle: true,
    targetHandle: true,
    connectMenu: {
      fromSource: false,
      fromTarget: false,
    },
  },
  createDefaultData: () => ({
    displayName: DEFAULT_NODE_DISPLAY_NAME[CANVAS_NODE_TYPES.gptBestSeedance],
    prompt: '',
    sourceKind: 'seedance',
    providerId: 'oopii',
    modelId: 'OK-video',
    size: '1280x720',
    aspectRatio: '16:9',
    seconds: 10,
    durationSeconds: 10,
    resolution: '720p',
    isSubmitting: false,
    lastSubmittedAt: null,
    lastError: null,
  }),
};

const gptBestGrokVideoNodeDefinition: CanvasNodeDefinition<GptBestVideoNodeData> = {
  type: CANVAS_NODE_TYPES.gptBestGrokVideo,
  menuLabelKey: 'node.menu.gptBestGrokVideo',
  menuIcon: 'video',
  menuGroup: 'media',
  visibleInMenu: true,
  menuProjectTypes: ['storyboard'],
  capabilities: {
    toolbar: true,
    promptInput: false,
  },
  connectivity: {
    sourceHandle: true,
    targetHandle: true,
    connectMenu: {
      fromSource: true,
      fromTarget: false,
    },
  },
  createDefaultData: () => ({
    displayName: DEFAULT_NODE_DISPLAY_NAME[CANVAS_NODE_TYPES.gptBestGrokVideo],
    prompt: '',
    sourceKind: 'grok',
    providerId: 'oopii',
    modelId: 'OK-video',
    size: '1280x720',
    aspectRatio: '16:9',
    seconds: 10,
    durationSeconds: 10,
    resolution: '720p',
    isSubmitting: false,
    lastSubmittedAt: null,
    lastError: null,
  }),
};

const gptBestVideoResultNodeDefinition: CanvasNodeDefinition<GptBestVideoResultNodeData> = {
  type: CANVAS_NODE_TYPES.gptBestVideoResult,
  menuLabelKey: 'node.menu.gptBestVideoResult',
  menuIcon: 'video',
  visibleInMenu: false,
  menuProjectTypes: ['storyboard'],
  capabilities: {
    toolbar: true,
    promptInput: false,
  },
  connectivity: {
    sourceHandle: true,
    targetHandle: true,
    connectMenu: {
      fromSource: false,
      fromTarget: false,
    },
  },
  createDefaultData: () => ({
    displayName: DEFAULT_NODE_DISPLAY_NAME[CANVAS_NODE_TYPES.gptBestVideoResult],
    sourceNodeId: null,
    provider: 'oopii',
    sourceKind: 'seedance',
    taskId: null,
    taskStatus: null,
    taskUpdatedAt: null,
    modelId: null,
    videoUrl: null,
    previewImageUrl: null,
    videoFileName: null,
    aspectRatio: '16:9',
    size: '1280x720',
    resolution: null,
    duration: undefined,
    requestSnapshot: null,
    isGenerating: false,
    generationStartedAt: null,
    generationDurationMs: 180000,
    lastGeneratedAt: null,
    lastError: null,
  }),
};

const viduNodeDefinition: CanvasNodeDefinition<ViduNodeData> = {
  type: CANVAS_NODE_TYPES.vidu,
  menuLabelKey: 'node.menu.viduVideo',
  menuIcon: 'sparkles',
  menuGroup: 'media',
  visibleInMenu: true,
  menuProjectTypes: ['storyboard'],
  capabilities: {
    toolbar: true,
    promptInput: false,
  },
  connectivity: {
    sourceHandle: true,
    targetHandle: true,
    connectMenu: {
      fromSource: true,
      fromTarget: false,
    },
  },
  createDefaultData: () => ({
    displayName: DEFAULT_NODE_DISPLAY_NAME[CANVAS_NODE_TYPES.vidu],
    prompt: '',
    inputMode: VIDU_INPUT_MODES[0],
    modelId: VIDU_MODEL_IDS[0],
    aspectRatio: VIDU_ASPECT_RATIOS[0],
    durationSeconds: VIDU_DURATION_SECONDS[1],
    resolution: VIDU_RESOLUTIONS[0],
    audio: true,
    bgm: false,
    isSubmitting: false,
    lastSubmittedAt: null,
    lastError: null,
  }),
};

const viduVideoResultNodeDefinition: CanvasNodeDefinition<ViduVideoResultNodeData> = {
  type: CANVAS_NODE_TYPES.viduVideoResult,
  menuLabelKey: 'node.menu.viduVideoResult',
  menuIcon: 'video',
  visibleInMenu: false,
  menuProjectTypes: ['storyboard'],
  capabilities: {
    toolbar: true,
    promptInput: false,
  },
  connectivity: {
    sourceHandle: true,
    targetHandle: true,
    connectMenu: {
      fromSource: false,
      fromTarget: false,
    },
  },
  createDefaultData: () => ({
    displayName: DEFAULT_NODE_DISPLAY_NAME[CANVAS_NODE_TYPES.viduVideoResult],
    sourceNodeId: null,
    provider: 'vidu',
    inputMode: VIDU_INPUT_MODES[0],
    taskId: null,
    taskStatus: null,
    taskUpdatedAt: null,
    modelId: VIDU_MODEL_IDS[0],
    videoUrl: null,
    previewImageUrl: null,
    videoFileName: null,
    aspectRatio: VIDU_ASPECT_RATIOS[0],
    resolution: VIDU_RESOLUTIONS[0],
    duration: undefined,
    requestSnapshot: null,
    isGenerating: false,
    generationStartedAt: null,
    generationDurationMs: 180000,
    lastGeneratedAt: null,
    lastError: null,
  }),
};

const exportImageNodeDefinition: CanvasNodeDefinition<ExportImageNodeData> = {
  type: CANVAS_NODE_TYPES.exportImage,
  menuLabelKey: 'node.menu.uploadImage',
  menuIcon: 'upload',
  visibleInMenu: false,
  menuProjectTypes: ['storyboard'],
  capabilities: {
    toolbar: true,
    promptInput: false,
  },
  connectivity: {
    sourceHandle: true,
    targetHandle: true,
    connectMenu: {
      fromSource: false,
      fromTarget: false,
    },
  },
  createDefaultData: () => ({
    displayName: DEFAULT_NODE_DISPLAY_NAME[CANVAS_NODE_TYPES.exportImage],
    imageUrl: null,
    previewImageUrl: null,
    aspectRatio: DEFAULT_ASPECT_RATIO,
    isSizeManuallyAdjusted: false,
    resultKind: 'generic',
    generationSummary: null,
    generationPhase: null,
    generationFailureStage: null,
  }),
};

const imageCompareNodeDefinition: CanvasNodeDefinition<ImageCompareNodeData> = {
  type: CANVAS_NODE_TYPES.imageCompare,
  menuLabelKey: 'node.menu.imageCompare',
  menuIcon: 'layout',
  visibleInMenu: false,
  menuProjectTypes: ['storyboard'],
  capabilities: {
    toolbar: true,
    promptInput: false,
  },
  connectivity: {
    sourceHandle: false,
    targetHandle: false,
    connectMenu: {
      fromSource: false,
      fromTarget: false,
    },
  },
  createDefaultData: () => ({
    displayName: DEFAULT_NODE_DISPLAY_NAME[CANVAS_NODE_TYPES.imageCompare],
    baseImage: {
      sourceNodeId: null,
      sourceNodeType: null,
      imageUrl: null,
      previewImageUrl: null,
      aspectRatio: DEFAULT_ASPECT_RATIO,
      displayName: null,
    },
    overlayImage: {
      sourceNodeId: null,
      sourceNodeType: null,
      imageUrl: null,
      previewImageUrl: null,
      aspectRatio: DEFAULT_ASPECT_RATIO,
      displayName: null,
    },
    dividerRatio: 0.5,
    mergeMeta: null,
  }),
};

const groupNodeDefinition: CanvasNodeDefinition<GroupNodeData> = {
  type: CANVAS_NODE_TYPES.group,
  menuLabelKey: 'node.menu.storyboard',
  menuIcon: 'layout',
  visibleInMenu: false,
  menuProjectTypes: ['storyboard'],
  capabilities: {
    toolbar: false,
    promptInput: false,
  },
  connectivity: {
    sourceHandle: false,
    targetHandle: false,
    connectMenu: {
      fromSource: false,
      fromTarget: false,
    },
  },
  createDefaultData: () => ({
    displayName: DEFAULT_NODE_DISPLAY_NAME[CANVAS_NODE_TYPES.group],
    label: DEFAULT_NODE_DISPLAY_NAME[CANVAS_NODE_TYPES.group],
    visualStyle: 'default',
    globalOverrideEnabled: false,
    optimizePromptBeforeGenerate: false,
    queueState: createEmptyAssetBatchQueueState(),
  }),
};

const legacyNodeDefinition: CanvasNodeDefinition<LegacyNodeData> = {
  type: CANVAS_NODE_TYPES.legacy,
  menuLabelKey: 'node.menu.legacyNode',
  menuIcon: 'text',
  visibleInMenu: false,
  menuProjectTypes: ['storyboard', 'script', 'ad'],
  capabilities: {
    toolbar: false,
    promptInput: false,
  },
  connectivity: {
    sourceHandle: true,
    targetHandle: true,
    connectMenu: {
      fromSource: false,
      fromTarget: false,
    },
  },
  createDefaultData: () => ({
    displayName: DEFAULT_NODE_DISPLAY_NAME[CANVAS_NODE_TYPES.legacy],
    legacyType: 'legacyNode',
    legacyData: {},
  }),
};

const textAnnotationNodeDefinition: CanvasNodeDefinition<TextAnnotationNodeData> = {
  type: CANVAS_NODE_TYPES.textAnnotation,
  menuLabelKey: 'node.menu.textAnnotation',
  menuIcon: 'text',
  menuGroup: 'text',
  visibleInMenu: true,
  menuProjectTypes: ['storyboard', 'script'],
  capabilities: {
    toolbar: true,
    promptInput: false,
  },
  connectivity: {
    sourceHandle: true,
    targetHandle: true,
    connectMenu: {
      fromSource: false,
      fromTarget: true,
    },
  },
  createDefaultData: () => ({
    displayName: DEFAULT_NODE_DISPLAY_NAME[CANVAS_NODE_TYPES.textAnnotation],
    content: '',
    generationSource: null,
    showCopyButton: false,
    isGenerating: false,
    generationStatusText: null,
  }),
};

const llmLogicNodeDefinition: CanvasNodeDefinition<LlmLogicNodeData> = {
  type: CANVAS_NODE_TYPES.llmLogic,
  menuLabelKey: 'node.menu.llmLogic',
  menuIcon: 'text',
  menuGroup: 'text',
  visibleInMenu: true,
  menuProjectTypes: ['storyboard'],
  capabilities: {
    toolbar: true,
    promptInput: false,
  },
  connectivity: {
    sourceHandle: true,
    targetHandle: true,
    connectMenu: {
      fromSource: true,
      fromTarget: false,
    },
  },
  createDefaultData: () => ({
    displayName: DEFAULT_NODE_DISPLAY_NAME[CANVAS_NODE_TYPES.llmLogic],
    model: '',
    systemInstruction: '',
    userPrompt: '',
    presetCategoryKey: null,
    presetKey: null,
    activeRequestId: null,
    outputNodeId: null,
    pendingRequestIds: [],
    isGenerating: false,
    statusText: null,
    lastError: null,
    lastGeneratedAt: null,
  }),
};

const storyboardSplitDefinition: CanvasNodeDefinition<StoryboardSplitNodeData> = {
  type: CANVAS_NODE_TYPES.storyboardSplit,
  menuLabelKey: 'node.menu.storyboardCompose',
  menuIcon: 'layout',
  menuGroup: 'storyboard',
  visibleInMenu: true,
  menuProjectTypes: ['storyboard'],
  capabilities: {
    toolbar: false,
    promptInput: false,
  },
  connectivity: {
    sourceHandle: true,
    targetHandle: true,
    connectMenu: {
      fromSource: true,
      fromTarget: false,
    },
  },
  createDefaultData: () => ({
    displayName: DEFAULT_NODE_DISPLAY_NAME[CANVAS_NODE_TYPES.storyboardSplit],
    sourceNodeId: null,
    aspectRatio: DEFAULT_ASPECT_RATIO,
    frameAspectRatio: DEFAULT_ASPECT_RATIO,
    gridRows: 2,
    gridCols: 2,
    frames: [],
    exportOptions: {
      showFrameIndex: false,
      showFrameNote: false,
      notePlacement: 'overlay',
      imageFit: 'cover',
      frameIndexPrefix: 'S',
      cellGap: 8,
      outerPadding: 0,
      fontSize: 4,
      backgroundColor: '#0f1115',
      textColor: '#f8fafc',
    },
  }),
};

const imageCollageNodeDefinition: CanvasNodeDefinition<ImageCollageNodeData> = {
  type: CANVAS_NODE_TYPES.imageCollage,
  menuLabelKey: 'node.menu.imageCollage',
  menuIcon: 'layout',
  menuGroup: 'storyboard',
  visibleInMenu: true,
  menuProjectTypes: ['storyboard'],
  capabilities: {
    toolbar: false,
    promptInput: false,
  },
  connectivity: {
    sourceHandle: true,
    targetHandle: true,
    connectMenu: {
      fromSource: true,
      fromTarget: false,
    },
  },
  createDefaultData: () => ({
    displayName: DEFAULT_NODE_DISPLAY_NAME[CANVAS_NODE_TYPES.imageCollage],
    aspectRatio: DEFAULT_ASPECT_RATIO,
    size: '1K' as ImageSize,
    layers: [],
    selectedLayerId: null,
    backgroundMode: 'transparent',
  }),
};

const storyboardSplitResultDefinition: CanvasNodeDefinition<StoryboardSplitResultNodeData> = {
  type: CANVAS_NODE_TYPES.storyboardSplitResult,
  menuLabelKey: 'node.menu.storyboardSplitResult',
  menuIcon: 'layout',
  visibleInMenu: false,
  menuProjectTypes: ['storyboard'],
  capabilities: {
    toolbar: false,
    promptInput: false,
  },
  connectivity: {
    sourceHandle: true,
    targetHandle: true,
    connectMenu: {
      fromSource: false,
      fromTarget: false,
    },
  },
  createDefaultData: () => ({
    displayName: DEFAULT_NODE_DISPLAY_NAME[CANVAS_NODE_TYPES.storyboardSplitResult],
    sourceNodeId: null,
    aspectRatio: DEFAULT_ASPECT_RATIO,
    frameAspectRatio: DEFAULT_ASPECT_RATIO,
    gridRows: 2,
    gridCols: 2,
    frames: [],
  }),
};

const storyboardGenNodeDefinition: CanvasNodeDefinition<StoryboardGenNodeData> = {
  type: CANVAS_NODE_TYPES.storyboardGen,
  menuLabelKey: 'node.menu.storyboardGen',
  menuIcon: 'sparkles',
  menuGroup: 'storyboard',
  visibleInMenu: true,
  menuProjectTypes: ['storyboard'],
  capabilities: {
    toolbar: true,
    promptInput: false,
  },
  connectivity: {
    sourceHandle: true,
    targetHandle: true,
    connectMenu: {
      fromSource: true,
      fromTarget: false,
    },
  },
  createDefaultData: () => ({
    displayName: DEFAULT_NODE_DISPLAY_NAME[CANVAS_NODE_TYPES.storyboardGen],
    gridRows: 2,
    gridCols: 2,
    frames: [],
    ratioControlMode: 'cell',
    model: DEFAULT_IMAGE_MODEL_ID,
    size: '2K' as ImageSize,
    requestAspectRatio: AUTO_REQUEST_ASPECT_RATIO,
    extraParams: {},
    imageUrl: null,
    previewImageUrl: null,
    aspectRatio: DEFAULT_ASPECT_RATIO,
    isGenerating: false,
    generationStartedAt: null,
    generationDurationMs: 60000,
  }),
};

const assetMaterialNodeDefinition: CanvasNodeDefinition<AssetMaterialNodeData> = {
  type: CANVAS_NODE_TYPES.assetMaterial,
  menuLabelKey: 'node.menu.assetMaterial',
  menuIcon: 'link',
  menuGroup: 'storyboard',
  visibleInMenu: true,
  menuProjectTypes: ['storyboard'],
  capabilities: {
    toolbar: true,
    promptInput: false,
  },
  connectivity: {
    sourceHandle: true,
    targetHandle: false,
    connectMenu: {
      fromSource: true,
      fromTarget: false,
    },
  },
  createDefaultData: () => ({
    displayName: DEFAULT_NODE_DISPLAY_NAME[CANVAS_NODE_TYPES.assetMaterial],
    assetLibraryId: null,
    selectedAssetIds: [],
    sourceStoryboardTableNodeId: null,
    sourceStoryboardRowIds: [],
    sourceDurationGroupId: null,
    defaultMatchedAssetNames: [],
    displayMode: 'nameOnlyAccordion',
    outputMode: 'namedReference',
  }),
};

const videoNodeDefinition: CanvasNodeDefinition<VideoNodeData> = {
  type: CANVAS_NODE_TYPES.video,
  menuLabelKey: 'node.menu.videoNode',
  menuIcon: 'video',
  menuGroup: 'media',
  visibleInMenu: true,
  menuProjectTypes: ['storyboard'],
  capabilities: {
    toolbar: true,
    promptInput: false,
  },
  connectivity: {
    sourceHandle: true,
    targetHandle: true,
    connectMenu: {
      fromSource: false,
      fromTarget: true,
    },
  },
  createDefaultData: () => ({
    displayName: DEFAULT_NODE_DISPLAY_NAME[CANVAS_NODE_TYPES.video],
    videoUrl: null,
    previewImageUrl: null,
    videoFileName: null,
    aspectRatio: '16:9',
    isSizeManuallyAdjusted: false,
  }),
};

const seedanceNodeDefinition: CanvasNodeDefinition<SeedanceNodeData> = {
  type: CANVAS_NODE_TYPES.seedance,
  menuLabelKey: 'node.menu.seedanceVideo',
  menuIcon: 'sparkles',
  menuGroup: 'jimeng',
  visibleInMenu: true,
  menuProjectTypes: ['storyboard'],
  capabilities: {
    toolbar: true,
    promptInput: false,
  },
  connectivity: {
    sourceHandle: true,
    targetHandle: true,
    connectMenu: {
      fromSource: true,
      fromTarget: false,
    },
  },
  createDefaultData: () => ({
    displayName: DEFAULT_NODE_DISPLAY_NAME[CANVAS_NODE_TYPES.seedance],
    prompt: '',
    inputMode: SEEDANCE_INPUT_MODES[0],
    modelId: SEEDANCE_MODEL_IDS[0],
    aspectRatio: SEEDANCE_ASPECT_RATIOS[0],
    durationSeconds: SEEDANCE_DURATION_SECONDS[2],
    resolution: SEEDANCE_RESOLUTIONS[1],
    generateAudio: true,
    returnLastFrame: false,
    isSubmitting: false,
    lastSubmittedAt: null,
    lastError: null,
  }),
};

const seedanceVideoResultNodeDefinition: CanvasNodeDefinition<SeedanceVideoResultNodeData> = {
  type: CANVAS_NODE_TYPES.seedanceVideoResult,
  menuLabelKey: 'node.menu.seedanceVideoResult',
  menuIcon: 'video',
  menuGroup: 'media',
  visibleInMenu: false,
  menuProjectTypes: ['storyboard'],
  capabilities: {
    toolbar: true,
    promptInput: false,
  },
  connectivity: {
    sourceHandle: true,
    targetHandle: true,
    connectMenu: {
      fromSource: false,
      fromTarget: false,
    },
  },
  createDefaultData: () => ({
    displayName: DEFAULT_NODE_DISPLAY_NAME[CANVAS_NODE_TYPES.seedanceVideoResult],
    sourceNodeId: null,
    taskId: null,
    taskStatus: null,
    taskUpdatedAt: null,
    modelId: SEEDANCE_MODEL_IDS[0],
    inputMode: SEEDANCE_INPUT_MODES[0],
    videoUrl: null,
    previewImageUrl: null,
    videoFileName: null,
    aspectRatio: SEEDANCE_ASPECT_RATIOS[0],
    resolution: SEEDANCE_RESOLUTIONS[1],
    duration: undefined,
    generateAudio: true,
    returnLastFrame: false,
    isGenerating: false,
    generationStartedAt: null,
    generationDurationMs: 180000,
    lastGeneratedAt: null,
    lastError: null,
  }),
};

const jimengImageNodeDefinition: CanvasNodeDefinition<JimengImageNodeData> = {
  type: CANVAS_NODE_TYPES.jimengImage,
  menuLabelKey: 'node.menu.jimengImage',
  menuIcon: 'sparkles',
  menuGroup: 'jimeng',
  visibleInMenu: true,
  menuProjectTypes: ['storyboard'],
  capabilities: {
    toolbar: true,
    promptInput: false,
  },
  connectivity: {
    sourceHandle: true,
    targetHandle: true,
    connectMenu: {
      fromSource: true,
      fromTarget: false,
    },
  },
  createDefaultData: () => ({
    displayName: DEFAULT_NODE_DISPLAY_NAME[CANVAS_NODE_TYPES.jimengImage],
    prompt: '',
    modelVersion: JIMENG_IMAGE_MODEL_VERSIONS[6],
    aspectRatio: JIMENG_ASPECT_RATIOS[3],
    resolutionType: JIMENG_IMAGE_RESOLUTION_TYPES[1],
    cameraParams: null,
    isGenerating: false,
    generationStartedAt: null,
    generationDurationMs: 90000,
    lastGeneratedAt: null,
    lastError: null,
    resultImages: [],
  }),
};

const mjNodeDefinition: CanvasNodeDefinition<MjNodeData> = {
  type: CANVAS_NODE_TYPES.mj,
  menuLabelKey: 'node.menu.midjourney',
  menuIcon: 'sparkles',
  menuGroup: 'imageGeneration',
  visibleInMenu: true,
  menuProjectTypes: ['storyboard'],
  capabilities: {
    toolbar: true,
    promptInput: false,
  },
  connectivity: {
    sourceHandle: true,
    targetHandle: true,
    connectMenu: {
      fromSource: true,
      fromTarget: false,
    },
  },
  createDefaultData: () => ({
    displayName: DEFAULT_NODE_DISPLAY_NAME[CANVAS_NODE_TYPES.mj],
    prompt: '',
    linkedResultNodeId: null,
    references: [],
    aspectRatio: MIDJOURNEY_ASPECT_RATIOS[0],
    rawMode: false,
    versionPreset: MIDJOURNEY_VERSION_PRESETS[0],
    personalizationCodes: [],
    advancedParams: '',
    isSubmitting: false,
    activeTaskId: null,
    lastSubmittedAt: null,
    lastError: null,
  }),
};

const mjResultNodeDefinition: CanvasNodeDefinition<MjResultNodeData> = {
  type: CANVAS_NODE_TYPES.mjResult,
  menuLabelKey: 'node.menu.midjourneyResult',
  menuIcon: 'layout',
  visibleInMenu: false,
  menuProjectTypes: ['storyboard'],
  capabilities: {
    toolbar: true,
    promptInput: false,
  },
  connectivity: {
    sourceHandle: true,
    targetHandle: true,
    connectMenu: {
      fromSource: false,
      fromTarget: false,
    },
  },
  createDefaultData: () => ({
    displayName: DEFAULT_NODE_DISPLAY_NAME[CANVAS_NODE_TYPES.mjResult],
    sourceNodeId: null,
    nodeRole: 'root',
    rootSourceNodeId: null,
    parentResultNodeId: null,
    parentBatchId: null,
    sourceImageIndex: null,
    branchKey: null,
    branchActionLabel: null,
    batches: [],
    activeBatchId: null,
    lastError: null,
    lastGeneratedAt: null,
  }),
};

const jimengImageResultNodeDefinition: CanvasNodeDefinition<JimengImageResultNodeData> = {
  type: CANVAS_NODE_TYPES.jimengImageResult,
  menuLabelKey: 'node.menu.jimengImageResult',
  menuIcon: 'layout',
  visibleInMenu: false,
  menuProjectTypes: ['storyboard'],
  capabilities: {
    toolbar: true,
    promptInput: false,
  },
  connectivity: {
    sourceHandle: true,
    targetHandle: true,
    connectMenu: {
      fromSource: false,
      fromTarget: false,
    },
  },
  createDefaultData: () => ({
    displayName: DEFAULT_NODE_DISPLAY_NAME[CANVAS_NODE_TYPES.jimengImageResult],
    sourceNodeId: null,
    submitIds: [],
    prompt: null,
    modelVersion: '5.0',
    resolutionType: '2k',
    referenceImageCount: 0,
    aspectRatio: DEFAULT_ASPECT_RATIO,
    gridRows: 2,
    gridCols: 2,
    resultImages: [],
    isGenerating: false,
    generationStartedAt: null,
    generationDurationMs: 90000,
    lastGeneratedAt: null,
    lastError: null,
  }),
};

const jimengVideoResultNodeDefinition: CanvasNodeDefinition<JimengVideoResultNodeData> = {
  type: CANVAS_NODE_TYPES.jimengVideoResult,
  menuLabelKey: 'node.menu.jimengVideoResult',
  menuIcon: 'video',
  visibleInMenu: false,
  menuProjectTypes: ['storyboard'],
  capabilities: {
    toolbar: true,
    promptInput: false,
  },
  connectivity: {
    sourceHandle: true,
    targetHandle: true,
    connectMenu: {
      fromSource: false,
      fromTarget: false,
    },
  },
  createDefaultData: () => ({
    displayName: DEFAULT_NODE_DISPLAY_NAME[CANVAS_NODE_TYPES.jimengVideoResult],
    sourceNodeId: null,
    queueJobId: null,
    queueStatus: null,
    queueScheduledAt: null,
    queueAttemptCount: 0,
    queueMaxAttempts: 3,
    submitId: null,
    sourceUrl: null,
    posterSourceUrl: null,
    videoUrl: null,
    previewImageUrl: null,
    videoFileName: null,
    aspectRatio: '16:9',
    duration: undefined,
    width: undefined,
    height: undefined,
    autoRequeryEnabled: false,
    autoRequeryIntervalSeconds: 900,
    isGenerating: false,
    generationStartedAt: null,
    generationDurationMs: 90000,
    lastGeneratedAt: null,
    lastError: null,
  }),
};

const audioNodeDefinition: CanvasNodeDefinition<AudioNodeData> = {
  type: CANVAS_NODE_TYPES.audio,
  menuLabelKey: 'node.menu.audioNode',
  menuIcon: 'audio',
  menuGroup: 'media',
  visibleInMenu: true,
  menuProjectTypes: ['storyboard'],
  capabilities: {
    toolbar: true,
    promptInput: false,
  },
  connectivity: {
    sourceHandle: true,
    targetHandle: true,
    connectMenu: {
      fromSource: false,
      fromTarget: true,
    },
  },
  createDefaultData: () => ({
    displayName: DEFAULT_NODE_DISPLAY_NAME[CANVAS_NODE_TYPES.audio],
    audioUrl: null,
    previewImageUrl: null,
    audioFileName: null,
    duration: undefined,
    mimeType: null,
    generationSource: null,
    sourceNodeId: null,
    isGenerating: false,
    generationProgress: 0,
    queuePosition: null,
    statusText: null,
    lastError: null,
    lastGeneratedAt: null,
  }),
};

const ttsTextNodeDefinition: CanvasNodeDefinition<TtsTextNodeData> = {
  type: CANVAS_NODE_TYPES.ttsText,
  menuLabelKey: 'node.menu.ttsText',
  menuIcon: 'text',
  menuGroup: 'text',
  visibleInMenu: false,
  menuProjectTypes: ['storyboard'],
  capabilities: {
    toolbar: true,
    promptInput: false,
  },
  connectivity: {
    sourceHandle: true,
    targetHandle: true,
    connectMenu: {
      fromSource: false,
      fromTarget: false,
    },
  },
  createDefaultData: () => ({
    displayName: DEFAULT_NODE_DISPLAY_NAME[CANVAS_NODE_TYPES.ttsText],
    content: '',
  }),
};

const ttsVoiceDesignNodeDefinition: CanvasNodeDefinition<TtsVoiceDesignNodeData> = {
  type: CANVAS_NODE_TYPES.ttsVoiceDesign,
  menuLabelKey: 'node.menu.ttsVoiceDesign',
  menuIcon: 'audio',
  menuGroup: 'extensionPackage',
  visibleInMenu: true,
  menuProjectTypes: ['storyboard'],
  requiredExtensionIds: [
    QWEN_TTS_SIMPLE_EXTENSION_ID,
    QWEN_TTS_COMPLETE_EXTENSION_ID,
  ],
  capabilities: {
    toolbar: true,
    promptInput: false,
  },
  connectivity: {
    sourceHandle: true,
    targetHandle: true,
    connectMenu: {
      fromSource: true,
      fromTarget: false,
    },
  },
  createDefaultData: () => ({
    displayName: DEFAULT_NODE_DISPLAY_NAME[CANVAS_NODE_TYPES.ttsVoiceDesign],
    voicePrompt: '',
    stylePreset: 'natural',
    language: 'auto',
    outputFormat: 'wav',
    speakingRate: 1,
    pitch: 0,
    maxNewTokens: 2048,
    topP: 0.8,
    topK: 20,
    temperature: 1,
    repetitionPenalty: 1.05,
    pauseLinebreak: 0.5,
    periodPause: 0.4,
    commaPause: 0.2,
    questionPause: 0.6,
    hyphenPause: 0.3,
    isGenerating: false,
    generationProgress: 0,
    statusText: null,
    lastError: null,
    lastGeneratedAt: null,
  }),
};

const ttsSavedVoiceNodeDefinition: CanvasNodeDefinition<TtsSavedVoiceNodeData> = {
  type: CANVAS_NODE_TYPES.ttsSavedVoice,
  menuLabelKey: 'node.menu.ttsSavedVoice',
  menuIcon: 'audio',
  menuGroup: 'extensionPackage',
  visibleInMenu: true,
  menuProjectTypes: ['storyboard'],
  requiredExtensionIds: [
    QWEN_TTS_SIMPLE_EXTENSION_ID,
    QWEN_TTS_COMPLETE_EXTENSION_ID,
  ],
  capabilities: {
    toolbar: true,
    promptInput: false,
  },
  connectivity: {
    sourceHandle: true,
    targetHandle: true,
    connectMenu: {
      fromSource: true,
      fromTarget: false,
    },
  },
  createDefaultData: () => ({
    displayName: DEFAULT_NODE_DISPLAY_NAME[CANVAS_NODE_TYPES.ttsSavedVoice],
    presetAssetId: null,
    voiceName: '',
    referenceTranscript: '',
    promptFile: null,
    promptLabel: null,
    language: 'auto',
    outputFormat: 'wav',
    maxNewTokens: 2048,
    topP: 0.8,
    topK: 20,
    temperature: 1,
    repetitionPenalty: 1.05,
    pauseLinebreak: 0.5,
    periodPause: 0.4,
    commaPause: 0.2,
    questionPause: 0.6,
    hyphenPause: 0.3,
    isExtracting: false,
    isGenerating: false,
    generationProgress: 0,
    statusText: null,
    lastError: null,
    lastSavedAt: null,
    lastGeneratedAt: null,
  }),
};

const voxCpmVoiceDesignNodeDefinition: CanvasNodeDefinition<VoxCpmVoiceDesignNodeData> = {
  type: CANVAS_NODE_TYPES.voxCpmVoiceDesign,
  menuLabelKey: 'node.menu.voxCpmVoiceDesign',
  menuIcon: 'audio',
  menuGroup: 'extensionPackage',
  visibleInMenu: true,
  menuProjectTypes: ['storyboard'],
  requiredExtensionId: VOXCPM2_COMPLETE_EXTENSION_ID,
  capabilities: {
    toolbar: true,
    promptInput: false,
  },
  connectivity: {
    sourceHandle: true,
    targetHandle: true,
    connectMenu: {
      fromSource: true,
      fromTarget: false,
    },
  },
  createDefaultData: () => ({
    displayName: DEFAULT_NODE_DISPLAY_NAME[CANVAS_NODE_TYPES.voxCpmVoiceDesign],
    voicePrompt: '',
    cfgValue: 2.0,
    inferenceTimesteps: 10,
    normalize: false,
    denoise: false,
    isGenerating: false,
    generationProgress: 0,
    statusText: null,
    lastError: null,
    lastGeneratedAt: null,
  }),
};

const voxCpmVoiceCloneNodeDefinition: CanvasNodeDefinition<VoxCpmVoiceCloneNodeData> = {
  type: CANVAS_NODE_TYPES.voxCpmVoiceClone,
  menuLabelKey: 'node.menu.voxCpmVoiceClone',
  menuIcon: 'audio',
  menuGroup: 'extensionPackage',
  visibleInMenu: true,
  menuProjectTypes: ['storyboard'],
  requiredExtensionId: VOXCPM2_COMPLETE_EXTENSION_ID,
  capabilities: {
    toolbar: true,
    promptInput: false,
  },
  connectivity: {
    sourceHandle: true,
    targetHandle: true,
    connectMenu: {
      fromSource: true,
      fromTarget: false,
    },
  },
  createDefaultData: () => ({
    displayName: DEFAULT_NODE_DISPLAY_NAME[CANVAS_NODE_TYPES.voxCpmVoiceClone],
    presetAssetId: null,
    referenceAssetId: null,
    controlText: '',
    cfgValue: 2.0,
    inferenceTimesteps: 10,
    normalize: false,
    denoise: false,
    isGenerating: false,
    generationProgress: 0,
    statusText: null,
    lastError: null,
    lastGeneratedAt: null,
  }),
};

const voxCpmUltimateCloneNodeDefinition: CanvasNodeDefinition<VoxCpmUltimateCloneNodeData> = {
  type: CANVAS_NODE_TYPES.voxCpmUltimateClone,
  menuLabelKey: 'node.menu.voxCpmUltimateClone',
  menuIcon: 'audio',
  menuGroup: 'extensionPackage',
  visibleInMenu: true,
  menuProjectTypes: ['storyboard'],
  requiredExtensionId: VOXCPM2_COMPLETE_EXTENSION_ID,
  capabilities: {
    toolbar: true,
    promptInput: false,
  },
  connectivity: {
    sourceHandle: true,
    targetHandle: true,
    connectMenu: {
      fromSource: true,
      fromTarget: false,
    },
  },
  createDefaultData: () => ({
    displayName: DEFAULT_NODE_DISPLAY_NAME[CANVAS_NODE_TYPES.voxCpmUltimateClone],
    presetAssetId: null,
    referenceAssetId: null,
    promptText: '',
    useReferenceAsReference: true,
    cfgValue: 2.0,
    inferenceTimesteps: 10,
    normalize: false,
    denoise: false,
    isGenerating: false,
    generationProgress: 0,
    statusText: null,
    lastError: null,
    lastGeneratedAt: null,
  }),
};

const adProjectRootNodeDefinition: CanvasNodeDefinition<AdProjectRootNodeData> = {
  type: CANVAS_NODE_TYPES.adProjectRoot,
  menuLabelKey: 'project.types.ad',
  menuIcon: 'layout',
  visibleInMenu: false,
  menuProjectTypes: ['ad'],
  capabilities: {
    toolbar: false,
    promptInput: false,
  },
  connectivity: {
    sourceHandle: false,
    targetHandle: false,
    connectMenu: {
      fromSource: false,
      fromTarget: false,
    },
  },
  createDefaultData: () => ({
    displayName: DEFAULT_NODE_DISPLAY_NAME[CANVAS_NODE_TYPES.adProjectRoot],
    ...createDefaultAdProjectRootState(),
  }),
};

const commerceProductNodeDefinition: CanvasNodeDefinition<CommerceProductNodeData> = {
  type: CANVAS_NODE_TYPES.commerceProduct,
  menuLabelKey: 'commerceAd.nodes.product',
  menuIcon: 'package',
  visibleInMenu: false,
  menuProjectTypes: ['commerceAd'],
  capabilities: {
    toolbar: true,
    promptInput: false,
  },
  connectivity: {
    sourceHandle: true,
    targetHandle: false,
    connectMenu: {
      fromSource: false,
      fromTarget: false,
    },
  },
  createDefaultData: () => ({
    displayName: DEFAULT_NODE_DISPLAY_NAME[CANVAS_NODE_TYPES.commerceProduct],
    ...createDefaultCommerceAdProductState(),
  }),
};

const commerceBriefNodeDefinition: CanvasNodeDefinition<CommerceBriefNodeData> = {
  type: CANVAS_NODE_TYPES.commerceBrief,
  menuLabelKey: 'commerceAd.nodes.brief',
  menuIcon: 'text',
  visibleInMenu: false,
  menuProjectTypes: ['commerceAd'],
  capabilities: {
    toolbar: true,
    promptInput: false,
  },
  connectivity: {
    sourceHandle: true,
    targetHandle: true,
    connectMenu: {
      fromSource: false,
      fromTarget: false,
    },
  },
  createDefaultData: () => ({
    displayName: DEFAULT_NODE_DISPLAY_NAME[CANVAS_NODE_TYPES.commerceBrief],
    ...createDefaultCommerceAdBriefState(),
  }),
};

const commerceBatchGenerateNodeDefinition: CanvasNodeDefinition<CommerceBatchGenerateNodeData> = {
  type: CANVAS_NODE_TYPES.commerceBatchGenerate,
  menuLabelKey: 'commerceAd.nodes.batch',
  menuIcon: 'sparkles',
  visibleInMenu: false,
  menuProjectTypes: ['commerceAd'],
  capabilities: {
    toolbar: true,
    promptInput: false,
  },
  connectivity: {
    sourceHandle: true,
    targetHandle: true,
    connectMenu: {
      fromSource: false,
      fromTarget: false,
    },
  },
  createDefaultData: () => ({
    displayName: DEFAULT_NODE_DISPLAY_NAME[CANVAS_NODE_TYPES.commerceBatchGenerate],
    ...createDefaultCommerceAdBatchGenerateState(),
  }),
};

const commerceResultGroupNodeDefinition: CanvasNodeDefinition<CommerceResultGroupNodeData> = {
  type: CANVAS_NODE_TYPES.commerceResultGroup,
  menuLabelKey: 'commerceAd.nodes.results',
  menuIcon: 'layout',
  visibleInMenu: false,
  menuProjectTypes: ['commerceAd'],
  capabilities: {
    toolbar: true,
    promptInput: false,
  },
  connectivity: {
    sourceHandle: false,
    targetHandle: true,
    connectMenu: {
      fromSource: false,
      fromTarget: false,
    },
  },
  createDefaultData: () => ({
    displayName: DEFAULT_NODE_DISPLAY_NAME[CANVAS_NODE_TYPES.commerceResultGroup],
    ...createDefaultCommerceAdResultGroupState(),
  }),
};

const scriptRootNodeDefinition: CanvasNodeDefinition<ScriptRootNodeData> = {
  type: CANVAS_NODE_TYPES.scriptRoot,
  menuLabelKey: 'node.menu.scriptRoot',
  menuIcon: 'text',
  visibleInMenu: false,
  menuProjectTypes: ['script'],
  capabilities: {
    toolbar: false,
    promptInput: false,
  },
  connectivity: {
    sourceHandle: true,
    targetHandle: false,
    connectMenu: {
      fromSource: true,
      fromTarget: false,
    },
  },
  createDefaultData: () => ({
    displayName: DEFAULT_NODE_DISPLAY_NAME[CANVAS_NODE_TYPES.scriptRoot] || '剧本',
    title: '',
    genre: '',
    totalChapters: 0,
    premise: '',
    theme: '',
    protagonist: '',
    want: '',
    need: '',
    stakes: '',
    tone: '',
    directorVision: '',
    beats: [],
    assetLibraryCharacters: [],
    assetLibraryLocations: [],
    assetLibraryItems: [],
  }),
};

const scriptChapterNodeDefinition: CanvasNodeDefinition<ScriptChapterNodeData> = {
  type: CANVAS_NODE_TYPES.scriptChapter,
  menuLabelKey: 'node.menu.scriptChapter',
  menuIcon: 'text',
  visibleInMenu: true,
  menuProjectTypes: ['script'],
  capabilities: {
    toolbar: true,
    promptInput: false,
  },
  connectivity: {
    sourceHandle: true,
    targetHandle: true,
    connectMenu: {
      fromSource: true,
      fromTarget: true,
    },
  },
  createDefaultData: () => ({
    displayName: DEFAULT_NODE_DISPLAY_NAME[CANVAS_NODE_TYPES.scriptChapter] || '章节',
    chapterNumber: 1,
    title: '',
    content: '',
    summary: '',
    chapterPurpose: '',
    chapterQuestion: '',
    sceneHeadings: [],
    scenes: [createDefaultSceneCard(0)],
    characters: [],
    locations: [],
    items: [],
    emotionalShift: '',
    isBranchPoint: false,
    branchType: 'main',
    tables: [],
    plotPoints: [],
  }),
};

const scriptSceneNodeDefinition: CanvasNodeDefinition<ScriptSceneNodeData> = {
  type: CANVAS_NODE_TYPES.scriptScene,
  menuLabelKey: 'node.menu.scriptScene',
  menuIcon: 'text',
  visibleInMenu: false,
  menuProjectTypes: ['script'],
  capabilities: {
    toolbar: true,
    promptInput: false,
  },
  connectivity: {
    sourceHandle: true,
    targetHandle: true,
    connectMenu: {
      fromSource: false,
      fromTarget: false,
    },
  },
  createDefaultData: () => ({
    displayName: DEFAULT_NODE_DISPLAY_NAME[CANVAS_NODE_TYPES.scriptScene] || '分集工作台',
    sourceChapterId: '',
    sourceSceneId: '',
    sourceSceneOrder: 0,
    chapterNumber: 1,
    title: '',
    summary: '',
    purpose: '',
    povCharacter: '',
    goal: '',
    conflict: '',
    turn: '',
    emotionalShift: '',
    visualHook: '',
    subtext: '',
    sourceDraftHtml: '',
    draftHtml: '',
    episodes: [],
  }),
};

const shootingScriptNodeDefinition: CanvasNodeDefinition<ShootingScriptNodeData> = {
  type: CANVAS_NODE_TYPES.shootingScript,
  menuLabelKey: 'node.menu.shootingScript',
  menuIcon: 'layout',
  visibleInMenu: false,
  menuProjectTypes: ['script'],
  capabilities: {
    toolbar: true,
    promptInput: false,
  },
  connectivity: {
    sourceHandle: false,
    targetHandle: true,
    connectMenu: {
      fromSource: false,
      fromTarget: false,
    },
  },
  createDefaultData: () => ({
    displayName: DEFAULT_NODE_DISPLAY_NAME[CANVAS_NODE_TYPES.shootingScript] || '拍摄脚本',
    sourceChapterId: '',
    sourceSceneNodeId: '',
    sourceEpisodeId: '',
    chapterNumber: 1,
    sceneNumber: 1,
    sceneTitle: '',
    episodeNumber: 1,
    episodeTitle: '',
    rows: [],
    status: 'empty',
    lastGeneratedAt: null,
    lastError: null,
    sourceSnapshot: null,
  }),
};

const scriptAssetExtractNodeDefinition: CanvasNodeDefinition<ScriptAssetExtractNodeData> = {
  type: CANVAS_NODE_TYPES.scriptAssetExtract,
  menuLabelKey: 'node.menu.scriptAssetExtract',
  menuIcon: 'package',
  menuGroup: 'text',
  visibleInMenu: true,
  menuProjectTypes: ['script'],
  capabilities: {
    toolbar: true,
    promptInput: false,
  },
  connectivity: {
    sourceHandle: true,
    targetHandle: true,
    connectMenu: {
      fromSource: false,
      fromTarget: false,
    },
  },
  createDefaultData: () => ({
    displayName: DEFAULT_NODE_DISPLAY_NAME[CANVAS_NODE_TYPES.scriptAssetExtract],
    presentationMode: 'editable',
    expansionSource: null,
    sourceMode: 'chapterSelection',
    selectedChapterIds: [],
    resolvedSourceSnapshot: null,
    extractionResult: null,
    extractionState: {
      requestId: null,
      phase: 'idle',
      statusText: null,
      lastError: null,
      lastGeneratedAt: null,
    },
    expandedGroupNodeIds: [],
    lastExpandedAt: null,
  }),
};

const smartDirectorStoryboardNodeDefinition: CanvasNodeDefinition<SmartDirectorStoryboardNodeData> = {
  type: CANVAS_NODE_TYPES.smartDirectorStoryboard,
  menuLabelKey: 'node.menu.smartDirectorStoryboard',
  menuIcon: 'sparkles',
  menuGroup: 'text',
  visibleInMenu: true,
  menuProjectTypes: ['script'],
  capabilities: {
    toolbar: true,
    promptInput: false,
  },
  connectivity: {
    sourceHandle: true,
    targetHandle: true,
    connectMenu: {
      fromSource: false,
      fromTarget: false,
    },
  },
  createDefaultData: () => ({
    displayName: DEFAULT_NODE_DISPLAY_NAME[CANVAS_NODE_TYPES.smartDirectorStoryboard],
    presentationMode: 'editable',
    expansionSource: null,
    sourceAssetExtractNodeId: null,
    resolvedSourceSnapshot: null,
    generationState: {
      requestId: null,
      phase: 'idle',
      statusText: null,
      lastError: null,
      lastGeneratedAt: null,
    },
    activeResultNodeId: null,
    generatedResultNodeIds: [],
    result: null,
    linkedStoryboardProjectId: null,
    storyboardTransferStatus: 'idle',
    storyboardTransferSnapshot: null,
  }),
};

const scriptStoryboardTableNodeDefinition: CanvasNodeDefinition<ScriptStoryboardTableNodeData> = {
  type: CANVAS_NODE_TYPES.scriptStoryboardTable,
  menuLabelKey: 'node.menu.scriptStoryboardTable',
  menuIcon: 'layout',
  menuGroup: 'text',
  visibleInMenu: false,
  menuProjectTypes: ['script'],
  capabilities: {
    toolbar: true,
    promptInput: false,
  },
  connectivity: {
    sourceHandle: true,
    targetHandle: true,
    connectMenu: {
      fromSource: false,
      fromTarget: false,
    },
  },
  createDefaultData: () => ({
    displayName: DEFAULT_NODE_DISPLAY_NAME[CANVAS_NODE_TYPES.scriptStoryboardTable],
    presentationMode: 'editable',
    expansionSource: null,
    sourceSmartDirectorStoryboardNodeId: null,
    sourceAssetExtractNodeId: null,
    sourceSnapshotVersion: null,
    sourceLabel: null,
    tableSchema: [],
    rows: [],
    summary: {
      rowCount: 0,
      generatedRowCount: 0,
      totalDurationSeconds: 0,
      continuousGroupCount: 0,
      groups10sCount: 0,
      groups15sCount: 0,
      lastUpdatedAt: null,
    },
    streamState: {
      requestId: null,
      phase: 'idle',
      statusText: null,
      error: null,
      activeRowId: null,
      completedRowCount: 0,
      totalRowCount: 0,
      lastEventAt: null,
    },
    rowHeight: 72,
    visibleColumnKeys: [
      'sceneNumber',
      'shotNumber',
      'sketch',
      'shotSize',
      'cameraAngle',
      'cameraMovement',
      'blockingAction',
      'dialogueOrSound',
      'duration',
      'assets',
      'imagePrompt',
      'remark',
    ],
    activeEditingCell: null,
    manualEditVersion: 0,
    manuallyEditedRowIds: [],
    storyboardProductionMode: 'none',
    continuousReferenceEnabled: false,
    productionImageModelId: DEFAULT_IMAGE_MODEL_ID,
    productionImageSize: '2K' as ImageSize,
    productionImageAspectRatio: AUTO_REQUEST_ASPECT_RATIO,
    productionStyleTemplateId: null,
    productionStyleTemplateName: null,
    productionStyleTemplatePrompt: null,
    productionSketchStylePrompt: undefined,
    expandedProductionGroupNodeIds: [],
    linkedStoryboardProjectId: null,
    storyboardTransferStatus: 'idle',
    storyboardTransferSnapshot: null,
  }),
};

const directorStoryboardReferenceNodeDefinition: CanvasNodeDefinition<DirectorStoryboardReferenceNodeData> = {
  type: CANVAS_NODE_TYPES.directorStoryboardReference,
  menuLabelKey: 'node.menu.directorStoryboardReference',
  menuIcon: 'link',
  menuGroup: 'scriptReference',
  visibleInMenu: false,
  menuProjectTypes: ['storyboard'],
  capabilities: {
    toolbar: true,
    promptInput: false,
  },
  connectivity: {
    sourceHandle: true,
    targetHandle: true,
    connectMenu: {
      fromSource: false,
      fromTarget: false,
    },
  },
  createDefaultData: () => ({
    displayName: DEFAULT_NODE_DISPLAY_NAME[CANVAS_NODE_TYPES.directorStoryboardReference],
    linkedScriptProjectId: null,
    directorStoryboardSourceProjectId: null,
    directorStoryboardSourceNodeId: null,
    directorStoryboardSourceVersion: null,
    directorStoryboardSnapshot: null,
    directorStoryboardOverrides: createEmptyDirectorStoryboardOverrides(),
    referenceContext: null,
    productionQueue: createEmptyProductionQueueState(),
    syncStatus: 'idle',
    syncMessage: null,
    lastSyncedAt: null,
  }),
};

const scriptReferenceNodeDefinition: CanvasNodeDefinition<ScriptReferenceNodeData> = {
  type: CANVAS_NODE_TYPES.scriptReference,
  menuLabelKey: 'node.menu.scriptReference',
  menuIcon: 'link',
  menuGroup: 'scriptReference',
  visibleInMenu: true,
  menuProjectTypes: ['storyboard'],
  capabilities: {
    toolbar: true,
    promptInput: false,
  },
  connectivity: {
    sourceHandle: true,
    targetHandle: true,
    connectMenu: {
      fromSource: true,
      fromTarget: false,
    },
  },
  createDefaultData: () => ({
    displayName: DEFAULT_NODE_DISPLAY_NAME[CANVAS_NODE_TYPES.scriptReference] || 'Script Reference',
    linkedScriptProjectId: null,
    referencedChapterId: null,
    referencedSceneNodeId: null,
    referencedEpisodeId: null,
    referencedScriptNodeId: null,
    selectedRowIds: [],
    scriptSnapshot: null,
    syncStatus: 'idle',
    syncMessage: null,
    lastSyncedAt: null,
  }),
};

const adScriptReferenceNodeDefinition: CanvasNodeDefinition<AdScriptReferenceNodeData> = {
  type: CANVAS_NODE_TYPES.adScriptReference,
  menuLabelKey: 'node.menu.adScriptReference',
  menuIcon: 'link',
  menuGroup: 'scriptReference',
  visibleInMenu: true,
  menuProjectTypes: ['storyboard'],
  capabilities: {
    toolbar: true,
    promptInput: false,
  },
  connectivity: {
    sourceHandle: true,
    targetHandle: true,
    connectMenu: {
      fromSource: true,
      fromTarget: false,
    },
  },
  createDefaultData: () => ({
    displayName: DEFAULT_NODE_DISPLAY_NAME[CANVAS_NODE_TYPES.adScriptReference] || 'Ad Script Reference',
    linkedAdProjectId: null,
    selectedRowIds: [],
    scriptSnapshot: null,
    syncStatus: 'idle',
    syncMessage: null,
    lastSyncedAt: null,
  }),
};

const scriptCharacterReferenceNodeDefinition: CanvasNodeDefinition<ScriptCharacterReferenceNodeData> = {
  type: CANVAS_NODE_TYPES.scriptCharacterReference,
  menuLabelKey: 'node.menu.scriptCharacterReference',
  menuIcon: 'link',
  menuGroup: 'scriptReference',
  visibleInMenu: true,
  menuProjectTypes: ['storyboard'],
  capabilities: {
    toolbar: true,
    promptInput: false,
  },
  connectivity: {
    sourceHandle: true,
    targetHandle: true,
    connectMenu: {
      fromSource: true,
      fromTarget: false,
    },
  },
  createDefaultData: () => ({
    displayName: DEFAULT_NODE_DISPLAY_NAME[CANVAS_NODE_TYPES.scriptCharacterReference] || '角色引用',
    linkedScriptProjectId: null,
    referencedAssetName: null,
    assetSnapshot: null,
    syncStatus: 'idle',
    syncMessage: null,
    lastSyncedAt: null,
  }),
};

const scriptLocationReferenceNodeDefinition: CanvasNodeDefinition<ScriptLocationReferenceNodeData> = {
  type: CANVAS_NODE_TYPES.scriptLocationReference,
  menuLabelKey: 'node.menu.scriptLocationReference',
  menuIcon: 'link',
  menuGroup: 'scriptReference',
  visibleInMenu: true,
  menuProjectTypes: ['storyboard'],
  capabilities: {
    toolbar: true,
    promptInput: false,
  },
  connectivity: {
    sourceHandle: true,
    targetHandle: true,
    connectMenu: {
      fromSource: true,
      fromTarget: false,
    },
  },
  createDefaultData: () => ({
    displayName: DEFAULT_NODE_DISPLAY_NAME[CANVAS_NODE_TYPES.scriptLocationReference] || '场景引用',
    linkedScriptProjectId: null,
    referencedAssetName: null,
    assetSnapshot: null,
    syncStatus: 'idle',
    syncMessage: null,
    lastSyncedAt: null,
  }),
};

const scriptItemReferenceNodeDefinition: CanvasNodeDefinition<ScriptItemReferenceNodeData> = {
  type: CANVAS_NODE_TYPES.scriptItemReference,
  menuLabelKey: 'node.menu.scriptItemReference',
  menuIcon: 'link',
  menuGroup: 'scriptReference',
  visibleInMenu: true,
  menuProjectTypes: ['storyboard'],
  capabilities: {
    toolbar: true,
    promptInput: false,
  },
  connectivity: {
    sourceHandle: true,
    targetHandle: true,
    connectMenu: {
      fromSource: true,
      fromTarget: false,
    },
  },
  createDefaultData: () => ({
    displayName: DEFAULT_NODE_DISPLAY_NAME[CANVAS_NODE_TYPES.scriptItemReference] || '道具引用',
    linkedScriptProjectId: null,
    referencedAssetName: null,
    assetSnapshot: null,
    syncStatus: 'idle',
    syncMessage: null,
    lastSyncedAt: null,
  }),
};

const scriptCharacterNodeDefinition: CanvasNodeDefinition<ScriptCharacterNodeData> = {
  type: CANVAS_NODE_TYPES.scriptCharacter,
  menuLabelKey: 'node.menu.scriptCharacter',
  menuIcon: 'text',
  visibleInMenu: true,
  menuProjectTypes: ['script'],
  capabilities: {
    toolbar: false,
    promptInput: false,
  },
  connectivity: {
    sourceHandle: true,
    targetHandle: false,
    connectMenu: {
      fromSource: true,
      fromTarget: false,
    },
  },
  createDefaultData: () => ({
    displayName: DEFAULT_NODE_DISPLAY_NAME[CANVAS_NODE_TYPES.scriptCharacter] || '角色',
    name: '',
    description: '',
    personality: '',
    appearance: '',
    statusUpdates: [],
    relationships: [],
  }),
};

const scriptLocationNodeDefinition: CanvasNodeDefinition<ScriptLocationNodeData> = {
  type: CANVAS_NODE_TYPES.scriptLocation,
  menuLabelKey: 'node.menu.scriptLocation',
  menuIcon: 'text',
  visibleInMenu: true,
  menuProjectTypes: ['script'],
  capabilities: {
    toolbar: false,
    promptInput: false,
  },
  connectivity: {
    sourceHandle: false,
    targetHandle: false,
    connectMenu: {
      fromSource: false,
      fromTarget: false,
    },
  },
  createDefaultData: () => ({
    displayName: DEFAULT_NODE_DISPLAY_NAME[CANVAS_NODE_TYPES.scriptLocation] || '场景',
    name: '',
    description: '',
    appearances: [],
  }),
};

const scriptItemNodeDefinition: CanvasNodeDefinition<ScriptItemNodeData> = {
  type: CANVAS_NODE_TYPES.scriptItem,
  menuLabelKey: 'node.menu.scriptItem',
  menuIcon: 'text',
  visibleInMenu: true,
  menuProjectTypes: ['script'],
  capabilities: {
    toolbar: false,
    promptInput: false,
  },
  connectivity: {
    sourceHandle: false,
    targetHandle: false,
    connectMenu: {
      fromSource: false,
      fromTarget: false,
    },
  },
  createDefaultData: () => ({
    displayName: DEFAULT_NODE_DISPLAY_NAME[CANVAS_NODE_TYPES.scriptItem] || '道具',
    name: '',
    description: '',
    appearances: [],
  }),
};

const scriptPlotLineNodeDefinition: CanvasNodeDefinition<ScriptPlotLineNodeData> = {
  type: CANVAS_NODE_TYPES.scriptPlotLine,
  menuLabelKey: 'node.menu.scriptPlotLine',
  menuIcon: 'text',
  visibleInMenu: false,
  menuProjectTypes: ['script'],
  capabilities: {
    toolbar: false,
    promptInput: false,
  },
  connectivity: {
    sourceHandle: true,
    targetHandle: true,
    connectMenu: {
      fromSource: false,
      fromTarget: false,
    },
  },
  createDefaultData: () => ({
    displayName: DEFAULT_NODE_DISPLAY_NAME[CANVAS_NODE_TYPES.scriptPlotLine] || '剧情线',
    title: '',
    summary: '',
    statusTag: '',
    relatedCharacterNames: [],
    relatedSceneNames: [],
    entries: [],
  }),
};

const scriptStoryNoteNodeDefinition: CanvasNodeDefinition<ScriptStoryNoteNodeData> = {
  type: CANVAS_NODE_TYPES.scriptStoryNote,
  menuLabelKey: 'node.menu.scriptStoryNote',
  menuIcon: 'text',
  visibleInMenu: true,
  menuProjectTypes: ['script'],
  capabilities: {
    toolbar: false,
    promptInput: false,
  },
  connectivity: {
    sourceHandle: false,
    targetHandle: false,
    connectMenu: {
      fromSource: false,
      fromTarget: false,
    },
  },
  createDefaultData: () => ({
    displayName: DEFAULT_NODE_DISPLAY_NAME[CANVAS_NODE_TYPES.scriptStoryNote] || '故事参考',
    title: DEFAULT_NODE_DISPLAY_NAME[CANVAS_NODE_TYPES.scriptStoryNote] || '故事参考',
    content: '',
    isEnabled: true,
  }),
};

const scriptPlotPointNodeDefinition: CanvasNodeDefinition<ScriptPlotPointNodeData> = {
  type: CANVAS_NODE_TYPES.scriptPlotPoint,
  menuLabelKey: 'node.menu.scriptPlotPoint',
  menuIcon: 'text',
  visibleInMenu: false,
  menuProjectTypes: ['script'],
  capabilities: {
    toolbar: false,
    promptInput: false,
  },
  connectivity: {
    sourceHandle: true,
    targetHandle: true,
    connectMenu: {
      fromSource: false,
      fromTarget: false,
    },
  },
  createDefaultData: () => ({
    displayName: DEFAULT_NODE_DISPLAY_NAME[CANVAS_NODE_TYPES.scriptPlotPoint] || '情节点',
    pointType: 'setup',
    description: '',
  }),
};

const scriptWorldviewNodeDefinition: CanvasNodeDefinition<ScriptWorldviewNodeData> = {
  type: CANVAS_NODE_TYPES.scriptWorldview,
  menuLabelKey: 'node.menu.scriptWorldview',
  menuIcon: 'text',
  visibleInMenu: false,
  menuProjectTypes: ['script'],
  capabilities: {
    toolbar: false,
    promptInput: false,
  },
  connectivity: {
    sourceHandle: false,
    targetHandle: false,
    connectMenu: {
      fromSource: false,
      fromTarget: false,
    },
  },
  createDefaultData: () => ({
    displayName: DEFAULT_NODE_DISPLAY_NAME[CANVAS_NODE_TYPES.scriptWorldview] || '世界观',
    worldviewName: '',
    description: '',
    era: '',
    technology: '',
    magic: '',
    society: '',
    geography: '',
    rules: [],
  }),
};

export const canvasNodeDefinitions: Record<CanvasNodeType, CanvasNodeDefinition> = {
  [CANVAS_NODE_TYPES.upload]: uploadNodeDefinition,
  [CANVAS_NODE_TYPES.imageEdit]: imageEditNodeDefinition,
  [CANVAS_NODE_TYPES.multiAngleImage]: multiAngleImageNodeDefinition,
  [CANVAS_NODE_TYPES.panorama360]: panorama360NodeDefinition,
  [CANVAS_NODE_TYPES.directorStage]: directorStageNodeDefinition,
  [CANVAS_NODE_TYPES.backgroundRemove]: backgroundRemoveNodeDefinition,
  [CANVAS_NODE_TYPES.seedvr2ImageUpscale]: seedvr2ImageUpscaleNodeDefinition,
  [CANVAS_NODE_TYPES.seedvr2VideoUpscale]: seedvr2VideoUpscaleNodeDefinition,
  [CANVAS_NODE_TYPES.jimeng]: jimengNodeDefinition,
  [CANVAS_NODE_TYPES.jimengImage]: jimengImageNodeDefinition,
  [CANVAS_NODE_TYPES.mj]: mjNodeDefinition,
  [CANVAS_NODE_TYPES.mjResult]: mjResultNodeDefinition,
  [CANVAS_NODE_TYPES.jimengImageResult]: jimengImageResultNodeDefinition,
  [CANVAS_NODE_TYPES.jimengVideoResult]: jimengVideoResultNodeDefinition,
  [CANVAS_NODE_TYPES.seedance]: seedanceNodeDefinition,
  [CANVAS_NODE_TYPES.seedanceVideoResult]: seedanceVideoResultNodeDefinition,
  [CANVAS_NODE_TYPES.gptBestSeedance]: gptBestSeedanceNodeDefinition,
  [CANVAS_NODE_TYPES.gptBestGrokVideo]: gptBestGrokVideoNodeDefinition,
  [CANVAS_NODE_TYPES.gptBestVideoResult]: gptBestVideoResultNodeDefinition,
  [CANVAS_NODE_TYPES.vidu]: viduNodeDefinition,
  [CANVAS_NODE_TYPES.viduVideoResult]: viduVideoResultNodeDefinition,
  [CANVAS_NODE_TYPES.legacy]: legacyNodeDefinition,
  [CANVAS_NODE_TYPES.exportImage]: exportImageNodeDefinition,
  [CANVAS_NODE_TYPES.imageCompare]: imageCompareNodeDefinition,
  [CANVAS_NODE_TYPES.textAnnotation]: textAnnotationNodeDefinition,
  [CANVAS_NODE_TYPES.llmLogic]: llmLogicNodeDefinition,
  [CANVAS_NODE_TYPES.group]: groupNodeDefinition,
  [CANVAS_NODE_TYPES.storyboardSplit]: storyboardSplitDefinition,
  [CANVAS_NODE_TYPES.imageCollage]: imageCollageNodeDefinition,
  [CANVAS_NODE_TYPES.storyboardSplitResult]: storyboardSplitResultDefinition,
  [CANVAS_NODE_TYPES.storyboardGen]: storyboardGenNodeDefinition,
  [CANVAS_NODE_TYPES.assetMaterial]: assetMaterialNodeDefinition,
  [CANVAS_NODE_TYPES.video]: videoNodeDefinition,
  [CANVAS_NODE_TYPES.audio]: audioNodeDefinition,
  [CANVAS_NODE_TYPES.ttsText]: ttsTextNodeDefinition,
  [CANVAS_NODE_TYPES.ttsVoiceDesign]: ttsVoiceDesignNodeDefinition,
  [CANVAS_NODE_TYPES.ttsSavedVoice]: ttsSavedVoiceNodeDefinition,
  [CANVAS_NODE_TYPES.voxCpmVoiceDesign]: voxCpmVoiceDesignNodeDefinition,
  [CANVAS_NODE_TYPES.voxCpmVoiceClone]: voxCpmVoiceCloneNodeDefinition,
  [CANVAS_NODE_TYPES.voxCpmUltimateClone]: voxCpmUltimateCloneNodeDefinition,
  [CANVAS_NODE_TYPES.adProjectRoot]: adProjectRootNodeDefinition,
  [CANVAS_NODE_TYPES.commerceProduct]: commerceProductNodeDefinition,
  [CANVAS_NODE_TYPES.commerceBrief]: commerceBriefNodeDefinition,
  [CANVAS_NODE_TYPES.commerceBatchGenerate]: commerceBatchGenerateNodeDefinition,
  [CANVAS_NODE_TYPES.commerceResultGroup]: commerceResultGroupNodeDefinition,
  [CANVAS_NODE_TYPES.scriptRoot]: scriptRootNodeDefinition,
  [CANVAS_NODE_TYPES.scriptChapter]: scriptChapterNodeDefinition,
  [CANVAS_NODE_TYPES.scriptScene]: scriptSceneNodeDefinition,
  [CANVAS_NODE_TYPES.shootingScript]: shootingScriptNodeDefinition,
  [CANVAS_NODE_TYPES.scriptAssetExtract]: scriptAssetExtractNodeDefinition,
  [CANVAS_NODE_TYPES.smartDirectorStoryboard]: smartDirectorStoryboardNodeDefinition,
  [CANVAS_NODE_TYPES.scriptStoryboardTable]: scriptStoryboardTableNodeDefinition,
  [CANVAS_NODE_TYPES.directorWorkPackage]: {
    ...scriptAssetExtractNodeDefinition,
    type: CANVAS_NODE_TYPES.directorWorkPackage,
    visibleInMenu: false,
  },
  [CANVAS_NODE_TYPES.directorStoryboardReference]: directorStoryboardReferenceNodeDefinition,
  [CANVAS_NODE_TYPES.scriptReference]: scriptReferenceNodeDefinition,
  [CANVAS_NODE_TYPES.adScriptReference]: adScriptReferenceNodeDefinition,
  [CANVAS_NODE_TYPES.scriptCharacterReference]: scriptCharacterReferenceNodeDefinition,
  [CANVAS_NODE_TYPES.scriptLocationReference]: scriptLocationReferenceNodeDefinition,
  [CANVAS_NODE_TYPES.scriptItemReference]: scriptItemReferenceNodeDefinition,
  [CANVAS_NODE_TYPES.scriptCharacter]: scriptCharacterNodeDefinition,
  [CANVAS_NODE_TYPES.scriptLocation]: scriptLocationNodeDefinition,
  [CANVAS_NODE_TYPES.scriptItem]: scriptItemNodeDefinition,
  [CANVAS_NODE_TYPES.scriptPlotLine]: scriptPlotLineNodeDefinition,
  [CANVAS_NODE_TYPES.scriptStoryNote]: scriptStoryNoteNodeDefinition,
  [CANVAS_NODE_TYPES.scriptPlotPoint]: scriptPlotPointNodeDefinition,
  [CANVAS_NODE_TYPES.scriptWorldview]: scriptWorldviewNodeDefinition,
};

export function getNodeDefinition(type: CanvasNodeType): CanvasNodeDefinition {
  return canvasNodeDefinitions[type];
}

function isDefinitionVisibleInMenu(
  definition: CanvasNodeDefinition,
  projectType: NodeMenuProjectType,
  options: NodeMenuAvailabilityOptions = {}
): boolean {
  if (!definition.visibleInMenu || !definition.menuProjectTypes.includes(projectType)) {
    return false;
  }

  if (
    projectType === 'storyboard'
    && (
      definition.type === CANVAS_NODE_TYPES.scriptReference
      || definition.type === CANVAS_NODE_TYPES.adScriptReference
      || definition.type === CANVAS_NODE_TYPES.scriptCharacterReference
      || definition.type === CANVAS_NODE_TYPES.scriptLocationReference
      || definition.type === CANVAS_NODE_TYPES.scriptItemReference
    )
  ) {
    if (definition.type === CANVAS_NODE_TYPES.adScriptReference) {
      return Boolean(options.linkedAdProjectId?.trim());
    }
    return Boolean(options.linkedScriptProjectId?.trim());
  }

  return true;
}

export function isNodeTypeAvailableInProject(
  type: CanvasNodeType,
  projectType: NodeMenuProjectType = 'storyboard',
  options: NodeMenuAvailabilityOptions = {}
): boolean {
  return isDefinitionVisibleInMenu(canvasNodeDefinitions[type], projectType, options);
}

export function getMenuNodeDefinitions(
  projectType: NodeMenuProjectType = 'storyboard',
  options: NodeMenuAvailabilityOptions = {}
): CanvasNodeDefinition[] {
  return Object.values(canvasNodeDefinitions).filter((definition) =>
    isDefinitionVisibleInMenu(definition, projectType, options)
  );
}

export function nodeHasSourceHandle(type: CanvasNodeType): boolean {
  return canvasNodeDefinitions[type].connectivity.sourceHandle;
}

export function nodeHasTargetHandle(type: CanvasNodeType): boolean {
  return canvasNodeDefinitions[type].connectivity.targetHandle;
}

export function getConnectMenuNodeTypes(
  handleType: 'source' | 'target',
  projectType: NodeMenuProjectType = 'storyboard',
  options: NodeMenuAvailabilityOptions = {}
): CanvasNodeType[] {
  const fromSource = handleType === 'source';
  return Object.values(canvasNodeDefinitions)
    .filter((definition) => isDefinitionVisibleInMenu(definition, projectType, options))
    .filter((definition) => (fromSource
      ? definition.connectivity.connectMenu.fromSource
      : definition.connectivity.connectMenu.fromTarget))
    .filter((definition) => (fromSource
      ? definition.connectivity.targetHandle
      : definition.connectivity.sourceHandle))
    .map((definition) => definition.type);
}
