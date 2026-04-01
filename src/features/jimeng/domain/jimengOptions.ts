import type {
  JimengAspectRatio,
  JimengDurationSeconds,
  JimengImageModelVersion,
  JimengImageResolutionType,
  JimengReferenceMode,
  JimengVideoModelId,
  JimengVideoResolution,
} from "@/features/canvas/domain/canvasNodes";
import { JIMENG_DURATION_SECONDS } from "@/features/canvas/domain/canvasNodes";

export interface JimengOptionDefinition<T extends string | number> {
  value: T;
  labelKey: string;
  descriptionKey?: string;
}

export const JIMENG_IMAGE_MODEL_OPTIONS: JimengOptionDefinition<JimengImageModelVersion>[] =
  [
    { value: "3.0", labelKey: "node.jimengImage.modelOptions.v3_0" },
    { value: "3.1", labelKey: "node.jimengImage.modelOptions.v3_1" },
    { value: "4.0", labelKey: "node.jimengImage.modelOptions.v4_0" },
    { value: "4.1", labelKey: "node.jimengImage.modelOptions.v4_1" },
    { value: "4.5", labelKey: "node.jimengImage.modelOptions.v4_5" },
    { value: "4.6", labelKey: "node.jimengImage.modelOptions.v4_6" },
    { value: "5.0", labelKey: "node.jimengImage.modelOptions.v5_0" },
    { value: "lab", labelKey: "node.jimengImage.modelOptions.lab" },
  ];

export const JIMENG_IMAGE_RESOLUTION_OPTIONS: JimengOptionDefinition<JimengImageResolutionType>[] =
  [
    { value: "1k", labelKey: "node.jimengImage.resolutionOptions.1k" },
    { value: "2k", labelKey: "node.jimengImage.resolutionOptions.2k" },
    { value: "4k", labelKey: "node.jimengImage.resolutionOptions.4k" },
  ];

export const JIMENG_VIDEO_MODEL_OPTIONS: JimengOptionDefinition<JimengVideoModelId>[] =
  [
    {
      value: "seedance2.0fast",
      labelKey: "node.jimeng.modelOptions.seedance20fast",
      descriptionKey: "node.jimeng.modelOptionDescriptions.seedance20fast",
    },
    {
      value: "seedance2.0",
      labelKey: "node.jimeng.modelOptions.seedance20",
      descriptionKey: "node.jimeng.modelOptionDescriptions.seedance20",
    },
  ];

export const JIMENG_REFERENCE_MODE_OPTIONS: JimengOptionDefinition<JimengReferenceMode>[] =
  [
    { value: "allAround", labelKey: "node.jimeng.referenceModes.allAround" },
    {
      value: "firstLastFrame",
      labelKey: "node.jimeng.referenceModes.firstLastFrame",
    },
  ];

export const JIMENG_ASPECT_RATIO_OPTIONS: JimengOptionDefinition<JimengAspectRatio>[] =
  [
    { value: "21:9", labelKey: "node.jimeng.aspectRatios.21:9" },
    { value: "16:9", labelKey: "node.jimeng.aspectRatios.16:9" },
    { value: "4:3", labelKey: "node.jimeng.aspectRatios.4:3" },
    { value: "1:1", labelKey: "node.jimeng.aspectRatios.1:1" },
    { value: "3:4", labelKey: "node.jimeng.aspectRatios.3:4" },
    { value: "9:16", labelKey: "node.jimeng.aspectRatios.9:16" },
  ];

export const JIMENG_DURATION_OPTIONS: JimengOptionDefinition<JimengDurationSeconds>[] =
  JIMENG_DURATION_SECONDS.map((value) => ({
    value,
    labelKey: `node.jimeng.durations.${value}`,
  }));

export const JIMENG_VIDEO_RESOLUTION_OPTIONS: JimengOptionDefinition<JimengVideoResolution>[] =
  [
    { value: "720p", labelKey: "node.jimeng.videoResolutionOptions.720p" },
    { value: "1080p", labelKey: "node.jimeng.videoResolutionOptions.1080p" },
  ];

const JIMENG_IMAGE_REFERENCE_UNSUPPORTED_MODELS =
  new Set<JimengImageModelVersion>(["3.0", "3.1"]);
const JIMENG_IMAGE_UP_TO_TWO_K_MODELS = new Set<JimengImageModelVersion>([
  "3.0",
  "3.1",
]);
const JIMENG_VIDEO_EXACT_TWO_IMAGE_MODES = new Set<JimengReferenceMode>([
  "firstLastFrame",
]);
const JIMENG_SUPPORTED_VIDEO_MODELS = new Set<JimengVideoModelId>(
  JIMENG_VIDEO_MODEL_OPTIONS.map((option) => option.value),
);
const JIMENG_SUPPORTED_REFERENCE_MODES = new Set<JimengReferenceMode>(
  JIMENG_REFERENCE_MODE_OPTIONS.map((option) => option.value),
);

export function jimengImageModelUsesFourGridDisplay(
  model: JimengImageModelVersion | null | undefined,
): boolean {
  return Boolean(model && JIMENG_IMAGE_REFERENCE_UNSUPPORTED_MODELS.has(model));
}

export function jimengImageModelSupportsReferenceImages(
  model: JimengImageModelVersion | null | undefined,
): boolean {
  return !model || !JIMENG_IMAGE_REFERENCE_UNSUPPORTED_MODELS.has(model);
}

export function resolveJimengImageResolutionOptionsForModel(
  model: JimengImageModelVersion | null | undefined,
): JimengOptionDefinition<JimengImageResolutionType>[] {
  if (model && JIMENG_IMAGE_UP_TO_TWO_K_MODELS.has(model)) {
    return JIMENG_IMAGE_RESOLUTION_OPTIONS.filter(
      (option) => option.value === "1k" || option.value === "2k",
    );
  }

  return JIMENG_IMAGE_RESOLUTION_OPTIONS;
}

export function normalizeJimengImageResolutionForModel(
  model: JimengImageModelVersion | null | undefined,
  resolution: JimengImageResolutionType | null | undefined,
): JimengImageResolutionType {
  if (model && JIMENG_IMAGE_UP_TO_TWO_K_MODELS.has(model)) {
    return resolution === "1k" || resolution === "2k" ? resolution : "2k";
  }

  if (
    resolution &&
    JIMENG_IMAGE_RESOLUTION_OPTIONS.some(
      (option) => option.value === resolution,
    )
  ) {
    return resolution;
  }

  return "2k";
}

export function resolveJimengVideoRequiredReferenceImageCount(
  mode: JimengReferenceMode | null | undefined,
): number | null {
  if (!mode || !JIMENG_VIDEO_EXACT_TWO_IMAGE_MODES.has(mode)) {
    return null;
  }

  return 2;
}

export function normalizeJimengVideoModel(
  model: JimengVideoModelId | string | null | undefined,
): JimengVideoModelId {
  return model && JIMENG_SUPPORTED_VIDEO_MODELS.has(model as JimengVideoModelId)
    ? (model as JimengVideoModelId)
    : "seedance2.0";
}

export function normalizeJimengReferenceMode(
  mode: JimengReferenceMode | string | null | undefined,
): JimengReferenceMode {
  return mode &&
    JIMENG_SUPPORTED_REFERENCE_MODES.has(mode as JimengReferenceMode)
    ? (mode as JimengReferenceMode)
    : "allAround";
}
