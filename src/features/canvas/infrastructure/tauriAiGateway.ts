import {
  generateImage,
  getGenerateImageJob,
  setApiKey,
  submitGenerateImageJob,
} from '@/commands/ai';
import { imageUrlToDataUrl, persistImageLocally } from '@/features/canvas/application/imageData';

import type { AiGateway, GenerateImagePayload } from '../application/ports';

const configuredApiKeyByProvider = new Map<string, string>();
const pendingApiKeySyncByProvider = new Map<string, Promise<void>>();

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
  generateImage: async (payload: GenerateImagePayload) => {
    const normalizedReferenceImages = await normalizeReferenceImages(payload);

    return await generateImage({
      prompt: payload.prompt,
      model: payload.model,
      size: payload.size,
      aspect_ratio: payload.aspectRatio,
      reference_images: normalizedReferenceImages,
      extra_params: payload.extraParams,
    });
  },
  submitGenerateImageJob: async (payload: GenerateImagePayload) => {
    const normalizedReferenceImages = await normalizeReferenceImages(payload);
    return await submitGenerateImageJob({
      prompt: payload.prompt,
      model: payload.model,
      size: payload.size,
      aspect_ratio: payload.aspectRatio,
      reference_images: normalizedReferenceImages,
      extra_params: payload.extraParams,
    });
  },
  getGenerateImageJob,
};
