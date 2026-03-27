import type { ModelProviderDefinition } from './types';
import {
  ALIBABA_TEXT_MODEL_OPTIONS,
  DEFAULT_ALIBABA_TEXT_MODEL,
} from './providers/alibaba';
import {
  CODING_MODEL_OPTIONS,
} from './providers/coding';

export const DEFAULT_BLTCY_TEXT_MODEL = 'gpt-5.4-2026-03-05';
export const DEFAULT_SCRIPT_PROVIDER_ID = 'alibaba';

export const SCRIPT_PROVIDER_IDS = [
  'alibaba',
  'coding',
  'bltcy',
  'volcengine',
  'zhenzhen',
  'comfly',
  'compatible',
] as const;

export type ScriptProviderId = typeof SCRIPT_PROVIDER_IDS[number];

export interface CustomScriptModelEntry {
  id: string;
  modelId: string;
  displayName: string;
}

export interface ScriptModelOption {
  modelId: string;
  label: string;
  source: 'builtin' | 'custom';
  customModelId?: string;
}

export interface ScriptModelSettingsLike {
  apiKeys?: Record<string, string>;
  scriptProviderEnabled?: string;
  scriptModelOverrides?: Record<string, string>;
  scriptProviderCustomModels?: Record<string, CustomScriptModelEntry[]>;
  alibabaTextModel?: string;
  codingModel?: string;
}

const SCRIPT_PROVIDER_ID_SET = new Set<string>(SCRIPT_PROVIDER_IDS);

const BUILT_IN_SCRIPT_MODELS: Record<ScriptProviderId, readonly ScriptModelOption[]> = {
  alibaba: ALIBABA_TEXT_MODEL_OPTIONS.map((option) => ({
    modelId: option.value,
    label: option.label,
    source: 'builtin',
  })),
  coding: CODING_MODEL_OPTIONS
    .filter((option) => option.value !== 'custom')
    .map((option) => ({
      modelId: option.value,
      label: option.label,
      source: 'builtin',
    })),
  bltcy: [
    {
      modelId: DEFAULT_BLTCY_TEXT_MODEL,
      label: 'gpt-5.4',
      source: 'builtin',
    },
  ],
  volcengine: [],
  zhenzhen: [],
  comfly: [],
  compatible: [],
};

function normalizeTrimmedString(input: unknown): string {
  return typeof input === 'string' ? input.trim() : '';
}

function buildCustomScriptModelId(providerId: string, modelId: string): string {
  const normalizedModelId = modelId
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return `${providerId}:${normalizedModelId || 'model'}`;
}

export function isScriptProviderId(value: string | null | undefined): value is ScriptProviderId {
  return SCRIPT_PROVIDER_ID_SET.has((value ?? '').trim());
}

export function listScriptProviders(
  providers: ModelProviderDefinition[]
): ModelProviderDefinition[] {
  return providers.filter((provider) => isScriptProviderId(provider.id));
}

export function getDefaultScriptModelId(providerId: string): string {
  if (!isScriptProviderId(providerId)) {
    return DEFAULT_ALIBABA_TEXT_MODEL;
  }

  return BUILT_IN_SCRIPT_MODELS[providerId][0]?.modelId ?? '';
}

export function normalizeScriptProviderEnabledSelection(
  input: string | null | undefined,
  apiKeys: Record<string, string>
): ScriptProviderId {
  const normalizedInput = normalizeTrimmedString(input);
  if (
    isScriptProviderId(normalizedInput)
    && normalizeTrimmedString(apiKeys[normalizedInput]).length > 0
  ) {
    return normalizedInput;
  }

  const configuredProvider = SCRIPT_PROVIDER_IDS.find(
    (providerId) => normalizeTrimmedString(apiKeys[providerId]).length > 0
  );
  if (configuredProvider) {
    return configuredProvider;
  }

  if (isScriptProviderId(normalizedInput)) {
    return normalizedInput;
  }

  return DEFAULT_SCRIPT_PROVIDER_ID;
}

export function normalizeCustomScriptModelEntries(input: unknown): CustomScriptModelEntry[] {
  if (!Array.isArray(input)) {
    return [];
  }

  const result: CustomScriptModelEntry[] = [];
  const seenModelIds = new Set<string>();

  for (const item of input) {
    const record = item && typeof item === 'object'
      ? item as Record<string, unknown>
      : null;
    const modelId = normalizeTrimmedString(
      record?.modelId ?? record?.value ?? (typeof item === 'string' ? item : '')
    );
    if (!modelId) {
      continue;
    }

    const modelKey = modelId.toLowerCase();
    if (seenModelIds.has(modelKey)) {
      continue;
    }
    seenModelIds.add(modelKey);

    const displayName = normalizeTrimmedString(record?.displayName ?? record?.label) || modelId;
    const providerId = normalizeTrimmedString(record?.providerId);
    const id =
      normalizeTrimmedString(record?.id)
      || buildCustomScriptModelId(providerId || 'script', modelId);

    result.push({
      id,
      modelId,
      displayName,
    });
  }

  return result;
}

export function normalizeScriptProviderCustomModels(
  input: unknown
): Record<string, CustomScriptModelEntry[]> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return {};
  }

  const record = input as Record<string, unknown>;
  const result: Record<string, CustomScriptModelEntry[]> = {};

  for (const providerId of SCRIPT_PROVIDER_IDS) {
    const normalizedEntries = normalizeCustomScriptModelEntries(record[providerId]).map((entry) => ({
      ...entry,
      id: normalizeTrimmedString(entry.id) || buildCustomScriptModelId(providerId, entry.modelId),
    }));
    if (normalizedEntries.length > 0) {
      result[providerId] = normalizedEntries;
    }
  }

  return result;
}

export function getCustomScriptModels(
  providerId: string,
  customModels: Record<string, CustomScriptModelEntry[]> | null | undefined
): CustomScriptModelEntry[] {
  if (!isScriptProviderId(providerId)) {
    return [];
  }

  return normalizeCustomScriptModelEntries(customModels?.[providerId]).map((entry) => ({
    ...entry,
    id: normalizeTrimmedString(entry.id) || buildCustomScriptModelId(providerId, entry.modelId),
  }));
}

export function resolveScriptModelOptions(
  providerId: string,
  customModels: Record<string, CustomScriptModelEntry[]> | null | undefined
): ScriptModelOption[] {
  if (!isScriptProviderId(providerId)) {
    return [];
  }

  const result: ScriptModelOption[] = [];
  const seenModelIds = new Set<string>();

  for (const option of BUILT_IN_SCRIPT_MODELS[providerId]) {
    const modelKey = option.modelId.toLowerCase();
    if (seenModelIds.has(modelKey)) {
      continue;
    }
    seenModelIds.add(modelKey);
    result.push(option);
  }

  for (const entry of getCustomScriptModels(providerId, customModels)) {
    const modelKey = entry.modelId.toLowerCase();
    if (seenModelIds.has(modelKey)) {
      continue;
    }
    seenModelIds.add(modelKey);
    result.push({
      modelId: entry.modelId,
      label: entry.displayName || entry.modelId,
      source: 'custom',
      customModelId: entry.id,
    });
  }

  return result;
}

export function resolveConfiguredScriptModel(
  providerId: string,
  settings: ScriptModelSettingsLike
): string {
  if (!isScriptProviderId(providerId)) {
    return getDefaultScriptModelId(DEFAULT_SCRIPT_PROVIDER_ID);
  }

  const explicitModel = normalizeTrimmedString(settings.scriptModelOverrides?.[providerId]);
  if (explicitModel) {
    return explicitModel;
  }

  if (providerId === 'alibaba') {
    const legacyAlibabaModel = normalizeTrimmedString(settings.alibabaTextModel);
    if (legacyAlibabaModel) {
      return legacyAlibabaModel;
    }
  }

  if (providerId === 'coding') {
    const legacyCodingModel = normalizeTrimmedString(settings.codingModel);
    if (legacyCodingModel) {
      return legacyCodingModel;
    }
  }

  return getDefaultScriptModelId(providerId);
}

export function normalizeScriptModelOverrides(
  input: unknown,
  customModels: Record<string, CustomScriptModelEntry[]>,
  legacyDefaults?: Partial<Record<ScriptProviderId, string>>
): Record<string, string> {
  const record =
    input && typeof input === 'object' && !Array.isArray(input)
      ? input as Record<string, unknown>
      : {};

  return SCRIPT_PROVIDER_IDS.reduce<Record<string, string>>((result, providerId) => {
    const rawModel = normalizeTrimmedString(record[providerId] ?? legacyDefaults?.[providerId]);
    result[providerId] = resolveConfiguredScriptModel(providerId, {
      scriptModelOverrides: rawModel ? { [providerId]: rawModel } : undefined,
      scriptProviderCustomModels: customModels,
      alibabaTextModel: providerId === 'alibaba' ? rawModel : legacyDefaults?.alibaba,
      codingModel: providerId === 'coding' ? rawModel : legacyDefaults?.coding,
    });
    return result;
  }, {});
}

export function resolveConfiguredScriptProvider(
  settings: ScriptModelSettingsLike,
  requestedProvider?: string | null | undefined
): ScriptProviderId {
  const candidateProvider = normalizeTrimmedString(
    requestedProvider ?? settings.scriptProviderEnabled
  );

  if (isScriptProviderId(candidateProvider)) {
    return candidateProvider;
  }

  return normalizeScriptProviderEnabledSelection(
    settings.scriptProviderEnabled,
    settings.apiKeys ?? {}
  );
}

export function resolveActivatedScriptProvider(
  settings: Pick<ScriptModelSettingsLike, 'scriptProviderEnabled'>
): ScriptProviderId | null {
  const activeProvider = normalizeTrimmedString(settings.scriptProviderEnabled);
  return isScriptProviderId(activeProvider) ? activeProvider : null;
}

export function upsertCustomScriptModelEntry(
  providerId: string,
  entries: CustomScriptModelEntry[],
  nextModelId: string,
  nextDisplayName: string
): CustomScriptModelEntry[] {
  const modelId = normalizeTrimmedString(nextModelId);
  if (!isScriptProviderId(providerId) || !modelId) {
    return entries;
  }

  const displayName = normalizeTrimmedString(nextDisplayName) || modelId;
  const nextEntry: CustomScriptModelEntry = {
    id: buildCustomScriptModelId(providerId, modelId),
    modelId,
    displayName,
  };

  return normalizeCustomScriptModelEntries([
    ...entries.filter((entry) => entry.modelId.toLowerCase() !== modelId.toLowerCase()),
    nextEntry,
  ]).map((entry) => ({
    ...entry,
    id: normalizeTrimmedString(entry.id) || buildCustomScriptModelId(providerId, entry.modelId),
  }));
}
