import type { CSSProperties } from 'react';

import {
  CANVAS_NODE_TYPES,
  type CanvasNode,
} from '@/features/canvas/domain/canvasNodes';
import {
  CANVAS_SEMANTIC_COLOR_VISUALS,
  isCanvasSemanticColor,
} from '@/features/canvas/domain/semanticColors';

const SELECTED_RING_SHADOW = '0 0 0 3px rgba(59, 130, 246, 0.28)';

type SemanticNodeStyle = CSSProperties & {
  '--canvas-semantic-border-color'?: string;
  '--canvas-semantic-glow-shadow'?: string;
  '--canvas-semantic-selected-shadow'?: string;
};

function joinClassNames(...classNames: Array<string | undefined>): string | undefined {
  const normalized = classNames
    .flatMap((className) => (className ?? '').split(/\s+/))
    .filter(Boolean);

  return normalized.length > 0 ? Array.from(new Set(normalized)).join(' ') : undefined;
}

export function nodeHasVisualError(node: CanvasNode): boolean {
  const data = node.data as Record<string, unknown>;

  return ['generationError', 'lastError'].some((key) => {
    const value = data[key];
    return typeof value === 'string' && value.trim().length > 0;
  });
}

export function resolveSemanticNodeWrapperStyle(node: CanvasNode): SemanticNodeStyle | undefined {
  if (node.type === CANVAS_NODE_TYPES.group || nodeHasVisualError(node)) {
    return undefined;
  }

  const semanticColor = (node.data as { semanticColor?: unknown }).semanticColor;
  if (!isCanvasSemanticColor(semanticColor)) {
    return undefined;
  }

  const visual = CANVAS_SEMANTIC_COLOR_VISUALS[semanticColor];

  return {
    ...(node.style ?? {}),
    '--canvas-semantic-border-color': visual.borderColor,
    '--canvas-semantic-glow-shadow': visual.glowShadow,
    '--canvas-semantic-selected-shadow': node.selected ? SELECTED_RING_SHADOW : '0 0 0 0 transparent',
  };
}

export function withSemanticNodePresentation(node: CanvasNode): CanvasNode {
  const semanticStyle = resolveSemanticNodeWrapperStyle(node);
  if (!semanticStyle) {
    return node;
  }

  return {
    ...node,
    className: joinClassNames(node.className, 'canvas-semantic-node'),
    style: semanticStyle,
  };
}
