import { create } from 'zustand';

import {
  addNodeMediaToClipLibrary,
  createClipFolder,
  createClipLibrary,
  createClipLibraryChapter,
  deleteClipFolder,
  deleteClipItem,
  deleteClipLibrary,
  deleteClipLibraryChapter,
  getClipDeleteImpact,
  getClipLibrarySnapshot,
  listClipLibraries,
  moveClipFolder,
  moveClipItem,
  moveClipLibraryChapter,
  renameClipFolder,
  renameClipItem,
  saveClipLibraryUiState,
  updateClipItemDescription,
  updateClipLibrary,
  updateClipLibraryChapter,
} from '@/commands/clipLibrary';
import type {
  AddNodeMediaToClipLibraryPayload,
  AddNodeMediaToClipLibraryResult,
  ClipDeleteImpactQuery,
  ClipDeleteImpactRecord,
  ClipFolderRecord,
  ClipItemRecord,
  ClipLibraryChapterRecord,
  ClipLibraryRecord,
  ClipLibrarySnapshot,
  ClipLibraryUiStateRecord,
  CreateClipFolderPayload,
  CreateClipLibraryChapterPayload,
  CreateClipLibraryPayload,
  MoveClipFolderPayload,
  MoveClipItemPayload,
  MoveClipLibraryChapterPayload,
  RenameClipFolderPayload,
  RenameClipItemPayload,
  SaveClipLibraryUiStatePayload,
  UpdateClipItemDescriptionPayload,
  UpdateClipLibraryChapterPayload,
  UpdateClipLibraryPayload,
} from '@/features/clip-library/domain/types';

function sortLibraries(libraries: ClipLibraryRecord[]): ClipLibraryRecord[] {
  return [...libraries].sort((left, right) => right.updatedAt - left.updatedAt);
}

interface ClipLibraryState {
  libraries: ClipLibraryRecord[];
  currentLibraryId: string | null;
  currentSnapshot: ClipLibrarySnapshot | null;
  isHydrated: boolean;
  isLoadingLibraries: boolean;
  isLoadingSnapshot: boolean;

  hydrate: () => Promise<void>;
  refreshLibraries: () => Promise<void>;
  loadLibrary: (libraryId: string | null) => Promise<ClipLibrarySnapshot | null>;
  refreshCurrentLibrary: () => Promise<ClipLibrarySnapshot | null>;

  createLibrary: (payload: CreateClipLibraryPayload) => Promise<ClipLibraryRecord>;
  renameLibrary: (payload: UpdateClipLibraryPayload) => Promise<ClipLibraryRecord>;
  removeLibrary: (libraryId: string) => Promise<void>;

  createChapter: (payload: CreateClipLibraryChapterPayload) => Promise<ClipLibraryChapterRecord>;
  renameChapter: (payload: UpdateClipLibraryChapterPayload) => Promise<ClipLibraryChapterRecord>;
  moveChapter: (payload: MoveClipLibraryChapterPayload) => Promise<ClipLibrarySnapshot>;
  deleteChapter: (chapterId: string) => Promise<void>;

  createFolder: (payload: CreateClipFolderPayload) => Promise<ClipFolderRecord>;
  moveFolder: (payload: MoveClipFolderPayload) => Promise<ClipLibrarySnapshot>;
  renameFolder: (payload: RenameClipFolderPayload) => Promise<ClipFolderRecord>;
  deleteFolder: (folderId: string) => Promise<void>;

  addNodeMedia: (payload: AddNodeMediaToClipLibraryPayload) => Promise<AddNodeMediaToClipLibraryResult>;
  updateItemDescription: (
    payload: UpdateClipItemDescriptionPayload
  ) => Promise<ClipItemRecord>;
  renameItem: (payload: RenameClipItemPayload) => Promise<ClipItemRecord>;
  moveItem: (payload: MoveClipItemPayload) => Promise<ClipItemRecord>;
  deleteItem: (itemId: string) => Promise<void>;

  saveUiState: (payload: SaveClipLibraryUiStatePayload) => Promise<ClipLibraryUiStateRecord>;
  getDeleteImpact: (query: ClipDeleteImpactQuery) => Promise<ClipDeleteImpactRecord>;
}

let hydrateRequest: Promise<void> | null = null;

export const useClipLibraryStore = create<ClipLibraryState>((set, get) => ({
  libraries: [],
  currentLibraryId: null,
  currentSnapshot: null,
  isHydrated: false,
  isLoadingLibraries: false,
  isLoadingSnapshot: false,

  hydrate: async () => {
    if (get().isHydrated) {
      return;
    }
    if (hydrateRequest) {
      return await hydrateRequest;
    }

    hydrateRequest = (async () => {
      set({ isLoadingLibraries: true });
      try {
        const libraries = await listClipLibraries();
        set({
          libraries: sortLibraries(libraries),
          isHydrated: true,
          isLoadingLibraries: false,
        });
      } catch (error) {
        console.error('Failed to hydrate clip libraries', error);
        set({
          libraries: [],
          isHydrated: true,
          isLoadingLibraries: false,
        });
      } finally {
        hydrateRequest = null;
      }
    })();

    await hydrateRequest;
  },

  refreshLibraries: async () => {
    set({ isLoadingLibraries: true });
    try {
      const libraries = await listClipLibraries();
      set({
        libraries: sortLibraries(libraries),
        isHydrated: true,
        isLoadingLibraries: false,
      });
    } catch (error) {
      console.error('Failed to refresh clip libraries', error);
      set({ isLoadingLibraries: false });
    }
  },

  loadLibrary: async (libraryId) => {
    if (!libraryId) {
      set({
        currentLibraryId: null,
        currentSnapshot: null,
      });
      return null;
    }

    set({ isLoadingSnapshot: true, currentLibraryId: libraryId });
    try {
      const snapshot = await getClipLibrarySnapshot(libraryId);
      set({
        currentLibraryId: libraryId,
        currentSnapshot: snapshot,
        isLoadingSnapshot: false,
      });
      return snapshot;
    } catch (error) {
      console.error('Failed to load clip library snapshot', error);
      set({ currentSnapshot: null, isLoadingSnapshot: false });
      return null;
    }
  },

  refreshCurrentLibrary: async () => {
    const { currentLibraryId } = get();
    if (!currentLibraryId) {
      return null;
    }
    return await get().loadLibrary(currentLibraryId);
  },

  createLibrary: async (payload) => {
    const library = await createClipLibrary(payload);
    set((state) => ({
      libraries: sortLibraries([...state.libraries.filter((item) => item.id !== library.id), library]),
      isHydrated: true,
    }));
    return library;
  },

  renameLibrary: async (payload) => {
    const library = await updateClipLibrary(payload);
    set((state) => ({
      libraries: sortLibraries([...state.libraries.filter((item) => item.id !== library.id), library]),
      currentSnapshot:
        state.currentSnapshot?.library.id === library.id
          ? { ...state.currentSnapshot, library }
          : state.currentSnapshot,
    }));
    return library;
  },

  removeLibrary: async (libraryId) => {
    await deleteClipLibrary(libraryId);
    set((state) => ({
      libraries: state.libraries.filter((library) => library.id !== libraryId),
      currentLibraryId: state.currentLibraryId === libraryId ? null : state.currentLibraryId,
      currentSnapshot:
        state.currentSnapshot?.library.id === libraryId ? null : state.currentSnapshot,
    }));
  },

  createChapter: async (payload) => {
    const chapter = await createClipLibraryChapter(payload);
    await get().refreshLibraries();
    if (get().currentLibraryId === payload.libraryId) {
      await get().refreshCurrentLibrary();
    }
    return chapter;
  },

  renameChapter: async (payload) => {
    const chapter = await updateClipLibraryChapter(payload);
    await get().refreshLibraries();
    if (get().currentLibraryId === chapter.libraryId) {
      await get().refreshCurrentLibrary();
    }
    return chapter;
  },

  moveChapter: async (payload) => {
    const snapshot = await moveClipLibraryChapter(payload);
    set((state) => ({
      currentLibraryId: snapshot.library.id,
      currentSnapshot: snapshot,
      libraries: sortLibraries(
        state.libraries.map((library) =>
          library.id === snapshot.library.id ? snapshot.library : library
        )
      ),
    }));
    return snapshot;
  },

  deleteChapter: async (chapterId) => {
    await deleteClipLibraryChapter(chapterId);
    await get().refreshLibraries();
    await get().refreshCurrentLibrary();
  },

  createFolder: async (payload) => {
    const folder = await createClipFolder(payload);
    await get().refreshCurrentLibrary();
    return folder;
  },

  moveFolder: async (payload) => {
    const snapshot = await moveClipFolder(payload);
    set((state) => ({
      currentLibraryId: snapshot.library.id,
      currentSnapshot: snapshot,
      libraries: sortLibraries(
        state.libraries.map((library) =>
          library.id === snapshot.library.id ? snapshot.library : library
        )
      ),
    }));
    return snapshot;
  },

  renameFolder: async (payload) => {
    const folder = await renameClipFolder(payload);
    await get().refreshCurrentLibrary();
    return folder;
  },

  deleteFolder: async (folderId) => {
    await deleteClipFolder(folderId);
    await get().refreshCurrentLibrary();
  },

  addNodeMedia: async (payload) => {
    const result = await addNodeMediaToClipLibrary(payload);
    await get().refreshLibraries();
    if (get().currentLibraryId === result.clipLibraryId) {
      await get().refreshCurrentLibrary();
    }
    return result;
  },

  updateItemDescription: async (payload) => {
    const item = await updateClipItemDescription(payload);
    await get().refreshCurrentLibrary();
    return item;
  },

  renameItem: async (payload) => {
    const item = await renameClipItem(payload);
    await get().refreshCurrentLibrary();
    return item;
  },

  moveItem: async (payload) => {
    const item = await moveClipItem(payload);
    await get().refreshCurrentLibrary();
    return item;
  },

  deleteItem: async (itemId) => {
    await deleteClipItem(itemId);
    await get().refreshCurrentLibrary();
  },

  saveUiState: async (payload) => {
    const uiState = await saveClipLibraryUiState(payload);
    set((state) => ({
      currentSnapshot:
        state.currentSnapshot?.library.id === uiState.libraryId
          ? { ...state.currentSnapshot, uiState }
          : state.currentSnapshot,
    }));
    return uiState;
  },

  getDeleteImpact: async (query) => {
    return await getClipDeleteImpact(query);
  },
}));
