import type { Node } from '@xyflow/react';

export interface AlignmentGuide {
  type: 'horizontal' | 'vertical';
  position: number;
  style: 'top' | 'center' | 'bottom' | 'left' | 'middle' | 'right';
}

interface NodeBounds {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  top: number;
  bottom: number;
  left: number;
  right: number;
  centerX: number;
  centerY: number;
}

export interface AlignmentResult {
  guide: AlignmentGuide;
  snapOffset: { x: number; y: number };
}

const DEFAULT_THRESHOLD = 10;

export function detectAlignments(
  draggedNode: Node,
  otherNodes: Node[],
  threshold: number = DEFAULT_THRESHOLD
): AlignmentResult[] {
  const draggedBounds = getNodeBounds(draggedNode);
  const alignments: AlignmentResult[] = [];

  for (const otherNode of otherNodes) {
    if (otherNode.id === draggedNode.id) continue;

    const otherBounds = getNodeBounds(otherNode);

    // 检测水平对齐（y轴方向）
    // 顶部对齐
    if (Math.abs(draggedBounds.top - otherBounds.top) < threshold) {
      alignments.push({
        guide: { type: 'horizontal', position: otherBounds.top, style: 'top' },
        snapOffset: { x: 0, y: otherBounds.top - draggedBounds.top },
      });
    }
    // 底部对齐
    if (Math.abs(draggedBounds.bottom - otherBounds.bottom) < threshold) {
      alignments.push({
        guide: { type: 'horizontal', position: otherBounds.bottom, style: 'bottom' },
        snapOffset: { x: 0, y: otherBounds.bottom - draggedBounds.bottom },
      });
    }

    // 检测垂直对齐（x轴方向）
    // 左对齐
    if (Math.abs(draggedBounds.left - otherBounds.left) < threshold) {
      alignments.push({
        guide: { type: 'vertical', position: otherBounds.left, style: 'left' },
        snapOffset: { x: otherBounds.left - draggedBounds.left, y: 0 },
      });
    }
    // 右对齐
    if (Math.abs(draggedBounds.right - otherBounds.right) < threshold) {
      alignments.push({
        guide: { type: 'vertical', position: otherBounds.right, style: 'right' },
        snapOffset: { x: otherBounds.right - draggedBounds.right, y: 0 },
      });
    }
  }

  return alignments;
}

function getNodeBounds(node: Node): NodeBounds {
  const width = node.measured?.width ?? node.width ?? 200;
  const height = node.measured?.height ?? node.height ?? 100;
  const x = node.position.x;
  const y = node.position.y;
  
  return {
    id: node.id,
    x,
    y,
    width,
    height,
    top: y,
    bottom: y + height,
    left: x,
    right: x + width,
    centerX: x + width / 2,
    centerY: y + height / 2,
  };
}
