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
  distance: number;
}

interface AlignmentCandidate {
  axis: 'horizontal' | 'vertical';
  style: AlignmentGuide['style'];
  position: number;
  delta: number;
  distance: number;
}

const DEFAULT_THRESHOLD = 10;

export function detectAlignments(
  draggedNode: Node,
  otherNodes: Node[],
  threshold: number = DEFAULT_THRESHOLD
): AlignmentResult[] {
  const draggedBounds = getNodeBounds(draggedNode);
  let bestHorizontal: AlignmentCandidate | null = null;
  let bestVertical: AlignmentCandidate | null = null;

  for (const otherNode of otherNodes) {
    if (otherNode.id === draggedNode.id) {
      continue;
    }

    const otherBounds = getNodeBounds(otherNode);

    const horizontalCandidates: AlignmentCandidate[] = [
      {
        axis: 'horizontal',
        style: 'top',
        position: otherBounds.top,
        delta: otherBounds.top - draggedBounds.top,
        distance: Math.abs(otherBounds.top - draggedBounds.top),
      },
      {
        axis: 'horizontal',
        style: 'center',
        position: otherBounds.centerY,
        delta: otherBounds.centerY - draggedBounds.centerY,
        distance: Math.abs(otherBounds.centerY - draggedBounds.centerY),
      },
      {
        axis: 'horizontal',
        style: 'bottom',
        position: otherBounds.bottom,
        delta: otherBounds.bottom - draggedBounds.bottom,
        distance: Math.abs(otherBounds.bottom - draggedBounds.bottom),
      },
    ];

    const verticalCandidates: AlignmentCandidate[] = [
      {
        axis: 'vertical',
        style: 'left',
        position: otherBounds.left,
        delta: otherBounds.left - draggedBounds.left,
        distance: Math.abs(otherBounds.left - draggedBounds.left),
      },
      {
        axis: 'vertical',
        style: 'middle',
        position: otherBounds.centerX,
        delta: otherBounds.centerX - draggedBounds.centerX,
        distance: Math.abs(otherBounds.centerX - draggedBounds.centerX),
      },
      {
        axis: 'vertical',
        style: 'right',
        position: otherBounds.right,
        delta: otherBounds.right - draggedBounds.right,
        distance: Math.abs(otherBounds.right - draggedBounds.right),
      },
    ];

    bestHorizontal = pickBetterAlignment(bestHorizontal, horizontalCandidates, threshold);
    bestVertical = pickBetterAlignment(bestVertical, verticalCandidates, threshold);
  }

  return [bestHorizontal, bestVertical]
    .filter((candidate): candidate is AlignmentCandidate => candidate !== null)
    .map((candidate) => ({
      guide: {
        type: candidate.axis,
        position: candidate.position,
        style: candidate.style,
      },
      snapOffset: {
        x: candidate.axis === 'vertical' ? candidate.delta : 0,
        y: candidate.axis === 'horizontal' ? candidate.delta : 0,
      },
      distance: candidate.distance,
    }));
}

function pickBetterAlignment(
  current: AlignmentCandidate | null,
  candidates: AlignmentCandidate[],
  threshold: number
): AlignmentCandidate | null {
  let best = current;

  for (const candidate of candidates) {
    if (candidate.distance > threshold) {
      continue;
    }

    if (!best || candidate.distance < best.distance) {
      best = candidate;
      continue;
    }

    if (
      best
      && candidate.distance === best.distance
      && getAlignmentStylePriority(candidate.style) < getAlignmentStylePriority(best.style)
    ) {
      best = candidate;
    }
  }

  return best;
}

function getAlignmentStylePriority(style: AlignmentGuide['style']): number {
  if (style === 'center' || style === 'middle') {
    return 0;
  }
  return 1;
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
