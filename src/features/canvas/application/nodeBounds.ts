import type { Node } from '@xyflow/react';

export interface NodeBounds {
  left: number;
  right: number;
  top: number;
  bottom: number;
  centerX: number;
  centerY: number;
  width: number;
  height: number;
}

export function calculateNodesBounds(nodes: Node[]): NodeBounds {
  if (nodes.length === 0) {
    return { left: 0, right: 0, top: 0, bottom: 0, centerX: 0, centerY: 0, width: 0, height: 0 };
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  for (const node of nodes) {
    const nodeWidth = node.width ?? node.measured?.width ?? 200;
    const nodeHeight = node.height ?? node.measured?.height ?? 100;
    minX = Math.min(minX, node.position.x);
    maxX = Math.max(maxX, node.position.x + nodeWidth);
    minY = Math.min(minY, node.position.y);
    maxY = Math.max(maxY, node.position.y + nodeHeight);
  }

  return {
    left: minX,
    right: maxX,
    top: minY,
    bottom: maxY,
    centerX: (minX + maxX) / 2,
    centerY: (minY + maxY) / 2,
    width: maxX - minX,
    height: maxY - minY
  };
}

export function getMergedAnchorPosition(nodes: Node[], side: 'left' | 'right' | 'top' | 'bottom' = 'right'): { x: number; y: number } | null {
  if (nodes.length === 0) return null;
  
  const bounds = calculateNodesBounds(nodes);
  const offset = 20;

  switch (side) {
    case 'right':
      return { x: bounds.right + offset, y: bounds.centerY };
    case 'left':
      return { x: bounds.left - offset, y: bounds.centerY };
    case 'top':
      return { x: bounds.centerX, y: bounds.top - offset };
    case 'bottom':
      return { x: bounds.centerX, y: bounds.bottom + offset };
    default:
      return { x: bounds.right + offset, y: bounds.centerY };
  }
}
