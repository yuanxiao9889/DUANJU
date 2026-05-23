import {
  isAudioNode,
  isAssetMaterialNode,
  isExportImageNode,
  isImageEditNode,
  isJimengNode,
  isMjResultNode,
  isPanorama360Node,
  isJimengImageNode,
  isJimengImageResultNode,
  isJimengVideoResultNode,
  isSeedanceNode,
  isSeedanceVideoResultNode,
  isViduNode,
  isViduVideoResultNode,
  isStoryboardGenNode,
  isUploadNode,
  isVideoNode,
  getMjResultNodeActiveImages,
  type CanvasNode,
  type ImageViewerMetadata,
} from '../domain/canvasNodes';
import { useAssetStore } from '@/stores/assetStore';

export interface ExtractedReferenceVisual {
  kind: 'image' | 'video';
  referenceUrl: string;
  previewImageUrl?: string | null;
  durationSeconds?: number | null;
  assetId?: string | null;
  displayName?: string | null;
  tokenAlias?: string | null;
  sourceNodeId?: string | null;
  viewerMetadata?: ImageViewerMetadata | null;
}

export interface ExtractedAudioReference {
  audioUrl: string;
  displayName: string | null;
  audioFileName: string | null;
  mimeType: string | null;
  durationSeconds?: number | null;
}

function resolvePrimaryImageReferenceUrl(node: CanvasNode): string {
  if (
    isUploadNode(node)
    || isImageEditNode(node)
    || isPanorama360Node(node)
    || isExportImageNode(node)
    || isStoryboardGenNode(node)
  ) {
    return node.data.imageUrl?.trim() || node.data.previewImageUrl?.trim() || '';
  }

  return '';
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function buildJimengImageViewerRequestModel({
  modelVersion,
  resolutionType,
  aspectRatio,
  referenceImageCount,
}: {
  modelVersion?: string | null;
  resolutionType?: string | null;
  aspectRatio?: string | null;
  referenceImageCount?: number | null;
}): string {
  const normalizedModelVersion = normalizeText(modelVersion) || 'image';
  const parts = [`jimeng-image-${normalizedModelVersion}`];
  const normalizedResolution = normalizeText(resolutionType).toUpperCase();
  const normalizedAspectRatio = normalizeText(aspectRatio);
  if (normalizedResolution) {
    parts.push(normalizedResolution);
  }
  if (normalizedAspectRatio) {
    parts.push(normalizedAspectRatio);
  }
  if (
    typeof referenceImageCount === 'number'
    && Number.isFinite(referenceImageCount)
    && referenceImageCount > 0
  ) {
    parts.push(`refs ${Math.round(referenceImageCount)}`);
  }

  return parts.join(' / ');
}

function resolveReferenceVisualMetadata(node: CanvasNode): ImageViewerMetadata | null {
  if (isExportImageNode(node)) {
    return node.data.generationSummary ?? null;
  }

  if (isJimengImageNode(node) || isJimengImageResultNode(node)) {
    const referenceImageCount =
      isJimengImageResultNode(node)
      &&
      typeof node.data.referenceImageCount === 'number'
      && Number.isFinite(node.data.referenceImageCount)
        ? node.data.referenceImageCount
        : null;

    return {
      sourceType: 'imageEdit',
      providerId: 'jimeng',
      requestModel: buildJimengImageViewerRequestModel({
        modelVersion: node.data.modelVersion,
        resolutionType: node.data.resolutionType,
        aspectRatio: node.data.aspectRatio,
        referenceImageCount,
      }),
      prompt: normalizeText(node.data.prompt),
      generatedAt: node.data.lastGeneratedAt ?? null,
    };
  }

  if (isMjResultNode(node)) {
    const activeBatch =
      node.data.batches.find((batch) => batch.id === node.data.activeBatchId)
      ?? node.data.batches[0]
      ?? null;
    if (!activeBatch) {
      return null;
    }

    return {
      sourceType: 'imageEdit',
      providerId: activeBatch.providerId,
      requestModel: activeBatch.action?.trim() || activeBatch.providerId,
      prompt: normalizeText(activeBatch.finalPrompt) || normalizeText(activeBatch.prompt),
      generatedAt:
        activeBatch.finishTime
        ?? activeBatch.startTime
        ?? activeBatch.submitTime
        ?? node.data.lastGeneratedAt
        ?? null,
    };
  }

  return null;
}

export function extractReferenceImageUrls(node: CanvasNode): string[] {
  if (
    isUploadNode(node)
    || isImageEditNode(node)
    || isPanorama360Node(node)
    || isExportImageNode(node)
    || isStoryboardGenNode(node)
  ) {
    const referenceUrl = resolvePrimaryImageReferenceUrl(node);
    return referenceUrl ? [referenceUrl] : [];
  }

  if (isJimengImageNode(node) || isJimengImageResultNode(node)) {
    return (node.data.resultImages ?? [])
      .map((item) => item.imageUrl ?? item.previewImageUrl ?? item.sourceUrl ?? null)
      .filter((imageUrl): imageUrl is string => Boolean(imageUrl && imageUrl.trim().length > 0));
  }

  if (isMjResultNode(node)) {
    return getMjResultNodeActiveImages(node.data)
      .map((item) => item.imageUrl ?? item.previewImageUrl ?? item.sourceUrl ?? null)
      .filter((imageUrl): imageUrl is string => Boolean(imageUrl && imageUrl.trim().length > 0));
  }

  return [];
}

export function extractReferenceVisuals(node: CanvasNode): ExtractedReferenceVisual[] {
  if (isAssetMaterialNode(node)) {
    const selectedIds = new Set(node.data.selectedAssetIds);
    if (selectedIds.size === 0) {
      return [];
    }

    const libraries = useAssetStore.getState().libraries;
    const itemById = new Map(
      libraries
        .flatMap((library) => library.items)
        .map((item) => [item.id, item] as const)
    );
    const selectedItems = node.data.selectedAssetIds
      .map((assetId) => itemById.get(assetId))
      .filter((item): item is (typeof libraries)[number]['items'][number] => Boolean(item && item.mediaType === 'image'));

    const nameCounts = new Map<string, number>();
    const seenTokenNames = new Set<string>();
    return selectedItems
      .map((item) => {
        const referenceUrl = item.sourcePath?.trim() || item.previewPath?.trim() || '';
        if (!referenceUrl) {
          return null;
        }
        const tokenName = item.name.replace(/\s+/g, '').trim() || item.name;
        const tokenKey = tokenName.toLowerCase();
        if (seenTokenNames.has(tokenKey)) {
          return null;
        }
        seenTokenNames.add(tokenKey);
        const duplicateIndex = nameCounts.get(tokenName) ?? 0;
        nameCounts.set(tokenName, duplicateIndex + 1);
        return {
          kind: 'image' as const,
          referenceUrl,
          previewImageUrl: item.previewPath?.trim() || referenceUrl,
          assetId: item.id,
          displayName: item.name,
          tokenAlias: `@${tokenName}${duplicateIndex > 0 ? duplicateIndex + 1 : ''}`,
          sourceNodeId: node.id,
        };
      })
      .filter((item): item is {
        kind: 'image';
        referenceUrl: string;
        previewImageUrl: string;
        assetId: string;
        displayName: string;
        tokenAlias: string;
        sourceNodeId: string;
      } => Boolean(item));
  }

  if (
    isUploadNode(node)
    || isImageEditNode(node)
    || isPanorama360Node(node)
    || isExportImageNode(node)
    || isStoryboardGenNode(node)
  ) {
    const referenceUrl = resolvePrimaryImageReferenceUrl(node);
    if (!referenceUrl) {
      return [];
    }

    const previewImageUrl = node.data.previewImageUrl?.trim() || referenceUrl;
    const viewerMetadata = resolveReferenceVisualMetadata(node);

    return [
      {
        kind: 'image',
        referenceUrl,
        previewImageUrl,
        viewerMetadata,
      },
    ];
  }

  if (isJimengImageNode(node) || isJimengImageResultNode(node)) {
    const viewerMetadata = resolveReferenceVisualMetadata(node);
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
          viewerMetadata,
        };
      })
      .filter(
        (
          item
        ): item is {
          kind: 'image';
          referenceUrl: string;
          previewImageUrl: string;
          viewerMetadata: ImageViewerMetadata | null;
        } => Boolean(item)
      );
  }

  if (isMjResultNode(node)) {
    const viewerMetadata = resolveReferenceVisualMetadata(node);
    return getMjResultNodeActiveImages(node.data)
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
          viewerMetadata,
        };
      })
      .filter(
        (
          item
        ): item is {
          kind: 'image';
          referenceUrl: string;
          previewImageUrl: string;
          viewerMetadata: ImageViewerMetadata | null;
        } => Boolean(item)
      );
  }

  if (
    isVideoNode(node)
    || isJimengVideoResultNode(node)
    || isSeedanceVideoResultNode(node)
    || isViduVideoResultNode(node)
  ) {
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
  if (isAssetMaterialNode(node)) {
    const selectedIds = new Set(node.data.selectedAssetIds);
    if (selectedIds.size === 0) {
      return null;
    }

    const libraries = useAssetStore.getState().libraries;
    const selectedItem = libraries
      .flatMap((library) => library.items)
      .find((item) => (
        selectedIds.has(item.id)
        && item.category === 'voice'
        && item.mediaType === 'audio'
        && item.sourcePath.trim().length > 0
      ));
    if (!selectedItem) {
      return null;
    }

    return {
      audioUrl: selectedItem.sourcePath.trim(),
      displayName: selectedItem.name,
      audioFileName: selectedItem.name,
      mimeType: selectedItem.mimeType,
      durationSeconds:
        typeof selectedItem.durationMs === 'number' && Number.isFinite(selectedItem.durationMs)
          ? selectedItem.durationMs / 1000
          : null,
    };
  }

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

export function nodeProvidesReferenceMaterial(node: CanvasNode | null | undefined): boolean {
  if (!node) {
    return false;
  }

  return extractReferenceVisuals(node).length > 0 || Boolean(extractAudioReference(node));
}

export function canNodeInheritAltDuplicatedReferenceInputs(
  node: CanvasNode | null | undefined
): boolean {
  if (!node) {
    return false;
  }

  return isImageEditNode(node)
    || isStoryboardGenNode(node)
    || isJimengImageNode(node)
    || isJimengNode(node)
    || isSeedanceNode(node)
    || isViduNode(node);
}
