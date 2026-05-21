import { resolveLocalFileSourcePath } from '@/features/canvas/application/imageData';

export type ImageLoadState = 'loaded' | 'failed';

const IMAGE_FAILURE_RETRY_DELAY_MS = 5 * 60_000;
const LOCAL_IMAGE_FAILURE_RETRY_DELAY_MS = 3_000;
const IMAGE_LOAD_STATE_CACHE_LIMIT = 1024;
const imageLoadStateCache = new Map<string, { state: ImageLoadState; updatedAt: number }>();

function normalizeImageSource(value: string | null | undefined): string | null {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed.length > 0 ? trimmed : null;
}

function isRetryableLocalImageSource(value: string): boolean {
  return Boolean(resolveLocalFileSourcePath(value));
}

function resolveImageFailureRetryDelayMs(value: string): number {
  return isRetryableLocalImageSource(value)
    ? LOCAL_IMAGE_FAILURE_RETRY_DELAY_MS
    : IMAGE_FAILURE_RETRY_DELAY_MS;
}

function isExpiredFailure(
  source: string,
  entry: { state: ImageLoadState; updatedAt: number }
): boolean {
  return (
    entry.state === 'failed'
    && Date.now() - entry.updatedAt >= resolveImageFailureRetryDelayMs(source)
  );
}

function pruneImageLoadStateCache(): void {
  for (const [source, entry] of imageLoadStateCache) {
    if (isExpiredFailure(source, entry)) {
      imageLoadStateCache.delete(source);
    }
  }

  while (imageLoadStateCache.size > IMAGE_LOAD_STATE_CACHE_LIMIT) {
    const oldestKey = imageLoadStateCache.keys().next().value;
    if (!oldestKey) {
      break;
    }
    imageLoadStateCache.delete(oldestKey);
  }
}

function rememberImageLoadState(source: string, state: ImageLoadState): void {
  if (imageLoadStateCache.has(source)) {
    imageLoadStateCache.delete(source);
  }

  imageLoadStateCache.set(source, {
    state,
    updatedAt: Date.now(),
  });
  pruneImageLoadStateCache();
}

export function getImageLoadRetryDelayMs(
  imageSrc: string | null | undefined
): number | null {
  const normalized = normalizeImageSource(imageSrc);
  if (!normalized) {
    return null;
  }

  const cached = imageLoadStateCache.get(normalized);
  if (!cached || cached.state !== 'failed') {
    return null;
  }

  const retryDelayMs = resolveImageFailureRetryDelayMs(normalized);
  const elapsedMs = Date.now() - cached.updatedAt;
  if (elapsedMs >= retryDelayMs) {
    imageLoadStateCache.delete(normalized);
    return 0;
  }

  return retryDelayMs - elapsedMs;
}

export function getCachedImageLoadState(
  imageSrc: string | null | undefined
): ImageLoadState | null {
  const normalized = normalizeImageSource(imageSrc);
  if (!normalized) {
    return null;
  }

  const cached = imageLoadStateCache.get(normalized);
  if (!cached) {
    return null;
  }

  if (
    isExpiredFailure(normalized, cached)
  ) {
    imageLoadStateCache.delete(normalized);
    return null;
  }

  imageLoadStateCache.delete(normalized);
  imageLoadStateCache.set(normalized, cached);
  return cached.state;
}

export function shouldAttemptImageLoad(imageSrc: string | null | undefined): boolean {
  return getCachedImageLoadState(imageSrc) !== 'failed';
}

export function markImageLoadFailed(imageSrc: string | null | undefined): void {
  const normalized = normalizeImageSource(imageSrc);
  if (!normalized) {
    return;
  }

  rememberImageLoadState(normalized, 'failed');
}

export function markImageLoadSucceeded(imageSrc: string | null | undefined): void {
  const normalized = normalizeImageSource(imageSrc);
  if (!normalized) {
    return;
  }

  rememberImageLoadState(normalized, 'loaded');
}
