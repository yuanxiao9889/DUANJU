import { create } from 'zustand';

import {
  createAssetItem,
  createAssetLibrary,
  createAssetSubcategory,
  deleteAssetItem,
  deleteAssetLibrary,
  deleteAssetSubcategory,
  listAssetLibraries,
  updateAssetItem,
  updateAssetLibrary,
  updateAssetSubcategory,
} from '@/commands/assetState';
import {
  emitAssetItemDeleted,
  emitAssetItemUpdated,
} from '@/features/assets/application/assetEvents';
import { getAssetCategoryOrder } from '@/features/assets/domain/types';
import type {
  AssetCategory,
  AssetItemRecord,
  AssetLibraryRecord,
  AssetSubcategoryRecord,
  CreateAssetItemPayload,
  UpdateAssetItemPayload,
} from '@/features/assets/domain/types';

function sortLibraries(libraries: AssetLibraryRecord[]): AssetLibraryRecord[] {
  return [...libraries].sort((left, right) => right.updatedAt - left.updatedAt);
}

function sortSubcategories(subcategories: AssetSubcategoryRecord[]): AssetSubcategoryRecord[] {
  return [...subcategories].sort((left, right) => {
    if (left.category !== right.category) {
      return getAssetCategoryOrder(left.category) - getAssetCategoryOrder(right.category);
    }
    return left.name.localeCompare(right.name, 'zh-Hans-CN', { sensitivity: 'base' });
  });
}

function sortItems(items: AssetItemRecord[]): AssetItemRecord[] {
  return [...items].sort((left, right) => {
    if (left.category !== right.category) {
      return getAssetCategoryOrder(left.category) - getAssetCategoryOrder(right.category);
    }
    return left.name.localeCompare(right.name, 'zh-Hans-CN', { sensitivity: 'base' });
  });
}

function upsertLibraryInList(
  libraries: AssetLibraryRecord[],
  nextLibrary: AssetLibraryRecord
): AssetLibraryRecord[] {
  const next = libraries.filter((library) => library.id !== nextLibrary.id);
  next.push({
    ...nextLibrary,
    subcategories: sortSubcategories(nextLibrary.subcategories),
    items: sortItems(nextLibrary.items),
  });
  return sortLibraries(next);
}

interface AssetState {
  libraries: AssetLibraryRecord[];
  isHydrated: boolean;
  isLoading: boolean;
  hydrate: () => Promise<void>;
  refresh: () => Promise<void>;
  createLibrary: (name: string) => Promise<AssetLibraryRecord>;
  renameLibrary: (libraryId: string, name: string) => Promise<AssetLibraryRecord>;
  deleteLibrary: (libraryId: string) => Promise<void>;
  createSubcategory: (
    libraryId: string,
    category: AssetCategory,
    name: string
  ) => Promise<AssetSubcategoryRecord>;
  renameSubcategory: (subcategoryId: string, name: string) => Promise<AssetSubcategoryRecord>;
  deleteSubcategory: (subcategoryId: string) => Promise<void>;
  createItem: (payload: CreateAssetItemPayload) => Promise<AssetItemRecord>;
  updateItem: (payload: UpdateAssetItemPayload) => Promise<AssetItemRecord>;
  deleteItem: (assetItemId: string) => Promise<void>;
}

let hydrateRequest: Promise<void> | null = null;

export const useAssetStore = create<AssetState>((set, get) => ({
  libraries: [],
  isHydrated: false,
  isLoading: false,

  hydrate: async () => {
    if (get().isHydrated) {
      return;
    }
    if (hydrateRequest) {
      return await hydrateRequest;
    }

    hydrateRequest = (async () => {
      set({ isLoading: true });
      try {
        const libraries = await listAssetLibraries();
        set({
          libraries: sortLibraries(libraries),
          isHydrated: true,
          isLoading: false,
        });
      } catch (error) {
        console.error('Failed to hydrate asset libraries', error);
        set({
          libraries: [],
          isHydrated: true,
          isLoading: false,
        });
      } finally {
        hydrateRequest = null;
      }
    })();

    await hydrateRequest;
  },

  refresh: async () => {
    set({ isLoading: true });
    try {
      const libraries = await listAssetLibraries();
      set({
        libraries: sortLibraries(libraries),
        isHydrated: true,
        isLoading: false,
      });
    } catch (error) {
      console.error('Failed to refresh asset libraries', error);
      set({ isLoading: false });
    }
  },

  createLibrary: async (name) => {
    const library = await createAssetLibrary({ name });
    set((state) => ({
      libraries: upsertLibraryInList(state.libraries, library),
      isHydrated: true,
    }));
    return library;
  },

  renameLibrary: async (libraryId, name) => {
    const library = await updateAssetLibrary({ id: libraryId, name });
    set((state) => ({
      libraries: upsertLibraryInList(state.libraries, library),
    }));
    return library;
  },

  deleteLibrary: async (libraryId) => {
    await deleteAssetLibrary(libraryId);
    set((state) => ({
      libraries: state.libraries.filter((library) => library.id !== libraryId),
    }));
  },

  createSubcategory: async (libraryId, category, name) => {
    const subcategory = await createAssetSubcategory({ libraryId, category, name });
    set((state) => ({
      libraries: state.libraries.map((library) =>
        library.id === libraryId
          ? {
              ...library,
              updatedAt: Math.max(library.updatedAt, subcategory.updatedAt),
              subcategories: sortSubcategories([...library.subcategories, subcategory]),
            }
          : library
      ),
    }));
    return subcategory;
  },

  renameSubcategory: async (subcategoryId, name) => {
    const subcategory = await updateAssetSubcategory({ id: subcategoryId, name });
    set((state) => ({
      libraries: state.libraries.map((library) => {
        if (library.id !== subcategory.libraryId) {
          return library;
        }

        return {
          ...library,
          updatedAt: Math.max(library.updatedAt, subcategory.updatedAt),
          subcategories: sortSubcategories(
            library.subcategories.map((existing) =>
              existing.id === subcategory.id ? subcategory : existing
            )
          ),
        };
      }),
    }));
    return subcategory;
  },

  deleteSubcategory: async (subcategoryId) => {
    const targetLibrary = get().libraries.find((library) =>
      library.subcategories.some((subcategory) => subcategory.id === subcategoryId)
    );
    await deleteAssetSubcategory(subcategoryId);
    if (!targetLibrary) {
      return;
    }

    set((state) => ({
      libraries: state.libraries.map((library) => {
        if (library.id !== targetLibrary.id) {
          return library;
        }

        return {
          ...library,
          subcategories: library.subcategories.filter(
            (subcategory) => subcategory.id !== subcategoryId
          ),
          items: library.items.map((item) =>
            item.subcategoryId === subcategoryId
              ? {
                  ...item,
                  subcategoryId: null,
                }
              : item
          ),
        };
      }),
    }));
  },

  createItem: async (payload) => {
    const item = await createAssetItem(payload);
    set((state) => ({
      libraries: state.libraries.map((library) =>
        library.id === item.libraryId
          ? {
              ...library,
              updatedAt: Math.max(library.updatedAt, item.updatedAt),
              items: sortItems([...library.items, item]),
            }
          : library
      ),
    }));
    return item;
  },

  updateItem: async (payload) => {
    const item = await updateAssetItem(payload);
    set((state) => ({
      libraries: state.libraries.map((library) => {
        if (library.id !== item.libraryId) {
          return {
            ...library,
            items: library.items.filter((existing) => existing.id !== item.id),
          };
        }

        return {
          ...library,
          updatedAt: Math.max(library.updatedAt, item.updatedAt),
          items: sortItems([
            ...library.items.filter((existing) => existing.id !== item.id),
            item,
          ]),
        };
      }),
    }));
    emitAssetItemUpdated(item);
    return item;
  },

  deleteItem: async (assetItemId) => {
    const existingItem = get()
      .libraries
      .flatMap((library) => library.items)
      .find((item) => item.id === assetItemId);
    await deleteAssetItem(assetItemId);
    set((state) => ({
      libraries: state.libraries.map((library) => ({
        ...library,
        items: library.items.filter((item) => item.id !== assetItemId),
      })),
    }));
    if (existingItem) {
      emitAssetItemDeleted(existingItem.id);
    }
  },
}));
