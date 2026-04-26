import type { CanvasNode, CanvasEdge } from '@/features/canvas/domain/canvasNodes';

export interface LayoutConfig {
  rootX: number;
  rootY: number;
  levelSpacingX: number;
  branchSpacingY: number;
  mainLineSpacingY: number;
  nodeWidth: number;
  nodeHeight: number;
}

export const DEFAULT_LAYOUT_CONFIG: LayoutConfig = {
  rootX: 100,
  rootY: 100,
  levelSpacingX: 500,
  branchSpacingY: 200,
  mainLineSpacingY: 440,
  nodeWidth: 420,
  nodeHeight: 400,
};

interface NodeLayoutInfo {
  id: string;
  depth: number;
  branchIndex: number;
  parentId: string | null;
  children: string[];
  branchChildren: string[];
  x: number;
  y: number;
}

function buildNodeTree(
  nodes: CanvasNode[],
  edges: CanvasEdge[]
): Map<string, NodeLayoutInfo> {
  const nodeMap = new Map<string, NodeLayoutInfo>();
  
  nodes.forEach((node) => {
    nodeMap.set(node.id, {
      id: node.id,
      depth: 0,
      branchIndex: 0,
      parentId: null,
      children: [],
      branchChildren: [],
      x: node.position.x,
      y: node.position.y,
    });
  });
  
  edges.forEach((edge) => {
    const sourceInfo = nodeMap.get(edge.source);
    const targetInfo = nodeMap.get(edge.target);
    if (sourceInfo && targetInfo) {
      const isBranchConnection = edge.sourceHandle === 'branch';
      if (isBranchConnection) {
        sourceInfo.branchChildren.push(edge.target);
      } else {
        sourceInfo.children.push(edge.target);
      }
      targetInfo.parentId = edge.source;
    }
  });
  
  return nodeMap;
}

function calculateDepths(nodeMap: Map<string, NodeLayoutInfo>, rootId: string): void {
  const visited = new Set<string>();
  const queue: Array<{ id: string; depth: number }> = [{ id: rootId, depth: 0 }];
  
  while (queue.length > 0) {
    const { id, depth } = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    
    const nodeInfo = nodeMap.get(id);
    if (nodeInfo) {
      nodeInfo.depth = depth;
      nodeInfo.children.forEach((childId) => {
        if (!visited.has(childId)) {
          queue.push({ id: childId, depth: depth + 1 });
        }
      });
      nodeInfo.branchChildren.forEach((childId) => {
        if (!visited.has(childId)) {
          queue.push({ id: childId, depth: depth + 1 });
        }
      });
    }
  }
}

function calculateSubtreeWidth(
  nodeId: string,
  nodeMap: Map<string, NodeLayoutInfo>,
  config: LayoutConfig
): number {
  const nodeInfo = nodeMap.get(nodeId);
  if (!nodeInfo) return config.levelSpacingX;
  
  if (nodeInfo.branchChildren.length === 0) {
    return config.levelSpacingX;
  }
  
  let totalWidth = 0;
  nodeInfo.branchChildren.forEach((childId) => {
    totalWidth += calculateSubtreeWidth(childId, nodeMap, config);
  });
  
  return Math.max(totalWidth, config.levelSpacingX);
}

function layoutBranches(
  nodeId: string,
  nodeMap: Map<string, NodeLayoutInfo>,
  config: LayoutConfig,
  startX: number
): void {
  const nodeInfo = nodeMap.get(nodeId);
  if (!nodeInfo || nodeInfo.branchChildren.length === 0) return;
  
  let currentX = startX;
  nodeInfo.branchChildren.forEach((childId) => {
    const childInfo = nodeMap.get(childId);
    if (childInfo) {
      childInfo.x = currentX;
      childInfo.y = nodeInfo.y;
      layoutBranches(childId, nodeMap, config, currentX + config.levelSpacingX);
      currentX += calculateSubtreeWidth(childId, nodeMap, config);
    }
  });
}

export function calculateMindMapLayout(
  nodes: CanvasNode[],
  edges: CanvasEdge[],
  config: LayoutConfig = DEFAULT_LAYOUT_CONFIG
): Map<string, { x: number; y: number }> {
  if (nodes.length === 0) {
    return new Map();
  }
  
  const nodeMap = buildNodeTree(nodes, edges);
  
  let rootId: string | null = null;
  nodeMap.forEach((info) => {
    if (info.parentId === null) {
      rootId = info.id;
    }
  });
  
  if (!rootId) {
    rootId = nodes[0].id;
  }
  
  calculateDepths(nodeMap, rootId);
  
  const rootInfo = nodeMap.get(rootId);
  if (rootInfo) {
    rootInfo.x = config.rootX;
    rootInfo.y = config.rootY;
  }
  
  const rootChildren = rootInfo ? [...rootInfo.children] : [];
  rootChildren.forEach((childId, index) => {
    const childInfo = nodeMap.get(childId);
    if (childInfo) {
      childInfo.x = config.rootX + config.levelSpacingX;
      childInfo.y = config.rootY + index * config.mainLineSpacingY;
      layoutBranches(childId, nodeMap, config, childInfo.x + config.levelSpacingX);
    }
  });
  
  const positions = new Map<string, { x: number; y: number }>();
  nodeMap.forEach((info) => {
    positions.set(info.id, { x: info.x, y: info.y });
  });
  
  return positions;
}

export function calculateChildNodePosition(
  parentNode: CanvasNode,
  childIndex: number,
  _totalChildren: number,
  config: LayoutConfig = DEFAULT_LAYOUT_CONFIG
): { x: number; y: number } {
  const x = parentNode.position.x + config.levelSpacingX;
  const parentNodeHeight = parentNode.measured?.height ?? config.nodeHeight;
  const y = parentNode.position.y + parentNodeHeight + 40 + childIndex * config.mainLineSpacingY;
  
  return { x, y };
}

export function calculateBranchNodePosition(
  parentNode: CanvasNode,
  existingBranchCount: number,
  config: LayoutConfig = DEFAULT_LAYOUT_CONFIG
): { x: number; y: number } {
  const x = parentNode.position.x + config.levelSpacingX;
  const y = parentNode.position.y + (existingBranchCount > 0 ? (existingBranchCount % 2 === 0 ? -1 : 1) * Math.ceil(existingBranchCount / 2) * config.branchSpacingY : 0);
  
  return { x, y };
}
