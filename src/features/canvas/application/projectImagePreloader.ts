import type { CanvasNode } from '@/stores/canvasStore';

import {
  getCachedImageLoadState,
  markImageLoadFailed,
  markImageLoadSucceeded,
} from './imageLoadState';
import { resolveImageDisplayUrl } from './imageData';

const DEFAULT_PRELOAD_CONCURRENCY = 6;
const IMAGE_SOURCE_KEYS = new Set([
  'imageUrl',
  'previewImageUrl',
  'thumbnailUrl',
  'posterSourceUrl',
  'sourceImageUrl',
  'sourceUrl',
  'referenceUrl',
  'maskImageUrl',
]);

export interface ImagePreloadProgress {
  totalCount: number;
  completedCount: number;
  loadedCount: number;
  failedCount: number;
  currentUrl: string;
}

export interface ImagePreloadResult {
  totalCount: number;
  loadedCount: number;
  failedCount: number;
}

function pushImageCandidate(urls: string[], seenUrls: Set<string>, value: unknown) {
  if (typeof value !== 'string') {
    return;
  }

  const normalized = value.trim();
  if (!normalized || seenUrls.has(normalized)) {
    return;
  }

  seenUrls.add(normalized);
  urls.push(normalized);
}

function pushPreferredPreviewCandidate(
  record: Record<string, unknown>,
  urls: string[],
  seenUrls: Set<string>
): boolean {
  const previewImageUrl =
    typeof record.previewImageUrl === 'string' ? record.previewImageUrl.trim() : '';
  if (!previewImageUrl) {
    return false;
  }

  pushImageCandidate(urls, seenUrls, previewImageUrl);
  return true;
}

function collectImageCandidates(
  value: unknown,
  urls: string[],
  seenUrls: Set<string>,
  visitedObjects: WeakSet<object>
) {
  if (Array.isArray(value)) {
    value.forEach((item) => {
      collectImageCandidates(item, urls, seenUrls, visitedObjects);
    });
    return;
  }

  if (!value || typeof value !== 'object') {
    return;
  }

  if (visitedObjects.has(value)) {
    return;
  }
  visitedObjects.add(value);

  const record = value as Record<string, unknown>;
  const hasPreferredPreviewImage = pushPreferredPreviewCandidate(record, urls, seenUrls);

  Object.entries(record).forEach(([key, nestedValue]) => {
    if (key === 'previewImageUrl') {
      return;
    }

    if (key === 'imageUrl' && hasPreferredPreviewImage) {
      return;
    }

    if (IMAGE_SOURCE_KEYS.has(key)) {
      pushImageCandidate(urls, seenUrls, nestedValue);
    }

    if (key === 'videoUrl' || key === 'audioUrl') {
      return;
    }

    collectImageCandidates(nestedValue, urls, seenUrls, visitedObjects);
  });
}

export function collectProjectImageUrls(nodes: CanvasNode[]): string[] {
  const urls: string[] = [];
  const seenUrls = new Set<string>();
  const visitedObjects = new WeakSet<object>();

  nodes.forEach((node) => {
    collectImageCandidates(node.data, urls, seenUrls, visitedObjects);
  });

  return urls;
}

async function preloadSingleImage(url: string): Promise<void> {
  const displaySource = resolveImageDisplayUrl(url);
  const cachedState = getCachedImageLoadState(displaySource);
  if (cachedState === 'loaded') {
    return;
  }

  if (cachedState === 'failed') {
    const cachedError = new Error(`Failed to preload image: ${displaySource}`);
    (cachedError as Error & { cached?: boolean }).cached = true;
    throw cachedError;
  }

  await new Promise<void>((resolve, reject) => {
    const image = new Image();

    if (
      displaySource.startsWith('http://')
      || displaySource.startsWith('https://')
      || displaySource.startsWith('asset:')
    ) {
      image.crossOrigin = 'anonymous';
    }

    image.onload = () => {
      markImageLoadSucceeded(displaySource);
      if (typeof image.decode === 'function') {
        image.decode().catch(() => undefined).finally(() => resolve());
        return;
      }

      resolve();
    };
    image.onerror = () => {
      markImageLoadFailed(displaySource);
      reject(new Error(`Failed to preload image: ${displaySource}`));
    };
    image.src = displaySource;
  });
}

export async function preloadProjectImages(
  urls: string[],
  options?: {
    concurrency?: number;
    onProgress?: (progress: ImagePreloadProgress) => void;
  }
): Promise<ImagePreloadResult> {
  const totalCount = urls.length;
  if (totalCount === 0) {
    return {
      totalCount: 0,
      loadedCount: 0,
      failedCount: 0,
    };
  }

  const concurrency = Math.max(
    1,
    Math.min(options?.concurrency ?? DEFAULT_PRELOAD_CONCURRENCY, totalCount)
  );
  let nextIndex = 0;
  let completedCount = 0;
  let loadedCount = 0;
  let failedCount = 0;

  const reportProgress = (currentUrl: string) => {
    options?.onProgress?.({
      totalCount,
      completedCount,
      loadedCount,
      failedCount,
      currentUrl,
    });
  };

  const worker = async () => {
    while (nextIndex < totalCount) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      const currentUrl = urls[currentIndex];

      try {
        await preloadSingleImage(currentUrl);
        loadedCount += 1;
      } catch (error) {
        failedCount += 1;
        if (!(error instanceof Error && 'cached' in error && error.cached === true)) {
          console.warn('Failed to preload canvas entry image', error);
        }
      } finally {
        completedCount += 1;
        reportProgress(currentUrl);
      }
    }
  };

  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      await worker();
    })
  );

  return {
    totalCount,
    loadedCount,
    failedCount,
  };
}
