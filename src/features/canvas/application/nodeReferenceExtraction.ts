import {
  isAudioNode,
  isExportImageNode,
  isImageEditNode,
  isJimengImageNode,
  isJimengImageResultNode,
  isJimengVideoResultNode,
  isPanoramaResultNode,
  isSeedanceVideoResultNode,
  isStoryboardGenNode,
  isUploadNode,
  isVideoNode,
  type CanvasNode,
} from '../domain/canvasNodes';

export interface ExtractedReferenceVisual {
  kind: 'image' | 'video';
  referenceUrl: string;
  previewImageUrl?: string | null;
  durationSeconds?: number | null;
}

export interface ExtractedAudioReference {
  audioUrl: string;
  displayName: string | null;
  audioFileName: string | null;
  mimeType: string | null;
  durationSeconds?: number | null;
}

export function extractReferenceImageUrls(node: CanvasNode): string[] {
  if (
    isUploadNode(node)
    || isImageEditNode(node)
    || isExportImageNode(node)
    || isPanoramaResultNode(node)
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

export function extractReferenceVisuals(node: CanvasNode): ExtractedReferenceVisual[] {
  if (
    isUploadNode(node)
    || isImageEditNode(node)
    || isExportImageNode(node)
    || isPanoramaResultNode(node)
    || isStoryboardGenNode(node)
  ) {
    const referenceUrl = node.data.imageUrl?.trim() ?? '';
    if (!referenceUrl) {
      return [];
    }

    const previewImageUrl = node.data.previewImageUrl?.trim() ?? referenceUrl;

    return [
      {
        kind: 'image',
        referenceUrl,
        previewImageUrl,
      },
    ];
  }

  if (isJimengImageNode(node) || isJimengImageResultNode(node)) {
    return (node.data.resultImages ?? [])
      .map((item) => {
        const previewImageUrl =
          item.imageUrl?.trim()
          ?? item.previewImageUrl?.trim()
          ?? item.sourceUrl?.trim()
          ?? '';
        if (!previewImageUrl) {
          return null;
        }

        return {
          kind: 'image' as const,
          referenceUrl: previewImageUrl,
          previewImageUrl,
        };
      })
      .filter(
        (
          item
        ): item is {
          kind: 'image';
          referenceUrl: string;
          previewImageUrl: string;
        } => Boolean(item)
      );
  }

  if (isVideoNode(node) || isJimengVideoResultNode(node) || isSeedanceVideoResultNode(node)) {
    const referenceUrl = node.data.videoUrl?.trim() ?? '';
    const posterSourceUrl =
      typeof node.data.posterSourceUrl === 'string'
        ? node.data.posterSourceUrl.trim()
        : '';
    const previewImageUrl =
      node.data.previewImageUrl?.trim()
      ?? posterSourceUrl
      ?? '';
    if (!referenceUrl) {
      return [];
    }

    return [
      {
        kind: 'video',
        referenceUrl,
        previewImageUrl: previewImageUrl || null,
        durationSeconds: typeof node.data.duration === 'number' ? node.data.duration : null,
      },
    ];
  }

  return [];
}

export function extractAudioReference(node: CanvasNode): ExtractedAudioReference | null {
  if (!isAudioNode(node)) {
    return null;
  }

  const audioUrl = node.data.audioUrl?.trim() ?? '';
  if (!audioUrl) {
    return null;
  }

  const displayName = node.data.displayName?.trim() || null;
  const audioFileName = node.data.audioFileName?.trim() || null;
  const mimeType = node.data.mimeType?.trim() || null;

  return {
    audioUrl,
    displayName,
    audioFileName,
    mimeType,
    durationSeconds: typeof node.data.duration === 'number' ? node.data.duration : null,
  };
}
