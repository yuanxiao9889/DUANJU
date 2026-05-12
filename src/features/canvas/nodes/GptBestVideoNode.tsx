import { memo, useCallback, useMemo, useRef, useState } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Loader2, Sparkles, TriangleAlert, Undo2, Video, Wand2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { UiButton, UiChipButton, UiSelect } from '@/components/ui';
import { resolveErrorContent, showErrorDialog } from '@/features/canvas/application/errorDialog';
import { flushCurrentProjectToDiskSafely } from '@/features/canvas/application/projectPersistence';
import { optimizeCanvasPrompt } from '@/features/canvas/application/promptOptimization';
import { resolveReadableReferenceImageSources } from '@/features/canvas/application/referenceImageSources';
import {
  CANVAS_NODE_TYPES,
  GPT_BEST_VIDEO_NODE_DEFAULT_HEIGHT,
  GPT_BEST_VIDEO_NODE_DEFAULT_WIDTH,
  GPT_BEST_VIDEO_NODE_MIN_HEIGHT,
  GPT_BEST_VIDEO_NODE_MIN_WIDTH,
  GPT_BEST_VIDEO_RESULT_NODE_DEFAULT_HEIGHT,
  GPT_BEST_VIDEO_RESULT_NODE_DEFAULT_WIDTH,
  GPT_BEST_GROK_VIDEO_MODEL_IDS,
  GPT_BEST_SEEDANCE_MODEL_IDS,
  GPT_BEST_VIDEO_ASPECT_RATIOS,
  GPT_BEST_VIDEO_DURATION_SECONDS,
  GPT_BEST_VIDEO_RESOLUTIONS,
  type GptBestSeedanceInputMode,
  type GptBestVideoNodeData,
  type GptBestVideoSourceKind,
} from '@/features/canvas/domain/canvasNodes';
import { resolveNodeDisplayName } from '@/features/canvas/domain/nodeDisplay';
import { useIsOverviewCanvasRender } from '@/features/canvas/CanvasPerformanceContext';
import { useCanvasConnectedReferenceImages, useCanvasNodeById } from '@/features/canvas/hooks/useCanvasNodeGraph';
import { CanvasNodeImage } from '@/features/canvas/ui/CanvasNodeImage';
import { CameraTriggerIcon } from '@/features/canvas/ui/CameraTriggerIcon';
import { NodeHeader, NODE_HEADER_FLOATING_POSITION_CLASS } from '@/features/canvas/ui/NodeHeader';
import { NodeResizeHandle } from '@/features/canvas/ui/NodeResizeHandle';
import { NodeStatusBadge } from '@/features/canvas/ui/NodeStatusBadge';
import { ShotParamsPanel } from '@/features/canvas/ui/ShotParamsPanel';
import {
  NODE_CONTROL_CHIP_CLASS,
  NODE_CONTROL_PRIMARY_BUTTON_CLASS,
} from '@/features/canvas/ui/nodeControlStyles';
import {
  normalizeGptBestSeedanceInputMode,
  normalizeGptBestVideoAspectRatio,
  normalizeGptBestVideoDurationSeconds,
  normalizeGptBestVideoModel,
  normalizeGptBestVideoResolution,
  submitGptBestVideoTask,
} from '@/features/gpt-best-video/application/gptBestVideoSubmission';
import { StyleTemplatePicker } from '@/features/project/StyleTemplatePicker';
import { appendStyleTemplatePrompt } from '@/features/project/styleTemplatePrompt';
import { openSettingsDialog } from '@/features/settings/settingsEvents';
import { useCanvasStore } from '@/stores/canvasStore';
import { useSettingsStore } from '@/stores/settingsStore';

type GptBestVideoNodeProps = NodeProps & {
  id: string;
  data: GptBestVideoNodeData;
  selected?: boolean;
};

interface GptBestOption<T extends string | number> {
  value: T;
  labelKey: string;
}

interface PromptOptimizationUndoState {
  previousPrompt: string;
  appliedPrompt: string;
}

const SEEDANCE_INPUT_MODE_OPTIONS: GptBestOption<GptBestSeedanceInputMode>[] = [
  { value: 'textToVideo', labelKey: 'node.gptBestVideo.inputModes.textToVideo' },
  { value: 'firstFrame', labelKey: 'node.gptBestVideo.inputModes.firstFrame' },
  { value: 'firstLastFrame', labelKey: 'node.gptBestVideo.inputModes.firstLastFrame' },
];

function FixedControlChip<T extends string | number>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: GptBestOption<T>[];
  onChange: (value: T) => void;
}) {
  const { t } = useTranslation();
  const chipRef = useRef<HTMLDivElement>(null);

  return (
    <div
      ref={chipRef}
      className="flex h-7 min-w-[96px] shrink-0 items-center gap-1 rounded-lg border border-[color:var(--ui-border-soft)] bg-[var(--ui-surface-field)] px-2"
      onMouseDown={(event) => event.stopPropagation()}
    >
      <span className="shrink-0 text-[10px] text-text-muted/90" title={label}>
        {label}
      </span>
      <div className="min-w-0 flex-1">
        <UiSelect
          value={value}
          aria-label={label}
          menuAnchorRef={chipRef}
          className="nodrag !h-6 !w-full !rounded-md !border-0 !bg-transparent !px-0.5 !text-[10.5px] !font-medium hover:!border-0 focus-visible:!border-0 focus-visible:!shadow-none"
          onChange={(event) =>
            onChange(
              typeof value === 'number'
                ? (Number(event.target.value) as T)
                : (event.target.value as T)
            )
          }
        >
          {options.map((option) => (
            <option key={String(option.value)} value={option.value}>
              {t(option.labelKey)}
            </option>
          ))}
        </UiSelect>
      </div>
    </div>
  );
}

function buildSourceKindForType(type: string | undefined, data: GptBestVideoNodeData): GptBestVideoSourceKind {
  if (data.sourceKind === 'grok' || type === CANVAS_NODE_TYPES.gptBestGrokVideo) {
    return 'grok';
  }
  return 'seedance';
}

function buildModelOptions(sourceKind: GptBestVideoSourceKind): GptBestOption<string>[] {
  const modelIds = sourceKind === 'grok'
    ? GPT_BEST_GROK_VIDEO_MODEL_IDS
    : GPT_BEST_SEEDANCE_MODEL_IDS;
  return modelIds.map((modelId) => ({
    value: modelId,
    labelKey: `node.gptBestVideo.modelOptions.${modelId}`,
  }));
}

export const GptBestVideoNode = memo(
  ({ id, data, selected, width, type }: GptBestVideoNodeProps) => {
    const { t, i18n } = useTranslation();
    const isOverviewRender = useIsOverviewCanvasRender();
    const currentNode = useCanvasNodeById(id);
    const connectedImages = useCanvasConnectedReferenceImages(id);
    const thirdPartyVideoApiKeys = useSettingsStore((state) => state.thirdPartyVideoApiKeys);
    const thirdPartyVideoProviderConfig = useSettingsStore((state) => state.thirdPartyVideoProviderConfig);
    const addNode = useCanvasStore((state) => state.addNode);
    const addEdge = useCanvasStore((state) => state.addEdge);
    const findNodePosition = useCanvasStore((state) => state.findNodePosition);
    const setSelectedNode = useCanvasStore((state) => state.setSelectedNode);
    const updateNodeData = useCanvasStore((state) => state.updateNodeData);
    const isShotParamsPanelOpen = useCanvasStore(
      (state) => state.activeShotParamsPanelNodeId === id
    );
    const toggleShotParamsPanel = useCanvasStore((state) => state.toggleShotParamsPanel);
    const closeShotParamsPanel = useCanvasStore((state) => state.closeShotParamsPanel);
    const promptRef = useRef<HTMLTextAreaElement>(null);
    const [isOptimizingPrompt, setIsOptimizingPrompt] = useState(false);
    const [promptOptimizationError, setPromptOptimizationError] = useState<string | null>(null);
    const [lastPromptOptimizationUndoState, setLastPromptOptimizationUndoState] =
      useState<PromptOptimizationUndoState | null>(null);

    const sourceKind = buildSourceKindForType(type, data);
    const apiKey = thirdPartyVideoApiKeys.gptBest?.trim() ?? '';
    const baseUrl = thirdPartyVideoProviderConfig.gptBest.baseUrl.trim();
    const selectedInputMode = normalizeGptBestSeedanceInputMode(data.inputMode);
    const selectedAspectRatio = normalizeGptBestVideoAspectRatio(data.aspectRatio);
    const selectedDuration = normalizeGptBestVideoDurationSeconds(data.durationSeconds);
    const selectedResolution = normalizeGptBestVideoResolution(data.resolution);
    const selectedModelId = normalizeGptBestVideoModel(sourceKind, data.modelId);
    const modelOptions = useMemo(() => buildModelOptions(sourceKind), [sourceKind]);
    const resolvedTitle = useMemo(
      () => resolveNodeDisplayName(
        sourceKind === 'grok' ? CANVAS_NODE_TYPES.gptBestGrokVideo : CANVAS_NODE_TYPES.gptBestSeedance,
        data
      ),
      [data, sourceKind]
    );
    const resolvedWidth = Math.max(
      GPT_BEST_VIDEO_NODE_MIN_WIDTH,
      Math.round(width ?? GPT_BEST_VIDEO_NODE_DEFAULT_WIDTH)
    );
    const explicitHeight =
      typeof currentNode?.height === 'number' && Number.isFinite(currentNode.height)
        ? currentNode.height
        : typeof currentNode?.style?.height === 'number' && Number.isFinite(currentNode.style.height)
          ? currentNode.style.height
          : null;
    const resolvedHeight = Math.max(
      GPT_BEST_VIDEO_NODE_MIN_HEIGHT,
      Math.round(explicitHeight ?? GPT_BEST_VIDEO_NODE_DEFAULT_HEIGHT)
    );
    const lastSubmittedTime = useMemo(() => {
      if (!data.lastSubmittedAt) {
        return null;
      }
      return new Intl.DateTimeFormat(i18n.language, {
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date(data.lastSubmittedAt));
    }, [data.lastSubmittedAt, i18n.language]);

    const updateCurrentNodeData = useCallback(
      (patch: Partial<GptBestVideoNodeData>) => updateNodeData(id, patch),
      [id, updateNodeData]
    );

    const handlePromptChange = useCallback(
      (prompt: string) => {
        updateCurrentNodeData({ prompt, lastError: null });
        setPromptOptimizationError(null);
      },
      [updateCurrentNodeData]
    );

    const applyPromptAndRestoreCursor = useCallback(
      (prompt: string, cursor: number) => {
        handlePromptChange(prompt);
        requestAnimationFrame(() => {
          const textarea = promptRef.current;
          if (!textarea) {
            return;
          }
          const nextCursor = Math.max(0, Math.min(cursor, prompt.length));
          textarea.focus();
          textarea.setSelectionRange(nextCursor, nextCursor);
        });
      },
      [handlePromptChange]
    );

    const insertPromptText = useCallback(
      (text: string) => {
        const textarea = promptRef.current;
        const sourcePrompt = data.prompt ?? '';
        const start = textarea?.selectionStart ?? sourcePrompt.length;
        const end = textarea?.selectionEnd ?? start;
        const prefix = sourcePrompt.slice(0, start);
        const suffix = sourcePrompt.slice(end);
        const separatorBefore = prefix.length > 0 && !/\s$/.test(prefix) ? ' ' : '';
        const separatorAfter = suffix.length > 0 && !/^\s/.test(suffix) ? ' ' : '';
        const nextPrompt = `${prefix}${separatorBefore}${text}${separatorAfter}${suffix}`;
        const nextCursor = prefix.length + separatorBefore.length + text.length;
        applyPromptAndRestoreCursor(nextPrompt, nextCursor);
        setLastPromptOptimizationUndoState(null);
      },
      [applyPromptAndRestoreCursor, data.prompt]
    );

    const handleOptimizePrompt = useCallback(async () => {
      const sourcePrompt = data.prompt ?? '';
      const currentPrompt = sourcePrompt.trim();
      if (!currentPrompt) {
        const message = t('node.gptBestVideo.promptRequired');
        setPromptOptimizationError(message);
        await showErrorDialog(message, t('common.error'));
        return;
      }

      setIsOptimizingPrompt(true);
      setPromptOptimizationError(null);
      updateCurrentNodeData({ lastError: null });

      try {
        const result = await optimizeCanvasPrompt({
          mode: 'video',
          prompt: currentPrompt,
          referenceImages: connectedImages
            .map((item) => item.previewImageUrl ?? item.imageUrl)
            .filter((item): item is string => Boolean(item)),
        });
        const nextPrompt = result.prompt;
        if (nextPrompt !== sourcePrompt) {
          setLastPromptOptimizationUndoState({
            previousPrompt: sourcePrompt,
            appliedPrompt: nextPrompt,
          });
        } else {
          setLastPromptOptimizationUndoState(null);
        }
        applyPromptAndRestoreCursor(nextPrompt, nextPrompt.length);
      } catch (error) {
        const message =
          error instanceof Error && error.message.trim().length > 0
            ? error.message
            : t('node.gptBestVideo.optimizePromptFailed');
        setPromptOptimizationError(message);
        await showErrorDialog(message, t('common.error'));
      } finally {
        setIsOptimizingPrompt(false);
      }
    }, [applyPromptAndRestoreCursor, connectedImages, data.prompt, t, updateCurrentNodeData]);

    const handleUndoOptimizedPrompt = useCallback(() => {
      if (!lastPromptOptimizationUndoState) {
        return;
      }
      if (data.prompt !== lastPromptOptimizationUndoState.appliedPrompt) {
        return;
      }
      setPromptOptimizationError(null);
      setLastPromptOptimizationUndoState(null);
      applyPromptAndRestoreCursor(
        lastPromptOptimizationUndoState.previousPrompt,
        lastPromptOptimizationUndoState.previousPrompt.length
      );
    }, [applyPromptAndRestoreCursor, data.prompt, lastPromptOptimizationUndoState]);

    const validateGenerationRequest = useCallback((): string | null => {
      if (!apiKey) {
        return t('node.gptBestVideo.apiKeyRequired');
      }
      if (!baseUrl) {
        return t('node.gptBestVideo.baseUrlRequired');
      }
      if (!data.prompt.trim()) {
        return t('node.gptBestVideo.promptRequired');
      }

      if (sourceKind === 'seedance') {
        if (selectedInputMode === 'textToVideo' && connectedImages.length > 0) {
          return t('node.gptBestVideo.textToVideoNoReferences');
        }
        if (selectedInputMode === 'firstFrame' && connectedImages.length !== 1) {
          return t('node.gptBestVideo.firstFrameRequiresOneImage');
        }
        if (selectedInputMode === 'firstLastFrame' && connectedImages.length !== 2) {
          return t('node.gptBestVideo.firstLastFrameRequiresTwoImages');
        }
      }

      if (sourceKind === 'grok' && connectedImages.length > 7) {
        return t('node.gptBestVideo.grokImageLimit', { count: 7 });
      }

      return null;
    }, [apiKey, baseUrl, connectedImages.length, data.prompt, selectedInputMode, sourceKind, t]);

    const handleGenerate = useCallback(async () => {
      closeShotParamsPanel();
      const validationError = validateGenerationRequest();
      if (validationError) {
        updateCurrentNodeData({ isSubmitting: false, lastError: validationError });
        if (!apiKey || !baseUrl) {
          openSettingsDialog({
            category: 'providers',
            providerTab: 'thirdPartyVideo',
            providerId: 'gptBest',
          });
        }
        await showErrorDialog(validationError, t('common.error'));
        return;
      }

      const startedAt = Date.now();
      let createdResultNodeId: string | null = null;
      updateCurrentNodeData({ isSubmitting: true, lastError: null });

      try {
        const readableReferenceImageSources = await resolveReadableReferenceImageSources(
          connectedImages
        );
        const resultNodePosition = findNodePosition(
          id,
          GPT_BEST_VIDEO_RESULT_NODE_DEFAULT_WIDTH,
          GPT_BEST_VIDEO_RESULT_NODE_DEFAULT_HEIGHT
        );
        createdResultNodeId = addNode(
          CANVAS_NODE_TYPES.gptBestVideoResult,
          resultNodePosition,
          {
            sourceNodeId: id,
            provider: 'gptBest',
            sourceKind,
            displayName: t('node.gptBestVideo.resultNodeTitle'),
            taskId: null,
            taskStatus: null,
            taskUpdatedAt: null,
            modelId: selectedModelId,
            videoUrl: null,
            previewImageUrl: null,
            videoFileName: null,
            aspectRatio: selectedAspectRatio,
            resolution: selectedResolution,
            duration: selectedDuration,
            requestSnapshot: {
              provider: 'gptBest',
              sourceKind,
              modelId: selectedModelId,
              prompt: data.prompt.trim(),
              imageCount: readableReferenceImageSources.length,
              aspectRatio: selectedAspectRatio,
              durationSeconds: selectedDuration,
              resolution: selectedResolution,
              submittedAt: startedAt,
            },
            isGenerating: true,
            generationStartedAt: startedAt,
            generationDurationMs: 180000,
            lastGeneratedAt: null,
            lastError: null,
          },
          { inheritParentFromNodeId: id }
        );
        addEdge(id, createdResultNodeId);
        await flushCurrentProjectToDiskSafely('creating third-party video result node');

        const submitResponse = await submitGptBestVideoTask({
          apiKey,
          baseUrl,
          sourceKind,
          prompt: data.prompt,
          modelId: selectedModelId,
          inputMode: selectedInputMode,
          aspectRatio: selectedAspectRatio,
          durationSeconds: selectedDuration,
          resolution: selectedResolution,
          referenceImageSources: readableReferenceImageSources,
        });

        updateNodeData(createdResultNodeId, {
          taskId: submitResponse.taskId,
          taskStatus: submitResponse.status,
          taskUpdatedAt: Date.now(),
          isGenerating: true,
          lastError: null,
        });
        updateCurrentNodeData({
          isSubmitting: false,
          lastSubmittedAt: startedAt,
          lastError: null,
        });
        await flushCurrentProjectToDiskSafely('saving third-party video task id');
      } catch (error) {
        const content = resolveErrorContent(error, t('node.gptBestVideo.submitFailed'));
        updateCurrentNodeData({
          isSubmitting: false,
          lastError: content.message,
        });
        if (createdResultNodeId) {
          updateNodeData(createdResultNodeId, {
            isGenerating: false,
            generationStartedAt: null,
            taskStatus: 'failed',
            lastError: content.message,
          });
        }
        await flushCurrentProjectToDiskSafely('saving third-party video submit error');
        await showErrorDialog(content.message, t('common.error'), content.details);
      }
    }, [
      addEdge,
      addNode,
      apiKey,
      baseUrl,
      closeShotParamsPanel,
      connectedImages,
      data.prompt,
      findNodePosition,
      id,
      selectedAspectRatio,
      selectedDuration,
      selectedInputMode,
      selectedModelId,
      selectedResolution,
      sourceKind,
      t,
      updateCurrentNodeData,
      updateNodeData,
      validateGenerationRequest,
    ]);

    const combinedError = promptOptimizationError ?? data.lastError ?? null;
    const canUndoPromptOptimization = Boolean(
      lastPromptOptimizationUndoState &&
      data.prompt === lastPromptOptimizationUndoState.appliedPrompt
    );
    const statusInfoText =
      combinedError ??
      (data.isSubmitting
        ? t('node.gptBestVideo.submitting')
        : lastSubmittedTime
          ? t('node.gptBestVideo.lastSubmitted', { time: lastSubmittedTime })
          : sourceKind === 'grok'
            ? t('node.gptBestVideo.grokModeHint')
            : t(`node.gptBestVideo.modeHints.${selectedInputMode}`));
    const shotParamsButtonClassName = isShotParamsPanelOpen
      ? `${NODE_CONTROL_CHIP_CLASS} shrink-0 !w-8 !border-accent/55 !bg-accent/15 !px-0 justify-center text-accent shadow-[0_0_0_1px_rgba(59,130,246,0.18)]`
      : `${NODE_CONTROL_CHIP_CLASS} shrink-0 !w-8 !px-0 justify-center`;
    const headerStatus = data.isSubmitting || isOptimizingPrompt ? (
      <NodeStatusBadge
        icon={<Loader2 className="h-3 w-3" />}
        label={data.isSubmitting ? t('node.gptBestVideo.submitting') : t('node.gptBestVideo.optimizingPrompt')}
        tone="processing"
        animate
      />
    ) : combinedError ? (
      <NodeStatusBadge
        icon={<TriangleAlert className="h-3 w-3" />}
        label={t('nodeStatus.error')}
        tone="danger"
        title={combinedError}
      />
    ) : undefined;

    return (
      <div
        className={`group relative flex flex-col overflow-visible rounded-[var(--node-radius)] border bg-surface-dark/90 p-2 transition-colors duration-150 ${
          selected
            ? 'border-accent shadow-[0_0_0_1px_rgba(59,130,246,0.32)]'
            : 'border-[rgba(15,23,42,0.22)] hover:border-[rgba(15,23,42,0.34)] dark:border-[rgba(255,255,255,0.22)] dark:hover:border-[rgba(255,255,255,0.34)]'
        }`}
        style={{ width: `${resolvedWidth}px`, height: `${resolvedHeight}px` }}
        onClick={() => setSelectedNode(id)}
      >
        <NodeHeader
          className={NODE_HEADER_FLOATING_POSITION_CLASS}
          icon={sourceKind === 'grok' ? <Video className="h-3.5 w-3.5" /> : <Sparkles className="h-3.5 w-3.5" />}
          titleText={resolvedTitle}
          rightSlot={headerStatus}
          editable
          onTitleChange={(displayName) => updateCurrentNodeData({ displayName })}
        />

        <div className="flex min-h-0 flex-1 flex-col pt-5">
          {isOverviewRender ? (
            <div className="min-h-0 flex-1 overflow-hidden rounded-[var(--node-radius)] border border-white/10 bg-bg-dark/80 px-3 py-3 text-sm leading-6 text-text-muted">
              <div className="line-clamp-6 whitespace-pre-wrap">
                {data.prompt.trim() || (sourceKind === 'grok'
                  ? t('node.gptBestVideo.grokPromptPlaceholder')
                  : t('node.gptBestVideo.seedancePromptPlaceholder'))}
              </div>
            </div>
          ) : (
            <textarea
              ref={promptRef}
              value={data.prompt}
              onChange={(event) => handlePromptChange(event.target.value)}
              placeholder={sourceKind === 'grok'
                ? t('node.gptBestVideo.grokPromptPlaceholder')
                : t('node.gptBestVideo.seedancePromptPlaceholder')}
              className="min-h-0 flex-1 resize-none rounded-[var(--node-radius)] border border-white/10 bg-bg-dark/80 px-3 py-3 text-sm leading-6 text-text-dark outline-none transition-colors placeholder:text-text-muted focus:border-accent/50"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => event.stopPropagation()}
            />
          )}

          <div className="mt-3 rounded-[var(--node-radius)] border border-white/10 bg-bg-dark/50 p-2">
            <div className="mb-2 flex items-center justify-between gap-2 text-xs text-text-muted">
              <span>{t('node.gptBestVideo.referenceImages', { count: connectedImages.length })}</span>
              {lastSubmittedTime ? (
                <span>{t('node.gptBestVideo.lastSubmitted', { time: lastSubmittedTime })}</span>
              ) : null}
            </div>
            {connectedImages.length > 0 ? (
              <div className="flex gap-2 overflow-x-auto pb-1">
                {connectedImages.slice(0, sourceKind === 'grok' ? 7 : 2).map((item, index) => (
                  <div key={`${item.sourceEdgeId}-${item.imageUrl}`} className="relative h-16 w-20 shrink-0 overflow-hidden rounded-md border border-white/10 bg-black">
                    <CanvasNodeImage
                      src={item.previewImageUrl ?? item.imageUrl}
                      fallbackSrc={item.imageUrl}
                      alt={t('node.gptBestVideo.referenceImageAlt', { index: index + 1 })}
                      className="h-full w-full object-cover"
                      disableViewer
                    />
                    {sourceKind === 'grok' ? (
                      <div className="absolute left-1 top-1 rounded bg-black/65 px-1.5 py-0.5 text-[10px] text-white">
                        @img{index + 1}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-md border border-dashed border-white/10 px-3 py-4 text-center text-xs text-text-muted">
                {t('node.gptBestVideo.noReferences')}
              </div>
            )}
          </div>
        </div>

        {!isOverviewRender ? (
        <div className="mt-2 space-y-1.5">
          <div className="flex items-center gap-2">
            <div className="ui-scrollbar min-w-0 flex-1 overflow-x-auto overflow-y-hidden">
              <div className="flex w-max min-w-full items-center gap-1.5 pr-1">
                <FixedControlChip
                  label={t('node.gptBestVideo.modelLabel')}
                  value={selectedModelId}
                  options={modelOptions}
                  onChange={(value) => updateCurrentNodeData({ modelId: value, lastError: null })}
                />
                {sourceKind === 'seedance' ? (
                  <FixedControlChip
                    label={t('node.gptBestVideo.inputModeLabel')}
                    value={selectedInputMode}
                    options={SEEDANCE_INPUT_MODE_OPTIONS}
                    onChange={(value) => updateCurrentNodeData({ inputMode: value, lastError: null })}
                  />
                ) : null}
                <FixedControlChip
                  label={t('node.gptBestVideo.aspectRatioLabel')}
                  value={selectedAspectRatio}
                  options={GPT_BEST_VIDEO_ASPECT_RATIOS.map((value) => ({
                    value,
                    labelKey: `node.gptBestVideo.aspectRatios.${value}`,
                  }))}
                  onChange={(value) => updateCurrentNodeData({ aspectRatio: value })}
                />
                <FixedControlChip
                  label={t('node.gptBestVideo.durationLabel')}
                  value={selectedDuration}
                  options={GPT_BEST_VIDEO_DURATION_SECONDS.map((value) => ({
                    value,
                    labelKey: `node.gptBestVideo.durations.${value}`,
                  }))}
                  onChange={(value) => updateCurrentNodeData({ durationSeconds: value })}
                />
                <FixedControlChip
                  label={t('node.gptBestVideo.resolutionLabel')}
                  value={selectedResolution}
                  options={GPT_BEST_VIDEO_RESOLUTIONS.map((value) => ({
                    value,
                    labelKey: `node.gptBestVideo.resolutions.${value}`,
                  }))}
                  onChange={(value) => updateCurrentNodeData({ resolution: value })}
                />
                <StyleTemplatePicker
                  className={`${NODE_CONTROL_CHIP_CLASS} shrink-0 !w-8 !px-0 justify-center`}
                  onTemplateApply={(template) => {
                    const nextPrompt = appendStyleTemplatePrompt(data.prompt ?? '', template.prompt);
                    handlePromptChange(nextPrompt);
                    setLastPromptOptimizationUndoState(null);
                    requestAnimationFrame(() => {
                      promptRef.current?.focus();
                      promptRef.current?.setSelectionRange(nextPrompt.length, nextPrompt.length);
                    });
                  }}
                />
                <UiChipButton
                  type="button"
                  active={isShotParamsPanelOpen}
                  className={shotParamsButtonClassName}
                  aria-label={t('shotParams.trigger')}
                  title={t('shotParams.trigger')}
                  onClick={(event) => {
                    event.stopPropagation();
                    toggleShotParamsPanel(id);
                  }}
                >
                  <CameraTriggerIcon
                    active={isShotParamsPanelOpen}
                    variant="video"
                    className="h-4 w-4 origin-center scale-[1.18]"
                  />
                </UiChipButton>
                <UiChipButton
                  type="button"
                  active={isOptimizingPrompt}
                  disabled={isOptimizingPrompt || data.prompt.trim().length === 0}
                  className={`${NODE_CONTROL_CHIP_CLASS} shrink-0 !w-8 !px-0 justify-center`}
                  aria-label={
                    isOptimizingPrompt
                      ? t('node.gptBestVideo.optimizingPrompt')
                      : t('node.gptBestVideo.optimizePrompt')
                  }
                  title={
                    isOptimizingPrompt
                      ? t('node.gptBestVideo.optimizingPrompt')
                      : t('node.gptBestVideo.optimizePrompt')
                  }
                  onClick={(event) => {
                    event.stopPropagation();
                    void handleOptimizePrompt();
                  }}
                >
                  <Wand2 className="h-4 w-4 origin-center scale-[1.18]" strokeWidth={2.45} />
                </UiChipButton>
                <UiChipButton
                  type="button"
                  disabled={isOptimizingPrompt || !canUndoPromptOptimization}
                  className={`${NODE_CONTROL_CHIP_CLASS} shrink-0 !w-8 !px-0 justify-center`}
                  aria-label={t('node.gptBestVideo.undoOptimizedPrompt')}
                  title={t('node.gptBestVideo.undoOptimizedPrompt')}
                  onClick={(event) => {
                    event.stopPropagation();
                    handleUndoOptimizedPrompt();
                  }}
                >
                  <Undo2 className="h-4 w-4 origin-center scale-[1.08]" strokeWidth={2.3} />
                </UiChipButton>
              </div>
            </div>
          
          <UiButton
            type="button"
            size="sm"
            disabled={Boolean(data.isSubmitting || isOptimizingPrompt)}
            className={`${NODE_CONTROL_PRIMARY_BUTTON_CLASS} shrink-0`}
            onClick={(event) => {
              event.stopPropagation();
              void handleGenerate();
            }}
          >
            <Sparkles className="h-4 w-4" strokeWidth={2.3} />
            {data.isSubmitting ? t('node.gptBestVideo.submitting') : t('node.gptBestVideo.submit')}
          </UiButton>
          </div>

          <div
            className={`min-h-[16px] truncate text-[10px] leading-4 ${
              combinedError ? 'text-rose-300' : 'text-text-muted'
            }`}
            title={statusInfoText}
          >
            {statusInfoText}
          </div>
        </div>
        ) : null}

        {isShotParamsPanelOpen && !isOverviewRender ? (
          <ShotParamsPanel
            onClose={closeShotParamsPanel}
            onInsert={(option) => insertPromptText(option.value)}
          />
        ) : null}

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
        <NodeResizeHandle minWidth={GPT_BEST_VIDEO_NODE_MIN_WIDTH} minHeight={GPT_BEST_VIDEO_NODE_MIN_HEIGHT} />
      </div>
    );
  }
);

GptBestVideoNode.displayName = 'GptBestVideoNode';

export const GptBestSeedanceNode = GptBestVideoNode;
export const GptBestGrokVideoNode = GptBestVideoNode;
