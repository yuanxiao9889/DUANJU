import type {
  MidjourneyAspectRatio,
  MidjourneyVersionPreset,
  MjReferenceItem,
} from '@/features/canvas/domain/canvasNodes';

const RESERVED_ADVANCED_PARAMS = ['ar', 'raw', 'v', 'sref'] as const;
const RESERVED_PARAM_PATTERN = /(^|\s)--(ar|raw|v|sref)(?=\s|$)/gi;

export interface MidjourneyPromptBuildOptions {
  prompt: string;
  aspectRatio?: MidjourneyAspectRatio | string | null;
  rawMode?: boolean;
  versionPreset?: MidjourneyVersionPreset | string | null;
  advancedParams?: string | null;
  styleReferenceUrls?: string[];
}

export interface MidjourneyPromptValidationResult {
  valid: boolean;
  duplicatedReservedParams: string[];
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

  const advancedParams = options.advancedParams?.trim() ?? '';
  if (advancedParams) {
    fragments.push(advancedParams);
  }

  return fragments.join(' ').trim();
}
