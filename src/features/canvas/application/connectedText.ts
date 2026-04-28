import {
  CANVAS_NODE_TYPES,
  type CanvasEdge,
  type CanvasNode,
} from '@/features/canvas/domain/canvasNodes';

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

function resolveNodeText(node: CanvasNode | undefined): string {
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

export function resolveConnectedCanvasText(
  nodeId: string,
  nodes: CanvasNode[],
  edges: CanvasEdge[]
): string {
  const incomingEdges = edges.filter((edge) => edge.target === nodeId);
  if (incomingEdges.length === 0) {
    return '';
  }

  const nodeMap = new Map(nodes.map((node) => [node.id, node] as const));
  return incomingEdges
    .map((edge) => resolveNodeText(nodeMap.get(edge.source)))
    .filter((text) => text.length > 0)
    .join('\n\n');
}
