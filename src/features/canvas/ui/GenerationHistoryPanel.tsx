import { useMemo, useState } from 'react';
import { Clock3, Image as ImageIcon, ListVideo, Music4, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useReactFlow } from '@xyflow/react';

import { UiButton, UiLoadingAnimation, UiPanel } from '@/components/ui';
import {
  GENERATION_HISTORY_DRAG_MIME_TYPE,
  collectGenerationHistoryItemNodeIds,
  parseGenerationHistorySnapshotNode,
  serializeGenerationHistoryDragPayload,
  type GenerationHistoryItemRecord,
} from '@/features/canvas/application/generationHistory';
import { flushCurrentProjectToDiskSafely } from '@/features/canvas/application/projectPersistence';
import { resolveVideoDisplayUrl } from '@/features/canvas/application/videoData';
import { useStableImageDisplaySource } from '@/features/canvas/hooks/useStableImageDisplaySource';
import { CanvasNodeImage } from '@/features/canvas/ui/CanvasNodeImage';
import { useCanvasStore } from '@/stores/canvasStore';
import { useGenerationHistoryStore } from '@/stores/generationHistoryStore';

interface GenerationHistoryPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

function formatTimestamp(timestamp: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(timestamp));
}

function resolveMediaIcon(mediaType: GenerationHistoryItemRecord['mediaType']) {
  switch (mediaType) {
    case 'video':
      return <ListVideo className="h-4 w-4" />;
    case 'audio':
      return <Music4 className="h-4 w-4" />;
    default:
      return <ImageIcon className="h-4 w-4" />;
  }
}

function GenerationHistoryVideoPreview({
  sourcePath,
  previewPath,
  title,
}: {
  sourcePath: string;
  previewPath: string | null;
  title: string;
}) {
  const { displaySource: posterDisplaySource } = useStableImageDisplaySource(
    previewPath ?? sourcePath
  );

  return (
    <video
      className="h-full w-full object-cover"
      muted
      preload="metadata"
      poster={posterDisplaySource ?? undefined}
      src={resolveVideoDisplayUrl(sourcePath)}
      title={title}
    />
  );
}

export function GenerationHistoryPanel({
  isOpen,
  onClose,
}: GenerationHistoryPanelProps) {
  const { t, i18n } = useTranslation();
  const reactFlow = useReactFlow();
  const items = useGenerationHistoryStore((state) => state.items);
  const isHydrating = useGenerationHistoryStore((state) => state.isHydrating);
  const removeItem = useGenerationHistoryStore((state) => state.removeItem);
  const nodes = useCanvasStore((state) => state.nodes);
  const edges = useCanvasStore((state) => state.edges);
  const deleteNodes = useCanvasStore((state) => state.deleteNodes);
  const restoreGenerationSnapshotNode = useCanvasStore((state) => state.restoreGenerationSnapshotNode);
  const setSelectedNode = useCanvasStore((state) => state.setSelectedNode);
  const [deletingItemId, setDeletingItemId] = useState<string | null>(null);

  const groupedItems = useMemo(() => items, [items]);

  const handleRestore = (item: GenerationHistoryItemRecord) => {
    const snapshotNode = parseGenerationHistorySnapshotNode(item);
    if (!snapshotNode) {
      return;
    }

    const { width: viewportWidth, height: viewportHeight } = useCanvasStore.getState().canvasViewportSize;
    const viewport = reactFlow.getViewport();
    const canvasCenter = {
      x: (-viewport.x + (viewportWidth > 0 ? viewportWidth : 960) / 2) / viewport.zoom,
      y: (-viewport.y + (viewportHeight > 0 ? viewportHeight : 640) / 2) / viewport.zoom,
    };
    const restoredNodeId = restoreGenerationSnapshotNode(snapshotNode, canvasCenter);
    if (restoredNodeId) {
      setSelectedNode(restoredNodeId);
    }
  };

  const handleDelete = async (item: GenerationHistoryItemRecord) => {
    setDeletingItemId(item.id);
    try {
      const relatedNodeIds = collectGenerationHistoryItemNodeIds(item, nodes, edges);
      if (relatedNodeIds.length > 0) {
        deleteNodes(relatedNodeIds);
        await flushCurrentProjectToDiskSafely('removing nodes before deleting generation history item');
      }
      await removeItem(item.id);
    } finally {
      setDeletingItemId(null);
    }
  };

  if (!isOpen) {
    return null;
  }

  return (
    <UiPanel className="absolute bottom-[72px] right-[68px] z-[10001] flex max-h-[72vh] w-[calc(100vw-40px)] max-w-[420px] flex-col overflow-hidden rounded-2xl border-white/10 bg-surface-dark/96 shadow-[0_24px_64px_rgba(0,0,0,0.38)]">
      <div className="flex items-start justify-between gap-3 border-b border-white/10 px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-semibold text-text-dark">
            <Clock3 className="h-4 w-4" />
            {t('generationHistory.title')}
          </div>
          <div className="mt-1 text-xs text-text-muted">
            {t('generationHistory.summary', { count: groupedItems.length })}
          </div>
        </div>
        <UiButton type="button" variant="ghost" size="sm" onClick={onClose}>
          {t('common.close')}
        </UiButton>
      </div>

      {isHydrating ? (
        <div className="flex min-h-[220px] items-center justify-center gap-2 px-6 text-center text-sm text-text-muted">
          <UiLoadingAnimation size="sm" />
          {t('generationHistory.loading')}
        </div>
      ) : groupedItems.length === 0 ? (
        <div className="flex min-h-[220px] items-center justify-center px-6 text-center text-sm text-text-muted">
          {t('generationHistory.empty')}
        </div>
      ) : (
        <div className="flex-1 space-y-3 overflow-y-auto px-3 py-3">
          {groupedItems.map((item) => {
            const previewSource = item.previewPath ?? item.sourcePath;
            const createdAtLabel = formatTimestamp(item.createdAt, i18n.language);
            const isDeleting = deletingItemId === item.id;

            return (
              <div
                key={item.id}
                className="rounded-2xl border border-white/10 bg-white/[0.03] p-3"
                draggable
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = 'copy';
                  event.dataTransfer.setData(
                    GENERATION_HISTORY_DRAG_MIME_TYPE,
                    serializeGenerationHistoryDragPayload(item)
                  );
                  event.dataTransfer.setData('text/plain', item.title);
                }}
              >
                <div className="flex items-start gap-3">
                  <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-white/10 bg-black/20">
                    {item.mediaType === 'audio' ? (
                      <div className="flex flex-col items-center gap-1 text-text-muted">
                        <Music4 className="h-6 w-6" />
                        <span className="text-[10px] uppercase">{item.mediaType}</span>
                      </div>
                    ) : item.mediaType === 'video' ? (
                      <GenerationHistoryVideoPreview
                        sourcePath={item.sourcePath}
                        previewPath={previewSource}
                        title={item.title}
                      />
                    ) : (
                      <CanvasNodeImage
                        src={previewSource ?? ''}
                        fallbackSrc={item.sourcePath}
                        disableViewer
                        alt={item.title}
                        className="h-full w-full object-cover"
                      />
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-xs text-text-muted">
                      {resolveMediaIcon(item.mediaType)}
                      <span>{item.mediaType}</span>
                      <span>·</span>
                      <span>{createdAtLabel}</span>
                    </div>
                    <div className="mt-1 line-clamp-2 text-sm font-medium text-text-dark">
                      {item.title}
                    </div>
                    {item.aspectRatio ? (
                      <div className="mt-1 text-xs text-text-muted">
                        {t('generationHistory.aspectRatio', { value: item.aspectRatio })}
                      </div>
                    ) : null}

                    <div className="mt-3 flex items-center gap-2">
                      <UiButton
                        type="button"
                        variant="muted"
                        size="sm"
                        onClick={() => handleRestore(item)}
                      >
                        {t('generationHistory.restore')}
                      </UiButton>
                      <UiButton
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={isDeleting}
                        onClick={() => {
                          void handleDelete(item);
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        {t('common.delete')}
                      </UiButton>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </UiPanel>
  );
}
