import type { Edge, Node, XYPosition } from '@xyflow/react';

export const CANVAS_NODE_TYPES = {
  upload: 'uploadNode',
  imageEdit: 'imageNode',
  jimeng: 'jimengNode',
  exportImage: 'exportImageNode',
  textAnnotation: 'textAnnotationNode',
  group: 'groupNode',
  storyboardSplit: 'storyboardNode',
  storyboardSplitResult: 'storyboardSplitResultNode',
  storyboardGen: 'storyboardGenNode',
  video: 'videoNode',
  audio: 'audioNode',
  scriptRoot: 'scriptRootNode',
  scriptChapter: 'scriptChapterNode',
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
export const EXPORT_RESULT_NODE_DEFAULT_WIDTH = 384;
export const EXPORT_RESULT_NODE_LAYOUT_HEIGHT = 288;
export const EXPORT_RESULT_NODE_MIN_WIDTH = 168;
export const EXPORT_RESULT_NODE_MIN_HEIGHT = 168;
export const AUDIO_NODE_DEFAULT_WIDTH = 320;
export const AUDIO_NODE_DEFAULT_HEIGHT = 96;

export const IMAGE_SIZES = ['0.5K', '1K', '2K', '4K'] as const;
export const IMAGE_ASPECT_RATIOS = [
  '1:1',
  '16:9',
  '9:16',
  '4:3',
  '3:4',
  '21:9',
] as const;

export const JIMENG_CREATION_TYPES = [
  'image',
  'video',
  'digitalHuman',
  'voice',
  'action',
] as const;

export const JIMENG_MODEL_IDS = [
  'seedance-2.0-fast',
  'seedance-2.0',
  'seedance-1.5-pro',
  'seedance-1.0',
  'seedance-1.0-fast',
  'seedance-1.0-mini',
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

export type ImageSize = (typeof IMAGE_SIZES)[number];
export type JimengCreationType = (typeof JIMENG_CREATION_TYPES)[number];
export type JimengModelId = (typeof JIMENG_MODEL_IDS)[number];
export type JimengReferenceMode = (typeof JIMENG_REFERENCE_MODES)[number];
export type JimengAspectRatio = (typeof JIMENG_ASPECT_RATIOS)[number];
export type JimengDurationSeconds = (typeof JIMENG_DURATION_SECONDS)[number];

export interface JimengExtraControlSelection {
  controlIndex: number;
  triggerText: string;
  optionText: string;
}

export interface NodeDisplayData {
  displayName?: string;
  [key: string]: unknown;
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
  assetId?: string | null;
  assetLibraryId?: string | null;
  assetName?: string | null;
  assetCategory?: string | null;
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

export interface JimengNodeData extends NodeDisplayData {
  prompt: string;
  referenceImageOrder?: string[];
  creationType?: JimengCreationType;
  model?: JimengModelId;
  referenceMode?: JimengReferenceMode;
  aspectRatio?: JimengAspectRatio;
  durationSeconds?: JimengDurationSeconds;
  suggestedDurationSeconds?: number | null;
  suggestedDurationEstimatedSeconds?: number | null;
  suggestedDurationExceedsLimit?: boolean;
  suggestedDurationReason?: string | null;
  extraControls?: JimengExtraControlSelection[];
  isSubmitting?: boolean;
  lastSubmittedAt?: number | null;
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

export interface ScriptRootNodeData extends NodeDisplayData {
  title: string;
  genre: string;
  totalChapters: number;
  styleProfile?: StyleProfile;
}

export interface ScriptChapterNodeData extends NodeDisplayData {
  chapterNumber: number;
  title: string;
  content: string;
  summary: string;
  sceneHeadings: string[];
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
  | TextAnnotationNodeData
  | GroupNodeData
  | ImageEditNodeData
  | JimengNodeData
  | StoryboardSplitNodeData
  | StoryboardSplitResultNodeData
  | StoryboardGenNodeData
  | VideoNodeData
  | AudioNodeData
  | ScriptRootNodeData
  | ScriptChapterNodeData
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

export function isJimengNode(
  node: CanvasNode | null | undefined
): node is Node<JimengNodeData, typeof CANVAS_NODE_TYPES.jimeng> {
  return node?.type === CANVAS_NODE_TYPES.jimeng;
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

export function getNodePrimaryImageSource(
  node: CanvasNode | null | undefined
): string | null {
  if (!node) {
    return null;
  }

  if (
    isUploadNode(node) ||
    isImageEditNode(node) ||
    isExportImageNode(node) ||
    isStoryboardGenNode(node)
  ) {
    const imageUrl = node.data.imageUrl;
    return typeof imageUrl === 'string' && imageUrl.trim().length > 0 ? imageUrl : null;
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
