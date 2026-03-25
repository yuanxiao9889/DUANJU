import type { ImageModelDefinition } from './types';

export const STORYBOARD_COMPATIBLE_PROVIDER_ID = 'compatible';
export const STORYBOARD_COMPATIBLE_MODEL_ID =
  `${STORYBOARD_COMPATIBLE_PROVIDER_ID}/storyboard-experimental`;

export const STORYBOARD_COMPATIBLE_API_FORMATS = [
  'openai-generations',
  'openai-edits',
  'openai-chat',
  'gemini-generate-content',
] as const;

export type StoryboardCompatibleApiFormat =
  typeof STORYBOARD_COMPATIBLE_API_FORMATS[number];

export interface StoryboardCompatibleModelConfig {
  apiFormat: StoryboardCompatibleApiFormat;
  endpointUrl: string;
  requestModel: string;
  displayName: string;
}

export interface StoryboardCompatibleExtraParamsPayload {
  api_format: StoryboardCompatibleApiFormat;
  endpoint_url: string;
  request_model: string;
  display_name: string;
}

export const DEFAULT_STORYBOARD_COMPATIBLE_API_FORMAT: StoryboardCompatibleApiFormat =
  'openai-generations';

export function normalizeStoryboardCompatibleApiFormat(
  input: string | null | undefined
): StoryboardCompatibleApiFormat {
  return STORYBOARD_COMPATIBLE_API_FORMATS.includes(
    input as StoryboardCompatibleApiFormat
  )
    ? (input as StoryboardCompatibleApiFormat)
    : DEFAULT_STORYBOARD_COMPATIBLE_API_FORMAT;
}

export function normalizeStoryboardCompatibleModelConfig(
  input: Partial<StoryboardCompatibleModelConfig> | null | undefined
): StoryboardCompatibleModelConfig {
  return {
    apiFormat: normalizeStoryboardCompatibleApiFormat(input?.apiFormat),
    endpointUrl: (input?.endpointUrl ?? '').trim(),
    requestModel: (input?.requestModel ?? '').trim(),
    displayName: (input?.displayName ?? '').trim(),
  };
}

export function isStoryboardCompatibleModelConfigured(
  config: StoryboardCompatibleModelConfig | null | undefined
): boolean {
  return Boolean(
    config
    && config.endpointUrl.trim()
    && config.requestModel.trim()
    && config.displayName.trim()
  );
}

export function toStoryboardCompatibleExtraParamsPayload(
  config: StoryboardCompatibleModelConfig
): StoryboardCompatibleExtraParamsPayload {
  const normalizedConfig = normalizeStoryboardCompatibleModelConfig(config);
  return {
    api_format: normalizedConfig.apiFormat,
    endpoint_url: normalizedConfig.endpointUrl,
    request_model: normalizedConfig.requestModel,
    display_name: normalizedConfig.displayName,
  };
}

export function resolveStoryboardCompatibleModeLabel(
  apiFormat: StoryboardCompatibleApiFormat,
  referenceImageCount: number
): string {
  switch (apiFormat) {
    case 'openai-generations':
      return referenceImageCount > 0 ? 'OpenAI Generations (I2I)' : 'OpenAI Generations';
    case 'openai-edits':
      return 'OpenAI Edits';
    case 'openai-chat':
      return 'OpenAI Chat';
    case 'gemini-generate-content':
      return 'Gemini generateContent';
    default:
      return 'Compatible API';
  }
}

export function createStoryboardCompatibleImageModel(
  config: StoryboardCompatibleModelConfig | null | undefined
): ImageModelDefinition | null {
  const normalizedConfig = normalizeStoryboardCompatibleModelConfig(config);
  if (!isStoryboardCompatibleModelConfigured(normalizedConfig)) {
    return null;
  }

  return {
    id: STORYBOARD_COMPATIBLE_MODEL_ID,
    mediaType: 'image',
    displayName: normalizedConfig.displayName,
    providerId: STORYBOARD_COMPATIBLE_PROVIDER_ID,
    description: 'Experimental storyboard-only compatible endpoint',
    eta: 'Experimental',
    expectedDurationMs: 60000,
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
      requestModel: STORYBOARD_COMPATIBLE_MODEL_ID,
      modeLabel: resolveStoryboardCompatibleModeLabel(
        normalizedConfig.apiFormat,
        referenceImageCount
      ),
    }),
  };
}
