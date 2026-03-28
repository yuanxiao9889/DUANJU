export const ASSET_CATEGORIES = ['character', 'scene', 'prop'] as const;

export type AssetCategory = (typeof ASSET_CATEGORIES)[number];

export interface AssetSubcategoryRecord {
  id: string;
  libraryId: string;
  category: AssetCategory;
  name: string;
  createdAt: number;
  updatedAt: number;
}

export interface AssetItemRecord {
  id: string;
  libraryId: string;
  category: AssetCategory;
  subcategoryId: string | null;
  name: string;
  description: string;
  tags: string[];
  imagePath: string;
  previewImagePath: string;
  aspectRatio: string;
  createdAt: number;
  updatedAt: number;
}

export interface AssetLibraryRecord {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  subcategories: AssetSubcategoryRecord[];
  items: AssetItemRecord[];
}

export interface CreateAssetLibraryPayload {
  name: string;
}

export interface UpdateAssetLibraryPayload extends CreateAssetLibraryPayload {
  id: string;
}

export interface CreateAssetSubcategoryPayload {
  libraryId: string;
  category: AssetCategory;
  name: string;
}

export interface UpdateAssetSubcategoryPayload {
  id: string;
  name: string;
}

export interface AssetItemMutationPayload {
  libraryId: string;
  category: AssetCategory;
  subcategoryId: string | null;
  name: string;
  description: string;
  tags: string[];
  imagePath: string;
  previewImagePath: string;
  aspectRatio: string;
}

export interface CreateAssetItemPayload extends AssetItemMutationPayload {}

export interface UpdateAssetItemPayload extends AssetItemMutationPayload {
  id: string;
}

export const ASSET_DRAG_MIME_TYPE = 'application/x-storyboard-asset';

export interface CanvasAssetDragPayload {
  assetId: string;
  assetLibraryId: string;
  assetName: string;
  assetCategory: AssetCategory;
  imagePath: string;
  previewImagePath: string;
  aspectRatio: string;
}

export function serializeAssetDragPayload(payload: CanvasAssetDragPayload): string {
  return JSON.stringify(payload);
}

export function parseAssetDragPayload(value: string | null | undefined): CanvasAssetDragPayload | null {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as Partial<CanvasAssetDragPayload>;
    if (
      typeof parsed.assetId !== 'string' ||
      typeof parsed.assetLibraryId !== 'string' ||
      typeof parsed.assetName !== 'string' ||
      typeof parsed.assetCategory !== 'string' ||
      typeof parsed.imagePath !== 'string' ||
      typeof parsed.previewImagePath !== 'string' ||
      typeof parsed.aspectRatio !== 'string'
    ) {
      return null;
    }

    if (!ASSET_CATEGORIES.includes(parsed.assetCategory as AssetCategory)) {
      return null;
    }

    return {
      assetId: parsed.assetId,
      assetLibraryId: parsed.assetLibraryId,
      assetName: parsed.assetName,
      assetCategory: parsed.assetCategory as AssetCategory,
      imagePath: parsed.imagePath,
      previewImagePath: parsed.previewImagePath,
      aspectRatio: parsed.aspectRatio,
    };
  } catch {
    return null;
  }
}

