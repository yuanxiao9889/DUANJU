import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type HTMLAttributes,
  type MutableRefObject,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type Ref,
  type SyntheticEvent,
} from 'react';
import { GripVertical, Image as ImageIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { ImageCompareNodeImageSnapshot } from '@/features/canvas/domain/canvasNodes';
import { CanvasNodeImage } from '@/features/canvas/ui/CanvasNodeImage';

function setForwardedRef<T>(ref: Ref<T> | undefined, value: T | null): void {
  if (!ref) {
    return;
  }

  if (typeof ref === 'function') {
    ref(value);
    return;
  }

  (ref as MutableRefObject<T | null>).current = value;
}

export function clampImageCompareDividerRatio(value: number): number {
  if (!Number.isFinite(value)) {
    return 0.5;
  }

  return Math.min(1, Math.max(0, value));
}

export function resolveImageCompareSources(
  imageUrl: string | null | undefined,
  previewImageUrl: string | null | undefined
): { primarySource: string | null; fallbackSource: string | null } {
  const resolvedImageUrl = typeof imageUrl === 'string' && imageUrl.trim().length > 0
    ? imageUrl
    : null;
  const resolvedPreviewImageUrl =
    typeof previewImageUrl === 'string' && previewImageUrl.trim().length > 0
      ? previewImageUrl
      : null;
  const primarySource = resolvedImageUrl ?? resolvedPreviewImageUrl;
  const fallbackSource = primarySource === resolvedImageUrl
    ? resolvedPreviewImageUrl
    : resolvedImageUrl;

  return {
    primarySource,
    fallbackSource,
  };
}

export interface ImageCompareStageProps extends HTMLAttributes<HTMLDivElement> {
  baseImage: ImageCompareNodeImageSnapshot;
  overlayImage: ImageCompareNodeImageSnapshot;
  dividerRatio: number;
  onDividerRatioCommit?: (ratio: number) => void;
  onDividerDragStart?: () => void;
  baseImageRef?: Ref<HTMLImageElement>;
  onBaseImageLoad?: (event: SyntheticEvent<HTMLImageElement, Event>) => void;
}

export const ImageCompareStage = memo(forwardRef<HTMLDivElement, ImageCompareStageProps>(({
  baseImage,
  overlayImage,
  dividerRatio,
  onDividerRatioCommit,
  onDividerDragStart,
  baseImageRef,
  onBaseImageLoad,
  className,
  ...props
}, forwardedRef) => {
  const { t } = useTranslation();
  const stageRef = useRef<HTMLDivElement | null>(null);
  const committedDividerRatio = clampImageCompareDividerRatio(dividerRatio);
  const [draftDividerRatio, setDraftDividerRatio] = useState(committedDividerRatio);
  const [isDraggingDivider, setIsDraggingDivider] = useState(false);
  const draftDividerRatioRef = useRef(draftDividerRatio);
  const committedDividerRatioRef = useRef(committedDividerRatio);

  useEffect(() => {
    draftDividerRatioRef.current = draftDividerRatio;
  }, [draftDividerRatio]);

  useEffect(() => {
    committedDividerRatioRef.current = committedDividerRatio;
    if (!isDraggingDivider) {
      setDraftDividerRatio(committedDividerRatio);
    }
  }, [committedDividerRatio, isDraggingDivider]);

  const baseSources = useMemo(
    () => resolveImageCompareSources(baseImage.imageUrl, baseImage.previewImageUrl),
    [baseImage.imageUrl, baseImage.previewImageUrl]
  );
  const overlaySources = useMemo(
    () => resolveImageCompareSources(overlayImage.imageUrl, overlayImage.previewImageUrl),
    [overlayImage.imageUrl, overlayImage.previewImageUrl]
  );
  const hasRenderableImages = Boolean(baseSources.primarySource && overlaySources.primarySource);

  const setStageRefs = useCallback((node: HTMLDivElement | null) => {
    stageRef.current = node;
    setForwardedRef(forwardedRef, node);
  }, [forwardedRef]);

  const updateDividerRatioFromClientX = useCallback((clientX: number) => {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) {
      return null;
    }

    const nextRatio = clampImageCompareDividerRatio((clientX - rect.left) / rect.width);
    setDraftDividerRatio(nextRatio);
    return nextRatio;
  }, []);

  useEffect(() => {
    if (!isDraggingDivider) {
      return;
    }

    const handlePointerMove = (event: PointerEvent) => {
      updateDividerRatioFromClientX(event.clientX);
    };

    const handlePointerUp = () => {
      setIsDraggingDivider(false);
      const nextRatio = draftDividerRatioRef.current;
      if (Math.abs(nextRatio - committedDividerRatioRef.current) > 0.0001) {
        onDividerRatioCommit?.(nextRatio);
      }
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp, { once: true });

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [isDraggingDivider, onDividerRatioCommit, updateDividerRatioFromClientX]);

  const handleDividerPointerDown = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    onDividerDragStart?.();
    setIsDraggingDivider(true);
    updateDividerRatioFromClientX(event.clientX);
  }, [onDividerDragStart, updateDividerRatioFromClientX]);

  const stopDividerMousePropagation = useCallback((event: ReactMouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
  }, []);

  return (
    <div
      {...props}
      ref={setStageRefs}
      className={`relative h-full w-full overflow-hidden bg-bg-dark ${className ?? ''}`}
    >
      {hasRenderableImages ? (
        <>
          <CanvasNodeImage
            ref={baseImageRef}
            src={baseSources.primarySource ?? ''}
            fallbackSrc={baseSources.fallbackSource}
            disableViewer
            alt={t('node.imageCompare.baseAlt')}
            className="absolute inset-0 h-full w-full object-contain"
            onLoad={onBaseImageLoad}
          />
          <div
            className="absolute inset-0"
            style={{
              clipPath: `inset(0 ${Math.max(0, 100 - draftDividerRatio * 100)}% 0 0)`,
            }}
          >
            <CanvasNodeImage
              src={overlaySources.primarySource ?? ''}
              fallbackSrc={overlaySources.fallbackSource}
              disableViewer
              alt={t('node.imageCompare.overlayAlt')}
              className="absolute inset-0 h-full w-full object-contain"
            />
          </div>

          <div
            className="pointer-events-none absolute inset-y-0 z-10 flex -translate-x-1/2 items-center"
            style={{ left: `${draftDividerRatio * 100}%` }}
          >
            <div className="h-full w-px bg-white/80 shadow-[0_0_0_1px_rgba(15,23,42,0.18)]" />
          </div>

          <button
            type="button"
            aria-label={t('node.imageCompare.dragDivider')}
            title={t('node.imageCompare.dragDivider')}
            className="nodrag nowheel absolute inset-y-0 z-20 flex -translate-x-1/2 items-center"
            style={{ left: `${draftDividerRatio * 100}%` }}
            onPointerDown={handleDividerPointerDown}
            onMouseDown={stopDividerMousePropagation}
            onClick={stopDividerMousePropagation}
            onDoubleClick={stopDividerMousePropagation}
          >
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/18 bg-surface-dark/92 text-text-dark shadow-[0_10px_24px_rgba(0,0,0,0.24)] backdrop-blur transition-colors hover:border-accent/45 hover:text-accent">
              <GripVertical className="h-4 w-4" />
            </span>
          </button>
        </>
      ) : (
        <div className="flex h-full w-full flex-col items-center justify-center gap-3 px-4 text-text-muted/85">
          <ImageIcon className="h-8 w-8 opacity-60" />
          <span className="text-center text-[12px] leading-6">
            {t('node.imageCompare.empty')}
          </span>
        </div>
      )}
    </div>
  );
}));

ImageCompareStage.displayName = 'ImageCompareStage';
