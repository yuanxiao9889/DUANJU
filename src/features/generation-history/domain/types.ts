import type {
  GenerationHistoryItemRecord,
  GenerationHistoryMediaType,
} from '@/commands/generationHistory';

export const GENERATION_HISTORY_DRAG_MIME_TYPE =
  'application/x-storyboard-generation-history';

export interface GenerationHistoryDragPayload {
  itemId: string;
  projectId: string;
  projectName: string;
  mediaType: GenerationHistoryMediaType;
  sourcePath: string;
  previewPath: string | null;
  fileName: string;
  mimeType: string | null;
  durationMs: number | null;
  aspectRatio: string;
}

export function toGenerationHistoryDragPayload(
  item: GenerationHistoryItemRecord
): GenerationHistoryDragPayload {
  return {
    itemId: item.id,
    projectId: item.projectId,
    projectName: item.projectName,
    mediaType: item.mediaType,
    sourcePath: item.sourcePath,
    previewPath: item.previewPath,
    fileName: item.fileName,
    mimeType: item.mimeType,
    durationMs: item.durationMs,
    aspectRatio: item.aspectRatio,
  };
}

export function serializeGenerationHistoryDragPayload(
  payload: GenerationHistoryDragPayload
): string {
  return JSON.stringify(payload);
}

export function parseGenerationHistoryDragPayload(
  value: string | null | undefined
): GenerationHistoryDragPayload | null {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as Partial<GenerationHistoryDragPayload>;
    if (
      typeof parsed.itemId !== 'string' ||
      typeof parsed.projectId !== 'string' ||
      typeof parsed.projectName !== 'string' ||
      (parsed.mediaType !== 'image' && parsed.mediaType !== 'video' && parsed.mediaType !== 'audio') ||
      typeof parsed.sourcePath !== 'string' ||
      (parsed.previewPath !== null && parsed.previewPath !== undefined && typeof parsed.previewPath !== 'string') ||
      typeof parsed.fileName !== 'string' ||
      (parsed.mimeType !== null && parsed.mimeType !== undefined && typeof parsed.mimeType !== 'string') ||
      (parsed.durationMs !== null && parsed.durationMs !== undefined && typeof parsed.durationMs !== 'number') ||
      typeof parsed.aspectRatio !== 'string'
    ) {
      return null;
    }

    return {
      itemId: parsed.itemId,
      projectId: parsed.projectId,
      projectName: parsed.projectName,
      mediaType: parsed.mediaType,
      sourcePath: parsed.sourcePath,
      previewPath: parsed.previewPath ?? null,
      fileName: parsed.fileName,
      mimeType: parsed.mimeType ?? null,
      durationMs: parsed.durationMs ?? null,
      aspectRatio: parsed.aspectRatio,
    };
  } catch {
    return null;
  }
}
