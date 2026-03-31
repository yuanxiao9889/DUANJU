import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Handle, Position, useUpdateNodeInternals, type NodeProps } from '@xyflow/react';
import {
  ExternalLink,
  Loader2,
  RefreshCw,
  Sparkles,
  TriangleAlert,
  Undo2,
  Wand2,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import {
  CANVAS_NODE_TYPES,
  JIMENG_IMAGE_RESULT_NODE_DEFAULT_HEIGHT,
  JIMENG_IMAGE_RESULT_NODE_DEFAULT_WIDTH,
  type JimengImageNodeData,
  type JimengNodeControlOption,
  type JimengNodeControlState,
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
import { focusJimengChromeWorkspace } from '@/features/jimeng/application/jimengChromeWorkspace';
import {
  generateJimengImages,
  inspectJimengImageControls,
} from '@/features/jimeng/application/jimengImageGeneration';

type JimengImageNodeProps = NodeProps & {
  id: string;
  data: JimengImageNodeData;
  selected?: boolean;
};

interface VisibleControlEntry {
  control: JimengNodeControlState;
  originalIndex: number;
}

interface PromptOptimizationMeta {
  modelLabel: string;
  referenceImageCount: number;
}

interface PromptOptimizationUndoState {
  previousPrompt: string;
  appliedPrompt: string;
}

const JIMENG_IMAGE_NODE_DEFAULT_WIDTH = 560;
const JIMENG_IMAGE_NODE_DEFAULT_HEIGHT = 300;
const JIMENG_IMAGE_NODE_MIN_WIDTH = 520;
const JIMENG_IMAGE_NODE_MIN_HEIGHT = 220;
const JIMENG_IMAGE_NODE_MAX_WIDTH = 1400;
const JIMENG_IMAGE_NODE_MAX_HEIGHT = 1000;

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

function normalizeAspectRatio(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const match = value.trim().match(/(\d{1,2})\s*[:/]\s*(\d{1,2})/);
  if (!match) {
    return null;
  }

  return `${match[1]}:${match[2]}`;
}

function resolveSelectedJimengAspectRatio(controls: JimengNodeControlState[]): string {
  for (const control of controls) {
    if (control.matchedKnownControlKey !== 'aspectRatio') {
      continue;
    }

    const normalized = normalizeAspectRatio(control.matchedValue) ?? normalizeAspectRatio(control.optionText);
    if (normalized) {
      return normalized;
    }
  }

  return '1:1';
}

function buildJimengResultNodeTitle(prompt: string, fallbackTitle: string): string {
  const normalizedPrompt = prompt.trim();
  return normalizedPrompt || fallbackTitle;
}

function buildVisibleControls(controls: JimengNodeControlState[]): VisibleControlEntry[] {
  return controls
    .map((control, originalIndex) => ({ control, originalIndex }))
    .filter(({ control }) => control.matchedKnownControlKey !== 'creationType');
}

function JimengControlChip({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: JimengNodeControlOption[];
  onChange: (nextValue: string) => void;
}) {
  return (
    <div
      className="flex h-7 shrink-0 items-center gap-1 rounded-lg border border-[color:var(--ui-border-soft)] bg-[var(--ui-surface-field)] px-2"
      onMouseDown={(event) => event.stopPropagation()}
    >
      <span className="max-w-[84px] truncate text-[11px] text-text-muted" title={label}>
        {label}
      </span>
      <UiSelect
        value={value}
        aria-label={label}
        className="nodrag !h-6 !w-[132px] !rounded-md !border-0 !bg-transparent !px-1.5 !text-[11px] !font-medium hover:!border-0 focus-visible:!border-0 focus-visible:!shadow-none"
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option.text} value={option.text} disabled={option.disabled}>
            {option.text}
          </option>
        ))}
      </UiSelect>
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
  const controls = Array.isArray(data.controls) ? data.controls : [];
  const visibleControls = useMemo(() => buildVisibleControls(controls), [controls]);
  const lastSyncTime = useMemo(
    () => formatTimestamp(data.controlsSyncedAt ?? null, i18n.language),
    [data.controlsSyncedAt, i18n.language]
  );
  const lastGeneratedTime = useMemo(
    () => formatTimestamp(data.lastGeneratedAt ?? null, i18n.language),
    [data.lastGeneratedAt, i18n.language]
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
  }, [id, resolvedHeight, resolvedWidth, visibleControls.length, updateNodeInternals]);

  const updateControls = useCallback((nextControls: JimengNodeControlState[]) => {
    updateNodeData(id, { controls: nextControls });
  }, [id, updateNodeData]);

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

  const syncControlsInternal = useCallback(async (): Promise<JimengNodeControlState[]> => {
    updateNodeData(id, {
      isSyncingControls: true,
      lastError: null,
    });

    try {
      await focusJimengChromeWorkspace('image');
      const nextControls = await inspectJimengImageControls(controls);
      updateNodeData(id, {
        controls: nextControls,
        controlsSyncedAt: Date.now(),
        isSyncingControls: false,
        lastError: null,
      });
      return nextControls;
    } catch (error) {
      const content = resolveErrorContent(error, t('node.jimengImage.syncFailed'));
      updateNodeData(id, {
        isSyncingControls: false,
        lastError: content.message,
      });
      throw content;
    }
  }, [controls, id, t, updateNodeData]);

  const handleOpenWorkspace = useCallback(async () => {
    setPromptOptimizationError(null);
    updateNodeData(id, { lastError: null });

    try {
      await focusJimengChromeWorkspace('image');
    } catch (error) {
      const content = resolveErrorContent(error, t('titleBar.jimengOpenFailed'));
      updateNodeData(id, { lastError: content.message });
      await showErrorDialog(content.message, t('common.error'), content.details);
    }
  }, [id, t, updateNodeData]);

  const handleSyncControls = useCallback(async () => {
    setPromptOptimizationError(null);
    try {
      await syncControlsInternal();
    } catch (error) {
      const content = error instanceof Error
        ? { message: error.message, details: undefined }
        : resolveErrorContent(error, t('node.jimengImage.syncFailed'));
      await showErrorDialog(content.message, t('common.error'), content.details);
    }
  }, [syncControlsInternal, t]);

  const handleControlChange = useCallback((controlIndex: number, optionText: string) => {
    const nextControls = controls.map((control, index) =>
      index === controlIndex
        ? {
            ...control,
            optionText,
          }
        : control
    );
    updateControls(nextControls);
  }, [controls, updateControls]);

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
    updateNodeData(id, {
      isGenerating: true,
      generationStartedAt: Date.now(),
      lastError: null,
      resultImages: [],
    });

    let createdResultNodeId: string | null = null;

    try {
      let activeControls = controls;
      if (activeControls.length === 0) {
        activeControls = await syncControlsInternal();
      }

      const resolvedAspectRatio = resolveSelectedJimengAspectRatio(activeControls);
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
          aspectRatio: resolvedAspectRatio,
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

      const generatedResults = await generateJimengImages({
        prompt,
        controls: activeControls,
        referenceImageSources: incomingImages,
      });
      const finalAspectRatio = generatedResults[0]?.aspectRatio ?? resolvedAspectRatio;
      const completedAt = Date.now();

      updateNodeData(id, {
        controls: activeControls,
        isGenerating: false,
        generationStartedAt: null,
        lastGeneratedAt: completedAt,
        lastError: null,
        resultImages: [],
      });

      if (createdResultNodeId) {
        updateNodeData(createdResultNodeId, {
          aspectRatio: finalAspectRatio,
          resultImages: generatedResults,
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
    controls,
    data.generationDurationMs,
    data.prompt,
    findNodePosition,
    id,
    incomingImages,
    syncControlsInternal,
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

    if (data.isSyncingControls) {
      return (
        <NodeStatusBadge
          icon={<Loader2 className="h-3 w-3" />}
          label={t('node.jimengImage.syncing')}
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
  }, [combinedError, data.isGenerating, data.isSyncingControls, isOptimizingPrompt, t]);

  const statusInfoText = combinedError
    ?? (data.isGenerating
      ? t('node.jimengImage.generating')
      : data.isSyncingControls
        ? t('node.jimengImage.syncing')
        : isOptimizingPrompt
          ? t('node.jimengImage.optimizingPrompt')
          : lastGeneratedTime
            ? t('node.jimengImage.generatedToNode', { time: lastGeneratedTime })
            : promptOptimizationNotice
              ? promptOptimizationNotice
              : lastSyncTime
                ? t('node.jimengImage.syncedAt', { time: lastSyncTime })
                : t('node.jimengImage.panelEmpty'));

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

      <div className="relative min-h-0 flex-1 rounded-lg border border-[rgba(255,255,255,0.1)] bg-bg-dark/45 p-2 pt-9">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="text-sm font-semibold text-text-dark">
            {t('node.jimengImage.promptLabel')}
          </div>
          <div className="text-xs text-text-muted">
            {t('node.jimengImage.referenceCount', { count: incomingImages.length })}
          </div>
        </div>

        <textarea
          ref={promptRef}
          value={data.prompt ?? ''}
          onChange={(event) => handlePromptChange(event.target.value)}
          placeholder={t('node.jimengImage.promptPlaceholder')}
          className="ui-scrollbar nodrag nowheel min-h-[110px] h-full w-full resize-none rounded-xl border border-white/10 bg-black/15 px-3 py-2 text-sm leading-6 text-text-dark outline-none placeholder:text-text-muted/70 focus:border-accent/50"
          onMouseDown={(event) => event.stopPropagation()}
          onKeyDownCapture={(event) => {
            if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
              event.preventDefault();
              event.stopPropagation();
              void handleGenerate();
            }
          }}
        />

        <div className="mt-3 flex min-h-[54px] flex-wrap gap-2 overflow-hidden">
          {incomingImages.length > 0 ? (
            incomingImages.map((imageUrl, index) => (
              <CanvasNodeImage
                key={`${imageUrl}-${index}`}
                src={resolveImageDisplayUrl(imageUrl)}
                alt={t('node.jimeng.referenceImageLabel', { index: index + 1 })}
                viewerSourceUrl={resolveImageDisplayUrl(imageUrl)}
                viewerImageList={incomingImageDisplayList}
                className="h-12 w-12 rounded-lg object-cover"
                draggable={false}
              />
            ))
          ) : (
            <div className="flex h-full min-h-[54px] w-full items-center justify-center rounded-xl border border-dashed border-white/10 bg-black/10 px-4 text-xs text-text-muted">
              {t('node.jimengImage.referenceEmpty')}
            </div>
          )}
        </div>
      </div>

      <div className="mt-2 flex shrink-0 items-center gap-2">
        <div className="ui-scrollbar min-w-0 flex-1 overflow-x-auto overflow-y-hidden">
          <div className="flex w-max min-w-full items-center gap-1">
            <UiChipButton
              type="button"
              className={`${NODE_CONTROL_CHIP_CLASS} shrink-0`}
              onClick={(event) => {
                event.stopPropagation();
                void handleOpenWorkspace();
              }}
            >
              <ExternalLink className="h-3.5 w-3.5" />
              {t('node.jimengImage.openWorkspace')}
            </UiChipButton>
            <UiChipButton
              type="button"
              active={data.isSyncingControls === true}
              disabled={data.isSyncingControls === true}
              className={`${NODE_CONTROL_CHIP_CLASS} shrink-0`}
              onClick={(event) => {
                event.stopPropagation();
                void handleSyncControls();
              }}
            >
              {data.isSyncingControls ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              {t('node.jimengImage.syncControls')}
            </UiChipButton>
            <UiChipButton
              type="button"
              active={isOptimizingPrompt}
              disabled={isOptimizingPrompt || (data.prompt?.trim().length ?? 0) === 0}
              className={`${NODE_CONTROL_CHIP_CLASS} !w-7 !px-0 shrink-0 justify-center`}
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
              className={`${NODE_CONTROL_CHIP_CLASS} !w-7 !px-0 shrink-0 justify-center`}
              aria-label={t('node.jimengImage.undoOptimizedPrompt')}
              title={t('node.jimengImage.undoOptimizedPrompt')}
              onClick={(event) => {
                event.stopPropagation();
                handleUndoOptimizedPrompt();
              }}
            >
              <Undo2 className="h-4 w-4 origin-center scale-[1.08] text-text-dark" strokeWidth={2.3} />
            </UiChipButton>

            {visibleControls.map(({ control, originalIndex }) => (
              <JimengControlChip
                key={`${control.matchedKnownControlKey ?? 'extra'}-${control.controlIndex ?? originalIndex}`}
                label={control.triggerText}
                value={control.optionText}
                options={control.options}
                onChange={(nextValue) => handleControlChange(originalIndex, nextValue)}
              />
            ))}
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

      <div
        className={`mt-1 min-h-[18px] text-[10px] leading-4 ${
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
        minWidth={JIMENG_IMAGE_NODE_MIN_WIDTH}
        minHeight={JIMENG_IMAGE_NODE_MIN_HEIGHT}
        maxWidth={JIMENG_IMAGE_NODE_MAX_WIDTH}
        maxHeight={JIMENG_IMAGE_NODE_MAX_HEIGHT}
        isVisible={selected}
      />
    </div>
  );
});

JimengImageNode.displayName = 'JimengImageNode';
