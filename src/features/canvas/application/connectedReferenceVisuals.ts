import {
  type CanvasEdge,
  type CanvasNode,
  type ImageViewerMetadata,
} from "../domain/canvasNodes";
import { extractReferenceVisuals } from "./nodeReferenceExtraction";

export interface ConnectedReferenceVisual {
  sourceEdgeId: string;
  sourceNodeId: string;
  kind: "image" | "video";
  referenceUrl: string;
  previewImageUrl?: string | null;
  durationSeconds?: number | null;
  assetId?: string | null;
  displayName?: string | null;
  tokenAlias?: string | null;
  viewerMetadata?: ImageViewerMetadata | null;
}

export function collectConnectedReferenceVisuals(
  nodeId: string,
  nodes: CanvasNode[],
  edges: CanvasEdge[],
): ConnectedReferenceVisual[] {
  const nodeById = new Map(nodes.map((node) => [node.id, node] as const));
  const items: ConnectedReferenceVisual[] = [];
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
      const normalizedReferenceUrl = item.referenceUrl.trim();
      const normalizedPreviewImageUrl = item.previewImageUrl?.trim() ?? "";
      if (!normalizedReferenceUrl || seenReferenceUrls.has(normalizedReferenceUrl)) {
        continue;
      }

      seenReferenceUrls.add(normalizedReferenceUrl);
      items.push({
        sourceEdgeId: edge.id,
        sourceNodeId: sourceNode.id,
        kind: item.kind,
        referenceUrl: normalizedReferenceUrl,
        previewImageUrl: normalizedPreviewImageUrl || null,
        durationSeconds: item.durationSeconds ?? null,
        assetId: item.assetId ?? null,
        displayName: item.displayName ?? null,
        tokenAlias: item.tokenAlias ?? null,
        viewerMetadata: item.viewerMetadata ?? null,
      });
    }
  }

  return items;
}
