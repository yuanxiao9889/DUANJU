import { create } from 'zustand';

import {
  listGenerationHistoryPage,
  type GenerationHistoryItemRecord,
  type GenerationHistoryMediaType,
  type GenerationHistoryProjectOption,
} from '@/commands/generationHistory';
import { isTauriRuntime } from '@/lib/tauriRuntime';

type MediaTypeFilter = GenerationHistoryMediaType | 'all';

const PAGE_SIZE = 50;

interface GenerationHistoryState {
  isOpen: boolean;
  isLoading: boolean;
  isLoadingMore: boolean;
  error: string | null;
  items: GenerationHistoryItemRecord[];
  projects: GenerationHistoryProjectOption[];
  totalCount: number;
  offset: number;
  hasMore: boolean;
  searchQuery: string;
  mediaTypeFilter: MediaTypeFilter;
  projectFilter: string;
  open: () => void;
  close: () => void;
  setSearchQuery: (value: string) => void;
  setMediaTypeFilter: (value: MediaTypeFilter) => void;
  setProjectFilter: (value: string) => void;
  resetAndLoad: () => Promise<void>;
  loadMore: () => Promise<void>;
}

function toProjectId(value: string): string | null {
  return value && value !== 'all' ? value : null;
}

function toMediaType(value: MediaTypeFilter): GenerationHistoryMediaType | 'all' {
  return value;
}

export const useGenerationHistoryStore = create<GenerationHistoryState>((set, get) => ({
  isOpen: false,
  isLoading: false,
  isLoadingMore: false,
  error: null,
  items: [],
  projects: [],
  totalCount: 0,
  offset: 0,
  hasMore: false,
  searchQuery: '',
  mediaTypeFilter: 'all',
  projectFilter: 'all',

  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
  setSearchQuery: (value) => set({ searchQuery: value }),
  setMediaTypeFilter: (value) => set({ mediaTypeFilter: value }),
  setProjectFilter: (value) => set({ projectFilter: value }),

  resetAndLoad: async () => {
    if (!isTauriRuntime()) {
      set({
        items: [],
        projects: [],
        totalCount: 0,
        offset: 0,
        hasMore: false,
        isLoading: false,
        error: null,
      });
      return;
    }

    const state = get();
    set({ isLoading: true, error: null, offset: 0 });
    try {
      const page = await listGenerationHistoryPage({
        projectId: toProjectId(state.projectFilter),
        mediaType: toMediaType(state.mediaTypeFilter),
        search: state.searchQuery,
        limit: PAGE_SIZE,
        offset: 0,
      });
      set({
        items: page.items,
        projects: page.projects,
        totalCount: page.totalCount,
        offset: page.items.length,
        hasMore: page.items.length < page.totalCount,
        isLoading: false,
      });
    } catch (error) {
      console.error('Failed to load generation history page', error);
      set({
        isLoading: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },

  loadMore: async () => {
    const state = get();
    if (!isTauriRuntime() || state.isLoading || state.isLoadingMore || !state.hasMore) {
      return;
    }

    set({ isLoadingMore: true, error: null });
    try {
      const page = await listGenerationHistoryPage({
        projectId: toProjectId(state.projectFilter),
        mediaType: toMediaType(state.mediaTypeFilter),
        search: state.searchQuery,
        limit: PAGE_SIZE,
        offset: state.offset,
      });
      set((current) => {
        const nextItems = [...current.items, ...page.items];
        return {
          items: nextItems,
          projects: page.projects,
          totalCount: page.totalCount,
          offset: nextItems.length,
          hasMore: nextItems.length < page.totalCount,
          isLoadingMore: false,
        };
      });
    } catch (error) {
      console.error('Failed to load more generation history', error);
      set({
        isLoadingMore: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },
}));
