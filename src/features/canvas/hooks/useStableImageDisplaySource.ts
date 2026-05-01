import { useEffect, useMemo, useState } from 'react';

import {
  getCachedStableImageDisplaySource,
  loadStableImageDisplaySource,
  resolveImageDisplayUrl,
  resolveLocalFileSourcePath,
} from '@/features/canvas/application/imageData';

interface StableImageDisplaySourceState {
  displaySource: string | null;
  isLoading: boolean;
  loadError: unknown;
  isLocalSource: boolean;
}

function normalizeSource(source: string | null | undefined): string | null {
  const normalized = typeof source === 'string' ? source.trim() : '';
  return normalized || null;
}

function resolveInitialDisplaySource(source: string | null): string | null {
  if (!source) {
    return null;
  }

  const cachedDisplaySource = getCachedStableImageDisplaySource(source);
  if (cachedDisplaySource) {
    return cachedDisplaySource;
  }

  return resolveLocalFileSourcePath(source) ? null : resolveImageDisplayUrl(source);
}

export function useStableImageDisplaySource(
  source: string | null | undefined
): StableImageDisplaySourceState {
  const normalizedSource = useMemo(() => normalizeSource(source), [source]);
  const isLocalSource = useMemo(
    () => Boolean(normalizedSource && resolveLocalFileSourcePath(normalizedSource)),
    [normalizedSource]
  );
  const [displaySource, setDisplaySource] = useState<string | null>(() =>
    resolveInitialDisplaySource(normalizedSource)
  );
  const [isLoading, setIsLoading] = useState(
    () => Boolean(normalizedSource && isLocalSource && !displaySource)
  );
  const [loadError, setLoadError] = useState<unknown>(null);

  useEffect(() => {
    let disposed = false;

    if (!normalizedSource) {
      setDisplaySource(null);
      setIsLoading(false);
      setLoadError(null);
      return () => {
        disposed = true;
      };
    }

    const initialDisplaySource = resolveInitialDisplaySource(normalizedSource);
    setDisplaySource(initialDisplaySource);
    setLoadError(null);

    if (!isLocalSource) {
      setIsLoading(false);
      return () => {
        disposed = true;
      };
    }

    if (initialDisplaySource) {
      setIsLoading(false);
      return () => {
        disposed = true;
      };
    }

    setIsLoading(true);
    void loadStableImageDisplaySource(normalizedSource)
      .then((nextDisplaySource) => {
        if (disposed) {
          return;
        }
        setDisplaySource(nextDisplaySource);
        setIsLoading(false);
        setLoadError(null);
      })
      .catch((error) => {
        if (disposed) {
          return;
        }
        setDisplaySource(null);
        setIsLoading(false);
        setLoadError(error);
      });

    return () => {
      disposed = true;
    };
  }, [isLocalSource, normalizedSource]);

  return {
    displaySource,
    isLoading,
    loadError,
    isLocalSource,
  };
}
