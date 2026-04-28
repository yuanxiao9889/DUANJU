import type { ImageModelDefinition, ResolutionOption } from './types';
import {
  createStoryboardNewApiImageModel,
  normalizeStoryboardNewApiApiFormat,
  normalizeStoryboardNewApiModelConfig,
  resolveStoryboardNewApiModeLabel,
  toStoryboardNewApiExtraParamsPayload,
  type StoryboardNewApiApiFormat,
  type StoryboardNewApiExtraParamsPayload,
  type StoryboardNewApiModelConfig,
} from './storyboardNewApi';
import type { CustomStoryboardModelEntry } from './storyboardProviders';

export const STORYBOARD_OOPII_PROVIDER_ID = 'oopii';
export const STORYBOARD_OOPII_BASE_URL = 'https://www.oopii.cn/';
export const STORYBOARD_OOPII_GPT_IMAGE_2_REQUEST_MODEL = 'gpt-image-2';

const OOPII_GPT_IMAGE_2_ASPECT_RATIOS = [
  '1:1',
  '2:3',
  '3:2',
  '3:4',
  '4:3',
  '4:5',
  '5:4',
  '9:16',
  '16:9',
  '21:9',
] as const;

const OOPII_GPT_IMAGE_2_RESOLUTIONS: ResolutionOption[] = [
  { value: '1K', label: '1K' },
  { value: '2K', label: '2K' },
  { value: '4K', label: '4K' },
];

const OOPII_GPT_IMAGE_2_QUALITY_OPTIONS = ['low', 'medium', 'high'] as const;

interface StoryboardOopiiRequestContext {
  resolution?: string | null;
  extraParams?: Record<string, unknown> | null;
}

export interface StoryboardOopiiBuiltinModel {
  id: string;
  apiFormat: StoryboardNewApiApiFormat;
  requestModel: string;
  displayName: string;
}

export const STORYBOARD_OOPII_BUILTIN_MODELS = [
  {
    id: `${STORYBOARD_OOPII_PROVIDER_ID}/gpt-image-2`,
    apiFormat: 'openai',
    requestModel: STORYBOARD_OOPII_GPT_IMAGE_2_REQUEST_MODEL,
    displayName: STORYBOARD_OOPII_GPT_IMAGE_2_REQUEST_MODEL,
  },
  {
    id: `${STORYBOARD_OOPII_PROVIDER_ID}/gemini-3-pro-image-preview`,
    apiFormat: 'gemini',
    requestModel: 'gemini-3-pro-image-preview',
    displayName: '香蕉Pro',
  },
  {
    id: `${STORYBOARD_OOPII_PROVIDER_ID}/gemini-3.1-flash-image-preview`,
    apiFormat: 'gemini',
    requestModel: 'gemini-3.1-flash-image-preview',
    displayName: '香蕉2',
  },
] as const satisfies readonly StoryboardOopiiBuiltinModel[];

export const STORYBOARD_OOPII_MODEL_ID = STORYBOARD_OOPII_BUILTIN_MODELS[0].id;
const DEFAULT_STORYBOARD_OOPII_MODEL = STORYBOARD_OOPII_BUILTIN_MODELS[0];

function normalizeTrimmedString(input: unknown): string {
  return typeof input === 'string' ? input.trim() : '';
}

function normalizeStoryboardOopiiRequestModel(
  input: string | null | undefined
): string {
  const trimmed = (input ?? '').trim();
  if (!trimmed) {
    return '';
  }

  const prefix = `${STORYBOARD_OOPII_PROVIDER_ID}/`;
  if (trimmed.toLowerCase().startsWith(prefix.toLowerCase())) {
    return trimmed.slice(prefix.length).trim();
  }

  return trimmed;
}

function inferStoryboardOopiiApiFormat(
  requestModel: string | null | undefined
): StoryboardNewApiApiFormat {
  const normalizedRequestModel = normalizeStoryboardOopiiRequestModel(requestModel).toLowerCase();
  if (!normalizedRequestModel) {
    return DEFAULT_STORYBOARD_OOPII_MODEL.apiFormat;
  }

  if (
    normalizedRequestModel.startsWith(`${STORYBOARD_OOPII_GPT_IMAGE_2_REQUEST_MODEL}-2k-`)
    || normalizedRequestModel.startsWith(`${STORYBOARD_OOPII_GPT_IMAGE_2_REQUEST_MODEL}-4k-`)
  ) {
    return 'openai-images';
  }

  if (
    normalizedRequestModel.includes('gemini')
    || normalizedRequestModel.includes('imagen')
  ) {
    return 'gemini';
  }

  return 'openai';
}

function normalizeStoryboardOopiiResolution(
  resolution: string | null | undefined
): '1K' | '2K' | '4K' | null {
  const normalizedResolution = normalizeTrimmedString(resolution).toUpperCase();
  if (
    normalizedResolution === '1K'
    || normalizedResolution === '2K'
    || normalizedResolution === '4K'
  ) {
    return normalizedResolution;
  }

  return null;
}

function isStoryboardOopiiGptImage2RequestModel(
  requestModel: string | null | undefined
): boolean {
  return normalizeStoryboardOopiiRequestModel(requestModel)
    .toLowerCase()
    .startsWith(STORYBOARD_OOPII_GPT_IMAGE_2_REQUEST_MODEL);
}

function normalizeStoryboardOopiiGptImage2Quality(
  extraParams: Record<string, unknown> | null | undefined
): 'low' | 'medium' | 'high' {
  const quality = normalizeTrimmedString(extraParams?.['quality']).toLowerCase();
  return OOPII_GPT_IMAGE_2_QUALITY_OPTIONS.includes(
    quality as (typeof OOPII_GPT_IMAGE_2_QUALITY_OPTIONS)[number]
  )
    ? quality as 'low' | 'medium' | 'high'
    : 'medium';
}

function resolveStoryboardOopiiRequestModelVariant(
  requestModel: string | null | undefined,
  requestContext?: StoryboardOopiiRequestContext | null
): string {
  const normalizedRequestModel = normalizeStoryboardOopiiRequestModel(requestModel);
  if (!isStoryboardOopiiGptImage2RequestModel(normalizedRequestModel)) {
    return normalizedRequestModel;
  }

  const normalizedResolution = normalizeStoryboardOopiiResolution(requestContext?.resolution);
  if (normalizedResolution !== '2K' && normalizedResolution !== '4K') {
    return STORYBOARD_OOPII_GPT_IMAGE_2_REQUEST_MODEL;
  }

  const quality = normalizeStoryboardOopiiGptImage2Quality(requestContext?.extraParams);
  return `${STORYBOARD_OOPII_GPT_IMAGE_2_REQUEST_MODEL}-${normalizedResolution.toLowerCase()}-${quality}`;
}

function resolveStoryboardOopiiApiFormatVariant(
  baseApiFormat: StoryboardNewApiApiFormat,
  requestModel: string
): StoryboardNewApiApiFormat {
  const normalizedRequestModel = normalizeStoryboardOopiiRequestModel(requestModel).toLowerCase();
  if (
    normalizedRequestModel.startsWith(`${STORYBOARD_OOPII_GPT_IMAGE_2_REQUEST_MODEL}-2k-`)
    || normalizedRequestModel.startsWith(`${STORYBOARD_OOPII_GPT_IMAGE_2_REQUEST_MODEL}-4k-`)
  ) {
    return 'openai-images';
  }

  if (normalizedRequestModel === STORYBOARD_OOPII_GPT_IMAGE_2_REQUEST_MODEL) {
    return 'openai';
  }

  return baseApiFormat;
}

function finalizeStoryboardOopiiModelConfig(
  baseConfig: StoryboardNewApiModelConfig,
  requestContext?: StoryboardOopiiRequestContext | null
): StoryboardNewApiModelConfig {
  const requestModelVariant = resolveStoryboardOopiiRequestModelVariant(
    baseConfig.requestModel,
    requestContext
  );

  return normalizeStoryboardOopiiModelConfig({
    ...baseConfig,
    apiFormat: resolveStoryboardOopiiApiFormatVariant(
      baseConfig.apiFormat,
      requestModelVariant
    ),
    requestModel: requestModelVariant,
  });
}

export function findStoryboardOopiiBuiltinModel(
  value: string | null | undefined
): StoryboardOopiiBuiltinModel | undefined {
  const normalizedValue = normalizeTrimmedString(value).toLowerCase();
  const normalizedRequestModel = normalizeStoryboardOopiiRequestModel(value).toLowerCase();

  if (!normalizedValue && !normalizedRequestModel) {
    return undefined;
  }

  return STORYBOARD_OOPII_BUILTIN_MODELS.find(
    (model) =>
      model.id.toLowerCase() === normalizedValue
      || model.requestModel.toLowerCase() === normalizedRequestModel
  );
}

export function normalizeStoryboardOopiiModelConfig(
  input: Partial<StoryboardNewApiModelConfig> | null | undefined
): StoryboardNewApiModelConfig {
  const matchedBuiltinModel = findStoryboardOopiiBuiltinModel(input?.requestModel);
  const normalizedRequestModel = normalizeStoryboardOopiiRequestModel(input?.requestModel);
  const trimmedApiFormat = normalizeTrimmedString(input?.apiFormat);
  const trimmedDisplayName = normalizeTrimmedString(input?.displayName);

  return normalizeStoryboardNewApiModelConfig({
    apiFormat:
      matchedBuiltinModel?.apiFormat
      || (trimmedApiFormat
        ? normalizeStoryboardNewApiApiFormat(trimmedApiFormat)
        : inferStoryboardOopiiApiFormat(normalizedRequestModel)),
    endpointUrl: STORYBOARD_OOPII_BASE_URL,
    requestModel:
      matchedBuiltinModel?.requestModel
      || normalizedRequestModel
      || DEFAULT_STORYBOARD_OOPII_MODEL.requestModel,
    displayName:
      matchedBuiltinModel?.displayName
      || trimmedDisplayName
      || normalizedRequestModel
      || DEFAULT_STORYBOARD_OOPII_MODEL.displayName,
  });
}

export function isStoryboardOopiiModelId(value: string | null | undefined): boolean {
  const normalizedValue = normalizeTrimmedString(value);
  return (
    Boolean(findStoryboardOopiiBuiltinModel(normalizedValue))
    || normalizedValue.startsWith(`${STORYBOARD_OOPII_PROVIDER_ID}/`)
  );
}

export function resolveStoryboardOopiiModelConfigForModel(
  modelId: string | null | undefined,
  customModels: Record<string, CustomStoryboardModelEntry[]> | null | undefined,
  requestContext?: StoryboardOopiiRequestContext | null
): StoryboardNewApiModelConfig {
  const normalizedModelId = normalizeTrimmedString(modelId);
  const matchedBuiltinModel = findStoryboardOopiiBuiltinModel(normalizedModelId);
  if (matchedBuiltinModel) {
    return finalizeStoryboardOopiiModelConfig(
      normalizeStoryboardOopiiModelConfig({
        requestModel: matchedBuiltinModel.requestModel,
        displayName: matchedBuiltinModel.displayName,
      }),
      requestContext
    );
  }

  const matchedCustomModel =
    normalizeTrimmedString(modelId).length > 0
      ? (customModels?.[STORYBOARD_OOPII_PROVIDER_ID] ?? []).find(
        (entry) =>
          `${STORYBOARD_OOPII_PROVIDER_ID}/${entry.modelId}`.toLowerCase()
          === normalizedModelId.toLowerCase()
      )
      : undefined;
  if (matchedCustomModel) {
    return finalizeStoryboardOopiiModelConfig(
      normalizeStoryboardOopiiModelConfig({
        requestModel: matchedCustomModel.modelId,
        displayName: matchedCustomModel.displayName,
      }),
      requestContext
    );
  }

  const normalizedRequestModel = normalizeStoryboardOopiiRequestModel(normalizedModelId);
  if (normalizedRequestModel) {
    return finalizeStoryboardOopiiModelConfig(
      normalizeStoryboardOopiiModelConfig({
        requestModel: normalizedRequestModel,
        displayName: normalizedRequestModel,
      }),
      requestContext
    );
  }

  return finalizeStoryboardOopiiModelConfig(
    normalizeStoryboardOopiiModelConfig(undefined),
    requestContext
  );
}

export function toStoryboardOopiiNewApiPayload(
  modelId: string | null | undefined,
  customModels: Record<string, CustomStoryboardModelEntry[]> | null | undefined
): StoryboardNewApiExtraParamsPayload {
  return toStoryboardNewApiExtraParamsPayload(
    resolveStoryboardOopiiModelConfigForModel(modelId, customModels)
  );
}

export function createStoryboardOopiiImageModel(
  config: StoryboardNewApiModelConfig | null | undefined
): ImageModelDefinition | null {
  const normalizedConfig = normalizeStoryboardOopiiModelConfig(config);
  const legacyModel = createStoryboardNewApiImageModel(normalizedConfig);
  if (!legacyModel) {
    return null;
  }

  const isGptImage2Model = isStoryboardOopiiGptImage2RequestModel(normalizedConfig.requestModel);
  const providerModelId = isGptImage2Model
    ? `${STORYBOARD_OOPII_PROVIDER_ID}/${STORYBOARD_OOPII_GPT_IMAGE_2_REQUEST_MODEL}`
    : `${STORYBOARD_OOPII_PROVIDER_ID}/${normalizedConfig.requestModel}`;

  return {
    ...legacyModel,
    id: providerModelId,
    displayName: isGptImage2Model
      ? STORYBOARD_OOPII_GPT_IMAGE_2_REQUEST_MODEL
      : normalizedConfig.displayName,
    providerId: STORYBOARD_OOPII_PROVIDER_ID,
    description: isGptImage2Model
      ? 'OOpii gpt-image-2 with 1K base output and 2K/4K quality tiers.'
      : 'Fixed OOpii storyboard image endpoint',
    defaultAspectRatio: isGptImage2Model ? '1:1' : legacyModel.defaultAspectRatio,
    defaultResolution: isGptImage2Model ? '1K' : legacyModel.defaultResolution,
    aspectRatios: isGptImage2Model
      ? OOPII_GPT_IMAGE_2_ASPECT_RATIOS.map((value) => ({ value, label: value }))
      : legacyModel.aspectRatios,
    resolutions: isGptImage2Model ? OOPII_GPT_IMAGE_2_RESOLUTIONS : legacyModel.resolutions,
    extraParamsSchema: isGptImage2Model
      ? [
        {
          key: 'quality',
          label: 'Generation quality',
          labelKey: 'modelParams.generationQuality',
          description:
            'Controls image fidelity, latency, and cost for gpt-image-2 output.',
          descriptionKey: 'modelParams.generationQualityDesc',
          type: 'enum',
          defaultValue: 'medium',
          visibleResolutions: ['2K', '4K'],
          options: [
            { value: 'low', label: 'Low', labelKey: 'modelParams.generationQualityLow' },
            { value: 'medium', label: 'Medium', labelKey: 'modelParams.generationQualityMedium' },
            { value: 'high', label: 'High', labelKey: 'modelParams.generationQualityHigh' },
          ],
        },
      ]
      : legacyModel.extraParamsSchema,
    defaultExtraParams: isGptImage2Model
      ? {
        ...legacyModel.defaultExtraParams,
        quality: 'medium',
      }
      : legacyModel.defaultExtraParams,
    resolveRequest: ({ referenceImageCount }) => ({
      requestModel: providerModelId,
      modeLabel: resolveStoryboardNewApiModeLabel(
        normalizedConfig.apiFormat,
        referenceImageCount
      ),
    }),
  };
}

export function createStoryboardOopiiImageModels(): ImageModelDefinition[] {
  return STORYBOARD_OOPII_BUILTIN_MODELS.map((model) =>
    createStoryboardOopiiImageModel({
      apiFormat: model.apiFormat,
      endpointUrl: STORYBOARD_OOPII_BASE_URL,
      requestModel: model.requestModel,
      displayName: model.displayName,
    })
  ).filter((model): model is ImageModelDefinition => Boolean(model));
}
