import { invoke } from '@tauri-apps/api/core';

export type GenerationHistoryMediaType = 'image' | 'video' | 'audio';

export interface GenerationHistoryItemRecord {
  id: string;
  projectId: string;
  projectName: string;
  mediaType: GenerationHistoryMediaType;
  sourcePath: string;
  previewPath: string | null;
  fileName: string;
  fileSize: number;
  mimeType: string | null;
  durationMs: number | null;
  aspectRatio: string;
  createdAt: number;
  modifiedAt: number;
  indexedAt: number;
  snapshotJson: string;
}

export interface GenerationHistoryProjectOption {
  projectId: string;
  projectName: string;
  count: number;
  updatedAt: number;
}

export interface GenerationHistoryListPagePayload {
  projectId?: string | null;
  mediaType?: GenerationHistoryMediaType | 'all' | null;
  search?: string | null;
  limit?: number;
  offset?: number;
}

export interface GenerationHistoryListPageResult {
  items: GenerationHistoryItemRecord[];
  projects: GenerationHistoryProjectOption[];
  totalCount: number;
  limit: number;
  offset: number;
  indexedAt: number;
}

export interface RecordGenerationOutputPayload {
  projectId: string;
  projectName: string;
  mediaType: GenerationHistoryMediaType;
  sourcePath: string;
  previewPath?: string | null;
  fileName: string;
  mimeType?: string | null;
  durationMs?: number | null;
  aspectRatio?: string | null;
  snapshotJson?: string | null;
}

export async function listGenerationHistoryPage(
  payload: GenerationHistoryListPagePayload
): Promise<GenerationHistoryListPageResult> {
  return await invoke<GenerationHistoryListPageResult>('list_generation_history_page', {
    payload,
  });
}

export async function getGenerationHistoryCount(): Promise<number> {
  return await invoke<number>('get_generation_history_count');
}

export async function recordGenerationOutput(
  payload: RecordGenerationOutputPayload
): Promise<GenerationHistoryItemRecord> {
  return await invoke<GenerationHistoryItemRecord>('record_generation_output', { payload });
}

export async function openGenerationHistoryItemInFolder(itemId: string): Promise<void> {
  await invoke('open_generation_history_item_in_folder', { itemId });
}
