import type {
  JimengAspectRatio,
  JimengDurationSeconds,
  JimengImageModelVersion,
  JimengImageResolutionType,
  JimengReferenceMode,
  JimengVideoModelId,
  JimengVideoResolution,
} from '@/features/canvas/domain/canvasNodes';
import { JIMENG_DURATION_SECONDS } from '@/features/canvas/domain/canvasNodes';

export interface JimengOptionDefinition<T extends string | number> {
  value: T;
  labelKey: string;
  descriptionKey?: string;
}

export const JIMENG_IMAGE_MODEL_OPTIONS: JimengOptionDefinition<JimengImageModelVersion>[] = [
  { value: '3.0', labelKey: 'node.jimengImage.modelOptions.v3_0' },
  { value: '3.1', labelKey: 'node.jimengImage.modelOptions.v3_1' },
  { value: '4.0', labelKey: 'node.jimengImage.modelOptions.v4_0' },
  { value: '4.1', labelKey: 'node.jimengImage.modelOptions.v4_1' },
  { value: '4.5', labelKey: 'node.jimengImage.modelOptions.v4_5' },
  { value: '4.6', labelKey: 'node.jimengImage.modelOptions.v4_6' },
  { value: '5.0', labelKey: 'node.jimengImage.modelOptions.v5_0' },
  { value: 'lab', labelKey: 'node.jimengImage.modelOptions.lab' },
];

export const JIMENG_IMAGE_RESOLUTION_OPTIONS: JimengOptionDefinition<JimengImageResolutionType>[] = [
  { value: '1k', labelKey: 'node.jimengImage.resolutionOptions.1k' },
  { value: '2k', labelKey: 'node.jimengImage.resolutionOptions.2k' },
  { value: '4k', labelKey: 'node.jimengImage.resolutionOptions.4k' },
];

export const JIMENG_VIDEO_MODEL_OPTIONS: JimengOptionDefinition<JimengVideoModelId>[] = [
  {
    value: 'seedance2.0fast',
    labelKey: 'node.jimeng.modelOptions.seedance20fast',
    descriptionKey: 'node.jimeng.modelOptionDescriptions.seedance20fast',
  },
  {
    value: 'seedance2.0',
    labelKey: 'node.jimeng.modelOptions.seedance20',
    descriptionKey: 'node.jimeng.modelOptionDescriptions.seedance20',
  },
  {
    value: '3.5pro',
    labelKey: 'node.jimeng.modelOptions.v3_5pro',
    descriptionKey: 'node.jimeng.modelOptionDescriptions.v3_5pro',
  },
  {
    value: '3.0pro',
    labelKey: 'node.jimeng.modelOptions.v3_0pro',
    descriptionKey: 'node.jimeng.modelOptionDescriptions.v3_0pro',
  },
  {
    value: '3.0fast',
    labelKey: 'node.jimeng.modelOptions.v3_0fast',
    descriptionKey: 'node.jimeng.modelOptionDescriptions.v3_0fast',
  },
  {
    value: '3.0',
    labelKey: 'node.jimeng.modelOptions.v3_0',
    descriptionKey: 'node.jimeng.modelOptionDescriptions.v3_0',
  },
];

export const JIMENG_REFERENCE_MODE_OPTIONS: JimengOptionDefinition<JimengReferenceMode>[] = [
  { value: 'allAround', labelKey: 'node.jimeng.referenceModes.allAround' },
  { value: 'firstLastFrame', labelKey: 'node.jimeng.referenceModes.firstLastFrame' },
  { value: 'smartFrames', labelKey: 'node.jimeng.referenceModes.smartFrames' },
  { value: 'subject', labelKey: 'node.jimeng.referenceModes.subject' },
];

export const JIMENG_ASPECT_RATIO_OPTIONS: JimengOptionDefinition<JimengAspectRatio>[] = [
  { value: '21:9', labelKey: 'node.jimeng.aspectRatios.21:9' },
  { value: '16:9', labelKey: 'node.jimeng.aspectRatios.16:9' },
  { value: '4:3', labelKey: 'node.jimeng.aspectRatios.4:3' },
  { value: '1:1', labelKey: 'node.jimeng.aspectRatios.1:1' },
  { value: '3:4', labelKey: 'node.jimeng.aspectRatios.3:4' },
  { value: '9:16', labelKey: 'node.jimeng.aspectRatios.9:16' },
];

export const JIMENG_DURATION_OPTIONS: JimengOptionDefinition<JimengDurationSeconds>[] =
  JIMENG_DURATION_SECONDS.map((value) => ({
    value,
    labelKey: `node.jimeng.durations.${value}`,
  }));

export const JIMENG_VIDEO_RESOLUTION_OPTIONS: JimengOptionDefinition<JimengVideoResolution>[] = [
  { value: '720p', labelKey: 'node.jimeng.videoResolutionOptions.720p' },
  { value: '1080p', labelKey: 'node.jimeng.videoResolutionOptions.1080p' },
];
