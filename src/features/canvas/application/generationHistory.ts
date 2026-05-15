import type { Node } from '@xyflow/react';

import {
  CANVAS_NODE_TYPES,
  isAudioNode,
  isExportImageNode,
  isGptBestVideoResultNode,
  isJimengImageResultNode,
  isJimengVideoResultNode,
  isMjResultNode,
  isSeedanceVideoResultNode,
  isViduVideoResultNode,
  isVideoNode,
  type AudioNodeData,
  type CanvasEdge,
  type CanvasNode,
  type CanvasNodeType,
  type ExportImageNodeData,
  type GptBestVideoResultNodeData,
  type JimengImageResultNodeData,
  type JimengVideoResultNodeData,
  type MjBatchImageItem,
  type MjResultBatch,
  type MjResultNodeData,
  type SeedanceVideoResultNodeData,
  type ViduVideoResultNodeData,
  type VideoNodeData,
} from '@/features/canvas/domain/canvasNodes';
import { resolveNodeDisplayName } from '@/features/canvas/domain/nodeDisplay';

export const GENERATION_HISTORY_DRAG_MIME_TYPE = 'application/x-storyboard-generation-history';

export type GenerationHistoryMediaType = 'image' | 'video' | 'audio';

export interface GenerationHistoryItemRecord {
  id: string;
  projectId: string;
  mediaType: GenerationHistoryMediaType;
  nodeType: CanvasNodeType;
  title: string;
  snapshotJson: string;
  sourcePath: string;
  previewPath: string | null;
  mimeType: string | null;
  durationMs: number | null;
  aspectRatio: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface CanvasGenerationHistoryDragPayload {
  itemId: string;
  projectId: string;
}

export interface GenerationHistoryDraft {
  id: string;
  nodeId: string;
  mediaType: GenerationHistoryMediaType;
  nodeType: CanvasNodeType;
  title: string;
  snapshotNode: CanvasNode;
  sourcePath: string;
  previewPath: string | null;
  mimeType: string | null;
  durationMs: number | null;
  aspectRatio: string | null;
  createdAt: number;
  updatedAt: number;
}

type VideoLikeNode =
  | Node<JimengVideoResultNodeData, typeof CANVAS_NODE_TYPES.jimengVideoResult>
  | Node<SeedanceVideoResultNodeData, typeof CANVAS_NODE_TYPES.seedanceVideoResult>
  | Node<GptBestVideoResultNodeData, typeof CANVAS_NODE_TYPES.gptBestVideoResult>
  | Node<ViduVideoResultNodeData, typeof CANVAS_NODE_TYPES.viduVideoResult>
  | Node<VideoNodeData, typeof CANVAS_NODE_TYPES.video>;

function cloneValue<T>(value: T): T {
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }

  return JSON.parse(JSON.stringify(value)) as T;
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeNullableText(value: unknown): string | null {
  const normalized = normalizeText(value);
  return normalized.length > 0 ? normalized : null;
}

function normalizeFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function normalizeTimestamp(value: unknown, fallback: number): number {
  const normalized = normalizeFiniteNumber(value);
  return normalized !== null && normalized > 0 ? normalized : fallback;
}

function normalizeDurationMsFromSeconds(value: unknown): number | null {
  const seconds = normalizeFiniteNumber(value);
  if (seconds === null || seconds < 0) {
    return null;
  }

  return Math.round(seconds * 1000);
}

function buildGenerationHistoryItemId(
  projectId: string,
  mediaType: GenerationHistoryMediaType,
  sourcePath: string
): string {
  return `generation-history:${projectId}:${mediaType}:${sourcePath}`;
}

function buildHistoryDragPayload(item: GenerationHistoryItemRecord): CanvasGenerationHistoryDragPayload {
  return {
    itemId: item.id,
    projectId: item.projectId,
  };
}

export function serializeGenerationHistoryDragPayload(
  item: GenerationHistoryItemRecord
): string {
  return JSON.stringify(buildHistoryDragPayload(item));
}

export function parseGenerationHistoryDragPayload(
  value: string | null | undefined
): CanvasGenerationHistoryDragPayload | null {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as Partial<CanvasGenerationHistoryDragPayload>;
    if (
      typeof parsed.itemId !== 'string'
      || parsed.itemId.trim().length === 0
      || typeof parsed.projectId !== 'string'
      || parsed.projectId.trim().length === 0
    ) {
      return null;
    }

    return {
      itemId: parsed.itemId.trim(),
      projectId: parsed.projectId.trim(),
    };
  } catch {
    return null;
  }
}

function withClearedGenerationState<T extends Record<string, unknown>>(value: T): T {
  const nextValue = cloneValue(value);

  for (const key of [
    'isGenerating',
    'generationJobId',
    'generationError',
    'generationFailureStage',
    'generationProgress',
    'queuePosition',
    'statusText',
    'lastError',
    'generationStartedAt',
    'generationDurationMs',
  ]) {
    if (key in nextValue) {
      delete nextValue[key];
    }
  }

  return nextValue;
}

function sanitizeMjBatch(batch: MjResultBatch, image: MjBatchImageItem): MjResultBatch {
  const nextBatch = cloneValue(batch);
  nextBatch.images = [cloneValue(image)];
  nextBatch.isPolling = false;
  if (!normalizeText(nextBatch.status)) {
    nextBatch.status = 'SUCCESS';
  }
  if (!normalizeText(nextBatch.progress)) {
    nextBatch.progress = '100%';
  }
  return nextBatch;
}

function buildImageItemTitle(baseTitle: string, index: number, fileName?: string | null): string {
  const normalizedFileName = normalizeText(fileName);
  if (normalizedFileName) {
    return normalizedFileName;
  }

  return `${baseTitle} ${index + 1}`;
}

function createDraftRecord(
  projectId: string,
  nodeId: string,
  nodeType: CanvasNodeType,
  mediaType: GenerationHistoryMediaType,
  title: string,
  snapshotNode: CanvasNode,
  sourcePath: string,
  previewPath: string | null,
  mimeType: string | null,
  durationMs: number | null,
  aspectRatio: string | null,
  createdAt: number,
  updatedAt: number
): GenerationHistoryDraft {
  return {
    id: buildGenerationHistoryItemId(projectId, mediaType, sourcePath),
    nodeId,
    mediaType,
    nodeType,
    title,
    snapshotNode,
    sourcePath,
    previewPath,
    mimeType,
    durationMs,
    aspectRatio,
    createdAt,
    updatedAt,
  };
}

function toRecord(projectId: string, draft: GenerationHistoryDraft): GenerationHistoryItemRecord {
  return {
    id: draft.id,
    projectId,
    mediaType: draft.mediaType,
    nodeType: draft.nodeType,
    title: draft.title,
    snapshotJson: JSON.stringify(draft.snapshotNode),
    sourcePath: draft.sourcePath,
    previewPath: draft.previewPath,
    mimeType: draft.mimeType,
    durationMs: draft.durationMs,
    aspectRatio: draft.aspectRatio,
    createdAt: draft.createdAt,
    updatedAt: draft.updatedAt,
  };
}

function isGeneratedVideoNode(
  node: CanvasNode,
  incomingSourceNodes: CanvasNode[]
): node is Node<VideoNodeData, typeof CANVAS_NODE_TYPES.video> {
  if (!isVideoNode(node)) {
    return false;
  }

  const generationSourceNodeId = normalizeText(
    (node.data as Record<string, unknown>).generationSourceNodeId
  );
  if (generationSourceNodeId.length > 0) {
    return true;
  }

  return incomingSourceNodes.some((sourceNode) => (
    sourceNode.type === CANVAS_NODE_TYPES.seedvr2VideoUpscale
  ));
}

function buildIncomingSourceMap(
  nodes: CanvasNode[],
  edges: CanvasEdge[]
): Map<string, CanvasNode[]> {
  const nodeMap = new Map(nodes.map((node) => [node.id, node] as const));
  const incomingSourceMap = new Map<string, CanvasNode[]>();

  for (const edge of edges) {
    const targetNode = nodeMap.get(edge.target);
    const sourceNode = nodeMap.get(edge.source);
    if (!targetNode || !sourceNode) {
      continue;
    }

    const existing = incomingSourceMap.get(targetNode.id) ?? [];
    existing.push(sourceNode);
    incomingSourceMap.set(targetNode.id, existing);
  }

  return incomingSourceMap;
}

function appendExportImageDrafts(
  drafts: GenerationHistoryDraft[],
  projectId: string,
  node: Node<ExportImageNodeData, typeof CANVAS_NODE_TYPES.exportImage>,
  now: number
): void {
  const sourcePath =
    normalizeNullableText(node.data.imageUrl)
    ?? normalizeNullableText(node.data.previewImageUrl);
  if (!sourcePath || node.data.isGenerating) {
    return;
  }

  const previewPath = normalizeNullableText(node.data.previewImageUrl) ?? sourcePath;
  const snapshotNode = {
    ...cloneValue(node),
    data: withClearedGenerationState(node.data as Record<string, unknown>),
  } as CanvasNode;
  const createdAt = normalizeTimestamp(node.data.generationSummary?.generatedAt, now);

  drafts.push(
    createDraftRecord(
      projectId,
      node.id,
      node.type,
      'image',
      resolveNodeDisplayName(node.type, node.data),
      snapshotNode,
      sourcePath,
      previewPath,
      null,
      null,
      normalizeNullableText(node.data.aspectRatio),
      createdAt,
      createdAt
    )
  );
}

function appendJimengImageResultDrafts(
  drafts: GenerationHistoryDraft[],
  projectId: string,
  node: Node<JimengImageResultNodeData, typeof CANVAS_NODE_TYPES.jimengImageResult>,
  now: number
): void {
  const baseTitle = resolveNodeDisplayName(node.type, node.data);
  const createdAt = normalizeTimestamp(node.data.lastGeneratedAt, now);

  node.data.resultImages.forEach((item, index) => {
    const sourcePath =
      normalizeNullableText(item.imageUrl)
      ?? normalizeNullableText(item.sourceUrl)
      ?? normalizeNullableText(item.previewImageUrl);
    if (!sourcePath) {
      return;
    }

    const previewPath =
      normalizeNullableText(item.previewImageUrl)
      ?? normalizeNullableText(item.imageUrl)
      ?? normalizeNullableText(item.sourceUrl)
      ?? sourcePath;
    const snapshotNode = {
      ...cloneValue(node),
      data: {
        ...withClearedGenerationState(node.data as Record<string, unknown>),
        gridRows: 1,
        gridCols: 1,
        resultImages: [cloneValue(item)],
        aspectRatio: normalizeText(item.aspectRatio) || normalizeText(node.data.aspectRatio),
      },
    } as CanvasNode;

    drafts.push(
      createDraftRecord(
        projectId,
        node.id,
        node.type,
        'image',
        buildImageItemTitle(baseTitle, index, item.fileName),
        snapshotNode,
        sourcePath,
        previewPath,
        null,
        null,
        normalizeNullableText(item.aspectRatio) ?? normalizeNullableText(node.data.aspectRatio),
        createdAt,
        createdAt
      )
    );
  });
}

function appendMjResultDrafts(
  drafts: GenerationHistoryDraft[],
  projectId: string,
  node: Node<MjResultNodeData, typeof CANVAS_NODE_TYPES.mjResult>,
  now: number
): void {
  const baseTitle = resolveNodeDisplayName(node.type, node.data);

  for (const batch of node.data.batches) {
    const batchCreatedAt = normalizeTimestamp(batch.finishTime ?? batch.submitTime ?? node.data.lastGeneratedAt, now);
    batch.images.forEach((item, index) => {
      const sourcePath =
        normalizeNullableText(item.imageUrl)
        ?? normalizeNullableText(item.previewImageUrl)
        ?? normalizeNullableText(item.sourceUrl);
      if (!sourcePath) {
        return;
      }

      const previewPath =
        normalizeNullableText(item.previewImageUrl)
        ?? normalizeNullableText(item.imageUrl)
        ?? normalizeNullableText(item.sourceUrl)
        ?? sourcePath;
      const snapshotNode = {
        ...cloneValue(node),
        data: {
          ...withClearedGenerationState(node.data as Record<string, unknown>),
          batches: [sanitizeMjBatch(batch, item)],
          activeBatchId: batch.id,
        },
      } as CanvasNode;

      drafts.push(
        createDraftRecord(
          projectId,
          node.id,
          node.type,
          'image',
          buildImageItemTitle(baseTitle, index, null),
          snapshotNode,
          sourcePath,
          previewPath,
          null,
          null,
          normalizeNullableText(item.aspectRatio),
          batchCreatedAt,
          batchCreatedAt
        )
      );
    });
  }
}

function appendVideoDraft(
  drafts: GenerationHistoryDraft[],
  projectId: string,
  node: VideoLikeNode,
  now: number
): void {
  const sourcePath = normalizeNullableText(node.data.videoUrl);
  if (!sourcePath || node.data.isGenerating) {
    return;
  }

  const previewPath =
    normalizeNullableText(node.data.previewImageUrl)
    ?? normalizeNullableText((node.data as Record<string, unknown>).posterSourceUrl);
  const createdAt = normalizeTimestamp(
    (node.data as Record<string, unknown>).lastGeneratedAt,
    now
  );
  const snapshotNode = {
    ...cloneValue(node),
    data: withClearedGenerationState(node.data as Record<string, unknown>),
  } as CanvasNode;

  drafts.push(
    createDraftRecord(
      projectId,
      node.id,
      node.type,
      'video',
      resolveNodeDisplayName(node.type, node.data),
      snapshotNode,
      sourcePath,
      previewPath,
      null,
      normalizeDurationMsFromSeconds(node.data.duration),
      normalizeNullableText(node.data.aspectRatio),
      createdAt,
      createdAt
    )
  );
}

function appendAudioDraft(
  drafts: GenerationHistoryDraft[],
  projectId: string,
  node: Node<AudioNodeData, typeof CANVAS_NODE_TYPES.audio>,
  now: number
): void {
  if (!node.data.generationSource) {
    return;
  }

  const sourcePath = normalizeNullableText(node.data.audioUrl);
  if (!sourcePath || node.data.isGenerating) {
    return;
  }

  const createdAt = normalizeTimestamp(node.data.lastGeneratedAt, now);
  const snapshotNode = {
    ...cloneValue(node),
    data: withClearedGenerationState(node.data as Record<string, unknown>),
  } as CanvasNode;

  drafts.push(
    createDraftRecord(
      projectId,
      node.id,
      node.type,
      'audio',
      resolveNodeDisplayName(node.type, node.data),
      snapshotNode,
      sourcePath,
      normalizeNullableText(node.data.previewImageUrl),
      normalizeNullableText(node.data.mimeType),
      normalizeDurationMsFromSeconds(node.data.duration),
      null,
      createdAt,
      createdAt
    )
  );
}

export function collectGenerationHistoryDrafts(
  projectId: string,
  nodes: CanvasNode[],
  edges: CanvasEdge[]
): GenerationHistoryDraft[] {
  const drafts: GenerationHistoryDraft[] = [];
  const incomingSourceMap = buildIncomingSourceMap(nodes, edges);
  const now = Date.now();

  for (const node of nodes) {
    if (isExportImageNode(node)) {
      appendExportImageDrafts(drafts, projectId, node, now);
      continue;
    }

    if (isJimengImageResultNode(node)) {
      appendJimengImageResultDrafts(drafts, projectId, node, now);
      continue;
    }

    if (isMjResultNode(node)) {
      appendMjResultDrafts(drafts, projectId, node, now);
      continue;
    }

    if (
      isJimengVideoResultNode(node)
      || isSeedanceVideoResultNode(node)
      || isGptBestVideoResultNode(node)
      || isViduVideoResultNode(node)
    ) {
      appendVideoDraft(drafts, projectId, node, now);
      continue;
    }

    if (isAudioNode(node)) {
      appendAudioDraft(drafts, projectId, node, now);
      continue;
    }

    const incomingSourceNodes = incomingSourceMap.get(node.id) ?? [];
    if (isGeneratedVideoNode(node, incomingSourceNodes)) {
      appendVideoDraft(drafts, projectId, node, now);
    }
  }

  const uniqueDrafts = new Map<string, GenerationHistoryDraft>();
  for (const draft of drafts) {
    const existing = uniqueDrafts.get(draft.id);
    if (!existing || draft.updatedAt >= existing.updatedAt) {
      uniqueDrafts.set(draft.id, draft);
    }
  }

  return Array.from(uniqueDrafts.values()).sort((left, right) => (
    right.createdAt - left.createdAt || right.updatedAt - left.updatedAt
  ));
}

export function collectGenerationHistoryRecords(
  projectId: string,
  nodes: CanvasNode[],
  edges: CanvasEdge[]
): GenerationHistoryItemRecord[] {
  return collectGenerationHistoryDrafts(projectId, nodes, edges).map((draft) => (
    toRecord(projectId, draft)
  ));
}

function appendGenerationHistorySignaturePart(
  parts: string[],
  projectId: string,
  mediaType: GenerationHistoryMediaType,
  sourcePath: string | null | undefined
): void {
  const normalizedSourcePath = normalizeNullableText(sourcePath);
  if (!normalizedSourcePath) {
    return;
  }

  parts.push(buildGenerationHistoryItemId(projectId, mediaType, normalizedSourcePath));
}

export function buildGenerationHistoryContentSignature(
  projectId: string,
  nodes: CanvasNode[],
  edges: CanvasEdge[]
): string {
  const normalizedProjectId = normalizeText(projectId);
  if (!normalizedProjectId) {
    return '';
  }

  const parts: string[] = [];
  const incomingSourceMap = buildIncomingSourceMap(nodes, edges);

  for (const node of nodes) {
    if (isExportImageNode(node)) {
      if (!node.data.isGenerating) {
        appendGenerationHistorySignaturePart(
          parts,
          normalizedProjectId,
          'image',
          normalizeNullableText(node.data.imageUrl) ?? normalizeNullableText(node.data.previewImageUrl)
        );
      }
      continue;
    }

    if (isJimengImageResultNode(node)) {
      node.data.resultImages.forEach((item) => {
        appendGenerationHistorySignaturePart(
          parts,
          normalizedProjectId,
          'image',
          normalizeNullableText(item.imageUrl)
            ?? normalizeNullableText(item.sourceUrl)
            ?? normalizeNullableText(item.previewImageUrl)
        );
      });
      continue;
    }

    if (isMjResultNode(node)) {
      node.data.batches.forEach((batch) => {
        batch.images.forEach((item) => {
          appendGenerationHistorySignaturePart(
            parts,
            normalizedProjectId,
            'image',
            normalizeNullableText(item.imageUrl)
              ?? normalizeNullableText(item.previewImageUrl)
              ?? normalizeNullableText(item.sourceUrl)
          );
        });
      });
      continue;
    }

    if (
      isJimengVideoResultNode(node)
      || isSeedanceVideoResultNode(node)
      || isGptBestVideoResultNode(node)
      || isViduVideoResultNode(node)
    ) {
      if (!node.data.isGenerating) {
        appendGenerationHistorySignaturePart(
          parts,
          normalizedProjectId,
          'video',
          node.data.videoUrl
        );
      }
      continue;
    }

    if (isAudioNode(node)) {
      if (node.data.generationSource && !node.data.isGenerating) {
        appendGenerationHistorySignaturePart(
          parts,
          normalizedProjectId,
          'audio',
          node.data.audioUrl
        );
      }
      continue;
    }

    const incomingSourceNodes = incomingSourceMap.get(node.id) ?? [];
    if (isGeneratedVideoNode(node, incomingSourceNodes) && !node.data.isGenerating) {
      appendGenerationHistorySignaturePart(
        parts,
        normalizedProjectId,
        'video',
        node.data.videoUrl
      );
    }
  }

  return Array.from(new Set(parts)).sort().join('\n');
}

export function parseGenerationHistorySnapshotNode(
  record: GenerationHistoryItemRecord
): CanvasNode | null {
  try {
    const parsed = JSON.parse(record.snapshotJson) as CanvasNode | null;
    if (!parsed || typeof parsed !== 'object' || typeof parsed.type !== 'string') {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

export function isGeneratedContentNode(
  node: CanvasNode,
  incomingSourceNodes: CanvasNode[]
): boolean {
  if (
    node.type === CANVAS_NODE_TYPES.exportImage
    || node.type === CANVAS_NODE_TYPES.jimengImageResult
    || node.type === CANVAS_NODE_TYPES.mjResult
    || node.type === CANVAS_NODE_TYPES.jimengVideoResult
    || node.type === CANVAS_NODE_TYPES.seedanceVideoResult
    || node.type === CANVAS_NODE_TYPES.gptBestVideoResult
  ) {
    return true;
  }

  if (isAudioNode(node)) {
    return Boolean(node.data.generationSource);
  }

  return isGeneratedVideoNode(node, incomingSourceNodes);
}

export function collectGeneratedContentNodeIds(
  nodes: CanvasNode[],
  edges: CanvasEdge[]
): string[] {
  const incomingSourceMap = buildIncomingSourceMap(nodes, edges);
  return nodes
    .filter((node) => isGeneratedContentNode(node, incomingSourceMap.get(node.id) ?? []))
    .map((node) => node.id);
}

export function collectGenerationHistoryItemNodeIds(
  item: GenerationHistoryItemRecord,
  nodes: CanvasNode[],
  edges: CanvasEdge[]
): string[] {
  const incomingSourceMap = buildIncomingSourceMap(nodes, edges);
  const targetSourcePath = normalizeNullableText(item.sourcePath);
  const targetPreviewPath = normalizeNullableText(item.previewPath);

  if (!targetSourcePath && !targetPreviewPath) {
    return [];
  }

  const matchesPath = (candidate: string | null | undefined): boolean => {
    const normalizedCandidate = normalizeNullableText(candidate);
    return Boolean(
      normalizedCandidate
      && (
        normalizedCandidate === targetSourcePath
        || normalizedCandidate === targetPreviewPath
      )
    );
  };

  return nodes
    .filter((node) => isGeneratedContentNode(node, incomingSourceMap.get(node.id) ?? []))
    .filter((node) => {
      if (isExportImageNode(node)) {
        return matchesPath(node.data.imageUrl) || matchesPath(node.data.previewImageUrl);
      }

      if (isJimengImageResultNode(node)) {
        return node.data.resultImages.some((image) => (
          matchesPath(image.imageUrl)
          || matchesPath(image.previewImageUrl)
          || matchesPath(image.sourceUrl)
        ));
      }

      if (isMjResultNode(node)) {
        return node.data.batches.some((batch) => batch.images.some((image) => (
          matchesPath(image.imageUrl)
          || matchesPath(image.previewImageUrl)
          || matchesPath(image.sourceUrl)
        )));
      }

      if (
        isJimengVideoResultNode(node)
        || isSeedanceVideoResultNode(node)
        || isGptBestVideoResultNode(node)
        || isViduVideoResultNode(node)
        || isVideoNode(node)
      ) {
        return (
          matchesPath(node.data.videoUrl)
          || matchesPath(node.data.previewImageUrl)
          || matchesPath((node.data as Record<string, unknown>).posterSourceUrl as string | null | undefined)
        );
      }

      if (isAudioNode(node)) {
        return matchesPath(node.data.audioUrl) || matchesPath(node.data.previewImageUrl);
      }

      return false;
    })
    .map((node) => node.id);
}
