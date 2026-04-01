import {
  type DragEvent as ReactDragEvent,
  type KeyboardEvent,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Handle, Position, useUpdateNodeInternals, type NodeProps } from '@xyflow/react';
import {
  AudioLines,
  Loader2,
  Sparkles,
  TriangleAlert,
  Undo2,
  Wand2,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { checkDreaminaCliStatus } from '@/commands/dreaminaCli';
import {
  CANVAS_NODE_TYPES,
  JIMENG_VIDEO_RESULT_NODE_DEFAULT_HEIGHT,
  JIMENG_VIDEO_RESULT_NODE_DEFAULT_WIDTH,
  isAudioNode,
  type JimengDurationSeconds,
  type JimengNodeData,
  type JimengReferenceMode,
  type JimengVideoModelId,
  type JimengVideoResolution,
} from '@/features/canvas/domain/canvasNodes';
import { resolveNodeDisplayName } from '@/features/canvas/domain/nodeDisplay';
import { graphImageResolver } from '@/features/canvas/application/canvasServices';
import { resolveErrorContent, showErrorDialog } from '@/features/canvas/application/errorDialog';
import { resolveImageDisplayUrl } from '@/features/canvas/application/imageData';
import {
  optimizeCanvasPrompt,
  type PromptDurationRecommendation,
} from '@/features/canvas/application/promptOptimization';
import { NodeHeader, NODE_HEADER_FLOATING_POSITION_CLASS } from '@/features/canvas/ui/NodeHeader';
import { NodeResizeHandle } from '@/features/canvas/ui/NodeResizeHandle';
import { CanvasNodeImage } from '@/features/canvas/ui/CanvasNodeImage';
import { NodeStatusBadge } from '@/features/canvas/ui/NodeStatusBadge';
import {
  NODE_CONTROL_CHIP_CLASS, NODE_CONTROL_GENERATE_ICON_CLASS, NODE_CONTROL_PRIMARY_BUTTON_CLASS,
} from '@/features/canvas/ui/nodeControlStyles';
import { UiButton, UiChipButton, UiSelect } from '@/components/ui';
import { useCanvasStore } from '@/stores/canvasStore';
import { generateJimengVideos } from '@/features/jimeng/application/jimengVideoSubmission';
import {
  areReferenceImageOrdersEqual,
  buildShortReferenceToken,
  insertReferenceToken,
  remapReferenceTokensByImageOrder,
  removeTextRange,
  resolveReferenceAwareDeleteRange,
} from '@/features/canvas/application/referenceTokenEditing';
import {
  JIMENG_ASPECT_RATIO_OPTIONS,
  JIMENG_DURATION_OPTIONS,
  JIMENG_REFERENCE_MODE_OPTIONS,
  JIMENG_VIDEO_MODEL_OPTIONS,
  JIMENG_VIDEO_RESOLUTION_OPTIONS,
} from '@/features/jimeng/domain/jimengOptions';

type JimengNodeProps = NodeProps & {
  id: string;
  data: JimengNodeData;
  selected?: boolean;
};

interface PromptDurationSuggestionSnapshot {
  suggestedDurationSeconds: number | null;
  suggestedDurationEstimatedSeconds: number | null;
  suggestedDurationExceedsLimit: boolean;
  suggestedDurationReason: string | null;
}

interface PromptOptimizationMeta {
  modelLabel: string;
  referenceImageCount: number;
}

interface PromptOptimizationUndoState {
  previousPrompt: string;
  appliedPrompt: string;
  previousDurationSuggestion: PromptDurationSuggestionSnapshot;
  appliedDurationSuggestion: PromptDurationSuggestionSnapshot;
}

interface FixedControlOption<T extends string | number> {
  value: T;
  label: string;
}

interface IncomingAudioItem {
  audioUrl: string;
  label: string;
}

interface PickerAnchor {
  left: number;
  top: number;
}

const JIMENG_NODE_DEFAULT_WIDTH = 920;
const JIMENG_NODE_DEFAULT_HEIGHT = 500;
const JIMENG_NODE_MIN_WIDTH = 820;
const JIMENG_NODE_MIN_HEIGHT = 420;
const JIMENG_NODE_MAX_WIDTH = 1320;
const JIMENG_NODE_MAX_HEIGHT = 1040;
const DEFAULT_VIDEO_MODEL: JimengVideoModelId = 'seedance2.0';
const DEFAULT_REFERENCE_MODE: JimengReferenceMode = 'allAround';
const DEFAULT_ASPECT_RATIO = '16:9';
const DEFAULT_DURATION: JimengDurationSeconds = 5;
const DEFAULT_VIDEO_RESOLUTION: JimengVideoResolution = '720p';
const PICKER_FALLBACK_ANCHOR: PickerAnchor = { left: 8, top: 8 };
const PICKER_Y_OFFSET_PX = 20;

function formatTimestamp(timestamp: number | null | undefined, locale: string): string | null {
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp) || timestamp <= 0) {
    return null;
  }

  return new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(
    new Date(timestamp)
  );
}

function buildJimengVideoResultNodeTitle(prompt: string, fallbackTitle: string): string {
  const normalizedPrompt = prompt.trim();
  return normalizedPrompt || fallbackTitle;
}

function buildClearedDurationSuggestionSnapshot(): PromptDurationSuggestionSnapshot {
  return {
    suggestedDurationSeconds: null,
    suggestedDurationEstimatedSeconds: null,
    suggestedDurationExceedsLimit: false,
    suggestedDurationReason: null,
  };
}

function readDurationSuggestionSnapshot(data: JimengNodeData): PromptDurationSuggestionSnapshot {
  return {
    suggestedDurationSeconds:
      typeof data.suggestedDurationSeconds === 'number' ? data.suggestedDurationSeconds : null,
    suggestedDurationEstimatedSeconds:
      typeof data.suggestedDurationEstimatedSeconds === 'number'
        ? data.suggestedDurationEstimatedSeconds
        : null,
    suggestedDurationExceedsLimit: data.suggestedDurationExceedsLimit === true,
    suggestedDurationReason:
      typeof data.suggestedDurationReason === 'string' && data.suggestedDurationReason.trim().length > 0
        ? data.suggestedDurationReason.trim()
        : null,
  };
}

function buildDurationSuggestionSnapshot(
  recommendation: PromptDurationRecommendation | null | undefined
): PromptDurationSuggestionSnapshot {
  if (!recommendation) {
    return buildClearedDurationSuggestionSnapshot();
  }

  return {
    suggestedDurationSeconds: recommendation.recommendedDurationSeconds,
    suggestedDurationEstimatedSeconds: recommendation.estimatedDurationSeconds,
    suggestedDurationExceedsLimit: recommendation.exceedsMaxDuration,
    suggestedDurationReason:
      typeof recommendation.reason === 'string' && recommendation.reason.trim().length > 0
        ? recommendation.reason.trim()
        : null,
  };
}

function toDurationSuggestionNodeData(
  snapshot: PromptDurationSuggestionSnapshot
): Partial<JimengNodeData> {
  return {
    suggestedDurationSeconds: snapshot.suggestedDurationSeconds,
    suggestedDurationEstimatedSeconds: snapshot.suggestedDurationEstimatedSeconds,
    suggestedDurationExceedsLimit: snapshot.suggestedDurationExceedsLimit,
    suggestedDurationReason: snapshot.suggestedDurationReason,
  };
}

function areDurationSuggestionSnapshotsEqual(
  left: PromptDurationSuggestionSnapshot,
  right: PromptDurationSuggestionSnapshot
): boolean {
  return (
    left.suggestedDurationSeconds === right.suggestedDurationSeconds
    && left.suggestedDurationEstimatedSeconds === right.suggestedDurationEstimatedSeconds
    && left.suggestedDurationExceedsLimit === right.suggestedDurationExceedsLimit
    && left.suggestedDurationReason === right.suggestedDurationReason
  );
}

function moveItem<T>(items: T[], fromIndex: number, toIndex: number): T[] {
  if (
    fromIndex < 0
    || toIndex < 0
    || fromIndex >= items.length
    || toIndex >= items.length
    || fromIndex === toIndex
  ) {
    return items;
  }

  const nextItems = [...items];
  const [movedItem] = nextItems.splice(fromIndex, 1);
  nextItems.splice(toIndex, 0, movedItem);
  return nextItems;
}

function getTextareaCaretOffset(
  textarea: HTMLTextAreaElement,
  caretIndex: number
): PickerAnchor {
  const mirror = document.createElement('div');
  const computed = window.getComputedStyle(textarea);
  const mirrorStyle = mirror.style;

  mirrorStyle.position = 'absolute';
  mirrorStyle.visibility = 'hidden';
  mirrorStyle.pointerEvents = 'none';
  mirrorStyle.whiteSpace = 'pre-wrap';
  mirrorStyle.overflowWrap = 'break-word';
  mirrorStyle.wordBreak = 'break-word';
  mirrorStyle.boxSizing = computed.boxSizing;
  mirrorStyle.width = `${textarea.clientWidth}px`;
  mirrorStyle.font = computed.font;
  mirrorStyle.lineHeight = computed.lineHeight;
  mirrorStyle.letterSpacing = computed.letterSpacing;
  mirrorStyle.padding = computed.padding;
  mirrorStyle.border = computed.border;
  mirrorStyle.textTransform = computed.textTransform;
  mirrorStyle.textIndent = computed.textIndent;

  mirror.textContent = textarea.value.slice(0, caretIndex);

  const marker = document.createElement('span');
  marker.textContent = textarea.value.slice(caretIndex, caretIndex + 1) || ' ';
  mirror.appendChild(marker);

  document.body.appendChild(mirror);

  const left = marker.offsetLeft - textarea.scrollLeft;
  const top = marker.offsetTop - textarea.scrollTop;

  document.body.removeChild(mirror);

  return {
    left: Math.max(0, left),
    top: Math.max(0, top),
  };
}

function resolvePickerAnchor(
  container: HTMLDivElement | null,
  textarea: HTMLTextAreaElement,
  caretIndex: number
): PickerAnchor {
  if (!container) {
    return PICKER_FALLBACK_ANCHOR;
  }

  const containerRect = container.getBoundingClientRect();
  const textareaRect = textarea.getBoundingClientRect();
  const caretOffset = getTextareaCaretOffset(textarea, caretIndex);

  return {
    left: Math.max(0, textareaRect.left - containerRect.left + caretOffset.left),
    top: Math.max(0, textareaRect.top - containerRect.top + caretOffset.top + PICKER_Y_OFFSET_PX),
  };
}

function resolveOrderedReferenceImages(imageUrls: string[], preferredOrder: string[] | undefined): string[] {
  if (imageUrls.length === 0) {
    return [];
  }

  const availableImages = new Set(imageUrls);
  const resolvedImages: string[] = [];
  const seenImages = new Set<string>();

  for (const imageUrl of preferredOrder ?? []) {
    if (!availableImages.has(imageUrl) || seenImages.has(imageUrl)) {
      continue;
    }

    seenImages.add(imageUrl);
    resolvedImages.push(imageUrl);
  }

  for (const imageUrl of imageUrls) {
    if (seenImages.has(imageUrl)) {
      continue;
    }

    seenImages.add(imageUrl);
    resolvedImages.push(imageUrl);
  }

  return resolvedImages;
}

function FixedControlChip<T extends string | number>({
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
      className="flex h-7 min-w-[100px] shrink-0 items-center gap-1 rounded-lg border border-[color:var(--ui-border-soft)] bg-[var(--ui-surface-field)] px-2"
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
            onChange(typeof value === 'number' ? Number(event.target.value) as T : event.target.value as T)
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

function buildDurationSuggestionText(
  snapshot: PromptDurationSuggestionSnapshot,
  t: ReturnType<typeof useTranslation>['t']
): string | null {
  if (typeof snapshot.suggestedDurationSeconds !== 'number') {
    return null;
  }

  if (snapshot.suggestedDurationExceedsLimit && typeof snapshot.suggestedDurationEstimatedSeconds === 'number') {
    return t('node.jimeng.durationSuggestionOverflow', {
      seconds: snapshot.suggestedDurationSeconds,
      estimated: snapshot.suggestedDurationEstimatedSeconds,
    });
  }

  return t('node.jimeng.durationSuggestionLabel', {
    seconds: snapshot.suggestedDurationSeconds,
  });
}

function resolveJimengVideoModelOptionKey(model: JimengVideoModelId): string {
  switch (model) {
    case 'seedance2.0fast':
      return 'seedance20fast';
    case 'seedance2.0':
      return 'seedance20';
    case '3.5pro':
      return 'v3_5pro';
    case '3.0pro':
      return 'v3_0pro';
    case '3.0fast':
      return 'v3_0fast';
    case '3.0':
    default:
      return 'v3_0';
  }
}

function resolveJimengVideoModelDurationRange(model: JimengVideoModelId): string {
  if (model === '3.0' || model === '3.0fast' || model === '3.0pro') {
    return '3-10s';
  }
  if (model === '3.5pro') {
    return '4-12s';
  }
  return '4-15s';
}

function resolveJimengCliEffectiveVideoModel(
  command: 'text2video' | 'image2video' | 'frames2video' | 'multiframe2video' | 'multimodal2video',
  selectedModel: JimengVideoModelId
): JimengVideoModelId | null {
  if (command === 'text2video' || command === 'multimodal2video') {
    return selectedModel === 'seedance2.0' || selectedModel === 'seedance2.0fast'
      ? selectedModel
      : 'seedance2.0fast';
  }

  if (command === 'frames2video') {
    return selectedModel === '3.0'
      || selectedModel === '3.5pro'
      || selectedModel === 'seedance2.0'
      || selectedModel === 'seedance2.0fast'
      ? selectedModel
      : 'seedance2.0fast';
  }

  if (command === 'image2video') {
    return selectedModel;
  }

  return null;
}

export const JimengNode = memo(({
  id,
  data,
  selected,
  width,
  height,
}: JimengNodeProps) => {
  const { t, i18n } = useTranslation();
  const updateNodeInternals = useUpdateNodeInternals();
  const rootRef = useRef<HTMLDivElement>(null);
  const promptPanelRef = useRef<HTMLDivElement>(null);
  const [isOptimizingPrompt, setIsOptimizingPrompt] = useState(false);
  const [isCheckingCliStatus, setIsCheckingCliStatus] = useState(false);
  const [cliStatusMessage, setCliStatusMessage] = useState<string | null>(null);
  const [promptOptimizationError, setPromptOptimizationError] = useState<string | null>(null);
  const [lastPromptOptimizationMeta, setLastPromptOptimizationMeta] = useState<PromptOptimizationMeta | null>(null);
  const [lastPromptOptimizationUndoState, setLastPromptOptimizationUndoState] = useState<PromptOptimizationUndoState | null>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const promptValueRef = useRef(data.prompt ?? '');
  const previousOrderedReferenceImagesRef = useRef<string[] | null>(null);
  const pickerItemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [showImagePicker, setShowImagePicker] = useState(false);
  const [pickerCursor, setPickerCursor] = useState<number | null>(null);
  const [pickerActiveIndex, setPickerActiveIndex] = useState(0);
  const [pickerAnchor, setPickerAnchor] = useState<PickerAnchor>(PICKER_FALLBACK_ANCHOR);
  const [draggingReferenceIndex, setDraggingReferenceIndex] = useState<number | null>(null);
  const [dragOverReferenceIndex, setDragOverReferenceIndex] = useState<number | null>(null);
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
  const orderedReferenceImages = useMemo(
    () => resolveOrderedReferenceImages(incomingImages, data.referenceImageOrder),
    [data.referenceImageOrder, incomingImages]
  );
  const incomingImageDisplayList = useMemo(
    () => orderedReferenceImages.map((imageUrl) => resolveImageDisplayUrl(imageUrl)),
    [orderedReferenceImages]
  );
  const incomingImageItems = useMemo(
    () =>
      orderedReferenceImages.map((imageUrl, index) => ({
        imageUrl,
        displayUrl: resolveImageDisplayUrl(imageUrl),
        tokenLabel: buildShortReferenceToken(index),
        label: t('node.jimeng.referenceImageLabel', { index: index + 1 }),
      })),
    [orderedReferenceImages, t]
  );
  const incomingAudios = useMemo<IncomingAudioItem[]>(() => {
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const items: IncomingAudioItem[] = [];

    for (const edge of edges) {
      if (edge.target !== id) {
        continue;
      }

      const sourceNode = nodeById.get(edge.source);
      if (!isAudioNode(sourceNode)) {
        continue;
      }

      const audioUrl = sourceNode.data.audioUrl?.trim() ?? '';
      if (!audioUrl || items.some((item) => item.audioUrl === audioUrl)) {
        continue;
      }

      items.push({
        audioUrl,
        label:
          sourceNode.data.displayName?.trim()
          || sourceNode.data.audioFileName?.trim()
          || t('node.jimeng.audioReferenceLabel', { index: items.length + 1 }),
      });
    }

    return items;
  }, [edges, id, nodes, t]);
  const isGenerateBlocked = orderedReferenceImages.length === 0 && incomingAudios.length > 0;
  const resolvedTitle = useMemo(
    () => resolveNodeDisplayName(CANVAS_NODE_TYPES.jimeng, data),
    [data]
  );
  const resolvedWidth = Math.max(
    JIMENG_NODE_MIN_WIDTH,
    Math.min(JIMENG_NODE_MAX_WIDTH, Math.round(width ?? JIMENG_NODE_DEFAULT_WIDTH))
  );
  const resolvedHeight = Math.max(
    JIMENG_NODE_MIN_HEIGHT,
    Math.min(JIMENG_NODE_MAX_HEIGHT, Math.round(height ?? JIMENG_NODE_DEFAULT_HEIGHT))
  );
  const lastSubmittedTime = useMemo(
    () => formatTimestamp(data.lastSubmittedAt ?? null, i18n.language),
    [data.lastSubmittedAt, i18n.language]
  );
  const selectedModel = data.model ?? DEFAULT_VIDEO_MODEL;
  const selectedReferenceMode = data.referenceMode ?? DEFAULT_REFERENCE_MODE;
  const selectedAspectRatio = data.aspectRatio ?? DEFAULT_ASPECT_RATIO;
  const selectedDuration = data.durationSeconds ?? DEFAULT_DURATION;
  const selectedVideoResolution = data.videoResolution ?? DEFAULT_VIDEO_RESOLUTION;
  const durationSuggestionSnapshot = useMemo(() => readDurationSuggestionSnapshot(data), [data]);

  const modelOptions = useMemo(
    () => JIMENG_VIDEO_MODEL_OPTIONS.map((option) => ({ value: option.value, label: t(option.labelKey) })),
    [t]
  );
  const referenceModeOptions = useMemo(
    () => JIMENG_REFERENCE_MODE_OPTIONS.map((option) => ({ value: option.value, label: t(option.labelKey) })),
    [t]
  );
  const aspectRatioOptions = useMemo(
    () => JIMENG_ASPECT_RATIO_OPTIONS.map((option) => ({ value: option.value, label: t(option.labelKey) })),
    [t]
  );
  const durationOptions = useMemo(
    () => JIMENG_DURATION_OPTIONS.map((option) => ({ value: option.value, label: t(option.labelKey) })),
    [t]
  );
  const videoResolutionOptions = useMemo(
    () => JIMENG_VIDEO_RESOLUTION_OPTIONS.map((option) => ({ value: option.value, label: t(option.labelKey) })),
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
    if (orderedReferenceImages.length === 0) {
      setShowImagePicker(false);
      setPickerCursor(null);
      setPickerActiveIndex(0);
      setDraggingReferenceIndex(null);
      setDragOverReferenceIndex(null);
      return;
    }

    setPickerActiveIndex((previous) => Math.min(previous, orderedReferenceImages.length - 1));
  }, [orderedReferenceImages.length]);

  useEffect(() => {
    if (!showImagePicker) {
      return;
    }

    pickerItemRefs.current[pickerActiveIndex]?.scrollIntoView({
      block: 'nearest',
    });
  }, [pickerActiveIndex, showImagePicker]);

  useEffect(() => {
    const handleOutside = (event: MouseEvent) => {
      if (rootRef.current?.contains(event.target as globalThis.Node)) {
        return;
      }

      setShowImagePicker(false);
      setPickerCursor(null);
    };

    document.addEventListener('mousedown', handleOutside, true);
    return () => {
      document.removeEventListener('mousedown', handleOutside, true);
    };
  }, []);

  useEffect(() => {
    updateNodeInternals(id);
  }, [id, incomingAudios.length, orderedReferenceImages.length, resolvedHeight, resolvedWidth, updateNodeInternals]);

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

  const handleMoveReferenceImage = useCallback((fromIndex: number, toIndex: number) => {
    const nextOrder = moveItem(orderedReferenceImages, fromIndex, toIndex);
    updateNodeData(id, { referenceImageOrder: nextOrder });
  }, [id, orderedReferenceImages, updateNodeData]);

  useEffect(() => {
    const previousOrderedReferenceImages = previousOrderedReferenceImagesRef.current;
    if (!previousOrderedReferenceImages) {
      previousOrderedReferenceImagesRef.current = orderedReferenceImages;
      return;
    }

    if (areReferenceImageOrdersEqual(previousOrderedReferenceImages, orderedReferenceImages)) {
      return;
    }

    previousOrderedReferenceImagesRef.current = orderedReferenceImages;
    const nextPrompt = remapReferenceTokensByImageOrder(
      promptValueRef.current,
      previousOrderedReferenceImages,
      orderedReferenceImages
    );
    if (nextPrompt === promptValueRef.current) {
      return;
    }

    updatePrompt(nextPrompt);
  }, [orderedReferenceImages, updatePrompt]);

  const insertImageReference = useCallback((imageIndex: number) => {
    const marker = buildShortReferenceToken(imageIndex);
    const currentPrompt = promptValueRef.current;
    const cursor = pickerCursor ?? currentPrompt.length;
    const { nextText, nextCursor } = insertReferenceToken(currentPrompt, cursor, marker);

    handlePromptChange(nextText);
    setShowImagePicker(false);
    setPickerCursor(null);
    setPickerActiveIndex(0);

    requestAnimationFrame(() => {
      promptRef.current?.focus();
      promptRef.current?.setSelectionRange(nextCursor, nextCursor);
    });
  }, [handlePromptChange, pickerCursor]);

  const handleReferenceDragStart = useCallback((index: number, event: ReactDragEvent<HTMLDivElement>) => {
    setDraggingReferenceIndex(index);
    setDragOverReferenceIndex(index);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', String(index));
  }, []);

  const handleReferenceDragEnter = useCallback((index: number) => {
    if (draggingReferenceIndex === null) {
      return;
    }
    setDragOverReferenceIndex(index);
  }, [draggingReferenceIndex]);

  const handleReferenceDrop = useCallback((toIndex: number, event: ReactDragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();

    const fromIndex = draggingReferenceIndex;
    setDraggingReferenceIndex(null);
    setDragOverReferenceIndex(null);
    if (fromIndex === null || fromIndex === toIndex) {
      return;
    }

    handleMoveReferenceImage(fromIndex, toIndex);
  }, [draggingReferenceIndex, handleMoveReferenceImage]);

  const handleReferenceDragEnd = useCallback(() => {
    setDraggingReferenceIndex(null);
    setDragOverReferenceIndex(null);
  }, []);

  const handleOptimizePrompt = useCallback(async () => {
    const sourcePrompt = promptValueRef.current;
    const currentPrompt = sourcePrompt.trim();
    if (!currentPrompt) {
      const message = t('node.jimeng.promptRequired');
      updateNodeData(id, { lastError: null });
      setPromptOptimizationError(message);
      await showErrorDialog(message, t('common.error'));
      return;
    }

    setIsOptimizingPrompt(true);
    setPromptOptimizationError(null);
    updateNodeData(id, { lastError: null });

    try {
      const previousDurationSuggestion = readDurationSuggestionSnapshot(data);
      const result = await optimizeCanvasPrompt({
        mode: 'jimeng',
        prompt: currentPrompt,
        referenceImages: orderedReferenceImages,
      });
      if (promptValueRef.current !== sourcePrompt) {
        return;
      }

      const nextPrompt = result.prompt;
      const nextDurationSuggestion = buildDurationSuggestionSnapshot(result.durationRecommendation);
      setLastPromptOptimizationMeta({
        modelLabel: [result.context.provider, result.context.model].filter(Boolean).join(' / '),
        referenceImageCount: result.usedReferenceImages ? orderedReferenceImages.length : 0,
      });

      const promptChanged = nextPrompt !== sourcePrompt;
      const durationChanged = !areDurationSuggestionSnapshotsEqual(previousDurationSuggestion, nextDurationSuggestion);

      if (promptChanged || durationChanged) {
        setLastPromptOptimizationUndoState({
          previousPrompt: sourcePrompt,
          appliedPrompt: nextPrompt,
          previousDurationSuggestion,
          appliedDurationSuggestion: nextDurationSuggestion,
        });
      } else {
        setLastPromptOptimizationUndoState(null);
      }

      updatePrompt(nextPrompt);
      updateNodeData(id, toDurationSuggestionNodeData(nextDurationSuggestion));

      requestAnimationFrame(() => {
        promptRef.current?.focus();
        const cursor = nextPrompt.length;
        promptRef.current?.setSelectionRange(cursor, cursor);
      });
    } catch (error) {
      const message =
        error instanceof Error && error.message.trim().length > 0
          ? error.message
          : t('node.jimeng.optimizePromptFailed');
      setPromptOptimizationError(message);
      await showErrorDialog(message, t('common.error'));
    } finally {
      setIsOptimizingPrompt(false);
    }
  }, [data, id, orderedReferenceImages, t, updateNodeData, updatePrompt]);

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
    updateNodeData(id, toDurationSuggestionNodeData(lastPromptOptimizationUndoState.previousDurationSuggestion));
    requestAnimationFrame(() => {
      promptRef.current?.focus();
      const cursor = restoredPrompt.length;
      promptRef.current?.setSelectionRange(cursor, cursor);
    });
  }, [id, lastPromptOptimizationUndoState, updateNodeData, updatePrompt]);

  const handleGenerate = useCallback(async () => {
    const prompt = data.prompt?.trim() ?? '';
    if (!prompt) {
      const message = t('node.jimeng.promptRequired');
      updateNodeData(id, { lastError: message });
      await showErrorDialog(message, t('common.error'));
      return;
    }

    if (isGenerateBlocked) {
      const message = t('node.jimeng.cliBlockedAudioNeedsImage');
      updateNodeData(id, { lastError: message });
      await showErrorDialog(message, t('common.error'));
      return;
    }

    setPromptOptimizationError(null);
    setCliStatusMessage(null);
    updateNodeData(id, { isSubmitting: true, lastError: null });

    let createdResultNodeId: string | null = null;

    try {
      const startedAt = Date.now();
      const resultNodePosition = findNodePosition(
        id,
        JIMENG_VIDEO_RESULT_NODE_DEFAULT_WIDTH,
        JIMENG_VIDEO_RESULT_NODE_DEFAULT_HEIGHT
      );
      createdResultNodeId = addNode(
        CANVAS_NODE_TYPES.jimengVideoResult,
        resultNodePosition,
        {
          sourceNodeId: id,
          displayName: buildJimengVideoResultNodeTitle(prompt, t('node.jimeng.resultNodeTitle')),
          submitId: null,
          sourceUrl: null,
          posterSourceUrl: null,
          videoUrl: null,
          previewImageUrl: null,
          videoFileName: null,
          aspectRatio: selectedAspectRatio,
          duration: selectedDuration,
          isGenerating: true,
          generationStartedAt: startedAt,
          generationDurationMs: 180000,
          lastGeneratedAt: null,
          lastError: null,
        },
        { inheritParentFromNodeId: id }
      );
      addEdge(id, createdResultNodeId);

      const generationResponse = await generateJimengVideos({
        prompt,
        modelVersion: selectedModel,
        referenceMode: selectedReferenceMode,
        aspectRatio: selectedAspectRatio,
        durationSeconds: selectedDuration,
        videoResolution: selectedVideoResolution,
        referenceImageSources: orderedReferenceImages,
        referenceAudioSources: incomingAudios.map((item) => item.audioUrl),
      });
      const primaryResult = generationResponse.videos[0];
      if (!primaryResult) {
        throw new Error(t('node.jimeng.resultEmpty'));
      }

      const completedAt = Date.now();
      updateNodeData(id, {
        isSubmitting: false,
        lastSubmittedAt: completedAt,
        lastError: null,
      });

      if (createdResultNodeId) {
        updateNodeData(createdResultNodeId, {
          submitId: generationResponse.submitId,
          sourceUrl: primaryResult.sourceUrl ?? null,
          posterSourceUrl: primaryResult.posterSourceUrl ?? null,
          videoUrl: primaryResult.videoUrl ?? null,
          previewImageUrl: primaryResult.previewImageUrl ?? null,
          videoFileName: primaryResult.fileName ?? null,
          aspectRatio: primaryResult.aspectRatio ?? selectedAspectRatio,
          duration: primaryResult.duration ?? selectedDuration,
          width: primaryResult.width ?? undefined,
          height: primaryResult.height ?? undefined,
          isGenerating: false,
          generationStartedAt: null,
          lastGeneratedAt: completedAt,
          lastError: null,
        });
      }
    } catch (error) {
      const content = resolveErrorContent(error, t('node.jimeng.submitFailed'));
      updateNodeData(id, { isSubmitting: false, lastError: content.message });
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
    data.prompt,
    findNodePosition,
    id,
    incomingAudios,
    isGenerateBlocked,
    orderedReferenceImages,
    selectedAspectRatio,
    selectedDuration,
    selectedModel,
    selectedReferenceMode,
    selectedVideoResolution,
    t,
    updateNodeData,
  ]);

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
      const content = resolveErrorContent(error, t('node.jimeng.checkCliFailed'));
      setCliStatusMessage(content.message);
      await showErrorDialog(content.message, t('common.error'), content.details);
    } finally {
      setIsCheckingCliStatus(false);
    }
  }, [t]);

  const handlePromptKeyDown = useCallback((event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Backspace' || event.key === 'Delete') {
      const currentPrompt = promptValueRef.current;
      const selectionStart = event.currentTarget.selectionStart ?? currentPrompt.length;
      const selectionEnd = event.currentTarget.selectionEnd ?? selectionStart;
      const deletionDirection = event.key === 'Backspace' ? 'backward' : 'forward';
      const deleteRange = resolveReferenceAwareDeleteRange(
        currentPrompt,
        selectionStart,
        selectionEnd,
        deletionDirection,
        orderedReferenceImages.length
      );
      if (deleteRange) {
        event.preventDefault();
        const { nextText, nextCursor } = removeTextRange(currentPrompt, deleteRange);
        handlePromptChange(nextText);
        requestAnimationFrame(() => {
          promptRef.current?.focus();
          promptRef.current?.setSelectionRange(nextCursor, nextCursor);
        });
        return;
      }
    }

    if (showImagePicker && orderedReferenceImages.length > 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        event.stopPropagation();
        setPickerActiveIndex((previous) => (previous + 1) % orderedReferenceImages.length);
        return;
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault();
        event.stopPropagation();
        setPickerActiveIndex((previous) =>
          previous === 0 ? orderedReferenceImages.length - 1 : previous - 1
        );
        return;
      }

      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        event.stopPropagation();
        insertImageReference(pickerActiveIndex);
        return;
      }
    }

    if (event.key === '@' && orderedReferenceImages.length > 0) {
      event.preventDefault();
      event.stopPropagation();
      const cursor = event.currentTarget.selectionStart ?? promptValueRef.current.length;
      setPickerAnchor(resolvePickerAnchor(promptPanelRef.current, event.currentTarget, cursor));
      setPickerCursor(cursor);
      setShowImagePicker(true);
      setPickerActiveIndex(0);
      return;
    }

    if (event.key === 'Escape' && showImagePicker) {
      event.preventDefault();
      event.stopPropagation();
      setShowImagePicker(false);
      setPickerCursor(null);
      setPickerActiveIndex(0);
      return;
    }

    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      void handleGenerate();
    }
  }, [
    handleGenerate,
    handlePromptChange,
    insertImageReference,
    orderedReferenceImages.length,
    pickerActiveIndex,
    showImagePicker,
  ]);

  const combinedError = promptOptimizationError ?? data.lastError;
  const canUndoPromptOptimization = Boolean(
    lastPromptOptimizationUndoState
    && (data.prompt ?? '') === lastPromptOptimizationUndoState.appliedPrompt
  );
  const promptOptimizationNotice = lastPromptOptimizationMeta
    ? `${t('node.jimeng.optimizeModelLabel', {
      model: lastPromptOptimizationMeta.modelLabel,
    })} | ${t('node.jimeng.optimizeReferenceImagesLabel', {
      status:
        lastPromptOptimizationMeta.referenceImageCount > 0
          ? t('node.jimeng.optimizeReferenceImagesUsed', {
            count: lastPromptOptimizationMeta.referenceImageCount,
          })
          : t('node.jimeng.optimizeReferenceImagesUnused'),
    })}`
    : null;
  const durationSuggestionText = buildDurationSuggestionText(durationSuggestionSnapshot, t);
  const cliModeHint = useMemo(() => {
    if (isGenerateBlocked) {
      return t('node.jimeng.cliBlockedAudioNeedsImage');
    }

    if (incomingAudios.length > 0) {
      const effectiveModel = resolveJimengCliEffectiveVideoModel('multimodal2video', selectedModel);
      return t('node.jimeng.cliHint.multimodal2video', {
        command: t('node.jimeng.cliMode.multimodal2video'),
        model: effectiveModel
          ? t(`node.jimeng.modelOptions.${resolveJimengVideoModelOptionKey(effectiveModel)}`)
          : '-',
      });
    }

    if (orderedReferenceImages.length === 0) {
      const effectiveModel = resolveJimengCliEffectiveVideoModel('text2video', selectedModel);
      return t('node.jimeng.cliHint.text2video', {
        command: t('node.jimeng.cliMode.text2video'),
        model: effectiveModel
          ? t(`node.jimeng.modelOptions.${resolveJimengVideoModelOptionKey(effectiveModel)}`)
          : '-',
      });
    }

    if (orderedReferenceImages.length === 1) {
      return t('node.jimeng.cliHint.image2video', {
        command: t('node.jimeng.cliMode.image2video'),
        duration: resolveJimengVideoModelDurationRange(selectedModel),
        resolution:
          selectedModel === 'seedance2.0' || selectedModel === 'seedance2.0fast'
            ? '720p'
            : '720p / 1080p',
      });
    }

    if (selectedReferenceMode === 'firstLastFrame') {
      const effectiveModel = resolveJimengCliEffectiveVideoModel('frames2video', selectedModel) ?? 'seedance2.0fast';
      return t('node.jimeng.cliHint.frames2video', {
        command: t('node.jimeng.cliMode.frames2video'),
        model: t(`node.jimeng.modelOptions.${resolveJimengVideoModelOptionKey(effectiveModel)}`),
        duration: resolveJimengVideoModelDurationRange(effectiveModel),
        resolution:
          effectiveModel === '3.0' || effectiveModel === '3.5pro'
            ? '720p / 1080p'
            : '720p',
      });
    }

    if (selectedReferenceMode === 'smartFrames') {
      return orderedReferenceImages.length <= 2
        ? t('node.jimeng.cliHint.multiframeTwo', {
          command: t('node.jimeng.cliMode.multiframe2video'),
        })
        : t('node.jimeng.cliHint.multiframeMany', {
          command: t('node.jimeng.cliMode.multiframe2video'),
          count: orderedReferenceImages.length,
        });
    }

    const effectiveModel = resolveJimengCliEffectiveVideoModel('multimodal2video', selectedModel);
    return t('node.jimeng.cliHint.multimodal2video', {
      command: t('node.jimeng.cliMode.multimodal2video'),
      model: effectiveModel
        ? t(`node.jimeng.modelOptions.${resolveJimengVideoModelOptionKey(effectiveModel)}`)
        : '-',
    });
  }, [
    incomingAudios.length,
    isGenerateBlocked,
    orderedReferenceImages.length,
    selectedModel,
    selectedReferenceMode,
    t,
  ]);

  const headerStatus = useMemo(() => {
    if (data.isSubmitting) {
      return (
        <NodeStatusBadge
          icon={<Loader2 className="h-3 w-3" />}
          label={t('node.jimeng.submitting')}
          tone="processing"
          animate
        />
      );
    }

    if (isOptimizingPrompt) {
      return (
        <NodeStatusBadge
          icon={<Loader2 className="h-3 w-3" />}
          label={t('node.jimeng.optimizingPrompt')}
          tone="processing"
          animate
        />
      );
    }

    if (isCheckingCliStatus) {
      return (
        <NodeStatusBadge
          icon={<Loader2 className="h-3 w-3" />}
          label={t('node.jimeng.checkingCli')}
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
  }, [combinedError, data.isSubmitting, isCheckingCliStatus, isOptimizingPrompt, t]);

  const statusInfoText = combinedError
    ?? (data.isSubmitting
      ? t('node.jimeng.submitting')
      : cliStatusMessage
        ?? (lastSubmittedTime
          ? t('node.jimeng.resultReturnedAt', { time: lastSubmittedTime })
          : [cliModeHint, durationSuggestionText, promptOptimizationNotice].filter(Boolean).join(' | ')));

  return (
    <div
      ref={rootRef}
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

      <div
        ref={promptPanelRef}
        className="relative min-h-0 flex-1 rounded-lg border border-[rgba(255,255,255,0.1)] bg-bg-dark/45 p-2"
      >
        <div className="flex h-full min-h-0 flex-col gap-2">
          <textarea
            ref={promptRef}
            value={data.prompt ?? ''}
            onChange={(event) => handlePromptChange(event.target.value)}
            placeholder={t('node.jimeng.promptPlaceholder')}
            className="ui-scrollbar nodrag nowheel min-h-[148px] flex-1 w-full resize-none rounded-xl border border-white/10 bg-black/15 px-3 py-2 text-sm leading-6 text-text-dark outline-none placeholder:text-text-muted/70 focus:border-accent/50"
            onMouseDown={(event) => event.stopPropagation()}
            onKeyDownCapture={handlePromptKeyDown}
          />

          <div className="flex min-h-[44px] flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-black/10 px-2 py-2">
            {orderedReferenceImages.length > 0 ? (
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                {incomingImageItems.map((item, index) => (
                  <div
                    key={`${item.imageUrl}-${index}`}
                    draggable
                    className={`flex items-center gap-1.5 rounded-lg border bg-black/15 px-1.5 py-1.5 transition-colors ${
                      draggingReferenceIndex === index
                        ? 'border-accent/55 opacity-70'
                        : dragOverReferenceIndex === index
                          ? 'border-accent/55 bg-accent/10'
                          : 'border-white/10'
                    }`}
                    onMouseDown={(event) => event.stopPropagation()}
                    onDragStart={(event) => handleReferenceDragStart(index, event)}
                    onDragEnter={() => handleReferenceDragEnter(index)}
                    onDragOver={(event) => {
                      event.preventDefault();
                      event.dataTransfer.dropEffect = 'move';
                    }}
                    onDrop={(event) => handleReferenceDrop(index, event)}
                    onDragEnd={handleReferenceDragEnd}
                  >
                    <CanvasNodeImage
                      src={item.displayUrl}
                      alt={t('node.jimeng.referenceImageLabel', { index: index + 1 })}
                      viewerSourceUrl={item.displayUrl}
                      viewerImageList={incomingImageDisplayList}
                      className="h-9 w-9 rounded-md object-cover"
                      draggable={false}
                    />
                    <div className="min-w-0">
                      <div className="truncate text-[11px] font-medium text-text-dark">
                        {item.tokenLabel}
                      </div>
                      <div className="truncate text-[10px] text-text-muted">
                        {item.label}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}

            {incomingAudios.length > 0 ? (
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                {incomingAudios.map((audio, index) => (
                  <div
                    key={`${audio.audioUrl}-${index}`}
                    className="flex max-w-full items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-2 py-1.5 text-[11px] text-text-dark"
                    onMouseDown={(event) => event.stopPropagation()}
                  >
                    <AudioLines className="h-3.5 w-3.5 shrink-0 text-text-muted" />
                    <span className="max-w-[92px] truncate">{audio.label}</span>
                  </div>
                ))}
              </div>
            ) : null}

            {orderedReferenceImages.length === 0 && incomingAudios.length === 0 ? (
              <div className="text-[11px] text-text-muted">
                {t('node.jimeng.referenceCount', { count: 0 })}
              </div>
            ) : null}
          </div>
        </div>

        {showImagePicker && incomingImageItems.length > 0 && (
          <div
            className="nowheel absolute z-30 w-[156px] overflow-hidden rounded-xl border border-[rgba(255,255,255,0.16)] bg-surface-dark shadow-xl"
            style={{ left: pickerAnchor.left, top: pickerAnchor.top }}
            onMouseDown={(event) => event.stopPropagation()}
            onWheelCapture={(event) => event.stopPropagation()}
          >
            <div
              className="ui-scrollbar nowheel max-h-[200px] overflow-y-auto"
              onWheelCapture={(event) => event.stopPropagation()}
              role="listbox"
            >
              {incomingImageItems.map((item, index) => (
                <button
                  key={`${item.imageUrl}-${index}`}
                  ref={(node) => {
                    pickerItemRefs.current[index] = node;
                  }}
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    insertImageReference(index);
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
                  <CanvasNodeImage
                    src={item.displayUrl}
                    alt={item.label}
                    viewerSourceUrl={item.displayUrl}
                    viewerImageList={incomingImageDisplayList}
                    className="h-8 w-8 rounded object-cover"
                    draggable={false}
                  />
                  <div className="min-w-0">
                    <div className="truncate text-[11px] font-medium text-text-dark">
                      {item.tokenLabel}
                    </div>
                    <div className="truncate text-[11px] text-text-muted">
                      {item.label}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="mt-2 flex items-center gap-2">
        <div className="ui-scrollbar min-w-0 flex-1 overflow-x-auto overflow-y-hidden">
          <div className="flex w-max min-w-full items-center gap-1.5 pr-1">
            <FixedControlChip
              label={t('node.jimeng.parameters.model')}
              value={selectedModel}
              options={modelOptions}
              onChange={(nextValue) => updateNodeData(id, { model: nextValue })}
            />
            <FixedControlChip
              label={t('node.jimeng.parameters.referenceMode')}
              value={selectedReferenceMode}
              options={referenceModeOptions}
              onChange={(nextValue) => updateNodeData(id, { referenceMode: nextValue })}
            />
            <FixedControlChip
              label={t('node.jimeng.parameters.aspectRatio')}
              value={selectedAspectRatio}
              options={aspectRatioOptions}
              onChange={(nextValue) => updateNodeData(id, { aspectRatio: nextValue })}
            />
            <FixedControlChip
              label={t('node.jimeng.parameters.duration')}
              value={selectedDuration}
              options={durationOptions}
              onChange={(nextValue) => updateNodeData(id, { durationSeconds: nextValue as JimengDurationSeconds })}
            />
            <FixedControlChip
              label={t('node.jimeng.parameters.videoResolution')}
              value={selectedVideoResolution}
              options={videoResolutionOptions}
              onChange={(nextValue) => updateNodeData(id, { videoResolution: nextValue })}
            />
            <UiChipButton
              type="button"
              className={`${NODE_CONTROL_CHIP_CLASS} shrink-0 !w-8 !px-0 justify-center`}
              disabled={isOptimizingPrompt || data.isSubmitting}
              aria-label={t('node.jimeng.optimizePrompt')}
              title={t('node.jimeng.optimizePrompt')}
              onClick={() => void handleOptimizePrompt()}
            >
              {isOptimizingPrompt ? (
                <Loader2 className="h-4 w-4 origin-center scale-[1.12] animate-spin" />
              ) : (
                <Wand2 className="h-4 w-4 origin-center scale-[1.18]" strokeWidth={2.45} />
              )}
            </UiChipButton>
            <UiChipButton
              type="button"
              disabled={isOptimizingPrompt || !canUndoPromptOptimization}
              className={`${NODE_CONTROL_CHIP_CLASS} shrink-0 !w-8 !px-0 justify-center`}
              aria-label={t('node.jimeng.undoOptimizedPrompt')}
              title={t('node.jimeng.undoOptimizedPrompt')}
              onClick={handleUndoOptimizedPrompt}
            >
              <Undo2 className="h-4 w-4 origin-center scale-[1.08]" strokeWidth={2.3} />
            </UiChipButton>
            <UiChipButton
              type="button"
              disabled={isCheckingCliStatus || data.isSubmitting}
              className={`${NODE_CONTROL_CHIP_CLASS} shrink-0 !px-2.5`}
              aria-label={t('node.jimeng.checkCli')}
              title={t('node.jimeng.checkCli')}
              onClick={() => void handleCheckCliStatus()}
            >
              {isCheckingCliStatus ? (
                <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.3} />
              ) : null}
              {t('node.jimeng.checkCli')}
            </UiChipButton>
          </div>
        </div>
        <UiButton
          type="button"
          variant="primary"
          className={NODE_CONTROL_PRIMARY_BUTTON_CLASS}
          disabled={data.isSubmitting || isOptimizingPrompt || isGenerateBlocked}
          onClick={() => void handleGenerate()}
        >
          {data.isSubmitting ? (
            <Loader2 className={`${NODE_CONTROL_GENERATE_ICON_CLASS} animate-spin`} strokeWidth={2.5} />
          ) : (
            <Sparkles className={NODE_CONTROL_GENERATE_ICON_CLASS} strokeWidth={2.5} />
          )}
          {data.isSubmitting ? t('node.jimeng.submitting') : t('node.jimeng.submit')}
        </UiButton>
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
        id="target"
        position={Position.Left}
        className="!h-2.5 !w-2.5 !border-2 !border-surface-dark !bg-accent"
      />
      <NodeResizeHandle minWidth={JIMENG_NODE_MIN_WIDTH} minHeight={JIMENG_NODE_MIN_HEIGHT} />
    </div>
  );
});

JimengNode.displayName = 'JimengNode';
