import {
  VIDU_ASPECT_RATIOS,
  VIDU_DURATION_SECONDS,
  VIDU_INPUT_MODES,
  VIDU_MODEL_IDS,
  VIDU_RESOLUTIONS,
  type ViduAspectRatio,
  type ViduDurationSeconds,
  type ViduInputMode,
  type ViduModelId,
  type ViduResolution,
} from '@/features/canvas/domain/canvasNodes';

export const VIDU_REFERENCE_VIDEO_MODEL_ID: ViduModelId = 'viduq2-pro';
export const VIDU_MAX_REFERENCE_IMAGE_COUNT = 7;
export const VIDU_MAX_REFERENCE_VIDEO_COUNT = 2;
export const VIDU_REFERENCE_VIDEO_MAX_BASE64_BYTES = 20 * 1024 * 1024;
export const VIDU_MODEL_IDS_BY_INPUT_MODE: Record<ViduInputMode, readonly ViduModelId[]> = {
  textToVideo: ['viduq3-turbo', 'viduq3-pro', 'viduq2', 'viduq1'],
  firstFrame: [
    'viduq3-turbo',
    'viduq3-pro',
    'viduq3-pro-fast',
    'viduq2-pro-fast',
    'viduq2-pro',
    'viduq2-turbo',
    'viduq1',
    'viduq1-classic',
    'vidu2.0',
  ],
  firstLastFrame: [
    'viduq3-turbo',
    'viduq3-pro',
    'viduq2-pro-fast',
    'viduq2-pro',
    'viduq2-turbo',
    'viduq1',
    'viduq1-classic',
    'vidu2.0',
  ],
  reference: [
    'viduq3-turbo',
    'viduq3-mix',
    'viduq3',
    'viduq2-pro',
    'viduq2',
    'viduq1',
    'vidu2.0',
  ],
};

export const VIDU_INPUT_MODE_OPTIONS = VIDU_INPUT_MODES.map((value) => ({
  value,
  labelKey: `node.vidu.inputModes.${value}`,
}));

export const VIDU_MODEL_OPTIONS = VIDU_MODEL_IDS.map((value) => ({
  value,
  labelKey: `node.vidu.modelOptions.${value}`,
}));

export function getViduModelOptions(inputMode: ViduInputMode | string | null | undefined) {
  const normalizedInputMode = normalizeViduInputMode(inputMode);
  return VIDU_MODEL_IDS_BY_INPUT_MODE[normalizedInputMode].map((value) => ({
    value,
    labelKey: `node.vidu.modelOptions.${value}`,
  }));
}

export function normalizeViduInputMode(
  inputMode: ViduInputMode | string | null | undefined
): ViduInputMode {
  return VIDU_INPUT_MODES.includes(inputMode as ViduInputMode)
    ? (inputMode as ViduInputMode)
    : 'textToVideo';
}

export function normalizeViduModelId(
  modelId: ViduModelId | string | null | undefined
): ViduModelId {
  return VIDU_MODEL_IDS.includes(modelId as ViduModelId)
    ? (modelId as ViduModelId)
    : 'viduq3-turbo';
}

export function normalizeViduModelIdForInputMode(
  modelId: ViduModelId | string | null | undefined,
  inputMode: ViduInputMode | string | null | undefined
): ViduModelId {
  const normalizedInputMode = normalizeViduInputMode(inputMode);
  const supportedModels = VIDU_MODEL_IDS_BY_INPUT_MODE[normalizedInputMode];
  const normalizedModelId = normalizeViduModelId(modelId);
  return supportedModels.includes(normalizedModelId)
    ? normalizedModelId
    : 'viduq3-turbo';
}

export function isViduQ3Model(modelId: ViduModelId | string | null | undefined): boolean {
  return typeof modelId === 'string' && modelId.startsWith('viduq3');
}

export function normalizeViduAspectRatio(
  aspectRatio: ViduAspectRatio | string | null | undefined
): ViduAspectRatio {
  return VIDU_ASPECT_RATIOS.includes(aspectRatio as ViduAspectRatio)
    ? (aspectRatio as ViduAspectRatio)
    : '16:9';
}

export function normalizeViduDurationSeconds(
  duration: ViduDurationSeconds | number | null | undefined
): ViduDurationSeconds {
  return VIDU_DURATION_SECONDS.includes(duration as ViduDurationSeconds)
    ? (duration as ViduDurationSeconds)
    : 5;
}

export function normalizeViduDurationSecondsForRequest(
  duration: ViduDurationSeconds | number | null | undefined,
  modelId: ViduModelId | string | null | undefined,
  inputMode: ViduInputMode | string | null | undefined
): ViduDurationSeconds {
  const normalizedDuration = normalizeViduDurationSeconds(duration);
  const normalizedInputMode = normalizeViduInputMode(inputMode);
  const model = normalizeViduModelId(modelId);

  if (model === 'viduq1' || model === 'viduq1-classic') {
    return 5;
  }

  if (model === 'vidu2.0') {
    return normalizedDuration === 8 ? 8 : 4;
  }

  if (normalizedInputMode === 'reference' && isViduQ3Model(model) && normalizedDuration < 3) {
    return 5;
  }

  if (normalizedInputMode === 'firstLastFrame' && model.startsWith('viduq2') && normalizedDuration > 8) {
    return 8;
  }

  if (model.startsWith('viduq2') && normalizedDuration > 10) {
    return 10;
  }

  return normalizedDuration;
}

export function normalizeViduResolution(
  resolution: ViduResolution | string | null | undefined
): ViduResolution {
  return VIDU_RESOLUTIONS.includes(resolution as ViduResolution)
    ? (resolution as ViduResolution)
    : '720p';
}

export function normalizeViduResolutionForRequest(
  resolution: ViduResolution | string | null | undefined,
  modelId: ViduModelId | string | null | undefined,
  duration: ViduDurationSeconds | number | null | undefined
): ViduResolution {
  const normalizedResolution = normalizeViduResolution(resolution);
  const model = normalizeViduModelId(modelId);
  const normalizedDuration = normalizeViduDurationSeconds(duration);

  if (model === 'viduq1' || model === 'viduq1-classic') {
    return '1080p';
  }

  if (model === 'vidu2.0' && normalizedDuration === 8) {
    return '720p';
  }

  if (
    normalizedResolution === '540p'
    && (model === 'viduq3-pro-fast' || model === 'viduq2-pro-fast')
  ) {
    return '720p';
  }

  return normalizedResolution;
}
