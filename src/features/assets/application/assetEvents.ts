import type { AssetItemRecord } from '@/features/assets/domain/types';

type AssetItemUpdatedListener = (item: AssetItemRecord) => void;
type AssetItemDeletedListener = (assetItemId: string) => void;

const assetItemUpdatedListeners = new Set<AssetItemUpdatedListener>();
const assetItemDeletedListeners = new Set<AssetItemDeletedListener>();

export function emitAssetItemUpdated(item: AssetItemRecord): void {
  assetItemUpdatedListeners.forEach((listener) => listener(item));
}

export function emitAssetItemDeleted(assetItemId: string): void {
  assetItemDeletedListeners.forEach((listener) => listener(assetItemId));
}

export function subscribeAssetItemUpdated(listener: AssetItemUpdatedListener): () => void {
  assetItemUpdatedListeners.add(listener);
  return () => {
    assetItemUpdatedListeners.delete(listener);
  };
}

export function subscribeAssetItemDeleted(listener: AssetItemDeletedListener): () => void {
  assetItemDeletedListeners.add(listener);
  return () => {
    assetItemDeletedListeners.delete(listener);
  };
}
