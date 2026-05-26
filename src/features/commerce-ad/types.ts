export type CommerceAdWorkflowStep =
  | 'product'
  | 'brief'
  | 'visualPreference'
  | 'batch'
  | 'results';

export type CommerceAdAgentRole = 'assistant' | 'user' | 'system';

export interface CommerceAdProductImage {
  id: string;
  imageUrl: string;
  previewImageUrl: string;
  aspectRatio: string;
  label: string;
  description: string;
  kind: 'main' | 'reference' | 'logo' | 'packaging';
}

export interface CommerceAdProductInference {
  summary: string;
  productType: string;
  visualDescription: string;
  visibleSellingPoints: string[];
  suggestedUseCases: string[];
  uncertaintyNotes: string[];
  followUpQuestions: string[];
}

export interface CommerceAdProductState {
  images: CommerceAdProductImage[];
  brand: string;
  productName: string;
  category: string;
  detailInputMode: 'auto' | 'manualPages';
  lockedDocumentInfo: string;
  userIdeaInfo: string;
  userInfo: string;
  inference: CommerceAdProductInference | null;
  lastAnalyzedAt: number | null;
  lastError: string | null;
}

export interface CommerceAdDetailPage {
  id: string;
  pageNo: number;
  title: string;
  lockedCopy: string;
  optimizedCopy: string;
  layoutNotes: string;
  prompt: string;
}

export interface CommerceAdBriefState {
  usage: string;
  platform: string;
  audience: string;
  style: string;
  headline: string;
  sellingPoints: string[];
  cta: string;
  mustInclude: string;
  constraints: string;
  normalizedBrief: string;
  optimizedUserIdeaInfo: string;
  detailPages: CommerceAdDetailPage[];
  updatedAt: number | null;
}

export interface CommerceAdVisualPreferenceState {
  designStyle: string;
  colorPalette: string;
  platformVisual: string;
  language: string;
  brandAccentColor: string;
  summary: string;
  promptFragment: string;
  updatedAt: number | null;
}

export interface CommerceAdBatchGenerateState {
  generationMode: 'detailPages' | 'legacyRatios';
  aspectRatios: string[];
  variantsPerRatio: number;
  batchCount: number;
  modelId: string;
  size: string;
  corePrompt: string;
  ratioPrompts: Record<string, string>;
  detailPages: CommerceAdDetailPage[];
  detailPageIds: string[];
  detailPageCount: number;
  stylePromptFragment: string;
  status: 'idle' | 'ready' | 'generating' | 'failed';
  lastGeneratedAt: number | null;
  lastError: string | null;
}

export interface CommerceAdGeneratedImageRecord {
  id: string;
  aspectRatio: string;
  detailPageId?: string;
  detailPageNo?: number;
  detailPageTitle?: string;
  nodeId: string | null;
  prompt: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  imageUrl: string | null;
  previewImageUrl: string | null;
  error: string | null;
}

export interface CommerceAdGenerationBatch {
  id: string;
  createdAt: number;
  corePrompt: string;
  aspectRatios: string[];
  variantsPerRatio: number;
  batchCount?: number;
  generationMode?: 'detailPages' | 'legacyRatios';
  detailPageCount?: number;
  detailPages?: CommerceAdDetailPage[];
  images: CommerceAdGeneratedImageRecord[];
}

export interface CommerceAdResultGroupState {
  batches: CommerceAdGenerationBatch[];
  activeBatchId: string | null;
}

export type CommerceAdGuidanceStage =
  | 'upload'
  | 'infer'
  | 'brief'
  | 'direction'
  | 'generation';

export interface CommerceAdGuidanceOption {
  id: string;
  label: string;
  value: string;
}

export interface CommerceAdGuidanceQuestion {
  id: string;
  label: string;
  allowMultiple: boolean;
  options: CommerceAdGuidanceOption[];
}

export interface CommerceAdDesignDirection {
  id: string;
  title: string;
  description: string;
  tags: string[];
}

export interface CommerceAdAgentGuidance {
  stage: CommerceAdGuidanceStage;
  summary: string;
  confirmedFacts: string[];
  missingFields: string[];
  questions: CommerceAdGuidanceQuestion[];
  designDirections: CommerceAdDesignDirection[];
  quickReplies: string[];
  readinessHint: string;
}

export interface CommerceAdAgentMessage {
  id: string;
  role: CommerceAdAgentRole;
  content: string;
  createdAt: number;
  guidance?: CommerceAdAgentGuidance;
}

export type CommerceAdAgentAction =
  | {
      type: 'upsertProduct';
      data: Partial<CommerceAdProductState>;
    }
  | {
      type: 'upsertBrief';
      data: Partial<CommerceAdBriefState>;
    }
  | {
      type: 'upsertVisualPreference';
      data: Partial<CommerceAdVisualPreferenceState>;
    }
  | {
      type: 'upsertBatchGenerate';
      data: Partial<CommerceAdBatchGenerateState>;
    }
  | {
      type: 'upsertResultGroup';
      data: Partial<CommerceAdResultGroupState>;
    };

export interface CommerceAdProjectRootState {
  workflowStep: CommerceAdWorkflowStep;
  agentMessages: CommerceAdAgentMessage[];
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return Array.from(new Set(value.map((item) => normalizeString(item)).filter(Boolean)));
  }

  if (typeof value === 'string') {
    return Array.from(
      new Set(
        value
          .split(/[\n,，、;；]+/)
          .map((item) => item.trim())
          .filter(Boolean)
      )
    );
  }

  return [];
}

function normalizeHexColor(value: unknown): string {
  const normalized = normalizeString(value);
  return /^#[0-9a-f]{6}$/i.test(normalized) ? normalized.toUpperCase() : '';
}

const VISUAL_PREFERENCE_LEGACY_VALUE_MAP: Record<string, string> = {
  '智能匹配': '智能匹配（自动推荐/整体更稳）',
  '极简高级': '极简编辑感（大留白/克制简洁）',
  '生活方式': '温馨生活感（居家暖调/亲和场景）',
  '促销转化': '图形海报风（视觉冲击/大字标题）',
  '科技质感': '现代科技感（冷调精密/理性质感）',
  '国潮插画': '复古潮流风（怀旧纹理/个性氛围）',
  '商品主色延展': '商品主色延展（自动提取/整体统一）',
  '高对比促销': '高对比冲击（反差强烈/更吸睛）',
  '低饱和高级': '柔和低饱和（高级柔和/克制耐看）',
  '清新明亮': '浅色通透（明亮清爽/轻盈通透）',
  '深色质感': '深色高级（沉稳浓郁/层次更深）',
  '全平台通用': '全平台通用（风格平衡/适配面广/稳妥耐用）',
  '淘宝/天猫主图': '淘宝/天猫（视觉抢眼/氛围浓/转化导向）',
  '小红书种草': '小红书（生活方式/种草氛围/编辑感强）',
  '抖音信息流': '抖音/TikTok（开屏抓眼/节奏快/冲击感强）',
  '详情页首屏': '淘宝/天猫（视觉抢眼/氛围浓/转化导向）',
  '英文': '英文（美式）',
  '中文（简体）': '中文（简体）',
};

function normalizeVisualPreferenceText(value: unknown, fallback: string): string {
  const normalized = normalizeString(value);
  if (!normalized) {
    return fallback;
  }
  return VISUAL_PREFERENCE_LEGACY_VALUE_MAP[normalized] ?? normalized;
}

function normalizeTimestamp(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function normalizePositiveInteger(value: unknown, fallback: number): number {
  const normalized = Math.round(Number(value));
  return Number.isFinite(normalized) && normalized > 0 ? normalized : fallback;
}

function normalizeProductImage(value: unknown, index: number): CommerceAdProductImage | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const record = value as Partial<CommerceAdProductImage>;
  const imageUrl = normalizeString(record.imageUrl);
  const previewImageUrl = normalizeString(record.previewImageUrl) || imageUrl;
  if (!imageUrl) {
    return null;
  }

  const kind = ['main', 'reference', 'logo', 'packaging'].includes(record.kind ?? '')
    ? record.kind as CommerceAdProductImage['kind']
    : index === 0
      ? 'main'
      : 'reference';

  return {
    id: normalizeString(record.id) || `commerce-product-image-${index + 1}`,
    imageUrl,
    previewImageUrl,
    aspectRatio: normalizeString(record.aspectRatio) || '1:1',
    label: normalizeString(record.label) || `Image ${index + 1}`,
    description: normalizeString(record.description),
    kind,
  };
}

export function createDefaultCommerceAdProductState(): CommerceAdProductState {
  return {
    images: [],
    brand: '',
    productName: '',
    category: '',
    detailInputMode: 'auto',
    lockedDocumentInfo: '',
    userIdeaInfo: '',
    userInfo: '',
    inference: null,
    lastAnalyzedAt: null,
    lastError: null,
  };
}

export function normalizeCommerceAdProductState(value: unknown): CommerceAdProductState {
  const record =
    value && typeof value === 'object' && !Array.isArray(value)
      ? value as Partial<CommerceAdProductState>
      : {};
  const inferenceRecord =
    record.inference && typeof record.inference === 'object' && !Array.isArray(record.inference)
      ? record.inference as Partial<CommerceAdProductInference>
      : null;

  const detailInputMode = record.detailInputMode === 'manualPages' ? 'manualPages' : 'auto';

  return {
    images: Array.isArray(record.images)
      ? record.images
          .map((item, index) => normalizeProductImage(item, index))
          .filter((item): item is CommerceAdProductImage => Boolean(item))
      : [],
    brand: normalizeString(record.brand),
    productName: normalizeString(record.productName),
    category: normalizeString(record.category),
    detailInputMode,
    lockedDocumentInfo: normalizeString(record.lockedDocumentInfo),
    userIdeaInfo: normalizeString(record.userIdeaInfo) || normalizeString(record.userInfo),
    userInfo: normalizeString(record.userInfo),
    inference: inferenceRecord
      ? {
          summary: normalizeString(inferenceRecord.summary),
          productType: normalizeString(inferenceRecord.productType),
          visualDescription: normalizeString(inferenceRecord.visualDescription),
          visibleSellingPoints: normalizeStringArray(inferenceRecord.visibleSellingPoints),
          suggestedUseCases: normalizeStringArray(inferenceRecord.suggestedUseCases),
          uncertaintyNotes: normalizeStringArray(inferenceRecord.uncertaintyNotes),
          followUpQuestions: normalizeStringArray(inferenceRecord.followUpQuestions),
        }
      : null,
    lastAnalyzedAt: normalizeTimestamp(record.lastAnalyzedAt),
    lastError: normalizeString(record.lastError) || null,
  };
}

export function normalizeCommerceAdDetailPages(value: unknown): CommerceAdDetailPage[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item, index): CommerceAdDetailPage | null => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        return null;
      }
      const record = item as Partial<CommerceAdDetailPage>;
      const title = normalizeString(record.title);
      const lockedCopy = normalizeString(record.lockedCopy);
      const optimizedCopy = normalizeString(record.optimizedCopy);
      const layoutNotes = normalizeString(record.layoutNotes);
      const prompt = normalizeString(record.prompt);
      if (!title && !lockedCopy && !optimizedCopy && !layoutNotes && !prompt) {
        return null;
      }

      return {
        id: normalizeString(record.id) || `commerce-detail-page-${index + 1}`,
        pageNo: normalizePositiveInteger(record.pageNo, index + 1),
        title,
        lockedCopy,
        optimizedCopy,
        layoutNotes,
        prompt,
      };
    })
    .filter((item): item is CommerceAdDetailPage => Boolean(item))
    .sort((left, right) => left.pageNo - right.pageNo)
    .map((item, index) => ({
      ...item,
      pageNo: index + 1,
    }));
}

export function createDefaultCommerceAdBriefState(): CommerceAdBriefState {
  return {
    usage: '',
    platform: '',
    audience: '',
    style: '',
    headline: '',
    sellingPoints: [],
    cta: '',
    mustInclude: '',
    constraints: '',
    normalizedBrief: '',
    optimizedUserIdeaInfo: '',
    detailPages: [],
    updatedAt: null,
  };
}

export function normalizeCommerceAdBriefState(value: unknown): CommerceAdBriefState {
  const record =
    value && typeof value === 'object' && !Array.isArray(value)
      ? value as Partial<CommerceAdBriefState>
      : {};

  return {
    usage: normalizeString(record.usage),
    platform: normalizeString(record.platform),
    audience: normalizeString(record.audience),
    style: normalizeString(record.style),
    headline: normalizeString(record.headline),
    sellingPoints: normalizeStringArray(record.sellingPoints),
    cta: normalizeString(record.cta),
    mustInclude: normalizeString(record.mustInclude),
    constraints: normalizeString(record.constraints),
    normalizedBrief: normalizeString(record.normalizedBrief),
    optimizedUserIdeaInfo: normalizeString(record.optimizedUserIdeaInfo),
    detailPages: normalizeCommerceAdDetailPages(record.detailPages),
    updatedAt: normalizeTimestamp(record.updatedAt),
  };
}

export function createDefaultCommerceAdVisualPreferenceState(): CommerceAdVisualPreferenceState {
  return {
    designStyle: '智能匹配（自动推荐/整体更稳）',
    colorPalette: '商品主色延展（自动提取/整体统一）',
    platformVisual: '全平台通用（风格平衡/适配面广/稳妥耐用）',
    language: '中文（简体）',
    brandAccentColor: 'auto',
    summary: '自动匹配商品气质、平台视觉与品牌强调色。',
    promptFragment: '视觉与排版偏好：智能匹配（自动推荐/整体更稳）设计风格，整体配色基于商品主色延展（自动提取/整体统一），平台视觉全平台通用（风格平衡/适配面广/稳妥耐用），画面语言使用中文（简体），品牌强调色自动提取。',
    updatedAt: null,
  };
}

export function normalizeCommerceAdVisualPreferenceState(value: unknown): CommerceAdVisualPreferenceState {
  const record =
    value && typeof value === 'object' && !Array.isArray(value)
      ? value as Partial<CommerceAdVisualPreferenceState>
      : {};
  const defaults = createDefaultCommerceAdVisualPreferenceState();
  const rawAccentColor = normalizeString(record.brandAccentColor);
  const brandAccentColor = rawAccentColor.toLowerCase() === 'auto'
    ? 'auto'
    : normalizeHexColor(rawAccentColor) || defaults.brandAccentColor;

  return {
    designStyle: normalizeVisualPreferenceText(record.designStyle, defaults.designStyle),
    colorPalette: normalizeVisualPreferenceText(record.colorPalette, defaults.colorPalette),
    platformVisual: normalizeVisualPreferenceText(record.platformVisual, defaults.platformVisual),
    language: normalizeVisualPreferenceText(record.language, defaults.language),
    brandAccentColor,
    summary: normalizeString(record.summary) || defaults.summary,
    promptFragment: normalizeString(record.promptFragment) || defaults.promptFragment,
    updatedAt: normalizeTimestamp(record.updatedAt),
  };
}

export function createDefaultCommerceAdBatchGenerateState(): CommerceAdBatchGenerateState {
  return {
    generationMode: 'detailPages',
    aspectRatios: ['4:5'],
    variantsPerRatio: 1,
    batchCount: 1,
    modelId: '',
    size: '2K',
    corePrompt: '',
    ratioPrompts: {},
    detailPages: [],
    detailPageIds: [],
    detailPageCount: 0,
    stylePromptFragment: '',
    status: 'idle',
    lastGeneratedAt: null,
    lastError: null,
  };
}

export function normalizeCommerceAdBatchGenerateState(value: unknown): CommerceAdBatchGenerateState {
  const record =
    value && typeof value === 'object' && !Array.isArray(value)
      ? value as Partial<CommerceAdBatchGenerateState>
      : {};
  const status = ['idle', 'ready', 'generating', 'failed'].includes(record.status ?? '')
      ? record.status as CommerceAdBatchGenerateState['status']
      : 'idle';
  const generationMode = ['detailPages', 'legacyRatios'].includes(record.generationMode ?? '')
    ? record.generationMode as CommerceAdBatchGenerateState['generationMode']
    : 'detailPages';

  return {
    generationMode,
    aspectRatios: normalizeStringArray(record.aspectRatios).length > 0
      ? normalizeStringArray(record.aspectRatios)
      : ['4:5'],
    variantsPerRatio: Math.max(1, Math.min(8, Math.round(Number(record.variantsPerRatio) || 1))),
    batchCount: Math.max(1, Math.min(20, Math.round(Number(record.batchCount) || 1))),
    modelId: normalizeString(record.modelId),
    size: normalizeString(record.size) || '2K',
    corePrompt: normalizeString(record.corePrompt),
    ratioPrompts:
      record.ratioPrompts && typeof record.ratioPrompts === 'object' && !Array.isArray(record.ratioPrompts)
        ? Object.fromEntries(
            Object.entries(record.ratioPrompts as Record<string, unknown>)
              .map(([key, item]) => [key, normalizeString(item)])
              .filter(([, item]) => item.length > 0)
          )
        : {},
    detailPages: normalizeCommerceAdDetailPages(record.detailPages),
    detailPageIds: normalizeStringArray(record.detailPageIds),
    detailPageCount: Math.max(
      normalizeCommerceAdDetailPages(record.detailPages).length,
      Math.round(Number(record.detailPageCount) || 0)
    ),
    stylePromptFragment: normalizeString(record.stylePromptFragment),
    status,
    lastGeneratedAt: normalizeTimestamp(record.lastGeneratedAt),
    lastError: normalizeString(record.lastError) || null,
  };
}

export function createDefaultCommerceAdResultGroupState(): CommerceAdResultGroupState {
  return {
    batches: [],
    activeBatchId: null,
  };
}

export function normalizeCommerceAdResultGroupState(value: unknown): CommerceAdResultGroupState {
  const record =
    value && typeof value === 'object' && !Array.isArray(value)
      ? value as Partial<CommerceAdResultGroupState>
      : {};
  const batches = Array.isArray(record.batches)
    ? record.batches
        .map((batch, batchIndex): CommerceAdGenerationBatch | null => {
          if (!batch || typeof batch !== 'object' || Array.isArray(batch)) {
            return null;
          }
          const item = batch as Partial<CommerceAdGenerationBatch>;
          return {
            id: normalizeString(item.id) || `commerce-batch-${batchIndex + 1}`,
            createdAt: normalizeTimestamp(item.createdAt) ?? Date.now(),
            corePrompt: normalizeString(item.corePrompt),
            aspectRatios: normalizeStringArray(item.aspectRatios),
            variantsPerRatio: Math.max(1, Math.min(8, Math.round(Number(item.variantsPerRatio) || 1))),
            batchCount: Math.max(1, Math.min(20, Math.round(Number(item.batchCount) || 1))),
            generationMode: ['detailPages', 'legacyRatios'].includes(item.generationMode ?? '')
              ? item.generationMode as CommerceAdGenerationBatch['generationMode']
              : undefined,
            detailPageCount: Math.max(0, Math.round(Number(item.detailPageCount) || 0)) || undefined,
            detailPages: normalizeCommerceAdDetailPages(item.detailPages),
            images: Array.isArray(item.images)
              ? item.images
                  .map((image, imageIndex): CommerceAdGeneratedImageRecord | null => {
                    if (!image || typeof image !== 'object' || Array.isArray(image)) {
                      return null;
                    }
                    const imageRecord = image as Partial<CommerceAdGeneratedImageRecord>;
                    const status = ['queued', 'running', 'succeeded', 'failed'].includes(imageRecord.status ?? '')
                      ? imageRecord.status as CommerceAdGeneratedImageRecord['status']
                      : 'queued';
                    return {
                      id: normalizeString(imageRecord.id) || `commerce-image-${imageIndex + 1}`,
                      aspectRatio: normalizeString(imageRecord.aspectRatio) || '1:1',
                      detailPageId: normalizeString(imageRecord.detailPageId) || undefined,
                      detailPageNo: imageRecord.detailPageNo
                        ? Math.max(1, Math.round(Number(imageRecord.detailPageNo) || 1))
                        : undefined,
                      detailPageTitle: normalizeString(imageRecord.detailPageTitle) || undefined,
                      nodeId: normalizeString(imageRecord.nodeId) || null,
                      prompt: normalizeString(imageRecord.prompt),
                      status,
                      imageUrl: normalizeString(imageRecord.imageUrl) || null,
                      previewImageUrl: normalizeString(imageRecord.previewImageUrl) || null,
                      error: normalizeString(imageRecord.error) || null,
                    };
                  })
                  .filter((image): image is CommerceAdGeneratedImageRecord => Boolean(image))
              : [],
          };
        })
        .filter((batch): batch is CommerceAdGenerationBatch => Boolean(batch))
    : [];

  return {
    batches,
    activeBatchId: normalizeString(record.activeBatchId) || batches[0]?.id || null,
  };
}

export function createDefaultCommerceAdProjectRootState(): CommerceAdProjectRootState {
  return {
    workflowStep: 'product',
    agentMessages: [],
  };
}
