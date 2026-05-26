import {
  CANVAS_NODE_TYPES,
  type CanvasNode,
  type CanvasNodeData,
  type CommerceBatchGenerateNodeData,
  type CommerceBriefNodeData,
  type CommerceProductNodeData,
  type CommerceResultGroupNodeData,
  type CommerceVisualPreferenceNodeData,
} from '@/features/canvas/domain/canvasNodes';
import type { CommerceAdAgentAction } from '@/features/commerce-ad/types';

const STAGE_NODE_GAP = 80;
const STAGE_NODE_FALLBACK_WIDTH = 360;
const STAGE_NODE_ORDER = [
  CANVAS_NODE_TYPES.commerceProduct,
  CANVAS_NODE_TYPES.commerceBrief,
  CANVAS_NODE_TYPES.commerceVisualPreference,
  CANVAS_NODE_TYPES.commerceBatchGenerate,
  CANVAS_NODE_TYPES.commerceResultGroup,
] as const;

export interface CommerceAdCanvasActionsContext {
  getNodes: () => CanvasNode[];
  addNode: (
    type: CanvasNode['type'],
    position: { x: number; y: number },
    data?: Partial<CanvasNodeData>
  ) => string;
  updateNodeData: (nodeId: string, data: Partial<CanvasNodeData>) => void;
  updateNodePosition?: (nodeId: string, position: { x: number; y: number }) => void;
  addEdge: (source: string, target: string) => string | null;
  setSelectedNode: (nodeId: string | null) => void;
  setCenter?: (x: number, y: number, options?: { zoom?: number; duration?: number }) => void;
}

export interface CommerceAdAgentActionOptions {
  focusLastTouched?: boolean;
  alignStageNodes?: boolean;
  targetNodeIds?: Partial<Record<
    'product' | 'brief' | 'visualPreference' | 'batch' | 'result',
    string | null
  >>;
}

function findNode(nodes: CanvasNode[], type: CanvasNode['type']): CanvasNode | null {
  return nodes.find((node) => node.type === type) ?? null;
}

function resolveStageBasePosition(nodes: CanvasNode[]): { x: number; y: number } {
  const stageNodes = [
    findNode(nodes, CANVAS_NODE_TYPES.commerceProduct),
    findNode(nodes, CANVAS_NODE_TYPES.commerceBrief),
    findNode(nodes, CANVAS_NODE_TYPES.commerceVisualPreference),
    findNode(nodes, CANVAS_NODE_TYPES.commerceBatchGenerate),
    findNode(nodes, CANVAS_NODE_TYPES.commerceResultGroup),
  ].filter((node): node is CanvasNode => Boolean(node));

  if (stageNodes.length === 0) {
    return { x: 0, y: 0 };
  }

  return {
    x: Math.min(...stageNodes.map((node) => node.position.x)),
    y: Math.min(...stageNodes.map((node) => node.position.y)),
  };
}

function resolveNodeWidth(node: CanvasNode | null): number {
  if (!node) {
    return STAGE_NODE_FALLBACK_WIDTH;
  }

  const measuredWidth = typeof node.measured?.width === 'number' ? node.measured.width : 0;
  const width = typeof node.width === 'number' ? node.width : 0;
  const styleWidth = typeof node.style?.width === 'number' ? node.style.width : 0;
  return Math.max(measuredWidth, width, styleWidth, STAGE_NODE_FALLBACK_WIDTH);
}

function resolveStagePositions(nodes: CanvasNode[]): Record<(typeof STAGE_NODE_ORDER)[number], { x: number; y: number }> {
  const basePosition = resolveStageBasePosition(nodes);
  let nextX = basePosition.x;
  return STAGE_NODE_ORDER.reduce((positions, type) => {
    const node = findNode(nodes, type);
    positions[type] = { x: nextX, y: basePosition.y };
    nextX += resolveNodeWidth(node) + STAGE_NODE_GAP;
    return positions;
  }, {} as Record<(typeof STAGE_NODE_ORDER)[number], { x: number; y: number }>);
}

function alignExistingStageNodes(
  context: CommerceAdCanvasActionsContext,
  stagePositions: Record<(typeof STAGE_NODE_ORDER)[number], { x: number; y: number }>
): void {
  const { updateNodePosition } = context;
  if (!updateNodePosition) {
    return;
  }

  const nodes = context.getNodes();
  STAGE_NODE_ORDER.forEach((type) => {
    const node = findNode(nodes, type);
    if (!node) {
      return;
    }

    updateNodePosition(node.id, stagePositions[type]);
  });
}

function ensureStageNode(
  context: CommerceAdCanvasActionsContext,
  type: CanvasNode['type'],
  position: { x: number; y: number },
  data: Partial<CanvasNodeData>,
  preferredNodeId?: string | null,
  alignExisting = false
): string {
  const nodes = context.getNodes();
  const existing = preferredNodeId
    ? nodes.find((node) => node.id === preferredNodeId && node.type === type)
    : findNode(nodes, type);
  if (existing) {
    context.updateNodeData(existing.id, data);
    if (alignExisting && context.updateNodePosition) {
      context.updateNodePosition(existing.id, position);
    }
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
  context: CommerceAdCanvasActionsContext,
  options: CommerceAdAgentActionOptions = {}
): string | null {
  const shouldFocusLastTouched = options.focusLastTouched ?? true;
  const shouldAlignStageNodes = options.alignStageNodes ?? false;
  const stagePositions = resolveStagePositions(context.getNodes());
  let productId = findNode(context.getNodes(), CANVAS_NODE_TYPES.commerceProduct)?.id ?? null;
  let briefId = findNode(context.getNodes(), CANVAS_NODE_TYPES.commerceBrief)?.id ?? null;
  let visualPreferenceId = findNode(context.getNodes(), CANVAS_NODE_TYPES.commerceVisualPreference)?.id ?? null;
  let batchId = findNode(context.getNodes(), CANVAS_NODE_TYPES.commerceBatchGenerate)?.id ?? null;
  let resultId = findNode(context.getNodes(), CANVAS_NODE_TYPES.commerceResultGroup)?.id ?? null;
  let lastTouchedId: string | null = null;

  for (const action of actions) {
    if (action.type === 'upsertProduct') {
      productId = ensureStageNode(
        context,
        CANVAS_NODE_TYPES.commerceProduct,
        stagePositions[CANVAS_NODE_TYPES.commerceProduct],
        action.data as Partial<CommerceProductNodeData>,
        options.targetNodeIds?.product,
        shouldAlignStageNodes
      );
      lastTouchedId = productId;
    }

    if (action.type === 'upsertBrief') {
      briefId = ensureStageNode(
        context,
        CANVAS_NODE_TYPES.commerceBrief,
        stagePositions[CANVAS_NODE_TYPES.commerceBrief],
        action.data as Partial<CommerceBriefNodeData>,
        options.targetNodeIds?.brief,
        shouldAlignStageNodes
      );
      ensureEdge(context, productId, briefId);
      lastTouchedId = briefId;
    }

    if (action.type === 'upsertVisualPreference') {
      visualPreferenceId = ensureStageNode(
        context,
        CANVAS_NODE_TYPES.commerceVisualPreference,
        stagePositions[CANVAS_NODE_TYPES.commerceVisualPreference],
        action.data as Partial<CommerceVisualPreferenceNodeData>,
        options.targetNodeIds?.visualPreference,
        shouldAlignStageNodes
      );
      ensureEdge(context, productId, briefId);
      ensureEdge(context, briefId, visualPreferenceId);
      lastTouchedId = visualPreferenceId;
    }

    if (action.type === 'upsertBatchGenerate') {
      batchId = ensureStageNode(
        context,
        CANVAS_NODE_TYPES.commerceBatchGenerate,
        stagePositions[CANVAS_NODE_TYPES.commerceBatchGenerate],
        action.data as Partial<CommerceBatchGenerateNodeData>,
        options.targetNodeIds?.batch,
        shouldAlignStageNodes
      );
      ensureEdge(context, productId, briefId);
      ensureEdge(context, briefId, visualPreferenceId);
      ensureEdge(context, visualPreferenceId ?? briefId, batchId);
      lastTouchedId = batchId;
    }

    if (action.type === 'upsertResultGroup') {
      resultId = ensureStageNode(
        context,
        CANVAS_NODE_TYPES.commerceResultGroup,
        stagePositions[CANVAS_NODE_TYPES.commerceResultGroup],
        action.data as Partial<CommerceResultGroupNodeData>,
        options.targetNodeIds?.result,
        shouldAlignStageNodes
      );
      ensureEdge(context, briefId, visualPreferenceId);
      ensureEdge(context, visualPreferenceId ?? briefId, batchId);
      ensureEdge(context, batchId, resultId);
      lastTouchedId = resultId;
    }
  }

  if (shouldAlignStageNodes) {
    alignExistingStageNodes(context, stagePositions);
  }

  if (lastTouchedId && shouldFocusLastTouched) {
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
