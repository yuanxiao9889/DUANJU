import {
  CANVAS_NODE_TYPES,
  type CanvasEdge,
  type CanvasNode,
} from '@/features/canvas/domain/canvasNodes';

export interface ConnectedCanvasTextInput {
  connectedText: string;
  hasConnectedTextSource: boolean;
  hasNonEmptyConnectedText: boolean;
}

function htmlToPlainText(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }

  if (typeof DOMParser !== 'undefined') {
    const parser = new DOMParser();
    const document = parser.parseFromString(trimmed, 'text/html');
    return (document.body.textContent || '')
      .replace(/\u00a0/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  return trimmed
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/p>\s*<p[^>]*>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, '\'')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isCanvasTextSourceNode(node: CanvasNode | undefined): boolean {
  return Boolean(
    node
    && (
      node.type === CANVAS_NODE_TYPES.textAnnotation
      || node.type === CANVAS_NODE_TYPES.ttsText
      || node.type === CANVAS_NODE_TYPES.scriptChapter
    )
  );
}

export function resolveCanvasTextSourceNodeText(node: CanvasNode | undefined): string {
  if (!node) {
    return '';
  }

  if (
    node.type === CANVAS_NODE_TYPES.textAnnotation
    || node.type === CANVAS_NODE_TYPES.ttsText
  ) {
    return typeof node.data.content === 'string' ? node.data.content.trim() : '';
  }

  if (node.type === CANVAS_NODE_TYPES.scriptChapter) {
    return typeof node.data.content === 'string'
      ? htmlToPlainText(node.data.content)
      : '';
  }

  return '';
}

export function resolveConnectedCanvasTextInput(
  nodeId: string,
  nodes: CanvasNode[],
  edges: CanvasEdge[]
): ConnectedCanvasTextInput {
  const incomingEdges = edges.filter((edge) => edge.target === nodeId);
  if (incomingEdges.length === 0) {
    return {
      connectedText: '',
      hasConnectedTextSource: false,
      hasNonEmptyConnectedText: false,
    };
  }

  const nodeMap = new Map(nodes.map((node) => [node.id, node] as const));
  const sourceTexts = incomingEdges
    .map((edge) => nodeMap.get(edge.source))
    .filter((node): node is CanvasNode => isCanvasTextSourceNode(node))
    .map((node) => resolveCanvasTextSourceNodeText(node))
    .filter((text) => text.length > 0);
  const connectedText = sourceTexts.join('\n\n');
  const hasConnectedTextSource = incomingEdges
    .some((edge) => isCanvasTextSourceNode(nodeMap.get(edge.source)));

  return {
    connectedText,
    hasConnectedTextSource,
    hasNonEmptyConnectedText: connectedText.trim().length > 0,
  };
}

export function resolveConnectedCanvasText(
  nodeId: string,
  nodes: CanvasNode[],
  edges: CanvasEdge[]
): string {
  return resolveConnectedCanvasTextInput(nodeId, nodes, edges).connectedText;
}
