import type { ImageModelDefinition } from './types';
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
    requestModel: 'gpt-image-2',
    displayName: 'gpt-image-2',
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
    normalizedRequestModel.includes('gemini')
    || normalizedRequestModel.includes('imagen')
  ) {
    return 'gemini';
  }

  return 'openai';
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
  customModels: Record<string, CustomStoryboardModelEntry[]> | null | undefined
): StoryboardNewApiModelConfig {
  const normalizedModelId = normalizeTrimmedString(modelId);
  const matchedBuiltinModel = findStoryboardOopiiBuiltinModel(normalizedModelId);
  if (matchedBuiltinModel) {
    return normalizeStoryboardOopiiModelConfig({
      requestModel: matchedBuiltinModel.requestModel,
      displayName: matchedBuiltinModel.displayName,
    });
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
    return normalizeStoryboardOopiiModelConfig({
      requestModel: matchedCustomModel.modelId,
      displayName: matchedCustomModel.displayName,
    });
  }

  const normalizedRequestModel = normalizeStoryboardOopiiRequestModel(normalizedModelId);
  if (normalizedRequestModel) {
    return normalizeStoryboardOopiiModelConfig({
      requestModel: normalizedRequestModel,
      displayName: normalizedRequestModel,
    });
  }

  return normalizeStoryboardOopiiModelConfig(undefined);
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

  const providerModelId = `${STORYBOARD_OOPII_PROVIDER_ID}/${normalizedConfig.requestModel}`;

  return {
    ...legacyModel,
    id: providerModelId,
    displayName: normalizedConfig.displayName,
    providerId: STORYBOARD_OOPII_PROVIDER_ID,
    description: 'Fixed OOpii storyboard image endpoint',
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
