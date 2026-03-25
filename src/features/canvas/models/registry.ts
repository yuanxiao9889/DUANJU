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
]);

function resolveCompatibleModelList(
  compatibleConfig?: StoryboardCompatibleModelConfig | null
): ImageModelDefinition[] {
  const compatibleModel = createStoryboardCompatibleImageModel(compatibleConfig);
  return compatibleModel ? [...imageModels, compatibleModel] : imageModels;
}

export function listImageModels(
  compatibleConfig?: StoryboardCompatibleModelConfig | null
): ImageModelDefinition[] {
  return resolveCompatibleModelList(compatibleConfig);
}

export function listStoryboardImageModels(
  compatibleConfig?: StoryboardCompatibleModelConfig | null
): ImageModelDefinition[] {
  return resolveCompatibleModelList(compatibleConfig);
}

export function listModelProviders(): ModelProviderDefinition[] {
  return providers;
}

function resolveImageModel(
  modelId: string,
  compatibleConfig?: StoryboardCompatibleModelConfig | null
): ImageModelDefinition {
  const resolvedModelId = imageModelAliasMap.get(modelId) ?? modelId;
  if (resolvedModelId === STORYBOARD_COMPATIBLE_MODEL_ID) {
    return (
      createStoryboardCompatibleImageModel(compatibleConfig)
      ?? imageModelMap.get(DEFAULT_IMAGE_MODEL_ID)!
    );
  }

  return imageModelMap.get(resolvedModelId) ?? imageModelMap.get(DEFAULT_IMAGE_MODEL_ID)!;
}

export function getImageModel(
  modelId: string,
  compatibleConfig?: StoryboardCompatibleModelConfig | null
): ImageModelDefinition {
  return resolveImageModel(modelId, compatibleConfig);
}

export function getStoryboardImageModel(
  modelId: string,
  compatibleConfig?: StoryboardCompatibleModelConfig | null
): ImageModelDefinition {
  return resolveImageModel(modelId, compatibleConfig);
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
