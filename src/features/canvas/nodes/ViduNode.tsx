import {
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Image as ImageIcon, Loader2, Music4, Sparkles, TriangleAlert, Undo2, Video, Wand2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { UiButton, UiChipButton, UiSelect } from '@/components/ui';
import { detectImageDimensions, reduceAspectRatio } from '@/features/canvas/application/imageData';
import { showErrorDialog } from '@/features/canvas/application/errorDialog';
import { flushCurrentProjectToDiskSafely } from '@/features/canvas/application/projectPersistence';
import { optimizeCanvasPrompt } from '@/features/canvas/application/promptOptimization';
import {
  buildShortReferenceToken,
  insertReferenceToken,
  removeTextRange,
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
import { formatVideoTime } from '@/features/canvas/application/videoData';
import {
  CANVAS_NODE_TYPES,
  VIDU_ASPECT_RATIOS,
  VIDU_DURATION_SECONDS,
  VIDU_RESOLUTIONS,
  VIDU_VIDEO_NODE_DEFAULT_HEIGHT,
  VIDU_VIDEO_NODE_DEFAULT_WIDTH,
  VIDU_VIDEO_NODE_MIN_HEIGHT,
  VIDU_VIDEO_NODE_MIN_WIDTH,
  VIDU_VIDEO_RESULT_NODE_DEFAULT_HEIGHT,
  VIDU_VIDEO_RESULT_NODE_DEFAULT_WIDTH,
  type ViduNodeData,
} from '@/features/canvas/domain/canvasNodes';
import { resolveNodeDisplayName } from '@/features/canvas/domain/nodeDisplay';
import {
  useCanvasConnectedAudioReferences,
  useCanvasConnectedReferenceVisuals,
  useCanvasNodeById,
} from '@/features/canvas/hooks/useCanvasNodeGraph';
import { useCanvasZoom } from '@/features/canvas/hooks/useCanvasZoom';
import { CanvasNodeImage } from '@/features/canvas/ui/CanvasNodeImage';
import {
  useIsOverviewCanvasRender,
  useShouldSuspendCanvasMedia,
} from '@/features/canvas/CanvasPerformanceContext';
import { CameraTriggerIcon } from '@/features/canvas/ui/CameraTriggerIcon';
import { NodeHeader, NODE_HEADER_FLOATING_POSITION_CLASS } from '@/features/canvas/ui/NodeHeader';
import { NodeResizeHandle } from '@/features/canvas/ui/NodeResizeHandle';
import { NodeStatusBadge } from '@/features/canvas/ui/NodeStatusBadge';
import { ShotParamsPanel } from '@/features/canvas/ui/ShotParamsPanel';
import {
  NODE_CONTROL_CHIP_CLASS,
  NODE_CONTROL_PRIMARY_BUTTON_CLASS,
} from '@/features/canvas/ui/nodeControlStyles';
import { PROMPT_REFERENCE_TOKEN_HIGHLIGHT_CLASS } from '@/features/canvas/ui/promptReferenceTokenStyles';
import { StyleTemplatePicker } from '@/features/project/StyleTemplatePicker';
import { appendStyleTemplatePrompt } from '@/features/project/styleTemplatePrompt';
import { openSettingsDialog } from '@/features/settings/settingsEvents';
import { submitViduVideoTask } from '@/features/vidu/application/viduVideoSubmission';
import { resolveViduErrorContent } from '@/features/vidu/application/viduError';
import {
  VIDU_INPUT_MODE_OPTIONS,
  VIDU_MAX_REFERENCE_IMAGE_COUNT,
  VIDU_MAX_REFERENCE_VIDEO_COUNT,
  VIDU_REFERENCE_VIDEO_MODEL_ID,
  getViduModelOptions,
  isViduQ3Model,
  normalizeViduAspectRatio,
  normalizeViduDurationSeconds,
  normalizeViduInputMode,
  normalizeViduModelIdForInputMode,
  normalizeViduResolution,
} from '@/features/vidu/domain/viduOptions';
import { useCanvasStore } from '@/stores/canvasStore';
import { useSettingsStore } from '@/stores/settingsStore';

type ViduNodeProps = NodeProps & {
  id: string;
  data: ViduNodeData;
  selected?: boolean;
};

interface ViduOption<T extends string | number | boolean> {
  value: T;
  labelKey: string;
}

interface PromptOptimizationUndoState {
  previousPrompt: string;
  appliedPrompt: string;
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

interface ViduPromptReferenceToken {
  start: number;
  end: number;
  token: string;
  value: number;
}

interface ViduPromptTokenRange {
  start: number;
  end: number;
  blockStart: number;
  blockEnd: number;
}

const PICKER_Y_OFFSET_PX = 20;
const VIDEO_REFERENCE_TOKEN_PREFIX = '@视频';
const VIDU_VISUAL_REFERENCE_TOKEN_PREFIXES = ['@图片', '@图', VIDEO_REFERENCE_TOKEN_PREFIX] as const;

function buildVideoReferenceToken(referenceIndex: number): string {
  return `${VIDEO_REFERENCE_TOKEN_PREFIX}${referenceIndex + 1}`;
}

function clampIndex(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function isAsciiDigit(char: string): boolean {
  return char >= '0' && char <= '9';
}

function resolveReferenceTokenPrefix(text: string, index: number): string | null {
  for (const prefix of VIDU_VISUAL_REFERENCE_TOKEN_PREFIXES) {
    if (text.startsWith(prefix, index)) {
      return prefix;
    }
  }
  return null;
}

function findViduPromptReferenceTokens(prompt: string, maxReferenceCount: number): ViduPromptReferenceToken[] {
  const maxReferenceNumber = Math.max(0, Math.floor(maxReferenceCount));
  const tokens: ViduPromptReferenceToken[] = [];

  for (let index = 0; index < prompt.length; index += 1) {
    const matchedPrefix = resolveReferenceTokenPrefix(prompt, index);
    if (!matchedPrefix) {
      continue;
    }

    const digitsStart = index + matchedPrefix.length;
    if (!isAsciiDigit(prompt[digitsStart] ?? '')) {
      continue;
    }

    let digitsEnd = digitsStart;
    let value = 0;
    let bestEnd = -1;
    let bestValue = 0;
    while (isAsciiDigit(prompt[digitsEnd] ?? '')) {
      value = value * 10 + Number(prompt[digitsEnd]);
      if (value >= 1 && value <= maxReferenceNumber) {
        bestEnd = digitsEnd + 1;
        bestValue = value;
      }
      if (value > maxReferenceNumber) {
        break;
      }
      digitsEnd += 1;
    }

    if (bestEnd > 0) {
      tokens.push({
        start: index,
        end: bestEnd,
        token: prompt.slice(index, bestEnd),
        value: bestValue,
      });
      index = bestEnd - 1;
    }
  }

  return tokens;
}

function findViduPromptTokenRanges(prompt: string, maxReferenceCount: number): ViduPromptTokenRange[] {
  return findViduPromptReferenceTokens(prompt, maxReferenceCount).map((token) => ({
    start: token.start,
    end: token.end,
    blockStart: token.start > 0 && prompt[token.start - 1] === ' ' ? token.start - 1 : token.start,
    blockEnd: token.end < prompt.length && prompt[token.end] === ' ' ? token.end + 1 : token.end,
  }));
}

function resolveViduReferenceAwareDeleteRange(
  text: string,
  selectionStart: number,
  selectionEnd: number,
  direction: 'backward' | 'forward',
  maxReferenceCount: number
): { start: number; end: number } | null {
  const safeStart = clampIndex(Math.min(selectionStart, selectionEnd), 0, text.length);
  const safeEnd = clampIndex(Math.max(selectionStart, selectionEnd), 0, text.length);
  const tokenRanges = findViduPromptTokenRanges(text, maxReferenceCount);

  if (safeStart !== safeEnd) {
    let expandedStart = safeStart;
    let expandedEnd = safeEnd;
    let touchedToken = false;

    for (const tokenRange of tokenRanges) {
      if (tokenRange.blockEnd <= expandedStart || tokenRange.blockStart >= expandedEnd) {
        continue;
      }
      touchedToken = true;
      expandedStart = Math.min(expandedStart, tokenRange.blockStart);
      expandedEnd = Math.max(expandedEnd, tokenRange.blockEnd);
    }

    return touchedToken ? { start: expandedStart, end: expandedEnd } : null;
  }

  const point = direction === 'backward' ? Math.max(0, safeStart - 1) : safeStart;
  for (const tokenRange of tokenRanges) {
    if (point >= tokenRange.blockStart && point < tokenRange.blockEnd) {
      return { start: tokenRange.blockStart, end: tokenRange.blockEnd };
    }
  }

  return null;
}

function renderPromptWithHighlights(prompt: string, maxReferenceCount: number): ReactNode {
  if (!prompt) {
    return ' ';
  }

  const segments: ReactNode[] = [];
  let lastIndex = 0;
  const referenceTokens = findViduPromptReferenceTokens(prompt, maxReferenceCount);
  for (const token of referenceTokens) {
    if (token.start > lastIndex) {
      segments.push(<span key={`plain-${lastIndex}`}>{prompt.slice(lastIndex, token.start)}</span>);
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
    segments.push(<span key={`plain-${lastIndex}`}>{prompt.slice(lastIndex)}</span>);
  }

  return segments;
}

function renderPromptReferenceHoverTargets(
  prompt: string,
  maxReferenceCount: number,
  onTokenHover: (
    token: ViduPromptReferenceToken,
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
  const referenceTokens = findViduPromptReferenceTokens(prompt, maxReferenceCount);
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

function FixedControlChip<T extends string | number | boolean>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: ViduOption<T>[];
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
          value={String(value)}
          aria-label={label}
          menuAnchorRef={chipRef}
          className="nodrag !h-6 !w-full !rounded-md !border-0 !bg-transparent !px-0.5 !text-[10.5px] !font-medium hover:!border-0 focus-visible:!border-0 focus-visible:!shadow-none"
          onChange={(event) => {
            const nextValue = event.target.value;
            onChange(
              typeof value === 'number'
                ? (Number(nextValue) as T)
                : typeof value === 'boolean'
                  ? ((nextValue === 'true') as T)
                  : (nextValue as T)
            );
          }}
        >
          {options.map((option) => (
            <option key={String(option.value)} value={String(option.value)}>
              {t(option.labelKey)}
            </option>
          ))}
        </UiSelect>
      </div>
    </div>
  );
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
      <div className="space-y-0.5">
        <div className="truncate text-[11px] font-medium leading-4 text-text-dark">
          {item.label}
        </div>
        {item.kind === 'video' && item.durationSeconds ? (
          <div className="text-[10px] leading-4 text-text-muted">
            {formatVideoTime(item.durationSeconds)}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function areImageAspectRatiosCompatible(
  dimensions: Array<{ width: number; height: number }>
): boolean {
  if (dimensions.length !== 2) {
    return true;
  }
  const ratios = dimensions.map((item) => item.width / item.height).filter(Number.isFinite);
  if (ratios.length !== 2 || ratios.some((ratio) => ratio <= 0)) {
    return true;
  }
  const ratioDelta = Math.min(ratios[0], ratios[1]) / Math.max(ratios[0], ratios[1]);
  return ratioDelta >= 0.8 && ratioDelta <= 1.25;
}

async function resolveInitialViduResultAspectRatio(
  inputMode: string,
  images: Array<{ referenceUrl: string }>,
  fallbackAspectRatio: string
): Promise<string> {
  if (inputMode !== 'firstFrame' && inputMode !== 'firstLastFrame') {
    return fallbackAspectRatio;
  }

  const primaryImage = images[0]?.referenceUrl?.trim();
  if (!primaryImage) {
    return fallbackAspectRatio;
  }

  try {
    const dimensions = await detectImageDimensions(primaryImage);
    return reduceAspectRatio(dimensions.width, dimensions.height);
  } catch {
    return fallbackAspectRatio;
  }
}

export const ViduNode = memo(({ id, data, selected, width }: ViduNodeProps) => {
  const { t, i18n } = useTranslation();
  const isOverviewRender = useIsOverviewCanvasRender();
  const shouldSuspendMedia = useShouldSuspendCanvasMedia();
  const zoom = useCanvasZoom();
  const currentNode = useCanvasNodeById(id);
  const connectedVisuals = useCanvasConnectedReferenceVisuals(id);
  const connectedAudioReferences = useCanvasConnectedAudioReferences(id);
  const officialVideoApiKeys = useSettingsStore((state) => state.officialVideoApiKeys);
  const addNode = useCanvasStore((state) => state.addNode);
  const addEdge = useCanvasStore((state) => state.addEdge);
  const findNodePosition = useCanvasStore((state) => state.findNodePosition);
  const setSelectedNode = useCanvasStore((state) => state.setSelectedNode);
  const updateNodeData = useCanvasStore((state) => state.updateNodeData);
  const isShotParamsPanelOpen = useCanvasStore((state) => state.activeShotParamsPanelNodeId === id);
  const toggleShotParamsPanel = useCanvasStore((state) => state.toggleShotParamsPanel);
  const closeShotParamsPanel = useCanvasStore((state) => state.closeShotParamsPanel);
  const promptPanelRef = useRef<HTMLDivElement>(null);
  const promptPreviewHostRef = useRef<HTMLDivElement>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const promptHighlightRef = useRef<HTMLDivElement>(null);
  const promptHoverLayerRef = useRef<HTMLDivElement>(null);
  const promptCompositionRef = useRef(false);
  const pickerItemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const lastPromptSelectionRef = useRef<TextSelectionRange | null>(null);
  const pickerSelectionRef = useRef<TextSelectionRange | null>(null);
  const [promptDraft, setPromptDraft] = useState(() => data.prompt ?? '');
  const promptDraftRef = useRef(promptDraft);
  const [showReferencePicker, setShowReferencePicker] = useState(false);
  const [pickerActiveIndex, setPickerActiveIndex] = useState(0);
  const [pickerAnchor, setPickerAnchor] = useState<PickerAnchor>(DEFAULT_PICKER_ANCHOR);
  const [promptReferencePreview, setPromptReferencePreview] =
    useState<PromptReferencePreviewState | null>(null);
  const [isOptimizingPrompt, setIsOptimizingPrompt] = useState(false);
  const [promptOptimizationError, setPromptOptimizationError] = useState<string | null>(null);
  const [lastPromptOptimizationUndoState, setLastPromptOptimizationUndoState] =
    useState<PromptOptimizationUndoState | null>(null);
  const showOverviewReferenceThumbnails = isOverviewRender && !shouldSuspendMedia;

  const apiKey = officialVideoApiKeys.vidu?.trim() ?? '';
  const selectedInputMode = normalizeViduInputMode(data.inputMode);
  const selectedModelId = normalizeViduModelIdForInputMode(data.modelId, selectedInputMode);
  const selectedModelIsQ3 = isViduQ3Model(selectedModelId);
  const modelOptions = useMemo(
    () => getViduModelOptions(selectedInputMode),
    [selectedInputMode]
  );
  const selectedAspectRatio = normalizeViduAspectRatio(data.aspectRatio);
  const selectedDuration = normalizeViduDurationSeconds(data.durationSeconds);
  const selectedResolution = normalizeViduResolution(data.resolution);
  const selectedAudio = selectedModelIsQ3 ? (data.audio ?? true) : false;
  const selectedBgm = selectedModelIsQ3 ? false : (data.bgm ?? false);
  const supportsSelectableAspectRatio =
    selectedInputMode === 'textToVideo' || selectedInputMode === 'reference';
  const referenceVisualItems = useMemo<ReferenceVisualItem[]>(
    () =>
      connectedVisuals.map((item, index) => {
        const previewSource = item.previewImageUrl?.trim() || item.referenceUrl.trim();
        return {
          sourceEdgeId: item.sourceEdgeId,
          sourceNodeId: item.sourceNodeId,
          kind: item.kind,
          referenceUrl: item.referenceUrl,
          previewImageUrl: item.previewImageUrl ?? null,
          displayUrl: previewSource || null,
          tokenLabel:
            item.kind === 'video'
              ? buildVideoReferenceToken(index)
              : buildShortReferenceToken(index),
          label:
            item.kind === 'video'
              ? t('node.vidu.referenceVideoLabel', { index: index + 1 })
              : t('node.vidu.referenceImageLabel', { index: index + 1 }),
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
  const connectedVideos = useMemo(
    () => connectedVisuals.filter((item) => item.kind === 'video'),
    [connectedVisuals]
  );
  const resolvedTitle = useMemo(
    () => resolveNodeDisplayName(CANVAS_NODE_TYPES.vidu, data),
    [data]
  );
  const resolvedWidth = Math.max(
    VIDU_VIDEO_NODE_MIN_WIDTH,
    Math.round(width ?? VIDU_VIDEO_NODE_DEFAULT_WIDTH)
  );
  const explicitHeight =
    typeof currentNode?.height === 'number' && Number.isFinite(currentNode.height)
      ? currentNode.height
      : typeof currentNode?.style?.height === 'number' && Number.isFinite(currentNode.style.height)
        ? currentNode.style.height
        : null;
  const resolvedHeight = Math.max(
    VIDU_VIDEO_NODE_MIN_HEIGHT,
    Math.round(explicitHeight ?? VIDU_VIDEO_NODE_DEFAULT_HEIGHT)
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
    (patch: Partial<ViduNodeData>) => updateNodeData(id, patch),
    [id, updateNodeData]
  );

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
    const externalPrompt = data.prompt ?? '';
    if (externalPrompt !== promptDraftRef.current) {
      promptDraftRef.current = externalPrompt;
      setPromptDraft(externalPrompt);
      setLastPromptOptimizationUndoState(null);
    }
  }, [data.prompt]);

  const handlePromptChange = useCallback(
    (prompt: string, options?: { commit?: boolean }) => {
      setPromptDraft(prompt);
      promptDraftRef.current = prompt;
      if (options?.commit !== false) {
        updateCurrentNodeData({ prompt, lastError: null });
      }
      setPromptOptimizationError(null);
    },
    [updateCurrentNodeData]
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
    (selection: TextSelectionRange | number, scrollSnapshot?: TextareaScrollSnapshot | null) => {
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
    (prompt: string, cursor: number) => {
      handlePromptChange(prompt);
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
    (token: ViduPromptReferenceToken, event: ReactMouseEvent<HTMLSpanElement>) => {
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
      if (event.key === 'Backspace' || event.key === 'Delete') {
        const currentPrompt = promptDraftRef.current;
        const selectionStart = event.currentTarget.selectionStart ?? currentPrompt.length;
        const selectionEnd = event.currentTarget.selectionEnd ?? selectionStart;
        const deleteRange = resolveViduReferenceAwareDeleteRange(
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
    const currentPrompt = promptDraft.trim();
    if (!currentPrompt) {
      const message = t('node.vidu.promptRequired');
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
      setLastPromptOptimizationUndoState(
        nextPrompt !== promptDraft
          ? { previousPrompt: promptDraft, appliedPrompt: nextPrompt }
          : null
      );
      applyPromptAndRestoreCursor(nextPrompt, nextPrompt.length);
    } catch (error) {
      const message =
        error instanceof Error && error.message.trim().length > 0
          ? error.message
          : t('node.vidu.optimizePromptFailed');
      setPromptOptimizationError(message);
      await showErrorDialog(message, t('common.error'));
    } finally {
      setIsOptimizingPrompt(false);
    }
  }, [applyPromptAndRestoreCursor, connectedImages, promptDraft, t, updateCurrentNodeData]);

  const handleUndoOptimizedPrompt = useCallback(() => {
    if (!lastPromptOptimizationUndoState || promptDraft !== lastPromptOptimizationUndoState.appliedPrompt) {
      return;
    }
    setPromptOptimizationError(null);
    setLastPromptOptimizationUndoState(null);
    applyPromptAndRestoreCursor(
      lastPromptOptimizationUndoState.previousPrompt,
      lastPromptOptimizationUndoState.previousPrompt.length
    );
  }, [applyPromptAndRestoreCursor, lastPromptOptimizationUndoState, promptDraft]);

  const validateGenerationRequest = useCallback((): string | null => {
    if (!apiKey) {
      return t('node.vidu.apiKeyRequired');
    }
    if (!promptDraft.trim()) {
      return t('node.vidu.promptRequired');
    }
    if (connectedAudioReferences.length > 1) {
      return t('node.vidu.voiceReferenceLimit');
    }
    if (connectedAudioReferences.length > 0) {
      if (selectedInputMode !== 'firstFrame' && selectedInputMode !== 'reference') {
        return t('node.vidu.voiceReferenceModeRequired');
      }
      if (selectedInputMode === 'reference' && selectedModelIsQ3) {
        return t('node.vidu.voiceReferenceModelUnsupported');
      }
      if (!/^https?:\/\//i.test(connectedAudioReferences[0]?.audioUrl?.trim() ?? '')) {
        return t('node.vidu.voiceReferencePublicUrlRequired');
      }
    }
    if (selectedInputMode === 'textToVideo' && connectedVisuals.length > 0) {
      return t('node.vidu.textToVideoNoReferences');
    }
    if (selectedInputMode === 'firstFrame' && (connectedImages.length !== 1 || connectedVideos.length > 0)) {
      return t('node.vidu.firstFrameRequiresOneImage');
    }
    if (selectedInputMode === 'firstLastFrame' && (connectedImages.length !== 2 || connectedVideos.length > 0)) {
      return t('node.vidu.firstLastFrameRequiresTwoImages');
    }
    if (selectedInputMode === 'reference') {
      if (connectedImages.length < 1 || connectedImages.length > VIDU_MAX_REFERENCE_IMAGE_COUNT) {
        return t('node.vidu.referenceImageLimit', { count: VIDU_MAX_REFERENCE_IMAGE_COUNT });
      }
      if (connectedVideos.length > VIDU_MAX_REFERENCE_VIDEO_COUNT) {
        return t('node.vidu.referenceVideoLimit', { count: VIDU_MAX_REFERENCE_VIDEO_COUNT });
      }
      if (connectedVideos.length > 0 && selectedModelId !== VIDU_REFERENCE_VIDEO_MODEL_ID) {
        return t('node.vidu.referenceVideoModelRequired');
      }
    }
    return null;
  }, [
    apiKey,
    connectedAudioReferences,
    connectedImages.length,
    connectedVideos.length,
    connectedVisuals.length,
    promptDraft,
    selectedInputMode,
    selectedModelIsQ3,
    selectedModelId,
    t,
  ]);

  const validateStartEndImageRatios = useCallback(async (): Promise<string | null> => {
    if (selectedInputMode !== 'firstLastFrame' || connectedImages.length !== 2) {
      return null;
    }
    try {
      const dimensions = await Promise.all(
        connectedImages.map((item) => detectImageDimensions(item.referenceUrl))
      );
      return areImageAspectRatiosCompatible(dimensions)
        ? null
        : t('node.vidu.firstLastFrameAspectRatioMismatch');
    } catch {
      return null;
    }
  }, [connectedImages, selectedInputMode, t]);

  const handleGenerate = useCallback(async () => {
    closeShotParamsPanel();
    const validationError = validateGenerationRequest() ?? (await validateStartEndImageRatios());
    if (validationError) {
      updateCurrentNodeData({ isSubmitting: false, lastError: validationError });
      if (!apiKey) {
        openSettingsDialog({
          category: 'providers',
          providerTab: 'officialVideo',
          providerId: 'vidu',
        });
      }
      await showErrorDialog(validationError, t('common.error'));
      return;
    }

    const startedAt = Date.now();
    let createdResultNodeId: string | null = null;
    updateCurrentNodeData({ isSubmitting: true, lastError: null });

    try {
      const resultAspectRatio = await resolveInitialViduResultAspectRatio(
        selectedInputMode,
        connectedImages,
        selectedAspectRatio
      );
      const resultNodePosition = findNodePosition(
        id,
        VIDU_VIDEO_RESULT_NODE_DEFAULT_WIDTH,
        VIDU_VIDEO_RESULT_NODE_DEFAULT_HEIGHT
      );
      createdResultNodeId = addNode(
        CANVAS_NODE_TYPES.viduVideoResult,
        resultNodePosition,
        {
          sourceNodeId: id,
          provider: 'vidu',
          inputMode: selectedInputMode,
          displayName: t('node.vidu.resultNodeTitle'),
          taskId: null,
          taskStatus: null,
          taskUpdatedAt: null,
          modelId: selectedModelId,
          videoUrl: null,
          previewImageUrl: null,
          videoFileName: null,
          aspectRatio: resultAspectRatio,
          resolution: selectedResolution,
          duration: selectedDuration,
          requestSnapshot: {
            provider: 'vidu',
            inputMode: selectedInputMode,
            modelId: selectedModelId,
            prompt: promptDraft.trim(),
            imageCount: connectedImages.length,
            videoCount: connectedVideos.length,
            aspectRatio: resultAspectRatio,
            durationSeconds: selectedDuration,
            resolution: selectedResolution,
            audio: selectedAudio,
            bgm: selectedBgm,
            audioCount: connectedAudioReferences.length,
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
      await flushCurrentProjectToDiskSafely('creating Vidu video result node');

      const submitResponse = await submitViduVideoTask({
        apiKey,
        prompt: promptDraft,
        inputMode: selectedInputMode,
        modelId: selectedModelId,
        aspectRatio: selectedAspectRatio,
        durationSeconds: selectedDuration,
        resolution: selectedResolution,
        audio: selectedAudio,
        bgm: selectedBgm,
        referenceImageSources: connectedImages.map((item) => item.referenceUrl),
        referenceVideoSources: connectedVideos.map((item) => item.referenceUrl),
        referenceAudioSources: connectedAudioReferences.map((item) => item.audioUrl),
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
      await flushCurrentProjectToDiskSafely('saving Vidu video task id');
    } catch (error) {
      const content = resolveViduErrorContent(
        error,
        t('node.vidu.submitFailed'),
        t('node.vidu.officialAuthError')
      );
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
      await flushCurrentProjectToDiskSafely('saving Vidu video submit error');
      await showErrorDialog(content.message, t('common.error'), content.details);
    }
  }, [
    addEdge,
    addNode,
    apiKey,
    closeShotParamsPanel,
    connectedImages,
    connectedAudioReferences,
    connectedVideos,
    findNodePosition,
    id,
    promptDraft,
    selectedAspectRatio,
    selectedAudio,
    selectedBgm,
    selectedDuration,
    selectedInputMode,
    selectedModelId,
    selectedResolution,
    t,
    updateCurrentNodeData,
    updateNodeData,
    validateGenerationRequest,
    validateStartEndImageRatios,
  ]);

  const canUndoPromptOptimization = Boolean(
    lastPromptOptimizationUndoState && promptDraft === lastPromptOptimizationUndoState.appliedPrompt
  );
  const combinedError = data.lastError ?? promptOptimizationError;
  const statusInfoText = data.isSubmitting
    ? t('node.vidu.submitting')
    : lastSubmittedTime
      ? t('node.vidu.lastSubmitted', { time: lastSubmittedTime })
      : t(`node.vidu.modeHints.${selectedInputMode}`);
  const headerStatus = data.isSubmitting ? (
    <NodeStatusBadge
      tone="processing"
      icon={<Loader2 className="h-3.5 w-3.5 animate-spin" />}
      label={t('node.vidu.submitting')}
    />
  ) : combinedError ? (
    <NodeStatusBadge
      tone="danger"
      icon={<TriangleAlert className="h-3.5 w-3.5" />}
      label={combinedError}
    />
  ) : (
    <NodeStatusBadge
      tone="warning"
      icon={<Video className="h-3.5 w-3.5" />}
      label="Vidu"
    />
  );
  const shotParamsButtonClassName = `${NODE_CONTROL_CHIP_CLASS} shrink-0 !w-8 !px-0 justify-center`;

  return (
    <div
      className={`relative flex flex-col rounded-[var(--node-radius)] border bg-surface-dark p-4 shadow-lg ${
        selected ? 'border-accent shadow-accent/20' : 'border-border-dark'
      }`}
      style={{ width: resolvedWidth, height: resolvedHeight }}
      onClick={() => setSelectedNode(id)}
    >
      <NodeHeader
        className={NODE_HEADER_FLOATING_POSITION_CLASS}
        title={resolvedTitle}
        icon={<Sparkles className="h-4 w-4" />}
        rightSlot={headerStatus}
        editable
        onTitleChange={(displayName) => updateCurrentNodeData({ displayName })}
      />

      <div ref={promptPanelRef} className="relative flex min-h-0 flex-1 flex-col pt-5">
        {isOverviewRender ? (
          <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden rounded-xl border border-white/10 bg-black/15 px-3 py-2 text-xs leading-5 text-text-muted">
            <div className="line-clamp-5 whitespace-pre-wrap break-words">
              {promptDraft.trim() || t('node.vidu.promptPlaceholder')}
            </div>
            {showOverviewReferenceThumbnails && referenceVisualItems.length > 0 ? (
              <div className="mt-auto flex min-h-0 gap-1 overflow-hidden">
                {referenceVisualItems.slice(0, 4).map((item) => (
                  <CanvasNodeImage
                    key={`${item.sourceEdgeId}-${item.referenceUrl}`}
                    src={item.displayUrl ?? item.previewImageUrl ?? item.referenceUrl}
                    fallbackSrc={item.referenceUrl}
                    alt={item.label}
                    className="h-10 w-10 shrink-0 rounded object-cover"
                    disableViewer
                    draggable={false}
                  />
                ))}
              </div>
            ) : null}
          </div>
        ) : (
        <>
        <div
          ref={promptPreviewHostRef}
          className="relative min-h-0 flex-1 rounded-xl border border-white/10 bg-black/15"
        >
          <div
            ref={promptHighlightRef}
            aria-hidden="true"
            className="ui-scrollbar pointer-events-none absolute inset-0 overflow-y-auto overflow-x-hidden text-sm leading-6 text-text-dark"
            style={{ scrollbarGutter: 'stable' }}
          >
            <div className="canvas-textarea-wrap min-h-full rounded-xl border border-transparent px-3 py-2">
              {renderPromptWithHighlights(promptDraft, referenceVisualItems.length)}
            </div>
          </div>

          <div
            ref={promptHoverLayerRef}
            aria-hidden="true"
            className="ui-scrollbar pointer-events-none absolute inset-0 z-20 overflow-y-auto overflow-x-hidden text-sm leading-6 text-transparent"
            style={{ scrollbarGutter: 'stable' }}
          >
            <div className="canvas-textarea-wrap min-h-full rounded-xl border border-transparent px-3 py-2">
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
            placeholder={t('node.vidu.promptPlaceholder')}
            className="canvas-textarea-wrap ui-scrollbar nodrag nowheel relative z-10 h-full min-h-0 w-full resize-none rounded-xl border border-transparent bg-transparent px-3 py-2 text-sm leading-6 text-transparent outline-none transition-colors placeholder:text-text-muted/70 selection:bg-accent/30 selection:text-transparent caret-text-dark focus:border-accent/50"
            style={{ scrollbarGutter: 'stable' }}
            onScroll={syncPromptHighlightScroll}
            onMouseDown={(event) => {
              event.stopPropagation();
              hidePromptReferencePreview();
            }}
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

        <div className="mt-3 rounded-[var(--node-radius)] border border-white/10 bg-bg-dark/50 p-2">
          <div className="mb-2 flex items-center justify-between gap-2 text-xs text-text-muted">
            <span>
              {t('node.vidu.references', {
                images: connectedImages.length,
                videos: connectedVideos.length,
                audios: connectedAudioReferences.length,
              })}
            </span>
            {lastSubmittedTime ? (
              <span>{t('node.vidu.lastSubmitted', { time: lastSubmittedTime })}</span>
            ) : null}
          </div>
          {referenceVisualItems.length > 0 ? (
            <div className="flex gap-2 overflow-x-auto pb-1">
              {referenceVisualItems.slice(0, 9).map((item) => (
                <div
                  key={`${item.sourceEdgeId}-${item.referenceUrl}`}
                  className="relative h-16 w-20 shrink-0 overflow-hidden rounded-md border border-white/10 bg-black"
                >
                  {item.kind === 'image' ? (
                    <CanvasNodeImage
                      src={item.displayUrl ?? item.referenceUrl}
                      fallbackSrc={item.referenceUrl}
                      alt={item.label}
                      className="h-full w-full object-cover"
                      disableViewer
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center bg-bg-dark">
                      {item.previewImageUrl ? (
                        <CanvasNodeImage
                          src={item.previewImageUrl}
                          fallbackSrc={item.previewImageUrl}
                          alt={item.label}
                          className="h-full w-full object-cover opacity-70"
                          disableViewer
                        />
                      ) : (
                        <Video className="h-5 w-5 text-text-muted" />
                      )}
                    </div>
                  )}
                  <div className="absolute left-1 top-1 rounded bg-black/65 px-1.5 py-0.5 text-[10px] text-white">
                    {item.kind === 'image' ? <ImageIcon className="inline h-3 w-3" /> : <Video className="inline h-3 w-3" />}
                  </div>
                  <div className="absolute bottom-1 left-1 max-w-[calc(100%-0.5rem)] truncate rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-medium text-white">
                    {item.tokenLabel}
                  </div>
                </div>
              ))}
            </div>
          ) : connectedAudioReferences.length === 0 ? (
            <div className="rounded-md border border-dashed border-white/10 px-3 py-4 text-center text-xs text-text-muted">
              {t('node.vidu.noReferences')}
            </div>
          ) : null}
          {connectedAudioReferences.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-2">
              {connectedAudioReferences.slice(0, 1).map((item) => (
                <div
                  key={`${item.sourceEdgeId}-${item.audioUrl}`}
                  className="flex min-w-0 items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-2 py-1.5 text-[11px] text-text-muted"
                  title={item.displayName ?? item.audioFileName ?? item.audioUrl}
                >
                  <Music4 className="h-3.5 w-3.5 shrink-0 text-accent" />
                  <span className="min-w-0 truncate">
                    {item.displayName ?? item.audioFileName ?? t('node.vidu.voiceReferenceLabel')}
                  </span>
                  {item.durationSeconds ? (
                    <span className="shrink-0 text-[10px] text-text-muted/80">
                      {formatVideoTime(item.durationSeconds)}
                    </span>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}
        </div>

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
                  onClick={(event) => {
                    event.stopPropagation();
                    insertReferenceItem(index);
                  }}
                  onMouseEnter={() => setPickerActiveIndex(index)}
                  role="option"
                  aria-selected={pickerActiveIndex === index}
                  className={`flex w-full items-center gap-2 border border-transparent bg-bg-dark/70 px-2 py-2 text-left text-sm text-text-dark transition-colors hover:border-[rgba(255,255,255,0.18)] ${
                    pickerActiveIndex === index
                      ? 'border-accent/55 bg-white/[0.08] shadow-[0_0_0_1px_rgba(59,130,246,0.22)]'
                      : ''
                  }`}
                >
                  <div className="relative h-8 w-8 shrink-0 overflow-hidden rounded">
                    {item.displayUrl ? (
                      <CanvasNodeImage
                        src={item.displayUrl}
                        alt={item.label}
                        className="h-8 w-8 object-cover"
                        viewerSourceUrl={item.displayUrl}
                        disableViewer
                        draggable={false}
                      />
                    ) : (
                      <div className="flex h-8 w-8 items-center justify-center rounded bg-white/[0.06] text-text-muted">
                        {item.previewKind === 'video' ? (
                          <Video className="h-4 w-4" />
                        ) : (
                          <ImageIcon className="h-4 w-4" />
                        )}
                      </div>
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="truncate text-[11px] font-medium text-text-dark">
                      {item.tokenLabel}
                    </div>
                    <div className="truncate text-[11px] text-text-muted">
                      {item.durationSeconds
                        ? `${item.label} · ${formatVideoTime(item.durationSeconds)}`
                        : item.label}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        ) : null}
        </>
        )}
      </div>

      {!isOverviewRender ? (
      <div className="mt-2 space-y-1.5">
        <div className="flex items-center gap-2">
          <div className="ui-scrollbar min-w-0 flex-1 overflow-x-auto overflow-y-hidden">
            <div className="flex w-max min-w-full items-center gap-1.5 pr-1">
              <FixedControlChip
                label={t('node.vidu.modelLabel')}
                value={selectedModelId}
                options={modelOptions}
                onChange={(value) => updateCurrentNodeData({ modelId: value, lastError: null })}
              />
              <FixedControlChip
                label={t('node.vidu.inputModeLabel')}
                value={selectedInputMode}
                options={VIDU_INPUT_MODE_OPTIONS}
                onChange={(value) => updateCurrentNodeData({ inputMode: value, lastError: null })}
              />
              {supportsSelectableAspectRatio ? (
                <FixedControlChip
                  label={t('node.vidu.aspectRatioLabel')}
                  value={selectedAspectRatio}
                  options={VIDU_ASPECT_RATIOS.map((value) => ({
                    value,
                    labelKey: `node.vidu.aspectRatios.${value}`,
                  }))}
                  onChange={(value) => updateCurrentNodeData({ aspectRatio: value })}
                />
              ) : null}
              <FixedControlChip
                label={t('node.vidu.durationLabel')}
                value={selectedDuration}
                options={VIDU_DURATION_SECONDS.map((value) => ({
                  value,
                  labelKey: `node.vidu.durations.${value}`,
                }))}
                onChange={(value) => updateCurrentNodeData({ durationSeconds: value })}
              />
              <FixedControlChip
                label={t('node.vidu.resolutionLabel')}
                value={selectedResolution}
                options={VIDU_RESOLUTIONS.map((value) => ({
                  value,
                  labelKey: `node.vidu.resolutions.${value}`,
                }))}
                onChange={(value) => updateCurrentNodeData({ resolution: value })}
              />
              <FixedControlChip
                label={t('node.vidu.audioLabel')}
                value={selectedAudio}
                options={[
                  { value: true, labelKey: 'common.enabled' },
                  { value: false, labelKey: 'common.disabled' },
                ]}
                onChange={(value) => updateCurrentNodeData({ audio: value })}
              />
              <FixedControlChip
                label={t('node.vidu.bgmLabel')}
                value={selectedBgm}
                options={[
                  { value: true, labelKey: 'common.enabled' },
                  { value: false, labelKey: 'common.disabled' },
                ]}
                onChange={(value) => updateCurrentNodeData({ bgm: value })}
              />
              <StyleTemplatePicker
                className={`${NODE_CONTROL_CHIP_CLASS} shrink-0 !w-8 !px-0 justify-center`}
                onTemplateApply={(template) => {
                  const nextPrompt = appendStyleTemplatePrompt(promptDraft, template.prompt);
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
                disabled={isOptimizingPrompt || promptDraft.trim().length === 0}
                className={`${NODE_CONTROL_CHIP_CLASS} shrink-0 !w-8 !px-0 justify-center`}
                aria-label={isOptimizingPrompt ? t('node.vidu.optimizingPrompt') : t('node.vidu.optimizePrompt')}
                title={isOptimizingPrompt ? t('node.vidu.optimizingPrompt') : t('node.vidu.optimizePrompt')}
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
                aria-label={t('node.vidu.undoOptimizedPrompt')}
                title={t('node.vidu.undoOptimizedPrompt')}
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
            {data.isSubmitting ? t('node.vidu.submitting') : t('node.vidu.submit')}
          </UiButton>
        </div>

        <div
          className={`min-h-[16px] truncate text-[10px] leading-4 ${
            combinedError ? 'text-rose-300' : 'text-text-muted'
          }`}
          title={combinedError ?? statusInfoText}
        >
          {combinedError ?? statusInfoText}
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
      <NodeResizeHandle minWidth={VIDU_VIDEO_NODE_MIN_WIDTH} minHeight={VIDU_VIDEO_NODE_MIN_HEIGHT} />
    </div>
  );
});

ViduNode.displayName = 'ViduNode';
