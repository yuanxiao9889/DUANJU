import { memo, useEffect, useMemo } from 'react';
import { Handle, Position, useUpdateNodeInternals, type NodeProps } from '@xyflow/react';
import { Loader2, Sparkles, TriangleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import {
  CANVAS_NODE_TYPES,
  JIMENG_IMAGE_RESULT_NODE_DEFAULT_HEIGHT,
  JIMENG_IMAGE_RESULT_NODE_DEFAULT_WIDTH,
  JIMENG_IMAGE_RESULT_NODE_MIN_HEIGHT,
  JIMENG_IMAGE_RESULT_NODE_MIN_WIDTH,
  type JimengGeneratedImageItem,
  type JimengImageResultNodeData,
} from '@/features/canvas/domain/canvasNodes';
import { resolveNodeDisplayName } from '@/features/canvas/domain/nodeDisplay';
import { resolveImageDisplayUrl } from '@/features/canvas/application/imageData';
import { CanvasNodeImage } from '@/features/canvas/ui/CanvasNodeImage';
import { NodeHeader, NODE_HEADER_FLOATING_POSITION_CLASS } from '@/features/canvas/ui/NodeHeader';
import { NodeResizeHandle } from '@/features/canvas/ui/NodeResizeHandle';
import { NodeStatusBadge } from '@/features/canvas/ui/NodeStatusBadge';
import { useCanvasStore } from '@/stores/canvasStore';

type JimengImageResultNodeProps = NodeProps & {
  id: string;
  data: JimengImageResultNodeData;
  selected?: boolean;
};

const RESULT_GRID_SLOT_COUNT = 4;

function formatTimestamp(
  timestamp: number | null | undefined,
  locale: string
): string | null {
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp) || timestamp <= 0) {
    return null;
  }

  return new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(timestamp));
}

function buildResultSlots(results: JimengGeneratedImageItem[]): Array<JimengGeneratedImageItem | null> {
  return Array.from({ length: RESULT_GRID_SLOT_COUNT }, (_value, index) => results[index] ?? null);
}

function toCssAspectRatio(aspectRatio: string): string {
  const [rawWidth = '1', rawHeight = '1'] = aspectRatio.split(':');
  const width = Number(rawWidth);
  const height = Number(rawHeight);

  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return '1 / 1';
  }

  return `${width} / ${height}`;
}

export const JimengImageResultNode = memo(({
  id,
  data,
  selected,
  width,
  height,
}: JimengImageResultNodeProps) => {
  const { t, i18n } = useTranslation();
  const updateNodeInternals = useUpdateNodeInternals();
  const setSelectedNode = useCanvasStore((state) => state.setSelectedNode);
  const updateNodeData = useCanvasStore((state) => state.updateNodeData);

  const resultImages = useMemo(
    () => (Array.isArray(data.resultImages) ? data.resultImages : []),
    [data.resultImages]
  );
  const resultSlots = useMemo(() => buildResultSlots(resultImages), [resultImages]);
  const viewerImageList = useMemo(
    () =>
      resultImages
        .map((item) => item.imageUrl ?? item.previewImageUrl ?? item.sourceUrl ?? '')
        .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
        .map((value) => resolveImageDisplayUrl(value)),
    [resultImages]
  );
  const resolvedTitle = useMemo(
    () => resolveNodeDisplayName(CANVAS_NODE_TYPES.jimengImageResult, data),
    [data]
  );
  const resolvedWidth = Math.max(
    JIMENG_IMAGE_RESULT_NODE_MIN_WIDTH,
    Math.round(width ?? JIMENG_IMAGE_RESULT_NODE_DEFAULT_WIDTH)
  );
  const resolvedHeight = Math.max(
    JIMENG_IMAGE_RESULT_NODE_MIN_HEIGHT,
    Math.round(height ?? JIMENG_IMAGE_RESULT_NODE_DEFAULT_HEIGHT)
  );
  const resolvedAspectRatio = useMemo(
    () => toCssAspectRatio(data.aspectRatio ?? '1:1'),
    [data.aspectRatio]
  );
  const lastGeneratedTime = useMemo(
    () => formatTimestamp(data.lastGeneratedAt ?? null, i18n.language),
    [data.lastGeneratedAt, i18n.language]
  );

  useEffect(() => {
    updateNodeInternals(id);
  }, [id, resolvedHeight, resolvedWidth, resultImages.length, updateNodeInternals]);

  const headerStatus = useMemo(() => {
    if (data.isGenerating) {
      return (
        <NodeStatusBadge
          icon={<Loader2 className="h-3 w-3" />}
          label={t('node.jimengImageResult.generating')}
          tone="processing"
          animate
        />
      );
    }

    if (data.lastError) {
      return (
        <NodeStatusBadge
          icon={<TriangleAlert className="h-3 w-3" />}
          label={t('nodeStatus.error')}
          tone="danger"
          title={data.lastError}
        />
      );
    }

    if (resultImages.length > 0) {
      return (
        <NodeStatusBadge
          icon={<Sparkles className="h-3 w-3" />}
          label={t('node.jimengImageResult.readyCount', { count: resultImages.length })}
          tone="warning"
        />
      );
    }

    return null;
  }, [data.isGenerating, data.lastError, resultImages.length, t]);

  const statusInfoText = data.lastError
    ?? (data.isGenerating
      ? t('node.jimengImageResult.statusGenerating')
      : lastGeneratedTime
        ? t('node.jimengImageResult.generatedAt', { time: lastGeneratedTime })
        : t('node.jimengImageResult.empty'));

  return (
    <div
      className={`
        group relative flex h-full flex-col overflow-hidden rounded-[var(--node-radius)] border bg-surface-dark/90 p-2 transition-colors duration-150
        ${selected
          ? 'border-accent shadow-[0_0_0_1px_rgba(59,130,246,0.32)]'
          : 'border-[rgba(15,23,42,0.22)] hover:border-[rgba(15,23,42,0.34)] dark:border-[rgba(255,255,255,0.22)] dark:hover:border-[rgba(255,255,255,0.34)]'}
      `}
      style={{ width: `${resolvedWidth}px`, height: `${resolvedHeight}px` }}
      onClick={() => setSelectedNode(id)}
    >
      <NodeHeader
        className={NODE_HEADER_FLOATING_POSITION_CLASS}
        icon={<Sparkles className="h-3.5 w-3.5" />}
        titleText={resolvedTitle}
        rightSlot={headerStatus ?? undefined}
        editable
        onTitleChange={(nextTitle) => updateNodeData(id, { displayName: nextTitle })}
      />

      <div className="ui-scrollbar nowheel min-h-0 flex-1 overflow-auto pt-8" onWheelCapture={(event) => event.stopPropagation()}>
        <div className="grid grid-cols-2 gap-2">
          {resultSlots.map((item, index) => {
            const source = item?.previewImageUrl ?? item?.imageUrl ?? item?.sourceUrl ?? null;
            const viewerSource = item?.imageUrl ?? item?.previewImageUrl ?? item?.sourceUrl ?? null;
            return (
              <div
                key={item?.id ?? `jimeng-result-slot-${index + 1}`}
                className="relative overflow-hidden rounded-xl border border-white/10 bg-black/10"
              >
                <div className="overflow-hidden bg-surface-dark" style={{ aspectRatio: resolvedAspectRatio }}>
                  {source && viewerSource ? (
                    <CanvasNodeImage
                      src={resolveImageDisplayUrl(source)}
                      alt={item?.fileName ?? t('node.jimengImageResult.slotLabel', { index: index + 1 })}
                      viewerSourceUrl={resolveImageDisplayUrl(viewerSource)}
                      viewerImageList={viewerImageList}
                      className="h-full w-full object-cover"
                      draggable={false}
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center bg-[radial-gradient(circle_at_top,#1f2937_0%,#0f172a_72%)] text-sm text-text-muted">
                      {data.isGenerating
                        ? t('node.jimengImageResult.pending')
                        : t('node.jimengImageResult.slotLabel', { index: index + 1 })}
                    </div>
                  )}
                </div>
                <div className="pointer-events-none absolute left-2 top-2 rounded-full bg-black/45 px-2 py-1 text-[11px] font-medium text-white">
                  {index + 1}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div
        className={`mt-2 min-h-[18px] text-[10px] leading-4 ${
          data.lastError ? 'text-rose-300' : 'text-text-muted'
        }`}
        title={statusInfoText}
      >
        {statusInfoText}
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
        minWidth={JIMENG_IMAGE_RESULT_NODE_MIN_WIDTH}
        minHeight={JIMENG_IMAGE_RESULT_NODE_MIN_HEIGHT}
      />
    </div>
  );
});

JimengImageResultNode.displayName = 'JimengImageResultNode';
