import {
  DEFAULT_NODE_WIDTH,
  type CanvasEdge,
  type CanvasNode,
  type GroupNodeData,
} from '@/features/canvas/domain/canvasNodes';

export type GroupLayoutDirection = NonNullable<GroupNodeData['layoutDirection']>;

export interface GroupLayoutOptions {
  maxItemsPerLine?: number;
  gapX?: number;
  gapY?: number;
  sidePadding?: number;
  topPadding?: number;
  bottomPadding?: number;
  minWidth?: number;
  minHeight?: number;
}

export interface GroupLayoutResult {
  direction: GroupLayoutDirection;
  maxItemsPerLine: number;
  positions: Map<string, { x: number; y: number }>;
  size: { width: number; height: number };
}

export const GROUP_NODE_SIDE_PADDING = 20;
export const GROUP_NODE_TOP_PADDING = 34;
export const GROUP_NODE_BOTTOM_PADDING = 20;
export const DEFAULT_GROUP_LAYOUT_MAX_ITEMS_PER_LINE = 5;

const DEFAULT_GROUP_LAYOUT_GAP_X = 28;
const DEFAULT_GROUP_LAYOUT_GAP_Y = 24;
const GROUP_NODE_MIN_WIDTH = 220;
const GROUP_NODE_MIN_HEIGHT = 140;

function getNodeSize(node: CanvasNode): { width: number; height: number } {
  return {
    width:
      typeof node.measured?.width === 'number'
        ? node.measured.width
        : typeof node.width === 'number'
          ? node.width
          : typeof node.style?.width === 'number'
            ? node.style.width
            : DEFAULT_NODE_WIDTH,
    height:
      typeof node.measured?.height === 'number'
        ? node.measured.height
        : typeof node.height === 'number'
          ? node.height
          : typeof node.style?.height === 'number'
            ? node.style.height
            : 200,
  };
}

function getPrimaryPosition(node: CanvasNode, direction: GroupLayoutDirection): number {
  return direction === 'horizontal' ? node.position.x : node.position.y;
}

function getSecondaryPosition(node: CanvasNode, direction: GroupLayoutDirection): number {
  return direction === 'horizontal' ? node.position.y : node.position.x;
}

function compareNodesByCurrentPosition(
  left: CanvasNode,
  right: CanvasNode,
  direction: GroupLayoutDirection
): number {
  const primaryDelta = getPrimaryPosition(left, direction) - getPrimaryPosition(right, direction);
  if (Math.abs(primaryDelta) > 1) {
    return primaryDelta;
  }

  const secondaryDelta =
    getSecondaryPosition(left, direction) - getSecondaryPosition(right, direction);
  if (Math.abs(secondaryDelta) > 1) {
    return secondaryDelta;
  }

  return left.id.localeCompare(right.id);
}

interface OrderedGroupGraph {
  orderedIds: string[];
  depthById: Map<string, number>;
  parentIdsByChild: Map<string, string[]>;
}

function buildOrderedGraph(nodes: CanvasNode[], edges: CanvasEdge[]): OrderedGroupGraph {
  const direction: GroupLayoutDirection = 'horizontal';
  const sortedNodes = [...nodes].sort((left, right) =>
    compareNodesByCurrentPosition(left, right, direction)
  );
  const nodeIdSet = new Set(sortedNodes.map((node) => node.id));
  const adjacency = new Map<string, Set<string>>();
  const indegree = new Map<string, number>();
  const depthById = new Map<string, number>();
  const parentIdsByChild = new Map<string, string[]>();

  for (const node of sortedNodes) {
    adjacency.set(node.id, new Set());
    indegree.set(node.id, 0);
    depthById.set(node.id, 0);
    parentIdsByChild.set(node.id, []);
  }

  for (const edge of edges) {
    if (!nodeIdSet.has(edge.source) || !nodeIdSet.has(edge.target) || edge.source === edge.target) {
      continue;
    }

    const targets = adjacency.get(edge.source);
    if (!targets || targets.has(edge.target)) {
      continue;
    }

    targets.add(edge.target);
    indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1);
    const parentIds = parentIdsByChild.get(edge.target);
    if (parentIds) {
      parentIds.push(edge.source);
    }
  }

  const queue = sortedNodes
    .filter((node) => (indegree.get(node.id) ?? 0) === 0)
    .map((node) => node.id);
  const orderedIds: string[] = [];

  while (queue.length > 0) {
    queue.sort((leftId, rightId) =>
      compareNodesByCurrentPosition(
        sortedNodes.find((node) => node.id === leftId)!,
        sortedNodes.find((node) => node.id === rightId)!,
        direction
      )
    );

    const currentId = queue.shift();
    if (!currentId) {
      continue;
    }

    orderedIds.push(currentId);

    for (const nextId of adjacency.get(currentId) ?? []) {
      depthById.set(
        nextId,
        Math.max(depthById.get(nextId) ?? 0, (depthById.get(currentId) ?? 0) + 1)
      );
      const nextDegree = (indegree.get(nextId) ?? 0) - 1;
      indegree.set(nextId, nextDegree);
      if (nextDegree === 0) {
        queue.push(nextId);
      }
    }
  }

  if (orderedIds.length < sortedNodes.length) {
    const orderedSet = new Set(orderedIds);
    sortedNodes
      .filter((node) => !orderedSet.has(node.id))
      .forEach((node) => orderedIds.push(node.id));
  }

  return {
    orderedIds,
    depthById,
    parentIdsByChild,
  };
}

function buildLevelColumns(
  orderedIds: string[],
  depthById: Map<string, number>,
  parentIdsByChild: Map<string, string[]>,
  nodeMap: Map<string, CanvasNode>,
  maxItemsPerLine: number
): string[][][] {
  const orderIndexById = new Map(orderedIds.map((nodeId, index) => [nodeId, index] as const));
  const levels = new Map<number, string[]>();

  for (const nodeId of orderedIds) {
    const depth = depthById.get(nodeId) ?? 0;
    const currentLevel = levels.get(depth) ?? [];
    currentLevel.push(nodeId);
    levels.set(depth, currentLevel);
  }

  return [...levels.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([, levelNodeIds]) => {
      const sortedLevelNodeIds = [...levelNodeIds].sort((leftId, rightId) => {
        const leftParentOrder = Math.min(
          ...(parentIdsByChild.get(leftId) ?? []).map(
            (parentId) => orderIndexById.get(parentId) ?? Number.MAX_SAFE_INTEGER
          ),
          Number.MAX_SAFE_INTEGER
        );
        const rightParentOrder = Math.min(
          ...(parentIdsByChild.get(rightId) ?? []).map(
            (parentId) => orderIndexById.get(parentId) ?? Number.MAX_SAFE_INTEGER
          ),
          Number.MAX_SAFE_INTEGER
        );

        if (leftParentOrder !== rightParentOrder) {
          return leftParentOrder - rightParentOrder;
        }

        const leftNode = nodeMap.get(leftId);
        const rightNode = nodeMap.get(rightId);
        if (leftNode && rightNode) {
          const verticalDelta = leftNode.position.y - rightNode.position.y;
          if (Math.abs(verticalDelta) > 1) {
            return verticalDelta;
          }

          const horizontalDelta = leftNode.position.x - rightNode.position.x;
          if (Math.abs(horizontalDelta) > 1) {
            return horizontalDelta;
          }
        }

        return (orderIndexById.get(leftId) ?? 0) - (orderIndexById.get(rightId) ?? 0);
      });

      const columns: string[][] = [];
      sortedLevelNodeIds.forEach((nodeId, index) => {
        const columnIndex = Math.floor(index / maxItemsPerLine);
        if (!columns[columnIndex]) {
          columns[columnIndex] = [];
        }
        columns[columnIndex].push(nodeId);
      });

      return columns;
    });
}

export function layoutGroupChildren(
  nodes: CanvasNode[],
  edges: CanvasEdge[],
  options?: GroupLayoutOptions
): GroupLayoutResult {
  // V1 keeps a predictable left-to-right flow and wraps to the next row when needed.
  const direction: GroupLayoutDirection = 'horizontal';
  const maxItemsPerLine = Math.max(1, options?.maxItemsPerLine ?? DEFAULT_GROUP_LAYOUT_MAX_ITEMS_PER_LINE);
  const gapX = options?.gapX ?? DEFAULT_GROUP_LAYOUT_GAP_X;
  const gapY = options?.gapY ?? DEFAULT_GROUP_LAYOUT_GAP_Y;
  const sidePadding = options?.sidePadding ?? GROUP_NODE_SIDE_PADDING;
  const topPadding = options?.topPadding ?? GROUP_NODE_TOP_PADDING;
  const bottomPadding = options?.bottomPadding ?? GROUP_NODE_BOTTOM_PADDING;
  const minWidth = options?.minWidth ?? GROUP_NODE_MIN_WIDTH;
  const minHeight = options?.minHeight ?? GROUP_NODE_MIN_HEIGHT;

  const nodeMap = new Map(nodes.map((node) => [node.id, node] as const));
  const { orderedIds, depthById, parentIdsByChild } = buildOrderedGraph(nodes, edges);
  const levelColumns = buildLevelColumns(
    orderedIds,
    depthById,
    parentIdsByChild,
    nodeMap,
    maxItemsPerLine
  );

  const positions = new Map<string, { x: number; y: number }>();
  let contentWidth = 0;
  let contentHeight = 0;
  let currentLevelX = sidePadding;

  levelColumns.forEach((columns) => {
    const columnWidths = columns.map((column) =>
      column.reduce((maxWidth, nodeId) => {
        const node = nodeMap.get(nodeId);
        return node ? Math.max(maxWidth, getNodeSize(node).width) : maxWidth;
      }, 0)
    );

    let currentColumnX = currentLevelX;
    let levelBottom = topPadding;

    columns.forEach((column, columnIndex) => {
      let currentY = topPadding;

      column.forEach((nodeId) => {
        const node = nodeMap.get(nodeId);
        if (!node) {
          return;
        }

        positions.set(nodeId, {
          x: Math.round(currentColumnX),
          y: Math.round(currentY),
        });

        currentY += getNodeSize(node).height + gapY;
      });

      const usedColumnHeight = Math.max(topPadding, currentY - gapY);
      levelBottom = Math.max(levelBottom, usedColumnHeight);
      currentColumnX += (columnWidths[columnIndex] ?? 0) + gapX;
    });

    const levelWidth = columnWidths.reduce((sum, width) => sum + width, 0)
      + Math.max(0, columns.length - 1) * gapX;
    contentWidth = Math.max(contentWidth, currentLevelX + levelWidth - sidePadding);
    contentHeight = Math.max(contentHeight, levelBottom - topPadding);
    currentLevelX += levelWidth + gapX;
  });

  return {
    direction,
    maxItemsPerLine,
    positions,
    size: {
      width: Math.max(minWidth, Math.round(contentWidth + sidePadding * 2)),
      height: Math.max(minHeight, Math.round(contentHeight + topPadding + bottomPadding)),
    },
  };
}
