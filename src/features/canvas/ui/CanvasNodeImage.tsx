import {
  forwardRef,
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
  getImageLoadRetryDelayMs,
  markImageLoadFailed,
  markImageLoadSucceeded,
  shouldAttemptImageLoad,
} from '@/features/canvas/application/imageLoadState';
import { resolveLocalFileSourcePath } from '@/features/canvas/application/imageData';
import type { ImageViewerMetadata } from '@/features/canvas/domain/canvasNodes';
import { useStableImageDisplaySource } from '@/features/canvas/hooks/useStableImageDisplaySource';
import { useCanvasStore } from '@/stores/canvasStore';

export interface CanvasNodeImageProps extends ImgHTMLAttributes<HTMLImageElement> {
  viewerSourceUrl?: string | null;
  viewerImageList?: Array<string | null | undefined>;
  viewerMetadata?: ImageViewerMetadata | null;
  disableViewer?: boolean;
  fallbackSrc?: string | null;
  onSourceUnavailable?: (error?: unknown) => void;
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

function normalizeCandidateList(values: Array<string | null | undefined>): string[] {
  const deduped: string[] = [];
  for (const value of values) {
    const normalized = normalizeImageSrc(value);
    if (!normalized || deduped.includes(normalized)) {
      continue;
    }
    deduped.push(normalized);
  }
  return deduped;
}

function resolveSkippedCandidateRetryDelayMs(candidateSources: string[]): number | null {
  let retryDelayMs: number | null = null;

  for (const candidate of candidateSources) {
    const candidateDelayMs = getImageLoadRetryDelayMs(candidate);
    if (candidateDelayMs === null) {
      continue;
    }

    retryDelayMs =
      retryDelayMs === null
        ? candidateDelayMs
        : Math.min(retryDelayMs, candidateDelayMs);
  }

  return retryDelayMs;
}

export const CanvasNodeImage = memo(forwardRef<HTMLImageElement, CanvasNodeImageProps>(({
  viewerSourceUrl,
  viewerImageList,
  viewerMetadata = null,
  disableViewer = false,
  fallbackSrc,
  onSourceUnavailable,
  onDoubleClick,
  onError,
  onLoad,
  src,
  ...props
}, forwardedRef) => {
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
  const candidateSources = useMemo(
    () => normalizeCandidateList([
      requestedSrc,
      resolvedFallbackSrc,
      normalizedViewerSource,
      ...(viewerImageList ?? []),
    ]),
    [normalizedViewerSource, requestedSrc, resolvedFallbackSrc, viewerImageList]
  );
  const candidateSourcesKey = useMemo(() => candidateSources.join('\n'), [candidateSources]);
  const [activeSrc, setActiveSrc] = useState<string | null>(() => resolvedDisplayState.activeSrc);
  const [isUsingFallback, setIsUsingFallback] = useState(
    () => resolvedDisplayState.isUsingFallback
  );
  const [retryAttempt, setRetryAttempt] = useState(0);
  const retryTimerRef = useRef<number | null>(null);
  const failedCandidateSourcesRef = useRef<Set<string>>(new Set());
  const {
    displaySource: activeDisplaySource,
    loadError: activeDisplaySourceError,
    isLocalSource: isActiveLocalSource,
  } = useStableImageDisplaySource(activeSrc);
  const renderedSrc = useMemo(
    () => {
      if (!activeSrc) {
        return null;
      }

      if (isActiveLocalSource) {
        return activeDisplaySource;
      }

      return appendRetryTokenToImageSrc(activeDisplaySource ?? activeSrc, retryAttempt);
    },
    [activeDisplaySource, activeSrc, isActiveLocalSource, retryAttempt]
  );

  const clearRetryTimer = useCallback(() => {
    if (retryTimerRef.current !== null) {
      window.clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    clearRetryTimer();
    failedCandidateSourcesRef.current.clear();
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
  }, [candidateSourcesKey, clearRetryTimer, resolvedDisplayState]);

  useEffect(() => () => {
    clearRetryTimer();
  }, [clearRetryTimer]);

  useEffect(() => {
    if (activeSrc || candidateSources.length === 0) {
      return;
    }

    const retryDelayMs = resolveSkippedCandidateRetryDelayMs(candidateSources);
    if (retryDelayMs === null) {
      return;
    }

    const retryTimerId = window.setTimeout(() => {
      const nextCandidate = candidateSources.find((candidate) => shouldAttemptImageLoad(candidate));
      if (!nextCandidate) {
        return;
      }

      failedCandidateSourcesRef.current.delete(nextCandidate);
      setActiveSrc(nextCandidate);
      setIsUsingFallback(nextCandidate !== requestedSrc);
      setRetryAttempt(0);
    }, retryDelayMs + 20);

    return () => {
      window.clearTimeout(retryTimerId);
    };
  }, [activeSrc, candidateSources, requestedSrc]);

  const handleSourceFailure = useCallback((reason: 'resolve' | 'render', error?: unknown) => {
    clearRetryTimer();
    markImageLoadFailed(activeSrc);
    if (activeSrc) {
      failedCandidateSourcesRef.current.add(activeSrc);
    }

    const nextCandidate = candidateSources.find((candidate) => (
      candidate !== activeSrc
      && !failedCandidateSourcesRef.current.has(candidate)
      && shouldAttemptImageLoad(candidate)
    ));
    if (nextCandidate) {
      setActiveSrc(nextCandidate);
      setIsUsingFallback(nextCandidate !== requestedSrc);
      setRetryAttempt(0);
      return;
    }

    const logPayload = {
      src: activeSrc,
      renderSrc: renderedSrc,
      requestedSrc,
      fallbackSrc: resolvedFallbackSrc,
      retryAttempt,
      viewerSourceUrl: normalizedViewerSource,
      reason,
      error,
    };
    if (isActiveLocalSource) {
      console.debug('[CanvasNodeImage] image failed to load', logPayload);
    } else {
      console.warn('[CanvasNodeImage] image failed to load', logPayload);
    }
    onSourceUnavailable?.(error);
    setActiveSrc(null);
    setIsUsingFallback(false);
    setRetryAttempt(0);
  }, [
    activeSrc,
    candidateSources,
    clearRetryTimer,
    isActiveLocalSource,
    normalizedViewerSource,
    onSourceUnavailable,
    renderedSrc,
    requestedSrc,
    resolvedFallbackSrc,
    retryAttempt,
  ]);

  useEffect(() => {
    if (!activeSrc || !isActiveLocalSource || !activeDisplaySourceError) {
      return;
    }

    handleSourceFailure('resolve', activeDisplaySourceError);
  }, [
    activeDisplaySourceError,
    activeSrc,
    handleSourceFailure,
    isActiveLocalSource,
  ]);

  const handleLoad = useCallback((event: SyntheticEvent<HTMLImageElement, Event>) => {
    onLoad?.(event);
    const currentDisplaySrc = event.currentTarget.currentSrc || event.currentTarget.src || '';
    if (isActiveLocalSource && (!activeDisplaySource || currentDisplaySrc === EMPTY_IMAGE_DATA_URL)) {
      return;
    }
    clearRetryTimer();
    setRetryAttempt(0);
    markImageLoadSucceeded(activeSrc);
  }, [activeDisplaySource, activeSrc, clearRetryTimer, isActiveLocalSource, onLoad]);

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
      && !isActiveLocalSource
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

    handleSourceFailure('render');
  }, [
    activeSrc,
    clearRetryTimer,
    handleSourceFailure,
    isActiveLocalSource,
    onError,
    retryAttempt,
  ]);

  const handleDoubleClick = useCallback((event: MouseEvent<HTMLImageElement>) => {
    onDoubleClick?.(event);

    if (event.defaultPrevented || disableViewer) {
      return;
    }

    const currentDisplaySrc =
      activeSrc || requestedSrc || resolvedFallbackSrc || event.currentTarget.currentSrc || '';
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
      ref={forwardedRef}
      src={renderedSrc ?? EMPTY_IMAGE_DATA_URL}
      decoding={props.decoding ?? 'async'}
      fetchPriority={props.fetchPriority ?? 'low'}
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
}));

CanvasNodeImage.displayName = 'CanvasNodeImage';
