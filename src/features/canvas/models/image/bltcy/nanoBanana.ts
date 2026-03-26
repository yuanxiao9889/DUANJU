import type { ImageModelDefinition, ResolutionOption } from '../../types';

export const BLTCY_GEMINI_FLASH_IMAGE_PREVIEW_4K_MODEL_ID =
  'bltcy/gemini-3.1-flash-image-preview-4k';

const GEMINI_FLASH_IMAGE_PREVIEW_4K_ASPECT_RATIOS = [
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
  id: BLTCY_GEMINI_FLASH_IMAGE_PREVIEW_4K_MODEL_ID,
  mediaType: 'image',
  displayName: '香蕉2',
  providerId: 'bltcy',
  description: '柏拉图 AI Gemini 3.1 Flash Image Preview 4K image generation and editing.',
  eta: '30s',
  expectedDurationMs: 30000,
  defaultAspectRatio: '1:1',
  defaultResolution: '1K',
  aspectRatios: GEMINI_FLASH_IMAGE_PREVIEW_4K_ASPECT_RATIOS.map((value) => ({
    value,
    label: value,
  })),
  resolutions: RESOLUTION_OPTIONS,
  resolveRequest: ({ referenceImageCount }) => ({
    requestModel: BLTCY_GEMINI_FLASH_IMAGE_PREVIEW_4K_MODEL_ID,
    modeLabel: referenceImageCount > 0 ? '编辑模式' : '生成模式',
  }),
};
