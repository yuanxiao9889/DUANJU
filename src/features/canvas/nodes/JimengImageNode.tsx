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
} from "react";
import {
  Handle,
  Position,
  useUpdateNodeInternals,
  useViewport,
  type NodeProps,
} from "@xyflow/react";
import {
  Loader2,
  Sparkles,
  TriangleAlert,
  Undo2,
  Wand2,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import { UiLoadingOverlay } from "@/components/ui";
import {
  CANVAS_NODE_TYPES,
  JIMENG_IMAGE_RESULT_NODE_DEFAULT_HEIGHT,
  JIMENG_IMAGE_RESULT_NODE_DEFAULT_WIDTH,
  type JimengAspectRatio,
  type JimengImageNodeData,
  type JimengImageModelVersion,
  type JimengImageResolutionType,
} from "@/features/canvas/domain/canvasNodes";
import { resolveNodeDisplayName } from "@/features/canvas/domain/nodeDisplay";
import {
  resolveErrorContent,
  showErrorDialog,
} from "@/features/canvas/application/errorDialog";
import { resolveScriptAssetOptimizedPromptMaxLength } from "@/features/canvas/application/scriptAssetReferencePromptLimit";
import { appendCameraParamsToPrompt } from "@/features/canvas/camera/cameraPrompt";
import {
  hasCameraParamsSelection,
  normalizeCameraParamsSelection,
  resolveCameraParamsSummary,
} from "@/features/canvas/camera/cameraPresets";
import {
  useCanvasConnectedReferenceImages,
  useCanvasConnectedTextInput,
  useCanvasIncomingSourceNodes,
} from "@/features/canvas/hooks/useCanvasNodeGraph";
import { resolveImageDisplayUrl } from "@/features/canvas/application/imageData";
import { optimizeCanvasPrompt } from "@/features/canvas/application/promptOptimization";
import {
  buildSequentialPromptReferenceImageCandidates,
  resolvePromptReferenceImageBindings,
} from "@/features/canvas/application/promptReferenceImageBindings";
import { flushCurrentProjectToDiskSafely } from "@/features/canvas/application/projectPersistence";
import {
  buildShortReferenceToken,
  findReferenceTokens,
  insertReferenceToken,
  remapReferenceTokensByImageOrder,
  removeTextRange,
  resolveReferenceAwareDeleteRange,
} from "@/features/canvas/application/referenceTokenEditing";
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
} from "@/features/canvas/application/textareaSelection";
import {
  NodeHeader,
  NODE_HEADER_FLOATING_POSITION_CLASS,
} from "@/features/canvas/ui/NodeHeader";
import { NodeResizeHandle } from "@/features/canvas/ui/NodeResizeHandle";
import { CanvasNodeImage } from "@/features/canvas/ui/CanvasNodeImage";
import { CameraParamsDialog } from "@/features/canvas/ui/CameraParamsDialog";
import { CameraTriggerIcon } from "@/features/canvas/ui/CameraTriggerIcon";
import { NodeStatusBadge } from "@/features/canvas/ui/NodeStatusBadge";
import { ReferenceVisualChip } from "@/features/canvas/ui/ReferenceVisualChip";
import { UpstreamPromptLockOverlay } from "@/features/canvas/ui/UpstreamPromptLockOverlay";
import {
  NODE_CONTROL_CHIP_CLASS,
  NODE_CONTROL_GENERATE_ICON_CLASS,
  NODE_CONTROL_PRIMARY_BUTTON_CLASS,
} from "@/features/canvas/ui/nodeControlStyles";
import { UiButton, UiChipButton, UiSelect } from "@/components/ui";
import { useCanvasStore } from "@/stores/canvasStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { generateJimengImages } from "@/features/jimeng/application/jimengImageGeneration";
import {
  ensureDreaminaCliReady,
  resolveDreaminaSetupBlockedMessage,
} from "@/features/jimeng/application/dreaminaSetup";
import {
  JIMENG_ASPECT_RATIO_OPTIONS,
  JIMENG_IMAGE_MODEL_OPTIONS,
  jimengImageModelSupportsReferenceImages,
  normalizeJimengImageResolutionForModel,
  resolveJimengImageResolutionOptionsForModel,
} from "@/features/jimeng/domain/jimengOptions";
import { StyleTemplatePicker } from "@/features/project/StyleTemplatePicker";
import { appendStyleTemplatePrompt } from "@/features/project/styleTemplatePrompt";

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

interface PromptReferencePreviewState {
  imageUrl: string;
  displayUrl: string;
  alt: string;
  left: number;
  top: number;
}

const JIMENG_IMAGE_NODE_DEFAULT_WIDTH = 640;
const JIMENG_IMAGE_NODE_DEFAULT_HEIGHT = 340;
const JIMENG_IMAGE_NODE_MIN_WIDTH = 620;
const JIMENG_IMAGE_NODE_MIN_HEIGHT = 300;
const JIMENG_IMAGE_NODE_MAX_WIDTH = 1400;
const JIMENG_IMAGE_NODE_MAX_HEIGHT = 1000;
const DEFAULT_IMAGE_MODEL: JimengImageModelVersion = "5.0";
const DEFAULT_IMAGE_RESOLUTION: JimengImageResolutionType = "2k";
const DEFAULT_IMAGE_ASPECT_RATIO = "1:1";
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

function buildJimengResultNodeTitle(fallbackTitle: string): string {
  return fallbackTitle;
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

function resolveOptimizationReferenceImages(
  prompt: string,
  imageUrls: string[],
  allowReferenceImages: boolean,
): string[] {
  if (!allowReferenceImages || imageUrls.length === 0) {
    return [];
  }

  const referencedImageIndexes = [
    ...new Set(
      findReferenceTokens(prompt, imageUrls.length)
        .map((token) => token.value - 1)
        .filter((index) => index >= 0 && index < imageUrls.length),
    ),
  ];

  if (referencedImageIndexes.length === 0) {
    return imageUrls;
  }

  return referencedImageIndexes
    .map((index) => imageUrls[index])
    .filter(Boolean);
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

export const JimengImageNode = memo(
  ({ id, data, selected, width, height }: JimengImageNodeProps) => {
    const { t, i18n } = useTranslation();
    const { zoom } = useViewport();
    const updateNodeInternals = useUpdateNodeInternals();
    const rootRef = useRef<HTMLDivElement>(null);
    const promptPanelRef = useRef<HTMLDivElement>(null);
    const promptPreviewHostRef = useRef<HTMLDivElement>(null);
    const promptRef = useRef<HTMLTextAreaElement>(null);
    const promptHighlightRef = useRef<HTMLDivElement>(null);
    const promptHoverLayerRef = useRef<HTMLDivElement>(null);
    const [promptDraft, setPromptDraft] = useState(() => data.prompt ?? "");
    const promptValueRef = useRef(promptDraft);
    const lastPromptSelectionRef = useRef<TextSelectionRange | null>(null);
    const pickerSelectionRef = useRef<TextSelectionRange | null>(null);
    const previousIncomingImagesRef = useRef<string[] | null>(null);
    const pickerItemRefs = useRef<Array<HTMLButtonElement | null>>([]);
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
    const [showCameraParamsDialog, setShowCameraParamsDialog] = useState(false);
    const [showImagePicker, setShowImagePicker] = useState(false);
    const [pickerActiveIndex, setPickerActiveIndex] = useState(0);
    const [pickerAnchor, setPickerAnchor] = useState<PickerAnchor>(
      DEFAULT_PICKER_ANCHOR,
    );
    const [promptReferencePreview, setPromptReferencePreview] =
      useState<PromptReferencePreviewState | null>(null);
    const [, setIsPromptTextSelectionActive] = useState(false);
    const setSelectedNode = useCanvasStore((state) => state.setSelectedNode);
    const highlightedReferenceSourceNodeId = useCanvasStore(
      (state) => state.highlightedReferenceSourceNodeId,
    );
    const setHighlightedReferenceSourceNode = useCanvasStore(
      (state) => state.setHighlightedReferenceSourceNode,
    );
    const updateNodeData = useCanvasStore((state) => state.updateNodeData);
    const addNode = useCanvasStore((state) => state.addNode);
    const addEdge = useCanvasStore((state) => state.addEdge);
    const deleteEdge = useCanvasStore((state) => state.deleteEdge);
    const findNodePosition = useCanvasStore((state) => state.findNodePosition);
    const setLastJimengImageDefaults = useSettingsStore(
      (state) => state.setLastJimengImageDefaults,
    );

    const connectedReferenceImages = useCanvasConnectedReferenceImages(id);
    const {
      connectedText,
      hasConnectedTextSource,
      hasNonEmptyConnectedText,
    } = useCanvasConnectedTextInput(id);
    const incomingSourceNodes = useCanvasIncomingSourceNodes(id);
    const isPromptLockedByUpstream = hasConnectedTextSource;
    const displayedPrompt = promptDraft;
    const effectivePrompt = isPromptLockedByUpstream ? connectedText : promptDraft;
    const incomingImages = useMemo(
      () => connectedReferenceImages.map((item) => item.imageUrl),
      [connectedReferenceImages],
    );
    const incomingImageDisplayList = useMemo(
      () => incomingImages.map((imageUrl) => resolveImageDisplayUrl(imageUrl)),
      [incomingImages],
    );
    const incomingImageItems = useMemo(
      () =>
        connectedReferenceImages.map((item, index) => ({
          sourceEdgeId: item.sourceEdgeId,
          sourceNodeId: item.sourceNodeId,
          imageUrl: item.imageUrl,
          displayUrl: resolveImageDisplayUrl(item.imageUrl),
          tokenLabel: buildShortReferenceToken(index),
          label: t("node.jimengImage.referenceImageLabel", {
            index: index + 1,
          }),
        })),
      [connectedReferenceImages, t],
    );
    const optimizedPromptMaxLength = useMemo(
      () =>
        resolveScriptAssetOptimizedPromptMaxLength(
          incomingSourceNodes.map((item) => item.node),
        ),
      [incomingSourceNodes],
    );
    const resolvedTitle = useMemo(
      () => resolveNodeDisplayName(CANVAS_NODE_TYPES.jimengImage, data),
      [data],
    );
    const resolvedWidth = Math.max(
      JIMENG_IMAGE_NODE_MIN_WIDTH,
      Math.min(
        JIMENG_IMAGE_NODE_MAX_WIDTH,
        Math.round(width ?? JIMENG_IMAGE_NODE_DEFAULT_WIDTH),
      ),
    );
    const resolvedHeight = Math.max(
      JIMENG_IMAGE_NODE_MIN_HEIGHT,
      Math.min(
        JIMENG_IMAGE_NODE_MAX_HEIGHT,
        Math.round(height ?? JIMENG_IMAGE_NODE_DEFAULT_HEIGHT),
      ),
    );
    const lastGeneratedTime = useMemo(
      () => formatTimestamp(data.lastGeneratedAt ?? null, i18n.language),
      [data.lastGeneratedAt, i18n.language],
    );
    const selectedModel = data.modelVersion ?? DEFAULT_IMAGE_MODEL;
    const modelSupportsReferenceImages =
      jimengImageModelSupportsReferenceImages(selectedModel);
    const selectedResolution = normalizeJimengImageResolutionForModel(
      selectedModel,
      data.resolutionType ?? DEFAULT_IMAGE_RESOLUTION,
    );
    const selectedAspectRatio = data.aspectRatio ?? DEFAULT_IMAGE_ASPECT_RATIO;
    const resolvedCameraParams = useMemo(
      () => normalizeCameraParamsSelection(data.cameraParams),
      [data.cameraParams],
    );
    const isCameraParamsApplied = hasCameraParamsSelection(resolvedCameraParams);
    const cameraParamsButtonTitle = isCameraParamsApplied
    ? resolveCameraParamsSummary(resolvedCameraParams)
    : t("cameraParams.trigger");
    const cameraParamsButtonClassName = isCameraParamsApplied
      ? `${NODE_CONTROL_CHIP_CLASS} !w-8 !border-emerald-400/55 !bg-emerald-500/14 !px-0 !text-emerald-300 shadow-[0_0_0_1px_rgba(52,211,153,0.12)] hover:!bg-emerald-500/20 shrink-0 justify-center`
      : `${NODE_CONTROL_CHIP_CLASS} !w-8 !px-0 shrink-0 justify-center`;
    const isGenerateBlocked =
      !modelSupportsReferenceImages && incomingImages.length > 0;

    const modelOptions = useMemo(
      () =>
        JIMENG_IMAGE_MODEL_OPTIONS.map((option) => ({
          value: option.value,
          label: t(option.labelKey),
        })),
      [t],
    );
    const resolutionOptions = useMemo(
      () =>
        resolveJimengImageResolutionOptionsForModel(selectedModel).map(
          (option) => ({
            value: option.value,
            label: t(option.labelKey),
          }),
        ),
      [selectedModel, t],
    );
    const aspectRatioOptions = useMemo(
      () =>
        JIMENG_ASPECT_RATIO_OPTIONS.map((option) => ({
          value: option.value,
          label: t(option.labelKey),
        })),
      [t],
    );

    useEffect(() => {
      const externalPrompt = data.prompt ?? "";
      if (externalPrompt !== promptValueRef.current) {
        promptValueRef.current = externalPrompt;
        setPromptDraft(externalPrompt);
        setPromptOptimizationError(null);
        setLastPromptOptimizationMeta(null);
        setLastPromptOptimizationUndoState(null);
      }
    }, [data.prompt]);

    useEffect(() => {
      if (data.resolutionType !== selectedResolution) {
        updateNodeData(
          id,
          { resolutionType: selectedResolution },
          { historyMode: "skip" },
        );
      }
    }, [data.resolutionType, id, selectedResolution, updateNodeData]);

    useEffect(() => {
      updateNodeInternals(id);
    }, [
      id,
      incomingImages.length,
      resolvedHeight,
      resolvedWidth,
      updateNodeInternals,
    ]);

    useEffect(() => {
      const previousIncomingImages = previousIncomingImagesRef.current;
      if (!previousIncomingImages) {
        previousIncomingImagesRef.current = incomingImages;
        return;
      }

      if (
        previousIncomingImages.length === incomingImages.length &&
        previousIncomingImages.every(
          (imageUrl, index) => imageUrl === incomingImages[index],
        )
      ) {
        return;
      }

      previousIncomingImagesRef.current = incomingImages;
      const nextPrompt = remapReferenceTokensByImageOrder(
        promptValueRef.current,
        previousIncomingImages,
        incomingImages,
      );
      if (nextPrompt === promptValueRef.current) {
        return;
      }

      setPromptDraft(nextPrompt);
      promptValueRef.current = nextPrompt;
      updateNodeData(id, { prompt: nextPrompt });
    }, [id, incomingImages, updateNodeData]);

    useEffect(() => {
      if (incomingImages.length === 0 || !modelSupportsReferenceImages) {
        setShowImagePicker(false);
        pickerSelectionRef.current = null;
        setPickerActiveIndex(0);
        setPromptReferencePreview(null);
        return;
      }

      setPickerActiveIndex((previous) =>
        Math.min(previous, incomingImages.length - 1),
      );
    }, [incomingImages.length, modelSupportsReferenceImages]);

    useEffect(() => {
      if (!isPromptLockedByUpstream) {
        return;
      }

      promptRef.current?.blur();
      setShowImagePicker(false);
      pickerSelectionRef.current = null;
      setPickerActiveIndex(0);
      setPromptReferencePreview(null);
    }, [isPromptLockedByUpstream]);

    useEffect(() => {
      setPromptReferencePreview(null);
    }, [displayedPrompt, incomingImages]);

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
        pickerSelectionRef.current = null;
        setPromptReferencePreview(null);
      };

      document.addEventListener("mousedown", handleOutside, true);
      return () => {
        document.removeEventListener("mousedown", handleOutside, true);
      };
    }, []);

    const updatePrompt = useCallback(
      (nextPrompt: string) => {
        setPromptDraft(nextPrompt);
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

    const syncPromptTextSelectionState = useCallback(
      (_target?: HTMLTextAreaElement | null) => {
        setIsPromptTextSelectionActive(false);
        setPromptReferencePreview(null);
      },
      [],
    );

    const rememberPromptSelection = useCallback(
      (textarea: HTMLTextAreaElement | null) => {
        lastPromptSelectionRef.current = readTextareaSelection(
          textarea,
          textarea?.value.length ?? promptValueRef.current.length,
        );
        syncPromptTextSelectionState(textarea);
      },
      [syncPromptTextSelectionState],
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

    const schedulePromptSelectionRestore = useCallback(
      (
        selection: TextSelectionRange | number,
        scrollSnapshot?: TextareaScrollSnapshot | null,
      ) => {
        requestAnimationFrame(() => {
        restoreTextareaSelection(
          promptRef.current,
          selection,
          promptRef.current?.value.length ?? promptValueRef.current.length,
          {
              scrollSnapshot,
              syncScroll: syncPromptHighlightScroll,
              onAfterRestore: (textarea, nextSelection) => {
                lastPromptSelectionRef.current = nextSelection;
                syncPromptTextSelectionState(textarea);
              },
            },
          );
        });
      },
      [syncPromptHighlightScroll, syncPromptTextSelectionState],
    );

    const insertImageReference = useCallback(
      (imageIndex: number) => {
        if (isPromptLockedByUpstream) {
          return;
        }

        const marker = buildShortReferenceToken(imageIndex);
        const currentPrompt = promptValueRef.current;
        const scrollSnapshot = readTextareaScroll(promptRef.current);
        const selection = resolveTextSelection({
          textarea: promptRef.current,
          lastSelection: pickerSelectionRef.current ?? lastPromptSelectionRef.current,
          fallbackLength: currentPrompt.length,
          requireFocus: true,
        });
        const cursor = selection.start;
        const { nextText, nextCursor } = insertReferenceToken(
          currentPrompt,
          cursor,
          marker,
        );

        handlePromptChange(nextText);
        setShowImagePicker(false);
        pickerSelectionRef.current = null;
        setPickerActiveIndex(0);
        schedulePromptSelectionRestore(nextCursor, scrollSnapshot);
      },
      [handlePromptChange, isPromptLockedByUpstream, schedulePromptSelectionRestore],
    );

    const handleRemoveReferenceImage = useCallback(
      (sourceEdgeId: string) => {
        setShowImagePicker(false);
        pickerSelectionRef.current = null;
        setPromptReferencePreview(null);
        deleteEdge(sourceEdgeId);
      },
      [deleteEdge],
    );

    const handleOptimizePrompt = useCallback(async () => {
      if (isPromptLockedByUpstream) {
        return;
      }

      const sourcePrompt = promptValueRef.current;
      const currentPrompt = sourcePrompt.trim();
      if (!currentPrompt) {
        const message = t("node.jimengImage.promptRequired");
        updateNodeData(id, { lastError: null });
        setPromptOptimizationError(message);
        await showErrorDialog(message, t("common.error"));
        return;
      }

      setIsOptimizingPrompt(true);
      setPromptOptimizationError(null);
      updateNodeData(id, { lastError: null });

      try {
        const optimizationReferenceImages = resolveOptimizationReferenceImages(
          currentPrompt,
          incomingImages,
          modelSupportsReferenceImages,
        );
        const optimizationReferenceImageBindings = resolvePromptReferenceImageBindings(
          currentPrompt,
          buildSequentialPromptReferenceImageCandidates(incomingImages),
        );
        const result = await optimizeCanvasPrompt({
          mode: "image",
          prompt: currentPrompt,
          referenceImages: optimizationReferenceImages,
          referenceImageBindings: optimizationReferenceImageBindings,
          maxPromptLength: optimizedPromptMaxLength,
        });
        if (promptValueRef.current !== sourcePrompt) {
          return;
        }

        const nextPrompt = result.prompt;
        setLastPromptOptimizationMeta({
          modelLabel: [result.context.provider, result.context.model]
            .filter(Boolean)
            .join(" / "),
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

        updatePrompt(nextPrompt);
        schedulePromptSelectionRestore(nextPrompt.length);
      } catch (error) {
        const message =
          error instanceof Error && error.message.trim().length > 0
            ? error.message
            : t("node.jimengImage.optimizePromptFailed");
        setPromptOptimizationError(message);
        await showErrorDialog(message, t("common.error"));
      } finally {
        setIsOptimizingPrompt(false);
      }
    }, [
      id,
      incomingImages,
      isPromptLockedByUpstream,
      optimizedPromptMaxLength,
      modelSupportsReferenceImages,
      syncPromptHighlightScroll,
      t,
      updateNodeData,
      updatePrompt,
    ]);

    const handleUndoOptimizedPrompt = useCallback(() => {
      if (isPromptLockedByUpstream) {
        return;
      }

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
      schedulePromptSelectionRestore(restoredPrompt.length);
    }, [
      isPromptLockedByUpstream,
      lastPromptOptimizationUndoState,
      schedulePromptSelectionRestore,
      updatePrompt,
    ]);

    const handleGenerate = useCallback(async () => {
      const prompt = effectivePrompt.trim();
      if (!prompt) {
        const message = t("node.jimengImage.promptRequired");
        updateNodeData(id, { lastError: message });
        await showErrorDialog(message, t("common.error"));
        return;
      }

      const submittedPrompt = appendCameraParamsToPrompt(
        prompt,
        resolvedCameraParams,
      );

      if (isGenerateBlocked) {
        const message = t("node.jimengImage.referenceUnsupportedModel");
        updateNodeData(id, { lastError: message });
        await showErrorDialog(message, t("common.error"));
        return;
      }

      setPromptOptimizationError(null);
      updateNodeData(id, {
        lastError: null,
        resultImages: [],
      });

      let createdResultNodeId: string | null = null;
      const startedAt = Date.now();

      try {
        const resultNodePosition = findNodePosition(
          id,
          JIMENG_IMAGE_RESULT_NODE_DEFAULT_WIDTH,
          JIMENG_IMAGE_RESULT_NODE_DEFAULT_HEIGHT,
        );
        createdResultNodeId = addNode(
          CANVAS_NODE_TYPES.jimengImageResult,
          resultNodePosition,
          {
            sourceNodeId: id,
            displayName: buildJimengResultNodeTitle(
              t("node.jimengImage.resultNodeTitle"),
            ),
            submitIds: [],
            modelVersion: selectedModel,
            aspectRatio: selectedAspectRatio,
            gridRows: 2,
            gridCols: 2,
            resultImages: [],
            isGenerating: true,
            generationStartedAt: startedAt,
            generationDurationMs: data.generationDurationMs ?? 90000,
            lastGeneratedAt: null,
            lastError: null,
          },
          { inheritParentFromNodeId: id },
        );
        addEdge(id, createdResultNodeId);
        await flushCurrentProjectToDiskSafely(
          "creating Jimeng image result node",
        );

        const dreaminaStatus = await ensureDreaminaCliReady({
          feature: "image",
          action: "generate",
        });
        if (!dreaminaStatus.ready) {
          const message = resolveDreaminaSetupBlockedMessage(
            t,
            dreaminaStatus.code,
          );
          updateNodeData(id, {
            lastError: message,
          });
          if (createdResultNodeId) {
            updateNodeData(createdResultNodeId, {
              isGenerating: false,
              generationStartedAt: null,
              lastError: message,
            });
          }
          await flushCurrentProjectToDiskSafely(
            "saving Jimeng image generation blocked state",
          );
          return;
        }

        const generationResponse = await generateJimengImages({
          prompt: submittedPrompt,
          aspectRatio: selectedAspectRatio,
          resolutionType: selectedResolution,
          modelVersion: selectedModel,
          referenceImageSources: modelSupportsReferenceImages
            ? incomingImages
            : [],
          onSubmitted: async ({ submitIds }) => {
            if (!createdResultNodeId) {
              return;
            }

            updateNodeData(createdResultNodeId, {
              submitIds,
              isGenerating: true,
              generationStartedAt: startedAt,
              lastError: null,
            });
            await flushCurrentProjectToDiskSafely(
              "saving Jimeng image submit ids",
            );
          },
        });
        const completedAt = Date.now();

        updateNodeData(id, {
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
        await flushCurrentProjectToDiskSafely(
          "saving Jimeng image generation result",
        );
      } catch (error) {
        const content = resolveErrorContent(
          error,
          t("node.jimengImage.generateFailed"),
        );
        updateNodeData(id, {
          lastError: content.message,
        });
        if (createdResultNodeId) {
          updateNodeData(createdResultNodeId, {
            isGenerating: false,
            generationStartedAt: null,
            lastError: content.message,
          });
        }
        await flushCurrentProjectToDiskSafely(
          "saving Jimeng image generation error",
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
      data.generationDurationMs,
      findNodePosition,
      flushCurrentProjectToDiskSafely,
      id,
      effectivePrompt,
      incomingImages,
      isGenerateBlocked,
      modelSupportsReferenceImages,
      resolvedCameraParams,
      selectedAspectRatio,
      selectedModel,
      selectedResolution,
      t,
      updateNodeData,
    ]);

    const handleModelChange = useCallback(
      (nextValue: JimengImageModelVersion) => {
        const nextResolution = normalizeJimengImageResolutionForModel(
          nextValue,
          selectedResolution,
        );
        updateNodeData(id, {
          modelVersion: nextValue,
          resolutionType: nextResolution,
        });
        setLastJimengImageDefaults({
          modelVersion: nextValue,
          resolutionType: nextResolution,
          aspectRatio: selectedAspectRatio,
        });
      },
      [
        id,
        selectedAspectRatio,
        selectedResolution,
        setLastJimengImageDefaults,
        updateNodeData,
      ],
    );

    const handleResolutionChange = useCallback(
      (nextValue: JimengImageResolutionType) => {
        updateNodeData(id, { resolutionType: nextValue });
        setLastJimengImageDefaults({
          modelVersion: selectedModel,
          resolutionType: nextValue,
          aspectRatio: selectedAspectRatio,
        });
      },
      [
        id,
        selectedAspectRatio,
        selectedModel,
        setLastJimengImageDefaults,
        updateNodeData,
      ],
    );

    const handleAspectRatioChange = useCallback(
      (nextValue: JimengAspectRatio) => {
        updateNodeData(id, { aspectRatio: nextValue });
        setLastJimengImageDefaults({
          modelVersion: selectedModel,
          resolutionType: selectedResolution,
          aspectRatio: nextValue,
        });
      },
      [
        id,
        selectedModel,
        selectedResolution,
        setLastJimengImageDefaults,
        updateNodeData,
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

        const previewMaxWidth = 144;
        const previewMaxHeight = 132;
        const previewPosition = resolveFloatingPreviewPosition({
          container: previewHost,
          clientX: event.clientX,
          clientY: event.clientY,
          previewWidth: previewMaxWidth,
          previewHeight: previewMaxHeight,
          zoom,
        });

        setPromptReferencePreview({
          imageUrl: item.imageUrl,
          displayUrl: item.displayUrl,
          alt: item.label,
          left: previewPosition.left,
          top: previewPosition.top,
        });
      },
      [incomingImageItems, zoom],
    );

    const handlePromptReferenceTokenMouseDown = useCallback(
      (tokenEnd: number, event: ReactMouseEvent<HTMLSpanElement>) => {
        event.preventDefault();
        event.stopPropagation();
        schedulePromptSelectionRestore(tokenEnd);
      },
      [schedulePromptSelectionRestore],
    );

    const handlePromptKeyDown = useCallback(
      (event: KeyboardEvent<HTMLTextAreaElement>) => {
        if (isPromptLockedByUpstream) {
          if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
            event.preventDefault();
            event.stopPropagation();
            void handleGenerate();
          }
          return;
        }

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
            incomingImages.length,
          );
          if (deleteRange) {
            event.preventDefault();
            const { nextText, nextCursor } = removeTextRange(
              currentPrompt,
              deleteRange,
            );
            handlePromptChange(nextText);
            schedulePromptSelectionRestore(nextCursor);
            return;
          }
        }

        if (showImagePicker && incomingImages.length > 0) {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            event.stopPropagation();
            setPickerActiveIndex(
              (previous) => (previous + 1) % incomingImages.length,
            );
            return;
          }

          if (event.key === "ArrowUp") {
            event.preventDefault();
            event.stopPropagation();
            setPickerActiveIndex((previous) =>
              previous === 0 ? incomingImages.length - 1 : previous - 1,
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

        if (
          event.key === "@" &&
          incomingImages.length > 0 &&
          modelSupportsReferenceImages
        ) {
          event.preventDefault();
          event.stopPropagation();
          const selection =
            readTextareaSelection(event.currentTarget, promptValueRef.current.length)
            ?? resolveTextSelection({
              textarea: event.currentTarget,
              lastSelection: lastPromptSelectionRef.current,
              fallbackLength: promptValueRef.current.length,
            });
          lastPromptSelectionRef.current = selection;
          pickerSelectionRef.current = selection;
          setPickerAnchor(
            resolveTextareaPickerAnchor({
              container: promptPanelRef.current,
              textarea: event.currentTarget,
              caretIndex: selection.start,
              yOffset: PICKER_Y_OFFSET_PX,
            }),
          );
          setShowImagePicker(true);
          setPickerActiveIndex(0);
          return;
        }

        if (event.key === "Escape" && showImagePicker) {
          event.preventDefault();
          event.stopPropagation();
          setShowImagePicker(false);
          pickerSelectionRef.current = null;
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
        incomingImages.length,
        isPromptLockedByUpstream,
        insertImageReference,
        modelSupportsReferenceImages,
        pickerActiveIndex,
        showImagePicker,
        schedulePromptSelectionRestore,
      ],
    );

    const combinedError = promptOptimizationError ?? data.lastError;
    const canUndoPromptOptimization = Boolean(
      lastPromptOptimizationUndoState &&
      promptDraft === lastPromptOptimizationUndoState.appliedPrompt,
    );
    const promptOptimizationNotice = lastPromptOptimizationMeta
      ? `${t("node.jimengImage.optimizeModelLabel", {
          model: lastPromptOptimizationMeta.modelLabel,
        })} | ${t("node.jimengImage.optimizeReferenceImagesLabel", {
          status:
            lastPromptOptimizationMeta.referenceImageCount > 0
              ? t("node.jimengImage.optimizeReferenceImagesUsed", {
                  count: lastPromptOptimizationMeta.referenceImageCount,
                })
              : t("node.jimengImage.optimizeReferenceImagesUnused"),
        })}`
      : null;
    const referenceStatusText = isGenerateBlocked
      ? t("node.jimengImage.referenceUnsupportedModel")
      : !modelSupportsReferenceImages
        ? t("node.jimengImage.resolutionLockedTo2k")
        : incomingImages.length > 0
          ? t("node.jimengImage.referenceHelperActive", {
              count: incomingImages.length,
            })
          : t("node.jimengImage.referenceEmpty");
    const promptLockStatusText = isPromptLockedByUpstream
      ? (
          hasNonEmptyConnectedText
            ? t("common.upstreamTextDisconnectHint")
            : t("common.upstreamTextEmpty")
        )
      : null;

    const headerStatus = useMemo(() => {
      if (isOptimizingPrompt) {
        return (
          <NodeStatusBadge
            icon={<Loader2 className="h-3 w-3" />}
            label={t("node.jimengImage.optimizingPrompt")}
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
      (promptLockStatusText ??
      (lastGeneratedTime
        ? t("node.jimengImage.generatedToNode", { time: lastGeneratedTime })
        : (promptOptimizationNotice ??
          referenceStatusText ??
          t("node.jimengImage.parameterHint"))));
    const showBlockingOverlay = Boolean(data.isGenerating || isOptimizingPrompt);
    const handleReferenceSourceHighlight = useCallback(
      (sourceNodeId: string) => {
        setHighlightedReferenceSourceNode(
          highlightedReferenceSourceNodeId === sourceNodeId ? null : sourceNodeId,
        );
      },
      [highlightedReferenceSourceNodeId, setHighlightedReferenceSourceNode],
    );

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
              className="relative min-h-[136px] flex-1"
            >
              <div
                ref={promptHighlightRef}
                aria-hidden="true"
                className="ui-scrollbar pointer-events-none absolute inset-0 overflow-y-auto overflow-x-hidden text-sm leading-6 text-text-dark"
                style={{ scrollbarGutter: "stable" }}
              >
                <div className="min-h-full whitespace-pre-wrap break-words px-3 py-2">
                  {renderPromptWithHighlights(
                    displayedPrompt,
                    incomingImages.length,
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
                    displayedPrompt,
                    incomingImages.length,
                    handlePromptReferenceTokenHover,
                    hidePromptReferencePreview,
                    handlePromptReferenceTokenMouseDown,
                  )}
                </div>
              </div>

                <textarea
                  ref={promptRef}
                  value={displayedPrompt}
                  readOnly={isPromptLockedByUpstream}
                  aria-readonly={isPromptLockedByUpstream}
                  aria-disabled={isPromptLockedByUpstream}
                  tabIndex={isPromptLockedByUpstream ? -1 : undefined}
                onChange={(event) => {
                  handlePromptChange(event.target.value);
                  rememberPromptSelection(event.currentTarget);
                }}
                placeholder={t("node.jimengImage.promptPlaceholder")}
                className={`ui-scrollbar nodrag nowheel relative z-10 h-full w-full resize-none rounded-xl border border-white/10 bg-black/15 px-3 py-2 text-sm leading-6 text-transparent outline-none placeholder:text-text-muted/70 whitespace-pre-wrap break-words selection:bg-accent/30 selection:text-transparent ${
                  isPromptLockedByUpstream
                    ? "cursor-default caret-transparent"
                    : "caret-text-dark focus:border-accent/50"
                }`}
                style={{ scrollbarGutter: "stable" }}
                onScroll={syncPromptHighlightScroll}
                onMouseDown={(event) => {
                  event.stopPropagation();
                  hidePromptReferencePreview();
                }}
                onSelect={(event) =>
                  rememberPromptSelection(event.currentTarget)
                }
                onMouseUp={(event) =>
                  rememberPromptSelection(event.currentTarget)
                }
                onKeyUp={(event) =>
                  rememberPromptSelection(event.currentTarget)
                }
                onBlur={() => setIsPromptTextSelectionActive(false)}
                onKeyDownCapture={handlePromptKeyDown}
              />

              {isPromptLockedByUpstream ? (
                <UpstreamPromptLockOverlay
                  empty={!hasNonEmptyConnectedText}
                />
              ) : null}

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
              {incomingImageItems.length > 0 ? (
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  {incomingImageItems.map((item, index) => (
                    <ReferenceVisualChip
                      key={`${item.imageUrl}-${index}`}
                      kind="image"
                      displayUrl={item.displayUrl}
                      label={item.label}
                      tokenLabel={item.tokenLabel}
                      viewerImageList={incomingImageDisplayList}
                      isActive={highlightedReferenceSourceNodeId === item.sourceNodeId}
                      removeLabel={t("common.delete")}
                      onMouseDown={(event) => {
                        event.stopPropagation();
                        if (event.button !== 0) {
                          return;
                        }
                        handleReferenceSourceHighlight(item.sourceNodeId);
                      }}
                      onRemove={() => handleRemoveReferenceImage(item.sourceEdgeId)}
                    />
                  ))}
                </div>
              ) : (
                <div className="flex min-h-[28px] w-full items-center text-[11px] text-text-muted">
                  {referenceStatusText}
                </div>
              )}
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

        <div className="mt-2 flex shrink-0 items-center gap-2">
          <div className="ui-scrollbar min-w-0 flex-1 overflow-x-auto overflow-y-hidden">
            <div className="flex w-max min-w-full items-center gap-1.5 pr-1">
              <FixedControlChip
                label={t("node.jimengImage.parameters.model")}
                value={selectedModel}
                options={modelOptions}
                onChange={handleModelChange}
              />
              <FixedControlChip
                label={t("node.jimengImage.parameters.resolution")}
                value={selectedResolution}
                options={resolutionOptions}
                onChange={handleResolutionChange}
              />
              <FixedControlChip
                label={t("node.jimengImage.parameters.aspectRatio")}
                value={selectedAspectRatio}
                options={aspectRatioOptions}
                onChange={handleAspectRatioChange}
              />
              <StyleTemplatePicker
                className={`${NODE_CONTROL_CHIP_CLASS} !w-8 !px-0 shrink-0 justify-center`}
                disabled={isPromptLockedByUpstream}
                onTemplateApply={(template) => {
                  if (isPromptLockedByUpstream) {
                    return;
                  }
                  const nextPrompt = appendStyleTemplatePrompt(
                    promptValueRef.current,
                    template.prompt,
                  );
                  handlePromptChange(nextPrompt);
                }}
              />
              <UiChipButton
                type="button"
                active={showCameraParamsDialog || isCameraParamsApplied}
                className={cameraParamsButtonClassName}
                aria-label={t("cameraParams.trigger")}
                title={cameraParamsButtonTitle}
                onClick={(event) => {
                  event.stopPropagation();
                  setShowCameraParamsDialog(true);
                }}
              >
                <CameraTriggerIcon
                  active={isCameraParamsApplied}
                  variant="photo"
                  className={`h-4 w-4 origin-center scale-[1.24] ${
                    isCameraParamsApplied ? "text-emerald-300" : "text-text-dark"
                  }`}
                />
              </UiChipButton>
              <UiChipButton
                type="button"
                active={isOptimizingPrompt}
                disabled={
                  isPromptLockedByUpstream
                  || isOptimizingPrompt
                  || promptDraft.trim().length === 0
                }
                className={`${NODE_CONTROL_CHIP_CLASS} !w-8 !px-0 shrink-0 justify-center`}
                aria-label={
                  isOptimizingPrompt
                    ? t("node.jimengImage.optimizingPrompt")
                    : t("node.jimengImage.optimizePrompt")
                }
                title={
                  isOptimizingPrompt
                    ? t("node.jimengImage.optimizingPrompt")
                    : t("node.jimengImage.optimizePrompt")
                }
                onClick={(event) => {
                  event.stopPropagation();
                  void handleOptimizePrompt();
                }}
              >
                <Wand2
                  className="h-4 w-4 origin-center scale-[1.18] text-text-dark"
                  strokeWidth={2.45}
                />
              </UiChipButton>
              <UiChipButton
                type="button"
                disabled={
                  isPromptLockedByUpstream
                  || isOptimizingPrompt
                  || !canUndoPromptOptimization
                }
                className={`${NODE_CONTROL_CHIP_CLASS} !w-8 !px-0 shrink-0 justify-center`}
                aria-label={t("node.jimengImage.undoOptimizedPrompt")}
                title={t("node.jimengImage.undoOptimizedPrompt")}
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
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1">
            <UiButton
              onClick={(event) => {
                event.stopPropagation();
                void handleGenerate();
              }}
              variant="primary"
              disabled={isGenerateBlocked}
              className={NODE_CONTROL_PRIMARY_BUTTON_CLASS}
            >
              <Sparkles
                className={NODE_CONTROL_GENERATE_ICON_CLASS}
                strokeWidth={2.5}
              />
              {t("node.jimengImage.generate")}
            </UiButton>
          </div>
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
        <UiLoadingOverlay
          visible={showBlockingOverlay}
          insetClassName="inset-3"
          backdropClassName="bg-transparent"
          variant="bare"
        />
        <CameraParamsDialog
          isOpen={showCameraParamsDialog}
          value={resolvedCameraParams}
          onApply={(nextValue) => updateNodeData(id, { cameraParams: nextValue })}
          onClose={() => setShowCameraParamsDialog(false)}
        />
      </div>
    );
  },
);

JimengImageNode.displayName = "JimengImageNode";
