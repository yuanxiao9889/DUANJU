import type { AssetCategory, AssetItemRecord } from '@/features/assets/domain/types';
import { prepareNodeImage } from '@/features/canvas/application/imageData';
import { createSharedMediaContext } from '@/features/canvas/application/mediaPersistenceContext';
import {
  CANVAS_NODE_TYPES,
  type CanvasNode,
  type GroupNodeData,
  isExportImageNode,
  isGroupNode,
  isImageEditNode,
} from '@/features/canvas/domain/canvasNodes';
import { useAssetStore } from '@/stores/assetStore';
import { useCanvasStore } from '@/stores/canvasStore';
import { useProjectStore } from '@/stores/projectStore';
import { useSettingsStore } from '@/stores/settingsStore';

export type BatchAssetResolvedGroupKind = 'character' | 'scene' | 'prop' | 'unresolved';
export type BatchAssetEditableCategory = Extract<AssetCategory, 'character' | 'scene' | 'prop'>;

export interface BatchAssetDraft {
  id: string;
  nodeId: string;
  mediaSource: string;
  previewSource: string | null;
  aspectRatio: string;
  defaultName: string;
  resolvedCategory: BatchAssetEditableCategory | null;
  resolvedGroupKind: BatchAssetResolvedGroupKind;
  sourceImageEditNodeId: string | null;
  sourceGroupNodeId: string | null;
  sourceDisplayName: string | null;
}

export interface BatchAssetDraftGroup {
  kind: BatchAssetResolvedGroupKind;
  category: BatchAssetEditableCategory | null;
  drafts: BatchAssetDraft[];
}

export interface BatchAssetSourceResolution {
  drafts: BatchAssetDraft[];
  groups: BatchAssetDraftGroup[];
  skippedNodeIds: string[];
  totalSelectedCount: number;
}

export interface BatchAssetSubmissionDraftInput {
  draftId: string;
  nodeId: string;
  mediaSource: string;
  category: BatchAssetEditableCategory;
  subcategoryId: string | null;
  name: string;
}

export interface BatchAssetSubmissionRequest {
  libraryId: string;
  drafts: BatchAssetSubmissionDraftInput[];
  bindProjectLibrary?: boolean;
}

export interface BatchAssetSubmissionResultItem {
  draftId: string;
  nodeId: string;
  status: 'success' | 'error';
  item?: AssetItemRecord;
  error?: string;
}

export interface BatchAssetSubmissionResult {
  results: BatchAssetSubmissionResultItem[];
}

const GROUP_KIND_ORDER: BatchAssetResolvedGroupKind[] = [
  'character',
  'scene',
  'prop',
  'unresolved',
];

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function stripFileExtension(value: string): string {
  return value.replace(/\.[^.]+$/, '').trim();
}

function resolveNodeAssetId(node: CanvasNode): string {
  return normalizeText((node.data as { assetId?: unknown }).assetId);
}

function resolveExportNodeImageSource(node: CanvasNode): {
  mediaSource: string;
  previewSource: string | null;
} | null {
  if (!isExportImageNode(node)) {
    return null;
  }

  const mediaSource = normalizeText(node.data.imageUrl);
  const previewSource = normalizeText(node.data.previewImageUrl) || mediaSource;
  if (!mediaSource && !previewSource) {
    return null;
  }

  return {
    mediaSource: mediaSource || previewSource,
    previewSource: previewSource || null,
  };
}

function mapBatchKindToCategory(
  batchKind: GroupNodeData['batchKind']
): BatchAssetEditableCategory | null {
  if (batchKind === 'character' || batchKind === 'scene') {
    return batchKind;
  }

  if (batchKind === 'item') {
    return 'prop';
  }

  return null;
}

function resolveFallbackAssetName(node: CanvasNode): string {
  const data = node.data as {
    assetName?: unknown;
    displayName?: unknown;
    sourceFileName?: unknown;
  };
  const candidates = [
    normalizeText(data.assetName),
    normalizeText(data.displayName),
    stripFileExtension(normalizeText(data.sourceFileName)),
  ];

  return candidates.find((candidate) => candidate.length > 0) ?? 'Untitled Asset';
}

function resolveDraftDefaultName(
  exportNode: CanvasNode,
  sourceNode: CanvasNode | null | undefined
): string {
  if (sourceNode) {
    const sourceDisplayName = normalizeText(
      (sourceNode.data as { displayName?: unknown }).displayName
    );
    if (sourceDisplayName) {
      return sourceDisplayName;
    }
  }

  return resolveFallbackAssetName(exportNode);
}

function buildDraftGroups(drafts: BatchAssetDraft[]): BatchAssetDraftGroup[] {
  return GROUP_KIND_ORDER.map((kind) => {
    const groupDrafts = drafts.filter((draft) => draft.resolvedGroupKind === kind);
    return {
      kind,
      category: kind === 'unresolved' ? null : kind,
      drafts: groupDrafts,
    };
  }).filter((group) => group.drafts.length > 0);
}

export function buildBatchAssetDraftsFromSelectedNodes(
  nodeIds: string[]
): BatchAssetSourceResolution {
  const { nodes, edges } = useCanvasStore.getState();
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const drafts: BatchAssetDraft[] = [];
  const skippedNodeIds: string[] = [];

  nodeIds.forEach((nodeId) => {
    const node = nodeMap.get(nodeId);
    if (!node || !isExportImageNode(node) || resolveNodeAssetId(node)) {
      skippedNodeIds.push(nodeId);
      return;
    }

    const imageSource = resolveExportNodeImageSource(node);
    if (!imageSource) {
      skippedNodeIds.push(nodeId);
      return;
    }

    const incomingEdge = edges.find((edge) => edge.target === node.id) ?? null;
    const sourceNode = incomingEdge ? nodeMap.get(incomingEdge.source) : null;
    const parentNode =
      sourceNode?.parentId ? nodeMap.get(sourceNode.parentId) : null;
    const assetBatchGroup =
      sourceNode
      && isImageEditNode(sourceNode)
      && parentNode
      && isGroupNode(parentNode)
      && parentNode.data.visualStyle === 'assetBatchGroup'
        ? parentNode
        : null;
    const resolvedCategory = mapBatchKindToCategory(assetBatchGroup?.data.batchKind);

    drafts.push({
      id: node.id,
      nodeId: node.id,
      mediaSource: imageSource.mediaSource,
      previewSource: imageSource.previewSource,
      aspectRatio: normalizeText(node.data.aspectRatio) || '1:1',
      defaultName: resolveDraftDefaultName(node, sourceNode),
      resolvedCategory,
      resolvedGroupKind: resolvedCategory ?? 'unresolved',
      sourceImageEditNodeId: isImageEditNode(sourceNode) ? sourceNode.id : null,
      sourceGroupNodeId: assetBatchGroup?.id ?? null,
      sourceDisplayName: sourceNode
        ? normalizeText((sourceNode.data as { displayName?: unknown }).displayName) || null
        : null,
    });
  });

  return {
    drafts,
    groups: buildDraftGroups(drafts),
    skippedNodeIds,
    totalSelectedCount: nodeIds.length,
  };
}

function updateExportNodeAssetBinding(nodeId: string, item: AssetItemRecord) {
  useCanvasStore.getState().updateNodeData(nodeId, {
    displayName: item.name,
    imageUrl: item.sourcePath,
    previewImageUrl: item.previewPath,
    aspectRatio: item.aspectRatio,
    assetId: item.id,
    assetLibraryId: item.libraryId,
    assetName: item.name,
    assetCategory: item.category,
    sourceFileName: item.name,
    imageWidth: null,
    imageHeight: null,
  });
}

export async function submitBatchAssetsFromDrafts({
  libraryId,
  drafts,
  bindProjectLibrary = false,
}: BatchAssetSubmissionRequest): Promise<BatchAssetSubmissionResult> {
  const createItem = useAssetStore.getState().createItem;
  const setCurrentProjectAssetLibrary = useProjectStore.getState().setCurrentProjectAssetLibrary;
  const results: BatchAssetSubmissionResultItem[] = [];
  let hasSuccess = false;

  for (const draft of drafts) {
    try {
      const prepared = await prepareNodeImage(
        draft.mediaSource,
        undefined,
        createSharedMediaContext('image'),
        useSettingsStore.getState().canvasOverviewThumbnailMaxDimension
      );
      const item = await createItem({
        libraryId,
        category: draft.category,
        mediaType: 'image',
        subcategoryId: draft.subcategoryId,
        name: draft.name.trim(),
        description: '',
        tags: [],
        sourcePath: prepared.imageUrl,
        previewPath: prepared.previewImageUrl,
        mimeType: null,
        durationMs: null,
        aspectRatio: prepared.aspectRatio,
        metadata: null,
      });

      updateExportNodeAssetBinding(draft.nodeId, item);
      results.push({
        draftId: draft.draftId,
        nodeId: draft.nodeId,
        status: 'success',
        item,
      });
      hasSuccess = true;
    } catch (error) {
      results.push({
        draftId: draft.draftId,
        nodeId: draft.nodeId,
        status: 'error',
        error: error instanceof Error ? error.message : 'Failed to create asset item',
      });
    }
  }

  if (bindProjectLibrary && hasSuccess) {
    setCurrentProjectAssetLibrary(libraryId);
  }

  return { results };
}

export function countBatchAssetDraftsByCategory(
  drafts: BatchAssetDraft[]
): Record<BatchAssetResolvedGroupKind, number> {
  return drafts.reduce<Record<BatchAssetResolvedGroupKind, number>>(
    (accumulator, draft) => {
      accumulator[draft.resolvedGroupKind] += 1;
      return accumulator;
    },
    {
      character: 0,
      scene: 0,
      prop: 0,
      unresolved: 0,
    }
  );
}

export function isBatchAssetAddableNode(node: CanvasNode): boolean {
  return node.type === CANVAS_NODE_TYPES.exportImage
    && !resolveNodeAssetId(node)
    && resolveExportNodeImageSource(node) !== null;
}
