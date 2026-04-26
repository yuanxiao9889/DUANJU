import type { ImageModelDefinition } from '../../types';

export const RUNNINGHUB_BANANA_2_MODEL_ID = 'runninghub/rhart-image-n-g31-flash';

const BANANA_2_ASPECT_RATIOS = [
  '1:1',
  '16:9',
  '9:16',
  '4:3',
  '3:4',
  '3:2',
  '2:3',
  '5:4',
  '4:5',
  '21:9',
  '1:4',
  '4:1',
  '1:8',
  '8:1',
] as const;

const BANANA_2_RESOLUTIONS = [
  { value: '1k', label: '1K' },
  { value: '2k', label: '2K' },
  { value: '4k', label: '4K' },
];

export const imageModel: ImageModelDefinition = {
  id: RUNNINGHUB_BANANA_2_MODEL_ID,
  mediaType: 'image',
  displayName: '香蕉2',
  providerId: 'runninghub',
  description: 'RunningHub 香蕉2 图像生成与编辑',
  eta: '1min',
  expectedDurationMs: 60000,
  defaultAspectRatio: '1:1',
  defaultResolution: '1k',
  aspectRatios: BANANA_2_ASPECT_RATIOS.map((value) => ({ value, label: value })),
  resolutions: BANANA_2_RESOLUTIONS,
  resolveRequest: ({ referenceImageCount }) => ({
    requestModel: RUNNINGHUB_BANANA_2_MODEL_ID,
    modeLabel: referenceImageCount > 0 ? '编辑模式' : '生成模式',
  }),
};
