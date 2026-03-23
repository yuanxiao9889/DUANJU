import { create } from 'zustand';
import {
  Connection,
  EdgeChange,
  NodeChange,
  type Viewport,
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
} from '@xyflow/react';
import { v4 as uuidv4 } from 'uuid';

import {
  CANVAS_NODE_TYPES,
  DEFAULT_ASPECT_RATIO,
  DEFAULT_NODE_WIDTH,
  EXPORT_RESULT_NODE_DEFAULT_WIDTH,
  EXPORT_RESULT_NODE_LAYOUT_HEIGHT,
  EXPORT_RESULT_NODE_MIN_HEIGHT,
  EXPORT_RESULT_NODE_MIN_WIDTH,
  type ActiveToolDialog,
  type CanvasEdge,
  type CanvasNode,
  type CanvasNodeData,
  type CanvasNodeType,
  type ExportImageNodeResultKind,
  type ImageEditNodeData,
  type NodeToolType,
  type StoryboardExportOptions,
  type StoryboardFrameItem,
  type ScriptChapterNodeData,
  isStoryboardSplitNode,
} from '@/features/canvas/domain/canvasNodes';
import {
  nodeHasSourceHandle,
  nodeHasTargetHandle,
} from '@/features/canvas/domain/nodeRegistry';
import { EXPORT_RESULT_DISPLAY_NAME } from '@/features/canvas/domain/nodeDisplay';
import { nodeCatalog } from '@/features/canvas/application/nodeCatalog';
import { canvasNodeFactory } from '@/features/canvas/application/canvasServices';
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
import { useSettingsStore } from '@/stores/settingsStore';
import { getImageModel } from '@/features/canvas/models';

export type {
  ActiveToolDialog,
  CanvasEdge,
  CanvasNode,
  CanvasNodeData,
  CanvasNodeType,
  NodeToolType,
  StoryboardFrameItem,
};

export interface CanvasHistorySnapshot {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
}

export interface CanvasHistoryState {
  past: CanvasHistorySnapshot[];
  future: CanvasHistorySnapshot[];
}

const MAX_HISTORY_STEPS = 50;
const IMAGE_NODE_VISUAL_MIN_EDGE = 96;
const DERIVED_NODE_COLUMN_GAP = 28;
const DERIVED_NODE_STACK_GAP = 20;
const IMAGE_EDIT_DERIVED_NODE_STACK_GAP = 12;
const DERIVED_NODE_MAX_ROWS_PER_COLUMN = 4;
const DERIVED_NODE_NEXT_COLUMN_GAP = 32;
const DERIVED_NODE_COLUMN_ALIGNMENT_THRESHOLD = 48;
const STORYBOARD_SPLIT_NODE_BASE_WIDTH = 620;
const STORYBOARD_SPLIT_NODE_MIN_HEIGHT = 360;
const STORYBOARD_SPLIT_NODE_WIDTH_PADDING = 200;
const STORYBOARD_SPLIT_NODE_HEIGHT_PADDING = 160;
const STORYBOARD_SPLIT_NODE_COL_WIDTH = 136;
const STORYBOARD_SPLIT_NODE_ROW_HEIGHT = 92;
type StoryboardGridAxis = 'rows' | 'cols';

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
  activeToolDialog: ActiveToolDialog | null;
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
    data?: Partial<CanvasNodeData>
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
    }
  ) => string | null;
  addStoryboardSplitNode: (
    sourceNodeId: string,
    rows: number,
    cols: number,
    frames: StoryboardFrameItem[],
    frameAspectRatio?: string
  ) => string | null;

  updateNodeData: (nodeId: string, data: Partial<CanvasNodeData>) => void;
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

  deleteNode: (nodeId: string) => void;
  deleteNodes: (nodeIds: string[]) => void;
  groupNodes: (nodeIds: string[]) => string | null;
  layoutGroupNode: (groupNodeId: string) => boolean;
  reparentNodesToGroup: (nodeIds: string[], groupNodeId: string) => boolean;
  ungroupNode: (groupNodeId: string) => boolean;
  deleteEdge: (edgeId: string) => void;
  setSelectedNode: (nodeId: string | null) => void;

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
  return rawNodes
    .map((node) => {
      if (!Object.values(CANVAS_NODE_TYPES).includes(node.type as CanvasNodeType)) {
        return null;
      }

      const definition = nodeCatalog.getDefinition(node.type as CanvasNodeType);
      const mergedData = {
        ...definition.createDefaultData(),
        ...(node.data as Partial<CanvasNodeData>),
      } as CanvasNodeData;

      if (node.type === CANVAS_NODE_TYPES.storyboardSplit) {
        const frames = (mergedData as { frames?: StoryboardFrameItem[] }).frames ?? [];
        const firstFrameAspectRatio = frames.find((frame) => typeof frame.aspectRatio === 'string')
          ?.aspectRatio;
        const normalizedFrameAspectRatio =
          (typeof (mergedData as { frameAspectRatio?: unknown }).frameAspectRatio === 'string'
            ? (mergedData as { frameAspectRatio?: string }).frameAspectRatio
            : null) ??
          firstFrameAspectRatio ??
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

      return {
        ...node,
        type: node.type as CanvasNodeType,
        data: mergedData,
      };
    })
    .filter((node): node is CanvasNode => Boolean(node));
}

function normalizeHistory(history?: CanvasHistoryState): CanvasHistoryState {
  if (!history) {
    return { past: [], future: [] };
  }

  const normalizeSnapshot = (snapshot: CanvasHistorySnapshot): CanvasHistorySnapshot => {
    const normalizedNodes = normalizeNodes(snapshot.nodes);
    return {
      nodes: normalizedNodes,
      edges: normalizeEdgesWithNodes(snapshot.edges, normalizedNodes),
    };
  };

  return {
    past: history.past.slice(-MAX_HISTORY_STEPS).map(normalizeSnapshot),
    future: history.future.slice(-MAX_HISTORY_STEPS).map(normalizeSnapshot),
  };
}

function createSnapshot(nodes: CanvasNode[], edges: CanvasEdge[]): CanvasHistorySnapshot {
  return { nodes, edges };
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

function collidesWithExistingNodes(
  nodes: CanvasNode[],
  x: number,
  y: number,
  width: number,
  height: number
): boolean {
  return nodes.some((node) => {
    const nodeSize = getNodeSize(node);
    const margin = 8;
    return (
      x < node.position.x + nodeSize.width + margin &&
      x + width + margin > node.position.x &&
      y < node.position.y + nodeSize.height + margin &&
      y + height + margin > node.position.y
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
  newNodeHeight: number
): { x: number; y: number } | null {
  const sourceSize = getNodeSize(sourceNode);
  const stackGap = resolveDerivedNodeStackGap(sourceNode);
  const anchorX = sourceNode.position.x + sourceSize.width + DERIVED_NODE_COLUMN_GAP;
  const anchorY = sourceNode.position.y;
  const minAcceptedColumnX = anchorX - DERIVED_NODE_COLUMN_ALIGNMENT_THRESHOLD;
  const stepX = newNodeWidth + DERIVED_NODE_NEXT_COLUMN_GAP;
  const stepY = newNodeHeight + stackGap;

  const directTargetIds = new Set(
    edges
      .filter((edge) => edge.source === sourceNode.id)
      .map((edge) => edge.target)
  );

  const directTargets = nodes.filter(
    (node) => directTargetIds.has(node.id) && node.position.x >= minAcceptedColumnX
  );

  const occupiedSlots = new Set<string>();
  for (const targetNode of directTargets) {
    const columnOffset = Math.max(0, targetNode.position.x - anchorX);
    const rowOffset = Math.max(0, targetNode.position.y - anchorY);
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
      if (!collidesWithExistingNodes(nodes, candidateX, candidateY, newNodeWidth, newNodeHeight)) {
        return { x: candidateX, y: candidateY };
      }
    }
  }

  return null;
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
  if (type !== CANVAS_NODE_TYPES.imageEdit) {
    return data;
  }

  const { lastImageEditModelId, lastImageEditSize } = useSettingsStore.getState();
  const preferredModelId = getImageModel(lastImageEditModelId).id;
  const imageEditData = data as Partial<ImageEditNodeData>;

  return {
    model: imageEditData.model ?? preferredModelId,
    size: imageEditData.size ?? lastImageEditSize,
    ...imageEditData,
  } as Partial<CanvasNodeData>;
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

  if (sourceNode.type === CANVAS_NODE_TYPES.storyboardSplit) {
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

function pushSnapshot(
  snapshots: CanvasHistorySnapshot[],
  snapshot: CanvasHistorySnapshot
): CanvasHistorySnapshot[] {
  const last = snapshots[snapshots.length - 1];
  if (last && last.nodes === snapshot.nodes && last.edges === snapshot.edges) {
    return snapshots;
  }

  const next = [...snapshots, snapshot];
  if (next.length > MAX_HISTORY_STEPS) {
    next.shift();
  }
  return next;
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
  activeToolDialog: null,
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
            (change): change is NodeChange<CanvasNode> & { id: string } =>
              change.type === 'dimensions'
              && 'resizing' in change
              && change.resizing === false
              && typeof change.id === 'string'
          )
          .map((change) => change.id)
      );

      let nextNodes = applyNodeChanges<CanvasNode>(changes, state.nodes);
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
      const hasInteractionMove = hasDragMove || hasResizeMove;
      const hasInteractionEnd = hasDragEnd || hasResizeEnd;

      let nextHistory = state.history;
      let nextDragHistorySnapshot = state.dragHistorySnapshot;

      if (hasInteractionMove && !nextDragHistorySnapshot) {
        nextDragHistorySnapshot = createSnapshot(state.nodes, state.edges);
      }

      if (hasInteractionEnd) {
        const snapshot = nextDragHistorySnapshot ?? createSnapshot(state.nodes, state.edges);
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
      const nextEdges = applyEdgeChanges<CanvasEdge>(changes, state.edges);
      const hasMeaningfulChange = changes.some((change) => change.type !== 'select');

      if (!hasMeaningfulChange) {
        return { edges: nextEdges };
      }

      return {
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
      edges: addEdge<CanvasEdge>(
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
      activeToolDialog: null,
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

  addNode: (type, position, data = {}) => {
    const state = get();
    const initialData = resolveNodeCreationDefaults(type, data);
    const newNode = canvasNodeFactory.createNode(type, position, initialData);
    set({
      nodes: [...state.nodes, newNode],
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

    const preferredColumnPosition = resolvePreferredDerivedColumnPosition(
      state.nodes,
      state.edges,
      sourceNode,
      newNodeWidth,
      newNodeHeight
    );
    if (preferredColumnPosition) {
      return preferredColumnPosition;
    }

    const sourceSize = getNodeSize(sourceNode);
    const stackGap = resolveDerivedNodeStackGap(sourceNode);
    const anchorX = sourceNode.position.x + sourceSize.width + DERIVED_NODE_COLUMN_GAP;
    const anchorY = sourceNode.position.y;

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
      { x: sourceNode.position.x, y: sourceNode.position.y + sourceSize.height + stackGap },
      { x: sourceNode.position.x - newNodeWidth - 20, y: sourceNode.position.y },
      { x: sourceNode.position.x, y: sourceNode.position.y - newNodeHeight - stackGap },
    ];

    let bestInView: { x: number; y: number; score: number } | null = null;
    let bestOutOfView: { x: number; y: number; score: number } | null = null;

    const evaluateCandidate = (x: number, y: number) => {
      if (collidesWithExistingNodes(state.nodes, x, y, newNodeWidth, newNodeHeight)) {
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
    const resolvedAspectRatio = resolveDerivedAspectRatio(sourceNode, aspectRatio);
    const derivedSize = resolveGeneratedImageNodeDimensions(resolvedAspectRatio);
    const position = state.findNodePosition(
      sourceNodeId,
      derivedSize.width,
      derivedSize.height
    );
    const node = canvasNodeFactory.createNode(CANVAS_NODE_TYPES.upload, position, {
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

  addDerivedExportNode: (sourceNodeId, imageUrl, aspectRatio, previewImageUrl, options) => {
    const state = get();
    const sourceNode = state.nodes.find((node) => node.id === sourceNodeId);
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
    const node = canvasNodeFactory.createNode(CANVAS_NODE_TYPES.exportImage, position, {
      ...exportNodeData,
    });
    node.width = derivedSize.width;
    node.height = derivedSize.height;
    node.style = {
      ...(node.style ?? {}),
      width: derivedSize.width,
      height: derivedSize.height,
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

  addStoryboardSplitNode: (sourceNodeId, rows, cols, frames, frameAspectRatio) => {
    const state = get();
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

    const node = canvasNodeFactory.createNode(CANVAS_NODE_TYPES.storyboardSplit, position, {
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

  updateNodeData: (nodeId, data) => {
    set((state) => {
      let changed = false;
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

      const frames = node.data.frames.filter((f) => f.id !== frameId);
      if (frames.length === node.data.frames.length) {
        return {};
      }

      const reorderedFrames = frames
        .sort((a, b) => a.order - b.order)
        .map((frame, index) => ({ ...frame, order: index }));
      const gridLayout = resolveStoryboardGridLayoutForAxis(
        reorderedFrames.length,
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
                  frames: reorderedFrames,
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

  deleteNode: (nodeId) => {
    get().deleteNodes([nodeId]);
  },

  deleteNodes: (nodeIds) => {
    const uniqueIds = Array.from(new Set(nodeIds.filter((nodeId) => nodeId.trim().length > 0)));
    if (uniqueIds.length === 0) {
      return;
    }

    set((state) => {
      const existingIds = uniqueIds.filter((nodeId) => state.nodes.some((node) => node.id === nodeId));
      if (existingIds.length === 0) {
        return {};
      }

      const deleteSet = collectNodeIdsWithDescendants(state.nodes, existingIds);
      const nextNodes = state.nodes.filter((node) => !deleteSet.has(node.id));
      const nextEdges = state.edges.filter(
        (edge) => !deleteSet.has(edge.source) && !deleteSet.has(edge.target)
      );

      return {
        nodes: nextNodes,
        edges: nextEdges,
        selectedNodeId:
          state.selectedNodeId && deleteSet.has(state.selectedNodeId) ? null : state.selectedNodeId,
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
        extent: 'parent',
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
          return {
            ...node,
            width: layoutResult.size.width,
            height: layoutResult.size.height,
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
        }

        return {
          ...node,
          position: nextPosition,
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

        if (node.parentId === groupNodeId && node.extent === 'parent') {
          return node;
        }

        const absolutePosition = resolveAbsolutePosition(node, nodeMap);
        didReparent = true;
        return {
          ...node,
          parentId: groupNodeId,
          extent: 'parent' as const,
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

      return {
        edges: state.edges.filter((edge) => edge.id !== edgeId),
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

    const currentSnapshot = createSnapshot(state.nodes, state.edges);
    const nextPast = state.history.past.slice(0, -1);

    set({
      nodes: target.nodes,
      edges: target.edges,
      selectedNodeId: resolveSelectedNodeId(state.selectedNodeId, target.nodes),
      activeToolDialog: resolveActiveToolDialog(state.activeToolDialog, target.nodes),
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

    const currentSnapshot = createSnapshot(state.nodes, state.edges);
    const nextFuture = state.history.future.slice(0, -1);

    set({
      nodes: target.nodes,
      edges: target.edges,
      selectedNodeId: resolveSelectedNodeId(state.selectedNodeId, target.nodes),
      activeToolDialog: resolveActiveToolDialog(state.activeToolDialog, target.nodes),
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
        activeToolDialog: null,
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
