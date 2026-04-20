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

export function normalizeMjPersonalizationCode(
  value: string | null | undefined
): string {
  return (value ?? '')
    .replace(/\r\n?/g, ' ')
    .replace(/(^|\s)--p(?=\s|$)/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
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
    if (!code || seen.has(code)) {
      continue;
    }

    seen.add(code);
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
        const name = normalizeText(candidate.name) || code;
        const imageUrl = normalizeText(candidate.imageUrl) || null;

        if (!id || !code || seenIds.has(id) || seenCodes.has(code)) {
          return null;
        }

        seenIds.add(id);
        seenCodes.add(code);

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
