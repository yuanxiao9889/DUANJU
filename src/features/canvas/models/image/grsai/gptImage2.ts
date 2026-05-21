import type { ImageModelDefinition, ResolutionOption } from '../../types';

export const GRSAI_GPT_IMAGE_2_MODEL_ID = 'grsai/gpt-image-2';
export const GRSAI_GPT_IMAGE_2_REQUEST_MODEL = 'grsai/gpt-image-2-vip';

const ASPECT_RATIOS = [
  '1:1',
  '2:3',
  '3:2',
  '3:4',
  '4:3',
  '4:5',
  '5:4',
  '9:16',
  '16:9',
  '21:9',
  '9:21',
  '1:3',
  '3:1',
  '1:2',
  '2:1',
] as const;

const LEGACY_ASPECT_RATIO_MAP: Record<string, (typeof ASPECT_RATIOS)[number]> = {
  '1:4': '1:3',
  '1:8': '1:3',
  '4:1': '3:1',
  '8:1': '3:1',
};

const RESOLUTION_OPTIONS: ResolutionOption[] = [
  { value: '1K', label: '1K' },
  { value: '2K', label: '2K' },
  { value: '4K', label: '4K' },
];

export const imageModel: ImageModelDefinition = {
  id: GRSAI_GPT_IMAGE_2_MODEL_ID,
  mediaType: 'image',
  displayName: 'gpt-image-2-vip',
  providerId: 'grsai',
  description:
    'GRSAI gpt-image-2-vip using /v1/api/generate with documented aspectRatio pixel values for 2K/4K output.',
  eta: '30s',
  expectedDurationMs: 30000,
  defaultAspectRatio: '1:1',
  defaultResolution: '1K',
  aspectRatios: ASPECT_RATIOS.map((value) => ({
    value,
    label: value,
  })),
  resolutions: RESOLUTION_OPTIONS,
  extraParamsSchema: [
    {
      key: 'quality',
      label: 'Generation quality',
      labelKey: 'modelParams.generationQuality',
      description:
        'Controls image fidelity and latency for gpt-image-2-vip output.',
      descriptionKey: 'modelParams.generationQualityDesc',
      type: 'enum',
      defaultValue: 'auto',
      options: [
        { value: 'auto', label: 'Auto', labelKey: 'modelParams.generationQualityAuto' },
        { value: 'low', label: 'Low', labelKey: 'modelParams.generationQualityLow' },
        { value: 'medium', label: 'Medium', labelKey: 'modelParams.generationQualityMedium' },
        { value: 'high', label: 'High', labelKey: 'modelParams.generationQualityHigh' },
      ],
    },
  ],
  defaultExtraParams: {
    quality: 'auto',
  },
  resolveRequest: ({ referenceImageCount }) => ({
    requestModel: GRSAI_GPT_IMAGE_2_REQUEST_MODEL,
    modeLabel: referenceImageCount > 0 ? 'Edit' : 'Generate',
  }),
};

export function normalizeGrsaiGptImage2AspectRatio(
  value: string | null | undefined
): string | null {
  const trimmed = (value ?? '').trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed === 'auto') {
    return trimmed;
  }
  return LEGACY_ASPECT_RATIO_MAP[trimmed] ?? trimmed;
}
