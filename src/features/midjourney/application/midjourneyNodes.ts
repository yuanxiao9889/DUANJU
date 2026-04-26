import type {
  CanvasNode,
  MjActionButton,
  MjReferenceItem,
  MjResultBatch,
  MjResultNodeData,
} from '@/features/canvas/domain/canvasNodes';
import {
  CANVAS_NODE_TYPES,
  MJ_RESULT_NODE_DEFAULT_HEIGHT,
  MJ_RESULT_NODE_DEFAULT_WIDTH,
  isMjResultNode,
} from '@/features/canvas/domain/canvasNodes';
import type { ConnectedReferenceImage } from '@/features/canvas/application/connectedReferenceImages';

export function buildSyncedMjReferences(
  connectedImages: ConnectedReferenceImage[],
  existingReferences: MjReferenceItem[]
): MjReferenceItem[] {
  const existingByImageUrl = new Map(
    existingReferences.map((item) => [item.imageUrl.trim(), item] as const)
  );

  return connectedImages.map((item, index) => {
    const existing = existingByImageUrl.get(item.imageUrl.trim());
    return {
      imageUrl: item.imageUrl.trim(),
      sourceNodeId: item.sourceNodeId,
      sourceEdgeId: item.sourceEdgeId,
      role: existing?.role ?? 'reference',
      sortIndex: index,
    } satisfies MjReferenceItem;
  });
}

export function areMjReferencesEqual(
  left: MjReferenceItem[],
  right: MjReferenceItem[]
): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((item, index) => {
    const candidate = right[index];
    return Boolean(
      candidate
      && candidate.imageUrl === item.imageUrl
      && candidate.sourceNodeId === item.sourceNodeId
      && candidate.sourceEdgeId === item.sourceEdgeId
      && candidate.role === item.role
      && candidate.sortIndex === item.sortIndex
    );
  });
}

export function findLinkedMjResultNode(
  nodes: CanvasNode[],
  linkedResultNodeId: string | null | undefined
): CanvasNode | null {
  const normalizedId = linkedResultNodeId?.trim() ?? '';
  if (!normalizedId) {
    return null;
  }

  const matchedNode = nodes.find((node) => node.id === normalizedId) ?? null;
  return matchedNode && isMjResultNode(matchedNode) ? matchedNode : null;
}

export function appendMjResultBatch(
  data: MjResultNodeData,
  batch: MjResultBatch
): MjResultNodeData {
  return {
    ...data,
    batches: [batch, ...data.batches],
    activeBatchId: batch.id,
    lastError: null,
  };
}

export function updateMjResultBatch(
  data: MjResultNodeData,
  batchId: string,
  updater: (batch: MjResultBatch) => MjResultBatch
): MjResultNodeData {
  let changed = false;
  const batches = data.batches.map((batch) => {
    if (batch.id !== batchId) {
      return batch;
    }

    changed = true;
    return updater(batch);
  });

  return changed
    ? {
      ...data,
      batches,
    }
    : data;
}

export function hasMjResultPendingBatch(data: MjResultNodeData): boolean {
  return data.batches.some((batch) => batch.isPolling);
}

export function createRootMjResultNodeData(
  sourceNodeId: string,
  displayName: string
): MjResultNodeData {
  return {
    sourceNodeId,
    nodeRole: 'root',
    rootSourceNodeId: sourceNodeId,
    parentResultNodeId: null,
    parentBatchId: null,
    sourceImageIndex: null,
    branchKey: null,
    branchActionLabel: null,
    displayName,
    batches: [],
    activeBatchId: null,
    lastError: null,
    lastGeneratedAt: null,
  };
}

export function buildMidjourneyBranchKey(payload: {
  parentResultNodeId: string;
  parentBatchId: string;
  sourceImageIndex?: number | null;
  actionKey: string;
}): string {
  return [
    payload.parentResultNodeId.trim(),
    payload.parentBatchId.trim(),
    Number.isFinite(payload.sourceImageIndex) ? `img-${Number(payload.sourceImageIndex)}` : 'batch',
    payload.actionKey.trim(),
  ].join('::');
}

export function buildMidjourneyBranchNodeTitle(
  actionLabel: string,
  sourceImageIndex?: number | null
): string {
  const normalizedLabel = actionLabel.trim() || 'MJ Branch';
  if (Number.isFinite(sourceImageIndex)) {
    return `${normalizedLabel} · 图${Number(sourceImageIndex) + 1}`;
  }
  return normalizedLabel;
}

export function createBranchMjResultNodeData(payload: {
  sourceNodeId: string;
  rootSourceNodeId: string | null;
  parentResultNodeId: string;
  parentBatchId: string;
  sourceImageIndex?: number | null;
  branchKey: string;
  branchActionLabel: string;
  displayName?: string;
}): MjResultNodeData {
  return {
    sourceNodeId: payload.sourceNodeId,
    nodeRole: 'branch',
    rootSourceNodeId: payload.rootSourceNodeId,
    parentResultNodeId: payload.parentResultNodeId,
    parentBatchId: payload.parentBatchId,
    sourceImageIndex: Number.isFinite(payload.sourceImageIndex)
      ? Number(payload.sourceImageIndex)
      : null,
    branchKey: payload.branchKey,
    branchActionLabel: payload.branchActionLabel,
    displayName:
      payload.displayName
      || buildMidjourneyBranchNodeTitle(
        payload.branchActionLabel,
        payload.sourceImageIndex ?? null
      ),
    batches: [],
    activeBatchId: null,
    lastError: null,
    lastGeneratedAt: null,
  };
}

export function findMidjourneyBranchResultNode(
  nodes: CanvasNode[],
  branchKey: string
): CanvasNode | null {
  const normalizedBranchKey = branchKey.trim();
  if (!normalizedBranchKey) {
    return null;
  }

  const matchedNode = nodes.find((node) => {
    if (!isMjResultNode(node)) {
      return false;
    }

    return (
      node.data.nodeRole === 'branch'
      && (node.data.branchKey ?? '').trim() === normalizedBranchKey
    );
  }) ?? null;

  return matchedNode;
}

export function resolveMidjourneyRootSourceNodeId(
  data: MjResultNodeData | null | undefined
): string | null {
  if (!data) {
    return null;
  }

  if (data.nodeRole === 'branch') {
    const rootSourceNodeId = data.rootSourceNodeId?.trim() ?? '';
    return rootSourceNodeId || null;
  }

  const sourceNodeId = data.sourceNodeId?.trim() ?? '';
  return sourceNodeId || null;
}

export function ensureMidjourneyBranchResultNode(payload: {
  nodes: CanvasNode[];
  addNode: (
    type: typeof CANVAS_NODE_TYPES.mjResult,
    position: { x: number; y: number },
    data?: Partial<MjResultNodeData>,
    options?: { inheritParentFromNodeId?: string }
  ) => string;
  addEdge: (source: string, target: string) => string | null;
  findNodePosition: (
    sourceNodeId: string,
    newNodeWidth: number,
    newNodeHeight: number
  ) => { x: number; y: number };
  sourceResultNodeId: string;
  sourceResultData: MjResultNodeData;
  parentBatchId: string;
  sourceImageIndex?: number | null;
  button: Pick<MjActionButton, 'actionKey' | 'label'>;
}): {
  nodeId: string;
  created: boolean;
  branchKey: string;
} {
  const branchKey = buildMidjourneyBranchKey({
    parentResultNodeId: payload.sourceResultNodeId,
    parentBatchId: payload.parentBatchId,
    sourceImageIndex: payload.sourceImageIndex,
    actionKey: payload.button.actionKey,
  });

  const existingNode = findMidjourneyBranchResultNode(payload.nodes, branchKey);
  if (existingNode) {
    payload.addEdge(payload.sourceResultNodeId, existingNode.id);
    return {
      nodeId: existingNode.id,
      created: false,
      branchKey,
    };
  }

  const position = payload.findNodePosition(
    payload.sourceResultNodeId,
    MJ_RESULT_NODE_DEFAULT_WIDTH,
    MJ_RESULT_NODE_DEFAULT_HEIGHT
  );
  const nodeId = payload.addNode(
    CANVAS_NODE_TYPES.mjResult,
    position,
    createBranchMjResultNodeData({
      sourceNodeId: payload.sourceResultNodeId,
      rootSourceNodeId: resolveMidjourneyRootSourceNodeId(payload.sourceResultData),
      parentResultNodeId: payload.sourceResultNodeId,
      parentBatchId: payload.parentBatchId,
      sourceImageIndex: payload.sourceImageIndex,
      branchKey,
      branchActionLabel: payload.button.label,
    }),
    { inheritParentFromNodeId: payload.sourceResultNodeId }
  );
  payload.addEdge(payload.sourceResultNodeId, nodeId);

  return {
    nodeId,
    created: true,
    branchKey,
  };
}

export function isMjNodeType(type: string): boolean {
  return type === CANVAS_NODE_TYPES.mj;
}
