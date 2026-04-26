import {
  getModelProvider,
  listModelProviders,
  type ModelProviderDefinition,
} from '@/features/canvas/models';

export const MJ_PROVIDER_IDS = ['zhenzhen', 'comfly', 'bltcy'] as const;

export type MidjourneyProviderId = (typeof MJ_PROVIDER_IDS)[number];
type ProviderApiKeyMap = Record<string, string>;

const MJ_PROVIDER_ID_SET = new Set<string>(MJ_PROVIDER_IDS);

export function isMidjourneyProviderId(
  value: string | null | undefined
): value is MidjourneyProviderId {
  return MJ_PROVIDER_ID_SET.has((value ?? '').trim());
}

export function normalizeMidjourneyProviderId(
  value: string | null | undefined
): MidjourneyProviderId {
  const normalizedValue = (value ?? '').trim();
  return isMidjourneyProviderId(normalizedValue) ? normalizedValue : 'comfly';
}

export function listMidjourneyProviders(
  providers: ModelProviderDefinition[] = listModelProviders()
): ModelProviderDefinition[] {
  return providers.filter((provider) => isMidjourneyProviderId(provider.id));
}

export function normalizeMidjourneyProviderEnabledSelection(
  providerId: string | null | undefined,
  apiKeys: ProviderApiKeyMap
): MidjourneyProviderId {
  const normalizedProviderId = (providerId ?? '').trim();
  if (isMidjourneyProviderId(normalizedProviderId)) {
    return normalizedProviderId;
  }

  const firstConfiguredProvider = MJ_PROVIDER_IDS.find((candidate) => {
    return (apiKeys[candidate] ?? '').trim().length > 0;
  });

  return firstConfiguredProvider ?? 'comfly';
}

export function getMidjourneyProviderDefinition(
  providerId: MidjourneyProviderId | string | null | undefined
): ModelProviderDefinition {
  return getModelProvider(normalizeMidjourneyProviderId(providerId));
}

export function resolveMidjourneyProviderLabel(
  providerId: MidjourneyProviderId | string | null | undefined,
  language: string
): string {
  const provider = getMidjourneyProviderDefinition(providerId);
  return language.startsWith('zh') ? provider.label : provider.name;
}
