import type { ImageModelDefinition, ResolutionOption } from '../../types';

export const COMFLY_NANO_BANANA_MODEL_ID = 'comfly/nano-banana';

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

const RESOLUTION_OPTIONS: ResolutionOption[] = [
  { value: '1K', label: '1K' },
];

export const imageModel: ImageModelDefinition = {
  id: COMFLY_NANO_BANANA_MODEL_ID,
  mediaType: 'image',
  displayName: 'Nano Banana',
  providerId: 'comfly',
  description: 'Nano Banana 图像生成与编辑，支持多图参考',
  eta: '30s',
  expectedDurationMs: 30000,
  defaultAspectRatio: '1:1',
  defaultResolution: '1K',
  aspectRatios: NANO_BANANA_ASPECT_RATIOS.map((value) => ({ value, label: value })),
  resolutions: RESOLUTION_OPTIONS,
  resolveRequest: ({ referenceImageCount }) => ({
    requestModel: COMFLY_NANO_BANANA_MODEL_ID,
    modeLabel: referenceImageCount > 0 ? '编辑模式' : '生成模式',
  }),
};
