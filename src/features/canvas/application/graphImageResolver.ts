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
import type { GraphImageResolver } from './ports';

export class DefaultGraphImageResolver implements GraphImageResolver {
  collectInputImages(nodeId: string, nodes: CanvasNode[], edges: CanvasEdge[]): string[] {
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const sourceNodeIds = edges
      .filter((edge) => edge.target === nodeId)
      .map((edge) => edge.source);

    const images = sourceNodeIds
      .map((sourceId) => nodeById.get(sourceId))
      .flatMap((node) => this.extractImages(node));

    return [...new Set(images)];
  }

  private extractImages(node: CanvasNode | undefined): string[] {
    if (!node) {
      return [];
    }

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
}
