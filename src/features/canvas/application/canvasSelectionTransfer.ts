import { v4 as uuidv4 } from 'uuid';

import {
  getProjectRecord,
  upsertProjectGraphSnapshot,
} from '@/commands/projectState';
import {
  createCanvasRect,
  getCanvasNodeRect,
  getCanvasNodeSize,
  rectIntersects,
  resolveAbsoluteCanvasNodePosition,
  type CanvasRect,
} from '@/features/canvas/application/nodeGeometry';
import { CANVAS_NODE_TYPES } from '@/features/canvas/domain/canvasNodes';
import { createDefaultCanvasColorLabelMap } from '@/features/canvas/domain/semanticColors';
import i18n from '@/i18n';
import {
  createEmptyHistory,
  DEFAULT_VIEWPORT,
  fromProjectRecord,
  toProjectRecord,
  type Project,
  type ProjectSummary,
  useProjectStore,
} from '@/stores/projectStore';
import { useCanvasStore, type CanvasEdge, type CanvasNode } from '@/stores/canvasStore';

const DEFAULT_TRANSFER_ORIGIN = { x: 120, y: 120 };
const TRANSFER_SCAN_GAP = 120;
const TRANSFER_COLLISION_MARGIN = 36;
const FALLBACK_VIEWPORT_WIDTH = 1440;
const FALLBACK_VIEWPORT_HEIGHT = 900;

export interface CanvasTransferProjectCandidate {
  id: string;
  name: string;
  updatedAt: number;
  nodeCount: number;
}

export interface TransferCanvasSelectionInput {
  sourceNodeIds: string[];
  targetProjectId?: string | null;
  newProjectName?: string | null;
}

export interface TransferCanvasSelectionResult {
  projectId: string;
  nodeCount: number;
}

interface SelectionCopyBlock {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  bounds: CanvasRect;
}

function normalizeText(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}

function cloneCanvasValue<T>(value: T): T {
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

function buildNodeMap(nodes: CanvasNode[]): Map<string, CanvasNode> {
  return new Map(nodes.map((node) => [node.id, node] as const));
}

function clonePersistentCanvasNode(node: CanvasNode): CanvasNode {
  const cloned = cloneCanvasValue(node) as CanvasNode & Record<string, unknown>;
  delete cloned.selected;
  delete cloned.dragging;
  delete cloned.measured;
  delete cloned.positionAbsolute;
  delete cloned.internals;
  delete cloned.handleBounds;
  return cloned;
}

function clonePersistentCanvasEdge(edge: CanvasEdge): CanvasEdge {
  const cloned = cloneCanvasValue(edge) as CanvasEdge & Record<string, unknown>;
  delete cloned.selected;
  return cloned;
}

function collectDescendantIds(groupNodeId: string, nodes: CanvasNode[]): string[] {
  const descendants: string[] = [];
  const pending = nodes
    .filter((node) => node.parentId === groupNodeId)
    .map((node) => node.id);

  while (pending.length > 0) {
    const nodeId = pending.shift();
    if (!nodeId) {
      continue;
    }
    descendants.push(nodeId);
    nodes.forEach((node) => {
      if (node.parentId === nodeId) {
        pending.push(node.id);
      }
    });
  }

  return descendants;
}

function collectTransferNodeIds(sourceNodeIds: string[], nodes: CanvasNode[]): string[] {
  const nodeMap = buildNodeMap(nodes);
  const orderedIds: string[] = [];
  const idSet = new Set<string>();

  const addId = (nodeId: string) => {
    if (!nodeMap.has(nodeId) || idSet.has(nodeId)) {
      return;
    }
    idSet.add(nodeId);
    orderedIds.push(nodeId);
  };

  sourceNodeIds.forEach((rawNodeId) => {
    const nodeId = normalizeText(rawNodeId);
    const node = nodeMap.get(nodeId);
    if (!node) {
      return;
    }

    addId(node.id);
    if (node.type === CANVAS_NODE_TYPES.group) {
      collectDescendantIds(node.id, nodes).forEach(addId);
    }
  });

  return orderedIds;
}

function resolveCopyBounds(nodes: CanvasNode[], nodeMap: Map<string, CanvasNode>): CanvasRect {
  const rects = nodes.map((node) => getCanvasNodeRect(node, nodeMap));
  const left = Math.min(...rects.map((rect) => rect.left));
  const right = Math.max(...rects.map((rect) => rect.right));
  const top = Math.min(...rects.map((rect) => rect.top));
  const bottom = Math.max(...rects.map((rect) => rect.bottom));
  return {
    left,
    right,
    top,
    bottom,
    width: right - left,
    height: bottom - top,
  };
}

function findTransferOrigin(
  targetProject: Project,
  blockSize: { width: number; height: number }
): { x: number; y: number } {
  if (targetProject.nodes.length === 0) {
    return DEFAULT_TRANSFER_ORIGIN;
  }

  const targetNodeMap = buildNodeMap(targetProject.nodes);
  const nodeRects = targetProject.nodes.map((node) => getCanvasNodeRect(node, targetNodeMap));
  const maxRight = nodeRects.reduce((max, rect) => Math.max(max, rect.right), DEFAULT_TRANSFER_ORIGIN.x);
  const minTop = nodeRects.reduce((min, rect) => Math.min(min, rect.top), DEFAULT_TRANSFER_ORIGIN.y);
  const viewportCenter = resolveViewportCanvasCenter(targetProject.viewport);

  const candidates: Array<{ x: number; y: number }> = [
    {
      x: Math.round(maxRight + TRANSFER_SCAN_GAP),
      y: Math.round(viewportCenter.y - blockSize.height / 2),
    },
    {
      x: Math.round(viewportCenter.x - blockSize.width / 2),
      y: Math.round(viewportCenter.y + TRANSFER_SCAN_GAP),
    },
    {
      x: DEFAULT_TRANSFER_ORIGIN.x,
      y: minTop,
    },
  ];

  const isFree = (x: number, y: number) => {
    const candidateRect = createCanvasRect(x, y, blockSize.width, blockSize.height);
    return !nodeRects.some((rect) => rectIntersects(candidateRect, rect, TRANSFER_COLLISION_MARGIN));
  };

  for (const candidate of candidates) {
    if (isFree(candidate.x, candidate.y)) {
      return candidate;
    }
  }

  for (let col = 0; col < 18; col += 1) {
    for (let row = 0; row < 18; row += 1) {
      const x = DEFAULT_TRANSFER_ORIGIN.x + col * (blockSize.width + TRANSFER_SCAN_GAP);
      const y = DEFAULT_TRANSFER_ORIGIN.y + row * (blockSize.height + TRANSFER_SCAN_GAP);
      if (isFree(x, y)) {
        return { x, y };
      }
    }
  }

  return {
    x: Math.round(maxRight + TRANSFER_SCAN_GAP),
    y: Math.max(DEFAULT_TRANSFER_ORIGIN.y, Math.round(viewportCenter.y - blockSize.height / 2)),
  };
}

function resolveViewportCanvasCenter(viewport: Project['viewport'] | undefined): { x: number; y: number } {
  const viewportState = viewport ?? DEFAULT_VIEWPORT;
  const { canvasViewportSize } = useCanvasStore.getState();
  const width = canvasViewportSize.width > 0 ? canvasViewportSize.width : FALLBACK_VIEWPORT_WIDTH;
  const height = canvasViewportSize.height > 0 ? canvasViewportSize.height : FALLBACK_VIEWPORT_HEIGHT;
  const zoom = Math.max(0.01, viewportState.zoom || 1);

  return {
    x: (-viewportState.x + width / 2) / zoom,
    y: (-viewportState.y + height / 2) / zoom,
  };
}

function buildFocusViewport(bounds: CanvasRect): Project['viewport'] {
  const { canvasViewportSize } = useCanvasStore.getState();
  const viewportWidth = canvasViewportSize.width > 0 ? canvasViewportSize.width : FALLBACK_VIEWPORT_WIDTH;
  const viewportHeight = canvasViewportSize.height > 0 ? canvasViewportSize.height : FALLBACK_VIEWPORT_HEIGHT;
  const zoom = Math.max(
    0.45,
    Math.min(
      1,
      Math.min(
        viewportWidth / Math.max(bounds.width + 220, 1),
        viewportHeight / Math.max(bounds.height + 180, 1),
      )
    )
  );
  const centerX = bounds.left + bounds.width / 2;
  const centerY = bounds.top + bounds.height / 2;

  return {
    x: Math.round(-centerX * zoom + viewportWidth / 2),
    y: Math.round(-centerY * zoom + viewportHeight / 2),
    zoom: Number(zoom.toFixed(4)),
  };
}

function buildSelectionCopyBlock(
  sourceNodeIds: string[],
  sourceNodes: CanvasNode[],
  sourceEdges: CanvasEdge[],
  targetProject: Project
): SelectionCopyBlock {
  const transferNodeIds = collectTransferNodeIds(sourceNodeIds, sourceNodes);
  if (transferNodeIds.length === 0) {
    throw new Error(i18n.t('project.canvasSelectionTransfer.errors.noNodes'));
  }

  const sourceNodeMap = buildNodeMap(sourceNodes);
  const transferNodeIdSet = new Set(transferNodeIds);
  const selectedNodes = transferNodeIds
    .map((nodeId) => sourceNodeMap.get(nodeId))
    .filter((node): node is CanvasNode => Boolean(node));
  const sourceBounds = resolveCopyBounds(selectedNodes, sourceNodeMap);
  const origin = findTransferOrigin(targetProject, sourceBounds);
  const idMap = new Map<string, string>();
  transferNodeIds.forEach((nodeId) => idMap.set(nodeId, uuidv4()));

  const copiedNodes = selectedNodes.map((node) => {
    const nextId = idMap.get(node.id) ?? uuidv4();
    const absolutePosition = resolveAbsoluteCanvasNodePosition(node, sourceNodeMap);
    const copiedParentId =
      node.parentId && idMap.has(node.parentId) ? idMap.get(node.parentId) : undefined;
    const position = copiedParentId
      ? node.position
      : {
          x: Math.round(origin.x + absolutePosition.x - sourceBounds.left),
          y: Math.round(origin.y + absolutePosition.y - sourceBounds.top),
        };

    return {
      ...clonePersistentCanvasNode(node),
      id: nextId,
      parentId: copiedParentId,
      selected: false,
      dragging: false,
      position: {
        x: Math.round(position.x),
        y: Math.round(position.y),
      },
    };
  });

  const copiedEdges = sourceEdges
    .filter((edge) => transferNodeIdSet.has(edge.source) && transferNodeIdSet.has(edge.target))
    .map((edge) => ({
      ...clonePersistentCanvasEdge(edge),
      id: uuidv4(),
      source: idMap.get(edge.source) ?? edge.source,
      target: idMap.get(edge.target) ?? edge.target,
    }));

  const copiedNodeMap = buildNodeMap(copiedNodes);
  const copiedBounds = resolveCopyBounds(copiedNodes, copiedNodeMap);
  const sizeFallback = getCanvasNodeSize(copiedNodes[0]);
  const bounds = Number.isFinite(copiedBounds.left)
    ? copiedBounds
    : createCanvasRect(origin.x, origin.y, sizeFallback.width, sizeFallback.height);

  return {
    nodes: copiedNodes,
    edges: copiedEdges,
    bounds,
  };
}

function toCandidate(summary: ProjectSummary): CanvasTransferProjectCandidate {
  return {
    id: summary.id,
    name: summary.name,
    updatedAt: summary.updatedAt,
    nodeCount: summary.nodeCount,
  };
}

export function rankCanvasTransferProjectCandidates(): CanvasTransferProjectCandidate[] {
  const projectStore = useProjectStore.getState();
  const currentProject = projectStore.getCurrentProject();
  if (!currentProject) {
    return [];
  }

  return projectStore.projects
    .filter((project) => (
      project.id !== currentProject.id
      && project.projectType === currentProject.projectType
    ))
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .map(toCandidate);
}

function createEmptyTargetProject(sourceProject: Project, projectId: string, projectName: string): Project {
  const now = Date.now();
  return {
    id: projectId,
    name: projectName,
    projectType: sourceProject.projectType,
    assetLibraryId: sourceProject.assetLibraryId ?? null,
    clipLibraryId: sourceProject.clipLibraryId ?? null,
    clipLastFolderId: sourceProject.clipLastFolderId ?? null,
    linkedScriptProjectId: sourceProject.linkedScriptProjectId ?? null,
    linkedAdProjectId: sourceProject.linkedAdProjectId ?? null,
    createdAt: now,
    updatedAt: now,
    nodeCount: 0,
    nodes: [],
    edges: [],
    viewport: DEFAULT_VIEWPORT,
    history: createEmptyHistory(),
    colorLabels: sourceProject.colorLabels ?? createDefaultCanvasColorLabelMap(),
    scriptWelcomeSkipped: sourceProject.scriptWelcomeSkipped ?? false,
  };
}

async function resolveTargetProject(
  sourceProject: Project,
  targetProjectId?: string | null,
  newProjectName?: string | null
): Promise<Project> {
  if (targetProjectId) {
    if (targetProjectId === sourceProject.id) {
      throw new Error(i18n.t('project.canvasSelectionTransfer.errors.sameProject'));
    }

    const record = await getProjectRecord(targetProjectId);
    if (!record) {
      throw new Error(i18n.t('project.canvasSelectionTransfer.errors.targetProjectMissing'));
    }

    const targetProject = fromProjectRecord(record);
    if (targetProject.projectType !== sourceProject.projectType) {
      throw new Error(i18n.t('project.canvasSelectionTransfer.errors.typeMismatch'));
    }
    return targetProject;
  }

  const nextProjectName =
    normalizeText(newProjectName)
    || i18n.t('project.canvasSelectionTransfer.defaultProjectName', {
      source: sourceProject.name,
    });
  const targetProject = createEmptyTargetProject(
    sourceProject,
    uuidv4(),
    nextProjectName
  );

  return {
    ...targetProject,
    assetLibraryId: sourceProject.assetLibraryId ?? null,
    clipLibraryId: sourceProject.clipLibraryId ?? null,
    clipLastFolderId: sourceProject.clipLastFolderId ?? null,
    linkedScriptProjectId: sourceProject.linkedScriptProjectId ?? null,
    linkedAdProjectId: sourceProject.linkedAdProjectId ?? null,
    colorLabels: sourceProject.colorLabels ?? createDefaultCanvasColorLabelMap(),
    scriptWelcomeSkipped: sourceProject.scriptWelcomeSkipped ?? false,
  };
}

export async function transferCanvasSelectionToProject(
  input: TransferCanvasSelectionInput
): Promise<TransferCanvasSelectionResult> {
  const projectStore = useProjectStore.getState();
  const sourceProject = projectStore.getCurrentProject();
  if (!sourceProject) {
    throw new Error(i18n.t('project.canvasSelectionTransfer.errors.noSourceProject'));
  }

  const canvasState = useCanvasStore.getState();
  const sourceNodes = canvasState.nodes;
  const sourceEdges = canvasState.edges;
  await projectStore.flushCurrentProjectToDisk();

  const targetProject = await resolveTargetProject(
    sourceProject,
    input.targetProjectId,
    input.newProjectName
  );
  const copiedBlock = buildSelectionCopyBlock(
    input.sourceNodeIds,
    sourceNodes,
    sourceEdges,
    targetProject
  );
  const nextProject: Project = {
    ...targetProject,
    nodes: [
      ...targetProject.nodes.map((node) => ({
        ...clonePersistentCanvasNode(node),
        selected: false,
        dragging: false,
      })),
      ...copiedBlock.nodes,
    ],
    edges: [
      ...targetProject.edges.map((edge) => clonePersistentCanvasEdge(edge)),
      ...copiedBlock.edges,
    ],
    viewport: buildFocusViewport(copiedBlock.bounds),
    history: createEmptyHistory(),
    nodeCount: targetProject.nodes.length + copiedBlock.nodes.length,
    updatedAt: Date.now(),
  };

  await upsertProjectGraphSnapshot(toProjectRecord(nextProject));
  await projectStore.refreshProjectSummaries();
  projectStore.openProject(nextProject.id);

  return {
    projectId: nextProject.id,
    nodeCount: copiedBlock.nodes.length,
  };
}
