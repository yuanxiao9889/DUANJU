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
export const STORYBOARD_OOPII_BASE_URL = 'https://www.oopii.cc/';
export const STORYBOARD_OOPII_GPT_IMAGE_2_REQUEST_MODEL = 'all-image-2';
export const STORYBOARD_OOPII_MONKEY_PRO_REQUEST_MODEL = 'monkey-image-pro';
export const STORYBOARD_OOPII_MONKEY_FLASH_2_REQUEST_MODEL = 'monkey-image-flash 2';

const STORYBOARD_OOPII_LEGACY_MODEL_ALIASES: Record<string, string> = {
  'gpt-image-2': STORYBOARD_OOPII_GPT_IMAGE_2_REQUEST_MODEL,
  'gemini-3-pro-image-preview': STORYBOARD_OOPII_MONKEY_PRO_REQUEST_MODEL,
  'gemini-3.1-flash-image-preview': STORYBOARD_OOPII_MONKEY_FLASH_2_REQUEST_MODEL,
};

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
  '9:21',
] as const;

const OOPII_GPT_IMAGE_2_RESOLUTIONS: ResolutionOption[] = [
  { value: '1K', label: '1K' },
  { value: '2K', label: '2K' },
  { value: '4K', label: '4K' },
];

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
    id: `${STORYBOARD_OOPII_PROVIDER_ID}/${STORYBOARD_OOPII_GPT_IMAGE_2_REQUEST_MODEL}`,
    apiFormat: 'openai-images',
    requestModel: STORYBOARD_OOPII_GPT_IMAGE_2_REQUEST_MODEL,
    displayName: STORYBOARD_OOPII_GPT_IMAGE_2_REQUEST_MODEL,
  },
  {
    id: `${STORYBOARD_OOPII_PROVIDER_ID}/grok-imagine-image-lite`,
    apiFormat: 'openai-images',
    requestModel: 'grok-imagine-image-lite',
    displayName: 'grok-image',
  },
  {
    id: `${STORYBOARD_OOPII_PROVIDER_ID}/${STORYBOARD_OOPII_MONKEY_PRO_REQUEST_MODEL}`,
    apiFormat: 'gemini',
    requestModel: STORYBOARD_OOPII_MONKEY_PRO_REQUEST_MODEL,
    displayName: 'monkey-pro',
  },
  {
    id: `${STORYBOARD_OOPII_PROVIDER_ID}/${STORYBOARD_OOPII_MONKEY_FLASH_2_REQUEST_MODEL}`,
    apiFormat: 'gemini',
    requestModel: STORYBOARD_OOPII_MONKEY_FLASH_2_REQUEST_MODEL,
    displayName: 'monkey-2',
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
    return normalizeStoryboardOopiiRequestModel(trimmed.slice(prefix.length));
  }

  return STORYBOARD_OOPII_LEGACY_MODEL_ALIASES[trimmed.toLowerCase()] ?? trimmed;
}

function inferStoryboardOopiiApiFormat(
  requestModel: string | null | undefined
): StoryboardNewApiApiFormat {
  const normalizedRequestModel = normalizeStoryboardOopiiRequestModel(requestModel).toLowerCase();
  if (!normalizedRequestModel) {
    return DEFAULT_STORYBOARD_OOPII_MODEL.apiFormat;
  }

  if (normalizedRequestModel.startsWith(STORYBOARD_OOPII_GPT_IMAGE_2_REQUEST_MODEL)) {
    return 'openai-images';
  }

  if (
    normalizedRequestModel.includes('gemini')
    || normalizedRequestModel.includes('imagen')
    || normalizedRequestModel.includes('monkey-image')
    || normalizedRequestModel === 'monkey-pro'
    || normalizedRequestModel === 'monkey-2'
  ) {
    return 'gemini';
  }

  return 'openai';
}

function isStoryboardOopiiGptImage2RequestModel(
  requestModel: string | null | undefined
): boolean {
  return normalizeStoryboardOopiiRequestModel(requestModel)
    .toLowerCase()
    .startsWith(STORYBOARD_OOPII_GPT_IMAGE_2_REQUEST_MODEL);
}

function resolveStoryboardOopiiRequestModelVariant(
  requestModel: string | null | undefined,
  _requestContext?: StoryboardOopiiRequestContext | null
): string {
  const normalizedRequestModel = normalizeStoryboardOopiiRequestModel(requestModel);
  return isStoryboardOopiiGptImage2RequestModel(normalizedRequestModel)
    ? STORYBOARD_OOPII_GPT_IMAGE_2_REQUEST_MODEL
    : normalizedRequestModel;
}

function resolveStoryboardOopiiApiFormatVariant(
  baseApiFormat: StoryboardNewApiApiFormat,
  requestModel: string
): StoryboardNewApiApiFormat {
  const normalizedRequestModel = normalizeStoryboardOopiiRequestModel(requestModel).toLowerCase();
  if (normalizedRequestModel.startsWith(STORYBOARD_OOPII_GPT_IMAGE_2_REQUEST_MODEL)) {
    return 'openai-images';
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
      ? 'OOpii all-image-2 via OpenAI Images with size/quality parameters.'
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
            'Controls image fidelity and latency for all-image-2 output.',
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
