import { memo, useEffect, useMemo, useState } from 'react';
import { Handle, Position, useUpdateNodeInternals, type NodeProps } from '@xyflow/react';
import { convertFileSrc, isTauri } from '@tauri-apps/api/core';
import { Loader2, Sparkles, TriangleAlert, Video } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import {
  CANVAS_NODE_TYPES,
  JIMENG_VIDEO_RESULT_NODE_DEFAULT_HEIGHT,
  JIMENG_VIDEO_RESULT_NODE_DEFAULT_WIDTH,
  JIMENG_VIDEO_RESULT_NODE_MIN_HEIGHT,
  JIMENG_VIDEO_RESULT_NODE_MIN_WIDTH,
  type JimengVideoResultNodeData,
} from '@/features/canvas/domain/canvasNodes';
import { resolveImageDisplayUrl } from '@/features/canvas/application/imageData';
import { formatVideoTime } from '@/features/canvas/application/videoData';
import { resolveNodeDisplayName } from '@/features/canvas/domain/nodeDisplay';
import { NodeHeader, NODE_HEADER_FLOATING_POSITION_CLASS } from '@/features/canvas/ui/NodeHeader';
import { NodeResizeHandle } from '@/features/canvas/ui/NodeResizeHandle';
import { NodeStatusBadge } from '@/features/canvas/ui/NodeStatusBadge';
import { useCanvasStore } from '@/stores/canvasStore';

type JimengVideoResultNodeProps = NodeProps & {
  id: string;
  data: JimengVideoResultNodeData;
  selected?: boolean;
};

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

function toCssAspectRatio(aspectRatio: string): string {
  const [rawWidth = '16', rawHeight = '9'] = aspectRatio.split(':');
  const width = Number(rawWidth);
  const height = Number(rawHeight);

  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return '16 / 9';
  }

  return `${width} / ${height}`;
}

export const JimengVideoResultNode = memo(({
  id,
  data,
  selected,
  width,
  height,
}: JimengVideoResultNodeProps) => {
  const { t, i18n } = useTranslation();
  const updateNodeInternals = useUpdateNodeInternals();
  const setSelectedNode = useCanvasStore((state) => state.setSelectedNode);
  const updateNodeData = useCanvasStore((state) => state.updateNodeData);
  const [playbackError, setPlaybackError] = useState<string | null>(null);

  const resolvedTitle = useMemo(
    () => resolveNodeDisplayName(CANVAS_NODE_TYPES.jimengVideoResult, data),
    [data]
  );
  const resolvedWidth = Math.max(
    JIMENG_VIDEO_RESULT_NODE_MIN_WIDTH,
    Math.round(width ?? JIMENG_VIDEO_RESULT_NODE_DEFAULT_WIDTH)
  );
  const resolvedHeight = Math.max(
    JIMENG_VIDEO_RESULT_NODE_MIN_HEIGHT,
    Math.round(height ?? JIMENG_VIDEO_RESULT_NODE_DEFAULT_HEIGHT)
  );
  const resolvedAspectRatio = useMemo(
    () => toCssAspectRatio(data.aspectRatio ?? '16:9'),
    [data.aspectRatio]
  );
  const videoSource = useMemo(() => {
    const source = data.videoUrl?.trim() ?? '';
    if (!source) {
      return null;
    }
    if (
      source.startsWith('blob:')
      || source.startsWith('data:')
      || source.startsWith('asset:')
      || source.startsWith('http://')
      || source.startsWith('https://')
    ) {
      return source;
    }
    return isTauri() ? convertFileSrc(source) : source;
  }, [data.videoUrl]);
  const posterSource = useMemo(() => {
    const source = data.previewImageUrl?.trim() ?? '';
    return source ? resolveImageDisplayUrl(source) : null;
  }, [data.previewImageUrl]);
  const lastGeneratedTime = useMemo(
    () => formatTimestamp(data.lastGeneratedAt ?? null, i18n.language),
    [data.lastGeneratedAt, i18n.language]
  );
  const durationLabel = useMemo(() => {
    if (typeof data.duration !== 'number' || !Number.isFinite(data.duration) || data.duration <= 0) {
      return null;
    }
    return formatVideoTime(data.duration);
  }, [data.duration]);
  const resolutionLabel = useMemo(() => {
    if (!data.width || !data.height) {
      return null;
    }
    return `${data.width} × ${data.height}`;
  }, [data.height, data.width]);

  useEffect(() => {
    updateNodeInternals(id);
  }, [id, resolvedHeight, resolvedWidth, updateNodeInternals, videoSource]);

  const combinedError = playbackError ?? data.lastError ?? null;
  const headerStatus = useMemo(() => {
    if (data.isGenerating) {
      return (
        <NodeStatusBadge
          icon={<Loader2 className="h-3 w-3" />}
          label={t('node.jimengVideoResult.generating')}
          tone="processing"
          animate
        />
      );
    }

    if (combinedError) {
      return (
        <NodeStatusBadge
          icon={<TriangleAlert className="h-3 w-3" />}
          label={t('nodeStatus.error')}
          tone="danger"
          title={combinedError}
        />
      );
    }

    if (videoSource) {
      return (
        <NodeStatusBadge
          icon={<Sparkles className="h-3 w-3" />}
          label={t('node.jimengVideoResult.ready')}
          tone="warning"
        />
      );
    }

    return null;
  }, [combinedError, data.isGenerating, t, videoSource]);

  const statusInfoText = combinedError
    ?? (data.isGenerating
      ? t('node.jimengVideoResult.statusGenerating')
      : lastGeneratedTime
        ? t('node.jimengVideoResult.generatedAt', { time: lastGeneratedTime })
        : t('node.jimengVideoResult.empty'));

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
        icon={<Video className="h-3.5 w-3.5" />}
        titleText={resolvedTitle}
        rightSlot={headerStatus ?? undefined}
        editable
        onTitleChange={(nextTitle) => updateNodeData(id, { displayName: nextTitle })}
      />

      <div className="flex min-h-0 flex-1 flex-col pt-8">
        <div className="relative overflow-hidden rounded-xl border border-white/10 bg-black/30">
          <div className="overflow-hidden bg-black" style={{ aspectRatio: resolvedAspectRatio }}>
            {videoSource ? (
              <video
                src={videoSource}
                controls
                preload="metadata"
                playsInline
                poster={posterSource ?? undefined}
                className="h-full w-full bg-black object-contain"
                onLoadedData={() => setPlaybackError(null)}
                onError={() => setPlaybackError(t('node.videoNode.loadFailed'))}
                onMouseDown={(event) => event.stopPropagation()}
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-[radial-gradient(circle_at_top,#1f2937_0%,#0f172a_72%)] text-sm text-text-muted">
                {data.isGenerating
                  ? t('node.jimengVideoResult.pending')
                  : t('node.jimengVideoResult.empty')}
              </div>
            )}
          </div>
        </div>

        <div className="mt-2 flex flex-wrap gap-1.5 text-[10px] leading-4 text-text-muted">
          {durationLabel ? (
            <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5">
              {t('node.jimengVideoResult.duration', { duration: durationLabel })}
            </span>
          ) : null}
          {resolutionLabel ? (
            <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5">
              {resolutionLabel}
            </span>
          ) : null}
          <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5">
            {data.aspectRatio ?? '16:9'}
          </span>
        </div>
      </div>

      <div
        className={`mt-2 min-h-[18px] text-[10px] leading-4 ${
          combinedError ? 'text-rose-300' : 'text-text-muted'
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
        minWidth={JIMENG_VIDEO_RESULT_NODE_MIN_WIDTH}
        minHeight={JIMENG_VIDEO_RESULT_NODE_MIN_HEIGHT}
      />
    </div>
  );
});

JimengVideoResultNode.displayName = 'JimengVideoResultNode';
