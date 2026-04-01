import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Handle, Position, useUpdateNodeInternals, type NodeProps } from '@xyflow/react';
import { Loader2, Sparkles, TriangleAlert, Undo2, Wand2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { checkDreaminaCliStatus } from '@/commands/dreaminaCli';
import {
  CANVAS_NODE_TYPES,
  JIMENG_IMAGE_RESULT_NODE_DEFAULT_HEIGHT,
  JIMENG_IMAGE_RESULT_NODE_DEFAULT_WIDTH,
  type JimengImageNodeData,
  type JimengImageModelVersion,
  type JimengImageResolutionType,
} from '@/features/canvas/domain/canvasNodes';
import { resolveNodeDisplayName } from '@/features/canvas/domain/nodeDisplay';
import { graphImageResolver } from '@/features/canvas/application/canvasServices';
import { resolveErrorContent, showErrorDialog } from '@/features/canvas/application/errorDialog';
import { resolveImageDisplayUrl } from '@/features/canvas/application/imageData';
import { optimizeCanvasPrompt } from '@/features/canvas/application/promptOptimization';
import { NodeHeader, NODE_HEADER_FLOATING_POSITION_CLASS } from '@/features/canvas/ui/NodeHeader';
import { NodeResizeHandle } from '@/features/canvas/ui/NodeResizeHandle';
import { CanvasNodeImage } from '@/features/canvas/ui/CanvasNodeImage';
import { NodeStatusBadge } from '@/features/canvas/ui/NodeStatusBadge';
import {
  NODE_CONTROL_CHIP_CLASS,
  NODE_CONTROL_GENERATE_ICON_CLASS,
  NODE_CONTROL_PRIMARY_BUTTON_CLASS,
} from '@/features/canvas/ui/nodeControlStyles';
import { UiButton, UiChipButton, UiSelect } from '@/components/ui';
import { useCanvasStore } from '@/stores/canvasStore';
import { generateJimengImages } from '@/features/jimeng/application/jimengImageGeneration';
import {
  JIMENG_ASPECT_RATIO_OPTIONS,
  JIMENG_IMAGE_MODEL_OPTIONS,
  JIMENG_IMAGE_RESOLUTION_OPTIONS,
} from '@/features/jimeng/domain/jimengOptions';

type JimengImageNodeProps = NodeProps & {
  id: string;
  data: JimengImageNodeData;
  selected?: boolean;
};

interface PromptOptimizationMeta {
  modelLabel: string;
  referenceImageCount: number;
}

interface PromptOptimizationUndoState {
  previousPrompt: string;
  appliedPrompt: string;
}

interface FixedControlOption<T extends string> {
  value: T;
  label: string;
}

const JIMENG_IMAGE_NODE_DEFAULT_WIDTH = 640;
const JIMENG_IMAGE_NODE_DEFAULT_HEIGHT = 340;
const JIMENG_IMAGE_NODE_MIN_WIDTH = 620;
const JIMENG_IMAGE_NODE_MIN_HEIGHT = 300;
const JIMENG_IMAGE_NODE_MAX_WIDTH = 1400;
const JIMENG_IMAGE_NODE_MAX_HEIGHT = 1000;
const DEFAULT_IMAGE_MODEL: JimengImageModelVersion = '5.0';
const DEFAULT_IMAGE_RESOLUTION: JimengImageResolutionType = '2k';
const DEFAULT_IMAGE_ASPECT_RATIO = '1:1';

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

function buildJimengResultNodeTitle(prompt: string, fallbackTitle: string): string {
  const normalizedPrompt = prompt.trim();
  return normalizedPrompt || fallbackTitle;
}

function FixedControlChip<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: FixedControlOption<T>[];
  onChange: (nextValue: T) => void;
}) {
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
          onChange={(event) => onChange(event.target.value as T)}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </UiSelect>
      </div>
    </div>
  );
}

export const JimengImageNode = memo(({
  id,
  data,
  selected,
  width,
  height,
}: JimengImageNodeProps) => {
  const { t, i18n } = useTranslation();
  const updateNodeInternals = useUpdateNodeInternals();
  const [isOptimizingPrompt, setIsOptimizingPrompt] = useState(false);
  const [isCheckingCliStatus, setIsCheckingCliStatus] = useState(false);
  const [cliStatusMessage, setCliStatusMessage] = useState<string | null>(null);
  const [promptOptimizationError, setPromptOptimizationError] = useState<string | null>(null);
  const [lastPromptOptimizationMeta, setLastPromptOptimizationMeta] =
    useState<PromptOptimizationMeta | null>(null);
  const [lastPromptOptimizationUndoState, setLastPromptOptimizationUndoState] =
    useState<PromptOptimizationUndoState | null>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const promptValueRef = useRef(data.prompt ?? '');
  const nodes = useCanvasStore((state) => state.nodes);
  const edges = useCanvasStore((state) => state.edges);
  const setSelectedNode = useCanvasStore((state) => state.setSelectedNode);
  const updateNodeData = useCanvasStore((state) => state.updateNodeData);
  const addNode = useCanvasStore((state) => state.addNode);
  const addEdge = useCanvasStore((state) => state.addEdge);
  const findNodePosition = useCanvasStore((state) => state.findNodePosition);

  const incomingImages = useMemo(
    () => graphImageResolver.collectInputImages(id, nodes, edges),
    [edges, id, nodes]
  );
  const incomingImageDisplayList = useMemo(
    () => incomingImages.map((imageUrl) => resolveImageDisplayUrl(imageUrl)),
    [incomingImages]
  );
  const resolvedTitle = useMemo(
    () => resolveNodeDisplayName(CANVAS_NODE_TYPES.jimengImage, data),
    [data]
  );
  const resolvedWidth = Math.max(
    JIMENG_IMAGE_NODE_MIN_WIDTH,
    Math.round(width ?? JIMENG_IMAGE_NODE_DEFAULT_WIDTH)
  );
  const resolvedHeight = Math.max(
    JIMENG_IMAGE_NODE_MIN_HEIGHT,
    Math.round(height ?? JIMENG_IMAGE_NODE_DEFAULT_HEIGHT)
  );
  const lastGeneratedTime = useMemo(
    () => formatTimestamp(data.lastGeneratedAt ?? null, i18n.language),
    [data.lastGeneratedAt, i18n.language]
  );
  const selectedModel = data.modelVersion ?? DEFAULT_IMAGE_MODEL;
  const selectedResolution = data.resolutionType ?? DEFAULT_IMAGE_RESOLUTION;
  const selectedAspectRatio = data.aspectRatio ?? DEFAULT_IMAGE_ASPECT_RATIO;

  const modelOptions = useMemo(
    () => JIMENG_IMAGE_MODEL_OPTIONS.map((option) => ({
      value: option.value,
      label: t(option.labelKey),
    })),
    [t]
  );
  const resolutionOptions = useMemo(
    () => JIMENG_IMAGE_RESOLUTION_OPTIONS.map((option) => ({
      value: option.value,
      label: t(option.labelKey),
    })),
    [t]
  );
  const aspectRatioOptions = useMemo(
    () => JIMENG_ASPECT_RATIO_OPTIONS.map((option) => ({
      value: option.value,
      label: t(option.labelKey),
    })),
    [t]
  );

  useEffect(() => {
    const externalPrompt = data.prompt ?? '';
    if (externalPrompt !== promptValueRef.current) {
      promptValueRef.current = externalPrompt;
      setPromptOptimizationError(null);
      setLastPromptOptimizationMeta(null);
      setLastPromptOptimizationUndoState(null);
    }
  }, [data.prompt]);

  useEffect(() => {
    updateNodeInternals(id);
  }, [id, incomingImages.length, resolvedHeight, resolvedWidth, updateNodeInternals]);

  const updatePrompt = useCallback((nextPrompt: string) => {
    promptValueRef.current = nextPrompt;
    updateNodeData(id, { prompt: nextPrompt });
  }, [id, updateNodeData]);

  const handlePromptChange = useCallback((nextPrompt: string) => {
    setPromptOptimizationError(null);
    setLastPromptOptimizationMeta(null);
    setLastPromptOptimizationUndoState(null);
    updatePrompt(nextPrompt);
  }, [updatePrompt]);

  const handleOptimizePrompt = useCallback(async () => {
    const sourcePrompt = promptValueRef.current;
    const currentPrompt = sourcePrompt.trim();
    if (!currentPrompt) {
      const message = t('node.jimengImage.promptRequired');
      updateNodeData(id, { lastError: null });
      setPromptOptimizationError(message);
      await showErrorDialog(message, t('common.error'));
      return;
    }

    setIsOptimizingPrompt(true);
    setPromptOptimizationError(null);
    updateNodeData(id, { lastError: null });

    try {
      const result = await optimizeCanvasPrompt({
        mode: 'image',
        prompt: currentPrompt,
        referenceImages: incomingImages,
      });
      if (promptValueRef.current !== sourcePrompt) {
        return;
      }

      const nextPrompt = result.prompt;
      setLastPromptOptimizationMeta({
        modelLabel: [result.context.provider, result.context.model].filter(Boolean).join(' / '),
        referenceImageCount: result.usedReferenceImages ? incomingImages.length : 0,
      });
      if (nextPrompt !== sourcePrompt) {
        setLastPromptOptimizationUndoState({
          previousPrompt: sourcePrompt,
          appliedPrompt: nextPrompt,
        });
      } else {
        setLastPromptOptimizationUndoState(null);
      }

      updatePrompt(nextPrompt);
      requestAnimationFrame(() => {
        promptRef.current?.focus();
        const cursor = nextPrompt.length;
        promptRef.current?.setSelectionRange(cursor, cursor);
      });
    } catch (error) {
      const message =
        error instanceof Error && error.message.trim().length > 0
          ? error.message
          : t('node.jimengImage.optimizePromptFailed');
      setPromptOptimizationError(message);
      await showErrorDialog(message, t('common.error'));
    } finally {
      setIsOptimizingPrompt(false);
    }
  }, [id, incomingImages, t, updateNodeData, updatePrompt]);

  const handleCheckCliStatus = useCallback(async () => {
    setIsCheckingCliStatus(true);

    try {
      const status = await checkDreaminaCliStatus();
      const message = [status.message, status.detail].filter(Boolean).join(' | ');
      setCliStatusMessage(message || status.message);

      if (!status.ready) {
        await showErrorDialog(status.detail ?? status.message, t('common.error'));
      }
    } catch (error) {
      const content = resolveErrorContent(error, t('node.jimengImage.checkCliFailed'));
      setCliStatusMessage(content.message);
      await showErrorDialog(content.message, t('common.error'), content.details);
    } finally {
      setIsCheckingCliStatus(false);
    }
  }, [t]);

  const handleUndoOptimizedPrompt = useCallback(() => {
    if (!lastPromptOptimizationUndoState) {
      return;
    }

    if (promptValueRef.current !== lastPromptOptimizationUndoState.appliedPrompt) {
      return;
    }

    const restoredPrompt = lastPromptOptimizationUndoState.previousPrompt;
    setPromptOptimizationError(null);
    setLastPromptOptimizationMeta(null);
    setLastPromptOptimizationUndoState(null);
    updatePrompt(restoredPrompt);
    requestAnimationFrame(() => {
      promptRef.current?.focus();
      const cursor = restoredPrompt.length;
      promptRef.current?.setSelectionRange(cursor, cursor);
    });
  }, [lastPromptOptimizationUndoState, updatePrompt]);

  const handleGenerate = useCallback(async () => {
    const prompt = data.prompt?.trim() ?? '';
    if (!prompt) {
      const message = t('node.jimengImage.promptRequired');
      updateNodeData(id, { lastError: message });
      await showErrorDialog(message, t('common.error'));
      return;
    }

    setPromptOptimizationError(null);
    setCliStatusMessage(null);
    updateNodeData(id, {
      isGenerating: true,
      generationStartedAt: Date.now(),
      lastError: null,
      resultImages: [],
    });

    let createdResultNodeId: string | null = null;

    try {
      const resultNodePosition = findNodePosition(
        id,
        JIMENG_IMAGE_RESULT_NODE_DEFAULT_WIDTH,
        JIMENG_IMAGE_RESULT_NODE_DEFAULT_HEIGHT
      );
      createdResultNodeId = addNode(
        CANVAS_NODE_TYPES.jimengImageResult,
        resultNodePosition,
        {
          sourceNodeId: id,
          displayName: buildJimengResultNodeTitle(prompt, t('node.jimengImage.resultNodeTitle')),
          submitIds: [],
          aspectRatio: selectedAspectRatio,
          gridRows: 2,
          gridCols: 2,
          resultImages: [],
          isGenerating: true,
          generationStartedAt: Date.now(),
          generationDurationMs: data.generationDurationMs ?? 90000,
          lastGeneratedAt: null,
          lastError: null,
        },
        { inheritParentFromNodeId: id }
      );
      addEdge(id, createdResultNodeId);

      const generationResponse = await generateJimengImages({
        prompt,
        aspectRatio: selectedAspectRatio,
        resolutionType: selectedResolution,
        modelVersion: selectedModel,
        referenceImageSources: incomingImages,
      });
      const completedAt = Date.now();

      updateNodeData(id, {
        isGenerating: false,
        generationStartedAt: null,
        lastGeneratedAt: completedAt,
        lastError: null,
        resultImages: [],
      });

      if (createdResultNodeId) {
        updateNodeData(createdResultNodeId, {
          submitIds: generationResponse.submitIds,
          aspectRatio: selectedAspectRatio,
          resultImages: generationResponse.images,
          isGenerating: false,
          generationStartedAt: null,
          lastGeneratedAt: completedAt,
          lastError: null,
        });
      }
    } catch (error) {
      const content = resolveErrorContent(error, t('node.jimengImage.generateFailed'));
      updateNodeData(id, {
        isGenerating: false,
        generationStartedAt: null,
        lastError: content.message,
      });
      if (createdResultNodeId) {
        updateNodeData(createdResultNodeId, {
          isGenerating: false,
          generationStartedAt: null,
          lastError: content.message,
        });
      }
      await showErrorDialog(content.message, t('common.error'), content.details);
    }
  }, [
    addEdge,
    addNode,
    data.generationDurationMs,
    data.prompt,
    findNodePosition,
    id,
    incomingImages,
    selectedAspectRatio,
    selectedModel,
    selectedResolution,
    t,
    updateNodeData,
  ]);

  const combinedError = promptOptimizationError ?? data.lastError;
  const canUndoPromptOptimization = Boolean(
    lastPromptOptimizationUndoState
    && (data.prompt ?? '') === lastPromptOptimizationUndoState.appliedPrompt
  );
  const promptOptimizationNotice = lastPromptOptimizationMeta
    ? `${t('node.jimengImage.optimizeModelLabel', {
      model: lastPromptOptimizationMeta.modelLabel,
    })} | ${t('node.jimengImage.optimizeReferenceImagesLabel', {
      status:
        lastPromptOptimizationMeta.referenceImageCount > 0
          ? t('node.jimengImage.optimizeReferenceImagesUsed', {
            count: lastPromptOptimizationMeta.referenceImageCount,
          })
          : t('node.jimengImage.optimizeReferenceImagesUnused'),
    })}`
    : null;

  const headerStatus = useMemo(() => {
    if (data.isGenerating) {
      return (
        <NodeStatusBadge
          icon={<Loader2 className="h-3 w-3" />}
          label={t('node.jimengImage.generating')}
          tone="processing"
          animate
        />
      );
    }

    if (isOptimizingPrompt) {
      return (
        <NodeStatusBadge
          icon={<Loader2 className="h-3 w-3" />}
          label={t('node.jimengImage.optimizingPrompt')}
          tone="processing"
          animate
        />
      );
    }

    if (isCheckingCliStatus) {
      return (
        <NodeStatusBadge
          icon={<Loader2 className="h-3 w-3" />}
          label={t('node.jimengImage.checkingCli')}
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

    return null;
  }, [combinedError, data.isGenerating, isCheckingCliStatus, isOptimizingPrompt, t]);

  const statusInfoText = combinedError
    ?? (data.isGenerating
      ? t('node.jimengImage.generating')
      : cliStatusMessage
        ?? (lastGeneratedTime
          ? t('node.jimengImage.generatedToNode', { time: lastGeneratedTime })
          : promptOptimizationNotice));

  return (
    <div
      className={`
        group relative flex h-full flex-col overflow-visible rounded-[var(--node-radius)] border bg-surface-dark/90 p-2 transition-all duration-150
        ${selected
          ? 'border-accent shadow-[0_0_0_2px_rgba(59,130,246,0.5),0_4px_20px_rgba(59,130,246,0.2)]'
          : 'border-[rgba(15,23,42,0.22)] hover:border-[rgba(15,23,42,0.34)] hover:shadow-[0_4px_16px_rgba(0,0,0,0.12)] dark:border-[rgba(255,255,255,0.22)] dark:hover:border-[rgba(255,255,255,0.34)] dark:hover:shadow-[0_4px_16px_rgba(0,0,0,0.25)]'}
      `}
      style={{ width: `${resolvedWidth}px`, height: `${resolvedHeight}px` }}
      onClick={() => setSelectedNode(id)}
    >
      <NodeHeader
        className={NODE_HEADER_FLOATING_POSITION_CLASS}
        icon={<Sparkles className="h-4 w-4" />}
        titleText={resolvedTitle}
        rightSlot={headerStatus ?? undefined}
        editable
        onTitleChange={(nextTitle) => updateNodeData(id, { displayName: nextTitle })}
      />

      <div className="relative min-h-0 flex-1 rounded-lg border border-[rgba(255,255,255,0.1)] bg-bg-dark/45 p-2">
        <div className="flex h-full min-h-0 flex-col gap-2">
          <textarea
            ref={promptRef}
            value={data.prompt ?? ''}
            onChange={(event) => handlePromptChange(event.target.value)}
            placeholder={t('node.jimengImage.promptPlaceholder')}
            className="ui-scrollbar nodrag nowheel min-h-[136px] flex-1 w-full resize-none rounded-xl border border-white/10 bg-black/15 px-3 py-2 text-sm leading-6 text-text-dark outline-none placeholder:text-text-muted/70 focus:border-accent/50"
            onMouseDown={(event) => event.stopPropagation()}
            onKeyDownCapture={(event) => {
              if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                event.preventDefault();
                event.stopPropagation();
                void handleGenerate();
              }
            }}
          />

          <div className="flex min-h-[44px] flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-black/10 px-2 py-2">
            {incomingImages.length > 0 ? (
              incomingImages.map((imageUrl, index) => (
                <CanvasNodeImage
                  key={`${imageUrl}-${index}`}
                  src={resolveImageDisplayUrl(imageUrl)}
                  alt={t('node.jimeng.referenceImageLabel', { index: index + 1 })}
                  viewerSourceUrl={resolveImageDisplayUrl(imageUrl)}
                  viewerImageList={incomingImageDisplayList}
                  className="h-10 w-10 rounded-lg object-cover"
                  draggable={false}
                />
              ))
            ) : (
              <div className="flex min-h-[28px] w-full items-center text-[11px] text-text-muted">
                {t('node.jimengImage.referenceCount', { count: 0 })}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="mt-2 flex shrink-0 items-center gap-2">
        <div className="ui-scrollbar min-w-0 flex-1 overflow-x-auto overflow-y-hidden">
          <div className="flex w-max min-w-full items-center gap-1.5 pr-1">
            <FixedControlChip
              label={t('node.jimengImage.parameters.model')}
              value={selectedModel}
              options={modelOptions}
              onChange={(nextValue) => updateNodeData(id, { modelVersion: nextValue })}
            />
            <FixedControlChip
              label={t('node.jimengImage.parameters.resolution')}
              value={selectedResolution}
              options={resolutionOptions}
              onChange={(nextValue) => updateNodeData(id, { resolutionType: nextValue })}
            />
            <FixedControlChip
              label={t('node.jimengImage.parameters.aspectRatio')}
              value={selectedAspectRatio}
              options={aspectRatioOptions}
              onChange={(nextValue) => updateNodeData(id, { aspectRatio: nextValue })}
            />
            <UiChipButton
              type="button"
              active={isOptimizingPrompt}
              disabled={isOptimizingPrompt || (data.prompt?.trim().length ?? 0) === 0}
              className={`${NODE_CONTROL_CHIP_CLASS} !w-8 !px-0 shrink-0 justify-center`}
              aria-label={
                isOptimizingPrompt
                  ? t('node.jimengImage.optimizingPrompt')
                  : t('node.jimengImage.optimizePrompt')
              }
              title={
                isOptimizingPrompt
                  ? t('node.jimengImage.optimizingPrompt')
                  : t('node.jimengImage.optimizePrompt')
              }
              onClick={(event) => {
                event.stopPropagation();
                void handleOptimizePrompt();
              }}
            >
              {isOptimizingPrompt ? (
                <Loader2 className="h-4 w-4 origin-center scale-[1.12] animate-spin text-text-dark" />
              ) : (
                <Wand2
                  className="h-4 w-4 origin-center scale-[1.18] text-text-dark"
                  strokeWidth={2.45}
                />
              )}
            </UiChipButton>
            <UiChipButton
              type="button"
              disabled={isOptimizingPrompt || !canUndoPromptOptimization}
              className={`${NODE_CONTROL_CHIP_CLASS} !w-8 !px-0 shrink-0 justify-center`}
              aria-label={t('node.jimengImage.undoOptimizedPrompt')}
              title={t('node.jimengImage.undoOptimizedPrompt')}
              onClick={(event) => {
                event.stopPropagation();
                handleUndoOptimizedPrompt();
              }}
            >
              <Undo2
                className="h-4 w-4 origin-center scale-[1.08] text-text-dark"
                strokeWidth={2.3}
              />
            </UiChipButton>
            <UiChipButton
              type="button"
              disabled={isCheckingCliStatus || data.isGenerating === true}
              className={`${NODE_CONTROL_CHIP_CLASS} shrink-0 !px-2.5`}
              aria-label={t('node.jimengImage.checkCli')}
              title={t('node.jimengImage.checkCli')}
              onClick={(event) => {
                event.stopPropagation();
                void handleCheckCliStatus();
              }}
            >
              {isCheckingCliStatus ? (
                <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.3} />
              ) : null}
              {t('node.jimengImage.checkCli')}
            </UiChipButton>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <UiButton
            onClick={(event) => {
              event.stopPropagation();
              void handleGenerate();
            }}
            variant="primary"
            disabled={data.isGenerating === true}
            className={NODE_CONTROL_PRIMARY_BUTTON_CLASS}
          >
            {data.isGenerating ? (
              <Loader2 className={`${NODE_CONTROL_GENERATE_ICON_CLASS} animate-spin`} strokeWidth={2.5} />
            ) : (
              <Sparkles className={NODE_CONTROL_GENERATE_ICON_CLASS} strokeWidth={2.5} />
            )}
            {t('node.jimengImage.generate')}
          </UiButton>
        </div>
      </div>

      {statusInfoText ? (
        <div
          className={`mt-1 min-h-[16px] truncate text-[10px] leading-4 ${
            combinedError ? 'text-rose-300' : 'text-text-muted'
          }`}
          title={statusInfoText}
        >
          {statusInfoText}
        </div>
      ) : null}

      <Handle
        type="target"
        position={Position.Left}
        id="target"
        className="!h-2.5 !w-2.5 !border-2 !border-surface-dark !bg-accent"
      />
      <Handle
        type="source"
        position={Position.Right}
        id="source"
        className="!h-2.5 !w-2.5 !border-2 !border-surface-dark !bg-accent"
      />
      <NodeResizeHandle
        minWidth={JIMENG_IMAGE_NODE_MIN_WIDTH}
        minHeight={JIMENG_IMAGE_NODE_MIN_HEIGHT}
        maxWidth={JIMENG_IMAGE_NODE_MAX_WIDTH}
        maxHeight={JIMENG_IMAGE_NODE_MAX_HEIGHT}
      />
    </div>
  );
});

JimengImageNode.displayName = 'JimengImageNode';
