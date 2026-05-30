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

export interface GenerationHistoryProjectGroup {
  projectId: string;
  projectName: string;
  updatedAt: number;
  items: GenerationHistoryItemRecord[];
}

export interface GenerationHistorySnapshot {
  groups: GenerationHistoryProjectGroup[];
  totalCount: number;
  indexedAt: number;
}

export interface GenerationHistoryScanResult {
  scannedCount: number;
  removedCount: number;
  snapshot: GenerationHistorySnapshot;
}

export async function listGenerationHistory(
  projectId?: string | null
): Promise<GenerationHistorySnapshot> {
  return await invoke<GenerationHistorySnapshot>('list_generation_history', {
    projectId: projectId ?? null,
  });
}

export async function scanGenerationHistory(
  projectId?: string | null
): Promise<GenerationHistoryScanResult> {
  return await invoke<GenerationHistoryScanResult>('scan_generation_history', {
    projectId: projectId ?? null,
  });
}

export async function openGenerationHistoryItemInFolder(itemId: string): Promise<void> {
  await invoke('open_generation_history_item_in_folder', { itemId });
}
