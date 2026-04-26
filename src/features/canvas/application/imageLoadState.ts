export type ImageLoadState = 'loaded' | 'failed';

const IMAGE_FAILURE_RETRY_DELAY_MS = 5 * 60_000;
const imageLoadStateCache = new Map<string, { state: ImageLoadState; updatedAt: number }>();

function normalizeImageSource(value: string | null | undefined): string | null {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed.length > 0 ? trimmed : null;
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
    cached.state === 'failed'
    && Date.now() - cached.updatedAt >= IMAGE_FAILURE_RETRY_DELAY_MS
  ) {
    imageLoadStateCache.delete(normalized);
    return null;
  }

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

  imageLoadStateCache.set(normalized, {
    state: 'failed',
    updatedAt: Date.now(),
  });
}

export function markImageLoadSucceeded(imageSrc: string | null | undefined): void {
  const normalized = normalizeImageSource(imageSrc);
  if (!normalized) {
    return;
  }

  imageLoadStateCache.set(normalized, {
    state: 'loaded',
    updatedAt: Date.now(),
  });
}
