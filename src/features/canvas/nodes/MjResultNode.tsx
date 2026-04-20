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
import { v4 as uuidv4 } from 'uuid';

import {
  UiButton,
  UiChipButton,
  UiInput,
  UiModal,
  UiTextArea,
} from '@/components/ui';
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
  getMjResultNodeActiveBatch,
  isMjResultNode,
  type MjActionButton,
  type MjActionFamily,
  type MjBatchImageItem,
  type MjModalKind,
  type MjResultBatch,
  type MjResultNodeData,
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
  appendMjResultBatch,
  ensureMidjourneyBranchResultNode,
  updateMjResultBatch,
} from '@/features/midjourney/application/midjourneyNodes';
import {
  prepareMidjourneyBatchImages,
  queryMidjourneyTask,
  splitMidjourneyGridToBatchImages,
  submitMidjourneyActionTask,
  submitMidjourneyModalTask,
} from '@/features/midjourney/application/midjourneyGeneration';
import {
  inferMidjourneyModalKind,
  isSupportedMidjourneyActionButton,
  normalizeMidjourneyButtons,
} from '@/features/midjourney/domain/action';
import {
  normalizeMidjourneyProviderId,
  resolveMidjourneyProviderLabel,
  type MidjourneyProviderId,
} from '@/features/midjourney/domain/providers';
import {
  createPendingMjBatch,
  isMidjourneyTaskTerminal,
  normalizeMidjourneyTaskPhase,
  type MidjourneyTaskSnapshot,
  updateMjBatchFromTask,
} from '@/features/midjourney/domain/task';
import { openSettingsDialog } from '@/features/settings/settingsEvents';
import { useCanvasStore } from '@/stores/canvasStore';
import { useSettingsStore } from '@/stores/settingsStore';

type MjResultNodeProps = NodeProps & {
  id: string;
  data: MjResultNodeData;
  selected?: boolean;
};

type SupportedModalKind = Exclude<MjModalKind, 'none' | 'unsupported'>;

interface MidjourneyModalState {
  kind: SupportedModalKind;
  batchId: string;
  modalTaskId: string;
  providerId: MidjourneyProviderId;
  button: MjActionButton;
  sourceImageIndex: number | null;
  promptDraft: string;
  zoomDraft: number;
  actionInstanceKey: string;
  isSubmitting: boolean;
}

const BATCH_GRID_SLOT_COUNT = 4;
const MIDJOURNEY_POLL_INTERVAL_MS = 5_000;
const MIDJOURNEY_POLL_ERROR_BACKOFF_MS = 10_000;
const CUSTOM_ZOOM_MIN = 1;
const CUSTOM_ZOOM_MAX = 2;
const CUSTOM_ZOOM_STEP = 0.1;
const DEFAULT_CUSTOM_ZOOM = 1.5;
const ACTION_FAMILY_ORDER: MjActionFamily[] = [
  'upscale',
  'variation',
  'zoom',
  'pan',
  'reroll',
];

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeCustomZoomValue(value: number): number {
  const clamped = clamp(value, CUSTOM_ZOOM_MIN, CUSTOM_ZOOM_MAX);
  return Math.round(clamped / CUSTOM_ZOOM_STEP) * CUSTOM_ZOOM_STEP;
}

function formatCustomZoomValue(value: number): string {
  return normalizeCustomZoomValue(value).toFixed(1);
}

function buildCustomZoomPrompt(prompt: string, zoomValue: number): string {
  const cleanedPrompt = prompt
    .replace(/\s--zoom\s+\S+/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  const zoomSuffix = `--zoom ${formatCustomZoomValue(zoomValue)}`;
  return [cleanedPrompt, zoomSuffix].filter(Boolean).join(' ').trim();
}

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

function listBatchImageCandidates(item: MjBatchImageItem | null | undefined): string[] {
  const candidates = [item?.imageUrl, item?.previewImageUrl, item?.sourceUrl];
  const deduped: string[] = [];
  for (const rawCandidate of candidates) {
    const normalized = rawCandidate?.trim() ?? '';
    if (!normalized || deduped.includes(normalized)) {
      continue;
    }
    deduped.push(normalized);
  }
  return deduped;
}

function buildBatchViewerImageList(batch: MjResultBatch): string[] {
  const urls: string[] = [];
  for (const item of [...batch.images]
    .sort((left, right) => left.index - right.index)
  ) {
    for (const candidate of listBatchImageCandidates(item)) {
      if (!urls.includes(candidate)) {
        urls.push(candidate);
      }
    }
  }

  return urls.map((value) => resolveImageDisplayUrl(value));
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

function resolveActionFamilyLabel(
  family: MjActionFamily,
  t: (key: string) => string
): string {
  switch (family) {
    case 'upscale':
      return t('node.midjourney.result.actionFamily.upscale');
    case 'variation':
      return t('node.midjourney.result.actionFamily.variation');
    case 'zoom':
      return t('node.midjourney.result.actionFamily.zoom');
    case 'pan':
      return t('node.midjourney.result.actionFamily.pan');
    case 'reroll':
      return t('node.midjourney.result.actionFamily.reroll');
    default:
      return t('node.midjourney.result.actionFamily.other');
  }
}

function humanizeMidjourneyActionCustomId(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return 'Action';
  }

  const lastToken = trimmed.split(/::|:/).filter(Boolean).pop() ?? trimmed;
  if (/^[uv][1-4]$/i.test(lastToken)) {
    return lastToken.toUpperCase();
  }

  return lastToken
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function resolveActionDisplayLabel(
  button: MjActionButton,
  t: (key: string) => string
): string {
  const rawLabel = button.label.trim();
  const loweredLabel = rawLabel.toLowerCase();
  const loweredCustomId = button.customId.trim().toLowerCase();
  const looksLikeRawCustomId =
    !rawLabel ||
    rawLabel === button.customId ||
    rawLabel.includes('::');

  if (button.scope !== 'image') {
    if (button.family === 'reroll') {
      return resolveActionFamilyLabel(button.family, t);
    }
    if (looksLikeRawCustomId) {
      return humanizeMidjourneyActionCustomId(button.customId);
    }
    return rawLabel || button.customId;
  }

  if (button.family === 'variation') {
    if (
      loweredLabel.includes('subtle') ||
      loweredCustomId.includes('subtle')
    ) {
      return 'V Subtle';
    }
    if (
      loweredLabel.includes('strong') ||
      loweredCustomId.includes('strong')
    ) {
      return 'V Strong';
    }
  }

  if (button.family === 'upscale') {
    if (
      loweredLabel.includes('subtle') ||
      loweredCustomId.includes('subtle')
    ) {
      return 'Subtle';
    }
    if (
      loweredLabel.includes('creative') ||
      loweredLabel.includes('strong') ||
      loweredCustomId.includes('creative') ||
      loweredCustomId.includes('strong')
    ) {
      return 'Creative';
    }
  }

  if (looksLikeRawCustomId) {
    return humanizeMidjourneyActionCustomId(button.customId);
  }

  return rawLabel || button.customId;
}

function buildActionInstanceKey(batchId: string, button: MjActionButton): string {
  return [
    batchId,
    button.scope === 'image'
      ? `img-${Number.isFinite(button.imageIndex) ? Number(button.imageIndex) : 'none'}`
      : 'batch',
    button.actionKey,
  ].join('::');
}

function groupButtonsByFamily(buttons: MjActionButton[]): Array<{
  family: MjActionFamily;
  items: MjActionButton[];
}> {
  return ACTION_FAMILY_ORDER
    .map((family) => ({
      family,
      items: buttons.filter((button) => button.family === family),
    }))
    .filter((group) => group.items.length > 0);
}

function hasMultipleImageActionTargets(buttons: MjActionButton[]): boolean {
  const imageIndexes = new Set<number>();
  for (const button of buttons) {
    if (button.scope !== 'image' || !Number.isFinite(button.imageIndex)) {
      continue;
    }
    imageIndexes.add(Number(button.imageIndex));
    if (imageIndexes.size > 1) {
      return true;
    }
  }
  return false;
}

function isSingleImageActionResult(action: string | null | undefined): boolean {
  const normalized = action?.trim().toLowerCase() ?? '';
  if (!normalized) {
    return false;
  }

  return (
    normalized.includes('upscale') ||
    normalized.includes('upsample') ||
    normalized.includes('zoom') ||
    normalized.includes('pan') ||
    normalized.includes('outpaint') ||
    normalized.includes('make square')
  );
}

function isGridImageActionResult(action: string | null | undefined): boolean {
  const normalized = action?.trim().toLowerCase() ?? '';
  if (!normalized) {
    return false;
  }

  return (
    normalized.includes('variation') ||
    normalized.includes('vary') ||
    normalized.includes('reroll') ||
    normalized.includes('re-roll') ||
    normalized.includes('refresh')
  );
}

function shouldTreatTaskAsSingleImageResult(
  task: MidjourneyTaskSnapshot,
  batch: MjResultBatch
): boolean {
  const taskImageUrls = (task.imageUrls ?? [])
    .map((value) => value?.trim() ?? '')
    .filter((value) => value.length > 0);

  if (taskImageUrls.length > 1) {
    return false;
  }
  if (taskImageUrls.length === 1) {
    return true;
  }

  const normalizedTaskButtons = normalizeMidjourneyButtons(task.buttons);
  const resolvedButtons =
    normalizedTaskButtons.length > 0 ? normalizedTaskButtons : batch.buttons;

  if (hasMultipleImageActionTargets(resolvedButtons)) {
    return false;
  }

  if (isSingleImageActionResult(task.action) || isSingleImageActionResult(batch.action)) {
    return true;
  }

  if (isGridImageActionResult(task.action) || isGridImageActionResult(batch.action)) {
    return false;
  }

  return batch.images.length === 1 && resolvedButtons.length > 0;
}

function buildBatchDisplayItems(batch: MjResultBatch): Array<MjBatchImageItem | null> {
  const orderedImages = [...batch.images].sort((left, right) => left.index - right.index);
  if (orderedImages.length === 1) {
    return orderedImages;
  }

  return buildBatchSlots(batch);
}

function resolveBranchSourceImageIndex(button: MjActionButton): number | null {
  return button.scope === 'image' && Number.isFinite(button.imageIndex)
    ? Number(button.imageIndex)
    : null;
}

export const MjResultNode = memo(
  ({ id, data, selected, width }: MjResultNodeProps) => {
    const { t, i18n } = useTranslation();
    const updateNodeInternals = useUpdateNodeInternals();
    const currentNode = useCanvasNodeById(id);
    const parentResultNode = useCanvasNodeById(data.parentResultNodeId ?? '');
    const mjApiKeys = useSettingsStore((state) => state.mjApiKeys);
    const setSelectedNode = useCanvasStore((state) => state.setSelectedNode);
    const updateNodeData = useCanvasStore((state) => state.updateNodeData);
    const addDerivedUploadNode = useCanvasStore((state) => state.addDerivedUploadNode);
    const addNode = useCanvasStore((state) => state.addNode);
    const addEdge = useCanvasStore((state) => state.addEdge);
    const findNodePosition = useCanvasStore((state) => state.findNodePosition);
    const isDescriptionPanelOpen = useCanvasStore(
      (state) => Boolean(state.nodeDescriptionPanelOpenById[id])
    );
    const isReferenceSourceHighlighted = useCanvasStore(
      (state) => state.highlightedReferenceSourceNodeId === id
    );
    const pollTimersRef = useRef(new Map<string, number>());
    const activePollBatchIdsRef = useRef(new Set<string>());
    const unmountedRef = useRef(false);
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const [expandedBatchIds, setExpandedBatchIds] = useState<Record<string, boolean>>(
      {}
    );
    const [selectedImageIndexByBatchId, setSelectedImageIndexByBatchId] = useState<
      Record<string, number | null>
    >({});
    const [busyActionKeys, setBusyActionKeys] = useState<Record<string, boolean>>({});
    const [modalState, setModalState] = useState<MidjourneyModalState | null>(null);

    const resolvedTitle = useMemo(
      () => resolveNodeDisplayName(CANVAS_NODE_TYPES.mjResult, data),
      [data]
    );
    const resolvedWidth = Math.max(
      MJ_RESULT_NODE_MIN_WIDTH,
      Math.round(width ?? MJ_RESULT_NODE_DEFAULT_WIDTH)
    );
    const explicitHeight =
      typeof currentNode?.height === 'number' && Number.isFinite(currentNode.height)
        ? currentNode.height
        : resolveNodeStyleDimension(currentNode?.style?.height);
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
    const branchLineageText = useMemo(() => {
      if (data.nodeRole !== 'branch') {
        return null;
      }

      const parts: string[] = [];
      if (isMjResultNode(parentResultNode) && data.parentBatchId) {
        const batchIndex = parentResultNode.data.batches.findIndex(
          (batch) => batch.id === data.parentBatchId
        );
        if (batchIndex >= 0) {
          parts.push(
            t('node.midjourney.result.branchLineageBatch', {
              index: parentResultNode.data.batches.length - batchIndex,
            })
          );
        }
      }

      if (Number.isFinite(data.sourceImageIndex)) {
        parts.push(
          t('node.midjourney.result.branchLineageImage', {
            index: Number(data.sourceImageIndex) + 1,
          })
        );
      }

      if ((data.branchActionLabel ?? '').trim()) {
        parts.push(data.branchActionLabel!.trim());
      }

      return parts.join(' / ') || null;
    }, [
      data.branchActionLabel,
      data.nodeRole,
      data.parentBatchId,
      data.sourceImageIndex,
      parentResultNode,
      t,
    ]);
    const selectedImageSignature = useMemo(
      () => JSON.stringify(selectedImageIndexByBatchId),
      [selectedImageIndexByBatchId]
    );

    const setActionBusy = useCallback((actionKey: string, isBusy: boolean) => {
      setBusyActionKeys((current) => {
        if (isBusy) {
          if (current[actionKey]) {
            return current;
          }
          return {
            ...current,
            [actionKey]: true,
          };
        }

        if (!current[actionKey]) {
          return current;
        }

        const next = { ...current };
        delete next[actionKey];
        return next;
      });
    }, []);

    const closeModal = useCallback(() => {
      if (modalState) {
        setActionBusy(modalState.actionInstanceKey, false);
      }
      setModalState(null);
    }, [modalState, setActionBusy]);

    const appendPendingBatchToResultNode = useCallback(
      (resultNodeId: string, pendingBatch: MjResultBatch) => {
        const latestNode = useCanvasStore
          .getState()
          .nodes.find((node) => node.id === resultNodeId);
        if (!isMjResultNode(latestNode)) {
          throw new Error(t('node.midjourney.result.branchNodeMissing'));
        }

        const nextNodeData = appendMjResultBatch(latestNode.data, pendingBatch);
        updateNodeData(
          resultNodeId,
          {
            ...nextNodeData,
            lastError: null,
          },
          { historyMode: 'skip' }
        );
      },
      [t, updateNodeData]
    );

    useEffect(() => {
      updateNodeInternals(id);
    }, [
      batchSections.length,
      branchLineageText,
      hasExplicitHeight,
      id,
      isDescriptionPanelOpen,
      resolvedHeight,
      resolvedWidth,
      selectedImageSignature,
      updateNodeInternals,
    ]);

    useEffect(() => {
      if (selected) {
        scrollContainerRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
      }
    }, [selected]);

    useEffect(() => {
      setSelectedImageIndexByBatchId((current) => {
        let changed = false;
        const next: Record<string, number | null> = {};
        for (const batch of data.batches) {
          const currentImageIndex = current[batch.id] ?? null;
          const availableImageIndexes = [...batch.images]
            .sort((left, right) => left.index - right.index)
            .map((item) => item.index);
          const hasImageScopedButtons = batch.buttons.some(
            (button) => button.scope === 'image'
          );

          if (
            currentImageIndex !== null &&
            availableImageIndexes.includes(currentImageIndex)
          ) {
            next[batch.id] = currentImageIndex;
            continue;
          }

          if (currentImageIndex !== null) {
            changed = true;
          }

          if (hasImageScopedButtons && availableImageIndexes.length > 0) {
            next[batch.id] = availableImageIndexes[0];
            if (currentImageIndex !== availableImageIndexes[0]) {
              changed = true;
            }
            continue;
          }

          if (currentImageIndex !== null) {
            changed = true;
          }
        }

        if (!changed && Object.keys(current).length !== Object.keys(next).length) {
          changed = true;
        }

        return changed ? next : current;
      });
    }, [data.batches]);

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
          const taskImageUrls = (task.imageUrls ?? [])
            .map((item) => item?.trim() ?? '')
            .filter((item) => item.length > 0);
          const taskImageUrl = task.imageUrl?.trim() ?? '';
          const shouldUseSingleImageResult = shouldTreatTaskAsSingleImageResult(
            task,
            latestBatch
          );
          let images = latestBatch.images;
          if (taskImageUrls.length > 0) {
            const preparedImages = await prepareMidjourneyBatchImages(taskImageUrls);
            if (preparedImages.length > 0) {
              images = preparedImages;
            } else if (taskImageUrl.length > 0) {
              images = shouldUseSingleImageResult
                ? await prepareMidjourneyBatchImages([taskImageUrl])
                : await splitMidjourneyGridToBatchImages(taskImageUrl);
            }
          } else if (taskImageUrl.length > 0) {
            images = shouldUseSingleImageResult
              ? await prepareMidjourneyBatchImages([taskImageUrl])
              : await splitMidjourneyGridToBatchImages(taskImageUrl);
          }

          const phase = normalizeMidjourneyTaskPhase(task.status);
          const terminal = isMidjourneyTaskTerminal(task.status);
          const succeededWithoutImages = terminal && phase === 'succeeded' && images.length === 0;
          const terminalErrorMessage = succeededWithoutImages
            ? t('node.midjourney.result.imageMissingAfterSuccess')
            : phase !== 'succeeded'
            ? task.failReason?.trim() || t('node.midjourney.result.pollFailed')
            : null;
          const nextNodeData = updateMjResultBatch(
            latestNode.data,
            batchId,
            (batch) => {
              const nextBatch = updateMjBatchFromTask(batch, task, images);
              if (!succeededWithoutImages) {
                return nextBatch;
              }

              return {
                ...nextBatch,
                failReason: terminalErrorMessage,
                isPolling: false,
              };
            }
          );

          updateNodeData(
            id,
            {
              ...nextNodeData,
              activeBatchId: batchId,
              lastError: terminalErrorMessage,
              lastGeneratedAt: terminal
                ? task.finishTime ?? Date.now()
                : latestNode.data.lastGeneratedAt ?? null,
            },
            { historyMode: 'skip' }
          );

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
          const isBackgroundPoll = Boolean(options?.scheduleNext) && !options?.showErrorDialog;

          console.warn('[midjourney] poll batch failed', {
            nodeId: id,
            batchId,
            taskId,
            providerId,
            background: isBackgroundPoll,
            message: content.message,
            details: content.details,
            rawError: error,
          });

          if (!isBackgroundPoll) {
            updateNodeData(
              id,
              {
                lastError: content.message,
              },
              { historyMode: 'skip' }
            );
          }

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
      [clearScheduledPoll, i18n.language, id, mjApiKeys, t, updateNodeData]
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

    const handleSelectBatch = useCallback((batchId: string) => {
      updateNodeData(
        id,
        {
          activeBatchId: batchId,
        },
        { historyMode: 'skip' }
      );
    }, [id, updateNodeData]);

    const toggleBatchPrompt = useCallback((batchId: string) => {
      setExpandedBatchIds((current) => ({
        ...current,
        [batchId]: !current[batchId],
      }));
    }, []);

    const handleOpenProviderSettings = useCallback(() => {
      openSettingsDialog({ category: 'providers', providerTab: 'mj' });
    }, []);

    const handleSubmitAction = useCallback(
      async (batch: MjResultBatch, button: MjActionButton) => {
        const actionInstanceKey = buildActionInstanceKey(batch.id, button);
        if (busyActionKeys[actionInstanceKey]) {
          return;
        }

        const providerId = normalizeMidjourneyProviderId(batch.providerId);
        const providerLabel = resolveMidjourneyProviderLabel(providerId, i18n.language);
        const apiKey = mjApiKeys[providerId]?.trim() ?? '';
        if (!apiKey) {
          const message = t('node.midjourney.result.providerKeyRequired', {
            provider: providerLabel,
          });
          updateNodeData(id, { lastError: message }, { historyMode: 'skip' });
          handleOpenProviderSettings();
          await showErrorDialog(message, t('common.error'));
          return;
        }

        handleSelectBatch(batch.id);
        setActionBusy(actionInstanceKey, true);
        let keepBusyForModal = false;

        try {
          const response = await submitMidjourneyActionTask({
            providerId,
            apiKey,
            taskId: batch.taskId,
            customId: button.customId,
          });
          const responseTaskId = response.taskId?.trim() ?? '';
          const modalKind = inferMidjourneyModalKind(button, response.code === 21);

          if (response.code === 21) {
            if (modalKind === 'unsupported' || modalKind === 'none') {
              throw new Error(
                response.description?.trim()
                || t('node.midjourney.result.unsupportedModal')
              );
            }

            keepBusyForModal = true;
            setModalState({
              kind: modalKind,
              batchId: batch.id,
              modalTaskId: responseTaskId || batch.taskId,
              providerId,
              button,
              sourceImageIndex: resolveBranchSourceImageIndex(button),
              promptDraft: batch.prompt?.trim() || '',
              zoomDraft: DEFAULT_CUSTOM_ZOOM,
              actionInstanceKey,
              isSubmitting: false,
            });
            updateNodeData(id, { lastError: null }, { historyMode: 'skip' });
            return;
          }

          if (!responseTaskId) {
            throw new Error(
              response.description?.trim()
              || t('node.midjourney.result.actionTaskMissing')
            );
          }

          const branch = ensureMidjourneyBranchResultNode({
            nodes: useCanvasStore.getState().nodes,
            addNode,
            addEdge,
            findNodePosition,
            sourceResultNodeId: id,
            sourceResultData: data,
            parentBatchId: batch.id,
            sourceImageIndex: resolveBranchSourceImageIndex(button),
            button,
          });

          const pendingBatchBase = createPendingMjBatch({
            id: `mj-batch-${uuidv4()}`,
            taskId: responseTaskId,
            providerId,
            prompt: batch.prompt?.trim() || '',
            finalPrompt: batch.finalPrompt?.trim() || batch.prompt?.trim() || '',
            action: button.label,
            submitTime: Date.now(),
          });

          appendPendingBatchToResultNode(branch.nodeId, {
            ...pendingBatchBase,
            state: response.state ?? null,
            properties: response.properties ?? null,
          });
          updateNodeData(id, { lastError: null }, { historyMode: 'skip' });
          setSelectedNode(branch.nodeId);
          await flushCurrentProjectToDiskSafely('saving Midjourney action submission');
        } catch (error) {
          const content = resolveErrorContent(
            error,
            t('node.midjourney.result.actionSubmitFailed')
          );
          updateNodeData(
            id,
            {
              lastError: content.message,
            },
            { historyMode: 'skip' }
          );
          await showErrorDialog(content.message, t('common.error'), content.details);
        } finally {
          if (!keepBusyForModal) {
            setActionBusy(actionInstanceKey, false);
          }
        }
      },
      [
        addEdge,
        addNode,
        appendPendingBatchToResultNode,
        busyActionKeys,
        data,
        findNodePosition,
        handleOpenProviderSettings,
        handleSelectBatch,
        i18n.language,
        id,
        mjApiKeys,
        setActionBusy,
        setSelectedNode,
        t,
        updateNodeData,
      ]
    );

    const handleSubmitModal = useCallback(async () => {
      if (!modalState || modalState.isSubmitting) {
        return;
      }

      const providerLabel = resolveMidjourneyProviderLabel(
        modalState.providerId,
        i18n.language
      );
      const apiKey = mjApiKeys[modalState.providerId]?.trim() ?? '';
      if (!apiKey) {
        const message = t('node.midjourney.result.providerKeyRequired', {
          provider: providerLabel,
        });
        updateNodeData(id, { lastError: message }, { historyMode: 'skip' });
        handleOpenProviderSettings();
        await showErrorDialog(message, t('common.error'));
        return;
      }

      setModalState((current) => (
        current
          ? {
            ...current,
            isSubmitting: true,
          }
          : current
      ));

      try {
        const sourceBatch = data.batches.find((batch) => batch.id === modalState.batchId);
        const promptDraft = modalState.promptDraft.trim() || sourceBatch?.prompt?.trim() || '';
        const modalPrompt =
          modalState.kind === 'customZoom'
            ? buildCustomZoomPrompt(promptDraft, modalState.zoomDraft)
            : promptDraft;

        const response = await submitMidjourneyModalTask({
          providerId: modalState.providerId,
          apiKey,
          taskId: modalState.modalTaskId,
          prompt: modalPrompt,
        });
        const responseTaskId = response.taskId?.trim() ?? '';
        if (!responseTaskId) {
          throw new Error(
            response.description?.trim()
            || t('node.midjourney.result.actionTaskMissing')
          );
        }

        const branch = ensureMidjourneyBranchResultNode({
          nodes: useCanvasStore.getState().nodes,
          addNode,
          addEdge,
          findNodePosition,
          sourceResultNodeId: id,
          sourceResultData: data,
          parentBatchId: modalState.batchId,
          sourceImageIndex: modalState.sourceImageIndex,
          button: modalState.button,
        });

        const pendingBatchBase = createPendingMjBatch({
          id: `mj-batch-${uuidv4()}`,
          taskId: responseTaskId,
          providerId: modalState.providerId,
          prompt: promptDraft,
          finalPrompt: modalPrompt,
          action: modalState.button.label,
          submitTime: Date.now(),
        });

        appendPendingBatchToResultNode(branch.nodeId, {
          ...pendingBatchBase,
          state: response.state ?? null,
          properties: response.properties ?? null,
        });
        updateNodeData(id, { lastError: null }, { historyMode: 'skip' });
        setActionBusy(modalState.actionInstanceKey, false);
        setModalState(null);
        setSelectedNode(branch.nodeId);
        await flushCurrentProjectToDiskSafely('saving Midjourney modal submission');
      } catch (error) {
        const content = resolveErrorContent(
          error,
          t('node.midjourney.result.modalSubmitFailed')
        );
        updateNodeData(
          id,
          {
            lastError: content.message,
          },
          { historyMode: 'skip' }
        );
        setModalState((current) => (
          current
            ? {
              ...current,
              isSubmitting: false,
            }
            : current
        ));
        await showErrorDialog(content.message, t('common.error'), content.details);
      }
    }, [
      addEdge,
      addNode,
      appendPendingBatchToResultNode,
      data,
      findNodePosition,
      handleOpenProviderSettings,
      i18n.language,
      id,
      mjApiKeys,
      modalState,
      setActionBusy,
      setSelectedNode,
      t,
      updateNodeData,
    ]);

    useEffect(() => {
      const pendingBatches = data.batches.filter((batch) => batch.isPolling);
      const pendingBatchIdSet = new Set(pendingBatches.map((batch) => batch.id));

      for (const existingBatchId of Array.from(pollTimersRef.current.keys())) {
        if (!pendingBatchIdSet.has(existingBatchId)) {
          clearScheduledPoll(existingBatchId);
        }
      }

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
    ]);

    useEffect(() => {
      return () => {
        unmountedRef.current = true;
        clearScheduledPoll();
      };
    }, [clearScheduledPoll]);

    const visibleLastError =
      pendingBatchCount > 0 && !pendingBatchMissingProviderKey ? null : data.lastError;

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

      if (visibleLastError) {
        return (
          <NodeStatusBadge
            icon={<TriangleAlert className="h-3 w-3" />}
            label={t('nodeStatus.error')}
            tone="danger"
            title={visibleLastError}
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
    }, [
      batchSections.length,
      i18n.language,
      pendingBatchCount,
      pendingBatchMissingProviderKey,
      t,
      visibleLastError,
    ]);

    const statusText = useMemo(() => {
      if (pendingBatchMissingProviderKey) {
        return t('node.midjourney.result.providerKeyRequired', {
          provider: resolveMidjourneyProviderLabel(
            pendingBatchMissingProviderKey.providerId,
            i18n.language
          ),
        });
      }

      if (pendingBatchCount > 0) {
        return t('node.midjourney.result.statusPolling');
      }

      if (visibleLastError) {
        return visibleLastError;
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
    }, [
      activeBatch,
      batchSections.length,
      i18n.language,
      pendingBatchCount,
      pendingBatchMissingProviderKey,
      t,
      visibleLastError,
    ]);

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
          minHeight: `${resolvedMinHeight}px`,
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
          ref={scrollContainerRef}
          className="ui-scrollbar nowheel min-h-0 flex-1 overflow-auto pt-5"
          onWheelCapture={(event) => event.stopPropagation()}
        >
          {data.nodeRole === 'branch' ? (
            <div className="mb-4 rounded-2xl border border-white/10 bg-white/[0.035] px-3 py-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-white/10 bg-black/20 px-2 py-0.5 text-[11px] text-text-muted">
                  {t('node.midjourney.result.branchNode')}
                </span>
                {branchLineageText ? (
                  <span className="text-[11px] text-text-muted">
                    {t('node.midjourney.result.branchLineage', {
                      lineage: branchLineageText,
                    })}
                  </span>
                ) : null}
              </div>
            </div>
          ) : null}

          {batchSections.length > 0 ? (
            <div className="space-y-0">
              {batchSections.map((batch, batchIndex) => {
                const isActive =
                  data.activeBatchId === batch.id || (!data.activeBatchId && batchIndex === 0);
                const batchViewerImageList = buildBatchViewerImageList(batch);
                const batchAspectRatioCss = toCssAspectRatio(resolveBatchAspectRatio(batch));
                const submittedAt = formatTimestamp(batch.submitTime, i18n.language);
                const startedAt = formatTimestamp(batch.startTime, i18n.language);
                const finishedAt = formatTimestamp(batch.finishTime, i18n.language);
                const promptExpanded = Boolean(expandedBatchIds[batch.id]);
                const phaseLabel = resolveBatchPhaseLabel(batch, t);
                const statusTone = resolveBatchStatusTone(batch);
                const phase = normalizeMidjourneyTaskPhase(batch.status);
                const shouldShowBatchFailure =
                  Boolean(batch.failReason) &&
                  (phase === 'failed' || phase === 'cancelled');
                const providerId = normalizeMidjourneyProviderId(batch.providerId);
                const providerLabel = resolveMidjourneyProviderLabel(
                  providerId,
                  i18n.language
                );
                const providerApiKey = mjApiKeys[providerId]?.trim() ?? '';
                const supportedButtons = batch.buttons.filter(isSupportedMidjourneyActionButton);
                const unsupportedCount = batch.buttons.length - supportedButtons.length;
                const selectedImageIndex =
                  selectedImageIndexByBatchId[batch.id] ?? null;
                const imageScopedButtons = Number.isFinite(selectedImageIndex)
                  ? supportedButtons.filter(
                    (button) =>
                      button.scope === 'image' &&
                      Number(button.imageIndex) === Number(selectedImageIndex)
                  )
                  : [];
                const batchScopedButtons = supportedButtons.filter(
                  (button) => button.scope === 'batch'
                );
                const imageActionGroups = groupButtonsByFamily(imageScopedButtons);
                const batchActionGroups = groupButtonsByFamily(batchScopedButtons);
                const hasImageScopedButtons = supportedButtons.some(
                  (button) => button.scope === 'image'
                );
                const showActionPanel =
                  batch.buttons.length > 0 || phase === 'succeeded';
                const batchDisplayItems = buildBatchDisplayItems(batch);
                const showSingleImageLayout =
                  batchDisplayItems.length === 1 && Boolean(batchDisplayItems[0]);

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
                        handleSelectBatch(batch.id);
                      }}
                      onKeyDown={(event) => {
                        if (event.key !== 'Enter' && event.key !== ' ') {
                          return;
                        }

                        event.preventDefault();
                        event.stopPropagation();
                        handleSelectBatch(batch.id);
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
                            {batch.action ? (
                              <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[11px] text-text-muted">
                                {batch.action}
                              </span>
                            ) : null}
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

                      {shouldShowBatchFailure ? (
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

                      <div
                        className={`mt-3 grid gap-2 ${showSingleImageLayout ? 'grid-cols-1' : 'grid-cols-2'}`}
                      >
                        {batchDisplayItems.map((item, index) => {
                          const sourceCandidates = listBatchImageCandidates(item);
                          const source = sourceCandidates[0] ?? null;
                          const fallbackSource =
                            sourceCandidates.find((candidate) => candidate !== source) ?? null;
                          const viewerSource = source ? resolveImageDisplayUrl(source) : null;
                          const fallbackViewerSource = fallbackSource
                            ? resolveImageDisplayUrl(fallbackSource)
                            : null;
                          const isImageSelected =
                            selectedImageIndex !== null && Number(selectedImageIndex) === index;

                          return (
                            <div
                              key={item?.id ?? `${batch.id}-slot-${index + 1}`}
                              className={`group/mj-slot relative overflow-hidden rounded-xl border bg-black/10 transition-colors ${
                                isImageSelected
                                  ? 'border-accent bg-accent/10 shadow-[0_0_0_2px_rgba(59,130,246,0.34),0_10px_24px_rgba(59,130,246,0.16)]'
                                  : 'border-white/10'
                              }`}
                            >
                              <button
                                type="button"
                                className="nodrag block w-full text-left"
                                disabled={!item}
                                onPointerDown={(event) => {
                                  event.stopPropagation();
                                }}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setSelectedNode(id);
                                  handleSelectBatch(batch.id);
                                  if (item) {
                                    setSelectedImageIndexByBatchId((current) => ({
                                      ...current,
                                      [batch.id]: index,
                                    }));
                                  }
                                }}
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
                                      fallbackSrc={fallbackViewerSource}
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
                              </button>

                              <div
                                className={`pointer-events-none absolute left-2 top-2 rounded-full px-2 py-1 text-[11px] font-medium text-white transition-colors ${
                                  isImageSelected
                                    ? 'bg-accent/85 shadow-[0_0_0_1px_rgba(255,255,255,0.16)]'
                                    : 'bg-black/55'
                                }`}
                              >
                                {index + 1}
                              </div>

                              {item && source ? (
                                <button
                                  type="button"
                                  className="nodrag absolute right-2 top-2 rounded bg-black/60 p-1 text-white opacity-0 transition-all duration-150 hover:bg-black/75 group-hover/mj-slot:opacity-100"
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

                      {showActionPanel ? (
                        <div
                          className="mt-3 rounded-2xl border border-white/8 bg-black/10 p-3"
                          onClick={(event) => event.stopPropagation()}
                          onPointerDown={(event) => event.stopPropagation()}
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="text-[12px] font-medium text-text-dark">
                              {t('node.midjourney.result.actionsTitle')}
                            </div>
                            {Number.isFinite(selectedImageIndex) ? (
                              <div className="text-[11px] text-text-muted">
                                {t('node.midjourney.result.selectedImage', {
                                  index: Number(selectedImageIndex) + 1,
                                })}
                              </div>
                            ) : null}
                          </div>

                          {!providerApiKey ? (
                            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-400/18 bg-amber-500/10 px-3 py-2">
                              <div className="text-xs text-amber-100">
                                {t('node.midjourney.result.providerKeyRequired', {
                                  provider: providerLabel,
                                })}
                              </div>
                              <UiButton
                                type="button"
                                size="sm"
                                variant="muted"
                                onClick={handleOpenProviderSettings}
                              >
                                {t('node.midjourney.result.openProviderSettings')}
                              </UiButton>
                            </div>
                          ) : null}

                          {providerApiKey && hasImageScopedButtons && !Number.isFinite(selectedImageIndex) ? (
                            <div className="mt-3 rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2 text-xs text-text-muted">
                              {t('node.midjourney.result.selectImageForActions')}
                            </div>
                          ) : null}

                          {providerApiKey && imageActionGroups.length > 0 ? (
                            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                              {imageActionGroups.map(({ family, items }) => (
                                <div
                                  key={`${batch.id}-image-${family}`}
                                  className="inline-flex flex-wrap items-center gap-1.5"
                                >
                                  <span className="shrink-0 text-[10px] font-medium leading-none text-text-muted">
                                    {resolveActionFamilyLabel(family, t)}
                                  </span>
                                  {items.map((button) => {
                                    const actionInstanceKey = buildActionInstanceKey(
                                      batch.id,
                                      button
                                    );
                                    const isBusy = Boolean(
                                      busyActionKeys[actionInstanceKey]
                                    );
                                    const isDisabled = !providerApiKey || isBusy;
                                    return (
                                      <UiChipButton
                                        key={`${batch.id}-${family}-${button.customId}`}
                                        type="button"
                                        active={isBusy}
                                        disabled={isDisabled}
                                        className="h-7 rounded-full !px-2.5 text-[11px]"
                                        onClick={() => void handleSubmitAction(batch, button)}
                                      >
                                        {isBusy ? (
                                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                        ) : null}
                                        <span className="truncate">
                                          {resolveActionDisplayLabel(button, t)}
                                        </span>
                                      </UiChipButton>
                                    );
                                  })}
                                </div>
                              ))}
                            </div>
                          ) : null}

                          {providerApiKey && batchActionGroups.length > 0 ? (
                            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                              {batchActionGroups.map(({ family, items }) => (
                                <div
                                  key={`${batch.id}-batch-${family}`}
                                  className="inline-flex flex-wrap items-center gap-1.5"
                                >
                                  <span className="shrink-0 text-[10px] font-medium leading-none text-text-muted">
                                    {resolveActionFamilyLabel(family, t)}
                                  </span>
                                  {items.map((button) => {
                                    const actionInstanceKey = buildActionInstanceKey(
                                      batch.id,
                                      button
                                    );
                                    const isBusy = Boolean(
                                      busyActionKeys[actionInstanceKey]
                                    );
                                    const isDisabled = !providerApiKey || isBusy;
                                    return (
                                      <UiChipButton
                                        key={`${batch.id}-${family}-${button.customId}`}
                                        type="button"
                                        active={isBusy}
                                        disabled={isDisabled}
                                        className="h-7 max-w-full rounded-full !px-2.5 text-[11px]"
                                        onClick={() => void handleSubmitAction(batch, button)}
                                      >
                                        {isBusy ? (
                                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                        ) : null}
                                        <span className="max-w-[180px] truncate">
                                          {resolveActionDisplayLabel(button, t)}
                                        </span>
                                      </UiChipButton>
                                    );
                                  })}
                                </div>
                              ))}
                            </div>
                          ) : null}

                          {providerApiKey &&
                          supportedButtons.length === 0 &&
                          unsupportedCount === 0 &&
                          phase === 'succeeded' ? (
                            <div className="mt-3 rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2 text-xs text-text-muted">
                              {t('node.midjourney.result.noAvailableActions')}
                            </div>
                          ) : null}

                          {unsupportedCount > 0 ? (
                            <div className="mt-3 text-xs text-text-muted">
                              {t('node.midjourney.result.unsupportedActions', {
                                count: unsupportedCount,
                              })}
                            </div>
                          ) : null}
                        </div>
                      ) : null}
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
              visibleLastError ? 'text-rose-300' : 'text-text-muted'
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

        <UiModal
          isOpen={Boolean(modalState)}
          title={
            modalState?.kind === 'customZoom'
              ? t('node.midjourney.result.modal.customZoomTitle')
              : t('node.midjourney.result.modal.remixPromptTitle')
          }
          onClose={() => {
            if (!modalState?.isSubmitting) {
              closeModal();
            }
          }}
          widthClassName="w-[520px]"
          footer={(
            <>
              <UiButton
                type="button"
                variant="ghost"
                disabled={Boolean(modalState?.isSubmitting)}
                onClick={closeModal}
              >
                {t('common.cancel')}
              </UiButton>
              <UiButton
                type="button"
                disabled={Boolean(modalState?.isSubmitting)}
                onClick={() => void handleSubmitModal()}
              >
                {modalState?.isSubmitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : null}
                {t('common.confirm')}
              </UiButton>
            </>
          )}
        >
          {modalState ? (
            <div className="space-y-3">
              {modalState.kind === 'customZoom' ? (
                <label className="block rounded-xl border border-white/10 bg-black/10 px-3 py-2.5">
                  <div className="mb-2 text-xs font-medium text-text-muted">
                    {t('node.midjourney.result.modal.zoomLabel')}
                  </div>
                  <div className="flex items-center gap-3">
                    <input
                      type="range"
                      min={CUSTOM_ZOOM_MIN}
                      max={CUSTOM_ZOOM_MAX}
                      step={CUSTOM_ZOOM_STEP}
                      value={modalState.zoomDraft}
                      className="ui-range nodrag h-5 flex-1"
                      onChange={(event) => {
                        const nextValue = normalizeCustomZoomValue(
                          Number.parseFloat(event.target.value)
                        );
                        setModalState((current) => (
                          current
                            ? {
                              ...current,
                              zoomDraft: nextValue,
                            }
                            : current
                        ));
                      }}
                    />
                    <UiInput
                      type="number"
                      min={CUSTOM_ZOOM_MIN}
                      max={CUSTOM_ZOOM_MAX}
                      step={CUSTOM_ZOOM_STEP}
                      value={formatCustomZoomValue(modalState.zoomDraft)}
                      className="!w-24 !rounded-xl !border-white/10 !bg-white/[0.04] !px-3 !py-2 text-sm"
                      onChange={(event) => {
                        const nextValue = normalizeCustomZoomValue(
                          Number.parseFloat(event.target.value || `${DEFAULT_CUSTOM_ZOOM}`)
                        );
                        setModalState((current) => (
                          current
                            ? {
                              ...current,
                              zoomDraft: nextValue,
                            }
                            : current
                        ));
                      }}
                    />
                  </div>
                  <div className="mt-2 text-[11px] text-text-muted">
                    {t('node.midjourney.result.modal.zoomHint')}
                  </div>
                </label>
              ) : null}

              <label className="block rounded-xl border border-white/10 bg-black/10 px-3 py-2.5">
                <div className="mb-2 text-xs font-medium text-text-muted">
                  {t('node.midjourney.result.modal.promptLabel')}
                </div>
                <UiTextArea
                  rows={7}
                  value={modalState.promptDraft}
                  className="!rounded-xl !border-white/10 !bg-white/[0.04] !text-sm"
                  placeholder={t('node.midjourney.result.modal.promptPlaceholder')}
                  onChange={(event) => {
                    const nextValue = event.target.value;
                    setModalState((current) => (
                      current
                        ? {
                          ...current,
                          promptDraft: nextValue,
                        }
                        : current
                    ));
                  }}
                />
              </label>
            </div>
          ) : null}
        </UiModal>
      </div>
    );
  }
);

MjResultNode.displayName = 'MjResultNode';
