export type CommerceAdWorkflowStep =
  | 'product'
  | 'brief'
  | 'batch'
  | 'results';

export type CommerceAdAgentRole = 'assistant' | 'user' | 'system';

export interface CommerceAdProductImage {
  id: string;
  imageUrl: string;
  previewImageUrl: string;
  aspectRatio: string;
  label: string;
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
  userInfo: string;
  inference: CommerceAdProductInference | null;
  lastAnalyzedAt: number | null;
  lastError: string | null;
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
  updatedAt: number | null;
}

export interface CommerceAdBatchGenerateState {
  aspectRatios: string[];
  variantsPerRatio: number;
  modelId: string;
  size: string;
  corePrompt: string;
  ratioPrompts: Record<string, string>;
  status: 'idle' | 'ready' | 'generating' | 'failed';
  lastGeneratedAt: number | null;
  lastError: string | null;
}

export interface CommerceAdGeneratedImageRecord {
  id: string;
  aspectRatio: string;
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

function normalizeTimestamp(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
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
    kind,
  };
}

export function createDefaultCommerceAdProductState(): CommerceAdProductState {
  return {
    images: [],
    brand: '',
    productName: '',
    category: '',
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

  return {
    images: Array.isArray(record.images)
      ? record.images
          .map((item, index) => normalizeProductImage(item, index))
          .filter((item): item is CommerceAdProductImage => Boolean(item))
      : [],
    brand: normalizeString(record.brand),
    productName: normalizeString(record.productName),
    category: normalizeString(record.category),
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
    updatedAt: normalizeTimestamp(record.updatedAt),
  };
}

export function createDefaultCommerceAdBatchGenerateState(): CommerceAdBatchGenerateState {
  return {
    aspectRatios: ['1:1', '4:5', '9:16'],
    variantsPerRatio: 4,
    modelId: '',
    size: '2K',
    corePrompt: '',
    ratioPrompts: {},
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

  return {
    aspectRatios: normalizeStringArray(record.aspectRatios).length > 0
      ? normalizeStringArray(record.aspectRatios)
      : ['1:1', '4:5', '9:16'],
    variantsPerRatio: Math.max(1, Math.min(8, Math.round(Number(record.variantsPerRatio) || 4))),
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
