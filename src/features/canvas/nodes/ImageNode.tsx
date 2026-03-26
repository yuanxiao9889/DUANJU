import { memo, useEffect, useMemo, useState } from 'react';
import {
  Handle,
  Position,
  useUpdateNodeInternals,
  useViewport,
  type NodeProps,
} from '@xyflow/react';
import { AlertTriangle, Image as ImageIcon, RefreshCw, Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import {
  CANVAS_NODE_TYPES,
  DEFAULT_ASPECT_RATIO,
  EXPORT_RESULT_NODE_MIN_HEIGHT,
  EXPORT_RESULT_NODE_MIN_WIDTH,
  type CanvasNodeType,
  type ExportImageNodeData,
  type ImageEditNodeData,
} from '@/features/canvas/domain/canvasNodes';
import {
  resolveMinEdgeFittedSize,
  resolveResizeMinConstraintsByAspect,
} from '@/features/canvas/application/imageNodeSizing';
import {
  detectImageDimensions,
  resolveImageDisplayUrl,
  shouldUseOriginalImageByZoom,
} from '@/features/canvas/application/imageData';
import { resolveNodeDisplayName } from '@/features/canvas/domain/nodeDisplay';
import { NodeHeader, NODE_HEADER_FLOATING_POSITION_CLASS } from '@/features/canvas/ui/NodeHeader';
import { NodeResizeHandle } from '@/features/canvas/ui/NodeResizeHandle';
import { CanvasNodeImage } from '@/features/canvas/ui/CanvasNodeImage';
import { ImageResolutionBadge } from '@/features/canvas/ui/ImageResolutionBadge';
import { NodeStatusBadge } from '@/features/canvas/ui/NodeStatusBadge';
import { useCanvasStore } from '@/stores/canvasStore';

type ImageNodeProps = NodeProps & {
  id: string;
  data: ImageEditNodeData | ExportImageNodeData;
  selected?: boolean;
};

function resolveNodeDimension(value: number | undefined, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 1) {
    return Math.round(value);
  }
  return fallback;
}

export const ImageNode = memo(({ id, data, selected, type, width, height }: ImageNodeProps) => {
  const { t } = useTranslation();
  const updateNodeInternals = useUpdateNodeInternals();
  const setSelectedNode = useCanvasStore((state) => state.setSelectedNode);
  const updateNodeData = useCanvasStore((state) => state.updateNodeData);
  const { zoom } = useViewport();
  const [now, setNow] = useState(() => Date.now());
  const isExportResultNode = type === CANVAS_NODE_TYPES.exportImage;
  const isGenerating = typeof data.isGenerating === 'boolean' ? data.isGenerating : false;
  const hasPersistedImage = Boolean(data.imageUrl || data.previewImageUrl);
  const generationError =
    typeof (data as { generationError?: unknown }).generationError === 'string'
      ? ((data as { generationError?: string }).generationError ?? '').trim()
      : '';
  const generationJobId =
    typeof (data as { generationJobId?: unknown }).generationJobId === 'string'
      ? ((data as { generationJobId?: string }).generationJobId ?? '').trim()
      : '';
  const hasGenerationError =
    isExportResultNode && !isGenerating && !hasPersistedImage && generationError.length > 0;
  const canManualRefresh =
    isExportResultNode && !hasPersistedImage && !isGenerating && generationJobId.length > 0;
  const generationStartedAt =
    typeof data.generationStartedAt === 'number' ? data.generationStartedAt : null;
  const generationDurationMs =
    typeof data.generationDurationMs === 'number' ? data.generationDurationMs : 60000;
  const resolvedAspectRatio = data.aspectRatio || DEFAULT_ASPECT_RATIO;
  const compactSize = resolveMinEdgeFittedSize(resolvedAspectRatio, {
    minWidth: EXPORT_RESULT_NODE_MIN_WIDTH,
    minHeight: EXPORT_RESULT_NODE_MIN_HEIGHT,
  });
  const resizeConstraints = resolveResizeMinConstraintsByAspect(resolvedAspectRatio, {
    minWidth: EXPORT_RESULT_NODE_MIN_WIDTH,
    minHeight: EXPORT_RESULT_NODE_MIN_HEIGHT,
  });
  const resizeMinWidth = resizeConstraints.minWidth;
  const resizeMinHeight = resizeConstraints.minHeight;
  const imageWidth =
    typeof data.imageWidth === 'number' && Number.isFinite(data.imageWidth) && data.imageWidth > 0
      ? Math.round(data.imageWidth)
      : null;
  const imageHeight =
    typeof data.imageHeight === 'number' && Number.isFinite(data.imageHeight) && data.imageHeight > 0
      ? Math.round(data.imageHeight)
      : null;
  const resolvedWidth = resolveNodeDimension(width, compactSize.width);
  const resolvedHeight = resolveNodeDimension(height, compactSize.height);
  const resolvedTitle = useMemo(
    () => resolveNodeDisplayName(type as CanvasNodeType, data),
    [data, type]
  );
  const dimensionSource = data.imageUrl ?? data.previewImageUrl ?? null;

  useEffect(() => {
    updateNodeInternals(id);
  }, [id, resolvedHeight, resolvedWidth, updateNodeInternals]);

  useEffect(() => {
    if (!isGenerating) {
      return;
    }

    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, 120);

    return () => {
      window.clearInterval(timer);
    };
  }, [isGenerating]);

  useEffect(() => {
    if (!dimensionSource || (imageWidth !== null && imageHeight !== null)) {
      return;
    }

    let disposed = false;

    void detectImageDimensions(dimensionSource)
      .then((dimensions) => {
        if (disposed) {
          return;
        }

        updateNodeData(id, {
          imageWidth: dimensions.width,
          imageHeight: dimensions.height,
        });
      })
      .catch(() => {});

    return () => {
      disposed = true;
    };
  }, [dimensionSource, id, imageHeight, imageWidth, updateNodeData]);

  const simulatedProgress = useMemo(() => {
    if (!isGenerating) {
      return 0;
    }

    const startedAt = generationStartedAt ?? Date.now();
    const duration = Math.max(1000, generationDurationMs);
    const elapsed = Math.max(0, now - startedAt);

    return Math.min(elapsed / duration, 0.96);
  }, [generationDurationMs, generationStartedAt, isGenerating, now]);

  const waitedMinutes = useMemo(() => {
    if (!isGenerating || generationStartedAt === null) {
      return 0;
    }

    const elapsed = Math.max(0, now - generationStartedAt);
    return Math.floor(elapsed / 60000);
  }, [generationStartedAt, isGenerating, now]);

  const waitingResultText = useMemo(() => {
    if (!isExportResultNode) {
      return t('node.imageNode.selectToEdit');
    }

    if (!isGenerating || waitedMinutes < 2) {
      return t('node.imageNode.waitingResult');
    }

    return t('node.imageNode.waitingResultDelayed', { minutes: waitedMinutes });
  }, [isExportResultNode, isGenerating, t, waitedMinutes]);

  const originalImageUrl = useMemo(() => {
    if (!data.imageUrl) {
      return null;
    }

    return resolveImageDisplayUrl(data.imageUrl);
  }, [data.imageUrl]);

  const previewImageUrl = useMemo(() => {
    if (!data.previewImageUrl) {
      return null;
    }

    return resolveImageDisplayUrl(data.previewImageUrl);
  }, [data.previewImageUrl]);

  const imageSource = useMemo(() => {
    const preferOriginal = shouldUseOriginalImageByZoom(zoom);
    return preferOriginal
      ? (originalImageUrl ?? previewImageUrl)
      : (previewImageUrl ?? originalImageUrl);
  }, [originalImageUrl, previewImageUrl, zoom]);

  const fallbackImageSource = useMemo(() => {
    if (!imageSource) {
      return null;
    }

    if (imageSource === originalImageUrl) {
      return previewImageUrl && previewImageUrl !== imageSource ? previewImageUrl : null;
    }

    return originalImageUrl && originalImageUrl !== imageSource ? originalImageUrl : null;
  }, [imageSource, originalImageUrl, previewImageUrl]);

  const hasRenderableImage = Boolean(imageSource || fallbackImageSource);

  const handleManualRefresh = () => {
    if (!canManualRefresh) {
      return;
    }

    updateNodeData(id, {
      isGenerating: true,
      generationStartedAt: Date.now(),
      generationError: null,
      generationErrorDetails: null,
    });
  };

  const headerStatus = useMemo(() => {
    if (hasGenerationError) {
      return (
        <NodeStatusBadge
          icon={<AlertTriangle className="h-3 w-3" />}
          label={t('nodeStatus.error')}
          tone="danger"
          title={generationError}
        />
      );
    }

    if (isGenerating) {
      return (
        <NodeStatusBadge
          icon={<RefreshCw className="h-3 w-3" />}
          label={t('nodeStatus.generating')}
          tone="processing"
          animate
        />
      );
    }

    if (canManualRefresh) {
      return (
        <NodeStatusBadge
          icon={<RefreshCw className="h-3 w-3" />}
          label={t('nodeStatus.retryAvailable')}
          tone="warning"
        />
      );
    }

    return null;
  }, [canManualRefresh, generationError, hasGenerationError, isGenerating, t]);

  return (
    <div
      className={`
        group relative overflow-visible rounded-[var(--node-radius)] border bg-surface-dark/85 p-0 transition-all duration-150
        ${hasGenerationError
          ? (selected
            ? 'border-red-400 shadow-[0_0_0_2px_rgba(248,113,113,0.5),0_4px_20px_rgba(248,113,113,0.25)]'
            : 'border-red-500/70 bg-[rgba(127,29,29,0.12)] hover:border-red-400/80 dark:border-red-500/70 dark:hover:border-red-400/80')
          : selected
          ? 'border-accent shadow-[0_0_0_2px_rgba(59,130,246,0.5),0_4px_20px_rgba(59,130,246,0.2)]'
          : 'border-[rgba(15,23,42,0.22)] hover:border-[rgba(15,23,42,0.34)] hover:shadow-[0_4px_16px_rgba(0,0,0,0.12)] dark:border-[rgba(255,255,255,0.22)] dark:hover:border-[rgba(255,255,255,0.34)] dark:hover:shadow-[0_4px_16px_rgba(0,0,0,0.25)]'}
      `}
      style={{ width: resolvedWidth, height: resolvedHeight }}
      onClick={() => setSelectedNode(id)}
    >
      <NodeHeader
        className={NODE_HEADER_FLOATING_POSITION_CLASS}
        icon={isExportResultNode
          ? <ImageIcon className="h-4 w-4" />
          : <Sparkles className="h-4 w-4" />}
        titleText={resolvedTitle}
        titleClassName="inline-block max-w-[220px] truncate whitespace-nowrap align-bottom"
        rightSlot={headerStatus}
        editable
        onTitleChange={(nextTitle) => updateNodeData(id, { displayName: nextTitle })}
      />

      <div
        className={`relative h-full w-full overflow-hidden rounded-[var(--node-radius)] ${hasGenerationError ? 'bg-[rgba(127,29,29,0.2)]' : 'bg-bg-dark'}`}
      >
        {hasRenderableImage ? (
          <CanvasNodeImage
            src={imageSource ?? ''}
            alt={isExportResultNode ? t('node.imageNode.resultAlt') : t('node.imageNode.generatedAlt')}
            fallbackSrc={fallbackImageSource}
            viewerSourceUrl={originalImageUrl ?? previewImageUrl}
            className="h-full w-full object-contain"
          />
        ) : hasGenerationError ? (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 px-4 text-red-300">
            <AlertTriangle className="h-7 w-7 opacity-90" />
            <span className="text-center text-[12px] font-medium leading-5 text-red-200">
              {t('node.imageNode.generationFailed')}
            </span>
            <span className="max-h-[88px] overflow-y-auto break-words text-center text-[11px] leading-5 text-red-200/90">
              {generationError}
            </span>
          </div>
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-text-muted/85">
            {isExportResultNode ? (
              <ImageIcon className="h-7 w-7 opacity-60" />
            ) : (
              <Sparkles className="h-7 w-7 opacity-60" />
            )}
            <span className="px-4 text-center text-[12px] leading-6">
              {waitingResultText}
            </span>
          </div>
        )}

        {isGenerating && (
          <div className="pointer-events-none absolute inset-0 overflow-hidden">
            <div className="absolute inset-0 bg-bg-dark/55" />
            <div
              className="absolute left-0 top-0 h-full bg-gradient-to-r from-[rgba(255,255,255,0.4)] to-[rgba(255,255,255,0.06)] transition-[width] duration-100 ease-linear"
              style={{ width: `${simulatedProgress * 100}%` }}
            />
          </div>
        )}

        {canManualRefresh && (
          <div className="absolute inset-0 flex items-center justify-center">
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                handleManualRefresh();
              }}
              className="inline-flex items-center gap-2 rounded-full border border-[rgba(255,255,255,0.18)] bg-bg-dark/90 px-4 py-2 text-sm font-medium text-text-dark shadow-lg transition-colors hover:border-accent/50 hover:bg-bg-dark"
            >
              <RefreshCw className="h-4 w-4" />
              {t('node.imageNode.manualRefresh')}
            </button>
          </div>
        )}

        <ImageResolutionBadge width={imageWidth} height={imageHeight} />
      </div>

      <Handle
        type="target"
        id="target"
        position={Position.Left}
        className="!h-2.5 !w-2.5 !border-2 !border-surface-dark !bg-accent"
      />
      <Handle
        type="source"
        id="source"
        position={Position.Right}
        className="!h-2.5 !w-2.5 !border-2 !border-surface-dark !bg-accent"
      />
      <NodeResizeHandle
        minWidth={resizeMinWidth}
        minHeight={resizeMinHeight}
        maxWidth={1600}
        maxHeight={1600}
        isVisible={selected}
      />
    </div>
  );
});

ImageNode.displayName = 'ImageNode';
