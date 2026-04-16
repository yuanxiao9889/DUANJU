import type { ImageModelDefinition, ResolutionOption } from '../../types';

export const ZHENZHEN_GEMINI_FLASH_IMAGE_PREVIEW_MODEL_ID =
  'zhenzhen/gemini-3.1-flash-image-preview';

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
  id: ZHENZHEN_GEMINI_FLASH_IMAGE_PREVIEW_MODEL_ID,
  mediaType: 'image',
  displayName: '\u9999\u85492',
  providerId: 'zhenzhen',
  description:
    'Zhenzhen Gemini 3.1 Flash Image Preview with 1K/2K/4K image_size, up to 14 reference images, long-image ratios, stronger text rendering, search grounding, and built-in thinking.',
  eta: '30s',
  expectedDurationMs: 30000,
  defaultAspectRatio: '1:1',
  defaultResolution: '1K',
  aspectRatios: ASPECT_RATIOS.map((value) => ({
    value,
    label: value,
  })),
  resolutions: RESOLUTION_OPTIONS,
  resolveRequest: ({ referenceImageCount }) => ({
    requestModel: ZHENZHEN_GEMINI_FLASH_IMAGE_PREVIEW_MODEL_ID,
    modeLabel: referenceImageCount > 0 ? 'Edit' : 'Generate',
  }),
};
