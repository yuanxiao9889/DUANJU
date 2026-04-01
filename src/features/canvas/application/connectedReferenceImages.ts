import {
  isExportImageNode,
  isImageEditNode,
  isJimengImageNode,
  isJimengImageResultNode,
  isStoryboardGenNode,
  isUploadNode,
  type CanvasEdge,
  type CanvasNode,
} from '../domain/canvasNodes';

export interface ConnectedReferenceImage {
  sourceEdgeId: string;
  sourceNodeId: string;
  imageUrl: string;
}

export function collectConnectedReferenceImages(
  nodeId: string,
  nodes: CanvasNode[],
  edges: CanvasEdge[]
): ConnectedReferenceImage[] {
  const nodeById = new Map(nodes.map((node) => [node.id, node] as const));
  const items: ConnectedReferenceImage[] = [];
  const seenImageUrls = new Set<string>();

  for (const edge of edges) {
    if (edge.target !== nodeId) {
      continue;
    }

    const sourceNode = nodeById.get(edge.source);
    if (!sourceNode) {
      continue;
    }

    for (const imageUrl of extractReferenceImageUrls(sourceNode)) {
      const normalizedImageUrl = imageUrl.trim();
      if (!normalizedImageUrl || seenImageUrls.has(normalizedImageUrl)) {
        continue;
      }

      seenImageUrls.add(normalizedImageUrl);
      items.push({
        sourceEdgeId: edge.id,
        sourceNodeId: sourceNode.id,
        imageUrl: normalizedImageUrl,
      });
    }
  }

  return items;
}

function extractReferenceImageUrls(node: CanvasNode): string[] {
  if (
    isUploadNode(node)
    || isImageEditNode(node)
    || isExportImageNode(node)
    || isStoryboardGenNode(node)
  ) {
    return node.data.imageUrl ? [node.data.imageUrl] : [];
  }

  if (isJimengImageNode(node) || isJimengImageResultNode(node)) {
    return (node.data.resultImages ?? [])
      .map((item) => item.imageUrl ?? item.previewImageUrl ?? item.sourceUrl ?? null)
      .filter((imageUrl): imageUrl is string => Boolean(imageUrl && imageUrl.trim().length > 0));
  }

  return [];
}
