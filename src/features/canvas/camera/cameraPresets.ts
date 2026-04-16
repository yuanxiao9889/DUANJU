import arriAlexa35Image from "@/assets/camera-presets/bodies/arri-alexa-35.png";
import arriAlexaMiniLfImage from "@/assets/camera-presets/bodies/arri-alexa-mini-lf.png";
import canonEosC500MarkIiImage from "@/assets/camera-presets/bodies/canon-eos-c500-mark-ii.png";
import panavisionDxl2Image from "@/assets/camera-presets/bodies/panavision-dxl2.png";
import sonyVenice2Image from "@/assets/camera-presets/bodies/sony-venice-2.png";
import apertureOverviewImage from "@/assets/camera-help/aperture-overview.png";
import cameraBodyOverviewImage from "@/assets/camera-help/camera-body-overview.png";
import focal135mmHelpImage from "@/assets/camera-help/focal-135mm.png";
import focal18mmHelpImage from "@/assets/camera-help/focal-18mm.png";
import focal24mmHelpImage from "@/assets/camera-help/focal-24mm.png";
import focal35mmHelpImage from "@/assets/camera-help/focal-35mm.png";
import focal50mmHelpImage from "@/assets/camera-help/focal-50mm.png";
import focal85mmHelpImage from "@/assets/camera-help/focal-85mm.png";
import focalOverviewImage from "@/assets/camera-help/focal-overview.png";
import lensOverviewImage from "@/assets/camera-help/lens-overview.png";
import f14Image from "@/assets/camera-presets/apertures/f-1_4.png";
import f18Image from "@/assets/camera-presets/apertures/f-1_8.png";
import f2Image from "@/assets/camera-presets/apertures/f-2.png";
import f28Image from "@/assets/camera-presets/apertures/f-2_8.png";
import f4Image from "@/assets/camera-presets/apertures/f-4.png";
import f56Image from "@/assets/camera-presets/apertures/f-5_6.png";
import f8Image from "@/assets/camera-presets/apertures/f-8.png";
import arriSignaturePrimeImage from "@/assets/camera-presets/lenses/arri-signature-prime.png";
import canonCnEPrimeImage from "@/assets/camera-presets/lenses/canon-cn-e-prime.png";
import cookeS4iPrimeImage from "@/assets/camera-presets/lenses/cooke-s4i-prime.png";
import panavisionPrimo70Image from "@/assets/camera-presets/lenses/panavision-primo-70.png";
import zeissSupremePrimeImage from "@/assets/camera-presets/lenses/zeiss-supreme-prime.png";
import type { CameraParamsSelection } from "@/features/canvas/domain/canvasNodes";

export interface CameraPresetOption {
  id: string;
  labelKey: string;
  fallbackLabel: string;
  imageSrc?: string | null;
}

export interface CameraLensPreset extends CameraPresetOption {
  focalLengthsMm: number[];
}

export type CameraHelpTabId = "focalLength" | "lens" | "aperture" | "cameraBody";

export interface CameraHelpItem {
  id: string;
  titleKey: string;
  fallbackTitle: string;
  imageSrc: string;
  layout?: "hero" | "card";
}

export interface CameraHelpTab {
  id: CameraHelpTabId;
  labelKey: string;
  fallbackLabel: string;
  items: CameraHelpItem[];
}

export interface CameraQuickPreset {
  id: string;
  titleKey: string;
  fallbackTitle: string;
  summaryKey: string;
  fallbackSummary: string;
  selection: CameraParamsSelection;
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
    imageSrc: arriAlexaMiniLfImage,
  },
  {
    id: "arri-alexa-35",
    labelKey: "cameraParams.presets.cameraBodies.arriAlexa35",
    fallbackLabel: "ARRI ALEXA 35",
    imageSrc: arriAlexa35Image,
  },
  {
    id: "sony-venice-2",
    labelKey: "cameraParams.presets.cameraBodies.sonyVenice2",
    fallbackLabel: "Sony VENICE 2",
    imageSrc: sonyVenice2Image,
  },
  {
    id: "canon-c500-mark-ii",
    labelKey: "cameraParams.presets.cameraBodies.canonC500MarkIi",
    fallbackLabel: "Canon EOS C500 Mark II",
    imageSrc: canonEosC500MarkIiImage,
  },
  {
    id: "panavision-dxl2",
    labelKey: "cameraParams.presets.cameraBodies.panavisionDxl2",
    fallbackLabel: "Panavision DXL2",
    imageSrc: panavisionDxl2Image,
  },
];

export const CAMERA_LENS_PRESETS: CameraLensPreset[] = [
  {
    id: "arri-signature-prime",
    labelKey: "cameraParams.presets.lenses.arriSignaturePrime",
    fallbackLabel: "ARRI Signature Prime",
    focalLengthsMm: [18, 24, 35, 50, 85, 135],
    imageSrc: arriSignaturePrimeImage,
  },
  {
    id: "zeiss-supreme-prime",
    labelKey: "cameraParams.presets.lenses.zeissSupremePrime",
    fallbackLabel: "ZEISS Supreme Prime",
    focalLengthsMm: [18, 24, 35, 50, 85, 135],
    imageSrc: zeissSupremePrimeImage,
  },
  {
    id: "cooke-s4i-prime",
    labelKey: "cameraParams.presets.lenses.cookeS4iPrime",
    fallbackLabel: "Cooke S4/i Prime",
    focalLengthsMm: [18, 25, 32, 40, 50, 75, 100],
    imageSrc: cookeS4iPrimeImage,
  },
  {
    id: "canon-cne-prime",
    labelKey: "cameraParams.presets.lenses.canonCnePrime",
    fallbackLabel: "Canon CN-E Prime",
    focalLengthsMm: [20, 24, 35, 50, 85, 135],
    imageSrc: canonCnEPrimeImage,
  },
  {
    id: "panavision-primo-70",
    labelKey: "cameraParams.presets.lenses.panavisionPrimo70",
    fallbackLabel: "Panavision Primo 70",
    focalLengthsMm: [24, 35, 50, 80, 100, 135],
    imageSrc: panavisionPrimo70Image,
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

export const CAMERA_APERTURE_IMAGES: Record<
  (typeof CAMERA_APERTURE_OPTIONS)[number],
  string
> = {
  "f/1.4": f14Image,
  "f/1.8": f18Image,
  "f/2": f2Image,
  "f/2.8": f28Image,
  "f/4": f4Image,
  "f/5.6": f56Image,
  "f/8": f8Image,
};

export const CAMERA_HELP_TABS: CameraHelpTab[] = [
  {
    id: "focalLength",
    labelKey: "cameraHelp.tabs.focalLength",
    fallbackLabel: "Focal Length",
    items: [
      {
        id: "focal-overview",
        titleKey: "cameraHelp.items.focalOverview",
        fallbackTitle: "Focal Length Overview",
        imageSrc: focalOverviewImage,
        layout: "hero",
      },
      {
        id: "18mm",
        titleKey: "cameraHelp.items.18mm",
        fallbackTitle: "18mm Ultra Wide",
        imageSrc: focal18mmHelpImage,
      },
      {
        id: "24mm",
        titleKey: "cameraHelp.items.24mm",
        fallbackTitle: "24mm Wide Angle",
        imageSrc: focal24mmHelpImage,
      },
      {
        id: "35mm",
        titleKey: "cameraHelp.items.35mm",
        fallbackTitle: "35mm Natural Wide",
        imageSrc: focal35mmHelpImage,
      },
      {
        id: "50mm",
        titleKey: "cameraHelp.items.50mm",
        fallbackTitle: "50mm Normal View",
        imageSrc: focal50mmHelpImage,
      },
      {
        id: "85mm",
        titleKey: "cameraHelp.items.85mm",
        fallbackTitle: "85mm Portrait Telephoto",
        imageSrc: focal85mmHelpImage,
      },
      {
        id: "135mm",
        titleKey: "cameraHelp.items.135mm",
        fallbackTitle: "135mm Long Telephoto",
        imageSrc: focal135mmHelpImage,
      },
    ],
  },
  {
    id: "lens",
    labelKey: "cameraHelp.tabs.lens",
    fallbackLabel: "Lens",
    items: [
      {
        id: "lens-overview",
        titleKey: "cameraHelp.items.lensOverview",
        fallbackTitle: "Lens Guide",
        imageSrc: lensOverviewImage,
        layout: "hero",
      },
    ],
  },
  {
    id: "aperture",
    labelKey: "cameraHelp.tabs.aperture",
    fallbackLabel: "Aperture",
    items: [
      {
        id: "aperture-overview",
        titleKey: "cameraHelp.items.apertureOverview",
        fallbackTitle: "Aperture Guide",
        imageSrc: apertureOverviewImage,
        layout: "hero",
      },
    ],
  },
  {
    id: "cameraBody",
    labelKey: "cameraHelp.tabs.cameraBody",
    fallbackLabel: "Camera Body",
    items: [
      {
        id: "camera-body-overview",
        titleKey: "cameraHelp.items.cameraBodyOverview",
        fallbackTitle: "Camera Body Guide",
        imageSrc: cameraBodyOverviewImage,
        layout: "hero",
      },
    ],
  },
];

export const CAMERA_QUICK_PRESETS: CameraQuickPreset[] = [
  {
    id: "portrait-closeup",
    titleKey: "cameraParams.quickPresets.entries.portraitCloseup.title",
    fallbackTitle: "Portrait",
    summaryKey: "cameraParams.quickPresets.entries.portraitCloseup.summary",
    fallbackSummary: "85mm · shallow depth",
    selection: {
      cameraBodyId: "arri-alexa-35",
      lensId: "zeiss-supreme-prime",
      focalLengthMm: 85,
      aperture: "f/1.8",
    },
  },
  {
    id: "environment-wide",
    titleKey: "cameraParams.quickPresets.entries.environmentWide.title",
    fallbackTitle: "Environment",
    summaryKey: "cameraParams.quickPresets.entries.environmentWide.summary",
    fallbackSummary: "24mm · spatial depth",
    selection: {
      cameraBodyId: "arri-alexa-mini-lf",
      lensId: "arri-signature-prime",
      focalLengthMm: 24,
      aperture: "f/4",
    },
  },
  {
    id: "cinematic-medium",
    titleKey: "cameraParams.quickPresets.entries.cinematicMedium.title",
    fallbackTitle: "Medium Shot",
    summaryKey: "cameraParams.quickPresets.entries.cinematicMedium.summary",
    fallbackSummary: "50mm · balanced frame",
    selection: {
      cameraBodyId: "sony-venice-2",
      lensId: "cooke-s4i-prime",
      focalLengthMm: 50,
      aperture: "f/2.8",
    },
  },
  {
    id: "dialogue-natural",
    titleKey: "cameraParams.quickPresets.entries.dialogueNatural.title",
    fallbackTitle: "Dialogue",
    summaryKey: "cameraParams.quickPresets.entries.dialogueNatural.summary",
    fallbackSummary: "35mm · natural view",
    selection: {
      cameraBodyId: "canon-c500-mark-ii",
      lensId: "canon-cne-prime",
      focalLengthMm: 35,
      aperture: "f/2.8",
    },
  },
  {
    id: "group-scene",
    titleKey: "cameraParams.quickPresets.entries.groupScene.title",
    fallbackTitle: "Group Scene",
    summaryKey: "cameraParams.quickPresets.entries.groupScene.summary",
    fallbackSummary: "35mm · wider coverage",
    selection: {
      cameraBodyId: "sony-venice-2",
      lensId: "zeiss-supreme-prime",
      focalLengthMm: 35,
      aperture: "f/4",
    },
  },
  {
    id: "long-shot",
    titleKey: "cameraParams.quickPresets.entries.longShot.title",
    fallbackTitle: "Long Shot",
    summaryKey: "cameraParams.quickPresets.entries.longShot.summary",
    fallbackSummary: "135mm · strong compression",
    selection: {
      cameraBodyId: "panavision-dxl2",
      lensId: "panavision-primo-70",
      focalLengthMm: 135,
      aperture: "f/2.8",
    },
  },
  {
    id: "establishing-wide",
    titleKey: "cameraParams.quickPresets.entries.establishingWide.title",
    fallbackTitle: "Establishing",
    summaryKey: "cameraParams.quickPresets.entries.establishingWide.summary",
    fallbackSummary: "18mm · ultra wide",
    selection: {
      cameraBodyId: "arri-alexa-mini-lf",
      lensId: "zeiss-supreme-prime",
      focalLengthMm: 18,
      aperture: "f/5.6",
    },
  },
  {
    id: "closeup-detail",
    titleKey: "cameraParams.quickPresets.entries.closeupDetail.title",
    fallbackTitle: "Close-up Detail",
    summaryKey: "cameraParams.quickPresets.entries.closeupDetail.summary",
    fallbackSummary: "100mm · tighter detail",
    selection: {
      cameraBodyId: "panavision-dxl2",
      lensId: "panavision-primo-70",
      focalLengthMm: 100,
      aperture: "f/2",
    },
  },
  {
    id: "full-body",
    titleKey: "cameraParams.quickPresets.entries.fullBody.title",
    fallbackTitle: "Full Body",
    summaryKey: "cameraParams.quickPresets.entries.fullBody.summary",
    fallbackSummary: "50mm · full figure",
    selection: {
      cameraBodyId: "canon-c500-mark-ii",
      lensId: "canon-cne-prime",
      focalLengthMm: 50,
      aperture: "f/4",
    },
  },
  {
    id: "two-shot",
    titleKey: "cameraParams.quickPresets.entries.twoShot.title",
    fallbackTitle: "Two Shot",
    summaryKey: "cameraParams.quickPresets.entries.twoShot.summary",
    fallbackSummary: "75mm · paired framing",
    selection: {
      cameraBodyId: "sony-venice-2",
      lensId: "cooke-s4i-prime",
      focalLengthMm: 75,
      aperture: "f/2.8",
    },
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

export function resolveCameraApertureImage(
  aperture: string | null | undefined,
): string | null {
  if (!aperture) {
    return null;
  }

  return CAMERA_APERTURE_IMAGES[aperture as keyof typeof CAMERA_APERTURE_IMAGES] ?? null;
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

export function areCameraParamsSelectionsEqual(
  left: Partial<CameraParamsSelection> | null | undefined,
  right: Partial<CameraParamsSelection> | null | undefined,
): boolean {
  const normalizedLeft = normalizeCameraParamsSelection(left);
  const normalizedRight = normalizeCameraParamsSelection(right);

  return (
    normalizedLeft.cameraBodyId === normalizedRight.cameraBodyId
    && normalizedLeft.lensId === normalizedRight.lensId
    && normalizedLeft.focalLengthMm === normalizedRight.focalLengthMm
    && normalizedLeft.aperture === normalizedRight.aperture
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
