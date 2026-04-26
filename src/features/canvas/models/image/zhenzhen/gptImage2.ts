import type { ImageModelDefinition, ResolutionOption } from '../../types';

export const ZHENZHEN_GPT_IMAGE_2_MODEL_ID = 'zhenzhen/gpt-image-2';

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
] as const;

const RESOLUTION_OPTIONS: ResolutionOption[] = [
  { value: '1K', label: '1K' },
  { value: '2K', label: '2K' },
  { value: '4K', label: '4K' },
];

export const imageModel: ImageModelDefinition = {
  id: ZHENZHEN_GPT_IMAGE_2_MODEL_ID,
  mediaType: 'image',
  displayName: 'gpt-image-2',
  providerId: 'zhenzhen',
  description:
    'Zhenzhen gpt-image-2 using OpenAI-style generations/edits size-based requests.',
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
        'Controls image fidelity, latency, and cost for gpt-image-2 output.',
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
    requestModel: ZHENZHEN_GPT_IMAGE_2_MODEL_ID,
    modeLabel: referenceImageCount > 0 ? 'Edit' : 'Generate',
  }),
};
