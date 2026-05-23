import {
  type CanvasEdge,
  type CanvasNode,
  type ImageViewerMetadata,
} from '../domain/canvasNodes';
import { extractReferenceVisuals } from './nodeReferenceExtraction';

export interface ConnectedReferenceImage {
  sourceEdgeId: string;
  sourceNodeId: string;
  imageUrl: string;
  previewImageUrl?: string | null;
  viewerMetadata?: ImageViewerMetadata | null;
}

export function collectConnectedReferenceImages(
  nodeId: string,
  nodes: CanvasNode[],
  edges: CanvasEdge[]
): ConnectedReferenceImage[] {
  const nodeById = new Map(nodes.map((node) => [node.id, node] as const));
  const items: ConnectedReferenceImage[] = [];
  const seenReferenceUrls = new Set<string>();

  for (const edge of edges) {
    if (edge.target !== nodeId) {
      continue;
    }

    const sourceNode = nodeById.get(edge.source);
    if (!sourceNode) {
      continue;
    }

    for (const item of extractReferenceVisuals(sourceNode)) {
      if (item.kind !== 'image') {
        continue;
      }

      const normalizedImageUrl = item.referenceUrl.trim();
      const normalizedPreviewImageUrl = item.previewImageUrl?.trim() ?? '';
      if (!normalizedImageUrl || seenReferenceUrls.has(normalizedImageUrl)) {
        continue;
      }

      seenReferenceUrls.add(normalizedImageUrl);
      items.push({
        sourceEdgeId: edge.id,
        sourceNodeId: sourceNode.id,
        imageUrl: normalizedImageUrl,
        previewImageUrl: normalizedPreviewImageUrl || null,
        viewerMetadata: item.viewerMetadata ?? null,
      });
    }
  }

  return items;
}
