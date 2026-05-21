import type { Viewport } from '@xyflow/react';
import type { CanvasNode } from '@/stores/canvasStore';

import {
  getCachedImageLoadState,
  markImageLoadFailed,
  markImageLoadSucceeded,
  shouldAttemptImageLoad,
} from './imageLoadState';
import { loadStableImageDisplaySource } from './imageData';
import {
  createCanvasRect,
  getCanvasNodeRect,
  rectIntersects,
  type CanvasRect,
} from './nodeGeometry';

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

export interface ImagePreloadViewportSize {
  width: number;
  height: number;
}

export interface ViewportImagePreloadOptions {
  marginScreens?: number;
  thumbnailMaxDimension?: number;
}

type ImagePreloadSource = string | ImagePreloadEntry;

function withPreloadTimeout<T>(
  task: Promise<T>,
  url: string,
  phase: string,
  timeoutMs = DEFAULT_SINGLE_IMAGE_PRELOAD_TIMEOUT_MS,
  signal?: AbortSignal
): Promise<T> {
  let timeoutId: number | undefined;
  let abortHandler: (() => void) | undefined;

  const timeout = new Promise<T>((_, reject) => {
    timeoutId = window.setTimeout(() => {
      reject(new Error(`Timed out while ${phase}: ${url}`));
    }, timeoutMs);
  });

  const tasks: Promise<T>[] = [task, timeout];
  if (signal) {
    if (signal.aborted) {
      return Promise.reject(new DOMException('Image preload aborted', 'AbortError'));
    }

    tasks.push(new Promise<T>((_, reject) => {
      abortHandler = () => reject(new DOMException('Image preload aborted', 'AbortError'));
      signal.addEventListener('abort', abortHandler, { once: true });
    }));
  }

  return Promise.race(tasks).finally(() => {
    if (typeof timeoutId === 'number') {
      window.clearTimeout(timeoutId);
    }
    if (signal && abortHandler) {
      signal.removeEventListener('abort', abortHandler);
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

function createPreloadEntryFilter() {
  const seenUrls = new Set<string>();

  return (entry: ImagePreloadEntry): ImagePreloadEntry | null => {
    const primaryUrl = shouldAttemptImageLoad(entry.primaryUrl) ? entry.primaryUrl : '';
    const fallbackUrls = entry.fallbackUrls.filter((fallbackUrl) => shouldAttemptImageLoad(fallbackUrl));

    if (!primaryUrl && fallbackUrls.length === 0) {
      return null;
    }

    const resolvedPrimaryUrl = primaryUrl || fallbackUrls[0];
    if (!resolvedPrimaryUrl || seenUrls.has(resolvedPrimaryUrl)) {
      return null;
    }

    seenUrls.add(resolvedPrimaryUrl);
    const dedupedFallbackUrls = fallbackUrls.filter((fallbackUrl) => {
      if (fallbackUrl === resolvedPrimaryUrl || seenUrls.has(fallbackUrl)) {
        return false;
      }
      seenUrls.add(fallbackUrl);
      return true;
    });

    return {
      primaryUrl: resolvedPrimaryUrl,
      fallbackUrls: dedupedFallbackUrls,
    };
  };
}

function filterPreloadEntries(entries: ImagePreloadEntry[]): ImagePreloadEntry[] {
  const filterEntry = createPreloadEntryFilter();
  const filteredEntries: ImagePreloadEntry[] = [];

  for (const entry of entries) {
    const filteredEntry = filterEntry(entry);
    if (filteredEntry) {
      filteredEntries.push(filteredEntry);
    }
  }

  return filteredEntries;
}

export function createViewportPreloadRect(
  viewport: Viewport,
  viewportSize: ImagePreloadViewportSize,
  options?: ViewportImagePreloadOptions
): CanvasRect | null {
  const width = Math.max(0, viewportSize.width);
  const height = Math.max(0, viewportSize.height);
  const zoom = Math.max(0.01, viewport.zoom || 1);

  if (width <= 0 || height <= 0) {
    return null;
  }

  const marginScreens = Math.max(0, options?.marginScreens ?? 1);
  const visibleWidth = width / zoom;
  const visibleHeight = height / zoom;
  const left = -viewport.x / zoom;
  const top = -viewport.y / zoom;

  return createCanvasRect(
    left - visibleWidth * marginScreens,
    top - visibleHeight * marginScreens,
    visibleWidth * (1 + marginScreens * 2),
    visibleHeight * (1 + marginScreens * 2)
  );
}

export function collectProjectViewportImagePreloadEntries(
  nodes: CanvasNode[],
  viewport: Viewport,
  viewportSize: ImagePreloadViewportSize,
  options?: ViewportImagePreloadOptions
): ImagePreloadEntry[] {
  const preloadRect = createViewportPreloadRect(viewport, viewportSize, options);
  if (!preloadRect) {
    return [];
  }

  const nodeMap = new Map(nodes.map((node) => [node.id, node] as const));
  const urls: ImagePreloadEntry[] = [];
  const seenUrls = new Set<string>();
  const visitedObjects = new WeakSet<object>();

  nodes.forEach((node) => {
    if (!rectIntersects(preloadRect, getCanvasNodeRect(node, nodeMap))) {
      return;
    }

    collectImageCandidates(node.data, urls, seenUrls, visitedObjects);
  });

  return filterPreloadEntries(urls);
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

  return filterPreloadEntries(urls);
}

export function collectCanvasNodeImagePreloadEntries(node: CanvasNode): ImagePreloadEntry[] {
  const urls: ImagePreloadEntry[] = [];
  const seenUrls = new Set<string>();
  const visitedObjects = new WeakSet<object>();
  collectImageCandidates(node.data, urls, seenUrls, visitedObjects);
  return filterPreloadEntries(urls);
}

function throwIfPreloadAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new DOMException('Image preload aborted', 'AbortError');
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

async function preloadSingleImage(url: string, signal?: AbortSignal): Promise<void> {
  throwIfPreloadAborted(signal);
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
    'resolving image display source',
    DEFAULT_SINGLE_IMAGE_PRELOAD_TIMEOUT_MS,
    signal
  );

  throwIfPreloadAborted(signal);
  await withPreloadTimeout(new Promise<void>((resolve, reject) => {
    const image = new Image();

    if (displaySource.startsWith('asset:')) {
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
  }), url, 'loading image element', DEFAULT_SINGLE_IMAGE_PRELOAD_TIMEOUT_MS, signal);
}

async function preloadImageEntry(entry: ImagePreloadEntry, signal?: AbortSignal): Promise<void> {
  const candidates = [entry.primaryUrl, ...entry.fallbackUrls];
  const errors: unknown[] = [];

  for (const candidate of candidates) {
    throwIfPreloadAborted(signal);
    try {
      await preloadSingleImage(candidate, signal);
      return;
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }
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
    signal?: AbortSignal;
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
      if (options?.signal?.aborted) {
        return;
      }

      const currentIndex = nextIndex;
      nextIndex += 1;
      const entry = normalizePreloadEntry(urls[currentIndex]);
      const currentUrl = entry.primaryUrl;

      try {
        await preloadImageEntry(entry, options?.signal);
        loadedCount += 1;
      } catch (error) {
        if (isAbortError(error)) {
          return;
        }

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
