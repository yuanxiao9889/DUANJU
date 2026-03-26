import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ImgHTMLAttributes,
  type MouseEvent,
  type SyntheticEvent,
} from 'react';

import { useCanvasStore } from '@/stores/canvasStore';

export interface CanvasNodeImageProps extends ImgHTMLAttributes<HTMLImageElement> {
  viewerSourceUrl?: string | null;
  viewerImageList?: Array<string | null | undefined>;
  disableViewer?: boolean;
  fallbackSrc?: string | null;
}

const EMPTY_IMAGE_DATA_URL = 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';

function normalizeImageSrc(value: string | null | undefined): string | null {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed.length > 0 ? trimmed : null;
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
  disableViewer = false,
  fallbackSrc,
  onDoubleClick,
  onError,
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
  const [activeSrc, setActiveSrc] = useState<string | null>(() => requestedSrc ?? resolvedFallbackSrc);
  const [isUsingFallback, setIsUsingFallback] = useState(
    () => !requestedSrc && Boolean(resolvedFallbackSrc)
  );

  useEffect(() => {
    setActiveSrc(requestedSrc ?? resolvedFallbackSrc);
    setIsUsingFallback(!requestedSrc && Boolean(resolvedFallbackSrc));
  }, [requestedSrc, resolvedFallbackSrc]);

  const handleLoadError = useCallback((event: SyntheticEvent<HTMLImageElement, Event>) => {
    onError?.(event);

    if (event.defaultPrevented) {
      return;
    }

    if (!isUsingFallback && resolvedFallbackSrc) {
      console.warn('[CanvasNodeImage] primary image failed, retrying fallback source', {
        src: requestedSrc,
        fallbackSrc: resolvedFallbackSrc,
        viewerSourceUrl: normalizedViewerSource,
      });
      setActiveSrc(resolvedFallbackSrc);
      setIsUsingFallback(true);
      return;
    }

    console.warn('[CanvasNodeImage] image failed to load', {
      src: activeSrc,
      requestedSrc,
      fallbackSrc: resolvedFallbackSrc,
      viewerSourceUrl: normalizedViewerSource,
    });
    setActiveSrc(null);
    setIsUsingFallback(false);
  }, [
    activeSrc,
    isUsingFallback,
    normalizedViewerSource,
    onError,
    requestedSrc,
    resolvedFallbackSrc,
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
    openImageViewer(resolvedSource, normalizeViewerList(viewerImageList, resolvedSource));
  }, [
    activeSrc,
    disableViewer,
    normalizedViewerSource,
    onDoubleClick,
    openImageViewer,
    requestedSrc,
    resolvedFallbackSrc,
    viewerImageList,
  ]);

  return (
    <img
      {...props}
      src={activeSrc ?? EMPTY_IMAGE_DATA_URL}
      data-image-load-state={activeSrc ? (isUsingFallback ? 'fallback' : 'primary') : 'failed'}
      data-viewer-src={
        normalizedViewerSource
          ? normalizedViewerSource
          : undefined
      }
      onError={handleLoadError}
      onDoubleClick={handleDoubleClick}
    />
  );
});

CanvasNodeImage.displayName = 'CanvasNodeImage';
