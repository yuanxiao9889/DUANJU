import {
  type CanvasEdge,
  type CanvasNode,
} from "../domain/canvasNodes";
import { extractReferenceVisuals } from "./nodeReferenceExtraction";

export interface ConnectedReferenceVisual {
  sourceEdgeId: string;
  sourceNodeId: string;
  kind: "image" | "video";
  referenceUrl: string;
  previewImageUrl: string;
  durationSeconds?: number | null;
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
      const normalizedPreviewImageUrl = item.previewImageUrl.trim();
      if (
        !normalizedReferenceUrl ||
        !normalizedPreviewImageUrl ||
        seenReferenceUrls.has(normalizedReferenceUrl)
      ) {
        continue;
      }

      seenReferenceUrls.add(normalizedReferenceUrl);
      items.push({
        sourceEdgeId: edge.id,
        sourceNodeId: sourceNode.id,
        kind: item.kind,
        referenceUrl: normalizedReferenceUrl,
        previewImageUrl: normalizedPreviewImageUrl,
        durationSeconds: item.durationSeconds ?? null,
      });
    }
  }

  return items;
}
