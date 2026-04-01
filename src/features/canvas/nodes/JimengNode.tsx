import {
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Handle,
  Position,
  useUpdateNodeInternals,
  type NodeProps,
} from "@xyflow/react";
import {
  AudioLines,
  GripVertical,
  Loader2,
  Sparkles,
  TriangleAlert,
  Undo2,
  Video,
  Wand2,
  X,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import {
  CANVAS_NODE_TYPES,
  JIMENG_VIDEO_RESULT_NODE_DEFAULT_HEIGHT,
  JIMENG_VIDEO_RESULT_NODE_DEFAULT_WIDTH,
  isAudioNode,
  type JimengDurationSeconds,
  type JimengNodeData,
  type JimengReferenceMode,
  type JimengVideoModelId,
} from "@/features/canvas/domain/canvasNodes";
import { resolveNodeDisplayName } from "@/features/canvas/domain/nodeDisplay";
import { collectConnectedReferenceVisuals } from "@/features/canvas/application/connectedReferenceVisuals";
import {
  resolveErrorContent,
  showErrorDialog,
} from "@/features/canvas/application/errorDialog";
import { resolveImageDisplayUrl } from "@/features/canvas/application/imageData";
import { flushCurrentProjectToDiskSafely } from "@/features/canvas/application/projectPersistence";
import {
  optimizeCanvasPrompt,
  type PromptDurationRecommendation,
} from "@/features/canvas/application/promptOptimization";
import {
  NodeHeader,
  NODE_HEADER_FLOATING_POSITION_CLASS,
} from "@/features/canvas/ui/NodeHeader";
import { NodeResizeHandle } from "@/features/canvas/ui/NodeResizeHandle";
import { CanvasNodeImage } from "@/features/canvas/ui/CanvasNodeImage";
import { NodeStatusBadge } from "@/features/canvas/ui/NodeStatusBadge";
import {
  NODE_CONTROL_CHIP_CLASS,
  NODE_CONTROL_GENERATE_ICON_CLASS,
  NODE_CONTROL_PRIMARY_BUTTON_CLASS,
} from "@/features/canvas/ui/nodeControlStyles";
import { UiButton, UiChipButton, UiSelect } from "@/components/ui";
import { useCanvasStore } from "@/stores/canvasStore";
import { generateJimengVideos } from "@/features/jimeng/application/jimengVideoSubmission";
import {
  areReferenceImageOrdersEqual,
  buildShortReferenceToken,
  findReferenceTokens,
  insertReferenceToken,
  remapReferenceTokensByImageOrder,
  removeTextRange,
  resolveReferenceAwareDeleteRange,
} from "@/features/canvas/application/referenceTokenEditing";
import {
  JIMENG_ASPECT_RATIO_OPTIONS,
  JIMENG_DURATION_OPTIONS,
  JIMENG_REFERENCE_MODE_OPTIONS,
  JIMENG_VIDEO_MODEL_OPTIONS,
  resolveJimengVideoRequiredReferenceImageCount,
} from "@/features/jimeng/domain/jimengOptions";

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

interface PromptReferencePreviewState {
  imageUrl: string;
  displayUrl: string;
  alt: string;
  left: number;
  top: number;
}

const JIMENG_NODE_DEFAULT_WIDTH = 920;
const JIMENG_NODE_DEFAULT_HEIGHT = 500;
const JIMENG_NODE_MIN_WIDTH = 820;
const JIMENG_NODE_MIN_HEIGHT = 420;
const JIMENG_NODE_MAX_WIDTH = 1320;
const JIMENG_NODE_MAX_HEIGHT = 1040;
const DEFAULT_VIDEO_MODEL: JimengVideoModelId = "seedance2.0";
const DEFAULT_REFERENCE_MODE: JimengReferenceMode = "allAround";
const DEFAULT_ASPECT_RATIO = "16:9";
const DEFAULT_DURATION: JimengDurationSeconds = 5;
const DEFAULT_VIDEO_RESOLUTION = "1080p";
const PICKER_FALLBACK_ANCHOR: PickerAnchor = { left: 8, top: 8 };
const PICKER_Y_OFFSET_PX = 20;

function formatTimestamp(
  timestamp: number | null | undefined,
  locale: string,
): string | null {
  if (
    typeof timestamp !== "number" ||
    !Number.isFinite(timestamp) ||
    timestamp <= 0
  ) {
    return null;
  }

  return new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

function buildJimengVideoResultNodeTitle(fallbackTitle: string): string {
  return fallbackTitle;
}

function buildClearedDurationSuggestionSnapshot(): PromptDurationSuggestionSnapshot {
  return {
    suggestedDurationSeconds: null,
    suggestedDurationEstimatedSeconds: null,
    suggestedDurationExceedsLimit: false,
    suggestedDurationReason: null,
  };
}

function readDurationSuggestionSnapshot(
  data: JimengNodeData,
): PromptDurationSuggestionSnapshot {
  return {
    suggestedDurationSeconds:
      typeof data.suggestedDurationSeconds === "number"
        ? data.suggestedDurationSeconds
        : null,
    suggestedDurationEstimatedSeconds:
      typeof data.suggestedDurationEstimatedSeconds === "number"
        ? data.suggestedDurationEstimatedSeconds
        : null,
    suggestedDurationExceedsLimit: data.suggestedDurationExceedsLimit === true,
    suggestedDurationReason:
      typeof data.suggestedDurationReason === "string" &&
      data.suggestedDurationReason.trim().length > 0
        ? data.suggestedDurationReason.trim()
        : null,
  };
}

function buildDurationSuggestionSnapshot(
  recommendation: PromptDurationRecommendation | null | undefined,
): PromptDurationSuggestionSnapshot {
  if (!recommendation) {
    return buildClearedDurationSuggestionSnapshot();
  }

  return {
    suggestedDurationSeconds: recommendation.recommendedDurationSeconds,
    suggestedDurationEstimatedSeconds: recommendation.estimatedDurationSeconds,
    suggestedDurationExceedsLimit: recommendation.exceedsMaxDuration,
    suggestedDurationReason:
      typeof recommendation.reason === "string" &&
      recommendation.reason.trim().length > 0
        ? recommendation.reason.trim()
        : null,
  };
}

function toDurationSuggestionNodeData(
  snapshot: PromptDurationSuggestionSnapshot,
): Partial<JimengNodeData> {
  return {
    suggestedDurationSeconds: snapshot.suggestedDurationSeconds,
    suggestedDurationEstimatedSeconds:
      snapshot.suggestedDurationEstimatedSeconds,
    suggestedDurationExceedsLimit: snapshot.suggestedDurationExceedsLimit,
    suggestedDurationReason: snapshot.suggestedDurationReason,
  };
}

function areDurationSuggestionSnapshotsEqual(
  left: PromptDurationSuggestionSnapshot,
  right: PromptDurationSuggestionSnapshot,
): boolean {
  return (
    left.suggestedDurationSeconds === right.suggestedDurationSeconds &&
    left.suggestedDurationEstimatedSeconds ===
      right.suggestedDurationEstimatedSeconds &&
    left.suggestedDurationExceedsLimit ===
      right.suggestedDurationExceedsLimit &&
    left.suggestedDurationReason === right.suggestedDurationReason
  );
}

function moveItem<T>(items: T[], fromIndex: number, toIndex: number): T[] {
  if (
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= items.length ||
    toIndex >= items.length ||
    fromIndex === toIndex
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
  caretIndex: number,
): PickerAnchor {
  const mirror = document.createElement("div");
  const computed = window.getComputedStyle(textarea);
  const mirrorStyle = mirror.style;

  mirrorStyle.position = "absolute";
  mirrorStyle.visibility = "hidden";
  mirrorStyle.pointerEvents = "none";
  mirrorStyle.whiteSpace = "pre-wrap";
  mirrorStyle.overflowWrap = "break-word";
  mirrorStyle.wordBreak = "break-word";
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

  const marker = document.createElement("span");
  marker.textContent = textarea.value.slice(caretIndex, caretIndex + 1) || " ";
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
  caretIndex: number,
): PickerAnchor {
  if (!container) {
    return PICKER_FALLBACK_ANCHOR;
  }

  const containerRect = container.getBoundingClientRect();
  const textareaRect = textarea.getBoundingClientRect();
  const caretOffset = getTextareaCaretOffset(textarea, caretIndex);

  return {
    left: Math.max(
      0,
      textareaRect.left - containerRect.left + caretOffset.left,
    ),
    top: Math.max(
      0,
      textareaRect.top -
        containerRect.top +
        caretOffset.top +
        PICKER_Y_OFFSET_PX,
    ),
  };
}

function renderPromptWithHighlights(
  prompt: string,
  maxImageCount: number,
): ReactNode {
  if (!prompt) {
    return " ";
  }

  const segments: ReactNode[] = [];
  let lastIndex = 0;
  const referenceTokens = findReferenceTokens(prompt, maxImageCount);
  for (const token of referenceTokens) {
    if (token.start > lastIndex) {
      segments.push(
        <span key={`plain-${lastIndex}`}>
          {prompt.slice(lastIndex, token.start)}
        </span>,
      );
    }

    segments.push(
      <span
        key={`ref-${token.start}`}
        className="relative z-0 text-white [text-shadow:0.24px_0_currentColor,-0.24px_0_currentColor] before:absolute before:-inset-x-[4px] before:-inset-y-[1px] before:-z-10 before:rounded-[7px] before:bg-accent/55 before:content-['']"
      >
        {token.token}
      </span>,
    );

    lastIndex = token.end;
  }

  if (lastIndex < prompt.length) {
    segments.push(
      <span key={`plain-${lastIndex}`}>{prompt.slice(lastIndex)}</span>,
    );
  }

  return segments;
}

function renderPromptReferenceHoverTargets(
  prompt: string,
  maxImageCount: number,
  onTokenHover: (
    token: number,
    event: ReactMouseEvent<HTMLSpanElement>,
  ) => void,
  onTokenLeave: () => void,
  onTokenMouseDown: (
    tokenEnd: number,
    event: ReactMouseEvent<HTMLSpanElement>,
  ) => void,
): ReactNode {
  if (!prompt) {
    return " ";
  }

  const segments: ReactNode[] = [];
  let lastIndex = 0;
  const referenceTokens = findReferenceTokens(prompt, maxImageCount);
  for (const token of referenceTokens) {
    if (token.start > lastIndex) {
      segments.push(
        <span key={`hover-plain-${lastIndex}`} className="text-transparent">
          {prompt.slice(lastIndex, token.start)}
        </span>,
      );
    }

    segments.push(
      <span
        key={`hover-ref-${token.start}`}
        className="pointer-events-auto cursor-help select-none text-transparent"
        onMouseEnter={(event) => onTokenHover(token.value - 1, event)}
        onMouseMove={(event) => onTokenHover(token.value - 1, event)}
        onMouseLeave={onTokenLeave}
        onMouseDown={(event) => onTokenMouseDown(token.end, event)}
      >
        {token.token}
      </span>,
    );

    lastIndex = token.end;
  }

  if (lastIndex < prompt.length) {
    segments.push(
      <span key={`hover-plain-${lastIndex}`} className="text-transparent">
        {prompt.slice(lastIndex)}
      </span>,
    );
  }

  return segments;
}

function resolveOrderedReferenceImages(
  imageUrls: string[],
  preferredOrder: string[] | undefined,
): string[] {
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
            onChange(
              typeof value === "number"
                ? (Number(event.target.value) as T)
                : (event.target.value as T),
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

function buildDurationSuggestionText(
  snapshot: PromptDurationSuggestionSnapshot,
  t: ReturnType<typeof useTranslation>["t"],
): string | null {
  if (typeof snapshot.suggestedDurationSeconds !== "number") {
    return null;
  }

  if (
    snapshot.suggestedDurationExceedsLimit &&
    typeof snapshot.suggestedDurationEstimatedSeconds === "number"
  ) {
    return t("node.jimeng.durationSuggestionOverflow", {
      seconds: snapshot.suggestedDurationSeconds,
      estimated: snapshot.suggestedDurationEstimatedSeconds,
    });
  }

  return t("node.jimeng.durationSuggestionLabel", {
    seconds: snapshot.suggestedDurationSeconds,
  });
}

function resolveJimengVideoModelOptionKey(model: JimengVideoModelId): string {
  switch (model) {
    case "seedance2.0fast":
      return "seedance20fast";
    case "seedance2.0":
      return "seedance20";
    case "3.5pro":
      return "v3_5pro";
    case "3.0pro":
      return "v3_0pro";
    case "3.0fast":
      return "v3_0fast";
    case "3.0":
    default:
      return "v3_0";
  }
}

function resolveJimengVideoModelDurationRange(
  model: JimengVideoModelId,
): string {
  if (model === "3.0" || model === "3.0fast" || model === "3.0pro") {
    return "3-10s";
  }
  if (model === "3.5pro") {
    return "4-12s";
  }
  return "4-15s";
}

function resolveJimengCliEffectiveVideoModel(
  command:
    | "text2video"
    | "image2video"
    | "frames2video"
    | "multiframe2video"
    | "multimodal2video",
  selectedModel: JimengVideoModelId,
): JimengVideoModelId | null {
  if (command === "text2video" || command === "multimodal2video") {
    return selectedModel === "seedance2.0" ||
      selectedModel === "seedance2.0fast"
      ? selectedModel
      : "seedance2.0fast";
  }

  if (command === "frames2video") {
    return selectedModel === "3.0" ||
      selectedModel === "3.5pro" ||
      selectedModel === "seedance2.0" ||
      selectedModel === "seedance2.0fast"
      ? selectedModel
      : "seedance2.0fast";
  }

  if (command === "image2video") {
    return selectedModel;
  }

  return null;
}

export const JimengNode = memo(
  ({ id, data, selected, width, height }: JimengNodeProps) => {
    const { t, i18n } = useTranslation();
    const updateNodeInternals = useUpdateNodeInternals();
    const rootRef = useRef<HTMLDivElement>(null);
    const promptPanelRef = useRef<HTMLDivElement>(null);
    const promptPreviewHostRef = useRef<HTMLDivElement>(null);
    const [isOptimizingPrompt, setIsOptimizingPrompt] = useState(false);
    const [promptOptimizationError, setPromptOptimizationError] = useState<
      string | null
    >(null);
    const [lastPromptOptimizationMeta, setLastPromptOptimizationMeta] =
      useState<PromptOptimizationMeta | null>(null);
    const [
      lastPromptOptimizationUndoState,
      setLastPromptOptimizationUndoState,
    ] = useState<PromptOptimizationUndoState | null>(null);
    const promptRef = useRef<HTMLTextAreaElement>(null);
    const promptHighlightRef = useRef<HTMLDivElement>(null);
    const promptHoverLayerRef = useRef<HTMLDivElement>(null);
    const promptValueRef = useRef(data.prompt ?? "");
    const previousOrderedReferenceImagesRef = useRef<string[] | null>(null);
    const pickerItemRefs = useRef<Array<HTMLButtonElement | null>>([]);
    const [showImagePicker, setShowImagePicker] = useState(false);
    const [pickerCursor, setPickerCursor] = useState<number | null>(null);
    const [pickerActiveIndex, setPickerActiveIndex] = useState(0);
    const [pickerAnchor, setPickerAnchor] = useState<PickerAnchor>(
      PICKER_FALLBACK_ANCHOR,
    );
    const [promptReferencePreview, setPromptReferencePreview] =
      useState<PromptReferencePreviewState | null>(null);
    const [draggingReferenceIndex, setDraggingReferenceIndex] = useState<
      number | null
    >(null);
    const [dragOverReferenceIndex, setDragOverReferenceIndex] = useState<
      number | null
    >(null);
    const nodes = useCanvasStore((state) => state.nodes);
    const edges = useCanvasStore((state) => state.edges);
    const setSelectedNode = useCanvasStore((state) => state.setSelectedNode);
    const updateNodeData = useCanvasStore((state) => state.updateNodeData);
    const addNode = useCanvasStore((state) => state.addNode);
    const addEdge = useCanvasStore((state) => state.addEdge);
    const deleteEdge = useCanvasStore((state) => state.deleteEdge);
    const findNodePosition = useCanvasStore((state) => state.findNodePosition);

    const connectedReferenceImages = useMemo(
      () => collectConnectedReferenceImages(id, nodes, edges),
      [edges, id, nodes],
    );
    const incomingImages = useMemo(
      () => connectedReferenceImages.map((item) => item.imageUrl),
      [connectedReferenceImages],
    );
    const orderedReferenceImages = useMemo(
      () =>
        resolveOrderedReferenceImages(incomingImages, data.referenceImageOrder),
      [data.referenceImageOrder, incomingImages],
    );
    const connectedReferenceImageByUrl = useMemo(
      () =>
        new Map(
          connectedReferenceImages.map(
            (item) => [item.imageUrl, item] as const,
          ),
        ),
      [connectedReferenceImages],
    );
    const incomingImageDisplayList = useMemo(
      () =>
        orderedReferenceImages.map((imageUrl) =>
          resolveImageDisplayUrl(imageUrl),
        ),
      [orderedReferenceImages],
    );
    const incomingImageItems = useMemo(
      () =>
        orderedReferenceImages
          .map((imageUrl, index) => {
            const connectedItem = connectedReferenceImageByUrl.get(imageUrl);
            if (!connectedItem) {
              return null;
            }

            return {
              sourceEdgeId: connectedItem.sourceEdgeId,
              sourceNodeId: connectedItem.sourceNodeId,
              imageUrl,
              displayUrl: resolveImageDisplayUrl(imageUrl),
              tokenLabel: buildShortReferenceToken(index),
              label: t("node.jimeng.referenceImageLabel", { index: index + 1 }),
            };
          })
          .filter(
            (
              item,
            ): item is {
              sourceEdgeId: string;
              sourceNodeId: string;
              imageUrl: string;
              displayUrl: string;
              tokenLabel: string;
              label: string;
            } => Boolean(item),
          ),
      [connectedReferenceImageByUrl, orderedReferenceImages, t],
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

        const audioUrl = sourceNode.data.audioUrl?.trim() ?? "";
        if (!audioUrl || items.some((item) => item.audioUrl === audioUrl)) {
          continue;
        }

        items.push({
          audioUrl,
          label:
            sourceNode.data.displayName?.trim() ||
            sourceNode.data.audioFileName?.trim() ||
            t("node.jimeng.audioReferenceLabel", { index: items.length + 1 }),
        });
      }

      return items;
    }, [edges, id, nodes, t]);
    const resolvedTitle = useMemo(
      () => resolveNodeDisplayName(CANVAS_NODE_TYPES.jimeng, data),
      [data],
    );
    const resolvedWidth = Math.max(
      JIMENG_NODE_MIN_WIDTH,
      Math.min(
        JIMENG_NODE_MAX_WIDTH,
        Math.round(width ?? JIMENG_NODE_DEFAULT_WIDTH),
      ),
    );
    const resolvedHeight = Math.max(
      JIMENG_NODE_MIN_HEIGHT,
      Math.min(
        JIMENG_NODE_MAX_HEIGHT,
        Math.round(height ?? JIMENG_NODE_DEFAULT_HEIGHT),
      ),
    );
    const lastSubmittedTime = useMemo(
      () => formatTimestamp(data.lastSubmittedAt ?? null, i18n.language),
      [data.lastSubmittedAt, i18n.language],
    );
    const selectedModel = data.model ?? DEFAULT_VIDEO_MODEL;
    const selectedReferenceMode = data.referenceMode ?? DEFAULT_REFERENCE_MODE;
    const selectedAspectRatio = data.aspectRatio ?? DEFAULT_ASPECT_RATIO;
    const selectedDuration = data.durationSeconds ?? DEFAULT_DURATION;
    const durationSuggestionSnapshot = useMemo(
      () => readDurationSuggestionSnapshot(data),
      [data],
    );
    const requiredReferenceImageCount =
      resolveJimengVideoRequiredReferenceImageCount(selectedReferenceMode);
    const isFirstLastFrameCountInvalid =
      typeof requiredReferenceImageCount === "number" &&
      orderedReferenceImages.length !== requiredReferenceImageCount;
    const isGenerateBlocked =
      (orderedReferenceImages.length === 0 && incomingAudios.length > 0) ||
      isFirstLastFrameCountInvalid;

    const modelOptions = useMemo(
      () =>
        JIMENG_VIDEO_MODEL_OPTIONS.map((option) => ({
          value: option.value,
          label: t(option.labelKey),
        })),
      [t],
    );
    const referenceModeOptions = useMemo(
      () =>
        JIMENG_REFERENCE_MODE_OPTIONS.map((option) => ({
          value: option.value,
          label: t(option.labelKey),
        })),
      [t],
    );
    const aspectRatioOptions = useMemo(
      () =>
        JIMENG_ASPECT_RATIO_OPTIONS.map((option) => ({
          value: option.value,
          label: t(option.labelKey),
        })),
      [t],
    );
    const durationOptions = useMemo(
      () =>
        JIMENG_DURATION_OPTIONS.map((option) => ({
          value: option.value,
          label: t(option.labelKey),
        })),
      [t],
    );
    useEffect(() => {
      const externalPrompt = data.prompt ?? "";
      if (externalPrompt !== promptValueRef.current) {
        promptValueRef.current = externalPrompt;
        setPromptOptimizationError(null);
        setLastPromptOptimizationMeta(null);
        setLastPromptOptimizationUndoState(null);
      }
    }, [data.prompt]);

    useEffect(() => {
      if (data.videoResolution !== DEFAULT_VIDEO_RESOLUTION) {
        updateNodeData(
          id,
          { videoResolution: DEFAULT_VIDEO_RESOLUTION },
          { historyMode: "skip" },
        );
      }
    }, [data.videoResolution, id, updateNodeData]);

    useEffect(() => {
      if (orderedReferenceImages.length === 0) {
        setShowImagePicker(false);
        setPickerCursor(null);
        setPickerActiveIndex(0);
        setPromptReferencePreview(null);
        setDraggingReferenceIndex(null);
        setDragOverReferenceIndex(null);
        return;
      }

      setPickerActiveIndex((previous) =>
        Math.min(previous, orderedReferenceImages.length - 1),
      );
    }, [orderedReferenceImages.length]);

    useEffect(() => {
      setPromptReferencePreview(null);
    }, [data.prompt, orderedReferenceImages]);

    useEffect(() => {
      if (!showImagePicker) {
        return;
      }

      pickerItemRefs.current[pickerActiveIndex]?.scrollIntoView({
        block: "nearest",
      });
    }, [pickerActiveIndex, showImagePicker]);

    useEffect(() => {
      const handleOutside = (event: MouseEvent) => {
        if (rootRef.current?.contains(event.target as globalThis.Node)) {
          return;
        }

        setShowImagePicker(false);
        setPickerCursor(null);
        setPromptReferencePreview(null);
      };

      document.addEventListener("mousedown", handleOutside, true);
      return () => {
        document.removeEventListener("mousedown", handleOutside, true);
      };
    }, []);

    useEffect(() => {
      updateNodeInternals(id);
    }, [
      id,
      incomingAudios.length,
      orderedReferenceImages.length,
      resolvedHeight,
      resolvedWidth,
      updateNodeInternals,
    ]);

    const updatePrompt = useCallback(
      (nextPrompt: string) => {
        promptValueRef.current = nextPrompt;
        updateNodeData(id, { prompt: nextPrompt });
      },
      [id, updateNodeData],
    );

    const handlePromptChange = useCallback(
      (nextPrompt: string) => {
        setPromptOptimizationError(null);
        setLastPromptOptimizationMeta(null);
        setLastPromptOptimizationUndoState(null);
        updatePrompt(nextPrompt);
      },
      [updatePrompt],
    );

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

    const handleMoveReferenceImage = useCallback(
      (fromIndex: number, toIndex: number) => {
        const nextOrder = moveItem(orderedReferenceImages, fromIndex, toIndex);
        updateNodeData(id, { referenceImageOrder: nextOrder });
        void flushCurrentProjectToDiskSafely(
          "saving Jimeng video reference image order",
        );
      },
      [id, orderedReferenceImages, updateNodeData],
    );

    const handleRemoveReferenceImage = useCallback(
      (sourceEdgeId: string) => {
        setShowImagePicker(false);
        setPickerCursor(null);
        setPromptReferencePreview(null);
        setDraggingReferenceIndex(null);
        setDragOverReferenceIndex(null);
        deleteEdge(sourceEdgeId);
      },
      [deleteEdge],
    );

    useEffect(() => {
      const previousOrderedReferenceImages =
        previousOrderedReferenceImagesRef.current;
      if (!previousOrderedReferenceImages) {
        previousOrderedReferenceImagesRef.current = orderedReferenceImages;
        return;
      }

      if (
        areReferenceImageOrdersEqual(
          previousOrderedReferenceImages,
          orderedReferenceImages,
        )
      ) {
        return;
      }

      previousOrderedReferenceImagesRef.current = orderedReferenceImages;
      const nextPrompt = remapReferenceTokensByImageOrder(
        promptValueRef.current,
        previousOrderedReferenceImages,
        orderedReferenceImages,
      );
      if (nextPrompt === promptValueRef.current) {
        return;
      }

      updatePrompt(nextPrompt);
    }, [orderedReferenceImages, updatePrompt]);

    const insertImageReference = useCallback(
      (imageIndex: number) => {
        const marker = buildShortReferenceToken(imageIndex);
        const currentPrompt = promptValueRef.current;
        const cursor = pickerCursor ?? currentPrompt.length;
        const { nextText, nextCursor } = insertReferenceToken(
          currentPrompt,
          cursor,
          marker,
        );

        handlePromptChange(nextText);
        setShowImagePicker(false);
        setPickerCursor(null);
        setPickerActiveIndex(0);

        requestAnimationFrame(() => {
          promptRef.current?.focus();
          promptRef.current?.setSelectionRange(nextCursor, nextCursor);
          syncPromptHighlightScroll();
        });
      },
      [handlePromptChange, pickerCursor, syncPromptHighlightScroll],
    );

    const handleReferenceSortStart = useCallback(
      (index: number, event: ReactPointerEvent<HTMLElement>) => {
        if (event.button !== 0) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();
        setDraggingReferenceIndex(index);
        setDragOverReferenceIndex(index);
      },
      [],
    );

    const handleReferenceSortHover = useCallback(
      (index: number) => {
        if (draggingReferenceIndex === null) {
          return;
        }

        setDragOverReferenceIndex(index);
      },
      [draggingReferenceIndex],
    );

    const finalizeReferenceSort = useCallback(() => {
      const fromIndex = draggingReferenceIndex;
      const toIndex = dragOverReferenceIndex;

      if (fromIndex !== null && toIndex !== null && fromIndex !== toIndex) {
        handleMoveReferenceImage(fromIndex, toIndex);
      }

      setDraggingReferenceIndex(null);
      setDragOverReferenceIndex(null);
    }, [
      dragOverReferenceIndex,
      draggingReferenceIndex,
      handleMoveReferenceImage,
    ]);

    useEffect(() => {
      if (draggingReferenceIndex === null) {
        return;
      }

      const handlePointerUp = () => {
        finalizeReferenceSort();
      };

      window.addEventListener("pointerup", handlePointerUp);
      window.addEventListener("pointercancel", handlePointerUp);

      return () => {
        window.removeEventListener("pointerup", handlePointerUp);
        window.removeEventListener("pointercancel", handlePointerUp);
      };
    }, [draggingReferenceIndex, finalizeReferenceSort]);

    const handleReferenceSortCancel = useCallback(() => {
      if (draggingReferenceIndex === null) {
        return;
      }

      setDraggingReferenceIndex(null);
      setDragOverReferenceIndex(null);
    }, [draggingReferenceIndex]);

    const handleOptimizePrompt = useCallback(async () => {
      const sourcePrompt = promptValueRef.current;
      const currentPrompt = sourcePrompt.trim();
      if (!currentPrompt) {
        const message = t("node.jimeng.promptRequired");
        updateNodeData(id, { lastError: null });
        setPromptOptimizationError(message);
        await showErrorDialog(message, t("common.error"));
        return;
      }

      setIsOptimizingPrompt(true);
      setPromptOptimizationError(null);
      updateNodeData(id, { lastError: null });

      try {
        const previousDurationSuggestion = readDurationSuggestionSnapshot(data);
        const result = await optimizeCanvasPrompt({
          mode: "jimeng",
          prompt: currentPrompt,
          referenceImages: orderedReferenceImages,
        });
        if (promptValueRef.current !== sourcePrompt) {
          return;
        }

        const nextPrompt = result.prompt;
        const nextDurationSuggestion = buildDurationSuggestionSnapshot(
          result.durationRecommendation,
        );
        setLastPromptOptimizationMeta({
          modelLabel: [result.context.provider, result.context.model]
            .filter(Boolean)
            .join(" / "),
          referenceImageCount: result.usedReferenceImages
            ? orderedReferenceImages.length
            : 0,
        });

        const promptChanged = nextPrompt !== sourcePrompt;
        const durationChanged = !areDurationSuggestionSnapshotsEqual(
          previousDurationSuggestion,
          nextDurationSuggestion,
        );

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
        updateNodeData(
          id,
          toDurationSuggestionNodeData(nextDurationSuggestion),
        );

        requestAnimationFrame(() => {
          promptRef.current?.focus();
          const cursor = nextPrompt.length;
          promptRef.current?.setSelectionRange(cursor, cursor);
          syncPromptHighlightScroll();
        });
      } catch (error) {
        const message =
          error instanceof Error && error.message.trim().length > 0
            ? error.message
            : t("node.jimeng.optimizePromptFailed");
        setPromptOptimizationError(message);
        await showErrorDialog(message, t("common.error"));
      } finally {
        setIsOptimizingPrompt(false);
      }
    }, [
      data,
      id,
      orderedReferenceImages,
      syncPromptHighlightScroll,
      t,
      updateNodeData,
      updatePrompt,
    ]);

    const handleUndoOptimizedPrompt = useCallback(() => {
      if (!lastPromptOptimizationUndoState) {
        return;
      }

      if (
        promptValueRef.current !== lastPromptOptimizationUndoState.appliedPrompt
      ) {
        return;
      }

      const restoredPrompt = lastPromptOptimizationUndoState.previousPrompt;
      setPromptOptimizationError(null);
      setLastPromptOptimizationMeta(null);
      setLastPromptOptimizationUndoState(null);
      updatePrompt(restoredPrompt);
      updateNodeData(
        id,
        toDurationSuggestionNodeData(
          lastPromptOptimizationUndoState.previousDurationSuggestion,
        ),
      );
      requestAnimationFrame(() => {
        promptRef.current?.focus();
        const cursor = restoredPrompt.length;
        promptRef.current?.setSelectionRange(cursor, cursor);
        syncPromptHighlightScroll();
      });
    }, [
      id,
      lastPromptOptimizationUndoState,
      syncPromptHighlightScroll,
      updateNodeData,
      updatePrompt,
    ]);

    const handleGenerate = useCallback(async () => {
      const prompt = data.prompt?.trim() ?? "";
      if (!prompt) {
        const message = t("node.jimeng.promptRequired");
        updateNodeData(id, { lastError: message });
        await showErrorDialog(message, t("common.error"));
        return;
      }

      if (isGenerateBlocked) {
        const message = isFirstLastFrameCountInvalid
          ? t("node.jimeng.firstLastFrameRequiresTwoImages")
          : t("node.jimeng.cliBlockedAudioNeedsImage");
        updateNodeData(id, { lastError: message });
        await showErrorDialog(message, t("common.error"));
        return;
      }

      setPromptOptimizationError(null);
      updateNodeData(id, { lastError: null });

      let createdResultNodeId: string | null = null;

      try {
        const startedAt = Date.now();
        const resultNodePosition = findNodePosition(
          id,
          JIMENG_VIDEO_RESULT_NODE_DEFAULT_WIDTH,
          JIMENG_VIDEO_RESULT_NODE_DEFAULT_HEIGHT,
        );
        createdResultNodeId = addNode(
          CANVAS_NODE_TYPES.jimengVideoResult,
          resultNodePosition,
          {
            sourceNodeId: id,
            displayName: buildJimengVideoResultNodeTitle(
              t("node.jimeng.resultNodeTitle"),
            ),
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
          { inheritParentFromNodeId: id },
        );
        addEdge(id, createdResultNodeId);
        await flushCurrentProjectToDiskSafely(
          "creating Jimeng video result node",
        );

        const generationResponse = await generateJimengVideos({
          prompt,
          modelVersion: selectedModel,
          referenceMode: selectedReferenceMode,
          aspectRatio: selectedAspectRatio,
          durationSeconds: selectedDuration,
          videoResolution: DEFAULT_VIDEO_RESOLUTION,
          referenceImageSources: orderedReferenceImages,
          referenceAudioSources: incomingAudios.map((item) => item.audioUrl),
          onSubmitted: async ({ submitId }) => {
            if (!createdResultNodeId) {
              return;
            }

            updateNodeData(createdResultNodeId, {
              submitId,
              isGenerating: true,
              generationStartedAt: startedAt,
              lastError: null,
            });
            await flushCurrentProjectToDiskSafely(
              "saving Jimeng video submit id",
            );
          },
        });
        const primaryResult = generationResponse.videos[0];
        if (!primaryResult) {
          throw new Error(t("node.jimeng.resultEmpty"));
        }

        const completedAt = Date.now();
        updateNodeData(id, {
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
        await flushCurrentProjectToDiskSafely(
          "saving Jimeng video generation result",
        );
      } catch (error) {
        const content = resolveErrorContent(
          error,
          t("node.jimeng.submitFailed"),
        );
        updateNodeData(id, { lastError: content.message });
        if (createdResultNodeId) {
          updateNodeData(createdResultNodeId, {
            isGenerating: false,
            generationStartedAt: null,
            lastError: content.message,
          });
        }
        await flushCurrentProjectToDiskSafely(
          "saving Jimeng video generation error",
        );
        await showErrorDialog(
          content.message,
          t("common.error"),
          content.details,
        );
      }
    }, [
      addEdge,
      addNode,
      data.prompt,
      findNodePosition,
      flushCurrentProjectToDiskSafely,
      id,
      incomingAudios,
      isGenerateBlocked,
      isFirstLastFrameCountInvalid,
      orderedReferenceImages,
      selectedAspectRatio,
      selectedDuration,
      selectedModel,
      selectedReferenceMode,
      t,
      updateNodeData,
    ]);

    const handlePromptKeyDown = useCallback(
      (event: KeyboardEvent<HTMLTextAreaElement>) => {
        if (event.key === "Backspace" || event.key === "Delete") {
          const currentPrompt = promptValueRef.current;
          const selectionStart =
            event.currentTarget.selectionStart ?? currentPrompt.length;
          const selectionEnd =
            event.currentTarget.selectionEnd ?? selectionStart;
          const deletionDirection =
            event.key === "Backspace" ? "backward" : "forward";
          const deleteRange = resolveReferenceAwareDeleteRange(
            currentPrompt,
            selectionStart,
            selectionEnd,
            deletionDirection,
            orderedReferenceImages.length,
          );
          if (deleteRange) {
            event.preventDefault();
            const { nextText, nextCursor } = removeTextRange(
              currentPrompt,
              deleteRange,
            );
            handlePromptChange(nextText);
            requestAnimationFrame(() => {
              promptRef.current?.focus();
              promptRef.current?.setSelectionRange(nextCursor, nextCursor);
              syncPromptHighlightScroll();
            });
            return;
          }
        }

        if (showImagePicker && orderedReferenceImages.length > 0) {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            event.stopPropagation();
            setPickerActiveIndex(
              (previous) => (previous + 1) % orderedReferenceImages.length,
            );
            return;
          }

          if (event.key === "ArrowUp") {
            event.preventDefault();
            event.stopPropagation();
            setPickerActiveIndex((previous) =>
              previous === 0 ? orderedReferenceImages.length - 1 : previous - 1,
            );
            return;
          }

          if (event.key === "Enter" || event.key === "Tab") {
            event.preventDefault();
            event.stopPropagation();
            insertImageReference(pickerActiveIndex);
            return;
          }
        }

        if (event.key === "@" && orderedReferenceImages.length > 0) {
          event.preventDefault();
          event.stopPropagation();
          const cursor =
            event.currentTarget.selectionStart ?? promptValueRef.current.length;
          setPickerAnchor(
            resolvePickerAnchor(
              promptPanelRef.current,
              event.currentTarget,
              cursor,
            ),
          );
          setPickerCursor(cursor);
          setShowImagePicker(true);
          setPickerActiveIndex(0);
          return;
        }

        if (event.key === "Escape" && showImagePicker) {
          event.preventDefault();
          event.stopPropagation();
          setShowImagePicker(false);
          setPickerCursor(null);
          setPickerActiveIndex(0);
          return;
        }

        if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
          event.preventDefault();
          event.stopPropagation();
          void handleGenerate();
        }
      },
      [
        handleGenerate,
        handlePromptChange,
        insertImageReference,
        orderedReferenceImages.length,
        pickerActiveIndex,
        showImagePicker,
        syncPromptHighlightScroll,
      ],
    );

    const hidePromptReferencePreview = useCallback(() => {
      setPromptReferencePreview(null);
    }, []);

    const handlePromptReferenceTokenHover = useCallback(
      (tokenIndex: number, event: ReactMouseEvent<HTMLSpanElement>) => {
        const item = incomingImageItems[tokenIndex];
        const previewHost = promptPreviewHostRef.current;
        if (!item || !previewHost) {
          setPromptReferencePreview(null);
          return;
        }

        const previewHostRect = previewHost.getBoundingClientRect();
        const previewMaxWidth = 144;
        const previewMaxHeight = 132;
        const horizontalPadding = 12;
        const horizontalGap = 8;
        const verticalGap = 8;
        const maxLeft = Math.max(
          horizontalPadding,
          previewHostRect.width - previewMaxWidth - horizontalPadding,
        );
        const preferredLeft =
          event.clientX - previewHostRect.left + horizontalGap;
        const preferredTop = event.clientY - previewHostRect.top + verticalGap;
        const maxTop = Math.max(
          horizontalPadding,
          previewHostRect.height - previewMaxHeight - horizontalPadding,
        );

        setPromptReferencePreview({
          imageUrl: item.imageUrl,
          displayUrl: item.displayUrl,
          alt: item.label,
          left: Math.max(horizontalPadding, Math.min(preferredLeft, maxLeft)),
          top: Math.max(horizontalPadding, Math.min(preferredTop, maxTop)),
        });
      },
      [incomingImageItems],
    );

    const handlePromptReferenceTokenMouseDown = useCallback(
      (tokenEnd: number, event: ReactMouseEvent<HTMLSpanElement>) => {
        event.preventDefault();
        event.stopPropagation();
        requestAnimationFrame(() => {
          promptRef.current?.focus();
          promptRef.current?.setSelectionRange(tokenEnd, tokenEnd);
          syncPromptHighlightScroll();
        });
      },
      [syncPromptHighlightScroll],
    );

    const combinedError = promptOptimizationError ?? data.lastError;
    const canUndoPromptOptimization = Boolean(
      lastPromptOptimizationUndoState &&
      (data.prompt ?? "") === lastPromptOptimizationUndoState.appliedPrompt,
    );
    const promptOptimizationNotice = lastPromptOptimizationMeta
      ? `${t("node.jimeng.optimizeModelLabel", {
          model: lastPromptOptimizationMeta.modelLabel,
        })} | ${t("node.jimeng.optimizeReferenceImagesLabel", {
          status:
            lastPromptOptimizationMeta.referenceImageCount > 0
              ? t("node.jimeng.optimizeReferenceImagesUsed", {
                  count: lastPromptOptimizationMeta.referenceImageCount,
                })
              : t("node.jimeng.optimizeReferenceImagesUnused"),
        })}`
      : null;
    const durationSuggestionText = buildDurationSuggestionText(
      durationSuggestionSnapshot,
      t,
    );
    const cliModeHint = useMemo(() => {
      if (isFirstLastFrameCountInvalid) {
        return t("node.jimeng.firstLastFrameRequiresTwoImages");
      }

      if (isGenerateBlocked) {
        return t("node.jimeng.cliBlockedAudioNeedsImage");
      }

      if (incomingAudios.length > 0) {
        const effectiveModel = resolveJimengCliEffectiveVideoModel(
          "multimodal2video",
          selectedModel,
        );
        return t("node.jimeng.cliHint.multimodal2video", {
          command: t("node.jimeng.cliMode.multimodal2video"),
          model: effectiveModel
            ? t(
                `node.jimeng.modelOptions.${resolveJimengVideoModelOptionKey(effectiveModel)}`,
              )
            : "-",
        });
      }

      if (orderedReferenceImages.length === 0) {
        const effectiveModel = resolveJimengCliEffectiveVideoModel(
          "text2video",
          selectedModel,
        );
        return t("node.jimeng.cliHint.text2video", {
          command: t("node.jimeng.cliMode.text2video"),
          model: effectiveModel
            ? t(
                `node.jimeng.modelOptions.${resolveJimengVideoModelOptionKey(effectiveModel)}`,
              )
            : "-",
        });
      }

      if (orderedReferenceImages.length === 1) {
        return t("node.jimeng.cliHint.image2video", {
          command: t("node.jimeng.cliMode.image2video"),
          duration: resolveJimengVideoModelDurationRange(selectedModel),
          resolution:
            selectedModel === "seedance2.0" ||
            selectedModel === "seedance2.0fast"
              ? "720p"
              : "720p / 1080p",
        });
      }

      if (selectedReferenceMode === "firstLastFrame") {
        const effectiveModel =
          resolveJimengCliEffectiveVideoModel("frames2video", selectedModel) ??
          "seedance2.0fast";
        return t("node.jimeng.cliHint.frames2video", {
          command: t("node.jimeng.cliMode.frames2video"),
          model: t(
            `node.jimeng.modelOptions.${resolveJimengVideoModelOptionKey(effectiveModel)}`,
          ),
          duration: resolveJimengVideoModelDurationRange(effectiveModel),
          resolution:
            effectiveModel === "3.0" || effectiveModel === "3.5pro"
              ? "720p / 1080p"
              : "720p",
        });
      }

      if (selectedReferenceMode === "smartFrames") {
        return orderedReferenceImages.length <= 2
          ? t("node.jimeng.cliHint.multiframeTwo", {
              command: t("node.jimeng.cliMode.multiframe2video"),
            })
          : t("node.jimeng.cliHint.multiframeMany", {
              command: t("node.jimeng.cliMode.multiframe2video"),
              count: orderedReferenceImages.length,
            });
      }

      const effectiveModel = resolveJimengCliEffectiveVideoModel(
        "multimodal2video",
        selectedModel,
      );
      return t("node.jimeng.cliHint.multimodal2video", {
        command: t("node.jimeng.cliMode.multimodal2video"),
        model: effectiveModel
          ? t(
              `node.jimeng.modelOptions.${resolveJimengVideoModelOptionKey(effectiveModel)}`,
            )
          : "-",
      });
    }, [
      incomingAudios.length,
      isFirstLastFrameCountInvalid,
      isGenerateBlocked,
      orderedReferenceImages.length,
      selectedModel,
      selectedReferenceMode,
      t,
    ]);

    const headerStatus = useMemo(() => {
      if (isOptimizingPrompt) {
        return (
          <NodeStatusBadge
            icon={<Loader2 className="h-3 w-3" />}
            label={t("node.jimeng.optimizingPrompt")}
            tone="processing"
            animate
          />
        );
      }

      if (combinedError) {
        return (
          <NodeStatusBadge
            icon={<TriangleAlert className="h-3 w-3" />}
            label={t("nodeStatus.error")}
            tone="danger"
            title={combinedError}
          />
        );
      }

      return null;
    }, [combinedError, isOptimizingPrompt, t]);

    const statusInfoText =
      combinedError ??
      (lastSubmittedTime
        ? t("node.jimeng.resultReturnedAt", { time: lastSubmittedTime })
        : [cliModeHint, durationSuggestionText, promptOptimizationNotice]
            .filter(Boolean)
            .join(" | "));

    return (
      <div
        ref={rootRef}
        className={`
        group relative flex h-full flex-col overflow-visible rounded-[var(--node-radius)] border bg-surface-dark/90 p-2 transition-all duration-150
        ${
          selected
            ? "border-accent shadow-[0_0_0_2px_rgba(59,130,246,0.5),0_4px_20px_rgba(59,130,246,0.2)]"
            : "border-[rgba(15,23,42,0.22)] hover:border-[rgba(15,23,42,0.34)] hover:shadow-[0_4px_16px_rgba(0,0,0,0.12)] dark:border-[rgba(255,255,255,0.22)] dark:hover:border-[rgba(255,255,255,0.34)] dark:hover:shadow-[0_4px_16px_rgba(0,0,0,0.25)]"
        }
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
          onTitleChange={(nextTitle) =>
            updateNodeData(id, { displayName: nextTitle })
          }
        />

        <div
          ref={promptPanelRef}
          className="relative min-h-0 flex-1 rounded-lg border border-[rgba(255,255,255,0.1)] bg-bg-dark/45 p-2"
        >
          <div className="flex h-full min-h-0 flex-col gap-2">
            <div
              ref={promptPreviewHostRef}
              className="relative min-h-[148px] flex-1"
            >
              <div
                ref={promptHighlightRef}
                aria-hidden="true"
                className="ui-scrollbar pointer-events-none absolute inset-0 overflow-y-auto overflow-x-hidden text-sm leading-6 text-text-dark"
                style={{ scrollbarGutter: "stable" }}
              >
                <div className="min-h-full whitespace-pre-wrap break-words px-3 py-2">
                  {renderPromptWithHighlights(
                    data.prompt ?? "",
                    orderedReferenceImages.length,
                  )}
                </div>
              </div>

              <div
                ref={promptHoverLayerRef}
                aria-hidden="true"
                className="ui-scrollbar pointer-events-none absolute inset-0 z-20 overflow-y-auto overflow-x-hidden text-sm leading-6 text-transparent"
                style={{ scrollbarGutter: "stable" }}
              >
                <div className="min-h-full whitespace-pre-wrap break-words px-3 py-2">
                  {renderPromptReferenceHoverTargets(
                    data.prompt ?? "",
                    orderedReferenceImages.length,
                    handlePromptReferenceTokenHover,
                    hidePromptReferencePreview,
                    handlePromptReferenceTokenMouseDown,
                  )}
                </div>
              </div>

              <textarea
                ref={promptRef}
                value={data.prompt ?? ""}
                onChange={(event) => handlePromptChange(event.target.value)}
                placeholder={t("node.jimeng.promptPlaceholder")}
                className="ui-scrollbar nodrag nowheel relative z-10 h-full w-full resize-none rounded-xl border border-white/10 bg-black/15 px-3 py-2 text-sm leading-6 text-transparent caret-text-dark outline-none placeholder:text-text-muted/70 focus:border-accent/50 whitespace-pre-wrap break-words"
                style={{ scrollbarGutter: "stable" }}
                onScroll={syncPromptHighlightScroll}
                onMouseDown={(event) => {
                  event.stopPropagation();
                  hidePromptReferencePreview();
                }}
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
                  <CanvasNodeImage
                    src={promptReferencePreview.displayUrl}
                    alt={promptReferencePreview.alt}
                    viewerSourceUrl={resolveImageDisplayUrl(
                      promptReferencePreview.imageUrl,
                    )}
                    viewerImageList={incomingImageDisplayList}
                    className="block max-h-[132px] max-w-[144px] rounded-xl object-contain"
                    draggable={false}
                  />
                </div>
              ) : null}
            </div>

            <div className="flex min-h-[44px] flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-black/10 px-2 py-2">
              {orderedReferenceImages.length > 0 ? (
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  {incomingImageItems.map((item, index) => (
                    <div
                      key={`${item.imageUrl}-${index}`}
                      className={`nodrag group/reference relative flex select-none items-center gap-1.5 rounded-lg border bg-black/15 px-1.5 py-1.5 transition-[transform,box-shadow,border-color,background-color,opacity] duration-200 ${
                        draggingReferenceIndex === index
                          ? "z-10 border-accent/55 bg-accent/10 opacity-80 shadow-[0_10px_26px_rgba(59,130,246,0.22)] -translate-y-0.5 scale-[1.02]"
                          : dragOverReferenceIndex === index
                            ? "z-10 border-accent/55 bg-accent/10 shadow-[0_0_0_1px_rgba(59,130,246,0.18)]"
                            : "border-white/10 motion-safe:hover:-translate-y-0.5 motion-safe:hover:border-white/15 motion-safe:hover:shadow-[0_8px_20px_rgba(0,0,0,0.2)]"
                      }`}
                      onMouseDown={(event) => event.stopPropagation()}
                      onPointerEnter={(event) => {
                        event.stopPropagation();
                        handleReferenceSortHover(index);
                      }}
                      onPointerMove={(event) => {
                        event.stopPropagation();
                        handleReferenceSortHover(index);
                      }}
                      onPointerCancel={handleReferenceSortCancel}
                    >
                      <button
                        type="button"
                        className={`flex h-9 w-6 shrink-0 items-center justify-center rounded-md border border-white/8 bg-white/[0.03] text-text-muted transition-all duration-200 ${
                          draggingReferenceIndex === index
                            ? "cursor-grabbing border-accent/30 bg-accent/15 text-accent shadow-[0_8px_18px_rgba(59,130,246,0.18)]"
                            : "cursor-grab group-hover/reference:border-white/15 group-hover/reference:bg-white/[0.06] group-hover/reference:text-text-dark"
                        }`}
                        aria-label={t("node.jimeng.referenceReorderHint")}
                        title={t("node.jimeng.referenceReorderHint")}
                        onPointerDown={(event) =>
                          handleReferenceSortStart(index, event)
                        }
                        onMouseDown={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                        }}
                      >
                        <GripVertical
                          className={`h-3.5 w-3.5 transition-transform duration-200 ${
                            draggingReferenceIndex === index
                              ? "scale-110 animate-pulse"
                              : "group-hover/reference:scale-110 group-hover/reference:-translate-y-0.5"
                          }`}
                          strokeWidth={2.1}
                        />
                      </button>
                      <button
                        type="button"
                        draggable={false}
                        className="absolute -right-1 -top-1 z-10 flex h-5 w-5 items-center justify-center rounded-full border border-white/15 bg-black/75 text-text-dark opacity-0 shadow-[0_6px_18px_rgba(0,0,0,0.28)] transition-opacity hover:bg-rose-500 hover:text-white group-hover/reference:opacity-100"
                        aria-label={t("common.delete")}
                        title={t("common.delete")}
                        onPointerDown={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                        }}
                        onMouseDown={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                        }}
                        onClick={(event) => {
                          event.stopPropagation();
                          handleRemoveReferenceImage(item.sourceEdgeId);
                        }}
                      >
                        <X className="h-3 w-3" strokeWidth={2.4} />
                      </button>
                      <CanvasNodeImage
                        src={item.displayUrl}
                        alt={t("node.jimeng.referenceImageLabel", {
                          index: index + 1,
                        })}
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

              {orderedReferenceImages.length > 1 ? (
                <div className="pointer-events-none ml-auto hidden items-center gap-1 rounded-full border border-white/10 bg-white/[0.04] px-2 py-1 text-[10px] text-text-muted md:flex">
                  <GripVertical className="h-3 w-3" strokeWidth={2.1} />
                  {t("node.jimeng.referenceReorderHint")}
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
                      <span className="max-w-[92px] truncate">
                        {audio.label}
                      </span>
                    </div>
                  ))}
                </div>
              ) : null}

              {orderedReferenceImages.length === 0 &&
              incomingAudios.length === 0 ? (
                <div className="text-[11px] text-text-muted">
                  {t("node.jimeng.referenceCount", { count: 0 })}
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
                        ? "border-accent/55 bg-white/[0.08] shadow-[0_0_0_1px_rgba(59,130,246,0.22)]"
                        : ""
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
                label={t("node.jimeng.parameters.model")}
                value={selectedModel}
                options={modelOptions}
                onChange={(nextValue) =>
                  updateNodeData(id, { model: nextValue })
                }
              />
              <FixedControlChip
                label={t("node.jimeng.parameters.referenceMode")}
                value={selectedReferenceMode}
                options={referenceModeOptions}
                onChange={(nextValue) =>
                  updateNodeData(id, { referenceMode: nextValue })
                }
              />
              <FixedControlChip
                label={t("node.jimeng.parameters.aspectRatio")}
                value={selectedAspectRatio}
                options={aspectRatioOptions}
                onChange={(nextValue) =>
                  updateNodeData(id, { aspectRatio: nextValue })
                }
              />
              <FixedControlChip
                label={t("node.jimeng.parameters.duration")}
                value={selectedDuration}
                options={durationOptions}
                onChange={(nextValue) =>
                  updateNodeData(id, {
                    durationSeconds: nextValue as JimengDurationSeconds,
                  })
                }
              />
              <UiChipButton
                type="button"
                className={`${NODE_CONTROL_CHIP_CLASS} shrink-0 !w-8 !px-0 justify-center`}
                disabled={isOptimizingPrompt}
                aria-label={t("node.jimeng.optimizePrompt")}
                title={t("node.jimeng.optimizePrompt")}
                onClick={() => void handleOptimizePrompt()}
              >
                {isOptimizingPrompt ? (
                  <Loader2 className="h-4 w-4 origin-center scale-[1.12] animate-spin" />
                ) : (
                  <Wand2
                    className="h-4 w-4 origin-center scale-[1.18]"
                    strokeWidth={2.45}
                  />
                )}
              </UiChipButton>
              <UiChipButton
                type="button"
                disabled={isOptimizingPrompt || !canUndoPromptOptimization}
                className={`${NODE_CONTROL_CHIP_CLASS} shrink-0 !w-8 !px-0 justify-center`}
                aria-label={t("node.jimeng.undoOptimizedPrompt")}
                title={t("node.jimeng.undoOptimizedPrompt")}
                onClick={handleUndoOptimizedPrompt}
              >
                <Undo2
                  className="h-4 w-4 origin-center scale-[1.08]"
                  strokeWidth={2.3}
                />
              </UiChipButton>
            </div>
          </div>
          <UiButton
            type="button"
            variant="primary"
            className={NODE_CONTROL_PRIMARY_BUTTON_CLASS}
            disabled={isOptimizingPrompt || isGenerateBlocked}
            onClick={() => void handleGenerate()}
          >
            <Sparkles
              className={NODE_CONTROL_GENERATE_ICON_CLASS}
              strokeWidth={2.5}
            />
            {t("node.jimeng.submit")}
          </UiButton>
        </div>

        {statusInfoText ? (
          <div
            className={`mt-1 min-h-[16px] truncate text-[10px] leading-4 ${
              combinedError ? "text-rose-300" : "text-text-muted"
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
        <Handle
          type="source"
          id="source"
          position={Position.Right}
          className="!h-2.5 !w-2.5 !border-2 !border-surface-dark !bg-accent"
        />
        <NodeResizeHandle
          minWidth={JIMENG_NODE_MIN_WIDTH}
          minHeight={JIMENG_NODE_MIN_HEIGHT}
        />
      </div>
    );
  },
);

JimengNode.displayName = "JimengNode";
