import {
  useState,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import {
  ReactFlow,
  Background,
  MiniMap,
  BackgroundVariant,
  SelectionMode,
  useReactFlow,
  type Connection,
  type EdgeChange,
  type FinalConnectionState,
  type HandleType,
  type NodeChange,
  type OnConnectStartParams,
  type Viewport,
} from '@xyflow/react';
import { join } from '@tauri-apps/api/path';
import { open } from '@tauri-apps/plugin-dialog';
import { useTranslation } from 'react-i18next';
import { Upload, ImagePlus, Grid3x3, Map as MapIcon, Plus, Minus, AlignCenter } from 'lucide-react';
import '@xyflow/react/dist/style.css';

import {
  ASSET_DRAG_MIME_TYPE,
  parseAssetDragPayload,
} from '@/features/assets/domain/types';
import {
  subscribeAssetItemDeleted,
  subscribeAssetItemUpdated,
} from '@/features/assets/application/assetEvents';
import { useAssetStore } from '@/stores/assetStore';
import { useCanvasStore } from '@/stores/canvasStore';
import { useProjectStore } from '@/stores/projectStore';
import { useScriptEditorStore } from '@/stores/scriptEditorStore';
import { getConfiguredApiKeyCount, useSettingsStore } from '@/stores/settingsStore';
import { canvasAiGateway, canvasEventBus } from '@/features/canvas/application/canvasServices';
import {
  CANVAS_NODE_TYPES,
  type CanvasEdge,
  type CanvasNode,
  type CanvasNodeType,
  type CanvasNodeData,
  type ScriptChapterNodeData,
  DEFAULT_NODE_WIDTH,
  getNodePrimaryImageSource,
  normalizeSceneCards,
  resolveSingleImageConnectionSource,
} from '@/features/canvas/domain/canvasNodes';
import { isSupportedAudioFile, prepareNodeAudioFromFile } from '@/features/canvas/application/audioData';
import { prepareNodeImage, prepareNodeImageFromFile } from '@/features/canvas/application/imageData';
import { prepareNodeVideoFromFile } from '@/features/canvas/application/videoData';
import {
  buildGenerationErrorReport,
  CURRENT_RUNTIME_SESSION_ID,
} from '@/features/canvas/application/generationErrorReport';
import { resolveErrorContent, showErrorDialog } from '@/features/canvas/application/errorDialog';
import {
  getConnectMenuNodeTypes,
  nodeHasSourceHandle,
  nodeHasTargetHandle,
} from '@/features/canvas/domain/nodeRegistry';
import {
  calculateChildNodePosition,
  calculateBranchNodePosition,
  DEFAULT_LAYOUT_CONFIG,
} from '@/features/canvas/application/mindMapLayout';
import { embedStoryboardImageMetadata, saveImageSourceToDirectory } from '@/commands/image';
import { resolveNodeDisplayName } from '@/features/canvas/domain/nodeDisplay';
import { listModelProviders } from '@/features/canvas/models';
import { isCanvasNodeTypeEnabled } from '@/features/canvas/application/nodeCatalog';
import { nodeTypes } from './nodes';
import { edgeTypes } from './edges';
import { NodeSelectionMenu } from './NodeSelectionMenu';
import { SelectedNodeOverlay } from './ui/SelectedNodeOverlay';
import { NodeToolDialog } from './ui/NodeToolDialog';
import { ImageViewerModal } from './ui/ImageViewerModal';
import { MissingApiKeyHint } from '@/features/settings/MissingApiKeyHint';
import { eventMatchesShortcut } from '@/features/settings/keyboardShortcuts';
import { ScriptBiblePanel } from './ui/ScriptBiblePanel';
import { ScriptWelcomeDialog } from './ui/ScriptWelcomeDialog';
import { SceneStudioPanel } from './ui/SceneStudioPanel';
import { AlignmentGuides } from './ui/AlignmentGuides';
import { detectAlignments, type AlignmentGuide } from './application/nodeAlignment';
import { MergedConnectionAnchor } from './ui/MergedConnectionAnchor';
import { BranchConnectionPreview } from './ui/BranchConnectionPreview';
import { BatchOperationMenu } from './ui/BatchOperationMenu';
import { calculateNodesBounds } from './application/nodeBounds';
import { GroupSidebar } from './ui/GroupSidebar';
import { SelectionGroupBar } from './ui/SelectionGroupBar';
import { CanvasAssetDock } from './ui/CanvasAssetDock';

const DEFAULT_VIEWPORT: Viewport = { x: 0, y: 0, zoom: 1 };

interface PendingConnectStart {
  nodeId: string;
  handleType: HandleType;
  handleId?: string;
  start?: {
    x: number;
    y: number;
  };
}

interface PreviewConnectionVisual {
  d: string;
  stroke: string;
  strokeWidth: number;
  strokeLinecap: 'butt' | 'round' | 'square';
  left: number;
  top: number;
  width: number;
  height: number;
}

interface ClipboardSnapshot {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
}

type CanvasDragOverlayKind = 'files' | 'asset' | null;

interface DuplicateOptions {
  explicitOffset?: { x: number; y: number };
  disableOffsetIteration?: boolean;
  suppressSelect?: boolean;
  suppressPersist?: boolean;
}

interface DuplicateResult {
  firstNodeId: string | null;
  idMap: globalThis.Map<string, string>;
}

const ALT_DRAG_COPY_Z_INDEX = 2000;
const GENERATION_JOB_POLL_INTERVAL_MS = 1400;
const GENERATION_JOB_RECOVERY_THRESHOLD_MS = 2 * 60 * 1000;
const GENERATION_JOB_RECOVERY_SWEEP_INTERVAL_MS = 15 * 1000;
const GENERATION_JOB_STALE_ACTIVITY_MS = 20 * 1000;
const GENERATION_JOB_RESULT_RETRY_INTERVAL_MS = 4000;
const DRAG_OVERLAY_IDLE_CLEAR_MS = 420;

interface GenerationStoryboardMetadata {
  gridRows: number;
  gridCols: number;
  frameNotes: string[];
}

interface PendingGenerationNodeState {
  nodeId: string;
  jobId: string;
  generationProviderId: string;
  data: Record<string, unknown>;
}

function sleep(delayMs: number): Promise<void> {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, delayMs);
  });
}

function isPendingExportGenerationNode(node: CanvasNode): boolean {
  if (node.type !== CANVAS_NODE_TYPES.exportImage) {
    return false;
  }

  const data = node.data as Record<string, unknown>;
  return data.isGenerating === true
    && typeof data.generationJobId === 'string'
    && data.generationJobId.trim().length > 0;
}

function hasGenerationStoryboardMetadata(value: unknown): value is GenerationStoryboardMetadata {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<GenerationStoryboardMetadata>;
  return typeof candidate.gridRows === 'number'
    && Number.isFinite(candidate.gridRows)
    && typeof candidate.gridCols === 'number'
    && Number.isFinite(candidate.gridCols)
    && Array.isArray(candidate.frameNotes);
}

function padTimestampSegment(value: number): string {
  return String(value).padStart(2, '0');
}

function buildTimestampFolderName(date = new Date()): string {
  return `${date.getFullYear()}${padTimestampSegment(date.getMonth() + 1)}${padTimestampSegment(date.getDate())}-${padTimestampSegment(date.getHours())}${padTimestampSegment(date.getMinutes())}${padTimestampSegment(date.getSeconds())}`;
}

function normalizeDialogDirectoryPath(value: string | string[] | null): string | null {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value;
  }

  if (Array.isArray(value)) {
    const [firstValue] = value;
    return typeof firstValue === 'string' && firstValue.trim().length > 0 ? firstValue : null;
  }

  return null;
}

function resolveSelectedImageSuggestedFileName(node: CanvasNode, index: number): string {
  const sourceFileName =
    'sourceFileName' in node.data && typeof node.data.sourceFileName === 'string'
      ? node.data.sourceFileName.trim()
      : '';
  if (sourceFileName) {
    return sourceFileName;
  }

  const displayName = resolveNodeDisplayName(node.type, node.data).trim();
  return displayName || `image-${index + 1}`;
}

function getNodeSize(node: CanvasNode): { width: number; height: number } {
  const styleWidth = typeof node.style?.width === 'number' ? node.style.width : null;
  const styleHeight = typeof node.style?.height === 'number' ? node.style.height : null;
  return {
    width: node.measured?.width ?? styleWidth ?? DEFAULT_NODE_WIDTH,
    height: node.measured?.height ?? styleHeight ?? 200,
  };
}

function resolveAbsoluteNodePosition(
  node: CanvasNode,
  nodeMap: globalThis.Map<string, CanvasNode>
): { x: number; y: number } {
  let x = node.position.x;
  let y = node.position.y;
  let currentParentId = node.parentId;
  const visited = new Set<string>();

  while (currentParentId && !visited.has(currentParentId)) {
    visited.add(currentParentId);
    const parentNode = nodeMap.get(currentParentId);
    if (!parentNode) {
      break;
    }
    x += parentNode.position.x;
    y += parentNode.position.y;
    currentParentId = parentNode.parentId;
  }

  return { x, y };
}

function findContainingGroupId(
  node: CanvasNode,
  allNodes: CanvasNode[]
): string | null {
  if (node.type === CANVAS_NODE_TYPES.group) {
    return null;
  }

  const nodeMap = new globalThis.Map(allNodes.map((item) => [item.id, item] as const));
  const nodeAbsolutePosition = resolveAbsoluteNodePosition(node, nodeMap);
  const nodeSize = getNodeSize(node);
  const nodeCenter = {
    x: nodeAbsolutePosition.x + nodeSize.width / 2,
    y: nodeAbsolutePosition.y + nodeSize.height / 2,
  };

  const candidateGroups = allNodes
    .filter((item) => item.type === CANVAS_NODE_TYPES.group && item.id !== node.id)
    .map((groupNode) => {
      const groupAbsolutePosition = resolveAbsoluteNodePosition(groupNode, nodeMap);
      const groupSize = getNodeSize(groupNode);
      const containsCenter =
        nodeCenter.x >= groupAbsolutePosition.x &&
        nodeCenter.x <= groupAbsolutePosition.x + groupSize.width &&
        nodeCenter.y >= groupAbsolutePosition.y &&
        nodeCenter.y <= groupAbsolutePosition.y + groupSize.height;

      return containsCenter
        ? {
            id: groupNode.id,
            area: groupSize.width * groupSize.height,
          }
        : null;
    })
    .filter((group): group is { id: string; area: number } => Boolean(group))
    .sort((left, right) => left.area - right.area);

  return candidateGroups[0]?.id ?? null;
}

function hasRectCollision(
  candidateRect: { x: number; y: number; width: number; height: number },
  nodes: CanvasNode[],
  ignoreNodeIds: Set<string>
): boolean {
  const margin = 18;
  return nodes.some((node) => {
    if (ignoreNodeIds.has(node.id)) {
      return false;
    }
    const size = getNodeSize(node);
    return (
      candidateRect.x < node.position.x + size.width + margin &&
      candidateRect.x + candidateRect.width + margin > node.position.x &&
      candidateRect.y < node.position.y + size.height + margin &&
      candidateRect.y + candidateRect.height + margin > node.position.y
    );
  });
}

function cloneNodeData<T>(value: T): T {
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

function isTypingTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element) {
    return false;
  }
  const tagName = element.tagName.toLowerCase();
  return tagName === 'input' || tagName === 'textarea' || element.isContentEditable;
}

function resolveClipboardImageFile(event: ClipboardEvent): File | null {
  const clipboardItems = event.clipboardData?.items;
  if (!clipboardItems) {
    return null;
  }

  for (const item of Array.from(clipboardItems)) {
    if (!item.type.startsWith('image/')) {
      continue;
    }

    const file = item.getAsFile();
    if (!file) {
      continue;
    }

    const existingName = typeof file.name === 'string' ? file.name.trim() : '';
    if (existingName) {
      return file;
    }

    const subtype = item.type.split('/')[1]?.split('+')[0] || 'png';
    return new File([file], `pasted-image.${subtype}`, {
      type: file.type || item.type,
      lastModified: Date.now(),
    });
  }

  return null;
}

function resolveAllowedNodeTypes(
  handleType: HandleType,
  projectType: 'storyboard' | 'script' = 'storyboard',
  sourceNodeId?: string | null,
  nodes?: CanvasNode[]
): CanvasNodeType[] {
  const baseTypes = getConnectMenuNodeTypes(handleType, projectType).filter(
    (type) => isCanvasNodeTypeEnabled(type)
  );
  
  if (!sourceNodeId || !nodes) {
    return baseTypes;
  }
  
  const sourceNode = nodes.find((n) => n.id === sourceNodeId);
  if (!sourceNode) {
    return baseTypes;
  }

  let allowedTypes = baseTypes;

  if (handleType === 'source') {
    const isSingleImageSource = Boolean(resolveSingleImageConnectionSource(sourceNode));
    const isVideoReferenceSource =
      sourceNode.type === CANVAS_NODE_TYPES.video
      || sourceNode.type === CANVAS_NODE_TYPES.jimengVideoResult;
    const shouldHideVoiceDesign =
      isSingleImageSource
      || isVideoReferenceSource
      || sourceNode.type === CANVAS_NODE_TYPES.jimeng
      || sourceNode.type === CANVAS_NODE_TYPES.jimengImage
      || sourceNode.type === CANVAS_NODE_TYPES.jimengImageResult;

    if (!isSingleImageSource) {
      allowedTypes = allowedTypes.filter(
        (type) => type !== CANVAS_NODE_TYPES.jimengImage
      );
    }

    if (shouldHideVoiceDesign) {
      allowedTypes = allowedTypes.filter(
        (type) => type !== CANVAS_NODE_TYPES.ttsVoiceDesign
      );
    }
  }
  
  const isSourceRootNode = sourceNode.type === CANVAS_NODE_TYPES.scriptRoot;
  const isSourceChapterNode = sourceNode.type === CANVAS_NODE_TYPES.scriptChapter;
  
  if (isSourceChapterNode) {
    const sourceData = sourceNode.data as ScriptChapterNodeData;
    const sourceDepth = sourceData.depth || 1;
    const isMainChapter = sourceData.branchType === 'main' && sourceDepth === 1;
    
    if (isMainChapter) {
      return allowedTypes.filter(
        (type) => type !== CANVAS_NODE_TYPES.scriptChapter || 
        (type === CANVAS_NODE_TYPES.scriptChapter && handleType === 'source')
      );
    }
    
    return allowedTypes.filter((type) => type !== CANVAS_NODE_TYPES.scriptChapter);
  }
  
  if (isSourceRootNode) {
    return allowedTypes;
  }
  
  return allowedTypes;
}

function canNodeTypeBeManualConnectionSource(type: CanvasNodeType): boolean {
  return nodeHasSourceHandle(type);
}

function shouldInsertIntoLinearOutgoingFlow(node: CanvasNode | undefined): boolean {
  return node?.type === CANVAS_NODE_TYPES.scriptRoot
    || node?.type === CANVAS_NODE_TYPES.scriptChapter;
}

function canNodeBeManualConnectionSource(nodeId: string | null | undefined, nodes: CanvasNode[]): boolean {
  if (!nodeId) {
    return false;
  }
  const node = nodes.find((item) => item.id === nodeId);
  return node ? canNodeTypeBeManualConnectionSource(node.type) : false;
}

function getClientPosition(event: MouseEvent | TouchEvent): { x: number; y: number } | null {
  if ('clientX' in event && 'clientY' in event) {
    return { x: event.clientX, y: event.clientY };
  }

  const touch = 'changedTouches' in event
    ? event.changedTouches[0] ?? event.touches[0]
    : null;
  if (!touch) {
    return null;
  }

  return { x: touch.clientX, y: touch.clientY };
}

function resolveDropNodeElement(
  eventTarget: EventTarget | null,
  clientPosition: { x: number; y: number }
): HTMLElement | null {
  const elementTarget = eventTarget instanceof Element ? eventTarget : null;
  const nodeElementFromTarget = elementTarget?.closest?.('.react-flow__node[data-id]') as HTMLElement | null;
  const nodeElementFromPoint = document
    .elementFromPoint(clientPosition.x, clientPosition.y)
    ?.closest?.('.react-flow__node[data-id]') as HTMLElement | null;

  return nodeElementFromTarget ?? nodeElementFromPoint;
}

function resolveDropNodeId(
  eventTarget: EventTarget | null,
  clientPosition: { x: number; y: number }
): string | null {
  return resolveDropNodeElement(eventTarget, clientPosition)?.dataset?.id ?? null;
}

function createPreviewPath(line: PreviewConnectionLine): string {
  const { start, end, handleType } = line;
  const deltaX = end.x - start.x;
  const curveStrength = Math.max(36, Math.min(120, Math.abs(deltaX) * 0.4));
  const handleDirection = handleType === 'source' ? 1 : -1;
  const isReverseDrag = deltaX * handleDirection < 0;
  const effectiveDirection = isReverseDrag ? -handleDirection : handleDirection;
  const startControlX = start.x + effectiveDirection * curveStrength;
  const endControlX = end.x - effectiveDirection * curveStrength;

  return `M ${start.x} ${start.y} C ${startControlX} ${start.y}, ${endControlX} ${end.y}, ${end.x} ${end.y}`;
}

interface PreviewConnectionLine {
  start: { x: number; y: number };
  end: { x: number; y: number };
  handleType: HandleType;
}

export function Canvas() {
  const { t } = useTranslation();
  const reactFlowInstance = useReactFlow();
  const { zoomIn, zoomOut } = reactFlowInstance;
  const wrapperRef = useRef<HTMLDivElement>(null);
  const reactFlowWrapperRef = useRef<HTMLDivElement>(null);
  const suppressNextPaneClickRef = useRef(false);
  const suppressNextEdgeClickRef = useRef(false);

  const [showNodeMenu, setShowNodeMenu] = useState(false);
  const [showWelcomeDialog, setShowWelcomeDialog] = useState(false);
  const [alignmentGuides, setAlignmentGuides] = useState<AlignmentGuide[]>([]);
  const [isDraggingNode, setIsDraggingNode] = useState(false);
  const [isDraggingBranchConnection, setIsDraggingBranchConnection] = useState(false);
  const [branchConnectionSource, setBranchConnectionSource] = useState<CanvasNode[]>([]);
  const [branchConnectionPosition, setBranchConnectionPosition] = useState<{ x: number; y: number } | null>(null);
  const [showBatchMenu, setShowBatchMenu] = useState(false);
  const [isExportingSelectedImages, setIsExportingSelectedImages] = useState(false);
  const [batchMenuPosition, setBatchMenuPosition] = useState({ x: 0, y: 0 });
  const [menuPosition, setMenuPosition] = useState({ x: 0, y: 0 });
  const [flowPosition, setFlowPosition] = useState({ x: 0, y: 0 });
  const [menuAllowedTypes, setMenuAllowedTypes] = useState<CanvasNodeType[] | undefined>(
    undefined
  );
  const [pendingConnectStart, setPendingConnectStart] = useState<PendingConnectStart | null>(
    null
  );
  const [previewConnectionVisual, setPreviewConnectionVisual] =
    useState<PreviewConnectionVisual | null>(null);
  const [dragOverlayKind, setDragOverlayKind] = useState<CanvasDragOverlayKind>(null);

  const isRestoringCanvasRef = useRef(true);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copiedSnapshotRef = useRef<ClipboardSnapshot | null>(null);
  const pasteIterationRef = useRef(0);
  const pasteImageHandledRef = useRef(false);
  const dragOverlayClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeGenerationPollNodeIdsRef = useRef(new Set<string>());
  const activeGenerationRecoveryNodeIdsRef = useRef(new Set<string>());
  const generationNodeActivityAtRef = useRef(new Map<string, number>());
  const duplicateNodesRef = useRef<((sourceNodeIds: string[]) => string | null) | null>(null);
  const connectionPointerRef = useRef<{ x: number; y: number } | null>(null);
  const connectionSpacePanActiveRef = useRef(false);
  const connectionSpacePanMovedRef = useRef(false);
  const altDragCopyRef = useRef<{
    sourceNodeIds: string[];
    startPositions: globalThis.Map<string, { x: number; y: number }>;
    copiedNodeIds: string[];
    sourceToCopyIdMap: globalThis.Map<string, string>;
  } | null>(null);
  const edgePanGestureRef = useRef<{
    active: boolean;
    pointerId: number;
    startClientX: number;
    startClientY: number;
    startViewportX: number;
    startViewportY: number;
    zoom: number;
    moved: boolean;
  } | null>(null);

  const nodes = useCanvasStore((state) => state.nodes);
  const edges = useCanvasStore((state) => state.edges);
  const history = useCanvasStore((state) => state.history);
  const dragHistorySnapshot = useCanvasStore((state) => state.dragHistorySnapshot);
  const applyNodesChange = useCanvasStore((state) => state.onNodesChange);
  const applyEdgesChange = useCanvasStore((state) => state.onEdgesChange);
  const connectNodes = useCanvasStore((state) => state.onConnect);
  const setCanvasData = useCanvasStore((state) => state.setCanvasData);
  const updateNodeData = useCanvasStore((state) => state.updateNodeData);
  const addNode = useCanvasStore((state) => state.addNode);
  const setSelectedNode = useCanvasStore((state) => state.setSelectedNode);
  const selectedNodeId = useCanvasStore((state) => state.selectedNodeId);
  const assetLibraries = useAssetStore((state) => state.libraries);
  const areAssetLibrariesHydrated = useAssetStore((state) => state.isHydrated);
  const activeChapterId = useScriptEditorStore((state) => state.activeChapterId);
  const activeSceneId = useScriptEditorStore((state) => state.activeSceneId);
  const focusChapter = useScriptEditorStore((state) => state.focusChapter);
  const deleteEdge = useCanvasStore((state) => state.deleteEdge);
  const deleteNode = useCanvasStore((state) => state.deleteNode);
  const deleteNodes = useCanvasStore((state) => state.deleteNodes);
  const groupNodes = useCanvasStore((state) => state.groupNodes);
  const syncAssetItemReferences = useCanvasStore((state) => state.syncAssetItemReferences);
  const detachDeletedAssetReferences = useCanvasStore((state) => state.detachDeletedAssetReferences);
  const undo = useCanvasStore((state) => state.undo);
  const redo = useCanvasStore((state) => state.redo);
  const reparentNodesToGroup = useCanvasStore((state) => state.reparentNodesToGroup);
  const detachNodesFromGroup = useCanvasStore((state) => state.detachNodesFromGroup);
  const openToolDialog = useCanvasStore((state) => state.openToolDialog);
  const closeToolDialog = useCanvasStore((state) => state.closeToolDialog);
  const setViewportState = useCanvasStore((state) => state.setViewportState);
  const setCanvasViewportSize = useCanvasStore((state) => state.setCanvasViewportSize);
  const currentViewport = useCanvasStore((state) => state.currentViewport);
  const imageViewer = useCanvasStore((state) => state.imageViewer);
  const closeImageViewer = useCanvasStore((state) => state.closeImageViewer);
  const navigateImageViewer = useCanvasStore((state) => state.navigateImageViewer);
  const snapToGrid = useCanvasStore((state) => state.snapToGrid);
  const snapGridSize = useCanvasStore((state) => state.snapGridSize);
  const setSnapToGrid = useCanvasStore((state) => state.setSnapToGrid);
  const enableNodeAlignment = useCanvasStore((state) => state.enableNodeAlignment);
  const alignmentThreshold = useCanvasStore((state) => state.alignmentThreshold);
  const showMiniMap = useSettingsStore((state) => state.showMiniMap);
  const showGrid = useSettingsStore((state) => state.showGrid);
  const showAlignmentGuides = useSettingsStore((state) => state.showAlignmentGuides);
  const groupNodesShortcut = useSettingsStore((state) => state.groupNodesShortcut);
  const setShowMiniMap = useSettingsStore((state) => state.setShowMiniMap);
  const setShowAlignmentGuides = useSettingsStore((state) => state.setShowAlignmentGuides);
  const storyboardApiKeys = useSettingsStore((state) => state.storyboardApiKeys);
  const providerIds = useMemo(() => listModelProviders().map((provider) => provider.id), []);
  const configuredApiKeyCount = useSettingsStore((state) =>
    getConfiguredApiKeyCount(
      { ...state.scriptApiKeys, ...state.storyboardApiKeys },
      providerIds
    )
  );

  const clearDragOverlay = useCallback(() => {
    if (dragOverlayClearTimerRef.current) {
      clearTimeout(dragOverlayClearTimerRef.current);
      dragOverlayClearTimerRef.current = null;
    }
    setDragOverlayKind(null);
  }, []);

  const refreshDragOverlay = useCallback((kind: CanvasDragOverlayKind) => {
    if (dragOverlayClearTimerRef.current) {
      clearTimeout(dragOverlayClearTimerRef.current);
      dragOverlayClearTimerRef.current = null;
    }

    setDragOverlayKind(kind);
    if (!kind) {
      return;
    }

    dragOverlayClearTimerRef.current = setTimeout(() => {
      dragOverlayClearTimerRef.current = null;
      setDragOverlayKind((current) => (current === kind ? null : current));
    }, DRAG_OVERLAY_IDLE_CLEAR_MS);
  }, []);

  const getCurrentProject = useProjectStore((state) => state.getCurrentProject);
  const project = getCurrentProject();
  const saveCurrentProject = useProjectStore((state) => state.saveCurrentProject);
  const saveCurrentProjectViewport = useProjectStore((state) => state.saveCurrentProjectViewport);
  const cancelPendingViewportPersist = useProjectStore(
    (state) => state.cancelPendingViewportPersist
  );

  const persistCanvasSnapshot = useCallback(() => {
    if (isRestoringCanvasRef.current) {
      return;
    }

    const currentProject = getCurrentProject();
    if (!currentProject) {
      return;
    }

    const currentNodes = useCanvasStore.getState().nodes;
    const currentEdges = useCanvasStore.getState().edges;
    const currentHistory = useCanvasStore.getState().history;
    saveCurrentProject(
      currentNodes,
      currentEdges,
      reactFlowInstance.getViewport(),
      currentHistory
    );
  }, [getCurrentProject, reactFlowInstance, saveCurrentProject]);

  const scheduleCanvasPersist = useCallback(
    (delayMs = 140) => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
      }

      saveTimerRef.current = setTimeout(() => {
        saveTimerRef.current = null;
        persistCanvasSnapshot();
      }, delayMs);
    },
    [persistCanvasSnapshot]
  );

  const resetBranchConnectionState = useCallback(() => {
    setShowBatchMenu(false);
    setBranchConnectionSource([]);
    setBranchConnectionPosition(null);
  }, []);

  const connectBranchSourcesToExistingNode = useCallback(
    (targetNodeId: string | null): boolean => {
      if (!targetNodeId) {
        return false;
      }

      const targetNode = nodes.find((node) => node.id === targetNodeId);
      if (!targetNode || !nodeHasTargetHandle(targetNode.type)) {
        return false;
      }

      let connectedCount = 0;

      for (const sourceNode of branchConnectionSource) {
        if (
          sourceNode.id === targetNodeId ||
          !canNodeTypeBeManualConnectionSource(sourceNode.type)
        ) {
          continue;
        }

        connectNodes({
          source: sourceNode.id,
          target: targetNodeId,
          sourceHandle: 'source',
          targetHandle: 'target',
        });
        connectedCount += 1;
      }

      if (connectedCount === 0) {
        return false;
      }

      scheduleCanvasPersist(0);
      return true;
    },
    [branchConnectionSource, connectNodes, nodes, scheduleCanvasPersist]
  );

  const markGenerationNodeActivity = useCallback((nodeId: string) => {
    generationNodeActivityAtRef.current.set(nodeId, Date.now());
  }, []);

  const resolvePendingGenerationNodeState = useCallback((nodeId: string): PendingGenerationNodeState | null => {
    const currentNode = useCanvasStore.getState().nodes.find((node) => node.id === nodeId);
    if (!currentNode || currentNode.type !== CANVAS_NODE_TYPES.exportImage) {
      generationNodeActivityAtRef.current.delete(nodeId);
      return null;
    }

    const currentData = currentNode.data as Record<string, unknown>;
    const jobId = typeof currentData.generationJobId === 'string' ? currentData.generationJobId.trim() : '';
    if (!jobId || currentData.isGenerating !== true) {
      generationNodeActivityAtRef.current.delete(nodeId);
      return null;
    }

    return {
      nodeId,
      jobId,
      generationProviderId:
        typeof currentData.generationProviderId === 'string'
          ? currentData.generationProviderId.trim()
          : '',
      data: currentData,
    };
  }, []);

  const syncGenerationProviderApiKey = useCallback(
    async (nodeId: string, generationProviderId: string) => {
      if (!generationProviderId) {
        return;
      }

      const providerApiKey = storyboardApiKeys[generationProviderId] ?? '';
      if (!providerApiKey) {
        return;
      }

      await canvasAiGateway.setApiKey(generationProviderId, providerApiKey).catch((error) => {
        console.warn('[GenerationJob] set_api_key failed before poll', {
          nodeId,
          generationProviderId,
          error,
        });
      });
    },
    [storyboardApiKeys]
  );

  const applyGenerationSuccessResult = useCallback(
    async (nodeId: string, currentData: Record<string, unknown>, resultSource: string) => {
      markGenerationNodeActivity(nodeId);

      try {
        const prepared = await prepareNodeImage(resultSource);
        const storyboardMetadataRaw = currentData.generationStoryboardMetadata;
        let imageWithMetadata = prepared.imageUrl;

        if (hasGenerationStoryboardMetadata(storyboardMetadataRaw)) {
          imageWithMetadata = await embedStoryboardImageMetadata(prepared.imageUrl, {
            gridRows: Math.max(1, Math.round(storyboardMetadataRaw.gridRows)),
            gridCols: Math.max(1, Math.round(storyboardMetadataRaw.gridCols)),
            frameNotes: storyboardMetadataRaw.frameNotes,
          }).catch((error) => {
            console.warn('[GenerationJob] embed storyboard metadata failed', {
              nodeId,
              error,
            });
            return prepared.imageUrl;
          });
        }

        const previewWithMetadata = prepared.previewImageUrl === prepared.imageUrl
          ? imageWithMetadata
          : prepared.previewImageUrl;

        updateNodeData(nodeId, {
          imageUrl: imageWithMetadata,
          previewImageUrl: previewWithMetadata,
          aspectRatio: prepared.aspectRatio,
          isGenerating: false,
          generationStartedAt: null,
          generationClientSessionId: null,
          generationStoryboardMetadata: undefined,
          generationError: null,
          generationErrorDetails: null,
          generationDebugContext: undefined,
        });
        generationNodeActivityAtRef.current.delete(nodeId);
        return true;
      } catch (error) {
        markGenerationNodeActivity(nodeId);
        console.warn('[GenerationJob] result hydration failed', {
          nodeId,
          error,
        });
        return false;
      }
    },
    [markGenerationNodeActivity, updateNodeData]
  );

  const applyGenerationFailureState = useCallback(
    (
      nodeId: string,
      currentData: Record<string, unknown>,
      status: {
        status: 'queued' | 'running' | 'succeeded' | 'failed' | 'not_found';
        error?: string | null;
      }
    ) => {
      const errorMessage =
        status.error ?? (status.status === 'not_found' ? 'generation job not found' : 'generation failed');
      const generationClientSessionId =
        typeof currentData.generationClientSessionId === 'string'
          ? currentData.generationClientSessionId
          : '';
      const shouldShowDialog = generationClientSessionId === CURRENT_RUNTIME_SESSION_ID;

      if (shouldShowDialog) {
        const reportText = buildGenerationErrorReport({
          errorMessage,
          errorDetails: status.error ?? undefined,
          context: currentData.generationDebugContext,
        });
        void showErrorDialog(errorMessage, t('common.error'), status.error ?? undefined, reportText);
      }

      updateNodeData(nodeId, {
        isGenerating: false,
        generationStartedAt: null,
        generationClientSessionId: null,
        generationStoryboardMetadata: undefined,
        generationError: errorMessage,
        generationErrorDetails: status.error ?? null,
      });
      generationNodeActivityAtRef.current.delete(nodeId);
    },
    [t, updateNodeData]
  );

  const reconcileGenerationNode = useCallback(
    async (
      nodeId: string,
      options?: {
        continuous?: boolean;
        forceRefresh?: boolean;
        reason?: string;
      }
    ) => {
      const continuous = options?.continuous === true;
      let preferForceRefresh = options?.forceRefresh === true;

      while (true) {
        const currentState = resolvePendingGenerationNodeState(nodeId);
        if (!currentState) {
          return;
        }

        try {
          markGenerationNodeActivity(nodeId);
          await syncGenerationProviderApiKey(nodeId, currentState.generationProviderId);

          const status = await canvasAiGateway.getGenerateImageJob(
            currentState.jobId,
            preferForceRefresh ? { forceRefresh: true } : undefined
          ).catch((error) => {
            console.warn('[GenerationJob] poll failed', {
              nodeId,
              jobId: currentState.jobId,
              preferForceRefresh,
              error,
            });
            return null;
          });

          markGenerationNodeActivity(nodeId);

          if (!status) {
            if (!continuous) {
              return;
            }
            await sleep(GENERATION_JOB_RESULT_RETRY_INTERVAL_MS);
            continue;
          }

          if (status.status === 'queued' || status.status === 'running') {
            if (!continuous) {
              return;
            }
            await sleep(
              preferForceRefresh
                ? GENERATION_JOB_RESULT_RETRY_INTERVAL_MS
                : GENERATION_JOB_POLL_INTERVAL_MS
            );
            continue;
          }

          if (status.status === 'succeeded' && typeof status.result === 'string' && status.result.trim()) {
            const applied = await applyGenerationSuccessResult(nodeId, currentState.data, status.result);
            if (applied) {
              return;
            }

            preferForceRefresh = true;
            if (!continuous) {
              return;
            }

            await sleep(GENERATION_JOB_RESULT_RETRY_INTERVAL_MS);
            continue;
          }

          applyGenerationFailureState(nodeId, currentState.data, status);
          return;
        } catch (error) {
          markGenerationNodeActivity(nodeId);
          console.warn('[GenerationJob] reconcile failed', {
            nodeId,
            reason: options?.reason ?? 'unknown',
            preferForceRefresh,
            error,
          });

          if (!continuous) {
            return;
          }

          await sleep(GENERATION_JOB_RESULT_RETRY_INTERVAL_MS);
        }
      }
    },
    [
      applyGenerationFailureState,
      applyGenerationSuccessResult,
      markGenerationNodeActivity,
      resolvePendingGenerationNodeState,
      syncGenerationProviderApiKey,
    ]
  );

  useEffect(() => {
    const unsubscribeOpen = canvasEventBus.subscribe('tool-dialog/open', (payload) => {
      openToolDialog(payload);
    });
    const unsubscribeClose = canvasEventBus.subscribe('tool-dialog/close', () => {
      closeToolDialog();
    });

    return () => {
      unsubscribeOpen();
      unsubscribeClose();
    };
  }, [openToolDialog, closeToolDialog]);

  useEffect(() => {
    isRestoringCanvasRef.current = true;
    const project = getCurrentProject();
    if (project) {
      setCanvasData(project.nodes, project.edges, project.history);
      setViewportState(project.viewport ?? DEFAULT_VIEWPORT);
      requestAnimationFrame(() => {
        reactFlowInstance.setViewport(project.viewport ?? DEFAULT_VIEWPORT, { duration: 0 });
      });
    } else {
      setViewportState(DEFAULT_VIEWPORT);
    }
    const restoreTimer = setTimeout(() => {
      isRestoringCanvasRef.current = false;
    }, 0);

    return () => {
      clearTimeout(restoreTimer);
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      closeImageViewer();
      persistCanvasSnapshot();
    };
  }, [
    closeImageViewer,
    getCurrentProject,
    persistCanvasSnapshot,
    reactFlowInstance,
    setCanvasData,
    setViewportState,
  ]);

  useEffect(() => {
    const timer = setTimeout(() => {
      const currentProject = getCurrentProject();
      if (!isRestoringCanvasRef.current && currentProject?.projectType === 'script') {
        const hasChapters = nodes.some((n) => n.type === 'scriptChapterNode');
        const hasRoot = nodes.some((n) => n.type === 'scriptRootNode');
        if (!hasChapters && !hasRoot) {
          setShowWelcomeDialog(true);
        }
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [nodes, getCurrentProject]);

  useEffect(() => {
    if (isRestoringCanvasRef.current || dragHistorySnapshot) {
      return;
    }

    scheduleCanvasPersist();
  }, [nodes, edges, history, dragHistorySnapshot, scheduleCanvasPersist]);

  useEffect(() => {
    const unsubscribeAssetItemUpdated = subscribeAssetItemUpdated((item) => {
      if (!getCurrentProject()) {
        return;
      }
      syncAssetItemReferences(item);
    });

    const unsubscribeAssetItemDeleted = subscribeAssetItemDeleted((assetItemId) => {
      if (!getCurrentProject()) {
        return;
      }
      detachDeletedAssetReferences(assetItemId);
    });

    return () => {
      unsubscribeAssetItemUpdated();
      unsubscribeAssetItemDeleted();
    };
  }, [detachDeletedAssetReferences, getCurrentProject, syncAssetItemReferences]);

  useEffect(() => {
    if (!areAssetLibrariesHydrated || !getCurrentProject()) {
      return;
    }

    for (const library of assetLibraries) {
      for (const item of library.items) {
        syncAssetItemReferences(item);
      }
    }
  }, [assetLibraries, areAssetLibrariesHydrated, getCurrentProject, syncAssetItemReferences]);

  useEffect(() => {
    const handleDragSessionEnd = () => {
      clearDragOverlay();
    };
    const handleVisibilityChange = () => {
      if (document.hidden) {
        clearDragOverlay();
      }
    };

    window.addEventListener('dragend', handleDragSessionEnd, true);
    window.addEventListener('drop', handleDragSessionEnd, true);
    window.addEventListener('blur', handleDragSessionEnd);
    document.addEventListener('dragend', handleDragSessionEnd, true);
    document.addEventListener('drop', handleDragSessionEnd, true);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('dragend', handleDragSessionEnd, true);
      window.removeEventListener('drop', handleDragSessionEnd, true);
      window.removeEventListener('blur', handleDragSessionEnd);
      document.removeEventListener('dragend', handleDragSessionEnd, true);
      document.removeEventListener('drop', handleDragSessionEnd, true);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (dragOverlayClearTimerRef.current) {
        clearTimeout(dragOverlayClearTimerRef.current);
        dragOverlayClearTimerRef.current = null;
      }
    };
  }, [clearDragOverlay]);

  useEffect(() => {
    const pendingNodeIds = nodes.filter(isPendingExportGenerationNode).map((node) => node.id);

    for (const nodeId of pendingNodeIds) {
      if (activeGenerationPollNodeIdsRef.current.has(nodeId)) {
        continue;
      }

      activeGenerationPollNodeIdsRef.current.add(nodeId);
      markGenerationNodeActivity(nodeId);

      void (async () => {
        try {
          await reconcileGenerationNode(nodeId, {
            continuous: true,
            reason: 'poll-loop',
          });
        } finally {
          activeGenerationPollNodeIdsRef.current.delete(nodeId);
        }
      })();
    }
  }, [markGenerationNodeActivity, nodes, reconcileGenerationNode]);

  useEffect(() => {
    const pendingNodeIds = new Set(nodes.filter(isPendingExportGenerationNode).map((node) => node.id));

    for (const nodeId of Array.from(generationNodeActivityAtRef.current.keys())) {
      if (!pendingNodeIds.has(nodeId)) {
        generationNodeActivityAtRef.current.delete(nodeId);
      }
    }

    for (const nodeId of Array.from(activeGenerationRecoveryNodeIdsRef.current)) {
      if (!pendingNodeIds.has(nodeId)) {
        activeGenerationRecoveryNodeIdsRef.current.delete(nodeId);
      }
    }
  }, [nodes]);

  useEffect(() => {
    const runRecoverySweep = () => {
      const now = Date.now();
      const pendingNodeIds = useCanvasStore.getState().nodes
        .filter(isPendingExportGenerationNode)
        .filter((node) => {
          const data = node.data as Record<string, unknown>;
          const generationStartedAt =
            typeof data.generationStartedAt === 'number' ? data.generationStartedAt : null;
          if (generationStartedAt === null) {
            return false;
          }

          if (now - generationStartedAt < GENERATION_JOB_RECOVERY_THRESHOLD_MS) {
            return false;
          }

          const lastActivityAt = generationNodeActivityAtRef.current.get(node.id) ?? 0;
          return now - lastActivityAt >= GENERATION_JOB_STALE_ACTIVITY_MS;
        })
        .map((node) => node.id);

      for (const nodeId of pendingNodeIds) {
        if (activeGenerationRecoveryNodeIdsRef.current.has(nodeId)) {
          continue;
        }

        activeGenerationRecoveryNodeIdsRef.current.add(nodeId);
        markGenerationNodeActivity(nodeId);

        void (async () => {
          try {
            await reconcileGenerationNode(nodeId, {
              continuous: false,
              forceRefresh: true,
              reason: 'recovery-sweep',
            });
          } finally {
            activeGenerationRecoveryNodeIdsRef.current.delete(nodeId);
          }
        })();
      }
    };

    const intervalId = window.setInterval(runRecoverySweep, GENERATION_JOB_RECOVERY_SWEEP_INTERVAL_MS);
    const handleWindowFocus = () => {
      runRecoverySweep();
    };
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        runRecoverySweep();
      }
    };

    window.addEventListener('focus', handleWindowFocus);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    runRecoverySweep();

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('focus', handleWindowFocus);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [markGenerationNodeActivity, reconcileGenerationNode]);

  useEffect(() => {
    const element = wrapperRef.current;
    if (!element) {
      return;
    }

    const updateSize = () => {
      const rect = element.getBoundingClientRect();
      setCanvasViewportSize({
        width: Math.max(0, Math.round(rect.width)),
        height: Math.max(0, Math.round(rect.height)),
      });
    };

    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, [setCanvasViewportSize]);

  const handleNodesChange = useCallback(
    (changes: NodeChange<CanvasNode>[]) => {
      applyNodesChange(changes);

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

      if (hasInteractionMove) {
        return;
      }

      if (hasInteractionEnd) {
        scheduleCanvasPersist(0);
        return;
      }

      scheduleCanvasPersist();
    },
    [applyNodesChange, scheduleCanvasPersist]
  );

  const handleEdgesChange = useCallback(
    (changes: EdgeChange<CanvasEdge>[]) => {
      applyEdgesChange(changes);
      scheduleCanvasPersist();
    },
    [applyEdgesChange, scheduleCanvasPersist]
  );

  const handleEdgeDoubleClick = useCallback(
    (event: ReactMouseEvent, edge: CanvasEdge) => {
      event.preventDefault();
      event.stopPropagation();
      deleteEdge(edge.id);
      scheduleCanvasPersist(0);
    },
    [deleteEdge, scheduleCanvasPersist]
  );

  const handleEdgeClick = useCallback((event: ReactMouseEvent) => {
    if (!suppressNextEdgeClickRef.current) {
      return;
    }
    suppressNextEdgeClickRef.current = false;
    event.preventDefault();
    event.stopPropagation();
  }, []);

  const handleConnect = useCallback(
    (connection: Connection) => {
      if (!canNodeBeManualConnectionSource(connection.source, nodes)) {
        return;
      }
      connectNodes(connection);
      scheduleCanvasPersist(0);
    },
    [connectNodes, nodes, scheduleCanvasPersist]
  );

  const handleMoveEnd = useCallback(
    (_event: unknown, viewport: Viewport) => {
      setViewportState(viewport);
      const project = getCurrentProject();
      if (!project || isRestoringCanvasRef.current) {
        return;
      }
      saveCurrentProjectViewport(viewport);
    },
    [getCurrentProject, saveCurrentProjectViewport, setViewportState]
  );

  const handleMove = useCallback(
    (_event: unknown, viewport: Viewport) => {
      setViewportState(viewport);
    },
    [setViewportState]
  );

  const handleMoveStart = useCallback(() => {
    cancelPendingViewportPersist();
  }, [cancelPendingViewportPersist]);

  useEffect(() => {
    const wrapperElement = wrapperRef.current;
    if (!wrapperElement) {
      return;
    }

    const edgePathSelector = '.react-flow__edge-path, .react-flow__edge-interaction';
    const dragThreshold = 4;

    const handlePointerDown = (event: PointerEvent) => {
      if (event.button !== 0) {
        return;
      }

      const target = event.target as HTMLElement | null;
      if (!target) {
        return;
      }

      if (target.closest('.react-flow__edgeupdater')) {
        return;
      }

      const edgePathElement = target.closest(edgePathSelector);
      if (!edgePathElement) {
        return;
      }

      const viewport = reactFlowInstance.getViewport();
      edgePanGestureRef.current = {
        active: true,
        pointerId: event.pointerId,
        startClientX: event.clientX,
        startClientY: event.clientY,
        startViewportX: viewport.x,
        startViewportY: viewport.y,
        zoom: viewport.zoom,
        moved: false,
      };
      cancelPendingViewportPersist();
    };

    const handlePointerMove = (event: PointerEvent) => {
      const gesture = edgePanGestureRef.current;
      if (!gesture || !gesture.active || event.pointerId !== gesture.pointerId) {
        return;
      }

      const deltaX = event.clientX - gesture.startClientX;
      const deltaY = event.clientY - gesture.startClientY;

      if (!gesture.moved && Math.hypot(deltaX, deltaY) >= dragThreshold) {
        gesture.moved = true;
      }
      if (!gesture.moved) {
        return;
      }

      suppressNextEdgeClickRef.current = true;
      reactFlowInstance.setViewport(
        {
          x: gesture.startViewportX + deltaX,
          y: gesture.startViewportY + deltaY,
          zoom: gesture.zoom,
        },
        { duration: 0 }
      );
    };

    const completeEdgePanGesture = () => {
      const gesture = edgePanGestureRef.current;
      if (!gesture) {
        return;
      }

      edgePanGestureRef.current = null;
      if (!gesture.moved) {
        return;
      }

      const viewport = reactFlowInstance.getViewport();
      setViewportState(viewport);
      const project = getCurrentProject();
      if (!project || isRestoringCanvasRef.current) {
        return;
      }
      saveCurrentProjectViewport(viewport);
    };

    const handlePointerUp = (event: PointerEvent) => {
      const gesture = edgePanGestureRef.current;
      if (!gesture || event.pointerId !== gesture.pointerId) {
        return;
      }
      completeEdgePanGesture();
    };

    const handlePointerCancel = (event: PointerEvent) => {
      const gesture = edgePanGestureRef.current;
      if (!gesture || event.pointerId !== gesture.pointerId) {
        return;
      }
      completeEdgePanGesture();
    };

    wrapperElement.addEventListener('pointerdown', handlePointerDown, true);
    window.addEventListener('pointermove', handlePointerMove, true);
    window.addEventListener('pointerup', handlePointerUp, true);
    window.addEventListener('pointercancel', handlePointerCancel, true);

    return () => {
      wrapperElement.removeEventListener('pointerdown', handlePointerDown, true);
      window.removeEventListener('pointermove', handlePointerMove, true);
      window.removeEventListener('pointerup', handlePointerUp, true);
      window.removeEventListener('pointercancel', handlePointerCancel, true);
    };
  }, [
    cancelPendingViewportPersist,
    getCurrentProject,
    reactFlowInstance,
    saveCurrentProjectViewport,
    setViewportState,
  ]);

  const selectedNodeIds = useMemo(
    () => nodes.filter((node) => Boolean(node.selected)).map((node) => node.id),
    [nodes]
  );
  const selectedUploadNodeId = useMemo(() => {
    if (selectedNodeIds.length !== 1) {
      return null;
    }
    const selectedNode = nodes.find((node) => node.id === selectedNodeIds[0]);
    if (!selectedNode || selectedNode.type !== CANVAS_NODE_TYPES.upload) {
      return null;
    }
    return selectedNode.id;
  }, [nodes, selectedNodeIds]);
  const groupNodesList = useMemo(
    () => nodes.filter((node) => node.type === CANVAS_NODE_TYPES.group),
    [nodes]
  );
  const selectedGroupId = useMemo(() => {
    if (!selectedNodeId) {
      return null;
    }

    const selectedNode = nodes.find((node) => node.id === selectedNodeId);
    return selectedNode?.type === CANVAS_NODE_TYPES.group ? selectedNode.id : null;
  }, [nodes, selectedNodeId]);
  const selectedScriptChapterNode = useMemo(() => {
    if (selectedNodeIds.length !== 1) {
      return null;
    }

    const selectedNode = nodes.find((node) => node.id === selectedNodeIds[0]);
    return selectedNode?.type === CANVAS_NODE_TYPES.scriptChapter ? selectedNode : null;
  }, [nodes, selectedNodeIds]);

  useEffect(() => {
    if (selectedNodeIds.length === 1) {
      if (selectedNodeId !== selectedNodeIds[0]) {
        setSelectedNode(selectedNodeIds[0]);
      }
      return;
    }

    if (selectedNodeId !== null) {
      setSelectedNode(null);
    }
  }, [selectedNodeId, selectedNodeIds, setSelectedNode]);

  useEffect(() => {
    if (project?.projectType !== 'script' || !selectedScriptChapterNode) {
      return;
    }

    const selectedChapterData = selectedScriptChapterNode.data as ScriptChapterNodeData;
    const scenes = normalizeSceneCards(selectedChapterData.scenes, selectedChapterData.content);
    const fallbackSceneId = scenes[0]?.id ?? null;
    const nextSceneId = activeChapterId === selectedScriptChapterNode.id
      ? activeSceneId ?? fallbackSceneId
      : fallbackSceneId;

    if (activeChapterId === selectedScriptChapterNode.id && activeSceneId === nextSceneId) {
      return;
    }

    focusChapter(selectedScriptChapterNode.id, nextSceneId);
  }, [
    activeChapterId,
    activeSceneId,
    project?.projectType,
    focusChapter,
    selectedScriptChapterNode,
  ]);

  useEffect(() => {
    if (!isDraggingBranchConnection) return;

    const handleMouseMove = (e: MouseEvent) => {
      setBranchConnectionPosition({ x: e.clientX, y: e.clientY });
    };

    const handleMouseUp = (e: MouseEvent) => {
      setIsDraggingBranchConnection(false);

      const clientPosition = getClientPosition(e);
      const dropNodeId = clientPosition ? resolveDropNodeId(e.target, clientPosition) : null;

      if (connectBranchSourcesToExistingNode(dropNodeId)) {
        resetBranchConnectionState();
        return;
      }

      setBatchMenuPosition({ x: e.clientX, y: e.clientY });
      setShowBatchMenu(true);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [connectBranchSourcesToExistingNode, isDraggingBranchConnection, resetBranchConnectionState]);

  useEffect(() => {
    const handlePaste = (event: ClipboardEvent) => {
      pasteImageHandledRef.current = false;
      if (!selectedUploadNodeId || isTypingTarget(event.target)) {
        return;
      }

      const imageFile = resolveClipboardImageFile(event);
      if (!imageFile) {
        return;
      }

      event.preventDefault();
      pasteImageHandledRef.current = true;
      canvasEventBus.publish('upload-node/paste-image', {
        nodeId: selectedUploadNodeId,
        file: imageFile,
      });
    };

    document.addEventListener('paste', handlePaste);
    return () => {
      document.removeEventListener('paste', handlePaste);
    };
  }, [selectedUploadNodeId]);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      if (!pendingConnectStart) {
        return;
      }

      const currentPosition = { x: event.clientX, y: event.clientY };
      const previousPosition = connectionPointerRef.current;
      connectionPointerRef.current = currentPosition;

      if (!connectionSpacePanActiveRef.current || !previousPosition) {
        return;
      }

      const viewport = reactFlowInstance.getViewport();
      const nextViewport = {
        x: viewport.x + (currentPosition.x - previousPosition.x),
        y: viewport.y + (currentPosition.y - previousPosition.y),
        zoom: viewport.zoom,
      };

      connectionSpacePanMovedRef.current = true;
      reactFlowInstance.setViewport(nextViewport, { duration: 0 });
      setViewportState(nextViewport);
    };

    const handlePointerUp = () => {
      connectionPointerRef.current = null;
      connectionSpacePanActiveRef.current = false;
    };

    window.addEventListener('pointermove', handlePointerMove, true);
    window.addEventListener('pointerup', handlePointerUp, true);
    window.addEventListener('pointercancel', handlePointerUp, true);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove, true);
      window.removeEventListener('pointerup', handlePointerUp, true);
      window.removeEventListener('pointercancel', handlePointerUp, true);
    };
  }, [pendingConnectStart, reactFlowInstance, setViewportState]);

  useEffect(() => {
    if (pendingConnectStart) {
      return;
    }

    connectionPointerRef.current = null;
    connectionSpacePanActiveRef.current = false;

    if (!connectionSpacePanMovedRef.current) {
      return;
    }

    connectionSpacePanMovedRef.current = false;
    const viewport = reactFlowInstance.getViewport();
    setViewportState(viewport);
    const currentProject = getCurrentProject();
    if (!currentProject || isRestoringCanvasRef.current) {
      return;
    }
    saveCurrentProjectViewport(viewport);
  }, [
    getCurrentProject,
    pendingConnectStart,
    reactFlowInstance,
    saveCurrentProjectViewport,
    setViewportState,
  ]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) {
        return;
      }

      if (event.key === ' ' && pendingConnectStart) {
        event.preventDefault();
        connectionSpacePanActiveRef.current = true;
        cancelPendingViewportPersist();
        return;
      }

      const commandPressed = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      const isUndo = commandPressed && key === 'z' && !event.shiftKey;
      const isRedo = commandPressed && (key === 'y' || (key === 'z' && event.shiftKey));
      const isGroup = eventMatchesShortcut(event, groupNodesShortcut);
      const isCopy = commandPressed && key === 'c' && !event.shiftKey;
      const isPaste = commandPressed && key === 'v' && !event.shiftKey;

      if (isCopy) {
        if (selectedNodeIds.length === 0) {
          return;
        }
        event.preventDefault();
        const selectedIdSet = new Set(selectedNodeIds);
        copiedSnapshotRef.current = {
          nodes: nodes.filter((node) => selectedIdSet.has(node.id)),
          edges: edges.filter(
            (edge) => selectedIdSet.has(edge.source) && selectedIdSet.has(edge.target)
          ),
        };
        return;
      }

      if (isPaste) {
        if (selectedUploadNodeId) {
          pasteImageHandledRef.current = false;
          window.setTimeout(() => {
            if (pasteImageHandledRef.current) {
              pasteImageHandledRef.current = false;
              return;
            }

            if (!copiedSnapshotRef.current || copiedSnapshotRef.current.nodes.length === 0) {
              return;
            }

            void duplicateNodesRef.current?.(copiedSnapshotRef.current.nodes.map((node) => node.id));
          }, 0);
          return;
        }

        if (!copiedSnapshotRef.current || copiedSnapshotRef.current.nodes.length === 0) {
          return;
        }
        event.preventDefault();
        void duplicateNodesRef.current?.(copiedSnapshotRef.current.nodes.map((node) => node.id));
        return;
      }

      if (isUndo || isRedo) {
        event.preventDefault();
        const changed = isUndo ? undo() : redo();
        if (changed) {
          scheduleCanvasPersist(0);
        }
        return;
      }

      if (isGroup) {
        if (selectedNodeIds.length < 2) {
          return;
        }
        event.preventDefault();
        const createdGroupId = groupNodes(selectedNodeIds);
        if (createdGroupId) {
          scheduleCanvasPersist(0);
        }
        return;
      }

      if (event.key !== 'Delete' && event.key !== 'Backspace') {
        return;
      }

      const idsToDelete = selectedNodeIds.length > 0
        ? selectedNodeIds
        : selectedNodeId
          ? [selectedNodeId]
          : [];
      if (idsToDelete.length === 0) {
        return;
      }

      event.preventDefault();
      if (idsToDelete.length === 1) {
        deleteNode(idsToDelete[0]);
      } else {
        deleteNodes(idsToDelete);
      }
      scheduleCanvasPersist(0);
    };

    document.addEventListener('keydown', handleKeyDown);
    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.key === ' ') {
        connectionSpacePanActiveRef.current = false;
        connectionPointerRef.current = null;
      }
    };
    document.addEventListener('keyup', handleKeyUp);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('keyup', handleKeyUp);
    };
  }, [
    cancelPendingViewportPersist,
    edges,
    nodes,
    pendingConnectStart,
    selectedNodeId,
    selectedNodeIds,
    deleteNode,
    deleteNodes,
    groupNodes,
    undo,
    redo,
    groupNodesShortcut,
    scheduleCanvasPersist,
    selectedUploadNodeId,
  ]);

  const openNodeMenuAtClientPosition = useCallback((clientX: number, clientY: number) => {
    const containerRect = reactFlowWrapperRef.current?.getBoundingClientRect();
    if (!containerRect) {
      return;
    }

    const flowPos = reactFlowInstance.screenToFlowPosition({
      x: clientX,
      y: clientY,
    });

    setFlowPosition(flowPos);
    setMenuPosition({
      x: clientX - containerRect.left,
      y: clientY - containerRect.top,
    });
    setMenuAllowedTypes(undefined);
    setPendingConnectStart(null);
    setPreviewConnectionVisual(null);
    setShowNodeMenu(true);
  }, [reactFlowInstance]);

  const handleDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const hasFiles =
      event.dataTransfer.types.includes('Files') ||
      event.dataTransfer.types.includes('text/uri-list');
    const hasAssetPayload = event.dataTransfer.types.includes(ASSET_DRAG_MIME_TYPE);
    if (hasFiles || hasAssetPayload) {
      event.dataTransfer.dropEffect = 'copy';
    }
    refreshDragOverlay(hasFiles ? 'files' : hasAssetPayload ? 'asset' : null);
  }, [refreshDragOverlay]);

  const handleDragLeave = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX;
    const y = event.clientY;
    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
      clearDragOverlay();
    }
  }, [clearDragOverlay]);

  const handleDrop = useCallback(async (event: React.DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    clearDragOverlay();

    const assetPayload = parseAssetDragPayload(
      event.dataTransfer.getData(ASSET_DRAG_MIME_TYPE)
    );
    if (assetPayload) {
      const position = reactFlowInstance.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });

      const newNodeId = assetPayload.mediaType === 'audio'
        ? addNode(CANVAS_NODE_TYPES.audio, position, {
            displayName: assetPayload.assetName,
            audioFileName: assetPayload.assetName,
            audioUrl: assetPayload.sourcePath,
            previewImageUrl: assetPayload.previewPath,
            duration: assetPayload.durationMs != null ? assetPayload.durationMs / 1000 : undefined,
            mimeType: assetPayload.mimeType,
            assetId: assetPayload.assetId,
            assetLibraryId: assetPayload.assetLibraryId,
            assetName: assetPayload.assetName,
            assetCategory: assetPayload.assetCategory,
          })
        : addNode(CANVAS_NODE_TYPES.upload, position, {
            displayName: assetPayload.assetName,
            sourceFileName: assetPayload.assetName,
            imageUrl: assetPayload.sourcePath,
            previewImageUrl: assetPayload.previewPath,
            aspectRatio: assetPayload.aspectRatio,
            assetId: assetPayload.assetId,
            assetLibraryId: assetPayload.assetLibraryId,
            assetName: assetPayload.assetName,
            assetCategory: assetPayload.assetCategory,
          });
      setSelectedNode(newNodeId);
      scheduleCanvasPersist(0);
      return;
    }

    const imageFiles: File[] = [];
    const videoFiles: File[] = [];
    const audioFiles: File[] = [];
    
    if (event.dataTransfer.files?.length) {
      Array.from(event.dataTransfer.files).forEach(file => {
        if (file.type.startsWith('image/')) {
          imageFiles.push(file);
        } else if (file.type.startsWith('video/')) {
          videoFiles.push(file);
        } else if (isSupportedAudioFile(file)) {
          audioFiles.push(file);
        }
      });
    } else {
      Array.from(event.dataTransfer.items || []).forEach(item => {
        if (item.kind === 'file') {
          if (item.type?.startsWith('image/')) {
            const file = item.getAsFile();
            if (file) imageFiles.push(file);
          } else if (item.type?.startsWith('video/')) {
            const file = item.getAsFile();
            if (file) videoFiles.push(file);
          } else {
            const file = item.getAsFile();
            if (file && isSupportedAudioFile(file)) {
              audioFiles.push(file);
            }
          }
        }
      });
    }

    if (imageFiles.length === 0 && videoFiles.length === 0 && audioFiles.length === 0) {
      return;
    }

    const basePosition = reactFlowInstance.screenToFlowPosition({
      x: event.clientX,
      y: event.clientY,
    });

    const NODE_OFFSET = 30;

    for (let i = 0; i < imageFiles.length; i++) {
      const file = imageFiles[i];
      const position = {
        x: basePosition.x + (i % 4) * NODE_OFFSET,
        y: basePosition.y + Math.floor(i / 4) * NODE_OFFSET,
      };

      try {
        const imageData = await prepareNodeImageFromFile(file);
        addNode(CANVAS_NODE_TYPES.upload, position, {
          displayName: '上传图片',
          imageUrl: imageData.imageUrl,
          previewImageUrl: imageData.previewImageUrl,
          aspectRatio: imageData.aspectRatio,
        });
      } catch (err) {
        console.error('Failed to process dropped image:', err);
      }
    }

    for (let i = 0; i < videoFiles.length; i++) {
      const file = videoFiles[i];
      const position = {
        x: basePosition.x + ((imageFiles.length + i) % 4) * NODE_OFFSET,
        y: basePosition.y + Math.floor((imageFiles.length + i) / 4) * NODE_OFFSET,
      };

        try {
          const videoData = await prepareNodeVideoFromFile(file);
          addNode(CANVAS_NODE_TYPES.video, position, {
            videoUrl: videoData.videoUrl,
            previewImageUrl: videoData.previewImageUrl,
            videoFileName: file.name,
            aspectRatio: videoData.aspectRatio,
            duration: videoData.duration,
          });
        } catch (err) {
        console.error('Failed to process dropped video:', err);
      }
    }

    for (let i = 0; i < audioFiles.length; i++) {
      const file = audioFiles[i];
      const offsetIndex = imageFiles.length + videoFiles.length + i;
      const position = {
        x: basePosition.x + (offsetIndex % 4) * NODE_OFFSET,
        y: basePosition.y + Math.floor(offsetIndex / 4) * NODE_OFFSET,
      };

      try {
        const audioData = await prepareNodeAudioFromFile(file);
        addNode(CANVAS_NODE_TYPES.audio, position, {
          displayName: file.name,
          audioUrl: audioData.audioUrl,
          audioFileName: file.name,
          previewImageUrl: audioData.previewImageUrl,
          duration: audioData.duration,
          mimeType: audioData.mimeType,
        });
      } catch (err) {
        console.error('Failed to process dropped audio:', err);
      }
    }
  }, [addNode, clearDragOverlay, reactFlowInstance, scheduleCanvasPersist, setSelectedNode]);

  const handlePaneClick = useCallback((event: ReactMouseEvent) => {
    if (suppressNextPaneClickRef.current) {
      suppressNextPaneClickRef.current = false;
      return;
    }

    if (event.detail >= 2) {
      openNodeMenuAtClientPosition(event.clientX, event.clientY);
      return;
    }

    setSelectedNode(null);
    setShowNodeMenu(false);
    setMenuAllowedTypes(undefined);
    setPendingConnectStart(null);
    setPreviewConnectionVisual(null);
  }, [openNodeMenuAtClientPosition, setSelectedNode]);

  const handlePaneContextMenu = useCallback((event: MouseEvent | React.MouseEvent) => {
    event.preventDefault();
    const clientX = 'clientX' in event ? event.clientX : 0;
    const clientY = 'clientY' in event ? event.clientY : 0;
    openNodeMenuAtClientPosition(clientX, clientY);
  }, [openNodeMenuAtClientPosition]);

  const handleNodeSelect = useCallback(
  (type: CanvasNodeType) => {
    const isSupplementConnection = pendingConnectStart?.handleId === 'supplement';
    const isBranchConnection = (() => {
      if (!pendingConnectStart?.nodeId) return false;
      if (isSupplementConnection) return false;
      const sourceNode = nodes.find(n => n.id === pendingConnectStart.nodeId);
      return sourceNode?.type === CANVAS_NODE_TYPES.scriptChapter;
    })();
    
    let nodeData: Partial<CanvasNodeData> = {};
    let nodePosition = flowPosition;
      
      if (type === CANVAS_NODE_TYPES.scriptChapter && isSupplementConnection) {
      const sourceNode = nodes.find(n => n.id === pendingConnectStart?.nodeId);
      const sourceData = sourceNode?.data as ScriptChapterNodeData | undefined;
      const sourceDepth = sourceData?.depth || 1;
      
      nodeData = {
        branchType: 'supplement',
        parentId: pendingConnectStart?.nodeId,
        chapterNumber: sourceData?.chapterNumber || 1,
        displayName: `补充`,
        depth: sourceDepth + 1,
      };
        
        if (sourceNode) {
          const sourceNodeHeight = sourceNode.measured?.height ?? DEFAULT_LAYOUT_CONFIG.nodeHeight;
          nodePosition = {
            x: sourceNode.position.x,
            y: sourceNode.position.y + sourceNodeHeight + 40,
          };
        }
      } else if (type === CANVAS_NODE_TYPES.scriptChapter && isBranchConnection) {
        const sourceNode = nodes.find(n => n.id === pendingConnectStart?.nodeId);
        const isSourceRootNode = sourceNode?.type === CANVAS_NODE_TYPES.scriptRoot;
        
        if (isSourceRootNode) {
          const maxChapterNumber = nodes.reduce((max, node) => {
            if (node.type !== CANVAS_NODE_TYPES.scriptChapter) return max;
            const d = node.data as ScriptChapterNodeData;
            if (d.branchType === 'branch') return max;
            return Math.max(max, d.chapterNumber || 0);
          }, 0);
          
          const nextChapterNumber = maxChapterNumber + 1;
          
          nodeData = {
            chapterNumber: nextChapterNumber,
            branchType: 'main',
            depth: 1,
            parentId: pendingConnectStart?.nodeId,
          };
          
          const mainLineChildren = nodes.filter(n => {
            const d = n.data as ScriptChapterNodeData;
            return n.type === CANVAS_NODE_TYPES.scriptChapter && 
                   d.branchType === 'main' &&
                   d.parentId === pendingConnectStart?.nodeId;
          });
          nodePosition = calculateChildNodePosition(
            sourceNode,
            mainLineChildren.length,
            mainLineChildren.length + 1,
            DEFAULT_LAYOUT_CONFIG
          );
        } else {
          const sourceData = sourceNode?.data as ScriptChapterNodeData | undefined;
    const sourceDepth = sourceData?.depth || 1;
    const parentChapterNumber = sourceData?.chapterNumber || 1;
    const parentDisplayName = sourceData?.displayName;
    
    const existingBranches = nodes.filter(n => {
      const d = n.data as ScriptChapterNodeData;
      return n.type === CANVAS_NODE_TYPES.scriptChapter && 
             d.branchType === 'branch' && 
             d.parentId === pendingConnectStart?.nodeId;
    });
    const branchIndex = existingBranches.length + 1;
    
    const newDisplayName = parentDisplayName 
      ? `${parentDisplayName}-${branchIndex}`
      : `${parentChapterNumber}-${branchIndex}`;
    
    nodeData = {
      branchType: 'branch',
      parentId: pendingConnectStart?.nodeId,
      branchIndex,
      chapterNumber: parentChapterNumber,
      displayName: newDisplayName,
      depth: sourceDepth + 1,
    };
          
          if (sourceNode) {
            nodePosition = calculateBranchNodePosition(
              sourceNode,
              existingBranches.length,
              DEFAULT_LAYOUT_CONFIG
            );
          }
        }
      } else if (type === CANVAS_NODE_TYPES.scriptChapter) {
  if (pendingConnectStart) {
    const sourceNode = nodes.find(n => n.id === pendingConnectStart.nodeId);
    if (sourceNode && sourceNode.type === CANVAS_NODE_TYPES.scriptChapter) {
      const sourceData = sourceNode.data as ScriptChapterNodeData;
      const sourceDepth = sourceData?.depth || 1;
      const parentChapterNumber = sourceData?.chapterNumber || 1;
      const parentDisplayName = sourceData?.displayName;
      
      const existingBranches = nodes.filter(n => {
        const d = n.data as ScriptChapterNodeData;
        return n.type === CANVAS_NODE_TYPES.scriptChapter && 
               d.branchType === 'branch' && 
               d.parentId === pendingConnectStart.nodeId;
      });
      const branchIndex = existingBranches.length + 1;
      
      const newDisplayName = parentDisplayName 
        ? `${parentDisplayName}-${branchIndex}`
        : `${parentChapterNumber}-${branchIndex}`;
      
      nodeData = {
        branchType: 'branch',
        parentId: pendingConnectStart.nodeId,
        branchIndex,
        chapterNumber: parentChapterNumber,
        displayName: newDisplayName,
        depth: sourceDepth + 1,
      };
      
      nodePosition = calculateBranchNodePosition(
        sourceNode,
        existingBranches.length,
        DEFAULT_LAYOUT_CONFIG
      );
    } else if (sourceNode && sourceNode.type === CANVAS_NODE_TYPES.scriptRoot) {
      const maxChapterNumber = nodes.reduce((max, node) => {
        if (node.type !== CANVAS_NODE_TYPES.scriptChapter) return max;
        const d = node.data as ScriptChapterNodeData;
        if (d.branchType === 'branch') return max;
        return Math.max(max, d.chapterNumber || 0);
      }, 0);
      
      const nextChapterNumber = maxChapterNumber + 1;
      nodeData = {
        chapterNumber: nextChapterNumber,
        branchType: 'main',
        depth: 1,
        parentId: pendingConnectStart.nodeId,
      };
      
      const mainLineChildren = nodes.filter(n => {
        const d = n.data as ScriptChapterNodeData;
        return n.type === CANVAS_NODE_TYPES.scriptChapter && 
               d.branchType === 'main' &&
               d.parentId === pendingConnectStart.nodeId;
      });
      nodePosition = calculateChildNodePosition(
        sourceNode,
        mainLineChildren.length,
        mainLineChildren.length + 1,
        DEFAULT_LAYOUT_CONFIG
      );
    }
  } else {
    const maxChapterNumber = nodes.reduce((max, node) => {
      if (node.type !== CANVAS_NODE_TYPES.scriptChapter) return max;
      const d = node.data as ScriptChapterNodeData;
      if (d.branchType === 'branch') return max;
      return Math.max(max, d.chapterNumber || 0);
    }, 0);
    
    const nextChapterNumber = maxChapterNumber + 1;
    nodeData = {
      chapterNumber: nextChapterNumber,
      branchType: 'main',
      depth: 1,
    };
  }
}

      const newNodeId = addNode(type, nodePosition, nodeData);
      if (pendingConnectStart) {
        if (pendingConnectStart.handleType === 'source') {
          const sourceNode = nodes.find((node) => node.id === pendingConnectStart.nodeId);

          if (shouldInsertIntoLinearOutgoingFlow(sourceNode)) {
            const existingOutgoingEdges = edges.filter(
              (e) => e.source === pendingConnectStart.nodeId && e.sourceHandle === 'source'
            );

            existingOutgoingEdges.forEach((edge) => {
              deleteEdge(edge.id);
            });

            connectNodes({
              source: pendingConnectStart.nodeId,
              target: newNodeId,
              sourceHandle: 'source',
              targetHandle: 'target',
            });

            existingOutgoingEdges.forEach((edge) => {
              connectNodes({
                source: newNodeId,
                target: edge.target,
                sourceHandle: 'source',
                targetHandle: edge.targetHandle ?? 'target',
              });
            });
          } else {
            connectNodes({
              source: pendingConnectStart.nodeId,
              target: newNodeId,
              sourceHandle: 'source',
              targetHandle: 'target',
            });
          }
        } else {
          const existingIncomingEdges = edges.filter(
            (e) => e.target === pendingConnectStart.nodeId
          );
          
          existingIncomingEdges.forEach((edge) => {
            deleteEdge(edge.id);
          });
          
          connectNodes({
            source: newNodeId,
            target: pendingConnectStart.nodeId,
            sourceHandle: 'source',
            targetHandle: 'target',
          });
          
          existingIncomingEdges.forEach((edge) => {
            connectNodes({
              source: edge.source,
              target: newNodeId,
              sourceHandle: edge.sourceHandle ?? 'source',
              targetHandle: 'target',
            });
          });
        }
      }

      scheduleCanvasPersist(0);
      setShowNodeMenu(false);
      setMenuAllowedTypes(undefined);
      setPendingConnectStart(null);
      setPreviewConnectionVisual(null);
    },
    [
      addNode,
      connectNodes,
      deleteEdge,
      edges,
      flowPosition,
      nodes,
      pendingConnectStart,
      scheduleCanvasPersist,
      setPreviewConnectionVisual,
    ]
  );

  const handleCreateBranch = useCallback((action?: 'createBranch' | 'createSupplement') => {
  if (!pendingConnectStart) return;
  
  const sourceNode = nodes.find(n => n.id === pendingConnectStart.nodeId);
  if (!sourceNode) return;
  
  const isSupplementConnection = action === 'createSupplement' || pendingConnectStart.handleId === 'supplement';
  
  if (isSupplementConnection) {
    const sourceData = sourceNode.data as ScriptChapterNodeData;
    const sourceDepth = sourceData?.depth || 1;
    const sourceNodeHeight = sourceNode.measured?.height ?? DEFAULT_LAYOUT_CONFIG.nodeHeight;
    
    const nodeData: Partial<ScriptChapterNodeData> = {
      branchType: 'supplement',
      parentId: pendingConnectStart.nodeId,
      chapterNumber: sourceData?.chapterNumber || 1,
      displayName: `补充`,
      depth: sourceDepth + 1,
    };
    
    const nodePosition = {
      x: sourceNode.position.x,
      y: sourceNode.position.y + sourceNodeHeight + 40,
    };
    
    const newNodeId = addNode(CANVAS_NODE_TYPES.scriptChapter, nodePosition, nodeData);
    
    connectNodes({
      source: pendingConnectStart.nodeId,
      target: newNodeId,
      sourceHandle: 'supplement',
      targetHandle: 'target',
    });
    
    scheduleCanvasPersist(0);
    setShowNodeMenu(false);
    setMenuAllowedTypes(undefined);
    setPendingConnectStart(null);
    setPreviewConnectionVisual(null);
    return;
  }
  
  const isSourceRootNode = sourceNode.type === CANVAS_NODE_TYPES.scriptRoot;
  
  if (isSourceRootNode) {
    const maxChapterNumber = nodes.reduce((max, node) => {
      if (node.type !== CANVAS_NODE_TYPES.scriptChapter) return max;
      const d = node.data as ScriptChapterNodeData;
      if (d.branchType === 'branch') return max;
      return Math.max(max, d.chapterNumber || 0);
    }, 0);
    
    const nextChapterNumber = maxChapterNumber + 1;
    
    const nodeData: Partial<ScriptChapterNodeData> = {
      chapterNumber: nextChapterNumber,
      branchType: 'main',
      depth: 1,
      parentId: pendingConnectStart.nodeId,
    };
    
    const mainLineChildren = nodes.filter(n => {
      const d = n.data as ScriptChapterNodeData;
      return n.type === CANVAS_NODE_TYPES.scriptChapter && 
             d.branchType === 'main' &&
             d.parentId === pendingConnectStart.nodeId;
    });
    const nodePosition = calculateChildNodePosition(
      sourceNode,
      mainLineChildren.length,
      mainLineChildren.length + 1,
      DEFAULT_LAYOUT_CONFIG
    );
    
    const newNodeId = addNode(CANVAS_NODE_TYPES.scriptChapter, nodePosition, nodeData);
    
    connectNodes({
      source: pendingConnectStart.nodeId,
      target: newNodeId,
      sourceHandle: 'source',
      targetHandle: 'target',
    });
    
    scheduleCanvasPersist(0);
    setShowNodeMenu(false);
    setMenuAllowedTypes(undefined);
    setPendingConnectStart(null);
    setPreviewConnectionVisual(null);
    return;
  }
  
  const sourceData = sourceNode.data as ScriptChapterNodeData;
  const sourceDepth = sourceData?.depth || 1;
  const parentChapterNumber = sourceData?.chapterNumber || 1;
  const parentDisplayName = sourceData?.displayName;
  
  const existingBranches = nodes.filter(n => {
    const d = n.data as ScriptChapterNodeData;
    return n.type === CANVAS_NODE_TYPES.scriptChapter && 
           d.branchType === 'branch' && 
           d.parentId === pendingConnectStart.nodeId;
  });
  const branchIndex = existingBranches.length + 1;
  
  const newDisplayName = parentDisplayName 
    ? `${parentDisplayName}-${branchIndex}`
    : `${parentChapterNumber}-${branchIndex}`;
  
  const nodeData: Partial<ScriptChapterNodeData> = {
    branchType: 'branch',
    parentId: pendingConnectStart.nodeId,
    branchIndex,
    chapterNumber: parentChapterNumber,
    displayName: newDisplayName,
    depth: sourceDepth + 1,
  };
  
  const nodePosition = calculateBranchNodePosition(
    sourceNode,
    existingBranches.length,
    DEFAULT_LAYOUT_CONFIG
  );
  
  const newNodeId = addNode(CANVAS_NODE_TYPES.scriptChapter, nodePosition, nodeData);
  
  connectNodes({
    source: pendingConnectStart.nodeId,
    target: newNodeId,
    sourceHandle: 'source',
    targetHandle: 'target',
  });
  
  scheduleCanvasPersist(0);
  setShowNodeMenu(false);
  setMenuAllowedTypes(undefined);
  setPendingConnectStart(null);
  setPreviewConnectionVisual(null);
}, [
  addNode,
  connectNodes,
  nodes,
  pendingConnectStart,
  scheduleCanvasPersist,
]);

  const duplicateNodes = useCallback(
    (sourceNodeIds: string[], options: DuplicateOptions = {}) => {
      const dedupedIds = Array.from(new Set(sourceNodeIds));
      if (dedupedIds.length === 0) {
        return null as DuplicateResult | null;
      }

      const sourceNodes = nodes.filter((node) => dedupedIds.includes(node.id));
      if (sourceNodes.length === 0) {
        return null as DuplicateResult | null;
      }

      const sourceIdSet = new Set(sourceNodes.map((node) => node.id));
      const internalEdges = edges.filter(
        (edge) => sourceIdSet.has(edge.source) && sourceIdSet.has(edge.target)
      );

      const baseOffsets = [
        { x: 44, y: 30 },
        { x: 72, y: 8 },
        { x: 18, y: 68 },
        { x: 96, y: 42 },
      ];
      const existingNodes = useCanvasStore.getState().nodes;
      const ignoreNodeIds = new Set<string>();
      const offsetStep = options.disableOffsetIteration ? 0 : pasteIterationRef.current;
      let chosenOffset = options.explicitOffset ?? baseOffsets[0];

      const isOffsetAvailable = (offset: { x: number; y: number }) => sourceNodes.every((node) => {
        const size = getNodeSize(node);
        return !hasRectCollision(
          {
            x: node.position.x + offset.x + offsetStep * 8,
            y: node.position.y + offset.y + offsetStep * 6,
            width: size.width,
            height: size.height,
          },
          existingNodes,
          ignoreNodeIds
        );
      });

      if (!options.explicitOffset) {
        const matchedBaseOffset = baseOffsets.find((offset) => isOffsetAvailable(offset));
        if (matchedBaseOffset) {
          chosenOffset = matchedBaseOffset;
        } else {
          const maxStep = 16;
          for (let step = 1; step <= maxStep; step += 1) {
            const candidate = { x: 24 + step * 26, y: 16 + step * 18 };
            if (isOffsetAvailable(candidate)) {
              chosenOffset = candidate;
              break;
            }
          }
        }
      }

      const idMap = new globalThis.Map<string, string>();
      const sizeMap = new globalThis.Map<string, { width: number; height: number }>();
      const sourceById = new globalThis.Map(sourceNodes.map((sourceNode) => [sourceNode.id, sourceNode] as const));
      for (const sourceNode of sourceNodes) {
        const data = cloneNodeData(sourceNode.data);
        if ('isGenerating' in (data as Record<string, unknown>)) {
          (data as { isGenerating?: boolean }).isGenerating = false;
        }
        if ('generationStartedAt' in (data as Record<string, unknown>)) {
          (data as { generationStartedAt?: number | null }).generationStartedAt = null;
        }
        if ('generationJobId' in (data as Record<string, unknown>)) {
          (data as { generationJobId?: string | null }).generationJobId = null;
        }
        if ('generationProviderId' in (data as Record<string, unknown>)) {
          (data as { generationProviderId?: string | null }).generationProviderId = null;
        }
        if ('generationClientSessionId' in (data as Record<string, unknown>)) {
          (data as { generationClientSessionId?: string | null }).generationClientSessionId = null;
        }
        if ('generationStoryboardMetadata' in (data as Record<string, unknown>)) {
          (data as { generationStoryboardMetadata?: unknown }).generationStoryboardMetadata = undefined;
        }
        if ('generationError' in (data as Record<string, unknown>)) {
          (data as { generationError?: string | null }).generationError = null;
        }
        if ('generationErrorDetails' in (data as Record<string, unknown>)) {
          (data as { generationErrorDetails?: string | null }).generationErrorDetails = null;
        }
        if ('generationDebugContext' in (data as Record<string, unknown>)) {
          (data as { generationDebugContext?: unknown }).generationDebugContext = undefined;
        }

        const nextNodeId = addNode(
          sourceNode.type as CanvasNodeType,
          {
            x: sourceNode.position.x + chosenOffset.x + offsetStep * 8,
            y: sourceNode.position.y + chosenOffset.y + offsetStep * 6,
          },
          { ...data }
        );
        idMap.set(sourceNode.id, nextNodeId);
        sizeMap.set(nextNodeId, getNodeSize(sourceNode));
      }

      const sizeSyncChanges = Array.from(sizeMap.entries()).map(([nodeId, size]: [string, { width: number; height: number }]) => ({
        id: nodeId,
        type: 'dimensions' as const,
        dimensions: { width: size.width, height: size.height },
        resizing: false,
        setAttributes: true,
      }));
      if (sizeSyncChanges.length > 0) {
        applyNodesChange(sizeSyncChanges as NodeChange<CanvasNode>[]);
      }

      useCanvasStore.setState((state) => ({
        nodes: state.nodes.map((currentNode) => {
          const sourceNodeEntry = Array.from(idMap.entries()).find(([, copiedId]) => copiedId === currentNode.id);
          if (!sourceNodeEntry) {
            return currentNode;
          }

          const sourceNode = sourceById.get(sourceNodeEntry[0]);
          if (!sourceNode) {
            return currentNode;
          }

          const copiedParentId = sourceNode.parentId
            ? (idMap.get(sourceNode.parentId) ?? sourceNode.parentId)
            : undefined;

          return {
            ...currentNode,
            parentId: copiedParentId,
            extent: undefined,
          };
        }),
      }));

      for (const edge of internalEdges) {
        const nextSource = idMap.get(edge.source);
        const nextTarget = idMap.get(edge.target);
        if (!nextSource || !nextTarget) {
          continue;
        }
        connectNodes({
          source: nextSource,
          target: nextTarget,
          sourceHandle: edge.sourceHandle ?? 'source',
          targetHandle: edge.targetHandle ?? 'target',
        });
      }

      if (!options.disableOffsetIteration) {
        pasteIterationRef.current += 1;
      }
      const firstNodeId = idMap.get(sourceNodes[0].id) ?? null;
      if (firstNodeId && !options.suppressSelect) {
        setSelectedNode(firstNodeId);
      }
      if (!options.suppressPersist) {
        scheduleCanvasPersist(0);
      }
      return { firstNodeId, idMap };
    },
    [addNode, applyNodesChange, connectNodes, edges, nodes, scheduleCanvasPersist, setSelectedNode]
  );

  useEffect(() => {
    duplicateNodesRef.current = (sourceNodeIds: string[]) => duplicateNodes(sourceNodeIds)?.firstNodeId ?? null;
  }, [duplicateNodes]);

  const handleConnectStart = useCallback(
    (event: MouseEvent | TouchEvent, params: OnConnectStartParams) => {
      setShowNodeMenu(false);
      setMenuAllowedTypes(undefined);
      setPreviewConnectionVisual(null);

      if (!params.nodeId || !params.handleType) {
        setPendingConnectStart(null);
        return;
      }

      if (
        params.handleType === 'source'
        && !canNodeBeManualConnectionSource(params.nodeId, nodes)
      ) {
        setPendingConnectStart(null);
        return;
      }

      const containerRect = reactFlowWrapperRef.current?.getBoundingClientRect();
      const eventTarget = event.target as Element | null;
      const handleElement = eventTarget?.closest?.('.react-flow__handle') as HTMLElement | null;
      const clientPosition = getClientPosition(event);
      const handleId = handleElement?.dataset?.handleid;
      let start: { x: number; y: number } | undefined;
      if (containerRect && handleElement) {
        const handleRect = handleElement.getBoundingClientRect();
        start = {
          x: handleRect.left - containerRect.left + handleRect.width / 2,
          y: handleRect.top - containerRect.top + handleRect.height / 2,
        };
      } else if (containerRect && clientPosition) {
        start = {
          x: clientPosition.x - containerRect.left,
          y: clientPosition.y - containerRect.top,
        };
      }

      if (clientPosition) {
        connectionPointerRef.current = {
          x: clientPosition.x,
          y: clientPosition.y,
        };
      } else {
        connectionPointerRef.current = null;
      }
      connectionSpacePanActiveRef.current = false;
      connectionSpacePanMovedRef.current = false;

      setPendingConnectStart({
        nodeId: params.nodeId,
        handleType: params.handleType,
        handleId,
        start,
      });
    },
    [nodes]
  );

  const handleNodeDragStart = useCallback(
    (event: ReactMouseEvent, node: CanvasNode) => {
      if (!event.altKey) {
        altDragCopyRef.current = null;
        return;
      }

      const sourceNodeIds = selectedNodeIds.includes(node.id)
        ? selectedNodeIds
        : [node.id];
      if (sourceNodeIds.length === 0) {
        altDragCopyRef.current = null;
        return;
      }
      const startPositions = new globalThis.Map<string, { x: number; y: number }>();
      for (const sourceNodeId of sourceNodeIds) {
        const sourceNode = nodes.find((item) => item.id === sourceNodeId);
        if (!sourceNode) {
          continue;
        }
        startPositions.set(sourceNodeId, {
          x: sourceNode.position.x,
          y: sourceNode.position.y,
        });
      }
      if (startPositions.size === 0) {
        altDragCopyRef.current = null;
        return;
      }

      const duplicateResult = duplicateNodes(sourceNodeIds, {
        explicitOffset: { x: 0, y: 0 },
        disableOffsetIteration: true,
        suppressPersist: true,
        suppressSelect: true,
      });
      if (!duplicateResult) {
        altDragCopyRef.current = null;
        return;
      }

      const copiedNodeIds = sourceNodeIds
        .map((sourceId) => duplicateResult.idMap.get(sourceId))
        .filter((id): id is string => Boolean(id));
      if (copiedNodeIds.length === 0) {
        altDragCopyRef.current = null;
        return;
      }

      // Keep the duplicated nodes visually above the original dragged node.
      useCanvasStore.setState((state) => ({
        nodes: state.nodes.map((currentNode) => {
          if (!copiedNodeIds.includes(currentNode.id)) {
            return currentNode;
          }
          return {
            ...currentNode,
            zIndex: ALT_DRAG_COPY_Z_INDEX,
            style: {
              ...(currentNode.style ?? {}),
              zIndex: ALT_DRAG_COPY_Z_INDEX,
            },
          };
        }),
      }));

      altDragCopyRef.current = {
        sourceNodeIds,
        startPositions,
        copiedNodeIds,
        sourceToCopyIdMap: duplicateResult.idMap,
      };
    },
    [duplicateNodes, nodes, selectedNodeIds]
  );

  const handleNodeDrag = useCallback(
    (_event: ReactMouseEvent, node: CanvasNode) => {
      const altCopyState = altDragCopyRef.current;

      if (enableNodeAlignment && !altCopyState) {
        setIsDraggingNode(true);
        const draggedNodeIds = selectedNodeIds.includes(node.id) ? selectedNodeIds : [node.id];
        const draggedNodeIdSet = new Set(draggedNodeIds);
        const otherNodes = nodes.filter(
          (candidate) =>
            !draggedNodeIdSet.has(candidate.id) && candidate.parentId === node.parentId
        );
        const alignments = detectAlignments(node, otherNodes, alignmentThreshold);
        setAlignmentGuides(showAlignmentGuides ? alignments.map((alignment) => alignment.guide) : []);

        const snapOffset = alignments.reduce(
          (offset, alignment) => ({
            x: alignment.guide.type === 'vertical' ? alignment.snapOffset.x : offset.x,
            y: alignment.guide.type === 'horizontal' ? alignment.snapOffset.y : offset.y,
          }),
          { x: 0, y: 0 }
        );

        if (Math.abs(snapOffset.x) > 0.01 || Math.abs(snapOffset.y) > 0.01) {
          const currentNodes = useCanvasStore.getState().nodes;
          const snapChanges = draggedNodeIds
            .map((draggedNodeId) => {
              const currentNode =
                draggedNodeId === node.id
                  ? node
                  : currentNodes.find((candidate) => candidate.id === draggedNodeId);
              if (!currentNode) {
                return null;
              }

              return {
                id: draggedNodeId,
                type: 'position' as const,
                position: {
                  x: currentNode.position.x + snapOffset.x,
                  y: currentNode.position.y + snapOffset.y,
                },
                dragging: true,
              };
            })
            .filter((change): change is {
              id: string;
              type: 'position';
              position: { x: number; y: number };
              dragging: true;
            } => Boolean(change));

          if (snapChanges.length > 0) {
            applyNodesChange(snapChanges);
          }
        }
      }

      if (!altCopyState) {
        return;
      }

      const startPosition = altCopyState.startPositions.get(node.id);
      if (!startPosition) {
        return;
      }

      const deltaX = node.position.x - startPosition.x;
      const deltaY = node.position.y - startPosition.y;

      const restoreSourceChanges = altCopyState.sourceNodeIds
        .map((sourceId) => {
          const sourceStart = altCopyState.startPositions.get(sourceId);
          if (!sourceStart) {
            return null;
          }
          return {
            id: sourceId,
            type: 'position' as const,
            position: sourceStart,
            dragging: true,
          };
        })
        .filter((change): change is {
          id: string;
          type: 'position';
          position: { x: number; y: number };
          dragging: true;
        } => Boolean(change));

      const moveCopyChanges = altCopyState.sourceNodeIds
        .map((sourceId) => {
          const sourceStart = altCopyState.startPositions.get(sourceId);
          const copyId = altCopyState.sourceToCopyIdMap.get(sourceId);
          if (!sourceStart || !copyId) {
            return null;
          }
          return {
            id: copyId,
            type: 'position' as const,
            position: { x: sourceStart.x + deltaX, y: sourceStart.y + deltaY },
            dragging: true,
          };
        })
        .filter((change): change is {
          id: string;
          type: 'position';
          position: { x: number; y: number };
          dragging: true;
        } => Boolean(change));

      const allChanges = [...restoreSourceChanges, ...moveCopyChanges];
      if (allChanges.length > 0) {
        applyNodesChange(allChanges);
      }
    },
    [
      alignmentThreshold,
      applyNodesChange,
      enableNodeAlignment,
      nodes,
      selectedNodeIds,
      showAlignmentGuides,
    ]
  );

  const handleNodeDragStop = useCallback(
    (_event: ReactMouseEvent, node: CanvasNode) => {
      // 清除对齐辅助线
      setIsDraggingNode(false);
      setAlignmentGuides([]);

      const altCopyState = altDragCopyRef.current;
      if (!altCopyState) {
        const currentNodes = useCanvasStore.getState().nodes;
        const currentNodeMap = new globalThis.Map(
          currentNodes.map((currentNode) => [currentNode.id, currentNode] as const)
        );
        const draggedNodeIds = selectedNodeIds.includes(node.id) ? selectedNodeIds : [node.id];
        const groupAssignments = new Map<string, string[]>();
        const detachedNodeIds: string[] = [];

        draggedNodeIds.forEach((draggedNodeId) => {
          const draggedNode = currentNodes.find((currentNode) => currentNode.id === draggedNodeId);
          if (!draggedNode || draggedNode.type === CANVAS_NODE_TYPES.group) {
            return;
          }

          const currentGroupId =
            draggedNode.parentId && currentNodeMap.get(draggedNode.parentId)?.type === CANVAS_NODE_TYPES.group
              ? draggedNode.parentId
              : null;
          const targetGroupId = findContainingGroupId(draggedNode, currentNodes);
          if (!targetGroupId) {
            if (currentGroupId) {
              detachedNodeIds.push(draggedNodeId);
            }
            return;
          }

          if (targetGroupId === currentGroupId) {
            return;
          }

          const currentAssignment = groupAssignments.get(targetGroupId) ?? [];
          currentAssignment.push(draggedNodeId);
          groupAssignments.set(targetGroupId, currentAssignment);
        });

        let didGroupMembershipChange = false;
        groupAssignments.forEach((nodeIds, groupNodeId) => {
          didGroupMembershipChange = reparentNodesToGroup(nodeIds, groupNodeId) || didGroupMembershipChange;
        });

        if (detachedNodeIds.length > 0) {
          didGroupMembershipChange =
            detachNodesFromGroup(detachedNodeIds) || didGroupMembershipChange;
        }

        if (didGroupMembershipChange) {
          scheduleCanvasPersist(0);
        }
        return;
      }
      altDragCopyRef.current = null;

      const startPosition = altCopyState.startPositions.get(node.id);
      if (!startPosition) {
        return;
      }

      const offset = {
        x: node.position.x - startPosition.x,
        y: node.position.y - startPosition.y,
      };

      const restoreSourceChanges = altCopyState.sourceNodeIds
        .map((sourceId) => {
          const sourceStart = altCopyState.startPositions.get(sourceId);
          if (!sourceStart) {
            return null;
          }
          return {
            id: sourceId,
            type: 'position' as const,
            position: sourceStart,
            dragging: false,
          };
        })
        .filter((change): change is {
          id: string;
          type: 'position';
          position: { x: number; y: number };
          dragging: false;
        } => Boolean(change));

      const finalizeCopyChanges = altCopyState.sourceNodeIds
        .map((sourceId) => {
          const sourceStart = altCopyState.startPositions.get(sourceId);
          const copyId = altCopyState.sourceToCopyIdMap.get(sourceId);
          if (!sourceStart || !copyId) {
            return null;
          }
          return {
            id: copyId,
            type: 'position' as const,
            position: { x: sourceStart.x + offset.x, y: sourceStart.y + offset.y },
            dragging: false,
          };
        })
        .filter((change): change is {
          id: string;
          type: 'position';
          position: { x: number; y: number };
          dragging: false;
        } => Boolean(change));

      const allChanges = [...restoreSourceChanges, ...finalizeCopyChanges];
      if (allChanges.length > 0) {
        applyNodesChange(allChanges);
      }

      const currentNodes = useCanvasStore.getState().nodes;
      const currentNodeMap = new globalThis.Map(
        currentNodes.map((currentNode) => [currentNode.id, currentNode] as const)
      );
      const groupAssignments = new Map<string, string[]>();
      const detachedNodeIds: string[] = [];
      altCopyState.copiedNodeIds.forEach((copiedNodeId) => {
        const copiedNode = currentNodes.find((currentNode) => currentNode.id === copiedNodeId);
        if (!copiedNode || copiedNode.type === CANVAS_NODE_TYPES.group) {
          return;
        }

        const currentGroupId =
          copiedNode.parentId && currentNodeMap.get(copiedNode.parentId)?.type === CANVAS_NODE_TYPES.group
            ? copiedNode.parentId
            : null;
        const targetGroupId = findContainingGroupId(copiedNode, currentNodes);
        if (!targetGroupId) {
          if (currentGroupId) {
            detachedNodeIds.push(copiedNodeId);
          }
          return;
        }

        if (targetGroupId === currentGroupId) {
          return;
        }

        const currentAssignment = groupAssignments.get(targetGroupId) ?? [];
        currentAssignment.push(copiedNodeId);
        groupAssignments.set(targetGroupId, currentAssignment);
      });

      groupAssignments.forEach((nodeIds, groupNodeId) => {
        reparentNodesToGroup(nodeIds, groupNodeId);
      });
      if (detachedNodeIds.length > 0) {
        detachNodesFromGroup(detachedNodeIds);
      }

      if (altCopyState.copiedNodeIds.length > 0) {
        setSelectedNode(altCopyState.copiedNodeIds[0]);
      }
      scheduleCanvasPersist(0);
    },
    [
      applyNodesChange,
      detachNodesFromGroup,
      reparentNodesToGroup,
      scheduleCanvasPersist,
      selectedNodeIds,
      setSelectedNode,
    ]
  );

  const handleConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent, connectionState: FinalConnectionState) => {
      if (connectionState.isValid || !pendingConnectStart) {
        setPendingConnectStart(null);
        setPreviewConnectionVisual(null);
        return;
      }

      const clientPosition = getClientPosition(event);
      const containerRect = reactFlowWrapperRef.current?.getBoundingClientRect();
      if (!clientPosition || !containerRect) {
        setPendingConnectStart(null);
        setPreviewConnectionVisual(null);
        return;
      }

      const dropNodeId = resolveDropNodeId(event.target, clientPosition);

      const isSupplementConnection = pendingConnectStart.handleId === 'supplement';
      const isBranchConnection = (() => {
        if (!pendingConnectStart?.nodeId) return false;
        if (isSupplementConnection) return false;
        const sourceNode = nodes.find(n => n.id === pendingConnectStart.nodeId);
        return sourceNode?.type === CANVAS_NODE_TYPES.scriptChapter;
      })();

      if (dropNodeId && dropNodeId !== pendingConnectStart.nodeId) {
        const sourceNode =
          pendingConnectStart.handleType === 'source'
            ? nodes.find((node) => node.id === pendingConnectStart.nodeId)
            : nodes.find((node) => node.id === dropNodeId);
        const targetNode =
          pendingConnectStart.handleType === 'source'
            ? nodes.find((node) => node.id === dropNodeId)
            : nodes.find((node) => node.id === pendingConnectStart.nodeId);

        if (
          sourceNode &&
          targetNode &&
          canNodeTypeBeManualConnectionSource(sourceNode.type) &&
          nodeHasSourceHandle(sourceNode.type) &&
          nodeHasTargetHandle(targetNode.type)
        ) {
          connectNodes({
            source: sourceNode.id,
            target: targetNode.id,
            sourceHandle: 'source',
            targetHandle: 'target',
          });
          scheduleCanvasPersist(0);
          setPendingConnectStart(null);
          setPreviewConnectionVisual(null);
          return;
        }
      }

      const allowedTypes = resolveAllowedNodeTypes(
        pendingConnectStart.handleType,
        project?.projectType === 'script' ? 'script' : 'storyboard',
        pendingConnectStart.nodeId,
        nodes
      );
      if (allowedTypes.length === 0) {
        setPendingConnectStart(null);
        setPreviewConnectionVisual(null);
        return;
      }

      const endX = clientPosition.x - containerRect.left;
      const endY = clientPosition.y - containerRect.top;
      let startX: number | null = pendingConnectStart.start?.x ?? null;
      let startY: number | null = pendingConnectStart.start?.y ?? null;

      if (startX === null || startY === null) {
        const nodeElement = reactFlowWrapperRef.current?.querySelector<HTMLElement>(
          `.react-flow__node[data-id="${pendingConnectStart.nodeId}"]`
        );
        const handleElement = nodeElement?.querySelector<HTMLElement>(
          `.react-flow__handle-${pendingConnectStart.handleType}`
        );
        if (handleElement) {
          const handleRect = handleElement.getBoundingClientRect();
          startX = handleRect.left - containerRect.left + handleRect.width / 2;
          startY = handleRect.top - containerRect.top + handleRect.height / 2;
        } else if (nodeElement) {
          const nodeRect = nodeElement.getBoundingClientRect();
          startX =
            pendingConnectStart.handleType === 'source'
              ? nodeRect.right - containerRect.left
              : nodeRect.left - containerRect.left;
          startY = nodeRect.top - containerRect.top + nodeRect.height / 2;
        } else if (connectionState.from) {
          startX = connectionState.from.x;
          startY = connectionState.from.y;
        }
      }

      if (startX === null || startY === null) {
        setPreviewConnectionVisual(null);
      } else {
        setPreviewConnectionVisual({
          d: createPreviewPath({
            start: { x: startX, y: startY },
            end: { x: endX, y: endY },
            handleType: pendingConnectStart.handleType,
          }),
          stroke: isBranchConnection ? 'rgba(168, 85, 247, 0.9)' : 'rgba(255,255,255,0.9)',
          strokeWidth: 1,
          strokeLinecap: 'round',
          left: 0,
          top: 0,
          width: containerRect.width,
          height: containerRect.height,
        });
      }

      const flowPos = reactFlowInstance.screenToFlowPosition(clientPosition);
      setFlowPosition(flowPos);
      setMenuPosition({
        x: clientPosition.x - containerRect.left,
        y: clientPosition.y - containerRect.top,
      });
      setMenuAllowedTypes(allowedTypes);
      suppressNextPaneClickRef.current = true;
      setShowNodeMenu(true);
    },
    [connectNodes, nodes, pendingConnectStart, reactFlowInstance, scheduleCanvasPersist]
  );

  const emptyHint = useMemo(
    () => (
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="flex max-w-3xl flex-col items-center gap-5 px-6 text-center">
          {configuredApiKeyCount === 0 && <MissingApiKeyHint />}
          <div>
            <div className="mb-2 text-2xl text-text-muted">{t('canvas.emptyHintTitle')}</div>
            <div className="text-sm text-text-muted opacity-60">{t('canvas.emptyHintSubtitle')}</div>
          </div>
        </div>
      </div>
    ),
    [configuredApiKeyCount, t]
  );

  const selectedNodes = useMemo<CanvasNode[]>(
    () => nodes.filter((node) => node.selected),
    [nodes]
  );
  const selectedNodesForOverlay = useMemo<CanvasNode[]>(() => {
    const nodeMap = new globalThis.Map(nodes.map((node) => [node.id, node] as const));
    return selectedNodes.map((node) => ({
      ...node,
      position: resolveAbsoluteNodePosition(node, nodeMap),
    }));
  }, [nodes, selectedNodes]);
  const selectedDownloadNodes = useMemo(
    () =>
      selectedNodes.flatMap((node, index) => {
        const source = getNodePrimaryImageSource(node);
        if (!source) {
          return [];
        }

        return [
          {
            source,
            suggestedFileName: resolveSelectedImageSuggestedFileName(node, index),
          },
        ];
      }),
    [selectedNodes]
  );

  const handleGroupSelectedNodes = useCallback(() => {
    if (selectedNodeIds.length < 2) {
      return;
    }

    const createdGroupId = groupNodes(selectedNodeIds);
    if (createdGroupId) {
      scheduleCanvasPersist(0);
    }
  }, [groupNodes, scheduleCanvasPersist, selectedNodeIds]);

  const handleExportSelectedImages = useCallback(async () => {
    if (selectedDownloadNodes.length < 2 || isExportingSelectedImages) {
      return;
    }

    setIsExportingSelectedImages(true);
    try {
      const baseDirectory = normalizeDialogDirectoryPath(
        await open({
          directory: true,
          multiple: false,
          title: t('selection.exportFolderPickerTitle'),
        })
      );
      if (!baseDirectory) {
        return;
      }

      const targetDirectory = await join(baseDirectory, buildTimestampFolderName());
      for (const item of selectedDownloadNodes) {
        await saveImageSourceToDirectory(item.source, targetDirectory, item.suggestedFileName);
      }
    } catch (error) {
      const { message, details } = resolveErrorContent(error, t('selection.exportFailed'));
      await showErrorDialog(message, t('common.error'), details);
    } finally {
      setIsExportingSelectedImages(false);
    }
  }, [isExportingSelectedImages, selectedDownloadNodes, t]);

  const handleLocateGroup = useCallback((groupId: string) => {
    const groupNode = nodes.find((node) => node.id === groupId && node.type === CANVAS_NODE_TYPES.group);
    if (!groupNode) {
      return;
    }

    const nodeWidth = groupNode.measured?.width ?? groupNode.width ?? DEFAULT_NODE_WIDTH;
    const nodeHeight = groupNode.measured?.height ?? groupNode.height ?? 200;

    setSelectedNode(groupNode.id);
    reactFlowInstance.setCenter(
      groupNode.position.x + nodeWidth / 2,
      groupNode.position.y + nodeHeight / 2,
      {
        zoom: Math.max(reactFlowInstance.getZoom(), 0.85),
        duration: 260,
      }
    );
  }, [nodes, reactFlowInstance, setSelectedNode]);

  const handleMergedAnchorMouseDown = useCallback((e: ReactMouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingBranchConnection(true);
    setBranchConnectionSource(selectedNodes as CanvasNode[]);
    setBranchConnectionPosition({ x: e.clientX, y: e.clientY });
  }, [selectedNodes]);

  const handleBatchOperationSelect = useCallback((nodeType: CanvasNodeType) => {
    if (branchConnectionSource.length === 0) return;

    const bounds = calculateNodesBounds(branchConnectionSource);
    const newNodePosition = {
      x: bounds.right + 100,
      y: bounds.centerY,
    };

    const newNodeId = addNode(nodeType, newNodePosition, undefined);

    // 自动连接所有源节点到新节点
    for (const sourceNode of branchConnectionSource) {
      connectNodes({
        source: sourceNode.id,
        target: newNodeId,
        sourceHandle: 'source',
        targetHandle: 'target',
      });
    }

    scheduleCanvasPersist(0);
    resetBranchConnectionState();
  }, [branchConnectionSource, addNode, connectNodes, resetBranchConnectionState, scheduleCanvasPersist]);

  return (
    <div ref={wrapperRef} className="relative h-full w-full flex">
      <ScriptBiblePanel />
      <ScriptWelcomeDialog isOpen={showWelcomeDialog} onClose={() => setShowWelcomeDialog(false)} />
      <div ref={reactFlowWrapperRef} className="relative min-w-0 flex-1">
      <GroupSidebar
        groups={groupNodesList}
        selectedGroupId={selectedGroupId}
        onLocateGroup={handleLocateGroup}
        onSelectGroup={handleLocateGroup}
      />
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={handleNodesChange}
        onEdgesChange={handleEdgesChange}
        onEdgeClick={handleEdgeClick}
        onEdgeDoubleClick={handleEdgeDoubleClick}
        onConnect={handleConnect}
        onConnectStart={handleConnectStart}
        onConnectEnd={handleConnectEnd}
        onNodeDragStart={handleNodeDragStart}
        onNodeDrag={handleNodeDrag}
        onNodeDragStop={handleNodeDragStop}
        onPaneClick={handlePaneClick}
        onPaneContextMenu={handlePaneContextMenu}
        onMove={handleMove}
        onMoveStart={handleMoveStart}
        onMoveEnd={handleMoveEnd}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        defaultEdgeOptions={{ type: 'disconnectableEdge' }}
        defaultViewport={DEFAULT_VIEWPORT}
        minZoom={0.1}
        maxZoom={5}
        selectionOnDrag
        selectionMode={SelectionMode.Partial}
        multiSelectionKeyCode={['Control', 'Meta']}
        selectionKeyCode={['Control', 'Meta']}
        deleteKeyCode={null}
        onlyRenderVisibleElements
        zoomOnDoubleClick={false}
        snapToGrid={snapToGrid}
        snapGrid={[snapGridSize, snapGridSize]}
        proOptions={{ hideAttribution: true }}
        className="bg-bg-dark"
      >
        <Background variant={BackgroundVariant.Dots} gap={snapGridSize} size={1.5} color={showGrid ? "rgba(255,255,255,0.12)" : "transparent"} />
        
        {showMiniMap && (
          <MiniMap
            className="canvas-minimap nopan nowheel !border-border-dark !bg-surface-dark"
            style={{ pointerEvents: 'all', zIndex: 10000 }}
            nodeColor="rgba(120, 120, 120, 0.92)"
            maskColor="rgba(0, 0, 0, 0.62)"
            pannable
            zoomable
          />
        )}

        <SelectedNodeOverlay />
        <SelectionGroupBar
          selectedNodes={selectedNodesForOverlay}
          viewport={currentViewport}
          onGroup={handleGroupSelectedNodes}
          downloadableCount={selectedDownloadNodes.length}
          onExportSelected={handleExportSelectedImages}
          isExportingSelected={isExportingSelectedImages}
        />

        {/* 对齐辅助线 */}
        {isDraggingNode && alignmentGuides.length > 0 && (
          <AlignmentGuides 
            guides={alignmentGuides} 
            viewport={currentViewport}
          />
        )}
      </ReactFlow>

      {/* 合并锚点 - 多选时显示 */}
      {selectedNodes.length >= 2 && !isDraggingBranchConnection && (
        <MergedConnectionAnchor
          selectedNodes={selectedNodesForOverlay}
          viewport={currentViewport}
          onMouseDown={handleMergedAnchorMouseDown}
        />
      )}

      {/* 分支连线预览 */}
      {isDraggingBranchConnection && branchConnectionPosition && (
        <BranchConnectionPreview
          sourceNodes={branchConnectionSource}
          currentPosition={branchConnectionPosition}
          viewport={currentViewport}
        />
      )}

      {/* 批量操作菜单 */}
      {showBatchMenu && branchConnectionSource.length > 0 && (
        <BatchOperationMenu
          position={batchMenuPosition}
          sourceNodeIds={branchConnectionSource.map(n => n.id)}
          sourceNodeType={branchConnectionSource[0]?.type || 'default'}
          projectType={project?.projectType === 'script' ? 'script' : 'storyboard'}
          onSelectNodeType={handleBatchOperationSelect}
          onClose={resetBranchConnectionState}
        />
      )}

      {/* 右下角控制条 */}
      <CanvasAssetDock />

      <div 
        className="absolute flex items-center gap-1 rounded-lg border border-border-dark bg-surface-dark px-2 py-1.5 shadow-lg"
        style={{ 
          bottom: '16px', 
          right: '16px', 
          zIndex: 9999 
        }}
      >
        {/* 网格吸附开关 */}
        <button
          onClick={() => setSnapToGrid(!snapToGrid)}
          style={{ 
            color: snapToGrid ? '#3b82f6' : '#6b7280',
            padding: '6px',
            borderRadius: '4px'
          }}
          title={snapToGrid ? t('canvas.toolbar.gridSnapOff') : t('canvas.toolbar.gridSnapOn')}
        >
          <Grid3x3 style={{ width: '16px', height: '16px' }} />
        </button>

        <div style={{ width: '1px', height: '16px', backgroundColor: '#374151' }} />

        {/* 对齐辅助线开关 */}
        <button
          onClick={() => setShowAlignmentGuides(!showAlignmentGuides)}
          style={{
            color: showAlignmentGuides ? '#3b82f6' : '#6b7280',
            padding: '6px',
            borderRadius: '4px'
          }}
          title={
            showAlignmentGuides
              ? t('canvas.toolbar.alignmentGuidesOff')
              : t('canvas.toolbar.alignmentGuidesOn')
          }
        >
          <AlignCenter style={{ width: '16px', height: '16px' }} />
        </button>

        <div style={{ width: '1px', height: '16px', backgroundColor: '#374151' }} />

        {/* 小地图开关 */}
        <button
          onClick={() => setShowMiniMap(!showMiniMap)}
          style={{ 
            color: showMiniMap ? '#3b82f6' : '#6b7280',
            padding: '6px',
            borderRadius: '4px'
          }}
          title={showMiniMap ? t('canvas.toolbar.miniMapOff') : t('canvas.toolbar.miniMapOn')}
        >
          <MapIcon style={{ width: '16px', height: '16px' }} />
        </button>

        <div style={{ width: '1px', height: '16px', backgroundColor: '#374151' }} />

        {/* 缩小 */}
        <button
          onClick={() => zoomOut()}
          style={{ 
            color: '#6b7280',
            padding: '6px',
            borderRadius: '4px'
          }}
          title="缩小"
        >
          <Minus style={{ width: '16px', height: '16px' }} />
        </button>

        {/* 缩放百分比 */}
        <span style={{ 
          minWidth: '40px', 
          textAlign: 'center', 
          fontSize: '12px',
          color: '#6b7280'
        }}>
          {Math.round((currentViewport?.zoom ?? 1) * 100)}%
        </span>

        {/* 放大 */}
        <button
          onClick={() => zoomIn()}
          style={{ 
            color: '#6b7280',
            padding: '6px',
            borderRadius: '4px'
          }}
          title="放大"
        >
          <Plus style={{ width: '16px', height: '16px' }} />
        </button>
      </div>

      {dragOverlayKind && (
        <div className="absolute inset-0 z-50 pointer-events-none">
          <div
            className={`absolute inset-0 m-4 flex items-center justify-center rounded-lg border-2 border-dashed ${
              dragOverlayKind === 'files'
                ? 'border-amber-500/50 bg-amber-500/10'
                : 'border-accent/40 bg-accent/10'
            }`}
          >
            <div
              className={`rounded-xl px-6 py-4 shadow-lg ${
                dragOverlayKind === 'files'
                  ? 'border border-amber-500/30 bg-surface-dark/90'
                  : 'border border-accent/30 bg-surface-dark/92'
              }`}
            >
              <div
                className={`flex items-center gap-3 ${
                  dragOverlayKind === 'files' ? 'text-amber-400' : 'text-accent'
                }`}
              >
                {dragOverlayKind === 'files' ? (
                  <Upload className="h-6 w-6" />
                ) : (
                  <ImagePlus className="h-6 w-6" />
                )}
                <span className="text-lg font-medium">
                  {dragOverlayKind === 'files'
                    ? t('canvas.dropFilesHint')
                    : t('assets.dropToCanvas')}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {nodes.length === 0 && emptyHint}
      {nodes.length > 0 && configuredApiKeyCount === 0 && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center px-6">
          <MissingApiKeyHint />
        </div>
      )}

      {showNodeMenu && previewConnectionVisual && (
        <svg
          className="pointer-events-none absolute z-40 overflow-visible"
          style={{
            left: previewConnectionVisual.left,
            top: previewConnectionVisual.top,
            width: previewConnectionVisual.width,
            height: previewConnectionVisual.height,
          }}
          width={previewConnectionVisual.width}
          height={previewConnectionVisual.height}
        >
          <path
            className="pointer-events-none"
            d={previewConnectionVisual.d}
            fill="none"
            stroke={previewConnectionVisual.stroke}
            strokeWidth={previewConnectionVisual.strokeWidth}
            strokeLinecap={previewConnectionVisual.strokeLinecap}
          />
        </svg>
      )}

      {showNodeMenu && (
        <NodeSelectionMenu
          position={menuPosition}
          allowedTypes={menuAllowedTypes}
          projectType={project?.projectType as 'storyboard' | 'script' | undefined}
          showBranchOption={(() => {
            if (project?.projectType !== 'script' || !pendingConnectStart?.nodeId) return false;
            if (pendingConnectStart.handleId === 'supplement') return false;
            const sourceNode = nodes.find(n => n.id === pendingConnectStart.nodeId);
            return sourceNode?.type === CANVAS_NODE_TYPES.scriptChapter || sourceNode?.type === CANVAS_NODE_TYPES.scriptRoot;
          })()}
          onlyBranchOption={(() => {
            if (project?.projectType !== 'script' || !pendingConnectStart?.nodeId) return false;
            if (pendingConnectStart.handleId === 'supplement') return false;
            const sourceNode = nodes.find(n => n.id === pendingConnectStart.nodeId);
            return sourceNode?.type === CANVAS_NODE_TYPES.scriptChapter || sourceNode?.type === CANVAS_NODE_TYPES.scriptRoot;
          })()}
          showSupplementOption={(() => {
            if (project?.projectType !== 'script' || !pendingConnectStart?.nodeId) return false;
            return pendingConnectStart.handleId === 'supplement';
          })()}
          onlySupplementOption={(() => {
            if (project?.projectType !== 'script' || !pendingConnectStart?.nodeId) return false;
            return pendingConnectStart.handleId === 'supplement';
          })()}
          onSelect={handleNodeSelect}
          onSpecialAction={handleCreateBranch}
          onClose={() => {
            setShowNodeMenu(false);
            setMenuAllowedTypes(undefined);
            setPendingConnectStart(null);
            setPreviewConnectionVisual(null);
          }}
        />
      )}

      <NodeToolDialog />

      <ImageViewerModal
        open={imageViewer.isOpen}
        imageUrl={imageViewer.currentImageUrl || ''}
        imageList={imageViewer.imageList}
        currentIndex={imageViewer.currentIndex}
        onClose={closeImageViewer}
        onNavigate={navigateImageViewer}
      />
      </div>
      <SceneStudioPanel />
    </div>
  );
}
