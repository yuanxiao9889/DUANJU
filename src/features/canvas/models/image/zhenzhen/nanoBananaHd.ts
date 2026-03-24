import type { ImageModelDefinition, ResolutionOption } from '../../types';

export const ZHENZHEN_NANO_BANANA_HD_MODEL_ID = 'zhenzhen/nano-banana-hd';
export const ZHENZHEN_NANO_BANANA_2_4K_REQUEST_MODEL_ID = 'zhenzhen/nano-banana-2-4k';

const NANO_BANANA_ASPECT_RATIOS = [
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

const HD_RESOLUTION_OPTIONS: ResolutionOption[] = [
  { value: '4K', label: '4K' },
];

export const imageModel: ImageModelDefinition = {
  id: ZHENZHEN_NANO_BANANA_HD_MODEL_ID,
  mediaType: 'image',
  displayName: '香蕉Pro',
  providerId: 'zhenzhen',
  description: 'Nano Banana HD 4K高清图像生成与编辑',
  eta: '45s',
  expectedDurationMs: 45000,
  defaultAspectRatio: '1:1',
  defaultResolution: '4K',
  aspectRatios: NANO_BANANA_ASPECT_RATIOS.map((value) => ({ value, label: value })),
  resolutions: HD_RESOLUTION_OPTIONS,
  resolveRequest: ({ referenceImageCount }) => ({
    requestModel: ZHENZHEN_NANO_BANANA_2_4K_REQUEST_MODEL_ID,
    modeLabel: referenceImageCount > 0 ? '编辑模式' : '生成模式',
  }),
};
