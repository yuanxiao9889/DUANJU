import { create } from 'zustand';

import {
  deleteGenerationHistoryItem,
  listGenerationHistoryItems,
  upsertGenerationHistoryItem,
} from '@/commands/generationHistory';
import type { GenerationHistoryItemRecord } from '@/features/canvas/application/generationHistory';
import { collectGenerationHistoryRecords } from '@/features/canvas/application/generationHistory';
import { useCanvasStore } from '@/stores/canvasStore';

interface GenerationHistoryState {
  currentProjectId: string | null;
  items: GenerationHistoryItemRecord[];
  isHydrating: boolean;
  openProject: (projectId: string) => Promise<void>;
  closeProject: () => void;
  syncFromCanvasSnapshot: () => Promise<void>;
  upsertItems: (items: GenerationHistoryItemRecord[]) => Promise<void>;
  removeItem: (itemId: string) => Promise<void>;
}

let openProjectRequestSeq = 0;

function sortItems(items: GenerationHistoryItemRecord[]): GenerationHistoryItemRecord[] {
  return [...items].sort((left, right) => (
    right.createdAt - left.createdAt
    || right.updatedAt - left.updatedAt
    || left.id.localeCompare(right.id)
  ));
}

function mergeItems(
  existingItems: GenerationHistoryItemRecord[],
  incomingItems: GenerationHistoryItemRecord[]
): GenerationHistoryItemRecord[] {
  const nextItems = [...existingItems];
  for (const item of incomingItems) {
    const existingIndex = nextItems.findIndex((candidate) => candidate.id === item.id);
    if (existingIndex >= 0) {
      nextItems[existingIndex] = item;
    } else {
      nextItems.push(item);
    }
  }

  return sortItems(nextItems);
}

function hasGenerationHistoryContentChanged(
  existingItem: GenerationHistoryItemRecord,
  incomingItem: GenerationHistoryItemRecord
): boolean {
  return existingItem.projectId !== incomingItem.projectId
    || existingItem.mediaType !== incomingItem.mediaType
    || existingItem.nodeType !== incomingItem.nodeType
    || existingItem.title !== incomingItem.title
    || existingItem.snapshotJson !== incomingItem.snapshotJson
    || existingItem.previewPath !== incomingItem.previewPath
    || existingItem.mimeType !== incomingItem.mimeType
    || existingItem.durationMs !== incomingItem.durationMs
    || existingItem.aspectRatio !== incomingItem.aspectRatio
    || existingItem.sourcePath !== incomingItem.sourcePath;
}

function mergeHistoryItemTimestamps(
  incomingItem: GenerationHistoryItemRecord,
  existingItem?: GenerationHistoryItemRecord
): GenerationHistoryItemRecord {
  if (!existingItem) {
    return incomingItem;
  }

  const createdAt = Math.min(existingItem.createdAt, incomingItem.createdAt);
  const contentChanged = hasGenerationHistoryContentChanged(existingItem, incomingItem);

  return {
    ...incomingItem,
    createdAt,
    updatedAt: contentChanged
      ? Math.max(existingItem.updatedAt, incomingItem.updatedAt)
      : existingItem.updatedAt,
  };
}

export const useGenerationHistoryStore = create<GenerationHistoryState>((set, get) => ({
  currentProjectId: null,
  items: [],
  isHydrating: false,

  openProject: async (projectId: string) => {
    const normalizedProjectId = projectId.trim();
    if (!normalizedProjectId) {
      set({
        currentProjectId: null,
        items: [],
        isHydrating: false,
      });
      return;
    }

    const requestId = openProjectRequestSeq + 1;
    openProjectRequestSeq = requestId;
    set({
      currentProjectId: normalizedProjectId,
      isHydrating: true,
    });

    try {
      const records = await listGenerationHistoryItems(normalizedProjectId);
      if (openProjectRequestSeq !== requestId) {
        return;
      }

      set({
        currentProjectId: normalizedProjectId,
        items: sortItems(records),
        isHydrating: false,
      });
    } catch (error) {
      console.error('[generationHistoryStore] failed to hydrate project history', {
        projectId: normalizedProjectId,
        error,
      });
      if (openProjectRequestSeq !== requestId) {
        return;
      }
      set({
        currentProjectId: normalizedProjectId,
        items: [],
        isHydrating: false,
      });
    }
  },

  closeProject: () => {
    openProjectRequestSeq += 1;
    set({
      currentProjectId: null,
      items: [],
      isHydrating: false,
    });
  },

  syncFromCanvasSnapshot: async () => {
    const currentProjectId = get().currentProjectId;
    if (!currentProjectId) {
      return;
    }

    const { nodes, edges } = useCanvasStore.getState();
    const records = collectGenerationHistoryRecords(currentProjectId, nodes, edges);
    if (records.length === 0) {
      return;
    }

    await get().upsertItems(records);
  },

  upsertItems: async (items) => {
    const currentProjectId = get().currentProjectId;
    if (!currentProjectId || items.length === 0) {
      return;
    }

    const currentItems = get().items;
    const currentItemsById = new Map(currentItems.map((item) => [item.id, item] as const));
    const normalizedItems = items
      .filter((item) => item.projectId === currentProjectId)
      .map((item) => mergeHistoryItemTimestamps(item, currentItemsById.get(item.id)));
    if (normalizedItems.length === 0) {
      return;
    }

    const changedItems = normalizedItems.filter((item) => {
      const existingItem = currentItemsById.get(item.id);
      return !existingItem
        || item.createdAt < existingItem.createdAt
        || hasGenerationHistoryContentChanged(existingItem, item);
    });

    if (changedItems.length === 0) {
      return;
    }

    await Promise.all(changedItems.map(async (item) => {
      await upsertGenerationHistoryItem(item);
    }));

    set((state) => {
      if (state.currentProjectId !== currentProjectId) {
        return state;
      }

      return {
        ...state,
        items: mergeItems(state.items, changedItems),
      };
    });
  },

  removeItem: async (itemId) => {
    const normalizedItemId = itemId.trim();
    if (!normalizedItemId) {
      return;
    }

    await deleteGenerationHistoryItem(normalizedItemId);
    set((state) => ({
      ...state,
      items: state.items.filter((item) => item.id !== normalizedItemId),
    }));
  },
}));
