import type { CanvasNode } from '@/stores/canvasStore';

import {
  getCachedImageLoadState,
  markImageLoadFailed,
  markImageLoadSucceeded,
  shouldAttemptImageLoad,
} from './imageLoadState';
import { loadStableImageDisplaySource } from './imageData';

const DEFAULT_PRELOAD_CONCURRENCY = 6;
const DEFAULT_SINGLE_IMAGE_PRELOAD_TIMEOUT_MS = 10_000;
const IMAGE_SOURCE_KEYS = new Set([
  'imageUrl',
  'previewImageUrl',
  'thumbnailUrl',
  'posterSourceUrl',
  'sourceImageUrl',
  'maskImageUrl',
]);
const GENERIC_SOURCE_KEYS = new Set([
  'sourceUrl',
  'referenceUrl',
]);
const PREVIEW_FALLBACK_KEYS = [
  'imageUrl',
  'sourceImageUrl',
  'sourceUrl',
  'referenceUrl',
] as const;
const TRANSIENT_IMAGE_SOURCE_PREFIXES = ['blob:'] as const;
const IMAGE_FILE_EXTENSION_PATTERN = /\.(?:png|jpe?g|jfif|webp|gif|bmp|avif|svg|tiff?|heic|heif)$/i;
const NON_IMAGE_FILE_EXTENSION_PATTERN = /\.(?:mp4|mov|m4v|webm|avi|mkv|flv|wmv|mp3|wav|m4a|aac|flac|ogg|opus|json|txt|md|html?|pdf|zip|rar|7z)(?:[?#].*)?$/i;

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

export interface ImagePreloadEntry {
  primaryUrl: string;
  fallbackUrls: string[];
}

type ImagePreloadSource = string | ImagePreloadEntry;

function withPreloadTimeout<T>(
  task: Promise<T>,
  url: string,
  phase: string,
  timeoutMs = DEFAULT_SINGLE_IMAGE_PRELOAD_TIMEOUT_MS
): Promise<T> {
  let timeoutId: number | undefined;

  const timeout = new Promise<T>((_, reject) => {
    timeoutId = window.setTimeout(() => {
      markImageLoadFailed(url);
      reject(new Error(`Timed out while ${phase}: ${url}`));
    }, timeoutMs);
  });

  return Promise.race([task, timeout]).finally(() => {
    if (typeof timeoutId === 'number') {
      window.clearTimeout(timeoutId);
    }
  });
}

function stripSearchHash(value: string): string {
  const separatorIndex = value.search(/[?#]/);
  return separatorIndex >= 0 ? value.slice(0, separatorIndex) : value;
}

function resolvePathForExtensionCheck(value: string): string {
  try {
    const parsed = new URL(value);
    return decodeURIComponent(parsed.pathname || value);
  } catch {
    try {
      return decodeURIComponent(stripSearchHash(value));
    } catch {
      return stripSearchHash(value);
    }
  }
}

function hasImageFileExtension(value: string): boolean {
  return IMAGE_FILE_EXTENSION_PATTERN.test(resolvePathForExtensionCheck(value));
}

function hasKnownNonImageFileExtension(value: string): boolean {
  return NON_IMAGE_FILE_EXTENSION_PATTERN.test(resolvePathForExtensionCheck(value));
}

function hasImageContext(record: Record<string, unknown>): boolean {
  const mediaType = typeof record.mediaType === 'string' ? record.mediaType.trim().toLowerCase() : '';
  const type = typeof record.type === 'string' ? record.type.trim().toLowerCase() : '';
  const kind = typeof record.kind === 'string' ? record.kind.trim().toLowerCase() : '';

  return mediaType === 'image' || type === 'image' || kind === 'image';
}

function isImagePreloadCandidate(
  value: string,
  key: string,
  record: Record<string, unknown>
): boolean {
  const normalized = value.trim();
  const lower = normalized.toLowerCase();

  if (!normalized || isTransientImageSource(normalized)) {
    return false;
  }

  if (lower.startsWith('data:image/')) {
    return true;
  }

  if (lower.startsWith('data:')) {
    return false;
  }

  if (hasKnownNonImageFileExtension(normalized)) {
    return false;
  }

  if (hasImageFileExtension(normalized)) {
    return true;
  }

  if (IMAGE_SOURCE_KEYS.has(key)) {
    return true;
  }

  return GENERIC_SOURCE_KEYS.has(key) && hasImageContext(record);
}

function normalizePreloadEntry(source: ImagePreloadSource): ImagePreloadEntry {
  if (typeof source === 'string') {
    return {
      primaryUrl: source,
      fallbackUrls: [],
    };
  }

  return {
    primaryUrl: source.primaryUrl,
    fallbackUrls: source.fallbackUrls,
  };
}

function pushImageCandidate(
  urls: ImagePreloadEntry[],
  seenUrls: Set<string>,
  value: unknown,
  key: string,
  record: Record<string, unknown>,
  fallbackValues: string[] = []
) {
  if (typeof value !== 'string') {
    return false;
  }

  const normalized = value.trim();
  if (
    !isImagePreloadCandidate(normalized, key, record)
    || seenUrls.has(normalized)
  ) {
    return false;
  }

  const fallbackUrls = fallbackValues
    .map((fallbackValue) => fallbackValue.trim())
    .filter((fallbackValue) => (
      fallbackValue
      && fallbackValue !== normalized
      && isImagePreloadCandidate(fallbackValue, key, record)
    ));

  seenUrls.add(normalized);
  fallbackUrls.forEach((fallbackUrl) => {
    seenUrls.add(fallbackUrl);
  });
  urls.push({
    primaryUrl: normalized,
    fallbackUrls,
  });
  return true;
}

function isTransientImageSource(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return TRANSIENT_IMAGE_SOURCE_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

function pushPreferredPreviewCandidate(
  record: Record<string, unknown>,
  urls: ImagePreloadEntry[],
  seenUrls: Set<string>
): boolean {
  const previewImageUrl =
    typeof record.previewImageUrl === 'string' ? record.previewImageUrl.trim() : '';
  if (!previewImageUrl) {
    return false;
  }

  const fallbackValues = PREVIEW_FALLBACK_KEYS
    .map((key) => record[key])
    .filter((value): value is string => typeof value === 'string');

  return pushImageCandidate(
    urls,
    seenUrls,
    previewImageUrl,
    'previewImageUrl',
    record,
    fallbackValues
  );
}

function collectImageCandidates(
  value: unknown,
  urls: ImagePreloadEntry[],
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

    if (
      hasPreferredPreviewImage
      && (key === 'imageUrl' || key === 'sourceImageUrl' || key === 'sourceUrl')
    ) {
      return;
    }

    if (IMAGE_SOURCE_KEYS.has(key)) {
      pushImageCandidate(urls, seenUrls, nestedValue, key, record);
    }

    if (GENERIC_SOURCE_KEYS.has(key)) {
      pushImageCandidate(urls, seenUrls, nestedValue, key, record);
    }

    if (key === 'videoUrl' || key === 'audioUrl') {
      return;
    }

    collectImageCandidates(nestedValue, urls, seenUrls, visitedObjects);
  });
}

export function collectProjectImageUrls(nodes: CanvasNode[]): string[] {
  const urls: ImagePreloadEntry[] = [];
  const seenUrls = new Set<string>();
  const visitedObjects = new WeakSet<object>();

  nodes.forEach((node) => {
    collectImageCandidates(node.data, urls, seenUrls, visitedObjects);
  });

  return urls
    .map((entry) => entry.primaryUrl)
    .filter((url) => shouldAttemptImageLoad(url));
}

export function collectProjectImagePreloadEntries(nodes: CanvasNode[]): ImagePreloadEntry[] {
  const urls: ImagePreloadEntry[] = [];
  const seenUrls = new Set<string>();
  const visitedObjects = new WeakSet<object>();

  nodes.forEach((node) => {
    collectImageCandidates(node.data, urls, seenUrls, visitedObjects);
  });

  return urls
    .map((entry) => ({
      primaryUrl: entry.primaryUrl,
      fallbackUrls: entry.fallbackUrls.filter((fallbackUrl) => shouldAttemptImageLoad(fallbackUrl)),
    }))
    .filter((entry) => shouldAttemptImageLoad(entry.primaryUrl) || entry.fallbackUrls.length > 0);
}

async function preloadSingleImage(url: string): Promise<void> {
  const cachedState = getCachedImageLoadState(url);
  if (cachedState === 'loaded') {
    return;
  }

  if (cachedState === 'failed') {
    const cachedError = new Error(`Failed to preload image: ${url}`);
    (cachedError as Error & { cached?: boolean }).cached = true;
    throw cachedError;
  }

  const displaySource = await withPreloadTimeout(
    loadStableImageDisplaySource(url),
    url,
    'resolving image display source'
  );

  await withPreloadTimeout(new Promise<void>((resolve, reject) => {
    const image = new Image();

    if (
      displaySource.startsWith('http://')
      || displaySource.startsWith('https://')
      || displaySource.startsWith('asset:')
    ) {
      image.crossOrigin = 'anonymous';
    }

    image.onload = () => {
      markImageLoadSucceeded(url);
      if (typeof image.decode === 'function') {
        image.decode().catch(() => undefined).finally(() => resolve());
        return;
      }

      resolve();
    };
    image.onerror = () => {
      markImageLoadFailed(url);
      reject(new Error(`Failed to preload image: ${url}`));
    };
    image.src = displaySource;
  }), url, 'loading image element');
}

async function preloadImageEntry(entry: ImagePreloadEntry): Promise<void> {
  const candidates = [entry.primaryUrl, ...entry.fallbackUrls];
  const errors: unknown[] = [];

  for (const candidate of candidates) {
    try {
      await preloadSingleImage(candidate);
      return;
    } catch (error) {
      errors.push(error);
    }
  }

  const error = new Error(`Failed to preload image entry: ${entry.primaryUrl}`);
  (error as Error & { causes?: unknown[] }).causes = errors;
  throw error;
}

export async function preloadProjectImages(
  urls: ImagePreloadSource[],
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
      const entry = normalizePreloadEntry(urls[currentIndex]);
      const currentUrl = entry.primaryUrl;

      try {
        await preloadImageEntry(entry);
        loadedCount += 1;
      } catch (error) {
        failedCount += 1;
        if (!(error instanceof Error && 'cached' in error && error.cached === true)) {
          console.debug('Skipped canvas entry image preload candidate', error);
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
