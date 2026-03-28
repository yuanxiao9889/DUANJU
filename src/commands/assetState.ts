import { invoke } from '@tauri-apps/api/core';

import type {
  AssetLibraryRecord,
  AssetItemRecord,
  AssetSubcategoryRecord,
  CreateAssetItemPayload,
  CreateAssetLibraryPayload,
  CreateAssetSubcategoryPayload,
  UpdateAssetItemPayload,
  UpdateAssetLibraryPayload,
  UpdateAssetSubcategoryPayload,
} from '@/features/assets/domain/types';

export async function listAssetLibraries(): Promise<AssetLibraryRecord[]> {
  return await invoke<AssetLibraryRecord[]>('list_asset_libraries');
}

export async function createAssetLibrary(
  payload: CreateAssetLibraryPayload
): Promise<AssetLibraryRecord> {
  return await invoke<AssetLibraryRecord>('create_asset_library', { payload });
}

export async function updateAssetLibrary(
  payload: UpdateAssetLibraryPayload
): Promise<AssetLibraryRecord> {
  return await invoke<AssetLibraryRecord>('update_asset_library', { payload });
}

export async function deleteAssetLibrary(libraryId: string): Promise<void> {
  await invoke('delete_asset_library', { libraryId });
}

export async function createAssetSubcategory(
  payload: CreateAssetSubcategoryPayload
): Promise<AssetSubcategoryRecord> {
  return await invoke<AssetSubcategoryRecord>('create_asset_subcategory', { payload });
}

export async function updateAssetSubcategory(
  payload: UpdateAssetSubcategoryPayload
): Promise<AssetSubcategoryRecord> {
  return await invoke<AssetSubcategoryRecord>('update_asset_subcategory', { payload });
}

export async function deleteAssetSubcategory(subcategoryId: string): Promise<void> {
  await invoke('delete_asset_subcategory', { subcategoryId });
}

export async function createAssetItem(payload: CreateAssetItemPayload): Promise<AssetItemRecord> {
  return await invoke<AssetItemRecord>('create_asset_item', { payload });
}

export async function updateAssetItem(payload: UpdateAssetItemPayload): Promise<AssetItemRecord> {
  return await invoke<AssetItemRecord>('update_asset_item', { payload });
}

export async function deleteAssetItem(assetItemId: string): Promise<void> {
  await invoke('delete_asset_item', { assetItemId });
}

