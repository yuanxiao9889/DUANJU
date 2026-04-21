import type { ImageModelDefinition } from './types';

export const STORYBOARD_API2OK_PROVIDER_ID = 'api2ok';
export const STORYBOARD_API2OK_BASE_URL = 'https://api2ok.qalgoai.com';

export const STORYBOARD_API2OK_API_FORMATS = ['gemini'] as const;

export type StoryboardApi2OkApiFormat =
  typeof STORYBOARD_API2OK_API_FORMATS[number];

export interface StoryboardApi2OkBuiltinModel {
  id: string;
  requestModel: string;
  displayName: string;
}

export const STORYBOARD_API2OK_BUILTIN_MODELS = [
  {
    id: `${STORYBOARD_API2OK_PROVIDER_ID}/gemini-3-pro-image-preview`,
    requestModel: 'gemini-3-pro-image-preview',
    displayName: '\u9999\u8549pro',
  },
  {
    id: `${STORYBOARD_API2OK_PROVIDER_ID}/gemini-3.1-flash-image-preview`,
    requestModel: 'gemini-3.1-flash-image-preview',
    displayName: '\u9999\u85492',
  },
] as const satisfies readonly StoryboardApi2OkBuiltinModel[];

export const STORYBOARD_API2OK_MODEL_ID = STORYBOARD_API2OK_BUILTIN_MODELS[0].id;
const DEFAULT_STORYBOARD_API2OK_MODEL = STORYBOARD_API2OK_BUILTIN_MODELS[0];

export interface StoryboardApi2OkModelConfig {
  apiFormat: StoryboardApi2OkApiFormat;
  endpointUrl: string;
  requestModel: string;
  displayName: string;
}

export interface StoryboardApi2OkExtraParamsPayload {
  api_format: StoryboardApi2OkApiFormat;
  endpoint_url: string;
  request_model: string;
  display_name: string;
}

export const DEFAULT_STORYBOARD_API2OK_API_FORMAT: StoryboardApi2OkApiFormat =
  'gemini';

function normalizeStoryboardApi2OkRequestModel(
  input: string | null | undefined
): string {
  const trimmed = (input ?? '').trim();
  if (!trimmed) {
    return '';
  }

  const prefix = `${STORYBOARD_API2OK_PROVIDER_ID}/`;
  if (trimmed.toLowerCase().startsWith(prefix.toLowerCase())) {
    return trimmed.slice(prefix.length).trim();
  }

  return trimmed;
}

export function findStoryboardApi2OkBuiltinModel(
  value: string | null | undefined
): StoryboardApi2OkBuiltinModel | undefined {
  const normalizedValue = (value ?? '').trim().toLowerCase();
  const normalizedRequestModel = normalizeStoryboardApi2OkRequestModel(value).toLowerCase();

  if (!normalizedValue && !normalizedRequestModel) {
    return undefined;
  }

  return STORYBOARD_API2OK_BUILTIN_MODELS.find(
    (model) =>
      model.id.toLowerCase() === normalizedValue
      || model.requestModel.toLowerCase() === normalizedRequestModel
  );
}

function createStoryboardApi2OkImageModelFromBuiltin(
  model: StoryboardApi2OkBuiltinModel
): ImageModelDefinition {
  return {
    id: model.id,
    mediaType: 'image',
    displayName: model.displayName,
    providerId: STORYBOARD_API2OK_PROVIDER_ID,
    description: 'Fixed XGJ API storyboard image endpoint',
    eta: '60-180s',
    expectedDurationMs: 120000,
    defaultAspectRatio: '1:1',
    defaultResolution: '2K',
    aspectRatios: [
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
    resolutions: [
      { value: '1K', label: '1K' },
      { value: '2K', label: '2K' },
      { value: '4K', label: '4K' },
    ],
    resolveRequest: ({ referenceImageCount }) => ({
      requestModel: model.id,
      modeLabel: resolveStoryboardApi2OkModeLabel(
        DEFAULT_STORYBOARD_API2OK_API_FORMAT,
        referenceImageCount
      ),
    }),
  };
}

export function normalizeStoryboardApi2OkApiFormat(
  _input: string | null | undefined
): StoryboardApi2OkApiFormat {
  return DEFAULT_STORYBOARD_API2OK_API_FORMAT;
}

export function normalizeStoryboardApi2OkModelConfig(
  input: Partial<StoryboardApi2OkModelConfig> | null | undefined
): StoryboardApi2OkModelConfig {
  const matchedBuiltinModel = findStoryboardApi2OkBuiltinModel(input?.requestModel);
  const normalizedRequestModel = normalizeStoryboardApi2OkRequestModel(input?.requestModel);
  const trimmedDisplayName = (input?.displayName ?? '').trim();

  return {
    apiFormat: normalizeStoryboardApi2OkApiFormat(input?.apiFormat),
    endpointUrl: STORYBOARD_API2OK_BASE_URL,
    requestModel:
      matchedBuiltinModel?.requestModel
      || normalizedRequestModel
      || DEFAULT_STORYBOARD_API2OK_MODEL.requestModel,
    displayName:
      matchedBuiltinModel?.displayName
      || trimmedDisplayName
      || normalizedRequestModel
      || DEFAULT_STORYBOARD_API2OK_MODEL.displayName,
  };
}

export function isStoryboardApi2OkModelConfigured(
  config: StoryboardApi2OkModelConfig | null | undefined
): boolean {
  return Boolean(
    config
    && config.requestModel.trim()
    && config.displayName.trim()
  );
}

export function isStoryboardApi2OkModelId(value: string | null | undefined): boolean {
  const normalizedValue = (value ?? '').trim();
  return (
    Boolean(findStoryboardApi2OkBuiltinModel(normalizedValue))
    || normalizedValue.startsWith(`${STORYBOARD_API2OK_PROVIDER_ID}/`)
  );
}

export function toStoryboardApi2OkExtraParamsPayload(
  config: StoryboardApi2OkModelConfig
): StoryboardApi2OkExtraParamsPayload {
  const normalizedConfig = normalizeStoryboardApi2OkModelConfig(config);
  return {
    api_format: normalizedConfig.apiFormat,
    endpoint_url: STORYBOARD_API2OK_BASE_URL,
    request_model: normalizedConfig.requestModel,
    display_name: normalizedConfig.displayName,
  };
}

export function resolveStoryboardApi2OkModeLabel(
  _apiFormat: StoryboardApi2OkApiFormat,
  referenceImageCount: number
): string {
  const suffix = referenceImageCount > 0 ? ' (I2I)' : '';
  return `XGJ API Gemini${suffix}`;
}

export function createStoryboardApi2OkImageModel(
  config: StoryboardApi2OkModelConfig | null | undefined
): ImageModelDefinition | null {
  const normalizedConfig = normalizeStoryboardApi2OkModelConfig(config);
  return createStoryboardApi2OkImageModelFromBuiltin(
    findStoryboardApi2OkBuiltinModel(normalizedConfig.requestModel)
      ?? DEFAULT_STORYBOARD_API2OK_MODEL
  );
}

export function createStoryboardApi2OkImageModels(): ImageModelDefinition[] {
  return STORYBOARD_API2OK_BUILTIN_MODELS.map((model) =>
    createStoryboardApi2OkImageModelFromBuiltin(model)
  );
}
