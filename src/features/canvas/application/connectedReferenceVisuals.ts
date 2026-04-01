import {
  isExportImageNode,
  isImageEditNode,
  isJimengImageNode,
  isJimengImageResultNode,
  isJimengVideoResultNode,
  isStoryboardGenNode,
  isUploadNode,
  isVideoNode,
  type CanvasEdge,
  type CanvasNode,
} from "../domain/canvasNodes";

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

function extractReferenceVisuals(
  node: CanvasNode,
): Array<{
  kind: "image" | "video";
  referenceUrl: string;
  previewImageUrl: string;
  durationSeconds?: number | null;
}> {
  if (
    isUploadNode(node) ||
    isImageEditNode(node) ||
    isExportImageNode(node) ||
    isStoryboardGenNode(node)
  ) {
    const imageUrl = node.data.imageUrl?.trim() ?? "";
    if (!imageUrl) {
      return [];
    }

    return [
      {
        kind: "image",
        referenceUrl: imageUrl,
        previewImageUrl: imageUrl,
      },
    ];
  }

  if (isJimengImageNode(node) || isJimengImageResultNode(node)) {
    return (node.data.resultImages ?? [])
      .map((item) => {
        const previewImageUrl =
          item.imageUrl?.trim() ??
          item.previewImageUrl?.trim() ??
          item.sourceUrl?.trim() ??
          "";
        if (!previewImageUrl) {
          return null;
        }

        return {
          kind: "image" as const,
          referenceUrl: previewImageUrl,
          previewImageUrl,
        };
      })
      .filter(
        (
          item,
        ): item is {
          kind: "image";
          referenceUrl: string;
          previewImageUrl: string;
        } => Boolean(item),
      );
  }

  if (isVideoNode(node)) {
    const referenceUrl = node.data.videoUrl?.trim() ?? "";
    const previewImageUrl = node.data.previewImageUrl?.trim() ?? "";
    if (!referenceUrl || !previewImageUrl) {
      return [];
    }

    return [
      {
        kind: "video",
        referenceUrl,
        previewImageUrl,
        durationSeconds:
          typeof node.data.duration === "number" ? node.data.duration : null,
      },
    ];
  }

  if (isJimengVideoResultNode(node)) {
    const referenceUrl = node.data.videoUrl?.trim() ?? "";
    const previewImageUrl = node.data.previewImageUrl?.trim() ?? "";
    if (!referenceUrl || !previewImageUrl) {
      return [];
    }

    return [
      {
        kind: "video",
        referenceUrl,
        previewImageUrl,
        durationSeconds:
          typeof node.data.duration === "number" ? node.data.duration : null,
      },
    ];
  }

  return [];
}
