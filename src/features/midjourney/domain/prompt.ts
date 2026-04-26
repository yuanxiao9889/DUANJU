import type {
  MidjourneyAspectRatio,
  MidjourneyVersionPreset,
  MjReferenceItem,
} from '@/features/canvas/domain/canvasNodes';
import {
  normalizeMjPersonalizationCodes,
  resolveMjPersonalizationPromptFragment,
} from '@/features/midjourney/domain/styleCodePresets';

const RESERVED_ADVANCED_PARAMS = ['ar', 'raw', 'v', 'sref', 'p'] as const;
const RESERVED_PARAM_PATTERN = /(^|\s)--(ar|raw|v|sref|p)(?=\s|$)/gi;
const ADVANCED_PARAM_TOKEN_PATTERN = /"[^"]*"|'[^']*'|\S+/g;

export const MIDJOURNEY_ADVANCED_PARAM_RANGES = {
  stylize: {
    min: 0,
    max: 1000,
    step: 50,
  },
  chaos: {
    min: 0,
    max: 100,
    step: 5,
  },
  weird: {
    min: 0,
    max: 3000,
    step: 5,
  },
} as const;

export interface MidjourneyPromptBuildOptions {
  prompt: string;
  aspectRatio?: MidjourneyAspectRatio | string | null;
  rawMode?: boolean;
  versionPreset?: MidjourneyVersionPreset | string | null;
  advancedParams?: string | null;
  styleReferenceUrls?: string[];
  personalizationCodes?: string[];
}

export interface MidjourneyPromptValidationResult {
  valid: boolean;
  duplicatedReservedParams: string[];
}

export interface MidjourneyAdvancedParamsDraft {
  stylize: number;
  chaos: number;
  weird: number;
  preservedSeed: string | null;
  passthroughTokens: string[];
}

function clampToRange(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeRangeValue(
  rawValue: number,
  range: { min: number; max: number; step: number }
): number {
  if (!Number.isFinite(rawValue)) {
    return range.min;
  }

  const clamped = clampToRange(rawValue, range.min, range.max);
  return Math.round(clamped / range.step) * range.step;
}

function parseAdvancedParamToken(token: string): {
  flagName: string | null;
  inlineValue: string | null;
} {
  if (!token.startsWith('--')) {
    return {
      flagName: null,
      inlineValue: null,
    };
  }

  const body = token.slice(2);
  const separatorIndex = body.indexOf('=');
  if (separatorIndex < 0) {
    return {
      flagName: body.trim().toLowerCase() || null,
      inlineValue: null,
    };
  }

  const flagName = body.slice(0, separatorIndex).trim().toLowerCase();
  const inlineValue = body.slice(separatorIndex + 1).trim();
  return {
    flagName: flagName || null,
    inlineValue: inlineValue || null,
  };
}

function normalizeFlagValue(
  inlineValue: string | null,
  trailingValue: string | null
): string | null {
  const resolvedValue = inlineValue ?? trailingValue;
  if (typeof resolvedValue !== 'string') {
    return null;
  }

  const normalized = resolvedValue.trim();
  return normalized.length > 0 ? normalized : null;
}

function serializeFlag(flagName: string, value: string | null): string {
  return value ? `--${flagName} ${value}` : `--${flagName}`;
}

export function parseMidjourneyAdvancedParams(
  advancedParams: string | null | undefined
): MidjourneyAdvancedParamsDraft {
  const tokens = (advancedParams?.trim().match(ADVANCED_PARAM_TOKEN_PATTERN) ?? [])
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
  const draft: MidjourneyAdvancedParamsDraft = {
    stylize: MIDJOURNEY_ADVANCED_PARAM_RANGES.stylize.min,
    chaos: MIDJOURNEY_ADVANCED_PARAM_RANGES.chaos.min,
    weird: MIDJOURNEY_ADVANCED_PARAM_RANGES.weird.min,
    preservedSeed: null,
    passthroughTokens: [],
  };

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const nextToken = tokens[index + 1] ?? null;
    const hasTrailingValue = Boolean(nextToken && !nextToken.startsWith('--'));
    const { flagName, inlineValue } = parseAdvancedParamToken(token);

    if (!flagName) {
      draft.passthroughTokens.push(token);
      continue;
    }

    const normalizedValue = normalizeFlagValue(
      inlineValue,
      hasTrailingValue ? nextToken : null
    );

    const consumeTrailingValue = () => {
      if (hasTrailingValue) {
        index += 1;
      }
    };

    if (flagName === 'stylize' || flagName === 'chaos' || flagName === 'weird') {
      const numericValue = normalizedValue ? Number.parseFloat(normalizedValue) : Number.NaN;
      if (Number.isFinite(numericValue)) {
        draft[flagName] = normalizeRangeValue(
          numericValue,
          MIDJOURNEY_ADVANCED_PARAM_RANGES[flagName]
        );
        consumeTrailingValue();
        continue;
      }
    }

    if (flagName === 'seed') {
      draft.preservedSeed = serializeFlag(flagName, normalizedValue);
      consumeTrailingValue();
      continue;
    }

    draft.passthroughTokens.push(serializeFlag(flagName, normalizedValue));
    consumeTrailingValue();
  }

  return draft;
}

export function buildMidjourneyAdvancedParams(
  draft: MidjourneyAdvancedParamsDraft
): string {
  const tokens: string[] = [];

  if (draft.stylize > MIDJOURNEY_ADVANCED_PARAM_RANGES.stylize.min) {
    tokens.push(`--stylize ${draft.stylize}`);
  }

  if (draft.chaos > MIDJOURNEY_ADVANCED_PARAM_RANGES.chaos.min) {
    tokens.push(`--chaos ${draft.chaos}`);
  }

  if (draft.weird > MIDJOURNEY_ADVANCED_PARAM_RANGES.weird.min) {
    tokens.push(`--weird ${draft.weird}`);
  }

  const preservedSeed = draft.preservedSeed?.trim() ?? '';
  if (preservedSeed) {
    tokens.push(preservedSeed);
  }

  const passthroughTokens = draft.passthroughTokens
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
  if (passthroughTokens.length > 0) {
    tokens.push(...passthroughTokens);
  }

  return tokens.join(' ').trim();
}

export function partitionMjReferences(references: MjReferenceItem[]): {
  referenceImages: string[];
  styleReferenceImages: string[];
} {
  const referenceImages: string[] = [];
  const styleReferenceImages: string[] = [];

  for (const reference of references) {
    const imageUrl = reference.imageUrl.trim();
    if (!imageUrl) {
      continue;
    }

    if (reference.role === 'styleReference') {
      styleReferenceImages.push(imageUrl);
      continue;
    }

    referenceImages.push(imageUrl);
  }

  return {
    referenceImages,
    styleReferenceImages,
  };
}

export function validateMidjourneyAdvancedParams(
  advancedParams: string | null | undefined
): MidjourneyPromptValidationResult {
  const duplicatedReservedParams = new Set<string>();
  const normalized = advancedParams?.trim() ?? '';

  if (!normalized) {
    return {
      valid: true,
      duplicatedReservedParams: [],
    };
  }

  let match: RegExpExecArray | null;
  while ((match = RESERVED_PARAM_PATTERN.exec(normalized)) !== null) {
    const paramName = match[2]?.trim().toLowerCase() ?? '';
    if (RESERVED_ADVANCED_PARAMS.includes(paramName as typeof RESERVED_ADVANCED_PARAMS[number])) {
      duplicatedReservedParams.add(`--${paramName}`);
    }
  }

  return {
    valid: duplicatedReservedParams.size === 0,
    duplicatedReservedParams: Array.from(duplicatedReservedParams),
  };
}

export function buildMidjourneyFinalPrompt(options: MidjourneyPromptBuildOptions): string {
  const prompt = options.prompt.trim();
  const fragments = [prompt].filter(Boolean);
  const styleReferenceUrls = (options.styleReferenceUrls ?? [])
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  const personalizationCodes = normalizeMjPersonalizationCodes(
    options.personalizationCodes ?? []
  );

  if (options.aspectRatio?.trim()) {
    fragments.push(`--ar ${options.aspectRatio.trim()}`);
  }

  if (options.rawMode) {
    fragments.push('--raw');
  }

  if (options.versionPreset?.trim()) {
    fragments.push(`--v ${options.versionPreset.trim()}`);
  }

  if (styleReferenceUrls.length > 0) {
    fragments.push(`--sref ${styleReferenceUrls.join(' ')}`);
  }

  personalizationCodes.forEach((code) => {
    const fragment = resolveMjPersonalizationPromptFragment(code);
    if (fragment) {
      fragments.push(fragment);
    }
  });

  const advancedParams = options.advancedParams?.trim() ?? '';
  if (advancedParams) {
    fragments.push(advancedParams);
  }

  return fragments.join(' ').trim();
}
