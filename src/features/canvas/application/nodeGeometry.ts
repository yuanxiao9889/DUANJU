import {
  DEFAULT_NODE_WIDTH,
  type CanvasNode,
} from "@/features/canvas/domain/canvasNodes";

export function getCanvasNodeSize(
  node: CanvasNode,
): { width: number; height: number } {
  const styleWidth =
    typeof node.style?.width === "number" ? node.style.width : null;
  const styleHeight =
    typeof node.style?.height === "number" ? node.style.height : null;

  return {
    width:
      node.measured?.width ??
      (typeof node.width === "number" ? node.width : null) ??
      styleWidth ??
      DEFAULT_NODE_WIDTH,
    height:
      node.measured?.height ??
      (typeof node.height === "number" ? node.height : null) ??
      styleHeight ??
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
