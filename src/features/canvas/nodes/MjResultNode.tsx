import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Handle,
  Position,
  useUpdateNodeInternals,
  type NodeProps,
} from '@xyflow/react';
import {
  ChevronDown,
  ChevronUp,
  Loader2,
  Sparkles,
  SquareArrowOutUpRight,
  TriangleAlert,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { UiButton } from '@/components/ui';
import {
  prepareNodeImage,
  resolveImageDisplayUrl,
} from '@/features/canvas/application/imageData';
import {
  resolveErrorContent,
  showErrorDialog,
} from '@/features/canvas/application/errorDialog';
import { flushCurrentProjectToDiskSafely } from '@/features/canvas/application/projectPersistence';
import {
  CANVAS_NODE_TYPES,
  MJ_RESULT_NODE_DEFAULT_WIDTH,
  MJ_RESULT_NODE_MIN_HEIGHT,
  MJ_RESULT_NODE_MIN_WIDTH,
  isMjResultNode,
  type MjBatchImageItem,
  type MjResultBatch,
  type MjResultNodeData,
} from '@/features/canvas/domain/canvasNodes';
import {
  getMjResultNodeActiveBatch,
  isMjNode,
} from '@/features/canvas/domain/canvasNodes';
import { resolveNodeDisplayName } from '@/features/canvas/domain/nodeDisplay';
import { useCanvasNodeById } from '@/features/canvas/hooks/useCanvasNodeGraph';
import { CanvasNodeImage } from '@/features/canvas/ui/CanvasNodeImage';
import {
  NodeHeader,
  NODE_HEADER_FLOATING_POSITION_CLASS,
} from '@/features/canvas/ui/NodeHeader';
import { NodeResizeHandle } from '@/features/canvas/ui/NodeResizeHandle';
import { NodeStatusBadge } from '@/features/canvas/ui/NodeStatusBadge';
import {
  NodeDescriptionPanel,
  NODE_DESCRIPTION_PANEL_EXPANDED_TOTAL_HEIGHT,
} from '@/features/canvas/ui/NodeDescriptionPanel';
import { resolveNodeStyleDimension } from '@/features/canvas/ui/nodeDimensionUtils';
import {
  queryMidjourneyTask,
  splitMidjourneyGridToBatchImages,
} from '@/features/midjourney/application/midjourneyGeneration';
import { updateMjResultBatch } from '@/features/midjourney/application/midjourneyNodes';
import {
  isMidjourneyTaskTerminal,
  normalizeMidjourneyTaskPhase,
  updateMjBatchFromTask,
} from '@/features/midjourney/domain/task';
import {
  normalizeMidjourneyProviderId,
  resolveMidjourneyProviderLabel,
} from '@/features/midjourney/domain/providers';
import { openSettingsDialog } from '@/features/settings/settingsEvents';
import { useCanvasStore } from '@/stores/canvasStore';
import { useSettingsStore } from '@/stores/settingsStore';

type MjResultNodeProps = NodeProps & {
  id: string;
  data: MjResultNodeData;
  selected?: boolean;
};

const BATCH_GRID_SLOT_COUNT = 4;
const MIDJOURNEY_POLL_INTERVAL_MS = 5_000;
const MIDJOURNEY_POLL_ERROR_BACKOFF_MS = 10_000;

function toCssAspectRatio(aspectRatio: string | null | undefined): string {
  const [rawWidth = '1', rawHeight = '1'] = (aspectRatio ?? '1:1').split(':');
  const width = Number(rawWidth);
  const height = Number(rawHeight);

  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return '1 / 1';
  }

  return `${width} / ${height}`;
}

function formatTimestamp(
  timestamp: number | null | undefined,
  locale: string
): string | null {
  if (
    typeof timestamp !== 'number' ||
    !Number.isFinite(timestamp) ||
    timestamp <= 0
  ) {
    return null;
  }

  return new Intl.DateTimeFormat(locale, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(timestamp));
}

function buildBatchSlots(batch: MjResultBatch): Array<MjBatchImageItem | null> {
  const orderedImages = [...batch.images].sort((left, right) => left.index - right.index);
  return Array.from(
    { length: BATCH_GRID_SLOT_COUNT },
    (_value, index) => orderedImages[index] ?? null
  );
}

function buildBatchViewerImageList(batch: MjResultBatch): string[] {
  return [...batch.images]
    .sort((left, right) => left.index - right.index)
    .map((item) => item.imageUrl ?? item.previewImageUrl ?? item.sourceUrl ?? '')
    .filter((value): value is string => value.trim().length > 0)
    .map((value) => resolveImageDisplayUrl(value));
}

function resolveBatchAspectRatio(batch: MjResultBatch): string {
  const primaryImage = [...batch.images]
    .sort((left, right) => left.index - right.index)
    .find((item) => Boolean(item.aspectRatio?.trim()));

  return primaryImage?.aspectRatio ?? '1:1';
}

function resolveBatchPhaseLabel(
  batch: MjResultBatch,
  t: (key: string, options?: Record<string, unknown>) => string
): string {
  switch (normalizeMidjourneyTaskPhase(batch.status)) {
    case 'queued':
      return t('node.midjourney.result.batchQueued');
    case 'running':
      return t('node.midjourney.result.batchRunning');
    case 'succeeded':
      return t('node.midjourney.result.batchSucceeded');
    case 'failed':
      return t('node.midjourney.result.batchFailed');
    case 'cancelled':
      return t('node.midjourney.result.batchCancelled');
    default:
      return batch.status?.trim() || t('node.midjourney.result.batchUnknown');
  }
}

function resolveBatchStatusTone(
  batch: MjResultBatch
): 'processing' | 'warning' | 'danger' {
  const phase = normalizeMidjourneyTaskPhase(batch.status);
  if (phase === 'queued' || phase === 'running') {
    return 'processing';
  }
  if (phase === 'failed' || phase === 'cancelled') {
    return 'danger';
  }
  return 'warning';
}

export const MjResultNode = memo(
  ({ id, data, selected, width }: MjResultNodeProps) => {
    const { t, i18n } = useTranslation();
    const updateNodeInternals = useUpdateNodeInternals();
    const currentNode = useCanvasNodeById(id);
    const mjApiKeys = useSettingsStore((state) => state.mjApiKeys);
    const setSelectedNode = useCanvasStore((state) => state.setSelectedNode);
    const updateNodeData = useCanvasStore((state) => state.updateNodeData);
    const addDerivedUploadNode = useCanvasStore((state) => state.addDerivedUploadNode);
    const addEdge = useCanvasStore((state) => state.addEdge);
    const isDescriptionPanelOpen = useCanvasStore(
      (state) => Boolean(state.nodeDescriptionPanelOpenById[id])
    );
    const isReferenceSourceHighlighted = useCanvasStore(
      (state) => state.highlightedReferenceSourceNodeId === id
    );
    const pollTimersRef = useRef(new Map<string, number>());
    const activePollBatchIdsRef = useRef(new Set<string>());
    const unmountedRef = useRef(false);
    const [expandedBatchIds, setExpandedBatchIds] = useState<Record<string, boolean>>(
      {}
    );

    const resolvedTitle = useMemo(
      () => resolveNodeDisplayName(CANVAS_NODE_TYPES.mjResult, data),
      [data]
    );
    const resolvedWidth = Math.max(
      MJ_RESULT_NODE_MIN_WIDTH,
      Math.round(width ?? MJ_RESULT_NODE_DEFAULT_WIDTH)
    );
    const explicitHeight = resolveNodeStyleDimension(currentNode?.style?.height);
    const hasExplicitHeight = typeof explicitHeight === 'number';
    const descriptionPanelHeight = isDescriptionPanelOpen
      ? NODE_DESCRIPTION_PANEL_EXPANDED_TOTAL_HEIGHT
      : 0;
    const collapsedHeight = Math.max(
      explicitHeight ?? MJ_RESULT_NODE_MIN_HEIGHT,
      MJ_RESULT_NODE_MIN_HEIGHT
    );
    const resolvedMinHeight = MJ_RESULT_NODE_MIN_HEIGHT + descriptionPanelHeight;
    const resolvedHeight = hasExplicitHeight
      ? collapsedHeight + descriptionPanelHeight
      : null;
    const activeBatch = useMemo(() => getMjResultNodeActiveBatch(data), [data]);
    const pendingBatchCount = useMemo(
      () => data.batches.filter((batch) => batch.isPolling).length,
      [data.batches]
    );
    const batchSections = useMemo(() => data.batches, [data.batches]);
    const pendingBatchMissingProviderKey = useMemo(
      () =>
        data.batches.find((batch) => {
          if (!batch.isPolling) {
            return false;
          }

          const providerId = normalizeMidjourneyProviderId(batch.providerId);
          return (mjApiKeys[providerId] ?? '').trim().length === 0;
        }) ?? null,
      [data.batches, mjApiKeys]
    );

    useEffect(() => {
      updateNodeInternals(id);
    }, [
      batchSections.length,
      hasExplicitHeight,
      id,
      isDescriptionPanelOpen,
      resolvedHeight,
      resolvedWidth,
      updateNodeInternals,
    ]);

    const clearScheduledPoll = useCallback((batchId?: string) => {
      if (batchId) {
        const timer = pollTimersRef.current.get(batchId);
        if (timer !== undefined) {
          window.clearTimeout(timer);
          pollTimersRef.current.delete(batchId);
        }
        return;
      }

      for (const timer of pollTimersRef.current.values()) {
        window.clearTimeout(timer);
      }
      pollTimersRef.current.clear();
    }, []);

    const syncSourceNodeSubmissionState = useCallback(
      (pendingTaskId: string | null) => {
        const sourceNodeId = data.sourceNodeId?.trim() ?? '';
        if (!sourceNodeId) {
          return;
        }

        const sourceNode = useCanvasStore
          .getState()
          .nodes.find((node) => node.id === sourceNodeId);
        if (!isMjNode(sourceNode)) {
          return;
        }

        const nextIsSubmitting = Boolean(pendingTaskId);
        const currentTaskId = sourceNode.data.activeTaskId ?? null;
        const currentIsSubmitting = Boolean(sourceNode.data.isSubmitting);
        if (
          currentIsSubmitting === nextIsSubmitting &&
          currentTaskId === pendingTaskId
        ) {
          return;
        }

        updateNodeData(
          sourceNodeId,
          {
            isSubmitting: nextIsSubmitting,
            activeTaskId: pendingTaskId,
          },
          { historyMode: 'skip' }
        );
      },
      [data.sourceNodeId, updateNodeData]
    );

    const handlePollBatch = useCallback(
      async (
        batchId: string,
        options?: {
          scheduleNext?: boolean;
          showErrorDialog?: boolean;
        }
      ) => {
        const latestNode = useCanvasStore
          .getState()
          .nodes.find((node) => node.id === id);
        if (!isMjResultNode(latestNode)) {
          clearScheduledPoll(batchId);
          return;
        }

        const latestBatch = latestNode.data.batches.find((batch) => batch.id === batchId);
        if (!latestBatch) {
          clearScheduledPoll(batchId);
          return;
        }

        if (!latestBatch.isPolling && !options?.showErrorDialog) {
          clearScheduledPoll(batchId);
          return;
        }

        const providerId = normalizeMidjourneyProviderId(latestBatch.providerId);
        const providerLabel = resolveMidjourneyProviderLabel(providerId, i18n.language);
        const apiKey = mjApiKeys[providerId]?.trim() ?? '';
        if (!apiKey) {
          const message = t('node.midjourney.result.providerKeyRequired', {
            provider: providerLabel,
          });
          updateNodeData(
            id,
            {
              lastError: message,
            },
            { historyMode: 'skip' }
          );
          clearScheduledPoll(batchId);
          if (options?.showErrorDialog) {
            openSettingsDialog({ category: 'providers', providerTab: 'mj' });
            await showErrorDialog(message, t('common.error'));
          }
          return;
        }

        const taskId = latestBatch.taskId?.trim() ?? '';
        if (!taskId) {
          const message = t('node.midjourney.result.taskIdMissing');
          const failedData = updateMjResultBatch(latestNode.data, batchId, (batch) => ({
            ...batch,
            status: 'FAILURE',
            failReason: message,
            isPolling: false,
          }));
          updateNodeData(
            id,
            {
              ...failedData,
              activeBatchId: batchId,
              lastError: message,
            },
            { historyMode: 'skip' }
          );
          syncSourceNodeSubmissionState(null);
          clearScheduledPoll(batchId);
          return;
        }

        if (activePollBatchIdsRef.current.has(batchId)) {
          return;
        }

        clearScheduledPoll(batchId);
        activePollBatchIdsRef.current.add(batchId);

        try {
          const task = await queryMidjourneyTask(providerId, apiKey, taskId);
          const taskImageUrl = task.imageUrl?.trim() ?? '';
          const images =
            taskImageUrl.length > 0
              ? await splitMidjourneyGridToBatchImages(taskImageUrl)
              : latestBatch.images;
          const terminal = isMidjourneyTaskTerminal(task.status);
          const nextNodeData = updateMjResultBatch(
            latestNode.data,
            batchId,
            (batch) => updateMjBatchFromTask(batch, task, images)
          );
          const nextError =
            terminal && normalizeMidjourneyTaskPhase(task.status) !== 'succeeded'
              ? task.failReason?.trim() || t('node.midjourney.result.pollFailed')
              : null;

          updateNodeData(
            id,
            {
              ...nextNodeData,
              activeBatchId: batchId,
              lastError: nextError,
              lastGeneratedAt: terminal
                ? task.finishTime ?? Date.now()
                : latestNode.data.lastGeneratedAt ?? null,
            },
            { historyMode: 'skip' }
          );

          syncSourceNodeSubmissionState(terminal ? null : task.id);

          if (terminal) {
            clearScheduledPoll(batchId);
            await flushCurrentProjectToDiskSafely('saving Midjourney batch result');
            return;
          }

          if (options?.scheduleNext && !unmountedRef.current) {
            const timer = window.setTimeout(() => {
              void handlePollBatch(batchId, { scheduleNext: true });
            }, MIDJOURNEY_POLL_INTERVAL_MS);
            pollTimersRef.current.set(batchId, timer);
          }
        } catch (error) {
          const content = resolveErrorContent(
            error,
            t('node.midjourney.result.pollFailed')
          );
          updateNodeData(
            id,
            {
              lastError: content.message,
            },
            { historyMode: 'skip' }
          );

          if (options?.scheduleNext && !unmountedRef.current) {
            const timer = window.setTimeout(() => {
              void handlePollBatch(batchId, { scheduleNext: true });
            }, MIDJOURNEY_POLL_ERROR_BACKOFF_MS);
            pollTimersRef.current.set(batchId, timer);
          }

          if (options?.showErrorDialog) {
            await showErrorDialog(content.message, t('common.error'), content.details);
          }
        } finally {
          activePollBatchIdsRef.current.delete(batchId);
        }
      },
      [clearScheduledPoll, i18n.language, id, mjApiKeys, syncSourceNodeSubmissionState, t, updateNodeData]
    );

    const handleRefreshActiveBatch = useCallback(async () => {
      if (!activeBatch) {
        return;
      }

      await handlePollBatch(activeBatch.id, {
        scheduleNext: activeBatch.isPolling,
        showErrorDialog: true,
      });
    }, [activeBatch, handlePollBatch]);

    const handleExtractImage = useCallback(
      async (batch: MjResultBatch, item: MjBatchImageItem, index: number) => {
        try {
          const sourceImage =
            item.imageUrl ?? item.previewImageUrl ?? item.sourceUrl ?? null;
          if (!sourceImage) {
            return;
          }

          const prepared = await prepareNodeImage(sourceImage);
          const createdNodeId = addDerivedUploadNode(
            id,
            prepared.imageUrl,
            prepared.aspectRatio || item.aspectRatio || resolveBatchAspectRatio(batch),
            prepared.previewImageUrl
          );

          if (createdNodeId) {
            addEdge(id, createdNodeId);
          }
        } catch (error) {
          const content = resolveErrorContent(
            error,
            t('node.midjourney.result.extractFailed', { index: index + 1 })
          );
          await showErrorDialog(content.message, t('common.error'), content.details);
        }
      },
      [addDerivedUploadNode, addEdge, id, t]
    );

    const toggleBatchPrompt = useCallback((batchId: string) => {
      setExpandedBatchIds((current) => ({
        ...current,
        [batchId]: !current[batchId],
      }));
    }, []);

    useEffect(() => {
      const pendingBatches = data.batches.filter((batch) => batch.isPolling);
      const pendingBatchIdSet = new Set(pendingBatches.map((batch) => batch.id));

      for (const existingBatchId of Array.from(pollTimersRef.current.keys())) {
        if (!pendingBatchIdSet.has(existingBatchId)) {
          clearScheduledPoll(existingBatchId);
        }
      }

      syncSourceNodeSubmissionState(pendingBatches[0]?.taskId ?? null);

      pendingBatches.forEach((batch) => {
        const providerId = normalizeMidjourneyProviderId(batch.providerId);
        if (!(mjApiKeys[providerId] ?? '').trim()) {
          return;
        }

        if (
          activePollBatchIdsRef.current.has(batch.id) ||
          pollTimersRef.current.has(batch.id)
        ) {
          return;
        }

        void handlePollBatch(batch.id, { scheduleNext: true });
      });
    }, [
      clearScheduledPoll,
      data.batches,
      handlePollBatch,
      mjApiKeys,
      syncSourceNodeSubmissionState,
    ]);

    useEffect(() => {
      return () => {
        unmountedRef.current = true;
        clearScheduledPoll();
      };
    }, [clearScheduledPoll]);

    const headerStatus = useMemo(() => {
      if (pendingBatchMissingProviderKey) {
        return (
          <NodeStatusBadge
            icon={<TriangleAlert className="h-3 w-3" />}
            label={t('nodeStatus.error')}
            tone="danger"
            title={t('node.midjourney.result.providerKeyRequired', {
              provider: resolveMidjourneyProviderLabel(
                pendingBatchMissingProviderKey.providerId,
                i18n.language
              ),
            })}
          />
        );
      }

      if (pendingBatchCount > 0) {
        return (
          <NodeStatusBadge
            icon={<Loader2 className="h-3 w-3 animate-spin" />}
            label={t('node.midjourney.result.pendingCount', {
              count: pendingBatchCount,
            })}
            tone="processing"
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

      if (batchSections.length > 0) {
        return (
          <NodeStatusBadge
            icon={<Sparkles className="h-3 w-3" />}
            label={t('node.midjourney.result.batchCount', {
              count: batchSections.length,
            })}
            tone="warning"
          />
        );
      }

      return null;
    }, [batchSections.length, data.lastError, i18n.language, pendingBatchCount, pendingBatchMissingProviderKey, t]);

    const statusText = useMemo(() => {
      if (pendingBatchMissingProviderKey) {
        return t('node.midjourney.result.providerKeyRequired', {
          provider: resolveMidjourneyProviderLabel(
            pendingBatchMissingProviderKey.providerId,
            i18n.language
          ),
        });
      }

      if (data.lastError) {
        return data.lastError;
      }

      if (pendingBatchCount > 0) {
        return t('node.midjourney.result.statusPolling');
      }

      if (batchSections.length === 0) {
        return t('node.midjourney.result.empty');
      }

      if (activeBatch) {
        const label = resolveBatchPhaseLabel(activeBatch, t);
        const progress = activeBatch.progress?.trim() ?? '';
        return progress ? `${label} / ${progress}` : label;
      }

      return t('node.midjourney.result.empty');
    }, [activeBatch, batchSections.length, data.lastError, i18n.language, pendingBatchCount, pendingBatchMissingProviderKey, t]);

    const nodeDescription =
      typeof data.nodeDescription === 'string' ? data.nodeDescription : '';

    return (
      <div
        className={`
          group relative flex flex-col overflow-visible rounded-[var(--node-radius)] border bg-surface-dark/90 p-2 transition-colors duration-150
          ${hasExplicitHeight ? 'h-full' : ''}
          ${
            selected
              ? 'border-accent shadow-[0_0_0_1px_rgba(59,130,246,0.32)]'
              : isReferenceSourceHighlighted
                ? 'border-accent/80 shadow-[0_0_0_2px_rgba(59,130,246,0.24),0_4px_18px_rgba(59,130,246,0.1)]'
                : 'border-[rgba(15,23,42,0.22)] hover:border-[rgba(15,23,42,0.34)] dark:border-[rgba(255,255,255,0.22)] dark:hover:border-[rgba(255,255,255,0.34)]'
          }
        `}
        style={{
          width: `${resolvedWidth}px`,
          ...(resolvedHeight ? { height: `${resolvedHeight}px` } : {}),
        }}
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

        <div
          className="ui-scrollbar nowheel min-h-0 flex-1 overflow-auto pt-5"
          onWheelCapture={(event) => event.stopPropagation()}
        >
          {batchSections.length > 0 ? (
            <div className="space-y-0">
              {batchSections.map((batch, batchIndex) => {
                const isActive =
                  data.activeBatchId === batch.id || (!data.activeBatchId && batchIndex === 0);
                const batchSlots = buildBatchSlots(batch);
                const batchViewerImageList = buildBatchViewerImageList(batch);
                const batchAspectRatioCss = toCssAspectRatio(resolveBatchAspectRatio(batch));
                const submittedAt = formatTimestamp(batch.submitTime, i18n.language);
                const startedAt = formatTimestamp(batch.startTime, i18n.language);
                const finishedAt = formatTimestamp(batch.finishTime, i18n.language);
                const promptExpanded = Boolean(expandedBatchIds[batch.id]);
                const phaseLabel = resolveBatchPhaseLabel(batch, t);
                const statusTone = resolveBatchStatusTone(batch);
                const providerLabel = resolveMidjourneyProviderLabel(
                  batch.providerId,
                  i18n.language
                );

                return (
                  <section
                    key={batch.id}
                    className={batchIndex > 0 ? 'mt-4 border-t border-white/10 pt-4' : ''}
                  >
                    <div
                      role="button"
                      tabIndex={0}
                      className={`w-full rounded-2xl border p-3 text-left transition-colors ${
                        isActive
                          ? 'border-accent/35 bg-accent/8'
                          : 'border-white/8 bg-white/[0.025] hover:border-white/14'
                      }`}
                      onClick={(event) => {
                        event.stopPropagation();
                        updateNodeData(
                          id,
                          {
                            activeBatchId: batch.id,
                          },
                          { historyMode: 'skip' }
                        );
                      }}
                      onKeyDown={(event) => {
                        if (event.key !== 'Enter' && event.key !== ' ') {
                          return;
                        }

                        event.preventDefault();
                        event.stopPropagation();
                        updateNodeData(
                          id,
                          {
                            activeBatchId: batch.id,
                          },
                          { historyMode: 'skip' }
                        );
                      }}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <div className="text-sm font-medium text-text-dark">
                              {t('node.midjourney.result.batchTitle', {
                                index: batchSections.length - batchIndex,
                              })}
                            </div>
                            <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[11px] text-text-muted">
                              {providerLabel}
                            </span>
                            <NodeStatusBadge label={phaseLabel} tone={statusTone} />
                            {batch.progress?.trim() ? (
                              <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[11px] text-text-muted">
                                {batch.progress}
                              </span>
                            ) : null}
                          </div>
                          <div className="mt-1 flex flex-wrap gap-3 text-[11px] text-text-muted">
                            {submittedAt ? (
                              <span>
                                {t('node.midjourney.result.submittedAt', {
                                  time: submittedAt,
                                })}
                              </span>
                            ) : null}
                            {startedAt ? (
                              <span>
                                {t('node.midjourney.result.startedAt', {
                                  time: startedAt,
                                })}
                              </span>
                            ) : null}
                            {finishedAt ? (
                              <span>
                                {t('node.midjourney.result.finishedAt', {
                                  time: finishedAt,
                                })}
                              </span>
                            ) : null}
                          </div>
                        </div>

                        <button
                          type="button"
                          className="inline-flex shrink-0 items-center gap-1 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] text-text-muted transition-colors hover:border-white/20 hover:text-text-dark"
                          onClick={(event) => {
                            event.stopPropagation();
                            toggleBatchPrompt(batch.id);
                          }}
                        >
                          {t('node.midjourney.result.promptDetails')}
                          {promptExpanded ? (
                            <ChevronUp className="h-3 w-3" />
                          ) : (
                            <ChevronDown className="h-3 w-3" />
                          )}
                        </button>
                      </div>

                      {batch.failReason ? (
                        <div className="mt-2 rounded-xl border border-rose-400/18 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
                          {batch.failReason}
                        </div>
                      ) : null}

                      {promptExpanded ? (
                        <div
                          className="mt-3 space-y-2"
                          onClick={(event) => event.stopPropagation()}
                          onPointerDown={(event) => event.stopPropagation()}
                        >
                          <div className="rounded-xl border border-white/8 bg-black/10 p-2">
                            <div className="mb-1 text-[11px] uppercase tracking-[0.12em] text-text-muted">
                              {t('node.midjourney.result.promptOriginal')}
                            </div>
                            <div className="text-xs leading-5 text-text-dark">
                              {batch.prompt || t('node.midjourney.result.emptyPrompt')}
                            </div>
                          </div>
                          {batch.promptEn ? (
                            <div className="rounded-xl border border-white/8 bg-black/10 p-2">
                              <div className="mb-1 text-[11px] uppercase tracking-[0.12em] text-text-muted">
                                {t('node.midjourney.result.promptTranslated')}
                              </div>
                              <div className="text-xs leading-5 text-text-dark">
                                {batch.promptEn}
                              </div>
                            </div>
                          ) : null}
                          {batch.finalPrompt ? (
                            <div className="rounded-xl border border-white/8 bg-black/10 p-2">
                              <div className="mb-1 text-[11px] uppercase tracking-[0.12em] text-text-muted">
                                {t('node.midjourney.result.promptFinal')}
                              </div>
                              <div className="text-xs leading-5 text-text-dark">
                                {batch.finalPrompt}
                              </div>
                            </div>
                          ) : null}
                        </div>
                      ) : null}

                      <div className="mt-3 grid grid-cols-2 gap-2">
                        {batchSlots.map((item, index) => {
                          const source =
                            item?.imageUrl ?? item?.previewImageUrl ?? item?.sourceUrl ?? null;
                          const viewerSource = source ? resolveImageDisplayUrl(source) : null;

                          return (
                            <div
                              key={item?.id ?? `${batch.id}-slot-${index + 1}`}
                              className="group/mj-slot relative overflow-hidden rounded-xl border border-white/10 bg-black/10"
                            >
                              <div
                                className="overflow-hidden bg-surface-dark"
                                style={{ aspectRatio: batchAspectRatioCss }}
                              >
                                {source && viewerSource ? (
                                  <CanvasNodeImage
                                    src={viewerSource}
                                    alt={t('node.midjourney.result.slotLabel', {
                                      index: index + 1,
                                    })}
                                    viewerSourceUrl={viewerSource}
                                    viewerImageList={batchViewerImageList}
                                    className="h-full w-full object-cover"
                                    draggable={false}
                                  />
                                ) : (
                                  <div className="flex h-full w-full items-center justify-center bg-[radial-gradient(circle_at_top,#1f2937_0%,#0f172a_72%)] px-3 text-center text-xs text-text-muted">
                                    {batch.isPolling
                                      ? t('node.midjourney.result.pendingSlot')
                                      : t('node.midjourney.result.slotLabel', {
                                          index: index + 1,
                                        })}
                                  </div>
                                )}
                              </div>

                              <div className="pointer-events-none absolute left-2 top-2 rounded-full bg-black/55 px-2 py-1 text-[11px] font-medium text-white">
                                {index + 1}
                              </div>

                              {item && source ? (
                                <button
                                  type="button"
                                  className="absolute right-2 top-2 rounded bg-black/60 p-1 text-white opacity-0 transition-all duration-150 hover:bg-black/75 group-hover/mj-slot:opacity-100"
                                  onPointerDown={(event) => event.stopPropagation()}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    void handleExtractImage(batch, item, index);
                                  }}
                                  title={t('node.midjourney.result.extractImage')}
                                >
                                  <SquareArrowOutUpRight className="h-3 w-3" />
                                </button>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </section>
                );
              })}
            </div>
          ) : (
            <div className="flex h-full min-h-[220px] items-center justify-center rounded-[var(--node-radius)] border border-dashed border-white/10 bg-white/[0.02] px-6 text-center text-sm text-text-muted">
              {t('node.midjourney.result.empty')}
            </div>
          )}
        </div>

        <div
          className="mt-2 flex min-h-[28px] items-center justify-between gap-2"
          onClick={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <div
            className={`min-w-0 flex-1 truncate text-[11px] ${
              data.lastError ? 'text-rose-300' : 'text-text-muted'
            }`}
            title={statusText}
          >
            {statusText}
          </div>

          {activeBatch ? (
            <UiButton
              type="button"
              size="sm"
              variant="muted"
              onClick={() => void handleRefreshActiveBatch()}
            >
              {t('node.midjourney.result.refresh')}
            </UiButton>
          ) : null}
        </div>

        <NodeDescriptionPanel
          isOpen={isDescriptionPanelOpen}
          value={nodeDescription}
          placeholder={t('nodeToolbar.descriptionPlaceholder')}
          onChange={(value) => updateNodeData(id, { nodeDescription: value })}
        />

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
          minWidth={MJ_RESULT_NODE_MIN_WIDTH}
          minHeight={resolvedMinHeight}
        />
      </div>
    );
  }
);

MjResultNode.displayName = 'MjResultNode';
