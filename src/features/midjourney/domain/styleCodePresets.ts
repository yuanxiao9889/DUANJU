export interface MjStyleCodePreset {
  id: string;
  name: string;
  code: string;
  imageUrl: string | null;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
  lastUsedAt: number | null;
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

const MJ_PERSONALIZATION_CODE_INPUT_SPLIT_PATTERN = /[\n,，]+/;
const MJ_PERSONALIZATION_FLAG_PATTERN = /^--p(?=\s|$)/i;
const MJ_PERSONALIZATION_REPEATED_FLAG_PATTERN = /^(?:--p(?=\s|$)\s+\S+\s*)+$/i;

function normalizeMjPersonalizationCodeWhitespace(
  value: string | null | undefined
): string {
  return (value ?? '')
    .replace(/\r\n?/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripLeadingMjPersonalizationFlags(value: string): string {
  return value.replace(/^(?:(?:--p)(?=\s|$)\s*)+/i, '').trim();
}

export function normalizeMjPersonalizationCode(
  value: string | null | undefined
): string {
  const normalized = normalizeMjPersonalizationCodeWhitespace(value);
  if (!normalized) {
    return '';
  }

  if (!MJ_PERSONALIZATION_FLAG_PATTERN.test(normalized)) {
    return normalized;
  }

  const strippedValue = stripLeadingMjPersonalizationFlags(normalized);
  return strippedValue ? `--p ${strippedValue}` : '';
}

export function normalizeMjPersonalizationCodeIdentity(
  value: string | null | undefined
): string {
  const normalized = normalizeMjPersonalizationCode(value);
  if (!normalized) {
    return '';
  }

  return MJ_PERSONALIZATION_FLAG_PATTERN.test(normalized)
    ? stripLeadingMjPersonalizationFlags(normalized)
    : normalized;
}

export function resolveMjPersonalizationPromptFragment(
  value: string | null | undefined
): string {
  const normalized = normalizeMjPersonalizationCode(value);
  if (!normalized) {
    return '';
  }

  return MJ_PERSONALIZATION_FLAG_PATTERN.test(normalized)
    ? normalized
    : `--p ${normalized}`;
}

export function parseMjPersonalizationCodeInput(
  value: string | null | undefined
): string[] {
  const normalizedInput = (value ?? '').replace(/\r\n?/g, '\n');
  const parsedCodes = normalizedInput
    .split(MJ_PERSONALIZATION_CODE_INPUT_SPLIT_PATTERN)
    .flatMap((item) => {
      const normalizedItem = normalizeMjPersonalizationCodeWhitespace(item);
      if (!normalizedItem) {
        return [];
      }

      if (MJ_PERSONALIZATION_REPEATED_FLAG_PATTERN.test(normalizedItem)) {
        return normalizedItem.match(/--p(?=\s|$)\s+\S+/gi) ?? [];
      }

      return [normalizedItem];
    });

  return normalizeMjPersonalizationCodes(parsedCodes);
}

export function formatMjPersonalizationCodeInput(
  value: string[] | null | undefined
): string {
  return normalizeMjPersonalizationCodes(value ?? []).join(', ');
}

export function normalizeMjPersonalizationCodes(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const normalizedCodes: string[] = [];
  const seen = new Set<string>();

  for (const item of value) {
    const code = normalizeMjPersonalizationCode(
      typeof item === 'string' ? item : ''
    );
    const identity = normalizeMjPersonalizationCodeIdentity(code);
    if (!code || !identity || seen.has(identity)) {
      continue;
    }

    seen.add(identity);
    normalizedCodes.push(code);
  }

  return normalizedCodes;
}

export function sortMjStyleCodePresets(
  presets: MjStyleCodePreset[]
): MjStyleCodePreset[] {
  return [...presets].sort((left, right) => {
    if (left.sortOrder !== right.sortOrder) {
      return left.sortOrder - right.sortOrder;
    }

    if (left.updatedAt !== right.updatedAt) {
      return left.updatedAt - right.updatedAt;
    }

    return left.createdAt - right.createdAt;
  });
}

export function sortMjStyleCodePresetsByUsage(
  presets: MjStyleCodePreset[]
): MjStyleCodePreset[] {
  return [...presets].sort((left, right) => {
    const leftLastUsedAt = left.lastUsedAt ?? 0;
    const rightLastUsedAt = right.lastUsedAt ?? 0;
    if (leftLastUsedAt !== rightLastUsedAt) {
      return rightLastUsedAt - leftLastUsedAt;
    }

    if (left.sortOrder !== right.sortOrder) {
      return left.sortOrder - right.sortOrder;
    }

    if (left.updatedAt !== right.updatedAt) {
      return left.updatedAt - right.updatedAt;
    }

    return left.createdAt - right.createdAt;
  });
}

export function normalizeMjStyleCodePresets(value: unknown): MjStyleCodePreset[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const seenIds = new Set<string>();
  const seenCodes = new Set<string>();

  return sortMjStyleCodePresets(
    value
      .map((item, index) => {
        if (!item || typeof item !== 'object') {
          return null;
        }

        const candidate = item as Partial<MjStyleCodePreset>;
        const id = normalizeText(candidate.id);
        const code = normalizeMjPersonalizationCode(candidate.code);
        const codeIdentity = normalizeMjPersonalizationCodeIdentity(code);
        const name = normalizeText(candidate.name) || code;
        const imageUrl = normalizeText(candidate.imageUrl) || null;

        if (!id || !code || !codeIdentity || seenIds.has(id) || seenCodes.has(codeIdentity)) {
          return null;
        }

        seenIds.add(id);
        seenCodes.add(codeIdentity);

        const createdAt =
          typeof candidate.createdAt === 'number' &&
          Number.isFinite(candidate.createdAt)
            ? candidate.createdAt
            : Date.now() + index;
        const updatedAt =
          typeof candidate.updatedAt === 'number' &&
          Number.isFinite(candidate.updatedAt)
            ? candidate.updatedAt
            : createdAt;
        const sortOrder =
          typeof candidate.sortOrder === 'number' &&
          Number.isFinite(candidate.sortOrder)
            ? candidate.sortOrder
            : index;
        const lastUsedAt =
          typeof candidate.lastUsedAt === 'number' &&
          Number.isFinite(candidate.lastUsedAt)
            ? candidate.lastUsedAt
            : null;

        return {
          id,
          name,
          code,
          imageUrl,
          sortOrder,
          createdAt,
          updatedAt,
          lastUsedAt,
        } satisfies MjStyleCodePreset;
      })
      .filter((item): item is MjStyleCodePreset => item !== null)
  );
}
