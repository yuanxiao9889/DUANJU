import { useCallback, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { ReactFlowProvider, useReactFlow } from '@xyflow/react';
import {
  AlertTriangle,
  Check,
  ImagePlus,
  Loader2,
  MessageSquareText,
  Send,
  Settings,
  Sparkles,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { UiButton, UiInput, UiSelect, UiTextAreaField } from '@/components/ui';
import { Canvas } from '@/features/canvas/Canvas';
import { canvasAiGateway } from '@/features/canvas/application/canvasServices';
import {
  prepareNodeImageFromFile,
  resolveImageDisplayUrl,
} from '@/features/canvas/application/imageData';
import {
  CANVAS_NODE_TYPES,
  type CanvasEdge,
  type CanvasNode,
  type CommerceBatchGenerateNodeData,
  type CommerceBriefNodeData,
  type CommerceProductNodeData,
  type CommerceResultGroupNodeData,
} from '@/features/canvas/domain/canvasNodes';
import {
  applyCommerceAdAgentActions,
  type CommerceAdCanvasActionsContext,
} from '@/features/commerce-ad/application/commerceAdCanvasActions';
import {
  isLikelyVisionTextModel,
  runCommerceAdAgentTurn,
} from '@/features/commerce-ad/application/commerceAdAgent';
import {
  type CommerceAdAgentMessage,
  type CommerceAdAgentAction,
  type CommerceAdAgentGuidance,
  type CommerceAdBatchGenerateState,
  type CommerceAdGeneratedImageRecord,
  type CommerceAdGenerationBatch,
  type CommerceAdProductImage,
  type CommerceAdProductState,
} from '@/features/commerce-ad/types';
import {
  getImageModel,
  getModelProvider,
  listImageModels,
  resolveActivatedScriptProvider,
  resolveConfiguredScriptModel,
  resolveImageModelResolution,
  resolveImageModelResolutions,
  STORYBOARD_OOPII_MODEL_ID,
} from '@/features/canvas/models';
import { openSettingsDialog } from '@/features/settings/settingsEvents';
import { useCanvasStore } from '@/stores/canvasStore';
import { useSettingsStore } from '@/stores/settingsStore';

const RATIO_OPTIONS = ['1:1', '4:5', '3:4', '16:9', '9:16'] as const;
const DEFAULT_AGENT_MESSAGES: CommerceAdAgentMessage[] = [];
const COMMERCE_DEFAULT_IMAGE_MODEL_ID = STORYBOARD_OOPII_MODEL_ID;

function createLocalMessage(
  role: CommerceAdAgentMessage['role'],
  content: string,
  guidance?: CommerceAdAgentGuidance
): CommerceAdAgentMessage {
  return {
    id: `commerce-agent-local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role,
    content,
    createdAt: Date.now(),
    ...(guidance ? { guidance } : {}),
  };
}

function findStageNode<T extends CanvasNode['data']>(
  nodes: CanvasNode[],
  type: CanvasNode['type']
): (CanvasNode & { data: T }) | null {
  return (nodes.find((node) => node.type === type) as (CanvasNode & { data: T }) | undefined) ?? null;
}

function mergeProductImages(
  product: CommerceProductNodeData | null,
  images: CommerceAdProductImage[]
): CommerceAdProductState {
  const existingImages = product?.images ?? [];
  return {
    images: [...existingImages, ...images],
    brand: product?.brand ?? '',
    productName: product?.productName ?? '',
    category: product?.category ?? '',
    userInfo: product?.userInfo ?? '',
    inference: product?.inference ?? null,
    lastAnalyzedAt: product?.lastAnalyzedAt ?? null,
    lastError: null,
  };
}

function buildGenerationBatch(
  batch: CommerceBatchGenerateNodeData | null,
  corePrompt: string
): CommerceAdGenerationBatch {
  const aspectRatios = batch?.aspectRatios?.length ? batch.aspectRatios : ['1:1'];
  const variantsPerRatio = Math.max(1, Math.min(8, batch?.variantsPerRatio ?? 4));
  const batchId = `commerce-batch-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const images: CommerceAdGeneratedImageRecord[] = aspectRatios.flatMap((aspectRatio) =>
    Array.from({ length: variantsPerRatio }, (_, index) => ({
      id: `${batchId}-${aspectRatio.replace(':', 'x')}-${index + 1}`,
      aspectRatio,
      nodeId: null,
      prompt: batch?.ratioPrompts?.[aspectRatio] || corePrompt,
      status: 'queued',
      imageUrl: null,
      previewImageUrl: null,
      error: null,
    }))
  );

  return {
    id: batchId,
    createdAt: Date.now(),
    corePrompt,
    aspectRatios,
    variantsPerRatio,
    images,
  };
}

function dedupeStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function hasProductInfo(product: Partial<CommerceAdProductState> | null | undefined): boolean {
  if (!product) {
    return false;
  }

  return [
    product.productName,
    product.brand,
    product.category,
    product.userInfo,
    product.inference?.summary,
  ].some((value) => typeof value === 'string' && value.trim().length > 0);
}

function mergeProductState(
  base: CommerceAdProductState | null | undefined,
  patch: Partial<CommerceAdProductState> | null | undefined
): Partial<CommerceAdProductState> {
  return {
    ...(base ?? {}),
    ...(patch ?? {}),
    inference: patch?.inference ?? base?.inference ?? null,
  };
}

function buildGuidanceChoiceKey(messageId: string, kind: string, id: string): string {
  return `${messageId}:${kind}:${id}`;
}

function hasGuidanceContent(guidance: CommerceAdAgentGuidance): boolean {
  return Boolean(
    guidance.summary
    || guidance.confirmedFacts.length
    || guidance.missingFields.length
    || guidance.questions.length
    || guidance.designDirections.length
    || guidance.quickReplies.length
    || guidance.readinessHint
  );
}

function GuidancePillList({
  items,
  tone = 'neutral',
}: {
  items: string[];
  tone?: 'neutral' | 'warning';
}) {
  if (items.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((item) => (
        <span
          key={item}
          className={`rounded-full border px-2 py-1 text-[11px] ${
            tone === 'warning'
              ? 'border-amber-300/25 bg-amber-400/10 text-amber-100'
              : 'border-border-dark/70 bg-surface-dark/70 text-text-dark/85'
          }`}
        >
          {item}
        </span>
      ))}
    </div>
  );
}

function GuidanceChoiceButton({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`rounded-lg border px-2.5 py-1.5 text-left text-xs leading-5 transition-colors ${
        active
          ? 'border-text-dark/35 bg-text-dark/[0.12] text-text-dark'
          : 'border-border-dark/70 bg-bg-dark/70 text-text-muted hover:border-text-dark/20 hover:text-text-dark'
      }`}
    >
      {children}
    </button>
  );
}

function GuidanceCard({
  messageId,
  guidance,
  selectedChoiceKeys,
  onToggleChoice,
}: {
  messageId: string;
  guidance: CommerceAdAgentGuidance;
  selectedChoiceKeys: string[];
  onToggleChoice: (key: string, value: string) => void;
}) {
  const { t } = useTranslation();
  if (!hasGuidanceContent(guidance)) {
    return null;
  }

  return (
    <div className="mt-2 space-y-3 rounded-lg border border-border-dark/70 bg-bg-dark/45 p-3">
      {guidance.summary ? (
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">
            {t('commerceAd.agent.guidance.understood')}
          </div>
          <p className="mt-1 whitespace-pre-wrap text-xs leading-5 text-text-dark/85">
            {guidance.summary}
          </p>
        </div>
      ) : null}

      {guidance.confirmedFacts.length > 0 ? (
        <div className="space-y-1.5">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">
            {t('commerceAd.agent.guidance.confirmed')}
          </div>
          <GuidancePillList items={guidance.confirmedFacts} />
        </div>
      ) : null}

      {guidance.missingFields.length > 0 ? (
        <div className="space-y-1.5">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">
            {t('commerceAd.agent.guidance.missing')}
          </div>
          <GuidancePillList items={guidance.missingFields} tone="warning" />
        </div>
      ) : null}

      {guidance.designDirections.length > 0 ? (
        <div className="space-y-2">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">
            {t('commerceAd.agent.guidance.directions')}
          </div>
          <div className="grid gap-2">
            {guidance.designDirections.map((direction) => {
              const key = buildGuidanceChoiceKey(messageId, 'direction', direction.id);
              const value = direction.description
                ? `${direction.title}：${direction.description}`
                : direction.title;
              return (
                <button
                  key={direction.id}
                  type="button"
                  aria-pressed={selectedChoiceKeys.includes(key)}
                  onClick={() => onToggleChoice(key, value)}
                  className={`rounded-lg border px-3 py-2 text-left transition-colors ${
                    selectedChoiceKeys.includes(key)
                      ? 'border-text-dark/35 bg-text-dark/[0.12]'
                      : 'border-border-dark/70 bg-surface-dark/45 hover:border-text-dark/20'
                  }`}
                >
                  <div className="text-xs font-medium text-text-dark">{direction.title}</div>
                  {direction.description ? (
                    <div className="mt-1 text-[11px] leading-5 text-text-muted">
                      {direction.description}
                    </div>
                  ) : null}
                  {direction.tags.length > 0 ? (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {direction.tags.map((tag) => (
                        <span
                          key={tag}
                          className="rounded-full bg-bg-dark px-1.5 py-0.5 text-[10px] text-text-muted"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {guidance.questions.length > 0 ? (
        <div className="space-y-2">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">
            {t('commerceAd.agent.guidance.questions')}
          </div>
          {guidance.questions.map((question) => (
            <div key={question.id} className="space-y-1.5">
              <div className="text-xs leading-5 text-text-dark/85">{question.label}</div>
              {question.options.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {question.options.map((option) => {
                    const key = buildGuidanceChoiceKey(messageId, question.id, option.id);
                    return (
                      <GuidanceChoiceButton
                        key={option.id}
                        active={selectedChoiceKeys.includes(key)}
                        onClick={() => onToggleChoice(key, option.value || option.label)}
                      >
                        {option.label}
                      </GuidanceChoiceButton>
                    );
                  })}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      {guidance.quickReplies.length > 0 ? (
        <div className="space-y-1.5">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">
            {t('commerceAd.agent.guidance.quickReplies')}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {guidance.quickReplies.map((reply) => {
              const key = buildGuidanceChoiceKey(messageId, 'quick', reply);
              return (
                <GuidanceChoiceButton
                  key={reply}
                  active={selectedChoiceKeys.includes(key)}
                  onClick={() => onToggleChoice(key, reply)}
                >
                  {reply}
                </GuidanceChoiceButton>
              );
            })}
          </div>
        </div>
      ) : null}

      {guidance.readinessHint ? (
        <div className="rounded-lg border border-text-dark/10 bg-text-dark/[0.06] px-3 py-2 text-xs leading-5 text-text-dark/80">
          {guidance.readinessHint}
        </div>
      ) : null}
    </div>
  );
}

function CommerceAdWorkspaceInner() {
  const { t } = useTranslation();
  const flow = useReactFlow<CanvasNode, CanvasEdge>();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [messages, setMessages] = useState<CommerceAdAgentMessage[]>(DEFAULT_AGENT_MESSAGES);
  const [draft, setDraft] = useState('');
  const [manualProductInfo, setManualProductInfo] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [statusText, setStatusText] = useState<string | null>(null);
  const [selectedGuidanceChoiceKeys, setSelectedGuidanceChoiceKeys] = useState<string[]>([]);

  const nodes = useCanvasStore((state) => state.nodes);
  const addNode = useCanvasStore((state) => state.addNode);
  const updateNodeData = useCanvasStore((state) => state.updateNodeData);
  const addEdge = useCanvasStore((state) => state.addEdge);
  const setSelectedNode = useCanvasStore((state) => state.setSelectedNode);
  const settings = useSettingsStore((state) => state);

  const productNode = useMemo(
    () => findStageNode<CommerceProductNodeData>(nodes, CANVAS_NODE_TYPES.commerceProduct),
    [nodes]
  );
  const briefNode = useMemo(
    () => findStageNode<CommerceBriefNodeData>(nodes, CANVAS_NODE_TYPES.commerceBrief),
    [nodes]
  );
  const batchNode = useMemo(
    () => findStageNode<CommerceBatchGenerateNodeData>(nodes, CANVAS_NODE_TYPES.commerceBatchGenerate),
    [nodes]
  );
  const resultNode = useMemo(
    () => findStageNode<CommerceResultGroupNodeData>(nodes, CANVAS_NODE_TYPES.commerceResultGroup),
    [nodes]
  );

  const activeTextProvider = useMemo(
    () => resolveActivatedScriptProvider(settings),
    [settings]
  );
  const activeTextModel = useMemo(
    () => activeTextProvider ? resolveConfiguredScriptModel(activeTextProvider, settings) : '',
    [activeTextProvider, settings]
  );
  const canUseVisionModel = useMemo(
    () => isLikelyVisionTextModel(activeTextProvider, activeTextModel),
    [activeTextProvider, activeTextModel]
  );
  const productImages = productNode?.data.images ?? [];
  const productReferenceImages = useMemo(
    () => dedupeStrings(productImages.map((image) => image.imageUrl)),
    [productImages]
  );
  const shouldShowVisionWarning = productImages.length > 0 && !canUseVisionModel;
  const hasResolvedProductInfo = hasProductInfo(productNode?.data);
  const emptyGuidance = useMemo<CommerceAdAgentGuidance>(() => ({
    stage: 'upload',
    summary: t('commerceAd.agent.guidance.emptySummary'),
    confirmedFacts: [
      t('commerceAd.agent.guidance.emptyStepUpload'),
      t('commerceAd.agent.guidance.emptyStepInfer'),
      t('commerceAd.agent.guidance.emptyStepDesign'),
    ],
    missingFields: [
      t('commerceAd.agent.guidance.missingProduct'),
      t('commerceAd.agent.guidance.missingPlatform'),
      t('commerceAd.agent.guidance.missingDirection'),
    ],
    questions: [
      {
        id: 'start',
        label: t('commerceAd.agent.guidance.emptyQuestion'),
        allowMultiple: true,
        options: [
          {
            id: 'upload-product',
            label: t('commerceAd.agent.guidance.optionUploadProduct'),
            value: t('commerceAd.agent.guidance.optionUploadProduct'),
          },
          {
            id: 'manual-product',
            label: t('commerceAd.agent.guidance.optionManualProduct'),
            value: t('commerceAd.agent.guidance.optionManualProduct'),
          },
          {
            id: 'design-direction',
            label: t('commerceAd.agent.guidance.optionDesignDirection'),
            value: t('commerceAd.agent.guidance.optionDesignDirection'),
          },
        ],
      },
    ],
    designDirections: [
      {
        id: 'clean-hero',
        title: t('commerceAd.agent.guidance.directionCleanHeroTitle'),
        description: t('commerceAd.agent.guidance.directionCleanHeroDesc'),
        tags: [
          t('commerceAd.agent.guidance.tagHero'),
          t('commerceAd.agent.guidance.tagPremium'),
        ],
      },
      {
        id: 'lifestyle',
        title: t('commerceAd.agent.guidance.directionLifestyleTitle'),
        description: t('commerceAd.agent.guidance.directionLifestyleDesc'),
        tags: [
          t('commerceAd.agent.guidance.tagScenario'),
          t('commerceAd.agent.guidance.tagSocial'),
        ],
      },
    ],
    quickReplies: [
      t('commerceAd.agent.guidance.quickXiaohongshu'),
      t('commerceAd.agent.guidance.quickPremium'),
    ],
    readinessHint: t('commerceAd.agent.guidance.emptyReadiness'),
  }), [t]);
  const createUploadGuidance = useCallback((count: number): CommerceAdAgentGuidance => ({
    stage: 'upload',
    summary: t('commerceAd.agent.guidance.uploadSummary', { count }),
    confirmedFacts: [t('commerceAd.agent.guidance.uploadConfirmed', { count })],
    missingFields: [
      t('commerceAd.agent.guidance.missingProductUnderstanding'),
      t('commerceAd.agent.guidance.missingPlatform'),
      t('commerceAd.agent.guidance.missingDirection'),
    ],
    questions: [
      {
        id: 'after-upload',
        label: t('commerceAd.agent.guidance.uploadQuestion'),
        allowMultiple: true,
        options: [
          {
            id: 'infer-now',
            label: t('commerceAd.agent.guidance.optionInferNow'),
            value: t('commerceAd.agent.guidance.optionInferNow'),
          },
          {
            id: 'add-selling-points',
            label: t('commerceAd.agent.guidance.optionAddSellingPoints'),
            value: t('commerceAd.agent.guidance.optionAddSellingPoints'),
          },
          {
            id: 'choose-platform',
            label: t('commerceAd.agent.guidance.optionChoosePlatform'),
            value: t('commerceAd.agent.guidance.optionChoosePlatform'),
          },
        ],
      },
    ],
    designDirections: [],
    quickReplies: [
      t('commerceAd.agent.guidance.quickInferThenXiaohongshu'),
      t('commerceAd.agent.guidance.quickAddBrandTone'),
    ],
    readinessHint: t('commerceAd.agent.guidance.uploadReadiness'),
  }), [t]);
  const guidanceChoiceValues = useMemo(() => {
    const values = new Map<string, string>();
    const collect = (messageId: string, guidance: CommerceAdAgentGuidance | undefined) => {
      if (!guidance) {
        return;
      }
      guidance.designDirections.forEach((direction) => {
        values.set(
          buildGuidanceChoiceKey(messageId, 'direction', direction.id),
          direction.description ? `${direction.title}：${direction.description}` : direction.title
        );
      });
      guidance.questions.forEach((question) => {
        question.options.forEach((option) => {
          values.set(
            buildGuidanceChoiceKey(messageId, question.id, option.id),
            option.value || option.label
          );
        });
      });
      guidance.quickReplies.forEach((reply) => {
        values.set(buildGuidanceChoiceKey(messageId, 'quick', reply), reply);
      });
    };
    collect('commerce-empty-guidance', emptyGuidance);
    messages.forEach((message) => collect(message.id, message.guidance));
    return values;
  }, [emptyGuidance, messages]);
  const handleGuidanceChoiceToggle = useCallback((key: string, value: string) => {
    setSelectedGuidanceChoiceKeys((current) => {
      const selected = new Set(current);
      if (selected.has(key)) {
        selected.delete(key);
      } else {
        selected.add(key);
      }
      const nextKeys = Array.from(selected);
      const labels = nextKeys
        .map((item) => (item === key && selected.has(key) ? value : guidanceChoiceValues.get(item)))
        .filter((item): item is string => Boolean(item));
      const marker = t('commerceAd.agent.guidance.selectionMarker');
      const selectionText = labels.length > 0
        ? t('commerceAd.agent.guidance.selectionDraft', {
            items: labels.join(t('commerceAd.agent.guidance.selectionSeparator')),
          })
        : '';

      setDraft((currentDraft) => {
        const lines = currentDraft.split('\n');
        const customDraft = lines[0]?.startsWith(marker)
          ? lines.slice(1).join('\n').trim()
          : currentDraft.trim();
        if (!selectionText) {
          return customDraft;
        }
        return customDraft ? `${selectionText}\n${customDraft}` : selectionText;
      });
      return nextKeys;
    });
  }, [guidanceChoiceValues, t]);
  const currentRatios = batchNode?.data.aspectRatios?.length
    ? batchNode.data.aspectRatios
    : ['1:1', '4:5', '9:16'];
  const currentVariants = batchNode?.data.variantsPerRatio ?? 4;
  const imageModels = useMemo(
    () => listImageModels(
      settings.storyboardCompatibleModelConfig,
      settings.storyboardNewApiModelConfig,
      settings.storyboardApi2OkModelConfig,
      settings.storyboardProviderCustomModels
    ),
    [
      settings.storyboardApi2OkModelConfig,
      settings.storyboardCompatibleModelConfig,
      settings.storyboardNewApiModelConfig,
      settings.storyboardProviderCustomModels,
    ]
  );
  const selectedImageModel = useMemo(
    () => getImageModel(
      batchNode?.data.modelId || COMMERCE_DEFAULT_IMAGE_MODEL_ID,
      settings.storyboardCompatibleModelConfig,
      settings.storyboardNewApiModelConfig,
      settings.storyboardApi2OkModelConfig,
      settings.storyboardProviderCustomModels
    ),
    [
      batchNode?.data.modelId,
      settings.storyboardApi2OkModelConfig,
      settings.storyboardCompatibleModelConfig,
      settings.storyboardNewApiModelConfig,
      settings.storyboardProviderCustomModels,
    ]
  );
  const imageProviderOptions = useMemo(() => {
    const providerIds = Array.from(new Set(imageModels.map((model) => model.providerId)));
    return providerIds
      .sort((left, right) => {
        if (left === 'oopii') return -1;
        if (right === 'oopii') return 1;
        return left.localeCompare(right);
      })
      .map((providerId) => {
        const provider = getModelProvider(providerId);
        return {
          id: providerId,
          label: providerId === 'oopii'
            ? `oopii-${t('commerceAd.agent.recommended')}`
            : provider.label || provider.name || providerId,
        };
      });
  }, [imageModels, t]);
  const selectedProviderImageModels = useMemo(
    () => imageModels.filter((model) => model.providerId === selectedImageModel.providerId),
    [imageModels, selectedImageModel.providerId]
  );
  const resolutionOptions = useMemo(
    () => resolveImageModelResolutions(selectedImageModel, { extraParams: {} }),
    [selectedImageModel]
  );
  const selectedResolution = useMemo(
    () => resolveImageModelResolution(
      selectedImageModel,
      batchNode?.data.size || selectedImageModel.defaultResolution,
      { extraParams: {} }
    ),
    [batchNode?.data.size, selectedImageModel]
  );

  const canvasActionContext = useMemo<CommerceAdCanvasActionsContext>(() => ({
    getNodes: () => useCanvasStore.getState().nodes,
    addNode,
    updateNodeData,
    addEdge,
    setSelectedNode,
    setCenter: flow.setCenter,
  }), [addEdge, addNode, flow.setCenter, setSelectedNode, updateNodeData]);

  const applyActions = useCallback((actions: CommerceAdAgentAction[]) => {
    return applyCommerceAdAgentActions(actions, canvasActionContext);
  }, [canvasActionContext]);

  const runAgent = useCallback(async (
    userMessage: string,
    productOverride?: CommerceAdProductState
  ) => {
    const trimmedMessage = userMessage.trim();
    if (!trimmedMessage && !productOverride && productImages.length === 0) {
      return;
    }

    const nextUserMessage = trimmedMessage
      ? createLocalMessage('user', trimmedMessage)
      : null;
    if (nextUserMessage) {
      setMessages((items) => [...items, nextUserMessage]);
    }

    setIsThinking(true);
    setStatusText(t('commerceAd.agent.statusThinking'));
    try {
      const product = productOverride ?? productNode?.data ?? null;
      const result = await runCommerceAdAgentTurn({
        userMessage: trimmedMessage || manualProductInfo,
        product,
        brief: briefNode?.data ?? null,
        batch: batchNode?.data ?? null,
        referenceImages: dedupeStrings([
          ...(product?.images ?? productImages).map((image) => image.imageUrl),
          ...productReferenceImages,
        ]),
        canUseVisionModel,
      });
      const productAction = result.actions.find((action) => action.type === 'upsertProduct');
      const nextProduct = mergeProductState(product, productAction?.type === 'upsertProduct' ? productAction.data : null);
      const shouldAllowBatchActions = hasProductInfo(nextProduct);
      const nextActions = shouldAllowBatchActions
        ? result.actions
        : result.actions.filter((action) => action.type !== 'upsertBatchGenerate');
      applyActions(nextActions);
      setMessages((items) => [...items, result.assistantMessage]);
      setStatusText(t('commerceAd.agent.statusSynced'));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setMessages((items) => [
        ...items,
        createLocalMessage('assistant', t('commerceAd.agent.errorMessage', { message })),
      ]);
      setStatusText(t('commerceAd.agent.statusFailed'));
    } finally {
      setIsThinking(false);
    }
  }, [
    applyActions,
    batchNode?.data,
    briefNode?.data,
    canUseVisionModel,
    manualProductInfo,
    productImages,
    productReferenceImages,
    productNode?.data,
    t,
  ]);

  const handleUploadClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFilesSelected = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []).filter((file) => file.type.startsWith('image/'));
    event.target.value = '';
    if (files.length === 0) {
      return;
    }

    setUploading(true);
    setStatusText(t('commerceAd.agent.statusUploading'));
    try {
      const preparedImages = await Promise.all(
        files.map(async (file, index): Promise<CommerceAdProductImage> => {
          const prepared = await prepareNodeImageFromFile(
            file,
            undefined,
            undefined,
            settings.canvasOverviewThumbnailMaxDimension
          );
          return {
            id: `commerce-product-image-${Date.now()}-${index + 1}`,
            imageUrl: prepared.imageUrl,
            previewImageUrl: prepared.previewImageUrl,
            aspectRatio: prepared.aspectRatio,
            label: file.name || t('commerceAd.agent.productImageLabel', { index: index + 1 }),
            kind: productImages.length === 0 && index === 0 ? 'main' : 'reference',
          };
        })
      );
      const mergedProduct = mergeProductImages(productNode?.data ?? null, preparedImages);
      applyActions([{ type: 'upsertProduct', data: mergedProduct }]);

      setMessages((items) => [
        ...items,
        createLocalMessage('user', t('commerceAd.agent.uploadedImages', { count: preparedImages.length })),
        createLocalMessage(
          'assistant',
          t('commerceAd.agent.guidance.uploadAssistant', { count: preparedImages.length }),
          createUploadGuidance(preparedImages.length)
        ),
      ]);
      setStatusText(t('commerceAd.agent.statusUploaded'));
    } finally {
      setUploading(false);
    }
  }, [applyActions, createUploadGuidance, productImages.length, productNode?.data, t]);

  const commitManualProductInfo = useCallback(() => {
    const userInfo = manualProductInfo.trim();
    if (!userInfo) {
      return;
    }
    const nextProduct: CommerceAdProductState = {
      ...mergeProductImages(productNode?.data ?? null, []),
      userInfo,
      lastError: null,
    };
    applyActions([{ type: 'upsertProduct', data: nextProduct }]);
    setMessages((items) => [
      ...items,
      createLocalMessage('user', t('commerceAd.agent.productInfoSynced')),
    ]);
    setStatusText(t('commerceAd.agent.statusProductSynced'));
  }, [applyActions, manualProductInfo, productNode?.data, t]);

  const handleInferProduct = useCallback(() => {
    const product = productNode?.data ?? null;
    if (!product || productReferenceImages.length === 0) {
      setStatusText(t('commerceAd.agent.needProductImageBeforeInfer'));
      return;
    }
    void runAgent(manualProductInfo.trim(), product);
  }, [manualProductInfo, productNode?.data, productReferenceImages.length, runAgent, t]);

  const updateBatchConfig = useCallback((data: Partial<CommerceAdBatchGenerateState>) => {
    applyActions([{
      type: 'upsertBatchGenerate',
      data: {
        aspectRatios: currentRatios,
        variantsPerRatio: currentVariants,
        modelId: selectedImageModel.id,
        size: selectedResolution.value,
        ...data,
        status: batchNode?.data.corePrompt ? 'ready' : batchNode?.data.status ?? 'idle',
      },
    }]);
  }, [
    applyActions,
    batchNode?.data.corePrompt,
    batchNode?.data.status,
    currentRatios,
    currentVariants,
    selectedImageModel.id,
    selectedResolution.value,
  ]);

  const toggleRatio = useCallback((ratio: string) => {
    const next = currentRatios.includes(ratio)
      ? currentRatios.filter((item) => item !== ratio)
      : [...currentRatios, ratio];
    updateBatchConfig({ aspectRatios: next.length > 0 ? next : [ratio] });
  }, [currentRatios, updateBatchConfig]);

  const handleImageModelChange = useCallback((modelId: string) => {
    const nextModel = getImageModel(
      modelId,
      settings.storyboardCompatibleModelConfig,
      settings.storyboardNewApiModelConfig,
      settings.storyboardApi2OkModelConfig,
      settings.storyboardProviderCustomModels
    );
    const nextResolution = resolveImageModelResolution(
      nextModel,
      undefined,
      { extraParams: {} }
    );
    updateBatchConfig({
      modelId: nextModel.id,
      size: nextResolution.value,
    });
  }, [
    settings.storyboardApi2OkModelConfig,
    settings.storyboardCompatibleModelConfig,
    settings.storyboardNewApiModelConfig,
    settings.storyboardProviderCustomModels,
    updateBatchConfig,
  ]);

  const handleImageProviderChange = useCallback((providerId: string) => {
    const nextModelId =
      imageModels.find((model) => model.providerId === providerId)?.id
      ?? COMMERCE_DEFAULT_IMAGE_MODEL_ID;
    handleImageModelChange(nextModelId);
  }, [handleImageModelChange, imageModels]);

  const handleGenerate = useCallback(async () => {
    const corePrompt =
      batchNode?.data.corePrompt
      || briefNode?.data.normalizedBrief
      || productNode?.data.userInfo
      || productNode?.data.inference?.summary
      || '';
    if (!hasResolvedProductInfo) {
      setStatusText(t('commerceAd.agent.needProductInfoBeforeBatch'));
      return;
    }
    if (!corePrompt.trim()) {
      setStatusText(t('commerceAd.agent.needBriefBeforeGenerate'));
      return;
    }
    if (productReferenceImages.length === 0 && !(productNode?.data.userInfo ?? '').trim()) {
      setStatusText(t('commerceAd.agent.needProductReferenceBeforeGenerate'));
      return;
    }

    const providerApiKey = settings.storyboardApiKeys[selectedImageModel.providerId] ?? '';
    if (!providerApiKey.trim()) {
      openSettingsDialog({
        category: 'providers',
        providerTab: 'storyboard',
        providerId: selectedImageModel.providerId,
      });
      setStatusText(t('commerceAd.agent.noImageApiKey'));
      return;
    }

    const generationBatch = buildGenerationBatch(batchNode?.data ?? null, corePrompt);
    const referenceImages = productReferenceImages;
    const startedAt = Date.now();
    const generationDurationMs = selectedImageModel.expectedDurationMs ?? 60000;
    const requestResolution = selectedImageModel.resolveRequest({
      referenceImageCount: referenceImages.length,
    });
    const resultPositionBase = resultNode?.position ?? { x: 1260, y: 420 };
    const submittedImages: CommerceAdGeneratedImageRecord[] = [];
    setStatusText(t('commerceAd.agent.statusSubmitting'));

    await canvasAiGateway.setApiKey(selectedImageModel.providerId, providerApiKey);

    for (const [index, imageRecord] of generationBatch.images.entries()) {
      const prompt = imageRecord.prompt || corePrompt;
      const resultNodeId = addNode(
        CANVAS_NODE_TYPES.exportImage,
        {
          x: resultPositionBase.x + (index % 4) * 260,
          y: resultPositionBase.y + Math.floor(index / 4) * 300,
        },
        {
          isGenerating: true,
          generationPhase: 'submitting',
          generationStartedAt: startedAt,
          generationDurationMs,
          resultKind: 'generic',
          displayName: `${t('commerceAd.nodes.results')} ${imageRecord.aspectRatio}`,
          aspectRatio: imageRecord.aspectRatio,
          generationSummary: {
            sourceType: 'imageEdit',
            providerId: selectedImageModel.providerId,
            requestModel: requestResolution.requestModel,
            prompt,
            generatedAt: null,
          },
        }
      );
      if (batchNode?.id) {
        addEdge(batchNode.id, resultNodeId);
      }

      try {
        const resolvedPayload = await canvasAiGateway.resolveGenerateImagePayload({
          prompt,
          model: requestResolution.requestModel,
          size: selectedResolution.value,
          aspectRatio: imageRecord.aspectRatio,
          referenceImages,
        });
        const jobId = await canvasAiGateway.submitGenerateImageJob(resolvedPayload);
        updateNodeData(resultNodeId, {
          isGenerating: true,
          generationJobId: jobId,
          generationPhase: 'queued',
          generationStartedAt: startedAt,
          generationSourceType: 'imageEdit',
          generationProviderId: selectedImageModel.providerId,
          generationError: null,
        });
        submittedImages.push({
          ...imageRecord,
          nodeId: resultNodeId,
          status: 'running',
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        updateNodeData(resultNodeId, {
          isGenerating: false,
          generationPhase: 'failed',
          generationError: message,
        });
        submittedImages.push({
          ...imageRecord,
          nodeId: resultNodeId,
          status: 'failed',
          error: message,
        });
      }
    }

    const submittedBatch: CommerceAdGenerationBatch = {
      ...generationBatch,
      images: submittedImages,
    };
    applyActions([
      {
        type: 'upsertBatchGenerate',
        data: {
          corePrompt,
          aspectRatios: submittedBatch.aspectRatios,
          variantsPerRatio: submittedBatch.variantsPerRatio,
          modelId: selectedImageModel.id,
          size: selectedResolution.value,
          status: 'ready',
          lastGeneratedAt: submittedBatch.createdAt,
          lastError: null,
        },
      },
      {
        type: 'upsertResultGroup',
        data: {
          batches: [...(resultNode?.data.batches ?? []), submittedBatch],
          activeBatchId: submittedBatch.id,
        },
      },
    ]);
    setMessages((items) => [
      ...items,
      createLocalMessage('assistant', t('commerceAd.agent.batchCreated', {
        count: submittedBatch.images.length,
      })),
    ]);
    setStatusText(t('commerceAd.agent.statusBatchCreated'));
  }, [
    addEdge,
    addNode,
    applyActions,
    batchNode?.data,
    batchNode?.id,
    briefNode?.data.normalizedBrief,
    hasResolvedProductInfo,
    productNode?.data,
    productReferenceImages,
    resultNode?.data.batches,
    resultNode?.position,
    selectedImageModel,
    selectedResolution.value,
    settings.storyboardApiKeys,
    t,
    updateNodeData,
  ]);

  const handleSubmit = useCallback(() => {
    const text = draft.trim();
    if (!text || isThinking) {
      return;
    }
    setDraft('');
    setSelectedGuidanceChoiceKeys([]);
    void runAgent(text);
  }, [draft, isThinking, runAgent]);

  return (
    <div className="flex h-full min-h-0 w-full bg-bg-base">
      <div className="min-w-0 flex-1">
        <Canvas />
      </div>
      <aside className="flex h-full w-[400px] shrink-0 flex-col border-l border-border-dark/70 bg-surface-dark/95 shadow-2xl">
        <div className="border-b border-border-dark/70 px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-border-dark/70 bg-bg-dark text-text-dark">
              <MessageSquareText className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <h2 className="truncate text-sm font-semibold text-text-dark">
                {t('commerceAd.agent.title')}
              </h2>
              <p className="truncate text-xs text-text-muted">
                {activeTextModel
                  ? t('commerceAd.agent.modelStatus', { model: activeTextModel })
                  : t('commerceAd.agent.noModel')}
              </p>
            </div>
          </div>
        </div>

        <div className="ui-scrollbar flex-1 space-y-4 overflow-y-auto px-4 py-4">
          {shouldShowVisionWarning ? (
            <div className="rounded-lg border border-amber-400/30 bg-amber-500/10 p-3 text-sm text-amber-100">
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <div className="min-w-0">
                  <div className="font-medium">{t('commerceAd.agent.visionWarningTitle')}</div>
                  <p className="mt-1 text-xs leading-5 text-amber-100/80">
                    {t('commerceAd.agent.visionWarningBody')}
                  </p>
                  <UiButton
                    type="button"
                    size="sm"
                    className="mt-2 gap-2"
                    onClick={() => openSettingsDialog({ category: 'providers' })}
                  >
                    <Settings className="h-3.5 w-3.5" />
                    {t('commerceAd.agent.openModelSettings')}
                  </UiButton>
                </div>
              </div>
            </div>
          ) : null}

          <section className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-text-muted">
                  {t('commerceAd.agent.productSection')}
                </h3>
                <p className="mt-1 text-xs text-text-muted">
                  {t('commerceAd.agent.productSectionHint')}
                </p>
              </div>
              <UiButton
                type="button"
                size="sm"
                className="gap-2"
                onClick={handleUploadClick}
                disabled={uploading}
              >
                {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImagePlus className="h-3.5 w-3.5" />}
                {t('commerceAd.agent.upload')}
              </UiButton>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={handleFilesSelected}
            />
            {productImages.length > 0 ? (
              <div className="grid grid-cols-4 gap-2">
                {productImages.slice(0, 8).map((image) => (
                  <div key={image.id} className="aspect-square overflow-hidden rounded-lg border border-border-dark/70 bg-bg-dark">
                    <img
                      src={resolveImageDisplayUrl(image.previewImageUrl || image.imageUrl)}
                      alt={image.label}
                      className="h-full w-full object-contain"
                      draggable={false}
                    />
                  </div>
                ))}
              </div>
            ) : null}
            <UiTextAreaField
              value={manualProductInfo}
              onChange={(event) => setManualProductInfo(event.target.value)}
              rows={3}
              placeholder={t('commerceAd.agent.manualProductPlaceholder')}
            />
            <UiButton
              type="button"
              size="sm"
              variant="muted"
              className="w-full gap-2"
              onClick={commitManualProductInfo}
              disabled={!manualProductInfo.trim() || isThinking}
            >
              <Sparkles className="h-3.5 w-3.5" />
              {t('commerceAd.agent.syncProductInfo')}
            </UiButton>
            <UiButton
              type="button"
              size="sm"
              className="w-full gap-2"
              onClick={handleInferProduct}
              disabled={productReferenceImages.length === 0 || isThinking || uploading}
            >
              {isThinking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              {t('commerceAd.agent.inferProduct')}
            </UiButton>
          </section>

          {hasResolvedProductInfo ? (
            <section className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-text-muted">
                {t('commerceAd.agent.batchSection')}
              </h3>
              <label className="block text-xs text-text-muted">
                <span>{t('commerceAd.agent.imageProvider')}</span>
                <UiSelect
                  value={selectedImageModel.providerId}
                  className="mt-1"
                  onChange={(event) => handleImageProviderChange(event.target.value)}
                >
                  {imageProviderOptions.map((provider) => (
                    <option key={provider.id} value={provider.id}>
                      {provider.label}
                    </option>
                  ))}
                </UiSelect>
              </label>
              <label className="block text-xs text-text-muted">
                <span>{t('commerceAd.agent.imageModel')}</span>
                <UiSelect
                  value={selectedImageModel.id}
                  className="mt-1"
                  onChange={(event) => handleImageModelChange(event.target.value)}
                >
                  {selectedProviderImageModels.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.displayName}
                    </option>
                  ))}
                </UiSelect>
              </label>
              <label className="block text-xs text-text-muted">
                <span>{t('commerceAd.agent.resolution')}</span>
                <UiSelect
                  value={selectedResolution.value}
                  className="mt-1"
                  onChange={(event) => updateBatchConfig({ size: event.target.value })}
                >
                  {resolutionOptions.map((resolution) => (
                    <option key={resolution.value} value={resolution.value}>
                      {resolution.label}
                    </option>
                  ))}
                </UiSelect>
              </label>
              <div className="flex flex-wrap gap-2">
                {RATIO_OPTIONS.map((ratio) => {
                  const active = currentRatios.includes(ratio);
                  return (
                    <button
                      key={ratio}
                      type="button"
                      onClick={() => toggleRatio(ratio)}
                      className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs transition-colors ${
                        active
                          ? 'border-text-dark/30 bg-text-dark/10 text-text-dark'
                          : 'border-border-dark/70 bg-bg-dark text-text-muted hover:text-text-dark'
                      }`}
                    >
                      {active ? <Check className="h-3 w-3" /> : null}
                      {ratio}
                    </button>
                  );
                })}
              </div>
              <label className="block text-xs text-text-muted">
                <span>{t('commerceAd.agent.variantsPerRatio')}</span>
                <UiInput
                  type="number"
                  min={1}
                  max={8}
                  value={currentVariants}
                  className="mt-1"
                  onChange={(event) => updateBatchConfig({
                    variantsPerRatio: Math.max(1, Math.min(8, Number(event.target.value) || 1)),
                  })}
                />
              </label>
              <UiButton
                type="button"
                className="w-full gap-2"
                onClick={handleGenerate}
                disabled={isThinking}
              >
                <Sparkles className="h-4 w-4" />
                {t('commerceAd.agent.createBatch')}
              </UiButton>
            </section>
          ) : (
            <div className="rounded-lg border border-border-dark/70 bg-bg-dark/50 p-3 text-xs leading-5 text-text-muted">
              {t('commerceAd.agent.batchLockedHint')}
            </div>
          )}

          <section className="space-y-2">
            {messages.length === 0 ? (
              <div className="rounded-lg border border-border-dark/70 bg-bg-dark/50 p-3 text-sm leading-6 text-text-muted">
                <div className="font-medium text-text-dark">
                  {t('commerceAd.agent.guidance.emptyTitle')}
                </div>
                <p className="mt-1 text-xs leading-5 text-text-muted">
                  {t('commerceAd.agent.emptyConversation')}
                </p>
                <GuidanceCard
                  messageId="commerce-empty-guidance"
                  guidance={emptyGuidance}
                  selectedChoiceKeys={selectedGuidanceChoiceKeys}
                  onToggleChoice={handleGuidanceChoiceToggle}
                />
              </div>
            ) : messages.map((message) => (
              <div
                key={message.id}
                className={`rounded-lg border px-3 py-2 text-sm leading-6 ${
                  message.role === 'user'
                    ? 'border-text-dark/10 bg-text-dark/[0.08] text-text-dark'
                    : 'border-border-dark/70 bg-bg-dark/70 text-text-dark/90'
                }`}
              >
                <div className="whitespace-pre-wrap">{message.content}</div>
                {message.role === 'assistant' && message.guidance ? (
                  <GuidanceCard
                    messageId={message.id}
                    guidance={message.guidance}
                    selectedChoiceKeys={selectedGuidanceChoiceKeys}
                    onToggleChoice={handleGuidanceChoiceToggle}
                  />
                ) : null}
              </div>
            ))}
          </section>
        </div>

        <div className="border-t border-border-dark/70 p-3">
          {statusText ? (
            <div className="mb-2 text-xs text-text-muted">{statusText}</div>
          ) : null}
          <div className="flex gap-2">
            <UiTextAreaField
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              rows={2}
              placeholder={t('commerceAd.agent.chatPlaceholder')}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  handleSubmit();
                }
              }}
            />
            <UiButton
              type="button"
              className="h-auto w-12 shrink-0 px-0"
              onClick={handleSubmit}
              disabled={!draft.trim() || isThinking}
              aria-label={t('commerceAd.agent.send')}
            >
              {isThinking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </UiButton>
          </div>
        </div>
      </aside>
    </div>
  );
}

export function CommerceAdProjectWorkspace() {
  return (
    <ReactFlowProvider>
      <CommerceAdWorkspaceInner />
    </ReactFlowProvider>
  );
}
