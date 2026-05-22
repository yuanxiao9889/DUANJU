import { createPortal } from 'react-dom';
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type SyntheticEvent,
} from 'react';
import { Position, type NodeProps } from '@xyflow/react';
import { Image as ImageIcon, Loader2, Sparkles, TriangleAlert, Undo2, Video, Wand2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { UiButton, UiChipButton, UiModal, UiPanel, UiSelect } from '@/components/ui';
import { resolveErrorContent, showErrorDialog } from '@/features/canvas/application/errorDialog';
import { flushCurrentProjectToDiskSafely } from '@/features/canvas/application/projectPersistence';
import { optimizeCanvasPrompt } from '@/features/canvas/application/promptOptimization';
import {
  buildShortReferenceToken,
  findReferenceTokens,
  insertReferenceToken,
  removeTextRange,
  resolveReferenceAwareDeleteRange,
  type ReferenceTokenMatch,
} from '@/features/canvas/application/referenceTokenEditing';
import {
  DEFAULT_PICKER_ANCHOR,
  type PickerAnchor,
  readTextareaScroll,
  readTextareaSelection,
  resolveFloatingPreviewPosition,
  resolveTextSelection,
  resolveTextareaPickerAnchor,
  restoreTextareaSelection,
  type TextareaScrollSnapshot,
  type TextSelectionRange,
} from '@/features/canvas/application/textareaSelection';
import {
  CANVAS_NODE_TYPES,
  GPT_BEST_VIDEO_RESULT_NODE_DEFAULT_HEIGHT,
  GPT_BEST_VIDEO_RESULT_NODE_DEFAULT_WIDTH,
  type GptBestVideoNodeData,
  type GptBestVideoSourceKind,
} from '@/features/canvas/domain/canvasNodes';
import { resolveNodeDisplayName } from '@/features/canvas/domain/nodeDisplay';
import { useIsOverviewCanvasRender } from '@/features/canvas/CanvasPerformanceContext';
import { useCanvasConnectedReferenceVisuals } from '@/features/canvas/hooks/useCanvasNodeGraph';
import { useCanvasZoom } from '@/features/canvas/hooks/useCanvasZoom';
import { CameraTriggerIcon } from '@/features/canvas/ui/CameraTriggerIcon';
import { CanvasHandle } from '@/features/canvas/ui/CanvasHandle';
import { CanvasNodeImage } from '@/features/canvas/ui/CanvasNodeImage';
import { NodeHeader, NODE_HEADER_FLOATING_POSITION_CLASS } from '@/features/canvas/ui/NodeHeader';
import { NodeResizeHandle } from '@/features/canvas/ui/NodeResizeHandle';
import { NodeStatusBadge } from '@/features/canvas/ui/NodeStatusBadge';
import { ShotParamsPanel } from '@/features/canvas/ui/ShotParamsPanel';
import {
  NODE_CONTROL_CHIP_CLASS,
  NODE_CONTROL_PRIMARY_BUTTON_CLASS,
} from '@/features/canvas/ui/nodeControlStyles';
import { PROMPT_REFERENCE_TOKEN_HIGHLIGHT_CLASS } from '@/features/canvas/ui/promptReferenceTokenStyles';
import {
  normalizeGptBestVideoModel,
  normalizeGptBestVideoSeconds,
  normalizeGptBestVideoSize,
  resolveAllowedSecondsForGptBestVideoModel,
  submitGptBestVideoTask,
} from '@/features/gpt-best-video/application/gptBestVideoSubmission';
import {
  OOPII_VIDEO_MODEL_IDS,
  OOPII_VIDEO_ASPECT_RATIO_OPTIONS,
  OOPII_VIDEO_PROVIDER_ID,
  OOPII_VIDEO_RESOLUTION_OPTIONS,
  normalizeOopiiVideoAspectRatio,
  normalizeOopiiVideoResolution,
  resolveOopiiVideoSizeFromDisplayOptions,
} from '@/features/gpt-best-video/domain/oopiiVideoModels';
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

interface SelectOption<T extends string | number> {
  value: T;
  label: string;
}

interface PromptOptimizationUndoState {
  previousPrompt: string;
  appliedPrompt: string;
}

interface PromptOptimizationMeta {
  modelLabel: string;
  referenceImageCount: number;
}

interface ReferenceVisualItem {
  sourceEdgeId: string;
  sourceNodeId: string;
  kind: 'image' | 'video';
  referenceUrl: string;
  previewImageUrl: string | null;
  displayUrl: string | null;
  tokenLabel: string;
  label: string;
  durationSeconds: number | null;
}

interface ReferencePickerItem {
  key: string;
  tokenLabel: string;
  label: string;
  insertToken: string;
  displayUrl: string | null;
  previewKind: 'image' | 'video';
  durationSeconds: number | null;
}

interface PromptReferencePreviewState {
  displayUrl: string | null;
  label: string;
  kind: 'image' | 'video';
  durationSeconds: number | null;
  left: number;
  top: number;
}

interface PanelAnchor {
  left: number;
  top: number;
}

const PICKER_Y_OFFSET_PX = 20;

const GPT_BEST_VIDEO_NODE_DEFAULT_WIDTH = 1000;
const GPT_BEST_VIDEO_NODE_DEFAULT_HEIGHT = 500;
const GPT_BEST_VIDEO_NODE_MIN_WIDTH = 980;
const GPT_BEST_VIDEO_NODE_MIN_HEIGHT = 420;
const GPT_BEST_VIDEO_NODE_MAX_WIDTH = 1480;
const GPT_BEST_VIDEO_NODE_MAX_HEIGHT = 1040;
const GPT_BEST_VIDEO_NODE_MAIN_WIDTH_RATIO = 0.6;

function FixedControlChip<T extends string | number>({
  label,
  value,
  options,
  onChange,
  disabled = false,
}: {
  label: string;
  value: T;
  options: SelectOption<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  const chipRef = useRef<HTMLDivElement>(null);

  return (
    <div
      ref={chipRef}
      className="flex h-7 min-w-[76px] shrink-0 items-center rounded-lg border border-[color:var(--ui-border-soft)] bg-[var(--ui-surface-field)] px-2"
      onMouseDown={(event) => event.stopPropagation()}
      title={label}
    >
      <div className="min-w-0 flex-1">
        <UiSelect
          disabled={disabled}
          value={value}
          aria-label={label}
          menuAnchorRef={chipRef}
          className="nodrag !h-6 !w-full !rounded-md !border-0 !bg-transparent !px-0.5 !text-[10.5px] !font-semibold hover:!border-0 focus-visible:!border-0 focus-visible:!shadow-none disabled:opacity-60"
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
              {option.label}
            </option>
          ))}
        </UiSelect>
      </div>
    </div>
  );
}

function buildSourceKindForType(
  type: string | undefined,
  data: GptBestVideoNodeData
): GptBestVideoSourceKind {
  if (data.sourceKind === 'grok' || type === CANVAS_NODE_TYPES.gptBestGrokVideo) {
    return 'grok';
  }
  return 'seedance';
}

function resolveModelLabel(
  t: (key: string) => string,
  modelId: string
): string {
  const key = `node.gptBestVideo.modelOptions.${modelId}`;
  const translated = t(key);
  return translated === key ? modelId : translated;
}

function getPanelAnchor(triggerElement: HTMLDivElement | null): PanelAnchor | null {
  if (!triggerElement) {
    return null;
  }

  const rect = triggerElement.getBoundingClientRect();
  return {
    left: rect.left + rect.width / 2,
    top: rect.top - 8,
  };
}

function buildPanelStyle(anchor: PanelAnchor | null): CSSProperties | undefined {
  if (!anchor) {
    return undefined;
  }

  return {
    left: anchor.left,
    top: anchor.top,
    transform: 'translateX(-50%) translateY(-100%)',
  };
}

function stopInteractionPropagation(event: SyntheticEvent) {
  event.stopPropagation();
}

function renderPromptWithHighlights(
  prompt: string,
  maxReferenceCount: number
): ReactNode {
  if (!prompt) {
    return ' ';
  }

  const segments: ReactNode[] = [];
  let lastIndex = 0;
  const referenceTokens = findReferenceTokens(prompt, maxReferenceCount);
  for (const token of referenceTokens) {
    if (token.start > lastIndex) {
      segments.push(
        <span key={`plain-${lastIndex}`}>
          {prompt.slice(lastIndex, token.start)}
        </span>
      );
    }

    segments.push(
      <span
        key={`token-${token.start}`}
        className={PROMPT_REFERENCE_TOKEN_HIGHLIGHT_CLASS}
      >
        {token.token}
      </span>
    );
    lastIndex = token.end;
  }

  if (lastIndex < prompt.length) {
    segments.push(
      <span key={`plain-${lastIndex}`}>{prompt.slice(lastIndex)}</span>
    );
  }

  return segments;
}

function renderPromptReferenceHoverTargets(
  prompt: string,
  maxReferenceCount: number,
  onTokenHover: (
    token: ReferenceTokenMatch,
    event: ReactMouseEvent<HTMLSpanElement>
  ) => void,
  onTokenLeave: () => void,
  onTokenMouseDown: (
    tokenEnd: number,
    event: ReactMouseEvent<HTMLSpanElement>
  ) => void
): ReactNode {
  if (!prompt) {
    return ' ';
  }

  const segments: ReactNode[] = [];
  let lastIndex = 0;
  const referenceTokens = findReferenceTokens(prompt, maxReferenceCount);
  for (const token of referenceTokens) {
    if (token.start > lastIndex) {
      segments.push(
        <span key={`hover-plain-${lastIndex}`} className="text-transparent">
          {prompt.slice(lastIndex, token.start)}
        </span>
      );
    }

    segments.push(
      <span
        key={`hover-token-${token.start}`}
        className="pointer-events-auto cursor-help select-none text-transparent"
        onMouseEnter={(event) => onTokenHover(token, event)}
        onMouseMove={(event) => onTokenHover(token, event)}
        onMouseLeave={onTokenLeave}
        onMouseDown={(event) => onTokenMouseDown(token.end, event)}
      >
        {token.token}
      </span>
    );
    lastIndex = token.end;
  }

  if (lastIndex < prompt.length) {
    segments.push(
      <span key={`hover-plain-${lastIndex}`} className="text-transparent">
        {prompt.slice(lastIndex)}
      </span>
    );
  }

  return segments;
}

function ReferenceVisualCard({ item }: { item: ReferenceVisualItem }) {
  return (
    <div className="flex w-[136px] shrink-0 self-start flex-col gap-1.5 rounded-xl border border-white/10 bg-white/[0.04] p-2">
      <div className="relative overflow-hidden rounded-lg border border-white/10 bg-black/30">
        <div className="aspect-[4/3] w-full">
          {item.displayUrl ? (
            <CanvasNodeImage
              src={item.displayUrl}
              alt={item.label}
              viewerSourceUrl={item.displayUrl}
              className="h-full w-full object-cover"
              draggable={false}
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-text-muted">
              {item.kind === 'video' ? (
                <Video className="h-5 w-5" />
              ) : (
                <ImageIcon className="h-5 w-5" />
              )}
            </div>
          )}
        </div>
        <div className="pointer-events-none absolute left-2 top-2 inline-flex h-6 w-6 items-center justify-center rounded-full bg-black/55 text-white">
          {item.kind === 'video' ? (
            <Video className="h-3.5 w-3.5" />
          ) : (
            <ImageIcon className="h-3.5 w-3.5" />
          )}
        </div>
      </div>
      <div className="min-w-0">
        <div className="truncate text-[11px] font-medium text-text-dark">
          {item.tokenLabel}
        </div>
        <div className="truncate text-[10px] text-text-muted">
          {item.label}
        </div>
      </div>
    </div>
  );
}

export const GptBestVideoNode = memo(
  ({ id, data, selected, width, height, type }: GptBestVideoNodeProps) => {
    const { t, i18n } = useTranslation();
    const isOverviewRender = useIsOverviewCanvasRender();
    const zoom = useCanvasZoom();
    const connectedVisuals = useCanvasConnectedReferenceVisuals(id);
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
    const promptPanelRef = useRef<HTMLDivElement>(null);
    const promptPreviewHostRef = useRef<HTMLDivElement>(null);
    const promptRef = useRef<HTMLTextAreaElement>(null);
    const promptHighlightRef = useRef<HTMLDivElement>(null);
    const promptHoverLayerRef = useRef<HTMLDivElement>(null);
    const promptCompositionRef = useRef(false);
    const [promptDraft, setPromptDraft] = useState(() => data.prompt ?? '');
    const promptDraftRef = useRef(promptDraft);
    const pickerItemRefs = useRef<Array<HTMLButtonElement | null>>([]);
    const lastPromptSelectionRef = useRef<TextSelectionRange | null>(null);
    const pickerSelectionRef = useRef<TextSelectionRange | null>(null);
    const modelTriggerRef = useRef<HTMLDivElement>(null);
    const modelPanelRef = useRef<HTMLDivElement>(null);
    const [isOptimizingPrompt, setIsOptimizingPrompt] = useState(false);
    const [promptOptimizationError, setPromptOptimizationError] = useState<string | null>(null);
    const [lastPromptOptimizationMeta, setLastPromptOptimizationMeta] =
      useState<PromptOptimizationMeta | null>(null);
    const [lastPromptOptimizationUndoState, setLastPromptOptimizationUndoState] =
      useState<PromptOptimizationUndoState | null>(null);
    const [isModelPanelOpen, setIsModelPanelOpen] = useState(false);
    const [modelPanelAnchor, setModelPanelAnchor] = useState<PanelAnchor | null>(null);
    const [missingKeyProviderOpen, setMissingKeyProviderOpen] = useState(false);
    const [showReferencePicker, setShowReferencePicker] = useState(false);
    const [pickerActiveIndex, setPickerActiveIndex] = useState(0);
    const [pickerAnchor, setPickerAnchor] = useState<PickerAnchor>(DEFAULT_PICKER_ANCHOR);
    const [promptReferencePreview, setPromptReferencePreview] =
      useState<PromptReferencePreviewState | null>(null);

    const sourceKind = buildSourceKindForType(type, data);
    const providerId = data.providerId?.trim() || OOPII_VIDEO_PROVIDER_ID;
    const apiKey = thirdPartyVideoApiKeys[OOPII_VIDEO_PROVIDER_ID]?.trim() ?? '';
    const baseUrl = thirdPartyVideoProviderConfig[OOPII_VIDEO_PROVIDER_ID].baseUrl.trim();
    const selectedModelId = normalizeGptBestVideoModel(sourceKind, data.modelId);
    const selectedSeconds = normalizeGptBestVideoSeconds(
      sourceKind,
      selectedModelId,
      data.seconds ?? data.durationSeconds
    );
    const selectedSize = normalizeGptBestVideoSize(
      sourceKind,
      data.size,
      data.aspectRatio,
      data.resolution
    );
    const selectedModelLabel = resolveModelLabel(t, selectedModelId);
    const providerName = t('settings.thirdPartyVideoOopiiName');
    const selectedAspectRatio = normalizeOopiiVideoAspectRatio(data.aspectRatio, selectedSize);
    const selectedResolution = normalizeOopiiVideoResolution(data.resolution);
    const resolvedTitle = useMemo(
      () => resolveNodeDisplayName(
        sourceKind === 'grok' ? CANVAS_NODE_TYPES.gptBestGrokVideo : CANVAS_NODE_TYPES.gptBestSeedance,
        data
      ),
      [data, sourceKind]
    );
    const resolvedWidth = Math.max(
      GPT_BEST_VIDEO_NODE_MIN_WIDTH,
      Math.min(
        GPT_BEST_VIDEO_NODE_MAX_WIDTH,
        Math.round(width ?? GPT_BEST_VIDEO_NODE_DEFAULT_WIDTH)
      )
    );
    const compactResolvedWidth = Math.round(
      resolvedWidth * GPT_BEST_VIDEO_NODE_MAIN_WIDTH_RATIO
    );
    const resolvedHeight = Math.max(
      GPT_BEST_VIDEO_NODE_MIN_HEIGHT,
      Math.min(
        GPT_BEST_VIDEO_NODE_MAX_HEIGHT,
        Math.round(height ?? GPT_BEST_VIDEO_NODE_DEFAULT_HEIGHT)
      )
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
    const modelOptions = useMemo(
      () => OOPII_VIDEO_MODEL_IDS.map((modelId) => ({
        value: modelId,
        label: resolveModelLabel(t, modelId),
      })),
      [t]
    );
    const aspectRatioOptions = useMemo(
      () =>
        OOPII_VIDEO_ASPECT_RATIO_OPTIONS.map((value) => ({
          value,
          label: t(`node.gptBestVideo.aspectRatios.${value}`),
        })),
      [t]
    );
    const secondsOptions = useMemo(
      () =>
        resolveAllowedSecondsForGptBestVideoModel(sourceKind, selectedModelId).map((value) => ({
          value,
          label: `${value}${t('node.gptBestVideo.secondsSuffix')}`,
        })),
      [selectedModelId, sourceKind, t]
    );
    const resolutionOptions = useMemo(
      () =>
        OOPII_VIDEO_RESOLUTION_OPTIONS.map((value) => ({
          value,
          label: t(`node.gptBestVideo.resolutions.${value}`),
        })),
      [t]
    );
    const referenceVisualItems = useMemo<ReferenceVisualItem[]>(
      () =>
        connectedVisuals.filter((item) => item.kind === 'image').map((item, index) => {
          const previewSource = item.previewImageUrl?.trim() || item.referenceUrl.trim();
          return {
            sourceEdgeId: item.sourceEdgeId,
            sourceNodeId: item.sourceNodeId,
            kind: item.kind,
            referenceUrl: item.referenceUrl,
            previewImageUrl: item.previewImageUrl ?? null,
            displayUrl: previewSource || null,
            tokenLabel: buildShortReferenceToken(index),
            label:
              item.kind === 'video'
                ? t('node.gptBestVideo.referenceVideoLabel', { index: index + 1 })
                : t('node.gptBestVideo.referenceImageLabel', { index: index + 1 }),
            durationSeconds: item.durationSeconds ?? null,
          };
        }),
      [connectedVisuals, t]
    );
    const referencePickerItems = useMemo<ReferencePickerItem[]>(
      () =>
        referenceVisualItems.map((item) => ({
          key: `${item.sourceEdgeId}-${item.referenceUrl}-${item.tokenLabel}`,
          tokenLabel: item.tokenLabel,
          label: item.label,
          insertToken: item.tokenLabel,
          displayUrl: item.displayUrl,
          previewKind: item.kind,
          durationSeconds: item.durationSeconds,
        })),
      [referenceVisualItems]
    );
    const connectedImages = useMemo(
      () => connectedVisuals.filter((item) => item.kind === 'image'),
      [connectedVisuals]
    );
    const grokReferenceImageSources = useMemo(
      () => connectedImages.slice(0, 7).map((item) => item.referenceUrl),
      [connectedImages]
    );
    const grokFirstFrameImageSource = grokReferenceImageSources[0] ?? null;
    const connectedVideos = useMemo(
      () => connectedVisuals.filter((item) => item.kind === 'video'),
      [connectedVisuals]
    );
    const selectedModelSupportsReferenceImages = selectedModelId === 'OK-video';
    useEffect(() => {
      const externalPrompt = data.prompt ?? '';
      if (!promptCompositionRef.current && externalPrompt !== promptDraftRef.current) {
        promptDraftRef.current = externalPrompt;
        setPromptDraft(externalPrompt);
      }
    }, [data.prompt]);

    useEffect(() => {
      if (referencePickerItems.length === 0) {
        setShowReferencePicker(false);
        pickerSelectionRef.current = null;
        setPromptReferencePreview(null);
      }
    }, [referencePickerItems.length]);

    useEffect(() => {
      if (!showReferencePicker) {
        return;
      }

      const activeItem = pickerItemRefs.current[pickerActiveIndex];
      activeItem?.scrollIntoView({ block: 'nearest' });
    }, [pickerActiveIndex, showReferencePicker]);

    useEffect(() => {
      if (!showReferencePicker) {
        return;
      }

      const handlePointerDown = (event: MouseEvent) => {
        const target = event.target as Node | null;
        if (
          target &&
          (promptPanelRef.current?.contains(target) ||
            pickerItemRefs.current.some((item) => item?.contains(target)))
        ) {
          return;
        }

        setShowReferencePicker(false);
        pickerSelectionRef.current = null;
      };

      window.addEventListener('mousedown', handlePointerDown);
      return () => {
        window.removeEventListener('mousedown', handlePointerDown);
      };
    }, [showReferencePicker]);

    useEffect(() => {
      if (!isModelPanelOpen) {
        return;
      }

      const handleOutside = (event: MouseEvent) => {
        const target = event.target as Node;
        if (modelTriggerRef.current?.contains(target) || modelPanelRef.current?.contains(target)) {
          return;
        }
        setIsModelPanelOpen(false);
      };

      document.addEventListener('mousedown', handleOutside, true);
      return () => {
        document.removeEventListener('mousedown', handleOutside, true);
      };
    }, [isModelPanelOpen]);

    const updateCurrentNodeData = useCallback(
      (patch: Partial<GptBestVideoNodeData>) => updateNodeData(id, patch),
      [id, updateNodeData]
    );

    const handlePromptChange = useCallback(
      (prompt: string, options?: { commit?: boolean; preserveOptimizationState?: boolean }) => {
        promptDraftRef.current = prompt;
        setPromptDraft(prompt);
        if (options?.commit !== false) {
          updateCurrentNodeData({ prompt, lastError: null });
        } else if (data.lastError) {
          updateCurrentNodeData({ lastError: null });
        }
        setPromptOptimizationError(null);
        if (!options?.preserveOptimizationState) {
          setLastPromptOptimizationMeta(null);
          setLastPromptOptimizationUndoState(null);
        }
      },
      [data.lastError, updateCurrentNodeData]
    );

    const rememberPromptSelection = useCallback((textarea: HTMLTextAreaElement | null) => {
      lastPromptSelectionRef.current = readTextareaSelection(
        textarea,
        textarea?.value.length ?? promptDraftRef.current.length
      );
    }, []);

    const syncPromptHighlightScroll = useCallback(() => {
      if (!promptRef.current || !promptHighlightRef.current) {
        return;
      }

      promptHighlightRef.current.scrollTop = promptRef.current.scrollTop;
      promptHighlightRef.current.scrollLeft = promptRef.current.scrollLeft;
      if (promptHoverLayerRef.current) {
        promptHoverLayerRef.current.scrollTop = promptRef.current.scrollTop;
        promptHoverLayerRef.current.scrollLeft = promptRef.current.scrollLeft;
      }
    }, []);

    const schedulePromptSelectionRestore = useCallback(
      (
        selection: TextSelectionRange | number,
        scrollSnapshot?: TextareaScrollSnapshot | null
      ) => {
        requestAnimationFrame(() => {
          const nextSelection = restoreTextareaSelection(
            promptRef.current,
            selection,
            promptRef.current?.value.length ?? promptDraftRef.current.length,
            { scrollSnapshot, syncScroll: syncPromptHighlightScroll }
          );
          lastPromptSelectionRef.current = nextSelection;
        });
      },
      [syncPromptHighlightScroll]
    );

    const applyPromptAndRestoreCursor = useCallback(
      (
        prompt: string,
        cursor: number,
        options?: { commit?: boolean; preserveOptimizationState?: boolean }
      ) => {
        handlePromptChange(prompt, options);
        schedulePromptSelectionRestore(Math.max(0, Math.min(cursor, prompt.length)));
      },
      [handlePromptChange, schedulePromptSelectionRestore]
    );

    const insertReferenceItem = useCallback(
      (pickerIndex: number) => {
        const pickerItem = referencePickerItems[pickerIndex];
        if (!pickerItem) {
          return;
        }

        const scrollSnapshot = readTextareaScroll(promptRef.current);
        const selection = resolveTextSelection({
          textarea: promptRef.current,
          lastSelection: pickerSelectionRef.current ?? lastPromptSelectionRef.current,
          fallbackLength: promptDraftRef.current.length,
          requireFocus: true,
        });
        const { nextText, nextCursor } = insertReferenceToken(
          promptDraftRef.current,
          selection.start,
          pickerItem.insertToken
        );
        handlePromptChange(nextText);
        setShowReferencePicker(false);
        pickerSelectionRef.current = null;
        setPickerActiveIndex(0);
        setLastPromptOptimizationUndoState(null);
        schedulePromptSelectionRestore(nextCursor, scrollSnapshot);
      },
      [handlePromptChange, referencePickerItems, schedulePromptSelectionRestore]
    );

    const hidePromptReferencePreview = useCallback(() => {
      setPromptReferencePreview(null);
    }, []);

    const handlePromptReferenceTokenHover = useCallback(
      (token: ReferenceTokenMatch, event: ReactMouseEvent<HTMLSpanElement>) => {
        const item = referenceVisualItems[token.value - 1];
        const previewHost = promptPreviewHostRef.current;
        if (!item || !previewHost) {
          setPromptReferencePreview(null);
          return;
        }

        const previewPosition = resolveFloatingPreviewPosition({
          container: previewHost,
          clientX: event.clientX,
          clientY: event.clientY,
          previewWidth: 144,
          previewHeight: 132,
          zoom,
        });

        setPromptReferencePreview({
          displayUrl: item.displayUrl,
          label: item.label,
          kind: item.kind,
          durationSeconds: item.durationSeconds,
          left: previewPosition.left,
          top: previewPosition.top,
        });
      },
      [referenceVisualItems, zoom]
    );

    const handlePromptReferenceTokenMouseDown = useCallback(
      (tokenEnd: number, event: ReactMouseEvent<HTMLSpanElement>) => {
        event.preventDefault();
        event.stopPropagation();
        schedulePromptSelectionRestore(tokenEnd);
      },
      [schedulePromptSelectionRestore]
    );

    const handlePromptKeyDown = useCallback(
      (event: KeyboardEvent<HTMLTextAreaElement>) => {
        if (event.nativeEvent.isComposing || promptCompositionRef.current) {
          return;
        }

        if (event.key === 'Backspace' || event.key === 'Delete') {
          const currentPrompt = promptDraftRef.current;
          const selectionStart = event.currentTarget.selectionStart ?? currentPrompt.length;
          const selectionEnd = event.currentTarget.selectionEnd ?? selectionStart;
          const deleteRange = resolveReferenceAwareDeleteRange(
            currentPrompt,
            selectionStart,
            selectionEnd,
            event.key === 'Backspace' ? 'backward' : 'forward',
            referenceVisualItems.length
          );

          if (deleteRange) {
            event.preventDefault();
            const { nextText, nextCursor } = removeTextRange(currentPrompt, deleteRange);
            handlePromptChange(nextText);
            schedulePromptSelectionRestore(nextCursor);
            return;
          }
        }

        if (showReferencePicker && referencePickerItems.length > 0) {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            event.stopPropagation();
            setPickerActiveIndex((previous) => (previous + 1) % referencePickerItems.length);
            return;
          }

          if (event.key === 'ArrowUp') {
            event.preventDefault();
            event.stopPropagation();
            setPickerActiveIndex((previous) =>
              previous === 0 ? referencePickerItems.length - 1 : previous - 1
            );
            return;
          }

          if (event.key === 'Enter' || event.key === 'Tab') {
            event.preventDefault();
            event.stopPropagation();
            insertReferenceItem(pickerActiveIndex);
            return;
          }
        }

        if (event.key === '@' && referencePickerItems.length > 0) {
          event.preventDefault();
          event.stopPropagation();
          const selection =
            readTextareaSelection(event.currentTarget, promptDraftRef.current.length) ??
            resolveTextSelection({
              textarea: event.currentTarget,
              lastSelection: lastPromptSelectionRef.current,
              fallbackLength: promptDraftRef.current.length,
            });
          lastPromptSelectionRef.current = selection;
          pickerSelectionRef.current = selection;
          setPickerAnchor(
            resolveTextareaPickerAnchor({
              container: promptPanelRef.current,
              textarea: event.currentTarget,
              caretIndex: selection.start,
              yOffset: PICKER_Y_OFFSET_PX,
            })
          );
          setShowReferencePicker(true);
          setPickerActiveIndex(0);
          return;
        }

        if (event.key === 'Escape' && showReferencePicker) {
          event.preventDefault();
          event.stopPropagation();
          setShowReferencePicker(false);
          pickerSelectionRef.current = null;
          setPickerActiveIndex(0);
        }
      },
      [
        handlePromptChange,
        insertReferenceItem,
        pickerActiveIndex,
        referencePickerItems.length,
        referenceVisualItems.length,
        schedulePromptSelectionRestore,
        showReferencePicker,
      ]
    );

    const insertPromptText = useCallback(
      (text: string) => {
        const textarea = promptRef.current;
        const sourcePrompt = promptDraftRef.current;
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
      [applyPromptAndRestoreCursor]
    );

    const handleOptimizePrompt = useCallback(async () => {
      const sourcePrompt = promptDraftRef.current;
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
            .map((item) => item.previewImageUrl ?? item.referenceUrl)
            .filter((item): item is string => Boolean(item)),
        });
        const nextPrompt = result.prompt;
        setLastPromptOptimizationMeta({
          modelLabel: [result.context.provider, result.context.model]
            .filter(Boolean)
            .join(' / '),
          referenceImageCount: result.usedReferenceImageCount,
        });
        if (nextPrompt !== sourcePrompt) {
          setLastPromptOptimizationUndoState({
            previousPrompt: sourcePrompt,
            appliedPrompt: nextPrompt,
          });
        } else {
          setLastPromptOptimizationUndoState(null);
        }
        applyPromptAndRestoreCursor(nextPrompt, nextPrompt.length, {
          preserveOptimizationState: true,
        });
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
    }, [applyPromptAndRestoreCursor, connectedImages, t, updateCurrentNodeData]);

    const handleUndoOptimizedPrompt = useCallback(() => {
      if (!lastPromptOptimizationUndoState) {
        return;
      }
      if (promptDraftRef.current !== lastPromptOptimizationUndoState.appliedPrompt) {
        return;
      }
      setPromptOptimizationError(null);
      setLastPromptOptimizationMeta(null);
      setLastPromptOptimizationUndoState(null);
      applyPromptAndRestoreCursor(
        lastPromptOptimizationUndoState.previousPrompt,
        lastPromptOptimizationUndoState.previousPrompt.length
      );
    }, [applyPromptAndRestoreCursor, lastPromptOptimizationUndoState]);

    const validateGenerationRequest = useCallback((): string | null => {
      if (!apiKey) {
        return t('node.gptBestVideo.apiKeyRequired');
      }
      if (!baseUrl) {
        return t('node.gptBestVideo.baseUrlRequired');
      }
      if (!promptDraft.trim()) {
        return t('node.gptBestVideo.promptRequired');
      }
      if (connectedVideos.length > 0) {
        return t('node.gptBestVideo.referenceVideoUnsupportedError');
      }
      if (connectedImages.length > 7) {
        return t('node.gptBestVideo.grokImageLimit', { count: 7 });
      }
      if (connectedImages.length > 0 && !selectedModelSupportsReferenceImages) {
        return t('node.gptBestVideo.referenceUnsupportedErrorProtocol');
      }

      const allowedSeconds = resolveAllowedSecondsForGptBestVideoModel(sourceKind, selectedModelId);
      if (!allowedSeconds.includes(selectedSeconds)) {
        return t('node.gptBestVideo.invalidSecondsForModel', {
          model: selectedModelLabel,
        });
      }

      return null;
    }, [
      apiKey,
      baseUrl,
      connectedImages.length,
      connectedVideos.length,
      promptDraft,
      selectedModelId,
      selectedModelLabel,
      selectedModelSupportsReferenceImages,
      selectedSeconds,
      sourceKind,
      t,
    ]);

    const handleGenerate = useCallback(async () => {
      closeShotParamsPanel();
      const validationError = validateGenerationRequest();
      if (validationError) {
        updateCurrentNodeData({ isSubmitting: false, lastError: validationError });
        if (!apiKey || !baseUrl) {
          openSettingsDialog({
            category: 'providers',
            providerTab: 'thirdPartyVideo',
            providerId: OOPII_VIDEO_PROVIDER_ID,
          });
        }
        await showErrorDialog(validationError, t('common.error'));
        return;
      }

      const startedAt = Date.now();
      let createdResultNodeId: string | null = null;
      updateCurrentNodeData({ isSubmitting: true, lastError: null });

      try {
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
            provider: providerId,
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
            size: selectedSize,
            resolution: selectedResolution,
            duration: selectedSeconds,
            requestSnapshot: {
              provider: providerId,
              sourceKind,
              modelId: selectedModelId,
              prompt: promptDraft.trim(),
              size: selectedSize,
              seconds: selectedSeconds,
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
          prompt: promptDraft,
          modelId: selectedModelId,
          seconds: selectedSeconds,
          size: selectedSize,
          legacyAspectRatio: data.aspectRatio,
          legacyResolution: data.resolution,
          firstFrameImageSource: selectedModelSupportsReferenceImages
            ? grokFirstFrameImageSource
            : null,
          referenceImageSources: selectedModelSupportsReferenceImages
            ? grokReferenceImageSources
            : [],
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
          prompt: promptDraft,
          providerId,
          modelId: selectedModelId,
          size: selectedSize,
          seconds: selectedSeconds,
          aspectRatio: selectedAspectRatio,
          durationSeconds: selectedSeconds,
          resolution: selectedResolution,
        });
        await flushCurrentProjectToDiskSafely('saving third-party video task id');
      } catch (error) {
        const content = resolveErrorContent(error, t('node.gptBestVideo.submitFailed'));
        const inlineError = content.rawMessage ?? content.details ?? content.message;
        updateCurrentNodeData({
          isSubmitting: false,
          lastError: inlineError,
        });
        if (createdResultNodeId) {
          updateNodeData(createdResultNodeId, {
            isGenerating: false,
            generationStartedAt: null,
            taskStatus: 'failed',
            lastError: inlineError,
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
      grokFirstFrameImageSource,
      grokReferenceImageSources,
      data.aspectRatio,
      data.resolution,
      findNodePosition,
      id,
      promptDraft,
      providerId,
      selectedAspectRatio,
      selectedModelId,
      selectedModelSupportsReferenceImages,
      selectedResolution,
      selectedSeconds,
      selectedSize,
      sourceKind,
      t,
      updateCurrentNodeData,
      updateNodeData,
      validateGenerationRequest,
    ]);

    const combinedError = promptOptimizationError ?? data.lastError ?? null;
    const canUndoPromptOptimization = Boolean(
      lastPromptOptimizationUndoState &&
      promptDraft === lastPromptOptimizationUndoState.appliedPrompt
    );
    const promptOptimizationNotice = lastPromptOptimizationMeta
      ? `${t('node.gptBestVideo.optimizeModelLabel', {
          model: lastPromptOptimizationMeta.modelLabel,
        })} | ${t('node.gptBestVideo.optimizeReferenceImagesLabel', {
          status:
            lastPromptOptimizationMeta.referenceImageCount > 0
              ? t('node.gptBestVideo.optimizeReferenceImagesUsed', {
                  count: lastPromptOptimizationMeta.referenceImageCount,
                })
              : t('node.gptBestVideo.optimizeReferenceImagesUnused'),
        })}`
      : null;
    const referenceUnsupportedMessage = selectedModelSupportsReferenceImages
      ? t('node.gptBestVideo.referenceUnsupported')
      : t('node.gptBestVideo.referenceUnsupportedProtocol');
    const referenceUnsupportedConnectedMessage = connectedVideos.length > 0
      ? t('node.gptBestVideo.referenceVideoUnsupportedConnected', { count: connectedVideos.length })
      : selectedModelSupportsReferenceImages
        ? t('node.gptBestVideo.referenceUnsupportedConnected', { count: connectedImages.length })
        : t('node.gptBestVideo.referenceUnsupportedConnectedProtocol', { count: connectedImages.length });
    const statusInfoText =
      combinedError
      ?? (promptOptimizationNotice
        ?? (connectedImages.length > 0
        ? referenceUnsupportedConnectedMessage
        : data.isSubmitting
          ? t('node.gptBestVideo.submitting')
          : lastSubmittedTime
            ? t('node.gptBestVideo.lastSubmitted', { time: lastSubmittedTime })
            : t('node.gptBestVideo.oopiiHint')));
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
        className={`canvas-node-selection-pass-through group relative flex flex-col overflow-visible rounded-[var(--node-radius)] bg-transparent p-0 transition-colors duration-150 ${
          selected
            ? 'shadow-[0_4px_20px_rgba(59,130,246,0.16)]'
            : ''
        }`}
        style={{ width: `${compactResolvedWidth}px`, height: `${resolvedHeight}px` }}
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

        <div
          ref={promptPanelRef}
          className={`relative min-h-0 flex-1 rounded-[var(--node-radius)] border bg-surface-dark/90 px-3 py-3 ${
            selected
              ? 'border-accent shadow-[0_0_0_2px_rgba(59,130,246,0.5),0_4px_20px_rgba(59,130,246,0.2)]'
              : 'border-[rgba(15,23,42,0.22)] hover:border-[rgba(15,23,42,0.34)] hover:shadow-[0_4px_16px_rgba(0,0,0,0.12)] dark:border-[rgba(255,255,255,0.22)] dark:hover:border-[rgba(255,255,255,0.34)] dark:hover:shadow-[0_4px_16px_rgba(0,0,0,0.25)]'
          }`}
        >
          {isOverviewRender ? (
            <div className="h-full min-h-0 overflow-hidden text-sm leading-6 text-text-muted">
              <div className="line-clamp-6 whitespace-pre-wrap">
                {promptDraft.trim() || (sourceKind === 'grok'
                  ? t('node.gptBestVideo.grokPromptPlaceholder')
                  : t('node.gptBestVideo.seedancePromptPlaceholder'))}
              </div>
            </div>
          ) : (
            <div
              ref={promptPreviewHostRef}
              className="relative min-h-[148px] flex-1"
            >
              <div
                ref={promptHighlightRef}
                aria-hidden="true"
                className="ui-scrollbar pointer-events-none absolute inset-0 overflow-y-auto overflow-x-hidden text-sm leading-6 text-text-dark"
                style={{ scrollbarGutter: 'stable' }}
              >
                <div className="canvas-textarea-wrap min-h-full rounded-[var(--node-radius)] border border-transparent px-0.5 py-0">
                  {renderPromptWithHighlights(promptDraft, referenceVisualItems.length)}
                </div>
              </div>

              <div
                ref={promptHoverLayerRef}
                aria-hidden="true"
                className="ui-scrollbar pointer-events-none absolute inset-0 z-20 overflow-y-auto overflow-x-hidden text-sm leading-6 text-transparent"
                style={{ scrollbarGutter: 'stable' }}
              >
                <div className="canvas-textarea-wrap min-h-full rounded-[var(--node-radius)] border border-transparent px-0.5 py-0">
                  {renderPromptReferenceHoverTargets(
                    promptDraft,
                    referenceVisualItems.length,
                    handlePromptReferenceTokenHover,
                    hidePromptReferencePreview,
                    handlePromptReferenceTokenMouseDown
                  )}
                </div>
              </div>

              <textarea
                ref={promptRef}
                value={promptDraft}
                onChange={(event) => {
                  handlePromptChange(event.target.value, {
                    commit: !promptCompositionRef.current,
                  });
                  rememberPromptSelection(event.currentTarget);
                }}
                onCompositionStart={() => {
                  promptCompositionRef.current = true;
                }}
                onCompositionEnd={(event) => {
                  promptCompositionRef.current = false;
                  handlePromptChange(event.currentTarget.value);
                  rememberPromptSelection(event.currentTarget);
                }}
                onBlur={(event) => {
                  if (event.currentTarget.value !== data.prompt) {
                    handlePromptChange(event.currentTarget.value);
                  }
                }}
                placeholder={sourceKind === 'grok'
                  ? t('node.gptBestVideo.grokPromptPlaceholder')
                  : t('node.gptBestVideo.seedancePromptPlaceholder')}
                className="canvas-textarea-wrap canvas-textarea-mirror-input ui-scrollbar nodrag nowheel relative z-10 h-full w-full resize-none rounded-[var(--node-radius)] border border-transparent bg-transparent px-0.5 py-0 text-sm leading-6 text-transparent outline-none placeholder:text-text-muted/70 selection:bg-accent/30 selection:text-transparent caret-text-dark focus:border-transparent"
                style={{ scrollbarGutter: 'stable' }}
                spellCheck={false}
                onScroll={syncPromptHighlightScroll}
                onMouseDown={(event) => {
                  event.stopPropagation();
                  hidePromptReferencePreview();
                }}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => event.stopPropagation()}
                onSelect={(event) => rememberPromptSelection(event.currentTarget)}
                onMouseUp={(event) => rememberPromptSelection(event.currentTarget)}
                onKeyUp={(event) => rememberPromptSelection(event.currentTarget)}
                onKeyDownCapture={handlePromptKeyDown}
              />

              {promptReferencePreview ? (
                <div
                  className="pointer-events-none absolute z-30 w-fit overflow-hidden rounded-xl shadow-[0_12px_28px_rgba(0,0,0,0.28)]"
                  style={{
                    left: `${promptReferencePreview.left}px`,
                    top: `${promptReferencePreview.top}px`,
                  }}
                >
                  <ReferenceVisualCard
                    item={{
                      sourceEdgeId: '',
                      sourceNodeId: '',
                      kind: promptReferencePreview.kind,
                      referenceUrl: promptReferencePreview.displayUrl ?? '',
                      previewImageUrl: promptReferencePreview.displayUrl,
                      displayUrl: promptReferencePreview.displayUrl,
                      label: promptReferencePreview.label,
                      durationSeconds: promptReferencePreview.durationSeconds,
                      tokenLabel: '',
                    }}
                  />
                </div>
              ) : null}
            </div>
          )}

          {showReferencePicker && referencePickerItems.length > 0 ? (
            <div
              className="nowheel absolute z-30 w-[168px] overflow-hidden rounded-xl border border-[rgba(255,255,255,0.16)] bg-surface-dark shadow-xl"
              style={{ left: pickerAnchor.left, top: pickerAnchor.top }}
              onMouseDown={(event) => event.stopPropagation()}
              onWheelCapture={(event) => event.stopPropagation()}
            >
              <div
                className="ui-scrollbar nowheel max-h-[220px] overflow-y-auto"
                onWheelCapture={(event) => event.stopPropagation()}
                role="listbox"
              >
                {referencePickerItems.map((item, index) => (
                  <button
                    key={item.key}
                    ref={(node) => {
                      pickerItemRefs.current[index] = node;
                    }}
                    type="button"
                    role="option"
                    aria-selected={index === pickerActiveIndex}
                    className={`flex w-full items-center gap-2 px-2 py-2 text-left text-xs transition-colors ${
                      index === pickerActiveIndex
                        ? 'bg-accent/18 text-text-dark'
                        : 'text-text-muted hover:bg-white/[0.06] hover:text-text-dark'
                    }`}
                    onMouseEnter={() => setPickerActiveIndex(index)}
                    onMouseDown={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                    }}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      insertReferenceItem(index);
                    }}
                  >
                    <div className="relative h-9 w-9 shrink-0 overflow-hidden rounded-md border border-white/10 bg-black/35">
                      {item.displayUrl ? (
                        <CanvasNodeImage
                          src={item.displayUrl}
                          alt={item.label}
                          className="h-full w-full object-cover"
                          disableViewer
                          draggable={false}
                        />
                      ) : item.previewKind === 'video' ? (
                        <Video className="m-2 h-5 w-5 text-text-muted" />
                      ) : (
                        <ImageIcon className="m-2 h-5 w-5 text-text-muted" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="truncate font-medium text-text-dark">
                        {item.tokenLabel}
                      </div>
                      <div className="truncate text-[10px] text-text-muted">
                        {item.label}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>

        {selected && !isOverviewRender ? (
          <div
            className="nodrag nowheel nopan pointer-events-auto absolute left-1/2 top-[calc(100%+10px)] z-30 w-max max-w-[166.6667%] -translate-x-1/2 rounded-[var(--node-radius)] border border-[rgba(15,23,42,0.24)] bg-surface-dark/95 p-2 shadow-[0_16px_34px_rgba(15,23,42,0.18)] dark:border-[rgba(255,255,255,0.22)] dark:shadow-[0_18px_42px_rgba(0,0,0,0.34)]"
            onClick={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()}
            onWheelCapture={(event) => event.stopPropagation()}
          >
            <div className="mb-2 rounded-[var(--node-radius)] border border-white/10 bg-bg-dark/50 p-3">
            <div className="mb-2 flex items-center justify-between gap-2 text-xs text-text-muted">
              <span>{t('node.gptBestVideo.referenceStatusLabel')}</span>
              {connectedImages.length > 0 ? (
                <span>{referenceUnsupportedConnectedMessage}</span>
              ) : null}
            </div>
            {referenceVisualItems.length > 0 ? (
              <div className="flex gap-2 overflow-x-auto pb-1">
                {referenceVisualItems.slice(0, 9).map((item) => (
                  <div
                    key={`${item.sourceEdgeId}-${item.referenceUrl}`}
                    className="relative h-16 w-20 shrink-0 overflow-hidden rounded-md border border-white/10 bg-black"
                  >
                    {item.displayUrl ? (
                      <CanvasNodeImage
                        src={item.displayUrl}
                        fallbackSrc={item.referenceUrl}
                        alt={item.label}
                        className="h-full w-full object-cover"
                        disableViewer
                        draggable={false}
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center bg-bg-dark">
                        {item.kind === 'video' ? (
                          <Video className="h-5 w-5 text-text-muted" />
                        ) : (
                          <ImageIcon className="h-5 w-5 text-text-muted" />
                        )}
                      </div>
                    )}
                    <div className="absolute left-1 top-1 rounded bg-black/65 px-1.5 py-0.5 text-[10px] text-white">
                      {item.kind === 'image' ? (
                        <ImageIcon className="inline h-3 w-3" />
                      ) : (
                        <Video className="inline h-3 w-3" />
                      )}
                    </div>
                    <div className="absolute bottom-1 left-1 max-w-[calc(100%-0.5rem)] truncate rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-medium text-white">
                      {item.tokenLabel}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-md border border-dashed border-white/10 px-3 py-4 text-center text-xs text-text-muted">
                {referenceUnsupportedMessage}
              </div>
            )}

            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-start gap-2">
                <div className="ui-scrollbar nodrag nowheel nopan max-w-full shrink-0 cursor-default overflow-x-auto overflow-y-hidden">
                  <div className="flex w-max items-center gap-1.5 pr-1">
                  <div ref={modelTriggerRef} className="shrink-0">
                    <UiChipButton
                      active={isModelPanelOpen}
                      className={`${NODE_CONTROL_CHIP_CLASS} max-w-[240px] justify-start`}
                      onMouseDown={stopInteractionPropagation}
                      onPointerDown={stopInteractionPropagation}
                      onClick={(event) => {
                        event.stopPropagation();
                        if (isModelPanelOpen) {
                          setIsModelPanelOpen(false);
                          return;
                        }
                        setModelPanelAnchor(getPanelAnchor(modelTriggerRef.current));
                        setIsModelPanelOpen(true);
                      }}
                    >
                      <span className="min-w-0 truncate text-[11px] font-medium">{selectedModelLabel}</span>
                      <span className="shrink-0 text-[10px] text-text-muted/80">{providerName}</span>
                    </UiChipButton>
                  </div>
                  <FixedControlChip
                    label={t('node.gptBestVideo.durationLabel')}
                    value={selectedSeconds}
                    options={secondsOptions}
                    disabled={secondsOptions.length === 1}
                    onChange={(value) =>
                      updateCurrentNodeData({
                        seconds: value,
                        durationSeconds: value,
                        lastError: null,
                      })
                    }
                  />
                  <FixedControlChip
                    label={t('node.gptBestVideo.aspectRatioLabel')}
                    value={selectedAspectRatio}
                    options={aspectRatioOptions}
                    onChange={(value) =>
                      updateCurrentNodeData({
                        size: resolveOopiiVideoSizeFromDisplayOptions(value, selectedResolution),
                        aspectRatio: value,
                        resolution: selectedResolution,
                        lastError: null,
                      })
                    }
                  />
                  <FixedControlChip
                    label={t('node.gptBestVideo.resolutionLabel')}
                    value={selectedResolution}
                    options={resolutionOptions}
                    disabled={resolutionOptions.length === 1}
                    onChange={(value) =>
                      updateCurrentNodeData({
                        size: resolveOopiiVideoSizeFromDisplayOptions(selectedAspectRatio, value),
                        resolution: value,
                        aspectRatio: selectedAspectRatio,
                        lastError: null,
                      })
                    }
                  />
                  <StyleTemplatePicker
                    className={`${NODE_CONTROL_CHIP_CLASS} shrink-0 !w-8 !px-0 justify-center`}
                    onTemplateApply={(template) => {
                      const nextPrompt = appendStyleTemplatePrompt(promptDraftRef.current, template.prompt);
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
                    disabled={isOptimizingPrompt || promptDraft.trim().length === 0}
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
                variant="primary"
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
          </div>
        ) : null}

        {typeof document !== 'undefined' && isModelPanelOpen && createPortal(
          <div
            ref={modelPanelRef}
            className="fixed z-[80]"
            style={buildPanelStyle(modelPanelAnchor)}
            onMouseDown={stopInteractionPropagation}
            onPointerDown={stopInteractionPropagation}
          >
            <UiPanel className="w-[560px] max-w-[calc(100vw-32px)] overflow-visible p-2">
              <div className="space-y-4 overflow-visible pl-1 pr-2 pt-2 pb-1">
                <section className="overflow-visible pr-1">
                  <div className="mb-2 text-xs font-medium text-text-muted">
                    {t('modelParams.provider')}
                  </div>
                  <div className="grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] items-start gap-2 overflow-visible">
                    <button
                      type="button"
                      className="relative flex h-8 items-center justify-center rounded-lg border border-accent/50 bg-accent/15 px-3 text-xs text-text-dark"
                      onClick={(event) => {
                        event.stopPropagation();
                        if (!apiKey) {
                          setIsModelPanelOpen(false);
                          setMissingKeyProviderOpen(true);
                        }
                      }}
                    >
                      <span className="block min-w-0 truncate">{providerName}</span>
                    </button>
                  </div>
                </section>

                <section>
                  <div className="mb-2 text-xs font-medium text-text-muted">
                    {t('modelParams.model')}
                  </div>
                  <div className="ui-scrollbar max-h-[220px] overflow-y-auto pr-1">
                    <div className="grid grid-cols-2 gap-2 pb-1">
                      {modelOptions.map((option) => {
                        const active = option.value === selectedModelId;
                        return (
                          <button
                            key={option.value}
                            type="button"
                            className={`inline-flex max-w-full items-center justify-center rounded-lg border px-2 py-2 text-xs leading-4 transition-colors ${
                              active
                                ? 'border-accent/50 bg-accent/15 text-text-dark shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]'
                                : 'border-[rgba(255,255,255,0.12)] bg-bg-dark/65 text-text-muted hover:border-[rgba(255,255,255,0.2)] hover:bg-[rgba(255,255,255,0.05)]'
                            }`}
                            onClick={(event) => {
                              event.stopPropagation();
                              const normalizedSeconds = normalizeGptBestVideoSeconds(
                                sourceKind,
                                option.value,
                                data.seconds ?? data.durationSeconds
                              );
                              updateCurrentNodeData({
                                providerId: OOPII_VIDEO_PROVIDER_ID,
                                modelId: option.value,
                                seconds: normalizedSeconds,
                                durationSeconds: normalizedSeconds,
                                lastError: null,
                              });
                              setIsModelPanelOpen(false);
                            }}
                          >
                            <span className="max-w-full truncate text-center">{option.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </section>
              </div>
            </UiPanel>
          </div>,
          document.body
        )}

        {isShotParamsPanelOpen && selected && !isOverviewRender ? (
          <ShotParamsPanel
            onClose={closeShotParamsPanel}
            onInsert={(option) => insertPromptText(option.value)}
          />
        ) : null}

        {typeof document !== 'undefined' && createPortal(
          <UiModal
            isOpen={missingKeyProviderOpen}
            title={t('modelParams.providerKeyRequiredTitle')}
            onClose={() => setMissingKeyProviderOpen(false)}
            widthClassName="w-[420px]"
            containerClassName="z-[120]"
            footer={(
              <>
                <UiButton
                  variant="muted"
                  size="sm"
                  onClick={() => setMissingKeyProviderOpen(false)}
                >
                  {t('common.cancel')}
                </UiButton>
                <UiButton
                  variant="primary"
                  size="sm"
                  onClick={() => {
                    setMissingKeyProviderOpen(false);
                    openSettingsDialog({
                      category: 'providers',
                      providerTab: 'thirdPartyVideo',
                      providerId: OOPII_VIDEO_PROVIDER_ID,
                    });
                  }}
                >
                  {t('modelParams.goConfigure')}
                </UiButton>
              </>
            )}
          >
            <p className="text-sm text-text-muted">
              {t('modelParams.providerKeyRequiredDesc', {
                provider: providerName,
              })}
            </p>
          </UiModal>,
          document.body
        )}

        <CanvasHandle
          type="target"
          id="target"
          position={Position.Left}
          className="!border-2 !border-surface-dark !bg-accent"
        />
        <CanvasHandle
          type="source"
          id="source"
          position={Position.Right}
          className="!border-2 !border-surface-dark !bg-accent"
        />
        <NodeResizeHandle
          minWidth={GPT_BEST_VIDEO_NODE_MIN_WIDTH}
          minHeight={GPT_BEST_VIDEO_NODE_MIN_HEIGHT}
          maxWidth={GPT_BEST_VIDEO_NODE_MAX_WIDTH}
          maxHeight={GPT_BEST_VIDEO_NODE_MAX_HEIGHT}
        />
      </div>
    );
  }
);

GptBestVideoNode.displayName = 'GptBestVideoNode';

export const GptBestSeedanceNode = GptBestVideoNode;
export const GptBestGrokVideoNode = GptBestVideoNode;
