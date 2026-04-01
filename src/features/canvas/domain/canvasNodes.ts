import type { Edge, Node, XYPosition } from '@xyflow/react';

export const CANVAS_NODE_TYPES = {
  upload: 'uploadNode',
  imageEdit: 'imageNode',
  jimeng: 'jimengNode',
  jimengImage: 'jimengImageNode',
  jimengImageResult: 'jimengImageResultNode',
  jimengVideoResult: 'jimengVideoResultNode',
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
export const JIMENG_IMAGE_RESULT_NODE_DEFAULT_WIDTH = 640;
export const JIMENG_IMAGE_RESULT_NODE_DEFAULT_HEIGHT = 520;
export const JIMENG_IMAGE_RESULT_NODE_MIN_WIDTH = 560;
export const JIMENG_IMAGE_RESULT_NODE_MIN_HEIGHT = 420;
export const JIMENG_VIDEO_RESULT_NODE_DEFAULT_WIDTH = 520;
export const JIMENG_VIDEO_RESULT_NODE_DEFAULT_HEIGHT = 388;
export const JIMENG_VIDEO_RESULT_NODE_MIN_WIDTH = 360;
export const JIMENG_VIDEO_RESULT_NODE_MIN_HEIGHT = 280;
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

export type ImageSize = (typeof IMAGE_SIZES)[number];
export type JimengImageModelVersion = (typeof JIMENG_IMAGE_MODEL_VERSIONS)[number];
export type JimengImageResolutionType = (typeof JIMENG_IMAGE_RESOLUTION_TYPES)[number];
export type JimengVideoModelId = (typeof JIMENG_VIDEO_MODEL_IDS)[number];
export type JimengReferenceMode = (typeof JIMENG_REFERENCE_MODES)[number];
export type JimengAspectRatio = (typeof JIMENG_ASPECT_RATIOS)[number];
export type JimengDurationSeconds = (typeof JIMENG_DURATION_SECONDS)[number];
export type JimengVideoResolution = (typeof JIMENG_VIDEO_RESOLUTIONS)[number];

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
  | JimengImageNodeData
  | JimengImageResultNodeData
  | JimengVideoResultNodeData
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

function normalizeString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function normalizeSceneCardStatus(value: unknown): SceneCardStatus {
  return value === 'idea' || value === 'reviewed' || value === 'locked'
    ? value
    : 'drafting';
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

export function normalizeScriptRootNodeData(data: ScriptRootNodeData): ScriptRootNodeData {
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

  if (
    isUploadNode(node) ||
    isImageEditNode(node) ||
    isExportImageNode(node) ||
    isStoryboardGenNode(node)
  ) {
    const imageUrl = node.data.imageUrl;
    return typeof imageUrl === 'string' && imageUrl.trim().length > 0 ? imageUrl : null;
  }

  if (isJimengImageNode(node)) {
    const primaryResult = node.data.resultImages?.find((item) => Boolean(resolveJimengResultSource(item)));
    return resolveJimengResultSource(primaryResult);
  }

  if (isJimengImageResultNode(node)) {
    const primaryResult = node.data.resultImages?.find((item) => Boolean(resolveJimengResultSource(item)));
    return resolveJimengResultSource(primaryResult);
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
