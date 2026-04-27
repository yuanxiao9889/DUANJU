import {
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
} from 'react';
import { Handle, Position, useUpdateNodeInternals, type NodeProps } from '@xyflow/react';
import { AlertTriangle, Loader2, Sparkles, Undo2, Wand2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { UiLoadingOverlay } from '@/components/ui';
import {
  AUTO_REQUEST_ASPECT_RATIO,
  CANVAS_NODE_TYPES,
  EXPORT_RESULT_NODE_MIN_HEIGHT,
  EXPORT_RESULT_NODE_MIN_WIDTH,
  IMAGE_EDIT_NODE_DEFAULT_HEIGHT,
  IMAGE_EDIT_NODE_DEFAULT_WIDTH,
  type ExportImageGenerationSummary,
  type ImageEditNodeData,
  type ImageSize,
} from '@/features/canvas/domain/canvasNodes';
import { resolveNodeDisplayName } from '@/features/canvas/domain/nodeDisplay';
import { NodeHeader, NODE_HEADER_FLOATING_POSITION_CLASS } from '@/features/canvas/ui/NodeHeader';
import { NodeResizeHandle } from '@/features/canvas/ui/NodeResizeHandle';
import {
  canvasAiGateway,
} from '@/features/canvas/application/canvasServices';
import { resolveErrorContent, showErrorDialog } from '@/features/canvas/application/errorDialog';
import {
  detectAspectRatio,
  parseAspectRatio,
  resolveImageDisplayUrl,
  resolveReadableImageSource,
} from '@/features/canvas/application/imageData';
import { optimizeCanvasPrompt } from '@/features/canvas/application/promptOptimization';
import {
  buildSequentialPromptReferenceImageCandidates,
  resolvePromptReferenceImageBindings,
} from '@/features/canvas/application/promptReferenceImageBindings';
import { resolveMinEdgeFittedSize } from '@/features/canvas/application/imageNodeSizing';
import { appendCameraParamsToPrompt } from '@/features/canvas/camera/cameraPrompt';
import {
  hasCameraParamsSelection,
  normalizeCameraParamsSelection,
  resolveCameraParamsSummary,
} from '@/features/canvas/camera/cameraPresets';
import {
  buildGenerationErrorReport,
  CURRENT_RUNTIME_SESSION_ID,
  createReferenceImagePlaceholders,
  getRuntimeDiagnostics,
  type GenerationDebugContext,
} from '@/features/canvas/application/generationErrorReport';
import {
  buildReferenceAwareGenerationPrompt,
  normalizeReferenceImagePrompt,
} from '@/features/canvas/application/referenceImagePrompting';
import {
  areReferenceImageOrdersEqual,
  buildShortReferenceToken,
  findReferenceTokens,
  insertReferenceToken,
  remapReferenceTokensByImageOrder,
  removeTextRange,
  resolveReferenceAwareDeleteRange,
} from '@/features/canvas/application/referenceTokenEditing';
import {
  DEFAULT_PICKER_ANCHOR,
  type PickerAnchor,
  readTextareaSelection,
  resolveTextSelection,
  resolveTextareaPickerAnchor,
  restoreTextareaSelection,
  type TextSelectionRange,
} from '@/features/canvas/application/textareaSelection';
import {
  DEFAULT_IMAGE_MODEL_ID,
  getImageModel,
  isStoryboardApi2OkModelId,
  isStoryboardCompatibleModelId,
  isStoryboardNewApiModelId,
  isStoryboardOopiiModelId,
  listImageModels,
  resolveStoryboardApi2OkModelConfigForModel,
  resolveImageModelResolution,
  resolveImageModelResolutions,
  resolveStoryboardCompatibleModelConfigForModel,
  resolveStoryboardNewApiModelConfigForModel,
  resolveStoryboardOopiiModelConfigForModel,
  toStoryboardApi2OkExtraParamsPayload,
  toStoryboardCompatibleExtraParamsPayload,
  toStoryboardNewApiExtraParamsPayload,
} from '@/features/canvas/models';
import { GRSAI_NANO_BANANA_PRO_MODEL_ID } from '@/features/canvas/models/image/grsai/nanoBananaPro';

import { resolveModelPriceDisplay } from '@/features/canvas/pricing';
import { resolveScriptAssetOptimizedPromptMaxLength } from '@/features/canvas/application/scriptAssetReferencePromptLimit';
import {
  useCanvasConnectedReferenceVisuals,
  useCanvasIncomingSourceNodes,
} from '@/features/canvas/hooks/useCanvasNodeGraph';
import {
  NODE_CONTROL_CHIP_CLASS,
  NODE_CONTROL_MODEL_CHIP_CLASS,
  NODE_CONTROL_PARAMS_CHIP_CLASS,
  NODE_CONTROL_PRIMARY_BUTTON_CLASS,
  NODE_CONTROL_GENERATE_ICON_CLASS,
} from '@/features/canvas/ui/nodeControlStyles';
import { CameraParamsDialog } from '@/features/canvas/ui/CameraParamsDialog';
import { CameraTriggerIcon } from '@/features/canvas/ui/CameraTriggerIcon';
import { ModelParamsControls } from '@/features/canvas/ui/ModelParamsControls';
import { appendStyleTemplatePrompt } from '@/features/project/styleTemplatePrompt';
import { CanvasNodeImage } from '@/features/canvas/ui/CanvasNodeImage';
import { NodePriceBadge } from '@/features/canvas/ui/NodePriceBadge';
import { NodeStatusBadge } from '@/features/canvas/ui/NodeStatusBadge';
import { UiButton, UiChipButton } from '@/components/ui';
import { useCanvasStore } from '@/stores/canvasStore';
import { useSettingsStore } from '@/stores/settingsStore';

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
}

const PICKER_Y_OFFSET_PX = 20;
const IMAGE_EDIT_NODE_MIN_WIDTH = 480;
const IMAGE_EDIT_NODE_MIN_HEIGHT = 180;
const IMAGE_EDIT_NODE_MAX_WIDTH = 1400;
const IMAGE_EDIT_NODE_MAX_HEIGHT = 1000;

function renderPromptWithHighlights(prompt: string, maxImageCount: number): ReactNode {
  if (!prompt) {
    return ' ';
  }

  const segments: ReactNode[] = [];
  let lastIndex = 0;
  const referenceTokens = findReferenceTokens(prompt, maxImageCount);
  for (const token of referenceTokens) {
    const matchStart = token.start;
    const matchText = token.token;

    if (matchStart > lastIndex) {
      segments.push(
        <span key={`plain-${lastIndex}`}>{prompt.slice(lastIndex, matchStart)}</span>
      );
    }

    segments.push(
      <span
        key={`ref-${matchStart}`}
        className="relative z-0 text-white [text-shadow:0.24px_0_currentColor,-0.24px_0_currentColor] before:absolute before:-inset-x-[4px] before:-inset-y-[1px] before:-z-10 before:rounded-[7px] before:bg-accent/55 before:content-['']"
      >
        {matchText}
      </span>
    );

    lastIndex = matchStart + matchText.length;
  }

  if (lastIndex < prompt.length) {
    segments.push(<span key={`plain-${lastIndex}`}>{prompt.slice(lastIndex)}</span>);
  }

  return segments;
}

function renderPromptReferenceHoverTargets(
  prompt: string,
  maxImageCount: number,
  onTokenHover: (token: number, event: ReactMouseEvent<HTMLSpanElement>) => void,
  onTokenLeave: () => void,
  onTokenMouseDown: (tokenEnd: number, event: ReactMouseEvent<HTMLSpanElement>) => void
): ReactNode {
  if (!prompt) {
    return ' ';
  }

  const segments: ReactNode[] = [];
  let lastIndex = 0;
  const referenceTokens = findReferenceTokens(prompt, maxImageCount);
  for (const token of referenceTokens) {
    const matchStart = token.start;

    if (matchStart > lastIndex) {
      segments.push(
        <span key={`hover-plain-${lastIndex}`} className="text-transparent">
          {prompt.slice(lastIndex, matchStart)}
        </span>
      );
    }

    segments.push(
      <span
        key={`hover-ref-${matchStart}`}
        className="pointer-events-auto cursor-help select-none text-transparent"
        onMouseEnter={(event) => onTokenHover(token.value - 1, event)}
        onMouseMove={(event) => onTokenHover(token.value - 1, event)}
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

function resolveOptimizationReferenceImages(prompt: string, imageUrls: string[]): string[] {
  if (imageUrls.length === 0) {
    return [];
  }

  const referencedImageIndexes = [...new Set(
    findReferenceTokens(prompt, imageUrls.length)
      .map((token) => token.value - 1)
      .filter((index) => index >= 0 && index < imageUrls.length)
  )];

  if (referencedImageIndexes.length === 0) {
    return [];
  }

  return referencedImageIndexes
    .map((index) => imageUrls[index])
    .filter((imageUrl): imageUrl is string => typeof imageUrl === 'string' && imageUrl.trim().length > 0);
}

function pickClosestAspectRatio(
  targetRatio: number,
  supportedAspectRatios: string[]
): string {
  const supported = supportedAspectRatios.length > 0 ? supportedAspectRatios : ['1:1'];
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

export const ImageEditNode = memo(({ id, data, selected, width, height }: ImageEditNodeProps) => {
  const { t, i18n } = useTranslation();
  const updateNodeInternals = useUpdateNodeInternals();
  const [error, setError] = useState<string | null>(null);
  const [isOptimizingPrompt, setIsOptimizingPrompt] = useState(false);
  const [lastPromptOptimizationMeta, setLastPromptOptimizationMeta] =
    useState<PromptOptimizationMeta | null>(null);
  const [lastPromptOptimizationUndoState, setLastPromptOptimizationUndoState] =
    useState<PromptOptimizationUndoState | null>(null);

  const rootRef = useRef<HTMLDivElement>(null);
  const promptPanelRef = useRef<HTMLDivElement>(null);
  const promptPreviewHostRef = useRef<HTMLDivElement>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const promptHighlightRef = useRef<HTMLDivElement>(null);
  const promptHoverLayerRef = useRef<HTMLDivElement>(null);
  const pickerItemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [promptDraft, setPromptDraft] = useState(() => data.prompt ?? '');
  const promptDraftRef = useRef(promptDraft);
  const lastPromptSelectionRef = useRef<TextSelectionRange | null>(null);
  const pickerSelectionRef = useRef<TextSelectionRange | null>(null);
  const previousIncomingImagesRef = useRef<string[] | null>(null);
  const [showCameraParamsDialog, setShowCameraParamsDialog] = useState(false);
  const [showImagePicker, setShowImagePicker] = useState(false);
  const [pickerActiveIndex, setPickerActiveIndex] = useState(0);
  const [pickerAnchor, setPickerAnchor] = useState<PickerAnchor>(DEFAULT_PICKER_ANCHOR);
  const [promptReferencePreview, setPromptReferencePreview] =
    useState<PromptReferencePreviewState | null>(null);
  const [, setIsPromptTextSelectionActive] = useState(false);

  const setSelectedNode = useCanvasStore((state) => state.setSelectedNode);
  const updateNodeData = useCanvasStore((state) => state.updateNodeData);
  const addNode = useCanvasStore((state) => state.addNode);
  const findNodePosition = useCanvasStore((state) => state.findNodePosition);
  const addEdge = useCanvasStore((state) => state.addEdge);
  const storyboardApiKeys = useSettingsStore((state) => state.storyboardApiKeys);
  const hrsaiNanoBananaProModel = useSettingsStore((state) => state.hrsaiNanoBananaProModel);
  const storyboardCompatibleModelConfig = useSettingsStore(
    (state) => state.storyboardCompatibleModelConfig
  );
  const storyboardApi2OkModelConfig = useSettingsStore(
    (state) => state.storyboardApi2OkModelConfig
  );
  const storyboardNewApiModelConfig = useSettingsStore(
    (state) => state.storyboardNewApiModelConfig
  );
  const storyboardProviderCustomModels = useSettingsStore(
    (state) => state.storyboardProviderCustomModels
  );
  const setLastImageEditDefaults = useSettingsStore((state) => state.setLastImageEditDefaults);
  const showNodePrice = useSettingsStore((state) => state.showNodePrice);
  const priceDisplayCurrencyMode = useSettingsStore((state) => state.priceDisplayCurrencyMode);
  const usdToCnyRate = useSettingsStore((state) => state.usdToCnyRate);
  const preferDiscountedPrice = useSettingsStore((state) => state.preferDiscountedPrice);
  const grsaiCreditTierId = useSettingsStore((state) => state.grsaiCreditTierId);

  const connectedReferenceVisuals = useCanvasConnectedReferenceVisuals(id);
  const incomingSourceNodes = useCanvasIncomingSourceNodes(id);

  const imageModels = useMemo(
    () => listImageModels(
      storyboardCompatibleModelConfig,
      storyboardNewApiModelConfig,
      storyboardApi2OkModelConfig,
      storyboardProviderCustomModels
    ),
    [
      storyboardCompatibleModelConfig,
      storyboardNewApiModelConfig,
      storyboardApi2OkModelConfig,
      storyboardProviderCustomModels,
    ]
  );

  const selectedModel = useMemo(() => {
    const modelId = data.model ?? DEFAULT_IMAGE_MODEL_ID;
    return getImageModel(
      modelId,
      storyboardCompatibleModelConfig,
      storyboardNewApiModelConfig,
      storyboardApi2OkModelConfig,
      storyboardProviderCustomModels
    );
  }, [
    data.model,
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
          storyboardProviderCustomModels
        )
        : storyboardCompatibleModelConfig,
    [
      selectedModel.id,
      storyboardCompatibleModelConfig,
      storyboardProviderCustomModels,
    ]
  );
  const resolvedNewApiModelConfig = useMemo(
    () =>
      isStoryboardNewApiModelId(selectedModel.id)
        ? resolveStoryboardNewApiModelConfigForModel(
          selectedModel.id,
          storyboardNewApiModelConfig,
          storyboardProviderCustomModels
        )
        : storyboardNewApiModelConfig,
    [
      selectedModel.id,
      storyboardNewApiModelConfig,
      storyboardProviderCustomModels,
    ]
  );
  const resolvedApi2OkModelConfig = useMemo(
    () =>
      isStoryboardApi2OkModelId(selectedModel.id)
        ? resolveStoryboardApi2OkModelConfigForModel(
          selectedModel.id,
          storyboardApi2OkModelConfig,
          storyboardProviderCustomModels
        )
        : storyboardApi2OkModelConfig,
    [
      selectedModel.id,
      storyboardApi2OkModelConfig,
      storyboardProviderCustomModels,
    ]
  );
  const requestedOopiiResolution = useMemo(
    () =>
      isStoryboardOopiiModelId(selectedModel.id)
        ? resolveImageModelResolution(selectedModel, data.size, {
          extraParams: data.extraParams,
        }).value
        : null,
    [data.extraParams, data.size, selectedModel]
  );
  const resolvedOopiiModelConfig = useMemo(
    () =>
      isStoryboardOopiiModelId(selectedModel.id)
        ? resolveStoryboardOopiiModelConfigForModel(
          selectedModel.id,
          storyboardProviderCustomModels,
          {
            resolution: requestedOopiiResolution,
            extraParams: data.extraParams,
          }
        )
        : resolveStoryboardOopiiModelConfigForModel(null, storyboardProviderCustomModels),
    [
      data.extraParams,
      requestedOopiiResolution,
      selectedModel.id,
      storyboardProviderCustomModels,
    ]
  );
  const incomingImageItems = useMemo<IncomingReferenceImageItem[]>(
    () =>
      connectedReferenceVisuals
        .filter((item) => item.kind === 'image')
        .map((item, index) => {
          const referenceUrl = item.referenceUrl.trim();
          if (!referenceUrl) {
            return null;
          }

          const previewImageUrl = item.previewImageUrl?.trim() || referenceUrl;
          return {
            referenceUrl,
            requestImageUrl: referenceUrl,
            previewImageUrl,
            displayUrl: resolveImageDisplayUrl(previewImageUrl),
            tokenLabel: buildShortReferenceToken(index),
            label: t('node.imageEdit.referenceImageLabel', { index: index + 1 }),
          };
        })
        .filter((item): item is IncomingReferenceImageItem => Boolean(item)),
    [connectedReferenceVisuals, t]
  );
  const incomingImages = useMemo(
    () => incomingImageItems.map((item) => item.referenceUrl),
    [incomingImageItems]
  );
  const incomingImageViewerList = useMemo(
    () => incomingImageItems.map((item) => resolveImageDisplayUrl(item.referenceUrl)),
    [incomingImageItems]
  );
  const optimizedPromptMaxLength = useMemo(
    () => resolveScriptAssetOptimizedPromptMaxLength(
      incomingSourceNodes.map((item) => item.node)
    ),
    [incomingSourceNodes]
  );
  const providerApiKey = storyboardApiKeys[selectedModel.providerId] ?? '';
  const effectiveExtraParams = useMemo(
    () => ({
      ...(data.extraParams ?? {}),
      ...(selectedModel.id === GRSAI_NANO_BANANA_PRO_MODEL_ID
        ? { grsai_pro_model: hrsaiNanoBananaProModel }
        : {}),
      ...(isStoryboardCompatibleModelId(selectedModel.id)
        ? {
          compatible_config: toStoryboardCompatibleExtraParamsPayload(
            resolvedCompatibleModelConfig
          ),
        }
        : isStoryboardOopiiModelId(selectedModel.id)
          ? {
            newapi_config: toStoryboardNewApiExtraParamsPayload(
              resolvedOopiiModelConfig
            ),
          }
        : isStoryboardNewApiModelId(selectedModel.id)
          ? {
            newapi_config: toStoryboardNewApiExtraParamsPayload(
              resolvedNewApiModelConfig
            ),
          }
        : isStoryboardApi2OkModelId(selectedModel.id)
          ? {
            api2ok_config: toStoryboardApi2OkExtraParamsPayload(
              resolvedApi2OkModelConfig
            ),
          }
        : {}),
    }),
    [
      data.extraParams,
      hrsaiNanoBananaProModel,
      resolvedOopiiModelConfig,
      resolvedApi2OkModelConfig,
      resolvedCompatibleModelConfig,
      resolvedNewApiModelConfig,
      selectedModel.id,
    ]
  );
  const resolutionOptions = useMemo(
    () => resolveImageModelResolutions(selectedModel, { extraParams: effectiveExtraParams }),
    [effectiveExtraParams, selectedModel]
  );

  const selectedResolution = useMemo(
    () => resolveImageModelResolution(selectedModel, data.size, { extraParams: effectiveExtraParams }),
    [data.size, effectiveExtraParams, selectedModel]
  );

  const aspectRatioOptions = useMemo<AspectRatioChoice[]>(
    () => [{
      value: AUTO_REQUEST_ASPECT_RATIO,
      label: t('modelParams.autoAspectRatio'),
    }, ...selectedModel.aspectRatios],
    [selectedModel.aspectRatios, t]
  );

  const selectedAspectRatio = useMemo(
    () =>
      aspectRatioOptions.find((item) => item.value === data.requestAspectRatio) ??
      aspectRatioOptions[0],
    [aspectRatioOptions, data.requestAspectRatio]
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
    ]
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
    ]
  );
  const resolvedPriceTooltip = useMemo(() => {
    if (!resolvedPriceDisplay) {
      return undefined;
    }

    const lines = [resolvedPriceDisplay.label];
    if (resolvedPriceDisplay.nativeLabel) {
      lines.push(t('pricing.nativePrice', { value: resolvedPriceDisplay.nativeLabel }));
    }
    if (resolvedPriceDisplay.originalLabel) {
      lines.push(t('pricing.originalPrice', { value: resolvedPriceDisplay.originalLabel }));
    }
    if (resolvedPriceDisplay.pointsCost) {
      lines.push(t('pricing.pointsCost', { count: resolvedPriceDisplay.pointsCost }));
    }
    if (resolvedPriceDisplay.grsaiCreditTier) {
      lines.push(
        t('pricing.grsaiTier', {
          price: resolvedPriceDisplay.grsaiCreditTier.priceCny.toFixed(2),
          credits: resolvedPriceDisplay.grsaiCreditTier.credits.toLocaleString(
            i18n.language.startsWith('zh') ? 'zh-CN' : 'en-US'
          ),
        })
      );
    }
    return lines.join('\n');
  }, [i18n.language, resolvedPriceDisplay, t]);

  const supportedAspectRatioValues = useMemo(
    () => selectedModel.aspectRatios.map((item) => item.value),
    [selectedModel.aspectRatios]
  );

  const resolvedTitle = useMemo(
    () => resolveNodeDisplayName(CANVAS_NODE_TYPES.imageEdit, data),
    [data]
  );
  const resolvedCameraParams = useMemo(
    () => normalizeCameraParamsSelection(data.cameraParams),
    [data.cameraParams]
  );
  const isCameraParamsApplied = hasCameraParamsSelection(resolvedCameraParams);
  const cameraParamsButtonTitle = isCameraParamsApplied
    ? resolveCameraParamsSummary(resolvedCameraParams)
    : t('cameraParams.trigger');
  const cameraParamsButtonClassName = isCameraParamsApplied
    ? `${NODE_CONTROL_CHIP_CLASS} !w-8 !border-emerald-400/55 !bg-emerald-500/14 !px-0 !text-emerald-300 shadow-[0_0_0_1px_rgba(52,211,153,0.12)] hover:!bg-emerald-500/20 shrink-0 justify-center`
    : `${NODE_CONTROL_CHIP_CLASS} !w-8 !px-0 shrink-0 justify-center`;
  const headerStatus = useMemo(() => {
    if (isOptimizingPrompt) {
      return (
        <NodeStatusBadge
          icon={<Loader2 className="h-3 w-3" />}
          label={t('node.imageEdit.optimizingPrompt')}
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
        label={t('nodeStatus.error')}
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

  const resolvedWidth = Math.max(IMAGE_EDIT_NODE_MIN_WIDTH, Math.round(width ?? IMAGE_EDIT_NODE_DEFAULT_WIDTH));
  const resolvedHeight = Math.max(IMAGE_EDIT_NODE_MIN_HEIGHT, Math.round(height ?? IMAGE_EDIT_NODE_DEFAULT_HEIGHT));

  useEffect(() => {
    updateNodeInternals(id);
  }, [id, resolvedHeight, resolvedWidth, updateNodeInternals]);

  useEffect(() => {
    const externalPrompt = data.prompt ?? '';
    if (externalPrompt !== promptDraftRef.current) {
      promptDraftRef.current = externalPrompt;
      setPromptDraft(externalPrompt);
      setLastPromptOptimizationMeta(null);
      setLastPromptOptimizationUndoState(null);
    }
  }, [data.prompt]);

  const commitPromptDraft = useCallback((nextPrompt: string) => {
    promptDraftRef.current = nextPrompt;
    updateNodeData(id, { prompt: nextPrompt });
  }, [id, updateNodeData]);

  const commitManualPromptDraft = useCallback((nextPrompt: string) => {
    setPromptDraft(nextPrompt);
    commitPromptDraft(nextPrompt);
    setLastPromptOptimizationMeta(null);
    setLastPromptOptimizationUndoState(null);
  }, [commitPromptDraft]);

  useEffect(() => {
    const previousIncomingImages = previousIncomingImagesRef.current;
    if (!previousIncomingImages) {
      previousIncomingImagesRef.current = incomingImages;
      return;
    }

    if (areReferenceImageOrdersEqual(previousIncomingImages, incomingImages)) {
      return;
    }

    previousIncomingImagesRef.current = incomingImages;
    const nextPrompt = remapReferenceTokensByImageOrder(
      promptDraftRef.current,
      previousIncomingImages,
      incomingImages
    );
    if (nextPrompt === promptDraftRef.current) {
      return;
    }

    setPromptDraft(nextPrompt);
    commitPromptDraft(nextPrompt);
  }, [commitPromptDraft, incomingImages]);

  useEffect(() => {
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

    setPickerActiveIndex((previous) => Math.min(previous, incomingImages.length - 1));
  }, [incomingImages.length]);

  useEffect(() => {
    setPromptReferencePreview(null);
  }, [incomingImages, promptDraft]);

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
      pickerSelectionRef.current = null;
    };

    document.addEventListener('mousedown', handleOutside, true);
    return () => {
      document.removeEventListener('mousedown', handleOutside, true);
    };
  }, []);

  const syncPromptTextSelectionState = useCallback((_target?: HTMLTextAreaElement | null) => {
    setIsPromptTextSelectionActive(false);
    setPromptReferencePreview(null);
  }, []);

  const rememberPromptSelection = useCallback((textarea: HTMLTextAreaElement | null) => {
    lastPromptSelectionRef.current = readTextareaSelection(
      textarea,
      textarea?.value.length ?? promptDraftRef.current.length
    );
    syncPromptTextSelectionState(textarea);
  }, [syncPromptTextSelectionState]);

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

  const schedulePromptSelectionRestore = useCallback((selection: TextSelectionRange | number) => {
    requestAnimationFrame(() => {
      restoreTextareaSelection(
        promptRef.current,
        selection,
        promptDraftRef.current.length,
        {
          syncScroll: syncPromptHighlightScroll,
          onAfterRestore: (textarea, nextSelection) => {
            lastPromptSelectionRef.current = nextSelection;
            syncPromptTextSelectionState(textarea);
          },
        }
      );
    });
  }, [syncPromptHighlightScroll, syncPromptTextSelectionState]);

  const handleOptimizePrompt = useCallback(async () => {
    const sourcePrompt = promptDraftRef.current;
    const currentPrompt = sourcePrompt.trim();
    if (!currentPrompt) {
      const errorMessage = t('node.imageEdit.promptRequired');
      setError(errorMessage);
      void showErrorDialog(errorMessage, t('common.error'));
      return;
    }

    setIsOptimizingPrompt(true);
    setError(null);

    try {
      const resolvedRequestReferenceImages = await Promise.all(
        incomingImageItems.map(async (item) =>
          await resolveReadableImageSource(item.requestImageUrl, item.previewImageUrl)
        )
      );
      const optimizationReferenceImages = resolveOptimizationReferenceImages(
        currentPrompt,
        resolvedRequestReferenceImages
      );
      const optimizationReferenceImageBindings = resolvePromptReferenceImageBindings(
        currentPrompt,
        buildSequentialPromptReferenceImageCandidates(resolvedRequestReferenceImages)
      );
      const result = await optimizeCanvasPrompt({
        mode: 'image',
        prompt: currentPrompt,
        referenceImages: optimizationReferenceImages,
        referenceImageBindings: optimizationReferenceImageBindings,
        maxPromptLength: optimizedPromptMaxLength,
      });
      if (promptDraftRef.current !== sourcePrompt) {
        return;
      }
      const nextPrompt = result.prompt;
      setLastPromptOptimizationMeta({
        modelLabel: [result.context.provider, result.context.model].filter(Boolean).join(' / '),
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
    } catch (optimizationError) {
      const errorMessage =
        optimizationError instanceof Error && optimizationError.message.trim().length > 0
          ? optimizationError.message
          : t('node.imageEdit.optimizePromptFailed');
      setError(errorMessage);
      void showErrorDialog(errorMessage, t('common.error'));
    } finally {
      setIsOptimizingPrompt(false);
    }
  }, [commitPromptDraft, incomingImageItems, optimizedPromptMaxLength, schedulePromptSelectionRestore, t]);

  const handleUndoOptimizedPrompt = useCallback(() => {
    if (!lastPromptOptimizationUndoState) {
      return;
    }

    if (promptDraftRef.current !== lastPromptOptimizationUndoState.appliedPrompt) {
      return;
    }

    const restoredPrompt = lastPromptOptimizationUndoState.previousPrompt;
    setLastPromptOptimizationUndoState(null);
    setLastPromptOptimizationMeta(null);
    setPromptDraft(restoredPrompt);
    commitPromptDraft(restoredPrompt);
    schedulePromptSelectionRestore(restoredPrompt.length);
  }, [commitPromptDraft, lastPromptOptimizationUndoState, schedulePromptSelectionRestore]);

  const handleGenerate = useCallback(async () => {
    const displayPrompt = normalizeReferenceImagePrompt(promptDraft).trim();
    if (!displayPrompt) {
      const errorMessage = t('node.imageEdit.promptRequired');
      setError(errorMessage);
      void showErrorDialog(errorMessage, t('common.error'));
      return;
    }

    if (!providerApiKey) {
      const errorMessage = t('node.imageEdit.apiKeyRequired');
      setError(errorMessage);
      void showErrorDialog(errorMessage, t('common.error'));
      return;
    }

    const generationDurationMs = selectedModel.expectedDurationMs ?? 60000;
    const generationStartedAt = Date.now();
    const resultNodeTitle = buildAiResultNodeTitle(
      displayPrompt,
      t('node.imageEdit.resultTitle')
    );
    setError(null);
    const runtimeDiagnosticsPromise = getRuntimeDiagnostics();
    const resolvedRequestReferenceImagesPromise = Promise.all(
      incomingImageItems.map(async (item) =>
        await resolveReadableImageSource(item.requestImageUrl, item.previewImageUrl)
      )
    );
    const initialRequestAspectRatio =
      selectedAspectRatio.value === AUTO_REQUEST_ASPECT_RATIO
        ? pickClosestAspectRatio(1, supportedAspectRatioValues)
        : selectedAspectRatio.value;
    const submittedPrompt = appendCameraParamsToPrompt(
      buildReferenceAwareGenerationPrompt(
        promptDraft,
        incomingImages.length
      ),
      resolvedCameraParams
    );
    const generationSummary: ExportImageGenerationSummary = {
      sourceType: 'imageEdit',
      providerId: selectedModel.providerId,
      requestModel: debugRequestModel,
      prompt: submittedPrompt,
      generatedAt: null,
    };
    const predictedResultSize = resolveMinEdgeFittedSize(initialRequestAspectRatio, {
      minWidth: EXPORT_RESULT_NODE_MIN_WIDTH,
      minHeight: EXPORT_RESULT_NODE_MIN_HEIGHT,
    });
    const newNodePosition = findNodePosition(
      id,
      predictedResultSize.width,
      predictedResultSize.height
    );
    const newNodeId = addNode(
      CANVAS_NODE_TYPES.exportImage,
      newNodePosition,
      {
        isGenerating: true,
        generationStartedAt,
        generationDurationMs,
        resultKind: 'generic',
        displayName: resultNodeTitle,
        aspectRatio: initialRequestAspectRatio,
        generationSummary,
      },
      { inheritParentFromNodeId: id }
    );
    addEdge(id, newNodeId);

    let resolvedRequestAspectRatio = initialRequestAspectRatio;

    try {
      const resolvedRequestReferenceImages = await resolvedRequestReferenceImagesPromise;
      if (selectedAspectRatio.value === AUTO_REQUEST_ASPECT_RATIO) {
        if (resolvedRequestReferenceImages.length > 0) {
          try {
            const sourceAspectRatio = await detectAspectRatio(resolvedRequestReferenceImages[0]);
            const sourceAspectRatioValue = parseAspectRatio(sourceAspectRatio);
            resolvedRequestAspectRatio = pickClosestAspectRatio(
              sourceAspectRatioValue,
              supportedAspectRatioValues
            );
          } catch {
            resolvedRequestAspectRatio = initialRequestAspectRatio;
          }
        }

        if (resolvedRequestAspectRatio !== initialRequestAspectRatio) {
          updateNodeData(
            newNodeId,
            { aspectRatio: resolvedRequestAspectRatio },
            { historyMode: 'skip' }
          );
        }
      }

      await canvasAiGateway.setApiKey(selectedModel.providerId, providerApiKey);
      const jobId = await canvasAiGateway.submitGenerateImageJob({
        prompt: submittedPrompt,
        model: requestResolution.requestModel,
        size: selectedResolution.value,
        aspectRatio: resolvedRequestAspectRatio,
        referenceImages: resolvedRequestReferenceImages,
        extraParams: effectiveExtraParams,
      });
      const runtimeDiagnostics = await runtimeDiagnosticsPromise;
      const generationDebugContext: GenerationDebugContext = {
        sourceType: 'imageEdit',
        providerId: selectedModel.providerId,
        requestModel: debugRequestModel,
        requestSize: selectedResolution.value,
        requestAspectRatio: resolvedRequestAspectRatio,
        prompt: submittedPrompt,
        extraParams: effectiveExtraParams,
        referenceImageCount: incomingImages.length,
        referenceImagePlaceholders: createReferenceImagePlaceholders(incomingImages.length),
        appVersion: runtimeDiagnostics.appVersion,
        osName: runtimeDiagnostics.osName,
        osVersion: runtimeDiagnostics.osVersion,
        osBuild: runtimeDiagnostics.osBuild,
        userAgent: runtimeDiagnostics.userAgent,
      };
      updateNodeData(newNodeId, {
        generationJobId: jobId,
        generationSourceType: 'imageEdit',
        generationProviderId: selectedModel.providerId,
        generationClientSessionId: CURRENT_RUNTIME_SESSION_ID,
        generationDebugContext,
      });
    } catch (generationError) {
      const resolvedError = resolveErrorContent(generationError, t('ai.error'));
      const runtimeDiagnostics = await runtimeDiagnosticsPromise;
      const generationDebugContext: GenerationDebugContext = {
        sourceType: 'imageEdit',
        providerId: selectedModel.providerId,
        requestModel: debugRequestModel,
        requestSize: selectedResolution.value,
        requestAspectRatio: resolvedRequestAspectRatio,
        prompt: submittedPrompt,
        extraParams: effectiveExtraParams,
        referenceImageCount: incomingImages.length,
        referenceImagePlaceholders: createReferenceImagePlaceholders(incomingImages.length),
        appVersion: runtimeDiagnostics.appVersion,
        osName: runtimeDiagnostics.osName,
        osVersion: runtimeDiagnostics.osVersion,
        osBuild: runtimeDiagnostics.osBuild,
        userAgent: runtimeDiagnostics.userAgent,
      };
      const reportText = buildGenerationErrorReport({
        errorMessage: resolvedError.message,
        errorDetails: resolvedError.details,
        context: generationDebugContext,
      });
      setError(resolvedError.message);
      void showErrorDialog(
        resolvedError.message,
        t('common.error'),
        resolvedError.details,
        reportText
      );
      updateNodeData(newNodeId, {
        isGenerating: false,
        generationStartedAt: null,
        generationJobId: null,
        generationProviderId: null,
        generationClientSessionId: null,
        generationError: resolvedError.message,
        generationErrorDetails: resolvedError.details ?? null,
        generationDebugContext,
      });
    }
  }, [
    addNode,
    addEdge,
    providerApiKey,
    findNodePosition,
    promptDraft,
    resolvedCameraParams,
    effectiveExtraParams,
    id,
    incomingImages,
    incomingImageItems,
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
  ]);

  const insertImageReference = useCallback((imageIndex: number) => {
    const marker = buildShortReferenceToken(imageIndex);
    const currentPrompt = promptDraftRef.current;
    const selection = resolveTextSelection({
      textarea: promptRef.current,
      lastSelection: pickerSelectionRef.current ?? lastPromptSelectionRef.current,
      fallbackLength: currentPrompt.length,
      requireFocus: true,
    });
    const cursor = selection.start;
    const { nextText: nextPrompt, nextCursor } = insertReferenceToken(currentPrompt, cursor, marker);

    commitManualPromptDraft(nextPrompt);
    setShowImagePicker(false);
    pickerSelectionRef.current = null;
    setPickerActiveIndex(0);
    schedulePromptSelectionRestore(nextCursor);
  }, [commitManualPromptDraft, schedulePromptSelectionRestore]);

  const handlePromptKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Backspace' || event.key === 'Delete') {
      const currentPrompt = promptDraftRef.current;
      const selectionStart = event.currentTarget.selectionStart ?? currentPrompt.length;
      const selectionEnd = event.currentTarget.selectionEnd ?? selectionStart;
      const deletionDirection = event.key === 'Backspace' ? 'backward' : 'forward';
      const deleteRange = resolveReferenceAwareDeleteRange(
        currentPrompt,
        selectionStart,
        selectionEnd,
        deletionDirection,
        incomingImages.length
      );
      if (deleteRange) {
        event.preventDefault();
        const { nextText, nextCursor } = removeTextRange(currentPrompt, deleteRange);
        commitManualPromptDraft(nextText);
        schedulePromptSelectionRestore(nextCursor);
        return;
      }
    }

    if (showImagePicker && incomingImages.length > 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        event.stopPropagation();
        setPickerActiveIndex((previous) => (previous + 1) % incomingImages.length);
        return;
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault();
        event.stopPropagation();
        setPickerActiveIndex((previous) =>
          previous === 0 ? incomingImages.length - 1 : previous - 1
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

    if (event.key === '@' && incomingImages.length > 0) {
      event.preventDefault();
      event.stopPropagation();
      const selection =
        readTextareaSelection(event.currentTarget, promptDraftRef.current.length)
        ?? resolveTextSelection({
          textarea: event.currentTarget,
          lastSelection: lastPromptSelectionRef.current,
          fallbackLength: promptDraftRef.current.length,
        });
      lastPromptSelectionRef.current = selection;
      pickerSelectionRef.current = selection;
      setPickerAnchor(resolveTextareaPickerAnchor({
        container: promptPanelRef.current,
        textarea: event.currentTarget,
        caretIndex: selection.start,
        yOffset: PICKER_Y_OFFSET_PX,
      }));
      setShowImagePicker(true);
      setPickerActiveIndex(0);
      return;
    }

    if (event.key === 'Escape' && showImagePicker) {
      event.preventDefault();
      event.stopPropagation();
      setShowImagePicker(false);
      pickerSelectionRef.current = null;
      setPickerActiveIndex(0);
      return;
    }

    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      void handleGenerate();
    }
  };

  const handleModelChange = useCallback((modelId: string) => {
    const nextModel = getImageModel(
      modelId,
      storyboardCompatibleModelConfig,
      storyboardNewApiModelConfig,
      storyboardApi2OkModelConfig,
      storyboardProviderCustomModels
    );
    const nextExtraParams = {
      ...(data.extraParams ?? {}),
      ...(nextModel.id === GRSAI_NANO_BANANA_PRO_MODEL_ID
        ? { grsai_pro_model: hrsaiNanoBananaProModel }
        : {}),
    };
    const nextResolution = resolveImageModelResolution(nextModel, data.size, {
      extraParams: nextExtraParams,
    });
    const nextRequestAspectRatio =
      data.requestAspectRatio === AUTO_REQUEST_ASPECT_RATIO
      || nextModel.aspectRatios.some((aspectRatio) => aspectRatio.value === data.requestAspectRatio)
        ? data.requestAspectRatio ?? AUTO_REQUEST_ASPECT_RATIO
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
  }, [
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
  ]);

  const handleResolutionChange = useCallback((resolution: string) => {
    const normalizedResolution = resolution as ImageSize;
    updateNodeData(id, { size: normalizedResolution });
    setLastImageEditDefaults({
      modelId: selectedModel.id,
      size: normalizedResolution,
      requestAspectRatio: selectedAspectRatio.value,
    });
  }, [
    id,
    selectedAspectRatio.value,
    selectedModel.id,
    setLastImageEditDefaults,
    updateNodeData,
  ]);

  const canUndoPromptOptimization = Boolean(
    lastPromptOptimizationUndoState
    && promptDraft === lastPromptOptimizationUndoState.appliedPrompt
  );

  const promptOptimizationNotice =
    lastPromptOptimizationMeta
      ? `${t('node.imageEdit.optimizeModelLabel', {
        model: lastPromptOptimizationMeta.modelLabel,
      })} · ${t('node.imageEdit.optimizeReferenceImagesLabel', {
        status:
          lastPromptOptimizationMeta.referenceImageCount > 0
            ? t('node.imageEdit.optimizeReferenceImagesUsed', {
              count: lastPromptOptimizationMeta.referenceImageCount,
            })
            : t('node.imageEdit.optimizeReferenceImagesUnused'),
      })}`
      : null;
  const statusInfoText =
    error
    ?? (isOptimizingPrompt ? t('node.imageEdit.optimizingPrompt') : null)
    ?? promptOptimizationNotice
    ?? t('node.imageEdit.statusHint');
  const showBlockingOverlay = Boolean(data.isGenerating || isOptimizingPrompt);

  const hidePromptReferencePreview = useCallback(() => {
    setPromptReferencePreview(null);
  }, []);

  const handlePromptReferenceTokenHover = useCallback((
    tokenIndex: number,
    event: ReactMouseEvent<HTMLSpanElement>
  ) => {
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
      previewHostRect.width - previewMaxWidth - horizontalPadding
    );
    const preferredLeft = event.clientX - previewHostRect.left + horizontalGap;
    const preferredTop = event.clientY - previewHostRect.top + verticalGap;
    const maxTop = Math.max(
      horizontalPadding,
      previewHostRect.height - previewMaxHeight - horizontalPadding
    );

    setPromptReferencePreview({
      imageUrl: item.referenceUrl,
      displayUrl: item.displayUrl,
      alt: item.label,
      left: Math.max(horizontalPadding, Math.min(preferredLeft, maxLeft)),
      top: Math.max(horizontalPadding, Math.min(preferredTop, maxTop)),
    });
  }, [incomingImageItems]);

  const handlePromptReferenceTokenMouseDown = useCallback((
    tokenEnd: number,
    event: ReactMouseEvent<HTMLSpanElement>
  ) => {
    event.preventDefault();
    event.stopPropagation();
    schedulePromptSelectionRestore(tokenEnd);
  }, [schedulePromptSelectionRestore]);

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
        rightSlot={headerRightSlot}
        editable
        onTitleChange={(nextTitle) => updateNodeData(id, { displayName: nextTitle })}
      />

      <div
        ref={promptPanelRef}
        className="relative min-h-0 flex-1 rounded-lg border border-[rgba(255,255,255,0.1)] bg-bg-dark/45 p-2"
      >
        <div ref={promptPreviewHostRef} className="relative h-full min-h-0">
          <div
            ref={promptHighlightRef}
            aria-hidden="true"
            className="ui-scrollbar pointer-events-none absolute inset-0 overflow-y-auto overflow-x-hidden text-sm leading-6 text-text-dark"
            style={{ scrollbarGutter: 'stable' }}
          >
            <div className="min-h-full whitespace-pre-wrap break-words px-1 py-0.5">
              {renderPromptWithHighlights(promptDraft, incomingImages.length)}
            </div>
          </div>

          <div
            ref={promptHoverLayerRef}
            aria-hidden="true"
            className="ui-scrollbar pointer-events-none absolute inset-0 z-20 overflow-y-auto overflow-x-hidden text-sm leading-6 text-transparent"
            style={{ scrollbarGutter: 'stable' }}
          >
            <div className="min-h-full whitespace-pre-wrap break-words px-1 py-0.5">
              {renderPromptReferenceHoverTargets(
                promptDraft,
                incomingImages.length,
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
              const nextValue = event.target.value;
              commitManualPromptDraft(nextValue);
              rememberPromptSelection(event.currentTarget);
            }}
            onKeyDownCapture={handlePromptKeyDown}
            onScroll={syncPromptHighlightScroll}
            onMouseDown={(event) => {
              event.stopPropagation();
              hidePromptReferencePreview();
            }}
            onSelect={(event) => rememberPromptSelection(event.currentTarget)}
            onMouseUp={(event) => rememberPromptSelection(event.currentTarget)}
            onKeyUp={(event) => rememberPromptSelection(event.currentTarget)}
            onBlur={() => setIsPromptTextSelectionActive(false)}
            placeholder={t('node.imageEdit.promptPlaceholder')}
            className="ui-scrollbar nodrag nowheel relative z-10 h-full w-full resize-none overflow-y-auto overflow-x-hidden border-none bg-transparent px-1 py-0.5 text-sm leading-6 text-transparent caret-text-dark outline-none placeholder:text-text-muted/80 focus:border-transparent whitespace-pre-wrap break-words selection:bg-accent/30 selection:text-transparent"
            style={{ scrollbarGutter: 'stable' }}
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
                viewerSourceUrl={resolveImageDisplayUrl(promptReferencePreview.imageUrl)}
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
                      ? 'border-accent/55 bg-white/[0.08] shadow-[0_0_0_1px_rgba(59,130,246,0.22)]'
                      : ''
                  }`}
                >
                  <CanvasNodeImage
                    src={item.displayUrl}
                    alt={item.label}
                    viewerSourceUrl={resolveImageDisplayUrl(item.referenceUrl)}
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
      </div>

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
              }
              }
              extraParams={data.extraParams}
              onExtraParamChange={(key, value) =>
                updateNodeData(id, {
                  extraParams: {
                    ...(data.extraParams ?? {}),
                    [key]: value,
                  },
                })
              }
              onStyleTemplateApply={(template) => {
                const nextPrompt = appendStyleTemplatePrompt(
                  promptDraftRef.current,
                  template.prompt
                );
                setPromptDraft(nextPrompt);
                commitPromptDraft(nextPrompt);
                setLastPromptOptimizationUndoState(null);
              }}
              triggerSize="sm"
              chipClassName={NODE_CONTROL_CHIP_CLASS}
              modelChipClassName={NODE_CONTROL_MODEL_CHIP_CLASS}
              paramsChipClassName={NODE_CONTROL_PARAMS_CHIP_CLASS}
              styleTemplateTriggerMode="icon"
              afterStyleTemplateSlot={(
                <Fragment>
                  <UiChipButton
                    type="button"
                    active={showCameraParamsDialog || isCameraParamsApplied}
                    className={cameraParamsButtonClassName}
                    aria-label={t('cameraParams.trigger')}
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
                        isCameraParamsApplied ? 'text-emerald-300' : 'text-text-dark'
                      }`}
                    />
                  </UiChipButton>
                  <UiChipButton
                    type="button"
                    active={isOptimizingPrompt}
                    disabled={isOptimizingPrompt || promptDraft.trim().length === 0}
                    className={`${NODE_CONTROL_CHIP_CLASS} !w-8 !px-0 shrink-0 justify-center`}
                    aria-label={
                      isOptimizingPrompt
                        ? t('node.imageEdit.optimizingPrompt')
                        : t('node.imageEdit.optimizePrompt')
                    }
                    title={
                      isOptimizingPrompt
                        ? t('node.imageEdit.optimizingPrompt')
                        : t('node.imageEdit.optimizePrompt')
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
                    disabled={isOptimizingPrompt || !canUndoPromptOptimization}
                    className={`${NODE_CONTROL_CHIP_CLASS} !w-8 !px-0 shrink-0 justify-center`}
                    aria-label={t('node.imageEdit.undoOptimizedPrompt')}
                    title={t('node.imageEdit.undoOptimizedPrompt')}
                    onClick={(event) => {
                      event.stopPropagation();
                      handleUndoOptimizedPrompt();
                    }}
                  >
                    <Undo2 className="h-4 w-4 origin-center scale-[1.08] text-text-dark" strokeWidth={2.3} />
                  </UiChipButton>
                </Fragment>
              )}
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
              <Sparkles className={NODE_CONTROL_GENERATE_ICON_CLASS} strokeWidth={2.5} />
              {t('canvas.generate')}
            </UiButton>
          </div>
        </div>
      </div>
      <div
        className={`mt-1 min-h-[18px] text-[10px] leading-4 ${
          error ? 'text-red-200' : 'text-text-muted'
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
        isOpen={showCameraParamsDialog}
        value={resolvedCameraParams}
        onApply={(nextValue) => updateNodeData(id, { cameraParams: nextValue })}
        onClose={() => setShowCameraParamsDialog(false)}
      />
    </div>
  );
});

ImageEditNode.displayName = 'ImageEditNode';
