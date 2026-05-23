import {
  DEFAULT_NODE_WIDTH,
  type CanvasNode,
} from "@/features/canvas/domain/canvasNodes";

export interface CanvasRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
}

export interface CanvasPoint {
  x: number;
  y: number;
}

export function getCanvasNodeSize(
  node: CanvasNode,
): { width: number; height: number } {
  const styleWidth =
    typeof node.style?.width === "number" ? node.style.width : null;
  const styleHeight =
    typeof node.style?.height === "number" ? node.style.height : null;
  const explicitWidth = typeof node.width === "number" ? node.width : null;
  const explicitHeight = typeof node.height === "number" ? node.height : null;

  return {
    width:
      explicitWidth ??
      styleWidth ??
      node.measured?.width ??
      DEFAULT_NODE_WIDTH,
    height:
      explicitHeight ??
      styleHeight ??
      node.measured?.height ??
      200,
  };
}

export function resolveAbsoluteCanvasNodePosition(
  node: CanvasNode,
  nodeMap: Map<string, CanvasNode>,
): { x: number; y: number } {
  let x = node.position.x;
  let y = node.position.y;
  let currentParentId = node.parentId;
  const visited = new Set<string>();

  while (currentParentId && !visited.has(currentParentId)) {
    visited.add(currentParentId);
    const parentNode = nodeMap.get(currentParentId);
    if (!parentNode) {
      break;
    }

    x += parentNode.position.x;
    y += parentNode.position.y;
    currentParentId = parentNode.parentId;
  }

  return { x, y };
}

export function createCanvasRect(
  x: number,
  y: number,
  width: number,
  height: number,
): CanvasRect {
  return {
    left: x,
    right: x + width,
    top: y,
    bottom: y + height,
    width,
    height,
  };
}

export function normalizeRect(
  start: CanvasPoint,
  end: CanvasPoint,
): CanvasRect {
  const left = Math.min(start.x, end.x);
  const right = Math.max(start.x, end.x);
  const top = Math.min(start.y, end.y);
  const bottom = Math.max(start.y, end.y);

  return {
    left,
    right,
    top,
    bottom,
    width: right - left,
    height: bottom - top,
  };
}

export function getCanvasNodeRect(
  node: CanvasNode,
  nodeMap: Map<string, CanvasNode>,
): CanvasRect {
  const position = resolveAbsoluteCanvasNodePosition(node, nodeMap);
  const size = getCanvasNodeSize(node);
  return createCanvasRect(position.x, position.y, size.width, size.height);
}

export function rectIntersects(
  left: CanvasRect,
  right: CanvasRect,
  margin = 0,
): boolean {
  return (
    left.left < right.right + margin &&
    left.right + margin > right.left &&
    left.top < right.bottom + margin &&
    left.bottom + margin > right.top
  );
}

export function rectContains(
  container: CanvasRect,
  target: CanvasRect,
  margin = 0,
): boolean {
  return (
    container.left - margin <= target.left &&
    container.right + margin >= target.right &&
    container.top - margin <= target.top &&
    container.bottom + margin >= target.bottom
  );
}
