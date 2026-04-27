import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ImgHTMLAttributes,
  type MouseEvent,
  type SyntheticEvent,
} from 'react';

import {
  markImageLoadFailed,
  markImageLoadSucceeded,
  shouldAttemptImageLoad,
} from '@/features/canvas/application/imageLoadState';
import { resolveLocalFileSourcePath } from '@/features/canvas/application/imageData';
import type { ImageViewerMetadata } from '@/features/canvas/domain/canvasNodes';
import { useCanvasStore } from '@/stores/canvasStore';

export interface CanvasNodeImageProps extends ImgHTMLAttributes<HTMLImageElement> {
  viewerSourceUrl?: string | null;
  viewerImageList?: Array<string | null | undefined>;
  viewerMetadata?: ImageViewerMetadata | null;
  disableViewer?: boolean;
  fallbackSrc?: string | null;
}

const EMPTY_IMAGE_DATA_URL = 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';
const LOCAL_IMAGE_RETRY_DELAYS_MS = [140, 360, 900, 1800] as const;

function normalizeImageSrc(value: string | null | undefined): string | null {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed.length > 0 ? trimmed : null;
}

function isRetryableLocalImageSource(value: string | null | undefined): boolean {
  const normalized = normalizeImageSrc(value);
  return normalized ? Boolean(resolveLocalFileSourcePath(normalized)) : false;
}

function appendRetryTokenToImageSrc(src: string, retryAttempt: number): string {
  if (retryAttempt <= 0 || src.startsWith('data:') || src.startsWith('blob:')) {
    return src;
  }

  try {
    const parsed = new URL(src);
    parsed.searchParams.set('__img_retry', String(retryAttempt));
    return parsed.toString();
  } catch {
    const separator = src.includes('?') ? '&' : '?';
    return `${src}${separator}__img_retry=${retryAttempt}`;
  }
}

function resolveDisplayState(
  requestedSrc: string | null,
  fallbackSrc: string | null
): { activeSrc: string | null; isUsingFallback: boolean } {
  if (requestedSrc && shouldAttemptImageLoad(requestedSrc)) {
    return {
      activeSrc: requestedSrc,
      isUsingFallback: false,
    };
  }

  if (fallbackSrc && shouldAttemptImageLoad(fallbackSrc)) {
    return {
      activeSrc: fallbackSrc,
      isUsingFallback: true,
    };
  }

  return {
    activeSrc: null,
    isUsingFallback: false,
  };
}

function normalizeViewerList(
  imageList: Array<string | null | undefined> | undefined,
  currentImageUrl: string
): string[] {
  const deduped: string[] = [];
  for (const rawItem of imageList ?? []) {
    const item = typeof rawItem === 'string' ? rawItem.trim() : '';
    if (!item || deduped.includes(item)) {
      continue;
    }
    deduped.push(item);
  }

  if (!deduped.includes(currentImageUrl)) {
    deduped.unshift(currentImageUrl);
  }

  return deduped.length > 0 ? deduped : [currentImageUrl];
}

export const CanvasNodeImage = memo(({
  viewerSourceUrl,
  viewerImageList,
  viewerMetadata = null,
  disableViewer = false,
  fallbackSrc,
  onDoubleClick,
  onError,
  onLoad,
  src,
  ...props
}: CanvasNodeImageProps) => {
  const openImageViewer = useCanvasStore((state) => state.openImageViewer);
  const requestedSrc = useMemo(
    () => normalizeImageSrc(typeof src === 'string' ? src : null),
    [src]
  );
  const normalizedFallbackSrc = useMemo(() => normalizeImageSrc(fallbackSrc), [fallbackSrc]);
  const normalizedViewerSource = useMemo(
    () => normalizeImageSrc(viewerSourceUrl),
    [viewerSourceUrl]
  );
  const resolvedFallbackSrc = useMemo(() => {
    if (normalizedFallbackSrc && normalizedFallbackSrc !== requestedSrc) {
      return normalizedFallbackSrc;
    }

    if (normalizedViewerSource && normalizedViewerSource !== requestedSrc) {
      return normalizedViewerSource;
    }

    return null;
  }, [normalizedFallbackSrc, normalizedViewerSource, requestedSrc]);
  const resolvedDisplayState = useMemo(
    () => resolveDisplayState(requestedSrc, resolvedFallbackSrc),
    [requestedSrc, resolvedFallbackSrc]
  );
  const [activeSrc, setActiveSrc] = useState<string | null>(() => resolvedDisplayState.activeSrc);
  const [isUsingFallback, setIsUsingFallback] = useState(
    () => resolvedDisplayState.isUsingFallback
  );
  const [retryAttempt, setRetryAttempt] = useState(0);
  const retryTimerRef = useRef<number | null>(null);
  const renderedSrc = useMemo(
    () => (activeSrc ? appendRetryTokenToImageSrc(activeSrc, retryAttempt) : null),
    [activeSrc, retryAttempt]
  );

  const clearRetryTimer = useCallback(() => {
    if (retryTimerRef.current !== null) {
      window.clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    clearRetryTimer();
    setActiveSrc((currentActiveSrc) => (
      currentActiveSrc === resolvedDisplayState.activeSrc
        ? currentActiveSrc
        : resolvedDisplayState.activeSrc
    ));
    setIsUsingFallback((currentIsUsingFallback) => (
      currentIsUsingFallback === resolvedDisplayState.isUsingFallback
        ? currentIsUsingFallback
        : resolvedDisplayState.isUsingFallback
    ));
    setRetryAttempt(0);
  }, [clearRetryTimer, resolvedDisplayState]);

  useEffect(() => () => {
    clearRetryTimer();
  }, [clearRetryTimer]);

  const handleLoad = useCallback((event: SyntheticEvent<HTMLImageElement, Event>) => {
    onLoad?.(event);
    clearRetryTimer();
    setRetryAttempt(0);
    markImageLoadSucceeded(activeSrc);
  }, [activeSrc, clearRetryTimer, onLoad]);

  const handleLoadError = useCallback((event: SyntheticEvent<HTMLImageElement, Event>) => {
    onError?.(event);

    if (event.defaultPrevented) {
      return;
    }

    const retryDelayMs = activeSrc
      ? LOCAL_IMAGE_RETRY_DELAYS_MS[retryAttempt]
      : undefined;
    if (
      activeSrc
      && retryDelayMs !== undefined
      && isRetryableLocalImageSource(activeSrc)
    ) {
      clearRetryTimer();
      retryTimerRef.current = window.setTimeout(() => {
        retryTimerRef.current = null;
        setRetryAttempt((currentAttempt) => currentAttempt + 1);
      }, retryDelayMs);
      return;
    }

    clearRetryTimer();
    markImageLoadFailed(activeSrc);

    if (!isUsingFallback && resolvedFallbackSrc) {
      setActiveSrc(resolvedFallbackSrc);
      setIsUsingFallback(true);
      setRetryAttempt(0);
      return;
    }

    console.warn('[CanvasNodeImage] image failed to load', {
      src: activeSrc,
      renderSrc: renderedSrc,
      requestedSrc,
      fallbackSrc: resolvedFallbackSrc,
      retryAttempt,
      viewerSourceUrl: normalizedViewerSource,
    });
    setActiveSrc(null);
    setIsUsingFallback(false);
    setRetryAttempt(0);
  }, [
    activeSrc,
    clearRetryTimer,
    isUsingFallback,
    normalizedViewerSource,
    onError,
    requestedSrc,
    renderedSrc,
    resolvedFallbackSrc,
    retryAttempt,
  ]);

  const handleDoubleClick = useCallback((event: MouseEvent<HTMLImageElement>) => {
    onDoubleClick?.(event);

    if (event.defaultPrevented || disableViewer) {
      return;
    }

    const currentDisplaySrc =
      event.currentTarget.currentSrc || activeSrc || requestedSrc || resolvedFallbackSrc || '';
    const resolvedSource =
      normalizedViewerSource ?? currentDisplaySrc.trim();
    if (!resolvedSource) {
      return;
    }

    event.stopPropagation();
    openImageViewer(
      resolvedSource,
      normalizeViewerList(viewerImageList, resolvedSource),
      viewerMetadata
    );
  }, [
    activeSrc,
    disableViewer,
    normalizedViewerSource,
    onDoubleClick,
    openImageViewer,
    requestedSrc,
    resolvedFallbackSrc,
    viewerMetadata,
    viewerImageList,
  ]);

  return (
    <img
      {...props}
      src={renderedSrc ?? EMPTY_IMAGE_DATA_URL}
      data-image-load-state={activeSrc ? (isUsingFallback ? 'fallback' : 'primary') : 'failed'}
      data-viewer-src={
        normalizedViewerSource
          ? normalizedViewerSource
          : undefined
      }
      onLoad={handleLoad}
      onError={handleLoadError}
      onDoubleClick={handleDoubleClick}
    />
  );
});

CanvasNodeImage.displayName = 'CanvasNodeImage';
