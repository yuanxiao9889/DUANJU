import { create } from 'zustand';
import type {
  Connection,
  EdgeChange,
  NodeChange,
  Viewport,
} from '@xyflow/react';
import { v4 as uuidv4 } from 'uuid';

import {
  AUTO_REQUEST_ASPECT_RATIO,
  CANVAS_NODE_TYPES,
  DEFAULT_ASPECT_RATIO,
  DEFAULT_NODE_WIDTH,
  EXPORT_RESULT_NODE_DEFAULT_WIDTH,
  EXPORT_RESULT_NODE_LAYOUT_HEIGHT,
  EXPORT_RESULT_NODE_MIN_HEIGHT,
  EXPORT_RESULT_NODE_MIN_WIDTH,
  IMAGE_COLLAGE_NODE_DEFAULT_HEIGHT,
  IMAGE_COLLAGE_NODE_DEFAULT_WIDTH,
  IMAGE_EDIT_NODE_DEFAULT_HEIGHT,
  IMAGE_EDIT_NODE_DEFAULT_WIDTH,
  SCRIPT_CHAPTER_NODE_DEFAULT_HEIGHT,
  SCRIPT_CHAPTER_NODE_DEFAULT_WIDTH,
  SCRIPT_REFERENCE_NODE_DEFAULT_HEIGHT,
  SCRIPT_REFERENCE_NODE_DEFAULT_WIDTH,
  SCRIPT_SCENE_NODE_DEFAULT_HEIGHT,
  SCRIPT_SCENE_NODE_DEFAULT_WIDTH,
  SHOOTING_SCRIPT_NODE_DEFAULT_HEIGHT,
  SHOOTING_SCRIPT_NODE_DEFAULT_WIDTH,
  type JimengImageNodeData,
  type JimengNodeData,
  type ActiveToolDialog,
  type CanvasEdge,
  type CanvasNode,
  type CanvasNodeData,
  type CanvasNodeType,
  type EpisodeCard,
  type ExportImageNodeResultKind,
  type ImageEditNodeData,
  type ImageCollageNodeData,
  type NodeToolType,
  type StoryboardExportOptions,
  type StoryboardFrameItem,
  type ScriptChapterNodeData,
  type ScriptRootNodeData,
  type ScriptSceneNodeData,
  type ShootingScriptNodeData,
  type ScriptReferenceNodeData,
  type ScriptCharacterReferenceNodeData,
  type ScriptLocationReferenceNodeData,
  type ScriptItemReferenceNodeData,
  createDefaultSceneCard,
  normalizeShootingScriptNodeData,
  normalizeImageCollageNodeData,
  normalizeScriptChapterNodeData,
  normalizeScriptCharacterReferenceNodeData,
  normalizeScriptItemReferenceNodeData,
  normalizeScriptLocationReferenceNodeData,
  normalizeScriptReferenceNodeData,
  normalizeScriptRootNodeData,
  normalizeScriptSceneNodeData,
  isStoryboardSplitNode,
  isImageCollageNode,
  resolveSingleImageConnectionSource,
} from '@/features/canvas/domain/canvasNodes';
import {
  nodeHasSourceHandle,
  nodeHasTargetHandle,
} from '@/features/canvas/domain/nodeRegistry';
import { EXPORT_RESULT_DISPLAY_NAME } from '@/features/canvas/domain/nodeDisplay';
import { nodeCatalog } from '@/features/canvas/application/nodeCatalog';
import { canvasNodeFactory } from '@/features/canvas/application/canvasServices';
import { emitCanvasNodesDeleted } from '@/features/canvas/application/nodeDeletionEvents';
import {
  ensureAtLeastOneMinEdge,
  resolveMinEdgeFittedSize,
  resolveSizeInsideTargetBox,
} from '@/features/canvas/application/imageNodeSizing';
import {
  calculateMindMapLayout,
  DEFAULT_LAYOUT_CONFIG,
} from '@/features/canvas/application/mindMapLayout';
import {
  DEFAULT_GROUP_LAYOUT_MAX_ITEMS_PER_LINE,
  GROUP_NODE_BOTTOM_PADDING,
  GROUP_NODE_SIDE_PADDING,
  GROUP_NODE_TOP_PADDING,
  layoutGroupChildren,
} from '@/features/canvas/application/groupLayout';
import type { AssetItemRecord } from '@/features/assets/domain/types';
import { useSettingsStore } from '@/stores/settingsStore';
import { getImageModel } from '@/features/canvas/models';
import {
  normalizeJimengImageResolutionForModel,
  normalizeJimengReferenceMode,
  normalizeJimengVideoModel,
} from '@/features/jimeng/domain/jimengOptions';
import type { CanvasSemanticColor } from '@/features/canvas/domain/semanticColors';
import { useScriptEditorStore } from '@/stores/scriptEditorStore';

export type {
  ActiveToolDialog,
  CanvasEdge,
  CanvasNode,
  CanvasNodeData,
  CanvasNodeType,
  NodeToolType,
  StoryboardFrameItem,
};

function applyNodeChangesLocal(
  changes: NodeChange<CanvasNode>[],
  nodes: CanvasNode[]
): CanvasNode[] {
  let nextNodes = [...nodes];

  for (const change of changes) {
    switch (change.type) {
      case 'add': {
        const index = typeof change.index === 'number' ? change.index : nextNodes.length;
        nextNodes = [
          ...nextNodes.slice(0, index),
          change.item,
          ...nextNodes.slice(index),
        ];
        break;
      }
      case 'remove':
        nextNodes = nextNodes.filter((node) => node.id !== change.id);
        break;
      case 'replace':
        nextNodes = nextNodes.map((node) => (node.id === change.id ? change.item : node));
        break;
      case 'select':
        nextNodes = nextNodes.map((node) => (
          node.id === change.id ? { ...node, selected: change.selected } : node
        ));
        break;
      case 'position':
        nextNodes = nextNodes.map((node) => {
          if (node.id !== change.id) {
            return node;
          }

          return {
            ...node,
            position: change.position ?? node.position,
            dragging:
              'dragging' in change
                ? change.dragging
                : node.dragging,
          };
        });
        break;
      case 'dimensions':
        nextNodes = nextNodes.map((node) => {
          if (node.id !== change.id) {
            return node;
          }

          const width = change.dimensions?.width;
          const height = change.dimensions?.height;
          const shouldSetWidth =
            change.setAttributes === true || change.setAttributes === 'width';
          const shouldSetHeight =
            change.setAttributes === true || change.setAttributes === 'height';

          return {
            ...node,
            width: shouldSetWidth && typeof width === 'number' ? width : node.width,
            height: shouldSetHeight && typeof height === 'number' ? height : node.height,
            measured: {
              ...(node.measured ?? {}),
              width: typeof width === 'number' ? width : node.measured?.width,
              height: typeof height === 'number' ? height : node.measured?.height,
            },
            resizing:
              'resizing' in change ? change.resizing : node.resizing,
          };
        });
        break;
      default:
        break;
    }
  }

  return nextNodes;
}

function applyEdgeChangesLocal(
  changes: EdgeChange<CanvasEdge>[],
  edges: CanvasEdge[]
): CanvasEdge[] {
  let nextEdges = [...edges];

  for (const change of changes) {
    switch (change.type) {
      case 'add': {
        const index = typeof change.index === 'number' ? change.index : nextEdges.length;
        nextEdges = [
          ...nextEdges.slice(0, index),
          change.item,
          ...nextEdges.slice(index),
        ];
        break;
      }
      case 'remove':
        nextEdges = nextEdges.filter((edge) => edge.id !== change.id);
        break;
      case 'replace':
        nextEdges = nextEdges.map((edge) => (edge.id === change.id ? change.item : edge));
        break;
      case 'select':
        nextEdges = nextEdges.map((edge) => (
          edge.id === change.id ? { ...edge, selected: change.selected } : edge
        ));
        break;
      default:
        break;
    }
  }

  return nextEdges;
}

function addEdgeLocal(
  connection: Connection | CanvasEdge,
  edges: CanvasEdge[]
): CanvasEdge[] {
  const sourceHandle = connection.sourceHandle ?? null;
  const targetHandle = connection.targetHandle ?? null;
  const alreadyExists = edges.some((edge) =>
    edge.source === connection.source &&
    edge.target === connection.target &&
    (edge.sourceHandle ?? null) === sourceHandle &&
    (edge.targetHandle ?? null) === targetHandle
  );

  if (alreadyExists) {
    return edges;
  }

  const nextEdge = {
    ...connection,
    id:
      ('id' in connection && typeof connection.id === 'string' && connection.id.trim().length > 0)
        ? connection.id
        : `xy-edge__${connection.source}-${sourceHandle ?? 'null'}-${connection.target}-${targetHandle ?? 'null'}`,
  } as CanvasEdge;

  return [...edges, nextEdge];
}

export interface CanvasFullHistorySnapshot {
  kind?: 'full';
  nodes: CanvasNode[];
  edges: CanvasEdge[];
}

export interface CanvasNodePatchHistoryEntry {
  nodeId: string;
  node: CanvasNode | null;
}

export interface CanvasNodePatchHistorySnapshot {
  kind: 'nodePatch';
  entries: CanvasNodePatchHistoryEntry[];
}

export type CanvasHistorySnapshot =
  | CanvasFullHistorySnapshot
  | CanvasNodePatchHistorySnapshot;

export interface CanvasHistoryState {
  past: CanvasHistorySnapshot[];
  future: CanvasHistorySnapshot[];
}

export interface GeneratedScriptChapterInput {
  title: string;
  summary: string;
  contentHtml: string;
  sceneTitle?: string;
  sceneSummary?: string;
  sceneHeading?: string;
  characters?: string[];
  location?: string;
  items?: string[];
  visualHook?: string;
  directorNotes?: string;
  sourceDraftLabel?: string;
}

const MAX_HISTORY_STEPS = 50;
const MAX_HISTORY_TIMELINE_REFERENCE_BUDGET = 120_000;
const IMAGE_NODE_VISUAL_MIN_EDGE = 96;
const DERIVED_NODE_COLUMN_GAP = 28;
const DERIVED_NODE_STACK_GAP = 20;
const IMAGE_EDIT_DERIVED_NODE_STACK_GAP = 12;
const DERIVED_NODE_MAX_ROWS_PER_COLUMN = 4;
const DERIVED_NODE_NEXT_COLUMN_GAP = 32;
const DERIVED_NODE_COLUMN_ALIGNMENT_THRESHOLD = 48;
const LEGACY_IMAGE_EDIT_NODE_DEFAULT_WIDTHS = new Set([620]);
const LEGACY_IMAGE_EDIT_NODE_DEFAULT_HEIGHTS = new Set([290, 340, 350]);
const STORYBOARD_SPLIT_NODE_BASE_WIDTH = 620;
const STORYBOARD_SPLIT_NODE_MIN_HEIGHT = 360;
const STORYBOARD_SPLIT_NODE_WIDTH_PADDING = 200;
const STORYBOARD_SPLIT_NODE_HEIGHT_PADDING = 160;
const STORYBOARD_SPLIT_NODE_COL_WIDTH = 136;
const STORYBOARD_SPLIT_NODE_ROW_HEIGHT = 92;
const GROUP_LAYOUT_ANIMATION_CLASS = 'canvas-node--layout-animating';
const GROUP_LAYOUT_ANIMATION_MS = 220;
let latestGroupLayoutAnimationRunId = 0;
type StoryboardGridAxis = 'rows' | 'cols';

interface AddNodeOptions {
  parentId?: string;
  inheritParentFromNodeId?: string;
  positionSpace?: 'canvas' | 'parent';
}

interface UpdateNodeDataOptions {
  historyMode?: 'push' | 'skip';
}

interface AddGeneratedScriptChaptersOptions {
  nodeWidth?: number;
  nodeHeight?: number;
}

function appendNodeClassName(existing: string | undefined, className: string): string {
  const classes = new Set((existing ?? '').split(/\s+/).filter(Boolean));
  classes.add(className);
  return Array.from(classes).join(' ');
}

function removeNodeClassName(existing: string | undefined, className: string): string | undefined {
  const classes = (existing ?? '').split(/\s+/).filter(Boolean).filter((value) => value !== className);
  return classes.length > 0 ? classes.join(' ') : undefined;
}

function calculateGridLayout(frameCount: number): { rows: number; cols: number } {
  if (frameCount <= 1) return { rows: 1, cols: 1 };
  if (frameCount <= 2) return { rows: 1, cols: 2 };
  if (frameCount <= 4) return { rows: 2, cols: 2 };
  if (frameCount <= 6) return { rows: 2, cols: 3 };
  if (frameCount <= 9) return { rows: 3, cols: 3 };
  if (frameCount <= 12) return { rows: 3, cols: 4 };
  if (frameCount <= 16) return { rows: 4, cols: 4 };
  const cols = Math.ceil(Math.sqrt(frameCount));
  const rows = Math.ceil(frameCount / cols);
  return { rows, cols };
}

function clampStoryboardGridDimension(value: number, frameCount: number): number {
  const safeMax = Math.max(1, Math.floor(frameCount));
  const normalized = Number.isFinite(value) ? Math.floor(value) : 1;
  return Math.max(1, Math.min(safeMax, normalized));
}

function resolveStoryboardGridLayoutForAxis(
  frameCount: number,
  axis: StoryboardGridAxis,
  value: number
): { rows: number; cols: number } {
  const safeFrameCount = Math.max(0, Math.floor(frameCount));
  if (safeFrameCount <= 0) {
    return { rows: 1, cols: 1 };
  }

  const safeValue = clampStoryboardGridDimension(value, safeFrameCount);
  if (axis === 'rows') {
    return {
      rows: safeValue,
      cols: clampStoryboardGridDimension(Math.ceil(safeFrameCount / safeValue), safeFrameCount),
    };
  }

  return {
    rows: clampStoryboardGridDimension(Math.ceil(safeFrameCount / safeValue), safeFrameCount),
    cols: safeValue,
  };
}

function normalizeStoryboardGridLayout(
  frameCount: number,
  rows: number,
  cols: number
): { rows: number; cols: number } {
  const safeFrameCount = Math.max(0, Math.floor(frameCount));
  if (safeFrameCount <= 0) {
    return { rows: 1, cols: 1 };
  }

  const fallback = calculateGridLayout(safeFrameCount);
  const safeRows = Number.isFinite(rows)
    ? clampStoryboardGridDimension(rows, safeFrameCount)
    : fallback.rows;
  const safeCols = Number.isFinite(cols)
    ? clampStoryboardGridDimension(cols, safeFrameCount)
    : fallback.cols;

  if (safeRows * safeCols >= safeFrameCount) {
    return { rows: safeRows, cols: safeCols };
  }

  return resolveStoryboardGridLayoutForAxis(safeFrameCount, 'cols', safeCols);
}

function resolveStoryboardSplitNodeSize(rows: number, cols: number): { width: number; height: number } {
  const safeRows = Math.max(1, Math.floor(rows));
  const safeCols = Math.max(1, Math.floor(cols));

  return {
    width: Math.max(
      STORYBOARD_SPLIT_NODE_BASE_WIDTH,
      STORYBOARD_SPLIT_NODE_WIDTH_PADDING + safeCols * STORYBOARD_SPLIT_NODE_COL_WIDTH
    ),
    height: Math.max(
      STORYBOARD_SPLIT_NODE_MIN_HEIGHT,
      STORYBOARD_SPLIT_NODE_HEIGHT_PADDING + safeRows * STORYBOARD_SPLIT_NODE_ROW_HEIGHT
    ),
  };
}

interface CanvasState {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  selectedNodeId: string | null;
  highlightedReferenceSourceNodeId: string | null;
  activeToolDialog: ActiveToolDialog | null;
  nodeDescriptionPanelOpenById: Record<string, boolean>;
  history: CanvasHistoryState;
  dragHistorySnapshot: CanvasHistorySnapshot | null;
  currentViewport: Viewport;
  canvasViewportSize: { width: number; height: number };
  imageViewer: {
    isOpen: boolean;
    currentImageUrl: string | null;
    imageList: string[];
    currentIndex: number;
  };

  // 网格设置
  snapToGrid: boolean;
  snapGridSize: number;
  setSnapToGrid: (enabled: boolean) => void;
  setSnapGridSize: (size: number) => void;

  // 节点对齐设置
  enableNodeAlignment: boolean;
  alignmentThreshold: number;
  setEnableNodeAlignment: (enabled: boolean) => void;
  setAlignmentThreshold: (threshold: number) => void;

  onNodesChange: (changes: NodeChange<CanvasNode>[]) => void;
  onEdgesChange: (changes: EdgeChange<CanvasEdge>[]) => void;
  onConnect: (connection: Connection) => void;

  setCanvasData: (nodes: CanvasNode[], edges: CanvasEdge[], history?: CanvasHistoryState) => void;
  addNode: (
    type: CanvasNodeType,
    position: { x: number; y: number },
    data?: Partial<CanvasNodeData>,
    options?: AddNodeOptions
  ) => string;
  addEdge: (source: string, target: string) => string | null;
  findNodePosition: (sourceNodeId: string, newNodeWidth: number, newNodeHeight: number) => { x: number; y: number };
  addDerivedUploadNode: (
    sourceNodeId: string,
    imageUrl: string,
    aspectRatio: string,
    previewImageUrl?: string
  ) => string | null;
  addDerivedExportNode: (
    sourceNodeId: string,
    imageUrl: string,
    aspectRatio: string,
    previewImageUrl?: string,
    options?: {
      defaultTitle?: string;
      resultKind?: ExportImageNodeResultKind;
      aspectRatioStrategy?: 'provided' | 'derivedFromSource';
      sizeStrategy?: 'generated' | 'autoMinEdge' | 'matchSource';
      matchSourceNodeSize?: boolean;
      connectToSource?: boolean;
    }
  ) => string | null;
  addStoryboardSplitFrameExportNodes: (
    sourceNodeId: string,
    frames: Array<{
      imageUrl: string;
      previewImageUrl?: string | null;
      aspectRatio?: string | null;
      title?: string | null;
    }>,
    options?: {
      gridCols?: number;
    }
  ) => string[];
  addStoryboardSplitNode: (
    sourceNodeId: string,
    rows: number,
    cols: number,
    frames: StoryboardFrameItem[],
    frameAspectRatio?: string
  ) => string | null;
  addStoryboardSplitResultNode: (
    sourceNodeId: string,
    rows: number,
    cols: number,
    frames: StoryboardFrameItem[],
    frameAspectRatio?: string
  ) => string | null;
  addGeneratedScriptChapters: (
    sourceNodeId: string,
    chapters: GeneratedScriptChapterInput[],
    options?: AddGeneratedScriptChaptersOptions
  ) => string[];
  createScriptSceneNodeFromChapterScene: (
    chapterNodeId: string,
    sceneId: string
  ) => string | null;
  ensureShootingScriptNodeFromSceneEpisode: (
    sceneNodeId: string,
    episodeId: string
  ) => {
    nodeId: string | null;
    created: boolean;
  };
  reindexScriptSceneEpisodes: (sourceChapterId: string) => void;

  updateNodeData: (
    nodeId: string,
    data: Partial<CanvasNodeData>,
    options?: UpdateNodeDataOptions
  ) => void;
  updateNodesData: (
    nodeIds: Iterable<string>,
    data: Partial<CanvasNodeData>,
    options?: UpdateNodeDataOptions
  ) => void;
  applySemanticColorToSelected: (color: CanvasSemanticColor) => void;
  updateNodePosition: (nodeId: string, position: { x: number; y: number }) => void;
  updateStoryboardFrame: (
    nodeId: string,
    frameId: string,
    data: Partial<StoryboardFrameItem>
  ) => void;
  updateStoryboardGridLayout: (
    nodeId: string,
    axis: StoryboardGridAxis,
    value: number
  ) => void;
  reorderStoryboardFrame: (
    nodeId: string,
    draggedFrameId: string,
    targetFrameId: string
  ) => void;
  addStoryboardFrame: (nodeId: string, isWhitePlaceholder?: boolean) => void;
  removeStoryboardFrame: (nodeId: string, frameId: string) => void;
  setStoryboardFrameImage: (nodeId: string, frameId: string, imageUrl: string | null) => void;
  createMergedImageNode: (sourceNodeId: string) => Promise<string | null>;
  syncAssetItemReferences: (item: AssetItemRecord) => boolean;
  detachDeletedAssetReferences: (assetItemId: string) => boolean;

  deleteNode: (nodeId: string) => void;
  deleteNodes: (nodeIds: string[]) => void;
  groupNodes: (nodeIds: string[]) => string | null;
  layoutGroupNode: (groupNodeId: string) => boolean;
  reparentNodesToGroup: (nodeIds: string[], groupNodeId: string) => boolean;
  detachNodesFromGroup: (nodeIds: string[]) => boolean;
  ungroupNode: (groupNodeId: string) => boolean;
  deleteEdge: (edgeId: string) => void;
  setSelectedNode: (nodeId: string | null) => void;
  setHighlightedReferenceSourceNode: (nodeId: string | null) => void;
  toggleNodeDescriptionPanel: (nodeId: string) => void;
  setNodeDescriptionPanelOpen: (nodeId: string, isOpen: boolean) => void;

  openToolDialog: (dialog: ActiveToolDialog) => void;
  closeToolDialog: () => void;
  setViewportState: (viewport: Viewport) => void;
  setCanvasViewportSize: (size: { width: number; height: number }) => void;
  openImageViewer: (imageUrl: string, imageList?: string[]) => void;
  closeImageViewer: () => void;
  navigateImageViewer: (direction: 'prev' | 'next') => void;

  undo: () => boolean;
  redo: () => boolean;

  applyMindMapLayout: () => void;
  clearCanvas: () => void;

  addImageFromBase64: (base64: string, width: number, height: number) => Promise<string>;
}

function normalizeHandleId(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed || trimmed === 'null' || trimmed === 'undefined') {
    return undefined;
  }
  return trimmed;
}

function normalizeEdgesWithNodes(rawEdges: CanvasEdge[], nodes: CanvasNode[]): CanvasEdge[] {
  const nodeMap = new Map(nodes.map((node) => [node.id, node] as const));

  return rawEdges
    .filter((edge) => {
      const sourceNode = nodeMap.get(edge.source);
      const targetNode = nodeMap.get(edge.target);
      if (!sourceNode || !targetNode) {
        return false;
      }
      return nodeHasSourceHandle(sourceNode.type) && nodeHasTargetHandle(targetNode.type);
    })
    .map((edge) => ({
      ...edge,
      type: edge.type ?? 'disconnectableEdge',
      sourceHandle:
        normalizeHandleId((edge as CanvasEdge & { sourceHandle?: unknown }).sourceHandle) ?? 'source',
      targetHandle:
        normalizeHandleId((edge as CanvasEdge & { targetHandle?: unknown }).targetHandle) ?? 'target',
    }));
}

function normalizeNodes(rawNodes: CanvasNode[]): CanvasNode[] {
  const normalizedNodes = rawNodes
    .map((node) => {
      if (!Object.values(CANVAS_NODE_TYPES).includes(node.type as CanvasNodeType)) {
        return null;
      }

      const normalizedNodeType = node.type as CanvasNodeType;
      const definition = nodeCatalog.getDefinition(normalizedNodeType);
      const mergedData = {
        ...definition.createDefaultData(),
        ...(node.data as Partial<CanvasNodeData>),
      } as CanvasNodeData;

      if (
        node.type === CANVAS_NODE_TYPES.storyboardSplit
        || node.type === CANVAS_NODE_TYPES.storyboardSplitResult
      ) {
        const frames = (mergedData as { frames?: StoryboardFrameItem[] }).frames ?? [];
        const firstFrameAspectRatio = frames
          .map((frame) => (typeof frame.aspectRatio === 'string' ? frame.aspectRatio.trim() : ''))
          .find((aspectRatio) => aspectRatio.length > 0) ?? null;
        const rawFrameAspectRatio =
          typeof (node.data as { frameAspectRatio?: unknown }).frameAspectRatio === 'string'
            ? (node.data as { frameAspectRatio?: string }).frameAspectRatio?.trim() ?? ''
            : '';
        const normalizedRawFrameAspectRatio = rawFrameAspectRatio.length > 0
          ? rawFrameAspectRatio
          : null;
        const normalizedFrameAspectRatio =
          (normalizedRawFrameAspectRatio && normalizedRawFrameAspectRatio !== DEFAULT_ASPECT_RATIO
            ? normalizedRawFrameAspectRatio
            : null) ??
          firstFrameAspectRatio ??
          normalizedRawFrameAspectRatio ??
          DEFAULT_ASPECT_RATIO;

        (mergedData as { frameAspectRatio: string }).frameAspectRatio = normalizedFrameAspectRatio;
        const normalizedFrames = frames.map((frame, index) => ({
          id: frame.id,
          imageUrl: frame.imageUrl ?? null,
          previewImageUrl: frame.previewImageUrl ?? null,
          aspectRatio:
            typeof frame.aspectRatio === 'string'
              ? frame.aspectRatio
              : normalizedFrameAspectRatio,
          sourceNodeId: normalizeNonEmptyString(frame.sourceNodeId),
          sourceEdgeId: normalizeNonEmptyString(frame.sourceEdgeId),
          note: frame.note ?? '',
          order: Number.isFinite(frame.order) ? frame.order : index,
        }));
        const normalizedGridLayout = normalizeStoryboardGridLayout(
          normalizedFrames.length,
          Number((mergedData as { gridRows?: unknown }).gridRows),
          Number((mergedData as { gridCols?: unknown }).gridCols)
        );

        (mergedData as { frames: StoryboardFrameItem[] }).frames = normalizedFrames;
        (mergedData as { gridRows: number }).gridRows = normalizedGridLayout.rows;
        (mergedData as { gridCols: number }).gridCols = normalizedGridLayout.cols;

        if (normalizedNodeType === CANVAS_NODE_TYPES.storyboardSplit) {
          const rawExportOptions = (mergedData as { exportOptions?: Partial<StoryboardExportOptions> })
            .exportOptions;
          const rawFontSize = Number.isFinite(rawExportOptions?.fontSize)
            ? Number(rawExportOptions?.fontSize)
            : createDefaultStoryboardExportOptions().fontSize;
          const normalizedFontSize = rawFontSize > 20
            ? Math.round(rawFontSize / 6)
            : rawFontSize;
          (mergedData as { exportOptions: StoryboardExportOptions }).exportOptions = {
            ...createDefaultStoryboardExportOptions(),
            ...(rawExportOptions ?? {}),
            fontSize: Math.max(1, Math.min(20, Math.round(normalizedFontSize))),
          };
        }
      }

      if (normalizedNodeType === CANVAS_NODE_TYPES.scriptRoot) {
        Object.assign(
          mergedData,
          normalizeScriptRootNodeData(mergedData as ScriptRootNodeData)
        );
      }

      if (normalizedNodeType === CANVAS_NODE_TYPES.scriptChapter) {
        Object.assign(
          mergedData,
          normalizeScriptChapterNodeData(mergedData as ScriptChapterNodeData)
        );
      }

      if (normalizedNodeType === CANVAS_NODE_TYPES.scriptScene) {
        Object.assign(
          mergedData,
          normalizeScriptSceneNodeData(mergedData as ScriptSceneNodeData)
        );
      }

      if (normalizedNodeType === CANVAS_NODE_TYPES.shootingScript) {
        Object.assign(
          mergedData,
          normalizeShootingScriptNodeData(mergedData as ShootingScriptNodeData)
        );
      }

      if (normalizedNodeType === CANVAS_NODE_TYPES.scriptReference) {
        Object.assign(
          mergedData,
          normalizeScriptReferenceNodeData(mergedData as ScriptReferenceNodeData)
        );
      }

      if (normalizedNodeType === CANVAS_NODE_TYPES.scriptCharacterReference) {
        Object.assign(
          mergedData,
          normalizeScriptCharacterReferenceNodeData(mergedData as ScriptCharacterReferenceNodeData)
        );
      }

      if (normalizedNodeType === CANVAS_NODE_TYPES.scriptLocationReference) {
        Object.assign(
          mergedData,
          normalizeScriptLocationReferenceNodeData(mergedData as ScriptLocationReferenceNodeData)
        );
      }

      if (normalizedNodeType === CANVAS_NODE_TYPES.scriptItemReference) {
        Object.assign(
          mergedData,
          normalizeScriptItemReferenceNodeData(mergedData as ScriptItemReferenceNodeData)
        );
      }

      if (normalizedNodeType === CANVAS_NODE_TYPES.imageCollage) {
        Object.assign(
          mergedData,
          normalizeImageCollageNodeData(mergedData as ImageCollageNodeData)
        );
      }

      if ('aspectRatio' in mergedData && !mergedData.aspectRatio) {
        mergedData.aspectRatio = DEFAULT_ASPECT_RATIO;
      }

      // Keep generation state only when there is a recoverable job id.
      if ('isGenerating' in mergedData && mergedData.isGenerating) {
        const generationJobId =
          typeof (mergedData as { generationJobId?: unknown }).generationJobId === 'string'
            ? (mergedData as { generationJobId?: string }).generationJobId?.trim() ?? ''
            : '';
        if (!generationJobId) {
          mergedData.isGenerating = false;
          if ('generationStartedAt' in mergedData) {
            mergedData.generationStartedAt = null;
          }
        }
      }

      const normalizedNode: CanvasNode = {
        ...node,
        type: normalizedNodeType,
        data: mergedData,
      };

      return applyDefaultNodeSize(normalizedNode, mergedData);
    })
    .filter((node): node is CanvasNode => Boolean(node));

  const reindexedNodes = reindexScriptSceneNodesByChapter(normalizedNodes).nodes;
  const nodeMap = new Map(reindexedNodes.map((node) => [node.id, node] as const));
  return reindexedNodes.map((node) => {
    if (!node.parentId || typeof node.extent === 'undefined') {
      return node;
    }

    const parentNode = nodeMap.get(node.parentId);
    if (parentNode?.type !== CANVAS_NODE_TYPES.group) {
      return node;
    }

    return {
      ...node,
      extent: undefined,
    };
  });
}

function buildScriptSceneSourceKey(sourceChapterId: string, sourceSceneId: string): string {
  return `${sourceChapterId}::${sourceSceneId}`;
}

function buildShootingScriptSourceKey(sourceSceneNodeId: string, sourceEpisodeId: string): string {
  return `${sourceSceneNodeId}::${sourceEpisodeId}`;
}

function isScriptSceneNodeType(node: CanvasNode): node is CanvasNode & {
  data: ScriptSceneNodeData;
  type: typeof CANVAS_NODE_TYPES.scriptScene;
} {
  return node.type === CANVAS_NODE_TYPES.scriptScene;
}

function isShootingScriptNodeType(node: CanvasNode): node is CanvasNode & {
  data: ShootingScriptNodeData;
  type: typeof CANVAS_NODE_TYPES.shootingScript;
} {
  return node.type === CANVAS_NODE_TYPES.shootingScript;
}

function sortEpisodeCardsForChapterReindex(episodes: EpisodeCard[]): EpisodeCard[] {
  return [...episodes].sort((left, right) => {
    const orderDelta = left.order - right.order;
    if (orderDelta !== 0) {
      return orderDelta;
    }
    return left.id.localeCompare(right.id);
  });
}

function reindexScriptSceneNodesByChapter(
  nodes: CanvasNode[],
  sourceChapterId?: string
): { nodes: CanvasNode[]; changed: boolean } {
  const chapterNumberById = new Map<string, number>();
  for (const node of nodes) {
    if (node.type !== CANVAS_NODE_TYPES.scriptChapter) {
      continue;
    }

    const chapterData = node.data as ScriptChapterNodeData;
    chapterNumberById.set(node.id, chapterData.chapterNumber || 1);
  }

  const sceneNodesByChapter = new Map<string, Array<CanvasNode & {
    data: ScriptSceneNodeData;
    type: typeof CANVAS_NODE_TYPES.scriptScene;
  }>>();

  for (const node of nodes) {
    if (!isScriptSceneNodeType(node)) {
      continue;
    }

    const chapterId = node.data.sourceChapterId;
    if (!chapterId) {
      continue;
    }
    if (sourceChapterId && chapterId !== sourceChapterId) {
      continue;
    }

    const list = sceneNodesByChapter.get(chapterId) ?? [];
    list.push(node);
    sceneNodesByChapter.set(chapterId, list);
  }

  if (sceneNodesByChapter.size === 0) {
    return { nodes, changed: false };
  }

  let changed = false;
  const nextNodeById = new Map<string, CanvasNode>();
  const shootingScriptContextBySourceKey = new Map<string, {
    chapterNumber: number;
    sceneNumber: number;
    sceneTitle: string;
    episodeNumber: number;
    episodeTitle: string;
  }>();

  sceneNodesByChapter.forEach((sceneNodes, chapterId) => {
    const sortedSceneNodes = [...sceneNodes].sort((left, right) => {
      const sceneOrderDelta = left.data.sourceSceneOrder - right.data.sourceSceneOrder;
      if (sceneOrderDelta !== 0) {
        return sceneOrderDelta;
      }

      return left.data.sourceSceneId.localeCompare(right.data.sourceSceneId);
    });

    const chapterNumber = chapterNumberById.get(chapterId) ?? sortedSceneNodes[0]?.data.chapterNumber ?? 1;
    let nextEpisodeNumber = 1;

    for (const [sceneIndex, sceneNode] of sortedSceneNodes.entries()) {
      const sceneNumber = sceneIndex + 1;
      const sortedEpisodes = sortEpisodeCardsForChapterReindex(sceneNode.data.episodes ?? []);
      const nextEpisodes = sortedEpisodes.map((episode, index) => {
        const normalizedEpisodeNumber = nextEpisodeNumber;
        nextEpisodeNumber += 1;
        return {
          ...episode,
          order: index,
          episodeNumber: normalizedEpisodeNumber,
        };
      });

      nextEpisodes.forEach((episode) => {
        shootingScriptContextBySourceKey.set(
          buildShootingScriptSourceKey(sceneNode.id, episode.id),
          {
            chapterNumber,
            sceneNumber,
            sceneTitle: sceneNode.data.title,
            episodeNumber: episode.episodeNumber,
            episodeTitle: episode.title,
          }
        );
      });

      const hasEpisodeChange =
        nextEpisodes.length !== sceneNode.data.episodes.length
        || nextEpisodes.some((episode, index) => {
          const previousEpisode = sceneNode.data.episodes[index];
          return !previousEpisode
            || previousEpisode.id !== episode.id
            || previousEpisode.order !== episode.order
            || previousEpisode.episodeNumber !== episode.episodeNumber;
        });

      if (!hasEpisodeChange && sceneNode.data.chapterNumber === chapterNumber) {
        continue;
      }

      changed = true;
      nextNodeById.set(sceneNode.id, {
        ...sceneNode,
        data: {
          ...sceneNode.data,
          chapterNumber,
          episodes: nextEpisodes,
        },
      });
    }
  });

  for (const node of nodes) {
    if (!isShootingScriptNodeType(node)) {
      continue;
    }

    const nextContext = shootingScriptContextBySourceKey.get(
      buildShootingScriptSourceKey(node.data.sourceSceneNodeId, node.data.sourceEpisodeId)
    );
    if (!nextContext) {
      continue;
    }

    const normalizedData = normalizeShootingScriptNodeData({
      ...node.data,
      chapterNumber: nextContext.chapterNumber,
      sceneNumber: nextContext.sceneNumber,
      sceneTitle: nextContext.sceneTitle,
      episodeNumber: nextContext.episodeNumber,
      episodeTitle: nextContext.episodeTitle,
    });

    const hasScriptChange =
      node.data.chapterNumber !== normalizedData.chapterNumber
      || node.data.sceneNumber !== normalizedData.sceneNumber
      || node.data.sceneTitle !== normalizedData.sceneTitle
      || node.data.episodeNumber !== normalizedData.episodeNumber
      || node.data.episodeTitle !== normalizedData.episodeTitle
      || normalizedData.rows.length !== node.data.rows.length
      || normalizedData.rows.some((row, index) => {
        const previousRow = node.data.rows[index];
        return !previousRow
          || previousRow.id !== row.id
          || previousRow.shotNumber !== row.shotNumber;
      });

    if (!hasScriptChange) {
      continue;
    }

    changed = true;
    nextNodeById.set(node.id, {
      ...node,
      data: normalizedData,
    });
  }

  if (!changed) {
    return { nodes, changed: false };
  }

  return {
    nodes: nodes.map((node) => nextNodeById.get(node.id) ?? node),
    changed: true,
  };
}

function findScriptSceneNodeBySource(
  nodes: CanvasNode[],
  sourceChapterId: string,
  sourceSceneId: string
): (CanvasNode & {
  data: ScriptSceneNodeData;
  type: typeof CANVAS_NODE_TYPES.scriptScene;
}) | null {
  const sourceKey = buildScriptSceneSourceKey(sourceChapterId, sourceSceneId);

  return nodes.find((node): node is CanvasNode & {
    data: ScriptSceneNodeData;
    type: typeof CANVAS_NODE_TYPES.scriptScene;
  } => (
    isScriptSceneNodeType(node)
    && buildScriptSceneSourceKey(node.data.sourceChapterId, node.data.sourceSceneId) === sourceKey
  )) ?? null;
}

function findShootingScriptNodeBySource(
  nodes: CanvasNode[],
  sourceSceneNodeId: string,
  sourceEpisodeId: string
): (CanvasNode & {
  data: ShootingScriptNodeData;
  type: typeof CANVAS_NODE_TYPES.shootingScript;
}) | null {
  const sourceKey = buildShootingScriptSourceKey(sourceSceneNodeId, sourceEpisodeId);

  return nodes.find((node): node is CanvasNode & {
    data: ShootingScriptNodeData;
    type: typeof CANVAS_NODE_TYPES.shootingScript;
  } => (
    isShootingScriptNodeType(node)
    && buildShootingScriptSourceKey(node.data.sourceSceneNodeId, node.data.sourceEpisodeId) === sourceKey
  )) ?? null;
}

function normalizeHistory(history?: CanvasHistoryState): CanvasHistoryState {
  if (!history) {
    return { past: [], future: [] };
  }

  const normalizeSnapshot = (snapshot: CanvasHistorySnapshot): CanvasHistorySnapshot => {
    if (isCanvasNodePatchHistorySnapshot(snapshot)) {
      const normalizedPatchNodes = normalizeNodes(
        snapshot.entries
          .map((entry) => entry.node)
          .filter((node): node is CanvasNode => Boolean(node))
      );
      let normalizedIndex = 0;
      return {
        kind: 'nodePatch',
        entries: snapshot.entries.map((entry) => {
          if (!entry.node) {
            return entry;
          }

          const normalizedNode = normalizedPatchNodes[normalizedIndex] ?? entry.node;
          normalizedIndex += 1;
          return {
            nodeId: entry.nodeId,
            node: normalizedNode,
          };
        }),
      };
    }

    const normalizedNodes = normalizeNodes(snapshot.nodes);
    return {
      nodes: normalizedNodes,
      edges: normalizeEdgesWithNodes(snapshot.edges, normalizedNodes),
    };
  };

  return {
    past: trimSnapshotTimeline(
      history.past.slice(-MAX_HISTORY_STEPS).map(normalizeSnapshot)
    ),
    future: trimSnapshotTimeline(
      history.future.slice(-MAX_HISTORY_STEPS).map(normalizeSnapshot)
    ),
  };
}

function createSnapshot(nodes: CanvasNode[], edges: CanvasEdge[]): CanvasHistorySnapshot {
  return { nodes, edges };
}

function isCanvasNodePatchHistorySnapshot(
  snapshot: CanvasHistorySnapshot
): snapshot is CanvasNodePatchHistorySnapshot {
  return snapshot.kind === 'nodePatch';
}

function createNodePatchSnapshot(
  nodes: CanvasNode[],
  nodeIds: Iterable<string>,
  fallbackEdges: CanvasEdge[]
): CanvasHistorySnapshot {
  const seenNodeIds = new Set<string>();
  const previousNodeById = new Map(nodes.map((node) => [node.id, node] as const));
  const entries: CanvasNodePatchHistoryEntry[] = [];

  for (const nodeId of nodeIds) {
    if (!nodeId || seenNodeIds.has(nodeId)) {
      continue;
    }

    seenNodeIds.add(nodeId);
    const previousNode = previousNodeById.get(nodeId);
    if (!previousNode) {
      continue;
    }

    entries.push({
      nodeId,
      node: previousNode,
    });
  }

  return entries.length > 0
    ? {
        kind: 'nodePatch',
        entries,
      }
    : createSnapshot(nodes, fallbackEdges);
}

function createReverseNodePatchSnapshot(
  snapshot: CanvasNodePatchHistorySnapshot,
  nodes: CanvasNode[],
  fallbackEdges: CanvasEdge[]
): CanvasHistorySnapshot {
  const currentNodeById = new Map(nodes.map((node) => [node.id, node] as const));
  const entries = snapshot.entries.map((entry) => ({
    nodeId: entry.nodeId,
    node: currentNodeById.get(entry.nodeId) ?? null,
  }));

  return entries.length > 0
    ? {
        kind: 'nodePatch',
        entries,
      }
    : createSnapshot(nodes, fallbackEdges);
}

function applyNodePatchSnapshot(
  currentNodes: CanvasNode[],
  snapshot: CanvasNodePatchHistorySnapshot
): CanvasNode[] {
  const patchById = new Map(snapshot.entries.map((entry) => [entry.nodeId, entry.node] as const));
  const nextNodes: CanvasNode[] = [];

  for (const node of currentNodes) {
    if (!patchById.has(node.id)) {
      nextNodes.push(node);
      continue;
    }

    const patchedNode = patchById.get(node.id) ?? null;
    patchById.delete(node.id);
    if (patchedNode) {
      nextNodes.push(patchedNode);
    }
  }

  for (const patchedNode of patchById.values()) {
    if (patchedNode) {
      nextNodes.push(patchedNode);
    }
  }

  return nextNodes;
}

function applyHistorySnapshot(
  currentNodes: CanvasNode[],
  currentEdges: CanvasEdge[],
  snapshot: CanvasHistorySnapshot
): CanvasFullHistorySnapshot {
  if (isCanvasNodePatchHistorySnapshot(snapshot)) {
    return {
      nodes: applyNodePatchSnapshot(currentNodes, snapshot),
      edges: currentEdges,
    };
  }

  return snapshot;
}

function estimateSnapshotReferenceFootprint(snapshot: CanvasHistorySnapshot): number {
  if (isCanvasNodePatchHistorySnapshot(snapshot)) {
    return snapshot.entries.length;
  }

  return snapshot.nodes.length + snapshot.edges.length;
}

function trimSnapshotTimeline(snapshots: CanvasHistorySnapshot[]): CanvasHistorySnapshot[] {
  if (snapshots.length <= 1) {
    return snapshots;
  }

  let totalFootprint = 0;
  for (const snapshot of snapshots) {
    totalFootprint += estimateSnapshotReferenceFootprint(snapshot);
  }

  if (totalFootprint <= MAX_HISTORY_TIMELINE_REFERENCE_BUDGET) {
    return snapshots;
  }

  let trimStartIndex = 0;
  while (
    trimStartIndex < snapshots.length - 1
    && totalFootprint > MAX_HISTORY_TIMELINE_REFERENCE_BUDGET
  ) {
    totalFootprint -= estimateSnapshotReferenceFootprint(snapshots[trimStartIndex]);
    trimStartIndex += 1;
  }

  return trimStartIndex > 0 ? snapshots.slice(trimStartIndex) : snapshots;
}

function normalizeNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function resolveStoryboardFrameImageKeys(frame: StoryboardFrameItem): string[] {
  const keys = [
    normalizeNonEmptyString(frame.imageUrl),
    normalizeNonEmptyString(frame.previewImageUrl),
  ].filter((value): value is string => Boolean(value));

  return Array.from(new Set(keys));
}

function isStoryboardInputSourceNode(node: CanvasNode | undefined): boolean {
  return Boolean(resolveSingleImageConnectionSource(node));
}

function doesStoryboardFrameReferenceIncomingEdge(
  frame: StoryboardFrameItem,
  edge: CanvasEdge,
  sourceNode: CanvasNode
): boolean {
  const singleImageSource = resolveSingleImageConnectionSource(sourceNode);
  const normalizedFrameSourceEdgeId = normalizeNonEmptyString(frame.sourceEdgeId);
  if (normalizedFrameSourceEdgeId && normalizedFrameSourceEdgeId === edge.id) {
    return true;
  }

  const normalizedFrameSourceNodeId = normalizeNonEmptyString(frame.sourceNodeId);
  if (normalizedFrameSourceNodeId && normalizedFrameSourceNodeId === edge.source) {
    return true;
  }

  const frameImageKeys = resolveStoryboardFrameImageKeys(frame);
  if (frameImageKeys.length === 0) {
    return false;
  }

  const sourceImageKeys = [
    normalizeNonEmptyString(singleImageSource?.imageUrl),
    normalizeNonEmptyString(singleImageSource?.previewImageUrl),
  ].filter((value): value is string => Boolean(value));

  return sourceImageKeys.some((key) => frameImageKeys.includes(key));
}

function resolveStoryboardFrameDisconnectedEdgeIds(
  nodeId: string,
  removedFrame: StoryboardFrameItem,
  remainingFrames: StoryboardFrameItem[],
  nodes: CanvasNode[],
  edges: CanvasEdge[]
): Set<string> {
  const nodeById = new Map(nodes.map((node) => [node.id, node] as const));
  const disconnectedEdgeIds = new Set<string>();

  for (const edge of edges) {
    if (edge.target !== nodeId) {
      continue;
    }

    const sourceNode = nodeById.get(edge.source);
    if (!sourceNode || !isStoryboardInputSourceNode(sourceNode)) {
      continue;
    }

    if (!doesStoryboardFrameReferenceIncomingEdge(removedFrame, edge, sourceNode)) {
      continue;
    }

    const stillReferenced = remainingFrames.some((frame) =>
      doesStoryboardFrameReferenceIncomingEdge(frame, edge, sourceNode)
    );

    if (!stillReferenced) {
      disconnectedEdgeIds.add(edge.id);
    }
  }

  return disconnectedEdgeIds;
}

function collectNodeIdsWithDescendants(nodes: CanvasNode[], seedIds: string[]): Set<string> {
  const deleteSet = new Set(seedIds);
  let changed = true;

  while (changed) {
    changed = false;
    for (const node of nodes) {
      if (!node.parentId || deleteSet.has(node.id)) {
        continue;
      }
      if (deleteSet.has(node.parentId)) {
        deleteSet.add(node.id);
        changed = true;
      }
    }
  }

  return deleteSet;
}

function getNodeSize(node: CanvasNode): { width: number; height: number } {
  return {
    width:
      typeof node.measured?.width === 'number'
        ? node.measured.width
        : typeof node.width === 'number'
          ? node.width
          : DEFAULT_NODE_WIDTH,
    height:
      typeof node.measured?.height === 'number'
        ? node.measured.height
        : typeof node.height === 'number'
          ? node.height
          : 200,
  };
}

function resolveNumericNodeDimension(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.round(value);
  }

  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? Math.round(parsed) : null;
  }

  return null;
}

function withImageEditDefaultSize(node: CanvasNode): CanvasNode {
  return {
    ...node,
    width: IMAGE_EDIT_NODE_DEFAULT_WIDTH,
    height: IMAGE_EDIT_NODE_DEFAULT_HEIGHT,
    style: {
      ...(node.style ?? {}),
      width: IMAGE_EDIT_NODE_DEFAULT_WIDTH,
      height: IMAGE_EDIT_NODE_DEFAULT_HEIGHT,
    },
  };
}

function withScriptSceneDefaultSize(node: CanvasNode): CanvasNode {
  return {
    ...node,
    width: SCRIPT_SCENE_NODE_DEFAULT_WIDTH,
    height: SCRIPT_SCENE_NODE_DEFAULT_HEIGHT,
    style: {
      ...(node.style ?? {}),
      width: SCRIPT_SCENE_NODE_DEFAULT_WIDTH,
      height: SCRIPT_SCENE_NODE_DEFAULT_HEIGHT,
    },
  };
}

function withShootingScriptDefaultSize(node: CanvasNode): CanvasNode {
  return {
    ...node,
    width: SHOOTING_SCRIPT_NODE_DEFAULT_WIDTH,
    height: SHOOTING_SCRIPT_NODE_DEFAULT_HEIGHT,
    style: {
      ...(node.style ?? {}),
      width: SHOOTING_SCRIPT_NODE_DEFAULT_WIDTH,
      height: SHOOTING_SCRIPT_NODE_DEFAULT_HEIGHT,
    },
  };
}

function withScriptReferenceDefaultSize(node: CanvasNode): CanvasNode {
  return {
    ...node,
    width: SCRIPT_REFERENCE_NODE_DEFAULT_WIDTH,
    height: SCRIPT_REFERENCE_NODE_DEFAULT_HEIGHT,
    style: {
      ...(node.style ?? {}),
      width: SCRIPT_REFERENCE_NODE_DEFAULT_WIDTH,
      height: SCRIPT_REFERENCE_NODE_DEFAULT_HEIGHT,
    },
  };
}

function withImageCollageDefaultSize(node: CanvasNode): CanvasNode {
  return {
    ...node,
    width: IMAGE_COLLAGE_NODE_DEFAULT_WIDTH,
    height: IMAGE_COLLAGE_NODE_DEFAULT_HEIGHT,
    style: {
      ...(node.style ?? {}),
      width: IMAGE_COLLAGE_NODE_DEFAULT_WIDTH,
      height: IMAGE_COLLAGE_NODE_DEFAULT_HEIGHT,
    },
  };
}

function isScriptAssetReferenceNodeType(type: CanvasNodeType): boolean {
  return type === CANVAS_NODE_TYPES.scriptCharacterReference
    || type === CANVAS_NODE_TYPES.scriptLocationReference
    || type === CANVAS_NODE_TYPES.scriptItemReference;
}

function applyDefaultNodeSize(node: CanvasNode, data: CanvasNodeData): CanvasNode {
  if (shouldApplyImageEditDefaultSize(node, data)) {
    return withImageEditDefaultSize(node);
  }

  if (node.type === CANVAS_NODE_TYPES.imageCollage) {
    const resolvedWidth =
      resolveNumericNodeDimension(node.width)
      ?? resolveNumericNodeDimension(node.style?.width);
    const resolvedHeight =
      resolveNumericNodeDimension(node.height)
      ?? resolveNumericNodeDimension(node.style?.height);
    if (resolvedWidth === null || resolvedHeight === null) {
      return withImageCollageDefaultSize(node);
    }
  }

  if (node.type === CANVAS_NODE_TYPES.scriptScene) {
    const resolvedWidth =
      resolveNumericNodeDimension(node.width)
      ?? resolveNumericNodeDimension(node.style?.width);
    const resolvedHeight =
      resolveNumericNodeDimension(node.height)
      ?? resolveNumericNodeDimension(node.style?.height);
    if (resolvedWidth === null || resolvedHeight === null) {
      return withScriptSceneDefaultSize(node);
    }
  }

  if (node.type === CANVAS_NODE_TYPES.scriptReference || isScriptAssetReferenceNodeType(node.type)) {
    const resolvedWidth =
      resolveNumericNodeDimension(node.width)
      ?? resolveNumericNodeDimension(node.style?.width);
    const resolvedHeight =
      resolveNumericNodeDimension(node.height)
      ?? resolveNumericNodeDimension(node.style?.height);
    if (resolvedWidth === null || resolvedHeight === null) {
      return withScriptReferenceDefaultSize(node);
    }
  }

  if (node.type === CANVAS_NODE_TYPES.shootingScript) {
    const resolvedWidth =
      resolveNumericNodeDimension(node.width)
      ?? resolveNumericNodeDimension(node.style?.width);
    const resolvedHeight =
      resolveNumericNodeDimension(node.height)
      ?? resolveNumericNodeDimension(node.style?.height);
    if (resolvedWidth === null || resolvedHeight === null) {
      return withShootingScriptDefaultSize(node);
    }
  }

  return node;
}

function cleanupImageCollageNodesForRemovedEdges(
  nodes: CanvasNode[],
  previousEdges: CanvasEdge[],
  nextEdges: CanvasEdge[]
): CanvasNode[] {
  const nextEdgeById = new Map(nextEdges.map((edge) => [edge.id, edge] as const));
  const removedEdgeIds = previousEdges
    .filter((edge) => {
      const nextEdge = nextEdgeById.get(edge.id);
      return !nextEdge
        || nextEdge.source !== edge.source
        || nextEdge.target !== edge.target
        || (nextEdge.sourceHandle ?? null) !== (edge.sourceHandle ?? null)
        || (nextEdge.targetHandle ?? null) !== (edge.targetHandle ?? null);
    })
    .map((edge) => edge.id);

  if (removedEdgeIds.length === 0) {
    return nodes;
  }

  const removedEdgeIdSet = new Set(removedEdgeIds);
  let changed = false;
  const nextNodes = nodes.map((node) => {
    if (!isImageCollageNode(node)) {
      return node;
    }

    const normalizedData = normalizeImageCollageNodeData(node.data as ImageCollageNodeData);
    const remainingLayers = normalizedData.layers.filter(
      (layer) => !removedEdgeIdSet.has(layer.sourceEdgeId)
    );
    const nextSelectedLayerId = remainingLayers.some(
      (layer) => layer.sourceEdgeId === normalizedData.selectedLayerId
    )
      ? normalizedData.selectedLayerId
      : null;

    if (
      remainingLayers.length === normalizedData.layers.length
      && nextSelectedLayerId === normalizedData.selectedLayerId
    ) {
      return node;
    }

    changed = true;
    return {
      ...node,
      data: normalizeImageCollageNodeData({
        ...normalizedData,
        layers: remainingLayers,
        selectedLayerId: nextSelectedLayerId,
      }),
    };
  });

  return changed ? nextNodes : nodes;
}

function shouldApplyImageEditDefaultSize(node: CanvasNode, data: CanvasNodeData): boolean {
  if (node.type !== CANVAS_NODE_TYPES.imageEdit) {
    return false;
  }

  const imageEditData = data as ImageEditNodeData;
  if (imageEditData.isSizeManuallyAdjusted) {
    return false;
  }

  if (normalizeNonEmptyString(imageEditData.imageUrl)) {
    return false;
  }

  const resolvedWidth =
    resolveNumericNodeDimension(node.width)
    ?? resolveNumericNodeDimension(node.style?.width);
  const resolvedHeight =
    resolveNumericNodeDimension(node.height)
    ?? resolveNumericNodeDimension(node.style?.height);

  const widthMatchesLegacyDefault =
    resolvedWidth === null
    || resolvedWidth === IMAGE_EDIT_NODE_DEFAULT_WIDTH
    || LEGACY_IMAGE_EDIT_NODE_DEFAULT_WIDTHS.has(resolvedWidth);
  const heightMatchesLegacyDefault =
    resolvedHeight === null
    || resolvedHeight === IMAGE_EDIT_NODE_DEFAULT_HEIGHT
    || LEGACY_IMAGE_EDIT_NODE_DEFAULT_HEIGHTS.has(resolvedHeight);

  return widthMatchesLegacyDefault && heightMatchesLegacyDefault;
}

function collidesWithExistingNodes(
  nodes: CanvasNode[],
  nodeMap: Map<string, CanvasNode>,
  x: number,
  y: number,
  width: number,
  height: number,
  ignoredNodeIds?: Set<string>
): boolean {
  return nodes.some((node) => {
    if (ignoredNodeIds?.has(node.id)) {
      return false;
    }

    const absolutePosition = resolveAbsolutePosition(node, nodeMap);
    const nodeSize = getNodeSize(node);
    const margin = 8;
    return (
      x < absolutePosition.x + nodeSize.width + margin &&
      x + width + margin > absolutePosition.x &&
      y < absolutePosition.y + nodeSize.height + margin &&
      y + height + margin > absolutePosition.y
    );
  });
}

function resolveDerivedNodeStackGap(sourceNode: CanvasNode): number {
  return sourceNode.type === CANVAS_NODE_TYPES.imageEdit
    ? IMAGE_EDIT_DERIVED_NODE_STACK_GAP
    : DERIVED_NODE_STACK_GAP;
}

function resolvePreferredDerivedColumnPosition(
  nodes: CanvasNode[],
  edges: CanvasEdge[],
  sourceNode: CanvasNode,
  newNodeWidth: number,
  newNodeHeight: number,
  nodeMap: Map<string, CanvasNode>,
  ignoredCollisionNodeIds?: Set<string>
): { x: number; y: number } | null {
  const sourcePosition = resolveAbsolutePosition(sourceNode, nodeMap);
  const sourceSize = getNodeSize(sourceNode);
  const stackGap = resolveDerivedNodeStackGap(sourceNode);
  const anchorX = sourcePosition.x + sourceSize.width + DERIVED_NODE_COLUMN_GAP;
  const anchorY = sourcePosition.y;
  const minAcceptedColumnX = anchorX - DERIVED_NODE_COLUMN_ALIGNMENT_THRESHOLD;
  const stepX = newNodeWidth + DERIVED_NODE_NEXT_COLUMN_GAP;
  const stepY = newNodeHeight + stackGap;

  const directTargetIds = new Set(
    edges
      .filter((edge) => edge.source === sourceNode.id)
      .map((edge) => edge.target)
  );

  const directTargets = nodes.filter((node) => {
    if (!directTargetIds.has(node.id)) {
      return false;
    }

    return resolveAbsolutePosition(node, nodeMap).x >= minAcceptedColumnX;
  });

  const occupiedSlots = new Set<string>();
  for (const targetNode of directTargets) {
    const targetPosition = resolveAbsolutePosition(targetNode, nodeMap);
    const columnOffset = Math.max(0, targetPosition.x - anchorX);
    const rowOffset = Math.max(0, targetPosition.y - anchorY);
    const rawColumnIndex = Math.max(0, Math.round(columnOffset / stepX));
    const rawRowIndex = Math.max(0, Math.round(rowOffset / stepY));
    const columnIndex = rawColumnIndex + Math.floor(rawRowIndex / DERIVED_NODE_MAX_ROWS_PER_COLUMN);
    const rowIndex = rawRowIndex % DERIVED_NODE_MAX_ROWS_PER_COLUMN;
    occupiedSlots.add(`${columnIndex}:${rowIndex}`);
  }

  const maxColumnCount = Math.max(
    2,
    Math.ceil((directTargets.length + 1) / DERIVED_NODE_MAX_ROWS_PER_COLUMN) + 1
  );

  for (let columnIndex = 0; columnIndex < maxColumnCount; columnIndex += 1) {
    for (let rowIndex = 0; rowIndex < DERIVED_NODE_MAX_ROWS_PER_COLUMN; rowIndex += 1) {
      const slotKey = `${columnIndex}:${rowIndex}`;
      if (occupiedSlots.has(slotKey)) {
        continue;
      }

      const candidateX = anchorX + columnIndex * stepX;
      const candidateY = anchorY + rowIndex * stepY;
      if (
        !collidesWithExistingNodes(
          nodes,
          nodeMap,
          candidateX,
          candidateY,
          newNodeWidth,
          newNodeHeight,
          ignoredCollisionNodeIds
        )
      ) {
        return { x: candidateX, y: candidateY };
      }
    }
  }

  return null;
}

function resolveBatchDerivedNodePosition(
  nodes: CanvasNode[],
  edges: CanvasEdge[],
  sourceNode: CanvasNode,
  newNodeWidth: number,
  newNodeHeight: number
): { x: number; y: number } {
  const nodeMap = new Map(nodes.map((node) => [node.id, node] as const));
  const ignoredCollisionNodeIds = collectAncestorGroupNodeIds(sourceNode, nodeMap);
  const preferredPosition = resolvePreferredDerivedColumnPosition(
    nodes,
    edges,
    sourceNode,
    newNodeWidth,
    newNodeHeight,
    nodeMap,
    ignoredCollisionNodeIds
  );

  if (preferredPosition) {
    return preferredPosition;
  }

  const sourcePosition = resolveAbsolutePosition(sourceNode, nodeMap);
  const sourceSize = getNodeSize(sourceNode);
  const anchorX = sourcePosition.x + sourceSize.width + DERIVED_NODE_COLUMN_GAP;
  const anchorY = sourcePosition.y;
  const stepX = newNodeWidth + DERIVED_NODE_NEXT_COLUMN_GAP;
  const stepY = newNodeHeight + resolveDerivedNodeStackGap(sourceNode);

  for (let columnIndex = 0; columnIndex < 12; columnIndex += 1) {
    for (let rowIndex = 0; rowIndex < DERIVED_NODE_MAX_ROWS_PER_COLUMN; rowIndex += 1) {
      const candidateX = anchorX + columnIndex * stepX;
      const candidateY = anchorY + rowIndex * stepY;
      if (
        !collidesWithExistingNodes(
          nodes,
          nodeMap,
          candidateX,
          candidateY,
          newNodeWidth,
          newNodeHeight,
          ignoredCollisionNodeIds
        )
      ) {
        return { x: candidateX, y: candidateY };
      }
    }
  }

  return {
    x: anchorX + stepX,
    y: anchorY,
  };
}

function isImageAutoResizableType(type: CanvasNodeType): boolean {
  return type === CANVAS_NODE_TYPES.upload
    || type === CANVAS_NODE_TYPES.imageEdit
    || type === CANVAS_NODE_TYPES.exportImage;
}

function withManualSizeLock(node: CanvasNode): CanvasNode {
  const nodeData = node.data as CanvasNodeData & { isSizeManuallyAdjusted?: boolean };
  if (nodeData.isSizeManuallyAdjusted) {
    return node;
  }

  return {
    ...node,
    data: {
      ...node.data,
      isSizeManuallyAdjusted: true,
    } as CanvasNodeData,
  };
}

function resolveAutoImageNodeDimensions(
  aspectRatio: string,
  options?: {
    minWidth?: number;
    minHeight?: number;
  }
): { width: number; height: number } {
  const minWidth = options?.minWidth ?? EXPORT_RESULT_NODE_MIN_WIDTH;
  const minHeight = options?.minHeight ?? EXPORT_RESULT_NODE_MIN_HEIGHT;
  return resolveMinEdgeFittedSize(aspectRatio, { minWidth, minHeight });
}

function resolveGeneratedImageNodeDimensions(
  aspectRatio: string,
  options?: {
    minWidth?: number;
    minHeight?: number;
  }
): { width: number; height: number } {
  const size = resolveSizeInsideTargetBox(aspectRatio, {
    width: EXPORT_RESULT_NODE_DEFAULT_WIDTH,
    height: EXPORT_RESULT_NODE_LAYOUT_HEIGHT,
  });
  const minWidth = options?.minWidth ?? IMAGE_NODE_VISUAL_MIN_EDGE;
  const minHeight = options?.minHeight ?? IMAGE_NODE_VISUAL_MIN_EDGE;

  return ensureAtLeastOneMinEdge(size, { minWidth, minHeight });
}

function resolveNodeCreationDefaults(
  type: CanvasNodeType,
  data: Partial<CanvasNodeData>
): Partial<CanvasNodeData> {
  if (type === CANVAS_NODE_TYPES.imageEdit) {
    const {
      lastImageEditModelId,
      lastImageEditSize,
      lastImageEditRequestAspectRatio,
      storyboardCompatibleModelConfig,
      storyboardNewApiModelConfig,
      storyboardProviderCustomModels,
    } = useSettingsStore.getState();
    const preferredModelId = getImageModel(
      lastImageEditModelId,
      storyboardCompatibleModelConfig,
      storyboardNewApiModelConfig,
      storyboardProviderCustomModels
    ).id;
    const imageEditData = data as Partial<ImageEditNodeData>;

    return {
      model: imageEditData.model ?? preferredModelId,
      size: imageEditData.size ?? lastImageEditSize,
      requestAspectRatio:
        imageEditData.requestAspectRatio
        ?? lastImageEditRequestAspectRatio
        ?? AUTO_REQUEST_ASPECT_RATIO,
      ...imageEditData,
    } as Partial<CanvasNodeData>;
  }

  const {
    lastJimengImageModelVersion,
    lastJimengImageResolutionType,
    lastJimengImageAspectRatio,
    lastJimengVideoModel,
    lastJimengVideoReferenceMode,
    lastJimengVideoAspectRatio,
    lastJimengVideoDurationSeconds,
    lastJimengVideoResolution,
  } = useSettingsStore.getState();

  if (type === CANVAS_NODE_TYPES.jimengImage) {
    const jimengImageData = data as Partial<JimengImageNodeData>;
    const modelVersion = jimengImageData.modelVersion ?? lastJimengImageModelVersion;
    const resolutionType = normalizeJimengImageResolutionForModel(
      modelVersion,
      jimengImageData.resolutionType ?? lastJimengImageResolutionType
    );

    return {
      ...jimengImageData,
      modelVersion,
      resolutionType,
      aspectRatio: jimengImageData.aspectRatio ?? lastJimengImageAspectRatio,
    } as Partial<CanvasNodeData>;
  }

  if (type === CANVAS_NODE_TYPES.jimeng) {
    const jimengVideoData = data as Partial<JimengNodeData>;

    return {
      ...jimengVideoData,
      model: normalizeJimengVideoModel(jimengVideoData.model ?? lastJimengVideoModel),
      referenceMode: normalizeJimengReferenceMode(
        jimengVideoData.referenceMode ?? lastJimengVideoReferenceMode
      ),
      aspectRatio: jimengVideoData.aspectRatio ?? lastJimengVideoAspectRatio,
      durationSeconds:
        jimengVideoData.durationSeconds ?? lastJimengVideoDurationSeconds,
      videoResolution: jimengVideoData.videoResolution ?? lastJimengVideoResolution,
    } as Partial<CanvasNodeData>;
  }

  return data;
}

function resolveDerivedAspectRatio(
  sourceNode: CanvasNode | undefined,
  fallbackAspectRatio: string
): string {
  if (!sourceNode) {
    return fallbackAspectRatio;
  }

  if (sourceNode.type === CANVAS_NODE_TYPES.storyboardGen) {
    const data = sourceNode.data as { requestAspectRatio?: string; aspectRatio?: string };
    const preferred = data.requestAspectRatio && data.requestAspectRatio !== 'auto'
      ? data.requestAspectRatio
      : data.aspectRatio;
    return preferred || fallbackAspectRatio;
  }

  if (
    sourceNode.type === CANVAS_NODE_TYPES.storyboardSplit
    || sourceNode.type === CANVAS_NODE_TYPES.storyboardSplitResult
  ) {
    const data = sourceNode.data as { frameAspectRatio?: string; aspectRatio?: string };
    return data.frameAspectRatio || data.aspectRatio || fallbackAspectRatio;
  }

  if (sourceNode.type === CANVAS_NODE_TYPES.imageEdit) {
    const data = sourceNode.data as { requestAspectRatio?: string; aspectRatio?: string };
    const preferred = data.requestAspectRatio && data.requestAspectRatio !== 'auto'
      ? data.requestAspectRatio
      : data.aspectRatio;
    return preferred || fallbackAspectRatio;
  }

  const imageLikeAspect = (sourceNode.data as { aspectRatio?: string }).aspectRatio;
  return imageLikeAspect || fallbackAspectRatio;
}

function maybeApplyImageAutoResize(node: CanvasNode, patch: Partial<CanvasNodeData>): CanvasNode {
  if (!isImageAutoResizableType(node.type)) {
    return node;
  }

  const nodeData = node.data as CanvasNodeData & {
    imageUrl?: string | null;
    aspectRatio?: string;
    isSizeManuallyAdjusted?: boolean;
  };
  const patchData = patch as Partial<CanvasNodeData> & {
    imageUrl?: string | null;
    aspectRatio?: string;
    isSizeManuallyAdjusted?: boolean;
  };

  const hasImageRelatedChange = 'imageUrl' in patchData || 'previewImageUrl' in patchData || 'aspectRatio' in patchData;
  if (!hasImageRelatedChange) {
    return node;
  }

  const isSizeManuallyAdjusted = patchData.isSizeManuallyAdjusted ?? nodeData.isSizeManuallyAdjusted ?? false;
  if (isSizeManuallyAdjusted) {
    return node;
  }

  const nextImageUrl = patchData.imageUrl ?? nodeData.imageUrl;
  if (typeof nextImageUrl !== 'string' || nextImageUrl.trim().length === 0) {
    return node;
  }

  const nextAspectRatio = patchData.aspectRatio ?? nodeData.aspectRatio ?? DEFAULT_ASPECT_RATIO;
  const nextSize = node.type === CANVAS_NODE_TYPES.exportImage
    ? resolveAutoImageNodeDimensions(nextAspectRatio, {
      minWidth: EXPORT_RESULT_NODE_MIN_WIDTH,
      minHeight: EXPORT_RESULT_NODE_MIN_HEIGHT,
    })
    : resolveAutoImageNodeDimensions(nextAspectRatio);

  return {
    ...node,
    width: nextSize.width,
    height: nextSize.height,
    style: {
      ...(node.style ?? {}),
      width: nextSize.width,
      height: nextSize.height,
    },
  };
}

function syncAssetItemToNode(
  node: CanvasNode,
  item: AssetItemRecord
): { node: CanvasNode; changed: boolean } {
  const assetId = normalizeNonEmptyString((node.data as { assetId?: unknown }).assetId);
  if (assetId !== item.id) {
    return { node, changed: false };
  }

  const nodeData = node.data as CanvasNodeData & {
    displayName?: string;
    imageUrl?: string | null;
    audioUrl?: string | null;
    previewImageUrl?: string | null;
    aspectRatio?: string;
    audioFileName?: string | null;
    duration?: number;
    mimeType?: string | null;
    assetName?: string | null;
    assetCategory?: string | null;
    assetLibraryId?: string | null;
    sourceFileName?: string | null;
    imageWidth?: number;
    imageHeight?: number;
  };

  let changed = false;
  const patch: Partial<CanvasNodeData> = {};

  const setField = <K extends keyof typeof nodeData>(key: K, value: (typeof nodeData)[K]) => {
    if (nodeData[key] === value) {
      return;
    }
    changed = true;
    patch[key] = value as CanvasNodeData[K];
  };

  setField('displayName', item.name);
  setField('assetName', item.name);
  setField('assetCategory', item.category);
  setField('assetLibraryId', item.libraryId);

  if (item.mediaType === 'audio') {
    setField('audioUrl', item.sourcePath);
    setField('previewImageUrl', item.previewPath);
    setField('audioFileName', item.name);
    setField('duration', item.durationMs != null ? item.durationMs / 1000 : undefined);
    setField('mimeType', item.mimeType);
  } else {
    const resetImageDimensions =
      nodeData.imageUrl !== item.sourcePath
      || nodeData.previewImageUrl !== item.previewPath
      || nodeData.aspectRatio !== item.aspectRatio;

    setField('imageUrl', item.sourcePath);
    setField('previewImageUrl', item.previewPath);
    setField('aspectRatio', item.aspectRatio);
    setField('sourceFileName', item.name);

    if (resetImageDimensions) {
      if (typeof nodeData.imageWidth === 'number') {
        changed = true;
        patch.imageWidth = undefined;
      }
      if (typeof nodeData.imageHeight === 'number') {
        changed = true;
        patch.imageHeight = undefined;
      }
    }
  }

  if (!changed) {
    return { node, changed: false };
  }

  const nextNode = maybeApplyImageAutoResize(
    {
      ...node,
      data: {
        ...node.data,
        ...patch,
      } as CanvasNodeData,
    },
    patch
  );

  return { node: nextNode, changed: true };
}

function detachDeletedAssetReferenceFromNode(
  node: CanvasNode,
  assetItemId: string
): { node: CanvasNode; changed: boolean } {
  const assetId = normalizeNonEmptyString((node.data as { assetId?: unknown }).assetId);
  if (assetId !== assetItemId) {
    return { node, changed: false };
  }

  const nodeData = node.data as CanvasNodeData & {
    assetId?: string | null;
    assetLibraryId?: string | null;
    assetName?: string | null;
    assetCategory?: string | null;
  };

  const changed =
    nodeData.assetId !== null
    || nodeData.assetLibraryId !== null
    || nodeData.assetName !== null
    || nodeData.assetCategory !== null;

  if (!changed) {
    return { node, changed: false };
  }

  return {
    node: {
      ...node,
      data: {
        ...node.data,
        assetId: null,
        assetLibraryId: null,
        assetName: null,
        assetCategory: null,
      } as CanvasNodeData,
    },
    changed: true,
  };
}

function syncAssetItemAcrossNodes(
  nodes: CanvasNode[],
  item: AssetItemRecord
): { nodes: CanvasNode[]; changed: boolean } {
  let changed = false;
  const nextNodes = nodes.map((node) => {
    const result = syncAssetItemToNode(node, item);
    changed ||= result.changed;
    return result.node;
  });

  return {
    nodes: changed ? nextNodes : nodes,
    changed,
  };
}

function detachDeletedAssetAcrossNodes(
  nodes: CanvasNode[],
  assetItemId: string
): { nodes: CanvasNode[]; changed: boolean } {
  let changed = false;
  const nextNodes = nodes.map((node) => {
    const result = detachDeletedAssetReferenceFromNode(node, assetItemId);
    changed ||= result.changed;
    return result.node;
  });

  return {
    nodes: changed ? nextNodes : nodes,
    changed,
  };
}

function mapHistorySnapshots(
  history: CanvasHistoryState,
  mapNodes: (nodes: CanvasNode[]) => { nodes: CanvasNode[]; changed: boolean }
): { history: CanvasHistoryState; changed: boolean } {
  let changed = false;

  const mapTimeline = (timeline: CanvasHistorySnapshot[]): CanvasHistorySnapshot[] =>
    timeline.map((snapshot) => {
      if (isCanvasNodePatchHistorySnapshot(snapshot)) {
        const patchNodes = snapshot.entries
          .map((entry) => entry.node)
          .filter((node): node is CanvasNode => Boolean(node));
        const result = mapNodes(patchNodes);
        changed ||= result.changed;
        if (!result.changed) {
          return snapshot;
        }

        let nextNodeIndex = 0;
        return {
          kind: 'nodePatch',
          entries: snapshot.entries.map((entry) => {
            if (!entry.node) {
              return entry;
            }

            const nextNode = result.nodes[nextNodeIndex] ?? entry.node;
            nextNodeIndex += 1;
            return {
              nodeId: entry.nodeId,
              node: nextNode,
            };
          }),
        };
      }

      const result = mapNodes(snapshot.nodes);
      changed ||= result.changed;
      return result.changed
        ? {
            ...snapshot,
            nodes: result.nodes,
          }
        : snapshot;
    });

  const nextHistory = {
    past: mapTimeline(history.past),
    future: mapTimeline(history.future),
  };

  return {
    history: changed ? nextHistory : history,
    changed,
  };
}

function resolveAbsolutePosition(
  node: CanvasNode,
  nodeMap: Map<string, CanvasNode>
): { x: number; y: number } {
  let x = node.position.x;
  let y = node.position.y;
  let currentParentId = node.parentId;
  const visited = new Set<string>();

  while (currentParentId && !visited.has(currentParentId)) {
    visited.add(currentParentId);
    const parent = nodeMap.get(currentParentId);
    if (!parent) {
      break;
    }
    x += parent.position.x;
    y += parent.position.y;
    currentParentId = parent.parentId;
  }

  return { x, y };
}

function collectAncestorGroupNodeIds(
  node: CanvasNode,
  nodeMap: Map<string, CanvasNode>
): Set<string> {
  const groupIds = new Set<string>();
  let currentParentId = node.parentId;
  const visited = new Set<string>();

  while (currentParentId && !visited.has(currentParentId)) {
    visited.add(currentParentId);
    const parentNode = nodeMap.get(currentParentId);
    if (!parentNode) {
      break;
    }

    if (parentNode.type === CANVAS_NODE_TYPES.group) {
      groupIds.add(parentNode.id);
    }

    currentParentId = parentNode.parentId;
  }

  return groupIds;
}

function isGroupNodeId(nodeId: string | undefined, nodeMap: Map<string, CanvasNode>): boolean {
  if (!nodeId) {
    return false;
  }

  return nodeMap.get(nodeId)?.type === CANVAS_NODE_TYPES.group;
}

function resolveInheritedGroupParentId(
  sourceNode: CanvasNode | undefined,
  nodeMap: Map<string, CanvasNode>
): string | undefined {
  if (!sourceNode?.parentId) {
    return undefined;
  }

  return isGroupNodeId(sourceNode.parentId, nodeMap) ? sourceNode.parentId : undefined;
}

function attachNodeToGroupParent(
  node: CanvasNode,
  position: { x: number; y: number },
  parentGroupId: string | undefined,
  nodeMap: Map<string, CanvasNode>,
  positionSpace: 'canvas' | 'parent' = 'canvas'
): CanvasNode {
  if (!parentGroupId) {
    return node;
  }

  const parentNode = nodeMap.get(parentGroupId);
  if (parentNode?.type !== CANVAS_NODE_TYPES.group) {
    return node;
  }

  const parentAbsolutePosition = resolveAbsolutePosition(parentNode, nodeMap);
  const nextPosition = positionSpace === 'parent'
    ? {
        x: Math.round(position.x),
        y: Math.round(position.y),
      }
    : {
        x: Math.round(position.x - parentAbsolutePosition.x),
        y: Math.round(position.y - parentAbsolutePosition.y),
      };

  return {
    ...node,
    parentId: parentGroupId,
    extent: undefined,
    position: nextPosition,
  };
}

function fitGroupNodeToChildren(nodes: CanvasNode[], groupNodeId: string): CanvasNode[] {
  const nodeMap = new Map(nodes.map((node) => [node.id, node] as const));
  const groupNode = nodeMap.get(groupNodeId);
  if (!groupNode || groupNode.type !== CANVAS_NODE_TYPES.group) {
    return nodes;
  }

  const directChildren = nodes.filter((node) => node.parentId === groupNodeId);
  if (directChildren.length === 0) {
    return nodes;
  }

  const groupAbsolutePosition = resolveAbsolutePosition(groupNode, nodeMap);
  const groupSize = getNodeSize(groupNode);
  const childBounds = directChildren.reduce(
    (acc, childNode) => {
      const absolutePosition = resolveAbsolutePosition(childNode, nodeMap);
      const childSize = getNodeSize(childNode);
      return {
        minX: Math.min(acc.minX, absolutePosition.x),
        minY: Math.min(acc.minY, absolutePosition.y),
        maxX: Math.max(acc.maxX, absolutePosition.x + childSize.width),
        maxY: Math.max(acc.maxY, absolutePosition.y + childSize.height),
      };
    },
    {
      minX: Number.POSITIVE_INFINITY,
      minY: Number.POSITIVE_INFINITY,
      maxX: Number.NEGATIVE_INFINITY,
      maxY: Number.NEGATIVE_INFINITY,
    }
  );

  if (!Number.isFinite(childBounds.minX) || !Number.isFinite(childBounds.minY)) {
    return nodes;
  }

  const nextAbsoluteX = Math.round(
    Math.min(groupAbsolutePosition.x, childBounds.minX - GROUP_NODE_SIDE_PADDING)
  );
  const nextAbsoluteY = Math.round(
    Math.min(groupAbsolutePosition.y, childBounds.minY - GROUP_NODE_TOP_PADDING)
  );
  const nextRight = Math.round(
    Math.max(groupAbsolutePosition.x + groupSize.width, childBounds.maxX + GROUP_NODE_SIDE_PADDING)
  );
  const nextBottom = Math.round(
    Math.max(groupAbsolutePosition.y + groupSize.height, childBounds.maxY + GROUP_NODE_BOTTOM_PADDING)
  );
  const nextWidth = Math.max(220, nextRight - nextAbsoluteX);
  const nextHeight = Math.max(140, nextBottom - nextAbsoluteY);

  const parentNode = groupNode.parentId ? nodeMap.get(groupNode.parentId) : undefined;
  const parentAbsolutePosition = parentNode
    ? resolveAbsolutePosition(parentNode, nodeMap)
    : { x: 0, y: 0 };
  const nextGroupPosition = {
    x: nextAbsoluteX - parentAbsolutePosition.x,
    y: nextAbsoluteY - parentAbsolutePosition.y,
  };
  const didMoveGroup =
    Math.round(groupNode.position.x) !== Math.round(nextGroupPosition.x)
    || Math.round(groupNode.position.y) !== Math.round(nextGroupPosition.y);
  const didResizeGroup =
    Math.round(groupSize.width) !== nextWidth || Math.round(groupSize.height) !== nextHeight;

  if (!didMoveGroup && !didResizeGroup) {
    return nodes;
  }

  return nodes.map((node) => {
    if (node.id === groupNodeId) {
      return {
        ...node,
        position: nextGroupPosition,
        width: nextWidth,
        height: nextHeight,
        style: {
          ...(node.style ?? {}),
          width: nextWidth,
          height: nextHeight,
        },
      };
    }

    if (node.parentId !== groupNodeId) {
      return node;
    }

    const absolutePosition = resolveAbsolutePosition(node, nodeMap);
    return {
      ...node,
      position: {
        x: Math.round(absolutePosition.x - nextAbsoluteX),
        y: Math.round(absolutePosition.y - nextAbsoluteY),
      },
    };
  });
}

function pushSnapshot(
  snapshots: CanvasHistorySnapshot[],
  snapshot: CanvasHistorySnapshot
): CanvasHistorySnapshot[] {
  const last = snapshots[snapshots.length - 1];
  if (last) {
    if (
      !isCanvasNodePatchHistorySnapshot(last)
      && !isCanvasNodePatchHistorySnapshot(snapshot)
      && last.nodes === snapshot.nodes
      && last.edges === snapshot.edges
    ) {
      return snapshots;
    }

    if (
      isCanvasNodePatchHistorySnapshot(last)
      && isCanvasNodePatchHistorySnapshot(snapshot)
      && last.entries === snapshot.entries
    ) {
      return snapshots;
    }
  }

  const next = [...snapshots, snapshot];
  if (next.length > MAX_HISTORY_STEPS) {
    next.shift();
  }
  return trimSnapshotTimeline(next);
}

function resolveSelectedNodeId(selectedNodeId: string | null, nodes: CanvasNode[]): string | null {
  if (!selectedNodeId) {
    return null;
  }
  return nodes.some((node) => node.id === selectedNodeId) ? selectedNodeId : null;
}

function resolveActiveToolDialog(
  activeToolDialog: ActiveToolDialog | null,
  nodes: CanvasNode[]
): ActiveToolDialog | null {
  if (!activeToolDialog) {
    return null;
  }
  return nodes.some((node) => node.id === activeToolDialog.nodeId) ? activeToolDialog : null;
}

function createDefaultStoryboardExportOptions(): StoryboardExportOptions {
  return {
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
  };
}

export const useCanvasStore = create<CanvasState>((set, get) => ({
  nodes: [],
  edges: [],
  selectedNodeId: null,
  highlightedReferenceSourceNodeId: null,
  activeToolDialog: null,
  nodeDescriptionPanelOpenById: {},
  history: { past: [], future: [] },
  dragHistorySnapshot: null,
  currentViewport: { x: 0, y: 0, zoom: 1 },
  canvasViewportSize: { width: 0, height: 0 },
  imageViewer: {
    isOpen: false,
    currentImageUrl: null,
    imageList: [],
    currentIndex: 0,
  },

  // 网格设置默认值
  snapToGrid: true,
  snapGridSize: 20,

  // 节点对齐默认值
  enableNodeAlignment: true,
  alignmentThreshold: 10,

  onNodesChange: (changes) => {
    set((state) => {
      const resizedNodeIds = new Set(
        changes
          .filter(
            (
              change
            ): change is NodeChange<CanvasNode> & {
              id: string;
              setAttributes?: boolean | 'width' | 'height';
            } =>
              change.type === 'dimensions'
              && 'resizing' in change
              && change.resizing === false
              && typeof change.id === 'string'
              && 'setAttributes' in change
              && Boolean(change.setAttributes)
          )
          .map((change) => change.id)
      );

      let nextNodes = applyNodeChangesLocal(changes, state.nodes);
      if (resizedNodeIds.size > 0) {
        nextNodes = nextNodes.map((node) => {
          if (!resizedNodeIds.has(node.id) || !isImageAutoResizableType(node.type)) {
            return node;
          }
          return withManualSizeLock(node);
        });
      }
      const hasMeaningfulChange = changes.some((change) => change.type !== 'select');
      const hasDragMove = changes.some(
        (change) =>
          change.type === 'position' &&
          'dragging' in change &&
          Boolean(change.dragging)
      );
      const hasDragEnd = changes.some(
        (change) =>
          change.type === 'position' &&
          'dragging' in change &&
          change.dragging === false
      );
      const hasResizeMove = changes.some(
        (change) =>
          change.type === 'dimensions' &&
          'resizing' in change &&
          Boolean(change.resizing)
      );
      const hasResizeEnd = changes.some(
        (change) =>
          change.type === 'dimensions' &&
          'resizing' in change &&
          change.resizing === false
      );
      const interactionNodeIds = changes
        .filter((change): change is NodeChange<CanvasNode> & { id: string } =>
          (change.type === 'position' || change.type === 'dimensions')
          && typeof change.id === 'string'
        )
        .map((change) => change.id);
      const hasInteractionMove = hasDragMove || hasResizeMove;
      const hasInteractionEnd = hasDragEnd || hasResizeEnd;

      let nextHistory = state.history;
      let nextDragHistorySnapshot = state.dragHistorySnapshot;

      if (hasInteractionMove && !nextDragHistorySnapshot) {
        nextDragHistorySnapshot = createSnapshot(state.nodes, state.edges);
      }

      if (hasInteractionEnd) {
        const snapshot = nextDragHistorySnapshot
          && !isCanvasNodePatchHistorySnapshot(nextDragHistorySnapshot)
          && interactionNodeIds.length > 0
          ? createNodePatchSnapshot(
              nextDragHistorySnapshot.nodes,
              interactionNodeIds,
              nextDragHistorySnapshot.edges
            )
          : nextDragHistorySnapshot ?? createSnapshot(state.nodes, state.edges);
        nextHistory = {
          past: pushSnapshot(state.history.past, snapshot),
          future: [],
        };
        nextDragHistorySnapshot = null;
      } else if (hasMeaningfulChange && !hasInteractionMove) {
        nextHistory = {
          past: pushSnapshot(state.history.past, createSnapshot(state.nodes, state.edges)),
          future: [],
        };
        nextDragHistorySnapshot = null;
      }

      return {
        nodes: nextNodes,
        selectedNodeId: resolveSelectedNodeId(state.selectedNodeId, nextNodes),
        activeToolDialog: resolveActiveToolDialog(state.activeToolDialog, nextNodes),
        history: nextHistory,
        dragHistorySnapshot: nextDragHistorySnapshot,
      };
    });
  },

  onEdgesChange: (changes) => {
    set((state) => {
      const nextEdges = applyEdgeChangesLocal(changes, state.edges);
      const nextNodes = cleanupImageCollageNodesForRemovedEdges(state.nodes, state.edges, nextEdges);
      const hasMeaningfulChange = changes.some((change) => change.type !== 'select');

      if (!hasMeaningfulChange) {
        return { edges: nextEdges };
      }

      return {
        nodes: nextNodes,
        edges: nextEdges,
        history: {
          past: pushSnapshot(state.history.past, createSnapshot(state.nodes, state.edges)),
          future: [],
        },
        dragHistorySnapshot: null,
      };
    });
  },

  onConnect: (connection) => {
    const sourceHandle = normalizeHandleId(connection.sourceHandle) ?? 'source';
    const targetHandle = normalizeHandleId(connection.targetHandle) ?? 'target';
    set((state) => ({
      edges: addEdgeLocal(
        { ...connection, sourceHandle, targetHandle, type: 'disconnectableEdge' },
        state.edges
      ),
      history: {
        past: pushSnapshot(state.history.past, createSnapshot(state.nodes, state.edges)),
        future: [],
      },
      dragHistorySnapshot: null,
    }));
  },

  setCanvasData: (nodes, edges, history) => {
    const normalizedNodes = normalizeNodes(nodes);
    const normalizedEdges = normalizeEdgesWithNodes(edges, normalizedNodes);

    set({
      nodes: normalizedNodes,
      edges: normalizedEdges,
      selectedNodeId: null,
      highlightedReferenceSourceNodeId: null,
      activeToolDialog: null,
      nodeDescriptionPanelOpenById: {},
      history: normalizeHistory(history),
      dragHistorySnapshot: null,
    });
  },

  setViewportState: (viewport) => {
    set({ currentViewport: viewport });
  },

  setCanvasViewportSize: (size) => {
    set({ canvasViewportSize: size });
  },

  openImageViewer: (imageUrl, imageList = []) => {
    const list = imageList.length > 0 ? imageList : [imageUrl];
    const index = list.indexOf(imageUrl);
    set({
      imageViewer: {
        isOpen: true,
        currentImageUrl: imageUrl,
        imageList: list,
        currentIndex: index >= 0 ? index : 0,
      },
    });
  },

  closeImageViewer: () => {
    set({
      imageViewer: {
        isOpen: false,
        currentImageUrl: null,
        imageList: [],
        currentIndex: 0,
      },
    });
  },

  navigateImageViewer: (direction) => {
    const state = get();
    const { currentIndex, imageList } = state.imageViewer;
    if (direction === 'prev' && currentIndex > 0) {
      const newIndex = currentIndex - 1;
      set({
        imageViewer: {
          ...state.imageViewer,
          currentIndex: newIndex,
          currentImageUrl: imageList[newIndex],
        },
      });
    } else if (direction === 'next' && currentIndex < imageList.length - 1) {
      const newIndex = currentIndex + 1;
      set({
        imageViewer: {
          ...state.imageViewer,
          currentIndex: newIndex,
          currentImageUrl: imageList[newIndex],
        },
      });
    }
  },

  addNode: (type, position, data = {}, options = {}) => {
      const state = get();
      const initialData = resolveNodeCreationDefaults(type, data);
      const sourceNode = options.inheritParentFromNodeId
        ? state.nodes.find((node) => node.id === options.inheritParentFromNodeId)
        : undefined;
      const nodeMap = new Map(state.nodes.map((node) => [node.id, node] as const));
      const parentGroupId = options.parentId ?? resolveInheritedGroupParentId(sourceNode, nodeMap);
      const createdNode = canvasNodeFactory.createNode(type, position, initialData);
      const sizedNode = applyDefaultNodeSize(createdNode, createdNode.data);
      const newNode = attachNodeToGroupParent(
        sizedNode,
        position,
        parentGroupId,
        nodeMap,
        options.positionSpace ?? 'canvas'
      );
    const nextNodes = parentGroupId
      ? fitGroupNodeToChildren([...state.nodes, newNode], parentGroupId)
      : [...state.nodes, newNode];
    set({
      nodes: nextNodes,
      history: {
        past: pushSnapshot(state.history.past, createSnapshot(state.nodes, state.edges)),
        future: [],
      },
      dragHistorySnapshot: null,
    });
    return newNode.id;
  },

  addEdge: (source, target) => {
    const state = get();
    const sourceNode = state.nodes.find((n) => n.id === source);
    const targetNode = state.nodes.find((n) => n.id === target);
    if (!sourceNode || !targetNode) {
      return null;
    }
    if (!nodeHasSourceHandle(sourceNode.type) || !nodeHasTargetHandle(targetNode.type)) {
      return null;
    }

    const edgeId = `e-${source}-${target}`;
    if (state.edges.some((e) => e.id === edgeId)) {
      return edgeId;
    }

    const newEdge: CanvasEdge = {
      id: edgeId,
      source,
      target,
      sourceHandle: 'source',
      targetHandle: 'target',
      type: 'disconnectableEdge',
    };

    const isBranchToChapterConnection =
      sourceNode.type === CANVAS_NODE_TYPES.scriptChapter &&
      targetNode.type === CANVAS_NODE_TYPES.scriptChapter &&
      (sourceNode.data as ScriptChapterNodeData)?.branchType === 'branch';

    console.log('[Debug addEdge] source:', source, 'target:', target, 'isBranchToChapterConnection:', isBranchToChapterConnection, 'sourceBranchType:', (sourceNode.data as ScriptChapterNodeData)?.branchType);

    let updatedNodes = state.nodes;
    if (isBranchToChapterConnection) {
      const targetData = targetNode.data as ScriptChapterNodeData;
      const existingMergedFrom = targetData.mergedFromBranches || [];
      const newMergedFrom = [...new Set([...existingMergedFrom, source])];
      console.log('[Debug addEdge] newMergedFrom:', newMergedFrom);

      if (newMergedFrom.length >= 2) {
        updatedNodes = state.nodes.map((n) => {
          if (n.id === target) {
            return {
              ...n,
              data: {
                ...n.data,
                isMergePoint: true,
                mergedFromBranches: newMergedFrom,
              },
            };
          }
          return n;
        });
      } else {
        updatedNodes = state.nodes.map((n) => {
          if (n.id === target) {
            return {
              ...n,
              data: {
                ...n.data,
                mergedFromBranches: newMergedFrom,
              },
            };
          }
          return n;
        });
      }
    }

    set({
      edges: [...state.edges, newEdge],
      nodes: updatedNodes,
    });

    return edgeId;
  },

  findNodePosition: (sourceNodeId, newNodeWidth, newNodeHeight) => {
    const state = get();
    const sourceNode = state.nodes.find((n) => n.id === sourceNodeId);
    if (!sourceNode) {
      return { x: 100, y: 100 };
    }
    const nodeMap = new Map(state.nodes.map((node) => [node.id, node] as const));
    const sourcePosition = resolveAbsolutePosition(sourceNode, nodeMap);
    const ignoredCollisionNodeIds = collectAncestorGroupNodeIds(sourceNode, nodeMap);

    const preferredColumnPosition = resolvePreferredDerivedColumnPosition(
      state.nodes,
      state.edges,
      sourceNode,
      newNodeWidth,
      newNodeHeight,
      nodeMap,
      ignoredCollisionNodeIds
    );
    if (preferredColumnPosition) {
      return preferredColumnPosition;
    }

    const sourceSize = getNodeSize(sourceNode);
    const stackGap = resolveDerivedNodeStackGap(sourceNode);
    const anchorX = sourcePosition.x + sourceSize.width + DERIVED_NODE_COLUMN_GAP;
    const anchorY = sourcePosition.y;

    const zoom = Math.max(0.01, state.currentViewport.zoom || 1);
    const viewportWidth = state.canvasViewportSize.width;
    const viewportHeight = state.canvasViewportSize.height;
    const hasViewportBounds = viewportWidth > 0 && viewportHeight > 0;
    const visibleBounds = hasViewportBounds
      ? {
          minX: -state.currentViewport.x / zoom,
          minY: -state.currentViewport.y / zoom,
          maxX: -state.currentViewport.x / zoom + viewportWidth / zoom,
          maxY: -state.currentViewport.y / zoom + viewportHeight / zoom,
        }
      : null;

    const overflowAmount = (x: number, y: number): number => {
      if (!visibleBounds) {
        return 0;
      }
      const overLeft = Math.max(0, visibleBounds.minX - x);
      const overTop = Math.max(0, visibleBounds.minY - y);
      const overRight = Math.max(0, x + newNodeWidth - visibleBounds.maxX);
      const overBottom = Math.max(0, y + newNodeHeight - visibleBounds.maxY);
      return overLeft + overTop + overRight + overBottom;
    };

    const stepX = Math.max(newNodeWidth + 12, 110);
    const stepY = sourceNode.type === CANVAS_NODE_TYPES.imageEdit
      ? newNodeHeight + stackGap
      : Math.max(Math.round(newNodeHeight * 0.35), 54);
    const baseCandidates = [
      { x: anchorX, y: anchorY },
      { x: sourcePosition.x, y: sourcePosition.y + sourceSize.height + stackGap },
      { x: sourcePosition.x - newNodeWidth - 20, y: sourcePosition.y },
      { x: sourcePosition.x, y: sourcePosition.y - newNodeHeight - stackGap },
    ];

    let bestInView: { x: number; y: number; score: number } | null = null;
    let bestOutOfView: { x: number; y: number; score: number } | null = null;

    const evaluateCandidate = (x: number, y: number) => {
      if (
        collidesWithExistingNodes(
          state.nodes,
          nodeMap,
          x,
          y,
          newNodeWidth,
          newNodeHeight,
          ignoredCollisionNodeIds
        )
      ) {
        return;
      }

      const dx = x - anchorX;
      const dy = y - anchorY;
      const distanceScore = Math.hypot(dx, dy);
      const upwardPenalty = dy < 0 ? Math.abs(dy) * 0.25 : 0;
      const overflow = overflowAmount(x, y);
      const score = distanceScore + upwardPenalty + overflow * 1000;
      const candidate = { x, y, score };

      if (overflow === 0) {
        if (!bestInView || score < bestInView.score) {
          bestInView = candidate;
        }
      } else if (!bestOutOfView || score < bestOutOfView.score) {
        bestOutOfView = candidate;
      }
    };

    for (const base of baseCandidates) {
      evaluateCandidate(base.x, base.y);
    }

    for (let ring = 1; ring <= 8; ring += 1) {
      const offsets = [
        { x: ring, y: 0 },
        { x: ring, y: 1 },
        { x: ring, y: -1 },
        { x: 0, y: ring },
        { x: 0, y: -ring },
        { x: -ring, y: 0 },
        { x: ring, y: 2 },
        { x: ring, y: -2 },
        { x: -ring, y: 1 },
        { x: -ring, y: -1 },
      ];
      for (const offset of offsets) {
        evaluateCandidate(anchorX + offset.x * stepX, anchorY + offset.y * stepY);
      }
    }

    // If ring sampling misses an available slot in current viewport,
    // run a denser viewport sweep before falling back outside view.
    if (!bestInView && visibleBounds) {
      const padding = 8;
      const minX = visibleBounds.minX + padding;
      const maxX = visibleBounds.maxX - newNodeWidth - padding;
      const minY = visibleBounds.minY + padding;
      const maxY = visibleBounds.maxY - newNodeHeight - padding;

      if (maxX >= minX && maxY >= minY) {
        const scanStepX = Math.max(42, Math.round(newNodeWidth * 0.32));
        const scanStepY = Math.max(42, Math.round(newNodeHeight * 0.32));

        for (let y = minY; y <= maxY; y += scanStepY) {
          for (let x = minX; x <= maxX; x += scanStepX) {
            evaluateCandidate(x, y);
          }
        }

        // Ensure boundary positions are also considered.
        evaluateCandidate(minX, minY);
        evaluateCandidate(maxX, minY);
        evaluateCandidate(minX, maxY);
        evaluateCandidate(maxX, maxY);
      }
    }

    const resolvedCandidate = (bestInView || bestOutOfView) as
      | { x: number; y: number; score: number }
      | null;
    if (resolvedCandidate) {
      return { x: resolvedCandidate.x, y: resolvedCandidate.y };
    }

    return { x: anchorX + 2 * stepX, y: anchorY };
  },

  addDerivedUploadNode: (sourceNodeId, imageUrl, aspectRatio, previewImageUrl) => {
    const state = get();
    const sourceNode = state.nodes.find((node) => node.id === sourceNodeId);
    const nodeMap = new Map(state.nodes.map((node) => [node.id, node] as const));
    const parentGroupId = resolveInheritedGroupParentId(sourceNode, nodeMap);
    const resolvedAspectRatio = resolveDerivedAspectRatio(sourceNode, aspectRatio);
    const derivedSize = resolveGeneratedImageNodeDimensions(resolvedAspectRatio);
    const position = state.findNodePosition(
      sourceNodeId,
      derivedSize.width,
      derivedSize.height
    );
    let node = canvasNodeFactory.createNode(CANVAS_NODE_TYPES.upload, position, {
      imageUrl,
      previewImageUrl: previewImageUrl ?? null,
      aspectRatio: resolvedAspectRatio,
    });
    node.width = derivedSize.width;
    node.height = derivedSize.height;
    node.style = {
      ...(node.style ?? {}),
      width: derivedSize.width,
      height: derivedSize.height,
    };
    node = attachNodeToGroupParent(node, position, parentGroupId, nodeMap);
    const nextNodes = parentGroupId
      ? fitGroupNodeToChildren([...state.nodes, node], parentGroupId)
      : [...state.nodes, node];

    set({
      nodes: nextNodes,
      selectedNodeId: node.id,
      activeToolDialog: null,
      history: {
        past: pushSnapshot(state.history.past, createSnapshot(state.nodes, state.edges)),
        future: [],
      },
      dragHistorySnapshot: null,
    });

    return node.id;
  },

  addDerivedExportNode: (sourceNodeId, imageUrl, aspectRatio, previewImageUrl, options) => {
    const state = get();
    const sourceNode = state.nodes.find((node) => node.id === sourceNodeId);
    const nodeMap = new Map(state.nodes.map((node) => [node.id, node] as const));
    const parentGroupId = resolveInheritedGroupParentId(sourceNode, nodeMap);
    const aspectRatioStrategy = options?.aspectRatioStrategy ?? 'provided';
    const resolvedAspectRatio = aspectRatioStrategy === 'derivedFromSource'
      ? resolveDerivedAspectRatio(sourceNode, aspectRatio)
      : (aspectRatio || resolveDerivedAspectRatio(sourceNode, DEFAULT_ASPECT_RATIO));
    const autoSize = resolveAutoImageNodeDimensions(resolvedAspectRatio, {
      minWidth: EXPORT_RESULT_NODE_MIN_WIDTH,
      minHeight: EXPORT_RESULT_NODE_MIN_HEIGHT,
    });
    const generatedSize = resolveGeneratedImageNodeDimensions(resolvedAspectRatio, {
      minWidth: EXPORT_RESULT_NODE_MIN_WIDTH,
      minHeight: EXPORT_RESULT_NODE_MIN_HEIGHT,
    });
    const sourceSize = sourceNode ? getNodeSize(sourceNode) : null;
    const sizeStrategy = options?.sizeStrategy
      ?? (options?.matchSourceNodeSize ? 'matchSource' : 'generated');
    let derivedSize = generatedSize;
    if (sizeStrategy === 'autoMinEdge') {
      derivedSize = autoSize;
    } else if (sizeStrategy === 'matchSource' && sourceSize) {
      derivedSize = {
        width: Math.max(1, Math.round(sourceSize.width)),
        height: Math.max(1, Math.round(sourceSize.height)),
      };
    }
    const position = state.findNodePosition(
      sourceNodeId,
      derivedSize.width,
      derivedSize.height
    );
    const exportNodeData: Partial<CanvasNodeData> = {
      imageUrl,
      previewImageUrl: previewImageUrl ?? null,
      aspectRatio: resolvedAspectRatio,
    };
    if (options?.defaultTitle) {
      (exportNodeData as { displayName?: string }).displayName = options.defaultTitle;
    }
    if (options?.resultKind) {
      (exportNodeData as { resultKind?: ExportImageNodeResultKind }).resultKind = options.resultKind;
      if (!options.defaultTitle) {
        (exportNodeData as { displayName?: string }).displayName =
          EXPORT_RESULT_DISPLAY_NAME[options.resultKind];
      }
    }
    let node = canvasNodeFactory.createNode(CANVAS_NODE_TYPES.exportImage, position, {
      ...exportNodeData,
    });
    node.width = derivedSize.width;
    node.height = derivedSize.height;
    node.style = {
      ...(node.style ?? {}),
      width: derivedSize.width,
      height: derivedSize.height,
    };
    node = attachNodeToGroupParent(node, position, parentGroupId, nodeMap);
    const nextNodes = parentGroupId
      ? fitGroupNodeToChildren([...state.nodes, node], parentGroupId)
      : [...state.nodes, node];
    const nextEdges = options?.connectToSource && sourceNode && nodeHasSourceHandle(sourceNode.type)
      ? addEdgeLocal({
        id: `e-${sourceNodeId}-${node.id}`,
        source: sourceNodeId,
        target: node.id,
        sourceHandle: 'source',
        targetHandle: 'target',
        type: 'disconnectableEdge',
      }, state.edges)
      : state.edges;

    set({
      nodes: nextNodes,
      edges: nextEdges,
      selectedNodeId: node.id,
      activeToolDialog: null,
      history: {
        past: pushSnapshot(state.history.past, createSnapshot(state.nodes, state.edges)),
        future: [],
      },
      dragHistorySnapshot: null,
    });

    return node.id;
  },

  addStoryboardSplitFrameExportNodes: (sourceNodeId, frames, options) => {
    const state = get();
    const sourceNode = state.nodes.find((node) => node.id === sourceNodeId);
    if (!sourceNode) {
      return [];
    }

    const frameEntries = frames.filter((frame) => typeof frame.imageUrl === 'string' && frame.imageUrl.trim().length > 0);
    if (frameEntries.length === 0) {
      return [];
    }

    const nodeMap = new Map(state.nodes.map((node) => [node.id, node] as const));
    const parentGroupId = resolveInheritedGroupParentId(sourceNode, nodeMap);
    const sourcePosition = resolveAbsolutePosition(sourceNode, nodeMap);
    const sourceSize = getNodeSize(sourceNode);
    const safeGridCols = Math.max(1, Math.floor(options?.gridCols ?? 3));
    const createdNodeIds: string[] = [];
    const createdNodes: CanvasNode[] = [];
    const nextEdges = [...state.edges];
    const baseX = sourcePosition.x + sourceSize.width + DERIVED_NODE_COLUMN_GAP;
    const baseY = sourcePosition.y;

    frameEntries.forEach((frame, index) => {
      const resolvedAspectRatio =
        (typeof frame.aspectRatio === 'string' && frame.aspectRatio.trim().length > 0)
          ? frame.aspectRatio
          : DEFAULT_ASPECT_RATIO;
      const derivedSize = resolveGeneratedImageNodeDimensions(resolvedAspectRatio, {
        minWidth: EXPORT_RESULT_NODE_MIN_WIDTH,
        minHeight: EXPORT_RESULT_NODE_MIN_HEIGHT,
      });
      const columnIndex = index % safeGridCols;
      const rowIndex = Math.floor(index / safeGridCols);
      const absolutePosition = {
        x: baseX + columnIndex * (derivedSize.width + DERIVED_NODE_COLUMN_GAP),
        y: baseY + rowIndex * (derivedSize.height + DERIVED_NODE_STACK_GAP),
      };
      const nodeData: Partial<CanvasNodeData> = {
        imageUrl: frame.imageUrl,
        previewImageUrl: frame.previewImageUrl ?? null,
        aspectRatio: resolvedAspectRatio,
        resultKind: 'storyboardFrameEdit',
        displayName: frame.title?.trim() || EXPORT_RESULT_DISPLAY_NAME.storyboardFrameEdit,
      };
      let node = canvasNodeFactory.createNode(
        CANVAS_NODE_TYPES.exportImage,
        absolutePosition,
        nodeData
      );
      node.width = derivedSize.width;
      node.height = derivedSize.height;
      node.style = {
        ...(node.style ?? {}),
        width: derivedSize.width,
        height: derivedSize.height,
      };
      node = attachNodeToGroupParent(node, absolutePosition, parentGroupId, nodeMap);
      createdNodes.push(node);
      createdNodeIds.push(node.id);
      nodeMap.set(node.id, node);
      nextEdges.push({
        id: `e-${sourceNodeId}-${node.id}`,
        source: sourceNodeId,
        target: node.id,
        sourceHandle: 'source',
        targetHandle: 'target',
        type: 'disconnectableEdge',
      });
    });

    const nextNodesBase = [...state.nodes, ...createdNodes];
    const nextNodes = parentGroupId
      ? fitGroupNodeToChildren(nextNodesBase, parentGroupId)
      : nextNodesBase;

    set({
      nodes: nextNodes,
      edges: nextEdges,
      selectedNodeId: createdNodeIds[0] ?? state.selectedNodeId,
      activeToolDialog: null,
      history: {
        past: pushSnapshot(state.history.past, createSnapshot(state.nodes, state.edges)),
        future: [],
      },
      dragHistorySnapshot: null,
    });

    return createdNodeIds;
  },

  addStoryboardSplitNode: (sourceNodeId, rows, cols, frames, frameAspectRatio) => {
    const state = get();
    const sourceNode = state.nodes.find((node) => node.id === sourceNodeId);
    const nodeMap = new Map(state.nodes.map((node) => [node.id, node] as const));
    const parentGroupId = resolveInheritedGroupParentId(sourceNode, nodeMap);
    const normalizedGridLayout = normalizeStoryboardGridLayout(frames.length, rows, cols);
    const resolvedFrameAspectRatio =
      frameAspectRatio ??
      frames.find((frame) => typeof frame.aspectRatio === 'string')?.aspectRatio ??
      DEFAULT_ASPECT_RATIO;
    const nodeSize = resolveStoryboardSplitNodeSize(
      normalizedGridLayout.rows,
      normalizedGridLayout.cols
    );
    const position = state.findNodePosition(
      sourceNodeId,
      nodeSize.width,
      nodeSize.height
    );

    let node = canvasNodeFactory.createNode(CANVAS_NODE_TYPES.storyboardSplit, position, {
      sourceNodeId,
      gridRows: normalizedGridLayout.rows,
      gridCols: normalizedGridLayout.cols,
      frames,
      aspectRatio: resolvedFrameAspectRatio,
      frameAspectRatio: resolvedFrameAspectRatio,
      exportOptions: createDefaultStoryboardExportOptions(),
    });
    node.width = nodeSize.width;
    node.height = nodeSize.height;
    node.style = {
      ...(node.style ?? {}),
      width: nodeSize.width,
      height: nodeSize.height,
    };
    node = attachNodeToGroupParent(node, position, parentGroupId, nodeMap);
    const nextNodes = parentGroupId
      ? fitGroupNodeToChildren([...state.nodes, node], parentGroupId)
      : [...state.nodes, node];

    set({
      nodes: nextNodes,
      selectedNodeId: node.id,
      activeToolDialog: null,
      history: {
        past: pushSnapshot(state.history.past, createSnapshot(state.nodes, state.edges)),
        future: [],
      },
      dragHistorySnapshot: null,
    });

    return node.id;
  },

  addStoryboardSplitResultNode: (sourceNodeId, rows, cols, frames, frameAspectRatio) => {
    const state = get();
    const sourceNode = state.nodes.find((node) => node.id === sourceNodeId);
    const nodeMap = new Map(state.nodes.map((node) => [node.id, node] as const));
    const parentGroupId = resolveInheritedGroupParentId(sourceNode, nodeMap);
    const normalizedGridLayout = normalizeStoryboardGridLayout(frames.length, rows, cols);
    const resolvedFrameAspectRatio =
      frameAspectRatio ??
      frames.find((frame) => typeof frame.aspectRatio === 'string')?.aspectRatio ??
      DEFAULT_ASPECT_RATIO;
    const nodeSize = resolveStoryboardSplitNodeSize(
      normalizedGridLayout.rows,
      normalizedGridLayout.cols
    );
    const position = state.findNodePosition(
      sourceNodeId,
      nodeSize.width,
      nodeSize.height
    );

    let node = canvasNodeFactory.createNode(CANVAS_NODE_TYPES.storyboardSplitResult, position, {
      sourceNodeId,
      gridRows: normalizedGridLayout.rows,
      gridCols: normalizedGridLayout.cols,
      frames,
      aspectRatio: resolvedFrameAspectRatio,
      frameAspectRatio: resolvedFrameAspectRatio,
    });
    node.width = nodeSize.width;
    node.height = nodeSize.height;
    node.style = {
      ...(node.style ?? {}),
      width: nodeSize.width,
      height: nodeSize.height,
    };
    node = attachNodeToGroupParent(node, position, parentGroupId, nodeMap);
    const nextNodes = parentGroupId
      ? fitGroupNodeToChildren([...state.nodes, node], parentGroupId)
      : [...state.nodes, node];

    set({
      nodes: nextNodes,
      selectedNodeId: node.id,
      activeToolDialog: null,
      history: {
        past: pushSnapshot(state.history.past, createSnapshot(state.nodes, state.edges)),
        future: [],
      },
      dragHistorySnapshot: null,
    });

    return node.id;
  },

  addGeneratedScriptChapters: (sourceNodeId, chapters, options) => {
    const safeChapters = chapters
      .filter((chapter) => chapter.contentHtml.trim().length > 0)
      .slice(0, 6);
    if (safeChapters.length === 0) {
      return [];
    }

    const state = get();
    const sourceNode = state.nodes.find((node) => node.id === sourceNodeId);
    if (!sourceNode || !nodeHasSourceHandle(sourceNode.type)) {
      return [];
    }

    const nodeWidth = Math.max(
      240,
      Math.round(options?.nodeWidth ?? SCRIPT_CHAPTER_NODE_DEFAULT_WIDTH)
    );
    const nodeHeight = Math.max(
      220,
      Math.round(options?.nodeHeight ?? SCRIPT_CHAPTER_NODE_DEFAULT_HEIGHT)
    );
    const rootNodeMap = new Map(state.nodes.map((node) => [node.id, node] as const));
    const parentGroupId = resolveInheritedGroupParentId(sourceNode, rootNodeMap);
    let nextChapterNumber = state.nodes.reduce((maxNumber, node) => {
      if (node.type !== CANVAS_NODE_TYPES.scriptChapter) {
        return maxNumber;
      }

      const value = Number((node.data as ScriptChapterNodeData).chapterNumber);
      return Number.isFinite(value) ? Math.max(maxNumber, Math.floor(value)) : maxNumber;
    }, 0) + 1;

    const nextNodes = [...state.nodes];
    const nextEdges = [...state.edges];
    const createdNodeIds: string[] = [];

    for (const chapter of safeChapters) {
      const position = resolveBatchDerivedNodePosition(
        nextNodes,
        nextEdges,
        sourceNode,
        nodeWidth,
        nodeHeight
      );
      const title = chapter.title.trim() || `章节 ${nextChapterNumber}`;
      const summary = chapter.summary.trim();
      const contentHtml = chapter.contentHtml.trim();
      const sceneHeading = chapter.sceneHeading?.trim() ?? '';
      const location = chapter.location?.trim() ?? '';
      const characters = Array.from(
        new Set(
          (chapter.characters ?? [])
            .map((item) => item.trim())
            .filter((item) => item.length > 0)
        )
      );
      const items = Array.from(
        new Set(
          (chapter.items ?? [])
            .map((item) => item.trim())
            .filter((item) => item.length > 0)
        )
      );
      const scene = createDefaultSceneCard(0);
      scene.title = chapter.sceneTitle?.trim() || title || scene.title;
      scene.summary = chapter.sceneSummary?.trim() || summary || sceneHeading;
      scene.draftHtml = contentHtml;
      scene.sourceDraftHtml = contentHtml || undefined;
      scene.sourceDraftLabel = chapter.sourceDraftLabel?.trim() || undefined;
      scene.visualHook = chapter.visualHook?.trim() ?? '';
      scene.directorNotes = chapter.directorNotes?.trim() ?? '';
      scene.status = contentHtml ? 'drafting' : 'idea';

      let node = canvasNodeFactory.createNode(
        CANVAS_NODE_TYPES.scriptChapter,
        position,
        normalizeScriptChapterNodeData({
          displayName: title,
          chapterNumber: nextChapterNumber,
          title,
          content: contentHtml,
          summary,
          chapterPurpose: '',
          chapterQuestion: '',
          sceneHeadings: sceneHeading ? [sceneHeading] : [],
          scenes: [scene],
          characters,
          locations: location ? [location] : [],
          items,
          emotionalShift: '',
          isBranchPoint: false,
          branchType: 'main',
          tables: [],
          plotPoints: [],
        })
      );
      node.width = nodeWidth;
      node.height = nodeHeight;
      node.style = {
        ...(node.style ?? {}),
        width: nodeWidth,
        height: nodeHeight,
      };

      const stagedNodeMap = new Map(nextNodes.map((currentNode) => [currentNode.id, currentNode] as const));
      node = attachNodeToGroupParent(node, position, parentGroupId, stagedNodeMap);
      nextNodes.push(node);
      nextEdges.push({
        id: `e-${sourceNodeId}-${node.id}`,
        source: sourceNodeId,
        target: node.id,
        sourceHandle: 'source',
        targetHandle: 'target',
        type: 'disconnectableEdge',
      });
      createdNodeIds.push(node.id);
      nextChapterNumber += 1;
    }

    const normalizedNodes = parentGroupId
      ? fitGroupNodeToChildren(nextNodes, parentGroupId)
      : nextNodes;

    set({
      nodes: normalizedNodes,
      edges: nextEdges,
      selectedNodeId: createdNodeIds[0] ?? state.selectedNodeId,
      activeToolDialog: null,
      history: {
        past: pushSnapshot(state.history.past, createSnapshot(state.nodes, state.edges)),
        future: [],
      },
      dragHistorySnapshot: null,
    });

    return createdNodeIds;
  },

  createScriptSceneNodeFromChapterScene: (chapterNodeId, sceneId) => {
    const state = get();
    const chapterNode = state.nodes.find(
      (node) => node.id === chapterNodeId && node.type === CANVAS_NODE_TYPES.scriptChapter
    );
    if (!chapterNode) {
      return null;
    }

    const existingSceneNode = findScriptSceneNodeBySource(state.nodes, chapterNodeId, sceneId);
    if (existingSceneNode) {
      return existingSceneNode.id;
    }

    const chapterData = chapterNode.data as ScriptChapterNodeData;
    const sourceScene = (chapterData.scenes ?? []).find((scene) => scene.id === sceneId);
    if (!sourceScene) {
      return null;
    }

    const position = get().findNodePosition(
      chapterNodeId,
      SCRIPT_SCENE_NODE_DEFAULT_WIDTH,
      SCRIPT_SCENE_NODE_DEFAULT_HEIGHT
    );
    const initialData = normalizeScriptSceneNodeData({
      displayName: sourceScene.title || `场景 ${sourceScene.order + 1}`,
      sourceChapterId: chapterNodeId,
      sourceSceneId: sourceScene.id,
      sourceSceneOrder: sourceScene.order,
      chapterNumber: chapterData.chapterNumber || 1,
      title: sourceScene.title,
      summary: sourceScene.summary,
      purpose: sourceScene.purpose,
      povCharacter: sourceScene.povCharacter,
      goal: sourceScene.goal,
      conflict: sourceScene.conflict,
      turn: sourceScene.turn,
      emotionalShift: sourceScene.emotionalShift,
      visualHook: sourceScene.visualHook,
      subtext: sourceScene.subtext,
      sourceDraftHtml: sourceScene.sourceDraftHtml?.trim() || sourceScene.draftHtml || undefined,
      draftHtml: sourceScene.draftHtml,
      episodes: [],
    });

    const rootNodeMap = new Map(state.nodes.map((node) => [node.id, node] as const));
    const parentGroupId = resolveInheritedGroupParentId(chapterNode, rootNodeMap);
    let createdNode = canvasNodeFactory.createNode(
      CANVAS_NODE_TYPES.scriptScene,
      position,
      initialData
    );
    createdNode = applyDefaultNodeSize(createdNode, createdNode.data);

    const stagedNodeMap = new Map(state.nodes.map((node) => [node.id, node] as const));
    createdNode = attachNodeToGroupParent(
      createdNode,
      position,
      parentGroupId,
      stagedNodeMap
    );

    const edgeId = `e-${chapterNodeId}-${createdNode.id}`;
    const nextNodes = parentGroupId
      ? fitGroupNodeToChildren([...state.nodes, createdNode], parentGroupId)
      : [...state.nodes, createdNode];
    const reindexedResult = reindexScriptSceneNodesByChapter(nextNodes, chapterNodeId);
    const nextEdges = state.edges.some((edge) => edge.id === edgeId)
      ? state.edges
      : [
          ...state.edges,
          {
            id: edgeId,
            source: chapterNodeId,
            target: createdNode.id,
            sourceHandle: 'source',
            targetHandle: 'target',
            type: 'disconnectableEdge',
          },
        ];

    set({
      nodes: reindexedResult.nodes,
      edges: nextEdges,
      selectedNodeId: createdNode.id,
      activeToolDialog: null,
      history: {
        past: pushSnapshot(state.history.past, createSnapshot(state.nodes, state.edges)),
        future: [],
      },
      dragHistorySnapshot: null,
    });

    return createdNode.id;
  },

  ensureShootingScriptNodeFromSceneEpisode: (sceneNodeId, episodeId) => {
    const state = get();
    const sceneNode = state.nodes.find(
      (node) => node.id === sceneNodeId && node.type === CANVAS_NODE_TYPES.scriptScene
    );
    if (!sceneNode) {
      return { nodeId: null, created: false };
    }

    const existingScriptNode = findShootingScriptNodeBySource(state.nodes, sceneNodeId, episodeId);
    if (existingScriptNode) {
      return { nodeId: existingScriptNode.id, created: false };
    }

    const sceneData = sceneNode.data as ScriptSceneNodeData;
    const episode = sceneData.episodes.find((item) => item.id === episodeId);
    if (!episode) {
      return { nodeId: null, created: false };
    }

    const chapterNode = state.nodes.find(
      (node) => node.id === sceneData.sourceChapterId && node.type === CANVAS_NODE_TYPES.scriptChapter
    );
    const chapterData = chapterNode?.data as ScriptChapterNodeData | undefined;
    const migratedRows = (episode.shotRows ?? []).map((row, index) => ({
      id: row.id,
      shotNumber: row.shotNumber || String(index + 1),
      beat: row.beat,
      action: row.action,
      composition: [row.shotSize, row.framingAngle].filter(Boolean).join(' / '),
      camera: row.cameraMove,
      duration: row.rhythmDuration,
      audio: [row.dialogueCue, row.audioCue].filter(Boolean).join(' / '),
      blocking: row.blocking,
      artLighting: row.artLighting,
      continuityNote: row.continuityNote,
      directorIntent: '',
      genTarget: row.genTarget,
      genPrompt: row.genPrompt,
      status: row.status,
    }));

    const position = get().findNodePosition(
      sceneNodeId,
      SHOOTING_SCRIPT_NODE_DEFAULT_WIDTH,
      SHOOTING_SCRIPT_NODE_DEFAULT_HEIGHT
    );
    const initialData = normalizeShootingScriptNodeData({
      displayName: episode.title?.trim() || `拍摄脚本 ${sceneData.chapterNumber || 1}-${episode.episodeNumber}`,
      sourceChapterId: sceneData.sourceChapterId,
      sourceSceneNodeId: sceneNodeId,
      sourceEpisodeId: episode.id,
      chapterNumber: sceneData.chapterNumber || 1,
      sceneNumber: sceneData.sourceSceneOrder + 1,
      sceneTitle: sceneData.title,
      episodeNumber: episode.episodeNumber,
      episodeTitle: episode.title,
      rows: migratedRows,
      status: migratedRows.length > 0 ? 'ready' : 'drafting',
      lastGeneratedAt: migratedRows.length > 0
        ? (episode.shotScriptUpdatedAt ?? Date.now())
        : null,
      lastError: null,
      sourceSnapshot: {
        chapterTitle: chapterData?.title || chapterData?.displayName || '',
        sceneTitle: sceneData.title,
        sceneSummary: sceneData.summary,
        episodeTitle: episode.title,
        episodeSummary: episode.summary,
        episodeDraft: episode.draftHtml,
        episodeDirectorNotes: episode.directorNotes,
        continuitySummary: episode.continuitySummary,
        continuityFacts: episode.continuityFacts,
        continuityOpenLoops: episode.continuityOpenLoops,
      },
    });

    const rootNodeMap = new Map(state.nodes.map((node) => [node.id, node] as const));
    const parentGroupId = resolveInheritedGroupParentId(sceneNode, rootNodeMap);
    let createdNode = canvasNodeFactory.createNode(
      CANVAS_NODE_TYPES.shootingScript,
      position,
      initialData
    );
    createdNode = applyDefaultNodeSize(createdNode, createdNode.data);

    const stagedNodeMap = new Map(state.nodes.map((node) => [node.id, node] as const));
    createdNode = attachNodeToGroupParent(
      createdNode,
      position,
      parentGroupId,
      stagedNodeMap
    );

    const edgeId = `e-${sceneNodeId}-${createdNode.id}`;
    const nextNodes = parentGroupId
      ? fitGroupNodeToChildren([...state.nodes, createdNode], parentGroupId)
      : [...state.nodes, createdNode];
    const nextEdges = state.edges.some((edge) => edge.id === edgeId)
      ? state.edges
      : [
          ...state.edges,
          {
            id: edgeId,
            source: sceneNodeId,
            target: createdNode.id,
            sourceHandle: 'source',
            targetHandle: 'target',
            type: 'disconnectableEdge',
          },
        ];

    set({
      nodes: nextNodes,
      edges: nextEdges,
      selectedNodeId: createdNode.id,
      activeToolDialog: null,
      history: {
        past: pushSnapshot(state.history.past, createSnapshot(state.nodes, state.edges)),
        future: [],
      },
      dragHistorySnapshot: null,
    });

    return { nodeId: createdNode.id, created: true };
  },

  reindexScriptSceneEpisodes: (sourceChapterId) => {
    if (!sourceChapterId.trim()) {
      return;
    }

    set((state) => {
      const reindexedResult = reindexScriptSceneNodesByChapter(state.nodes, sourceChapterId);
      if (!reindexedResult.changed) {
        return {};
      }

      return {
        nodes: reindexedResult.nodes,
      };
    });
  },

  updateNodeData: (nodeId, data, options) => {
    set((state) => {
      let changed = false;
      const affectedChapterIds = new Set<string>();
      const nextNodes = state.nodes.map((node) => {
        if (node.id !== nodeId) {
          return node;
        }

        const hasDataChange = Object.entries(data).some(([key, nextValue]) => {
          const previousValue = (node.data as Record<string, unknown>)[key];
          return !Object.is(previousValue, nextValue);
        });
        if (!hasDataChange) {
          return node;
        }

        const mergedData = {
          ...node.data,
          ...data,
        } as CanvasNodeData;
        if (node.type === CANVAS_NODE_TYPES.scriptChapter) {
          Object.assign(
            mergedData,
            normalizeScriptChapterNodeData(mergedData as ScriptChapterNodeData)
          );
          if ('chapterNumber' in data) {
            affectedChapterIds.add(node.id);
          }
        }
        if (node.type === CANVAS_NODE_TYPES.scriptScene) {
          const previousData = node.data as ScriptSceneNodeData;
          const normalizedSceneData = normalizeScriptSceneNodeData(mergedData as ScriptSceneNodeData);
          Object.assign(mergedData, normalizedSceneData);
          if (previousData.sourceChapterId) {
            affectedChapterIds.add(previousData.sourceChapterId);
          }
          if (normalizedSceneData.sourceChapterId) {
            affectedChapterIds.add(normalizedSceneData.sourceChapterId);
          }
        }
        if (node.type === CANVAS_NODE_TYPES.shootingScript) {
          Object.assign(
            mergedData,
            normalizeShootingScriptNodeData(mergedData as ShootingScriptNodeData)
          );
        }
        if (node.type === CANVAS_NODE_TYPES.scriptReference) {
          Object.assign(
            mergedData,
            normalizeScriptReferenceNodeData(mergedData as ScriptReferenceNodeData)
          );
        }
        if (node.type === CANVAS_NODE_TYPES.scriptCharacterReference) {
          Object.assign(
            mergedData,
            normalizeScriptCharacterReferenceNodeData(mergedData as ScriptCharacterReferenceNodeData)
          );
        }
        if (node.type === CANVAS_NODE_TYPES.scriptLocationReference) {
          Object.assign(
            mergedData,
            normalizeScriptLocationReferenceNodeData(mergedData as ScriptLocationReferenceNodeData)
          );
        }
        if (node.type === CANVAS_NODE_TYPES.scriptItemReference) {
          Object.assign(
            mergedData,
            normalizeScriptItemReferenceNodeData(mergedData as ScriptItemReferenceNodeData)
          );
        }
        if (node.type === CANVAS_NODE_TYPES.imageCollage) {
          Object.assign(
            mergedData,
            normalizeImageCollageNodeData(mergedData as ImageCollageNodeData)
          );
        }
        const resizedNode = maybeApplyImageAutoResize(
          {
            ...node,
            data: mergedData,
          },
          data
        );

        changed = true;
        return resizedNode;
      });

      if (!changed) {
        return {};
      }

      let normalizedNextNodes = nextNodes;
      affectedChapterIds.forEach((chapterId) => {
        normalizedNextNodes = reindexScriptSceneNodesByChapter(normalizedNextNodes, chapterId).nodes;
      });

      const nextHistory =
        options?.historyMode === 'skip'
          ? state.history
          : {
              past: pushSnapshot(state.history.past, createSnapshot(state.nodes, state.edges)),
              future: [],
            };

      return {
        nodes: normalizedNextNodes,
        history: nextHistory,
        dragHistorySnapshot: null,
      };
    });
  },

  updateNodesData: (nodeIds, data, options) => {
    const normalizedNodeIds = Array.from(
      new Set(
        Array.from(nodeIds).filter((nodeId): nodeId is string => (
          typeof nodeId === 'string' && nodeId.trim().length > 0
        ))
      )
    );

    if (normalizedNodeIds.length === 0) {
      return;
    }

    set((state) => {
      const targetNodeIds = new Set(normalizedNodeIds);
      let changed = false;
      const affectedChapterIds = new Set<string>();
      const nextNodes = state.nodes.map((node) => {
        if (!targetNodeIds.has(node.id)) {
          return node;
        }

        const hasDataChange = Object.entries(data).some(([key, nextValue]) => {
          const previousValue = (node.data as Record<string, unknown>)[key];
          return !Object.is(previousValue, nextValue);
        });
        if (!hasDataChange) {
          return node;
        }

        const mergedData = {
          ...node.data,
          ...data,
        } as CanvasNodeData;
        if (node.type === CANVAS_NODE_TYPES.scriptChapter) {
          Object.assign(
            mergedData,
            normalizeScriptChapterNodeData(mergedData as ScriptChapterNodeData)
          );
          if ('chapterNumber' in data) {
            affectedChapterIds.add(node.id);
          }
        }
        if (node.type === CANVAS_NODE_TYPES.scriptScene) {
          const previousData = node.data as ScriptSceneNodeData;
          const normalizedSceneData = normalizeScriptSceneNodeData(mergedData as ScriptSceneNodeData);
          Object.assign(mergedData, normalizedSceneData);
          if (previousData.sourceChapterId) {
            affectedChapterIds.add(previousData.sourceChapterId);
          }
          if (normalizedSceneData.sourceChapterId) {
            affectedChapterIds.add(normalizedSceneData.sourceChapterId);
          }
        }
        if (node.type === CANVAS_NODE_TYPES.shootingScript) {
          Object.assign(
            mergedData,
            normalizeShootingScriptNodeData(mergedData as ShootingScriptNodeData)
          );
        }
        if (node.type === CANVAS_NODE_TYPES.imageCollage) {
          Object.assign(
            mergedData,
            normalizeImageCollageNodeData(mergedData as ImageCollageNodeData)
          );
        }
        const resizedNode = maybeApplyImageAutoResize(
          {
            ...node,
            data: mergedData,
          },
          data
        );

        changed = true;
        return resizedNode;
      });

      if (!changed) {
        return {};
      }

      let normalizedNextNodes = nextNodes;
      affectedChapterIds.forEach((chapterId) => {
        normalizedNextNodes = reindexScriptSceneNodesByChapter(normalizedNextNodes, chapterId).nodes;
      });

      const nextHistory =
        options?.historyMode === 'skip'
          ? state.history
          : {
              past: pushSnapshot(
                state.history.past,
                createNodePatchSnapshot(state.nodes, normalizedNodeIds, state.edges)
              ),
              future: [],
            };

      return {
        nodes: normalizedNextNodes,
        history: nextHistory,
        dragHistorySnapshot: null,
      };
    });
  },

  applySemanticColorToSelected: (color) => {
    const selectedColorableNodes = get()
      .nodes
      .filter((node) => node.selected && node.type !== CANVAS_NODE_TYPES.group);
    const targetNodeIds = selectedColorableNodes.map((node) => node.id);

    if (targetNodeIds.length === 0) {
      return;
    }

    const shouldClearColor = selectedColorableNodes.every((node) => (
      (node.data as { semanticColor?: CanvasSemanticColor | null }).semanticColor === color
    ));

    get().updateNodesData(targetNodeIds, {
      semanticColor: shouldClearColor ? null : color,
    });
  },

  updateNodePosition: (nodeId, position) => {
    set((state) => {
      let changed = false;
      const nextNodes = state.nodes.map((node) => {
        if (node.id !== nodeId) {
          return node;
        }

        if (node.position.x === position.x && node.position.y === position.y) {
          return node;
        }

        changed = true;
        return {
          ...node,
          position,
        };
      });

      if (!changed) {
        return {};
      }

      return { nodes: nextNodes };
    });
  },

  updateStoryboardFrame: (nodeId, frameId, data) => {
    set((state) => {
      let changed = false;
      const nextNodes = state.nodes.map((node) => {
        if (node.id !== nodeId || !isStoryboardSplitNode(node)) {
          return node;
        }

        const nextFrames = node.data.frames.map((frame) => {
          if (frame.id !== frameId) {
            return frame;
          }

          const patchEntries = Object.entries(data) as Array<
            [keyof StoryboardFrameItem, StoryboardFrameItem[keyof StoryboardFrameItem]]
          >;
          const hasFrameChange = patchEntries.some(([key, nextValue]) =>
            !Object.is(frame[key], nextValue)
          );
          if (!hasFrameChange) {
            return frame;
          }

          changed = true;
          return {
            ...frame,
            ...data,
          };
        });

        return {
          ...node,
          data: {
            ...node.data,
            frames: nextFrames,
          },
        };
      });

      if (!changed) {
        return {};
      }

      return {
        nodes: nextNodes,
        history: {
          past: pushSnapshot(state.history.past, createSnapshot(state.nodes, state.edges)),
          future: [],
        },
        dragHistorySnapshot: null,
      };
    });
  },

  updateStoryboardGridLayout: (nodeId, axis, value) => {
    set((state) => {
      const node = state.nodes.find((currentNode) => currentNode.id === nodeId);
      if (!node || !isStoryboardSplitNode(node)) {
        return {};
      }

      const nextGridLayout = resolveStoryboardGridLayoutForAxis(
        node.data.frames.length,
        axis,
        value
      );

      if (
        nextGridLayout.rows === node.data.gridRows &&
        nextGridLayout.cols === node.data.gridCols
      ) {
        return {};
      }

      return {
        nodes: state.nodes.map((currentNode) =>
          currentNode.id === nodeId
            ? {
                ...currentNode,
                data: {
                  ...currentNode.data,
                  gridRows: nextGridLayout.rows,
                  gridCols: nextGridLayout.cols,
                },
              }
            : currentNode
        ),
        history: {
          past: pushSnapshot(state.history.past, createSnapshot(state.nodes, state.edges)),
          future: [],
        },
        dragHistorySnapshot: null,
      };
    });
  },

  reorderStoryboardFrame: (nodeId, draggedFrameId, targetFrameId) => {
    set((state) => {
      let changed = false;
      const nextNodes = state.nodes.map((node) => {
        if (node.id !== nodeId || !isStoryboardSplitNode(node)) {
          return node;
        }

        const frames = [...node.data.frames].sort((a, b) => a.order - b.order);
        const fromIndex = frames.findIndex((frame) => frame.id === draggedFrameId);
        const toIndex = frames.findIndex((frame) => frame.id === targetFrameId);

        if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) {
          return node;
        }

        changed = true;
        const [movedFrame] = frames.splice(fromIndex, 1);
        frames.splice(toIndex, 0, movedFrame);

        return {
          ...node,
          data: {
            ...node.data,
            frames: frames.map((frame, index) => ({
              ...frame,
              order: index,
            })),
          },
        };
      });

      if (!changed) {
        return {};
      }

      return {
        nodes: nextNodes,
        history: {
          past: pushSnapshot(state.history.past, createSnapshot(state.nodes, state.edges)),
          future: [],
        },
        dragHistorySnapshot: null,
      };
    });
  },

  addStoryboardFrame: (nodeId, isWhitePlaceholder = false) => {
    set((state) => {
      const node = state.nodes.find((n) => n.id === nodeId);
      if (!node || !isStoryboardSplitNode(node)) {
        return {};
      }

      const frames = [...node.data.frames].sort((a, b) => a.order - b.order);
      const newFrameId = uuidv4();
      const newFrame: StoryboardFrameItem = {
        id: newFrameId,
        imageUrl: isWhitePlaceholder ? 'white-placeholder' : null,
        note: '',
        order: frames.length,
      };

      const newFrames = [...frames, newFrame];
      const gridLayout = resolveStoryboardGridLayoutForAxis(
        newFrames.length,
        'cols',
        node.data.gridCols
      );

      return {
        nodes: state.nodes.map((n) =>
          n.id === nodeId
            ? {
                ...n,
                data: {
                  ...n.data,
                  frames: newFrames,
                  gridRows: gridLayout.rows,
                  gridCols: gridLayout.cols,
                },
              }
            : n
        ),
        history: {
          past: pushSnapshot(state.history.past, createSnapshot(state.nodes, state.edges)),
          future: [],
        },
        dragHistorySnapshot: null,
      };
    });
  },

  removeStoryboardFrame: (nodeId, frameId) => {
    set((state) => {
      const node = state.nodes.find((n) => n.id === nodeId);
      if (!node || !isStoryboardSplitNode(node)) {
        return {};
      }

      const removedFrame = node.data.frames.find((frame) => frame.id === frameId);
      if (!removedFrame) {
        return {};
      }

      const frames = node.data.frames.filter((f) => f.id !== frameId);

      const reorderedFrames = frames
        .sort((a, b) => a.order - b.order)
        .map((frame, index) => ({ ...frame, order: index }));
      const gridLayout = resolveStoryboardGridLayoutForAxis(
        reorderedFrames.length,
        'cols',
        node.data.gridCols
      );
      const disconnectedEdgeIds = resolveStoryboardFrameDisconnectedEdgeIds(
        nodeId,
        removedFrame,
        reorderedFrames,
        state.nodes,
        state.edges
      );
      const nextEdges = disconnectedEdgeIds.size > 0
        ? state.edges.filter((edge) => !disconnectedEdgeIds.has(edge.id))
        : state.edges;

      return {
        nodes: state.nodes.map((n) =>
          n.id === nodeId
            ? {
                ...n,
                data: {
                  ...n.data,
                  frames: reorderedFrames,
                  gridRows: gridLayout.rows,
                  gridCols: gridLayout.cols,
                },
              }
            : n
        ),
        edges: nextEdges,
        history: {
          past: pushSnapshot(state.history.past, createSnapshot(state.nodes, state.edges)),
          future: [],
        },
        dragHistorySnapshot: null,
      };
    });
  },

  setStoryboardFrameImage: (nodeId, frameId, imageUrl) => {
    set((state) => {
      let changed = false;
      const nextNodes = state.nodes.map((node) => {
        if (node.id !== nodeId || !isStoryboardSplitNode(node)) {
          return node;
        }

        const nextFrames = node.data.frames.map((frame) => {
          if (frame.id !== frameId) {
            return frame;
          }
          changed = true;
          return { ...frame, imageUrl };
        });

        return { ...node, data: { ...node.data, frames: nextFrames } };
      });

      if (!changed) {
        return {};
      }

      return {
        nodes: nextNodes,
        history: {
          past: pushSnapshot(state.history.past, createSnapshot(state.nodes, state.edges)),
          future: [],
        },
        dragHistorySnapshot: null,
      };
    });
  },

  createMergedImageNode: async (sourceNodeId) => {
    const state = get();
    const node = state.nodes.find((n) => n.id === sourceNodeId);
    if (!node || !isStoryboardSplitNode(node)) {
      return null;
    }

    const { frames, exportOptions, aspectRatio } = node.data;
    const frameSources = frames
      .sort((a, b) => a.order - b.order)
      .map((frame) => frame.imageUrl === 'white-placeholder' ? null : (frame.imageUrl ?? null));

    if (frameSources.length === 0) {
      return null;
    }

    const gridRows = node.data.gridRows;
    const gridCols = node.data.gridCols;

    try {
      const { mergeStoryboardImages } = await import('@/commands/image');
      const result = await mergeStoryboardImages({
        frameSources: frameSources as string[],
        rows: gridRows,
        cols: gridCols,
        cellGap: exportOptions?.cellGap ?? 1,
        outerPadding: exportOptions?.outerPadding ?? 0,
        noteHeight: 0,
        fontSize: 12,
        backgroundColor: exportOptions?.backgroundColor ?? '#FFFFFF',
        maxDimension: 4096,
        showFrameIndex: exportOptions?.showFrameIndex ?? false,
        showFrameNote: exportOptions?.showFrameNote ?? false,
        notePlacement: exportOptions?.notePlacement ?? 'overlay',
        imageFit: exportOptions?.imageFit ?? 'cover',
        frameIndexPrefix: exportOptions?.frameIndexPrefix ?? '',
        textColor: exportOptions?.textColor ?? '#000000',
        frameNotes: frames.map((f) => f.note),
      });

      if (!result.imagePath) {
        return null;
      }

      const nodePosition = {
        x: (node.position?.x ?? 0) + 400,
        y: node.position?.y ?? 0,
      };

      const newNodeId = get().addNode(CANVAS_NODE_TYPES.exportImage, nodePosition, {
        displayName: '合并分镜',
        imageUrl: result.imagePath,
        aspectRatio: aspectRatio,
      });

      return newNodeId;
    } catch (error) {
      console.error('Failed to create merged image node:', error);
      return null;
    }
  },

  syncAssetItemReferences: (item) => {
    let didChange = false;

    set((state) => {
      const nodeResult = syncAssetItemAcrossNodes(state.nodes, item);
      const historyResult = mapHistorySnapshots(state.history, (nodes) =>
        syncAssetItemAcrossNodes(nodes, item)
      );

      didChange = nodeResult.changed || historyResult.changed;
      if (!didChange) {
        return {};
      }

      return {
        nodes: nodeResult.nodes,
        history: historyResult.history,
        dragHistorySnapshot: null,
      };
    });

    return didChange;
  },

  detachDeletedAssetReferences: (assetItemId) => {
    let didChange = false;

    set((state) => {
      const nodeResult = detachDeletedAssetAcrossNodes(state.nodes, assetItemId);
      const historyResult = mapHistorySnapshots(state.history, (nodes) =>
        detachDeletedAssetAcrossNodes(nodes, assetItemId)
      );

      didChange = nodeResult.changed || historyResult.changed;
      if (!didChange) {
        return {};
      }

      return {
        nodes: nodeResult.nodes,
        history: historyResult.history,
        dragHistorySnapshot: null,
      };
    });

    return didChange;
  },

  deleteNode: (nodeId) => {
    get().deleteNodes([nodeId]);
  },

  deleteNodes: (nodeIds) => {
    const uniqueIds = Array.from(new Set(nodeIds.filter((nodeId) => nodeId.trim().length > 0)));
    if (uniqueIds.length === 0) {
      return;
    }

    let deletedNodeIds: string[] = [];
    const affectedChapterIds = new Set<string>();
    let fallbackChapterId: string | null = null;
    let fallbackSceneId: string | null = null;
    let fallbackEpisodeId: string | null = null;
    const { activeSceneNodeId, activeScriptNodeId } = useScriptEditorStore.getState();

    set((state) => {
      const existingIds = uniqueIds.filter((nodeId) => state.nodes.some((node) => node.id === nodeId));
      if (existingIds.length === 0) {
        return {};
      }

      const deleteSet = collectNodeIdsWithDescendants(state.nodes, existingIds);
      deletedNodeIds = Array.from(deleteSet);
      if (activeSceneNodeId && deleteSet.has(activeSceneNodeId)) {
        const activeSceneNode = state.nodes.find(
          (node) => node.id === activeSceneNodeId && node.type === CANVAS_NODE_TYPES.scriptScene
        );
        if (activeSceneNode) {
          const activeSceneData = activeSceneNode.data as ScriptSceneNodeData;
          const sourceChapterSurvives = state.nodes.some(
            (node) => node.id === activeSceneData.sourceChapterId && !deleteSet.has(node.id)
          );
          if (sourceChapterSurvives) {
            fallbackChapterId = activeSceneData.sourceChapterId;
            fallbackSceneId = activeSceneData.sourceSceneId;
          }
        }
      }
      if (activeScriptNodeId && deleteSet.has(activeScriptNodeId)) {
        const activeScriptNode = state.nodes.find(
          (node) => node.id === activeScriptNodeId && node.type === CANVAS_NODE_TYPES.shootingScript
        );
        if (activeScriptNode) {
          const activeScriptData = activeScriptNode.data as ShootingScriptNodeData;
          const sourceSceneSurvives = state.nodes.some(
            (node) => node.id === activeScriptData.sourceSceneNodeId && !deleteSet.has(node.id)
          );
          if (sourceSceneSurvives) {
            fallbackSceneId = activeScriptData.sourceSceneNodeId;
            fallbackEpisodeId = activeScriptData.sourceEpisodeId;
          }
        }
      }
      state.nodes.forEach((node) => {
        if (!deleteSet.has(node.id) || node.type !== CANVAS_NODE_TYPES.scriptScene) {
          return;
        }

        const sceneData = node.data as ScriptSceneNodeData;
        if (sceneData.sourceChapterId) {
          affectedChapterIds.add(sceneData.sourceChapterId);
        }
      });
      const nextNodes = state.nodes.filter((node) => !deleteSet.has(node.id));
      const nextEdges = state.edges.filter(
        (edge) => !deleteSet.has(edge.source) && !deleteSet.has(edge.target)
      );
      let normalizedNextNodes = nextNodes;
      affectedChapterIds.forEach((chapterId) => {
        normalizedNextNodes = reindexScriptSceneNodesByChapter(normalizedNextNodes, chapterId).nodes;
      });

      return {
        nodes: normalizedNextNodes,
        edges: nextEdges,
        selectedNodeId:
          state.selectedNodeId && deleteSet.has(state.selectedNodeId)
            ? fallbackChapterId ?? null
            : state.selectedNodeId,
        activeToolDialog:
          state.activeToolDialog && deleteSet.has(state.activeToolDialog.nodeId)
            ? null
            : state.activeToolDialog,
        history: {
          past: pushSnapshot(state.history.past, createSnapshot(state.nodes, state.edges)),
          future: [],
        },
        dragHistorySnapshot: null,
      };
    });

    if (deletedNodeIds.length > 0) {
      if (activeScriptNodeId && deletedNodeIds.includes(activeScriptNodeId)) {
        if (fallbackSceneId) {
          useScriptEditorStore.getState().focusSceneNode(
            fallbackSceneId,
            fallbackEpisodeId
          );
        } else {
          useScriptEditorStore.getState().clearSelection();
        }
      } else if (activeSceneNodeId && deletedNodeIds.includes(activeSceneNodeId)) {
        if (fallbackChapterId && fallbackSceneId) {
          useScriptEditorStore.getState().focusChapterScene(
            fallbackChapterId,
            fallbackSceneId
          );
        } else {
          useScriptEditorStore.getState().clearSelection();
        }
      }
    }

    if (deletedNodeIds.length > 0) {
      emitCanvasNodesDeleted(deletedNodeIds);
    }
  },

  groupNodes: (nodeIds) => {
    const uniqueIds = Array.from(new Set(nodeIds.filter((nodeId) => nodeId.trim().length > 0)));
    if (uniqueIds.length < 2) {
      return null;
    }

    const state = get();
    const nodeMap = new Map(state.nodes.map((node) => [node.id, node] as const));
    const existingIds = uniqueIds.filter((nodeId) => nodeMap.has(nodeId));
    if (existingIds.length < 2) {
      return null;
    }

    const selectedSet = new Set(existingIds);
    const memberIds = existingIds.filter((nodeId) => {
      let currentParentId = nodeMap.get(nodeId)?.parentId;
      const visited = new Set<string>();
      while (currentParentId && !visited.has(currentParentId)) {
        if (selectedSet.has(currentParentId)) {
          return false;
        }
        visited.add(currentParentId);
        currentParentId = nodeMap.get(currentParentId)?.parentId;
      }
      return true;
    });
    if (memberIds.length < 2) {
      return null;
    }

    const memberSet = new Set(memberIds);
    const members = memberIds
      .map((id) => nodeMap.get(id))
      .filter((node): node is CanvasNode => Boolean(node));

    const absoluteBounds = members.reduce(
      (acc, node) => {
        const absolute = resolveAbsolutePosition(node, nodeMap);
        const size = getNodeSize(node);
        return {
          minX: Math.min(acc.minX, absolute.x),
          minY: Math.min(acc.minY, absolute.y),
          maxX: Math.max(acc.maxX, absolute.x + size.width),
          maxY: Math.max(acc.maxY, absolute.y + size.height),
        };
      },
      {
        minX: Number.POSITIVE_INFINITY,
        minY: Number.POSITIVE_INFINITY,
        maxX: Number.NEGATIVE_INFINITY,
        maxY: Number.NEGATIVE_INFINITY,
      }
    );

    if (!Number.isFinite(absoluteBounds.minX) || !Number.isFinite(absoluteBounds.minY)) {
      return null;
    }

    const groupX = Math.round(absoluteBounds.minX - GROUP_NODE_SIDE_PADDING);
    const groupY = Math.round(absoluteBounds.minY - GROUP_NODE_TOP_PADDING);
    const groupWidth = Math.round(
      Math.max(220, absoluteBounds.maxX - absoluteBounds.minX + GROUP_NODE_SIDE_PADDING * 2)
    );
    const groupHeight = Math.round(
      Math.max(
        140,
        absoluteBounds.maxY
          - absoluteBounds.minY
          + GROUP_NODE_TOP_PADDING
          + GROUP_NODE_BOTTOM_PADDING
      )
    );

    const existingGroupCount = state.nodes.filter((node) => node.type === CANVAS_NODE_TYPES.group).length;
    const groupDisplayName = `组 ${existingGroupCount + 1}`;
    const groupNode = canvasNodeFactory.createNode(
      CANVAS_NODE_TYPES.group,
      { x: groupX, y: groupY },
      {
        label: groupDisplayName,
        displayName: groupDisplayName,
        layoutDirection: 'horizontal',
        maxItemsPerLine: DEFAULT_GROUP_LAYOUT_MAX_ITEMS_PER_LINE,
      }
    );
    groupNode.width = groupWidth;
    groupNode.height = groupHeight;
    groupNode.style = { width: groupWidth, height: groupHeight };
    groupNode.selected = true;

    const updatedMemberMap = new Map<string, CanvasNode>();
    for (const node of members) {
      const absolute = resolveAbsolutePosition(node, nodeMap);
      updatedMemberMap.set(node.id, {
        ...node,
        parentId: groupNode.id,
        extent: undefined,
        position: {
          x: Math.round(absolute.x - groupX),
          y: Math.round(absolute.y - groupY),
        },
        selected: false,
      });
    }

    const firstMemberIndex = state.nodes.reduce((acc, node, index) => {
      if (!memberSet.has(node.id)) {
        return acc;
      }
      return acc === -1 ? index : Math.min(acc, index);
    }, -1);

    const nextNodes: CanvasNode[] = [];
    let insertedGroup = false;
    for (let index = 0; index < state.nodes.length; index += 1) {
      const node = state.nodes[index];
      if (!insertedGroup && index === firstMemberIndex) {
        nextNodes.push(groupNode);
        insertedGroup = true;
      }

      const updatedMember = updatedMemberMap.get(node.id);
      if (updatedMember) {
        nextNodes.push(updatedMember);
      } else {
        nextNodes.push({
          ...node,
          selected: false,
        });
      }
    }

    if (!insertedGroup) {
      nextNodes.push(groupNode);
    }

    set({
      nodes: nextNodes,
      selectedNodeId: groupNode.id,
      activeToolDialog:
        state.activeToolDialog && memberSet.has(state.activeToolDialog.nodeId)
          ? null
          : state.activeToolDialog,
      history: {
        past: pushSnapshot(state.history.past, createSnapshot(state.nodes, state.edges)),
        future: [],
      },
      dragHistorySnapshot: null,
    });

    return groupNode.id;
  },

  layoutGroupNode: (groupNodeId) => {
    let didLayout = false;
    const animatedNodeIds = new Set<string>();

    set((state) => {
      const groupNode = state.nodes.find(
        (node) => node.id === groupNodeId && node.type === CANVAS_NODE_TYPES.group
      );
      if (!groupNode) {
        return {};
      }

      const directChildren = state.nodes.filter((node) => node.parentId === groupNodeId);
      if (directChildren.length < 2) {
        return {};
      }

      const childIdSet = new Set(directChildren.map((node) => node.id));
      const internalEdges = state.edges.filter(
        (edge) => childIdSet.has(edge.source) && childIdSet.has(edge.target)
      );

      const layoutResult = layoutGroupChildren(directChildren, internalEdges, {
        maxItemsPerLine:
          typeof groupNode.data.maxItemsPerLine === 'number'
            ? groupNode.data.maxItemsPerLine
            : DEFAULT_GROUP_LAYOUT_MAX_ITEMS_PER_LINE,
      });

      const nextNodes = state.nodes.map((node) => {
        if (node.id === groupNodeId) {
          const widthChanged = Math.round(node.width ?? 0) !== layoutResult.size.width;
          const heightChanged = Math.round(node.height ?? 0) !== layoutResult.size.height;
          const directionChanged = node.data.layoutDirection !== layoutResult.direction;
          const maxItemsChanged =
            node.data.maxItemsPerLine !== layoutResult.maxItemsPerLine;

          if (!widthChanged && !heightChanged && !directionChanged && !maxItemsChanged) {
            return {
              ...node,
              selected: true,
            };
          }

          didLayout = true;
          animatedNodeIds.add(node.id);
          return {
            ...node,
            width: layoutResult.size.width,
            height: layoutResult.size.height,
            className: appendNodeClassName(node.className, GROUP_LAYOUT_ANIMATION_CLASS),
            style: {
              ...(node.style ?? {}),
              width: layoutResult.size.width,
              height: layoutResult.size.height,
            },
            selected: true,
            data: {
              ...node.data,
              layoutDirection: layoutResult.direction,
              maxItemsPerLine: layoutResult.maxItemsPerLine,
            },
          };
        }

        if (!childIdSet.has(node.id)) {
          return node;
        }

        const nextPosition = layoutResult.positions.get(node.id);
        if (!nextPosition) {
          return {
            ...node,
            selected: false,
          };
        }

        const positionChanged =
          Math.round(node.position.x) !== nextPosition.x ||
          Math.round(node.position.y) !== nextPosition.y;

        if (positionChanged) {
          didLayout = true;
          animatedNodeIds.add(node.id);
        }

        return {
          ...node,
          position: nextPosition,
          className: positionChanged
            ? appendNodeClassName(node.className, GROUP_LAYOUT_ANIMATION_CLASS)
            : node.className,
          selected: false,
        };
      });

      if (!didLayout) {
        return {};
      }

      return {
        nodes: nextNodes,
        selectedNodeId: groupNodeId,
        activeToolDialog:
          state.activeToolDialog && childIdSet.has(state.activeToolDialog.nodeId)
            ? null
            : state.activeToolDialog,
        history: {
          past: pushSnapshot(state.history.past, createSnapshot(state.nodes, state.edges)),
          future: [],
        },
        dragHistorySnapshot: null,
      };
    });

    if (didLayout && typeof window !== 'undefined' && animatedNodeIds.size > 0) {
      const runId = ++latestGroupLayoutAnimationRunId;
      window.setTimeout(() => {
        if (runId !== latestGroupLayoutAnimationRunId) {
          return;
        }

        set((state) => ({
          nodes: state.nodes.map((node) =>
            animatedNodeIds.has(node.id)
              ? {
                  ...node,
                  className: removeNodeClassName(node.className, GROUP_LAYOUT_ANIMATION_CLASS),
                }
              : node
          ),
        }));
      }, GROUP_LAYOUT_ANIMATION_MS + 40);
    }

    return didLayout;
  },

  reparentNodesToGroup: (nodeIds, groupNodeId) => {
    const uniqueIds = Array.from(new Set(nodeIds.filter((nodeId) => nodeId.trim().length > 0)));
    if (uniqueIds.length === 0) {
      return false;
    }

    let didReparent = false;

    set((state) => {
      const groupNode = state.nodes.find(
        (node) => node.id === groupNodeId && node.type === CANVAS_NODE_TYPES.group
      );
      if (!groupNode) {
        return {};
      }

      const nodeMap = new Map(state.nodes.map((node) => [node.id, node] as const));
      const groupAbsolutePosition = resolveAbsolutePosition(groupNode, nodeMap);
      const nodeIdSet = new Set(uniqueIds);

      const nextNodes = state.nodes.map((node) => {
        if (!nodeIdSet.has(node.id)) {
          return node;
        }

        if (node.id === groupNodeId || node.type === CANVAS_NODE_TYPES.group) {
          return node;
        }

        if (node.parentId === groupNodeId) {
          return node;
        }

        const absolutePosition = resolveAbsolutePosition(node, nodeMap);
        didReparent = true;
        return {
          ...node,
          parentId: groupNodeId,
          extent: undefined,
          position: {
            x: Math.round(absolutePosition.x - groupAbsolutePosition.x),
            y: Math.round(absolutePosition.y - groupAbsolutePosition.y),
          },
        };
      });

      if (!didReparent) {
        return {};
      }

      return {
        nodes: nextNodes,
        history: {
          past: pushSnapshot(state.history.past, createSnapshot(state.nodes, state.edges)),
          future: [],
        },
        dragHistorySnapshot: null,
      };
    });

    return didReparent;
  },

  detachNodesFromGroup: (nodeIds) => {
    const uniqueIds = Array.from(new Set(nodeIds.filter((nodeId) => nodeId.trim().length > 0)));
    if (uniqueIds.length === 0) {
      return false;
    }

    let didDetach = false;

    set((state) => {
      const nodeMap = new Map(state.nodes.map((node) => [node.id, node] as const));
      const nodeIdSet = new Set(uniqueIds);

      const nextNodes = state.nodes.map((node) => {
        if (!nodeIdSet.has(node.id) || node.type === CANVAS_NODE_TYPES.group) {
          return node;
        }

        if (!isGroupNodeId(node.parentId, nodeMap)) {
          return node;
        }

        const absolutePosition = resolveAbsolutePosition(node, nodeMap);
        didDetach = true;
        return {
          ...node,
          parentId: undefined,
          extent: undefined,
          position: {
            x: Math.round(absolutePosition.x),
            y: Math.round(absolutePosition.y),
          },
        };
      });

      if (!didDetach) {
        return {};
      }

      return {
        nodes: nextNodes,
        history: {
          past: pushSnapshot(state.history.past, createSnapshot(state.nodes, state.edges)),
          future: [],
        },
        dragHistorySnapshot: null,
      };
    });

    return didDetach;
  },

  ungroupNode: (groupNodeId) => {
    const state = get();
    const groupNode = state.nodes.find(
      (node) => node.id === groupNodeId && node.type === CANVAS_NODE_TYPES.group
    );
    if (!groupNode) {
      return false;
    }

    const nodeMap = new Map(state.nodes.map((node) => [node.id, node] as const));
    const children = state.nodes.filter((node) => node.parentId === groupNodeId);
    if (children.length === 0) {
      return false;
    }

    const nextNodes = state.nodes
      .filter((node) => node.id !== groupNodeId)
      .map((node) => {
        if (node.parentId !== groupNodeId) {
          return node;
        }

        const absolute = resolveAbsolutePosition(node, nodeMap);
        return {
          ...node,
          parentId: undefined,
          extent: undefined,
          position: {
            x: Math.round(absolute.x),
            y: Math.round(absolute.y),
          },
          selected: false,
        };
      });

    const nextEdges = state.edges.filter(
      (edge) => edge.source !== groupNodeId && edge.target !== groupNodeId
    );

    set({
      nodes: nextNodes,
      edges: nextEdges,
      selectedNodeId: state.selectedNodeId === groupNodeId ? null : state.selectedNodeId,
      activeToolDialog:
        state.activeToolDialog?.nodeId === groupNodeId ? null : state.activeToolDialog,
      history: {
        past: pushSnapshot(state.history.past, createSnapshot(state.nodes, state.edges)),
        future: [],
      },
      dragHistorySnapshot: null,
    });

    return true;
  },

  deleteEdge: (edgeId) => {
    set((state) => {
      const hasEdge = state.edges.some((edge) => edge.id === edgeId);
      if (!hasEdge) {
        return {};
      }

      const nextEdges = state.edges.filter((edge) => edge.id !== edgeId);
      const nextNodes = cleanupImageCollageNodesForRemovedEdges(state.nodes, state.edges, nextEdges);

      return {
        nodes: nextNodes,
        edges: nextEdges,
        history: {
          past: pushSnapshot(state.history.past, createSnapshot(state.nodes, state.edges)),
          future: [],
        },
        dragHistorySnapshot: null,
      };
    });
  },

  setSelectedNode: (nodeId) => {
    set({ selectedNodeId: nodeId });
  },

  setHighlightedReferenceSourceNode: (nodeId) => {
    set({ highlightedReferenceSourceNodeId: nodeId });
  },

  toggleNodeDescriptionPanel: (nodeId) => {
    set((state) => ({
      nodeDescriptionPanelOpenById: {
        ...state.nodeDescriptionPanelOpenById,
        [nodeId]: !state.nodeDescriptionPanelOpenById[nodeId],
      },
    }));
  },

  setNodeDescriptionPanelOpen: (nodeId, isOpen) => {
    set((state) => ({
      nodeDescriptionPanelOpenById: {
        ...state.nodeDescriptionPanelOpenById,
        [nodeId]: isOpen,
      },
    }));
  },

  openToolDialog: (dialog) => {
    set({ activeToolDialog: dialog });
  },

  closeToolDialog: () => {
    set({ activeToolDialog: null });
  },

  undo: () => {
    const state = get();
    const target = state.history.past[state.history.past.length - 1];
    if (!target) {
      return false;
    }

    const currentSnapshot = isCanvasNodePatchHistorySnapshot(target)
      ? createReverseNodePatchSnapshot(target, state.nodes, state.edges)
      : createSnapshot(state.nodes, state.edges);
    const appliedSnapshot = applyHistorySnapshot(state.nodes, state.edges, target);
    const nextPast = state.history.past.slice(0, -1);

    set({
      nodes: appliedSnapshot.nodes,
      edges: appliedSnapshot.edges,
      selectedNodeId: resolveSelectedNodeId(state.selectedNodeId, appliedSnapshot.nodes),
      activeToolDialog: resolveActiveToolDialog(state.activeToolDialog, appliedSnapshot.nodes),
      history: {
        past: nextPast,
        future: pushSnapshot(state.history.future, currentSnapshot),
      },
      dragHistorySnapshot: null,
    });
    return true;
  },

  redo: () => {
    const state = get();
    const target = state.history.future[state.history.future.length - 1];
    if (!target) {
      return false;
    }

    const currentSnapshot = isCanvasNodePatchHistorySnapshot(target)
      ? createReverseNodePatchSnapshot(target, state.nodes, state.edges)
      : createSnapshot(state.nodes, state.edges);
    const appliedSnapshot = applyHistorySnapshot(state.nodes, state.edges, target);
    const nextFuture = state.history.future.slice(0, -1);

    set({
      nodes: appliedSnapshot.nodes,
      edges: appliedSnapshot.edges,
      selectedNodeId: resolveSelectedNodeId(state.selectedNodeId, appliedSnapshot.nodes),
      activeToolDialog: resolveActiveToolDialog(state.activeToolDialog, appliedSnapshot.nodes),
      history: {
        past: pushSnapshot(state.history.past, currentSnapshot),
        future: nextFuture,
      },
      dragHistorySnapshot: null,
    });
    return true;
  },

  clearCanvas: () => {
    set((state) => {
      if (state.nodes.length === 0 && state.edges.length === 0) {
        return {};
      }

      return {
        nodes: [],
        edges: [],
        selectedNodeId: null,
        highlightedReferenceSourceNodeId: null,
        activeToolDialog: null,
        nodeDescriptionPanelOpenById: {},
        history: {
          past: pushSnapshot(state.history.past, createSnapshot(state.nodes, state.edges)),
          future: [],
        },
        dragHistorySnapshot: null,
      };
    });
  },

  applyMindMapLayout: () => {
    set((state) => {
      if (state.nodes.length === 0) {
        return {};
      }

      const positions = calculateMindMapLayout(
        state.nodes,
        state.edges,
        DEFAULT_LAYOUT_CONFIG
      );

      const updatedNodes = state.nodes.map((node) => {
        const newPosition = positions.get(node.id);
        if (newPosition) {
          return {
            ...node,
            position: newPosition,
          };
        }
        return node;
      });

      return {
        nodes: updatedNodes,
        history: {
          past: pushSnapshot(state.history.past, createSnapshot(state.nodes, state.edges)),
          future: [],
        },
      };
    });
  },

  setSnapToGrid: (enabled) => {
    set({ snapToGrid: enabled });
  },

  setSnapGridSize: (size) => {
    set({ snapGridSize: Math.max(5, Math.min(100, size)) });
  },

  setEnableNodeAlignment: (enabled) => {
    set({ enableNodeAlignment: enabled });
  },

  setAlignmentThreshold: (threshold) => {
    set({ alignmentThreshold: Math.max(5, Math.min(50, threshold)) });
  },

  addImageFromBase64: async (base64, width, height) => {
    const { prepareNodeImageBinary } = await import('@/commands/image');
    
    const isJpeg = base64.startsWith('/9j/') || !base64.startsWith('iVBOR');
    const base64Data = base64.replace(/^data:image\/\w+;base64,/, '');
    const binaryString = atob(base64Data);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i += 1) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    const extension = isJpeg ? 'jpg' : 'png';
    const result = await prepareNodeImageBinary(bytes, extension, 512);

    const state = get();
    const viewportCenterX = state.canvasViewportSize.width / 2;
    const viewportCenterY = state.canvasViewportSize.height / 2;
    const zoom = Math.max(0.01, state.currentViewport.zoom || 1);
    const centerX = (-state.currentViewport.x + viewportCenterX) / zoom;
    const centerY = (-state.currentViewport.y + viewportCenterY) / zoom;

    const aspectRatio = `${width}:${height}`;
    const nodeSize = resolveGeneratedImageNodeDimensions(aspectRatio);

    const node = canvasNodeFactory.createNode(CANVAS_NODE_TYPES.upload, { x: centerX - nodeSize.width / 2, y: centerY - nodeSize.height / 2 }, {
      imageUrl: result.imagePath,
      previewImageUrl: result.previewImagePath,
      aspectRatio: result.aspectRatio,
    });
    node.width = nodeSize.width;
    node.height = nodeSize.height;
    node.style = {
      ...(node.style ?? {}),
      width: nodeSize.width,
      height: nodeSize.height,
    };

    set({
      nodes: [...state.nodes, node],
      selectedNodeId: node.id,
      activeToolDialog: null,
      history: {
        past: pushSnapshot(state.history.past, createSnapshot(state.nodes, state.edges)),
        future: [],
      },
      dragHistorySnapshot: null,
    });

    return node.id;
  },
}));
