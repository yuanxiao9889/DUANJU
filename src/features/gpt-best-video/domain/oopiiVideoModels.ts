import type { GptBestVideoSourceKind } from '@/features/canvas/domain/canvasNodes';

export const OOPII_VIDEO_PROVIDER_ID = 'oopii' as const;
export type OopiiVideoProviderId = typeof OOPII_VIDEO_PROVIDER_ID;

export const OOPII_VIDEO_MODEL_IDS = [
  'OK-video',
] as const;

export type OopiiVideoModelId = (typeof OOPII_VIDEO_MODEL_IDS)[number];

export const OOPII_VIDEO_SIZE_OPTIONS = [
  '720x1280',
  '1280x720',
  '1024x1024',
  '1024x1792',
  '1792x1024',
] as const;

export type OopiiVideoSizeOption = (typeof OOPII_VIDEO_SIZE_OPTIONS)[number];

export const OOPII_VIDEO_ASPECT_RATIO_OPTIONS = [
  '16:9',
  '9:16',
  '1:1',
] as const;

export type OopiiVideoAspectRatioOption = (typeof OOPII_VIDEO_ASPECT_RATIO_OPTIONS)[number];

export const OOPII_VIDEO_RESOLUTION_OPTIONS = [
  '720p',
] as const;

export type OopiiVideoResolutionOption = (typeof OOPII_VIDEO_RESOLUTION_OPTIONS)[number];

export const OOPII_VIDEO_SECONDS_OPTIONS = [6, 10] as const;
export type OopiiVideoSecondsOption = (typeof OOPII_VIDEO_SECONDS_OPTIONS)[number];

const DEFAULT_MODEL_BY_SOURCE_KIND: Record<GptBestVideoSourceKind, OopiiVideoModelId> = {
  grok: 'OK-video',
  seedance: 'OK-video',
};

const DEFAULT_SIZE_BY_SOURCE_KIND: Record<GptBestVideoSourceKind, OopiiVideoSizeOption> = {
  grok: '1280x720',
  seedance: '1280x720',
};

const OOPII_VIDEO_MODEL_ID_SET = new Set<string>(OOPII_VIDEO_MODEL_IDS);
const OOPII_VIDEO_SIZE_SET = new Set<string>(OOPII_VIDEO_SIZE_OPTIONS);
const OOPII_VIDEO_ASPECT_RATIO_SET = new Set<string>(OOPII_VIDEO_ASPECT_RATIO_OPTIONS);
const OOPII_VIDEO_RESOLUTION_SET = new Set<string>(OOPII_VIDEO_RESOLUTION_OPTIONS);

export function isOopiiVideoModelId(value: string | null | undefined): value is OopiiVideoModelId {
  return OOPII_VIDEO_MODEL_ID_SET.has((value ?? '').trim());
}

export function isOopiiVideoSizeOption(
  value: string | null | undefined
): value is OopiiVideoSizeOption {
  return OOPII_VIDEO_SIZE_SET.has((value ?? '').trim());
}

export function isOopiiVideoAspectRatioOption(
  value: string | null | undefined
): value is OopiiVideoAspectRatioOption {
  return OOPII_VIDEO_ASPECT_RATIO_SET.has((value ?? '').trim());
}

export function isOopiiVideoResolutionOption(
  value: string | null | undefined
): value is OopiiVideoResolutionOption {
  return OOPII_VIDEO_RESOLUTION_SET.has((value ?? '').trim().toLowerCase());
}

export function normalizeOopiiVideoModelId(
  sourceKind: GptBestVideoSourceKind,
  modelId: string | null | undefined
): OopiiVideoModelId {
  const normalizedModelId = modelId?.trim() ?? '';
  if (isOopiiVideoModelId(normalizedModelId)) {
    return normalizedModelId;
  }

  return DEFAULT_MODEL_BY_SOURCE_KIND[sourceKind];
}

export function resolveAllowedSecondsForOopiiVideoModel(
  modelId: OopiiVideoModelId
): readonly OopiiVideoSecondsOption[] {
  if (modelId === 'OK-video') {
    return [6, 10];
  }

  return OOPII_VIDEO_SECONDS_OPTIONS;
}

export function normalizeOopiiVideoSeconds(
  modelId: OopiiVideoModelId,
  seconds: number | string | null | undefined
): OopiiVideoSecondsOption {
  const numericValue =
    typeof seconds === 'number'
      ? seconds
      : typeof seconds === 'string'
        ? Number(seconds)
        : NaN;
  const allowedSeconds = resolveAllowedSecondsForOopiiVideoModel(modelId);
  if (allowedSeconds.includes(numericValue as OopiiVideoSecondsOption)) {
    return numericValue as OopiiVideoSecondsOption;
  }

  return allowedSeconds[0];
}

export function normalizeOopiiVideoAspectRatio(
  value: string | null | undefined,
  fallbackSize?: string | null
): OopiiVideoAspectRatioOption {
  const normalizedValue = value?.trim() ?? '';
  if (isOopiiVideoAspectRatioOption(normalizedValue)) {
    return normalizedValue;
  }

  const normalizedFallbackSize = fallbackSize?.trim() ?? '';
  if (normalizedFallbackSize) {
    return resolveAspectRatioFromOopiiVideoSize(normalizedFallbackSize);
  }

  if (normalizedValue === '4:3') {
    return '16:9';
  }
  if (normalizedValue === '3:4') {
    return '9:16';
  }

  return '16:9';
}

export function normalizeOopiiVideoResolution(
  value: string | null | undefined
): OopiiVideoResolutionOption {
  const normalizedValue = value?.trim().toLowerCase() ?? '';
  if (isOopiiVideoResolutionOption(normalizedValue)) {
    return normalizedValue;
  }

  return '720p';
}

export function resolveOopiiVideoSizeFromDisplayOptions(
  aspectRatio: string | null | undefined,
  resolution?: string | null | undefined
): OopiiVideoSizeOption {
  const normalizedAspectRatio = normalizeOopiiVideoAspectRatio(aspectRatio);
  normalizeOopiiVideoResolution(resolution);

  switch (normalizedAspectRatio) {
    case '9:16':
      return '720x1280';
    case '1:1':
      return '1024x1024';
    case '16:9':
    default:
      return '1280x720';
  }
}

export function normalizeOopiiVideoSize(
  sourceKind: GptBestVideoSourceKind,
  input: string | null | undefined,
  legacyAspectRatio?: string | null,
  legacyResolution?: string | null
): OopiiVideoSizeOption {
  const normalizedInput = input?.trim() ?? '';
  if (isOopiiVideoSizeOption(normalizedInput)) {
    return normalizedInput;
  }

  const normalizedLegacyAspectRatio = legacyAspectRatio?.trim() ?? '';
  if (normalizedLegacyAspectRatio === '1:1') {
    return resolveOopiiVideoSizeFromDisplayOptions('1:1', legacyResolution);
  }
  if (normalizedLegacyAspectRatio === '9:16' || normalizedLegacyAspectRatio === '3:4') {
    return resolveOopiiVideoSizeFromDisplayOptions('9:16', legacyResolution);
  }
  if (normalizedLegacyAspectRatio === '16:9' || normalizedLegacyAspectRatio === '4:3') {
    return resolveOopiiVideoSizeFromDisplayOptions('16:9', legacyResolution);
  }

  return DEFAULT_SIZE_BY_SOURCE_KIND[sourceKind];
}

export function resolveAspectRatioFromOopiiVideoSize(
  size: string | null | undefined
): OopiiVideoAspectRatioOption {
  const normalizedSize = size?.trim() ?? '';
  switch (normalizedSize) {
    case '720x1280':
    case '1024x1792':
      return '9:16';
    case '1024x1024':
      return '1:1';
    case '1792x1024':
      return '16:9';
    case '1280x720':
    default:
      return '16:9';
  }
}
