import {
  JIMENG_DURATION_SECONDS,
} from '@/features/canvas/domain/canvasNodes';
import type {
  JimengAspectRatio,
  JimengCreationType,
  JimengDurationSeconds,
  JimengModelId,
  JimengReferenceMode,
} from '@/features/canvas/domain/canvasNodes';

export interface JimengOptionDefinition<T extends string | number> {
  value: T;
  labelKey: string;
  descriptionKey?: string;
}

export const JIMENG_CREATION_OPTIONS: JimengOptionDefinition<JimengCreationType>[] = [
  { value: 'video', labelKey: 'node.jimeng.creationTypes.video' },
];

export const JIMENG_MODEL_OPTIONS: JimengOptionDefinition<JimengModelId>[] = [
  {
    value: 'seedance-2.0',
    labelKey: 'node.jimeng.models.seedance-2.0',
    descriptionKey: 'node.jimeng.modelDescriptions.seedance-2.0',
  },
];

export const JIMENG_REFERENCE_MODE_OPTIONS: JimengOptionDefinition<JimengReferenceMode>[] = [
  {
    value: 'allAround',
    labelKey: 'node.jimeng.referenceModes.allAround',
    descriptionKey: 'node.jimeng.referenceModeDescriptions.allAround',
  },
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
