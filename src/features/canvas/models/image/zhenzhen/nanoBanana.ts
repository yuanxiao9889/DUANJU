import type { ImageModelDefinition, ResolutionOption } from '../../types';

export const ZHENZHEN_NANO_BANANA_MODEL_ID = 'zhenzhen/nano-banana-pro';
export const ZHENZHEN_NANO_BANANA_REQUEST_MODEL_ID = 'zhenzhen/nano-banana-pro';

const NANO_BANANA_ASPECT_RATIOS = [
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
  id: ZHENZHEN_NANO_BANANA_MODEL_ID,
  mediaType: 'image',
  displayName: 'Nano Banana Pro',
  providerId: 'zhenzhen',
  description:
    'Recommended Zhenzhen Nano Banana Pro model with 1K/2K/4K output controlled by image_size.',
  eta: '30s',
  expectedDurationMs: 30000,
  defaultAspectRatio: '1:1',
  defaultResolution: '1K',
  aspectRatios: NANO_BANANA_ASPECT_RATIOS.map((value) => ({
    value,
    label: value,
  })),
  resolutions: RESOLUTION_OPTIONS,
  resolveRequest: ({ referenceImageCount }) => ({
    requestModel: ZHENZHEN_NANO_BANANA_REQUEST_MODEL_ID,
    modeLabel: referenceImageCount > 0 ? 'Edit' : 'Generate',
  }),
};
