import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import {
  Handle,
  Position,
  useUpdateNodeInternals,
  type NodeProps,
} from '@xyflow/react';
import {
  Languages,
  Loader2,
  SlidersHorizontal,
  Sparkles,
  Undo2,
  Wand2,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { v4 as uuidv4 } from 'uuid';

import {
  UiButton,
  UiChipButton,
  UiPanel,
  UiSelect,
} from '@/components/ui';
import { createUiRangeStyle } from '@/components/ui/rangeStyle';
import { resolveImageDisplayUrl } from '@/features/canvas/application/imageData';
import {
  resolveErrorContent,
  showErrorDialog,
} from '@/features/canvas/application/errorDialog';
import { flushCurrentProjectToDiskSafely } from '@/features/canvas/application/projectPersistence';
import {
  CANVAS_NODE_TYPES,
  MJ_NODE_DEFAULT_HEIGHT,
  MJ_NODE_DEFAULT_WIDTH,
  MJ_NODE_MIN_HEIGHT,
  MJ_NODE_MIN_WIDTH,
  MJ_RESULT_NODE_DEFAULT_HEIGHT,
  MJ_RESULT_NODE_DEFAULT_WIDTH,
  MIDJOURNEY_ASPECT_RATIOS,
  MIDJOURNEY_VERSION_PRESETS,
  isMjResultNode,
  type MidjourneyAspectRatio,
  type MidjourneyVersionPreset,
  type MjNodeData,
  type MjResultBatch,
} from '@/features/canvas/domain/canvasNodes';
import { resolveNodeDisplayName } from '@/features/canvas/domain/nodeDisplay';
import {
  useCanvasConnectedReferenceImages,
  useCanvasNodeById,
} from '@/features/canvas/hooks/useCanvasNodeGraph';
import { CanvasNodeImage } from '@/features/canvas/ui/CanvasNodeImage';
import {
  NodeHeader,
  NODE_HEADER_FLOATING_POSITION_CLASS,
} from '@/features/canvas/ui/NodeHeader';
import { NodeResizeHandle } from '@/features/canvas/ui/NodeResizeHandle';
import { resolveNodeStyleDimension } from '@/features/canvas/ui/nodeDimensionUtils';
import {
  NODE_CONTROL_CHIP_CLASS,
  NODE_CONTROL_GENERATE_ICON_CLASS,
  NODE_CONTROL_PRIMARY_BUTTON_CLASS,
} from '@/features/canvas/ui/nodeControlStyles';
import {
  appendMjResultBatch,
  areMjReferencesEqual,
  buildSyncedMjReferences,
  createRootMjResultNodeData,
  updateMjResultBatch,
} from '@/features/midjourney/application/midjourneyNodes';
import {
  optimizeMidjourneyPrompt,
  stripMidjourneyParams,
  translateMidjourneyPrompt,
} from '@/features/midjourney/application/midjourneyPrompt';
import { submitMidjourneyImagineTask } from '@/features/midjourney/application/midjourneyGeneration';
import {
  MIDJOURNEY_ADVANCED_PARAM_RANGES,
  buildMidjourneyAdvancedParams,
  parseMidjourneyAdvancedParams,
  validateMidjourneyAdvancedParams,
  type MidjourneyAdvancedParamsDraft,
} from '@/features/midjourney/domain/prompt';
import { createPendingMjBatch } from '@/features/midjourney/domain/task';
import { resolveMidjourneyProviderLabel } from '@/features/midjourney/domain/providers';
import { MjStyleCodeDialog } from '@/features/midjourney/ui/MjStyleCodeDialog';
import { openSettingsDialog } from '@/features/settings/settingsEvents';
import { useCanvasStore } from '@/stores/canvasStore';
import { useSettingsStore } from '@/stores/settingsStore';

type MjNodeProps = NodeProps & {
  id: string;
  data: MjNodeData;
  selected?: boolean;
};

interface PromptRewriteUndoState {
  previousPrompt: string;
  appliedPrompt: string;
}

function FixedControlChip<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (nextValue: T) => void;
}) {
  const chipRef = useRef<HTMLDivElement>(null);

  return (
    <div
      ref={chipRef}
      className={`flex h-7 min-w-[108px] shrink-0 items-center gap-1 rounded-lg border border-[color:var(--ui-border-soft)] bg-[var(--ui-surface-field)] px-2 ${NODE_CONTROL_CHIP_CLASS}`}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <span className="shrink-0 text-[10px] text-text-muted/90">{label}</span>
      <div className="min-w-0 flex-1">
        <UiSelect
          value={value}
          aria-label={label}
          menuAnchorRef={chipRef}
          className="nodrag !h-6 !w-full !rounded-md !border-0 !bg-transparent !px-0.5 !text-[10.5px] !font-medium hover:!border-0 focus-visible:!border-0 focus-visible:!shadow-none"
          onChange={(event) => onChange(event.target.value as T)}
        >
          {options.map((option) => (
            <option key={option.value || 'default'} value={option.value}>
              {option.label}
            </option>
          ))}
        </UiSelect>
      </div>
    </div>
  );
}

function AdvancedParamSlider({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (nextValue: number) => void;
}) {
  const sliderStyle = {
    ...createUiRangeStyle(value, min, max),
    '--ui-range-track-size': '5px',
    '--ui-range-thumb-size': '12px',
    '--ui-range-track': 'rgba(104, 112, 128, 0.56)',
    '--ui-range-track-fill-start': 'rgba(104, 112, 128, 0.92)',
    '--ui-range-track-fill-end': 'rgba(104, 112, 128, 0.92)',
    '--ui-range-thumb-bg': 'rgba(196, 202, 214, 0.98)',
    '--ui-range-thumb-border': 'rgba(233, 237, 245, 0.18)',
    '--ui-range-thumb-shadow': 'none',
    '--ui-range-thumb-shadow-hover': '0 0 0 4px rgba(255,255,255,0.05)',
  } as CSSProperties;

  return (
    <div className="border-t border-border-dark/90 px-5 py-5 first:border-t-0">
      <div className="grid grid-cols-[88px_minmax(0,1fr)_auto] items-center gap-4">
        <span className="text-[15px] font-medium leading-none text-[#d7dbe3]">{label}</span>
        <div className="flex min-w-0 items-center">
          <input
            type="range"
            min={min}
            max={max}
            step={step}
            value={value}
            className="ui-range nodrag h-5"
            style={sliderStyle}
            onChange={(event) => onChange(Number.parseInt(event.target.value, 10))}
          />
        </div>
        <span className="min-w-[30px] rounded-md border border-white/8 bg-black/18 px-2 py-1 text-center text-[11px] font-medium leading-none text-[#c8ced9] shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
          {value}
        </span>
      </div>
    </div>
  );
}

export const MjNode = memo(({ id, data, selected, width }: MjNodeProps) => {
  const { t, i18n } = useTranslation();
  const updateNodeInternals = useUpdateNodeInternals();
  const mjApiKeys = useSettingsStore((state) => state.mjApiKeys);
  const mjProviderEnabled = useSettingsStore((state) => state.mjProviderEnabled);
  const currentNode = useCanvasNodeById(id);
  const connectedReferenceImages = useCanvasConnectedReferenceImages(id);
  const linkedNode = useCanvasNodeById(data.linkedResultNodeId ?? '');
  const linkedResultNode = isMjResultNode(linkedNode) ? linkedNode : null;
  const setSelectedNode = useCanvasStore((state) => state.setSelectedNode);
  const updateNodeData = useCanvasStore((state) => state.updateNodeData);
  const addNode = useCanvasStore((state) => state.addNode);
  const addEdge = useCanvasStore((state) => state.addEdge);
  const findNodePosition = useCanvasStore((state) => state.findNodePosition);
  const containerRef = useRef<HTMLDivElement>(null);
  const advancedParamsTriggerRef = useRef<HTMLDivElement>(null);
  const advancedParamsPanelRef = useRef<HTMLDivElement>(null);
  const generateRequestInFlightRef = useRef(false);

  const [promptDraft, setPromptDraft] = useState(() => data.prompt ?? '');
  const promptDraftRef = useRef(data.prompt ?? '');
  const [advancedParamsDraft, setAdvancedParamsDraft] = useState<MidjourneyAdvancedParamsDraft>(
    () => parseMidjourneyAdvancedParams(data.advancedParams ?? '')
  );
  const [isAdvancedParamsOpen, setIsAdvancedParamsOpen] = useState(false);
  const [isStyleCodeDialogOpen, setIsStyleCodeDialogOpen] = useState(false);
  const [isOptimizingPrompt, setIsOptimizingPrompt] = useState(false);
  const [isTranslatingPrompt, setIsTranslatingPrompt] = useState(false);
  const [promptRewriteError, setPromptRewriteError] = useState<string | null>(null);
  const [lastPromptRewriteUndoState, setLastPromptRewriteUndoState] =
    useState<PromptRewriteUndoState | null>(null);
  const resolvedTitle = useMemo(
    () => resolveNodeDisplayName(CANVAS_NODE_TYPES.mj, data),
    [data]
  );
  const resolvedWidth = Math.max(
    MJ_NODE_MIN_WIDTH,
    Math.round(width ?? MJ_NODE_DEFAULT_WIDTH)
  );
  const explicitHeight = resolveNodeStyleDimension(currentNode?.style?.height);
  const hasExplicitHeight =
    typeof explicitHeight === 'number'
    && Math.abs(explicitHeight - MJ_NODE_DEFAULT_HEIGHT) > 1;
  const resolvedHeight = hasExplicitHeight
    ? Math.max(MJ_NODE_MIN_HEIGHT, Math.round(explicitHeight))
    : null;
  const apiKey = mjApiKeys[mjProviderEnabled]?.trim() ?? '';
  const providerLabel = resolveMidjourneyProviderLabel(mjProviderEnabled, i18n.language);
  const syncedReferences = useMemo(
    () => buildSyncedMjReferences(connectedReferenceImages, data.references ?? []),
    [connectedReferenceImages, data.references]
  );
  const optimizationReferenceImages = useMemo(
    () =>
      syncedReferences
        .filter((reference) => reference.role === 'reference')
        .map((reference) => reference.imageUrl),
    [syncedReferences]
  );
  const pendingBatchCount = linkedResultNode?.data.batches.filter((batch) => batch.isPolling).length ?? 0;
  const personalizationCodeCount = data.personalizationCodes?.length ?? 0;
  const isSubmitting = Boolean(data.isSubmitting);
  const isPromptBusy = isSubmitting || isOptimizingPrompt || isTranslatingPrompt;
  const canRewritePrompt = stripMidjourneyParams(promptDraft).length > 0;
  const canUndoPromptRewrite = Boolean(
    lastPromptRewriteUndoState
    && promptDraft === lastPromptRewriteUndoState.appliedPrompt
  );
  const aspectRatioOptions = useMemo(
    () => MIDJOURNEY_ASPECT_RATIOS.map((value) => ({ value, label: value })),
    []
  );
  const versionOptions = useMemo(
    () =>
      MIDJOURNEY_VERSION_PRESETS.map((value) => ({
        value,
        label: value ? `V${value}` : t('node.midjourney.versionDefault'),
      })),
    [t]
  );

  useEffect(() => {
    promptDraftRef.current = data.prompt ?? '';
    setPromptDraft(data.prompt ?? '');
  }, [data.prompt]);

  useEffect(() => {
    promptDraftRef.current = promptDraft;
  }, [promptDraft]);

  useEffect(() => {
    if (!isAdvancedParamsOpen) {
      setAdvancedParamsDraft(parseMidjourneyAdvancedParams(data.advancedParams ?? ''));
    }
  }, [data.advancedParams, isAdvancedParamsOpen]);

  useEffect(() => {
    if (!areMjReferencesEqual(data.references ?? [], syncedReferences)) {
      updateNodeData(id, { references: syncedReferences }, { historyMode: 'skip' });
    }
  }, [data.references, id, syncedReferences, updateNodeData]);

  useEffect(() => {
    if (!data.linkedResultNodeId || linkedResultNode) {
      return;
    }

    updateNodeData(
      id,
      {
        linkedResultNodeId: null,
        ...(data.isSubmitting
          ? {
              isSubmitting: false,
              activeTaskId: null,
            }
          : {}),
      },
      { historyMode: 'skip' }
    );
  }, [data.isSubmitting, data.linkedResultNodeId, id, linkedResultNode, updateNodeData]);

  useEffect(() => {
    updateNodeInternals(id);
  }, [hasExplicitHeight, id, resolvedHeight, resolvedWidth, syncedReferences.length, updateNodeInternals]);

  useEffect(() => {
    const host = containerRef.current;
    if (!host || hasExplicitHeight) {
      return;
    }

    const observer = new ResizeObserver(() => {
      updateNodeInternals(id);
    });
    observer.observe(host);

    return () => {
      observer.disconnect();
    };
  }, [hasExplicitHeight, id, updateNodeInternals]);

  useEffect(() => {
    if (!isAdvancedParamsOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) {
        return;
      }

      if (advancedParamsTriggerRef.current?.contains(target)) {
        return;
      }

      if (advancedParamsPanelRef.current?.contains(target)) {
        return;
      }

      setIsAdvancedParamsOpen(false);
      setAdvancedParamsDraft(parseMidjourneyAdvancedParams(data.advancedParams ?? ''));
    };

    window.addEventListener('pointerdown', handlePointerDown);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [data.advancedParams, isAdvancedParamsOpen]);

  const commitPromptDraft = useCallback(() => {
    if (promptDraft !== (data.prompt ?? '')) {
      updateNodeData(id, { prompt: promptDraft });
    }
  }, [data.prompt, id, promptDraft, updateNodeData]);

  const applyPromptRewrite = useCallback(
    (nextPrompt: string, sourcePrompt: string) => {
      setPromptDraft(nextPrompt);
      promptDraftRef.current = nextPrompt;
      setPromptRewriteError(null);
      setLastPromptRewriteUndoState({
        previousPrompt: sourcePrompt,
        appliedPrompt: nextPrompt,
      });
      updateNodeData(id, {
        prompt: nextPrompt,
        lastError: null,
      });
    },
    [id, updateNodeData]
  );

  const handleOptimizePrompt = useCallback(async () => {
    if (isPromptBusy) {
      return;
    }

    const sourcePrompt = promptDraftRef.current;
    const currentPrompt = stripMidjourneyParams(sourcePrompt);
    if (!currentPrompt) {
      const errorMessage = t('node.midjourney.promptRequired');
      setPromptRewriteError(errorMessage);
      await showErrorDialog(errorMessage, t('common.error'));
      return;
    }

    setIsOptimizingPrompt(true);
    setPromptRewriteError(null);
    updateNodeData(id, { lastError: null }, { historyMode: 'skip' });

    try {
      const result = await optimizeMidjourneyPrompt({
        prompt: sourcePrompt,
        referenceImages: optimizationReferenceImages,
      });
      if (promptDraftRef.current !== sourcePrompt) {
        return;
      }

      applyPromptRewrite(result.prompt, sourcePrompt);
    } catch (error) {
      const content = resolveErrorContent(
        error,
        t('node.midjourney.optimizePromptFailed')
      );
      setPromptRewriteError(content.message);
      await showErrorDialog(content.message, t('common.error'), content.details);
    } finally {
      setIsOptimizingPrompt(false);
    }
  }, [
    applyPromptRewrite,
    id,
    isPromptBusy,
    optimizationReferenceImages,
    t,
    updateNodeData,
  ]);

  const handleTranslatePrompt = useCallback(async () => {
    if (isPromptBusy) {
      return;
    }

    const sourcePrompt = promptDraftRef.current;
    const currentPrompt = stripMidjourneyParams(sourcePrompt);
    if (!currentPrompt) {
      const errorMessage = t('node.midjourney.promptRequired');
      setPromptRewriteError(errorMessage);
      await showErrorDialog(errorMessage, t('common.error'));
      return;
    }

    setIsTranslatingPrompt(true);
    setPromptRewriteError(null);
    updateNodeData(id, { lastError: null }, { historyMode: 'skip' });

    try {
      const result = await translateMidjourneyPrompt({
        prompt: sourcePrompt,
      });
      if (promptDraftRef.current !== sourcePrompt) {
        return;
      }

      applyPromptRewrite(result.prompt, sourcePrompt);
    } catch (error) {
      const content = resolveErrorContent(
        error,
        t('node.midjourney.translatePromptFailed')
      );
      setPromptRewriteError(content.message);
      await showErrorDialog(content.message, t('common.error'), content.details);
    } finally {
      setIsTranslatingPrompt(false);
    }
  }, [applyPromptRewrite, id, isPromptBusy, t, updateNodeData]);

  const handleUndoPromptRewrite = useCallback(() => {
    if (!lastPromptRewriteUndoState) {
      return;
    }

    if (promptDraftRef.current !== lastPromptRewriteUndoState.appliedPrompt) {
      return;
    }

    setPromptDraft(lastPromptRewriteUndoState.previousPrompt);
    promptDraftRef.current = lastPromptRewriteUndoState.previousPrompt;
    setPromptRewriteError(null);
    setLastPromptRewriteUndoState(null);
    updateNodeData(id, {
      prompt: lastPromptRewriteUndoState.previousPrompt,
      lastError: null,
    });
  }, [id, lastPromptRewriteUndoState, updateNodeData]);

  const handleToggleReferenceRole = useCallback(
    (imageUrl: string) => {
      const nextReferences = (data.references ?? []).map((item) =>
        item.imageUrl === imageUrl
          ? {
              ...item,
              role:
                item.role === 'styleReference'
                  ? 'reference'
                  : 'styleReference',
            }
          : item
      );
      updateNodeData(id, { references: nextReferences });
    },
    [data.references, id, updateNodeData]
  );

  const handleApplyAdvancedParams = useCallback(async () => {
    const nextAdvancedParams = buildMidjourneyAdvancedParams(advancedParamsDraft);
    const validation = validateMidjourneyAdvancedParams(nextAdvancedParams);
    if (!validation.valid) {
      const message = t('node.midjourney.advancedParamsConflict', {
        params: validation.duplicatedReservedParams.join(', '),
      });
      await showErrorDialog(message, t('common.error'));
      return;
    }

    updateNodeData(id, {
      advancedParams: nextAdvancedParams,
      lastError: data.lastError ?? null,
    });
    setIsAdvancedParamsOpen(false);
  }, [advancedParamsDraft, data.lastError, id, t, updateNodeData]);

  const handleGenerate = useCallback(async () => {
    const prompt = promptDraft.trim();
    if (!prompt) {
      const message = t('node.midjourney.promptRequired');
      updateNodeData(id, { lastError: message });
      await showErrorDialog(message, t('common.error'));
      return;
    }

    if (!apiKey) {
      const message = t('node.midjourney.apiKeyRequired', {
        provider: providerLabel,
      });
      updateNodeData(id, { lastError: message });
      openSettingsDialog({ category: 'providers', providerTab: 'mj' });
      await showErrorDialog(message, t('common.error'));
      return;
    }

    if (isPromptBusy || generateRequestInFlightRef.current) {
      return;
    }

    const advancedParamValidation = validateMidjourneyAdvancedParams(
      data.advancedParams ?? ''
    );
    if (!advancedParamValidation.valid) {
      const message = t('node.midjourney.advancedParamsConflict', {
        params: advancedParamValidation.duplicatedReservedParams.join(', '),
      });
      updateNodeData(id, { lastError: message });
      await showErrorDialog(message, t('common.error'));
      return;
    }

    let resultNodeId = linkedResultNode?.id ?? null;
    if (!resultNodeId) {
      const resultNodePosition = findNodePosition(
        id,
        MJ_RESULT_NODE_DEFAULT_WIDTH,
        MJ_RESULT_NODE_DEFAULT_HEIGHT
      );
      resultNodeId = addNode(
        CANVAS_NODE_TYPES.mjResult,
        resultNodePosition,
        createRootMjResultNodeData(id, t('node.midjourney.resultNodeTitle')),
        { inheritParentFromNodeId: id }
      );
      addEdge(id, resultNodeId);
      updateNodeData(
        id,
        {
          linkedResultNodeId: resultNodeId,
        },
        { historyMode: 'skip' }
      );
    }

    if (!resultNodeId) {
      return;
    }

    generateRequestInFlightRef.current = true;
    const startedAt = Date.now();
    const placeholderBatchId = `mj-batch-${uuidv4()}`;
    const placeholderBatch: MjResultBatch = {
      id: placeholderBatchId,
      taskId: '',
      providerId: mjProviderEnabled,
      action: null,
      status: 'SUBMITTED',
      progress: '',
      prompt,
      promptEn: null,
      finalPrompt: null,
      images: [],
      buttons: [],
      properties: null,
      state: null,
      submitTime: startedAt,
      startTime: null,
      finishTime: null,
      failReason: null,
      isPolling: false,
    };

    try {
      const initialResultNode = useCanvasStore
        .getState()
        .nodes.find((node) => node.id === resultNodeId);
      const initialResultData =
        isMjResultNode(initialResultNode)
          ? initialResultNode.data
          : createRootMjResultNodeData(id, t('node.midjourney.resultNodeTitle'));
      const seededResultData = appendMjResultBatch(initialResultData, placeholderBatch);

      updateNodeData(
        resultNodeId,
        {
          ...seededResultData,
          sourceNodeId: id,
        },
        { historyMode: 'skip' }
      );
      updateNodeData(id, {
        prompt: promptDraft,
        linkedResultNodeId: resultNodeId,
        isSubmitting: true,
        activeTaskId: null,
        lastError: null,
      }, { historyMode: 'skip' });

      const submission = await submitMidjourneyImagineTask({
        providerId: mjProviderEnabled,
        apiKey,
        prompt,
        references: syncedReferences,
        personalizationCodes: data.personalizationCodes ?? [],
        aspectRatio:
          (data.aspectRatio ?? MIDJOURNEY_ASPECT_RATIOS[0]) as MidjourneyAspectRatio,
        rawMode: data.rawMode ?? false,
        versionPreset:
          (data.versionPreset ??
            MIDJOURNEY_VERSION_PRESETS[0]) as MidjourneyVersionPreset,
        advancedParams: data.advancedParams ?? '',
      });

      const pendingBatch = createPendingMjBatch({
        id: `mj-batch-${uuidv4()}`,
        taskId: submission.taskId,
        providerId: mjProviderEnabled,
        prompt: submission.prompt,
        finalPrompt: submission.finalPrompt,
        action: null,
        submitTime: startedAt,
      });

      const latestResultNode = useCanvasStore
        .getState()
        .nodes.find((node) => node.id === resultNodeId);
      const currentResultData =
        isMjResultNode(latestResultNode)
          ? latestResultNode.data
          : createRootMjResultNodeData(id, t('node.midjourney.resultNodeTitle'));
      const nextResultData = updateMjResultBatch(
        currentResultData,
        placeholderBatchId,
        (batch) => ({
          ...batch,
          ...pendingBatch,
          id: batch.id,
        })
      );

      updateNodeData(
        resultNodeId,
        {
          ...nextResultData,
          sourceNodeId: id,
        },
        { historyMode: 'skip' }
      );
      updateNodeData(
        id,
        {
          prompt: promptDraft,
          linkedResultNodeId: resultNodeId,
          isSubmitting: false,
          activeTaskId: null,
          lastSubmittedAt: startedAt,
          lastError: null,
        },
        { historyMode: 'skip' }
      );
      await flushCurrentProjectToDiskSafely('saving MJ imagine submission');
    } catch (error) {
      const content = resolveErrorContent(
        error,
        t('node.midjourney.generateFailed')
      );
      updateNodeData(
        id,
        {
          isSubmitting: false,
          activeTaskId: null,
          lastError: content.message,
        },
        { historyMode: 'skip' }
      );
      if (resultNodeId) {
        const latestResultNode = useCanvasStore
          .getState()
          .nodes.find((node) => node.id === resultNodeId);
        const currentResultData =
          isMjResultNode(latestResultNode)
            ? latestResultNode.data
            : createRootMjResultNodeData(id, t('node.midjourney.resultNodeTitle'));
        const failedResultData = updateMjResultBatch(
          currentResultData,
          placeholderBatchId,
          (batch) => ({
            ...batch,
            status: 'FAILURE',
            progress: '',
            failReason: content.message,
            isPolling: false,
            finishTime: Date.now(),
          })
        );
        updateNodeData(
          resultNodeId,
          {
            ...failedResultData,
            lastError: content.message,
          },
          { historyMode: 'skip' }
        );
      }
      await showErrorDialog(content.message, t('common.error'), content.details);
    } finally {
      generateRequestInFlightRef.current = false;
    }
  }, [
    addEdge,
    addNode,
    apiKey,
    data.advancedParams,
    data.aspectRatio,
    data.personalizationCodes,
    data.rawMode,
    data.versionPreset,
    findNodePosition,
    id,
    isPromptBusy,
    linkedResultNode,
    mjProviderEnabled,
    promptDraft,
    providerLabel,
    syncedReferences,
    t,
    updateNodeData,
  ]);

  return (
    <div
      ref={containerRef}
      className={`
        group relative flex flex-col overflow-visible rounded-[var(--node-radius)] border bg-surface-dark/90 p-2 transition-colors duration-150
        ${
          selected
            ? 'border-accent shadow-[0_0_0_1px_rgba(59,130,246,0.32)]'
            : 'border-[rgba(15,23,42,0.22)] hover:border-[rgba(15,23,42,0.34)] dark:border-[rgba(255,255,255,0.22)] dark:hover:border-[rgba(255,255,255,0.34)]'
        }
      `}
      style={{
        width: `${resolvedWidth}px`,
        minHeight: `${MJ_NODE_MIN_HEIGHT}px`,
        ...(resolvedHeight ? { height: `${resolvedHeight}px` } : {}),
      }}
      onClick={() => setSelectedNode(id)}
    >
      <NodeHeader
        className={NODE_HEADER_FLOATING_POSITION_CLASS}
        icon={<Sparkles className="h-3.5 w-3.5" />}
        titleText={resolvedTitle}
        editable
        onTitleChange={(nextTitle) => updateNodeData(id, { displayName: nextTitle })}
      />

      <div className="flex min-h-0 flex-1 flex-col">
        <div
          className="relative min-h-0 rounded-lg border border-[rgba(255,255,255,0.1)] bg-bg-dark/45 p-2"
          onClick={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <textarea
            value={promptDraft}
            onChange={(event) => {
              const nextValue = event.target.value;
              promptDraftRef.current = nextValue;
              setPromptDraft(nextValue);
              if (promptRewriteError) {
                setPromptRewriteError(null);
              }
            }}
            onBlur={commitPromptDraft}
            placeholder={t('node.midjourney.promptPlaceholder')}
            className="ui-scrollbar nodrag nowheel relative block min-h-[132px] w-full resize-none overflow-y-auto overflow-x-hidden border-none bg-transparent px-1 py-0.5 text-sm leading-6 text-text-dark caret-text-dark outline-none placeholder:text-text-muted/80 whitespace-pre-wrap break-words focus:border-transparent focus-visible:ring-0"
            style={{ scrollbarGutter: 'stable' }}
          />
        </div>

        <div
          className="mt-2 rounded-[var(--node-radius)] border border-[rgba(255,255,255,0.06)] bg-bg-dark/60 p-2"
          onClick={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <div className="mb-2 flex items-center justify-between">
            <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-text-muted">
              {t('node.midjourney.referencesTitle')}
            </div>
            <div className="text-[11px] text-text-muted">
              {syncedReferences.length > 0
                ? t('node.midjourney.referencesCount', {
                    count: syncedReferences.length,
                  })
                : t('node.midjourney.referencesEmpty')}
            </div>
          </div>

          {syncedReferences.length > 0 ? (
            <div className="flex gap-2 overflow-x-auto pb-1">
              {syncedReferences.map((reference) => {
                const displayUrl = resolveImageDisplayUrl(reference.imageUrl);
                const isStyleReference = reference.role === 'styleReference';

                return (
                  <div
                    key={reference.imageUrl}
                    className="w-[108px] shrink-0 rounded-xl border border-[rgba(255,255,255,0.06)] bg-white/[0.03] p-1.5"
                  >
                    <div className="overflow-hidden rounded-lg bg-black/40">
                      <CanvasNodeImage
                        src={displayUrl}
                        alt={t('node.midjourney.referenceAlt')}
                        viewerSourceUrl={displayUrl}
                        viewerImageList={[displayUrl]}
                        className="h-[72px] w-full object-cover"
                        draggable={false}
                      />
                    </div>
                    <div className="mt-1.5 flex items-center justify-between gap-1">
                      <span className="truncate text-[10px] text-text-muted">
                        {reference.sortIndex + 1}
                      </span>
                      <button
                        type="button"
                        className={`rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors ${
                          isStyleReference
                            ? 'bg-amber-500/16 text-amber-200'
                            : 'bg-sky-500/14 text-sky-200'
                        }`}
                        onClick={(
                          event: ReactMouseEvent<HTMLButtonElement>
                        ) => {
                          event.stopPropagation();
                          handleToggleReferenceRole(reference.imageUrl);
                        }}
                      >
                        {isStyleReference
                          ? t('node.midjourney.referenceRoleStyle')
                          : t('node.midjourney.referenceRoleReference')}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-[rgba(255,255,255,0.06)] bg-white/[0.02] px-3 py-4 text-sm text-text-muted">
              {t('node.midjourney.referencesHint')}
            </div>
          )}
        </div>

        <div
          className="mt-2 flex items-center gap-2"
          onClick={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <FixedControlChip
            label={t('node.midjourney.aspectRatio')}
            value={
              (data.aspectRatio ?? MIDJOURNEY_ASPECT_RATIOS[0]) as MidjourneyAspectRatio
            }
            options={aspectRatioOptions}
            onChange={(nextValue) => updateNodeData(id, { aspectRatio: nextValue })}
          />

          <UiChipButton
            type="button"
            active={Boolean(data.rawMode)}
            className={NODE_CONTROL_CHIP_CLASS}
            onClick={() => updateNodeData(id, { rawMode: !(data.rawMode ?? false) })}
          >
            {t('node.midjourney.raw')}
          </UiChipButton>

          <FixedControlChip
            label={t('node.midjourney.version')}
            value={
              (data.versionPreset ??
                MIDJOURNEY_VERSION_PRESETS[0]) as MidjourneyVersionPreset
            }
            options={versionOptions}
            onChange={(nextValue) => updateNodeData(id, { versionPreset: nextValue })}
          />

          <UiChipButton
            type="button"
            active={isStyleCodeDialogOpen || personalizationCodeCount > 0}
            className={`${NODE_CONTROL_CHIP_CLASS} shrink-0 gap-1 px-2`}
            aria-label={t('node.midjourney.personalization.button')}
            title={t('node.midjourney.personalization.button')}
            onClick={(event) => {
              event.stopPropagation();
              setIsStyleCodeDialogOpen(true);
            }}
          >
            <span className="text-[11px] font-semibold uppercase">P</span>
            {personalizationCodeCount > 0 ? (
              <span className="rounded-full bg-white/10 px-1.5 py-0.5 text-[10px] leading-none text-text-dark">
                {personalizationCodeCount}
              </span>
            ) : null}
          </UiChipButton>

          <UiChipButton
            type="button"
            active={isOptimizingPrompt}
            disabled={isPromptBusy || !canRewritePrompt}
            className={`${NODE_CONTROL_CHIP_CLASS} shrink-0 !w-8 !px-0 justify-center`}
            aria-label={
              isOptimizingPrompt
                ? t('node.midjourney.optimizingPrompt')
                : t('node.midjourney.optimizePrompt')
            }
            title={
              isOptimizingPrompt
                ? t('node.midjourney.optimizingPrompt')
                : t('node.midjourney.optimizePrompt')
            }
            onClick={() => void handleOptimizePrompt()}
          >
            <Wand2
              className="h-4 w-4 origin-center scale-[1.18]"
              strokeWidth={2.45}
            />
          </UiChipButton>

          <UiChipButton
            type="button"
            active={isTranslatingPrompt}
            disabled={isPromptBusy || !canRewritePrompt}
            className={`${NODE_CONTROL_CHIP_CLASS} shrink-0 !w-8 !px-0 justify-center`}
            aria-label={
              isTranslatingPrompt
                ? t('node.midjourney.translatingPrompt')
                : t('node.midjourney.translatePrompt')
            }
            title={
              isTranslatingPrompt
                ? t('node.midjourney.translatingPrompt')
                : t('node.midjourney.translatePrompt')
            }
            onClick={() => void handleTranslatePrompt()}
          >
            <Languages
              className="h-4 w-4 origin-center scale-[1.1]"
              strokeWidth={2.25}
            />
          </UiChipButton>

          <UiChipButton
            type="button"
            disabled={isPromptBusy || !canUndoPromptRewrite}
            className={`${NODE_CONTROL_CHIP_CLASS} shrink-0 !w-8 !px-0 justify-center`}
            aria-label={t('node.midjourney.undoPromptRewrite')}
            title={t('node.midjourney.undoPromptRewrite')}
            onClick={handleUndoPromptRewrite}
          >
            <Undo2
              className="h-4 w-4 origin-center scale-[1.08]"
              strokeWidth={2.3}
            />
          </UiChipButton>

          <div ref={advancedParamsTriggerRef} className="relative flex shrink-0">
            <UiChipButton
              type="button"
              title={t('node.midjourney.advancedParamsButton')}
              aria-label={t('node.midjourney.advancedParamsButton')}
              className={`${NODE_CONTROL_CHIP_CLASS} shrink-0 !w-8 !px-0 justify-center ${
                isAdvancedParamsOpen
                  ? '!bg-white/[0.06] !text-text-dark hover:!bg-white/[0.08]'
                  : '!text-text-dark hover:!bg-white/[0.06]'
              }`}
              onClick={(event) => {
                event.stopPropagation();
                setAdvancedParamsDraft(parseMidjourneyAdvancedParams(data.advancedParams ?? ''));
                setIsAdvancedParamsOpen((current) => !current);
              }}
            >
              <SlidersHorizontal
                className="h-4 w-4 origin-center scale-[1.04]"
                strokeWidth={2.25}
              />
            </UiChipButton>

            {isAdvancedParamsOpen ? (
              <div
                ref={advancedParamsPanelRef}
                className="absolute right-0 top-[calc(100%+10px)] z-20 w-[372px]"
                onClick={(event) => event.stopPropagation()}
                onPointerDown={(event) => event.stopPropagation()}
              >
                <UiPanel className="overflow-hidden rounded-[22px] border border-border-dark/95 bg-[linear-gradient(180deg,rgba(30,33,40,0.98),rgba(20,22,28,0.98))] p-0 shadow-[0_24px_56px_rgba(0,0,0,0.46)] backdrop-blur-xl">
                  <div className="relative border-b border-border-dark/95 px-5 py-4 text-center">
                    <div className="text-[18px] font-semibold tracking-[-0.01em] text-text-dark">
                      {t('node.midjourney.advancedParamsTitle')}
                    </div>
                    <button
                      type="button"
                      className="absolute right-5 top-1/2 -translate-y-1/2 rounded-md px-2 py-1 text-[12px] font-medium text-text-muted transition-colors hover:bg-white/[0.04] hover:text-text-dark"
                      onClick={() =>
                        setAdvancedParamsDraft({
                          stylize: MIDJOURNEY_ADVANCED_PARAM_RANGES.stylize.min,
                          chaos: MIDJOURNEY_ADVANCED_PARAM_RANGES.chaos.min,
                          weird: MIDJOURNEY_ADVANCED_PARAM_RANGES.weird.min,
                          preservedSeed: null,
                          passthroughTokens: [],
                        })
                      }
                    >
                      {t('node.midjourney.advancedParamsReset')}
                    </button>
                  </div>

                  <AdvancedParamSlider
                    label={t('node.midjourney.advancedParamStylize')}
                    value={advancedParamsDraft.stylize}
                    min={MIDJOURNEY_ADVANCED_PARAM_RANGES.stylize.min}
                    max={MIDJOURNEY_ADVANCED_PARAM_RANGES.stylize.max}
                    step={MIDJOURNEY_ADVANCED_PARAM_RANGES.stylize.step}
                    onChange={(nextValue) =>
                      setAdvancedParamsDraft((current) => ({
                        ...current,
                        stylize: nextValue,
                      }))
                    }
                  />

                  <AdvancedParamSlider
                    label={t('node.midjourney.advancedParamWeird')}
                    value={advancedParamsDraft.weird}
                    min={MIDJOURNEY_ADVANCED_PARAM_RANGES.weird.min}
                    max={MIDJOURNEY_ADVANCED_PARAM_RANGES.weird.max}
                    step={MIDJOURNEY_ADVANCED_PARAM_RANGES.weird.step}
                    onChange={(nextValue) =>
                      setAdvancedParamsDraft((current) => ({
                        ...current,
                        weird: nextValue,
                      }))
                    }
                  />

                  <AdvancedParamSlider
                    label={t('node.midjourney.advancedParamChaos')}
                    value={advancedParamsDraft.chaos}
                    min={MIDJOURNEY_ADVANCED_PARAM_RANGES.chaos.min}
                    max={MIDJOURNEY_ADVANCED_PARAM_RANGES.chaos.max}
                    step={MIDJOURNEY_ADVANCED_PARAM_RANGES.chaos.step}
                    onChange={(nextValue) =>
                      setAdvancedParamsDraft((current) => ({
                        ...current,
                        chaos: nextValue,
                      }))
                    }
                  />

                  <div className="border-t border-border-dark/95 px-5 py-4">
                    <div className="text-[11px] leading-6 text-text-muted/85">
                      {t('node.midjourney.advancedParamsHint')}
                    </div>
                  </div>

                  <div className="flex items-center justify-end gap-2 border-t border-border-dark/95 bg-black/10 px-5 py-4">
                    <UiButton
                      type="button"
                      size="sm"
                      variant="muted"
                      onClick={() => {
                        setAdvancedParamsDraft(parseMidjourneyAdvancedParams(data.advancedParams ?? ''));
                        setIsAdvancedParamsOpen(false);
                      }}
                    >
                      {t('common.cancel')}
                    </UiButton>
                    <UiButton
                      type="button"
                      size="sm"
                      variant="primary"
                      onClick={() => void handleApplyAdvancedParams()}
                    >
                      {t('common.confirm')}
                    </UiButton>
                  </div>
                </UiPanel>
              </div>
            ) : null}
          </div>

          <UiButton
            type="button"
            size="sm"
            variant="primary"
            disabled={isPromptBusy}
            className={`${NODE_CONTROL_PRIMARY_BUTTON_CLASS} ml-auto shrink-0`}
            onClick={() => void handleGenerate()}
          >
            {isSubmitting ? (
              <Loader2 className={`${NODE_CONTROL_GENERATE_ICON_CLASS} animate-spin`} />
            ) : (
              <Sparkles className={NODE_CONTROL_GENERATE_ICON_CLASS} />
            )}
            {t('canvas.generate')}
          </UiButton>
        </div>

        <div className="mt-2 min-h-[20px] text-[11px] text-text-muted">
          {promptRewriteError ? (
            <span className="text-rose-300">{promptRewriteError}</span>
          ) : data.lastError ? (
            <span className="text-rose-300">{data.lastError}</span>
          ) : isOptimizingPrompt ? (
            <span>{t('node.midjourney.optimizingPrompt')}</span>
          ) : isTranslatingPrompt ? (
            <span>{t('node.midjourney.translatingPrompt')}</span>
          ) : isSubmitting ? (
            <span>{t('node.midjourney.statusSubmitting')}</span>
          ) : pendingBatchCount > 0 ? (
            <span>{t('node.midjourney.statusPollingBatches', { count: pendingBatchCount })}</span>
          ) : !apiKey ? (
            <span>{t('node.midjourney.apiKeyHint')}</span>
          ) : (
            <span>{t('node.midjourney.statusIdle')}</span>
          )}
        </div>
      </div>

      <Handle type="target" position={Position.Left} id="target" />
      <Handle type="source" position={Position.Right} id="source" />
      <NodeResizeHandle minWidth={MJ_NODE_MIN_WIDTH} minHeight={MJ_NODE_MIN_HEIGHT} />
      <MjStyleCodeDialog
        isOpen={isStyleCodeDialogOpen}
        selectedCodes={data.personalizationCodes ?? []}
        onClose={() => setIsStyleCodeDialogOpen(false)}
        onConfirm={(codes) => {
          updateNodeData(id, { personalizationCodes: codes });
          setIsStyleCodeDialogOpen(false);
        }}
      />
    </div>
  );
});

MjNode.displayName = 'MjNode';
