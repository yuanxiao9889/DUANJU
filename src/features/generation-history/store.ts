import { create } from 'zustand';

import {
  listGenerationHistory,
  scanGenerationHistory,
  type GenerationHistoryMediaType,
  type GenerationHistorySnapshot,
} from '@/commands/generationHistory';
import { isTauriRuntime } from '@/lib/tauriRuntime';

type MediaTypeFilter = GenerationHistoryMediaType | 'all';

interface GenerationHistoryState {
  isOpen: boolean;
  isLoading: boolean;
  isScanning: boolean;
  error: string | null;
  snapshot: GenerationHistorySnapshot;
  searchQuery: string;
  mediaTypeFilter: MediaTypeFilter;
  projectFilter: string;
  open: () => void;
  close: () => void;
  setSearchQuery: (value: string) => void;
  setMediaTypeFilter: (value: MediaTypeFilter) => void;
  setProjectFilter: (value: string) => void;
  load: (projectId?: string | null) => Promise<void>;
  scan: (projectId?: string | null) => Promise<void>;
}

const EMPTY_SNAPSHOT: GenerationHistorySnapshot = {
  groups: [],
  totalCount: 0,
  indexedAt: 0,
};

export const useGenerationHistoryStore = create<GenerationHistoryState>((set, get) => ({
  isOpen: false,
  isLoading: false,
  isScanning: false,
  error: null,
  snapshot: EMPTY_SNAPSHOT,
  searchQuery: '',
  mediaTypeFilter: 'all',
  projectFilter: 'all',

  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
  setSearchQuery: (value) => set({ searchQuery: value }),
  setMediaTypeFilter: (value) => set({ mediaTypeFilter: value }),
  setProjectFilter: (value) => set({ projectFilter: value }),

  load: async (projectId) => {
    if (!isTauriRuntime()) {
      set({ snapshot: EMPTY_SNAPSHOT, isLoading: false, error: null });
      return;
    }

    set({ isLoading: true, error: null });
    try {
      const snapshot = await listGenerationHistory(projectId);
      set({ snapshot, isLoading: false });
    } catch (error) {
      console.error('Failed to load generation history', error);
      set({
        isLoading: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },

  scan: async (projectId) => {
    if (!isTauriRuntime()) {
      set({ snapshot: EMPTY_SNAPSHOT, isScanning: false, error: null });
      return;
    }

    set({ isScanning: true, error: null });
    try {
      const result = await scanGenerationHistory(projectId);
      set({ snapshot: result.snapshot, isScanning: false });
    } catch (error) {
      console.error('Failed to scan generation history', error);
      set({
        isScanning: false,
        error: error instanceof Error ? error.message : String(error),
      });
      if (get().snapshot.indexedAt === 0) {
        await get().load(projectId);
      }
    }
  },
}));
