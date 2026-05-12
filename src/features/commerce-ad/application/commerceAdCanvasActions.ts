import {
  CANVAS_NODE_TYPES,
  type CanvasNode,
  type CanvasNodeData,
  type CommerceBatchGenerateNodeData,
  type CommerceBriefNodeData,
  type CommerceProductNodeData,
  type CommerceResultGroupNodeData,
} from '@/features/canvas/domain/canvasNodes';
import type { CommerceAdAgentAction } from '@/features/commerce-ad/types';

const STAGE_LAYOUT = {
  product: { x: 0, y: 0 },
  brief: { x: 420, y: 0 },
  batch: { x: 840, y: 0 },
  results: { x: 1260, y: 0 },
} as const;

export interface CommerceAdCanvasActionsContext {
  getNodes: () => CanvasNode[];
  addNode: (
    type: CanvasNode['type'],
    position: { x: number; y: number },
    data?: Partial<CanvasNodeData>
  ) => string;
  updateNodeData: (nodeId: string, data: Partial<CanvasNodeData>) => void;
  addEdge: (source: string, target: string) => string | null;
  setSelectedNode: (nodeId: string | null) => void;
  setCenter?: (x: number, y: number, options?: { zoom?: number; duration?: number }) => void;
}

function findNode(nodes: CanvasNode[], type: CanvasNode['type']): CanvasNode | null {
  return nodes.find((node) => node.type === type) ?? null;
}

function ensureStageNode(
  context: CommerceAdCanvasActionsContext,
  type: CanvasNode['type'],
  position: { x: number; y: number },
  data: Partial<CanvasNodeData>
): string {
  const existing = findNode(context.getNodes(), type);
  if (existing) {
    context.updateNodeData(existing.id, data);
    return existing.id;
  }

  return context.addNode(type, position, data);
}

function ensureEdge(context: CommerceAdCanvasActionsContext, sourceId: string | null, targetId: string | null): void {
  if (!sourceId || !targetId) {
    return;
  }
  context.addEdge(sourceId, targetId);
}

export function applyCommerceAdAgentActions(
  actions: CommerceAdAgentAction[],
  context: CommerceAdCanvasActionsContext
): string | null {
  let productId = findNode(context.getNodes(), CANVAS_NODE_TYPES.commerceProduct)?.id ?? null;
  let briefId = findNode(context.getNodes(), CANVAS_NODE_TYPES.commerceBrief)?.id ?? null;
  let batchId = findNode(context.getNodes(), CANVAS_NODE_TYPES.commerceBatchGenerate)?.id ?? null;
  let resultId = findNode(context.getNodes(), CANVAS_NODE_TYPES.commerceResultGroup)?.id ?? null;
  let lastTouchedId: string | null = null;

  for (const action of actions) {
    if (action.type === 'upsertProduct') {
      productId = ensureStageNode(
        context,
        CANVAS_NODE_TYPES.commerceProduct,
        STAGE_LAYOUT.product,
        action.data as Partial<CommerceProductNodeData>
      );
      lastTouchedId = productId;
    }

    if (action.type === 'upsertBrief') {
      briefId = ensureStageNode(
        context,
        CANVAS_NODE_TYPES.commerceBrief,
        STAGE_LAYOUT.brief,
        action.data as Partial<CommerceBriefNodeData>
      );
      ensureEdge(context, productId, briefId);
      lastTouchedId = briefId;
    }

    if (action.type === 'upsertBatchGenerate') {
      batchId = ensureStageNode(
        context,
        CANVAS_NODE_TYPES.commerceBatchGenerate,
        STAGE_LAYOUT.batch,
        action.data as Partial<CommerceBatchGenerateNodeData>
      );
      ensureEdge(context, productId, briefId);
      ensureEdge(context, briefId, batchId);
      lastTouchedId = batchId;
    }

    if (action.type === 'upsertResultGroup') {
      resultId = ensureStageNode(
        context,
        CANVAS_NODE_TYPES.commerceResultGroup,
        STAGE_LAYOUT.results,
        action.data as Partial<CommerceResultGroupNodeData>
      );
      ensureEdge(context, briefId, batchId);
      ensureEdge(context, batchId, resultId);
      lastTouchedId = resultId;
    }
  }

  if (lastTouchedId) {
    context.setSelectedNode(lastTouchedId);
    const node = context.getNodes().find((item) => item.id === lastTouchedId);
    if (node && context.setCenter) {
      context.setCenter(node.position.x + 180, node.position.y + 180, {
        zoom: 0.9,
        duration: 260,
      });
    }
  }

  return lastTouchedId;
}
