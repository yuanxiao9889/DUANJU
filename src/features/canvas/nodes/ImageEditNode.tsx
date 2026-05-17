import {
  type FormEvent as ReactFormEvent,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  Fragment,
  memo,
  useMemo,
  useState,
  useCallback,
  useEffect,
  useRef,
} from "react";
import {
  Position,
  useUpdateNodeInternals,
  type NodeProps,
} from "@xyflow/react";
import { CanvasHandle } from "@/features/canvas/ui/CanvasHandle";
import { AlertTriangle, Loader2, Sparkles, Undo2, Wand2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { UiLoadingOverlay } from "@/components/ui";
import {
  AUTO_REQUEST_ASPECT_RATIO,
  CANVAS_NODE_TYPES,
  EXPORT_RESULT_NODE_MIN_HEIGHT,
  EXPORT_RESULT_NODE_MIN_WIDTH,
  IMAGE_EDIT_NODE_DEFAULT_HEIGHT,
  IMAGE_EDIT_NODE_DEFAULT_WIDTH,
  type ExportImageGenerationSummary,
  type ExportImageNodeData,
  type ImageEditNodeData,
  type ImageSize,
} from "@/features/canvas/domain/canvasNodes";
import { resolveNodeDisplayName } from "@/features/canvas/domain/nodeDisplay";
import {
  GRSAI_GPT_IMAGE_2_MODEL_ID,
  normalizeGrsaiGptImage2AspectRatio,
} from "@/features/canvas/models/image/grsai/gptImage2";
import {
  NodeHeader,
  NODE_HEADER_FLOATING_POSITION_CLASS,
} from "@/features/canvas/ui/NodeHeader";
import { NodeResizeHandle } from "@/features/canvas/ui/NodeResizeHandle";
import { canvasAiGateway, canvasEventBus } from "@/features/canvas/application/canvasServices";
import { cropImageSource } from "@/commands/image";
import {
  resolveErrorContent,
  showErrorDialog,
} from "@/features/canvas/application/errorDialog";
import { recordImageGenerationErrorLog } from "@/features/canvas/application/errorLog";
import {
  detectAspectRatio,
  detectImageDimensions,
  parseAspectRatio,
  resolveReadableImageSource,
} from "@/features/canvas/application/imageData";
import { createCurrentProjectMediaContext } from "@/features/canvas/application/mediaPersistenceContext";
import { optimizeCanvasPrompt } from "@/features/canvas/application/promptOptimization";
import {
  buildSequentialPromptReferenceImageCandidates,
  resolvePromptBoundReferenceImages,
  resolvePromptReferenceImageCandidateByToken,
  resolvePromptReferenceImageBindings,
  rewritePromptReferenceTokensForRequest,
  type PromptReferenceImageCandidate,
} from "@/features/canvas/application/promptReferenceImageBindings";
import { resolveMinEdgeFittedSize } from "@/features/canvas/application/imageNodeSizing";
import { appendCameraParamsToPrompt } from "@/features/canvas/camera/cameraPrompt";
import { openSettingsDialog } from "@/features/settings/settingsEvents";
import {
  hasCameraParamsSelection,
  normalizeCameraParamsSelection,
  resolveCameraParamsSummary,
} from "@/features/canvas/camera/cameraPresets";
import {
  buildGenerationErrorReport,
  CURRENT_RUNTIME_SESSION_ID,
  createReferenceImagePlaceholders,
  getRuntimeDiagnostics,
  type GenerationDebugContext,
} from "@/features/canvas/application/generationErrorReport";
import {
  buildReferenceAwareGenerationPrompt,
  normalizeReferenceImagePrompt,
} from "@/features/canvas/application/referenceImagePrompting";
import {
  areReferenceImageOrdersEqual,
  buildShortReferenceToken,
  findReferenceTokensWithNamedCandidates,
  insertReferenceToken,
  remapReferenceTokensByImageOrder,
  removeTextRange,
  resolveReferenceAwareDeleteRange,
  type ReferenceTokenMatch,
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
  DEFAULT_IMAGE_MODEL_ID,
  getImageModel,
  isStoryboardApi2OkModelId,
  isStoryboardCompatibleModelId,
  isStoryboardNewApiModelId,
  isStoryboardOopiiModelId,
  listImageModels,
  resolveImageModelExtraParams,
  resolveStoryboardApi2OkModelConfigForModel,
  resolveImageModelResolution,
  resolveImageModelResolutions,
  resolveStoryboardCompatibleModelConfigForModel,
  resolveStoryboardNewApiModelConfigForModel,
  resolveStoryboardOopiiModelConfigForModel,
  toStoryboardApi2OkExtraParamsPayload,
  toStoryboardCompatibleExtraParamsPayload,
  toStoryboardNewApiExtraParamsPayload,
} from "@/features/canvas/models";
import { GRSAI_NANO_BANANA_PRO_MODEL_ID } from "@/features/canvas/models/image/grsai/nanoBananaPro";
import { resolveModelPriceDisplay } from "@/features/canvas/pricing";
import { resolveScriptAssetOptimizedPromptMaxLength } from "@/features/canvas/application/scriptAssetReferencePromptLimit";
import {
  useCanvasConnectedReferenceVisuals,
  useCanvasConnectedTextInput,
  useCanvasIncomingSourceNodes,
} from "@/features/canvas/hooks/useCanvasNodeGraph";
import { useCanvasZoom } from "@/features/canvas/hooks/useCanvasZoom";
import {
  NODE_CONTROL_CHIP_CLASS,
  NODE_CONTROL_MODEL_CHIP_CLASS,
  NODE_CONTROL_PARAMS_CHIP_CLASS,
  NODE_CONTROL_PRIMARY_BUTTON_CLASS,
  NODE_CONTROL_GENERATE_ICON_CLASS,
} from "@/features/canvas/ui/nodeControlStyles";
import { CameraParamsDialog } from "@/features/canvas/ui/CameraParamsDialog";
import { CameraTriggerIcon } from "@/features/canvas/ui/CameraTriggerIcon";
import { ModelParamsControls } from "@/features/canvas/ui/ModelParamsControls";
import { UpstreamPromptLockOverlay } from "@/features/canvas/ui/UpstreamPromptLockOverlay";
import { appendStyleTemplatePrompt } from "@/features/project/styleTemplatePrompt";
import {
  getCanvasNodeSize,
  resolveAbsoluteCanvasNodePosition,
} from "@/features/canvas/application/nodeGeometry";
import { CanvasNodeImage } from "@/features/canvas/ui/CanvasNodeImage";
import { NodePriceBadge } from "@/features/canvas/ui/NodePriceBadge";
import { NodeStatusBadge } from "@/features/canvas/ui/NodeStatusBadge";
import { PROMPT_REFERENCE_TOKEN_HIGHLIGHT_CLASS } from "@/features/canvas/ui/promptReferenceTokenStyles";
import {
  useIsOverviewCanvasRender,
  useShouldSuspendCanvasMedia,
} from "@/features/canvas/CanvasPerformanceContext";
import { UiButton, UiChipButton } from "@/components/ui";
import { useCanvasStore } from "@/stores/canvasStore";
import { useSettingsStore } from "@/stores/settingsStore";

type ImageEditNodeProps = NodeProps & {
  id: string;
  data: ImageEditNodeData;
  selected?: boolean;
};

interface AspectRatioChoice {
  value: string;
  label: string;
}

interface PromptOptimizationMeta {
  modelLabel: string;
  referenceImageCount: number;
}

interface PromptOptimizationUndoState {
  previousPrompt: string;
  appliedPrompt: string;
}

interface PromptReferencePreviewState {
  imageUrl: string;
  displayUrl: string;
  alt: string;
  left: number;
  top: number;
}

interface IncomingReferenceImageItem {
  referenceUrl: string;
  requestImageUrl: string;
  previewImageUrl: string;
  displayUrl: string;
  tokenLabel: string;
  label: string;
  assetId: string | null;
  displayName: string | null;
}

interface PromptReferenceTokenCandidate {
  tokenLabel: string;
  value: number;
}

const PICKER_Y_OFFSET_PX = 20;
const IMAGE_EDIT_NODE_MIN_WIDTH = 480;
const IMAGE_EDIT_NODE_MIN_HEIGHT = 180;
const ASSET_BATCH_RESULT_AREA_GAP_X = 56;
const ASSET_BATCH_RESULT_GRID_GAP_X = 28;
const ASSET_BATCH_RESULT_GRID_GAP_Y = 28;
const ASSET_BATCH_RESULT_GRID_COLS = 2;
const IMAGE_EDIT_NODE_MAX_WIDTH = 1400;
const IMAGE_EDIT_NODE_MAX_HEIGHT = 1000;
const REFERENCE_PICKER_TRIGGER_CHARACTERS = new Set(["@", "\uFF20"]);

function isReferencePickerTriggerCharacter(
  value: string | null | undefined,
): boolean {
  if (!value) {
    return false;
  }

  return REFERENCE_PICKER_TRIGGER_CHARACTERS.has(value);
}

function renderPromptWithHighlights(
  prompt: string,
  maxImageCount: number,
  namedCandidates: PromptReferenceTokenCandidate[] = [],
): ReactNode {
  if (!prompt) {
    return " ";
  }

  const segments: ReactNode[] = [];
  let lastIndex = 0;
  const referenceTokens = findReferenceTokensWithNamedCandidates(prompt, maxImageCount, namedCandidates);
  for (const token of referenceTokens) {
    const matchStart = token.start;
    const matchText = token.token;

    if (matchStart > lastIndex) {
      segments.push(
        <span key={`plain-${lastIndex}`}>
          {prompt.slice(lastIndex, matchStart)}
        </span>,
      );
    }

    segments.push(
      <span
        key={`ref-${matchStart}`}
        className={PROMPT_REFERENCE_TOKEN_HIGHLIGHT_CLASS}
      >
        {matchText}
      </span>,
    );

    lastIndex = matchStart + matchText.length;
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
  namedCandidates: PromptReferenceTokenCandidate[],
  onTokenHover: (
    token: ReferenceTokenMatch,
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
  const referenceTokens = findReferenceTokensWithNamedCandidates(prompt, maxImageCount, namedCandidates);
  for (const token of referenceTokens) {
    const matchStart = token.start;

    if (matchStart > lastIndex) {
      segments.push(
        <span key={`hover-plain-${lastIndex}`} className="text-transparent">
          {prompt.slice(lastIndex, matchStart)}
        </span>,
      );
    }

    segments.push(
      <span
        key={`hover-ref-${matchStart}`}
        className="pointer-events-auto cursor-help select-none text-transparent"
        onMouseEnter={(event) => onTokenHover(token, event)}
        onMouseMove={(event) => onTokenHover(token, event)}
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

function pickClosestAspectRatio(
  targetRatio: number,
  supportedAspectRatios: string[],
): string {
  const supported =
    supportedAspectRatios.length > 0 ? supportedAspectRatios : ["1:1"];
  let bestValue = supported[0];
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const aspectRatio of supported) {
    const ratio = parseAspectRatio(aspectRatio);
    const distance = Math.abs(Math.log(ratio / targetRatio));
    if (distance < bestDistance) {
      bestDistance = distance;
      bestValue = aspectRatio;
    }
  }

  return bestValue;
}

function buildAiResultNodeTitle(prompt: string, fallbackTitle: string): string {
  const normalizedPrompt = prompt.trim();
  if (!normalizedPrompt) {
    return fallbackTitle;
  }

  return normalizedPrompt;
}

function isStoryboardProductionImageNode(data: ImageEditNodeData): boolean {
  return Boolean(
    data.sourceStoryboardTableNodeId?.trim()
      && data.sourceDurationGroupId?.trim()
      && data.sourceImageResultNodeId?.trim(),
  );
}

function resolveStoryboardContinuousReferenceImage(
  currentNodeData: ImageEditNodeData,
  nodes: ReturnType<typeof useCanvasStore.getState>["nodes"],
  edges: ReturnType<typeof useCanvasStore.getState>["edges"],
): Promise<string | null> {
  if (
    !isStoryboardProductionImageNode(currentNodeData)
    || currentNodeData.continuousReferenceChain?.enabled !== true
  ) {
    return Promise.resolve(null);
  }

  const previousImageNodeId =
    currentNodeData.continuousReferenceChain.previousImageNodeId?.trim();
  if (!previousImageNodeId) {
    return Promise.resolve(null);
  }

  const nodeMap = new Map(nodes.map((node) => [node.id, node] as const));
  const previousResultNode = edges
    .filter((edge) => edge.source === previousImageNodeId)
    .map((edge) => nodeMap.get(edge.target))
    .find((node): node is typeof nodes[number] & {
      type: typeof CANVAS_NODE_TYPES.exportImage;
      data: ExportImageNodeData;
    } => (
      Boolean(node)
      && node?.type === CANVAS_NODE_TYPES.exportImage
      && (node.data as ExportImageNodeData).isStoryboardProductionPlaceholder === true
    ));

  if (!previousResultNode) {
    return Promise.resolve(null);
  }

  const selectedResultId = previousResultNode.data.selectedStoryboardProductionResultId?.trim();
  const selectedResult = selectedResultId
    ? previousResultNode.data.storyboardProductionResults?.find(
        (item) => item.id === selectedResultId,
      ) ?? null
    : null;

  const selectedImageUrl =
    selectedResult?.imageUrl?.trim()
    || selectedResult?.previewImageUrl?.trim()
    || selectedResult?.thumbnailUrl?.trim()
    || null;
  if (!selectedImageUrl) {
    return Promise.resolve(null);
  }

  return cropStoryboardLastShotReferenceImage(
    selectedImageUrl,
    previousResultNode.data,
  );
}

async function cropStoryboardLastShotReferenceImage(
  sourceImageUrl: string,
  previousResultData: ExportImageNodeData,
): Promise<string | null> {
  const rowCount = Math.max(
    1,
    Math.round(
      Number(
        previousResultData.generationStoryboardMetadata?.gridRows
          ?? previousResultData.sourceStoryboardRowIds?.length
          ?? 1,
      ),
    ),
  );
  if (rowCount <= 1) {
    return sourceImageUrl;
  }

  try {
    const dimensions = await detectImageDimensions(sourceImageUrl);
    const width = Math.max(1, dimensions.width);
    const height = Math.max(1, dimensions.height);
    const titleRatio = 0.1;
    const footerRatio = 0.18;
    const bodyTop = Math.round(height * titleRatio);
    const bodyHeight = Math.max(1, Math.round(height * (1 - titleRatio - footerRatio)));
    const rowHeight = Math.max(1, Math.floor(bodyHeight / rowCount));
    const cropY = Math.min(height - 1, bodyTop + rowHeight * (rowCount - 1));
    const cropHeight = Math.max(1, Math.min(rowHeight, height - cropY));
    const cropX = 0;
    const cropWidth = Math.max(1, Math.round(width * 0.42));

    return await cropImageSource(
      {
        source: sourceImageUrl,
        cropX,
        cropY,
        cropWidth,
        cropHeight,
      },
      createCurrentProjectMediaContext("image"),
    );
  } catch (error) {
    console.warn("[ImageEditNode] failed to crop storyboard continuity reference", error);
    return sourceImageUrl;
  }
}

function appendUniqueReferenceImage(
  referenceImages: string[],
  imageUrl: string | null,
): string[] {
  const normalizedImageUrl = imageUrl?.trim();
  if (!normalizedImageUrl) {
    return referenceImages;
  }

  if (referenceImages.some((item) => item.trim() === normalizedImageUrl)) {
    return referenceImages;
  }

  return [...referenceImages, normalizedImageUrl];
}

function appendStoryboardContinuityPrompt(prompt: string): string {
  const continuityPrompt =
    "连续分镜参考图来自上一组最后一个镜头行的左侧画面格；本组第一镜必须承接它的角色站位、视线方向、空间轴线、光影方向和动作末状态，但输出仍然是一整张新的拍摄分镜板。";
  const normalizedPrompt = prompt.trim();
  if (!normalizedPrompt || normalizedPrompt.includes(continuityPrompt)) {
    return prompt;
  }

  return `${prompt}\n${continuityPrompt}`;
}

export const ImageEditNode = memo(
  ({ id, data, selected, width, height }: ImageEditNodeProps) => {
    const { t, i18n } = useTranslation();
    const isOverviewRender = useIsOverviewCanvasRender();
    const shouldSuspendMedia = useShouldSuspendCanvasMedia();
    const zoom = useCanvasZoom();
    const updateNodeInternals = useUpdateNodeInternals();
    const [error, setError] = useState<string | null>(null);
    const [isOptimizingPrompt, setIsOptimizingPrompt] = useState(false);
    const [lastPromptOptimizationMeta, setLastPromptOptimizationMeta] =
      useState<PromptOptimizationMeta | null>(null);
    const [
      lastPromptOptimizationUndoState,
      setLastPromptOptimizationUndoState,
    ] = useState<PromptOptimizationUndoState | null>(null);

    const rootRef = useRef<HTMLDivElement>(null);
    const promptPanelRef = useRef<HTMLDivElement>(null);
    const promptPreviewHostRef = useRef<HTMLDivElement>(null);
    const promptRef = useRef<HTMLTextAreaElement>(null);
    const promptHighlightRef = useRef<HTMLDivElement>(null);
    const promptHoverLayerRef = useRef<HTMLDivElement>(null);
    const pickerItemRefs = useRef<Array<HTMLButtonElement | null>>([]);
    const [promptDraft, setPromptDraft] = useState(() => data.prompt ?? "");
    const promptDraftRef = useRef(promptDraft);
    const lastPromptSelectionRef = useRef<TextSelectionRange | null>(null);
    const pickerSelectionRef = useRef<TextSelectionRange | null>(null);
    const previousIncomingImagesRef = useRef<string[] | null>(null);
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
    const nodes = useCanvasStore((state) => state.nodes);
    const edges = useCanvasStore((state) => state.edges);
    const updateNodeData = useCanvasStore((state) => state.updateNodeData);
    const addNode = useCanvasStore((state) => state.addNode);
    const findNodePosition = useCanvasStore((state) => state.findNodePosition);
    const addEdge = useCanvasStore((state) => state.addEdge);
    const storyboardApiKeys = useSettingsStore(
      (state) => state.storyboardApiKeys,
    );
    const hrsaiNanoBananaProModel = useSettingsStore(
      (state) => state.hrsaiNanoBananaProModel,
    );
    const storyboardCompatibleModelConfig = useSettingsStore(
      (state) => state.storyboardCompatibleModelConfig,
    );
    const storyboardApi2OkModelConfig = useSettingsStore(
      (state) => state.storyboardApi2OkModelConfig,
    );
    const storyboardNewApiModelConfig = useSettingsStore(
      (state) => state.storyboardNewApiModelConfig,
    );
    const storyboardProviderCustomModels = useSettingsStore(
      (state) => state.storyboardProviderCustomModels,
    );
    const setLastImageEditDefaults = useSettingsStore(
      (state) => state.setLastImageEditDefaults,
    );
    const lastImageGenerationExtraParams = useSettingsStore(
      (state) => state.lastImageGenerationExtraParams,
    );
    const setLastImageGenerationExtraParams = useSettingsStore(
      (state) => state.setLastImageGenerationExtraParams,
    );
    const showNodePrice = useSettingsStore((state) => state.showNodePrice);
    const priceDisplayCurrencyMode = useSettingsStore(
      (state) => state.priceDisplayCurrencyMode,
    );
    const usdToCnyRate = useSettingsStore((state) => state.usdToCnyRate);
    const preferDiscountedPrice = useSettingsStore(
      (state) => state.preferDiscountedPrice,
    );
    const grsaiCreditTierId = useSettingsStore(
      (state) => state.grsaiCreditTierId,
    );

    const connectedReferenceVisuals = useCanvasConnectedReferenceVisuals(id);
    const { connectedText, hasConnectedTextSource, hasNonEmptyConnectedText } =
      useCanvasConnectedTextInput(id);
    const incomingSourceNodes = useCanvasIncomingSourceNodes(id);
    const batchParentGroup = useMemo(() => {
      const currentNode = nodes.find((node) => node.id === id);
      if (!currentNode?.parentId) {
        return null;
      }

      return (
        nodes.find(
          (node) =>
            node.id === currentNode.parentId &&
            node.type === CANVAS_NODE_TYPES.group &&
            (node.data as { visualStyle?: string }).visualStyle === "assetBatchGroup",
        ) ?? null
      );
    }, [id, nodes]);
    const isInAssetBatchGroup =
      batchParentGroup?.type === CANVAS_NODE_TYPES.group &&
      (batchParentGroup.data as { visualStyle?: string }).visualStyle === "assetBatchGroup";
    const isBatchGroupOverrideActive =
      isInAssetBatchGroup &&
      (batchParentGroup.data as { globalOverrideEnabled?: boolean })
        .globalOverrideEnabled === true;
    const effectiveModelId =
      isBatchGroupOverrideActive &&
      typeof (batchParentGroup?.data as { globalModelId?: string | null })?.globalModelId ===
        "string" &&
      ((batchParentGroup?.data as { globalModelId?: string | null }).globalModelId?.trim()
        .length ?? 0) > 0
        ? (batchParentGroup?.data as { globalModelId?: string }).globalModelId
        : data.model ?? DEFAULT_IMAGE_MODEL_ID;
    const effectiveSize =
      isBatchGroupOverrideActive &&
      typeof (batchParentGroup?.data as { globalSize?: ImageSize | null })?.globalSize ===
        "string"
        ? (batchParentGroup?.data as { globalSize?: ImageSize }).globalSize
        : data.size;
    const effectiveRequestAspectRatioValue =
      isBatchGroupOverrideActive &&
      typeof (batchParentGroup?.data as { globalAspectRatio?: string | null })
        ?.globalAspectRatio === "string"
        ? (batchParentGroup?.data as { globalAspectRatio?: string }).globalAspectRatio
        : data.requestAspectRatio;
    const effectiveStyleTemplatePrompt =
      isBatchGroupOverrideActive &&
      typeof (batchParentGroup?.data as { globalStyleTemplatePrompt?: string | null })
        ?.globalStyleTemplatePrompt === "string"
        ? (batchParentGroup?.data as { globalStyleTemplatePrompt?: string }).globalStyleTemplatePrompt
        : "";
    const isPromptOptimizationControlledByGroup = isBatchGroupOverrideActive;
    const isPromptLockedByUpstream = hasConnectedTextSource;
    const displayedPrompt = promptDraft;
    const effectivePrompt = isPromptLockedByUpstream
      ? connectedText
      : promptDraft;
    const relayoutBatchGroupResultNodes = useCallback(() => {
      if (!isInAssetBatchGroup || !batchParentGroup) {
        return;
      }

      const state = useCanvasStore.getState();
      const nodeMap = new Map(state.nodes.map((node) => [node.id, node] as const));
      const latestGroupNode = nodeMap.get(batchParentGroup.id);
      if (!latestGroupNode) {
        return;
      }

      const groupChildren = state.nodes.filter(
        (node) =>
          node.parentId === latestGroupNode.id &&
          node.type === CANVAS_NODE_TYPES.imageEdit,
      );
      if (groupChildren.length === 0) {
        return;
      }

      const sortedChildren = [...groupChildren].sort((left, right) => {
        const leftAbsolute = resolveAbsoluteCanvasNodePosition(left, nodeMap);
        const rightAbsolute = resolveAbsoluteCanvasNodePosition(right, nodeMap);
        if (leftAbsolute.y !== rightAbsolute.y) {
          return leftAbsolute.y - rightAbsolute.y;
        }
        return leftAbsolute.x - rightAbsolute.x;
      });
      const childOrder = new Map(
        sortedChildren.map((childNode, index) => [childNode.id, index] as const),
      );

      const resultEntries = state.edges
        .filter(
          (edge) =>
            childOrder.has(edge.source) &&
            nodeMap.get(edge.target)?.type === CANVAS_NODE_TYPES.exportImage,
        )
        .map((edge) => {
          const resultNode = nodeMap.get(edge.target);
          if (!resultNode || resultNode.type !== CANVAS_NODE_TYPES.exportImage) {
            return null;
          }

          const resultData = resultNode.data as { generationStartedAt?: number | null };
          return {
            sourceId: edge.source,
            resultNode,
            createdAt: resultData.generationStartedAt ?? 0,
          };
        })
        .filter(
          (
            value,
          ): value is {
            sourceId: string;
            resultNode: (typeof state.nodes)[number];
            createdAt: number;
          } => value !== null,
        )
        .sort((left, right) => {
          const sourceOrderDelta =
            (childOrder.get(left.sourceId) ?? Number.MAX_SAFE_INTEGER) -
            (childOrder.get(right.sourceId) ?? Number.MAX_SAFE_INTEGER);
          if (sourceOrderDelta !== 0) {
            return sourceOrderDelta;
          }
          if (left.createdAt !== right.createdAt) {
            return left.createdAt - right.createdAt;
          }
          return left.resultNode.id.localeCompare(right.resultNode.id);
        });

      if (resultEntries.length === 0) {
        return;
      }

      const groupAbsolutePosition = resolveAbsoluteCanvasNodePosition(
        latestGroupNode,
        nodeMap,
      );
      const groupSize = getCanvasNodeSize(latestGroupNode);
      const baseX = Math.round(
        groupAbsolutePosition.x + groupSize.width + ASSET_BATCH_RESULT_AREA_GAP_X,
      );
      const baseY = Math.round(
        sortedChildren.reduce((minY, childNode) => {
          const absolute = resolveAbsoluteCanvasNodePosition(childNode, nodeMap);
          return Math.min(minY, absolute.y);
        }, Number.POSITIVE_INFINITY),
      );

      const columnWidths = new Array(ASSET_BATCH_RESULT_GRID_COLS).fill(0);
      resultEntries.forEach((entry, index) => {
        const columnIndex = index % ASSET_BATCH_RESULT_GRID_COLS;
        const size = getCanvasNodeSize(entry.resultNode);
        columnWidths[columnIndex] = Math.max(
          columnWidths[columnIndex],
          Math.round(size.width),
        );
      });

      const rowHeights: number[] = [];
      resultEntries.forEach((entry, index) => {
        const rowIndex = Math.floor(index / ASSET_BATCH_RESULT_GRID_COLS);
        const size = getCanvasNodeSize(entry.resultNode);
        rowHeights[rowIndex] = Math.max(
          rowHeights[rowIndex] ?? 0,
          Math.round(size.height),
        );
      });

      const columnOffsets = columnWidths.map((_, columnIndex) => {
        let offset = 0;
        for (let index = 0; index < columnIndex; index += 1) {
          offset += columnWidths[index] + ASSET_BATCH_RESULT_GRID_GAP_X;
        }
        return offset;
      });
      const rowOffsets = rowHeights.map((_, rowIndex) => {
        let offset = 0;
        for (let index = 0; index < rowIndex; index += 1) {
          offset += rowHeights[index] + ASSET_BATCH_RESULT_GRID_GAP_Y;
        }
        return offset;
      });

      const currentResultNodeIds = new Set(resultEntries.map((entry) => entry.resultNode.id));
      useCanvasStore.setState((currentState) => ({
        nodes: currentState.nodes.map((node) => {
          if (!currentResultNodeIds.has(node.id)) {
            return node;
          }

          const layoutIndex = resultEntries.findIndex(
            (entry) => entry.resultNode.id === node.id,
          );
          if (layoutIndex === -1) {
            return node;
          }

          const columnIndex = layoutIndex % ASSET_BATCH_RESULT_GRID_COLS;
          const rowIndex = Math.floor(layoutIndex / ASSET_BATCH_RESULT_GRID_COLS);
          const nextPosition = {
            x: Math.round(baseX + columnOffsets[columnIndex]),
            y: Math.round(baseY + rowOffsets[rowIndex]),
          };

          if (
            node.parentId === undefined &&
            node.position.x === nextPosition.x &&
            node.position.y === nextPosition.y
          ) {
            return node;
          }

          return {
            ...node,
            parentId: undefined,
            extent: undefined,
            position: nextPosition,
          };
        }),
      }));
    }, [batchParentGroup, isInAssetBatchGroup]);

    const imageModels = useMemo(
      () =>
        listImageModels(
          storyboardCompatibleModelConfig,
          storyboardNewApiModelConfig,
          storyboardApi2OkModelConfig,
          storyboardProviderCustomModels,
        ),
      [
        storyboardCompatibleModelConfig,
        storyboardNewApiModelConfig,
        storyboardApi2OkModelConfig,
        storyboardProviderCustomModels,
      ],
    );

    const selectedModel = useMemo(() => {
      const modelId = effectiveModelId ?? DEFAULT_IMAGE_MODEL_ID;
      return getImageModel(
        modelId,
        storyboardCompatibleModelConfig,
        storyboardNewApiModelConfig,
        storyboardApi2OkModelConfig,
        storyboardProviderCustomModels,
      );
    }, [
      effectiveModelId,
      storyboardCompatibleModelConfig,
      storyboardNewApiModelConfig,
      storyboardApi2OkModelConfig,
      storyboardProviderCustomModels,
    ]);
    const resolvedCompatibleModelConfig = useMemo(
      () =>
        isStoryboardCompatibleModelId(selectedModel.id)
          ? resolveStoryboardCompatibleModelConfigForModel(
              selectedModel.id,
              storyboardCompatibleModelConfig,
              storyboardProviderCustomModels,
            )
          : storyboardCompatibleModelConfig,
      [
        selectedModel.id,
        storyboardCompatibleModelConfig,
        storyboardProviderCustomModels,
      ],
    );
    const resolvedApi2OkModelConfig = useMemo(
      () =>
        isStoryboardApi2OkModelId(selectedModel.id)
          ? resolveStoryboardApi2OkModelConfigForModel(
              selectedModel.id,
              storyboardApi2OkModelConfig,
              storyboardProviderCustomModels,
            )
          : storyboardApi2OkModelConfig,
      [
        selectedModel.id,
        storyboardApi2OkModelConfig,
        storyboardProviderCustomModels,
      ],
    );
    const resolvedModelExtraParams = useMemo(
      () =>
        resolveImageModelExtraParams(
          selectedModel,
          selectedModel.defaultExtraParams,
          lastImageGenerationExtraParams,
          data.extraParams,
        ),
      [data.extraParams, lastImageGenerationExtraParams, selectedModel],
    );
    const requestedNewApiResolution = useMemo(
      () =>
        isStoryboardNewApiModelId(selectedModel.id)
          ? resolveImageModelResolution(selectedModel, effectiveSize, {
              extraParams: resolvedModelExtraParams,
            }).value
          : null,
      [effectiveSize, resolvedModelExtraParams, selectedModel],
    );
    const resolvedNewApiModelConfig = useMemo(
      () =>
        isStoryboardNewApiModelId(selectedModel.id)
          ? resolveStoryboardNewApiModelConfigForModel(
              selectedModel.id,
              storyboardNewApiModelConfig,
              storyboardProviderCustomModels,
              {
                resolution: requestedNewApiResolution,
                extraParams: resolvedModelExtraParams,
              },
            )
          : storyboardNewApiModelConfig,
      [
        requestedNewApiResolution,
        resolvedModelExtraParams,
        selectedModel.id,
        storyboardNewApiModelConfig,
        storyboardProviderCustomModels,
      ],
    );
    const requestedOopiiResolution = useMemo(
      () =>
        isStoryboardOopiiModelId(selectedModel.id)
          ? resolveImageModelResolution(selectedModel, effectiveSize, {
              extraParams: resolvedModelExtraParams,
            }).value
          : null,
      [effectiveSize, resolvedModelExtraParams, selectedModel],
    );
    const resolvedOopiiModelConfig = useMemo(
      () =>
        isStoryboardOopiiModelId(selectedModel.id)
          ? resolveStoryboardOopiiModelConfigForModel(
              selectedModel.id,
              storyboardProviderCustomModels,
              {
                resolution: requestedOopiiResolution,
                extraParams: resolvedModelExtraParams,
              },
            )
          : resolveStoryboardOopiiModelConfigForModel(
              null,
              storyboardProviderCustomModels,
            ),
      [
        requestedOopiiResolution,
        resolvedModelExtraParams,
        selectedModel.id,
        storyboardProviderCustomModels,
      ],
    );
    const incomingImageItems = useMemo<IncomingReferenceImageItem[]>(
      () =>
        connectedReferenceVisuals
          .filter((item) => item.kind === "image")
          .map((item, index) => {
            const referenceUrl = item.referenceUrl.trim();
            if (!referenceUrl) {
              return null;
            }

            const previewImageUrl =
              item.previewImageUrl?.trim() || referenceUrl;
            return {
              referenceUrl,
              requestImageUrl: referenceUrl,
              previewImageUrl,
              displayUrl: previewImageUrl,
              tokenLabel: item.tokenAlias?.trim() || buildShortReferenceToken(index),
              label:
                item.displayName?.trim()
                || t("node.imageEdit.referenceImageLabel", {
                  index: index + 1,
                }),
              assetId: item.assetId ?? null,
              displayName: item.displayName ?? null,
            };
          })
          .filter((item): item is IncomingReferenceImageItem => item !== null),
      [connectedReferenceVisuals, t],
    );
    const namedReferenceTokenCandidates = useMemo<PromptReferenceTokenCandidate[]>(
      () =>
        incomingImageItems.map((item, index) => ({
          tokenLabel: item.tokenLabel,
          value: index + 1,
        })),
      [incomingImageItems],
    );
    const promptReferenceCandidates = useMemo<PromptReferenceImageCandidate[]>(
      () =>
        incomingImageItems.map((item, index) => ({
          referenceNumber: index + 1,
          imageUrl: item.requestImageUrl,
          previewImageUrl: item.previewImageUrl,
          tokenLabel: item.tokenLabel,
          assetId: item.assetId,
        })),
      [incomingImageItems],
    );
    const incomingImages = useMemo(
      () => incomingImageItems.map((item) => item.referenceUrl),
      [incomingImageItems],
    );
    const incomingImageViewerList = useMemo(
      () => incomingImageItems.map((item) => item.referenceUrl),
      [incomingImageItems],
    );
    const optimizedPromptMaxLength = useMemo(
      () =>
        resolveScriptAssetOptimizedPromptMaxLength(
          incomingSourceNodes.map((item) => item.node),
        ),
      [incomingSourceNodes],
    );
    const providerApiKey = storyboardApiKeys[selectedModel.providerId] ?? "";
    const effectiveExtraParams = useMemo(
      () => ({
        ...resolvedModelExtraParams,
        ...(selectedModel.id === GRSAI_NANO_BANANA_PRO_MODEL_ID
          ? { grsai_pro_model: hrsaiNanoBananaProModel }
          : {}),
        ...(isStoryboardCompatibleModelId(selectedModel.id)
          ? {
              compatible_config: toStoryboardCompatibleExtraParamsPayload(
                resolvedCompatibleModelConfig,
              ),
            }
          : isStoryboardOopiiModelId(selectedModel.id)
            ? {
                newapi_config: toStoryboardNewApiExtraParamsPayload(
                  resolvedOopiiModelConfig,
                ),
              }
            : isStoryboardNewApiModelId(selectedModel.id)
              ? {
                  newapi_config: toStoryboardNewApiExtraParamsPayload(
                    resolvedNewApiModelConfig,
                  ),
                }
              : isStoryboardApi2OkModelId(selectedModel.id)
                ? {
                    api2ok_config: toStoryboardApi2OkExtraParamsPayload(
                      resolvedApi2OkModelConfig,
                    ),
                  }
                : {}),
      }),
      [
        hrsaiNanoBananaProModel,
        resolvedModelExtraParams,
        resolvedOopiiModelConfig,
        resolvedApi2OkModelConfig,
        resolvedCompatibleModelConfig,
        resolvedNewApiModelConfig,
        selectedModel.id,
      ],
    );
    const resolutionOptions = useMemo(
      () =>
        resolveImageModelResolutions(selectedModel, {
          extraParams: effectiveExtraParams,
        }),
      [effectiveExtraParams, selectedModel],
    );

    const selectedResolution = useMemo(
      () =>
        resolveImageModelResolution(selectedModel, effectiveSize, {
          extraParams: effectiveExtraParams,
        }),
      [effectiveSize, effectiveExtraParams, selectedModel],
    );

    const aspectRatioOptions = useMemo<AspectRatioChoice[]>(
      () => [
        {
          value: AUTO_REQUEST_ASPECT_RATIO,
          label: t("modelParams.autoAspectRatio"),
        },
        ...selectedModel.aspectRatios,
      ],
      [selectedModel.aspectRatios, t],
    );

    const normalizedRequestAspectRatio = useMemo(
      () =>
        selectedModel.id === GRSAI_GPT_IMAGE_2_MODEL_ID
          ? (normalizeGrsaiGptImage2AspectRatio(
            effectiveRequestAspectRatioValue,
          ) ??
            AUTO_REQUEST_ASPECT_RATIO)
          : effectiveRequestAspectRatioValue,
      [effectiveRequestAspectRatioValue, selectedModel.id],
    );

    const selectedAspectRatio = useMemo(
      () =>
        aspectRatioOptions.find(
          (item) => item.value === normalizedRequestAspectRatio,
        ) ?? aspectRatioOptions[0],
      [aspectRatioOptions, normalizedRequestAspectRatio],
    );

    const requestResolution = selectedModel.resolveRequest({
      referenceImageCount: incomingImages.length,
    });
    const debugRequestModel = useMemo(
      () =>
        isStoryboardCompatibleModelId(selectedModel.id)
          ? resolvedCompatibleModelConfig.requestModel
          : isStoryboardNewApiModelId(selectedModel.id)
            ? resolvedNewApiModelConfig.requestModel
            : isStoryboardApi2OkModelId(selectedModel.id)
              ? resolvedApi2OkModelConfig.requestModel
              : requestResolution.requestModel,
      [
        requestResolution.requestModel,
        resolvedApi2OkModelConfig.requestModel,
        resolvedCompatibleModelConfig.requestModel,
        resolvedNewApiModelConfig.requestModel,
        selectedModel.id,
      ],
    );
    const resolvedPriceDisplay = useMemo(
      () =>
        showNodePrice
          ? resolveModelPriceDisplay(selectedModel, {
              resolution: selectedResolution.value,
              extraParams: effectiveExtraParams,
              language: i18n.language,
              settings: {
                displayCurrencyMode: priceDisplayCurrencyMode,
                usdToCnyRate,
                preferDiscountedPrice,
                grsaiCreditTierId,
              },
            })
          : null,
      [
        grsaiCreditTierId,
        i18n.language,
        preferDiscountedPrice,
        priceDisplayCurrencyMode,
        effectiveExtraParams,
        selectedModel,
        selectedResolution.value,
        showNodePrice,
        usdToCnyRate,
      ],
    );
    const resolvedPriceTooltip = useMemo(() => {
      if (!resolvedPriceDisplay) {
        return undefined;
      }

      const lines = [resolvedPriceDisplay.label];
      if (resolvedPriceDisplay.nativeLabel) {
        lines.push(
          t("pricing.nativePrice", { value: resolvedPriceDisplay.nativeLabel }),
        );
      }
      if (resolvedPriceDisplay.originalLabel) {
        lines.push(
          t("pricing.originalPrice", {
            value: resolvedPriceDisplay.originalLabel,
          }),
        );
      }
      if (resolvedPriceDisplay.pointsCost) {
        lines.push(
          t("pricing.pointsCost", { count: resolvedPriceDisplay.pointsCost }),
        );
      }
      if (resolvedPriceDisplay.grsaiCreditTier) {
        lines.push(
          t("pricing.grsaiTier", {
            price: resolvedPriceDisplay.grsaiCreditTier.priceCny.toFixed(2),
            credits:
              resolvedPriceDisplay.grsaiCreditTier.credits.toLocaleString(
                i18n.language.startsWith("zh") ? "zh-CN" : "en-US",
              ),
          }),
        );
      }
      return lines.join("\n");
    }, [i18n.language, resolvedPriceDisplay, t]);

    const supportedAspectRatioValues = useMemo(
      () => selectedModel.aspectRatios.map((item) => item.value),
      [selectedModel.aspectRatios],
    );

    const resolvedTitle = useMemo(
      () => resolveNodeDisplayName(CANVAS_NODE_TYPES.imageEdit, data),
      [data],
    );
    const resolvedCameraParams = useMemo(
      () => normalizeCameraParamsSelection(data.cameraParams),
      [data.cameraParams],
    );
    const isCameraParamsApplied =
      hasCameraParamsSelection(resolvedCameraParams);
    const cameraParamsButtonTitle = isCameraParamsApplied
      ? resolveCameraParamsSummary(resolvedCameraParams)
      : t("cameraParams.trigger");
    const cameraParamsButtonClassName = isCameraParamsApplied
      ? `${NODE_CONTROL_CHIP_CLASS} !w-8 !border-emerald-400/55 !bg-emerald-500/14 !px-0 !text-emerald-300 shadow-[0_0_0_1px_rgba(52,211,153,0.12)] hover:!bg-emerald-500/20 shrink-0 justify-center`
      : `${NODE_CONTROL_CHIP_CLASS} !w-8 !px-0 shrink-0 justify-center`;
    const headerStatus = useMemo(() => {
      if (isOptimizingPrompt) {
        return (
          <NodeStatusBadge
            icon={<Loader2 className="h-3 w-3" />}
            label={t("node.imageEdit.optimizingPrompt")}
            tone="processing"
            animate
          />
        );
      }

      if (!error) {
        return null;
      }

      return (
        <NodeStatusBadge
          icon={<AlertTriangle className="h-3 w-3" />}
          label={t("nodeStatus.error")}
          tone="danger"
          title={error}
        />
      );
    }, [error, isOptimizingPrompt, t]);
    const headerRightSlot = useMemo(() => {
      if (!resolvedPriceDisplay && !headerStatus) {
        return undefined;
      }

      return (
        <div className="mr-2 flex items-center gap-2">
          {resolvedPriceDisplay ? (
            <NodePriceBadge
              label={resolvedPriceDisplay.label}
              title={resolvedPriceTooltip}
              className="mr-0"
            />
          ) : null}
          {headerStatus}
        </div>
      );
    }, [headerStatus, resolvedPriceDisplay, resolvedPriceTooltip]);

    const resolvedWidth = Math.max(
      IMAGE_EDIT_NODE_MIN_WIDTH,
      Math.round(width ?? IMAGE_EDIT_NODE_DEFAULT_WIDTH),
    );
    const resolvedHeight = Math.max(
      IMAGE_EDIT_NODE_MIN_HEIGHT,
      Math.round(height ?? IMAGE_EDIT_NODE_DEFAULT_HEIGHT),
    );

    useEffect(() => {
      updateNodeInternals(id);
    }, [id, resolvedHeight, resolvedWidth, updateNodeInternals]);

    useEffect(() => {
      const externalPrompt = data.prompt ?? "";
      if (externalPrompt !== promptDraftRef.current) {
        promptDraftRef.current = externalPrompt;
        setPromptDraft(externalPrompt);
        setLastPromptOptimizationMeta(null);
        setLastPromptOptimizationUndoState(null);
      }
    }, [data.prompt]);

    const commitPromptDraft = useCallback(
      (nextPrompt: string) => {
        promptDraftRef.current = nextPrompt;
        updateNodeData(id, { prompt: nextPrompt });
      },
      [id, updateNodeData],
    );

    const commitManualPromptDraft = useCallback(
      (nextPrompt: string) => {
        setPromptDraft(nextPrompt);
        commitPromptDraft(nextPrompt);
        setLastPromptOptimizationMeta(null);
        setLastPromptOptimizationUndoState(null);
      },
      [commitPromptDraft],
    );

    useEffect(() => {
      const previousIncomingImages = previousIncomingImagesRef.current;
      if (!previousIncomingImages) {
        previousIncomingImagesRef.current = incomingImages;
        return;
      }

      if (
        areReferenceImageOrdersEqual(previousIncomingImages, incomingImages)
      ) {
        return;
      }

      previousIncomingImagesRef.current = incomingImages;
      const nextPrompt = remapReferenceTokensByImageOrder(
        promptDraftRef.current,
        previousIncomingImages,
        incomingImages,
      );
      if (nextPrompt === promptDraftRef.current) {
        return;
      }

      setPromptDraft(nextPrompt);
      commitPromptDraft(nextPrompt);
    }, [commitPromptDraft, incomingImages]);

    useEffect(() => {
      if (isBatchGroupOverrideActive) {
        return;
      }

      if (data.model !== selectedModel.id) {
        updateNodeData(id, { model: selectedModel.id });
      }

      if (data.size !== selectedResolution.value) {
        updateNodeData(id, { size: selectedResolution.value as ImageSize });
      }

      if (data.requestAspectRatio !== selectedAspectRatio.value) {
        updateNodeData(id, { requestAspectRatio: selectedAspectRatio.value });
      }
    }, [
      data.model,
      data.requestAspectRatio,
      data.size,
      id,
      isBatchGroupOverrideActive,
      selectedAspectRatio.value,
      selectedModel.id,
      selectedResolution.value,
      updateNodeData,
    ]);

    useEffect(() => {
      if (incomingImages.length === 0) {
        setShowImagePicker(false);
        pickerSelectionRef.current = null;
        setPickerActiveIndex(0);
        setPromptReferencePreview(null);
        return;
      }

      setPickerActiveIndex((previous) =>
        Math.min(previous, incomingImages.length - 1),
      );
    }, [incomingImages.length]);

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
      };

      document.addEventListener("mousedown", handleOutside, true);
      return () => {
        document.removeEventListener("mousedown", handleOutside, true);
      };
    }, []);

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
          textarea?.value.length ?? promptDraftRef.current.length,
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
            promptRef.current?.value.length ?? promptDraftRef.current.length,
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

    const handleOptimizePrompt = useCallback(async (): Promise<boolean> => {
      if (isPromptLockedByUpstream) {
        return false;
      }

      const sourcePrompt = promptDraftRef.current;
      const currentPrompt = sourcePrompt.trim();
      if (!currentPrompt) {
        const errorMessage = t("node.imageEdit.promptRequired");
        setError(errorMessage);
        void showErrorDialog(errorMessage, t("common.error"));
        return false;
      }

      setIsOptimizingPrompt(true);
      setError(null);

      try {
        const resolvedRequestReferenceImages = await Promise.all(
          incomingImageItems.map(
            async (item) =>
              await resolveReadableImageSource(
                item.requestImageUrl,
                item.previewImageUrl,
              ),
          ),
        );
        const requestReferenceCandidates = buildSequentialPromptReferenceImageCandidates(
          resolvedRequestReferenceImages,
        ).map((candidate, index) => ({
          ...candidate,
          tokenLabel: incomingImageItems[index]?.tokenLabel ?? null,
          previewImageUrl: incomingImageItems[index]?.previewImageUrl ?? null,
          assetId: incomingImageItems[index]?.assetId ?? null,
        }));
        const boundOptimizationImages = resolvePromptBoundReferenceImages(
          currentPrompt,
          requestReferenceCandidates,
        );
        const optimizationReferenceImages = boundOptimizationImages.map(
          (item) => item.candidate.imageUrl,
        );
        const optimizationReferenceImageBindings =
          resolvePromptReferenceImageBindings(
            currentPrompt,
            requestReferenceCandidates,
          );
        const result = await optimizeCanvasPrompt({
          mode: "image",
          prompt: currentPrompt,
          referenceImages: optimizationReferenceImages,
          referenceImageBindings: optimizationReferenceImageBindings,
          maxPromptLength: optimizedPromptMaxLength,
        });
        if (promptDraftRef.current !== sourcePrompt) {
          return false;
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
        setPromptDraft(nextPrompt);
        commitPromptDraft(nextPrompt);
        schedulePromptSelectionRestore(nextPrompt.length);
        return true;
      } catch (optimizationError) {
        const errorMessage =
          optimizationError instanceof Error &&
          optimizationError.message.trim().length > 0
            ? optimizationError.message
            : t("node.imageEdit.optimizePromptFailed");
        setError(errorMessage);
        void showErrorDialog(errorMessage, t("common.error"));
        return false;
      } finally {
        setIsOptimizingPrompt(false);
      }
    }, [
      commitPromptDraft,
      incomingImageItems,
      isPromptLockedByUpstream,
      optimizedPromptMaxLength,
      schedulePromptSelectionRestore,
      t,
    ]);

    const handleUndoOptimizedPrompt = useCallback(() => {
      if (isPromptLockedByUpstream) {
        return;
      }

      if (!lastPromptOptimizationUndoState) {
        return;
      }

      if (
        promptDraftRef.current !== lastPromptOptimizationUndoState.appliedPrompt
      ) {
        return;
      }

      const restoredPrompt = lastPromptOptimizationUndoState.previousPrompt;
      setLastPromptOptimizationUndoState(null);
      setLastPromptOptimizationMeta(null);
      setPromptDraft(restoredPrompt);
      commitPromptDraft(restoredPrompt);
      schedulePromptSelectionRestore(restoredPrompt.length);
    }, [
      commitPromptDraft,
      isPromptLockedByUpstream,
      lastPromptOptimizationUndoState,
      schedulePromptSelectionRestore,
    ]);

    const handleGenerate = useCallback(async (): Promise<boolean> => {
      const displayPrompt =
        normalizeReferenceImagePrompt(effectivePrompt).trim();
      if (!displayPrompt) {
        const errorMessage = t("node.imageEdit.promptRequired");
        setError(errorMessage);
        void showErrorDialog(errorMessage, t("common.error"));
        return false;
      }

      if (!providerApiKey) {
        const errorMessage = t("node.imageEdit.apiKeyRequired");
        setError(errorMessage);
        openSettingsDialog({
          category: "providers",
          providerTab: "storyboard",
          providerId: selectedModel.providerId,
        });
        void showErrorDialog(errorMessage, t("common.error"));
        return false;
      }

      const generationDurationMs = selectedModel.expectedDurationMs ?? 60000;
      const generationStartedAt = Date.now();
      const generationClientSessionId = `${CURRENT_RUNTIME_SESSION_ID}:${id}:${generationStartedAt}`;
      const resultNodeTitle = buildAiResultNodeTitle(
        displayPrompt,
        t("node.imageEdit.resultTitle"),
      );
      setError(null);
      const runtimeDiagnosticsPromise = getRuntimeDiagnostics();
      const resolvedRequestReferenceImagesPromise = Promise.all(
        incomingImageItems.map(
          async (item) =>
            await resolveReadableImageSource(
              item.requestImageUrl,
              item.previewImageUrl,
            ),
        ),
      );
      const initialRequestAspectRatio =
        selectedAspectRatio.value === AUTO_REQUEST_ASPECT_RATIO
          ? pickClosestAspectRatio(1, supportedAspectRatioValues)
          : selectedAspectRatio.value;
      const styledPrompt = effectiveStyleTemplatePrompt
        ? appendStyleTemplatePrompt(
          effectivePrompt,
          effectiveStyleTemplatePrompt,
        )
        : effectivePrompt;
      let submittedPrompt = styledPrompt;
      let generationSummary: ExportImageGenerationSummary = {
        sourceType: "imageEdit",
        providerId: selectedModel.providerId,
        requestModel: debugRequestModel,
        prompt: submittedPrompt,
        generatedAt: null,
      };
      const predictedResultSize = resolveMinEdgeFittedSize(
        initialRequestAspectRatio,
        {
          minWidth: EXPORT_RESULT_NODE_MIN_WIDTH,
          minHeight: EXPORT_RESULT_NODE_MIN_HEIGHT,
        },
      );
      const newNodePosition =
        isInAssetBatchGroup && batchParentGroup
          ? { x: 0, y: 0 }
          : findNodePosition(
            id,
            predictedResultSize.width,
            predictedResultSize.height,
          );
      const placeholderResultNode = edges
        .filter((edge) => edge.source === id)
        .map((edge) => nodes.find((node) => node.id === edge.target))
        .find((node): node is typeof nodes[number] & {
          type: typeof CANVAS_NODE_TYPES.exportImage;
          data: ExportImageNodeData;
        } => (
          Boolean(node)
          && node?.type === CANVAS_NODE_TYPES.exportImage
          && (node.data as ExportImageNodeData).isStoryboardProductionPlaceholder === true
        ));
      let newNodeId = placeholderResultNode?.id ?? null;
      const shouldResetStoryboardProductionPreview =
        placeholderResultNode?.data.isStoryboardProductionPlaceholder === true;
      const resultNodeData = {
          isGenerating: true,
          imageUrl: null,
          previewImageUrl: null,
          thumbnailUrl: null,
          generationPhase: "submitting",
          generationFailureStage: null,
          generationStartedAt,
          generationDurationMs,
          resultKind: "generic",
          displayName: resultNodeTitle,
          aspectRatio: initialRequestAspectRatio,
          generationSummary,
          generationStoryboardMetadata: data.generationStoryboardMetadata ?? undefined,
          generationJobId: null,
          generationProviderId: null,
          generationClientSessionId,
          generationStatusText: null,
          generationError: null,
          generationErrorDetails: null,
          generationDebugContext: undefined,
          ...(shouldResetStoryboardProductionPreview
            ? {
              generationForceRefreshRequestedAt: generationStartedAt,
            }
            : {}),
      } satisfies Partial<ExportImageNodeData>;
      if (newNodeId) {
        updateNodeData(newNodeId, resultNodeData);
      } else {
        newNodeId = addNode(
          CANVAS_NODE_TYPES.exportImage,
          newNodePosition,
          resultNodeData,
        );
        addEdge(id, newNodeId);
      }
      if (isInAssetBatchGroup && batchParentGroup) {
        relayoutBatchGroupResultNodes();
      }

      let resolvedRequestAspectRatio = initialRequestAspectRatio;
      let effectiveRequestSize = selectedResolution.value;
      let requestReferenceImages: string[] = [];
      let referenceImageOptimization: GenerationDebugContext["referenceImageOptimization"];
      let resolutionDowngrade: GenerationDebugContext["resolutionDowngrade"];

      try {
        const resolvedRequestReferenceImages =
          await resolvedRequestReferenceImagesPromise;
        const requestReferenceCandidates = buildSequentialPromptReferenceImageCandidates(
          resolvedRequestReferenceImages,
        ).map((candidate, index) => ({
          ...candidate,
          tokenLabel: promptReferenceCandidates[index]?.tokenLabel ?? null,
          previewImageUrl: promptReferenceCandidates[index]?.previewImageUrl ?? null,
          assetId: promptReferenceCandidates[index]?.assetId ?? null,
        }));
        const boundRequestImages = resolvePromptBoundReferenceImages(
          styledPrompt,
          requestReferenceCandidates,
        );
        requestReferenceImages = boundRequestImages.length > 0
          ? boundRequestImages.map((item) => item.candidate.imageUrl)
          : resolvedRequestReferenceImages;
        const continuousReferenceImage = await resolveStoryboardContinuousReferenceImage(
          data,
          nodes,
          edges,
        );
        requestReferenceImages = appendUniqueReferenceImage(
          requestReferenceImages,
          continuousReferenceImage,
        );
        const resolvedRequestPrompt = boundRequestImages.length > 0
          ? rewritePromptReferenceTokensForRequest(styledPrompt, boundRequestImages)
          : styledPrompt;
        const continuityAwarePrompt = continuousReferenceImage
          ? appendStoryboardContinuityPrompt(resolvedRequestPrompt)
          : resolvedRequestPrompt;
        submittedPrompt = appendCameraParamsToPrompt(
          buildReferenceAwareGenerationPrompt(
            continuityAwarePrompt,
            requestReferenceImages.length,
          ),
          resolvedCameraParams,
        );
        generationSummary = {
          ...generationSummary,
          prompt: submittedPrompt,
        };
        updateNodeData(
          newNodeId,
          { generationSummary },
          { historyMode: "skip" },
        );
        if (selectedAspectRatio.value === AUTO_REQUEST_ASPECT_RATIO) {
          if (requestReferenceImages.length > 0) {
            try {
              const sourceAspectRatio = await detectAspectRatio(
                requestReferenceImages[0],
              );
              const sourceAspectRatioValue =
                parseAspectRatio(sourceAspectRatio);
              resolvedRequestAspectRatio = pickClosestAspectRatio(
                sourceAspectRatioValue,
                supportedAspectRatioValues,
              );
            } catch {
              resolvedRequestAspectRatio = initialRequestAspectRatio;
            }
          }

          if (resolvedRequestAspectRatio !== initialRequestAspectRatio) {
            updateNodeData(
              newNodeId,
              { aspectRatio: resolvedRequestAspectRatio },
              { historyMode: "skip" },
            );
          }
        }

        await canvasAiGateway.setApiKey(
          selectedModel.providerId,
          providerApiKey,
        );
        const resolvedGeneratePayload =
          await canvasAiGateway.resolveGenerateImagePayload({
            prompt: submittedPrompt,
            model: requestResolution.requestModel,
            size: selectedResolution.value,
            aspectRatio: resolvedRequestAspectRatio,
            referenceImages: requestReferenceImages,
            extraParams: effectiveExtraParams,
          });
        effectiveRequestSize = resolvedGeneratePayload.effectiveSize;
        referenceImageOptimization =
          resolvedGeneratePayload.referenceImageOptimization;
        resolutionDowngrade = resolvedGeneratePayload.resolutionDowngrade;
        const generationStatusText = resolutionDowngrade
          ? t("node.imageNode.optimizedReferenceRequestDowngraded")
          : referenceImageOptimization?.applied
            ? t("node.imageNode.optimizedReferenceRequest")
            : null;
        const jobId = await canvasAiGateway.submitGenerateImageJob(
          resolvedGeneratePayload,
        );
        const runtimeDiagnostics = await runtimeDiagnosticsPromise;
        const generationDebugContext: GenerationDebugContext = {
          sourceType: "imageEdit",
          providerId: selectedModel.providerId,
          requestModel: debugRequestModel,
          requestSize: selectedResolution.value,
          effectiveRequestSize,
          requestAspectRatio: resolvedRequestAspectRatio,
          prompt: submittedPrompt,
          extraParams: effectiveExtraParams,
          referenceImageCount: requestReferenceImages.length,
          referenceImagePlaceholders: createReferenceImagePlaceholders(
            requestReferenceImages.length,
          ),
          referenceImageOptimization,
          resolutionDowngrade,
          appVersion: runtimeDiagnostics.appVersion,
          osName: runtimeDiagnostics.osName,
          osVersion: runtimeDiagnostics.osVersion,
          osBuild: runtimeDiagnostics.osBuild,
          networkProxySummary: runtimeDiagnostics.networkProxySummary,
          userAgent: runtimeDiagnostics.userAgent,
        };
        updateNodeData(newNodeId, {
          isGenerating: true,
          generationJobId: jobId,
          generationPhase: "queued",
          generationFailureStage: null,
          generationStartedAt,
          generationSourceType: "imageEdit",
          generationProviderId: selectedModel.providerId,
          generationClientSessionId,
          generationStatusText,
          generationError: null,
          generationErrorDetails: null,
          generationDebugContext,
        });
        return true;
      } catch (generationError) {
        const resolvedError = resolveErrorContent(
          generationError,
          t("ai.error"),
        );
        const runtimeDiagnostics = await runtimeDiagnosticsPromise;
        const generationDebugContext: GenerationDebugContext = {
          sourceType: "imageEdit",
          providerId: selectedModel.providerId,
          requestModel: debugRequestModel,
          requestSize: selectedResolution.value,
          effectiveRequestSize,
          requestAspectRatio: resolvedRequestAspectRatio,
          prompt: submittedPrompt,
          extraParams: effectiveExtraParams,
          referenceImageCount: requestReferenceImages.length,
          referenceImagePlaceholders: createReferenceImagePlaceholders(
            requestReferenceImages.length,
          ),
          referenceImageOptimization,
          resolutionDowngrade,
          appVersion: runtimeDiagnostics.appVersion,
          osName: runtimeDiagnostics.osName,
          osVersion: runtimeDiagnostics.osVersion,
          osBuild: runtimeDiagnostics.osBuild,
          networkProxySummary: runtimeDiagnostics.networkProxySummary,
          userAgent: runtimeDiagnostics.userAgent,
        };
        const reportText = buildGenerationErrorReport({
          errorMessage: resolvedError.message,
          errorDetails: resolvedError.details,
          context: generationDebugContext,
          errorCategory: resolvedError.category,
          statusCode: resolvedError.statusCode,
          traceId: resolvedError.traceId,
          requestId: resolvedError.requestId,
        });
        setError(resolvedError.message);
        void showErrorDialog(
          resolvedError.message,
          t("common.error"),
          resolvedError.details,
          reportText,
        );
        void recordImageGenerationErrorLog({
          nodeId: newNodeId,
          sourceType: "imageEdit",
          failureStage: "submit",
          errorMessage: resolvedError.message,
          errorDetails: resolvedError.details,
          context: generationDebugContext,
          errorCategory: resolvedError.category,
          statusCode: resolvedError.statusCode,
          traceId: resolvedError.traceId,
          requestId: resolvedError.requestId,
          providerId: selectedModel.providerId,
          startedAt: generationStartedAt,
        }).catch((error) => {
          console.warn("[ImageEditNode] failed to record error log", error);
        });
        updateNodeData(newNodeId, {
          isGenerating: false,
          generationPhase: "failed",
          generationFailureStage: "submit",
          generationStartedAt: null,
          generationJobId: null,
          generationProviderId: null,
          generationClientSessionId: null,
          generationStatusText: null,
          generationError: resolvedError.message,
          generationErrorDetails: resolvedError.details ?? null,
          generationDebugContext,
        });
        return false;
      }
    }, [
      addNode,
      addEdge,
      edges,
      providerApiKey,
      findNodePosition,
      resolvedCameraParams,
      effectivePrompt,
      effectiveStyleTemplatePrompt,
      effectiveExtraParams,
      id,
      incomingImages,
      incomingImageItems,
      nodes,
      promptReferenceCandidates,
      debugRequestModel,
      requestResolution.requestModel,
      selectedAspectRatio.value,
      selectedModel.id,
      selectedModel.expectedDurationMs,
      selectedModel.providerId,
      selectedResolution.value,
      supportedAspectRatioValues,
      t,
      updateNodeData,
      relayoutBatchGroupResultNodes,
      isInAssetBatchGroup,
      batchParentGroup,
    ]);

    useEffect(() => {
      return canvasEventBus.subscribe("image-edit/optimize-prompt", (payload) => {
        if (payload.nodeId !== id) {
          return;
        }

        void handleOptimizePrompt()
          .then((ok) => payload.onSettled?.({ ok, error: ok ? null : null }))
          .catch((error: unknown) => {
            payload.onSettled?.({
              ok: false,
              error: error instanceof Error ? error.message : String(error),
            });
          });
      });
    }, [handleOptimizePrompt, id]);

    useEffect(() => {
      return canvasEventBus.subscribe("image-edit/submit-generate", (payload) => {
        if (payload.nodeId !== id) {
          return;
        }

        void handleGenerate()
          .then((ok) => payload.onSettled?.({ ok, error: ok ? null : null }))
          .catch((error: unknown) => {
            payload.onSettled?.({
              ok: false,
              error: error instanceof Error ? error.message : String(error),
            });
          });
      });
    }, [handleGenerate, id]);

    const insertImageReference = useCallback(
      (imageIndex: number) => {
        if (isPromptLockedByUpstream) {
          return;
        }

        const selectedItem = incomingImageItems[imageIndex];
        if (!selectedItem) {
          return;
        }

        const marker = selectedItem.tokenLabel || buildShortReferenceToken(imageIndex);
        const currentPrompt = promptDraftRef.current;
        const scrollSnapshot = readTextareaScroll(promptRef.current);
        const selection = resolveTextSelection({
          textarea: promptRef.current,
          lastSelection:
            pickerSelectionRef.current ?? lastPromptSelectionRef.current,
          fallbackLength: currentPrompt.length,
          requireFocus: true,
        });
        const cursor = selection.start;
        const { nextText: nextPrompt, nextCursor } = insertReferenceToken(
          currentPrompt,
          cursor,
          marker,
        );

        commitManualPromptDraft(nextPrompt);
        setShowImagePicker(false);
        pickerSelectionRef.current = null;
        setPickerActiveIndex(0);
        schedulePromptSelectionRestore(nextCursor, scrollSnapshot);
      },
      [
        commitManualPromptDraft,
        incomingImageItems,
        isPromptLockedByUpstream,
        schedulePromptSelectionRestore,
      ],
    );

    const openImagePicker = useCallback(
      (textarea: HTMLTextAreaElement) => {
        const selection =
          readTextareaSelection(textarea, promptDraftRef.current.length) ??
          resolveTextSelection({
            textarea,
            lastSelection: lastPromptSelectionRef.current,
            fallbackLength: promptDraftRef.current.length,
          });
        lastPromptSelectionRef.current = selection;
        pickerSelectionRef.current = selection;
        setPickerAnchor(
          resolveTextareaPickerAnchor({
            container: promptPanelRef.current,
            textarea,
            caretIndex: selection.start,
            yOffset: PICKER_Y_OFFSET_PX,
          }),
        );
        setShowImagePicker(true);
        setPickerActiveIndex(0);
      },
      [],
    );

    const handlePromptKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (isPromptLockedByUpstream) {
        if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
          event.preventDefault();
          event.stopPropagation();
          void handleGenerate();
        }
        return;
      }

      if (event.key === "Backspace" || event.key === "Delete") {
        const currentPrompt = promptDraftRef.current;
        const selectionStart =
          event.currentTarget.selectionStart ?? currentPrompt.length;
        const selectionEnd = event.currentTarget.selectionEnd ?? selectionStart;
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
          commitManualPromptDraft(nextText);
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
        isReferencePickerTriggerCharacter(event.key) &&
        incomingImageItems.length > 0
      ) {
        event.preventDefault();
        event.stopPropagation();
        openImagePicker(event.currentTarget);
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
    };

    const handlePromptBeforeInput = useCallback(
      (event: ReactFormEvent<HTMLTextAreaElement>) => {
        if (isPromptLockedByUpstream || incomingImageItems.length <= 0) {
          return;
        }

        const nativeEvent = event.nativeEvent as InputEvent;
        if (!isReferencePickerTriggerCharacter(nativeEvent.data)) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();
        openImagePicker(event.currentTarget);
      },
      [incomingImageItems.length, isPromptLockedByUpstream, openImagePicker],
    );

    const handleModelChange = useCallback(
      (modelId: string) => {
        const nextModel = getImageModel(
          modelId,
          storyboardCompatibleModelConfig,
          storyboardNewApiModelConfig,
          storyboardApi2OkModelConfig,
          storyboardProviderCustomModels,
        );
        const nextExtraParams = {
          ...(data.extraParams ?? {}),
          ...(nextModel.id === GRSAI_NANO_BANANA_PRO_MODEL_ID
            ? { grsai_pro_model: hrsaiNanoBananaProModel }
            : {}),
        };
        const nextResolution = resolveImageModelResolution(
          nextModel,
          data.size,
          {
            extraParams: nextExtraParams,
          },
        );
        const normalizedNextRequestAspectRatio =
          nextModel.id === GRSAI_GPT_IMAGE_2_MODEL_ID
            ? normalizeGrsaiGptImage2AspectRatio(data.requestAspectRatio)
            : data.requestAspectRatio;
        const nextRequestAspectRatio =
          normalizedNextRequestAspectRatio === AUTO_REQUEST_ASPECT_RATIO ||
          nextModel.aspectRatios.some(
            (aspectRatio) =>
              aspectRatio.value === normalizedNextRequestAspectRatio,
          )
            ? (normalizedNextRequestAspectRatio ?? AUTO_REQUEST_ASPECT_RATIO)
            : AUTO_REQUEST_ASPECT_RATIO;

        updateNodeData(id, {
          model: nextModel.id,
          size: nextResolution.value as ImageSize,
          requestAspectRatio: nextRequestAspectRatio,
        });
        setLastImageEditDefaults({
          modelId: nextModel.id,
          size: nextResolution.value as ImageSize,
          requestAspectRatio: nextRequestAspectRatio,
        });
      },
      [
        data.extraParams,
        data.requestAspectRatio,
        data.size,
        hrsaiNanoBananaProModel,
        id,
        setLastImageEditDefaults,
        storyboardCompatibleModelConfig,
        storyboardNewApiModelConfig,
        storyboardApi2OkModelConfig,
        storyboardProviderCustomModels,
        updateNodeData,
      ],
    );

    const handleResolutionChange = useCallback(
      (resolution: string) => {
        const normalizedResolution = resolution as ImageSize;
        updateNodeData(id, { size: normalizedResolution });
        setLastImageEditDefaults({
          modelId: selectedModel.id,
          size: normalizedResolution,
          requestAspectRatio: selectedAspectRatio.value,
        });
      },
      [
        id,
        selectedAspectRatio.value,
        selectedModel.id,
        setLastImageEditDefaults,
        updateNodeData,
      ],
    );

    const canUndoPromptOptimization = Boolean(
      lastPromptOptimizationUndoState &&
      promptDraft === lastPromptOptimizationUndoState.appliedPrompt,
    );

    const promptOptimizationNotice = lastPromptOptimizationMeta
      ? `${t("node.imageEdit.optimizeModelLabel", {
          model: lastPromptOptimizationMeta.modelLabel,
        })} · ${t("node.imageEdit.optimizeReferenceImagesLabel", {
          status:
            lastPromptOptimizationMeta.referenceImageCount > 0
              ? t("node.imageEdit.optimizeReferenceImagesUsed", {
                  count: lastPromptOptimizationMeta.referenceImageCount,
                })
              : t("node.imageEdit.optimizeReferenceImagesUnused"),
        })}`
      : null;
    const promptLockStatusText = isPromptLockedByUpstream
      ? hasNonEmptyConnectedText
        ? t("common.upstreamTextDisconnectHint")
        : t("common.upstreamTextEmpty")
      : null;
    const statusInfoText =
      error ??
      (isOptimizingPrompt ? t("node.imageEdit.optimizingPrompt") : null) ??
      promptOptimizationNotice ??
      promptLockStatusText ??
      t("node.imageEdit.statusHint");
    const showBlockingOverlay = Boolean(
      data.isGenerating || isOptimizingPrompt,
    );
    const showOverviewReferenceThumbnails =
      isOverviewRender && !shouldSuspendMedia;

    const hidePromptReferencePreview = useCallback(() => {
      setPromptReferencePreview(null);
    }, []);

    const handlePromptReferenceTokenHover = useCallback(
      (token: ReferenceTokenMatch, event: ReactMouseEvent<HTMLSpanElement>) => {
        const matchedCandidate = resolvePromptReferenceImageCandidateByToken(
          token.token,
          token.value,
          promptReferenceCandidates,
        );
        const item = matchedCandidate
          ? incomingImageItems[matchedCandidate.referenceNumber - 1]
          : null;
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
          imageUrl: item.referenceUrl,
          displayUrl: item.displayUrl,
          alt: item.label,
          left: previewPosition.left,
          top: previewPosition.top,
        });
      },
      [incomingImageItems, promptReferenceCandidates, zoom],
    );

    const handlePromptReferenceTokenMouseDown = useCallback(
      (tokenEnd: number, event: ReactMouseEvent<HTMLSpanElement>) => {
        event.preventDefault();
        event.stopPropagation();
        schedulePromptSelectionRestore(tokenEnd);
      },
      [schedulePromptSelectionRestore],
    );

    return (
      <div
        ref={rootRef}
        className={`
        group relative flex h-full flex-col overflow-visible rounded-[var(--node-radius)] border bg-surface-dark/90 p-2 transition-all duration-150
        ${
          selected
            ? "border-[#222222] shadow-[0_0_0_2px_rgba(34,34,34,0.38),0_4px_14px_rgba(15,23,42,0.12)] dark:border-white/70 dark:shadow-[0_0_0_2px_rgba(245,245,245,0.2),0_4px_14px_rgba(0,0,0,0.24)]"
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
          rightSlot={headerRightSlot}
          editable
          onTitleChange={(nextTitle) =>
            updateNodeData(id, { displayName: nextTitle })
          }
        />

        <div
          ref={promptPanelRef}
          className="relative min-h-0 flex-1 rounded-lg border border-[rgba(255,255,255,0.1)] bg-bg-dark/45 p-2"
        >
          {isOverviewRender ? (
            <div className="flex h-full min-h-0 flex-col gap-2 overflow-hidden text-xs leading-5 text-text-muted">
              <div className="line-clamp-4 whitespace-pre-wrap break-words">
                {displayedPrompt.trim() ||
                  t("node.imageEdit.promptPlaceholder")}
              </div>
              {showOverviewReferenceThumbnails &&
              incomingImageItems.length > 0 ? (
                <div className="mt-auto flex min-h-0 gap-1 overflow-hidden">
                  {incomingImageItems.slice(0, 4).map((item, index) => (
                    <CanvasNodeImage
                      key={`${item.referenceUrl}-${index}`}
                      src={item.displayUrl}
                      alt={item.label}
                      viewerSourceUrl={item.referenceUrl}
                      viewerImageList={incomingImageViewerList}
                      className="h-10 w-10 shrink-0 rounded object-cover"
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
                className="relative h-full min-h-0"
              >
                <div
                  ref={promptHighlightRef}
                  aria-hidden="true"
                  className="ui-scrollbar pointer-events-none absolute inset-0 overflow-y-auto overflow-x-hidden text-sm leading-6 text-text-dark"
                  style={{ scrollbarGutter: "stable" }}
                >
                  <div className="canvas-textarea-wrap min-h-full px-1 py-0.5">
                    {renderPromptWithHighlights(
                      displayedPrompt,
                      incomingImages.length,
                      namedReferenceTokenCandidates,
                    )}
                  </div>
                </div>

                <div
                  ref={promptHoverLayerRef}
                  aria-hidden="true"
                  className="ui-scrollbar pointer-events-none absolute inset-0 z-20 overflow-y-auto overflow-x-hidden text-sm leading-6 text-transparent"
                  style={{ scrollbarGutter: "stable" }}
                >
                  <div className="canvas-textarea-wrap min-h-full px-1 py-0.5">
                    {renderPromptReferenceHoverTargets(
                      displayedPrompt,
                      incomingImages.length,
                      namedReferenceTokenCandidates,
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
                    const nextValue = event.target.value;
                    commitManualPromptDraft(nextValue);
                    rememberPromptSelection(event.currentTarget);
                  }}
                  onBeforeInput={handlePromptBeforeInput}
                  onKeyDownCapture={handlePromptKeyDown}
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
                  placeholder={t("node.imageEdit.promptPlaceholder")}
                  className={`canvas-textarea-wrap canvas-textarea-mirror-input ui-scrollbar nodrag nowheel relative z-10 h-full w-full resize-none overflow-y-auto overflow-x-hidden border-none bg-transparent px-1 py-0.5 text-sm leading-6 text-transparent outline-none placeholder:text-text-muted/80 selection:bg-accent/30 selection:text-transparent ${
                    isPromptLockedByUpstream
                      ? "cursor-default caret-transparent"
                      : "caret-text-dark focus:border-transparent"
                  }`}
                  style={{ scrollbarGutter: "stable" }}
                  spellCheck={false}
                />

                {isPromptLockedByUpstream ? (
                  <UpstreamPromptLockOverlay
                    empty={!hasNonEmptyConnectedText}
                    className="rounded-lg"
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
                      viewerSourceUrl={promptReferencePreview.imageUrl}
                      viewerImageList={incomingImageViewerList}
                      className="block max-h-[132px] max-w-[144px] rounded-xl object-contain"
                      draggable={false}
                    />
                  </div>
                ) : null}
              </div>

              {showImagePicker && incomingImageItems.length > 0 && (
                <div
                  className="nowheel absolute z-30 w-[156px] overflow-hidden rounded-xl border border-[rgba(255,255,255,0.16)] bg-surface-dark shadow-xl"
                  style={{ left: pickerAnchor.left, top: pickerAnchor.top }}
                  onMouseDown={(event) => event.stopPropagation()}
                  onWheelCapture={(event) => event.stopPropagation()}
                >
                  <div
                    className="ui-scrollbar nowheel max-h-[180px] overflow-y-auto"
                    onWheelCapture={(event) => event.stopPropagation()}
                    role="listbox"
                  >
                    {incomingImageItems.map((item, index) => (
                      <button
                        key={`${item.referenceUrl}-${index}`}
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
                          viewerSourceUrl={item.referenceUrl}
                          viewerImageList={incomingImageViewerList}
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
            </>
          )}
        </div>

        {!isOverviewRender ? (
          <div className="mt-2 flex shrink-0 items-center gap-2">
            <div className="ui-scrollbar min-w-0 flex-1 overflow-x-auto overflow-y-hidden">
              <div className="flex w-max min-w-full items-center gap-1">
                <ModelParamsControls
                  imageModels={imageModels}
                  selectedModel={selectedModel}
                  resolutionOptions={resolutionOptions}
                  selectedResolution={selectedResolution}
                  selectedAspectRatio={selectedAspectRatio}
                  aspectRatioOptions={aspectRatioOptions}
                  onModelChange={handleModelChange}
                  onResolutionChange={handleResolutionChange}
                  onAspectRatioChange={(aspectRatio) => {
                    updateNodeData(id, { requestAspectRatio: aspectRatio });
                    setLastImageEditDefaults({
                      modelId: selectedModel.id,
                      size: selectedResolution.value as ImageSize,
                      requestAspectRatio: aspectRatio,
                    });
                  }}
                  extraParams={resolvedModelExtraParams}
                  onExtraParamChange={(key, value) => {
                    updateNodeData(id, {
                      extraParams: {
                        ...(data.extraParams ?? {}),
                        [key]: value,
                      },
                    });
                    setLastImageGenerationExtraParams({ [key]: value });
                  }}
                  onStyleTemplateApply={(template) => {
                    if (isPromptLockedByUpstream) {
                      return;
                    }
                    updateNodeData(id, {
                      selectedStyleTemplateId: template.id,
                      selectedStyleTemplateName: template.name,
                      selectedStyleTemplatePrompt: template.prompt,
                    });
                    const nextPrompt = appendStyleTemplatePrompt(
                      promptDraftRef.current,
                      template.prompt,
                    );
                    setPromptDraft(nextPrompt);
                    commitPromptDraft(nextPrompt);
                    setLastPromptOptimizationUndoState(null);
                  }}
                  selectedStyleTemplateName={data.selectedStyleTemplateName ?? null}
                  triggerSize="sm"
                  chipClassName={NODE_CONTROL_CHIP_CLASS}
                  modelChipClassName={NODE_CONTROL_MODEL_CHIP_CLASS}
                  paramsChipClassName={NODE_CONTROL_PARAMS_CHIP_CLASS}
                  styleTemplateTriggerMode="icon"
                  styleTemplateDisabled={
                    isPromptLockedByUpstream || isBatchGroupOverrideActive
                  }
                  modelSelectionDisabled={isBatchGroupOverrideActive}
                  paramsSelectionDisabled={isBatchGroupOverrideActive}
                  modelSelectionLockedByGroup={isBatchGroupOverrideActive}
                  paramsSelectionLockedByGroup={isBatchGroupOverrideActive}
                  styleTemplateLockedByGroup={isBatchGroupOverrideActive}
                  afterStyleTemplateSlot={
                    <Fragment>
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
                            isCameraParamsApplied
                              ? "text-emerald-300"
                              : "text-text-dark"
                          }`}
                        />
                      </UiChipButton>
                      <UiChipButton
                        type="button"
                        active={isOptimizingPrompt}
                        disabled={
                          isPromptLockedByUpstream ||
                          isOptimizingPrompt ||
                          promptDraft.trim().length === 0 ||
                          isPromptOptimizationControlledByGroup
                        }
                        className={`${NODE_CONTROL_CHIP_CLASS} !w-8 !px-0 shrink-0 justify-center`}
                        aria-label={
                          isOptimizingPrompt
                            ? t("node.imageEdit.optimizingPrompt")
                            : t("node.imageEdit.optimizePrompt")
                        }
                        title={
                          isOptimizingPrompt
                            ? t("node.imageEdit.optimizingPrompt")
                            : t("node.imageEdit.optimizePrompt")
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
                          isPromptLockedByUpstream ||
                          isOptimizingPrompt ||
                          !canUndoPromptOptimization ||
                          isPromptOptimizationControlledByGroup
                        }
                        className={`${NODE_CONTROL_CHIP_CLASS} !w-8 !px-0 shrink-0 justify-center`}
                        aria-label={t("node.imageEdit.undoOptimizedPrompt")}
                        title={t("node.imageEdit.undoOptimizedPrompt")}
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
                    </Fragment>
                  }
                />
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-1">
              <div className="shrink-0">
                <UiButton
                  onClick={(event) => {
                    event.stopPropagation();
                    void handleGenerate();
                  }}
                  variant="primary"
                  className={NODE_CONTROL_PRIMARY_BUTTON_CLASS}
                >
                  <Sparkles
                    className={NODE_CONTROL_GENERATE_ICON_CLASS}
                    strokeWidth={2.5}
                  />
                  {t("canvas.generate")}
                </UiButton>
              </div>
            </div>
          </div>
        ) : null}
        <div
          className={`mt-1 min-h-[18px] text-[10px] leading-4 ${
            error ? "text-red-200" : "text-text-muted"
          }`}
          title={statusInfoText}
        >
          {statusInfoText}
        </div>
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
          minWidth={IMAGE_EDIT_NODE_MIN_WIDTH}
          minHeight={IMAGE_EDIT_NODE_MIN_HEIGHT}
          maxWidth={IMAGE_EDIT_NODE_MAX_WIDTH}
          maxHeight={IMAGE_EDIT_NODE_MAX_HEIGHT}
          isVisible={selected}
        />
        <UiLoadingOverlay
          visible={showBlockingOverlay}
          insetClassName="inset-3"
          backdropClassName="bg-transparent"
          variant="bare"
        />

        <CameraParamsDialog
          isOpen={!isOverviewRender && showCameraParamsDialog}
          value={resolvedCameraParams}
          onApply={(nextValue) =>
            updateNodeData(id, { cameraParams: nextValue })
          }
          onClose={() => setShowCameraParamsDialog(false)}
        />
      </div>
    );
  },
);

ImageEditNode.displayName = "ImageEditNode";
