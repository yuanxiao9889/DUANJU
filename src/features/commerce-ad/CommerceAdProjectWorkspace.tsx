import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type ClipboardEvent as ReactClipboardEvent, type DragEvent as ReactDragEvent } from 'react';
import { ReactFlowProvider, useReactFlow } from '@xyflow/react';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  Images,
  ImagePlus,
  Loader2,
  Megaphone,
  MessageSquareText,
  PackageCheck,
  Plus,
  Send,
  Settings,
  Shirt,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { UiButton, UiInput, UiModal, UiSelect, UiTextAreaField } from '@/components/ui';
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
  type CanvasNodeData,
  type CommerceAgentPlanNodeData,
  type CommerceBatchGenerateNodeData,
  type CommerceBriefNodeData,
  type CommerceProductNodeData,
  type CommerceResultGroupNodeData,
  type CommerceVisualPreferenceNodeData,
} from '@/features/canvas/domain/canvasNodes';
import {
  applyCommerceAdAgentActions,
  type CommerceAdCanvasActionsContext,
  type CommerceAdAgentActionOptions,
} from '@/features/commerce-ad/application/commerceAdCanvasActions';
import {
  isLikelyVisionTextModel,
  runCommerceAdAgentTurn,
} from '@/features/commerce-ad/application/commerceAdAgent';
import {
  BRAND_ACCENT_PRESETS,
  VISUAL_PREFERENCE_OPTION_KEYS,
  buildVisualPreferencePatch,
  composeVisualPreferenceSummary,
} from '@/features/commerce-ad/application/commerceAdVisualPreference';
import {
  createDefaultCommerceAdBriefState,
  createDefaultCommerceAgentPlanState,
  createDefaultCommerceAdProductState,
  createDefaultCommerceAdResultGroupState,
  createDefaultCommerceAdVisualPreferenceState,
  normalizeCommerceAdVisualPreferenceState,
  type CommerceAdAgentMessage,
  type CommerceAdAgentAction,
  type CommerceAdAgentGuidance,
  type CommerceAdBatchGenerateState,
  type CommerceAdDetailPage,
  type CommerceAdGeneratedImageRecord,
  type CommerceAdGenerationBatch,
  type CommerceAdProductImage,
  type CommerceAdProductState,
  type CommerceAdVisualPreferenceState,
  type CommerceAgentPlanState,
  type CommerceAgentSkill,
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

const COMMERCE_AGENT_PRODUCT_INFO_COLLAPSED_STORAGE_KEY = 'commerce-agent-product-info-collapsed';
const COMMERCE_AGENT_VISUAL_PREFERENCE_COLLAPSED_STORAGE_KEY = 'commerce-agent-visual-preference-collapsed';
const COMMERCE_AGENT_BATCH_SETTINGS_COLLAPSED_STORAGE_KEY = 'commerce-agent-batch-settings-collapsed';
const COMMERCE_AGENT_ACTIVE_MODULE_STORAGE_KEY = 'commerce-agent-active-module';
const COMMERCE_START_IMAGE_GENERATION_EVENT = 'commerce-ad:start-image-generation';
const COMMERCE_START_AGENT_PLAN_GENERATION_EVENT = 'commerce-ad:start-agent-plan-generation';
const COMMERCE_RETRY_IMAGE_GENERATION_EVENT = 'commerce-ad:retry-image-generation';
const COMMERCE_SYNC_DOWNSTREAM_EVENT = 'commerce-ad:sync-downstream';
const COMMERCE_INFER_PRODUCT_EVENT = 'commerce-ad:infer-product';
const COMMERCE_UPLOAD_PRODUCT_IMAGE_EVENT = 'commerce-ad:upload-product-image';
const DEFAULT_AGENT_MESSAGES: CommerceAdAgentMessage[] = [];
const COMMERCE_DEFAULT_IMAGE_MODEL_ID = STORYBOARD_OOPII_MODEL_ID;
const COMMERCE_DEFAULT_RESOLUTION = '2K';
const COMMERCE_PRODUCT_REFERENCE_IMAGE_LIMIT = 5;
const COMMERCE_AGENT_MODULES = [
  { id: 'detailPage', icon: PackageCheck },
  { id: 'productImageOptimize', icon: Sparkles },
  { id: 'modelTryOn', icon: Shirt },
  { id: 'campaignPoster', icon: Megaphone },
  { id: 'sceneImage', icon: Images },
] as const;
const COMMERCE_AGENT_SKILLS: CommerceAgentSkill[] = [];
type CommerceAgentModuleId = (typeof COMMERCE_AGENT_MODULES)[number]['id'];
type CommerceAgentTask =
  | 'chat'
  | 'syncProductInfo'
  | 'inferProduct'
  | 'paginateDetailPages';

function readStoredBoolean(key: string, fallback: boolean): boolean {
  if (typeof window === 'undefined') {
    return fallback;
  }

  const raw = window.localStorage.getItem(key);
  return raw === null ? fallback : raw === 'true';
}

function isCommerceAgentModuleId(value: string | null): value is CommerceAgentModuleId {
  return COMMERCE_AGENT_MODULES.some((module) => module.id === value);
}

function readActiveCommerceAgentModule(): CommerceAgentModuleId {
  if (typeof window === 'undefined') {
    return 'detailPage';
  }

  const raw = window.localStorage.getItem(COMMERCE_AGENT_ACTIVE_MODULE_STORAGE_KEY);
  return isCommerceAgentModuleId(raw) ? raw : 'detailPage';
}

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

function resolveActiveStageNode<T extends CanvasNode['data']>(
  nodes: CanvasNode[],
  type: CanvasNode['type'],
  selectedNodeId: string | null
): (CanvasNode & { data: T }) | null {
  const matchingNodes = nodes.filter((node) => node.type === type);
  if (matchingNodes.length === 0) {
    return null;
  }

  const selectedMatch = selectedNodeId
    ? matchingNodes.find((node) => node.id === selectedNodeId)
    : null;
  if (selectedMatch) {
    return selectedMatch as CanvasNode & { data: T };
  }

  const markedSelectedMatch = matchingNodes.find((node) => node.selected);
  if (markedSelectedMatch) {
    return markedSelectedMatch as CanvasNode & { data: T };
  }

  return matchingNodes[matchingNodes.length - 1] as CanvasNode & { data: T };
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
    detailInputMode: product?.detailInputMode ?? 'auto',
    lockedDocumentInfo: product?.lockedDocumentInfo ?? '',
    userIdeaInfo: product?.userIdeaInfo ?? product?.userInfo ?? '',
    userInfo: product?.userInfo ?? '',
    inference: product?.inference ?? null,
    lastAnalyzedAt: product?.lastAnalyzedAt ?? null,
    lastError: null,
  };
}

function normalizeProductImageRoles(images: CommerceAdProductImage[]): CommerceAdProductImage[] {
  return images.map((image, index) => ({
    ...image,
    kind: index === 0 ? 'main' : 'reference',
    evidenceTags: image.evidenceTags ?? [],
  }));
}

function composeProductUserInfo(lockedDocumentInfo: string, userIdeaInfo: string): string {
  return [
    lockedDocumentInfo.trim()
      ? `文档信息（不可改）：\n${lockedDocumentInfo.trim()}`
      : '',
    userIdeaInfo.trim()
      ? `想法补充（AI 可优化）：\n${userIdeaInfo.trim()}`
      : '',
  ].filter(Boolean).join('\n\n');
}

function composeProductImageReferenceNotes(images: CommerceAdProductImage[]): string {
  return images
    .slice(0, COMMERCE_PRODUCT_REFERENCE_IMAGE_LIMIT)
    .map((image, index) => {
      const role = index === 0 ? '主图' : `参考图 ${index}`;
      const description = image.description?.trim();
      return description ? `${role}：${description}` : '';
    })
    .filter(Boolean)
    .join('\n');
}

function isInternalProductInfoMessage(message: CommerceAdAgentMessage): boolean {
  if (message.role !== 'user') {
    return false;
  }

  const content = message.content.trim();
  return content.startsWith('文档信息（不可改）：')
    || content.startsWith('Document copy (locked):');
}

function createImageChangedProductState(
  images: CommerceAdProductImage[],
  lockedDocumentInfo: string,
  userIdeaInfo: string,
  detailInputMode: CommerceAdProductState['detailInputMode'] = 'auto'
): CommerceAdProductState {
  return {
    images: normalizeProductImageRoles(images),
    brand: '',
    productName: '',
    category: '',
    detailInputMode,
    lockedDocumentInfo,
    userIdeaInfo,
    userInfo: composeProductUserInfo(lockedDocumentInfo, userIdeaInfo),
    inference: null,
    lastAnalyzedAt: null,
    lastError: null,
  };
}

function resolveCommerceDefaultResolution(
  model: Parameters<typeof resolveImageModelResolutions>[0]
): string {
  const resolutions = resolveImageModelResolutions(model, { extraParams: {} });
  return (
    resolutions.find((item) => item.value === COMMERCE_DEFAULT_RESOLUTION)?.value
    ?? resolutions.find((item) => item.value === model.defaultResolution)?.value
    ?? resolutions[0]?.value
    ?? model.defaultResolution
  );
}

function resolveCommerceAspectRatiosForModel(
  model: Parameters<typeof resolveImageModelResolutions>[0],
  preferredRatios: string[]
): string[] {
  const ratioOptions = model.aspectRatios;
  const supportedRatios = new Set(ratioOptions.map((item) => item.value));
  const selectedRatios = preferredRatios.filter((ratio) => supportedRatios.has(ratio));

  if (selectedRatios.length > 0) {
    return selectedRatios;
  }

  const defaultRatio = supportedRatios.has(model.defaultAspectRatio)
    ? model.defaultAspectRatio
    : ratioOptions[0]?.value;
  return defaultRatio ? [defaultRatio] : ['1:1'];
}

function normalizeDetailPagesForEditing(pages: CommerceAdDetailPage[]): CommerceAdDetailPage[] {
  return pages.map((page, index) => ({
    ...page,
    id: page.id || `commerce-detail-page-${Date.now()}-${index + 1}`,
    pageNo: index + 1,
  }));
}

function createDetailPageDraft(partial: Partial<CommerceAdDetailPage> = {}): CommerceAdDetailPage {
  return {
    id: partial.id || `commerce-detail-page-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    pageNo: partial.pageNo ?? 1,
    title: partial.title ?? '',
    pageGoal: partial.pageGoal ?? '',
    lockedCopy: partial.lockedCopy ?? '',
    optimizedCopy: partial.optimizedCopy ?? '',
    layoutNotes: partial.layoutNotes ?? '',
    blueprint: partial.blueprint ?? '',
    referenceImageIds: partial.referenceImageIds ?? [],
    qualityNotes: partial.qualityNotes ?? [],
    prompt: partial.prompt ?? '',
  };
}

function hasLockedDetailPageInfo(pages: CommerceAdDetailPage[]): boolean {
  return pages.some((page) => page.lockedCopy.trim().length > 0);
}

function composeManualDetailPagesLockedInfo(pages: CommerceAdDetailPage[]): string {
  return normalizeDetailPagesForEditing(pages)
    .map((page) => ({
      pageNo: page.pageNo,
      lockedCopy: page.lockedCopy.trim(),
    }))
    .filter((page) => page.lockedCopy.length > 0)
    .map((page) => `第 ${page.pageNo} 页：\n${page.lockedCopy}`)
    .join('\n\n');
}

function composeDetailPagePrompt(
  page: CommerceAdDetailPage,
  corePrompt: string,
  visualPreference: CommerceAdVisualPreferenceState | null | undefined,
  imageReferenceNotes = ''
): string {
  return [
    corePrompt.trim(),
    `详情页第 ${page.pageNo} 页：${page.title || '未命名页面'}`,
    page.lockedCopy.trim()
      ? `必须原样出现在画面上的文档信息，不得改写：\n${page.lockedCopy.trim()}`
      : '',
    page.optimizedCopy.trim()
      ? `可优化表达后的说明文案：\n${page.optimizedCopy.trim()}`
      : '',
    page.layoutNotes.trim()
      ? `版式备注：${page.layoutNotes.trim()}`
      : '',
    page.prompt.trim(),
    visualPreference?.promptFragment?.trim() ?? '',
    imageReferenceNotes.trim()
      ? `商品参考图说明：\n${imageReferenceNotes.trim()}`
      : '',
    '生成电商详情页分页图片，页面信息层级清晰，商品主体准确，画面文字必须清晰可读。',
  ].filter(Boolean).join('\n\n');
}

function buildDetailPageGenerationBatch(
  batch: CommerceBatchGenerateNodeData | null,
  corePrompt: string,
  detailPages: CommerceAdDetailPage[],
  visualPreference: CommerceAdVisualPreferenceState | null | undefined,
  imageReferenceNotes = ''
): CommerceAdGenerationBatch {
  const aspectRatios = batch?.aspectRatios?.length ? batch.aspectRatios : ['4:5'];
  const variantsPerRatio = Math.max(1, Math.min(8, Math.round(Number(batch?.variantsPerRatio) || 1)));
  const batchCount = Math.max(1, Math.min(20, Math.round(Number(batch?.batchCount) || 1)));
  const batchId = `commerce-batch-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const pages = normalizeDetailPagesForEditing(detailPages);
  const images: CommerceAdGeneratedImageRecord[] = pages.flatMap((page) => (
    aspectRatios.flatMap((aspectRatio) => (
      Array.from({ length: batchCount }, (_, batchIndex) => (
        Array.from({ length: variantsPerRatio }, (_, variantIndex): CommerceAdGeneratedImageRecord => ({
          id: [
            batchId,
            `page-${page.pageNo}`,
            `ratio-${aspectRatio.replace(/[^a-z0-9]+/gi, '-')}`,
            `batch-${batchIndex + 1}`,
            `variant-${variantIndex + 1}`,
          ].join('-'),
          aspectRatio,
          detailPageId: page.id,
          detailPageNo: page.pageNo,
          detailPageTitle: [
            page.title,
            aspectRatio,
            batchCount > 1 ? `批次 ${batchIndex + 1}` : '',
            variantsPerRatio > 1 ? `第 ${variantIndex + 1} 张` : '',
          ].filter(Boolean).join(' · '),
          nodeId: null,
          prompt: composeDetailPagePrompt(
            page,
            batch?.ratioPrompts?.[aspectRatio] || corePrompt,
            visualPreference,
            imageReferenceNotes
          ),
          status: 'queued',
          imageUrl: null,
          previewImageUrl: null,
          error: null,
        }))
      )).flat()
    ))
  ));

  return {
    id: batchId,
    createdAt: Date.now(),
    corePrompt,
    aspectRatios,
    variantsPerRatio,
    batchCount,
    generationMode: 'detailPages',
    detailPageCount: pages.length,
    detailPages: pages,
    images,
  };
}

function buildAgentPlanGenerationBatch(plan: CommerceAgentPlanState): CommerceAdGenerationBatch {
  const aspectRatios = plan.aspectRatios.length > 0 ? plan.aspectRatios : ['4:5'];
  const variantsPerRatio = Math.max(1, Math.min(8, Math.round(Number(plan.variantsPerRatio) || 1)));
  const batchCount = Math.max(1, Math.min(20, Math.round(Number(plan.batchCount) || 1)));
  const batchId = `commerce-agent-plan-batch-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const images: CommerceAdGeneratedImageRecord[] = aspectRatios.flatMap((aspectRatio) => (
    Array.from({ length: batchCount }, (_, batchIndex) => (
      Array.from({ length: variantsPerRatio }, (_, variantIndex): CommerceAdGeneratedImageRecord => ({
        id: [
          batchId,
          `ratio-${aspectRatio.replace(/[^a-z0-9]+/gi, '-')}`,
          `batch-${batchIndex + 1}`,
          `variant-${variantIndex + 1}`,
        ].join('-'),
        aspectRatio,
        detailPageTitle: [
          aspectRatio,
          batchCount > 1 ? `Batch ${batchIndex + 1}` : '',
          variantsPerRatio > 1 ? `Variant ${variantIndex + 1}` : '',
        ].filter(Boolean).join(' / '),
        nodeId: null,
        prompt: plan.prompt,
        status: 'queued',
        imageUrl: null,
        previewImageUrl: null,
        error: null,
      }))
    )).flat()
  ));

  return {
    id: batchId,
    createdAt: Date.now(),
    corePrompt: plan.prompt,
    aspectRatios,
    variantsPerRatio,
    batchCount,
    generationMode: 'legacyRatios',
    detailPageCount: 0,
    detailPages: [],
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
    product.lockedDocumentInfo,
    product.userIdeaInfo,
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

function composeAgentPlanState(input: {
  text: string;
  images: CommerceAdProductImage[];
  selectedSkillId: string;
  resultActions: CommerceAdAgentAction[];
  fallbackModelId: string;
  fallbackProviderId: string;
  fallbackSize: string;
  fallbackRatios: string[];
}): CommerceAgentPlanState {
  const productAction = input.resultActions.find((action) => action.type === 'upsertProduct');
  const briefAction = input.resultActions.find((action) => action.type === 'upsertBrief');
  const batchAction = input.resultActions.find((action) => action.type === 'upsertBatchGenerate');
  const product = productAction?.type === 'upsertProduct' ? productAction.data : null;
  const brief = briefAction?.type === 'upsertBrief' ? briefAction.data : null;
  const batch = batchAction?.type === 'upsertBatchGenerate' ? batchAction.data : null;
  const defaultPlan = createDefaultCommerceAgentPlanState();
  const prompt = [
    batch?.corePrompt,
    brief?.normalizedBrief,
    brief?.headline,
    input.text,
  ].find((value) => value?.trim())?.trim() ?? '';
  const riskNotes = dedupeStrings([
    ...(product?.inference?.uncertaintyNotes ?? []),
    ...(product?.inference?.followUpQuestions ?? []),
    ...(brief?.qualityIssues ?? []),
  ]);

  return {
    ...defaultPlan,
    summary: brief?.normalizedBrief || brief?.headline || input.text,
    productUnderstanding: product?.inference?.summary || product?.userInfo || input.text,
    creativeDirection: [
      brief?.platform,
      brief?.audience,
      brief?.style,
      ...(brief?.sellingPoints ?? []).slice(0, 4),
    ].filter(Boolean).join('\n'),
    prompt,
    referenceImages: input.images,
    referenceImageNotes: composeProductImageReferenceNotes(input.images),
    riskNotes,
    selectedSkillId: input.selectedSkillId,
    providerId: batch?.modelId ? input.fallbackProviderId : input.fallbackProviderId,
    modelId: batch?.modelId || input.fallbackModelId,
    size: batch?.size || input.fallbackSize,
    aspectRatios: batch?.aspectRatios?.length ? batch.aspectRatios : input.fallbackRatios,
    variantsPerRatio: batch?.variantsPerRatio ?? 1,
    batchCount: batch?.batchCount ?? 1,
    status: prompt ? 'ready' : 'idle',
    lastError: null,
  };
}

function VisionModelWarningBar({
  isOpen,
  onToggle,
  onOpenSettings,
}: {
  isOpen: boolean;
  onToggle: () => void;
  onOpenSettings: () => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="pointer-events-none absolute left-4 top-4 z-[96] w-[min(420px,calc(100%-2rem))]">
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onToggle();
        }}
        className="pointer-events-auto flex h-8 w-full items-center gap-2 rounded-md border border-amber-300/40 bg-surface-dark/92 px-3 text-left text-xs font-medium text-amber-100 shadow-[0_16px_40px_rgba(0,0,0,0.26)] backdrop-blur transition-colors hover:border-amber-300/60 hover:bg-amber-500/12"
        aria-expanded={isOpen}
      >
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate">
          {t('commerceAd.agent.visionWarningTitle')}
        </span>
      </button>

      {isOpen ? (
        <div
          className="pointer-events-auto mt-2 rounded-lg border border-amber-400/30 bg-surface-dark/96 p-3 text-sm text-amber-100 shadow-[0_20px_60px_rgba(0,0,0,0.32)] backdrop-blur"
          onClick={(event) => event.stopPropagation()}
        >
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
                onClick={onOpenSettings}
              >
                <Settings className="h-3.5 w-3.5" />
                {t('commerceAd.agent.openModelSettings')}
              </UiButton>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function CommerceAgentModuleSwitcher({
  activeModule,
  onChange,
}: {
  activeModule: CommerceAgentModuleId;
  onChange: (moduleId: CommerceAgentModuleId) => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-6 z-[95] flex justify-center px-4">
      <div className="pointer-events-auto flex max-w-[calc(100%-2rem)] items-center gap-1 overflow-x-auto rounded-lg border border-border-dark/70 bg-surface-dark/92 p-1 shadow-[0_16px_42px_rgba(0,0,0,0.32)] backdrop-blur">
        {COMMERCE_AGENT_MODULES.map((module) => {
          const Icon = module.icon;
          const active = activeModule === module.id;
          return (
            <button
              key={module.id}
              type="button"
              aria-pressed={active}
              title={t(`commerceAd.agent.modules.${module.id}.title`)}
              onClick={() => onChange(module.id)}
              className={`inline-flex h-10 shrink-0 items-center gap-2 rounded-md border px-3 text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-accent/45 ${
                active
                  ? 'border-accent/50 bg-accent/18 text-text-dark shadow-[0_0_0_1px_rgba(59,130,246,0.18)]'
                  : 'border-transparent text-text-muted hover:bg-text-dark/8 hover:text-text-dark'
              }`}
            >
              <Icon className="h-4 w-4" />
              <span className="whitespace-nowrap">{t(`commerceAd.agent.modules.${module.id}.label`)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function CommerceDetailPageSetupModal({
  isOpen,
  onClose,
  activeModuleTitle,
  productImages,
  isProductImageLimitReached,
  uploading,
  isThinking,
  isSyncProductInfoRunning,
  isProductInfoCollapsed,
  isVisualPreferenceCollapsed,
  isBatchSettingsCollapsed,
  detailInputMode,
  lockedDocumentInfo,
  userIdeaInfo,
  detailPages,
  hasManualPageLockedInfo,
  visualPreferenceDraft,
  visualPreferenceSummary,
  imageProviderOptions,
  selectedImageModel,
  selectedProviderImageModels,
  selectedResolution,
  resolutionOptions,
  ratioOptions,
  currentRatios,
  currentVariantsPerRatio,
  currentBatchCount,
  canCreateDetailPageBatch,
  productionSummary,
  detailPageCount,
  plannedImageCount,
  fileInputRef,
  replaceFileInputRef,
  userIdeaInfoRef,
  productInfoContentRef,
  visualPreferenceContentRef,
  batchSettingsContentRef,
  onFilesSelected,
  onReplaceProductImageSelected,
  onUploadClick,
  onReplaceProductImageClick,
  onDeleteProductImage,
  onUpdateProductImageDescription,
  onToggleProductInfoCollapsed,
  onToggleVisualPreferenceCollapsed,
  onToggleBatchSettingsCollapsed,
  onDetailInputModeChange,
  onLockedDocumentInfoChange,
  onUserIdeaInfoChange,
  onAddDetailPage,
  onDeleteDetailPage,
  onMoveDetailPage,
  onUpdateDetailPage,
  onUpdateVisualPreference,
  onImageProviderChange,
  onImageModelChange,
  onTogglePageRatio,
  onUpdateBatchConfig,
  onGenerateNodeInfo,
}: {
  isOpen: boolean;
  onClose: () => void;
  activeModuleTitle: string;
  productImages: CommerceAdProductImage[];
  isProductImageLimitReached: boolean;
  uploading: boolean;
  isThinking: boolean;
  isSyncProductInfoRunning: boolean;
  isProductInfoCollapsed: boolean;
  isVisualPreferenceCollapsed: boolean;
  isBatchSettingsCollapsed: boolean;
  detailInputMode: CommerceAdProductState['detailInputMode'];
  lockedDocumentInfo: string;
  userIdeaInfo: string;
  detailPages: CommerceAdDetailPage[];
  hasManualPageLockedInfo: boolean;
  hasResolvedProductInfo: boolean;
  visualPreferenceDraft: CommerceAdVisualPreferenceState;
  visualPreferenceSummary: string;
  imageProviderOptions: Array<{ id: string; label: string }>;
  selectedImageModel: ReturnType<typeof getImageModel>;
  selectedProviderImageModels: Array<ReturnType<typeof getImageModel>>;
  selectedResolution: ReturnType<typeof resolveImageModelResolution>;
  resolutionOptions: ReturnType<typeof resolveImageModelResolutions>;
  ratioOptions: ReturnType<typeof getImageModel>['aspectRatios'];
  currentRatios: string[];
  currentVariantsPerRatio: number;
  currentBatchCount: number;
  canCreateDetailPageBatch: boolean;
  productionSummary: string;
  detailPageCount: number;
  plannedImageCount: number;
  fileInputRef: React.Ref<HTMLInputElement>;
  replaceFileInputRef: React.Ref<HTMLInputElement>;
  userIdeaInfoRef: React.Ref<HTMLTextAreaElement>;
  productInfoContentRef: React.RefObject<HTMLElement | null>;
  visualPreferenceContentRef: React.RefObject<HTMLElement | null>;
  batchSettingsContentRef: React.RefObject<HTMLElement | null>;
  onFilesSelected: (event: ChangeEvent<HTMLInputElement>) => void;
  onReplaceProductImageSelected: (event: ChangeEvent<HTMLInputElement>) => void;
  onUploadClick: () => void;
  onReplaceProductImageClick: (imageId: string) => void;
  onDeleteProductImage: (imageId: string) => void;
  onUpdateProductImageDescription: (imageId: string, description: string) => void;
  onToggleProductInfoCollapsed: () => void;
  onToggleVisualPreferenceCollapsed: () => void;
  onToggleBatchSettingsCollapsed: () => void;
  onDetailInputModeChange: (mode: CommerceAdProductState['detailInputMode']) => void;
  onLockedDocumentInfoChange: (value: string) => void;
  onUserIdeaInfoChange: (value: string) => void;
  onAddDetailPage: () => void;
  onDeleteDetailPage: (pageId: string) => void;
  onMoveDetailPage: (pageId: string, direction: -1 | 1) => void;
  onUpdateDetailPage: (pageId: string, data: Partial<Omit<CommerceAdDetailPage, 'id' | 'pageNo'>>) => void;
  onUpdateVisualPreference: (data: Partial<CommerceAdVisualPreferenceState>) => void;
  onImageProviderChange: (providerId: string) => void;
  onImageModelChange: (modelId: string) => void;
  onTogglePageRatio: (ratio: string) => void;
  onUpdateBatchConfig: (data: Partial<CommerceAdBatchGenerateState>) => void;
  onGenerateNodeInfo: () => void;
}) {
  const { t } = useTranslation();
  const isGeneratingNodeInfo = isSyncProductInfoRunning;

  return (
    <UiModal
      isOpen={isOpen}
      title={activeModuleTitle}
      onClose={onClose}
      widthClassName="w-[min(1080px,calc(100vw-48px))]"
      bodyClassName="ui-scrollbar flex-1 overflow-y-auto"
      footer={
        <>
          <UiButton
            type="button"
            variant="ghost"
            onClick={onClose}
            disabled={isGeneratingNodeInfo}
          >
            {t('common.cancel')}
          </UiButton>
          <UiButton
            type="button"
            className="gap-2"
            onClick={onGenerateNodeInfo}
            disabled={
              (detailInputMode === 'auto'
                ? !(lockedDocumentInfo.trim() || userIdeaInfo.trim() || productImages.length > 0)
                : !(hasManualPageLockedInfo || userIdeaInfo.trim() || productImages.length > 0))
              || isThinking
            }
          >
            {isGeneratingNodeInfo ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {isGeneratingNodeInfo
              ? t('commerceAd.agent.generatingNodeInfo')
              : t('commerceAd.agent.generateNodeInfo')}
          </UiButton>
        </>
      }
    >
      {isGeneratingNodeInfo ? (
        <div className="mb-4 flex items-start gap-3 rounded-lg border border-text-dark/15 bg-text-dark/[0.06] px-3 py-2.5 text-xs leading-5 text-text-muted">
          <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-text-dark" />
          <div>
            <div className="font-medium text-text-dark">
              {t('commerceAd.agent.generatingNodeInfoTitle')}
            </div>
            <div className="mt-0.5">
              {t('commerceAd.agent.generatingNodeInfoHint')}
            </div>
          </div>
        </div>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.05fr)_minmax(320px,0.95fr)]">
        <div className="space-y-4">
          <section className="rounded-lg border border-border-dark/70 bg-bg-dark/35 p-3">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-text-dark">
                  {t('commerceAd.agent.productSection')}
                </h3>
                <p className="mt-1 text-xs leading-5 text-text-muted">
                  {t('commerceAd.agent.productSectionHint', {
                    limit: COMMERCE_PRODUCT_REFERENCE_IMAGE_LIMIT,
                  })}
                </p>
              </div>
              <UiButton
                type="button"
                size="sm"
                className="shrink-0 gap-2"
                onClick={onUploadClick}
                disabled={uploading || isProductImageLimitReached}
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
              onChange={onFilesSelected}
            />
            <input
              ref={replaceFileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={onReplaceProductImageSelected}
            />
            <div className="space-y-2">
              {productImages.slice(0, COMMERCE_PRODUCT_REFERENCE_IMAGE_LIMIT).map((image, index) => (
                <div
                  key={image.id}
                  className="group flex gap-2 rounded-lg border border-border-dark/70 bg-bg-dark p-2"
                >
                  <div className="relative h-[72px] w-[72px] shrink-0 overflow-hidden rounded-md border border-border-dark/60 bg-black/20">
                    <img
                      src={resolveImageDisplayUrl(image.previewImageUrl || image.imageUrl)}
                      alt={image.label}
                      className="h-full w-full object-contain"
                      draggable={false}
                    />
                    <span className="absolute left-1 top-1 rounded-full bg-black/65 px-1.5 py-0.5 text-[10px] font-medium text-white">
                      {index === 0
                        ? t('commerceAd.agent.productImageRoleMain')
                        : t('commerceAd.agent.productImageRoleReference', { index })}
                    </span>
                    <div className="absolute inset-0 flex items-start justify-end gap-1 bg-black/0 p-1 opacity-0 transition group-hover:bg-black/30 group-hover:opacity-100 group-focus-within:bg-black/30 group-focus-within:opacity-100">
                      <button
                        type="button"
                        className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-white/20 bg-black/65 text-white shadow-sm transition hover:bg-black/85 focus:outline-none focus:ring-2 focus:ring-white/60 disabled:cursor-not-allowed disabled:opacity-50"
                        onClick={() => onReplaceProductImageClick(image.id)}
                        disabled={uploading || isThinking}
                        title={t('commerceAd.agent.replaceProductImage')}
                        aria-label={t('commerceAd.agent.replaceProductImage')}
                      >
                        <ArrowUp className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-white/20 bg-black/65 text-white shadow-sm transition hover:bg-red-500/90 focus:outline-none focus:ring-2 focus:ring-white/60 disabled:cursor-not-allowed disabled:opacity-50"
                        onClick={() => onDeleteProductImage(image.id)}
                        disabled={uploading || isThinking}
                        title={t('commerceAd.agent.deleteProductImage')}
                        aria-label={t('commerceAd.agent.deleteProductImage')}
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                  <UiTextAreaField
                    value={image.description ?? ''}
                    rows={3}
                    className="min-h-[72px] flex-1 px-2 py-1.5 text-xs leading-5"
                    onChange={(event) => onUpdateProductImageDescription(image.id, event.target.value)}
                    placeholder={t('commerceAd.agent.productImageDescriptionPlaceholder')}
                  />
                </div>
              ))}
              {!isProductImageLimitReached ? (
                <button
                  type="button"
                  className="flex min-h-[72px] w-full items-center justify-center gap-2 rounded-lg border border-dashed border-border-dark/80 bg-bg-dark/45 text-sm text-text-muted transition hover:border-text-dark/40 hover:bg-text-dark/[0.06] hover:text-text-dark focus:outline-none focus:ring-2 focus:ring-text-dark/20 disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={onUploadClick}
                  disabled={uploading || isThinking}
                >
                  {uploading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Plus className="h-5 w-5" />}
                  {t('commerceAd.agent.addProductReferenceImage', {
                    limit: COMMERCE_PRODUCT_REFERENCE_IMAGE_LIMIT,
                  })}
                </button>
              ) : null}
            </div>
          </section>

          <section className="rounded-lg border border-border-dark/70 bg-bg-dark/35 p-3">
            <button
              type="button"
              className="flex w-full items-start gap-2 text-left"
              onClick={onToggleProductInfoCollapsed}
              aria-expanded={!isProductInfoCollapsed}
            >
              {isProductInfoCollapsed ? (
                <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-text-muted" />
              ) : (
                <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-text-muted" />
              )}
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-text-dark">
                  {t('commerceAd.agent.productInfoTitle')}
                </span>
                <span className="mt-1 block text-xs leading-5 text-text-muted">
                  {isProductInfoCollapsed && (lockedDocumentInfo.trim() || userIdeaInfo.trim())
                    ? t('commerceAd.agent.productInfoCollapsedFilled')
                    : t('commerceAd.agent.productInfoHint')}
                </span>
              </span>
            </button>
            {!isProductInfoCollapsed ? (
              <div ref={productInfoContentRef as React.RefObject<HTMLDivElement>} className="mt-3 space-y-3">
                <div className="inline-grid w-full grid-cols-2 gap-1.5 rounded-full bg-bg-dark/35 p-0.5">
                  {(['auto', 'manualPages'] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => onDetailInputModeChange(mode)}
                      className={`inline-flex h-8 items-center justify-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors ${
                        detailInputMode === mode
                          ? 'border-text-dark/25 bg-surface-dark text-text-dark shadow-[0_6px_18px_rgba(0,0,0,0.18)]'
                          : 'border-transparent text-text-muted hover:bg-text-dark/[0.05] hover:text-text-dark'
                      }`}
                    >
                      <span className={`h-1.5 w-1.5 rounded-full ${
                        detailInputMode === mode ? 'bg-text-dark' : 'bg-text-muted/45'
                      }`} />
                      {t(`commerceAd.agent.detailInputMode.${mode}`)}
                    </button>
                  ))}
                </div>
                {detailInputMode === 'auto' ? (
                  <>
                    <label className="block space-y-1.5 text-xs text-text-muted">
                      <span>{t('commerceAd.agent.lockedDocumentInfoLabel')}</span>
                      <UiTextAreaField
                        value={lockedDocumentInfo}
                        onChange={(event) => onLockedDocumentInfoChange(event.target.value)}
                        rows={5}
                        placeholder={t('commerceAd.agent.lockedDocumentInfoPlaceholder')}
                      />
                    </label>
                    <label className="block space-y-1.5 text-xs text-text-muted">
                      <span>{t('commerceAd.agent.userIdeaInfoLabel')}</span>
                      <UiTextAreaField
                        ref={userIdeaInfoRef}
                        value={userIdeaInfo}
                        onChange={(event) => onUserIdeaInfoChange(event.target.value)}
                        rows={4}
                        placeholder={t('commerceAd.agent.userIdeaInfoPlaceholder')}
                      />
                    </label>
                  </>
                ) : (
                  <div className="space-y-3">
                    <div className="rounded-lg border border-border-dark/70 bg-bg-dark/45 px-3 py-2 text-xs leading-5 text-text-muted">
                      {t('commerceAd.agent.detailInputMode.manualHint')}
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-xs font-medium text-text-dark">
                        {t('commerceAd.agent.detailPages.manualFixedInfoTitle')}
                      </div>
                      <UiButton type="button" size="sm" className="gap-1.5" onClick={onAddDetailPage}>
                        <Plus className="h-3.5 w-3.5" />
                        {t('commerceAd.agent.detailPages.addFixedInfo')}
                      </UiButton>
                    </div>
                    {detailPages.length > 0 ? (
                      <div className="space-y-2">
                        {detailPages.map((page, index) => (
                          <div key={page.id} className="rounded-lg border border-border-dark/70 bg-bg-dark/45 p-2">
                            <div className="mb-2 flex items-center justify-between gap-2">
                              <div className="text-xs font-medium text-text-dark">
                                {t('commerceAd.agent.detailPages.pageBadge', { page: index + 1 })}
                              </div>
                              <div className="flex gap-1">
                                <button
                                  type="button"
                                  className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border-dark/70 text-text-muted hover:text-text-dark disabled:opacity-40"
                                  onClick={() => onMoveDetailPage(page.id, -1)}
                                  disabled={index === 0}
                                  aria-label={t('commerceAd.agent.detailPages.moveUp')}
                                >
                                  <ArrowUp className="h-3.5 w-3.5" />
                                </button>
                                <button
                                  type="button"
                                  className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border-dark/70 text-text-muted hover:text-text-dark disabled:opacity-40"
                                  onClick={() => onMoveDetailPage(page.id, 1)}
                                  disabled={index === detailPages.length - 1}
                                  aria-label={t('commerceAd.agent.detailPages.moveDown')}
                                >
                                  <ArrowDown className="h-3.5 w-3.5" />
                                </button>
                                <button
                                  type="button"
                                  className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-rose-300/30 text-rose-100 hover:bg-rose-500/10"
                                  onClick={() => onDeleteDetailPage(page.id)}
                                  aria-label={t('commerceAd.agent.detailPages.delete')}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            </div>
                            <UiInput
                              value={page.title}
                              className="mb-2"
                              onChange={(event) => onUpdateDetailPage(page.id, { title: event.target.value })}
                              placeholder={t('commerceAd.agent.detailPages.pageTitlePlaceholder')}
                            />
                            <UiTextAreaField
                              value={page.lockedCopy}
                              rows={3}
                              onChange={(event) => onUpdateDetailPage(page.id, { lockedCopy: event.target.value })}
                              placeholder={t('commerceAd.agent.detailPages.fixedInfoPlaceholder')}
                            />
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="rounded-lg border border-border-dark/70 bg-bg-dark/45 px-3 py-3 text-xs leading-5 text-text-muted">
                        {t('commerceAd.agent.detailPages.manualEmpty')}
                      </div>
                    )}
                    <label className="block space-y-1.5 text-xs text-text-muted">
                      <span>{t('commerceAd.agent.userIdeaInfoLabel')}</span>
                      <UiTextAreaField
                        ref={userIdeaInfoRef}
                        value={userIdeaInfo}
                        onChange={(event) => onUserIdeaInfoChange(event.target.value)}
                        rows={4}
                        placeholder={t('commerceAd.agent.userIdeaInfoPlaceholder')}
                      />
                    </label>
                  </div>
                )}
              </div>
            ) : null}
          </section>
        </div>

        <div className="space-y-4">
          <section className="rounded-lg border border-border-dark/70 bg-bg-dark/35 p-3">
                <button
                  type="button"
                  className="flex w-full items-start gap-2 text-left"
                  onClick={onToggleVisualPreferenceCollapsed}
                  aria-expanded={!isVisualPreferenceCollapsed}
                >
                  {isVisualPreferenceCollapsed ? (
                    <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-text-muted" />
                  ) : (
                    <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-text-muted" />
                  )}
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-text-dark">
                      {t('commerceAd.agent.visualPreference.title')}
                    </span>
                    <span className="mt-1 block truncate text-xs text-text-muted">
                      {isVisualPreferenceCollapsed
                        ? visualPreferenceSummary
                        : t('commerceAd.agent.visualPreference.hint')}
                    </span>
                  </span>
                </button>
                {!isVisualPreferenceCollapsed ? (
                  <div ref={visualPreferenceContentRef as React.RefObject<HTMLDivElement>} className="mt-3 space-y-3">
                    <label className="block text-xs text-text-muted">
                      <span>{t('commerceAd.fields.designStyle')}</span>
                      <UiSelect
                        value={visualPreferenceDraft.designStyle}
                        className="mt-1"
                        onChange={(event) => onUpdateVisualPreference({ designStyle: event.target.value })}
                      >
                        {VISUAL_PREFERENCE_OPTION_KEYS.designStyle.map((optionKey) => {
                          const label = t(`commerceAd.agent.visualPreference.options.designStyle.${optionKey}`);
                          return <option key={optionKey} value={label}>{label}</option>;
                        })}
                      </UiSelect>
                    </label>
                    <label className="block text-xs text-text-muted">
                      <span>{t('commerceAd.fields.colorPalette')}</span>
                      <UiSelect
                        value={visualPreferenceDraft.colorPalette}
                        className="mt-1"
                        onChange={(event) => onUpdateVisualPreference({ colorPalette: event.target.value })}
                      >
                        {VISUAL_PREFERENCE_OPTION_KEYS.colorPalette.map((optionKey) => {
                          const label = t(`commerceAd.agent.visualPreference.options.colorPalette.${optionKey}`);
                          return <option key={optionKey} value={label}>{label}</option>;
                        })}
                      </UiSelect>
                    </label>
                    <label className="block text-xs text-text-muted">
                      <span>{t('commerceAd.fields.platformVisual')}</span>
                      <UiSelect
                        value={visualPreferenceDraft.platformVisual}
                        className="mt-1"
                        onChange={(event) => onUpdateVisualPreference({ platformVisual: event.target.value })}
                      >
                        {VISUAL_PREFERENCE_OPTION_KEYS.platformVisual.map((optionKey) => {
                          const label = t(`commerceAd.agent.visualPreference.options.platformVisual.${optionKey}`);
                          return <option key={optionKey} value={label}>{label}</option>;
                        })}
                      </UiSelect>
                    </label>
                    <label className="block text-xs text-text-muted">
                      <span>{t('commerceAd.fields.language')}</span>
                      <UiSelect
                        value={visualPreferenceDraft.language}
                        className="mt-1"
                        onChange={(event) => onUpdateVisualPreference({ language: event.target.value })}
                      >
                        {VISUAL_PREFERENCE_OPTION_KEYS.language.map((optionKey) => {
                          const label = t(`commerceAd.agent.visualPreference.options.language.${optionKey}`);
                          return <option key={optionKey} value={label}>{label}</option>;
                        })}
                      </UiSelect>
                    </label>
                    <div className="space-y-2">
                      <div className="text-xs text-text-muted">
                        {t('commerceAd.fields.brandAccentColor')}
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => onUpdateVisualPreference({ brandAccentColor: 'auto' })}
                          className={`inline-flex h-8 items-center rounded-full border px-3 text-xs transition-colors ${
                            visualPreferenceDraft.brandAccentColor.toLowerCase() === 'auto'
                              ? 'border-text-dark/30 bg-text-dark/10 text-text-dark'
                              : 'border-border-dark/70 bg-bg-dark text-text-muted hover:text-text-dark'
                          }`}
                        >
                          {t('commerceAd.agent.visualPreference.autoAccent')}
                        </button>
                        {BRAND_ACCENT_PRESETS.map(({ key, color }) => (
                          <button
                            key={key}
                            type="button"
                            onClick={() => onUpdateVisualPreference({ brandAccentColor: color })}
                            className={`h-7 w-7 rounded-full border transition-transform hover:scale-105 ${
                              visualPreferenceDraft.brandAccentColor.toUpperCase() === color
                                ? 'border-white ring-2 ring-white/30'
                                : 'border-white/20'
                            }`}
                            style={{ backgroundColor: color }}
                            aria-label={t('commerceAd.agent.visualPreference.chooseAccent', {
                              color: t(`commerceAd.agent.visualPreference.options.accentColor.${key}`),
                            })}
                            title={t('commerceAd.agent.visualPreference.chooseAccent', {
                              color: t(`commerceAd.agent.visualPreference.options.accentColor.${key}`),
                            })}
                          />
                        ))}
                      </div>
                      <UiInput
                        value={visualPreferenceDraft.brandAccentColor}
                        onChange={(event) => onUpdateVisualPreference({ brandAccentColor: event.target.value })}
                        placeholder="#3B82F6"
                      />
                    </div>
                  </div>
                ) : null}
          </section>

          <section className="rounded-lg border border-border-dark/70 bg-bg-dark/35 p-3">
                <button
                  type="button"
                  className="flex w-full items-start gap-2 text-left"
                  onClick={onToggleBatchSettingsCollapsed}
                  aria-expanded={!isBatchSettingsCollapsed}
                >
                  {isBatchSettingsCollapsed ? (
                    <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-text-muted" />
                  ) : (
                    <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-text-muted" />
                  )}
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-text-dark">
                      {t('commerceAd.agent.batchSection')}
                    </span>
                    <span className="mt-1 block truncate text-xs text-text-muted">
                      {isBatchSettingsCollapsed
                        ? t('commerceAd.agent.batchSettingsSummary', {
                            provider: imageProviderOptions.find((item) => item.id === selectedImageModel.providerId)?.label ?? selectedImageModel.providerId,
                            model: selectedImageModel.displayName,
                            ratios: currentRatios.join(' / '),
                            count: plannedImageCount,
                          })
                        : t('commerceAd.agent.batchSettingsHint')}
                    </span>
                  </span>
                </button>
                {!isBatchSettingsCollapsed ? (
                  <div ref={batchSettingsContentRef as React.RefObject<HTMLDivElement>} className="mt-3 space-y-3">
                    <div className="rounded-lg border border-border-dark/70 bg-bg-dark/45 px-3 py-2 text-xs leading-5 text-text-muted">
                      <div className="font-medium text-text-dark">
                        {t('commerceAd.agent.detailPages.productionFlowTitle')}
                      </div>
                      <div className="mt-1">
                        {productionSummary}
                      </div>
                    </div>
                    <label className="block text-xs text-text-muted">
                      <span>{t('commerceAd.agent.imageProvider')}</span>
                      <UiSelect
                        value={selectedImageModel.providerId}
                        className="mt-1"
                        onChange={(event) => onImageProviderChange(event.target.value)}
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
                        onChange={(event) => onImageModelChange(event.target.value)}
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
                        onChange={(event) => onUpdateBatchConfig({ size: event.target.value })}
                      >
                        {resolutionOptions.map((resolution) => (
                          <option key={resolution.value} value={resolution.value}>
                            {resolution.label}
                          </option>
                        ))}
                      </UiSelect>
                    </label>
                    <div className="flex flex-wrap gap-2">
                      {ratioOptions.map((ratio) => {
                        const active = currentRatios.includes(ratio.value);
                        return (
                          <button
                            key={ratio.value}
                            type="button"
                            onClick={() => onTogglePageRatio(ratio.value)}
                            className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs transition-colors ${
                              active
                                ? 'border-text-dark/30 bg-text-dark/10 text-text-dark'
                                : 'border-border-dark/70 bg-bg-dark text-text-muted hover:text-text-dark'
                            }`}
                          >
                            {active ? <Check className="h-3 w-3" /> : null}
                            {ratio.label}
                          </button>
                        );
                      })}
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <label className="block text-xs text-text-muted">
                        <span>{t('commerceAd.agent.imagesPerGroup')}</span>
                        <UiInput
                          type="number"
                          min={1}
                          max={8}
                          step={1}
                          value={currentVariantsPerRatio}
                          className="mt-1"
                          onChange={(event) => onUpdateBatchConfig({ variantsPerRatio: event.target.valueAsNumber || 1 })}
                        />
                      </label>
                      <label className="block text-xs text-text-muted">
                        <span>{t('commerceAd.agent.batchCount')}</span>
                        <UiInput
                          type="number"
                          min={1}
                          max={20}
                          step={1}
                          value={currentBatchCount}
                          className="mt-1"
                          onChange={(event) => onUpdateBatchConfig({ batchCount: event.target.valueAsNumber || 1 })}
                        />
                      </label>
                    </div>
                    <div className="rounded-lg border border-border-dark/70 bg-bg-dark/45 px-3 py-2 text-xs leading-5 text-text-muted">
                      {canCreateDetailPageBatch
                        ? t('commerceAd.agent.detailPages.batchHint', {
                            pageCount: detailPageCount,
                            ratioCount: currentRatios.length,
                            imageCount: currentVariantsPerRatio,
                            batchCount: currentBatchCount,
                            total: plannedImageCount,
                            ratios: currentRatios.join(' / '),
                          })
                        : t('commerceAd.agent.detailPages.batchNeedsPagesHint')}
                    </div>
                  </div>
                ) : null}
          </section>
        </div>
      </div>
    </UiModal>
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
  void messageId;
  void selectedChoiceKeys;
  void onToggleChoice;
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

void GuidanceCard;

function CommerceAdWorkspaceInner() {
  const { t } = useTranslation();
  const flow = useReactFlow<CanvasNode, CanvasEdge>();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const chatImageFileInputRef = useRef<HTMLInputElement | null>(null);
  const replaceFileInputRef = useRef<HTMLInputElement | null>(null);
  const userIdeaInfoRef = useRef<HTMLTextAreaElement | null>(null);
  const productInfoContentRef = useRef<HTMLElement | null>(null);
  const visualPreferenceContentRef = useRef<HTMLElement | null>(null);
  const batchSettingsContentRef = useRef<HTMLElement | null>(null);
  const replaceImageIdRef = useRef<string | null>(null);
  const [messages, setMessages] = useState<CommerceAdAgentMessage[]>(DEFAULT_AGENT_MESSAGES);
  const [draft, setDraft] = useState('');
  const [chatImages, setChatImages] = useState<CommerceAdProductImage[]>([]);
  const [selectedSkillId] = useState('');
  const [isSkillsOpen, setIsSkillsOpen] = useState(false);
  const [isChatDragActive, setIsChatDragActive] = useState(false);
  const [detailInputMode, setDetailInputMode] = useState<CommerceAdProductState['detailInputMode']>('auto');
  const [lockedDocumentInfo, setLockedDocumentInfo] = useState('');
  const [userIdeaInfo, setUserIdeaInfo] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const [activeAgentTask, setActiveAgentTask] = useState<CommerceAgentTask | null>(null);
  const [uploading, setUploading] = useState(false);
  const [statusText, setStatusText] = useState<string | null>(null);
  const [isVisionWarningOpen, setIsVisionWarningOpen] = useState(false);
  const [isDetailSetupOpen, setIsDetailSetupOpen] = useState(false);
  const [isProductInfoCollapsed, setIsProductInfoCollapsed] = useState(() => (
    readStoredBoolean(COMMERCE_AGENT_PRODUCT_INFO_COLLAPSED_STORAGE_KEY, false)
  ));
  const [isVisualPreferenceCollapsed, setIsVisualPreferenceCollapsed] = useState(() => (
    readStoredBoolean(COMMERCE_AGENT_VISUAL_PREFERENCE_COLLAPSED_STORAGE_KEY, false)
  ));
  const [isBatchSettingsCollapsed, setIsBatchSettingsCollapsed] = useState(() => (
    readStoredBoolean(COMMERCE_AGENT_BATCH_SETTINGS_COLLAPSED_STORAGE_KEY, false)
  ));
  const [activeModule, setActiveModule] = useState<CommerceAgentModuleId>(() => readActiveCommerceAgentModule());
  const [visualPreferenceDraft, setVisualPreferenceDraft] = useState<CommerceAdVisualPreferenceState>(() => (
    createDefaultCommerceAdVisualPreferenceState()
  ));

  const nodes = useCanvasStore((state) => state.nodes);
  const selectedNodeId = useCanvasStore((state) => state.selectedNodeId);
  const addNode = useCanvasStore((state) => state.addNode);
  const updateNodeData = useCanvasStore((state) => state.updateNodeData);
  const updateNodePosition = useCanvasStore((state) => state.updateNodePosition);
  const addEdge = useCanvasStore((state) => state.addEdge);
  const setSelectedNode = useCanvasStore((state) => state.setSelectedNode);
  const settings = useSettingsStore((state) => state);

  const productNode = useMemo(
    () => resolveActiveStageNode<CommerceProductNodeData>(nodes, CANVAS_NODE_TYPES.commerceProduct, selectedNodeId),
    [nodes, selectedNodeId]
  );
  const briefNode = useMemo(
    () => resolveActiveStageNode<CommerceBriefNodeData>(nodes, CANVAS_NODE_TYPES.commerceBrief, selectedNodeId),
    [nodes, selectedNodeId]
  );
  const batchNode = useMemo(
    () => resolveActiveStageNode<CommerceBatchGenerateNodeData>(nodes, CANVAS_NODE_TYPES.commerceBatchGenerate, selectedNodeId),
    [nodes, selectedNodeId]
  );
  const visualPreferenceNode = useMemo(
    () => resolveActiveStageNode<CommerceVisualPreferenceNodeData>(nodes, CANVAS_NODE_TYPES.commerceVisualPreference, selectedNodeId),
    [nodes, selectedNodeId]
  );
  const resultNode = useMemo(
    () => resolveActiveStageNode<CommerceResultGroupNodeData>(nodes, CANVAS_NODE_TYPES.commerceResultGroup, selectedNodeId),
    [nodes, selectedNodeId]
  );

  const activeTextProvider = useMemo(
    () => resolveActivatedScriptProvider(settings),
    [settings]
  );
  const activeTextModel = useMemo(
    () => activeTextProvider ? resolveConfiguredScriptModel(activeTextProvider, settings) : '',
    [activeTextProvider, settings]
  );

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(
      COMMERCE_AGENT_ACTIVE_MODULE_STORAGE_KEY,
      activeModule
    );
  }, [activeModule]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(
      COMMERCE_AGENT_PRODUCT_INFO_COLLAPSED_STORAGE_KEY,
      String(isProductInfoCollapsed)
    );
  }, [isProductInfoCollapsed]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(
      COMMERCE_AGENT_VISUAL_PREFERENCE_COLLAPSED_STORAGE_KEY,
      String(isVisualPreferenceCollapsed)
    );
  }, [isVisualPreferenceCollapsed]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(
      COMMERCE_AGENT_BATCH_SETTINGS_COLLAPSED_STORAGE_KEY,
      String(isBatchSettingsCollapsed)
    );
  }, [isBatchSettingsCollapsed]);

  useEffect(() => {
    setVisualPreferenceDraft(normalizeCommerceAdVisualPreferenceState(visualPreferenceNode?.data ?? null));
  }, [visualPreferenceNode?.data]);

  useEffect(() => {
    const productData = productNode?.data;
    setDetailInputMode(productData?.detailInputMode ?? 'auto');
    setLockedDocumentInfo(productData?.lockedDocumentInfo ?? '');
    setUserIdeaInfo(productData?.userIdeaInfo ?? productData?.userInfo ?? '');
  }, [
    productNode?.data?.detailInputMode,
    productNode?.data?.lockedDocumentInfo,
    productNode?.data?.userIdeaInfo,
    productNode?.data?.userInfo,
  ]);

  const scrollSectionContentIntoView = useCallback((target: HTMLElement | null) => {
    requestAnimationFrame(() => {
      target?.scrollIntoView({
        block: 'start',
        behavior: 'smooth',
      });
    });
  }, []);

  const toggleProductInfoCollapsed = useCallback(() => {
    setIsProductInfoCollapsed((collapsed) => {
      const nextCollapsed = !collapsed;
      if (!nextCollapsed) {
        scrollSectionContentIntoView(productInfoContentRef.current);
        requestAnimationFrame(() => {
          userIdeaInfoRef.current?.focus();
        });
      }
      return nextCollapsed;
    });
  }, [scrollSectionContentIntoView]);

  const toggleVisualPreferenceCollapsed = useCallback(() => {
    setIsVisualPreferenceCollapsed((collapsed) => {
      const nextCollapsed = !collapsed;
      if (!nextCollapsed) {
        scrollSectionContentIntoView(visualPreferenceContentRef.current);
      }
      return nextCollapsed;
    });
  }, [scrollSectionContentIntoView]);

  const toggleBatchSettingsCollapsed = useCallback(() => {
    setIsBatchSettingsCollapsed((collapsed) => {
      const nextCollapsed = !collapsed;
      if (!nextCollapsed) {
        scrollSectionContentIntoView(batchSettingsContentRef.current);
      }
      return nextCollapsed;
    });
  }, [scrollSectionContentIntoView]);

  const canUseVisionModel = useMemo(
    () => isLikelyVisionTextModel(activeTextProvider, activeTextModel),
    [activeTextProvider, activeTextModel]
  );
  const productImages = productNode?.data.images ?? [];
  const productReferenceImages = useMemo(
    () => dedupeStrings(productImages.map((image) => image.imageUrl)).slice(0, COMMERCE_PRODUCT_REFERENCE_IMAGE_LIMIT),
    [productImages]
  );
  const productImageCount = Math.min(productImages.length, COMMERCE_PRODUCT_REFERENCE_IMAGE_LIMIT);
  const remainingProductImageSlots = Math.max(0, COMMERCE_PRODUCT_REFERENCE_IMAGE_LIMIT - productImageCount);
  const isProductImageLimitReached = remainingProductImageSlots <= 0;
  const shouldShowVisionWarning = productImages.length > 0 && !canUseVisionModel;
  const hasResolvedProductInfo = hasProductInfo(productNode?.data);
  const visualPreferenceSummary = composeVisualPreferenceSummary(visualPreferenceDraft);
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
    summary: t('commerceAd.agent.guidance.uploadSummary', {
      count,
      limit: COMMERCE_PRODUCT_REFERENCE_IMAGE_LIMIT,
    }),
    confirmedFacts: [t('commerceAd.agent.guidance.uploadConfirmed', {
      count,
      limit: COMMERCE_PRODUCT_REFERENCE_IMAGE_LIMIT,
    })],
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
  void useMemo(() => {
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
  const visibleMessages = useMemo(
    () => messages.filter((message) => !isInternalProductInfoMessage(message)),
    [messages]
  );
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
  const ratioOptions = selectedImageModel.aspectRatios;
  const currentRatios = useMemo(() => {
    return resolveCommerceAspectRatiosForModel(selectedImageModel, batchNode?.data.aspectRatios ?? []);
  }, [batchNode?.data.aspectRatios, selectedImageModel]);
  const currentVariantsPerRatio = Math.max(1, Math.min(8, Math.round(Number(batchNode?.data.variantsPerRatio) || 1)));
  const currentBatchCount = Math.max(1, Math.min(20, Math.round(Number(batchNode?.data.batchCount) || 1)));
  const detailPages = useMemo(
    () => normalizeDetailPagesForEditing(
      batchNode?.data.detailPages?.length
        ? batchNode.data.detailPages
        : briefNode?.data.detailPages ?? []
    ),
    [batchNode?.data.detailPages, briefNode?.data.detailPages]
  );
  const validDetailPages = useMemo(
    () => detailPages.filter((page) => (
      page.lockedCopy.trim()
      || page.optimizedCopy.trim()
      || page.prompt.trim()
    )),
    [detailPages]
  );
  const hasManualPageLockedInfo = useMemo(
    () => hasLockedDetailPageInfo(detailPages),
    [detailPages]
  );
  const detailPageCount = validDetailPages.length;
  const plannedImageCount = detailPageCount * currentRatios.length * currentVariantsPerRatio * currentBatchCount;
  const canCreateDetailPageBatch = hasResolvedProductInfo && detailPageCount > 0;
  const productionSummary = canCreateDetailPageBatch
    ? t('commerceAd.agent.detailPages.productionReady', {
        pageCount: detailPageCount,
        ratioCount: currentRatios.length,
        imageCount: currentVariantsPerRatio,
        batchCount: currentBatchCount,
        total: plannedImageCount,
      })
    : t('commerceAd.agent.detailPages.productionNeedsPages');
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
      batchNode?.data.size || resolveCommerceDefaultResolution(selectedImageModel),
      { extraParams: {} }
    ),
    [batchNode?.data.size, selectedImageModel]
  );
  const upsertAgentPlanNode = useCallback((plan: CommerceAgentPlanState) => {
    const existing = useCanvasStore.getState().nodes.find((node) => node.type === CANVAS_NODE_TYPES.commerceAgentPlan);
    if (existing) {
      updateNodeData(existing.id, plan as Partial<CanvasNodeData>);
      setSelectedNode(existing.id);
      flow.setCenter(existing.position.x + 180, existing.position.y + 180, {
        zoom: 0.9,
        duration: 260,
      });
      return existing.id;
    }

    const position = resultNode?.position
      ? { x: resultNode.position.x, y: resultNode.position.y - 520 }
      : { x: 120, y: 120 };
    const nodeId = addNode(CANVAS_NODE_TYPES.commerceAgentPlan, position, plan as Partial<CanvasNodeData>);
    setSelectedNode(nodeId);
    flow.setCenter(position.x + 180, position.y + 180, {
      zoom: 0.9,
      duration: 260,
    });
    return nodeId;
  }, [addNode, flow, resultNode?.position, setSelectedNode, updateNodeData]);

  const canvasActionContext = useMemo<CommerceAdCanvasActionsContext>(() => ({
    getNodes: () => useCanvasStore.getState().nodes,
    addNode,
    updateNodeData,
    updateNodePosition,
    addEdge,
    setSelectedNode,
    setCenter: flow.setCenter,
  }), [addEdge, addNode, flow.setCenter, setSelectedNode, updateNodeData, updateNodePosition]);

  const applyActions = useCallback((
    actions: CommerceAdAgentAction[],
    options?: CommerceAdAgentActionOptions
  ) => {
    return applyCommerceAdAgentActions(actions, canvasActionContext, options);
  }, [canvasActionContext]);

  const runAgent = useCallback(async (
    userMessage: string,
    productOverride?: CommerceAdProductState,
    visualPreferenceOverride?: CommerceAdVisualPreferenceState,
    task: CommerceAgentTask = 'chat',
    options: { hideUserMessage?: boolean } = {}
  ) => {
    const trimmedMessage = userMessage.trim();
    if (!trimmedMessage && !productOverride && productImages.length === 0) {
      return;
    }

    const nextUserMessage = trimmedMessage && !options.hideUserMessage
      ? createLocalMessage('user', trimmedMessage)
      : null;
    if (nextUserMessage) {
      setMessages((items) => [...items, nextUserMessage]);
    }

    setIsThinking(true);
    setActiveAgentTask(task);
    setStatusText(t('commerceAd.agent.statusThinking'));
    try {
      const product = productOverride ?? productNode?.data ?? null;
      const result = await runCommerceAdAgentTurn({
        userMessage: trimmedMessage || composeProductUserInfo(lockedDocumentInfo, userIdeaInfo),
        product,
        brief: briefNode?.data ?? null,
        visualPreference: visualPreferenceOverride ?? visualPreferenceNode?.data ?? visualPreferenceDraft,
        batch: batchNode?.data ?? null,
        referenceImages: dedupeStrings([
          ...(product?.images ?? productImages).map((image) => image.imageUrl),
          ...productReferenceImages,
        ]).slice(0, COMMERCE_PRODUCT_REFERENCE_IMAGE_LIMIT),
        canUseVisionModel,
      });
      const productAction = result.actions.find((action) => action.type === 'upsertProduct');
      const nextProduct = mergeProductState(product, productAction?.type === 'upsertProduct' ? productAction.data : null);
      const shouldAllowBatchActions = hasProductInfo(nextProduct);
      const nextActions = shouldAllowBatchActions
        ? result.actions
        : result.actions.filter((action) => action.type !== 'upsertBatchGenerate');
      applyActions(nextActions, {
        alignStageNodes: true,
        targetNodeIds: {
          product: productNode?.id ?? null,
          brief: briefNode?.id ?? null,
          visualPreference: visualPreferenceNode?.id ?? null,
          batch: batchNode?.id ?? null,
          result: resultNode?.id ?? null,
        },
      });
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
      setActiveAgentTask(null);
    }
  }, [
    applyActions,
    batchNode?.data,
    batchNode?.id,
    briefNode?.data,
    briefNode?.id,
    canUseVisionModel,
    lockedDocumentInfo,
    productImages,
    productReferenceImages,
    productNode?.data,
    productNode?.id,
    resultNode?.id,
    t,
    userIdeaInfo,
    visualPreferenceDraft,
    visualPreferenceNode?.data,
    visualPreferenceNode?.id,
  ]);

  const handleUploadClick = useCallback(() => {
    if (isProductImageLimitReached) {
      setStatusText(t('commerceAd.agent.productImageLimitReached', {
        limit: COMMERCE_PRODUCT_REFERENCE_IMAGE_LIMIT,
      }));
      return;
    }
    fileInputRef.current?.click();
  }, [isProductImageLimitReached, t]);

  useEffect(() => {
    window.addEventListener(COMMERCE_UPLOAD_PRODUCT_IMAGE_EVENT, handleUploadClick);
    return () => {
      window.removeEventListener(COMMERCE_UPLOAD_PRODUCT_IMAGE_EVENT, handleUploadClick);
    };
  }, [handleUploadClick]);

  const resetCommerceDataAfterProductImageChange = useCallback((nextImages: CommerceAdProductImage[]) => {
    const nextLockedDocumentInfo = lockedDocumentInfo.trim() || productNode?.data.lockedDocumentInfo || '';
    const nextUserIdeaInfo = userIdeaInfo.trim()
      || productNode?.data.userIdeaInfo
      || productNode?.data.userInfo
      || '';
    if (productNode) {
      updateNodeData(
        productNode.id,
        createImageChangedProductState(
          nextImages,
          nextLockedDocumentInfo,
          nextUserIdeaInfo,
          detailInputMode
        ) as Partial<CanvasNodeData>
      );
    }
    if (briefNode) {
      updateNodeData(
        briefNode.id,
        createDefaultCommerceAdBriefState() as Partial<CanvasNodeData>
      );
    }
    if (visualPreferenceNode) {
      const defaultVisualPreference = createDefaultCommerceAdVisualPreferenceState();
      updateNodeData(
        visualPreferenceNode.id,
        defaultVisualPreference as Partial<CanvasNodeData>
      );
      setVisualPreferenceDraft(defaultVisualPreference);
    }
    if (batchNode) {
      updateNodeData(batchNode.id, {
        generationMode: 'detailPages',
        aspectRatios: currentRatios,
        variantsPerRatio: currentVariantsPerRatio,
        modelId: selectedImageModel.id,
        size: selectedResolution.value,
        corePrompt: '',
        ratioPrompts: {},
        detailPageIds: [],
        detailPageCount: 0,
        detailPages: [],
        batchCount: currentBatchCount,
        stylePromptFragment: '',
        status: 'idle',
        lastGeneratedAt: null,
        lastError: null,
      } as Partial<CanvasNodeData>);
    }
    if (resultNode) {
      updateNodeData(
        resultNode.id,
        createDefaultCommerceAdResultGroupState() as Partial<CanvasNodeData>
      );
    }
  }, [
    batchNode,
    briefNode,
    currentBatchCount,
    currentRatios,
    currentVariantsPerRatio,
    detailInputMode,
    lockedDocumentInfo,
    productNode,
    resultNode,
    selectedImageModel.id,
    selectedResolution.value,
    updateNodeData,
    userIdeaInfo,
    visualPreferenceNode,
  ]);

  const handleDeleteProductImage = useCallback((imageId: string) => {
    const nextImages = productImages.filter((image) => image.id !== imageId);
    resetCommerceDataAfterProductImageChange(nextImages);
    setStatusText(t('commerceAd.agent.productImageDeleted'));
  }, [productImages, resetCommerceDataAfterProductImageChange, t]);

  const handleReplaceProductImageClick = useCallback((imageId: string) => {
    replaceImageIdRef.current = imageId;
    replaceFileInputRef.current?.click();
  }, []);

  const handleUpdateProductImageDescription = useCallback((imageId: string, description: string) => {
    const nextImages = productImages.map((image) => (
      image.id === imageId ? { ...image, description } : image
    ));
    if (productNode) {
      updateNodeData(productNode.id, {
        images: normalizeProductImageRoles(nextImages),
        lastError: null,
      } as Partial<CanvasNodeData>);
      return;
    }

    applyActions([{
      type: 'upsertProduct',
      data: createImageChangedProductState(
        nextImages,
        lockedDocumentInfo,
        userIdeaInfo,
        detailInputMode
      ),
    }], { focusLastTouched: false });
  }, [
    applyActions,
    detailInputMode,
    lockedDocumentInfo,
    productImages,
    productNode,
    updateNodeData,
    userIdeaInfo,
  ]);

  const handleFilesSelected = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []).filter((file) => file.type.startsWith('image/'));
    event.target.value = '';
    if (files.length === 0) {
      return;
    }
    if (remainingProductImageSlots <= 0) {
      setStatusText(t('commerceAd.agent.productImageLimitReached', {
        limit: COMMERCE_PRODUCT_REFERENCE_IMAGE_LIMIT,
      }));
      return;
    }

    const acceptedFiles = files.slice(0, remainingProductImageSlots);
    const skippedCount = files.length - acceptedFiles.length;

    setUploading(true);
    setStatusText(t('commerceAd.agent.statusUploading'));
    try {
      const preparedImages = await Promise.all(
        acceptedFiles.map(async (file, index): Promise<CommerceAdProductImage> => {
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
            description: '',
            kind: productImages.length === 0 && index === 0 ? 'main' : 'reference',
            evidenceTags: [],
          };
        })
      );
      const mergedProduct = mergeProductImages(productNode?.data ?? null, preparedImages);
      applyActions([{ type: 'upsertProduct', data: mergedProduct }]);

      setMessages((items) => [
        ...items,
        createLocalMessage('user', t('commerceAd.agent.uploadedImages', {
          count: preparedImages.length,
          total: Math.min(productImageCount + preparedImages.length, COMMERCE_PRODUCT_REFERENCE_IMAGE_LIMIT),
          limit: COMMERCE_PRODUCT_REFERENCE_IMAGE_LIMIT,
        })),
        createLocalMessage(
          'assistant',
          t('commerceAd.agent.guidance.uploadAssistant', {
            count: preparedImages.length,
            total: Math.min(productImageCount + preparedImages.length, COMMERCE_PRODUCT_REFERENCE_IMAGE_LIMIT),
            limit: COMMERCE_PRODUCT_REFERENCE_IMAGE_LIMIT,
          }),
          createUploadGuidance(preparedImages.length)
        ),
      ]);
      setStatusText(skippedCount > 0
        ? t('commerceAd.agent.productImageLimitAccepted', {
            accepted: preparedImages.length,
            skipped: skippedCount,
            limit: COMMERCE_PRODUCT_REFERENCE_IMAGE_LIMIT,
          })
        : t('commerceAd.agent.statusUploaded'));
    } finally {
      setUploading(false);
    }
  }, [
    applyActions,
    createUploadGuidance,
    productImageCount,
    productImages.length,
    productNode?.data,
    remainingProductImageSlots,
    settings.canvasOverviewThumbnailMaxDimension,
    t,
  ]);

  const addChatImagesFromFiles = useCallback(async (fileList: FileList | File[]) => {
    const files = Array.from(fileList).filter((file) => file.type.startsWith('image/'));
    if (files.length === 0) {
      return;
    }
    const remainingSlots = Math.max(0, COMMERCE_PRODUCT_REFERENCE_IMAGE_LIMIT - chatImages.length);
    if (remainingSlots <= 0) {
      setStatusText(t('commerceAd.agent.productImageLimitReached', {
        limit: COMMERCE_PRODUCT_REFERENCE_IMAGE_LIMIT,
      }));
      return;
    }

    const acceptedFiles = files.slice(0, remainingSlots);
    setUploading(true);
    setStatusText(t('commerceAd.agent.statusUploading'));
    try {
      const preparedImages = await Promise.all(
        acceptedFiles.map(async (file, index): Promise<CommerceAdProductImage> => {
          const prepared = await prepareNodeImageFromFile(
            file,
            undefined,
            undefined,
            settings.canvasOverviewThumbnailMaxDimension
          );
          return {
            id: `commerce-agent-chat-image-${Date.now()}-${index + 1}`,
            imageUrl: prepared.imageUrl,
            previewImageUrl: prepared.previewImageUrl,
            aspectRatio: prepared.aspectRatio,
            label: file.name || t('commerceAd.agent.productImageLabel', { index: index + 1 }),
            description: '',
            kind: chatImages.length === 0 && index === 0 ? 'main' : 'reference',
            evidenceTags: [],
          };
        })
      );
      setChatImages((items) => normalizeProductImageRoles([...items, ...preparedImages]));
      setStatusText(t('commerceAd.agent.chatImagesUploaded', { count: preparedImages.length }));
    } finally {
      setUploading(false);
    }
  }, [chatImages.length, settings.canvasOverviewThumbnailMaxDimension, t]);

  const handleChatImageInputChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    event.target.value = '';
    if (files) {
      void addChatImagesFromFiles(files);
    }
  }, [addChatImagesFromFiles]);

  const handleRemoveChatImage = useCallback((imageId: string) => {
    setChatImages((items) => normalizeProductImageRoles(items.filter((image) => image.id !== imageId)));
  }, []);

  const handleChatPaste = useCallback((event: ReactClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(event.clipboardData?.files ?? []).filter((file) => file.type.startsWith('image/'));
    if (files.length > 0) {
      event.preventDefault();
      void addChatImagesFromFiles(files);
    }
  }, [addChatImagesFromFiles]);

  const handleReplaceProductImageSelected = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const imageId = replaceImageIdRef.current;
    const file = Array.from(event.target.files ?? []).find((item) => item.type.startsWith('image/'));
    event.target.value = '';
    replaceImageIdRef.current = null;
    if (!imageId || !file) {
      return;
    }

    setUploading(true);
    setStatusText(t('commerceAd.agent.statusUploading'));
    try {
      const prepared = await prepareNodeImageFromFile(
        file,
        undefined,
        undefined,
        settings.canvasOverviewThumbnailMaxDimension
      );
      const nextImages = productImages.map((image) => (
        image.id === imageId
          ? {
              ...image,
              imageUrl: prepared.imageUrl,
              previewImageUrl: prepared.previewImageUrl,
              aspectRatio: prepared.aspectRatio,
              label: file.name || image.label,
              description: image.description ?? '',
              evidenceTags: image.evidenceTags ?? [],
            }
          : image
      ));
      resetCommerceDataAfterProductImageChange(nextImages);
      setStatusText(t('commerceAd.agent.productImageReplaced'));
    } finally {
      setUploading(false);
    }
  }, [
    productImages,
    resetCommerceDataAfterProductImageChange,
    settings.canvasOverviewThumbnailMaxDimension,
    t,
  ]);

  const handleGenerateNodeInfo = useCallback(() => {
    const normalizedDetailPages = normalizeDetailPagesForEditing(detailPages);
    const manualLockedInfo = composeManualDetailPagesLockedInfo(normalizedDetailPages);
    const nextLockedDocumentInfo = detailInputMode === 'manualPages'
      ? manualLockedInfo
      : lockedDocumentInfo.trim();
    const nextUserIdeaInfo = userIdeaInfo.trim();
    const userInfo = composeProductUserInfo(nextLockedDocumentInfo, nextUserIdeaInfo);
    if (!nextLockedDocumentInfo && !nextUserIdeaInfo && productReferenceImages.length === 0) {
      setStatusText(t('commerceAd.agent.needProductReferenceBeforeGenerate'));
      return;
    }
    const nextProduct: CommerceAdProductState = {
      ...mergeProductImages(productNode?.data ?? null, []),
      detailInputMode,
      lockedDocumentInfo: nextLockedDocumentInfo,
      userIdeaInfo: nextUserIdeaInfo,
      userInfo,
      lastError: null,
    };
    const actions: CommerceAdAgentAction[] = [{ type: 'upsertProduct', data: nextProduct }];
    if (detailInputMode === 'manualPages') {
      actions.push(
        {
          type: 'upsertBrief',
          data: {
            detailPages: normalizedDetailPages,
            updatedAt: Date.now(),
          },
        },
        {
          type: 'upsertBatchGenerate',
          data: {
            generationMode: 'detailPages',
            aspectRatios: currentRatios,
            variantsPerRatio: currentVariantsPerRatio,
            batchCount: currentBatchCount,
            detailPages: normalizedDetailPages,
            detailPageIds: normalizedDetailPages.map((page) => page.id),
            detailPageCount: normalizedDetailPages.length,
            stylePromptFragment: visualPreferenceDraft.promptFragment,
            modelId: selectedImageModel.id,
            size: selectedResolution.value,
            status: batchNode?.data.corePrompt ? 'ready' : batchNode?.data.status ?? 'idle',
          },
        }
      );
    }
    applyActions(actions, { alignStageNodes: true });
    setStatusText(t('commerceAd.agent.statusThinking'));
    void runAgent(userInfo, nextProduct, undefined, 'syncProductInfo', { hideUserMessage: true })
      .finally(() => {
        setIsDetailSetupOpen(false);
      });
  }, [
    applyActions,
    batchNode?.data.corePrompt,
    batchNode?.data.status,
    currentBatchCount,
    currentRatios,
    currentVariantsPerRatio,
    detailInputMode,
    detailPages,
    lockedDocumentInfo,
    productNode?.data,
    productReferenceImages.length,
    runAgent,
    selectedImageModel.id,
    selectedResolution.value,
    t,
    userIdeaInfo,
    visualPreferenceDraft.promptFragment,
  ]);

  const updateVisualPreferenceDraft = useCallback((data: Partial<CommerceAdVisualPreferenceState>) => {
    setVisualPreferenceDraft((current) => {
      const nextPreference = buildVisualPreferencePatch(normalizeCommerceAdVisualPreferenceState({
        ...current,
        ...data,
        updatedAt: Date.now(),
      }));
      applyActions(
        [
          { type: 'upsertVisualPreference', data: nextPreference },
          {
            type: 'upsertBatchGenerate',
            data: {
              generationMode: 'detailPages',
              stylePromptFragment: nextPreference.promptFragment,
            },
          },
        ],
        {
          focusLastTouched: false,
          targetNodeIds: {
            visualPreference: visualPreferenceNode?.id ?? null,
            batch: batchNode?.id ?? null,
          },
        }
      );
      return nextPreference;
    });
  }, [applyActions, batchNode?.id, visualPreferenceNode?.id]);

  const handleInferProduct = useCallback(() => {
    const product = productNode?.data ?? null;
    if (!product || productReferenceImages.length === 0) {
      setStatusText(t('commerceAd.agent.needProductImageBeforeInfer'));
      return;
    }
    void runAgent(composeProductUserInfo(lockedDocumentInfo, userIdeaInfo), product, undefined, 'inferProduct', { hideUserMessage: true });
  }, [lockedDocumentInfo, productNode?.data, productReferenceImages.length, runAgent, t, userIdeaInfo]);

  useEffect(() => {
    window.addEventListener(COMMERCE_INFER_PRODUCT_EVENT, handleInferProduct);
    return () => {
      window.removeEventListener(COMMERCE_INFER_PRODUCT_EVENT, handleInferProduct);
    };
  }, [handleInferProduct]);

  const updateBatchConfig = useCallback((data: Partial<CommerceAdBatchGenerateState>) => {
    applyActions([{
      type: 'upsertBatchGenerate',
      data: {
        generationMode: 'detailPages',
        aspectRatios: currentRatios,
        variantsPerRatio: currentVariantsPerRatio,
        batchCount: currentBatchCount,
        modelId: selectedImageModel.id,
        size: selectedResolution.value,
        detailPageIds: detailPages.map((page) => page.id),
        detailPageCount: detailPages.length,
        detailPages,
        stylePromptFragment: visualPreferenceDraft.promptFragment,
        ...data,
        status: batchNode?.data.corePrompt ? 'ready' : batchNode?.data.status ?? 'idle',
      },
    }]);
  }, [
    applyActions,
    currentBatchCount,
    currentRatios,
    currentVariantsPerRatio,
    batchNode?.data.status,
    detailPages,
    selectedImageModel.id,
    selectedResolution.value,
    visualPreferenceDraft.promptFragment,
  ]);

  const togglePageRatio = useCallback((ratio: string) => {
    const nextRatios = currentRatios.includes(ratio)
      ? currentRatios.filter((item) => item !== ratio)
      : [...currentRatios, ratio];
    updateBatchConfig({ aspectRatios: nextRatios.length > 0 ? nextRatios : [ratio] });
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
      resolveCommerceDefaultResolution(nextModel),
      { extraParams: {} }
    );
    updateBatchConfig({
      aspectRatios: resolveCommerceAspectRatiosForModel(nextModel, currentRatios),
      modelId: nextModel.id,
      size: nextResolution.value,
    });
  }, [
    currentRatios,
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

  const updateDetailPages = useCallback((pages: CommerceAdDetailPage[]) => {
    const normalizedPages = normalizeDetailPagesForEditing(pages);
    applyActions(
      [
        {
          type: 'upsertBrief',
          data: {
            detailPages: normalizedPages,
            updatedAt: Date.now(),
          },
        },
        {
          type: 'upsertBatchGenerate',
          data: {
            generationMode: 'detailPages',
            aspectRatios: currentRatios,
            variantsPerRatio: currentVariantsPerRatio,
            batchCount: currentBatchCount,
            detailPages: normalizedPages,
            detailPageIds: normalizedPages.map((page) => page.id),
            detailPageCount: normalizedPages.length,
            stylePromptFragment: visualPreferenceDraft.promptFragment,
            modelId: selectedImageModel.id,
            size: selectedResolution.value,
            status: batchNode?.data.corePrompt ? 'ready' : batchNode?.data.status ?? 'idle',
          },
        },
      ],
      {
        focusLastTouched: false,
        targetNodeIds: {
          brief: briefNode?.id ?? null,
          batch: batchNode?.id ?? null,
        },
      }
    );
  }, [
    applyActions,
    batchNode?.data.corePrompt,
    batchNode?.data.status,
    batchNode?.id,
    briefNode?.id,
    currentBatchCount,
    currentRatios,
    currentVariantsPerRatio,
    selectedImageModel.id,
    selectedResolution.value,
    visualPreferenceDraft.promptFragment,
  ]);

  const handleAddDetailPage = useCallback(() => {
    const nextPage = createDetailPageDraft({
      pageNo: detailPages.length + 1,
      title: t('commerceAd.agent.detailPages.defaultTitle', { page: detailPages.length + 1 }),
    });
    updateDetailPages([...detailPages, nextPage]);
  }, [detailPages, t, updateDetailPages]);

  const handleDeleteDetailPage = useCallback((pageId: string) => {
    updateDetailPages(detailPages.filter((page) => page.id !== pageId));
  }, [detailPages, updateDetailPages]);

  const handleMoveDetailPage = useCallback((pageId: string, direction: -1 | 1) => {
    const currentIndex = detailPages.findIndex((page) => page.id === pageId);
    const nextIndex = currentIndex + direction;
    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= detailPages.length) {
      return;
    }
    const nextPages = [...detailPages];
    const [page] = nextPages.splice(currentIndex, 1);
    nextPages.splice(nextIndex, 0, page);
    updateDetailPages(nextPages);
  }, [detailPages, updateDetailPages]);

  const handleUpdateDetailPage = useCallback((
    pageId: string,
    data: Partial<Omit<CommerceAdDetailPage, 'id' | 'pageNo'>>
  ) => {
    updateDetailPages(detailPages.map((page) => (
      page.id === pageId ? { ...page, ...data } : page
    )));
  }, [detailPages, updateDetailPages]);

  const handleGenerate = useCallback(async () => {
    const corePrompt =
      batchNode?.data.corePrompt
      || briefNode?.data.normalizedBrief
      || productNode?.data.lockedDocumentInfo
      || productNode?.data.userIdeaInfo
      || productNode?.data.userInfo
      || productNode?.data.inference?.summary
      || '';
    const pagesForGeneration = validDetailPages;
    if (!hasResolvedProductInfo) {
      setStatusText(t('commerceAd.agent.needProductInfoBeforeBatch'));
      return;
    }
    if (pagesForGeneration.length === 0) {
      setStatusText(t('commerceAd.agent.detailPages.needPagesBeforeGenerate'));
      return;
    }
    if (!corePrompt.trim()) {
      setStatusText(t('commerceAd.agent.needBriefBeforeGenerate'));
      return;
    }
    if (
      productReferenceImages.length === 0
      && ![
        productNode?.data.lockedDocumentInfo,
        productNode?.data.userIdeaInfo,
        productNode?.data.userInfo,
      ].some((value) => value?.trim())
    ) {
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

    const generationBatch = buildDetailPageGenerationBatch(
      batchNode?.data ?? null,
      corePrompt,
      pagesForGeneration,
      visualPreferenceNode?.data ?? visualPreferenceDraft,
      composeProductImageReferenceNotes(productNode?.data.images ?? productImages)
    );
    const referenceImages = productReferenceImages.slice(0, COMMERCE_PRODUCT_REFERENCE_IMAGE_LIMIT);
    const startedAt = Date.now();
    const generationDurationMs = selectedImageModel.expectedDurationMs ?? 60000;
    const requestResolution = selectedImageModel.resolveRequest({
      referenceImageCount: referenceImages.length,
    });
    const emptyBatch: CommerceAdGenerationBatch = {
      ...generationBatch,
      images: [],
    };
    const resultGroupId = applyActions([
      {
        type: 'upsertResultGroup',
        data: {
          batches: [...(resultNode?.data.batches ?? []), emptyBatch],
          activeBatchId: emptyBatch.id,
        },
      },
    ], {
      focusLastTouched: false,
      targetNodeIds: {
        result: resultNode?.id ?? null,
      },
    }) ?? resultNode?.id ?? null;
    const resultGroupNode =
      resultGroupId
        ? useCanvasStore.getState().nodes.find((node) => node.id === resultGroupId)
        : resultNode ?? null;
    const resultPositionBase = resultGroupNode?.position ?? resultNode?.position ?? { x: 1260, y: 420 };
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
          displayName: imageRecord.detailPageNo
            ? t('commerceAd.agent.detailPages.resultTitle', {
                page: imageRecord.detailPageNo,
                title: imageRecord.detailPageTitle || t('commerceAd.agent.detailPages.untitled'),
              })
            : `${t('commerceAd.nodes.results')} ${imageRecord.aspectRatio}`,
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
      if (resultGroupId) {
        addEdge(resultGroupId, resultNodeId);
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
          batchCount: submittedBatch.batchCount ?? currentBatchCount,
          generationMode: 'detailPages',
          detailPageIds: pagesForGeneration.map((page) => page.id),
          detailPageCount: pagesForGeneration.length,
          detailPages: pagesForGeneration,
          stylePromptFragment: (visualPreferenceNode?.data ?? visualPreferenceDraft).promptFragment,
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
          batches: [
            ...(resultNode?.data.batches ?? []).filter((batch) => batch.id !== submittedBatch.id),
            submittedBatch,
          ],
          activeBatchId: submittedBatch.id,
        },
      },
    ], {
      focusLastTouched: false,
      targetNodeIds: {
        result: resultGroupId,
      },
    });
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
    briefNode?.data,
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
    validDetailPages,
    visualPreferenceDraft,
    visualPreferenceNode?.data,
  ]);

  const handleGenerateFromAgentPlan = useCallback(async (planNodeId: string) => {
    const planNode = useCanvasStore.getState().nodes.find((node) => (
      node.id === planNodeId && node.type === CANVAS_NODE_TYPES.commerceAgentPlan
    )) as (CanvasNode & { data: CommerceAgentPlanNodeData }) | undefined;
    if (!planNode) {
      return;
    }

    const plan = planNode.data;
    const selectedPlanModel = getImageModel(
      plan.modelId || COMMERCE_DEFAULT_IMAGE_MODEL_ID,
      settings.storyboardCompatibleModelConfig,
      settings.storyboardNewApiModelConfig,
      settings.storyboardApi2OkModelConfig,
      settings.storyboardProviderCustomModels
    );
    const selectedPlanResolution = resolveImageModelResolution(
      selectedPlanModel,
      plan.size || resolveCommerceDefaultResolution(selectedPlanModel),
      { extraParams: {} }
    );
    if (!plan.prompt.trim()) {
      updateNodeData(planNode.id, {
        status: 'failed',
        lastError: t('commerceAd.agentPlan.needPrompt'),
      } as Partial<CanvasNodeData>);
      setStatusText(t('commerceAd.agentPlan.needPrompt'));
      return;
    }

    const providerApiKey = settings.storyboardApiKeys[selectedPlanModel.providerId] ?? '';
    if (!providerApiKey.trim()) {
      openSettingsDialog({
        category: 'providers',
        providerTab: 'storyboard',
        providerId: selectedPlanModel.providerId,
      });
      updateNodeData(planNode.id, {
        status: 'failed',
        lastError: t('commerceAd.agent.noImageApiKey'),
      } as Partial<CanvasNodeData>);
      setStatusText(t('commerceAd.agent.noImageApiKey'));
      return;
    }

    updateNodeData(planNode.id, {
      status: 'generating',
      lastError: null,
      providerId: selectedPlanModel.providerId,
      modelId: selectedPlanModel.id,
      size: selectedPlanResolution.value,
    } as Partial<CanvasNodeData>);

    const generationBatch = buildAgentPlanGenerationBatch({
      ...plan,
      providerId: selectedPlanModel.providerId,
      modelId: selectedPlanModel.id,
      size: selectedPlanResolution.value,
    });
    const referenceImages = dedupeStrings(
      plan.referenceImages.map((image) => image.imageUrl)
    ).slice(0, COMMERCE_PRODUCT_REFERENCE_IMAGE_LIMIT);
    const startedAt = Date.now();
    const generationDurationMs = selectedPlanModel.expectedDurationMs ?? 60000;
    const requestResolution = selectedPlanModel.resolveRequest({
      referenceImageCount: referenceImages.length,
    });
    const emptyBatch: CommerceAdGenerationBatch = {
      ...generationBatch,
      images: [],
    };
    const existingResultGroup = useCanvasStore.getState().nodes.find((node) => (
      node.type === CANVAS_NODE_TYPES.commerceResultGroup
      && useCanvasStore.getState().edges.some((edge) => edge.source === planNode.id && edge.target === node.id)
    ));
    const resultGroupId = existingResultGroup
      ? existingResultGroup.id
      : addNode(CANVAS_NODE_TYPES.commerceResultGroup, {
          x: planNode.position.x + 520,
          y: planNode.position.y,
        }, {
          ...createDefaultCommerceAdResultGroupState(),
          batches: [emptyBatch],
          activeBatchId: emptyBatch.id,
        } as Partial<CanvasNodeData>);
    if (existingResultGroup) {
      updateNodeData(resultGroupId, {
        batches: [...(((existingResultGroup.data as CommerceResultGroupNodeData).batches) ?? []), emptyBatch],
        activeBatchId: emptyBatch.id,
      } as Partial<CanvasNodeData>);
    }
    addEdge(planNode.id, resultGroupId);

    const resultGroupNode = useCanvasStore.getState().nodes.find((node) => node.id === resultGroupId);
    const resultPositionBase = resultGroupNode?.position ?? { x: planNode.position.x + 520, y: planNode.position.y };
    const submittedImages: CommerceAdGeneratedImageRecord[] = [];
    setStatusText(t('commerceAd.agent.statusSubmitting'));
    await canvasAiGateway.setApiKey(selectedPlanModel.providerId, providerApiKey);

    for (const [index, imageRecord] of generationBatch.images.entries()) {
      const prompt = imageRecord.prompt || plan.prompt;
      const resultImageNodeId = addNode(
        CANVAS_NODE_TYPES.exportImage,
        {
          x: resultPositionBase.x + (index % 4) * 260,
          y: resultPositionBase.y + 360 + Math.floor(index / 4) * 300,
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
            providerId: selectedPlanModel.providerId,
            requestModel: requestResolution.requestModel,
            prompt,
            generatedAt: null,
          },
        } as Partial<CanvasNodeData>
      );
      addEdge(resultGroupId, resultImageNodeId);
      try {
        const resolvedPayload = await canvasAiGateway.resolveGenerateImagePayload({
          prompt,
          model: requestResolution.requestModel,
          size: selectedPlanResolution.value,
          aspectRatio: imageRecord.aspectRatio,
          referenceImages,
        });
        const jobId = await canvasAiGateway.submitGenerateImageJob(resolvedPayload);
        updateNodeData(resultImageNodeId, {
          isGenerating: true,
          generationJobId: jobId,
          generationPhase: 'queued',
          generationStartedAt: startedAt,
          generationSourceType: 'imageEdit',
          generationProviderId: selectedPlanModel.providerId,
          generationError: null,
        } as Partial<CanvasNodeData>);
        submittedImages.push({
          ...imageRecord,
          nodeId: resultImageNodeId,
          status: 'running',
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        updateNodeData(resultImageNodeId, {
          isGenerating: false,
          generationPhase: 'failed',
          generationError: message,
        } as Partial<CanvasNodeData>);
        submittedImages.push({
          ...imageRecord,
          nodeId: resultImageNodeId,
          status: 'failed',
          error: message,
        });
      }
    }

    const submittedBatch: CommerceAdGenerationBatch = {
      ...generationBatch,
      images: submittedImages,
    };
    const latestResultGroup = useCanvasStore.getState().nodes.find((node) => node.id === resultGroupId) as
      | (CanvasNode & { data: CommerceResultGroupNodeData })
      | undefined;
    updateNodeData(resultGroupId, {
      batches: [
        ...((latestResultGroup?.data.batches ?? []).filter((batch) => batch.id !== submittedBatch.id)),
        submittedBatch,
      ],
      activeBatchId: submittedBatch.id,
    } as Partial<CanvasNodeData>);
    updateNodeData(planNode.id, {
      status: 'ready',
      lastError: null,
    } as Partial<CanvasNodeData>);
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
    settings.storyboardApi2OkModelConfig,
    settings.storyboardApiKeys,
    settings.storyboardCompatibleModelConfig,
    settings.storyboardNewApiModelConfig,
    settings.storyboardProviderCustomModels,
    t,
    updateNodeData,
  ]);

  const handleRetryGeneratedImage = useCallback(async (batchId: string, imageId: string) => {
    const batch = resultNode?.data.batches.find((item) => item.id === batchId);
    const imageRecord = batch?.images.find((item) => item.id === imageId);
    if (!batch || !imageRecord) {
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

    const referenceImages = productReferenceImages.slice(0, COMMERCE_PRODUCT_REFERENCE_IMAGE_LIMIT);
    const requestResolution = selectedImageModel.resolveRequest({
      referenceImageCount: referenceImages.length,
    });
    const startedAt = Date.now();
    const generationDurationMs = selectedImageModel.expectedDurationMs ?? 60000;
    const prompt = imageRecord.prompt || batch.corePrompt;
    const resultNodeId = imageRecord.nodeId;

    const updateResultImage = (patch: Partial<CommerceAdGeneratedImageRecord>) => {
      applyActions([{
        type: 'upsertResultGroup',
        data: {
          activeBatchId: batch.id,
          batches: (resultNode?.data.batches ?? []).map((item) => (
            item.id === batch.id
              ? {
                  ...item,
                  images: item.images.map((image) => (
                    image.id === imageRecord.id ? { ...image, ...patch } : image
                  )),
                }
              : item
          )),
        },
      }], { focusLastTouched: false });
    };

    updateResultImage({
      status: 'running',
      error: null,
      imageUrl: null,
      previewImageUrl: null,
    });
    if (resultNodeId) {
      updateNodeData(resultNodeId, {
        imageUrl: null,
        previewImageUrl: null,
        isGenerating: true,
        generationPhase: 'submitting',
        generationStartedAt: startedAt,
        generationDurationMs,
        generationSummary: {
          sourceType: 'imageEdit',
          providerId: selectedImageModel.providerId,
          requestModel: requestResolution.requestModel,
          prompt,
          generatedAt: null,
        },
        generationError: null,
      } as Partial<CanvasNodeData>);
    }

    setStatusText(t('commerceAd.agent.statusSubmitting'));
    await canvasAiGateway.setApiKey(selectedImageModel.providerId, providerApiKey);
    try {
      const resolvedPayload = await canvasAiGateway.resolveGenerateImagePayload({
        prompt,
        model: requestResolution.requestModel,
        size: selectedResolution.value,
        aspectRatio: imageRecord.aspectRatio,
        referenceImages,
      });
      const jobId = await canvasAiGateway.submitGenerateImageJob(resolvedPayload);
      if (resultNodeId) {
        updateNodeData(resultNodeId, {
          isGenerating: true,
          generationJobId: jobId,
          generationPhase: 'queued',
          generationStartedAt: startedAt,
          generationSourceType: 'imageEdit',
          generationProviderId: selectedImageModel.providerId,
          generationError: null,
        } as Partial<CanvasNodeData>);
      }
      updateResultImage({
        status: 'running',
        error: null,
        nodeId: resultNodeId ?? null,
      });
      setStatusText(t('commerceAd.agent.retrySubmitted'));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (resultNodeId) {
        updateNodeData(resultNodeId, {
          isGenerating: false,
          generationPhase: 'failed',
          generationError: message,
        } as Partial<CanvasNodeData>);
      }
      updateResultImage({
        status: 'failed',
        error: message,
        nodeId: resultNodeId ?? null,
      });
      setStatusText(t('commerceAd.agent.statusFailed'));
    }
  }, [
    applyActions,
    productReferenceImages,
    resultNode?.data.batches,
    selectedImageModel,
    selectedResolution.value,
    settings.storyboardApiKeys,
    t,
    updateNodeData,
  ]);

  useEffect(() => {
    const handleStartImageGeneration = () => {
      void handleGenerate();
    };
    window.addEventListener(COMMERCE_START_IMAGE_GENERATION_EVENT, handleStartImageGeneration);
    return () => {
      window.removeEventListener(COMMERCE_START_IMAGE_GENERATION_EVENT, handleStartImageGeneration);
    };
  }, [handleGenerate]);

  useEffect(() => {
    const handleStartAgentPlanGeneration = (event: Event) => {
      const detail = (event as CustomEvent<{ planNodeId?: string }>).detail;
      if (!detail?.planNodeId) {
        return;
      }
      void handleGenerateFromAgentPlan(detail.planNodeId);
    };
    window.addEventListener(COMMERCE_START_AGENT_PLAN_GENERATION_EVENT, handleStartAgentPlanGeneration);
    return () => {
      window.removeEventListener(COMMERCE_START_AGENT_PLAN_GENERATION_EVENT, handleStartAgentPlanGeneration);
    };
  }, [handleGenerateFromAgentPlan]);

  useEffect(() => {
    const handleRetryImageGeneration = (event: Event) => {
      const detail = (event as CustomEvent<{ batchId?: string; imageId?: string }>).detail;
      if (!detail?.batchId || !detail.imageId) {
        return;
      }
      void handleRetryGeneratedImage(detail.batchId, detail.imageId);
    };
    window.addEventListener(COMMERCE_RETRY_IMAGE_GENERATION_EVENT, handleRetryImageGeneration);
    return () => {
      window.removeEventListener(COMMERCE_RETRY_IMAGE_GENERATION_EVENT, handleRetryImageGeneration);
    };
  }, [handleRetryGeneratedImage]);

  useEffect(() => {
    const handleSyncDownstream = () => {
      const product = productNode?.data ?? null;
      if (!product && productImages.length === 0) {
        setStatusText(t('commerceAd.agent.needProductReferenceBeforeGenerate'));
        return;
      }
      void runAgent(
        composeProductUserInfo(
          product?.lockedDocumentInfo ?? lockedDocumentInfo,
          product?.userIdeaInfo ?? product?.userInfo ?? userIdeaInfo
        ),
        product ?? undefined,
        visualPreferenceNode?.data ?? visualPreferenceDraft,
        'syncProductInfo',
        { hideUserMessage: true }
      );
    };
    window.addEventListener(COMMERCE_SYNC_DOWNSTREAM_EVENT, handleSyncDownstream);
    return () => {
      window.removeEventListener(COMMERCE_SYNC_DOWNSTREAM_EVENT, handleSyncDownstream);
    };
  }, [
    lockedDocumentInfo,
    productImages.length,
    productNode?.data,
    runAgent,
    t,
    userIdeaInfo,
    visualPreferenceDraft,
    visualPreferenceNode?.data,
  ]);

  const handleSubmit = useCallback(() => {
    const text = draft.trim();
    if (isThinking || (!text && chatImages.length === 0)) {
      return;
    }
    setDraft('');
    void (async () => {
      const nextUserMessage = text || t('commerceAd.agentPlan.imageOnlyPrompt');
      setMessages((items) => [...items, createLocalMessage('user', nextUserMessage)]);
      setIsThinking(true);
      setActiveAgentTask('chat');
      setStatusText(t('commerceAd.agentPlan.statusThinking'));
      try {
        const product = createDefaultCommerceAdProductState();
        product.images = chatImages;
        product.userInfo = text;
        product.userIdeaInfo = text;
        const agentResult = await runCommerceAdAgentTurn({
          userMessage: text || nextUserMessage,
          product,
          brief: null,
          visualPreference: createDefaultCommerceAdVisualPreferenceState(),
          batch: null,
          referenceImages: dedupeStrings(chatImages.map((image) => image.imageUrl)),
          canUseVisionModel: true,
        });
        setMessages((items) => [...items, agentResult.assistantMessage]);
        const planState = composeAgentPlanState({
          text,
          images: chatImages,
          selectedSkillId,
          resultActions: agentResult.actions,
          fallbackModelId: COMMERCE_DEFAULT_IMAGE_MODEL_ID,
          fallbackProviderId: getImageModel(
            COMMERCE_DEFAULT_IMAGE_MODEL_ID,
            settings.storyboardCompatibleModelConfig,
            settings.storyboardNewApiModelConfig,
            settings.storyboardApi2OkModelConfig,
            settings.storyboardProviderCustomModels
          ).providerId,
          fallbackSize: COMMERCE_DEFAULT_RESOLUTION,
          fallbackRatios: ['4:5'],
        });
        upsertAgentPlanNode(planState);
        setStatusText(t('commerceAd.agentPlan.statusPlanCreated'));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setMessages((items) => [
          ...items,
          createLocalMessage('assistant', t('commerceAd.agent.errorMessage', { message })),
        ]);
        setStatusText(t('commerceAd.agentPlan.statusFailed'));
      } finally {
        setIsThinking(false);
        setActiveAgentTask(null);
        setChatImages([]);
      }
    })();
  }, [
    chatImages,
    draft,
    isThinking,
    selectedSkillId,
    settings.storyboardApi2OkModelConfig,
    settings.storyboardCompatibleModelConfig,
    settings.storyboardNewApiModelConfig,
    settings.storyboardProviderCustomModels,
    t,
    upsertAgentPlanNode,
  ]);

  const handleChatDrop = useCallback((event: ReactDragEvent<HTMLTextAreaElement>) => {
    event.preventDefault();
    setIsChatDragActive(false);
    const files = Array.from(event.dataTransfer.files ?? []).filter((file) => file.type.startsWith('image/'));
    if (files.length > 0) {
      void addChatImagesFromFiles(files);
    }
  }, [addChatImagesFromFiles]);

  const handleChatDragOver = useCallback((event: ReactDragEvent<HTMLTextAreaElement>) => {
    event.preventDefault();
    setIsChatDragActive(true);
  }, []);

  const handleChatDragLeave = useCallback(() => {
    setIsChatDragActive(false);
  }, []);

  const activeModuleTitle = t(`commerceAd.agent.modules.${activeModule}.title`);
  const isSyncProductInfoRunning = activeAgentTask === 'syncProductInfo';
  const isChatRunning = activeAgentTask === 'chat';

  return (
    <div className="flex h-full min-h-0 w-full bg-bg-base">
      <div className="relative min-w-0 flex-1">
        <Canvas />
        <CommerceAgentModuleSwitcher
          activeModule={activeModule}
          onChange={(moduleId) => {
            setActiveModule(moduleId);
            if (moduleId === 'detailPage') {
              setIsDetailSetupOpen(true);
            }
          }}
        />
        {shouldShowVisionWarning ? (
          <VisionModelWarningBar
            isOpen={isVisionWarningOpen}
            onToggle={() => setIsVisionWarningOpen((open) => !open)}
            onOpenSettings={() => openSettingsDialog({ category: 'providers' })}
          />
        ) : null}
      </div>
      <aside className="relative flex h-full w-[400px] shrink-0 flex-col border-l border-border-dark/70 bg-surface-dark/95 shadow-2xl">
        <div className="border-b border-border-dark/70 px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-border-dark/70 bg-bg-dark text-text-dark">
              <MessageSquareText className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <h2 className="truncate text-sm font-semibold text-text-dark">
                {activeModuleTitle}
              </h2>
              <p className="truncate text-xs text-text-muted">
                {activeTextModel
                  ? t('commerceAd.agent.modelStatus', { model: activeTextModel })
                  : t('commerceAd.agent.noModel')}
              </p>
            </div>
          </div>
        </div>

        <div className="ui-scrollbar flex-1 overflow-y-auto px-4 pb-4">
          <section className="space-y-2 pt-4">
            {visibleMessages.length === 0 ? (
              <div className="rounded-lg border border-border-dark/70 bg-bg-dark/50 p-3 text-sm leading-6 text-text-muted">
                <div className="font-medium text-text-dark">
                  {t('commerceAd.agent.guidance.emptyTitle')}
                </div>
                <p className="mt-1 text-xs leading-5 text-text-muted">
                  {t('commerceAd.agent.emptyConversation')}
                </p>
              </div>
            ) : visibleMessages.map((message) => (
              <div
                key={message.id}
                className={message.role === 'user'
                  ? 'rounded-lg border border-text-dark/10 bg-text-dark/[0.08] px-3 py-2 text-sm leading-6 text-text-dark'
                  : 'rounded-lg border border-border-dark/70 bg-bg-dark/70 px-3 py-2 text-sm leading-6 text-text-dark/90'}
              >
                <div className="whitespace-pre-wrap">{message.content}</div>
              </div>
            ))}
          </section>
        </div>

        <div className="border-t border-border-dark/70 p-3">
          {statusText ? (
            <div className="mb-2 text-xs text-text-muted">{statusText}</div>
          ) : null}
          {chatImages.length > 0 ? (
            <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
              {chatImages.map((image) => (
                <div key={image.id} className="relative h-12 w-12 shrink-0 overflow-hidden rounded-md border border-border-dark/70 bg-bg-dark">
                  <img
                    src={resolveImageDisplayUrl(image.previewImageUrl || image.imageUrl)}
                    alt={image.label}
                    className="h-full w-full object-cover"
                    draggable={false}
                  />
                  <button
                    type="button"
                    className="absolute right-0.5 top-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full bg-black/70 text-[10px] text-white"
                    onClick={() => handleRemoveChatImage(image.id)}
                    aria-label={t('commerceAd.agent.removeChatImage')}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          ) : null}
          <div className="mb-2 flex items-center justify-between gap-2">
            <button
              type="button"
              className="inline-flex h-8 items-center gap-2 rounded-full border border-border-dark/70 bg-bg-dark px-3 text-xs text-text-dark transition hover:bg-text-dark/[0.06]"
              onClick={() => chatImageFileInputRef.current?.click()}
            >
              <ImagePlus className="h-3.5 w-3.5" />
              {t('commerceAd.agent.upload')}
            </button>
            <button
              type="button"
              className="inline-flex h-8 items-center gap-2 rounded-full border border-border-dark/70 bg-bg-dark px-3 text-xs text-text-dark transition hover:bg-text-dark/[0.06]"
              onClick={() => setIsSkillsOpen((open) => !open)}
            >
              <BookOpen className="h-3.5 w-3.5" />
              {t('commerceAd.agent.skills')}
            </button>
          </div>
          {isSkillsOpen ? (
            <div className="mb-2 rounded-lg border border-border-dark/70 bg-bg-dark/90 p-3 text-xs text-text-muted">
              {COMMERCE_AGENT_SKILLS.length === 0 ? (
                <div>{t('commerceAd.agent.skillsEmpty')}</div>
              ) : null}
            </div>
          ) : null}
          <input
            ref={chatImageFileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={handleChatImageInputChange}
          />
          <UiTextAreaField
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            rows={4}
            className={`min-h-[120px] ${isChatDragActive ? 'border-text-dark/40 bg-text-dark/[0.04]' : ''}`}
            placeholder={t('commerceAd.agent.chatPlaceholder')}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                handleSubmit();
              }
            }}
            onPaste={handleChatPaste}
            onDragOver={handleChatDragOver}
            onDragLeave={handleChatDragLeave}
            onDrop={handleChatDrop}
          />
          <div className="mt-2 flex items-center justify-between gap-2">
            <div className="text-[11px] text-text-muted">
              {isThinking ? t('commerceAd.agent.statusThinking') : t('commerceAd.agentPlan.helperText')}
            </div>
            <UiButton
              type="button"
              className="h-9 gap-2 px-4"
              onClick={handleSubmit}
              disabled={isThinking || (!draft.trim() && chatImages.length === 0)}
              aria-label={t('commerceAd.agent.send')}
            >
              {isChatRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {t('commerceAd.agent.send')}
            </UiButton>
          </div>
        </div>
      </aside>
      <CommerceDetailPageSetupModal
        isOpen={isDetailSetupOpen}
        onClose={() => setIsDetailSetupOpen(false)}
        activeModuleTitle={t('commerceAd.agent.modules.detailPage.title')}
        productImages={productImages}
        isProductImageLimitReached={isProductImageLimitReached}
        uploading={uploading}
        isThinking={isThinking}
        isSyncProductInfoRunning={isSyncProductInfoRunning}
        isProductInfoCollapsed={isProductInfoCollapsed}
        isVisualPreferenceCollapsed={isVisualPreferenceCollapsed}
        isBatchSettingsCollapsed={isBatchSettingsCollapsed}
        detailInputMode={detailInputMode}
        lockedDocumentInfo={lockedDocumentInfo}
        userIdeaInfo={userIdeaInfo}
        detailPages={detailPages}
        hasManualPageLockedInfo={hasManualPageLockedInfo}
        hasResolvedProductInfo={hasResolvedProductInfo}
        visualPreferenceDraft={visualPreferenceDraft}
        visualPreferenceSummary={visualPreferenceSummary}
        imageProviderOptions={imageProviderOptions}
        selectedImageModel={selectedImageModel}
        selectedProviderImageModels={selectedProviderImageModels}
        selectedResolution={selectedResolution}
        resolutionOptions={resolutionOptions}
        ratioOptions={ratioOptions}
        currentRatios={currentRatios}
        currentVariantsPerRatio={currentVariantsPerRatio}
        currentBatchCount={currentBatchCount}
        canCreateDetailPageBatch={canCreateDetailPageBatch}
        productionSummary={productionSummary}
        detailPageCount={detailPageCount}
        plannedImageCount={plannedImageCount}
        fileInputRef={fileInputRef}
        replaceFileInputRef={replaceFileInputRef}
        userIdeaInfoRef={userIdeaInfoRef}
        productInfoContentRef={productInfoContentRef}
        visualPreferenceContentRef={visualPreferenceContentRef}
        batchSettingsContentRef={batchSettingsContentRef}
        onFilesSelected={handleFilesSelected}
        onReplaceProductImageSelected={handleReplaceProductImageSelected}
        onUploadClick={handleUploadClick}
        onReplaceProductImageClick={handleReplaceProductImageClick}
        onDeleteProductImage={handleDeleteProductImage}
        onUpdateProductImageDescription={handleUpdateProductImageDescription}
        onToggleProductInfoCollapsed={toggleProductInfoCollapsed}
        onToggleVisualPreferenceCollapsed={toggleVisualPreferenceCollapsed}
        onToggleBatchSettingsCollapsed={toggleBatchSettingsCollapsed}
        onDetailInputModeChange={(mode) => {
          setDetailInputMode(mode);
          if (productNode) {
            updateNodeData(productNode.id, { detailInputMode: mode } as Partial<CanvasNodeData>);
          }
        }}
        onLockedDocumentInfoChange={setLockedDocumentInfo}
        onUserIdeaInfoChange={setUserIdeaInfo}
        onAddDetailPage={handleAddDetailPage}
        onDeleteDetailPage={handleDeleteDetailPage}
        onMoveDetailPage={handleMoveDetailPage}
        onUpdateDetailPage={handleUpdateDetailPage}
        onUpdateVisualPreference={updateVisualPreferenceDraft}
        onImageProviderChange={handleImageProviderChange}
        onImageModelChange={handleImageModelChange}
        onTogglePageRatio={togglePageRatio}
        onUpdateBatchConfig={updateBatchConfig}
        onGenerateNodeInfo={handleGenerateNodeInfo}
      />
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
