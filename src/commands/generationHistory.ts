import { invoke } from '@tauri-apps/api/core';
import type { GenerationHistoryItemRecord } from '@/features/canvas/application/generationHistory';

export async function listGenerationHistoryItems(
  projectId: string
): Promise<GenerationHistoryItemRecord[]> {
  return await invoke<GenerationHistoryItemRecord[]>('list_generation_history_items', {
    projectId,
  });
}

export async function upsertGenerationHistoryItem(
  record: GenerationHistoryItemRecord
): Promise<void> {
  await invoke('upsert_generation_history_item', { record });
}

export async function deleteGenerationHistoryItem(itemId: string): Promise<void> {
  await invoke('delete_generation_history_item', { itemId });
}
