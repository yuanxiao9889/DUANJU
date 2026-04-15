import {
  CANVAS_NODE_TYPES,
  type CanvasNode,
} from '@/features/canvas/domain/canvasNodes';

export const SCRIPT_ASSET_REFERENCE_OPTIMIZED_PROMPT_MAX_LENGTH = 1000;

const SCRIPT_ASSET_REFERENCE_NODE_TYPES = new Set<CanvasNode['type']>([
  CANVAS_NODE_TYPES.scriptCharacterReference,
  CANVAS_NODE_TYPES.scriptLocationReference,
  CANVAS_NODE_TYPES.scriptItemReference,
]);

export function isScriptAssetReferenceNode(
  node: Pick<CanvasNode, 'type'> | null | undefined
): boolean {
  return Boolean(node && SCRIPT_ASSET_REFERENCE_NODE_TYPES.has(node.type));
}

export function resolveScriptAssetOptimizedPromptMaxLength(
  nodes: ReadonlyArray<Pick<CanvasNode, 'type'> | null | undefined>
): number | undefined {
  return nodes.some((node) => isScriptAssetReferenceNode(node))
    ? SCRIPT_ASSET_REFERENCE_OPTIMIZED_PROMPT_MAX_LENGTH
    : undefined;
}
