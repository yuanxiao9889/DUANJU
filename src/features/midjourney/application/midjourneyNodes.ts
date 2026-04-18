import type {
  CanvasNode,
  MjReferenceItem,
  MjResultBatch,
  MjResultNodeData,
} from '@/features/canvas/domain/canvasNodes';
import {
  CANVAS_NODE_TYPES,
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

export function isMjNodeType(type: string): boolean {
  return type === CANVAS_NODE_TYPES.mj;
}
