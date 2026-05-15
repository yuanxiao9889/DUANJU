import {
  generateImage,
  getGenerateImageJob,
  setApiKey,
  submitGenerateImageJob,
} from '@/commands/ai';
import { optimizeReferenceImagesForApi } from '@/commands/image';
import { imageUrlToDataUrl, persistImageLocally } from '@/features/canvas/application/imageData';
import { createCurrentProjectMediaContext } from '@/features/canvas/application/mediaPersistenceContext';

import type {
  AiGateway,
  GenerateImagePayload,
  ReferenceImageOptimizationSummary,
  ResolvedGenerateImagePayload,
} from '../application/ports';

const configuredApiKeyByProvider = new Map<string, string>();
const pendingApiKeySyncByProvider = new Map<string, Promise<void>>();
const API_REFERENCE_OPTIMIZATION_MIN_COUNT = 1;
const API_REFERENCE_MAX_DIMENSION = 2048;
const API_REFERENCE_MAX_BYTES = 3 * 1024 * 1024;

function isResolvedGenerateImagePayload(
  payload: GenerateImagePayload
): payload is ResolvedGenerateImagePayload {
  return typeof (payload as Partial<ResolvedGenerateImagePayload>).effectiveSize === 'string';
}

function describeReferenceImageSource(source: string, index: number): string {
  const trimmed = source.trim();
  if (trimmed.startsWith('data:')) {
    const mimeMatch = /^data:([^;,]+)/.exec(trimmed);
    const mimeType = mimeMatch?.[1] ?? 'unknown';
    return `[reference ${index + 1}] data:${mimeType}; length=${trimmed.length}`;
  }

  if (trimmed.length > 240) {
    return `${trimmed.slice(0, 200)}... length=${trimmed.length}`;
  }

  return trimmed;
}

async function normalizeReferenceImages(payload: GenerateImagePayload): Promise<string[] | undefined> {
  const isKieModel = payload.model.startsWith('kie/');
  const isFalModel = payload.model.startsWith('fal/');
  const isRunningHubModel = payload.model.startsWith('runninghub/');
  return payload.referenceImages
    ? await Promise.all(
      payload.referenceImages.map(async (imageUrl) => {
        if (isKieModel || isFalModel) {
          return await imageUrlToDataUrl(imageUrl);
        }
        if (isRunningHubModel) {
          return await persistImageLocally(imageUrl);
        }
        return await persistImageLocally(imageUrl);
      })
    )
    : undefined;
}

async function resolveGenerateImagePayload(
  payload: GenerateImagePayload
): Promise<ResolvedGenerateImagePayload> {
  if (isResolvedGenerateImagePayload(payload)) {
    return payload;
  }

  const referenceImages = payload.referenceImages ?? [];
  let optimizedReferenceImages = referenceImages;
  let referenceImageOptimization: ReferenceImageOptimizationSummary | undefined;

  if (referenceImages.length >= API_REFERENCE_OPTIMIZATION_MIN_COUNT) {
    const optimizedItems = await optimizeReferenceImagesForApi(referenceImages, {
      maxDimension: API_REFERENCE_MAX_DIMENSION,
      maxBytes: API_REFERENCE_MAX_BYTES,
    }, createCurrentProjectMediaContext('image', 'cache'));
    optimizedReferenceImages = optimizedItems.map((item) => item.imagePath);
    referenceImageOptimization = {
      applied: true,
      inputCount: referenceImages.length,
      totalBeforeBytes: optimizedItems.reduce((total, item) => total + item.originalBytes, 0),
      totalAfterBytes: optimizedItems.reduce((total, item) => total + item.outputBytes, 0),
      items: optimizedItems.map((item, index) => ({
        source: describeReferenceImageSource(item.source, index),
        optimizedSource: item.imagePath,
        originalFormat: item.originalFormat,
        outputFormat: item.outputFormat,
        originalWidth: item.originalWidth,
        originalHeight: item.originalHeight,
        outputWidth: item.outputWidth,
        outputHeight: item.outputHeight,
        originalBytes: item.originalBytes,
        outputBytes: item.outputBytes,
        resized: item.resized,
        transparent: item.transparent,
      })),
    };
  } else {
    referenceImageOptimization = {
      applied: false,
      inputCount: referenceImages.length,
      items: [],
    };
  }

  const effectiveSize = payload.size;

  if (referenceImageOptimization.applied) {
    console.info('[AI] resolved generation request before provider submission', {
      model: payload.model,
      originalSize: payload.size,
      effectiveSize,
      referenceImageCount: referenceImages.length,
      referenceImageOptimization: referenceImageOptimization.applied
        ? {
          inputCount: referenceImageOptimization.inputCount,
          totalBeforeBytes: referenceImageOptimization.totalBeforeBytes,
          totalAfterBytes: referenceImageOptimization.totalAfterBytes,
        }
        : { applied: false, inputCount: referenceImages.length },
    });
  }

  return {
    ...payload,
    originalSize: payload.size,
    effectiveSize,
    size: effectiveSize,
    referenceImages: optimizedReferenceImages,
    referenceImageOptimization,
  };
}

export const tauriAiGateway: AiGateway = {
  setApiKey: async (provider: string, apiKey: string) => {
    const normalizedProvider = provider.trim();
    const normalizedApiKey = apiKey.trim();
    const pendingSync = pendingApiKeySyncByProvider.get(normalizedProvider);

    if (configuredApiKeyByProvider.get(normalizedProvider) === normalizedApiKey) {
      return;
    }

    if (pendingSync) {
      await pendingSync;
      if (configuredApiKeyByProvider.get(normalizedProvider) === normalizedApiKey) {
        return;
      }
    }

    const syncPromise = setApiKey(normalizedProvider, normalizedApiKey)
      .then(() => {
        configuredApiKeyByProvider.set(normalizedProvider, normalizedApiKey);
      })
      .finally(() => {
        const currentPending = pendingApiKeySyncByProvider.get(normalizedProvider);
        if (currentPending === syncPromise) {
          pendingApiKeySyncByProvider.delete(normalizedProvider);
        }
      });

    pendingApiKeySyncByProvider.set(normalizedProvider, syncPromise);
    await syncPromise;
  },
  resolveGenerateImagePayload,
  generateImage: async (payload: GenerateImagePayload) => {
    const resolvedPayload = await resolveGenerateImagePayload(payload);
    const normalizedReferenceImages = await normalizeReferenceImages(resolvedPayload);

    return await generateImage({
      prompt: resolvedPayload.prompt,
      model: resolvedPayload.model,
      size: resolvedPayload.effectiveSize,
      aspect_ratio: resolvedPayload.aspectRatio,
      reference_images: normalizedReferenceImages,
      extra_params: resolvedPayload.extraParams,
    });
  },
  submitGenerateImageJob: async (payload: GenerateImagePayload) => {
    const resolvedPayload = await resolveGenerateImagePayload(payload);
    const normalizedReferenceImages = await normalizeReferenceImages(resolvedPayload);
    return await submitGenerateImageJob({
      prompt: resolvedPayload.prompt,
      model: resolvedPayload.model,
      size: resolvedPayload.effectiveSize,
      aspect_ratio: resolvedPayload.aspectRatio,
      reference_images: normalizedReferenceImages,
      extra_params: resolvedPayload.extraParams,
    });
  },
  getGenerateImageJob,
};
