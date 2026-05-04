import type { ImageModelDefinition, ResolutionOption } from './types';

export const STORYBOARD_NEWAPI_PROVIDER_ID = 'newapi';
export const STORYBOARD_NEWAPI_MODEL_ID =
  `${STORYBOARD_NEWAPI_PROVIDER_ID}/storyboard-experimental`;

export const STORYBOARD_NEWAPI_API_FORMATS = [
  'openai',
  'openai-images',
  'gemini',
] as const;

export type StoryboardNewApiApiFormat =
  typeof STORYBOARD_NEWAPI_API_FORMATS[number];

export interface StoryboardNewApiModelConfig {
  apiFormat: StoryboardNewApiApiFormat;
  endpointUrl: string;
  requestModel: string;
  displayName: string;
}

export interface StoryboardNewApiExtraParamsPayload {
  api_format: StoryboardNewApiApiFormat;
  endpoint_url: string;
  request_model: string;
  display_name: string;
}

interface StoryboardNewApiRequestContext {
  resolution?: string | null;
  extraParams?: Record<string, unknown> | null;
}

const STORYBOARD_NEWAPI_GPT_IMAGE_2_REQUEST_MODEL = 'gpt-image-2';

const STORYBOARD_NEWAPI_GPT_IMAGE_2_ASPECT_RATIOS = [
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

const STORYBOARD_NEWAPI_GPT_IMAGE_2_RESOLUTIONS: ResolutionOption[] = [
  { value: '1K', label: '1K' },
  { value: '2K', label: '2K' },
  { value: '4K', label: '4K' },
];

export const DEFAULT_STORYBOARD_NEWAPI_API_FORMAT: StoryboardNewApiApiFormat =
  'openai';

function normalizeTrimmedString(input: unknown): string {
  return typeof input === 'string' ? input.trim() : '';
}

export function normalizeStoryboardNewApiApiFormat(
  input: string | null | undefined
): StoryboardNewApiApiFormat {
  const normalizedInput = (input ?? '').trim();
  if (
    normalizedInput === 'openai'
    || normalizedInput === 'openai-chat'
    || normalizedInput === 'openai-edits'
  ) {
    return 'openai';
  }

  if (
    normalizedInput === 'openai-images'
    || normalizedInput === 'openai-image'
  ) {
    return 'openai-images';
  }

  if (
    normalizedInput === 'gemini'
    || normalizedInput === 'gemini-generate-content'
  ) {
    return 'gemini';
  }

  return DEFAULT_STORYBOARD_NEWAPI_API_FORMAT;
}

export function normalizeStoryboardNewApiModelConfig(
  input: Partial<StoryboardNewApiModelConfig> | null | undefined
): StoryboardNewApiModelConfig {
  return {
    apiFormat: normalizeStoryboardNewApiApiFormat(input?.apiFormat),
    endpointUrl: (input?.endpointUrl ?? '').trim(),
    requestModel: (input?.requestModel ?? '').trim(),
    displayName: (input?.displayName ?? '').trim(),
  };
}

function stripNewApiProviderPrefix(model: string | null | undefined): string {
  const trimmed = normalizeTrimmedString(model);
  if (!trimmed) {
    return '';
  }

  const prefix = `${STORYBOARD_NEWAPI_PROVIDER_ID}/`;
  if (trimmed.toLowerCase().startsWith(prefix.toLowerCase())) {
    return trimmed.slice(prefix.length).trim();
  }

  return trimmed;
}

function isStoryboardNewApiGptImage2RequestModel(
  requestModel: string | null | undefined
): boolean {
  return stripNewApiProviderPrefix(requestModel)
    .toLowerCase()
    .startsWith(STORYBOARD_NEWAPI_GPT_IMAGE_2_REQUEST_MODEL);
}

function resolveStoryboardNewApiRequestModelVariant(
  requestModel: string | null | undefined,
  _requestContext?: StoryboardNewApiRequestContext | null
): string {
  const normalizedRequestModel = stripNewApiProviderPrefix(requestModel);
  if (!isStoryboardNewApiGptImage2RequestModel(normalizedRequestModel)) {
    return normalizedRequestModel;
  }

  return STORYBOARD_NEWAPI_GPT_IMAGE_2_REQUEST_MODEL;
}

function resolveStoryboardNewApiApiFormatVariant(
  baseApiFormat: StoryboardNewApiApiFormat,
  requestModel: string
): StoryboardNewApiApiFormat {
  return isStoryboardNewApiGptImage2RequestModel(requestModel)
    ? 'openai-images'
    : baseApiFormat;
}

function finalizeStoryboardNewApiModelConfig(
  baseConfig: StoryboardNewApiModelConfig,
  requestContext?: StoryboardNewApiRequestContext | null
): StoryboardNewApiModelConfig {
  const requestModelVariant = resolveStoryboardNewApiRequestModelVariant(
    baseConfig.requestModel,
    requestContext
  );

  return normalizeStoryboardNewApiModelConfig({
    ...baseConfig,
    apiFormat: resolveStoryboardNewApiApiFormatVariant(
      baseConfig.apiFormat,
      requestModelVariant
    ),
    requestModel: requestModelVariant,
  });
}

export function isStoryboardNewApiModelConfigured(
  config: StoryboardNewApiModelConfig | null | undefined
): boolean {
  return Boolean(
    config
    && config.endpointUrl.trim()
    && config.requestModel.trim()
    && config.displayName.trim()
  );
}

export function isStoryboardNewApiModelId(value: string | null | undefined): boolean {
  const normalizedValue = (value ?? '').trim();
  return (
    normalizedValue === STORYBOARD_NEWAPI_MODEL_ID
    || normalizedValue.startsWith(`${STORYBOARD_NEWAPI_PROVIDER_ID}/`)
  );
}

export function toStoryboardNewApiExtraParamsPayload(
  config: StoryboardNewApiModelConfig
): StoryboardNewApiExtraParamsPayload {
  const normalizedConfig = normalizeStoryboardNewApiModelConfig(config);
  return {
    api_format: normalizedConfig.apiFormat,
    endpoint_url: normalizedConfig.endpointUrl,
    request_model: normalizedConfig.requestModel,
    display_name: normalizedConfig.displayName,
  };
}

export function resolveStoryboardNewApiModeLabel(
  apiFormat: StoryboardNewApiApiFormat,
  referenceImageCount: number
): string {
  const suffix = referenceImageCount > 0 ? '锛堝浘鐢熷浘锛?' : '';
  if (apiFormat === 'openai') {
    return `OpenAI 鍏煎鏍煎紡${suffix}`;
  }
  if (apiFormat === 'openai-images') {
    return `OpenAI 鍥剧墖鎺ュ彛${suffix}`;
  }
  return `Gemini 鍘熺敓鏍煎紡${suffix}`;
}

export function createStoryboardNewApiImageModel(
  config: StoryboardNewApiModelConfig | null | undefined
): ImageModelDefinition | null {
  const normalizedConfig = normalizeStoryboardNewApiModelConfig(config);
  if (!isStoryboardNewApiModelConfigured(normalizedConfig)) {
    return null;
  }

  const isGptImage2Model = isStoryboardNewApiGptImage2RequestModel(
    normalizedConfig.requestModel
  );

  return {
    id: STORYBOARD_NEWAPI_MODEL_ID,
    mediaType: 'image',
    displayName: isGptImage2Model
      ? STORYBOARD_NEWAPI_GPT_IMAGE_2_REQUEST_MODEL
      : normalizedConfig.displayName,
    providerId: STORYBOARD_NEWAPI_PROVIDER_ID,
    description: isGptImage2Model
      ? 'NewAPI gpt-image-2 endpoint with OpenAI Images routing and size/quality parameters.'
      : 'NewAPI-backed storyboard image endpoint.',
    eta: 'Experimental',
    expectedDurationMs: 60000,
    defaultAspectRatio: '1:1',
    defaultResolution: isGptImage2Model ? '1K' : '2K',
    aspectRatios: isGptImage2Model
      ? STORYBOARD_NEWAPI_GPT_IMAGE_2_ASPECT_RATIOS.map((value) => ({ value, label: value }))
      : [
      { value: '1:1', label: '1:1' },
      { value: '1:4', label: '1:4' },
      { value: '1:8', label: '1:8' },
      { value: '2:3', label: '2:3' },
      { value: '3:2', label: '3:2' },
      { value: '3:4', label: '3:4' },
      { value: '4:1', label: '4:1' },
      { value: '4:3', label: '4:3' },
      { value: '4:5', label: '4:5' },
      { value: '5:4', label: '5:4' },
      { value: '8:1', label: '8:1' },
      { value: '9:16', label: '9:16' },
      { value: '16:9', label: '16:9' },
      { value: '21:9', label: '21:9' },
    ],
    resolutions: isGptImage2Model ? STORYBOARD_NEWAPI_GPT_IMAGE_2_RESOLUTIONS : [
      { value: '1K', label: '1K' },
      { value: '2K', label: '2K' },
      { value: '4K', label: '4K' },
    ],
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
      : undefined,
    defaultExtraParams: isGptImage2Model
      ? {
        quality: 'medium',
      }
      : undefined,
    resolveRequest: ({ referenceImageCount }) => ({
      requestModel: STORYBOARD_NEWAPI_MODEL_ID,
      modeLabel: resolveStoryboardNewApiModeLabel(
        isGptImage2Model ? 'openai-images' : normalizedConfig.apiFormat,
        referenceImageCount
      ),
    }),
  };
}

export function resolveStoryboardNewApiRuntimeModelConfig(
  config: StoryboardNewApiModelConfig,
  requestContext?: StoryboardNewApiRequestContext | null
): StoryboardNewApiModelConfig {
  return finalizeStoryboardNewApiModelConfig(config, requestContext);
}
