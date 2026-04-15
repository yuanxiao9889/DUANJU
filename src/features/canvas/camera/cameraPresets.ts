import type { CameraParamsSelection } from "@/features/canvas/domain/canvasNodes";

export interface CameraPresetOption {
  id: string;
  labelKey: string;
  fallbackLabel: string;
}

export interface CameraLensPreset extends CameraPresetOption {
  focalLengthsMm: number[];
}

export interface CameraHelpTag {
  key: string;
  fallback: string;
}

export interface CameraHelpImage {
  src: string;
  alt: string;
}

export interface CameraHelpEntry {
  id: string;
  focalLengthMm: number;
  titleKey: string;
  fallbackTitle: string;
  bodyKey: string;
  fallbackBody: string;
  tags: CameraHelpTag[];
  image?: CameraHelpImage | null;
}

export const EMPTY_CAMERA_PARAMS_SELECTION: CameraParamsSelection = {
  cameraBodyId: null,
  lensId: null,
  focalLengthMm: null,
  aperture: null,
};

export const COMMON_CAMERA_FOCAL_LENGTHS = [18, 24, 35, 50, 85, 135] as const;

export const CAMERA_BODY_PRESETS: CameraPresetOption[] = [
  {
    id: "arri-alexa-mini-lf",
    labelKey: "cameraParams.presets.cameraBodies.arriAlexaMiniLf",
    fallbackLabel: "ARRI ALEXA Mini LF",
  },
  {
    id: "arri-alexa-35",
    labelKey: "cameraParams.presets.cameraBodies.arriAlexa35",
    fallbackLabel: "ARRI ALEXA 35",
  },
  {
    id: "sony-venice-2",
    labelKey: "cameraParams.presets.cameraBodies.sonyVenice2",
    fallbackLabel: "Sony VENICE 2",
  },
  {
    id: "canon-c500-mark-ii",
    labelKey: "cameraParams.presets.cameraBodies.canonC500MarkIi",
    fallbackLabel: "Canon EOS C500 Mark II",
  },
  {
    id: "panavision-dxl2",
    labelKey: "cameraParams.presets.cameraBodies.panavisionDxl2",
    fallbackLabel: "Panavision DXL2",
  },
];

export const CAMERA_LENS_PRESETS: CameraLensPreset[] = [
  {
    id: "arri-signature-prime",
    labelKey: "cameraParams.presets.lenses.arriSignaturePrime",
    fallbackLabel: "ARRI Signature Prime",
    focalLengthsMm: [18, 24, 35, 50, 85, 135],
  },
  {
    id: "zeiss-supreme-prime",
    labelKey: "cameraParams.presets.lenses.zeissSupremePrime",
    fallbackLabel: "ZEISS Supreme Prime",
    focalLengthsMm: [18, 24, 35, 50, 85, 135],
  },
  {
    id: "cooke-s4i-prime",
    labelKey: "cameraParams.presets.lenses.cookeS4iPrime",
    fallbackLabel: "Cooke S4/i Prime",
    focalLengthsMm: [18, 25, 32, 40, 50, 75, 100],
  },
  {
    id: "canon-cne-prime",
    labelKey: "cameraParams.presets.lenses.canonCnePrime",
    fallbackLabel: "Canon CN-E Prime",
    focalLengthsMm: [20, 24, 35, 50, 85, 135],
  },
  {
    id: "panavision-primo-70",
    labelKey: "cameraParams.presets.lenses.panavisionPrimo70",
    fallbackLabel: "Panavision Primo 70",
    focalLengthsMm: [24, 35, 50, 80, 100, 135],
  },
];

export const CAMERA_APERTURE_OPTIONS = [
  "f/1.4",
  "f/1.8",
  "f/2",
  "f/2.8",
  "f/4",
  "f/5.6",
  "f/8",
] as const;

export const CAMERA_HELP_ENTRIES: CameraHelpEntry[] = [
  {
    id: "18mm",
    focalLengthMm: 18,
    titleKey: "cameraHelp.entries.18mm.title",
    fallbackTitle: "18mm Ultra Wide",
    bodyKey: "cameraHelp.entries.18mm.body",
    fallbackBody: "Broad space, strong perspective, and deep focus.",
    tags: [
      { key: "cameraHelp.entries.18mm.tags.space", fallback: "Broad space" },
      { key: "cameraHelp.entries.18mm.tags.perspective", fallback: "Strong perspective" },
      { key: "cameraHelp.entries.18mm.tags.focus", fallback: "Deep focus" },
    ],
    image: null,
  },
  {
    id: "24mm",
    focalLengthMm: 24,
    titleKey: "cameraHelp.entries.24mm.title",
    fallbackTitle: "24mm Wide Angle",
    bodyKey: "cameraHelp.entries.24mm.body",
    fallbackBody: "Environmental storytelling, depth, and clearer depth of field.",
    tags: [
      { key: "cameraHelp.entries.24mm.tags.storytelling", fallback: "Environmental storytelling" },
      { key: "cameraHelp.entries.24mm.tags.depth", fallback: "Depth" },
      { key: "cameraHelp.entries.24mm.tags.focus", fallback: "Clearer depth of field" },
    ],
    image: null,
  },
  {
    id: "35mm",
    focalLengthMm: 35,
    titleKey: "cameraHelp.entries.35mm.title",
    fallbackTitle: "35mm Natural Wide",
    bodyKey: "cameraHelp.entries.35mm.body",
    fallbackBody: "Cinematic balance for medium shots and a natural field of view.",
    tags: [
      { key: "cameraHelp.entries.35mm.tags.cinematic", fallback: "Cinematic feel" },
      { key: "cameraHelp.entries.35mm.tags.medium", fallback: "Medium shot" },
      { key: "cameraHelp.entries.35mm.tags.balance", fallback: "Balanced view" },
    ],
    image: null,
  },
  {
    id: "50mm",
    focalLengthMm: 50,
    titleKey: "cameraHelp.entries.50mm.title",
    fallbackTitle: "50mm Normal View",
    bodyKey: "cameraHelp.entries.50mm.body",
    fallbackBody: "Natural proportions and balanced framing.",
    tags: [
      { key: "cameraHelp.entries.50mm.tags.proportion", fallback: "Natural proportions" },
      { key: "cameraHelp.entries.50mm.tags.balance", fallback: "Balanced composition" },
    ],
    image: null,
  },
  {
    id: "85mm",
    focalLengthMm: 85,
    titleKey: "cameraHelp.entries.85mm.title",
    fallbackTitle: "85mm Portrait Telephoto",
    bodyKey: "cameraHelp.entries.85mm.body",
    fallbackBody: "Close-up portraits, compressed backgrounds, shallow depth, and creamy bokeh.",
    tags: [
      { key: "cameraHelp.entries.85mm.tags.closeup", fallback: "Close-up" },
      { key: "cameraHelp.entries.85mm.tags.compression", fallback: "Background compression" },
      { key: "cameraHelp.entries.85mm.tags.bokeh", fallback: "Creamy bokeh" },
    ],
    image: null,
  },
  {
    id: "135mm",
    focalLengthMm: 135,
    titleKey: "cameraHelp.entries.135mm.title",
    fallbackTitle: "135mm Long Telephoto",
    bodyKey: "cameraHelp.entries.135mm.body",
    fallbackBody: "Strong compression, distant shooting, compact framing, and shallow depth.",
    tags: [
      { key: "cameraHelp.entries.135mm.tags.compression", fallback: "Strong compression" },
      { key: "cameraHelp.entries.135mm.tags.distance", fallback: "Long-distance shooting" },
      { key: "cameraHelp.entries.135mm.tags.depth", fallback: "Shallow depth of field" },
    ],
    image: null,
  },
];

export function resolveCameraBodyPreset(
  cameraBodyId: string | null | undefined,
): CameraPresetOption | null {
  if (!cameraBodyId) {
    return null;
  }

  return CAMERA_BODY_PRESETS.find((preset) => preset.id === cameraBodyId) ?? null;
}

export function resolveCameraLensPreset(
  lensId: string | null | undefined,
): CameraLensPreset | null {
  if (!lensId) {
    return null;
  }

  return CAMERA_LENS_PRESETS.find((preset) => preset.id === lensId) ?? null;
}

export function resolveCameraFocalLengthOptions(
  lensId: string | null | undefined,
): number[] {
  const lensPreset = resolveCameraLensPreset(lensId);
  if (lensPreset && lensPreset.focalLengthsMm.length > 0) {
    return [...lensPreset.focalLengthsMm].sort((left, right) => left - right);
  }

  return [...COMMON_CAMERA_FOCAL_LENGTHS];
}

export function normalizeCameraParamsSelection(
  value: Partial<CameraParamsSelection> | null | undefined,
): CameraParamsSelection {
  const normalizedCameraBodyId = resolveCameraBodyPreset(value?.cameraBodyId)?.id ?? null;
  const normalizedLensId = resolveCameraLensPreset(value?.lensId)?.id ?? null;
  const focalLengthOptions = resolveCameraFocalLengthOptions(normalizedLensId);
  const normalizedFocalLength = Number.isFinite(value?.focalLengthMm)
    && focalLengthOptions.includes(Number(value?.focalLengthMm))
      ? Number(value?.focalLengthMm)
      : null;
  const normalizedAperture = typeof value?.aperture === "string"
    && CAMERA_APERTURE_OPTIONS.includes(value.aperture as (typeof CAMERA_APERTURE_OPTIONS)[number])
      ? value.aperture
      : null;

  return {
    cameraBodyId: normalizedCameraBodyId,
    lensId: normalizedLensId,
    focalLengthMm: normalizedFocalLength,
    aperture: normalizedAperture,
  };
}

export function hasCameraParamsSelection(
  value: Partial<CameraParamsSelection> | null | undefined,
): boolean {
  const normalized = normalizeCameraParamsSelection(value);
  return Boolean(
    normalized.cameraBodyId
      || normalized.lensId
      || normalized.focalLengthMm
      || normalized.aperture,
  );
}

export function resolveCameraParamsSummary(
  value: Partial<CameraParamsSelection> | null | undefined,
): string {
  const normalized = normalizeCameraParamsSelection(value);
  const parts: string[] = [];
  const cameraBody = resolveCameraBodyPreset(normalized.cameraBodyId);
  const lens = resolveCameraLensPreset(normalized.lensId);

  if (cameraBody) {
    parts.push(cameraBody.fallbackLabel);
  }
  if (lens) {
    parts.push(lens.fallbackLabel);
  }
  if (normalized.focalLengthMm) {
    parts.push(`${normalized.focalLengthMm}mm`);
  }
  if (normalized.aperture) {
    parts.push(normalized.aperture);
  }

  return parts.join(" / ");
}
