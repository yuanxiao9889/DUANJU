import type { ImageModelDefinition, ResolutionOption } from '../../types';

export const KIE_GPT_IMAGE_2_MODEL_ID = 'kie/gpt-image-2';
export const KIE_GPT_IMAGE_2_TEXT_TO_IMAGE_MODEL_ID = 'kie/gpt-image-2-text-to-image';
export const KIE_GPT_IMAGE_2_IMAGE_TO_IMAGE_MODEL_ID = 'kie/gpt-image-2-image-to-image';

const ASPECT_RATIOS = ['1:1', '9:16', '16:9', '4:3', '3:4'] as const;

const RESOLUTION_OPTIONS: ResolutionOption[] = [
  { value: '1K', label: '1K' },
  { value: '2K', label: '2K' },
  { value: '4K', label: '4K' },
];

export const imageModel: ImageModelDefinition = {
  id: KIE_GPT_IMAGE_2_MODEL_ID,
  mediaType: 'image',
  displayName: 'gpt-image-2',
  providerId: 'kie',
  description: 'KIE GPT Image 2 image generation and editing via Market task APIs.',
  eta: '1min',
  expectedDurationMs: 60000,
  defaultAspectRatio: '1:1',
  defaultResolution: '1K',
  aspectRatios: ASPECT_RATIOS.map((value) => ({ value, label: value })),
  resolutions: RESOLUTION_OPTIONS,
  resolveRequest: ({ referenceImageCount }) => ({
    requestModel:
      referenceImageCount > 0
        ? KIE_GPT_IMAGE_2_IMAGE_TO_IMAGE_MODEL_ID
        : KIE_GPT_IMAGE_2_TEXT_TO_IMAGE_MODEL_ID,
    modeLabel: referenceImageCount > 0 ? 'Edit' : 'Generate',
  }),
};
