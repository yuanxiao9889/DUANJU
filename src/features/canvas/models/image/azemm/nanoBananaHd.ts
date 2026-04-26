import type { ImageModelDefinition, ResolutionOption } from '../../types';

export const AZEMM_NANO_BANANA_HD_MODEL_ID =
  'azemm/gemini-3-pro-image-preview';

const ASPECT_RATIOS = [
  '1:1',
  '1:4',
  '1:8',
  '2:3',
  '3:2',
  '3:4',
  '4:1',
  '4:3',
  '4:5',
  '5:4',
  '8:1',
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
  id: AZEMM_NANO_BANANA_HD_MODEL_ID,
  mediaType: 'image',
  displayName: '\u9999\u8549pro',
  providerId: 'azemm',
  description: 'Higher quality Gemini image preview model for richer scene rendering.',
  eta: '45s',
  expectedDurationMs: 45000,
  defaultAspectRatio: '1:1',
  defaultResolution: '4K',
  aspectRatios: ASPECT_RATIOS.map((value) => ({ value, label: value })),
  resolutions: RESOLUTION_OPTIONS,
  resolveRequest: ({ referenceImageCount }) => ({
    requestModel: AZEMM_NANO_BANANA_HD_MODEL_ID,
    modeLabel: referenceImageCount > 0
      ? '\u7f16\u8f91\u6a21\u5f0f'
      : '\u751f\u6210\u6a21\u5f0f',
  }),
};
