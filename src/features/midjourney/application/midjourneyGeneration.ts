import { v4 as uuidv4 } from 'uuid';

import type {
  MidjourneyAspectRatio,
  MidjourneyVersionPreset,
  MjBatchImageItem,
  MjReferenceItem,
} from '@/features/canvas/domain/canvasNodes';
import {
  detectImageDimensions,
  prepareNodeImage,
} from '@/features/canvas/application/imageData';
import { splitImageSource } from '@/commands/image';
import {
  queryMidjourneyTasks,
  submitMidjourneyImagine,
  type MidjourneyTaskDto,
} from '@/features/midjourney/infrastructure/commands';
import {
  buildMidjourneyFinalPrompt,
  partitionMjReferences,
  validateMidjourneyAdvancedParams,
} from '@/features/midjourney/domain/prompt';
import type { MidjourneyProviderId } from '@/features/midjourney/domain/providers';

export interface SubmitMidjourneyImagineInput {
  providerId: MidjourneyProviderId;
  apiKey: string;
  prompt: string;
  references: MjReferenceItem[];
  aspectRatio?: MidjourneyAspectRatio | string | null;
  rawMode?: boolean;
  versionPreset?: MidjourneyVersionPreset | string | null;
  advancedParams?: string | null;
}

export interface SubmitMidjourneyImagineOutput {
  taskId: string;
  prompt: string;
  finalPrompt: string;
  state?: string | null;
}

export async function submitMidjourneyImagineTask(
  input: SubmitMidjourneyImagineInput
): Promise<SubmitMidjourneyImagineOutput> {
  const apiKey = input.apiKey.trim();
  if (!apiKey) {
    throw new Error('MJ API key is required');
  }

  const prompt = input.prompt.trim();
  if (!prompt) {
    throw new Error('Prompt is required');
  }

  const validation = validateMidjourneyAdvancedParams(input.advancedParams);
  if (!validation.valid) {
    throw new Error(
      `Advanced Params duplicates reserved params: ${validation.duplicatedReservedParams.join(', ')}`
    );
  }

  const { referenceImages, styleReferenceImages } = partitionMjReferences(
    input.references
  );
  const response = await submitMidjourneyImagine({
    providerId: input.providerId,
    apiKey,
    prompt,
    referenceImages,
    styleReferenceImages,
    aspectRatio: input.aspectRatio ?? undefined,
    rawMode: input.rawMode ?? false,
    versionPreset: input.versionPreset ?? undefined,
    advancedParams: input.advancedParams ?? undefined,
  });

  return {
    taskId: response.taskId,
    prompt,
    finalPrompt:
      response.finalPrompt ||
      buildMidjourneyFinalPrompt({
        prompt,
        aspectRatio: input.aspectRatio,
        rawMode: input.rawMode,
        versionPreset: input.versionPreset,
        advancedParams: input.advancedParams,
      }),
    state: response.state ?? null,
  };
}

export async function queryMidjourneyTask(
  providerId: MidjourneyProviderId,
  apiKey: string,
  taskId: string
): Promise<MidjourneyTaskDto> {
  const normalizedApiKey = apiKey.trim();
  if (!normalizedApiKey) {
    throw new Error('MJ API key is required');
  }

  const normalizedTaskId = taskId.trim();
  if (!normalizedTaskId) {
    throw new Error('Midjourney task id is required');
  }

  const tasks = await queryMidjourneyTasks({
    providerId,
    apiKey: normalizedApiKey,
    taskIds: [normalizedTaskId],
  });

  const task = tasks.find((item) => item.id === normalizedTaskId) ?? tasks[0];
  if (!task) {
    throw new Error(`Midjourney task not found: ${normalizedTaskId}`);
  }

  return task;
}

async function fallbackGridImage(
  gridImageSource: string
): Promise<MjBatchImageItem[]> {
  const prepared = await prepareNodeImage(gridImageSource);
  const dimensions = await detectImageDimensions(prepared.imageUrl).catch(() => null);

  return [
    {
      id: `mj-batch-image-${uuidv4()}`,
      imageUrl: prepared.imageUrl,
      previewImageUrl: prepared.previewImageUrl,
      sourceUrl: gridImageSource,
      index: 0,
      aspectRatio: prepared.aspectRatio,
      width: dimensions?.width,
      height: dimensions?.height,
    },
  ];
}

export async function splitMidjourneyGridToBatchImages(
  gridImageSource: string
): Promise<MjBatchImageItem[]> {
  const normalizedGridImageSource = gridImageSource.trim();
  if (!normalizedGridImageSource) {
    return [];
  }

  const splitSources = await splitImageSource(normalizedGridImageSource, 2, 2, 0).catch(
    async () => fallbackGridImage(normalizedGridImageSource)
  );
  if (splitSources.length > 0 && typeof splitSources[0] !== 'string') {
    return splitSources as MjBatchImageItem[];
  }

  const preparedImages = await Promise.all(
    (splitSources as string[]).map(async (sourceUrl, index) => {
      const prepared = await prepareNodeImage(sourceUrl);
      const dimensions = await detectImageDimensions(prepared.imageUrl).catch(() => null);

      return {
        id: `mj-batch-image-${uuidv4()}`,
        imageUrl: prepared.imageUrl,
        previewImageUrl: prepared.previewImageUrl,
        sourceUrl,
        index,
        aspectRatio: prepared.aspectRatio,
        width: dimensions?.width,
        height: dimensions?.height,
      } satisfies MjBatchImageItem;
    })
  );

  if (preparedImages.length === 0) {
    return fallbackGridImage(normalizedGridImageSource);
  }

  return preparedImages.sort((left, right) => left.index - right.index);
}
