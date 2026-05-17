import type { Edge, Node, XYPosition } from '@xyflow/react';
import type { CanvasSemanticColor } from './semanticColors';
import {
  normalizeAdBrief,
  normalizeAdScriptRows,
  createDefaultAdProjectRootState,
  normalizeAdProjectRootState,
  type AdBrief,
  type AdScriptTemplateId,
  type AdProjectRootState,
} from '@/features/ad/types';
import {
  createDefaultCommerceAdBatchGenerateState,
  createDefaultCommerceAdBriefState,
  createDefaultCommerceAdProductState,
  createDefaultCommerceAdResultGroupState,
  normalizeCommerceAdBatchGenerateState,
  normalizeCommerceAdBriefState,
  normalizeCommerceAdProductState,
  normalizeCommerceAdResultGroupState,
  type CommerceAdBatchGenerateState,
  type CommerceAdBriefState,
  type CommerceAdProductState,
  type CommerceAdResultGroupState,
} from '@/features/commerce-ad/types';
import {
  normalizeMidjourneyProviderId,
  type MidjourneyProviderId,
} from '@/features/midjourney/domain/providers';
import { normalizeMjPersonalizationCodes } from '@/features/midjourney/domain/styleCodePresets';
import type { DirectorStageProject } from '@/features/director-stage/domain/types';

export const CANVAS_NODE_TYPES = {
  upload: 'uploadNode',
  imageCompare: 'imageCompareNode',
  imageEdit: 'imageNode',
  multiAngleImage: 'multiAngleImageNode',
  panorama360: 'panorama360Node',
  directorStage: 'directorStageNode',
  backgroundRemove: 'backgroundRemoveNode',
  seedvr2ImageUpscale: 'seedvr2ImageUpscaleNode',
  seedvr2VideoUpscale: 'seedvr2VideoUpscaleNode',
  jimeng: 'jimengNode',
  jimengImage: 'jimengImageNode',
  mj: 'mjNode',
  mjResult: 'mjResultNode',
  jimengImageResult: 'jimengImageResultNode',
  jimengVideoResult: 'jimengVideoResultNode',
  seedance: 'seedanceNode',
  seedanceVideoResult: 'seedanceVideoResultNode',
  vidu: 'viduNode',
  viduVideoResult: 'viduVideoResultNode',
  gptBestSeedance: 'gptBestSeedanceNode',
  gptBestGrokVideo: 'gptBestGrokVideoNode',
  gptBestVideoResult: 'gptBestVideoResultNode',
  legacy: 'legacyNode',
  exportImage: 'exportImageNode',
  textAnnotation: 'textAnnotationNode',
  llmLogic: 'llmLogicNode',
  group: 'groupNode',
  storyboardSplit: 'storyboardNode',
  imageCollage: 'imageCollageNode',
  storyboardSplitResult: 'storyboardSplitResultNode',
  storyboardGen: 'storyboardGenNode',
  assetMaterial: 'assetMaterialNode',
  video: 'videoNode',
  audio: 'audioNode',
  ttsText: 'ttsTextNode',
  ttsVoiceDesign: 'ttsVoiceDesignNode',
  ttsSavedVoice: 'ttsSavedVoiceNode',
  voxCpmVoiceDesign: 'voxCpmVoiceDesignNode',
  voxCpmVoiceClone: 'voxCpmVoiceCloneNode',
  voxCpmUltimateClone: 'voxCpmUltimateCloneNode',
  adProjectRoot: 'adProjectRootNode',
  commerceProduct: 'commerceProductNode',
  commerceBrief: 'commerceBriefNode',
  commerceBatchGenerate: 'commerceBatchGenerateNode',
  commerceResultGroup: 'commerceResultGroupNode',
  scriptRoot: 'scriptRootNode',
  scriptChapter: 'scriptChapterNode',
  scriptScene: 'scriptSceneNode',
  shootingScript: 'shootingScriptNode',
  scriptAssetExtract: 'scriptAssetExtractNode',
  smartDirectorStoryboard: 'smartDirectorStoryboardNode',
  scriptStoryboardTable: 'scriptStoryboardTableNode',
  directorWorkPackage: 'directorWorkPackageNode',
  directorStoryboardReference: 'directorStoryboardReferenceNode',
  scriptReference: 'scriptReferenceNode',
  adScriptReference: 'adScriptReferenceNode',
  scriptCharacterReference: 'scriptCharacterReferenceNode',
  scriptLocationReference: 'scriptLocationReferenceNode',
  scriptItemReference: 'scriptItemReferenceNode',
  scriptCharacter: 'scriptCharacterNode',
  scriptLocation: 'scriptLocationNode',
  scriptItem: 'scriptItemNode',
  scriptPlotLine: 'scriptPlotLineNode',
  scriptStoryNote: 'scriptStoryNoteNode',
  scriptPlotPoint: 'scriptPlotPointNode',
  scriptWorldview: 'scriptWorldviewNode',
} as const;

export type CanvasNodeType = (typeof CANVAS_NODE_TYPES)[keyof typeof CANVAS_NODE_TYPES];

export const DEFAULT_ASPECT_RATIO = '1:1';
export const AUTO_REQUEST_ASPECT_RATIO = 'auto';
export const DEFAULT_PRODUCTION_IMAGE_MODEL_ID = 'oopii/all-image-2';
export const DEFAULT_NODE_WIDTH = 220;
export const COMMERCE_STAGE_NODE_DEFAULT_WIDTH = 380;
export const COMMERCE_STAGE_NODE_DEFAULT_HEIGHT = 460;
export const IMAGE_EDIT_NODE_DEFAULT_WIDTH = 500;
export const IMAGE_EDIT_NODE_DEFAULT_HEIGHT = 280;
export const MULTI_ANGLE_IMAGE_NODE_DEFAULT_WIDTH = 560;
export const MULTI_ANGLE_IMAGE_NODE_DEFAULT_HEIGHT = 420;
export const PANORAMA360_NODE_DEFAULT_WIDTH = 520;
export const PANORAMA360_NODE_DEFAULT_HEIGHT = 380;
export const PANORAMA360_NODE_MIN_WIDTH = 420;
export const PANORAMA360_NODE_MIN_HEIGHT = 300;
export const DIRECTOR_STAGE_NODE_DEFAULT_WIDTH = 420;
export const DIRECTOR_STAGE_NODE_DEFAULT_HEIGHT = 300;
export const BACKGROUND_REMOVE_NODE_DEFAULT_WIDTH = 440;
export const BACKGROUND_REMOVE_NODE_DEFAULT_HEIGHT = 320;
export const SEEDVR2_IMAGE_UPSCALE_NODE_DEFAULT_WIDTH = 440;
export const SEEDVR2_IMAGE_UPSCALE_NODE_DEFAULT_HEIGHT = 388;
export const SEEDVR2_VIDEO_UPSCALE_NODE_DEFAULT_WIDTH = 440;
export const SEEDVR2_VIDEO_UPSCALE_NODE_DEFAULT_HEIGHT = 404;
export const EXPORT_RESULT_NODE_DEFAULT_WIDTH = 384;
export const EXPORT_RESULT_NODE_LAYOUT_HEIGHT = 288;
export const EXPORT_RESULT_NODE_MIN_WIDTH = 168;
export const EXPORT_RESULT_NODE_MIN_HEIGHT = 168;
export const IMAGE_COMPARE_NODE_DEFAULT_WIDTH = 384;
export const IMAGE_COMPARE_NODE_DEFAULT_HEIGHT = 288;
export const JIMENG_IMAGE_RESULT_NODE_DEFAULT_WIDTH = 640;
export const JIMENG_IMAGE_RESULT_NODE_DEFAULT_HEIGHT = 520;
export const JIMENG_IMAGE_RESULT_NODE_MIN_WIDTH = 560;
export const JIMENG_IMAGE_RESULT_NODE_MIN_HEIGHT = 420;
export const MJ_NODE_DEFAULT_WIDTH = 700;
export const MJ_NODE_DEFAULT_HEIGHT = 360;
export const MJ_NODE_MIN_WIDTH = 620;
export const MJ_NODE_MIN_HEIGHT = 320;
export const MJ_RESULT_NODE_DEFAULT_WIDTH = 700;
export const MJ_RESULT_NODE_DEFAULT_HEIGHT = 560;
export const MJ_RESULT_NODE_MIN_WIDTH = 620;
export const MJ_RESULT_NODE_MIN_HEIGHT = 420;
export const JIMENG_VIDEO_RESULT_NODE_DEFAULT_WIDTH = 520;
export const JIMENG_VIDEO_RESULT_NODE_DEFAULT_HEIGHT = 388;
export const JIMENG_VIDEO_RESULT_NODE_MIN_WIDTH = 360;
export const JIMENG_VIDEO_RESULT_NODE_MIN_HEIGHT = 280;
export const SEEDANCE_NODE_DEFAULT_WIDTH = 920;
export const SEEDANCE_NODE_DEFAULT_HEIGHT = 560;
export const SEEDANCE_NODE_MIN_WIDTH = 760;
export const SEEDANCE_NODE_MIN_HEIGHT = 440;
export const IMAGE_COLLAGE_NODE_DEFAULT_WIDTH = 920;
export const IMAGE_COLLAGE_NODE_DEFAULT_HEIGHT = 560;
export const IMAGE_COLLAGE_NODE_MIN_WIDTH = 760;
export const IMAGE_COLLAGE_NODE_MIN_HEIGHT = 420;
export const SEEDANCE_VIDEO_RESULT_NODE_DEFAULT_WIDTH = 520;
export const SEEDANCE_VIDEO_RESULT_NODE_DEFAULT_HEIGHT = 388;
export const SEEDANCE_VIDEO_RESULT_NODE_MIN_WIDTH = 360;
export const SEEDANCE_VIDEO_RESULT_NODE_MIN_HEIGHT = 280;
export const GPT_BEST_VIDEO_NODE_DEFAULT_WIDTH = 920;
export const GPT_BEST_VIDEO_NODE_DEFAULT_HEIGHT = 560;
export const GPT_BEST_VIDEO_NODE_MIN_WIDTH = 760;
export const GPT_BEST_VIDEO_NODE_MIN_HEIGHT = 440;
export const GPT_BEST_VIDEO_RESULT_NODE_DEFAULT_WIDTH = 520;
export const GPT_BEST_VIDEO_RESULT_NODE_DEFAULT_HEIGHT = 388;
export const GPT_BEST_VIDEO_RESULT_NODE_MIN_WIDTH = 360;
export const GPT_BEST_VIDEO_RESULT_NODE_MIN_HEIGHT = 280;
export const VIDU_VIDEO_NODE_DEFAULT_WIDTH = 920;
export const VIDU_VIDEO_NODE_DEFAULT_HEIGHT = 560;
export const VIDU_VIDEO_NODE_MIN_WIDTH = 760;
export const VIDU_VIDEO_NODE_MIN_HEIGHT = 440;
export const VIDU_VIDEO_RESULT_NODE_DEFAULT_WIDTH = 520;
export const VIDU_VIDEO_RESULT_NODE_DEFAULT_HEIGHT = 388;
export const VIDU_VIDEO_RESULT_NODE_MIN_WIDTH = 360;
export const VIDU_VIDEO_RESULT_NODE_MIN_HEIGHT = 280;
export const AUDIO_NODE_DEFAULT_WIDTH = 320;
export const AUDIO_NODE_DEFAULT_HEIGHT = 96;
export const TTS_TEXT_NODE_DEFAULT_WIDTH = 500;
export const TTS_TEXT_NODE_DEFAULT_HEIGHT = 300;
export const LLM_LOGIC_NODE_DEFAULT_WIDTH = 520;
export const LLM_LOGIC_NODE_DEFAULT_HEIGHT = 540;
export const SCRIPT_CHAPTER_NODE_DEFAULT_WIDTH = 420;
export const SCRIPT_CHAPTER_NODE_DEFAULT_HEIGHT = 380;
export const SCRIPT_SCENE_NODE_DEFAULT_WIDTH = 460;
export const SCRIPT_SCENE_NODE_DEFAULT_HEIGHT = 420;
export const SHOOTING_SCRIPT_NODE_DEFAULT_WIDTH = 1680;
export const SHOOTING_SCRIPT_NODE_DEFAULT_HEIGHT = 760;
export const SCRIPT_CHARACTER_NODE_DEFAULT_WIDTH = 320;
export const SCRIPT_CHARACTER_NODE_DEFAULT_HEIGHT = 360;
export const SCRIPT_LOCATION_NODE_DEFAULT_WIDTH = 320;
export const SCRIPT_LOCATION_NODE_DEFAULT_HEIGHT = 300;
export const SCRIPT_ITEM_NODE_DEFAULT_WIDTH = 320;
export const SCRIPT_ITEM_NODE_DEFAULT_HEIGHT = 300;
export const SCRIPT_PLOT_LINE_NODE_DEFAULT_WIDTH = 420;
export const SCRIPT_PLOT_LINE_NODE_DEFAULT_HEIGHT = 156;
export const SCRIPT_ASSET_EXTRACT_NODE_DEFAULT_WIDTH = 620;
export const SCRIPT_ASSET_EXTRACT_NODE_DEFAULT_HEIGHT = 420;
export const SMART_DIRECTOR_STORYBOARD_NODE_DEFAULT_WIDTH = 860;
export const SMART_DIRECTOR_STORYBOARD_NODE_DEFAULT_HEIGHT = 520;
export const SCRIPT_STORYBOARD_TABLE_NODE_DEFAULT_WIDTH = 1780;
export const SCRIPT_STORYBOARD_TABLE_NODE_DEFAULT_HEIGHT = 720;
export const ASSET_MATERIAL_NODE_DEFAULT_WIDTH = 420;
export const ASSET_MATERIAL_NODE_DEFAULT_HEIGHT = 520;
export const DIRECTOR_WORK_PACKAGE_NODE_DEFAULT_WIDTH = 620;
export const DIRECTOR_WORK_PACKAGE_NODE_DEFAULT_HEIGHT = 420;
export const DIRECTOR_STORYBOARD_REFERENCE_NODE_DEFAULT_WIDTH = 760;
export const DIRECTOR_STORYBOARD_REFERENCE_NODE_DEFAULT_HEIGHT = 620;
export const SCRIPT_REFERENCE_NODE_DEFAULT_WIDTH = 620;
export const SCRIPT_REFERENCE_NODE_DEFAULT_HEIGHT = 620;
export const AD_SCRIPT_REFERENCE_NODE_DEFAULT_WIDTH = 620;
export const AD_SCRIPT_REFERENCE_NODE_DEFAULT_HEIGHT = 620;
export const TTS_VOICE_DESIGN_NODE_DEFAULT_WIDTH = 440;
export const TTS_VOICE_DESIGN_NODE_DEFAULT_HEIGHT = 300;
export const TTS_SAVED_VOICE_NODE_DEFAULT_WIDTH = 440;
export const TTS_SAVED_VOICE_NODE_DEFAULT_HEIGHT = 320;
export const VOXCPM_VOICE_DESIGN_NODE_DEFAULT_WIDTH = 440;
export const VOXCPM_VOICE_DESIGN_NODE_DEFAULT_HEIGHT = 300;
export const VOXCPM_VOICE_CLONE_NODE_DEFAULT_WIDTH = 460;
export const VOXCPM_VOICE_CLONE_NODE_DEFAULT_HEIGHT = 320;
export const VOXCPM_ULTIMATE_CLONE_NODE_DEFAULT_WIDTH = 460;
export const VOXCPM_ULTIMATE_CLONE_NODE_DEFAULT_HEIGHT = 360;

export const IMAGE_SIZES = ['0.5K', '1K', '2K', '4K'] as const;
export const IMAGE_ASPECT_RATIOS = [
  '1:1',
  '16:9',
  '9:16',
  '4:3',
  '3:4',
  '21:9',
] as const;

export const JIMENG_IMAGE_MODEL_VERSIONS = [
  '3.0',
  '3.1',
  '4.0',
  '4.1',
  '4.5',
  '4.6',
  '5.0',
  'lab',
] as const;

export const JIMENG_IMAGE_RESOLUTION_TYPES = ['1k', '2k', '4k'] as const;

export const JIMENG_VIDEO_MODEL_IDS = [
  'seedance2.0fast',
  'seedance2.0',
  'seedance2.0fast_vip',
  'seedance2.0_vip',
  '3.0',
  '3.0fast',
  '3.0pro',
  '3.5pro',
] as const;

export const JIMENG_REFERENCE_MODES = [
  'allAround',
  'firstLastFrame',
  'smartFrames',
  'subject',
] as const;

export const JIMENG_ASPECT_RATIOS = [
  '21:9',
  '16:9',
  '4:3',
  '1:1',
  '3:4',
  '9:16',
] as const;

export const MIDJOURNEY_ASPECT_RATIOS = [
  '1:1',
  '16:9',
  '9:16',
  '4:3',
  '3:4',
  '2:3',
  '3:2',
] as const;

export const MIDJOURNEY_VERSION_PRESETS = [
  '',
  '7',
  '6.1',
  'niji6',
] as const;

export const JIMENG_DURATION_SECONDS = [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] as const;
export const JIMENG_VIDEO_RESOLUTIONS = ['720p', '1080p'] as const;
export const SEEDANCE_MODEL_IDS = [
  'doubao-seedance-2-0-260128',
  'doubao-seedance-2-0-fast-260128',
] as const;
export const SEEDANCE_INPUT_MODES = [
  'textToVideo',
  'firstFrame',
  'firstLastFrame',
  'reference',
] as const;
export const SEEDANCE_ASPECT_RATIOS = [
  'adaptive',
  '21:9',
  '16:9',
  '4:3',
  '1:1',
  '3:4',
  '9:16',
] as const;
export const SEEDANCE_DURATION_SECONDS = [-1, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] as const;
export const SEEDANCE_RESOLUTIONS = ['480p', '720p'] as const;
export const GPT_BEST_VIDEO_SOURCE_KINDS = ['seedance', 'grok'] as const;
export const GPT_BEST_VIDEO_DURATION_SECONDS = [6, 10] as const;
export const GPT_BEST_VIDEO_SIZES = [
  '720x1280',
  '1280x720',
  '1024x1024',
  '1024x1792',
  '1792x1024',
] as const;
export const GPT_BEST_VIDEO_MODEL_IDS = [
  'OK-video',
] as const;
export const VIDU_INPUT_MODES = [
  'textToVideo',
  'firstFrame',
  'firstLastFrame',
  'reference',
] as const;
export const VIDU_MODEL_IDS = [
  'viduq3-turbo',
  'viduq3-pro',
  'viduq3-pro-fast',
  'viduq3-mix',
  'viduq3',
  'viduq2-pro-fast',
  'viduq2-pro',
  'viduq2-turbo',
  'viduq2',
  'viduq1',
  'viduq1-classic',
  'vidu2.0',
] as const;
export const VIDU_ASPECT_RATIOS = ['16:9', '9:16', '4:3', '3:4', '1:1'] as const;
export const VIDU_DURATION_SECONDS = [1, 2, 3, 4, 5, 8, 10, 16] as const;
export const VIDU_RESOLUTIONS = ['540p', '720p', '1080p'] as const;
export const SEEDVR2_IMAGE_TARGET_RESOLUTIONS = [1080, 1440, 2160] as const;
export const SEEDVR2_VIDEO_TARGET_RESOLUTIONS = [720, 1080, 1440] as const;

export type ImageSize = (typeof IMAGE_SIZES)[number];
export type JimengImageModelVersion = (typeof JIMENG_IMAGE_MODEL_VERSIONS)[number];
export type JimengImageResolutionType = (typeof JIMENG_IMAGE_RESOLUTION_TYPES)[number];
export type JimengVideoModelId = (typeof JIMENG_VIDEO_MODEL_IDS)[number];
export type JimengReferenceMode = (typeof JIMENG_REFERENCE_MODES)[number];
export type JimengAspectRatio = (typeof JIMENG_ASPECT_RATIOS)[number];
export type MidjourneyAspectRatio = (typeof MIDJOURNEY_ASPECT_RATIOS)[number];
export type MidjourneyVersionPreset = (typeof MIDJOURNEY_VERSION_PRESETS)[number];
export type JimengDurationSeconds = (typeof JIMENG_DURATION_SECONDS)[number];
export type JimengVideoResolution = (typeof JIMENG_VIDEO_RESOLUTIONS)[number];
export type SeedanceModelId = (typeof SEEDANCE_MODEL_IDS)[number];
export type SeedanceInputMode = (typeof SEEDANCE_INPUT_MODES)[number];
export type SeedanceAspectRatio = (typeof SEEDANCE_ASPECT_RATIOS)[number];
export type SeedanceDurationSeconds = (typeof SEEDANCE_DURATION_SECONDS)[number];
export type SeedanceResolution = (typeof SEEDANCE_RESOLUTIONS)[number];
export type GptBestVideoSourceKind = (typeof GPT_BEST_VIDEO_SOURCE_KINDS)[number];
export type GptBestVideoDurationSeconds = (typeof GPT_BEST_VIDEO_DURATION_SECONDS)[number];
export type GptBestVideoSize = (typeof GPT_BEST_VIDEO_SIZES)[number];
export type GptBestVideoModelId = (typeof GPT_BEST_VIDEO_MODEL_IDS)[number];
export type ViduInputMode = (typeof VIDU_INPUT_MODES)[number];
export type ViduModelId = (typeof VIDU_MODEL_IDS)[number];
export type ViduAspectRatio = (typeof VIDU_ASPECT_RATIOS)[number];
export type ViduDurationSeconds = (typeof VIDU_DURATION_SECONDS)[number];
export type ViduResolution = (typeof VIDU_RESOLUTIONS)[number];
export type Seedvr2ImageTargetResolution = (typeof SEEDVR2_IMAGE_TARGET_RESOLUTIONS)[number];
export type Seedvr2VideoTargetResolution = (typeof SEEDVR2_VIDEO_TARGET_RESOLUTIONS)[number];

export interface NodeDisplayData {
  displayName?: string;
  nodeDescription?: string | null;
  semanticColor?: CanvasSemanticColor | null;
  [key: string]: unknown;
}

export interface LegacyNodeData extends NodeDisplayData {
  legacyType: string;
  legacyData: Record<string, unknown>;
}

export type VoiceGenerationSource =
  | 'ttsVoiceDesign'
  | 'ttsSavedVoice'
  | 'voxCpmVoiceDesign'
  | 'voxCpmVoiceClone'
  | 'voxCpmUltimateClone';

export interface VoicePresetSourceData {
  referenceText?: string | null;
  voicePrompt?: string | null;
  controlText?: string | null;
  promptText?: string | null;
  stylePreset?: string | null;
  language?: string | null;
  speakingRate?: number | null;
  pitch?: number | null;
  useReferenceAsReference?: boolean | null;
  sourceGeneration?: VoiceGenerationSource | null;
}

export interface NodeImageData extends NodeDisplayData {
  imageUrl: string | null;
  previewImageUrl?: string | null;
  thumbnailUrl?: string | null;
  aspectRatio: string;
  imageWidth?: number;
  imageHeight?: number;
  isSizeManuallyAdjusted?: boolean;
  assetId?: string | null;
  assetLibraryId?: string | null;
  assetName?: string | null;
  assetCategory?: string | null;
  [key: string]: unknown;
}

export interface CameraParamsSelection {
  cameraBodyId: string | null;
  lensId: string | null;
  focalLengthMm: number | null;
  aperture: string | null;
}

export interface UploadImageNodeData extends NodeImageData {
  sourceFileName?: string | null;
}

export type ExportImageNodeResultKind =
  | 'generic'
  | 'backgroundRemoved'
  | 'storyboardGenOutput'
  | 'storyboardSplitExport'
  | 'storyboardFrameEdit'
  | 'imageCollageExport';

export type ExportImageGenerationSourceType = 'imageEdit' | 'storyboardGen' | 'multiAngleImage';
export type ExportImageGenerationPhase =
  | 'submitting'
  | 'queued'
  | 'running'
  | 'failed'
  | 'succeeded';
export type ExportImageGenerationFailureStage = 'submit' | 'run';

export interface ImageViewerMetadata {
  sourceType: ExportImageGenerationSourceType;
  providerId: string;
  requestModel: string;
  prompt: string;
  generatedAt: number | null;
}

export interface ExportImageGenerationSummary extends ImageViewerMetadata {}

export interface StoryboardProductionImageResult {
  id: string;
  imageUrl: string;
  previewImageUrl?: string | null;
  thumbnailUrl?: string | null;
  aspectRatio?: string | null;
  generationSummary?: ExportImageGenerationSummary | null;
  createdAt: number;
}

export interface ExportImageNodeData extends NodeImageData {
  resultKind?: ExportImageNodeResultKind;
  generationSummary?: ExportImageGenerationSummary | null;
  generationPhase?: ExportImageGenerationPhase | null;
  generationFailureStage?: ExportImageGenerationFailureStage | null;
  generationStatusText?: string | null;
  isStoryboardProductionPlaceholder?: boolean;
  sourceImageNodeId?: string | null;
  sourceStoryboardTableNodeId?: string | null;
  sourceStoryboardRowIds?: string[];
  sourceDurationGroupId?: string | null;
  storyboardProductionResults?: StoryboardProductionImageResult[];
  selectedStoryboardProductionResultId?: string | null;
}

export type ImageCompareSourceNodeType =
  | typeof CANVAS_NODE_TYPES.upload
  | typeof CANVAS_NODE_TYPES.exportImage;

export interface ImageCompareNodeImageSnapshot {
  sourceNodeId: string | null;
  sourceNodeType: ImageCompareSourceNodeType | null;
  imageUrl: string | null;
  previewImageUrl?: string | null;
  thumbnailUrl?: string | null;
  aspectRatio: string;
  displayName?: string | null;
}

export interface ImageCompareRestorableNodeSnapshot {
  id: string;
  type: ImageCompareSourceNodeType;
  position: XYPosition;
  width?: number;
  height?: number;
  originalIndex: number;
  data: UploadImageNodeData | ExportImageNodeData;
}

export interface ImageCompareNodeMergeMeta {
  baseNode: ImageCompareRestorableNodeSnapshot;
  overlayNode: ImageCompareRestorableNodeSnapshot;
}

export interface ImageCompareNodeData extends NodeDisplayData {
  baseImage: ImageCompareNodeImageSnapshot;
  overlayImage: ImageCompareNodeImageSnapshot;
  dividerRatio: number;
  mergeMeta: ImageCompareNodeMergeMeta | null;
}

export interface AssetMaterialNodeData extends NodeDisplayData {
  assetLibraryId: string | null;
  selectedAssetIds: string[];
  sourceStoryboardTableNodeId?: string | null;
  sourceStoryboardRowIds?: string[];
  sourceDurationGroupId?: string | null;
  defaultMatchedAssetNames?: string[];
  displayMode: 'nameOnlyAccordion';
  outputMode?: 'namedReference';
}

export interface GroupNodeData extends NodeDisplayData {
  label: string;
  layoutDirection?: 'horizontal' | 'vertical';
  maxItemsPerLine?: number;
  visualStyle?: 'default' | 'scriptPlotLinePanel' | 'assetBatchGroup' | 'storyboardProductionGroup' | 'storyboardProductionCard';
  batchKind?: 'character' | 'scene' | 'item' | 'storyboard10s' | 'storyboard15s';
  batchSource?: {
    sourceMirrorNodeId: string | null;
    sourcePanelNodeId: string | null;
    sourceProjectId: string | null;
    sourceNodeId: string | null;
  } | null;
  globalOverrideEnabled?: boolean;
  globalModelId?: string | null;
  globalSize?: ImageSize | null;
  globalAspectRatio?: string | null;
  globalStyleTemplateId?: string | null;
  globalStyleTemplateName?: string | null;
  globalStyleTemplatePrompt?: string | null;
  optimizePromptBeforeGenerate?: boolean;
  queueState?: AssetBatchQueueState | null;
  plotLineEntries?: ExtractedScriptPlotLine[];
  [key: string]: unknown;
}

export interface AssetBatchQueueState {
  pendingNodeIds: string[];
  runningNodeId: string | null;
  completedNodeIds: string[];
  failedNodeIds: string[];
  lastRunAt: number | null;
}

export interface TextAnnotationGenerationSource {
  kind: 'llmLogic';
  sourceNodeId: string;
}

export interface TextAnnotationNodeData extends NodeDisplayData {
  content: string;
  generationSource?: TextAnnotationGenerationSource | null;
  showCopyButton?: boolean;
  isGenerating?: boolean;
  generationStatusText?: string | null;
  [key: string]: unknown;
}

export type LlmLogicPresetKey =
  | 'generalPolish'
  | 'spokenNatural'
  | 'clarity'
  | 'voiceSeparation'
  | 'cinematicImagery'
  | 'reverseImageContent'
  | 'rhythmPause'
  | 'emotionProgression'
  | 'subtext'
  | 'dialogueTension'
  | 'dubbingReadability';

export type LlmLogicPresetCategoryKey =
  | 'voice'
  | 'screen'
  | 'writing';

export interface LlmLogicNodeData extends NodeDisplayData {
  model: string;
  systemInstruction: string;
  userPrompt: string;
  presetCategoryKey?: LlmLogicPresetCategoryKey | null;
  presetKey?: LlmLogicPresetKey | null;
  activeRequestId?: string | null;
  outputNodeId?: string | null;
  pendingRequestIds?: string[];
  isGenerating?: boolean;
  statusText?: string | null;
  lastError?: string | null;
  lastGeneratedAt?: number | null;
  [key: string]: unknown;
}

export interface VideoNodeData extends NodeDisplayData {
  videoUrl: string | null;
  previewImageUrl?: string | null;
  thumbnailUrl?: string | null;
  videoFileName?: string | null;
  descriptionText?: string | null;
  clipLibraryId?: string | null;
  clipFolderId?: string | null;
  clipItemId?: string | null;
  aspectRatio: string;
  duration?: number;
  isSizeManuallyAdjusted?: boolean;
  sourceDirectorPackageId?: string | null;
  sourceSectionId?: string | null;
  sourceShotIds?: string[];
  referenceAssets?: ReferenceAssetSnapshot[];
  productionJobId?: string | null;
  [key: string]: unknown;
}

export interface AudioNodeData extends NodeDisplayData {
  audioUrl: string | null;
  previewImageUrl?: string | null;
  audioFileName?: string | null;
  descriptionText?: string | null;
  clipLibraryId?: string | null;
  clipFolderId?: string | null;
  clipItemId?: string | null;
  duration?: number;
  mimeType?: string | null;
  generationSource?: VoiceGenerationSource | null;
  sourceNodeId?: string | null;
  isGenerating?: boolean;
  generationProgress?: number;
  queuePosition?: number | null;
  statusText?: string | null;
  lastError?: string | null;
  lastGeneratedAt?: number | null;
  assetId?: string | null;
  assetLibraryId?: string | null;
  assetName?: string | null;
  assetCategory?: string | null;
  ttsPresetSource?: {
    referenceText?: string | null;
    voicePrompt?: string | null;
    stylePreset?: TtsVoiceDesignStylePreset | null;
    language?: TtsVoiceLanguage | null;
    speakingRate?: number | null;
    pitch?: number | null;
  } | null;
  voicePresetSource?: VoicePresetSourceData | null;
  [key: string]: unknown;
}

export interface TtsTextNodeData extends NodeDisplayData {
  content: string;
  [key: string]: unknown;
}

export type TtsVoiceDesignStylePreset = 'natural' | 'narrator' | 'bright' | 'calm';
export type QwenTtsOutputFormat = 'wav' | 'mp3';

export type TtsVoiceLanguage =
  | 'auto'
  | 'zh'
  | 'en'
  | 'jp'
  | 'kr'
  | 'fr'
  | 'de'
  | 'es'
  | 'pt'
  | 'ru'
  | 'it';

export interface QwenTtsPauseConfig {
  pauseLinebreak?: number;
  periodPause?: number;
  commaPause?: number;
  questionPause?: number;
  hyphenPause?: number;
}

export interface TtsVoiceDesignNodeData extends NodeDisplayData, QwenTtsPauseConfig {
  voicePrompt: string;
  stylePreset: TtsVoiceDesignStylePreset;
  language: TtsVoiceLanguage;
  outputFormat?: QwenTtsOutputFormat;
  speakingRate: number;
  pitch: number;
  maxNewTokens?: number;
  topP?: number;
  topK?: number;
  temperature?: number;
  repetitionPenalty?: number;
  isGenerating?: boolean;
  generationProgress?: number;
  statusText?: string | null;
  lastError?: string | null;
  lastGeneratedAt?: number | null;
  [key: string]: unknown;
}

export interface TtsSavedVoiceNodeData extends NodeDisplayData, QwenTtsPauseConfig {
  presetAssetId?: string | null;
  voiceName: string;
  referenceTranscript: string;
  promptFile?: string | null;
  promptLabel?: string | null;
  language: TtsVoiceLanguage;
  outputFormat?: QwenTtsOutputFormat;
  maxNewTokens?: number;
  topP?: number;
  topK?: number;
  temperature?: number;
  repetitionPenalty?: number;
  isExtracting?: boolean;
  isGenerating?: boolean;
  generationProgress?: number;
  statusText?: string | null;
  lastError?: string | null;
  lastSavedAt?: number | null;
  lastGeneratedAt?: number | null;
  [key: string]: unknown;
}

export interface VoxCpmVoiceDesignNodeData extends NodeDisplayData {
  voicePrompt: string;
  cfgValue?: number;
  inferenceTimesteps?: number;
  normalize?: boolean;
  denoise?: boolean;
  isGenerating?: boolean;
  generationProgress?: number;
  statusText?: string | null;
  lastError?: string | null;
  lastGeneratedAt?: number | null;
  [key: string]: unknown;
}

export interface VoxCpmVoiceCloneNodeData extends NodeDisplayData {
  presetAssetId?: string | null;
  referenceAssetId?: string | null;
  controlText: string;
  cfgValue?: number;
  inferenceTimesteps?: number;
  normalize?: boolean;
  denoise?: boolean;
  isGenerating?: boolean;
  generationProgress?: number;
  statusText?: string | null;
  lastError?: string | null;
  lastGeneratedAt?: number | null;
  [key: string]: unknown;
}

export interface VoxCpmUltimateCloneNodeData extends NodeDisplayData {
  presetAssetId?: string | null;
  referenceAssetId?: string | null;
  promptText: string;
  useReferenceAsReference?: boolean;
  cfgValue?: number;
  inferenceTimesteps?: number;
  normalize?: boolean;
  denoise?: boolean;
  isGenerating?: boolean;
  generationProgress?: number;
  statusText?: string | null;
  lastError?: string | null;
  lastGeneratedAt?: number | null;
  [key: string]: unknown;
}

export type ReferenceTransferTargetKind = 'image' | 'video' | 'storyboard';
export type ReferenceTransferSourceKind = 'adScript' | 'shootingScript';

export interface ReferenceTransferItem {
  sourceRowId: string;
  shotNumber: string;
  title: string;
  summary?: string | null;
  lines: string[];
  renderedPrompt: string;
}

export interface ReferenceTransferPackage {
  sourceKind: ReferenceTransferSourceKind;
  sourceNodeId: string;
  targetKind: ReferenceTransferTargetKind;
  contextLines: string[];
  closingLines: string[];
  items: ReferenceTransferItem[];
  renderedPrompt: string;
}

export interface ImageEditNodeData extends NodeImageData {
  prompt: string;
  promptSource?: ReferenceTransferPackage | null;
  model: string;
  size: ImageSize;
  requestAspectRatio?: string;
  cameraParams?: CameraParamsSelection | null;
  extraParams?: Record<string, unknown>;
  isGenerating?: boolean;
  generationStartedAt?: number | null;
  generationDurationMs?: number;
  sourceStoryboardTableNodeId?: string | null;
  sourceStoryboardRowIds?: string[];
  sourceDurationGroupId?: string | null;
  targetVideoDurationSeconds?: 10 | 15;
  sourceAssetMaterialNodeId?: string | null;
  sourceImageResultNodeId?: string | null;
  referenceTokenMode?: 'namedAsset' | 'indexedImage';
  selectedStyleTemplateId?: string | null;
  selectedStyleTemplateName?: string | null;
  selectedStyleTemplatePrompt?: string | null;
  continuousReferenceChain?: {
    enabled: boolean;
    previousImageNodeId?: string | null;
    previousRowId?: string | null;
  };
}

export interface MultiAngleImageNodeData extends NodeDisplayData {
  model: string;
  size: ImageSize;
  requestAspectRatio?: string;
  horizontalAngle: number;
  verticalAngle: number;
  zoom: number;
  cameraView?: boolean;
  extraParams?: Record<string, unknown>;
  isGenerating?: boolean;
  generationStartedAt?: number | null;
  generationDurationMs?: number;
  lastError?: string | null;
  [key: string]: unknown;
}

export interface Panorama360NodeData extends NodeImageData {
  viewerYaw?: number;
  viewerPitch?: number;
  viewerFov?: number;
}

export interface DirectorStageNodeData extends NodeDisplayData {
  project: DirectorStageProject;
  lastSnapshotUrl?: string | null;
  lastSnapshotPreviewUrl?: string | null;
  lastSnapshotAt?: number | null;
  objectCount?: number;
  cameraShotCount?: number;
  activeCameraShotName?: string | null;
}

export interface BackgroundRemoveNodeData extends NodeDisplayData {
  statusText?: string | null;
  lastError?: string | null;
  lastGeneratedAt?: number | null;
  [key: string]: unknown;
}

export interface Seedvr2ImageUpscaleNodeData extends NodeDisplayData {
  targetResolution: Seedvr2ImageTargetResolution;
  isProcessing?: boolean | null;
  statusText?: string | null;
  lastError?: string | null;
  lastGeneratedAt?: number | null;
  [key: string]: unknown;
}

export interface Seedvr2VideoUpscaleNodeData extends NodeDisplayData {
  targetResolution: Seedvr2VideoTargetResolution;
  statusText?: string | null;
  lastError?: string | null;
  lastGeneratedAt?: number | null;
  [key: string]: unknown;
}

export interface ImageCollageLayerItem {
  sourceNodeId: string;
  sourceEdgeId: string;
  imageUrl: string;
  previewImageUrl?: string | null;
  placed: boolean;
  order: number;
  centerX: number;
  centerY: number;
  scale: number;
  rotationDeg: number;
  flipX: boolean;
  flipY: boolean;
}

export type ImageCollageBackgroundMode = 'transparent' | 'white';

export interface ImageCollageNodeData extends NodeDisplayData {
  aspectRatio: string;
  size: ImageSize;
  layers: ImageCollageLayerItem[];
  selectedLayerId: string | null;
  backgroundMode: ImageCollageBackgroundMode;
}

export interface JimengNodeData extends NodeDisplayData {
  prompt: string;
  promptSource?: ReferenceTransferPackage | null;
  referenceImageOrder?: string[];
  model?: JimengVideoModelId;
  referenceMode?: JimengReferenceMode;
  aspectRatio?: JimengAspectRatio;
  durationSeconds?: JimengDurationSeconds;
  videoResolution?: JimengVideoResolution;
  suggestedDurationSeconds?: number | null;
  suggestedDurationEstimatedSeconds?: number | null;
  suggestedDurationExceedsLimit?: boolean;
  suggestedDurationReason?: string | null;
  isSubmitting?: boolean;
  lastSubmittedAt?: number | null;
  lastError?: string | null;
  sourceStoryboardTableNodeId?: string | null;
  sourceStoryboardRowIds?: string[];
  sourceDurationGroupId?: string | null;
  targetVideoDurationSeconds?: 10 | 15;
  sourceImageNodeId?: string | null;
  sourceAssetMaterialNodeId?: string | null;
  sourceImageResultNodeId?: string | null;
  referenceTokenMode?: 'namedAsset' | 'indexedImage';
  continuousReferenceChain?: {
    enabled: boolean;
    previousImageNodeId?: string | null;
    previousRowId?: string | null;
  };
}

export interface JimengGeneratedImageItem {
  id: string;
  sourceUrl?: string | null;
  imageUrl: string | null;
  previewImageUrl?: string | null;
  thumbnailUrl?: string | null;
  aspectRatio: string;
  width?: number;
  height?: number;
  fileName?: string | null;
}

export type MjReferenceRole = 'reference' | 'styleReference';

export interface MjReferenceItem {
  imageUrl: string;
  previewImageUrl?: string | null;
  thumbnailUrl?: string | null;
  sourceNodeId: string;
  sourceEdgeId: string;
  role: MjReferenceRole;
  sortIndex: number;
}

export interface MjBatchImageItem {
  id: string;
  imageUrl: string | null;
  previewImageUrl?: string | null;
  thumbnailUrl?: string | null;
  sourceUrl?: string | null;
  index: number;
  aspectRatio: string;
  width?: number;
  height?: number;
}

export type MjResultNodeRole = 'root' | 'branch';
export type MjActionFamily =
  | 'upscale'
  | 'variation'
  | 'reroll'
  | 'zoom'
  | 'pan'
  | 'other';
export type MjActionScope = 'image' | 'batch';
export type MjModalKind = 'none' | 'customZoom' | 'remixPrompt' | 'unsupported';
export type MjAutoUpscaleMode = 'subtle' | 'creative';
export type MjAutoUpscaleStatus = 'pending' | 'submitted' | 'failed';

export interface MjActionButton {
  customId: string;
  label: string;
  type?: string | null;
  style?: string | null;
  emoji?: string | null;
  family: MjActionFamily;
  scope: MjActionScope;
  imageIndex?: number | null;
  actionKey: string;
  requiresModal: boolean;
  modalKind?: MjModalKind;
  groupIndex: number;
  order: number;
}

export interface MjAutoUpscaleChain {
  mode: MjAutoUpscaleMode;
  sourceImageIndex: number;
  status: MjAutoUpscaleStatus;
  targetNodeId?: string | null;
  targetBatchId?: string | null;
  targetTaskId?: string | null;
  error?: string | null;
}

export interface MjResultBatch {
  id: string;
  taskId: string;
  providerId: MidjourneyProviderId;
  action?: string | null;
  status: string;
  progress: string;
  prompt: string;
  promptEn?: string | null;
  finalPrompt?: string | null;
  images: MjBatchImageItem[];
  buttons: MjActionButton[];
  properties?: Record<string, unknown> | null;
  state?: Record<string, unknown> | string | null;
  submitTime?: number | null;
  startTime?: number | null;
  finishTime?: number | null;
  failReason?: string | null;
  isPolling: boolean;
  autoUpscaleChain?: MjAutoUpscaleChain | null;
}

export interface JimengGeneratedVideoItem {
  id: string;
  sourceUrl?: string | null;
  posterSourceUrl?: string | null;
  videoUrl: string | null;
  previewImageUrl?: string | null;
  aspectRatio: string;
  duration?: number;
  width?: number;
  height?: number;
  fileName?: string | null;
}

export interface JimengImageNodeData extends NodeDisplayData {
  prompt: string;
  promptSource?: ReferenceTransferPackage | null;
  modelVersion?: JimengImageModelVersion;
  aspectRatio?: JimengAspectRatio;
  resolutionType?: JimengImageResolutionType;
  cameraParams?: CameraParamsSelection | null;
  isGenerating?: boolean;
  generationStartedAt?: number | null;
  generationDurationMs?: number;
  lastGeneratedAt?: number | null;
  lastError?: string | null;
  resultImages?: JimengGeneratedImageItem[];
}

export interface MjNodeData extends NodeDisplayData {
  prompt: string;
  promptSource?: ReferenceTransferPackage | null;
  linkedResultNodeId?: string | null;
  references: MjReferenceItem[];
  aspectRatio?: MidjourneyAspectRatio;
  rawMode?: boolean;
  versionPreset?: MidjourneyVersionPreset;
  personalizationCodes: string[];
  advancedParams?: string;
  isSubmitting?: boolean;
  activeTaskId?: string | null;
  lastSubmittedAt?: number | null;
  lastError?: string | null;
}

export interface MjResultNodeData extends NodeDisplayData {
  sourceNodeId?: string | null;
  nodeRole?: MjResultNodeRole;
  rootSourceNodeId?: string | null;
  parentResultNodeId?: string | null;
  parentBatchId?: string | null;
  sourceImageIndex?: number | null;
  branchKey?: string | null;
  branchActionLabel?: string | null;
  batches: MjResultBatch[];
  activeBatchId?: string | null;
  lastError?: string | null;
  lastGeneratedAt?: number | null;
}

export interface JimengImageResultNodeData extends NodeDisplayData {
  sourceNodeId?: string | null;
  submitIds?: string[];
  prompt?: string | null;
  modelVersion?: JimengImageModelVersion;
  resolutionType?: JimengImageResolutionType;
  referenceImageCount?: number;
  aspectRatio: string;
  gridRows: number;
  gridCols: number;
  resultImages: JimengGeneratedImageItem[];
  isGenerating?: boolean;
  generationStartedAt?: number | null;
  generationDurationMs?: number;
  lastGeneratedAt?: number | null;
  lastError?: string | null;
}

export interface JimengVideoResultNodeData extends NodeDisplayData {
  sourceNodeId?: string | null;
  queueJobId?: string | null;
  queueStatus?: string | null;
  queueScheduledAt?: number | null;
  queueAttemptCount?: number;
  queueMaxAttempts?: number;
  submitId?: string | null;
  sourceUrl?: string | null;
  posterSourceUrl?: string | null;
  videoUrl: string | null;
  previewImageUrl?: string | null;
  videoFileName?: string | null;
  aspectRatio: string;
  duration?: number;
  width?: number;
  height?: number;
  autoRequeryEnabled?: boolean;
  autoRequeryIntervalSeconds?: number;
  isGenerating?: boolean;
  generationStartedAt?: number | null;
  generationDurationMs?: number;
  lastGeneratedAt?: number | null;
  lastError?: string | null;
}

export interface SeedanceNodeData extends NodeDisplayData {
  prompt: string;
  promptSource?: ReferenceTransferPackage | null;
  inputMode?: SeedanceInputMode;
  modelId?: SeedanceModelId;
  aspectRatio?: SeedanceAspectRatio;
  durationSeconds?: SeedanceDurationSeconds;
  resolution?: SeedanceResolution;
  generateAudio?: boolean;
  returnLastFrame?: boolean;
  isSubmitting?: boolean;
  lastSubmittedAt?: number | null;
  lastError?: string | null;
  sourceStoryboardTableNodeId?: string | null;
  sourceStoryboardRowIds?: string[];
  sourceDurationGroupId?: string | null;
  targetVideoDurationSeconds?: 10 | 15;
  sourceImageNodeId?: string | null;
  sourceAssetMaterialNodeId?: string | null;
  sourceImageResultNodeId?: string | null;
  referenceTokenMode?: 'namedAsset' | 'indexedImage';
  continuousReferenceChain?: {
    enabled: boolean;
    previousImageNodeId?: string | null;
    previousRowId?: string | null;
  };
}

export interface SeedanceVideoResultNodeData extends NodeDisplayData {
  sourceNodeId?: string | null;
  taskId?: string | null;
  taskStatus?: string | null;
  taskUpdatedAt?: number | null;
  modelId?: SeedanceModelId | string | null;
  inputMode?: SeedanceInputMode | null;
  videoUrl: string | null;
  previewImageUrl?: string | null;
  videoFileName?: string | null;
  aspectRatio: string;
  resolution?: SeedanceResolution | string | null;
  duration?: number;
  generateAudio?: boolean;
  returnLastFrame?: boolean;
  isGenerating?: boolean;
  generationStartedAt?: number | null;
  generationDurationMs?: number;
  lastGeneratedAt?: number | null;
  lastError?: string | null;
}

export interface GptBestVideoNodeData extends NodeDisplayData {
  prompt: string;
  sourceKind: GptBestVideoSourceKind;
  providerId?: string | null;
  modelId: string;
  size?: GptBestVideoSize | string | null;
  seconds?: GptBestVideoDurationSeconds | number | null;
  aspectRatio?: string | null;
  durationSeconds?: number | null;
  resolution?: string | null;
  isSubmitting?: boolean;
  lastSubmittedAt?: number | null;
  lastError?: string | null;
}

export interface GptBestVideoRequestSnapshot {
  provider: string;
  sourceKind: GptBestVideoSourceKind;
  modelId: string;
  prompt: string;
  size: string;
  seconds: number;
  submittedAt: number;
}

export interface GptBestVideoResultNodeData extends NodeDisplayData {
  sourceNodeId?: string | null;
  provider?: string;
  sourceKind: GptBestVideoSourceKind;
  taskId?: string | null;
  taskStatus?: string | null;
  taskUpdatedAt?: number | null;
  modelId?: string | null;
  videoUrl: string | null;
  previewImageUrl?: string | null;
  videoFileName?: string | null;
  aspectRatio: string;
  size?: string | null;
  resolution?: string | null;
  duration?: number;
  requestSnapshot?: GptBestVideoRequestSnapshot | null;
  isGenerating?: boolean;
  generationStartedAt?: number | null;
  generationDurationMs?: number;
  lastGeneratedAt?: number | null;
  lastError?: string | null;
}

export interface ViduNodeData extends NodeDisplayData {
  prompt: string;
  inputMode: ViduInputMode;
  modelId: ViduModelId;
  aspectRatio: ViduAspectRatio;
  durationSeconds: ViduDurationSeconds;
  resolution: ViduResolution;
  audio: boolean;
  bgm: boolean;
  isSubmitting?: boolean;
  lastSubmittedAt?: number | null;
  lastError?: string | null;
}

export interface ViduVideoRequestSnapshot {
  provider: 'vidu';
  inputMode: ViduInputMode;
  modelId: string;
  prompt: string;
  imageCount: number;
  videoCount: number;
  aspectRatio: string;
  durationSeconds: number;
  resolution: string;
  audio: boolean;
  bgm: boolean;
  submittedAt: number;
}

export interface ViduVideoResultNodeData extends NodeDisplayData {
  sourceNodeId?: string | null;
  provider?: 'vidu';
  inputMode?: ViduInputMode | null;
  taskId?: string | null;
  taskStatus?: string | null;
  taskUpdatedAt?: number | null;
  modelId?: string | null;
  videoUrl: string | null;
  previewImageUrl?: string | null;
  videoFileName?: string | null;
  aspectRatio: string;
  resolution?: string | null;
  duration?: number;
  requestSnapshot?: ViduVideoRequestSnapshot | null;
  isGenerating?: boolean;
  generationStartedAt?: number | null;
  generationDurationMs?: number;
  lastGeneratedAt?: number | null;
  lastError?: string | null;
}

export interface StoryboardFrameItem {
  id: string;
  imageUrl: string | null;
  previewImageUrl?: string | null;
  thumbnailUrl?: string | null;
  aspectRatio?: string;
  sourceNodeId?: string | null;
  sourceEdgeId?: string | null;
  note: string;
  order: number;
}

export interface StoryboardExportOptions {
  showFrameIndex: boolean;
  showFrameNote: boolean;
  notePlacement: 'overlay' | 'bottom';
  imageFit: 'cover' | 'contain';
  frameIndexPrefix: string;
  cellGap: number;
  outerPadding: number;
  fontSize: number;
  backgroundColor: string;
  textColor: string;
}

export interface StoryboardSplitNodeData {
  displayName?: string;
  sourceNodeId?: string | null;
  aspectRatio: string;
  frameAspectRatio?: string;
  gridRows: number;
  gridCols: number;
  frames: StoryboardFrameItem[];
  exportOptions?: StoryboardExportOptions;
  [key: string]: unknown;
}

export interface StoryboardSplitResultNodeData {
  displayName?: string;
  sourceNodeId?: string | null;
  aspectRatio: string;
  frameAspectRatio?: string;
  gridRows: number;
  gridCols: number;
  frames: StoryboardFrameItem[];
  [key: string]: unknown;
}

export interface StoryboardGenFrameItem {
  id: string;
  description: string;
  referenceIndex: number | null;
  sourcePackage?: ReferenceTransferPackage | null;
}

export type StoryboardRatioControlMode = 'overall' | 'cell';

export interface StoryboardGenNodeData {
  displayName?: string;
  gridRows: number;
  gridCols: number;
  frames: StoryboardGenFrameItem[];
  ratioControlMode?: StoryboardRatioControlMode;
  model: string;
  size: ImageSize;
  requestAspectRatio: string;
  extraParams?: Record<string, unknown>;
  imageUrl: string | null;
  previewImageUrl?: string | null;
  aspectRatio: string;
  isGenerating?: boolean;
  generationStartedAt?: number | null;
  generationDurationMs?: number;
  sourceDirectorPackageId?: string | null;
  sourceSectionId?: string | null;
  sourceShotId?: string | null;
  sourceStoryboardTableNodeId?: string | null;
  sourceStoryboardRowIds?: string[];
  sourceDurationGroupId?: string | null;
  targetVideoDurationSeconds?: 10 | 15;
  continuousReferenceChain?: {
    enabled: boolean;
    previousRowId?: string | null;
  };
  promptText?: string;
  videoPromptText?: string;
  referenceAssets?: ReferenceAssetSnapshot[];
  productionJobId?: string | null;
  [key: string]: unknown;
}

function normalizeImageAspectRatioValue(value: unknown): string {
  return typeof value === 'string' && IMAGE_ASPECT_RATIOS.includes(value as (typeof IMAGE_ASPECT_RATIOS)[number])
    ? value
    : DEFAULT_ASPECT_RATIO;
}

function normalizeLooseAspectRatioValue(value: unknown): string {
  return normalizeString(value).trim() || DEFAULT_ASPECT_RATIO;
}

function normalizeImageSizeValue(value: unknown): ImageSize {
  return typeof value === 'string' && IMAGE_SIZES.includes(value as ImageSize)
    ? value as ImageSize
    : '1K';
}

function normalizeFiniteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function normalizeBooleanValue(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function normalizeExportImageNodeResultKind(
  value: unknown
): ExportImageNodeResultKind {
  switch (value) {
    case 'backgroundRemoved':
    case 'storyboardGenOutput':
    case 'storyboardSplitExport':
    case 'storyboardFrameEdit':
    case 'imageCollageExport':
      return value;
    default:
      return 'generic';
  }
}

function normalizeExportImageGenerationSourceType(
  value: unknown
): ExportImageGenerationSourceType | null {
  return value === 'imageEdit' || value === 'storyboardGen' || value === 'multiAngleImage'
    ? value
    : null;
}

function normalizeExportImageGenerationPhase(
  value: unknown
): ExportImageGenerationPhase | null {
  switch (value) {
    case 'submitting':
    case 'queued':
    case 'running':
    case 'failed':
    case 'succeeded':
      return value;
    default:
      return null;
  }
}

function normalizeExportImageGenerationFailureStage(
  value: unknown
): ExportImageGenerationFailureStage | null {
  return value === 'submit' || value === 'run' ? value : null;
}

export function normalizeExportImageGenerationSummary(
  value: unknown
): ExportImageGenerationSummary | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const record = value as Partial<ExportImageGenerationSummary>;
  const sourceType = normalizeExportImageGenerationSourceType(record.sourceType);
  if (!sourceType) {
    return null;
  }

  return {
    sourceType,
    providerId: normalizeString(record.providerId).trim(),
    requestModel: normalizeString(record.requestModel).trim(),
    prompt: normalizeString(record.prompt).trim(),
    generatedAt: Number.isFinite(record.generatedAt) ? Number(record.generatedAt) : null,
  };
}

function normalizeStoryboardProductionImageResult(
  value: unknown,
  index: number
): StoryboardProductionImageResult | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const record = value as Partial<StoryboardProductionImageResult>;
  const imageUrl = normalizeString(record.imageUrl).trim();
  if (!imageUrl) {
    return null;
  }

  return {
    id: normalizeString(record.id).trim() || `storyboard-production-result-${index + 1}`,
    imageUrl,
    previewImageUrl: normalizeString(record.previewImageUrl).trim() || imageUrl,
    thumbnailUrl: normalizeString(record.thumbnailUrl).trim() || null,
    aspectRatio: normalizeString(record.aspectRatio).trim() || null,
    generationSummary: normalizeExportImageGenerationSummary(record.generationSummary),
    createdAt: Number.isFinite(record.createdAt) ? Number(record.createdAt) : Date.now(),
  };
}

function normalizeStoryboardProductionImageResults(
  value: unknown
): StoryboardProductionImageResult[] {
  return (Array.isArray(value) ? value : [])
    .map((item, index) => normalizeStoryboardProductionImageResult(item, index))
    .filter((item): item is StoryboardProductionImageResult => Boolean(item));
}

function normalizeMidjourneyAspectRatioValue(value: unknown): MidjourneyAspectRatio {
  return typeof value === 'string'
    && MIDJOURNEY_ASPECT_RATIOS.includes(value as MidjourneyAspectRatio)
    ? value as MidjourneyAspectRatio
    : MIDJOURNEY_ASPECT_RATIOS[0];
}

function normalizeMidjourneyVersionPresetValue(value: unknown): MidjourneyVersionPreset {
  return typeof value === 'string'
    && MIDJOURNEY_VERSION_PRESETS.includes(value as MidjourneyVersionPreset)
    ? value as MidjourneyVersionPreset
    : MIDJOURNEY_VERSION_PRESETS[0];
}

function normalizeMjReferenceRole(value: unknown): MjReferenceRole {
  return value === 'styleReference' ? 'styleReference' : 'reference';
}

function normalizeMjResultNodeRole(value: unknown): MjResultNodeRole {
  return value === 'branch' ? 'branch' : 'root';
}

function normalizeMjActionFamily(value: unknown): MjActionFamily {
  switch (value) {
    case 'upscale':
    case 'variation':
    case 'reroll':
    case 'zoom':
    case 'pan':
      return value;
    default:
      return 'other';
  }
}

function normalizeMjActionScope(value: unknown): MjActionScope {
  return value === 'image' ? 'image' : 'batch';
}

function normalizeMjModalKind(value: unknown): MjModalKind {
  switch (value) {
    case 'customZoom':
    case 'remixPrompt':
    case 'unsupported':
      return value;
    default:
      return 'none';
  }
}

function normalizeMjAutoUpscaleMode(value: unknown): MjAutoUpscaleMode {
  return value === 'creative' ? 'creative' : 'subtle';
}

function normalizeMjAutoUpscaleStatus(value: unknown): MjAutoUpscaleStatus {
  switch (value) {
    case 'submitted':
    case 'failed':
      return value;
    default:
      return 'pending';
  }
}

function normalizeStructuredRecord(
  value: unknown
): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function normalizeMjStateValue(
  value: unknown
): Record<string, unknown> | string | null {
  if (typeof value === 'string') {
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
  }

  return normalizeStructuredRecord(value);
}

function normalizeMjAutoUpscaleChain(
  value: unknown
): MjAutoUpscaleChain | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const record = value as Partial<MjAutoUpscaleChain>;
  const sourceImageIndex = Number.isFinite(record.sourceImageIndex)
    ? Math.max(0, Math.round(Number(record.sourceImageIndex)))
    : null;
  if (sourceImageIndex === null) {
    return null;
  }

  return {
    mode: normalizeMjAutoUpscaleMode(record.mode),
    sourceImageIndex,
    status: normalizeMjAutoUpscaleStatus(record.status),
    targetNodeId: normalizeString(record.targetNodeId).trim() || null,
    targetBatchId: normalizeString(record.targetBatchId).trim() || null,
    targetTaskId: normalizeString(record.targetTaskId).trim() || null,
    error: normalizeString(record.error).trim() || null,
  };
}

function normalizeMjReferenceItems(value: unknown): MjReferenceItem[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const items = value
    .map((item, index): MjReferenceItem | null => {
      if (!item || typeof item !== 'object') {
        return null;
      }

      const record = item as Partial<MjReferenceItem>;
      const imageUrl = normalizeString(record.imageUrl).trim();
      const previewImageUrl = normalizeString(record.previewImageUrl).trim();
      const sourceNodeId = normalizeString(record.sourceNodeId).trim();
      const sourceEdgeId = normalizeString(record.sourceEdgeId).trim();
      if (!imageUrl || !sourceNodeId || !sourceEdgeId) {
        return null;
      }

      return {
        imageUrl,
        previewImageUrl: previewImageUrl || null,
        thumbnailUrl: normalizeString(record.thumbnailUrl).trim() || null,
        sourceNodeId,
        sourceEdgeId,
        role: normalizeMjReferenceRole(record.role),
        sortIndex: Math.max(0, Math.round(normalizeFiniteNumber(record.sortIndex, index))),
      };
    })
    .filter((item): item is MjReferenceItem => Boolean(item))
    .sort((left, right) => {
      const sortDelta = left.sortIndex - right.sortIndex;
      if (sortDelta !== 0) {
        return sortDelta;
      }
      return left.imageUrl.localeCompare(right.imageUrl);
    });

  return items.map((item, index) => ({
    ...item,
    sortIndex: index,
  }));
}

function normalizeMjActionButtons(value: unknown): MjActionButton[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item, index): MjActionButton | null => {
      if (!item || typeof item !== 'object') {
        return null;
      }

      const record = item as Partial<MjActionButton>;
      const customId = normalizeString(record.customId).trim();
      const actionKey = normalizeString(record.actionKey).trim();
      if (!customId || !actionKey) {
        return null;
      }

      return {
        customId,
        label: normalizeString(record.label).trim() || customId,
        type: normalizeString(record.type).trim() || null,
        style: normalizeString(record.style).trim() || null,
        emoji: normalizeString(record.emoji).trim() || null,
        family: normalizeMjActionFamily(record.family),
        scope: normalizeMjActionScope(record.scope),
        imageIndex: Number.isFinite(record.imageIndex) ? Math.max(0, Math.round(Number(record.imageIndex))) : null,
        actionKey,
        requiresModal: normalizeBooleanValue(record.requiresModal),
        modalKind: normalizeMjModalKind(record.modalKind),
        groupIndex: Math.max(0, Math.round(normalizeFiniteNumber(record.groupIndex, 0))),
        order: Math.max(0, Math.round(normalizeFiniteNumber(record.order, index))),
      };
    })
    .filter((item): item is MjActionButton => Boolean(item))
    .sort((left, right) => {
      const groupDelta = left.groupIndex - right.groupIndex;
      if (groupDelta !== 0) {
        return groupDelta;
      }
      const orderDelta = left.order - right.order;
      if (orderDelta !== 0) {
        return orderDelta;
      }
      return left.label.localeCompare(right.label);
    });
}

function normalizeMjBatchImageItems(value: unknown, fallbackAspectRatio: string): MjBatchImageItem[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item, index): MjBatchImageItem | null => {
      if (!item || typeof item !== 'object') {
        return null;
      }

      const record = item as Partial<MjBatchImageItem>;
      return {
        id: normalizeString(record.id, `mj-batch-image-${index + 1}`),
        imageUrl: normalizeString(record.imageUrl).trim() || null,
        previewImageUrl: normalizeString(record.previewImageUrl).trim() || null,
        thumbnailUrl: normalizeString(record.thumbnailUrl).trim() || null,
        sourceUrl: normalizeString(record.sourceUrl).trim() || null,
        index: Math.max(0, Math.round(normalizeFiniteNumber(record.index, index))),
        aspectRatio: normalizeString(record.aspectRatio).trim() || fallbackAspectRatio,
        width: Number.isFinite(record.width) ? Number(record.width) : undefined,
        height: Number.isFinite(record.height) ? Number(record.height) : undefined,
      };
    })
    .filter((item): item is MjBatchImageItem => Boolean(item))
    .sort((left, right) => left.index - right.index);
}

function normalizeMjResultBatches(value: unknown, fallbackAspectRatio: string): MjResultBatch[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item, index): MjResultBatch | null => {
      if (!item || typeof item !== 'object') {
        return null;
      }

      const record = item as Partial<MjResultBatch>;
      const taskId = normalizeString(record.taskId).trim();
      if (!taskId) {
        return null;
      }

      return {
        id: normalizeString(record.id, `mj-batch-${index + 1}`),
        taskId,
        providerId: normalizeMidjourneyProviderId(record.providerId),
        action: normalizeString(record.action).trim() || null,
        status: normalizeString(record.status, 'queued').trim() || 'queued',
        progress: normalizeString(record.progress).trim(),
        prompt: normalizeString(record.prompt).trim(),
        promptEn: normalizeString(record.promptEn).trim() || null,
        finalPrompt: normalizeString(record.finalPrompt).trim() || null,
        images: normalizeMjBatchImageItems(record.images, fallbackAspectRatio),
        buttons: normalizeMjActionButtons(record.buttons),
        properties: normalizeStructuredRecord(record.properties),
        state: normalizeMjStateValue(record.state),
        submitTime: Number.isFinite(record.submitTime) ? Number(record.submitTime) : null,
        startTime: Number.isFinite(record.startTime) ? Number(record.startTime) : null,
        finishTime: Number.isFinite(record.finishTime) ? Number(record.finishTime) : null,
        failReason: normalizeString(record.failReason).trim() || null,
        isPolling: normalizeBooleanValue(record.isPolling),
        autoUpscaleChain: normalizeMjAutoUpscaleChain(record.autoUpscaleChain),
      };
    })
    .filter((item): item is MjResultBatch => Boolean(item));
}

function normalizeImageCollageLayerItems(value: unknown): ImageCollageLayerItem[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const layers = value
    .map((item, index): ImageCollageLayerItem | null => {
      if (!item || typeof item !== 'object') {
        return null;
      }

      const record = item as Partial<ImageCollageLayerItem>;
      const sourceEdgeId = normalizeString(record.sourceEdgeId).trim();
      const sourceNodeId = normalizeString(record.sourceNodeId).trim();
      const imageUrl = normalizeString(record.imageUrl).trim();
      if (!sourceEdgeId || !sourceNodeId || !imageUrl) {
        return null;
      }

      const previewImageUrl = normalizeString(record.previewImageUrl).trim() || imageUrl;

      return {
        sourceNodeId,
        sourceEdgeId,
        imageUrl,
        previewImageUrl,
        placed: normalizeBooleanValue(record.placed),
        order: Math.round(normalizeFiniteNumber(record.order, index)),
        centerX: normalizeFiniteNumber(record.centerX, 0.5),
        centerY: normalizeFiniteNumber(record.centerY, 0.5),
        scale: Math.max(0.05, normalizeFiniteNumber(record.scale, 1)),
        rotationDeg: normalizeFiniteNumber(record.rotationDeg, 0),
        flipX: normalizeBooleanValue(record.flipX),
        flipY: normalizeBooleanValue(record.flipY),
      };
    })
    .filter((item): item is ImageCollageLayerItem => item !== null)
    .sort((left, right) => {
      const orderDelta = left.order - right.order;
      if (orderDelta !== 0) {
        return orderDelta;
      }
      return left.sourceEdgeId.localeCompare(right.sourceEdgeId);
    });

  return layers.map((layer, index) => ({
    ...layer,
    order: index,
  }));
}

function normalizeImageCollageBackgroundMode(value: unknown): ImageCollageBackgroundMode {
  return value === 'white' ? 'white' : 'transparent';
}

export function normalizeImageCollageNodeData(
  data: Partial<ImageCollageNodeData> | null | undefined
): ImageCollageNodeData {
  const layers = normalizeImageCollageLayerItems(data?.layers);
  const selectedLayerId = normalizeString(data?.selectedLayerId).trim();

  return {
    displayName: normalizeString(data?.displayName).trim() || undefined,
    aspectRatio: normalizeImageAspectRatioValue(data?.aspectRatio),
    size: normalizeImageSizeValue(data?.size),
    layers,
    selectedLayerId: layers.some((layer) => layer.sourceEdgeId === selectedLayerId)
      ? selectedLayerId
      : null,
    backgroundMode: normalizeImageCollageBackgroundMode(data?.backgroundMode),
  };
}

function normalizeImageCompareSourceNodeType(
  value: unknown
): ImageCompareSourceNodeType | null {
  if (value === CANVAS_NODE_TYPES.upload || value === CANVAS_NODE_TYPES.exportImage) {
    return value;
  }

  return null;
}

function normalizeImageCompareNodeImageSnapshot(
  value: unknown
): ImageCompareNodeImageSnapshot {
  const record = value && typeof value === 'object'
    ? value as Partial<ImageCompareNodeImageSnapshot>
    : {};

  return {
    sourceNodeId: normalizeString(record.sourceNodeId).trim() || null,
    sourceNodeType: normalizeImageCompareSourceNodeType(record.sourceNodeType),
    imageUrl: normalizeString(record.imageUrl).trim() || null,
    previewImageUrl: normalizeString(record.previewImageUrl).trim() || null,
    thumbnailUrl: normalizeString(record.thumbnailUrl).trim() || null,
    aspectRatio: normalizeLooseAspectRatioValue(record.aspectRatio),
    displayName: normalizeString(record.displayName).trim() || null,
  };
}

function normalizeStaticImageCompareSnapshotData(
  type: ImageCompareSourceNodeType,
  value: unknown
): UploadImageNodeData | ExportImageNodeData {
  const record = value && typeof value === 'object'
    ? value as Partial<UploadImageNodeData & ExportImageNodeData>
    : {};

  const baseData = {
    displayName: normalizeString(record.displayName).trim() || undefined,
    nodeDescription: normalizeString(record.nodeDescription).trim() || null,
    semanticColor: record.semanticColor ?? null,
    imageUrl: normalizeString(record.imageUrl).trim() || null,
    previewImageUrl: normalizeString(record.previewImageUrl).trim() || null,
    thumbnailUrl: normalizeString(record.thumbnailUrl).trim() || null,
    aspectRatio: normalizeLooseAspectRatioValue(record.aspectRatio),
    imageWidth: Number.isFinite(record.imageWidth) ? Number(record.imageWidth) : undefined,
    imageHeight: Number.isFinite(record.imageHeight) ? Number(record.imageHeight) : undefined,
    isSizeManuallyAdjusted: normalizeBooleanValue(record.isSizeManuallyAdjusted),
    assetId: normalizeString(record.assetId).trim() || null,
    assetLibraryId: normalizeString(record.assetLibraryId).trim() || null,
    assetName: normalizeString(record.assetName).trim() || null,
    assetCategory: normalizeString(record.assetCategory).trim() || null,
  };

  if (type === CANVAS_NODE_TYPES.upload) {
    return {
      ...baseData,
      sourceFileName: normalizeString(record.sourceFileName).trim() || null,
    };
  }

  return {
    ...baseData,
    resultKind: normalizeExportImageNodeResultKind(record.resultKind),
    generationSummary: normalizeExportImageGenerationSummary(record.generationSummary),
    generationPhase: normalizeExportImageGenerationPhase(record.generationPhase),
    generationFailureStage: normalizeExportImageGenerationFailureStage(
      record.generationFailureStage
    ),
    generationStatusText: normalizeString(record.generationStatusText).trim() || null,
    isStoryboardProductionPlaceholder: normalizeBooleanValue(record.isStoryboardProductionPlaceholder, false),
    sourceImageNodeId: normalizeString(record.sourceImageNodeId).trim() || null,
    sourceStoryboardTableNodeId: normalizeString(record.sourceStoryboardTableNodeId).trim() || null,
    sourceStoryboardRowIds: normalizeStringArray(record.sourceStoryboardRowIds),
    sourceDurationGroupId: normalizeString(record.sourceDurationGroupId).trim() || null,
    storyboardProductionResults: normalizeStoryboardProductionImageResults(
      record.storyboardProductionResults
    ),
    selectedStoryboardProductionResultId:
      normalizeString(record.selectedStoryboardProductionResultId).trim() || null,
  };
}

function normalizeImageCompareRestorableNodeSnapshot(
  value: unknown
): ImageCompareRestorableNodeSnapshot | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const record = value as Partial<ImageCompareRestorableNodeSnapshot>;
  const id = normalizeString(record.id).trim();
  const type = normalizeImageCompareSourceNodeType(record.type);
  if (!id || !type) {
    return null;
  }

  return {
    id,
    type,
    position: {
      x: Number.isFinite(record.position?.x) ? Number(record.position?.x) : 0,
      y: Number.isFinite(record.position?.y) ? Number(record.position?.y) : 0,
    },
    width: Number.isFinite(record.width) ? Number(record.width) : undefined,
    height: Number.isFinite(record.height) ? Number(record.height) : undefined,
    originalIndex: Number.isFinite(record.originalIndex)
      ? Math.max(0, Math.round(Number(record.originalIndex)))
      : 0,
    data: normalizeStaticImageCompareSnapshotData(type, record.data),
  };
}

function buildImageCompareNodeImageSnapshotFromRestorableNode(
  snapshot: ImageCompareRestorableNodeSnapshot
): ImageCompareNodeImageSnapshot {
  return {
    sourceNodeId: snapshot.id,
    sourceNodeType: snapshot.type,
    imageUrl: snapshot.data.imageUrl,
    previewImageUrl: snapshot.data.previewImageUrl ?? snapshot.data.imageUrl,
    aspectRatio: normalizeLooseAspectRatioValue(snapshot.data.aspectRatio),
    displayName: normalizeString(snapshot.data.displayName).trim() || null,
  };
}

export function normalizeImageCompareNodeData(
  data: Partial<ImageCompareNodeData> | null | undefined
): ImageCompareNodeData {
  const rawMergeMeta = data?.mergeMeta && typeof data.mergeMeta === 'object'
    ? data.mergeMeta as Partial<ImageCompareNodeMergeMeta>
    : null;
  const baseNode = normalizeImageCompareRestorableNodeSnapshot(rawMergeMeta?.baseNode);
  const overlayNode = normalizeImageCompareRestorableNodeSnapshot(rawMergeMeta?.overlayNode);
  const mergeMeta = baseNode && overlayNode
    ? {
        baseNode,
        overlayNode,
      }
    : null;
  const fallbackBaseImage = mergeMeta
    ? buildImageCompareNodeImageSnapshotFromRestorableNode(mergeMeta.baseNode)
    : null;
  const fallbackOverlayImage = mergeMeta
    ? buildImageCompareNodeImageSnapshotFromRestorableNode(mergeMeta.overlayNode)
    : null;
  const baseImage = normalizeImageCompareNodeImageSnapshot(data?.baseImage);
  const overlayImage = normalizeImageCompareNodeImageSnapshot(data?.overlayImage);
  const dividerRatio = normalizeFiniteNumber(data?.dividerRatio, 0.5);

  return {
    displayName: normalizeString(data?.displayName).trim() || undefined,
    nodeDescription: normalizeString(data?.nodeDescription).trim() || null,
    semanticColor: data?.semanticColor ?? null,
    baseImage: {
      ...(fallbackBaseImage ?? {}),
      ...baseImage,
      aspectRatio: normalizeLooseAspectRatioValue(baseImage.aspectRatio || fallbackBaseImage?.aspectRatio),
    },
    overlayImage: {
      ...(fallbackOverlayImage ?? {}),
      ...overlayImage,
      aspectRatio: normalizeLooseAspectRatioValue(overlayImage.aspectRatio || fallbackOverlayImage?.aspectRatio),
    },
    dividerRatio: Math.min(1, Math.max(0, dividerRatio)),
    mergeMeta,
  };
}

export function normalizeMjNodeData(
  data: Partial<MjNodeData> | null | undefined
): MjNodeData {
  return {
    displayName: normalizeString(data?.displayName).trim() || undefined,
    nodeDescription: normalizeString(data?.nodeDescription).trim() || null,
    semanticColor: data?.semanticColor ?? null,
    prompt: normalizeString(data?.prompt),
    promptSource: normalizeReferenceTransferPackage(data?.promptSource),
    linkedResultNodeId: normalizeString(data?.linkedResultNodeId).trim() || null,
    references: normalizeMjReferenceItems(data?.references),
    aspectRatio: normalizeMidjourneyAspectRatioValue(data?.aspectRatio),
    rawMode: normalizeBooleanValue(data?.rawMode),
    versionPreset: normalizeMidjourneyVersionPresetValue(data?.versionPreset),
    personalizationCodes: normalizeMjPersonalizationCodes(data?.personalizationCodes),
    advancedParams: normalizeString(data?.advancedParams).trim(),
    isSubmitting: normalizeBooleanValue(data?.isSubmitting),
    activeTaskId: normalizeString(data?.activeTaskId).trim() || null,
    lastSubmittedAt: Number.isFinite(data?.lastSubmittedAt) ? Number(data?.lastSubmittedAt) : null,
    lastError: normalizeString(data?.lastError).trim() || null,
  };
}

export function normalizeMjResultNodeData(
  data: Partial<MjResultNodeData> | null | undefined
): MjResultNodeData {
  const batches = normalizeMjResultBatches(data?.batches, DEFAULT_ASPECT_RATIO);
  const activeBatchId = normalizeString(data?.activeBatchId).trim();
  const nodeRole = normalizeMjResultNodeRole(data?.nodeRole);
  const sourceNodeId = normalizeString(data?.sourceNodeId).trim() || null;
  const parentResultNodeId = normalizeString(data?.parentResultNodeId).trim() || null;
  const resolvedActiveBatchId =
    batches.some((batch) => batch.id === activeBatchId)
      ? activeBatchId
      : batches[0]?.id ?? null;

  return {
    displayName: normalizeString(data?.displayName).trim() || undefined,
    nodeDescription: normalizeString(data?.nodeDescription).trim() || null,
    semanticColor: data?.semanticColor ?? null,
    sourceNodeId,
    nodeRole,
    rootSourceNodeId:
      normalizeString(data?.rootSourceNodeId).trim()
      || (nodeRole === 'root' ? sourceNodeId : null),
    parentResultNodeId,
    parentBatchId: normalizeString(data?.parentBatchId).trim() || null,
    sourceImageIndex: Number.isFinite(data?.sourceImageIndex)
      ? Math.max(0, Math.round(Number(data?.sourceImageIndex)))
      : null,
    branchKey: normalizeString(data?.branchKey).trim() || null,
    branchActionLabel: normalizeString(data?.branchActionLabel).trim() || null,
    batches,
    activeBatchId: resolvedActiveBatchId,
    lastError: normalizeString(data?.lastError).trim() || null,
    lastGeneratedAt: Number.isFinite(data?.lastGeneratedAt) ? Number(data?.lastGeneratedAt) : null,
  };
}

export type ShotRowGenTarget = 'image' | 'video' | 'storyboard';
export type ShotRowStatus = 'draft' | 'ready' | 'locked';
export type ShotScriptStatus = 'empty' | 'drafting' | 'ready';
export type ShootingScriptStatus = 'empty' | 'drafting' | 'ready';
export type ShootingScriptColumnKey =
  | 'shotNumber'
  | 'beat'
  | 'action'
  | 'composition'
  | 'camera'
  | 'duration'
  | 'audio'
  | 'genTarget'
  | 'genPrompt'
  | 'blocking'
  | 'artLighting'
  | 'continuityNote'
  | 'directorIntent'
  | 'status';

export interface ShotRow {
  id: string;
  shotNumber: string;
  beat: string;
  action: string;
  dialogueCue: string;
  shotSize: string;
  framingAngle: string;
  cameraMove: string;
  blocking: string;
  rhythmDuration: string;
  audioCue: string;
  artLighting: string;
  continuityNote: string;
  genTarget: ShotRowGenTarget;
  genPrompt: string;
  status: ShotRowStatus;
}

export interface ShootingScriptRow {
  id: string;
  shotNumber: string;
  beat: string;
  action: string;
  composition: string;
  camera: string;
  duration: string;
  audio: string;
  blocking: string;
  artLighting: string;
  continuityNote: string;
  directorIntent: string;
  genTarget: ShotRowGenTarget;
  genPrompt: string;
  status: ShotRowStatus;
}

export interface ShootingScriptSourceSnapshot {
  chapterTitle: string;
  sceneTitle: string;
  sceneSummary: string;
  episodeTitle: string;
  episodeSummary: string;
  episodeDraft: string;
  episodeDirectorNotes: string;
  continuitySummary: string;
  continuityFacts: string[];
  continuityOpenLoops: string[];
}

export type ScriptReferenceSyncStatus =
  | 'idle'
  | 'ready'
  | 'missingProject'
  | 'missingScript'
  | 'missingEpisode'
  | 'missingRows'
  | 'stale';

export type ScriptAssetReferenceSyncStatus =
  | 'idle'
  | 'ready'
  | 'missingProject'
  | 'missingAsset'
  | 'stale';

export interface ScriptReferenceShotRowSnapshot {
  id: string;
  shotNumber: string;
  beat: string;
  genTarget: ShotRowGenTarget;
  genPrompt: string;
  status: ShotRowStatus;
}

export interface ScriptReferenceScriptSnapshot {
  scriptNodeId: string | null;
  chapterId: string | null;
  chapterTitle: string;
  sceneNodeId: string | null;
  sceneTitle: string;
  episodeId: string;
  episodeTitle: string;
  episodeLabel: string;
  rows: ScriptReferenceShotRowSnapshot[];
}

export type AdScriptReferenceSyncStatus =
  | 'idle'
  | 'ready'
  | 'missingProject'
  | 'missingRows'
  | 'stale';

export interface AdScriptReferenceRowSnapshot {
  id: string;
  shotNumber: string;
  duration: string;
  objective: string;
  visual: string;
  dialogueOrVO: string;
  camera: string;
  audio: string;
  productFocus: string;
  sellingPoint: string;
  cta: string;
  assetHint: string;
  directorIntent: string;
  status: string;
}

export interface AdScriptReferenceSnapshot {
  templateId: AdScriptTemplateId;
  brief: AdBrief;
  lastGeneratedAt: number | null;
  rows: AdScriptReferenceRowSnapshot[];
}

export interface ScriptCharacterReferenceSnapshot {
  name: string;
  description: string;
  personality: string;
  appearance: string;
}

export interface ScriptLocationReferenceSnapshot {
  name: string;
  description: string;
  appearances: string[];
}

export interface ScriptItemReferenceSnapshot {
  name: string;
  description: string;
  appearances: string[];
}

export interface StyleProfile {
  dialogueRatio: number;
  actionDetailLevel: string;
  slangTerms: string[];
}

export interface BranchOption {
  id: string;
  label: string;
  targetChapterId: string;
  description: string;
}

export interface PlotPoint {
  id: string;
  type: 'setup' | 'conflict' | 'result' | 'emotional_shift';
  description: string;
}

export interface ScriptTableRow {
  [key: string]: string;
}

export interface ScriptTable {
  id: string;
  type: 'dialogue' | 'scene' | 'custom';
  columns: string[]; 
  rows: ScriptTableRow[];
}

export type StoryBeatKey =
  | 'opening'
  | 'inciting'
  | 'lock_in'
  | 'first_setback'
  | 'midpoint'
  | 'all_is_lost'
  | 'climax'
  | 'resolution';

export interface StoryBeat {
  id: string;
  key: StoryBeatKey;
  title: string;
  summary: string;
  dramaticQuestion: string;
}

export type SceneCardStatus = 'idea' | 'drafting' | 'reviewed' | 'locked';

export type SceneCopilotMessageMode =
  | 'analysis'
  | 'continue'
  | 'director'
  | 'custom'
  | 'selection'
  | 'seed';

export type SceneCopilotSelectionResolution =
  | 'pending'
  | 'replaced'
  | 'inserted'
  | 'dismissed';

export type SceneContinuityIssueSeverity = 'low' | 'medium' | 'high';

export interface SceneContinuityIssue {
  id: string;
  severity: SceneContinuityIssueSeverity;
  title: string;
  detail: string;
  evidence?: string;
}

export interface SceneContinuityCheck {
  status: 'clear' | 'warning';
  summary: string;
  issues: SceneContinuityIssue[];
  checkedAt: number;
}

export interface SceneCopilotThreadMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  mode: SceneCopilotMessageMode;
  createdAt: number;
  selectionSourceText?: string;
  selectionVariants?: string[];
  selectedVariantIndex?: number | null;
  selectionResolution?: SceneCopilotSelectionResolution | null;
  continuityCheck?: SceneContinuityCheck | null;
}

export interface SceneCard {
  id: string;
  order: number;
  title: string;
  summary: string;
  purpose: string;
  povCharacter: string;
  goal: string;
  conflict: string;
  turn: string;
  emotionalShift: string;
  visualHook: string;
  subtext: string;
  draftHtml: string;
  sourceDraftHtml?: string;
  sourceDraftLabel?: string;
  continuitySummary: string;
  continuityFacts: string[];
  continuityOpenLoops: string[];
  continuityUpdatedAt?: number | null;
  directorNotes: string;
  copilotSummary?: string;
  copilotThread?: SceneCopilotThreadMessage[];
  status: SceneCardStatus;
}

export interface ScriptCharacterAsset {
  name: string;
  description: string;
  personality: string;
  appearance: string;
}

export interface ScriptLocationAsset {
  name: string;
  description: string;
  appearances: string[];
}

export interface ScriptItemAsset {
  name: string;
  description: string;
  appearances: string[];
}

export type ReferenceAssetKind = 'character' | 'location' | 'item' | 'image';
export type ReferenceAssetSourceType = 'scriptAsset' | 'libraryAsset' | 'upload' | 'nodeOutput';
export type ReferenceBindingRole = 'subject' | 'environment' | 'prop' | 'style' | 'continuity';
export type ScriptAssetExtractSourceMode = 'connectedText' | 'chapterSelection';
export type DirectorWorkPackageSourceMode = ScriptAssetExtractSourceMode;
export type DirectorStoryboardGenerationPhase = 'idle' | 'planning' | 'ready' | 'error';
export type DirectorStoryboardPackageStatus = 'ready' | 'stale' | 'error';
export type ProductionJobKind = 'image' | 'video';
export type ProductionJobStatus =
  | 'idle'
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'skipped';
export type DirectorStoryboardReferenceSyncStatus =
  | 'idle'
  | 'ready'
  | 'stale'
  | 'missingProject'
  | 'missingSource'
  | 'error';

export interface ReferenceAssetSnapshot {
  id: string;
  kind: ReferenceAssetKind;
  sourceType: ReferenceAssetSourceType;
  sourceProjectId: string | null;
  sourceNodeId: string | null;
  assetId: string | null;
  assetLibraryId: string | null;
  name: string;
  imageUrl: string | null;
  previewImageUrl?: string | null;
  description?: string | null;
  locked?: boolean;
}

export interface ReferenceAssetBinding {
  referenceId: string;
  targetType: 'section' | 'shot' | 'video';
  targetId: string;
  role: ReferenceBindingRole;
  weight?: number;
  notes?: string | null;
}

export interface ReferenceContextSnapshot {
  assets: ReferenceAssetSnapshot[];
  bindings: ReferenceAssetBinding[];
  updatedAt: number | null;
}

export interface DirectorStoryboardShotDraft {
  id: string;
  sectionId: string;
  order: number;
  shotLabel: string;
  shotPurpose: string;
  compositionHint: string;
  cameraHint: string;
  motionHint: string;
  promptDraft: string;
  videoPromptDraft: string;
  referenceBindings: ReferenceAssetBinding[];
}

export interface DirectorStoryboardSection {
  id: string;
  order: number;
  title: string;
  summary: string;
  dramaticGoal: string;
  visualIntent: string;
  continuityNotes: string;
  styleHints: string[];
  referenceBindings: ReferenceAssetBinding[];
  shots: DirectorStoryboardShotDraft[];
}

export interface DirectorStoryboardGenerationState {
  requestId: string | null;
  phase: DirectorStoryboardGenerationPhase;
  statusText: string | null;
  lastError: string | null;
  lastGeneratedAt: number | null;
}

export interface DirectorStoryboardPackage {
  id: string;
  sourceScriptProjectId: string;
  sourceScriptRootNodeId: string | null;
  sourceDirectorWorkPackageNodeId?: string | null;
  sourceSceneNodeId: string | null;
  sourceShootingScriptNodeId: string | null;
  sourceMode?: DirectorWorkPackageSourceMode | null;
  sourceChapterNodeIds?: string[];
  version: number;
  generatedAt: number;
  status: DirectorStoryboardPackageStatus;
  sections: DirectorStoryboardSection[];
  referenceAssets: ReferenceAssetSnapshot[];
  generation: DirectorStoryboardGenerationState;
}

export interface ScriptAssetExtractSourceSnapshot {
  mode: ScriptAssetExtractSourceMode;
  chapterNodeIds: string[];
  chapterLabels: string[];
  sourceNodeId: string | null;
  sourceNodeTitle: string | null;
  chapterCount: number;
  sceneCount: number;
  sourceText: string;
  updatedAt: number | null;
}

export type DirectorWorkPackageSourceSnapshot = ScriptAssetExtractSourceSnapshot;

export interface ScriptAssetExtractCharacter {
  id?: string;
  name: string;
  aliases?: string[];
  roleWeight?: number;
  description: string;
  personality: string;
  appearance: string;
  visualDesc?: string;
  continuityNotes?: string;
  referencePrompt?: string;
}

export interface ExtractedScriptScene {
  id?: string;
  name: string;
  description: string;
  relatedCharacterNames: string[];
  sceneDesc?: string;
  timeTone?: string;
  lightLock?: string;
  spaceLayout?: string;
  referencePrompt?: string;
}

export interface ScriptAssetExtractItem {
  id?: string;
  name: string;
  description: string;
  visualDesc?: string;
  function?: string;
  ownerCharacterIds?: string[];
  continuityNotes?: string;
}

export interface ExtractedScriptPlotLine {
  id?: string;
  title: string;
  summary: string;
  statusTag: string;
  relatedCharacterNames: string[];
  relatedSceneNames: string[];
  relatedItemNames?: string[];
}

export interface ExtractedScriptEmotion {
  id?: string;
  name: string;
  description: string;
  visualPrompt: string;
  relatedCharacterNames: string[];
  relatedSceneNames: string[];
}

export interface ScriptAssetLineBlueprint {
  seq: number;
  comicText: string;
  plotPoint: string;
  characterIds: string[];
  sceneId: string;
  itemIds: string[];
  mood: string;
  shotHint: string;
  compositionHint: string;
  cameraHint: string;
  motionHint: string;
}

export interface ScriptAssetPromptRow {
  seq: number;
  comicText: string;
  imagePrompt: string;
  videoFirstFramePrompt: string;
  characterNames: string[];
  sceneName: string;
  referenceAssetHints: string[];
}

export interface ScriptAssetExtractionResult {
  schemaVersion?: number;
  version: number;
  generatedAt: number;
  characters: ScriptAssetExtractCharacter[];
  scenes: ExtractedScriptScene[];
  items: ScriptAssetExtractItem[];
  plotLines: ExtractedScriptPlotLine[];
  emotions: ExtractedScriptEmotion[];
  charactersCatalog: ScriptAssetExtractCharacter[];
  scenesCatalog: ExtractedScriptScene[];
  itemsCatalog: ScriptAssetExtractItem[];
  lineBlueprints: ScriptAssetLineBlueprint[];
  promptRows: ScriptAssetPromptRow[];
}

export interface ScriptAssetExtractionState {
  requestId: string | null;
  phase: 'idle' | 'extracting' | 'ready' | 'error';
  statusText: string | null;
  lastError: string | null;
  lastGeneratedAt: number | null;
}

export type SmartDirectorStoryboardGenerationPhase =
  | 'idle'
  | 'generating'
  | 'ready'
  | 'error';

export type SmartDirectorStoryboardTransferStatus =
  | 'idle'
  | 'ready'
  | 'missingProject'
  | 'error';

export interface SmartDirectorStoryboardGenerationState {
  requestId: string | null;
  phase: SmartDirectorStoryboardGenerationPhase;
  statusText: string | null;
  lastError: string | null;
  lastGeneratedAt: number | null;
}

export interface DirectorStoryboardTableRow {
  id: string;
  rowState: ScriptStoryboardTableRowState;
  rowError?: string | null;
  sceneNumber: string;
  shotNumber: string;
  sketch: string;
  shotSize: string;
  cameraAngle: string;
  cameraMovement: string;
  blockingAction: string;
  dialogueOrSound: string;
  durationSeconds: number;
  assetRefs: string[];
  imagePrompt: string;
  remark: string;
  group10sId: string;
  group15sId: string;
  isContinuousWithPrev: boolean;
}

export interface DirectorStoryboardDurationGroup {
  id: string;
  label: string;
  rowIds: string[];
  totalDurationSeconds: number;
  startShotNumber: string;
  endShotNumber: string;
}

export interface SmartDirectorStoryboardResult {
  schemaVersion?: number;
  version: number;
  generatedAt: number;
  rows: DirectorStoryboardTableRow[];
  continuousGroups: DirectorStoryboardDurationGroup[];
  groups10s: DirectorStoryboardDurationGroup[];
  groups15s: DirectorStoryboardDurationGroup[];
  totalDurationSeconds: number;
}

export type ScriptStoryboardTableRowState =
  | 'queued'
  | 'generating'
  | 'ready'
  | 'error';

export type ScriptStoryboardTableStreamPhase =
  | 'idle'
  | 'preparing'
  | 'outlining'
  | 'streaming'
  | 'completed'
  | 'error'
  | 'cancelled';

export interface ScriptStoryboardTableColumn {
  key: string;
  label: string;
}

export interface ScriptStoryboardTableSummary {
  rowCount: number;
  generatedRowCount: number;
  totalDurationSeconds: number;
  continuousGroupCount: number;
  groups10sCount: number;
  groups15sCount: number;
  lastUpdatedAt: number | null;
}

export interface ScriptStoryboardTableStreamState {
  requestId: string | null;
  phase: ScriptStoryboardTableStreamPhase;
  statusText: string | null;
  error: string | null;
  activeRowId: string | null;
  completedRowCount: number;
  totalRowCount: number;
  lastEventAt: number | null;
}

export interface ScriptStoryboardTableEditingCell {
  rowId: string;
  columnKey: string;
}

export interface ScriptStoryboardTableNodeData extends NodeDisplayData {
  presentationMode?: 'editable' | 'storyboardMirror';
  expansionSource?: {
    sourceProjectId: string;
    sourceProjectName: string;
    sourceNodeId: string;
    sourceNodeVersion: number | null;
    sourceLabel: string;
  } | null;
  sourceSmartDirectorStoryboardNodeId: string | null;
  sourceAssetExtractNodeId: string | null;
  sourceSnapshotVersion: number | null;
  sourceLabel?: string | null;
  tableSchema: ScriptStoryboardTableColumn[];
  rows: DirectorStoryboardTableRow[];
  summary: ScriptStoryboardTableSummary;
  streamState: ScriptStoryboardTableStreamState;
  rowHeight?: number;
  visibleColumnKeys?: string[];
  activeEditingCell?: ScriptStoryboardTableEditingCell | null;
  manualEditVersion?: number;
  manuallyEditedRowIds?: string[];
  storyboardProductionMode?: 'none' | '10s' | '15s';
  continuousReferenceEnabled?: boolean;
  autoStoryboardProductionEnabled?: boolean;
  activeStoryboardProductionMode?: '10s' | '15s' | null;
  productionImageModelId?: string | null;
  productionImageSize?: ImageSize | null;
  productionImageAspectRatio?: string | null;
  productionStyleTemplateId?: string | null;
  productionStyleTemplateName?: string | null;
  productionStyleTemplatePrompt?: string | null;
  productionSketchStylePrompt?: string | null;
  expandedProductionGroupNodeIds?: string[];
  linkedStoryboardProjectId: string | null;
  storyboardTransferStatus: SmartDirectorStoryboardTransferStatus;
  storyboardTransferSnapshot: DirectorStoryboardTransferSnapshot | null;
}

export interface DirectorStoryboardTransferSnapshot {
  version: number;
  generatedAt: number;
  rowCount: number;
  totalDurationSeconds: number;
}

export interface ProductionJobRecord {
  jobId: string;
  kind: ProductionJobKind;
  sourceSectionId: string | null;
  sourceShotId: string | null;
  sourceNodeId: string | null;
  status: ProductionJobStatus;
  requestId: string | null;
  resultNodeIds: string[];
  startedAt: number | null;
  finishedAt: number | null;
  error: string | null;
}

export interface ProductionQueueState {
  imageJobs: ProductionJobRecord[];
  videoJobs: ProductionJobRecord[];
  activeJobIds: string[];
  lastRunAt: number | null;
  lastError: string | null;
  batchScope: string | null;
}

export interface DirectorStoryboardOverrides {
  lockedSectionIds: string[];
  expandedSectionIds: string[];
  sectionGroupNodeIds: Record<string, string>;
  shotNodeIds: Record<string, string>;
  shotPromptOverrides: Record<string, string>;
  shotVideoPromptOverrides: Record<string, string>;
  shotReferenceAssetIds: Record<string, string[]>;
}

export interface DirectorStoryboardReferenceNodeData extends NodeDisplayData {
  linkedScriptProjectId: string | null;
  directorStoryboardSourceProjectId: string | null;
  directorStoryboardSourceNodeId: string | null;
  directorStoryboardSourceVersion: number | null;
  directorStoryboardSnapshot: DirectorStoryboardPackage | null;
  directorStoryboardOverrides: DirectorStoryboardOverrides;
  referenceContext: ReferenceContextSnapshot | null;
  productionQueue: ProductionQueueState;
  syncStatus: DirectorStoryboardReferenceSyncStatus;
  syncMessage?: string | null;
  lastSyncedAt?: number | null;
}

export interface ScriptAssetExtractNodeData extends NodeDisplayData {
  presentationMode?: 'editable' | 'storyboardMirror';
  expansionSource?: {
    sourceProjectId: string;
    sourceProjectName: string;
    sourceNodeId: string;
    sourceNodeVersion: number | null;
    sourceLabel: string;
  } | null;
  sourceMode: ScriptAssetExtractSourceMode;
  selectedChapterIds: string[];
  resolvedSourceSnapshot: ScriptAssetExtractSourceSnapshot | null;
  extractionResult: ScriptAssetExtractionResult | null;
  extractionState: ScriptAssetExtractionState;
  expandedGroupNodeIds: string[];
  lastExpandedAt?: number | null;
}

export type DirectorWorkPackageNodeData = ScriptAssetExtractNodeData;

export interface SmartDirectorStoryboardNodeData extends NodeDisplayData {
  presentationMode?: 'editable' | 'storyboardMirror';
  expansionSource?: {
    sourceProjectId: string;
    sourceProjectName: string;
    sourceNodeId: string;
    sourceNodeVersion: number | null;
    sourceLabel: string;
  } | null;
  sourceAssetExtractNodeId: string | null;
  resolvedSourceSnapshot: ScriptAssetExtractSourceSnapshot | null;
  generationState: SmartDirectorStoryboardGenerationState;
  activeResultNodeId: string | null;
  generatedResultNodeIds: string[];
  result: SmartDirectorStoryboardResult | null;
  linkedStoryboardProjectId: string | null;
  storyboardTransferStatus: SmartDirectorStoryboardTransferStatus;
  storyboardTransferSnapshot: DirectorStoryboardTransferSnapshot | null;
}

export interface ScriptRootNodeData extends NodeDisplayData {
  title: string;
  genre: string;
  totalChapters: number;
  premise?: string;
  theme?: string;
  protagonist?: string;
  want?: string;
  need?: string;
  stakes?: string;
  tone?: string;
  directorVision?: string;
  beats?: StoryBeat[];
  styleProfile?: StyleProfile;
  assetLibraryCharacters: ScriptCharacterAsset[];
  assetLibraryLocations: ScriptLocationAsset[];
  assetLibraryItems: ScriptItemAsset[];
}

export interface ScriptChapterNodeData extends NodeDisplayData {
  chapterNumber: number;
  title: string;
  content: string;
  summary: string;
  chapterPurpose?: string;
  chapterQuestion?: string;
  sceneHeadings: string[];
  scenes?: SceneCard[];
  characters: string[];
  locations: string[];
  items: string[];
  emotionalShift: string;
  setupRef?: string;
  payoffRef?: string;
  isBranchPoint: boolean;
  branchType?: 'main' | 'branch' | 'supplement';
  linkedChapterId?: string;
  branches?: BranchOption[];
  tables?: ScriptTable[];
  plotPoints?: PlotPoint[];
  parentId?: string;
  branchIndex?: number;
  depth?: number;
  isMergePoint?: boolean;
  mergedFromBranches?: string[];
}

export interface EpisodeCard extends SceneCard {
  episodeNumber: number;
  shotRows: ShotRow[];
  shotScriptStatus: ShotScriptStatus;
  shotScriptUpdatedAt?: number | null;
}

export interface ScriptSceneNodeData extends NodeDisplayData {
  sourceChapterId: string;
  sourceSceneId: string;
  sourceSceneOrder: number;
  chapterNumber: number;
  title: string;
  summary: string;
  purpose: string;
  povCharacter: string;
  goal: string;
  conflict: string;
  turn: string;
  emotionalShift: string;
  visualHook: string;
  subtext: string;
  sourceDraftHtml?: string;
  draftHtml: string;
  episodes: EpisodeCard[];
  directorStoryboardPackage?: DirectorStoryboardPackage | null;
  directorStoryboardGeneration?: DirectorStoryboardGenerationState | null;
}

export interface ShootingScriptNodeData extends NodeDisplayData {
  sourceChapterId: string;
  sourceSceneNodeId: string;
  sourceEpisodeId: string;
  chapterNumber: number;
  sceneNumber: number;
  sceneTitle: string;
  episodeNumber: number;
  episodeTitle: string;
  rows: ShootingScriptRow[];
  status: ShootingScriptStatus;
  lastGeneratedAt?: number | null;
  lastError?: string | null;
  sourceSnapshot: ShootingScriptSourceSnapshot | null;
  directorStoryboardPackage?: DirectorStoryboardPackage | null;
  directorStoryboardGeneration?: DirectorStoryboardGenerationState | null;
}

export interface ScriptReferenceNodeData extends NodeDisplayData {
  linkedScriptProjectId: string | null;
  referencedChapterId: string | null;
  referencedSceneNodeId: string | null;
  referencedEpisodeId: string | null;
  referencedScriptNodeId: string | null;
  selectedRowIds: string[];
  selectedShotRowIds?: string[];
  scriptSnapshot: ScriptReferenceScriptSnapshot | null;
  episodeSnapshot?: ScriptReferenceScriptSnapshot | null;
  syncStatus: ScriptReferenceSyncStatus;
  syncMessage?: string | null;
  lastSyncedAt?: number | null;
}

export interface AdScriptReferenceNodeData extends NodeDisplayData {
  linkedAdProjectId: string | null;
  selectedRowIds: string[];
  scriptSnapshot: AdScriptReferenceSnapshot | null;
  syncStatus: AdScriptReferenceSyncStatus;
  syncMessage?: string | null;
  lastSyncedAt?: number | null;
}

interface ScriptAssetReferenceBaseNodeData<TSnapshot> extends NodeDisplayData {
  linkedScriptProjectId: string | null;
  referencedAssetName: string | null;
  assetSnapshot: TSnapshot | null;
  syncStatus: ScriptAssetReferenceSyncStatus;
  syncMessage?: string | null;
  lastSyncedAt?: number | null;
}

export interface ScriptCharacterReferenceNodeData
  extends ScriptAssetReferenceBaseNodeData<ScriptCharacterReferenceSnapshot> {}

export interface ScriptLocationReferenceNodeData
  extends ScriptAssetReferenceBaseNodeData<ScriptLocationReferenceSnapshot> {}

export interface ScriptItemReferenceNodeData
  extends ScriptAssetReferenceBaseNodeData<ScriptItemReferenceSnapshot> {}

export interface ScriptCharacterNodeData extends NodeDisplayData {
  name: string;
  description: string;
  personality: string;
  appearance: string;
  statusUpdates: { chapterId: string; status: string }[];
  relationships: { targetId: string; type: string }[];
}

export interface ScriptLocationNodeData extends NodeDisplayData {
  name: string;
  description: string;
  appearances: string[];
}

export interface ScriptItemNodeData extends NodeDisplayData {
  name: string;
  description: string;
  appearances: string[];
}

export interface ScriptPlotLineNodeData extends NodeDisplayData {
  panelKind?: 'plotLines' | 'characters' | 'scenes' | 'items' | 'emotions' | 'blueprints';
  title: string;
  summary: string;
  statusTag: string;
  relatedCharacterNames: string[];
  relatedSceneNames: string[];
  entries?: ExtractedScriptPlotLine[];
  assetPanelRows?: ScriptAssetPanelRow[];
}

export interface ScriptAssetPanelRow {
  id: string;
  title: string;
  subtitle?: string;
  body: string;
  meta?: string[];
  prompt?: string;
}

export interface ScriptStoryNoteNodeData extends NodeDisplayData {
  title: string;
  content: string;
  isEnabled: boolean;
}

export interface ScriptPlotPointNodeData extends NodeDisplayData {
  pointType: 'setup' | 'payoff';
  description: string;
  relatedChapterId?: string;
  relatedPointId?: string;
}

export interface ScriptWorldviewNodeData extends NodeDisplayData {
  worldviewName: string;
  description: string;
  era: string;
  technology: string;
  magic: string;
  society: string;
  geography: string;
  rules: string[];
}

export interface ScriptStoryNotePromptEntry {
  title: string;
  content: string;
}

export interface ScriptCharacterPromptEntry {
  name: string;
  description: string;
  personality: string;
  appearance: string;
}

export interface AdProjectRootNodeData extends NodeDisplayData, AdProjectRootState {}

export interface CommerceProductNodeData extends NodeDisplayData, CommerceAdProductState {}

export interface CommerceBriefNodeData extends NodeDisplayData, CommerceAdBriefState {}

export interface CommerceBatchGenerateNodeData extends NodeDisplayData, CommerceAdBatchGenerateState {}

export interface CommerceResultGroupNodeData extends NodeDisplayData, CommerceAdResultGroupState {}

export type CanvasNodeData =
  | UploadImageNodeData
  | ExportImageNodeData
  | ImageCompareNodeData
  | Panorama360NodeData
  | DirectorStageNodeData
  | BackgroundRemoveNodeData
  | Seedvr2ImageUpscaleNodeData
  | Seedvr2VideoUpscaleNodeData
  | LegacyNodeData
  | ImageCollageNodeData
  | TextAnnotationNodeData
  | LlmLogicNodeData
  | GroupNodeData
  | ImageEditNodeData
  | MultiAngleImageNodeData
  | JimengNodeData
  | JimengImageNodeData
  | MjNodeData
  | MjResultNodeData
  | JimengImageResultNodeData
  | JimengVideoResultNodeData
  | SeedanceNodeData
  | SeedanceVideoResultNodeData
  | GptBestVideoNodeData
  | GptBestVideoResultNodeData
  | ViduNodeData
  | ViduVideoResultNodeData
  | StoryboardSplitNodeData
  | StoryboardSplitResultNodeData
  | StoryboardGenNodeData
  | AssetMaterialNodeData
  | VideoNodeData
  | AudioNodeData
  | TtsTextNodeData
  | TtsVoiceDesignNodeData
  | TtsSavedVoiceNodeData
  | VoxCpmVoiceDesignNodeData
  | VoxCpmVoiceCloneNodeData
  | VoxCpmUltimateCloneNodeData
  | AdProjectRootNodeData
  | CommerceProductNodeData
  | CommerceBriefNodeData
  | CommerceBatchGenerateNodeData
  | CommerceResultGroupNodeData
  | ScriptRootNodeData
  | ScriptChapterNodeData
  | ScriptSceneNodeData
  | ShootingScriptNodeData
  | ScriptAssetExtractNodeData
  | SmartDirectorStoryboardNodeData
  | ScriptStoryboardTableNodeData
  | DirectorWorkPackageNodeData
  | DirectorStoryboardReferenceNodeData
  | ScriptReferenceNodeData
  | AdScriptReferenceNodeData
  | ScriptCharacterReferenceNodeData
  | ScriptLocationReferenceNodeData
  | ScriptItemReferenceNodeData
  | ScriptCharacterNodeData
  | ScriptLocationNodeData
  | ScriptItemNodeData
  | ScriptPlotLineNodeData
  | ScriptStoryNoteNodeData
  | ScriptPlotPointNodeData
  | ScriptWorldviewNodeData;

export type CanvasNode = Node<CanvasNodeData, CanvasNodeType>;
export type CanvasEdge = Edge;

export interface NodeCreationDto {
  type: CanvasNodeType;
  position: XYPosition;
  data?: Partial<CanvasNodeData>;
}

export interface StoryboardNodeCreationDto {
  position: XYPosition;
  rows: number;
  cols: number;
  frames: StoryboardFrameItem[];
}

export const NODE_TOOL_TYPES = {
  crop: 'crop',
  annotate: 'annotate',
  splitStoryboard: 'split-storyboard',
  extractAudio: 'extract-audio',
} as const;

export type NodeToolType = (typeof NODE_TOOL_TYPES)[keyof typeof NODE_TOOL_TYPES];

export interface ActiveToolDialog {
  nodeId: string;
  toolType: NodeToolType;
}

function normalizeString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function normalizeReferenceStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => normalizeString(item).trim())
    .filter((item) => item.length > 0);
}

function normalizeReferenceTransferItem(
  value: unknown,
  fallbackIndex: number
): ReferenceTransferItem | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const record = value as Partial<ReferenceTransferItem>;
  const sourceRowId = normalizeString(record.sourceRowId).trim();
  if (!sourceRowId) {
    return null;
  }

  const lines = normalizeReferenceStringArray(record.lines);
  const renderedPrompt = normalizeString(record.renderedPrompt).trim()
    || lines.join('\n');

  return {
    sourceRowId,
    shotNumber: normalizeString(record.shotNumber, String(fallbackIndex + 1)).trim() || String(fallbackIndex + 1),
    title: normalizeString(record.title).trim() || `item-${fallbackIndex + 1}`,
    summary: normalizeString(record.summary).trim() || null,
    lines,
    renderedPrompt,
  };
}

function normalizeReferenceTransferPackage(value: unknown): ReferenceTransferPackage | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const record = value as Partial<ReferenceTransferPackage>;
  const sourceKind =
    record.sourceKind === 'adScript' || record.sourceKind === 'shootingScript'
      ? record.sourceKind
      : null;
  const targetKind =
    record.targetKind === 'image' || record.targetKind === 'video' || record.targetKind === 'storyboard'
      ? record.targetKind
      : null;
  const sourceNodeId = normalizeString(record.sourceNodeId).trim();
  if (!sourceKind || !targetKind || !sourceNodeId) {
    return null;
  }

  const items = Array.isArray(record.items)
    ? record.items
        .map((item, index) => normalizeReferenceTransferItem(item, index))
        .filter((item): item is ReferenceTransferItem => item !== null)
    : [];

  return {
    sourceKind,
    sourceNodeId,
    targetKind,
    contextLines: normalizeReferenceStringArray(record.contextLines),
    closingLines: normalizeReferenceStringArray(record.closingLines),
    items,
    renderedPrompt: normalizeString(record.renderedPrompt).trim(),
  };
}

function normalizeSceneCardStatus(value: unknown): SceneCardStatus {
  return value === 'idea' || value === 'reviewed' || value === 'locked'
    ? value
    : 'drafting';
}

function normalizeShotRowGenTarget(value: unknown): ShotRowGenTarget {
  return value === 'video' || value === 'storyboard' ? value : 'image';
}

function normalizeShotRowStatus(value: unknown): ShotRowStatus {
  return value === 'ready' || value === 'locked' ? value : 'draft';
}

function normalizeShotScriptStatus(value: unknown): ShotScriptStatus {
  return value === 'drafting' || value === 'ready' ? value : 'empty';
}

function normalizeShootingScriptStatus(value: unknown): ShootingScriptStatus {
  return value === 'drafting' || value === 'ready' ? value : 'empty';
}

function normalizeSceneCopilotMessageMode(value: unknown): SceneCopilotMessageMode {
  return value === 'analysis'
    || value === 'continue'
    || value === 'director'
    || value === 'custom'
    || value === 'selection'
    || value === 'seed'
    ? value
    : 'custom';
}

function normalizeSceneCopilotSelectionResolution(
  value: unknown
): SceneCopilotSelectionResolution | null {
  return value === 'pending'
    || value === 'replaced'
    || value === 'inserted'
    || value === 'dismissed'
    ? value
    : null;
}

function normalizeSceneContinuityIssueSeverity(value: unknown): SceneContinuityIssueSeverity {
  return value === 'low' || value === 'high' ? value : 'medium';
}

function normalizeSceneContinuityIssues(value: unknown): SceneContinuityIssue[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((issue, index): SceneContinuityIssue | null => {
      const record = issue && typeof issue === 'object'
        ? issue as Partial<SceneContinuityIssue>
        : {};
      const title = normalizeString(record.title).trim();
      const detail = normalizeString(record.detail).trim();
      if (!title || !detail) {
        return null;
      }

      const normalizedIssue: SceneContinuityIssue = {
        id: normalizeString(record.id, `continuity-issue-${index + 1}`),
        severity: normalizeSceneContinuityIssueSeverity(record.severity),
        title,
        detail,
        evidence: normalizeString(record.evidence).trim() || undefined,
      };

      return normalizedIssue;
    })
    .filter((issue): issue is SceneContinuityIssue => issue !== null);
}

function normalizeSceneContinuityCheck(value: unknown): SceneContinuityCheck | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const record = value as Partial<SceneContinuityCheck>;
  const issues = normalizeSceneContinuityIssues(record.issues);
  const summary = normalizeString(record.summary).trim();

  return {
    status: record.status === 'warning' ? 'warning' : 'clear',
    summary,
    issues,
    checkedAt: Number.isFinite(record.checkedAt) ? Number(record.checkedAt) : Date.now(),
  };
}

function normalizeStringArray(values: unknown): string[] {
  if (!Array.isArray(values)) {
    return [];
  }

  return values
    .map((value) => normalizeString(value).trim())
    .filter((value) => value.length > 0);
}

function normalizeStringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value)
      .map(([key, entryValue]) => [normalizeString(key).trim(), normalizeString(entryValue).trim()] as const)
      .filter(([key, entryValue]) => key.length > 0 && entryValue.length > 0)
  );
}

function normalizeStringArrayRecord(value: unknown): Record<string, string[]> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value)
      .map(([key, entryValue]) => [normalizeString(key).trim(), normalizeStringArray(entryValue)] as const)
      .filter(([key, entryValue]) => key.length > 0 && entryValue.length > 0)
  );
}

function normalizeReferenceAssetKind(value: unknown): ReferenceAssetKind {
  return value === 'location' || value === 'item' || value === 'image' ? value : 'character';
}

function normalizeReferenceAssetSourceType(value: unknown): ReferenceAssetSourceType {
  return value === 'libraryAsset' || value === 'upload' || value === 'nodeOutput'
    ? value
    : 'scriptAsset';
}

function normalizeReferenceBindingRole(value: unknown): ReferenceBindingRole {
  switch (value) {
    case 'environment':
    case 'prop':
    case 'style':
    case 'continuity':
      return value;
    default:
      return 'subject';
  }
}

function normalizeDirectorStoryboardGenerationPhase(
  value: unknown
): DirectorStoryboardGenerationPhase {
  switch (value) {
    case 'planning':
    case 'ready':
    case 'error':
      return value;
    default:
      return 'idle';
  }
}

function normalizeDirectorStoryboardPackageStatus(value: unknown): DirectorStoryboardPackageStatus {
  return value === 'stale' || value === 'error' ? value : 'ready';
}

function normalizeProductionJobKind(value: unknown): ProductionJobKind {
  return value === 'video' ? 'video' : 'image';
}

function normalizeProductionJobStatus(value: unknown): ProductionJobStatus {
  switch (value) {
    case 'queued':
    case 'running':
    case 'completed':
    case 'failed':
    case 'skipped':
      return value;
    default:
      return 'idle';
  }
}

function normalizeDirectorStoryboardReferenceSyncStatus(
  value: unknown
): DirectorStoryboardReferenceSyncStatus {
  switch (value) {
    case 'ready':
    case 'stale':
    case 'missingProject':
    case 'missingSource':
    case 'error':
      return value;
    default:
      return 'idle';
  }
}

export function normalizeReferenceAssetSnapshot(value: unknown): ReferenceAssetSnapshot | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const record = value as Partial<ReferenceAssetSnapshot>;
  const id = normalizeString(record.id).trim();
  const name = normalizeString(record.name).trim();
  if (!id || !name) {
    return null;
  }

  return {
    id,
    kind: normalizeReferenceAssetKind(record.kind),
    sourceType: normalizeReferenceAssetSourceType(record.sourceType),
    sourceProjectId: normalizeString(record.sourceProjectId).trim() || null,
    sourceNodeId: normalizeString(record.sourceNodeId).trim() || null,
    assetId: normalizeString(record.assetId).trim() || null,
    assetLibraryId: normalizeString(record.assetLibraryId).trim() || null,
    name,
    imageUrl: normalizeString(record.imageUrl).trim() || null,
    previewImageUrl: normalizeString(record.previewImageUrl).trim() || null,
    description: normalizeString(record.description).trim() || null,
    locked: normalizeBooleanValue(record.locked),
  };
}

export function normalizeReferenceAssetSnapshots(value: unknown): ReferenceAssetSnapshot[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => normalizeReferenceAssetSnapshot(item))
    .filter((item): item is ReferenceAssetSnapshot => Boolean(item));
}

export function normalizeReferenceAssetBinding(value: unknown): ReferenceAssetBinding | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const record = value as Partial<ReferenceAssetBinding>;
  const referenceId = normalizeString(record.referenceId).trim();
  const targetId = normalizeString(record.targetId).trim();
  if (!referenceId || !targetId) {
    return null;
  }

  const targetType = record.targetType === 'section' || record.targetType === 'video' ? record.targetType : 'shot';

  return {
    referenceId,
    targetType,
    targetId,
    role: normalizeReferenceBindingRole(record.role),
    weight: Number.isFinite(record.weight) ? Number(record.weight) : 1,
    notes: normalizeString(record.notes).trim() || null,
  };
}

export function normalizeReferenceAssetBindings(value: unknown): ReferenceAssetBinding[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => normalizeReferenceAssetBinding(item))
    .filter((item): item is ReferenceAssetBinding => Boolean(item));
}

export function normalizeReferenceContextSnapshot(value: unknown): ReferenceContextSnapshot | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const record = value as Partial<ReferenceContextSnapshot>;
  return {
    assets: normalizeReferenceAssetSnapshots(record.assets),
    bindings: normalizeReferenceAssetBindings(record.bindings),
    updatedAt: Number.isFinite(record.updatedAt) ? Number(record.updatedAt) : null,
  };
}

export function normalizeDirectorStoryboardShotDraft(
  value: unknown,
  fallbackSectionId = '',
  fallbackOrder = 0
): DirectorStoryboardShotDraft | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const record = value as Partial<DirectorStoryboardShotDraft>;
  const id = normalizeString(record.id).trim();
  if (!id) {
    return null;
  }

  return {
    id,
    sectionId: normalizeString(record.sectionId).trim() || fallbackSectionId,
    order: Number.isFinite(record.order) ? Math.max(0, Math.floor(Number(record.order))) : fallbackOrder,
    shotLabel: normalizeString(record.shotLabel),
    shotPurpose: normalizeString(record.shotPurpose),
    compositionHint: normalizeString(record.compositionHint),
    cameraHint: normalizeString(record.cameraHint),
    motionHint: normalizeString(record.motionHint),
    promptDraft: normalizeString(record.promptDraft),
    videoPromptDraft: normalizeString(record.videoPromptDraft),
    referenceBindings: normalizeReferenceAssetBindings(record.referenceBindings),
  };
}

export function normalizeDirectorStoryboardSection(value: unknown): DirectorStoryboardSection | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const record = value as Partial<DirectorStoryboardSection>;
  const id = normalizeString(record.id).trim();
  if (!id) {
    return null;
  }

  const shots = Array.isArray(record.shots)
    ? record.shots
        .map((shot, index) => normalizeDirectorStoryboardShotDraft(shot, id, index))
        .filter((shot): shot is DirectorStoryboardShotDraft => Boolean(shot))
        .sort((left, right) => left.order - right.order)
    : [];

  return {
    id,
    order: Number.isFinite(record.order) ? Math.max(0, Math.floor(Number(record.order))) : 0,
    title: normalizeString(record.title),
    summary: normalizeString(record.summary),
    dramaticGoal: normalizeString(record.dramaticGoal),
    visualIntent: normalizeString(record.visualIntent),
    continuityNotes: normalizeString(record.continuityNotes),
    styleHints: normalizeStringArray(record.styleHints),
    referenceBindings: normalizeReferenceAssetBindings(record.referenceBindings),
    shots,
  };
}

export function normalizeDirectorStoryboardSections(value: unknown): DirectorStoryboardSection[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => normalizeDirectorStoryboardSection(item))
    .filter((item): item is DirectorStoryboardSection => Boolean(item))
    .sort((left, right) => left.order - right.order);
}

export function normalizeDirectorStoryboardGenerationState(
  value: unknown
): DirectorStoryboardGenerationState {
  const record = value && typeof value === 'object'
    ? value as Partial<DirectorStoryboardGenerationState>
    : {};

  return {
    requestId: normalizeString(record.requestId).trim() || null,
    phase: normalizeDirectorStoryboardGenerationPhase(record.phase),
    statusText: normalizeString(record.statusText).trim() || null,
    lastError: normalizeString(record.lastError).trim() || null,
    lastGeneratedAt: Number.isFinite(record.lastGeneratedAt) ? Number(record.lastGeneratedAt) : null,
  };
}

export function normalizeDirectorStoryboardPackage(
  value: unknown
): DirectorStoryboardPackage | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const record = value as Partial<DirectorStoryboardPackage>;
  const id = normalizeString(record.id).trim();
  const sourceScriptProjectId = normalizeString(record.sourceScriptProjectId).trim();
  if (!id || !sourceScriptProjectId) {
    return null;
  }

  return {
    id,
    sourceScriptProjectId,
    sourceScriptRootNodeId: normalizeString(record.sourceScriptRootNodeId).trim() || null,
    sourceDirectorWorkPackageNodeId:
      normalizeString(record.sourceDirectorWorkPackageNodeId).trim() || null,
    sourceSceneNodeId: normalizeString(record.sourceSceneNodeId).trim() || null,
    sourceShootingScriptNodeId: normalizeString(record.sourceShootingScriptNodeId).trim() || null,
    sourceMode:
      record.sourceMode === 'chapterSelection' || record.sourceMode === 'connectedText'
        ? record.sourceMode
        : null,
    sourceChapterNodeIds: normalizeStringArray(record.sourceChapterNodeIds),
    version: Number.isFinite(record.version) ? Math.max(1, Math.floor(Number(record.version))) : 1,
    generatedAt: Number.isFinite(record.generatedAt) ? Number(record.generatedAt) : Date.now(),
    status: normalizeDirectorStoryboardPackageStatus(record.status),
    sections: normalizeDirectorStoryboardSections(record.sections),
    referenceAssets: normalizeReferenceAssetSnapshots(record.referenceAssets),
    generation: normalizeDirectorStoryboardGenerationState(record.generation),
  };
}

export function normalizeScriptAssetExtractSourceSnapshot(
  value: unknown
): ScriptAssetExtractSourceSnapshot | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const record = value as Partial<ScriptAssetExtractSourceSnapshot>;
  const mode =
    record.mode === 'chapterSelection' || record.mode === 'connectedText'
      ? record.mode
      : null;
  if (!mode) {
    return null;
  }

  const sourceText = normalizeString(record.sourceText).trim();
  return {
    mode,
    chapterNodeIds: normalizeStringArray(record.chapterNodeIds),
    chapterLabels: normalizeStringArray(record.chapterLabels),
    sourceNodeId: normalizeString(record.sourceNodeId).trim() || null,
    sourceNodeTitle: normalizeString(record.sourceNodeTitle).trim() || null,
    chapterCount: Number.isFinite(record.chapterCount)
      ? Math.max(0, Math.floor(Number(record.chapterCount)))
      : 0,
    sceneCount: Number.isFinite(record.sceneCount)
      ? Math.max(0, Math.floor(Number(record.sceneCount)))
      : 0,
    sourceText,
    updatedAt: Number.isFinite(record.updatedAt) ? Number(record.updatedAt) : null,
  };
}

export const normalizeDirectorWorkPackageSourceSnapshot = normalizeScriptAssetExtractSourceSnapshot;

export function normalizeScriptAssetExtractionResult(
  value: unknown
): ScriptAssetExtractionResult | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const record = value as Partial<ScriptAssetExtractionResult>;
  const normalizeCharacter = (item: unknown): ScriptAssetExtractCharacter | null => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return null;
    }
    const row = item as Partial<ScriptAssetExtractCharacter>;
    const name = normalizeString(row.name).trim();
    if (!name) {
      return null;
    }
    return {
      id: normalizeString(row.id).trim() || undefined,
      name,
      aliases: normalizeStringArray(row.aliases),
      roleWeight: Number.isFinite(row.roleWeight) ? Number(row.roleWeight) : undefined,
      description: normalizeString(row.description).trim(),
      personality: normalizeString(row.personality).trim(),
      appearance: normalizeString(row.appearance).trim(),
      visualDesc: normalizeString(row.visualDesc).trim(),
      continuityNotes: normalizeString(row.continuityNotes).trim(),
      referencePrompt: normalizeString(row.referencePrompt).trim(),
    };
  };
  const normalizeScene = (item: unknown): ExtractedScriptScene | null => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return null;
    }
    const row = item as Partial<ExtractedScriptScene>;
    const name = normalizeString(row.name).trim();
    if (!name) {
      return null;
    }
    return {
      id: normalizeString(row.id).trim() || undefined,
      name,
      description: normalizeString(row.description).trim(),
      relatedCharacterNames: normalizeStringArray(row.relatedCharacterNames),
      sceneDesc: normalizeString(row.sceneDesc).trim(),
      timeTone: normalizeString(row.timeTone).trim(),
      lightLock: normalizeString(row.lightLock).trim(),
      spaceLayout: normalizeString(row.spaceLayout).trim(),
      referencePrompt: normalizeString(row.referencePrompt).trim(),
    };
  };
  const normalizeItem = (item: unknown): ScriptAssetExtractItem | null => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return null;
    }
    const row = item as Partial<ScriptAssetExtractItem>;
    const name = normalizeString(row.name).trim();
    if (!name) {
      return null;
    }
    return {
      id: normalizeString(row.id).trim() || undefined,
      name,
      description: normalizeString(row.description).trim(),
      visualDesc: normalizeString(row.visualDesc).trim(),
      function: normalizeString(row.function).trim(),
      ownerCharacterIds: normalizeStringArray(row.ownerCharacterIds),
      continuityNotes: normalizeString(row.continuityNotes).trim(),
    };
  };
  const normalizePlotLine = (item: unknown): ExtractedScriptPlotLine | null => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return null;
    }
    const row = item as Partial<ExtractedScriptPlotLine>;
    const title = normalizeString(row.title).trim();
    if (!title) {
      return null;
    }
    return {
      id: normalizeString(row.id).trim() || undefined,
      title,
      summary: normalizeString(row.summary).trim(),
      statusTag: normalizeString(row.statusTag).trim(),
      relatedCharacterNames: normalizeStringArray(row.relatedCharacterNames),
      relatedSceneNames: normalizeStringArray(row.relatedSceneNames),
      relatedItemNames: normalizeStringArray(row.relatedItemNames),
    };
  };
  const normalizeEmotion = (item: unknown): ExtractedScriptEmotion | null => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return null;
    }
    const row = item as Partial<ExtractedScriptEmotion>;
    const name = normalizeString(row.name).trim();
    if (!name) {
      return null;
    }
    return {
      id: normalizeString(row.id).trim() || undefined,
      name,
      description: normalizeString(row.description).trim(),
      visualPrompt: normalizeString(row.visualPrompt).trim(),
      relatedCharacterNames: normalizeStringArray(row.relatedCharacterNames),
      relatedSceneNames: normalizeStringArray(row.relatedSceneNames),
    };
  };
  const normalizeLineBlueprint = (item: unknown, index: number): ScriptAssetLineBlueprint | null => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return null;
    }
    const row = item as Partial<ScriptAssetLineBlueprint>;
    const seq = Number.isFinite(row.seq) ? Math.max(1, Math.floor(Number(row.seq))) : index + 1;
    const comicText = normalizeString(row.comicText).trim();
    const plotPoint = normalizeString(row.plotPoint).trim();
    if (!comicText && !plotPoint) {
      return null;
    }
    return {
      seq,
      comicText,
      plotPoint,
      characterIds: normalizeStringArray(row.characterIds),
      sceneId: normalizeString(row.sceneId).trim(),
      itemIds: normalizeStringArray(row.itemIds),
      mood: normalizeString(row.mood).trim(),
      shotHint: normalizeString(row.shotHint).trim(),
      compositionHint: normalizeString(row.compositionHint).trim(),
      cameraHint: normalizeString(row.cameraHint).trim(),
      motionHint: normalizeString(row.motionHint).trim(),
    };
  };
  const normalizePromptRow = (item: unknown, index: number): ScriptAssetPromptRow | null => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return null;
    }
    const row = item as Partial<ScriptAssetPromptRow>;
    const seq = Number.isFinite(row.seq) ? Math.max(1, Math.floor(Number(row.seq))) : index + 1;
    const imagePrompt = normalizeString(row.imagePrompt).trim();
    const videoFirstFramePrompt = normalizeString(row.videoFirstFramePrompt).trim();
    const comicText = normalizeString(row.comicText).trim();
    if (!imagePrompt && !videoFirstFramePrompt && !comicText) {
      return null;
    }
    return {
      seq,
      comicText,
      imagePrompt,
      videoFirstFramePrompt,
      characterNames: normalizeStringArray(row.characterNames),
      sceneName: normalizeString(row.sceneName).trim(),
      referenceAssetHints: normalizeStringArray(row.referenceAssetHints),
    };
  };
  const characters = (Array.isArray(record.characters) ? record.characters : [])
    .map((item) => normalizeCharacter(item))
    .filter((item): item is ScriptAssetExtractCharacter => Boolean(item));
  const scenes = (Array.isArray(record.scenes) ? record.scenes : [])
    .map((item) => normalizeScene(item))
    .filter((item): item is ExtractedScriptScene => Boolean(item));
  const items = (Array.isArray(record.items) ? record.items : [])
    .map((item) => normalizeItem(item))
    .filter((item): item is ScriptAssetExtractItem => Boolean(item));
  const plotLines = (Array.isArray(record.plotLines) ? record.plotLines : [])
    .map((item) => normalizePlotLine(item))
    .filter((item): item is ExtractedScriptPlotLine => Boolean(item));
  const emotions = (Array.isArray(record.emotions) ? record.emotions : [])
    .map((item) => normalizeEmotion(item))
    .filter((item): item is ExtractedScriptEmotion => Boolean(item));
  const charactersCatalog = (Array.isArray(record.charactersCatalog) ? record.charactersCatalog : [])
    .map((item) => normalizeCharacter(item))
    .filter((item): item is ScriptAssetExtractCharacter => Boolean(item));
  const scenesCatalog = (Array.isArray(record.scenesCatalog) ? record.scenesCatalog : [])
    .map((item) => normalizeScene(item))
    .filter((item): item is ExtractedScriptScene => Boolean(item));
  const itemsCatalog = (Array.isArray(record.itemsCatalog) ? record.itemsCatalog : [])
    .map((item) => normalizeItem(item))
    .filter((item): item is ScriptAssetExtractItem => Boolean(item));

  return {
    schemaVersion: Number.isFinite(record.schemaVersion)
      ? Math.max(1, Math.floor(Number(record.schemaVersion)))
      : 1,
    version: Number.isFinite(record.version) ? Math.max(1, Math.floor(Number(record.version))) : 1,
    generatedAt: Number.isFinite(record.generatedAt) ? Number(record.generatedAt) : Date.now(),
    characters,
    scenes,
    items,
    plotLines,
    emotions,
    charactersCatalog: charactersCatalog.length > 0 ? charactersCatalog : characters,
    scenesCatalog: scenesCatalog.length > 0 ? scenesCatalog : scenes,
    itemsCatalog: itemsCatalog.length > 0 ? itemsCatalog : items,
    lineBlueprints: (Array.isArray(record.lineBlueprints) ? record.lineBlueprints : [])
      .map((item, index) => normalizeLineBlueprint(item, index))
      .filter((item): item is ScriptAssetLineBlueprint => Boolean(item))
      .sort((left, right) => left.seq - right.seq),
    promptRows: (Array.isArray(record.promptRows) ? record.promptRows : [])
      .map((item, index) => normalizePromptRow(item, index))
      .filter((item): item is ScriptAssetPromptRow => Boolean(item))
      .sort((left, right) => left.seq - right.seq),
  };
}

export function normalizeScriptAssetExtractionState(
  value: unknown
): ScriptAssetExtractionState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {
      requestId: null,
      phase: 'idle',
      statusText: null,
      lastError: null,
      lastGeneratedAt: null,
    };
  }

  const record = value as Partial<ScriptAssetExtractionState>;
  const phase = record.phase === 'extracting' || record.phase === 'ready' || record.phase === 'error'
    ? record.phase
    : 'idle';

  return {
    requestId: normalizeString(record.requestId).trim() || null,
    phase,
    statusText: normalizeString(record.statusText).trim() || null,
    lastError: normalizeString(record.lastError).trim() || null,
    lastGeneratedAt: Number.isFinite(record.lastGeneratedAt) ? Number(record.lastGeneratedAt) : null,
  };
}

function normalizeSmartDirectorStoryboardGenerationPhase(
  value: unknown
): SmartDirectorStoryboardGenerationPhase {
  return value === 'generating' || value === 'ready' || value === 'error'
    ? value
    : 'idle';
}

function normalizeSmartDirectorStoryboardTransferStatus(
  value: unknown
): SmartDirectorStoryboardTransferStatus {
  return value === 'ready' || value === 'missingProject' || value === 'error'
    ? value
    : 'idle';
}

function normalizeScriptStoryboardTableRowState(
  value: unknown
): ScriptStoryboardTableRowState {
  return value === 'generating' || value === 'ready' || value === 'error'
    ? value
    : 'queued';
}

function normalizeScriptStoryboardTableStreamPhase(
  value: unknown
): ScriptStoryboardTableStreamPhase {
  return value === 'preparing'
    || value === 'outlining'
    || value === 'streaming'
    || value === 'completed'
    || value === 'error'
    || value === 'cancelled'
    ? value
    : 'idle';
}

export function normalizeSmartDirectorStoryboardGenerationState(
  value: unknown
): SmartDirectorStoryboardGenerationState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {
      requestId: null,
      phase: 'idle',
      statusText: null,
      lastError: null,
      lastGeneratedAt: null,
    };
  }

  const record = value as Partial<SmartDirectorStoryboardGenerationState>;
  return {
    requestId: normalizeString(record.requestId).trim() || null,
    phase: normalizeSmartDirectorStoryboardGenerationPhase(record.phase),
    statusText: normalizeString(record.statusText).trim() || null,
    lastError: normalizeString(record.lastError).trim() || null,
    lastGeneratedAt: Number.isFinite(record.lastGeneratedAt) ? Number(record.lastGeneratedAt) : null,
  };
}

export function normalizeDirectorStoryboardTableRow(
  value: unknown,
  fallbackIndex: number
): DirectorStoryboardTableRow | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const record = value as Partial<DirectorStoryboardTableRow>;
  const sketch = normalizeString(
    (record as { sketch?: unknown; frameDescription?: unknown; comicText?: unknown }).sketch
      ?? (record as { frameDescription?: unknown }).frameDescription
      ?? (record as { comicText?: unknown }).comicText
  ).trim();
  const imagePrompt = normalizeString(record.imagePrompt).trim();
  if (!sketch && !imagePrompt) {
    return null;
  }

  return {
    id: normalizeString(record.id).trim() || `director-row-${fallbackIndex + 1}`,
    rowState: normalizeScriptStoryboardTableRowState(record.rowState),
    rowError: normalizeString((record as { rowError?: unknown }).rowError).trim() || null,
    sceneNumber: normalizeString(
      (record as { sceneNumber?: unknown; sceneLabel?: unknown }).sceneNumber
        ?? (record as { sceneLabel?: unknown }).sceneLabel
    ).trim(),
    shotNumber: normalizeString(record.shotNumber).trim() || String(fallbackIndex + 1),
    sketch,
    shotSize: normalizeString(
      (record as { shotSize?: unknown; shotType?: unknown }).shotSize
        ?? (record as { shotType?: unknown }).shotType
    ).trim(),
    cameraAngle: normalizeString(record.cameraAngle).trim(),
    cameraMovement: normalizeString(record.cameraMovement).trim(),
    blockingAction: normalizeString(record.blockingAction).trim(),
    dialogueOrSound: normalizeString(
      (record as { dialogueOrSound?: unknown; dialogueOrVoiceover?: unknown }).dialogueOrSound
        ?? (record as { dialogueOrVoiceover?: unknown }).dialogueOrVoiceover
    ).trim(),
    durationSeconds: Number.isFinite(record.durationSeconds)
      ? Math.max(0.5, Number(record.durationSeconds))
      : 3,
    assetRefs: normalizeStringArray(record.assetRefs),
    imagePrompt,
    remark: normalizeString(
      (record as { remark?: unknown; continuityNote?: unknown }).remark
        ?? (record as { continuityNote?: unknown }).continuityNote
    ).trim(),
    group10sId: normalizeString(record.group10sId).trim(),
    group15sId: normalizeString(record.group15sId).trim(),
    isContinuousWithPrev: Boolean(record.isContinuousWithPrev),
  };
}

export function normalizeDirectorStoryboardDurationGroup(
  value: unknown,
  fallbackIndex: number
): DirectorStoryboardDurationGroup | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const record = value as Partial<DirectorStoryboardDurationGroup>;
  const rowIds = normalizeStringArray(record.rowIds);
  if (rowIds.length === 0) {
    return null;
  }

  return {
    id: normalizeString(record.id).trim() || `director-group-${fallbackIndex + 1}`,
    label: normalizeString(record.label).trim() || `Group ${fallbackIndex + 1}`,
    rowIds,
    totalDurationSeconds: Number.isFinite(record.totalDurationSeconds)
      ? Math.max(0, Number(record.totalDurationSeconds))
      : 0,
    startShotNumber: normalizeString(record.startShotNumber).trim(),
    endShotNumber: normalizeString(record.endShotNumber).trim(),
  };
}

export function normalizeSmartDirectorStoryboardResult(
  value: unknown
): SmartDirectorStoryboardResult | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const record = value as Partial<SmartDirectorStoryboardResult>;
  return {
    schemaVersion: Number.isFinite(record.schemaVersion)
      ? Math.max(1, Math.floor(Number(record.schemaVersion)))
      : 1,
    version: Number.isFinite(record.version) ? Math.max(1, Math.floor(Number(record.version))) : 1,
    generatedAt: Number.isFinite(record.generatedAt) ? Number(record.generatedAt) : Date.now(),
    rows: (Array.isArray(record.rows) ? record.rows : [])
      .map((item, index) => normalizeDirectorStoryboardTableRow(item, index))
      .filter((item): item is DirectorStoryboardTableRow => Boolean(item)),
    continuousGroups: (Array.isArray(record.continuousGroups) ? record.continuousGroups : [])
      .map((item, index) => normalizeDirectorStoryboardDurationGroup(item, index))
      .filter((item): item is DirectorStoryboardDurationGroup => Boolean(item)),
    groups10s: (Array.isArray(record.groups10s) ? record.groups10s : [])
      .map((item, index) => normalizeDirectorStoryboardDurationGroup(item, index))
      .filter((item): item is DirectorStoryboardDurationGroup => Boolean(item)),
    groups15s: (Array.isArray(record.groups15s) ? record.groups15s : [])
      .map((item, index) => normalizeDirectorStoryboardDurationGroup(item, index))
      .filter((item): item is DirectorStoryboardDurationGroup => Boolean(item)),
    totalDurationSeconds: Number.isFinite(record.totalDurationSeconds)
      ? Math.max(0, Number(record.totalDurationSeconds))
      : 0,
  };
}

export function normalizeScriptStoryboardTableColumn(
  value: unknown,
  fallbackIndex: number
): ScriptStoryboardTableColumn | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const record = value as Partial<ScriptStoryboardTableColumn>;
  const key = normalizeString(record.key).trim();
  const label = normalizeString(record.label).trim();
  if (!key && !label) {
    return null;
  }

  return {
    key: key || `column-${fallbackIndex + 1}`,
    label: label || key || `Column ${fallbackIndex + 1}`,
  };
}

export function normalizeScriptStoryboardTableSummary(
  value: unknown
): ScriptStoryboardTableSummary {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {
      rowCount: 0,
      generatedRowCount: 0,
      totalDurationSeconds: 0,
      continuousGroupCount: 0,
      groups10sCount: 0,
      groups15sCount: 0,
      lastUpdatedAt: null,
    };
  }

  const record = value as Partial<ScriptStoryboardTableSummary>;
  return {
    rowCount: Number.isFinite(record.rowCount) ? Math.max(0, Math.floor(Number(record.rowCount))) : 0,
    generatedRowCount: Number.isFinite(record.generatedRowCount)
      ? Math.max(0, Math.floor(Number(record.generatedRowCount)))
      : 0,
    totalDurationSeconds: Number.isFinite(record.totalDurationSeconds)
      ? Math.max(0, Number(record.totalDurationSeconds))
      : 0,
    continuousGroupCount: Number.isFinite(record.continuousGroupCount)
      ? Math.max(0, Math.floor(Number(record.continuousGroupCount)))
      : 0,
    groups10sCount: Number.isFinite(record.groups10sCount)
      ? Math.max(0, Math.floor(Number(record.groups10sCount)))
      : 0,
    groups15sCount: Number.isFinite(record.groups15sCount)
      ? Math.max(0, Math.floor(Number(record.groups15sCount)))
      : 0,
    lastUpdatedAt: Number.isFinite(record.lastUpdatedAt) ? Number(record.lastUpdatedAt) : null,
  };
}

export function normalizeScriptStoryboardTableStreamState(
  value: unknown
): ScriptStoryboardTableStreamState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {
      requestId: null,
      phase: 'idle',
      statusText: null,
      error: null,
      activeRowId: null,
      completedRowCount: 0,
      totalRowCount: 0,
      lastEventAt: null,
    };
  }

  const record = value as Partial<ScriptStoryboardTableStreamState>;
  return {
    requestId: normalizeString(record.requestId).trim() || null,
    phase: normalizeScriptStoryboardTableStreamPhase(record.phase),
    statusText: normalizeString(record.statusText).trim() || null,
    error: normalizeString(record.error).trim() || null,
    activeRowId: normalizeString(record.activeRowId).trim() || null,
    completedRowCount: Number.isFinite(record.completedRowCount)
      ? Math.max(0, Math.floor(Number(record.completedRowCount)))
      : 0,
    totalRowCount: Number.isFinite(record.totalRowCount)
      ? Math.max(0, Math.floor(Number(record.totalRowCount)))
      : 0,
    lastEventAt: Number.isFinite(record.lastEventAt) ? Number(record.lastEventAt) : null,
  };
}

export function normalizeDirectorStoryboardTransferSnapshot(
  value: unknown
): DirectorStoryboardTransferSnapshot | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const record = value as Partial<DirectorStoryboardTransferSnapshot>;
  const version = Number.isFinite(record.version) ? Math.max(1, Math.floor(Number(record.version))) : 0;
  if (!version) {
    return null;
  }

  return {
    version,
    generatedAt: Number.isFinite(record.generatedAt) ? Number(record.generatedAt) : Date.now(),
    rowCount: Number.isFinite((record as { rowCount?: unknown }).rowCount)
      ? Math.max(0, Math.floor(Number((record as { rowCount?: unknown }).rowCount)))
      : 0,
    totalDurationSeconds: Number.isFinite(record.totalDurationSeconds)
      ? Math.max(0, Number(record.totalDurationSeconds))
      : 0,
  };
}

export function normalizeProductionJobRecord(value: unknown): ProductionJobRecord | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const record = value as Partial<ProductionJobRecord>;
  const jobId = normalizeString(record.jobId).trim();
  if (!jobId) {
    return null;
  }

  return {
    jobId,
    kind: normalizeProductionJobKind(record.kind),
    sourceSectionId: normalizeString(record.sourceSectionId).trim() || null,
    sourceShotId: normalizeString(record.sourceShotId).trim() || null,
    sourceNodeId: normalizeString(record.sourceNodeId).trim() || null,
    status: normalizeProductionJobStatus(record.status),
    requestId: normalizeString(record.requestId).trim() || null,
    resultNodeIds: normalizeStringArray(record.resultNodeIds),
    startedAt: Number.isFinite(record.startedAt) ? Number(record.startedAt) : null,
    finishedAt: Number.isFinite(record.finishedAt) ? Number(record.finishedAt) : null,
    error: normalizeString(record.error).trim() || null,
  };
}

function normalizeProductionJobRecords(value: unknown): ProductionJobRecord[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => normalizeProductionJobRecord(item))
    .filter((item): item is ProductionJobRecord => Boolean(item));
}

export function createEmptyProductionQueueState(): ProductionQueueState {
  return {
    imageJobs: [],
    videoJobs: [],
    activeJobIds: [],
    lastRunAt: null,
    lastError: null,
    batchScope: null,
  };
}

export function createEmptyAssetBatchQueueState(): AssetBatchQueueState {
  return {
    pendingNodeIds: [],
    runningNodeId: null,
    completedNodeIds: [],
    failedNodeIds: [],
    lastRunAt: null,
  };
}

export function normalizeAssetBatchQueueState(value: unknown): AssetBatchQueueState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return createEmptyAssetBatchQueueState();
  }

  const record = value as Partial<AssetBatchQueueState>;
  return {
    pendingNodeIds: normalizeStringArray(record.pendingNodeIds),
    runningNodeId: normalizeString(record.runningNodeId).trim() || null,
    completedNodeIds: normalizeStringArray(record.completedNodeIds),
    failedNodeIds: normalizeStringArray(record.failedNodeIds),
    lastRunAt: Number.isFinite(record.lastRunAt) ? Number(record.lastRunAt) : null,
  };
}

export function normalizeProductionQueueState(value: unknown): ProductionQueueState {
  const record = value && typeof value === 'object'
    ? value as Partial<ProductionQueueState>
    : {};

  return {
    imageJobs: normalizeProductionJobRecords(record.imageJobs),
    videoJobs: normalizeProductionJobRecords(record.videoJobs),
    activeJobIds: normalizeStringArray(record.activeJobIds),
    lastRunAt: Number.isFinite(record.lastRunAt) ? Number(record.lastRunAt) : null,
    lastError: normalizeString(record.lastError).trim() || null,
    batchScope: normalizeString(record.batchScope).trim() || null,
  };
}

export function createEmptyDirectorStoryboardOverrides(): DirectorStoryboardOverrides {
  return {
    lockedSectionIds: [],
    expandedSectionIds: [],
    sectionGroupNodeIds: {},
    shotNodeIds: {},
    shotPromptOverrides: {},
    shotVideoPromptOverrides: {},
    shotReferenceAssetIds: {},
  };
}

export function normalizeDirectorStoryboardOverrides(value: unknown): DirectorStoryboardOverrides {
  const record = value && typeof value === 'object'
    ? value as Partial<DirectorStoryboardOverrides>
    : {};

  return {
    lockedSectionIds: normalizeStringArray(record.lockedSectionIds),
    expandedSectionIds: normalizeStringArray(record.expandedSectionIds),
    sectionGroupNodeIds: normalizeStringRecord(record.sectionGroupNodeIds),
    shotNodeIds: normalizeStringRecord(record.shotNodeIds),
    shotPromptOverrides: normalizeStringRecord(record.shotPromptOverrides),
    shotVideoPromptOverrides: normalizeStringRecord(record.shotVideoPromptOverrides),
    shotReferenceAssetIds: normalizeStringArrayRecord(record.shotReferenceAssetIds),
  };
}

function normalizeSceneCopilotThread(
  messages: unknown
): SceneCopilotThreadMessage[] {
  if (!Array.isArray(messages)) {
    return [];
  }

  return messages
    .map((message, index) => {
      const record = message && typeof message === 'object'
        ? message as Partial<SceneCopilotThreadMessage>
        : {};
      const role = record.role === 'assistant' ? 'assistant' : 'user';
      const content = normalizeString(record.content).trim();

      if (!content) {
        return null;
      }

      const selectionVariants = normalizeStringArray(record.selectionVariants);
      const selectedVariantIndex = Number.isInteger(record.selectedVariantIndex)
        ? Number(record.selectedVariantIndex)
        : null;

      const normalizedMessage: SceneCopilotThreadMessage = {
        id: normalizeString(record.id, `copilot-${role}-${index + 1}`),
        role,
        content,
        mode: normalizeSceneCopilotMessageMode(record.mode),
        createdAt: Number.isFinite(record.createdAt) ? Number(record.createdAt) : Date.now(),
        selectionSourceText: normalizeString(record.selectionSourceText).trim() || undefined,
        selectionVariants: selectionVariants.length > 0 ? selectionVariants : undefined,
        selectedVariantIndex: selectedVariantIndex !== null
          && selectedVariantIndex >= 0
          && selectedVariantIndex < selectionVariants.length
          ? selectedVariantIndex
          : null,
        selectionResolution: normalizeSceneCopilotSelectionResolution(record.selectionResolution),
        continuityCheck: normalizeSceneContinuityCheck(record.continuityCheck),
      };

      return normalizedMessage;
    })
    .filter((message): message is SceneCopilotThreadMessage => Boolean(message));
}

export function createDefaultSceneCard(order = 0): SceneCard {
  const sceneIndex = order + 1;
  return {
    id: `scene-${sceneIndex}-${Math.random().toString(36).slice(2, 8)}`,
    order,
    title: `场景 ${sceneIndex}`,
    summary: '',
    purpose: '',
    povCharacter: '',
    goal: '',
    conflict: '',
    turn: '',
    emotionalShift: '',
    visualHook: '',
    subtext: '',
    draftHtml: '',
    sourceDraftHtml: undefined,
    sourceDraftLabel: undefined,
    continuitySummary: '',
    continuityFacts: [],
    continuityOpenLoops: [],
    continuityUpdatedAt: null,
    directorNotes: '',
    copilotSummary: '',
    copilotThread: [],
    status: 'idea',
  };
}

export function createDefaultShotRow(order = 0): ShotRow {
  const shotIndex = order + 1;
  return {
    id: `shot-${shotIndex}-${Math.random().toString(36).slice(2, 8)}`,
    shotNumber: String(shotIndex),
    beat: '',
    action: '',
    dialogueCue: '',
    shotSize: '',
    framingAngle: '',
    cameraMove: '',
    blocking: '',
    rhythmDuration: '',
    audioCue: '',
    artLighting: '',
    continuityNote: '',
    genTarget: 'image',
    genPrompt: '',
    status: 'draft',
  };
}

export interface ShootingScriptNumberingContext {
  chapterNumber: number;
  sceneNumber: number;
  episodeNumber: number;
}

function normalizeShootingScriptIndex(value: unknown, fallback = 1): number {
  return Number.isFinite(value)
    ? Math.max(1, Math.floor(Number(value)))
    : fallback;
}

export function normalizeShootingScriptNumberingContext(
  context?: Partial<ShootingScriptNumberingContext> | null
): ShootingScriptNumberingContext {
  return {
    chapterNumber: normalizeShootingScriptIndex(context?.chapterNumber),
    sceneNumber: normalizeShootingScriptIndex(context?.sceneNumber),
    episodeNumber: normalizeShootingScriptIndex(context?.episodeNumber),
  };
}

export function formatShootingScriptNodeLabel(
  context?: Partial<ShootingScriptNumberingContext> | null
): string {
  const normalizedContext = normalizeShootingScriptNumberingContext(context);
  return `${normalizedContext.chapterNumber}-${normalizedContext.sceneNumber}-${normalizedContext.episodeNumber}`;
}

export function formatShootingScriptShotNumber(
  context: Partial<ShootingScriptNumberingContext> | null | undefined,
  order: number
): string {
  const normalizedContext = normalizeShootingScriptNumberingContext(context);
  const shotNumber = normalizeShootingScriptIndex(order + 1);
  return `${normalizedContext.chapterNumber}-${normalizedContext.sceneNumber}-${normalizedContext.episodeNumber}-${shotNumber}`;
}

export function createDefaultShootingScriptRow(
  order = 0,
  context?: Partial<ShootingScriptNumberingContext> | null
): ShootingScriptRow {
  const shotIndex = order + 1;
  return {
    id: `shooting-script-row-${shotIndex}-${Math.random().toString(36).slice(2, 8)}`,
    shotNumber: formatShootingScriptShotNumber(context, order),
    beat: '',
    action: '',
    composition: '',
    camera: '',
    duration: '',
    audio: '',
    blocking: '',
    artLighting: '',
    continuityNote: '',
    directorIntent: '',
    genTarget: 'image',
    genPrompt: '',
    status: 'draft',
  };
}

export function createDefaultEpisodeCard(order = 0): EpisodeCard {
  const episodeIndex = order + 1;
  const baseCard = createDefaultSceneCard(order);
  return {
    ...baseCard,
    id: `episode-${episodeIndex}-${Math.random().toString(36).slice(2, 8)}`,
    title: `分集 ${episodeIndex}`,
    episodeNumber: episodeIndex,
    shotRows: [],
    shotScriptStatus: 'empty',
    shotScriptUpdatedAt: null,
  };
}

export function normalizeSceneCards(
  scenes: unknown,
  legacyContent?: string | null
): SceneCard[] {
  if (!Array.isArray(scenes) || scenes.length === 0) {
    const fallbackScene = createDefaultSceneCard(0);
    if (legacyContent && legacyContent.trim()) {
      fallbackScene.draftHtml = legacyContent;
      fallbackScene.status = 'drafting';
    }
    return [fallbackScene];
  }

  return scenes.map((scene, index) => {
    const record = scene && typeof scene === 'object'
      ? scene as Partial<SceneCard>
      : {};
    const fallbackScene = createDefaultSceneCard(index);

    return {
      ...fallbackScene,
      ...record,
      id: normalizeString(record.id, fallbackScene.id),
      order: Number.isFinite(record.order) ? Number(record.order) : index,
      title: normalizeString(record.title, fallbackScene.title),
      summary: normalizeString(record.summary),
      purpose: normalizeString(record.purpose),
      povCharacter: normalizeString(record.povCharacter),
      goal: normalizeString(record.goal),
      conflict: normalizeString(record.conflict),
      turn: normalizeString(record.turn),
      emotionalShift: normalizeString(record.emotionalShift),
      visualHook: normalizeString(record.visualHook),
      subtext: normalizeString(record.subtext),
      draftHtml: normalizeString(record.draftHtml),
      sourceDraftHtml: normalizeString(record.sourceDraftHtml).trim() || undefined,
      sourceDraftLabel: normalizeString(record.sourceDraftLabel).trim() || undefined,
      continuitySummary: normalizeString(record.continuitySummary),
      continuityFacts: normalizeStringArray(record.continuityFacts),
      continuityOpenLoops: normalizeStringArray(record.continuityOpenLoops),
      continuityUpdatedAt: Number.isFinite(record.continuityUpdatedAt)
        ? Number(record.continuityUpdatedAt)
        : null,
      directorNotes: normalizeString(record.directorNotes),
      copilotSummary: normalizeString(record.copilotSummary),
      copilotThread: normalizeSceneCopilotThread(record.copilotThread),
      status: normalizeSceneCardStatus(record.status),
    };
  });
}

export function normalizeShotRows(shotRows: unknown): ShotRow[] {
  if (!Array.isArray(shotRows) || shotRows.length === 0) {
    return [];
  }

  return shotRows.map((shotRow, index) => {
    const record = shotRow && typeof shotRow === 'object'
      ? shotRow as Partial<ShotRow>
      : {};
    const fallbackShotRow = createDefaultShotRow(index);

    return {
      ...fallbackShotRow,
      ...record,
      id: normalizeString(record.id, fallbackShotRow.id),
      shotNumber: normalizeString(record.shotNumber, fallbackShotRow.shotNumber),
      beat: normalizeString(record.beat),
      action: normalizeString(record.action),
      dialogueCue: normalizeString(record.dialogueCue),
      shotSize: normalizeString(record.shotSize),
      framingAngle: normalizeString(record.framingAngle),
      cameraMove: normalizeString(record.cameraMove),
      blocking: normalizeString(record.blocking),
      rhythmDuration: normalizeString(record.rhythmDuration),
      audioCue: normalizeString(record.audioCue),
      artLighting: normalizeString(record.artLighting),
      continuityNote: normalizeString(record.continuityNote),
      genTarget: normalizeShotRowGenTarget(record.genTarget),
      genPrompt: normalizeString(record.genPrompt),
      status: normalizeShotRowStatus(record.status),
    };
  });
}

export function normalizeShootingScriptRows(
  rows: unknown,
  context?: Partial<ShootingScriptNumberingContext> | null
): ShootingScriptRow[] {
  if (!Array.isArray(rows) || rows.length === 0) {
    return [];
  }

  return rows.map((row, index) => {
    const record = row && typeof row === 'object'
      ? row as Partial<ShootingScriptRow>
      : {};
    const fallbackRow = createDefaultShootingScriptRow(index, context);

    return {
      ...fallbackRow,
      ...record,
      id: normalizeString(record.id, fallbackRow.id),
      shotNumber: fallbackRow.shotNumber,
      beat: normalizeString(record.beat),
      action: normalizeString(record.action),
      composition: normalizeString(record.composition),
      camera: normalizeString(record.camera),
      duration: normalizeString(record.duration),
      audio: normalizeString(record.audio),
      blocking: normalizeString(record.blocking),
      artLighting: normalizeString(record.artLighting),
      continuityNote: normalizeString(record.continuityNote),
      directorIntent: normalizeString(record.directorIntent),
      genTarget: normalizeShotRowGenTarget(record.genTarget),
      genPrompt: normalizeString(record.genPrompt),
      status: normalizeShotRowStatus(record.status),
    };
  });
}

export function normalizeEpisodeCards(episodes: unknown): EpisodeCard[] {
  if (!Array.isArray(episodes) || episodes.length === 0) {
    return [];
  }

  return episodes.map((episode, index) => {
    const record = episode && typeof episode === 'object'
      ? episode as Partial<EpisodeCard>
      : {};
    const fallbackEpisode = createDefaultEpisodeCard(index);

    return {
      ...fallbackEpisode,
      ...record,
      id: normalizeString(record.id, fallbackEpisode.id),
      order: Number.isFinite(record.order) ? Number(record.order) : index,
      episodeNumber: Number.isFinite(record.episodeNumber)
        ? Math.max(1, Math.floor(Number(record.episodeNumber)))
        : fallbackEpisode.episodeNumber,
      title: normalizeString(record.title, fallbackEpisode.title),
      summary: normalizeString(record.summary),
      purpose: normalizeString(record.purpose),
      povCharacter: normalizeString(record.povCharacter),
      goal: normalizeString(record.goal),
      conflict: normalizeString(record.conflict),
      turn: normalizeString(record.turn),
      emotionalShift: normalizeString(record.emotionalShift),
      visualHook: normalizeString(record.visualHook),
      subtext: normalizeString(record.subtext),
      draftHtml: normalizeString(record.draftHtml),
      sourceDraftHtml: normalizeString(record.sourceDraftHtml).trim() || undefined,
      sourceDraftLabel: normalizeString(record.sourceDraftLabel).trim() || undefined,
      continuitySummary: normalizeString(record.continuitySummary),
      continuityFacts: normalizeStringArray(record.continuityFacts),
      continuityOpenLoops: normalizeStringArray(record.continuityOpenLoops),
      continuityUpdatedAt: Number.isFinite(record.continuityUpdatedAt)
        ? Number(record.continuityUpdatedAt)
        : null,
      directorNotes: normalizeString(record.directorNotes),
      copilotSummary: normalizeString(record.copilotSummary),
      copilotThread: normalizeSceneCopilotThread(record.copilotThread),
      status: normalizeSceneCardStatus(record.status),
      shotRows: normalizeShotRows(record.shotRows),
      shotScriptStatus: normalizeShotScriptStatus(record.shotScriptStatus),
      shotScriptUpdatedAt: Number.isFinite(record.shotScriptUpdatedAt)
        ? Number(record.shotScriptUpdatedAt)
        : null,
    };
  });
}

function normalizeScriptReferenceShotRowSnapshots(
  value: unknown
): ScriptReferenceShotRowSnapshot[] {
  if (!Array.isArray(value) || value.length === 0) {
    return [];
  }

  return value
    .map((item, index): ScriptReferenceShotRowSnapshot | null => {
      const record = item && typeof item === 'object'
        ? item as Partial<ScriptReferenceShotRowSnapshot>
        : {};
      const id = normalizeString(record.id, `script-reference-shot-${index + 1}`).trim();
      if (!id) {
        return null;
      }

      return {
        id,
        shotNumber: normalizeString(record.shotNumber, String(index + 1)),
        beat: normalizeString(record.beat),
        genTarget: normalizeShotRowGenTarget(record.genTarget),
        genPrompt: normalizeString(record.genPrompt),
        status: normalizeShotRowStatus(record.status),
      };
    })
    .filter((item): item is ScriptReferenceShotRowSnapshot => Boolean(item));
}

function normalizeShootingScriptSourceSnapshot(
  value: unknown
): ShootingScriptSourceSnapshot | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const record = value as Partial<ShootingScriptSourceSnapshot>;

  return {
    chapterTitle: normalizeString(record.chapterTitle),
    sceneTitle: normalizeString(record.sceneTitle),
    sceneSummary: normalizeString(record.sceneSummary),
    episodeTitle: normalizeString(record.episodeTitle),
    episodeSummary: normalizeString(record.episodeSummary),
    episodeDraft: normalizeString(record.episodeDraft),
    episodeDirectorNotes: normalizeString(record.episodeDirectorNotes),
    continuitySummary: normalizeString(record.continuitySummary),
    continuityFacts: normalizeStringArray(record.continuityFacts),
    continuityOpenLoops: normalizeStringArray(record.continuityOpenLoops),
  };
}

function normalizeScriptReferenceScriptSnapshot(
  value: unknown
): ScriptReferenceScriptSnapshot | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const record = value as Partial<ScriptReferenceScriptSnapshot> & {
    shotRows?: ScriptReferenceShotRowSnapshot[];
  };
  const episodeId = normalizeString(record.episodeId).trim();
  if (!episodeId) {
    return null;
  }

  return {
    scriptNodeId: normalizeString(record.scriptNodeId).trim() || null,
    chapterId: normalizeString(record.chapterId).trim() || null,
    chapterTitle: normalizeString(record.chapterTitle),
    sceneNodeId: normalizeString(record.sceneNodeId).trim() || null,
    sceneTitle: normalizeString(record.sceneTitle),
    episodeId,
    episodeTitle: normalizeString(record.episodeTitle),
    episodeLabel: normalizeString(record.episodeLabel),
    rows: normalizeScriptReferenceShotRowSnapshots(record.rows ?? record.shotRows),
  };
}

function normalizeAdScriptReferenceRowSnapshots(
  value: unknown
): AdScriptReferenceRowSnapshot[] {
  return normalizeAdScriptRows(value).map((row) => ({
    id: row.id,
    shotNumber: row.shotNumber,
    duration: row.duration,
    objective: row.objective,
    visual: row.visual,
    dialogueOrVO: row.dialogueOrVO,
    camera: row.camera,
    audio: row.audio,
    productFocus: row.productFocus,
    sellingPoint: row.sellingPoint,
    cta: row.cta,
    assetHint: row.assetHint,
    directorIntent: row.directorIntent,
    status: row.status,
  }));
}

function normalizeAdScriptReferenceSnapshot(
  value: unknown
): AdScriptReferenceSnapshot | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const record = value as Partial<AdScriptReferenceSnapshot>;
  const templateId = record.templateId;
  if (
    templateId !== 'performance'
    && templateId !== 'problemSolution'
    && templateId !== 'brandStory'
  ) {
    return null;
  }

  return {
    templateId,
    brief: normalizeAdBrief(record.brief),
    lastGeneratedAt: Number.isFinite(record.lastGeneratedAt)
      ? Number(record.lastGeneratedAt)
      : null,
    rows: normalizeAdScriptReferenceRowSnapshots(record.rows),
  };
}

function normalizeScriptCharacterReferenceSnapshot(
  value: unknown
): ScriptCharacterReferenceSnapshot | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const record = value as Partial<ScriptCharacterReferenceSnapshot>;
  const name = normalizeString(record.name).trim();
  if (!name) {
    return null;
  }

  return {
    name,
    description: normalizeString(record.description),
    personality: normalizeString(record.personality),
    appearance: normalizeString(record.appearance),
  };
}

function normalizeScriptLocationReferenceSnapshot(
  value: unknown
): ScriptLocationReferenceSnapshot | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const record = value as Partial<ScriptLocationReferenceSnapshot>;
  const name = normalizeString(record.name).trim();
  if (!name) {
    return null;
  }

  return {
    name,
    description: normalizeString(record.description),
    appearances: normalizeStringArray(record.appearances),
  };
}

function normalizeScriptItemReferenceSnapshot(
  value: unknown
): ScriptItemReferenceSnapshot | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const record = value as Partial<ScriptItemReferenceSnapshot>;
  const name = normalizeString(record.name).trim();
  if (!name) {
    return null;
  }

  return {
    name,
    description: normalizeString(record.description),
    appearances: normalizeStringArray(record.appearances),
  };
}

export function normalizeScriptRootNodeData(data: ScriptRootNodeData): ScriptRootNodeData {
  const normalizeCharacterAssets = (items: unknown): ScriptCharacterAsset[] => (
    Array.isArray(items)
      ? items
          .map((item) => {
            if (!item || typeof item !== 'object') {
              return null;
            }

            const record = item as Record<string, unknown>;
            const name = normalizeString(record.name).trim();
            if (!name) {
              return null;
            }

            return {
              name,
              description: normalizeString(record.description),
              personality: normalizeString(record.personality),
              appearance: normalizeString(record.appearance),
            };
          })
          .filter((item): item is ScriptCharacterAsset => Boolean(item))
      : []
  );

  const normalizeLocationAssets = (items: unknown): ScriptLocationAsset[] => (
    Array.isArray(items)
      ? items
          .map((item) => {
            if (!item || typeof item !== 'object') {
              return null;
            }

            const record = item as Record<string, unknown>;
            const name = normalizeString(record.name).trim();
            if (!name) {
              return null;
            }

            return {
              name,
              description: normalizeString(record.description),
              appearances: normalizeStringArray(record.appearances),
            };
          })
          .filter((item): item is ScriptLocationAsset => Boolean(item))
      : []
  );

  const normalizeItemAssets = (items: unknown): ScriptItemAsset[] => (
    Array.isArray(items)
      ? items
          .map((item) => {
            if (!item || typeof item !== 'object') {
              return null;
            }

            const record = item as Record<string, unknown>;
            const name = normalizeString(record.name).trim();
            if (!name) {
              return null;
            }

            return {
              name,
              description: normalizeString(record.description),
              appearances: normalizeStringArray(record.appearances),
            };
          })
          .filter((item): item is ScriptItemAsset => Boolean(item))
      : []
  );

  return {
    ...data,
    premise: normalizeString(data.premise),
    theme: normalizeString(data.theme),
    protagonist: normalizeString(data.protagonist),
    want: normalizeString(data.want),
    need: normalizeString(data.need),
    stakes: normalizeString(data.stakes),
    tone: normalizeString(data.tone),
    directorVision: normalizeString(data.directorVision),
    beats: Array.isArray(data.beats) ? data.beats : [],
    assetLibraryCharacters: normalizeCharacterAssets(data.assetLibraryCharacters),
    assetLibraryLocations: normalizeLocationAssets(data.assetLibraryLocations),
    assetLibraryItems: normalizeItemAssets(data.assetLibraryItems),
  };
}

export function normalizeAdProjectRootNodeData(
  data: Partial<AdProjectRootNodeData> | null | undefined
): AdProjectRootNodeData {
  const normalizedState = normalizeAdProjectRootState(data);

  return {
    ...createDefaultAdProjectRootState(),
    ...normalizedState,
    displayName: normalizeString(data?.displayName).trim() || undefined,
    nodeDescription: normalizeString(data?.nodeDescription).trim() || null,
    semanticColor: data?.semanticColor ?? null,
  };
}

export function normalizeCommerceProductNodeData(
  data: Partial<CommerceProductNodeData> | null | undefined
): CommerceProductNodeData {
  return {
    ...createDefaultCommerceAdProductState(),
    ...normalizeCommerceAdProductState(data),
    displayName: normalizeString(data?.displayName).trim() || undefined,
    nodeDescription: normalizeString(data?.nodeDescription).trim() || null,
    semanticColor: data?.semanticColor ?? null,
  };
}

export function normalizeCommerceBriefNodeData(
  data: Partial<CommerceBriefNodeData> | null | undefined
): CommerceBriefNodeData {
  return {
    ...createDefaultCommerceAdBriefState(),
    ...normalizeCommerceAdBriefState(data),
    displayName: normalizeString(data?.displayName).trim() || undefined,
    nodeDescription: normalizeString(data?.nodeDescription).trim() || null,
    semanticColor: data?.semanticColor ?? null,
  };
}

export function normalizeCommerceBatchGenerateNodeData(
  data: Partial<CommerceBatchGenerateNodeData> | null | undefined
): CommerceBatchGenerateNodeData {
  return {
    ...createDefaultCommerceAdBatchGenerateState(),
    ...normalizeCommerceAdBatchGenerateState(data),
    displayName: normalizeString(data?.displayName).trim() || undefined,
    nodeDescription: normalizeString(data?.nodeDescription).trim() || null,
    semanticColor: data?.semanticColor ?? null,
  };
}

export function normalizeCommerceResultGroupNodeData(
  data: Partial<CommerceResultGroupNodeData> | null | undefined
): CommerceResultGroupNodeData {
  return {
    ...createDefaultCommerceAdResultGroupState(),
    ...normalizeCommerceAdResultGroupState(data),
    displayName: normalizeString(data?.displayName).trim() || undefined,
    nodeDescription: normalizeString(data?.nodeDescription).trim() || null,
    semanticColor: data?.semanticColor ?? null,
  };
}

export function normalizeTextAnnotationNodeData(data: TextAnnotationNodeData): TextAnnotationNodeData {
  return {
    ...data,
    content: normalizeString(data.content),
    generationSource:
      data.generationSource
      && data.generationSource.kind === 'llmLogic'
      && normalizeString(data.generationSource.sourceNodeId).trim()
        ? {
            kind: 'llmLogic',
            sourceNodeId: normalizeString(data.generationSource.sourceNodeId).trim(),
          }
        : null,
    showCopyButton: normalizeBooleanValue(data.showCopyButton, false),
    isGenerating: normalizeBooleanValue(data.isGenerating, false),
    generationStatusText: normalizeString(data.generationStatusText).trim() || null,
  };
}

export function normalizeLlmLogicNodeData(data: LlmLogicNodeData): LlmLogicNodeData {
  const presetCategoryKey = normalizeString(data.presetCategoryKey).trim();
  const presetKey = normalizeString(data.presetKey).trim();
  const normalizedPresetCategoryKey: LlmLogicPresetCategoryKey | null = [
    'voice',
    'screen',
    'writing',
  ].includes(presetCategoryKey)
    ? presetCategoryKey as LlmLogicPresetCategoryKey
    : ({
        general: 'writing',
        dialogue: 'screen',
        dubbing: 'voice',
      } as const)[presetCategoryKey as 'general' | 'dialogue' | 'dubbing'] ?? null;
  const normalizedPresetKey: LlmLogicPresetKey | null = [
    'generalPolish',
    'spokenNatural',
    'clarity',
    'voiceSeparation',
    'cinematicImagery',
    'reverseImageContent',
    'rhythmPause',
    'emotionProgression',
    'subtext',
    'dialogueTension',
    'dubbingReadability',
  ].includes(presetKey)
    ? presetKey as LlmLogicPresetKey
    : null;
  const derivedPresetCategoryKey: LlmLogicPresetCategoryKey | null = normalizedPresetKey
    ? ({
        generalPolish: 'writing',
        spokenNatural: 'voice',
        clarity: 'writing',
        voiceSeparation: 'voice',
        cinematicImagery: 'screen',
        reverseImageContent: 'screen',
        rhythmPause: 'voice',
        emotionProgression: 'screen',
        subtext: 'screen',
        dialogueTension: 'screen',
        dubbingReadability: 'voice',
      } satisfies Record<LlmLogicPresetKey, LlmLogicPresetCategoryKey>)[normalizedPresetKey]
    : normalizedPresetCategoryKey;

  return {
    ...data,
    model: normalizeString(data.model),
    systemInstruction: normalizeString(data.systemInstruction),
    userPrompt: normalizeString(data.userPrompt),
    presetCategoryKey: derivedPresetCategoryKey,
    presetKey: normalizedPresetKey,
    activeRequestId: normalizeString(data.activeRequestId).trim() || null,
    outputNodeId: normalizeString(data.outputNodeId).trim() || null,
    pendingRequestIds: normalizeStringArray(data.pendingRequestIds),
    isGenerating: normalizeBooleanValue(data.isGenerating, false),
    statusText: normalizeString(data.statusText).trim() || null,
    lastError: normalizeString(data.lastError).trim() || null,
    lastGeneratedAt:
      typeof data.lastGeneratedAt === 'number' && Number.isFinite(data.lastGeneratedAt)
        ? data.lastGeneratedAt
        : null,
  };
}

export function normalizeScriptChapterNodeData(data: ScriptChapterNodeData): ScriptChapterNodeData {
  return {
    ...data,
    chapterPurpose: normalizeString(data.chapterPurpose),
    chapterQuestion: normalizeString(data.chapterQuestion),
    scenes: normalizeSceneCards(data.scenes, data.content),
  };
}

export function normalizeScriptSceneNodeData(data: ScriptSceneNodeData): ScriptSceneNodeData {
  return {
    ...data,
    sourceChapterId: normalizeString(data.sourceChapterId),
    sourceSceneId: normalizeString(data.sourceSceneId),
    sourceSceneOrder: Number.isFinite(data.sourceSceneOrder)
      ? Math.max(0, Math.floor(Number(data.sourceSceneOrder)))
      : 0,
    chapterNumber: Number.isFinite(data.chapterNumber)
      ? Math.max(1, Math.floor(Number(data.chapterNumber)))
      : 1,
    title: normalizeString(data.title),
    summary: normalizeString(data.summary),
    purpose: normalizeString(data.purpose),
    povCharacter: normalizeString(data.povCharacter),
    goal: normalizeString(data.goal),
    conflict: normalizeString(data.conflict),
    turn: normalizeString(data.turn),
    emotionalShift: normalizeString(data.emotionalShift),
    visualHook: normalizeString(data.visualHook),
    subtext: normalizeString(data.subtext),
    sourceDraftHtml: normalizeString(data.sourceDraftHtml).trim() || undefined,
    draftHtml: normalizeString(data.draftHtml),
    episodes: normalizeEpisodeCards(data.episodes),
    directorStoryboardPackage: normalizeDirectorStoryboardPackage(data.directorStoryboardPackage),
    directorStoryboardGeneration: normalizeDirectorStoryboardGenerationState(
      data.directorStoryboardGeneration
    ),
  };
}

export function normalizeScriptCharacterNodeData(
  data: ScriptCharacterNodeData
): ScriptCharacterNodeData {
  return {
    ...data,
    name: normalizeString(data.name),
    description: normalizeString(data.description),
    personality: normalizeString(data.personality),
    appearance: normalizeString(data.appearance),
    statusUpdates: Array.isArray(data.statusUpdates) ? data.statusUpdates : [],
    relationships: Array.isArray(data.relationships) ? data.relationships : [],
  };
}

export function normalizeScriptStoryNoteNodeData(
  data: ScriptStoryNoteNodeData
): ScriptStoryNoteNodeData {
  return {
    ...data,
    title: normalizeString(data.title),
    content: normalizeString(data.content),
    isEnabled: normalizeBooleanValue(data.isEnabled, true),
  };
}

export function normalizeGroupNodeData(
  data: GroupNodeData
): GroupNodeData {
  const batchSource =
    data.batchSource && typeof data.batchSource === 'object' && !Array.isArray(data.batchSource)
      ? {
          sourceMirrorNodeId:
            normalizeString(data.batchSource.sourceMirrorNodeId).trim() || null,
          sourcePanelNodeId:
            normalizeString(data.batchSource.sourcePanelNodeId).trim() || null,
          sourceProjectId:
            normalizeString(data.batchSource.sourceProjectId).trim() || null,
          sourceNodeId:
            normalizeString(data.batchSource.sourceNodeId).trim() || null,
        }
      : null;

  return {
    ...data,
    label: normalizeString(data.label),
    layoutDirection: data.layoutDirection === 'vertical' ? 'vertical' : 'horizontal',
    maxItemsPerLine: Number.isFinite(data.maxItemsPerLine)
      ? Math.max(1, Math.round(Number(data.maxItemsPerLine)))
      : undefined,
    visualStyle:
      data.visualStyle === 'scriptPlotLinePanel'
      || data.visualStyle === 'assetBatchGroup'
      || data.visualStyle === 'storyboardProductionGroup'
      || data.visualStyle === 'storyboardProductionCard'
        ? data.visualStyle
        : 'default',
    batchKind:
      data.batchKind === 'character'
      || data.batchKind === 'scene'
      || data.batchKind === 'item'
      || data.batchKind === 'storyboard10s'
      || data.batchKind === 'storyboard15s'
        ? data.batchKind
        : undefined,
    batchSource,
    globalOverrideEnabled: normalizeBooleanValue(data.globalOverrideEnabled, false),
    globalModelId: normalizeString(data.globalModelId).trim() || null,
    globalSize:
      typeof data.globalSize === 'string' && data.globalSize.trim().length > 0
        ? (data.globalSize.trim() as ImageSize)
        : null,
    globalAspectRatio: normalizeString(data.globalAspectRatio).trim() || null,
    globalStyleTemplateId: normalizeString(data.globalStyleTemplateId).trim() || null,
    globalStyleTemplateName: normalizeString(data.globalStyleTemplateName).trim() || null,
    globalStyleTemplatePrompt: normalizeString(data.globalStyleTemplatePrompt).trim() || null,
    optimizePromptBeforeGenerate: normalizeBooleanValue(data.optimizePromptBeforeGenerate, false),
    queueState: normalizeAssetBatchQueueState(data.queueState),
  };
}

export function normalizeAssetMaterialNodeData(
  data: AssetMaterialNodeData
): AssetMaterialNodeData {
  return {
    ...data,
    assetLibraryId: normalizeString(data.assetLibraryId).trim() || null,
    selectedAssetIds: normalizeStringArray(data.selectedAssetIds)
      .filter((value, index, array) => value.length > 0 && array.indexOf(value) === index),
    sourceStoryboardTableNodeId: normalizeString(data.sourceStoryboardTableNodeId).trim() || null,
    sourceStoryboardRowIds: normalizeStringArray(data.sourceStoryboardRowIds)
      .filter((value, index, array) => value.length > 0 && array.indexOf(value) === index),
    sourceDurationGroupId: normalizeString(data.sourceDurationGroupId).trim() || null,
    defaultMatchedAssetNames: normalizeStringArray(data.defaultMatchedAssetNames)
      .filter((value, index, array) => value.length > 0 && array.indexOf(value) === index),
    displayMode: 'nameOnlyAccordion',
    outputMode: 'namedReference',
    displayName: normalizeString(data.displayName).trim() || data.displayName,
    description: normalizeString(data.description).trim() || undefined,
    semanticColor: data.semanticColor ?? null,
  };
}

export function normalizeShootingScriptNodeData(
  data: ShootingScriptNodeData
): ShootingScriptNodeData {
  const chapterNumber = Number.isFinite(data.chapterNumber)
    ? Math.max(1, Math.floor(Number(data.chapterNumber)))
    : 1;
  const sceneNumber = Number.isFinite(data.sceneNumber)
    ? Math.max(1, Math.floor(Number(data.sceneNumber)))
    : 1;
  const episodeNumber = Number.isFinite(data.episodeNumber)
    ? Math.max(1, Math.floor(Number(data.episodeNumber)))
    : 1;

  return {
    ...data,
    sourceChapterId: normalizeString(data.sourceChapterId),
    sourceSceneNodeId: normalizeString(data.sourceSceneNodeId),
    sourceEpisodeId: normalizeString(data.sourceEpisodeId),
    chapterNumber,
    sceneNumber,
    sceneTitle: normalizeString(data.sceneTitle),
    episodeNumber,
    episodeTitle: normalizeString(data.episodeTitle),
    rows: normalizeShootingScriptRows(data.rows, {
      chapterNumber,
      sceneNumber,
      episodeNumber,
    }),
    status: normalizeShootingScriptStatus(data.status),
    lastGeneratedAt: Number.isFinite(data.lastGeneratedAt)
      ? Number(data.lastGeneratedAt)
      : null,
    lastError: normalizeString(data.lastError).trim() || null,
    sourceSnapshot: normalizeShootingScriptSourceSnapshot(data.sourceSnapshot),
    directorStoryboardPackage: normalizeDirectorStoryboardPackage(data.directorStoryboardPackage),
    directorStoryboardGeneration: normalizeDirectorStoryboardGenerationState(
      data.directorStoryboardGeneration
    ),
  };
}

export function normalizeScriptAssetExtractNodeData(
  data: ScriptAssetExtractNodeData
): ScriptAssetExtractNodeData {
  const expansionSource =
    data.expansionSource && typeof data.expansionSource === 'object' && !Array.isArray(data.expansionSource)
      ? {
          sourceProjectId:
            normalizeString(data.expansionSource.sourceProjectId).trim(),
          sourceProjectName:
            normalizeString(data.expansionSource.sourceProjectName).trim(),
          sourceNodeId:
            normalizeString(data.expansionSource.sourceNodeId).trim(),
          sourceNodeVersion:
            Number.isFinite(data.expansionSource.sourceNodeVersion)
              ? Math.max(1, Math.floor(Number(data.expansionSource.sourceNodeVersion)))
              : null,
          sourceLabel:
            normalizeString(data.expansionSource.sourceLabel).trim(),
        }
      : null;

  return {
    presentationMode: data.presentationMode === 'storyboardMirror'
      ? 'storyboardMirror'
      : 'editable',
    expansionSource:
      expansionSource
      && expansionSource.sourceProjectId
      && expansionSource.sourceNodeId
        ? expansionSource
        : null,
    sourceMode:
      data.sourceMode === 'connectedText'
        ? 'connectedText'
        : 'chapterSelection',
    selectedChapterIds: normalizeStringArray(data.selectedChapterIds),
    resolvedSourceSnapshot: normalizeScriptAssetExtractSourceSnapshot(data.resolvedSourceSnapshot),
    extractionResult: normalizeScriptAssetExtractionResult(data.extractionResult),
    extractionState: normalizeScriptAssetExtractionState(data.extractionState),
    expandedGroupNodeIds: normalizeStringArray(data.expandedGroupNodeIds),
    lastExpandedAt: Number.isFinite(data.lastExpandedAt) ? Number(data.lastExpandedAt) : null,
    displayName: normalizeString(data.displayName).trim() || data.displayName,
    description: normalizeString(data.description).trim() || undefined,
    semanticColor: data.semanticColor ?? null,
  };
}

export const normalizeDirectorWorkPackageNodeData = normalizeScriptAssetExtractNodeData;

export function normalizeSmartDirectorStoryboardNodeData(
  data: SmartDirectorStoryboardNodeData
): SmartDirectorStoryboardNodeData {
  const expansionSource =
    data.expansionSource && typeof data.expansionSource === 'object' && !Array.isArray(data.expansionSource)
      ? {
          sourceProjectId: normalizeString(data.expansionSource.sourceProjectId).trim(),
          sourceProjectName: normalizeString(data.expansionSource.sourceProjectName).trim(),
          sourceNodeId: normalizeString(data.expansionSource.sourceNodeId).trim(),
          sourceNodeVersion: Number.isFinite(data.expansionSource.sourceNodeVersion)
            ? Math.max(1, Math.floor(Number(data.expansionSource.sourceNodeVersion)))
            : null,
          sourceLabel: normalizeString(data.expansionSource.sourceLabel).trim(),
        }
      : null;

  return {
    presentationMode: data.presentationMode === 'storyboardMirror'
      ? 'storyboardMirror'
      : 'editable',
    expansionSource:
      expansionSource
      && expansionSource.sourceProjectId
      && expansionSource.sourceNodeId
        ? expansionSource
        : null,
    sourceAssetExtractNodeId: normalizeString(data.sourceAssetExtractNodeId).trim() || null,
    resolvedSourceSnapshot: normalizeScriptAssetExtractSourceSnapshot(data.resolvedSourceSnapshot),
    generationState: normalizeSmartDirectorStoryboardGenerationState(data.generationState),
    activeResultNodeId: normalizeString((data as { activeResultNodeId?: unknown }).activeResultNodeId).trim() || null,
    generatedResultNodeIds: normalizeStringArray((data as { generatedResultNodeIds?: unknown }).generatedResultNodeIds),
    result: normalizeSmartDirectorStoryboardResult(data.result),
    linkedStoryboardProjectId: normalizeString(data.linkedStoryboardProjectId).trim() || null,
    storyboardTransferStatus: normalizeSmartDirectorStoryboardTransferStatus(data.storyboardTransferStatus),
    storyboardTransferSnapshot: normalizeDirectorStoryboardTransferSnapshot(data.storyboardTransferSnapshot),
    displayName: normalizeString(data.displayName).trim() || data.displayName,
    description: normalizeString(data.description).trim() || undefined,
    semanticColor: data.semanticColor ?? null,
  };
}

export function normalizeScriptStoryboardTableNodeData(
  data: ScriptStoryboardTableNodeData
): ScriptStoryboardTableNodeData {
  const expansionSource =
    data.expansionSource && typeof data.expansionSource === 'object' && !Array.isArray(data.expansionSource)
      ? {
          sourceProjectId: normalizeString(data.expansionSource.sourceProjectId).trim(),
          sourceProjectName: normalizeString(data.expansionSource.sourceProjectName).trim(),
          sourceNodeId: normalizeString(data.expansionSource.sourceNodeId).trim(),
          sourceNodeVersion: Number.isFinite(data.expansionSource.sourceNodeVersion)
            ? Math.max(1, Math.floor(Number(data.expansionSource.sourceNodeVersion)))
            : null,
          sourceLabel: normalizeString(data.expansionSource.sourceLabel).trim(),
        }
      : null;

  const visibleColumnKeys = normalizeStringArray(
    (data as { visibleColumnKeys?: unknown }).visibleColumnKeys
  ).filter((value, index, array) => value.length > 0 && array.indexOf(value) === index);
  const activeEditingCellValue = (data as { activeEditingCell?: unknown }).activeEditingCell;
  const activeEditingCell =
    activeEditingCellValue
    && typeof activeEditingCellValue === 'object'
    && !Array.isArray(activeEditingCellValue)
      ? {
          rowId: normalizeString(
            (activeEditingCellValue as { rowId?: unknown }).rowId
          ).trim(),
          columnKey: normalizeString(
            (activeEditingCellValue as { columnKey?: unknown }).columnKey
          ).trim(),
        }
      : null;

  return {
    presentationMode: data.presentationMode === 'storyboardMirror'
      ? 'storyboardMirror'
      : 'editable',
    expansionSource:
      expansionSource
      && expansionSource.sourceProjectId
      && expansionSource.sourceNodeId
        ? expansionSource
        : null,
    sourceSmartDirectorStoryboardNodeId:
      normalizeString(data.sourceSmartDirectorStoryboardNodeId).trim() || null,
    sourceAssetExtractNodeId: normalizeString(data.sourceAssetExtractNodeId).trim() || null,
    sourceSnapshotVersion: Number.isFinite(data.sourceSnapshotVersion)
      ? Math.max(1, Math.floor(Number(data.sourceSnapshotVersion)))
      : null,
    sourceLabel: normalizeString((data as { sourceLabel?: unknown }).sourceLabel).trim() || null,
    tableSchema: (Array.isArray(data.tableSchema) ? data.tableSchema : [])
      .map((item, index) => normalizeScriptStoryboardTableColumn(item, index))
      .filter((item): item is ScriptStoryboardTableColumn => Boolean(item)),
    rows: (Array.isArray(data.rows) ? data.rows : [])
      .map((item, index) => normalizeDirectorStoryboardTableRow(item, index))
      .filter((item): item is DirectorStoryboardTableRow => Boolean(item)),
    summary: normalizeScriptStoryboardTableSummary(data.summary),
    streamState: normalizeScriptStoryboardTableStreamState(data.streamState),
    rowHeight: Number.isFinite((data as { rowHeight?: unknown }).rowHeight)
      ? Math.min(160, Math.max(56, Math.round(Number((data as { rowHeight?: unknown }).rowHeight))))
      : 72,
    visibleColumnKeys,
    activeEditingCell:
      activeEditingCell && activeEditingCell.rowId && activeEditingCell.columnKey
        ? activeEditingCell
        : null,
    manualEditVersion: Number.isFinite((data as { manualEditVersion?: unknown }).manualEditVersion)
      ? Math.max(0, Math.floor(Number((data as { manualEditVersion?: unknown }).manualEditVersion)))
      : 0,
    manuallyEditedRowIds: normalizeStringArray(
      (data as { manuallyEditedRowIds?: unknown }).manuallyEditedRowIds
    ).filter((value, index, array) => value.length > 0 && array.indexOf(value) === index),
    storyboardProductionMode:
      data.storyboardProductionMode === '10s' || data.storyboardProductionMode === '15s'
        ? data.storyboardProductionMode
        : 'none',
    continuousReferenceEnabled: normalizeBooleanValue(data.continuousReferenceEnabled, false),
    autoStoryboardProductionEnabled: normalizeBooleanValue(
      data.autoStoryboardProductionEnabled,
      false
    ),
    activeStoryboardProductionMode:
      data.activeStoryboardProductionMode === '10s' || data.activeStoryboardProductionMode === '15s'
        ? data.activeStoryboardProductionMode
        : null,
    productionImageModelId:
      normalizeString(data.productionImageModelId).trim() || DEFAULT_PRODUCTION_IMAGE_MODEL_ID,
    productionImageSize:
      typeof data.productionImageSize === 'string' && data.productionImageSize.trim().length > 0
        ? (data.productionImageSize.trim() as ImageSize)
        : ('2K' as ImageSize),
    productionImageAspectRatio:
      normalizeString(data.productionImageAspectRatio).trim() || AUTO_REQUEST_ASPECT_RATIO,
    productionStyleTemplateId: normalizeString(data.productionStyleTemplateId).trim() || null,
    productionStyleTemplateName: normalizeString(data.productionStyleTemplateName).trim() || null,
    productionStyleTemplatePrompt: normalizeString(data.productionStyleTemplatePrompt).trim() || null,
    productionSketchStylePrompt:
      Object.prototype.hasOwnProperty.call(data, 'productionSketchStylePrompt')
        ? normalizeString(data.productionSketchStylePrompt)
        : undefined,
    expandedProductionGroupNodeIds: normalizeStringArray(data.expandedProductionGroupNodeIds)
      .filter((value, index, array) => value.length > 0 && array.indexOf(value) === index),
    linkedStoryboardProjectId: normalizeString(data.linkedStoryboardProjectId).trim() || null,
    storyboardTransferStatus: normalizeSmartDirectorStoryboardTransferStatus(data.storyboardTransferStatus),
    storyboardTransferSnapshot: normalizeDirectorStoryboardTransferSnapshot(data.storyboardTransferSnapshot),
    displayName: normalizeString(data.displayName).trim() || data.displayName,
    description: normalizeString(data.description).trim() || undefined,
    semanticColor: data.semanticColor ?? null,
  };
}

export function normalizeScriptPlotLineNodeData(
  data: ScriptPlotLineNodeData
): ScriptPlotLineNodeData {
  const normalizePlotLineEntry = (item: unknown): ExtractedScriptPlotLine | null => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return null;
    }

    const row = item as Partial<ExtractedScriptPlotLine>;
    const title = normalizeString(row.title).trim();
    if (!title) {
      return null;
    }

    return {
      title,
      summary: normalizeString(row.summary).trim(),
      statusTag: normalizeString(row.statusTag).trim(),
      relatedCharacterNames: normalizeStringArray(row.relatedCharacterNames),
      relatedSceneNames: normalizeStringArray(row.relatedSceneNames),
      relatedItemNames: normalizeStringArray(row.relatedItemNames),
    };
  };
  const normalizePanelRow = (item: unknown, index: number): ScriptAssetPanelRow | null => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return null;
    }

    const row = item as Partial<ScriptAssetPanelRow>;
    const rowId = normalizeString(row.id).trim();
    const title = normalizeString(row.title).trim();
    const body = normalizeString(row.body).trim();
    const prompt = normalizeString(row.prompt).trim();
    if (!rowId && !title && !body && !prompt) {
      return null;
    }

    return {
      id: rowId || `panel-row-${index + 1}`,
      title: title || (rowId ? '' : `条目 ${index + 1}`),
      subtitle: normalizeString(row.subtitle).trim(),
      body,
      meta: normalizeStringArray(row.meta),
      prompt,
    };
  };
  const panelKind = (
    data.panelKind === 'characters'
    || data.panelKind === 'scenes'
    || data.panelKind === 'items'
    || data.panelKind === 'emotions'
    || data.panelKind === 'blueprints'
  )
    ? data.panelKind
    : 'plotLines';

  return {
    ...data,
    panelKind,
    title: normalizeString(data.title),
    summary: normalizeString(data.summary),
    statusTag: normalizeString(data.statusTag),
    relatedCharacterNames: normalizeStringArray(data.relatedCharacterNames),
    relatedSceneNames: normalizeStringArray(data.relatedSceneNames),
    entries: (Array.isArray(data.entries) ? data.entries : [])
      .map((item) => normalizePlotLineEntry(item))
      .filter((item): item is ExtractedScriptPlotLine => item !== null),
    assetPanelRows: (Array.isArray(data.assetPanelRows) ? data.assetPanelRows : [])
      .map((item, index) => normalizePanelRow(item, index))
      .filter((item): item is ScriptAssetPanelRow => item !== null),
  };
}

export function normalizeDirectorStoryboardReferenceNodeData(
  data: DirectorStoryboardReferenceNodeData
): DirectorStoryboardReferenceNodeData {
  return {
    ...data,
    linkedScriptProjectId: normalizeString(data.linkedScriptProjectId).trim() || null,
    directorStoryboardSourceProjectId:
      normalizeString(data.directorStoryboardSourceProjectId).trim() || null,
    directorStoryboardSourceNodeId:
      normalizeString(data.directorStoryboardSourceNodeId).trim() || null,
    directorStoryboardSourceVersion: Number.isFinite(data.directorStoryboardSourceVersion)
      ? Math.max(1, Math.floor(Number(data.directorStoryboardSourceVersion)))
      : null,
    directorStoryboardSnapshot: normalizeDirectorStoryboardPackage(data.directorStoryboardSnapshot),
    directorStoryboardOverrides: normalizeDirectorStoryboardOverrides(data.directorStoryboardOverrides),
    referenceContext: normalizeReferenceContextSnapshot(data.referenceContext),
    productionQueue: normalizeProductionQueueState(data.productionQueue),
    syncStatus: normalizeDirectorStoryboardReferenceSyncStatus(data.syncStatus),
    syncMessage: normalizeString(data.syncMessage).trim() || null,
    lastSyncedAt: Number.isFinite(data.lastSyncedAt) ? Number(data.lastSyncedAt) : null,
  };
}

export function normalizeScriptReferenceNodeData(
  data: ScriptReferenceNodeData
): ScriptReferenceNodeData {
  return {
    ...data,
    linkedScriptProjectId: normalizeString(data.linkedScriptProjectId).trim() || null,
    referencedChapterId: normalizeString(data.referencedChapterId).trim() || null,
    referencedSceneNodeId: normalizeString(data.referencedSceneNodeId).trim() || null,
    referencedEpisodeId: normalizeString(data.referencedEpisodeId).trim() || null,
    referencedScriptNodeId: normalizeString(data.referencedScriptNodeId).trim() || null,
    selectedRowIds: normalizeStringArray(data.selectedRowIds ?? data.selectedShotRowIds),
    selectedShotRowIds: undefined,
    scriptSnapshot: normalizeScriptReferenceScriptSnapshot(data.scriptSnapshot ?? data.episodeSnapshot),
    episodeSnapshot: undefined,
    syncStatus:
      data.syncStatus === 'ready'
      || data.syncStatus === 'missingScript'
      || data.syncStatus === 'missingProject'
      || data.syncStatus === 'missingEpisode'
      || data.syncStatus === 'missingRows'
      || data.syncStatus === 'stale'
        ? data.syncStatus
        : 'idle',
    syncMessage: normalizeString(data.syncMessage).trim() || null,
    lastSyncedAt: Number.isFinite(data.lastSyncedAt) ? Number(data.lastSyncedAt) : null,
  };
}

export function normalizeAdScriptReferenceNodeData(
  data: AdScriptReferenceNodeData
): AdScriptReferenceNodeData {
  return {
    ...data,
    linkedAdProjectId: normalizeString(data.linkedAdProjectId).trim() || null,
    selectedRowIds: normalizeStringArray(data.selectedRowIds),
    scriptSnapshot: normalizeAdScriptReferenceSnapshot(data.scriptSnapshot),
    syncStatus:
      data.syncStatus === 'ready'
      || data.syncStatus === 'missingProject'
      || data.syncStatus === 'missingRows'
      || data.syncStatus === 'stale'
        ? data.syncStatus
        : 'idle',
    syncMessage: normalizeString(data.syncMessage).trim() || null,
    lastSyncedAt: Number.isFinite(data.lastSyncedAt) ? Number(data.lastSyncedAt) : null,
  };
}

export function normalizeScriptCharacterReferenceNodeData(
  data: ScriptCharacterReferenceNodeData
): ScriptCharacterReferenceNodeData {
  return {
    ...data,
    linkedScriptProjectId: normalizeString(data.linkedScriptProjectId).trim() || null,
    referencedAssetName: normalizeString(data.referencedAssetName).trim() || null,
    assetSnapshot: normalizeScriptCharacterReferenceSnapshot(data.assetSnapshot),
    syncStatus:
      data.syncStatus === 'ready'
      || data.syncStatus === 'missingProject'
      || data.syncStatus === 'missingAsset'
      || data.syncStatus === 'stale'
        ? data.syncStatus
        : 'idle',
    syncMessage: normalizeString(data.syncMessage).trim() || null,
    lastSyncedAt: Number.isFinite(data.lastSyncedAt) ? Number(data.lastSyncedAt) : null,
  };
}

export function normalizeScriptLocationReferenceNodeData(
  data: ScriptLocationReferenceNodeData
): ScriptLocationReferenceNodeData {
  return {
    ...data,
    linkedScriptProjectId: normalizeString(data.linkedScriptProjectId).trim() || null,
    referencedAssetName: normalizeString(data.referencedAssetName).trim() || null,
    assetSnapshot: normalizeScriptLocationReferenceSnapshot(data.assetSnapshot),
    syncStatus:
      data.syncStatus === 'ready'
      || data.syncStatus === 'missingProject'
      || data.syncStatus === 'missingAsset'
      || data.syncStatus === 'stale'
        ? data.syncStatus
        : 'idle',
    syncMessage: normalizeString(data.syncMessage).trim() || null,
    lastSyncedAt: Number.isFinite(data.lastSyncedAt) ? Number(data.lastSyncedAt) : null,
  };
}

export function normalizeScriptItemReferenceNodeData(
  data: ScriptItemReferenceNodeData
): ScriptItemReferenceNodeData {
  return {
    ...data,
    linkedScriptProjectId: normalizeString(data.linkedScriptProjectId).trim() || null,
    referencedAssetName: normalizeString(data.referencedAssetName).trim() || null,
    assetSnapshot: normalizeScriptItemReferenceSnapshot(data.assetSnapshot),
    syncStatus:
      data.syncStatus === 'ready'
      || data.syncStatus === 'missingProject'
      || data.syncStatus === 'missingAsset'
      || data.syncStatus === 'stale'
        ? data.syncStatus
        : 'idle',
    syncMessage: normalizeString(data.syncMessage).trim() || null,
    lastSyncedAt: Number.isFinite(data.lastSyncedAt) ? Number(data.lastSyncedAt) : null,
  };
}

export function isUploadNode(
  node: CanvasNode | null | undefined
): node is Node<UploadImageNodeData, typeof CANVAS_NODE_TYPES.upload> {
  return node?.type === CANVAS_NODE_TYPES.upload;
}

export function isImageEditNode(
  node: CanvasNode | null | undefined
): node is Node<ImageEditNodeData, typeof CANVAS_NODE_TYPES.imageEdit> {
  return node?.type === CANVAS_NODE_TYPES.imageEdit;
}

export function isMultiAngleImageNode(
  node: CanvasNode | null | undefined
): node is Node<MultiAngleImageNodeData, typeof CANVAS_NODE_TYPES.multiAngleImage> {
  return node?.type === CANVAS_NODE_TYPES.multiAngleImage;
}

export function isPanorama360Node(
  node: CanvasNode | null | undefined
): node is Node<Panorama360NodeData, typeof CANVAS_NODE_TYPES.panorama360> {
  return node?.type === CANVAS_NODE_TYPES.panorama360;
}

export function isDirectorStageNode(
  node: CanvasNode | null | undefined
): node is Node<DirectorStageNodeData, typeof CANVAS_NODE_TYPES.directorStage> {
  return node?.type === CANVAS_NODE_TYPES.directorStage;
}

export function isBackgroundRemoveNode(
  node: CanvasNode | null | undefined
): node is Node<BackgroundRemoveNodeData, typeof CANVAS_NODE_TYPES.backgroundRemove> {
  return node?.type === CANVAS_NODE_TYPES.backgroundRemove;
}

export function isSeedvr2ImageUpscaleNode(
  node: CanvasNode | null | undefined
): node is Node<Seedvr2ImageUpscaleNodeData, typeof CANVAS_NODE_TYPES.seedvr2ImageUpscale> {
  return node?.type === CANVAS_NODE_TYPES.seedvr2ImageUpscale;
}

export function isSeedvr2VideoUpscaleNode(
  node: CanvasNode | null | undefined
): node is Node<Seedvr2VideoUpscaleNodeData, typeof CANVAS_NODE_TYPES.seedvr2VideoUpscale> {
  return node?.type === CANVAS_NODE_TYPES.seedvr2VideoUpscale;
}

export function isImageCollageNode(
  node: CanvasNode | null | undefined
): node is Node<ImageCollageNodeData, typeof CANVAS_NODE_TYPES.imageCollage> {
  return node?.type === CANVAS_NODE_TYPES.imageCollage;
}

export function isJimengNode(
  node: CanvasNode | null | undefined
): node is Node<JimengNodeData, typeof CANVAS_NODE_TYPES.jimeng> {
  return node?.type === CANVAS_NODE_TYPES.jimeng;
}

export function isJimengImageNode(
  node: CanvasNode | null | undefined
): node is Node<JimengImageNodeData, typeof CANVAS_NODE_TYPES.jimengImage> {
  return node?.type === CANVAS_NODE_TYPES.jimengImage;
}

export function isMjNode(
  node: CanvasNode | null | undefined
): node is Node<MjNodeData, typeof CANVAS_NODE_TYPES.mj> {
  return node?.type === CANVAS_NODE_TYPES.mj;
}

export function isMjResultNode(
  node: CanvasNode | null | undefined
): node is Node<MjResultNodeData, typeof CANVAS_NODE_TYPES.mjResult> {
  return node?.type === CANVAS_NODE_TYPES.mjResult;
}

export function isJimengImageResultNode(
  node: CanvasNode | null | undefined
): node is Node<JimengImageResultNodeData, typeof CANVAS_NODE_TYPES.jimengImageResult> {
  return node?.type === CANVAS_NODE_TYPES.jimengImageResult;
}

export function isJimengVideoResultNode(
  node: CanvasNode | null | undefined
): node is Node<JimengVideoResultNodeData, typeof CANVAS_NODE_TYPES.jimengVideoResult> {
  return node?.type === CANVAS_NODE_TYPES.jimengVideoResult;
}

export function isSeedanceNode(
  node: CanvasNode | null | undefined
): node is Node<SeedanceNodeData, typeof CANVAS_NODE_TYPES.seedance> {
  return node?.type === CANVAS_NODE_TYPES.seedance;
}

export function isSeedanceVideoResultNode(
  node: CanvasNode | null | undefined
): node is Node<SeedanceVideoResultNodeData, typeof CANVAS_NODE_TYPES.seedanceVideoResult> {
  return node?.type === CANVAS_NODE_TYPES.seedanceVideoResult;
}

export function isGptBestSeedanceNode(
  node: CanvasNode | null | undefined
): node is Node<GptBestVideoNodeData, typeof CANVAS_NODE_TYPES.gptBestSeedance> {
  return node?.type === CANVAS_NODE_TYPES.gptBestSeedance;
}

export function isGptBestGrokVideoNode(
  node: CanvasNode | null | undefined
): node is Node<GptBestVideoNodeData, typeof CANVAS_NODE_TYPES.gptBestGrokVideo> {
  return node?.type === CANVAS_NODE_TYPES.gptBestGrokVideo;
}

export function isGptBestVideoResultNode(
  node: CanvasNode | null | undefined
): node is Node<GptBestVideoResultNodeData, typeof CANVAS_NODE_TYPES.gptBestVideoResult> {
  return node?.type === CANVAS_NODE_TYPES.gptBestVideoResult;
}

export function isViduNode(
  node: CanvasNode | null | undefined
): node is Node<ViduNodeData, typeof CANVAS_NODE_TYPES.vidu> {
  return node?.type === CANVAS_NODE_TYPES.vidu;
}

export function isViduVideoResultNode(
  node: CanvasNode | null | undefined
): node is Node<ViduVideoResultNodeData, typeof CANVAS_NODE_TYPES.viduVideoResult> {
  return node?.type === CANVAS_NODE_TYPES.viduVideoResult;
}

export function isExportImageNode(
  node: CanvasNode | null | undefined
): node is Node<ExportImageNodeData, typeof CANVAS_NODE_TYPES.exportImage> {
  return node?.type === CANVAS_NODE_TYPES.exportImage;
}

export function isImageCompareNode(
  node: CanvasNode | null | undefined
): node is Node<ImageCompareNodeData, typeof CANVAS_NODE_TYPES.imageCompare> {
  return node?.type === CANVAS_NODE_TYPES.imageCompare;
}

export function isImageCompareSourceNodeType(
  type: CanvasNodeType | null | undefined
): type is ImageCompareSourceNodeType {
  return type === CANVAS_NODE_TYPES.upload || type === CANVAS_NODE_TYPES.exportImage;
}

export function isImageCompareSourceNode(
  node: CanvasNode | null | undefined
): node is Node<UploadImageNodeData | ExportImageNodeData, ImageCompareSourceNodeType> {
  return isUploadNode(node) || isExportImageNode(node);
}

export function isGroupNode(
  node: CanvasNode | null | undefined
): node is Node<GroupNodeData, typeof CANVAS_NODE_TYPES.group> {
  return node?.type === CANVAS_NODE_TYPES.group;
}

export function isTextAnnotationNode(
  node: CanvasNode | null | undefined
): node is Node<TextAnnotationNodeData, typeof CANVAS_NODE_TYPES.textAnnotation> {
  return node?.type === CANVAS_NODE_TYPES.textAnnotation;
}

export function isLlmLogicNode(
  node: CanvasNode | null | undefined
): node is Node<LlmLogicNodeData, typeof CANVAS_NODE_TYPES.llmLogic> {
  return node?.type === CANVAS_NODE_TYPES.llmLogic;
}

export function isVideoNode(
  node: CanvasNode | null | undefined
): node is Node<VideoNodeData, typeof CANVAS_NODE_TYPES.video> {
  return node?.type === CANVAS_NODE_TYPES.video;
}

export function isAudioNode(
  node: CanvasNode | null | undefined
): node is Node<AudioNodeData, typeof CANVAS_NODE_TYPES.audio> {
  return node?.type === CANVAS_NODE_TYPES.audio;
}

export function nodeSupportsDescriptionPanel(
  node: CanvasNode | null | undefined
): boolean {
  return (
    isUploadNode(node)
    || isPanorama360Node(node)
    || isExportImageNode(node)
    || isMjResultNode(node)
    || isJimengImageResultNode(node)
    || isVideoNode(node)
    || isJimengVideoResultNode(node)
    || isSeedanceVideoResultNode(node)
    || isGptBestVideoResultNode(node)
    || isViduVideoResultNode(node)
    || isAudioNode(node)
  );
}

export function isTtsTextNode(
  node: CanvasNode | null | undefined
): node is Node<TtsTextNodeData, typeof CANVAS_NODE_TYPES.ttsText> {
  return node?.type === CANVAS_NODE_TYPES.ttsText;
}

export function isTtsVoiceDesignNode(
  node: CanvasNode | null | undefined
): node is Node<TtsVoiceDesignNodeData, typeof CANVAS_NODE_TYPES.ttsVoiceDesign> {
  return node?.type === CANVAS_NODE_TYPES.ttsVoiceDesign;
}

export function isTtsSavedVoiceNode(
  node: CanvasNode | null | undefined
): node is Node<TtsSavedVoiceNodeData, typeof CANVAS_NODE_TYPES.ttsSavedVoice> {
  return node?.type === CANVAS_NODE_TYPES.ttsSavedVoice;
}

export function isVoxCpmVoiceDesignNode(
  node: CanvasNode | null | undefined
): node is Node<VoxCpmVoiceDesignNodeData, typeof CANVAS_NODE_TYPES.voxCpmVoiceDesign> {
  return node?.type === CANVAS_NODE_TYPES.voxCpmVoiceDesign;
}

export function isVoxCpmVoiceCloneNode(
  node: CanvasNode | null | undefined
): node is Node<VoxCpmVoiceCloneNodeData, typeof CANVAS_NODE_TYPES.voxCpmVoiceClone> {
  return node?.type === CANVAS_NODE_TYPES.voxCpmVoiceClone;
}

export function isVoxCpmUltimateCloneNode(
  node: CanvasNode | null | undefined
): node is Node<VoxCpmUltimateCloneNodeData, typeof CANVAS_NODE_TYPES.voxCpmUltimateClone> {
  return node?.type === CANVAS_NODE_TYPES.voxCpmUltimateClone;
}

export function isStoryboardSplitNode(
  node: CanvasNode | null | undefined
): node is Node<StoryboardSplitNodeData, typeof CANVAS_NODE_TYPES.storyboardSplit> {
  return node?.type === CANVAS_NODE_TYPES.storyboardSplit;
}

export function isStoryboardSplitResultNode(
  node: CanvasNode | null | undefined
): node is Node<StoryboardSplitResultNodeData, typeof CANVAS_NODE_TYPES.storyboardSplitResult> {
  return node?.type === CANVAS_NODE_TYPES.storyboardSplitResult;
}

export function isStoryboardGenNode(
  node: CanvasNode | null | undefined
): node is Node<StoryboardGenNodeData, typeof CANVAS_NODE_TYPES.storyboardGen> {
  return node?.type === CANVAS_NODE_TYPES.storyboardGen;
}

export function isAssetMaterialNode(
  node: CanvasNode | null | undefined
): node is Node<AssetMaterialNodeData, typeof CANVAS_NODE_TYPES.assetMaterial> {
  return node?.type === CANVAS_NODE_TYPES.assetMaterial;
}

export function isScriptRootNode(
  node: CanvasNode | null | undefined
): node is Node<ScriptRootNodeData, typeof CANVAS_NODE_TYPES.scriptRoot> {
  return node?.type === CANVAS_NODE_TYPES.scriptRoot;
}

export function isScriptChapterNode(
  node: CanvasNode | null | undefined
): node is Node<ScriptChapterNodeData, typeof CANVAS_NODE_TYPES.scriptChapter> {
  return node?.type === CANVAS_NODE_TYPES.scriptChapter;
}

export function isScriptSceneNode(
  node: CanvasNode | null | undefined
): node is Node<ScriptSceneNodeData, typeof CANVAS_NODE_TYPES.scriptScene> {
  return node?.type === CANVAS_NODE_TYPES.scriptScene;
}

export function isShootingScriptNode(
  node: CanvasNode | null | undefined
): node is Node<ShootingScriptNodeData, typeof CANVAS_NODE_TYPES.shootingScript> {
  return node?.type === CANVAS_NODE_TYPES.shootingScript;
}

export function isScriptReferenceNode(
  node: CanvasNode | null | undefined
): node is Node<ScriptReferenceNodeData, typeof CANVAS_NODE_TYPES.scriptReference> {
  return node?.type === CANVAS_NODE_TYPES.scriptReference;
}

export function isScriptCharacterReferenceNode(
  node: CanvasNode | null | undefined
): node is Node<ScriptCharacterReferenceNodeData, typeof CANVAS_NODE_TYPES.scriptCharacterReference> {
  return node?.type === CANVAS_NODE_TYPES.scriptCharacterReference;
}

export function isScriptLocationReferenceNode(
  node: CanvasNode | null | undefined
): node is Node<ScriptLocationReferenceNodeData, typeof CANVAS_NODE_TYPES.scriptLocationReference> {
  return node?.type === CANVAS_NODE_TYPES.scriptLocationReference;
}

export function isScriptItemReferenceNode(
  node: CanvasNode | null | undefined
): node is Node<ScriptItemReferenceNodeData, typeof CANVAS_NODE_TYPES.scriptItemReference> {
  return node?.type === CANVAS_NODE_TYPES.scriptItemReference;
}

export function isScriptCharacterNode(
  node: CanvasNode | null | undefined
): node is Node<ScriptCharacterNodeData, typeof CANVAS_NODE_TYPES.scriptCharacter> {
  return node?.type === CANVAS_NODE_TYPES.scriptCharacter;
}

export function isScriptLocationNode(
  node: CanvasNode | null | undefined
): node is Node<ScriptLocationNodeData, typeof CANVAS_NODE_TYPES.scriptLocation> {
  return node?.type === CANVAS_NODE_TYPES.scriptLocation;
}

export function isScriptItemNode(
  node: CanvasNode | null | undefined
): node is Node<ScriptItemNodeData, typeof CANVAS_NODE_TYPES.scriptItem> {
  return node?.type === CANVAS_NODE_TYPES.scriptItem;
}

export function isScriptStoryNoteNode(
  node: CanvasNode | null | undefined
): node is Node<ScriptStoryNoteNodeData, typeof CANVAS_NODE_TYPES.scriptStoryNote> {
  return node?.type === CANVAS_NODE_TYPES.scriptStoryNote;
}

export function isScriptPlotPointNode(
  node: CanvasNode | null | undefined
): node is Node<ScriptPlotPointNodeData, typeof CANVAS_NODE_TYPES.scriptPlotPoint> {
  return node?.type === CANVAS_NODE_TYPES.scriptPlotPoint;
}

export function isScriptWorldviewNode(
  node: CanvasNode | null | undefined
): node is Node<ScriptWorldviewNodeData, typeof CANVAS_NODE_TYPES.scriptWorldview> {
  return node?.type === CANVAS_NODE_TYPES.scriptWorldview;
}

export interface SingleImageConnectionSource {
  imageUrl: string;
  previewImageUrl: string;
  thumbnailUrl: string | null;
  aspectRatio: string;
}

export interface SingleVideoConnectionSource {
  videoUrl: string;
  previewImageUrl: string | null;
  aspectRatio: string;
  duration: number | null;
  videoFileName: string | null;
}

function normalizeImageSource(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function resolveJimengResultImageSource(
  item: JimengGeneratedImageItem | undefined
): string | null {
  if (!item) {
    return null;
  }

  return normalizeImageSource(
    item.imageUrl ?? item.previewImageUrl ?? item.sourceUrl ?? null
  );
}

function resolveMjBatchImageSource(
  item: MjBatchImageItem | undefined
): string | null {
  if (!item) {
    return null;
  }

  return normalizeImageSource(
    item.imageUrl ?? item.previewImageUrl ?? item.sourceUrl ?? null
  );
}

export function getMjResultNodeActiveBatch(
  data: MjResultNodeData | null | undefined
): MjResultBatch | null {
  if (!data) {
    return null;
  }

  const activeBatchId = normalizeString(data.activeBatchId).trim();
  if (activeBatchId) {
    const matchedBatch = data.batches.find((batch) => batch.id === activeBatchId) ?? null;
    if (matchedBatch) {
      return matchedBatch;
    }
  }

  return data.batches[0] ?? null;
}

export function getMjResultNodeActiveImages(
  data: MjResultNodeData | null | undefined
): MjBatchImageItem[] {
  return getMjResultNodeActiveBatch(data)?.images ?? [];
}

export function resolveSingleImageConnectionSource(
  node: CanvasNode | null | undefined
): SingleImageConnectionSource | null {
  if (!node) {
    return null;
  }

  if (
    isUploadNode(node)
    || isImageEditNode(node)
    || isPanorama360Node(node)
    || isExportImageNode(node)
  ) {
    const imageUrl =
      normalizeImageSource(node.data.imageUrl)
      ?? normalizeImageSource(node.data.previewImageUrl);
    if (!imageUrl) {
      return null;
    }

    return {
      imageUrl,
      previewImageUrl: normalizeImageSource(node.data.previewImageUrl) ?? imageUrl,
      thumbnailUrl: normalizeImageSource(node.data.thumbnailUrl),
      aspectRatio: normalizeImageSource(node.data.aspectRatio) ?? DEFAULT_ASPECT_RATIO,
    };
  }

  if (isDirectorStageNode(node)) {
    const imageUrl =
      normalizeImageSource(node.data.lastSnapshotUrl)
      ?? normalizeImageSource(node.data.lastSnapshotPreviewUrl);
    if (!imageUrl) {
      return null;
    }

    return {
      imageUrl,
      previewImageUrl: normalizeImageSource(node.data.lastSnapshotPreviewUrl) ?? imageUrl,
      thumbnailUrl: null,
      aspectRatio: '16:9',
    };
  }

  if (isJimengImageResultNode(node)) {
    const resolvedImages = (node.data.resultImages ?? [])
      .map((item) => {
        const imageUrl = resolveJimengResultImageSource(item);
        if (!imageUrl) {
          return null;
        }

        return {
          imageUrl,
          previewImageUrl:
            normalizeImageSource(item.previewImageUrl)
            ?? normalizeImageSource(item.imageUrl)
            ?? normalizeImageSource(item.sourceUrl)
            ?? imageUrl,
          thumbnailUrl: normalizeImageSource(item.thumbnailUrl),
          aspectRatio:
            normalizeImageSource(item.aspectRatio)
            ?? normalizeImageSource(node.data.aspectRatio)
            ?? DEFAULT_ASPECT_RATIO,
        } satisfies SingleImageConnectionSource;
      })
      .filter((item): item is SingleImageConnectionSource => Boolean(item));

    return resolvedImages.length === 1 ? resolvedImages[0] : null;
  }

  return null;
}

function normalizeVideoSource(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeDuration(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

export function resolveSingleVideoConnectionSource(
  node: CanvasNode | null | undefined
): SingleVideoConnectionSource | null {
  if (!node) {
    return null;
  }

  if (
    isVideoNode(node)
    || isJimengVideoResultNode(node)
    || isSeedanceVideoResultNode(node)
    || isGptBestVideoResultNode(node)
    || isViduVideoResultNode(node)
  ) {
    const videoUrl = normalizeVideoSource(node.data.videoUrl);
    if (!videoUrl) {
      return null;
    }

    return {
      videoUrl,
      previewImageUrl: normalizeVideoSource(node.data.previewImageUrl),
      aspectRatio: normalizeImageSource(node.data.aspectRatio) ?? '16:9',
      duration: normalizeDuration(node.data.duration),
      videoFileName: normalizeVideoSource(node.data.videoFileName),
    };
  }

  return null;
}

export function getNodePrimaryImageSource(
  node: CanvasNode | null | undefined
): string | null {
  const resolveJimengResultSource = (item: JimengGeneratedImageItem | undefined): string | null => {
    if (!item) {
      return null;
    }

    const source = item.imageUrl ?? item.previewImageUrl ?? item.sourceUrl ?? null;
    return typeof source === 'string' && source.trim().length > 0 ? source : null;
  };

  if (!node) {
    return null;
  }

  const singleImageSource = resolveSingleImageConnectionSource(node);
  if (singleImageSource) {
    return singleImageSource.imageUrl;
  }

  if (
    isStoryboardGenNode(node)
  ) {
    const imageUrl = node.data.imageUrl;
    return typeof imageUrl === 'string' && imageUrl.trim().length > 0 ? imageUrl : null;
  }

  if (isJimengImageNode(node)) {
    const primaryResult = node.data.resultImages?.find((item) => Boolean(resolveJimengResultSource(item)));
    return resolveJimengResultSource(primaryResult);
  }

  if (isMjResultNode(node)) {
    const primaryResult = getMjResultNodeActiveImages(node.data)
      .find((item) => Boolean(resolveMjBatchImageSource(item)));
    return resolveMjBatchImageSource(primaryResult);
  }

  return null;
}

export interface NodePrimaryDownloadSource {
  source: string;
  mediaType: 'image' | 'video' | 'audio';
  fileName?: string | null;
}

export function getNodePrimaryDownloadSource(
  node: CanvasNode | null | undefined
): NodePrimaryDownloadSource | null {
  const imageSource = getNodePrimaryImageSource(node);
  if (imageSource) {
    const fileName =
      node && 'sourceFileName' in node.data && typeof node.data.sourceFileName === 'string'
        ? node.data.sourceFileName
        : null;

    return {
      source: imageSource,
      mediaType: 'image',
      fileName,
    };
  }

  const videoSource = resolveSingleVideoConnectionSource(node);
  if (videoSource) {
    if (!videoSource.videoUrl) {
      return null;
    }

    return {
      source: videoSource.videoUrl,
      mediaType: 'video',
      fileName: videoSource.videoFileName,
    };
  }

  if (isAudioNode(node)) {
    const source = typeof node.data.audioUrl === 'string' ? node.data.audioUrl.trim() : '';
    if (!source) {
      return null;
    }

    return {
      source,
      mediaType: 'audio',
      fileName: typeof node.data.audioFileName === 'string' ? node.data.audioFileName : null,
    };
  }

  return null;
}

export function nodeHasImage(node: CanvasNode | null | undefined): boolean {
  if (getNodePrimaryImageSource(node)) {
    return true;
  }

  if (isStoryboardSplitNode(node)) {
    return node.data.frames.some((frame) => Boolean(frame.imageUrl));
  }

  if (
    isVideoNode(node) ||
    isAudioNode(node) ||
    isScriptRootNode(node) ||
    isScriptChapterNode(node) ||
    isScriptSceneNode(node) ||
    isScriptCharacterNode(node) ||
    isScriptLocationNode(node) ||
    isScriptItemNode(node) ||
    isScriptStoryNoteNode(node) ||
    isScriptPlotPointNode(node) ||
    isScriptWorldviewNode(node)
  ) {
    return false;
  }

  return false;
}
