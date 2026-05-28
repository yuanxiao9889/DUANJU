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
  isStoryboardNewApiProviderId,
  STORYBOARD_NEWAPI_MODEL_ID,
  STORYBOARD_NEWAPI_PROVIDER_ID,
  STORYBOARD_NEWAPI_PROVIDER_IDS,
  type StoryboardNewApiModelConfig,
} from './storyboardNewApi';
import {
  type StoryboardApi2OkModelConfig,
} from './storyboardApi2Ok';
import {
  createStoryboardOopiiImageModel,
  createStoryboardOopiiImageModels,
  isStoryboardOopiiModelId,
  resolveStoryboardOopiiModelConfigForModel,
} from './storyboardOopii';
import {
  createCustomStoryboardImageModels,
  getStoryboardNewApiModelConfigForProvider,
  isStoryboardCompatibleModelId,
  type CustomStoryboardModelEntry,
  type StoryboardNewApiModelConfigMap,
} from './storyboardProviders';

export interface StoryboardModelConfigInputs {
  compatibleConfig?: StoryboardCompatibleModelConfig | null;
  newApiConfig?: StoryboardNewApiModelConfig | null;
  api2OkConfig?: StoryboardApi2OkModelConfig | null;
  customStoryboardModels?: Record<string, CustomStoryboardModelEntry[]> | null;
  newApiConfigs?: StoryboardNewApiModelConfigMap | null;
}

function normalizeStoryboardModelConfigArgs(
  compatibleConfigOrInputs?: StoryboardCompatibleModelConfig | StoryboardModelConfigInputs | null,
  newApiConfig?: StoryboardNewApiModelConfig | null,
  api2OkConfig?: StoryboardApi2OkModelConfig | null,
  customStoryboardModels?: Record<string, CustomStoryboardModelEntry[]> | null,
  newApiConfigs?: StoryboardNewApiModelConfigMap | null
): StoryboardModelConfigInputs {
  if (
    compatibleConfigOrInputs
    && typeof compatibleConfigOrInputs === 'object'
    && (
      'compatibleConfig' in compatibleConfigOrInputs
      || 'newApiConfig' in compatibleConfigOrInputs
      || 'api2OkConfig' in compatibleConfigOrInputs
      || 'customStoryboardModels' in compatibleConfigOrInputs
      || 'newApiConfigs' in compatibleConfigOrInputs
    )
  ) {
    return compatibleConfigOrInputs as StoryboardModelConfigInputs;
  }

  return {
    compatibleConfig: compatibleConfigOrInputs as StoryboardCompatibleModelConfig | null | undefined,
    newApiConfig,
    api2OkConfig,
    customStoryboardModels,
    newApiConfigs,
  };
}

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
  ['zhenzhen/gemini-3.1-flash-image-preview-4k', 'zhenzhen/gemini-3.1-flash-image-preview'],
]);

function resolveCompatibleModelList(
  compatibleConfig?: StoryboardCompatibleModelConfig | null,
  newApiConfig?: StoryboardNewApiModelConfig | null,
  api2OkConfig?: StoryboardApi2OkModelConfig | null,
  customStoryboardModels?: Record<string, CustomStoryboardModelEntry[]> | null,
  newApiConfigs?: StoryboardNewApiModelConfigMap | null
): ImageModelDefinition[] {
  const customModels = createCustomStoryboardImageModels(
    customStoryboardModels,
    compatibleConfig,
    newApiConfig,
    api2OkConfig,
    newApiConfigs
  );
  const hasCompatibleCustomModels = customModels.some(
    (model) => model.providerId === 'compatible'
  );
  const newApiModels = STORYBOARD_NEWAPI_PROVIDER_IDS
    .filter((providerId) =>
      !customModels.some((model) => model.providerId === providerId)
    )
    .map((providerId) =>
      createStoryboardNewApiImageModel(
        getStoryboardNewApiModelConfigForProvider(providerId, newApiConfigs, newApiConfig),
        providerId
      )
    )
    .filter((model): model is ImageModelDefinition => Boolean(model));
  const compatibleModel =
    hasCompatibleCustomModels
      ? null
      : createStoryboardCompatibleImageModel(compatibleConfig);
  const oopiiModels = createStoryboardOopiiImageModels();
  return [
    ...imageModels,
    ...customModels,
    ...(compatibleModel ? [compatibleModel] : []),
    ...newApiModels,
    ...oopiiModels,
  ];
}

export function listImageModels(
  compatibleConfig?: StoryboardCompatibleModelConfig | StoryboardModelConfigInputs | null,
  newApiConfig?: StoryboardNewApiModelConfig | null,
  api2OkConfig?: StoryboardApi2OkModelConfig | null,
  customStoryboardModels?: Record<string, CustomStoryboardModelEntry[]> | null,
  newApiConfigs?: StoryboardNewApiModelConfigMap | null
): ImageModelDefinition[] {
  const inputs = normalizeStoryboardModelConfigArgs(
    compatibleConfig,
    newApiConfig,
    api2OkConfig,
    customStoryboardModels,
    newApiConfigs
  );
  return resolveCompatibleModelList(
    inputs.compatibleConfig,
    inputs.newApiConfig,
    inputs.api2OkConfig,
    inputs.customStoryboardModels,
    inputs.newApiConfigs
  );
}

export function listStoryboardImageModels(
  compatibleConfig?: StoryboardCompatibleModelConfig | StoryboardModelConfigInputs | null,
  newApiConfig?: StoryboardNewApiModelConfig | null,
  api2OkConfig?: StoryboardApi2OkModelConfig | null,
  customStoryboardModels?: Record<string, CustomStoryboardModelEntry[]> | null,
  newApiConfigs?: StoryboardNewApiModelConfigMap | null
): ImageModelDefinition[] {
  const inputs = normalizeStoryboardModelConfigArgs(
    compatibleConfig,
    newApiConfig,
    api2OkConfig,
    customStoryboardModels,
    newApiConfigs
  );
  return resolveCompatibleModelList(
    inputs.compatibleConfig,
    inputs.newApiConfig,
    inputs.api2OkConfig,
    inputs.customStoryboardModels,
    inputs.newApiConfigs
  );
}

export function listModelProviders(): ModelProviderDefinition[] {
  return providers;
}

function resolveImageModel(
  modelId: string,
  compatibleConfig?: StoryboardCompatibleModelConfig | null,
  newApiConfig?: StoryboardNewApiModelConfig | null,
  api2OkConfig?: StoryboardApi2OkModelConfig | null,
  customStoryboardModels?: Record<string, CustomStoryboardModelEntry[]> | null,
  newApiConfigs?: StoryboardNewApiModelConfigMap | null
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
      createStoryboardNewApiImageModel(newApiConfig, STORYBOARD_NEWAPI_PROVIDER_ID)
      ?? imageModelMap.get(DEFAULT_IMAGE_MODEL_ID)!
    );
  }
  const dynamicModel = resolveCompatibleModelList(
    compatibleConfig,
    newApiConfig,
    api2OkConfig,
    customStoryboardModels,
    newApiConfigs
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
    const providerId = resolvedModelId.split('/', 1)[0];
    return (
      createStoryboardNewApiImageModel(
        getStoryboardNewApiModelConfigForProvider(
          isStoryboardNewApiProviderId(providerId) ? providerId : STORYBOARD_NEWAPI_PROVIDER_ID,
          newApiConfigs,
          newApiConfig
        ),
        isStoryboardNewApiProviderId(providerId) ? providerId : STORYBOARD_NEWAPI_PROVIDER_ID
      )
      ?? imageModelMap.get(DEFAULT_IMAGE_MODEL_ID)!
    );
  }
  if (isStoryboardOopiiModelId(resolvedModelId)) {
    return (
      createStoryboardOopiiImageModel(
        resolveStoryboardOopiiModelConfigForModel(
          resolvedModelId,
          customStoryboardModels
        )
      )
      ?? imageModelMap.get(DEFAULT_IMAGE_MODEL_ID)!
    );
  }

  return imageModelMap.get(resolvedModelId) ?? imageModelMap.get(DEFAULT_IMAGE_MODEL_ID)!;
}

export function getImageModel(
  modelId: string,
  compatibleConfig?: StoryboardCompatibleModelConfig | StoryboardModelConfigInputs | null,
  newApiConfig?: StoryboardNewApiModelConfig | null,
  api2OkConfig?: StoryboardApi2OkModelConfig | null,
  customStoryboardModels?: Record<string, CustomStoryboardModelEntry[]> | null,
  newApiConfigs?: StoryboardNewApiModelConfigMap | null
): ImageModelDefinition {
  const inputs = normalizeStoryboardModelConfigArgs(
    compatibleConfig,
    newApiConfig,
    api2OkConfig,
    customStoryboardModels,
    newApiConfigs
  );
  return resolveImageModel(
    modelId,
    inputs.compatibleConfig,
    inputs.newApiConfig,
    inputs.api2OkConfig,
    inputs.customStoryboardModels,
    inputs.newApiConfigs
  );
}

export function getStoryboardImageModel(
  modelId: string,
  compatibleConfig?: StoryboardCompatibleModelConfig | StoryboardModelConfigInputs | null,
  newApiConfig?: StoryboardNewApiModelConfig | null,
  api2OkConfig?: StoryboardApi2OkModelConfig | null,
  customStoryboardModels?: Record<string, CustomStoryboardModelEntry[]> | null,
  newApiConfigs?: StoryboardNewApiModelConfigMap | null
): ImageModelDefinition {
  const inputs = normalizeStoryboardModelConfigArgs(
    compatibleConfig,
    newApiConfig,
    api2OkConfig,
    customStoryboardModels,
    newApiConfigs
  );
  return resolveImageModel(
    modelId,
    inputs.compatibleConfig,
    inputs.newApiConfig,
    inputs.api2OkConfig,
    inputs.customStoryboardModels,
    inputs.newApiConfigs
  );
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
