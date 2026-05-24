import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type UIEvent } from 'react';
import { ReactFlowProvider, useReactFlow } from '@xyflow/react';
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  ImageUp,
  ImagePlus,
  Loader2,
  MessageSquareText,
  Send,
  Settings,
  Sparkles,
  X,
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
  type CanvasNodeData,
  type CommerceBatchGenerateNodeData,
  type CommerceBriefNodeData,
  type CommerceProductNodeData,
  type CommerceResultGroupNodeData,
  type CommerceVisualPreferenceNodeData,
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
  createDefaultCommerceAdBriefState,
  createDefaultCommerceAdResultGroupState,
  createDefaultCommerceAdVisualPreferenceState,
  normalizeCommerceAdVisualPreferenceState,
  type CommerceAdAgentMessage,
  type CommerceAdAgentAction,
  type CommerceAdAgentGuidance,
  type CommerceAdBatchGenerateState,
  type CommerceAdGeneratedImageRecord,
  type CommerceAdGenerationBatch,
  type CommerceAdProductImage,
  type CommerceAdProductState,
  type CommerceAdVisualPreferenceState,
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

const PRODUCT_INFO_FIELD_KEYS = [
  'coreSellingPoints',
  'targetAudience',
  'materials',
  'restrictions',
  'specModel',
] as const;
const COMMERCE_AGENT_PANEL_WIDTH_STORAGE_KEY = 'commerce-agent-panel-width';
const COMMERCE_AGENT_PRODUCT_INFO_COLLAPSED_STORAGE_KEY = 'commerce-agent-product-info-collapsed';
const COMMERCE_AGENT_VISUAL_PREFERENCE_COLLAPSED_STORAGE_KEY = 'commerce-agent-visual-preference-collapsed';
const COMMERCE_AGENT_BATCH_SETTINGS_COLLAPSED_STORAGE_KEY = 'commerce-agent-batch-settings-collapsed';
const COMMERCE_AGENT_PANEL_DEFAULT_WIDTH = 400;
const COMMERCE_AGENT_PANEL_MIN_WIDTH = 360;
const COMMERCE_AGENT_PANEL_MAX_WIDTH = 640;
const DEFAULT_AGENT_MESSAGES: CommerceAdAgentMessage[] = [];
const COMMERCE_DEFAULT_IMAGE_MODEL_ID = STORYBOARD_OOPII_MODEL_ID;
const COMMERCE_DEFAULT_RESOLUTION = '2K';
const VISUAL_PREFERENCE_OPTION_KEYS = {
  designStyle: [
    'auto',
    'minimalist',
    'premium_luxury',
    'luxury_minimal',
    'natural_organic',
    'warm_cozy',
    'soft_editorial_lifestyle',
    'tech_modern',
    'dynamic_vitality',
    'professional_clean',
    'clean_beauty_commercial',
    'editorial_magazine',
    'bold_graphic_poster',
    'fashion_campaign',
    'cute_playful',
    'retro_trendy',
    'industrial_precision',
  ],
  colorPalette: [
    'auto_extract',
    'light_bright',
    'dark_moody',
    'warm_tones',
    'cool_tones',
    'high_contrast',
    'soft_muted',
    'cream_beige',
    'black_gold',
    'silver_gray',
  ],
  platformVisual: [
    'general',
    'taobao',
    'jd',
    'amazon',
    'xiaohongshu',
    'tiktok',
    'pinduoduo',
    'shopify',
  ],
  language: ['zhCN', 'zhTW', 'enUS', 'jaJP', 'koKR', 'deDE', 'frFR', 'ruRU', 'esES', 'arSA'],
} as const;
const BRAND_ACCENT_PRESETS = [
  { key: 'red', color: '#EF4444' },
  { key: 'orange', color: '#F97316' },
  { key: 'gold', color: '#F59E0B' },
  { key: 'blue', color: '#3B82F6' },
  { key: 'green', color: '#10B981' },
  { key: 'purple', color: '#8B5CF6' },
  { key: 'pink', color: '#EC4899' },
  { key: 'black', color: '#111827' },
] as const;

function clampAgentPanelWidth(value: number): number {
  return Math.min(
    COMMERCE_AGENT_PANEL_MAX_WIDTH,
    Math.max(COMMERCE_AGENT_PANEL_MIN_WIDTH, Math.round(value))
  );
}

function readAgentPanelWidth(): number {
  if (typeof window === 'undefined') {
    return COMMERCE_AGENT_PANEL_DEFAULT_WIDTH;
  }

  const raw = Number(window.localStorage.getItem(COMMERCE_AGENT_PANEL_WIDTH_STORAGE_KEY));
  if (!Number.isFinite(raw) || raw <= 0) {
    return COMMERCE_AGENT_PANEL_DEFAULT_WIDTH;
  }

  return clampAgentPanelWidth(raw);
}

function readStoredBoolean(key: string, fallback: boolean): boolean {
  if (typeof window === 'undefined') {
    return fallback;
  }

  const raw = window.localStorage.getItem(key);
  return raw === null ? fallback : raw === 'true';
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

function normalizeProductImageRoles(images: CommerceAdProductImage[]): CommerceAdProductImage[] {
  return images.map((image, index) => ({
    ...image,
    kind: index === 0 ? 'main' : 'reference',
  }));
}

function createImageChangedProductState(images: CommerceAdProductImage[], userInfo: string): CommerceAdProductState {
  return {
    images: normalizeProductImageRoles(images),
    brand: '',
    productName: '',
    category: '',
    userInfo,
    inference: null,
    lastAnalyzedAt: null,
    lastError: null,
  };
}

function normalizeBrandAccentInput(value: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.toLowerCase() === 'auto') {
    return 'auto';
  }
  const preset = BRAND_ACCENT_PRESETS.find((item) => item.color.toLowerCase() === normalized.toLowerCase());
  if (preset) {
    return preset.color;
  }
  return /^#[0-9a-f]{6}$/i.test(normalized) ? normalized.toUpperCase() : normalized;
}

function composeVisualPreferenceSummary(preference: CommerceAdVisualPreferenceState): string {
  const accent = preference.brandAccentColor.toLowerCase() === 'auto'
    ? '品牌强调色自动提取'
    : `品牌强调色 ${preference.brandAccentColor}`;
  return [
    preference.designStyle,
    preference.colorPalette,
    preference.platformVisual,
    preference.language,
    accent,
  ].filter(Boolean).join(' / ');
}

function composeVisualPreferencePromptFragment(preference: CommerceAdVisualPreferenceState): string {
  const accent = preference.brandAccentColor.toLowerCase() === 'auto'
    ? '品牌强调色自动从商品主色或品牌识别中提取'
    : `品牌强调色使用 ${preference.brandAccentColor}`;
  return `视觉与排版偏好：设计风格为${preference.designStyle}，整体配色为${preference.colorPalette}，平台视觉偏好为${preference.platformVisual}，画面语言为${preference.language}，${accent}。`;
}

function buildVisualPreferencePatch(
  preference: CommerceAdVisualPreferenceState
): CommerceAdVisualPreferenceState {
  const normalized = normalizeCommerceAdVisualPreferenceState({
    ...preference,
    brandAccentColor: normalizeBrandAccentInput(preference.brandAccentColor),
    updatedAt: Date.now(),
  });
  return {
    ...normalized,
    summary: composeVisualPreferenceSummary(normalized),
    promptFragment: composeVisualPreferencePromptFragment(normalized),
    updatedAt: Date.now(),
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
  const replaceFileInputRef = useRef<HTMLInputElement | null>(null);
  const manualProductInfoRef = useRef<HTMLTextAreaElement | null>(null);
  const productInfoContentRef = useRef<HTMLElement | null>(null);
  const visualPreferenceContentRef = useRef<HTMLElement | null>(null);
  const batchSettingsContentRef = useRef<HTMLElement | null>(null);
  const agentScrollAreaRef = useRef<HTMLDivElement | null>(null);
  const panelResizeStateRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const replaceImageIdRef = useRef<string | null>(null);
  const [messages, setMessages] = useState<CommerceAdAgentMessage[]>(DEFAULT_AGENT_MESSAGES);
  const [draft, setDraft] = useState('');
  const [manualProductInfo, setManualProductInfo] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [statusText, setStatusText] = useState<string | null>(null);
  const [selectedGuidanceChoiceKeys, setSelectedGuidanceChoiceKeys] = useState<string[]>([]);
  const [isVisionWarningOpen, setIsVisionWarningOpen] = useState(false);
  const [agentPanelWidth, setAgentPanelWidth] = useState(() => readAgentPanelWidth());
  const [isAgentPanelResizing, setIsAgentPanelResizing] = useState(false);
  const [isProductInfoCollapsed, setIsProductInfoCollapsed] = useState(() => (
    readStoredBoolean(COMMERCE_AGENT_PRODUCT_INFO_COLLAPSED_STORAGE_KEY, false)
  ));
  const [isVisualPreferenceCollapsed, setIsVisualPreferenceCollapsed] = useState(() => (
    readStoredBoolean(COMMERCE_AGENT_VISUAL_PREFERENCE_COLLAPSED_STORAGE_KEY, false)
  ));
  const [isBatchSettingsCollapsed, setIsBatchSettingsCollapsed] = useState(() => (
    readStoredBoolean(COMMERCE_AGENT_BATCH_SETTINGS_COLLAPSED_STORAGE_KEY, false)
  ));
  const [visualPreferenceDraft, setVisualPreferenceDraft] = useState<CommerceAdVisualPreferenceState>(() => (
    createDefaultCommerceAdVisualPreferenceState()
  ));
  const [isProductHeaderCompact, setIsProductHeaderCompact] = useState(false);

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
  const visualPreferenceNode = useMemo(
    () => findStageNode<CommerceVisualPreferenceNodeData>(nodes, CANVAS_NODE_TYPES.commerceVisualPreference),
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

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(
      COMMERCE_AGENT_PANEL_WIDTH_STORAGE_KEY,
      String(agentPanelWidth)
    );
  }, [agentPanelWidth]);

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
    if (!isAgentPanelResizing || typeof window === 'undefined') {
      return;
    }

    const handlePointerMove = (event: PointerEvent) => {
      const resizeState = panelResizeStateRef.current;
      if (!resizeState) {
        return;
      }

      setAgentPanelWidth(clampAgentPanelWidth(
        resizeState.startWidth + (resizeState.startX - event.clientX)
      ));
    };

    const handlePointerUp = () => {
      panelResizeStateRef.current = null;
      setIsAgentPanelResizing(false);
    };

    const handleSelectStart = (event: Event) => {
      event.preventDefault();
    };

    if (typeof document !== 'undefined') {
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    }

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('selectstart', handleSelectStart);
    return () => {
      if (typeof document !== 'undefined') {
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('selectstart', handleSelectStart);
    };
  }, [isAgentPanelResizing]);

  const handleAgentScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    setIsProductHeaderCompact(event.currentTarget.scrollTop > 64);
  }, []);

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
          manualProductInfoRef.current?.focus();
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
    () => dedupeStrings(productImages.map((image) => image.imageUrl)),
    [productImages]
  );
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
  const ratioOptions = selectedImageModel.aspectRatios;
  const currentRatios = useMemo(() => {
    return resolveCommerceAspectRatiosForModel(selectedImageModel, batchNode?.data.aspectRatios ?? []);
  }, [batchNode?.data.aspectRatios, selectedImageModel]);
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
    productOverride?: CommerceAdProductState,
    visualPreferenceOverride?: CommerceAdVisualPreferenceState
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
        visualPreference: visualPreferenceOverride ?? visualPreferenceNode?.data ?? visualPreferenceDraft,
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
    visualPreferenceDraft,
    visualPreferenceNode?.data,
  ]);

  const handleUploadClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const resetCommerceDataAfterProductImageChange = useCallback((nextImages: CommerceAdProductImage[]) => {
    const userInfo = manualProductInfo.trim() || productNode?.data.userInfo || '';
    if (productNode) {
      updateNodeData(
        productNode.id,
        createImageChangedProductState(nextImages, userInfo) as Partial<CanvasNodeData>
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
        aspectRatios: currentRatios,
        variantsPerRatio: currentVariants,
        modelId: selectedImageModel.id,
        size: selectedResolution.value,
        corePrompt: '',
        ratioPrompts: {},
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
    currentRatios,
    currentVariants,
    manualProductInfo,
    productNode,
    resultNode,
    selectedImageModel.id,
    selectedResolution.value,
    updateNodeData,
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

  const handleInsertProductInfoField = useCallback((label: string) => {
    const title = `${label}：`;
    const titleIndex = manualProductInfo.indexOf(title);

    if (titleIndex >= 0) {
      const cursorPosition = titleIndex + title.length;
      manualProductInfoRef.current?.focus();
      requestAnimationFrame(() => {
        manualProductInfoRef.current?.setSelectionRange(cursorPosition, cursorPosition);
      });
      return;
    }

    const trimmedEnd = manualProductInfo.replace(/\s+$/u, '');
    const prefix = trimmedEnd.length > 0 ? `${trimmedEnd}\n` : '';
    const nextValue = `${prefix}${title}`;
    const cursorPosition = nextValue.length;

    setManualProductInfo(nextValue);
    requestAnimationFrame(() => {
      manualProductInfoRef.current?.focus();
      manualProductInfoRef.current?.setSelectionRange(cursorPosition, cursorPosition);
    });
  }, [manualProductInfo]);

  const handleManualProductInfoKeyDown = useCallback((event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Tab') {
      return;
    }

    event.preventDefault();
    const textarea = event.currentTarget;
    const selectionStart = textarea.selectionStart;
    const selectionEnd = textarea.selectionEnd;
    const nextValue = `${manualProductInfo.slice(0, selectionStart)}\n${manualProductInfo.slice(selectionEnd)}`;
    const cursorPosition = selectionStart + 1;

    setManualProductInfo(nextValue);
    requestAnimationFrame(() => {
      manualProductInfoRef.current?.focus();
      manualProductInfoRef.current?.setSelectionRange(cursorPosition, cursorPosition);
    });
  }, [manualProductInfo]);

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
    setStatusText(t('commerceAd.agent.statusThinking'));
    void runAgent(userInfo, nextProduct);
  }, [applyActions, manualProductInfo, productNode?.data, runAgent, t]);

  const updateVisualPreferenceDraft = useCallback((data: Partial<CommerceAdVisualPreferenceState>) => {
    setVisualPreferenceDraft((current) => normalizeCommerceAdVisualPreferenceState({
      ...current,
      ...data,
    }));
  }, []);

  const handleSyncVisualPreference = useCallback(() => {
    const nextPreference = buildVisualPreferencePatch(visualPreferenceDraft);
    setVisualPreferenceDraft(nextPreference);
    applyActions([{ type: 'upsertVisualPreference', data: nextPreference }]);
    setStatusText(t('commerceAd.agent.statusThinking'));
    void runAgent(
      `${t('commerceAd.agent.visualPreference.syncInstruction')}\n${nextPreference.promptFragment}`,
      undefined,
      nextPreference
    );
  }, [applyActions, runAgent, t, visualPreferenceDraft]);

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
      <div className="relative min-w-0 flex-1">
        <Canvas />
        {shouldShowVisionWarning ? (
          <VisionModelWarningBar
            isOpen={isVisionWarningOpen}
            onToggle={() => setIsVisionWarningOpen((open) => !open)}
            onOpenSettings={() => openSettingsDialog({ category: 'providers' })}
          />
        ) : null}
      </div>
      <aside
        className={`relative flex h-full shrink-0 flex-col border-l border-border-dark/70 bg-surface-dark/95 shadow-2xl ${
          isAgentPanelResizing ? 'transition-none' : 'transition-[width] duration-200'
        }`}
        style={{ width: agentPanelWidth }}
      >
        <div
          className="absolute left-0 top-0 z-20 h-full w-[6px] -translate-x-1/2 cursor-col-resize touch-none transition-colors hover:bg-white/16"
          onPointerDown={(event) => {
            event.preventDefault();
            panelResizeStateRef.current = {
              startX: event.clientX,
              startWidth: agentPanelWidth,
            };
            setIsAgentPanelResizing(true);
          }}
        />
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

        <div
          ref={agentScrollAreaRef}
          className="ui-scrollbar flex-1 overflow-y-auto px-4 pb-4"
          onScroll={handleAgentScroll}
        >
          <div className="sticky top-0 z-20 -mx-4 border-b border-border-dark/70 bg-surface-dark/95 px-4 py-3 shadow-[0_12px_28px_rgba(0,0,0,0.18)] backdrop-blur">
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                {productImages.length > 0 && isProductHeaderCompact ? (
                  <div className="h-11 w-11 shrink-0 overflow-hidden rounded-lg border border-border-dark/70 bg-bg-dark">
                    <img
                      src={resolveImageDisplayUrl(productImages[0].previewImageUrl || productImages[0].imageUrl)}
                      alt={productImages[0].label}
                      className="h-full w-full object-contain"
                      draggable={false}
                    />
                  </div>
                ) : null}
                <div className="min-w-0">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-text-muted">
                    {t('commerceAd.agent.productSection')}
                  </h3>
                  <p className="mt-1 truncate text-xs text-text-muted">
                    {isProductHeaderCompact && productImages.length > 0
                      ? t('commerceAd.agent.productStickySummary', { count: productImages.length })
                      : t('commerceAd.agent.productSectionHint')}
                  </p>
                </div>
              </div>
              <UiButton
                type="button"
                size="sm"
                className="shrink-0 gap-2"
                onClick={handleUploadClick}
                disabled={uploading}
              >
                {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImagePlus className="h-3.5 w-3.5" />}
                {t('commerceAd.agent.upload')}
              </UiButton>
            </div>
          </div>
          <section className="space-y-3 py-3">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={handleFilesSelected}
            />
            <input
              ref={replaceFileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleReplaceProductImageSelected}
            />
            {productImages.length > 0 ? (
              <div className={`grid gap-2 transition-all ${isProductHeaderCompact ? 'grid-cols-6 opacity-0 pointer-events-none h-0 overflow-hidden' : 'grid-cols-4'}`}>
                {productImages.slice(0, 8).map((image) => (
                  <div
                    key={image.id}
                    className="group relative aspect-square overflow-hidden rounded-lg border border-border-dark/70 bg-bg-dark"
                  >
                    <img
                      src={resolveImageDisplayUrl(image.previewImageUrl || image.imageUrl)}
                      alt={image.label}
                      className="h-full w-full object-contain"
                      draggable={false}
                    />
                    <div className="absolute inset-0 flex items-start justify-end gap-1 bg-black/0 p-1 opacity-0 transition group-hover:bg-black/30 group-hover:opacity-100 group-focus-within:bg-black/30 group-focus-within:opacity-100">
                      <button
                        type="button"
                        className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-white/20 bg-black/65 text-white shadow-sm transition hover:bg-black/85 focus:outline-none focus:ring-2 focus:ring-white/60 disabled:cursor-not-allowed disabled:opacity-50"
                        onClick={() => handleReplaceProductImageClick(image.id)}
                        disabled={uploading || isThinking}
                        title={t('commerceAd.agent.replaceProductImage')}
                        aria-label={t('commerceAd.agent.replaceProductImage')}
                      >
                        <ImageUp className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-white/20 bg-black/65 text-white shadow-sm transition hover:bg-red-500/90 focus:outline-none focus:ring-2 focus:ring-white/60 disabled:cursor-not-allowed disabled:opacity-50"
                        onClick={() => handleDeleteProductImage(image.id)}
                        disabled={uploading || isThinking}
                        title={t('commerceAd.agent.deleteProductImage')}
                        aria-label={t('commerceAd.agent.deleteProductImage')}
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
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

          <button
            type="button"
            className="sticky top-[68px] z-30 -mx-4 flex w-[calc(100%+2rem)] items-start gap-2 border-b border-border-dark/60 bg-surface-dark/95 px-4 py-2 text-left backdrop-blur"
            onClick={toggleProductInfoCollapsed}
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
                {isProductInfoCollapsed && manualProductInfo.trim()
                  ? t('commerceAd.agent.productInfoCollapsedFilled')
                  : t('commerceAd.agent.productInfoHint')}
              </span>
            </span>
          </button>
          {!isProductInfoCollapsed ? (
            <section ref={productInfoContentRef} className="scroll-mt-[132px] space-y-3 py-3">
              <UiTextAreaField
                ref={manualProductInfoRef}
                value={manualProductInfo}
                onChange={(event) => setManualProductInfo(event.target.value)}
                onKeyDown={handleManualProductInfoKeyDown}
                rows={4}
                placeholder={t('commerceAd.agent.manualProductPlaceholder')}
              />
              <div className="flex flex-wrap gap-1.5">
                {PRODUCT_INFO_FIELD_KEYS.map((fieldKey) => {
                  const label = t(`commerceAd.agent.productInfoFields.${fieldKey}`);
                  return (
                    <button
                      key={fieldKey}
                      type="button"
                      onClick={() => handleInsertProductInfoField(label)}
                      className="inline-flex h-7 items-center rounded-full border border-border-dark/70 bg-bg-dark/70 px-3 text-xs text-text-muted transition-colors hover:border-text-dark/25 hover:bg-text-dark/10 hover:text-text-dark"
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
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
            </section>
          ) : null}

          {hasResolvedProductInfo ? (
            <>
              <button
                type="button"
                className="sticky top-[128px] z-30 -mx-4 flex w-[calc(100%+2rem)] items-start gap-2 border-b border-border-dark/60 bg-surface-dark/95 px-4 py-2 text-left backdrop-blur"
                onClick={toggleVisualPreferenceCollapsed}
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
                <section ref={visualPreferenceContentRef} className="scroll-mt-[194px] space-y-3 py-3">
                  <label className="block text-xs text-text-muted">
                    <span>{t('commerceAd.fields.designStyle')}</span>
                    <UiSelect
                      value={visualPreferenceDraft.designStyle}
                      className="mt-1"
                      onChange={(event) => updateVisualPreferenceDraft({ designStyle: event.target.value })}
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
                      onChange={(event) => updateVisualPreferenceDraft({ colorPalette: event.target.value })}
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
                      onChange={(event) => updateVisualPreferenceDraft({ platformVisual: event.target.value })}
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
                      onChange={(event) => updateVisualPreferenceDraft({ language: event.target.value })}
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
                        onClick={() => updateVisualPreferenceDraft({ brandAccentColor: 'auto' })}
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
                          onClick={() => updateVisualPreferenceDraft({ brandAccentColor: color })}
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
                      onChange={(event) => updateVisualPreferenceDraft({ brandAccentColor: event.target.value })}
                      placeholder="#3B82F6"
                    />
                  </div>
                  <UiButton
                    type="button"
                    size="sm"
                    variant="muted"
                    className="w-full gap-2"
                    onClick={handleSyncVisualPreference}
                    disabled={isThinking}
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    {t('commerceAd.agent.visualPreference.sync')}
                  </UiButton>
                </section>
              ) : null}
              <button
                type="button"
                className="sticky top-[184px] z-30 -mx-4 flex w-[calc(100%+2rem)] items-start gap-2 border-b border-border-dark/60 bg-surface-dark/95 px-4 py-2 text-left backdrop-blur"
                onClick={toggleBatchSettingsCollapsed}
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
                          count: currentVariants,
                        })
                      : t('commerceAd.agent.batchSettingsHint')}
                  </span>
                </span>
              </button>
              {!isBatchSettingsCollapsed ? (
                <section ref={batchSettingsContentRef} className="scroll-mt-[256px] space-y-3 py-3">
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
                    {ratioOptions.map((ratio) => {
                      const active = currentRatios.includes(ratio.value);
                      return (
                        <button
                          key={ratio.value}
                          type="button"
                          onClick={() => toggleRatio(ratio.value)}
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
              ) : null}
            </>
          ) : (
            <div className="my-3 rounded-lg border border-border-dark/70 bg-bg-dark/50 p-3 text-xs leading-5 text-text-muted">
              {t('commerceAd.agent.batchLockedHint')}
            </div>
          )}

          <section className="space-y-2 pt-4">
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
              rows={4}
              className="min-h-[112px]"
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
