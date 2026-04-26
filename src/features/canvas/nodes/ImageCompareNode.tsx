import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type { NodeProps } from '@xyflow/react';
import { GripVertical, Image as ImageIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import {
  CANVAS_NODE_TYPES,
  IMAGE_COMPARE_NODE_DEFAULT_HEIGHT,
  IMAGE_COMPARE_NODE_DEFAULT_WIDTH,
  EXPORT_RESULT_NODE_MIN_HEIGHT,
  EXPORT_RESULT_NODE_MIN_WIDTH,
  type ImageCompareNodeData,
} from '@/features/canvas/domain/canvasNodes';
import { resolveNodeDisplayName } from '@/features/canvas/domain/nodeDisplay';
import { resolveImageDisplayUrl } from '@/features/canvas/application/imageData';
import { CanvasNodeImage } from '@/features/canvas/ui/CanvasNodeImage';
import { NodeHeader, NODE_HEADER_FLOATING_POSITION_CLASS } from '@/features/canvas/ui/NodeHeader';
import { NodeResizeHandle } from '@/features/canvas/ui/NodeResizeHandle';
import { useCanvasStore } from '@/stores/canvasStore';

type ImageCompareNodeProps = NodeProps & {
  id: string;
  data: ImageCompareNodeData;
  selected?: boolean;
};

function resolveNodeDimension(value: number | undefined, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 1) {
    return Math.round(value);
  }

  return fallback;
}

function clampDividerRatio(value: number): number {
  if (!Number.isFinite(value)) {
    return 0.5;
  }

  return Math.min(1, Math.max(0, value));
}

function resolveImageSources(imageUrl: string | null | undefined, previewImageUrl: string | null | undefined) {
  const resolvedImageUrl = typeof imageUrl === 'string' && imageUrl.trim().length > 0
    ? resolveImageDisplayUrl(imageUrl)
    : null;
  const resolvedPreviewImageUrl = typeof previewImageUrl === 'string' && previewImageUrl.trim().length > 0
    ? resolveImageDisplayUrl(previewImageUrl)
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

export const ImageCompareNode = memo(({
  id,
  data,
  selected,
  width,
  height,
}: ImageCompareNodeProps) => {
  const { t } = useTranslation();
  const setSelectedNode = useCanvasStore((state) => state.setSelectedNode);
  const updateNodeData = useCanvasStore((state) => state.updateNodeData);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const committedDividerRatio = clampDividerRatio(
    typeof data.dividerRatio === 'number' ? data.dividerRatio : 0.5
  );
  const [draftDividerRatio, setDraftDividerRatio] = useState(committedDividerRatio);
  const [isDraggingDivider, setIsDraggingDivider] = useState(false);
  const draftDividerRatioRef = useRef(draftDividerRatio);
  const committedDividerRatioRef = useRef(committedDividerRatio);
  const resolvedWidth = resolveNodeDimension(width, IMAGE_COMPARE_NODE_DEFAULT_WIDTH);
  const resolvedHeight = resolveNodeDimension(height, IMAGE_COMPARE_NODE_DEFAULT_HEIGHT);
  const resolvedTitle = useMemo(
    () => resolveNodeDisplayName(CANVAS_NODE_TYPES.imageCompare, data),
    [data]
  );

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
    () => resolveImageSources(data.baseImage.imageUrl, data.baseImage.previewImageUrl),
    [data.baseImage.imageUrl, data.baseImage.previewImageUrl]
  );
  const overlaySources = useMemo(
    () => resolveImageSources(data.overlayImage.imageUrl, data.overlayImage.previewImageUrl),
    [data.overlayImage.imageUrl, data.overlayImage.previewImageUrl]
  );
  const hasRenderableImages = Boolean(baseSources.primarySource && overlaySources.primarySource);

  const updateDividerRatioFromClientX = useCallback((clientX: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) {
      return null;
    }

    const nextRatio = clampDividerRatio((clientX - rect.left) / rect.width);
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
        updateNodeData(id, { dividerRatio: nextRatio });
      }
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp, { once: true });

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [id, isDraggingDivider, updateDividerRatioFromClientX, updateNodeData]);

  const handleDividerPointerDown = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setSelectedNode(id);
    setIsDraggingDivider(true);
    updateDividerRatioFromClientX(event.clientX);
  }, [id, setSelectedNode, updateDividerRatioFromClientX]);

  return (
    <div
      className={`
        group relative flex flex-col overflow-visible rounded-[var(--node-radius)] border bg-surface-dark/85 p-0 transition-all duration-150
        ${selected
          ? 'border-accent shadow-[0_0_0_2px_rgba(59,130,246,0.5),0_4px_20px_rgba(59,130,246,0.2)]'
          : 'border-[rgba(15,23,42,0.22)] hover:border-[rgba(15,23,42,0.34)] hover:shadow-[0_4px_16px_rgba(0,0,0,0.12)] dark:border-[rgba(255,255,255,0.22)] dark:hover:border-[rgba(255,255,255,0.34)] dark:hover:shadow-[0_4px_16px_rgba(0,0,0,0.25)]'}
      `}
      style={{ width: resolvedWidth, height: resolvedHeight }}
      onClick={() => setSelectedNode(id)}
    >
      <NodeHeader
        className={NODE_HEADER_FLOATING_POSITION_CLASS}
        icon={<ImageIcon className="h-4 w-4" />}
        titleText={resolvedTitle}
        titleClassName="inline-block max-w-[220px] truncate whitespace-nowrap align-bottom"
        editable
        onTitleChange={(nextTitle) => updateNodeData(id, { displayName: nextTitle })}
      />

      <div
        ref={containerRef}
        className="relative min-h-0 flex-1 overflow-hidden rounded-[var(--node-radius)] bg-bg-dark"
      >
        {hasRenderableImages ? (
          <>
            <CanvasNodeImage
              src={baseSources.primarySource ?? ''}
              fallbackSrc={baseSources.fallbackSource}
              disableViewer
              alt={t('node.imageCompare.baseAlt')}
              className="absolute inset-0 h-full w-full object-contain"
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

      <NodeResizeHandle
        minWidth={EXPORT_RESULT_NODE_MIN_WIDTH}
        minHeight={EXPORT_RESULT_NODE_MIN_HEIGHT}
        maxWidth={1600}
        maxHeight={1600}
        isVisible={selected}
      />
    </div>
  );
});

ImageCompareNode.displayName = 'ImageCompareNode';
