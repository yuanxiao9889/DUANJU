import type {
  AspectRatioOption,
  ImageModelDefinition,
  ModelProviderDefinition,
  ResolutionOption,
} from './types';
import {
  createStoryboardCompatibleImageModel,
  normalizeStoryboardCompatibleModelConfig,
  resolveStoryboardCompatibleModeLabel,
  STORYBOARD_COMPATIBLE_MODEL_ID,
  STORYBOARD_COMPATIBLE_PROVIDER_ID,
  type StoryboardCompatibleModelConfig,
} from './storyboardCompatible';
import {
  createStoryboardNewApiImageModel,
  normalizeStoryboardNewApiModelConfig,
  resolveStoryboardNewApiModeLabel,
  STORYBOARD_NEWAPI_PROVIDER_ID,
  type StoryboardNewApiModelConfig,
} from './storyboardNewApi';
import {
  createStoryboardApi2OkImageModel,
  findStoryboardApi2OkBuiltinModel,
  normalizeStoryboardApi2OkModelConfig,
  resolveStoryboardApi2OkModeLabel,
  STORYBOARD_API2OK_PROVIDER_ID,
  STORYBOARD_API2OK_BUILTIN_MODELS,
  type StoryboardApi2OkModelConfig,
} from './storyboardApi2Ok';
import { AZEMM_NANO_BANANA_MODEL_ID } from './image/azemm/nanoBanana';
import { AZEMM_NANO_BANANA_HD_MODEL_ID } from './image/azemm/nanoBananaHd';
import { BLTCY_GEMINI_FLASH_IMAGE_PREVIEW_4K_MODEL_ID } from './image/bltcy/nanoBanana';
import { BLTCY_NANO_BANANA_2_4K_MODEL_ID } from './image/bltcy/nanoBananaHd';
import { COMFLY_NANO_BANANA_PRO_MODEL_ID } from './image/comfly/nanoBanana';
import { COMFLY_GEMINI_FLASH_IMAGE_PREVIEW_MODEL_ID } from './image/comfly/geminiFlashImagePreview';
import { ZHENZHEN_NANO_BANANA_MODEL_ID } from './image/zhenzhen/nanoBanana';
import { ZHENZHEN_GEMINI_FLASH_IMAGE_PREVIEW_MODEL_ID } from './image/zhenzhen/geminiFlashImagePreview';

export const STORYBOARD_CUSTOM_MODEL_PROVIDER_IDS = [
  'azemm',
  'comfly',
  'zhenzhen',
  'bltcy',
  STORYBOARD_API2OK_PROVIDER_ID,
  STORYBOARD_COMPATIBLE_PROVIDER_ID,
  STORYBOARD_NEWAPI_PROVIDER_ID,
] as const;

export type StoryboardCustomModelProviderId =
  typeof STORYBOARD_CUSTOM_MODEL_PROVIDER_IDS[number];

export interface CustomStoryboardModelEntry {
  id: string;
  modelId: string;
  displayName: string;
}

export interface StoryboardModelOption {
  modelId: string;
  label: string;
  source: 'builtin' | 'custom';
  customModelId?: string;
}

export interface StoryboardModelSettingsLike {
  storyboardModelOverrides?: Record<string, string>;
  storyboardProviderCustomModels?: Record<string, CustomStoryboardModelEntry[]>;
  storyboardCompatibleModelConfig?: StoryboardCompatibleModelConfig | null;
  storyboardNewApiModelConfig?: StoryboardNewApiModelConfig | null;
  storyboardApi2OkModelConfig?: StoryboardApi2OkModelConfig | null;
}

const STORYBOARD_CUSTOM_MODEL_PROVIDER_ID_SET = new Set<string>(
  STORYBOARD_CUSTOM_MODEL_PROVIDER_IDS
);

const FULL_ASPECT_RATIOS = [
  '1:1',
  '1:4',
  '1:8',
  '2:3',
  '3:2',
  '3:4',
  '4:1',
  '4:3',
  '4:5',
  '5:4',
  '8:1',
  '9:16',
  '16:9',
  '21:9',
] as const;

const HD_ASPECT_RATIOS = [
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

const FULL_RESOLUTIONS: ResolutionOption[] = [
  { value: '1K', label: '1K' },
  { value: '2K', label: '2K' },
  { value: '4K', label: '4K' },
];

const FOUR_K_RESOLUTIONS: ResolutionOption[] = [
  { value: '4K', label: '4K' },
];

const COMPATIBLE_ASPECT_RATIO_OPTIONS: AspectRatioOption[] = FULL_ASPECT_RATIOS.map((value) => ({
  value,
  label: value,
}));

const COMPATIBLE_RESOLUTION_OPTIONS: ResolutionOption[] = [
  { value: '1K', label: '1K' },
  { value: '2K', label: '2K' },
  { value: '4K', label: '4K' },
];

const BUILT_IN_STORYBOARD_MODELS: Record<
  StoryboardCustomModelProviderId,
  readonly StoryboardModelOption[]
> = {
  azemm: [
    { modelId: AZEMM_NANO_BANANA_MODEL_ID, label: '\u9999\u85492', source: 'builtin' },
    { modelId: AZEMM_NANO_BANANA_HD_MODEL_ID, label: '\u9999\u8549pro', source: 'builtin' },
  ],
  comfly: [
    { modelId: COMFLY_NANO_BANANA_PRO_MODEL_ID, label: '\u9999\u8549Pro', source: 'builtin' },
    { modelId: COMFLY_GEMINI_FLASH_IMAGE_PREVIEW_MODEL_ID, label: 'Gemini 3.1 Flash', source: 'builtin' },
  ],
  zhenzhen: [
    { modelId: ZHENZHEN_NANO_BANANA_MODEL_ID, label: 'Nano Banana Pro', source: 'builtin' },
    {
      modelId: ZHENZHEN_GEMINI_FLASH_IMAGE_PREVIEW_MODEL_ID,
      label: '\u9999\u85492',
      source: 'builtin',
    },
  ],
  bltcy: [
    { modelId: BLTCY_GEMINI_FLASH_IMAGE_PREVIEW_4K_MODEL_ID, label: '\u9999\u85492', source: 'builtin' },
    { modelId: BLTCY_NANO_BANANA_2_4K_MODEL_ID, label: '\u9999\u8549Pro', source: 'builtin' },
  ],
  api2ok: STORYBOARD_API2OK_BUILTIN_MODELS.map((model) => ({
    modelId: model.id,
    label: model.displayName,
    source: 'builtin' as const,
  })),
  compatible: [],
  newapi: [],
};

function normalizeTrimmedString(input: unknown): string {
  return typeof input === 'string' ? input.trim() : '';
}

function normalizeStoryboardRequestModelId(
  providerId: string,
  input: unknown
): string {
  const trimmed = normalizeTrimmedString(input);
  if (!trimmed) {
    return '';
  }

  const prefix = `${providerId}/`;
  if (trimmed.toLowerCase().startsWith(prefix.toLowerCase())) {
    return trimmed.slice(prefix.length).trim();
  }

  return trimmed;
}

function buildCustomStoryboardModelEntryId(providerId: string, modelId: string): string {
  const normalizedModelId = normalizeStoryboardRequestModelId(providerId, modelId)
    .toLowerCase()
    .replace(/[^a-z0-9._/-]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return `${providerId}:${normalizedModelId || 'model'}`;
}

export function isStoryboardCustomModelProviderId(
  value: string | null | undefined
): value is StoryboardCustomModelProviderId {
  return STORYBOARD_CUSTOM_MODEL_PROVIDER_ID_SET.has((value ?? '').trim());
}

export function listStoryboardCustomModelProviders(
  providers: ModelProviderDefinition[]
): ModelProviderDefinition[] {
  return providers.filter((provider) => isStoryboardCustomModelProviderId(provider.id));
}

export function toStoryboardProviderModelId(providerId: string, modelId: string): string {
  const normalizedProviderId = normalizeTrimmedString(providerId);
  const normalizedModelId = normalizeStoryboardRequestModelId(providerId, modelId);
  if (!normalizedProviderId || !normalizedModelId) {
    return '';
  }

  return `${normalizedProviderId}/${normalizedModelId}`;
}

export function isStoryboardCompatibleModelId(value: string | null | undefined): boolean {
  const normalizedValue = normalizeTrimmedString(value);
  return (
    normalizedValue === STORYBOARD_COMPATIBLE_MODEL_ID
    || normalizedValue.startsWith(`${STORYBOARD_COMPATIBLE_PROVIDER_ID}/`)
  );
}

export function getDefaultStoryboardModelId(
  providerId: string,
  compatibleConfig?: StoryboardCompatibleModelConfig | null,
  customModels?: Record<string, CustomStoryboardModelEntry[]> | null
): string {
  if (!isStoryboardCustomModelProviderId(providerId)) {
    return '';
  }

  return (
    resolveStoryboardModelOptions(providerId, customModels, compatibleConfig)[0]?.modelId ?? ''
  );
}

export function normalizeCustomStoryboardModelEntries(
  input: unknown,
  providerId?: string
): CustomStoryboardModelEntry[] {
  if (!Array.isArray(input)) {
    return [];
  }

  const result: CustomStoryboardModelEntry[] = [];
  const seenModelIds = new Set<string>();

  for (const item of input) {
    const record = item && typeof item === 'object'
      ? item as Record<string, unknown>
      : null;
    const resolvedProviderId =
      normalizeTrimmedString(record?.providerId) || normalizeTrimmedString(providerId);
    const modelId = resolvedProviderId
      ? normalizeStoryboardRequestModelId(
        resolvedProviderId,
        record?.modelId ?? record?.value ?? (typeof item === 'string' ? item : '')
      )
      : normalizeTrimmedString(record?.modelId ?? record?.value ?? (typeof item === 'string' ? item : ''));

    if (!resolvedProviderId || !isStoryboardCustomModelProviderId(resolvedProviderId) || !modelId) {
      continue;
    }

    const providerModelId = toStoryboardProviderModelId(resolvedProviderId, modelId).toLowerCase();
    if (seenModelIds.has(providerModelId)) {
      continue;
    }
    seenModelIds.add(providerModelId);

    const displayName = normalizeTrimmedString(record?.displayName ?? record?.label) || modelId;
    const id =
      normalizeTrimmedString(record?.id)
      || buildCustomStoryboardModelEntryId(resolvedProviderId, modelId);

    result.push({
      id,
      modelId,
      displayName,
    });
  }

  return result;
}

function createLegacyCompatibleModelEntry(
  compatibleConfig: StoryboardCompatibleModelConfig | null | undefined
): CustomStoryboardModelEntry | null {
  const normalizedConfig = normalizeStoryboardCompatibleModelConfig(compatibleConfig);
  if (!normalizedConfig.requestModel || !normalizedConfig.displayName) {
    return null;
  }

  return {
    id: buildCustomStoryboardModelEntryId(
      STORYBOARD_COMPATIBLE_PROVIDER_ID,
      normalizedConfig.requestModel
    ),
    modelId: normalizeStoryboardRequestModelId(
      STORYBOARD_COMPATIBLE_PROVIDER_ID,
      normalizedConfig.requestModel
    ),
    displayName: normalizedConfig.displayName,
  };
}

function createLegacyNewApiModelEntry(
  newApiConfig: StoryboardNewApiModelConfig | null | undefined
): CustomStoryboardModelEntry | null {
  const normalizedConfig = normalizeStoryboardNewApiModelConfig(newApiConfig);
  if (!normalizedConfig.requestModel || !normalizedConfig.displayName) {
    return null;
  }

  return {
    id: buildCustomStoryboardModelEntryId(
      STORYBOARD_NEWAPI_PROVIDER_ID,
      normalizedConfig.requestModel
    ),
    modelId: normalizeStoryboardRequestModelId(
      STORYBOARD_NEWAPI_PROVIDER_ID,
      normalizedConfig.requestModel
    ),
    displayName: normalizedConfig.displayName,
  };
}

function createLegacyApi2OkModelEntry(
  api2OkConfig: StoryboardApi2OkModelConfig | null | undefined
): CustomStoryboardModelEntry | null {
  const requestModel = normalizeTrimmedString(api2OkConfig?.requestModel);
  const displayName = normalizeTrimmedString(api2OkConfig?.displayName);
  if (!requestModel || !displayName) {
    return null;
  }

  const matchedBuiltinModel = findStoryboardApi2OkBuiltinModel(requestModel);
  if (
    matchedBuiltinModel
    && matchedBuiltinModel.requestModel.toLowerCase() === requestModel.toLowerCase()
    && matchedBuiltinModel.displayName === displayName
  ) {
    return null;
  }

  return {
    id: buildCustomStoryboardModelEntryId(
      STORYBOARD_API2OK_PROVIDER_ID,
      requestModel
    ),
    modelId: normalizeStoryboardRequestModelId(
      STORYBOARD_API2OK_PROVIDER_ID,
      requestModel
    ),
    displayName,
  };
}

export function normalizeStoryboardProviderCustomModels(
  input: unknown,
  compatibleConfig?: StoryboardCompatibleModelConfig | null,
  newApiConfig?: StoryboardNewApiModelConfig | null,
  api2OkConfig?: StoryboardApi2OkModelConfig | null
): Record<string, CustomStoryboardModelEntry[]> {
  const record =
    input && typeof input === 'object' && !Array.isArray(input)
      ? input as Record<string, unknown>
      : {};

  const result: Record<string, CustomStoryboardModelEntry[]> = {};

  for (const providerId of STORYBOARD_CUSTOM_MODEL_PROVIDER_IDS) {
    const normalizedEntries = normalizeCustomStoryboardModelEntries(record[providerId], providerId).map(
      (entry) => ({
        ...entry,
        id: normalizeTrimmedString(entry.id) || buildCustomStoryboardModelEntryId(providerId, entry.modelId),
      })
    );

    if (providerId === STORYBOARD_COMPATIBLE_PROVIDER_ID) {
      const legacyEntry = createLegacyCompatibleModelEntry(compatibleConfig);
      if (
        legacyEntry
        && !normalizedEntries.some((entry) =>
          toStoryboardProviderModelId(providerId, entry.modelId).toLowerCase()
          === toStoryboardProviderModelId(providerId, legacyEntry.modelId).toLowerCase()
        )
      ) {
        normalizedEntries.unshift(legacyEntry);
      }
    }

    if (providerId === STORYBOARD_NEWAPI_PROVIDER_ID) {
      const legacyEntry = createLegacyNewApiModelEntry(newApiConfig);
      if (
        legacyEntry
        && !normalizedEntries.some((entry) =>
          toStoryboardProviderModelId(providerId, entry.modelId).toLowerCase()
          === toStoryboardProviderModelId(providerId, legacyEntry.modelId).toLowerCase()
        )
      ) {
        normalizedEntries.unshift(legacyEntry);
      }
    }

    if (providerId === STORYBOARD_API2OK_PROVIDER_ID) {
      const legacyEntry = createLegacyApi2OkModelEntry(api2OkConfig);
      if (
        legacyEntry
        && !normalizedEntries.some((entry) =>
          toStoryboardProviderModelId(providerId, entry.modelId).toLowerCase()
          === toStoryboardProviderModelId(providerId, legacyEntry.modelId).toLowerCase()
        )
      ) {
        normalizedEntries.unshift(legacyEntry);
      }
    }

    if (normalizedEntries.length > 0) {
      result[providerId] = normalizedEntries;
    }
  }

  return result;
}

export function getCustomStoryboardModels(
  providerId: string,
  customModels: Record<string, CustomStoryboardModelEntry[]> | null | undefined
): CustomStoryboardModelEntry[] {
  if (!isStoryboardCustomModelProviderId(providerId)) {
    return [];
  }

  return normalizeCustomStoryboardModelEntries(customModels?.[providerId], providerId).map(
    (entry) => ({
      ...entry,
      id: normalizeTrimmedString(entry.id) || buildCustomStoryboardModelEntryId(providerId, entry.modelId),
    })
  );
}

export function resolveStoryboardModelOptions(
  providerId: string,
  customModels: Record<string, CustomStoryboardModelEntry[]> | null | undefined,
  compatibleConfig?: StoryboardCompatibleModelConfig | null,
  newApiConfig?: StoryboardNewApiModelConfig | null,
  api2OkConfig?: StoryboardApi2OkModelConfig | null
): StoryboardModelOption[] {
  if (!isStoryboardCustomModelProviderId(providerId)) {
    return [];
  }

  const result: StoryboardModelOption[] = [];
  const seenModelIds = new Set<string>();
  const normalizedCustomModels = normalizeStoryboardProviderCustomModels(
    customModels,
    compatibleConfig,
    newApiConfig,
    api2OkConfig
  );

  for (const option of BUILT_IN_STORYBOARD_MODELS[providerId]) {
    const modelKey = option.modelId.toLowerCase();
    if (seenModelIds.has(modelKey)) {
      continue;
    }
    seenModelIds.add(modelKey);
    result.push(option);
  }

  for (const entry of getCustomStoryboardModels(providerId, normalizedCustomModels)) {
    const providerModelId = toStoryboardProviderModelId(providerId, entry.modelId);
    if (!providerModelId) {
      continue;
    }

    const modelKey = providerModelId.toLowerCase();
    if (seenModelIds.has(modelKey)) {
      continue;
    }
    seenModelIds.add(modelKey);

    result.push({
      modelId: providerModelId,
      label: entry.displayName || entry.modelId,
      source: 'custom',
      customModelId: entry.id,
    });
  }

  return result;
}

export function resolveConfiguredStoryboardModel(
  providerId: string,
  settings: StoryboardModelSettingsLike
): string {
  if (!isStoryboardCustomModelProviderId(providerId)) {
    return '';
  }

  const resolvedOptions = resolveStoryboardModelOptions(
    providerId,
    settings.storyboardProviderCustomModels,
    settings.storyboardCompatibleModelConfig,
    settings.storyboardNewApiModelConfig,
    settings.storyboardApi2OkModelConfig
  );
  const defaultModelId = resolvedOptions[0]?.modelId ?? '';
  const explicitModel = normalizeTrimmedString(settings.storyboardModelOverrides?.[providerId]);
  if (!explicitModel) {
    return defaultModelId;
  }

  const normalizedModel = explicitModel.includes('/')
    ? explicitModel
    : toStoryboardProviderModelId(providerId, explicitModel);
  if (
    normalizedModel
    && resolvedOptions.some((option) => option.modelId.toLowerCase() === normalizedModel.toLowerCase())
  ) {
    return normalizedModel;
  }

  if (
    providerId === STORYBOARD_COMPATIBLE_PROVIDER_ID
    && isStoryboardCompatibleModelId(normalizedModel)
  ) {
    return normalizedModel;
  }

  return defaultModelId;
}

export function normalizeStoryboardModelOverrides(
  input: unknown,
  customModels: Record<string, CustomStoryboardModelEntry[]>,
  compatibleConfig?: StoryboardCompatibleModelConfig | null,
  newApiConfig?: StoryboardNewApiModelConfig | null,
  api2OkConfig?: StoryboardApi2OkModelConfig | null
): Record<string, string> {
  const record =
    input && typeof input === 'object' && !Array.isArray(input)
      ? input as Record<string, unknown>
      : {};

  return STORYBOARD_CUSTOM_MODEL_PROVIDER_IDS.reduce<Record<string, string>>((result, providerId) => {
    const rawModel = normalizeTrimmedString(record[providerId]);
    result[providerId] = resolveConfiguredStoryboardModel(providerId, {
      storyboardModelOverrides: rawModel ? { [providerId]: rawModel } : undefined,
      storyboardProviderCustomModels: customModels,
      storyboardCompatibleModelConfig: compatibleConfig,
      storyboardNewApiModelConfig: newApiConfig,
      storyboardApi2OkModelConfig: api2OkConfig,
    });
    return result;
  }, {});
}

export function upsertCustomStoryboardModelEntry(
  providerId: string,
  entries: CustomStoryboardModelEntry[],
  nextModelId: string,
  nextDisplayName: string
): CustomStoryboardModelEntry[] {
  const normalizedModelId = normalizeStoryboardRequestModelId(providerId, nextModelId);
  if (!isStoryboardCustomModelProviderId(providerId) || !normalizedModelId) {
    return entries;
  }

  const displayName = normalizeTrimmedString(nextDisplayName) || normalizedModelId;
  const nextEntry: CustomStoryboardModelEntry = {
    id: buildCustomStoryboardModelEntryId(providerId, normalizedModelId),
    modelId: normalizedModelId,
    displayName,
  };

  return normalizeCustomStoryboardModelEntries(
    [
      ...entries.filter(
        (entry) =>
          toStoryboardProviderModelId(providerId, entry.modelId).toLowerCase()
          !== toStoryboardProviderModelId(providerId, normalizedModelId).toLowerCase()
      ),
      nextEntry,
    ],
    providerId
  ).map((entry) => ({
    ...entry,
    id: normalizeTrimmedString(entry.id) || buildCustomStoryboardModelEntryId(providerId, entry.modelId),
  }));
}

export function resolveStoryboardCompatibleModelConfigForModel(
  modelId: string | null | undefined,
  compatibleConfig: StoryboardCompatibleModelConfig | null | undefined,
  customModels: Record<string, CustomStoryboardModelEntry[]> | null | undefined
): StoryboardCompatibleModelConfig {
  const normalizedConfig = normalizeStoryboardCompatibleModelConfig(compatibleConfig);
  const normalizedModelId = normalizeTrimmedString(modelId);
  if (!isStoryboardCompatibleModelId(normalizedModelId)) {
    return normalizedConfig;
  }

  const matchedEntry = getCustomStoryboardModels(STORYBOARD_COMPATIBLE_PROVIDER_ID, customModels).find(
    (entry) =>
      toStoryboardProviderModelId(STORYBOARD_COMPATIBLE_PROVIDER_ID, entry.modelId).toLowerCase()
      === normalizedModelId.toLowerCase()
  );

  if (!matchedEntry) {
    return normalizedConfig;
  }

  return normalizeStoryboardCompatibleModelConfig({
    ...normalizedConfig,
    requestModel: matchedEntry.modelId,
    displayName: matchedEntry.displayName,
  });
}

export function resolveStoryboardNewApiModelConfigForModel(
  modelId: string | null | undefined,
  newApiConfig: StoryboardNewApiModelConfig | null | undefined,
  customModels: Record<string, CustomStoryboardModelEntry[]> | null | undefined
): StoryboardNewApiModelConfig {
  const normalizedConfig = normalizeStoryboardNewApiModelConfig(newApiConfig);
  const normalizedModelId = normalizeTrimmedString(modelId);
  if (!normalizedModelId.startsWith(`${STORYBOARD_NEWAPI_PROVIDER_ID}/`)) {
    return normalizedConfig;
  }

  const matchedEntry = getCustomStoryboardModels(STORYBOARD_NEWAPI_PROVIDER_ID, customModels).find(
    (entry) =>
      toStoryboardProviderModelId(STORYBOARD_NEWAPI_PROVIDER_ID, entry.modelId).toLowerCase()
      === normalizedModelId.toLowerCase()
  );

  if (!matchedEntry) {
    return normalizedConfig;
  }

  return normalizeStoryboardNewApiModelConfig({
    ...normalizedConfig,
    requestModel: matchedEntry.modelId,
    displayName: matchedEntry.displayName,
  });
}

export function resolveStoryboardApi2OkModelConfigForModel(
  modelId: string | null | undefined,
  api2OkConfig: StoryboardApi2OkModelConfig | null | undefined,
  customModels: Record<string, CustomStoryboardModelEntry[]> | null | undefined
): StoryboardApi2OkModelConfig {
  const normalizedConfig = normalizeStoryboardApi2OkModelConfig(api2OkConfig);
  const normalizedModelId = normalizeTrimmedString(modelId);
  if (!normalizedModelId.startsWith(`${STORYBOARD_API2OK_PROVIDER_ID}/`)) {
    return normalizedConfig;
  }

  const matchedBuiltinModel = findStoryboardApi2OkBuiltinModel(normalizedModelId);
  if (matchedBuiltinModel) {
    return normalizeStoryboardApi2OkModelConfig({
      ...normalizedConfig,
      requestModel: matchedBuiltinModel.requestModel,
      displayName: matchedBuiltinModel.displayName,
    });
  }

  const matchedEntry = getCustomStoryboardModels(STORYBOARD_API2OK_PROVIDER_ID, customModels).find(
    (entry) =>
      toStoryboardProviderModelId(STORYBOARD_API2OK_PROVIDER_ID, entry.modelId).toLowerCase()
      === normalizedModelId.toLowerCase()
  );

  if (!matchedEntry) {
    return normalizedConfig;
  }

  return normalizeStoryboardApi2OkModelConfig({
    ...normalizedConfig,
    requestModel: matchedEntry.modelId,
    displayName: matchedEntry.displayName,
  });
}

interface StoryboardCustomModelProfile {
  aspectRatios: AspectRatioOption[];
  resolutions: ResolutionOption[];
  defaultResolution: string;
  eta: string;
  expectedDurationMs: number;
}

function resolveStoryboardCustomModelProfile(
  providerId: StoryboardCustomModelProviderId,
  requestModelId: string
): StoryboardCustomModelProfile {
  const normalizedModelId = normalizeTrimmedString(requestModelId).toLowerCase();

  if (providerId === STORYBOARD_COMPATIBLE_PROVIDER_ID) {
    return {
      aspectRatios: COMPATIBLE_ASPECT_RATIO_OPTIONS,
      resolutions: COMPATIBLE_RESOLUTION_OPTIONS,
      defaultResolution: '2K',
      eta: 'Experimental',
      expectedDurationMs: 60000,
    };
  }

  if (normalizedModelId.includes('gemini') || normalizedModelId.includes('preview')) {
    return {
      aspectRatios: COMPATIBLE_ASPECT_RATIO_OPTIONS,
      resolutions: FULL_RESOLUTIONS,
      defaultResolution: '1K',
      eta: '30s',
      expectedDurationMs: 30000,
    };
  }

  if (normalizedModelId.includes('2k') && !normalizedModelId.includes('4k')) {
    return {
      aspectRatios: COMPATIBLE_ASPECT_RATIO_OPTIONS,
      resolutions: FULL_RESOLUTIONS.filter((item) => item.value === '2K'),
      defaultResolution: '2K',
      eta: '45s',
      expectedDurationMs: 45000,
    };
  }
  if (
    providerId !== 'comfly'
    && (
      normalizedModelId.includes('hd')
      || normalizedModelId.includes('4k')
    )
  ) {
    return {
      aspectRatios: HD_ASPECT_RATIOS.map((value) => ({ value, label: value })),
      resolutions: FOUR_K_RESOLUTIONS,
      defaultResolution: '4K',
      eta: '45s',
      expectedDurationMs: 45000,
    };
  }

  return {
    aspectRatios: COMPATIBLE_ASPECT_RATIO_OPTIONS,
    resolutions: FULL_RESOLUTIONS,
    defaultResolution: '1K',
    eta: '30s',
    expectedDurationMs: 30000,
  };
}

function createProviderCustomStoryboardImageModel(
  providerId: Exclude<StoryboardCustomModelProviderId, 'compatible'>,
  entry: CustomStoryboardModelEntry
): ImageModelDefinition {
  const providerModelId = toStoryboardProviderModelId(providerId, entry.modelId);
  const profile = resolveStoryboardCustomModelProfile(providerId, entry.modelId);

  return {
    id: providerModelId,
    mediaType: 'image',
    displayName: entry.displayName || entry.modelId,
    providerId,
    description: 'Custom storyboard image model configured in Settings.',
    eta: profile.eta,
    expectedDurationMs: profile.expectedDurationMs,
    defaultAspectRatio: '1:1',
    defaultResolution: profile.defaultResolution,
    aspectRatios: profile.aspectRatios,
    resolutions: profile.resolutions,
    resolveRequest: ({ referenceImageCount }) => ({
      requestModel: providerModelId,
      modeLabel: referenceImageCount > 0 ? 'Edit' : 'Generate',
    }),
  };
}

function createCompatibleCustomStoryboardImageModel(
  entry: CustomStoryboardModelEntry,
  compatibleConfig: StoryboardCompatibleModelConfig | null | undefined
): ImageModelDefinition | null {
  const resolvedConfig = resolveStoryboardCompatibleModelConfigForModel(
    toStoryboardProviderModelId(STORYBOARD_COMPATIBLE_PROVIDER_ID, entry.modelId),
    compatibleConfig,
    { [STORYBOARD_COMPATIBLE_PROVIDER_ID]: [entry] }
  );

  const legacyModel = createStoryboardCompatibleImageModel(resolvedConfig);
  if (!legacyModel) {
    return null;
  }

  const providerModelId = toStoryboardProviderModelId(STORYBOARD_COMPATIBLE_PROVIDER_ID, entry.modelId);

  return {
    ...legacyModel,
    id: providerModelId,
    displayName: entry.displayName || entry.modelId,
    resolveRequest: ({ referenceImageCount }) => ({
      requestModel: providerModelId,
      modeLabel: resolveStoryboardCompatibleModeLabel(
        resolvedConfig.apiFormat,
        referenceImageCount
      ),
    }),
  };
}

function createNewApiCustomStoryboardImageModel(
  entry: CustomStoryboardModelEntry,
  newApiConfig: StoryboardNewApiModelConfig | null | undefined
): ImageModelDefinition | null {
  const resolvedConfig = resolveStoryboardNewApiModelConfigForModel(
    toStoryboardProviderModelId(STORYBOARD_NEWAPI_PROVIDER_ID, entry.modelId),
    newApiConfig,
    { [STORYBOARD_NEWAPI_PROVIDER_ID]: [entry] }
  );

  const legacyModel = createStoryboardNewApiImageModel(resolvedConfig);
  if (!legacyModel) {
    return null;
  }

  const providerModelId = toStoryboardProviderModelId(
    STORYBOARD_NEWAPI_PROVIDER_ID,
    entry.modelId
  );

  return {
    ...legacyModel,
    id: providerModelId,
    displayName: entry.displayName || entry.modelId,
    resolveRequest: ({ referenceImageCount }) => ({
      requestModel: providerModelId,
      modeLabel: resolveStoryboardNewApiModeLabel(
        resolvedConfig.apiFormat,
        referenceImageCount
      ),
    }),
  };
}

function createApi2OkCustomStoryboardImageModel(
  entry: CustomStoryboardModelEntry,
  api2OkConfig: StoryboardApi2OkModelConfig | null | undefined
): ImageModelDefinition | null {
  const resolvedConfig = resolveStoryboardApi2OkModelConfigForModel(
    toStoryboardProviderModelId(STORYBOARD_API2OK_PROVIDER_ID, entry.modelId),
    api2OkConfig,
    { [STORYBOARD_API2OK_PROVIDER_ID]: [entry] }
  );

  const legacyModel = createStoryboardApi2OkImageModel(resolvedConfig);
  if (!legacyModel) {
    return null;
  }

  const providerModelId = toStoryboardProviderModelId(
    STORYBOARD_API2OK_PROVIDER_ID,
    entry.modelId
  );

  return {
    ...legacyModel,
    id: providerModelId,
    displayName: entry.displayName || entry.modelId,
    resolveRequest: ({ referenceImageCount }) => ({
      requestModel: providerModelId,
      modeLabel: resolveStoryboardApi2OkModeLabel(
        resolvedConfig.apiFormat,
        referenceImageCount
      ),
    }),
  };
}

export function createCustomStoryboardImageModels(
  customModels: Record<string, CustomStoryboardModelEntry[]> | null | undefined,
  compatibleConfig?: StoryboardCompatibleModelConfig | null,
  newApiConfig?: StoryboardNewApiModelConfig | null,
  api2OkConfig?: StoryboardApi2OkModelConfig | null
): ImageModelDefinition[] {
  const normalizedCustomModels = normalizeStoryboardProviderCustomModels(
    customModels,
    compatibleConfig,
    newApiConfig,
    api2OkConfig
  );
  const result: ImageModelDefinition[] = [];
  const seenModelIds = new Set<string>();

  for (const providerId of STORYBOARD_CUSTOM_MODEL_PROVIDER_IDS) {
    for (const entry of getCustomStoryboardModels(providerId, normalizedCustomModels)) {
      const model =
        providerId === STORYBOARD_COMPATIBLE_PROVIDER_ID
          ? createCompatibleCustomStoryboardImageModel(entry, compatibleConfig)
          : providerId === STORYBOARD_NEWAPI_PROVIDER_ID
            ? createNewApiCustomStoryboardImageModel(entry, newApiConfig)
          : providerId === STORYBOARD_API2OK_PROVIDER_ID
            ? createApi2OkCustomStoryboardImageModel(entry, api2OkConfig)
            : createProviderCustomStoryboardImageModel(providerId, entry);

      if (!model) {
        continue;
      }

      if (BUILT_IN_STORYBOARD_MODELS[providerId].some(
        (builtin) => builtin.modelId.toLowerCase() === model.id.toLowerCase()
      )) {
        continue;
      }

      if (seenModelIds.has(model.id.toLowerCase())) {
        continue;
      }
      seenModelIds.add(model.id.toLowerCase());
      result.push(model);
    }
  }

  return result;
}
