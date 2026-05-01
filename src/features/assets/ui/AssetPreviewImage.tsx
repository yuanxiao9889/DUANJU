import { useEffect, useMemo, useRef } from 'react';

import { resolveLocalFileSourcePath } from '@/features/canvas/application/imageData';
import { useStableImageDisplaySource } from '@/features/canvas/hooks/useStableImageDisplaySource';
import { CanvasNodeImage } from '@/features/canvas/ui/CanvasNodeImage';
import { useAssetStore } from '@/stores/assetStore';

interface AssetPreviewImageProps {
  assetId: string;
  previewSource?: string | null | undefined;
  sourceSource: string | null | undefined;
  alt: string;
  className: string;
}

function normalizeSource(source: string | null | undefined): string | null {
  const normalized = typeof source === 'string' ? source.trim() : '';
  return normalized || null;
}

export function AssetPreviewImage({
  assetId,
  previewSource,
  sourceSource,
  alt,
  className,
}: AssetPreviewImageProps) {
  const repairItemPreview = useAssetStore((state) => state.repairItemPreview);
  const normalizedPreviewSource = useMemo(() => normalizeSource(previewSource), [previewSource]);
  const normalizedSourceSource = useMemo(() => normalizeSource(sourceSource), [sourceSource]);
  const shouldRepairPreview = Boolean(
    assetId
    && normalizedSourceSource
    && resolveLocalFileSourcePath(normalizedSourceSource)
    && (!normalizedPreviewSource || normalizedPreviewSource !== normalizedSourceSource)
  );
  const { loadError: previewLoadError } = useStableImageDisplaySource(
    shouldRepairPreview && normalizedPreviewSource ? normalizedPreviewSource : null
  );
  const attemptedRepairKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!shouldRepairPreview || !normalizedSourceSource) {
      return;
    }

    if (normalizedPreviewSource && !previewLoadError) {
      return;
    }

    const repairKey = `${assetId}:${normalizedPreviewSource ?? 'missing-preview'}`;
    if (attemptedRepairKeyRef.current === repairKey) {
      return;
    }
    attemptedRepairKeyRef.current = repairKey;

    void repairItemPreview(assetId).catch((error) => {
      console.warn('[AssetPreviewImage] failed to repair asset preview', {
        assetId,
        source: normalizedSourceSource,
        error,
      });
    });
  }, [
    assetId,
    normalizedPreviewSource,
    normalizedSourceSource,
    previewLoadError,
    repairItemPreview,
    shouldRepairPreview,
  ]);

  return (
    <CanvasNodeImage
      src={normalizedPreviewSource ?? normalizedSourceSource ?? ''}
      fallbackSrc={
        normalizedSourceSource && normalizedSourceSource !== normalizedPreviewSource
          ? normalizedSourceSource
          : null
      }
      disableViewer
      alt={alt}
      className={className}
    />
  );
}
