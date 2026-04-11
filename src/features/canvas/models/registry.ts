import type {
  ImageModelDefinition,
  ImageModelRuntimeContext,
  ModelProviderDefinition,
  ResolutionOption,
} from './types';
import {
  createStoryboardCompatibleImageModel,
  STORYBOARD_COMPATIBLE_MODEL_ID,
  type StoryboardCompatibleModelConfig,
} from './storyboardCompatible';
import {
  createStoryboardNewApiImageModel,
  isStoryboardNewApiModelId,
  STORYBOARD_NEWAPI_MODEL_ID,
  type StoryboardNewApiModelConfig,
} from './storyboardNewApi';
import {
  createCustomStoryboardImageModels,
  isStoryboardCompatibleModelId,
  type CustomStoryboardModelEntry,
} from './storyboardProviders';

const providerModules = import.meta.glob<{ provider: ModelProviderDefinition }>(
  './providers/*.ts',
  { eager: true }
);
const modelModules = import.meta.glob<{ imageModel: ImageModelDefinition }>(
  './image/**/*.ts',
  { eager: true }
);

const providers: ModelProviderDefinition[] = Object.values(providerModules)
  .map((module) => module.provider)
  .filter((provider): provider is ModelProviderDefinition => Boolean(provider))
  .sort((a, b) => a.id.localeCompare(b.id));

const imageModels: ImageModelDefinition[] = Object.values(modelModules)
  .map((module) => module.imageModel)
  .filter((model): model is ImageModelDefinition => Boolean(model))
  .sort((a, b) => a.id.localeCompare(b.id));

const providerMap = new Map<string, ModelProviderDefinition>(
  providers.map((provider) => [provider.id, provider])
);
const imageModelMap = new Map<string, ImageModelDefinition>(
  imageModels.map((model) => [model.id, model])
);

export const DEFAULT_IMAGE_MODEL_ID = 'kie/nano-banana-2';

const imageModelAliasMap = new Map<string, string>([
  ['gemini-3.1-flash', 'ppio/gemini-3.1-flash'],
  ['gemini-3.1-flash-edit', 'ppio/gemini-3.1-flash'],
  ['zhenzhen/nano-banana', 'zhenzhen/nano-banana-pro'],
  ['zhenzhen/nano-banana-2', 'zhenzhen/nano-banana-pro'],
  ['zhenzhen/nano-banana-2-2k', 'zhenzhen/nano-banana-pro'],
  ['zhenzhen/nano-banana-hd', 'zhenzhen/nano-banana-pro'],
  ['zhenzhen/nano-banana-2-4k', 'zhenzhen/nano-banana-pro'],
  ['zhenzhen/nano-banana-pro-2k', 'zhenzhen/nano-banana-pro'],
  ['zhenzhen/nano-banana-pro-4k', 'zhenzhen/nano-banana-pro'],
]);

function resolveCompatibleModelList(
  compatibleConfig?: StoryboardCompatibleModelConfig | null,
  newApiConfig?: StoryboardNewApiModelConfig | null,
  customStoryboardModels?: Record<string, CustomStoryboardModelEntry[]> | null
): ImageModelDefinition[] {
  const customModels = createCustomStoryboardImageModels(
    customStoryboardModels,
    compatibleConfig,
    newApiConfig
  );
  const hasCompatibleCustomModels = customModels.some(
    (model) => model.providerId === 'compatible'
  );
  const hasNewApiCustomModels = customModels.some(
    (model) => model.providerId === 'newapi'
  );
  const compatibleModel =
    hasCompatibleCustomModels
      ? null
      : createStoryboardCompatibleImageModel(compatibleConfig);
  const newApiModel =
    hasNewApiCustomModels
      ? null
      : createStoryboardNewApiImageModel(newApiConfig);
  return [
    ...imageModels,
    ...customModels,
    ...(compatibleModel ? [compatibleModel] : []),
    ...(newApiModel ? [newApiModel] : []),
  ];
}

export function listImageModels(
  compatibleConfig?: StoryboardCompatibleModelConfig | null,
  newApiConfig?: StoryboardNewApiModelConfig | null,
  customStoryboardModels?: Record<string, CustomStoryboardModelEntry[]> | null
): ImageModelDefinition[] {
  return resolveCompatibleModelList(compatibleConfig, newApiConfig, customStoryboardModels);
}

export function listStoryboardImageModels(
  compatibleConfig?: StoryboardCompatibleModelConfig | null,
  newApiConfig?: StoryboardNewApiModelConfig | null,
  customStoryboardModels?: Record<string, CustomStoryboardModelEntry[]> | null
): ImageModelDefinition[] {
  return resolveCompatibleModelList(compatibleConfig, newApiConfig, customStoryboardModels);
}

export function listModelProviders(): ModelProviderDefinition[] {
  return providers;
}

function resolveImageModel(
  modelId: string,
  compatibleConfig?: StoryboardCompatibleModelConfig | null,
  newApiConfig?: StoryboardNewApiModelConfig | null,
  customStoryboardModels?: Record<string, CustomStoryboardModelEntry[]> | null
): ImageModelDefinition {
  const resolvedModelId = imageModelAliasMap.get(modelId) ?? modelId;
  if (resolvedModelId === STORYBOARD_COMPATIBLE_MODEL_ID) {
    return (
      createStoryboardCompatibleImageModel(compatibleConfig)
      ?? imageModelMap.get(DEFAULT_IMAGE_MODEL_ID)!
    );
  }
  if (resolvedModelId === STORYBOARD_NEWAPI_MODEL_ID) {
    return (
      createStoryboardNewApiImageModel(newApiConfig)
      ?? imageModelMap.get(DEFAULT_IMAGE_MODEL_ID)!
    );
  }

  const dynamicModel = resolveCompatibleModelList(
    compatibleConfig,
    newApiConfig,
    customStoryboardModels
  ).find((model) => model.id === resolvedModelId);
  if (dynamicModel) {
    return dynamicModel;
  }

  if (isStoryboardCompatibleModelId(resolvedModelId)) {
    return (
      createStoryboardCompatibleImageModel(compatibleConfig)
      ?? imageModelMap.get(DEFAULT_IMAGE_MODEL_ID)!
    );
  }
  if (isStoryboardNewApiModelId(resolvedModelId)) {
    return (
      createStoryboardNewApiImageModel(newApiConfig)
      ?? imageModelMap.get(DEFAULT_IMAGE_MODEL_ID)!
    );
  }

  return imageModelMap.get(resolvedModelId) ?? imageModelMap.get(DEFAULT_IMAGE_MODEL_ID)!;
}

export function getImageModel(
  modelId: string,
  compatibleConfig?: StoryboardCompatibleModelConfig | null,
  newApiConfig?: StoryboardNewApiModelConfig | null,
  customStoryboardModels?: Record<string, CustomStoryboardModelEntry[]> | null
): ImageModelDefinition {
  return resolveImageModel(modelId, compatibleConfig, newApiConfig, customStoryboardModels);
}

export function getStoryboardImageModel(
  modelId: string,
  compatibleConfig?: StoryboardCompatibleModelConfig | null,
  newApiConfig?: StoryboardNewApiModelConfig | null,
  customStoryboardModels?: Record<string, CustomStoryboardModelEntry[]> | null
): ImageModelDefinition {
  return resolveImageModel(modelId, compatibleConfig, newApiConfig, customStoryboardModels);
}

export function resolveImageModelResolutions(
  model: ImageModelDefinition,
  context: ImageModelRuntimeContext = {}
): ResolutionOption[] {
  const resolvedOptions = model.resolveResolutions?.(context);
  return resolvedOptions && resolvedOptions.length > 0 ? resolvedOptions : model.resolutions;
}

export function resolveImageModelResolution(
  model: ImageModelDefinition,
  requestedResolution: string | undefined,
  context: ImageModelRuntimeContext = {}
): ResolutionOption {
  const resolutionOptions = resolveImageModelResolutions(model, context);

  return (
    (requestedResolution
      ? resolutionOptions.find((item) => item.value === requestedResolution)
      : undefined) ??
    resolutionOptions.find((item) => item.value === model.defaultResolution) ??
    resolutionOptions[0] ??
    model.resolutions[0]
  );
}

export function getModelProvider(providerId: string): ModelProviderDefinition {
  return (
    providerMap.get(providerId) ?? {
      id: 'unknown',
      name: 'Unknown Provider',
      label: 'Unknown',
    }
  );
}
