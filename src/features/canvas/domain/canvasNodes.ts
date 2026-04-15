import type { Edge, Node, XYPosition } from '@xyflow/react';
import type { CanvasSemanticColor } from './semanticColors';

export const CANVAS_NODE_TYPES = {
  upload: 'uploadNode',
  imageEdit: 'imageNode',
  panorama360: 'panorama360Node',
  jimeng: 'jimengNode',
  jimengImage: 'jimengImageNode',
  jimengImageResult: 'jimengImageResultNode',
  jimengVideoResult: 'jimengVideoResultNode',
  seedance: 'seedanceNode',
  seedanceVideoResult: 'seedanceVideoResultNode',
  exportImage: 'exportImageNode',
  textAnnotation: 'textAnnotationNode',
  group: 'groupNode',
  storyboardSplit: 'storyboardNode',
  storyboardSplitResult: 'storyboardSplitResultNode',
  storyboardGen: 'storyboardGenNode',
  video: 'videoNode',
  audio: 'audioNode',
  ttsText: 'ttsTextNode',
  scriptText: 'scriptTextNode',
  ttsVoiceDesign: 'ttsVoiceDesignNode',
  ttsSavedVoice: 'ttsSavedVoiceNode',
  voxCpmVoiceDesign: 'voxCpmVoiceDesignNode',
  voxCpmVoiceClone: 'voxCpmVoiceCloneNode',
  voxCpmUltimateClone: 'voxCpmUltimateCloneNode',
  scriptRoot: 'scriptRootNode',
  scriptChapter: 'scriptChapterNode',
  scriptScene: 'scriptSceneNode',
  shootingScript: 'shootingScriptNode',
  scriptReference: 'scriptReferenceNode',
  scriptCharacter: 'scriptCharacterNode',
  scriptLocation: 'scriptLocationNode',
  scriptItem: 'scriptItemNode',
  scriptPlotPoint: 'scriptPlotPointNode',
  scriptWorldview: 'scriptWorldviewNode',
} as const;

export type CanvasNodeType = (typeof CANVAS_NODE_TYPES)[keyof typeof CANVAS_NODE_TYPES];

export const DEFAULT_ASPECT_RATIO = '1:1';
export const AUTO_REQUEST_ASPECT_RATIO = 'auto';
export const DEFAULT_NODE_WIDTH = 220;
export const IMAGE_EDIT_NODE_DEFAULT_WIDTH = 500;
export const IMAGE_EDIT_NODE_DEFAULT_HEIGHT = 280;
export const PANORAMA360_NODE_DEFAULT_WIDTH = 520;
export const PANORAMA360_NODE_DEFAULT_HEIGHT = 380;
export const PANORAMA360_NODE_MIN_WIDTH = 420;
export const PANORAMA360_NODE_MIN_HEIGHT = 300;
export const EXPORT_RESULT_NODE_DEFAULT_WIDTH = 384;
export const EXPORT_RESULT_NODE_LAYOUT_HEIGHT = 288;
export const EXPORT_RESULT_NODE_MIN_WIDTH = 168;
export const EXPORT_RESULT_NODE_MIN_HEIGHT = 168;
export const JIMENG_IMAGE_RESULT_NODE_DEFAULT_WIDTH = 640;
export const JIMENG_IMAGE_RESULT_NODE_DEFAULT_HEIGHT = 520;
export const JIMENG_IMAGE_RESULT_NODE_MIN_WIDTH = 560;
export const JIMENG_IMAGE_RESULT_NODE_MIN_HEIGHT = 420;
export const JIMENG_VIDEO_RESULT_NODE_DEFAULT_WIDTH = 520;
export const JIMENG_VIDEO_RESULT_NODE_DEFAULT_HEIGHT = 388;
export const JIMENG_VIDEO_RESULT_NODE_MIN_WIDTH = 360;
export const JIMENG_VIDEO_RESULT_NODE_MIN_HEIGHT = 280;
export const SEEDANCE_NODE_DEFAULT_WIDTH = 920;
export const SEEDANCE_NODE_DEFAULT_HEIGHT = 560;
export const SEEDANCE_NODE_MIN_WIDTH = 760;
export const SEEDANCE_NODE_MIN_HEIGHT = 440;
export const SEEDANCE_VIDEO_RESULT_NODE_DEFAULT_WIDTH = 520;
export const SEEDANCE_VIDEO_RESULT_NODE_DEFAULT_HEIGHT = 388;
export const SEEDANCE_VIDEO_RESULT_NODE_MIN_WIDTH = 360;
export const SEEDANCE_VIDEO_RESULT_NODE_MIN_HEIGHT = 280;
export const AUDIO_NODE_DEFAULT_WIDTH = 320;
export const AUDIO_NODE_DEFAULT_HEIGHT = 96;
export const TTS_TEXT_NODE_DEFAULT_WIDTH = 500;
export const TTS_TEXT_NODE_DEFAULT_HEIGHT = 300;
export const SCRIPT_TEXT_NODE_DEFAULT_WIDTH = 480;
export const SCRIPT_TEXT_NODE_DEFAULT_HEIGHT = 320;
export const SCRIPT_CHAPTER_NODE_DEFAULT_WIDTH = 420;
export const SCRIPT_CHAPTER_NODE_DEFAULT_HEIGHT = 380;
export const SCRIPT_SCENE_NODE_DEFAULT_WIDTH = 460;
export const SCRIPT_SCENE_NODE_DEFAULT_HEIGHT = 420;
export const SHOOTING_SCRIPT_NODE_DEFAULT_WIDTH = 1680;
export const SHOOTING_SCRIPT_NODE_DEFAULT_HEIGHT = 760;
export const SCRIPT_REFERENCE_NODE_DEFAULT_WIDTH = 620;
export const SCRIPT_REFERENCE_NODE_DEFAULT_HEIGHT = 620;
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

export type ImageSize = (typeof IMAGE_SIZES)[number];
export type JimengImageModelVersion = (typeof JIMENG_IMAGE_MODEL_VERSIONS)[number];
export type JimengImageResolutionType = (typeof JIMENG_IMAGE_RESOLUTION_TYPES)[number];
export type JimengVideoModelId = (typeof JIMENG_VIDEO_MODEL_IDS)[number];
export type JimengReferenceMode = (typeof JIMENG_REFERENCE_MODES)[number];
export type JimengAspectRatio = (typeof JIMENG_ASPECT_RATIOS)[number];
export type JimengDurationSeconds = (typeof JIMENG_DURATION_SECONDS)[number];
export type JimengVideoResolution = (typeof JIMENG_VIDEO_RESOLUTIONS)[number];
export type SeedanceModelId = (typeof SEEDANCE_MODEL_IDS)[number];
export type SeedanceInputMode = (typeof SEEDANCE_INPUT_MODES)[number];
export type SeedanceAspectRatio = (typeof SEEDANCE_ASPECT_RATIOS)[number];
export type SeedanceDurationSeconds = (typeof SEEDANCE_DURATION_SECONDS)[number];
export type SeedanceResolution = (typeof SEEDANCE_RESOLUTIONS)[number];

export interface NodeDisplayData {
  displayName?: string;
  nodeDescription?: string | null;
  semanticColor?: CanvasSemanticColor | null;
  [key: string]: unknown;
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

export interface UploadImageNodeData extends NodeImageData {
  sourceFileName?: string | null;
}

export type ExportImageNodeResultKind =
  | 'generic'
  | 'storyboardGenOutput'
  | 'storyboardSplitExport'
  | 'storyboardFrameEdit';

export interface ExportImageNodeData extends NodeImageData {
  resultKind?: ExportImageNodeResultKind;
}

export interface GroupNodeData extends NodeDisplayData {
  label: string;
  layoutDirection?: 'horizontal' | 'vertical';
  maxItemsPerLine?: number;
  [key: string]: unknown;
}

export interface TextAnnotationNodeData extends NodeDisplayData {
  content: string;
  [key: string]: unknown;
}

export interface VideoNodeData extends NodeDisplayData {
  videoUrl: string | null;
  previewImageUrl?: string | null;
  videoFileName?: string | null;
  aspectRatio: string;
  duration?: number;
  isSizeManuallyAdjusted?: boolean;
  [key: string]: unknown;
}

export interface AudioNodeData extends NodeDisplayData {
  audioUrl: string | null;
  previewImageUrl?: string | null;
  audioFileName?: string | null;
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

export interface ScriptTextNodeData extends NodeDisplayData {
  content: string;
  isGenerating?: boolean;
  lastError?: string | null;
  lastGeneratedAt?: number | null;
  lastGeneratedCount?: number;
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
  isGenerating?: boolean;
  generationProgress?: number;
  statusText?: string | null;
  lastError?: string | null;
  lastGeneratedAt?: number | null;
  [key: string]: unknown;
}

export interface ImageEditNodeData extends NodeImageData {
  prompt: string;
  model: string;
  size: ImageSize;
  requestAspectRatio?: string;
  extraParams?: Record<string, unknown>;
  isGenerating?: boolean;
  generationStartedAt?: number | null;
  generationDurationMs?: number;
}

export interface Panorama360NodeData extends NodeImageData {
  viewerYaw?: number;
  viewerPitch?: number;
  viewerFov?: number;
}

export interface JimengNodeData extends NodeDisplayData {
  prompt: string;
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
}

export interface JimengGeneratedImageItem {
  id: string;
  sourceUrl?: string | null;
  imageUrl: string | null;
  previewImageUrl?: string | null;
  aspectRatio: string;
  width?: number;
  height?: number;
  fileName?: string | null;
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
  modelVersion?: JimengImageModelVersion;
  aspectRatio?: JimengAspectRatio;
  resolutionType?: JimengImageResolutionType;
  isGenerating?: boolean;
  generationStartedAt?: number | null;
  generationDurationMs?: number;
  lastGeneratedAt?: number | null;
  lastError?: string | null;
  resultImages?: JimengGeneratedImageItem[];
}

export interface JimengImageResultNodeData extends NodeDisplayData {
  sourceNodeId?: string | null;
  submitIds?: string[];
  modelVersion?: JimengImageModelVersion;
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

export interface StoryboardFrameItem {
  id: string;
  imageUrl: string | null;
  previewImageUrl?: string | null;
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
  [key: string]: unknown;
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

export type CanvasNodeData =
  | UploadImageNodeData
  | ExportImageNodeData
  | Panorama360NodeData
  | TextAnnotationNodeData
  | GroupNodeData
  | ImageEditNodeData
  | JimengNodeData
  | JimengImageNodeData
  | JimengImageResultNodeData
  | JimengVideoResultNodeData
  | SeedanceNodeData
  | SeedanceVideoResultNodeData
  | StoryboardSplitNodeData
  | StoryboardSplitResultNodeData
  | StoryboardGenNodeData
  | VideoNodeData
  | AudioNodeData
  | TtsTextNodeData
  | ScriptTextNodeData
  | TtsVoiceDesignNodeData
  | TtsSavedVoiceNodeData
  | VoxCpmVoiceDesignNodeData
  | VoxCpmVoiceCloneNodeData
  | VoxCpmUltimateCloneNodeData
  | ScriptRootNodeData
  | ScriptChapterNodeData
  | ScriptSceneNodeData
  | ShootingScriptNodeData
  | ScriptReferenceNodeData
  | ScriptCharacterNodeData
  | ScriptLocationNodeData
  | ScriptItemNodeData
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
} as const;

export type NodeToolType = (typeof NODE_TOOL_TYPES)[keyof typeof NODE_TOOL_TYPES];

export interface ActiveToolDialog {
  nodeId: string;
  toolType: NodeToolType;
}

function normalizeString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
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

export function isPanorama360Node(
  node: CanvasNode | null | undefined
): node is Node<Panorama360NodeData, typeof CANVAS_NODE_TYPES.panorama360> {
  return node?.type === CANVAS_NODE_TYPES.panorama360;
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

export function isExportImageNode(
  node: CanvasNode | null | undefined
): node is Node<ExportImageNodeData, typeof CANVAS_NODE_TYPES.exportImage> {
  return node?.type === CANVAS_NODE_TYPES.exportImage;
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
    || isJimengImageResultNode(node)
    || isVideoNode(node)
    || isJimengVideoResultNode(node)
    || isSeedanceVideoResultNode(node)
    || isAudioNode(node)
  );
}

export function isTtsTextNode(
  node: CanvasNode | null | undefined
): node is Node<TtsTextNodeData, typeof CANVAS_NODE_TYPES.ttsText> {
  return node?.type === CANVAS_NODE_TYPES.ttsText;
}

export function isScriptTextNode(
  node: CanvasNode | null | undefined
): node is Node<ScriptTextNodeData, typeof CANVAS_NODE_TYPES.scriptText> {
  return node?.type === CANVAS_NODE_TYPES.scriptText;
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
  aspectRatio: string;
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
    const imageUrl = normalizeImageSource(node.data.imageUrl);
    if (!imageUrl) {
      return null;
    }

    return {
      imageUrl,
      previewImageUrl: normalizeImageSource(node.data.previewImageUrl) ?? imageUrl,
      aspectRatio: normalizeImageSource(node.data.aspectRatio) ?? DEFAULT_ASPECT_RATIO,
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

  if (isVideoNode(node) || isJimengVideoResultNode(node) || isSeedanceVideoResultNode(node)) {
    const source = typeof node.data.videoUrl === 'string' ? node.data.videoUrl.trim() : '';
    if (!source) {
      return null;
    }

    return {
      source,
      mediaType: 'video',
      fileName: typeof node.data.videoFileName === 'string' ? node.data.videoFileName : null,
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
    isScriptPlotPointNode(node) ||
    isScriptWorldviewNode(node)
  ) {
    return false;
  }

  return false;
}
