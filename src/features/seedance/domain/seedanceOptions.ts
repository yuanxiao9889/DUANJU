import type {
  SeedanceAspectRatio,
  SeedanceDurationSeconds,
  SeedanceInputMode,
  SeedanceModelId,
  SeedanceResolution,
} from '@/features/canvas/domain/canvasNodes';
import {
  SEEDANCE_ASPECT_RATIOS,
  SEEDANCE_DURATION_SECONDS,
  SEEDANCE_INPUT_MODES,
  SEEDANCE_MODEL_IDS,
  SEEDANCE_RESOLUTIONS,
} from '@/features/canvas/domain/canvasNodes';

export interface SeedanceOptionDefinition<T extends string | number> {
  value: T;
  labelKey: string;
  descriptionKey?: string;
}

export const SEEDANCE_MODEL_OPTIONS: SeedanceOptionDefinition<SeedanceModelId>[] = [
  {
    value: 'doubao-seedance-2-0-260128',
    labelKey: 'node.seedance.modelOptions.seedance20',
    descriptionKey: 'node.seedance.modelOptionDescriptions.seedance20',
  },
];

export const SEEDANCE_INPUT_MODE_OPTIONS: SeedanceOptionDefinition<SeedanceInputMode>[] = [
  {
    value: 'textToVideo',
    labelKey: 'node.seedance.inputModes.textToVideo',
  },
  {
    value: 'firstFrame',
    labelKey: 'node.seedance.inputModes.firstFrame',
  },
  {
    value: 'firstLastFrame',
    labelKey: 'node.seedance.inputModes.firstLastFrame',
  },
  {
    value: 'reference',
    labelKey: 'node.seedance.inputModes.reference',
  },
];

export const SEEDANCE_ASPECT_RATIO_OPTIONS: SeedanceOptionDefinition<SeedanceAspectRatio>[] =
  SEEDANCE_ASPECT_RATIOS.map((value) => ({
    value,
    labelKey:
      value === 'adaptive'
        ? 'node.seedance.aspectRatios.adaptive'
        : `node.seedance.aspectRatios.${value}`,
  }));

export const SEEDANCE_DURATION_OPTIONS: SeedanceOptionDefinition<SeedanceDurationSeconds>[] =
  SEEDANCE_DURATION_SECONDS.map((value) => ({
    value,
    labelKey:
      value === -1
        ? 'node.seedance.durations.auto'
        : `node.seedance.durations.${value}`,
  }));

export const SEEDANCE_RESOLUTION_OPTIONS: SeedanceOptionDefinition<SeedanceResolution>[] =
  SEEDANCE_RESOLUTIONS.map((value) => ({
    value,
    labelKey: `node.seedance.resolutionOptions.${value}`,
  }));

const SUPPORTED_SEEDANCE_MODEL_IDS = new Set<SeedanceModelId>(SEEDANCE_MODEL_IDS);
const SUPPORTED_SEEDANCE_INPUT_MODES = new Set<SeedanceInputMode>(SEEDANCE_INPUT_MODES);
const SUPPORTED_SEEDANCE_ASPECT_RATIOS = new Set<SeedanceAspectRatio>(SEEDANCE_ASPECT_RATIOS);
const SUPPORTED_SEEDANCE_DURATION_SECONDS = new Set<SeedanceDurationSeconds>(SEEDANCE_DURATION_SECONDS);
const SUPPORTED_SEEDANCE_RESOLUTIONS = new Set<SeedanceResolution>(SEEDANCE_RESOLUTIONS);

export function normalizeSeedanceModelId(
  modelId: SeedanceModelId | string | null | undefined
): SeedanceModelId {
  return SUPPORTED_SEEDANCE_MODEL_IDS.has(modelId as SeedanceModelId)
    ? (modelId as SeedanceModelId)
    : 'doubao-seedance-2-0-260128';
}

export function normalizeSeedanceInputMode(
  inputMode: SeedanceInputMode | string | null | undefined
): SeedanceInputMode {
  return SUPPORTED_SEEDANCE_INPUT_MODES.has(inputMode as SeedanceInputMode)
    ? (inputMode as SeedanceInputMode)
    : 'textToVideo';
}

export function normalizeSeedanceAspectRatio(
  aspectRatio: SeedanceAspectRatio | string | null | undefined
): SeedanceAspectRatio {
  return SUPPORTED_SEEDANCE_ASPECT_RATIOS.has(aspectRatio as SeedanceAspectRatio)
    ? (aspectRatio as SeedanceAspectRatio)
    : 'adaptive';
}

export function normalizeSeedanceDurationSeconds(
  duration: SeedanceDurationSeconds | number | null | undefined
): SeedanceDurationSeconds {
  return SUPPORTED_SEEDANCE_DURATION_SECONDS.has(duration as SeedanceDurationSeconds)
    ? (duration as SeedanceDurationSeconds)
    : 5;
}

export function normalizeSeedanceResolution(
  resolution: SeedanceResolution | string | null | undefined
): SeedanceResolution {
  return SUPPORTED_SEEDANCE_RESOLUTIONS.has(resolution as SeedanceResolution)
    ? (resolution as SeedanceResolution)
    : '720p';
}
