import { canvasEventBus } from '@/features/canvas/application/canvasServices';
import {
  CANVAS_NODE_TYPES,
  createEmptyAssetBatchQueueState,
  type CanvasNode,
  type GroupNodeData,
} from '@/features/canvas/domain/canvasNodes';
import { useCanvasStore } from '@/stores/canvasStore';

const runningGroupIds = new Set<string>();

function resolveGroupNode(groupNodeId: string): (CanvasNode & { data: GroupNodeData }) | null {
  const node = useCanvasStore.getState().nodes.find(
    (entry): entry is CanvasNode & { data: GroupNodeData } =>
      entry.id === groupNodeId && entry.type === CANVAS_NODE_TYPES.group
  );

  return node ?? null;
}

function updateGroupQueueState(
  groupNodeId: string,
  queueState: Partial<NonNullable<GroupNodeData['queueState']>>
): void {
  const groupNode = resolveGroupNode(groupNodeId);
  if (!groupNode) {
    return;
  }

  useCanvasStore.getState().updateNodeData(groupNodeId, {
    queueState: {
      ...(groupNode.data.queueState ?? createEmptyAssetBatchQueueState()),
      ...queueState,
    },
  });
}

function publishNodeAction(
  type: 'image-edit/submit-generate' | 'image-edit/optimize-prompt',
  nodeId: string
): Promise<{ ok: boolean; error?: string | null }> {
  return new Promise((resolve) => {
    canvasEventBus.publish(type, {
      nodeId,
      onSettled: resolve,
    });
  });
}

export async function submitImageEditGeneration(
  nodeId: string
): Promise<{ ok: boolean; error?: string | null }> {
  return publishNodeAction('image-edit/submit-generate', nodeId);
}

export async function optimizeImageEditPrompt(
  nodeId: string
): Promise<{ ok: boolean; error?: string | null }> {
  return publishNodeAction('image-edit/optimize-prompt', nodeId);
}

function sortBatchChildren(nodes: CanvasNode[]): CanvasNode[] {
  return [...nodes].sort((left, right) => {
    const deltaY = Math.round(left.position.y) - Math.round(right.position.y);
    if (deltaY !== 0) {
      return deltaY;
    }

    const deltaX = Math.round(left.position.x) - Math.round(right.position.x);
    if (deltaX !== 0) {
      return deltaX;
    }

    return left.id.localeCompare(right.id);
  });
}

async function runAssetBatchSequence(
  groupNodeId: string,
  mode: 'generate' | 'optimize'
): Promise<void> {
  const groupNode = resolveGroupNode(groupNodeId);
  if (!groupNode || groupNode.data.visualStyle !== 'assetBatchGroup') {
    return;
  }

  if (runningGroupIds.has(groupNodeId)) {
    return;
  }

  const childNodes = sortBatchChildren(
    useCanvasStore.getState().nodes.filter(
      (node) => node.parentId === groupNodeId && node.type === CANVAS_NODE_TYPES.imageEdit
    )
  );
  const pendingNodeIds = childNodes.map((node) => node.id);
  updateGroupQueueState(groupNodeId, {
    pendingNodeIds,
    runningNodeId: null,
    completedNodeIds: [],
    failedNodeIds: [],
    lastRunAt: Date.now(),
  });

  runningGroupIds.add(groupNodeId);
  const completedNodeIds: string[] = [];
  const failedNodeIds: string[] = [];

  try {
    for (const childNode of childNodes) {
      updateGroupQueueState(groupNodeId, {
        pendingNodeIds: pendingNodeIds.filter((nodeId) => nodeId !== childNode.id),
        runningNodeId: childNode.id,
        completedNodeIds,
        failedNodeIds,
        lastRunAt: Date.now(),
      });

      let nodeFailed = false;
      if (mode === 'optimize') {
        const optimizeResult = await optimizeImageEditPrompt(childNode.id);
        nodeFailed = !optimizeResult.ok;
      } else {
        const generateResult = await submitImageEditGeneration(childNode.id);
        nodeFailed = !generateResult.ok;
      }

      if (nodeFailed) {
        failedNodeIds.push(childNode.id);
      } else {
        completedNodeIds.push(childNode.id);
      }

      updateGroupQueueState(groupNodeId, {
        runningNodeId: null,
        completedNodeIds: [...completedNodeIds],
        failedNodeIds: [...failedNodeIds],
        lastRunAt: Date.now(),
      });
    }
  } finally {
    runningGroupIds.delete(groupNodeId);
    updateGroupQueueState(groupNodeId, {
      pendingNodeIds: [],
      runningNodeId: null,
      completedNodeIds: [...completedNodeIds],
      failedNodeIds: [...failedNodeIds],
      lastRunAt: Date.now(),
    });
  }
}

export async function runAssetBatchGeneration(groupNodeId: string): Promise<void> {
  await runAssetBatchSequence(groupNodeId, 'generate');
}

export async function runAssetBatchPromptOptimization(groupNodeId: string): Promise<void> {
  await runAssetBatchSequence(groupNodeId, 'optimize');
}
