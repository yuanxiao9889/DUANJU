import { isTauri } from '@tauri-apps/api/core';

import {
  createSeedanceVideoTask,
  getSeedanceVideoTask,
  type CreateSeedanceVideoTaskPayload,
  type SeedanceContentItemPayload,
} from '@/commands/seedance';
import { persistImageSource } from '@/commands/image';
import { audioUrlToDataUrl } from '@/features/canvas/application/audioData';
import {
  createPreviewDataUrl,
  prepareNodeImage,
} from '@/features/canvas/application/imageData';
import {
  captureVideoFrameFromSource,
  resolveVideoDisplayUrl,
  videoUrlToDataUrl,
} from '@/features/canvas/application/videoData';
import type {
  SeedanceAspectRatio,
  SeedanceDurationSeconds,
  SeedanceInputMode,
  SeedanceModelId,
  SeedanceResolution,
} from '@/features/canvas/domain/canvasNodes';
import {
  normalizeSeedanceAspectRatio,
  normalizeSeedanceDurationSeconds,
  normalizeSeedanceInputMode,
  normalizeSeedanceModelId,
  normalizeSeedanceResolution,
} from '@/features/seedance/domain/seedanceOptions';

export const SEEDANCE_RESULT_POLL_INTERVAL_MS = 2_500;
const SEEDANCE_REFERENCE_IMAGE_MAX_DIMENSION = 1600;

export interface SeedanceReferenceAudioSource {
  source: string;
  mimeType?: string | null;
}

export interface GenerateSeedanceVideoPayload {
  apiKey: string;
  prompt: string;
  inputMode?: SeedanceInputMode | string;
  modelId?: SeedanceModelId | string;
  aspectRatio?: SeedanceAspectRatio | string;
  durationSeconds?: SeedanceDurationSeconds | number;
  resolution?: SeedanceResolution | string;
  generateAudio?: boolean;
  returnLastFrame?: boolean;
  referenceImageSources?: string[];
  referenceVideoSources?: string[];
  referenceAudioSources?: SeedanceReferenceAudioSource[];
  onSubmitted?: (payload: { taskId: string }) => void | Promise<void>;
}

export interface SeedanceGeneratedVideoItem {
  taskId: string;
  modelId?: string | null;
  videoUrl: string;
  previewImageUrl?: string | null;
  aspectRatio: string;
  duration?: number;
  resolution?: string | null;
  generateAudio?: boolean;
  fileName?: string | null;
}

export interface SubmittedSeedanceVideoTaskResponse {
  taskId: string;
  status: 'queued';
}

export interface QuerySeedanceVideoResultPayload {
  apiKey: string;
  taskId: string;
}

export interface QuerySeedanceVideoResultResponse {
  taskId: string;
  pending: boolean;
  status: string;
  createdAt?: number | null;
  updatedAt?: number | null;
  video?: SeedanceGeneratedVideoItem;
  errorMessage?: string | null;
}

function normalizeWhitespace(value: string): string {
  return value
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function normalizeUniqueSources(sources: string[] | undefined): string[] {
  return [...new Set((sources ?? []).map((source) => source.trim()).filter(Boolean))];
}

function normalizeUniqueAudioSources(
  sources: SeedanceReferenceAudioSource[] | undefined
): SeedanceReferenceAudioSource[] {
  const normalizedBySource = new Map<string, SeedanceReferenceAudioSource>();

  for (const item of sources ?? []) {
    const source = item.source.trim();
    if (!source || normalizedBySource.has(source)) {
      continue;
    }

    normalizedBySource.set(source, {
      source,
      mimeType: item.mimeType?.trim() || null,
    });
  }

  return [...normalizedBySource.values()];
}

async function prepareReferenceImages(sources: string[] | undefined): Promise<string[]> {
  const uniqueSources = normalizeUniqueSources(sources);
  if (uniqueSources.length === 0) {
    return [];
  }

  return await Promise.all(
    uniqueSources.map((source) =>
      createPreviewDataUrl(source, SEEDANCE_REFERENCE_IMAGE_MAX_DIMENSION)
    )
  );
}

async function prepareReferenceVideos(sources: string[] | undefined): Promise<string[]> {
  const uniqueSources = normalizeUniqueSources(sources);
  if (uniqueSources.length === 0) {
    return [];
  }

  return await Promise.all(uniqueSources.map((source) => videoUrlToDataUrl(source)));
}

async function prepareReferenceAudios(
  sources: SeedanceReferenceAudioSource[] | undefined
): Promise<string[]> {
  const uniqueSources = normalizeUniqueAudioSources(sources);
  if (uniqueSources.length === 0) {
    return [];
  }

  return await Promise.all(
    uniqueSources.map((item) =>
      audioUrlToDataUrl(item.source, {
        mimeType: item.mimeType,
      })
    )
  );
}

function buildSeedanceContentPayload(input: {
  prompt: string;
  inputMode: SeedanceInputMode;
  referenceImages: string[];
  referenceVideos: string[];
  referenceAudios: string[];
}): SeedanceContentItemPayload[] {
  const content: SeedanceContentItemPayload[] = [
    {
      type: 'text',
      text: input.prompt,
    },
  ];

  if (input.inputMode === 'firstFrame') {
    content.push({
      type: 'image_url',
      image_url: { url: input.referenceImages[0] },
      role: 'first_frame',
    });
    return content;
  }

  if (input.inputMode === 'firstLastFrame') {
    content.push(
      {
        type: 'image_url',
        image_url: { url: input.referenceImages[0] },
        role: 'first_frame',
      },
      {
        type: 'image_url',
        image_url: { url: input.referenceImages[1] },
        role: 'last_frame',
      }
    );
    return content;
  }

  if (input.inputMode === 'reference') {
    content.push(
      ...input.referenceImages.map((url) => ({
        type: 'image_url' as const,
        image_url: { url },
        role: 'reference_image',
      })),
      ...input.referenceVideos.map((url) => ({
        type: 'video_url' as const,
        video_url: { url },
        role: 'reference_video',
      })),
      ...input.referenceAudios.map((url) => ({
        type: 'audio_url' as const,
        audio_url: { url },
        role: 'reference_audio',
      }))
    );
  }

  return content;
}

function resolveVideoCaptureSource(source: string): string {
  const trimmedSource = source.trim();
  if (!trimmedSource) {
    return trimmedSource;
  }
  return resolveVideoDisplayUrl(trimmedSource);
}

function resolvePosterCaptureTime(durationSeconds?: number | null): number {
  if (
    !durationSeconds ||
    !Number.isFinite(durationSeconds) ||
    durationSeconds <= 0.18
  ) {
    return 0;
  }

  return Math.min(0.12, Math.max(durationSeconds / 10, 0.04));
}

async function prepareSeedanceVideoPreviewImage(
  lastFrameSourceUrl: string | null | undefined,
  videoUrl: string,
  durationSeconds?: number | null
): Promise<string | null> {
  const normalizedLastFrameSource = lastFrameSourceUrl?.trim() ?? '';
  if (normalizedLastFrameSource) {
    try {
      const preparedPoster = await prepareNodeImage(normalizedLastFrameSource, 640);
      return preparedPoster.previewImageUrl ?? preparedPoster.imageUrl;
    } catch (error) {
      console.warn(
        '[seedance] failed to prepare returned last frame, falling back to video capture',
        error
      );
    }
  }

  try {
    const capturedPosterDataUrl = await captureVideoFrameFromSource(
      resolveVideoCaptureSource(videoUrl),
      resolvePosterCaptureTime(durationSeconds),
      960
    );
    const preparedPoster = await prepareNodeImage(capturedPosterDataUrl, 640);
    return preparedPoster.previewImageUrl ?? preparedPoster.imageUrl;
  } catch (error) {
    console.warn('[seedance] failed to capture video poster', error);
    return null;
  }
}

async function buildGeneratedVideoItem(task: Awaited<ReturnType<typeof getSeedanceVideoTask>>): Promise<SeedanceGeneratedVideoItem> {
  const rawVideoUrl = task.video_url?.trim() ?? '';
  if (!rawVideoUrl) {
    throw new Error('Seedance video result is missing a video URL');
  }

  const persistedVideoUrl = isTauri()
    ? await persistImageSource(rawVideoUrl)
    : rawVideoUrl;
  const previewImageUrl = await prepareSeedanceVideoPreviewImage(
    task.last_frame_url ?? null,
    persistedVideoUrl,
    task.duration ?? null
  );

  return {
    taskId: task.task_id,
    modelId: task.model ?? null,
    videoUrl: persistedVideoUrl,
    previewImageUrl,
    aspectRatio: normalizeSeedanceAspectRatio(task.ratio),
    duration: task.duration ?? undefined,
    resolution: task.resolution ?? normalizeSeedanceResolution(undefined),
    generateAudio: task.generate_audio ?? undefined,
    fileName: `seedance-${task.task_id}.mp4`,
  };
}

export async function querySeedanceVideoResult(
  payload: QuerySeedanceVideoResultPayload
): Promise<QuerySeedanceVideoResultResponse> {
  const task = await getSeedanceVideoTask({
    apiKey: payload.apiKey,
    taskId: payload.taskId,
  });

  const normalizedStatus = (task.status ?? '').trim().toLowerCase();
  if (normalizedStatus === 'queued' || normalizedStatus === 'running') {
    return {
      taskId: task.task_id,
      pending: true,
      status: normalizedStatus,
      createdAt: task.created_at ?? null,
      updatedAt: task.updated_at ?? null,
      errorMessage: null,
    };
  }

  if (normalizedStatus !== 'succeeded') {
    return {
      taskId: task.task_id,
      pending: false,
      status: normalizedStatus || 'unknown',
      createdAt: task.created_at ?? null,
      updatedAt: task.updated_at ?? null,
      errorMessage: task.error_message ?? 'Seedance task did not complete successfully',
    };
  }

  return {
    taskId: task.task_id,
    pending: false,
    status: normalizedStatus,
    createdAt: task.created_at ?? null,
    updatedAt: task.updated_at ?? null,
    video: await buildGeneratedVideoItem(task),
    errorMessage: null,
  };
}

export async function submitSeedanceVideoTask(
  payload: GenerateSeedanceVideoPayload
): Promise<SubmittedSeedanceVideoTaskResponse> {
  const normalizedApiKey = payload.apiKey.trim();
  if (!normalizedApiKey) {
    throw new Error('Volcengine API key is required for Seedance');
  }

  const normalizedPrompt = normalizeWhitespace(payload.prompt);
  if (!normalizedPrompt) {
    throw new Error('Prompt is required for Seedance video generation');
  }

  const inputMode = normalizeSeedanceInputMode(payload.inputMode);
  const [referenceImages, referenceVideos, referenceAudios] = await Promise.all([
    prepareReferenceImages(payload.referenceImageSources),
    prepareReferenceVideos(payload.referenceVideoSources),
    prepareReferenceAudios(payload.referenceAudioSources),
  ]);

  const createPayload: CreateSeedanceVideoTaskPayload = {
    apiKey: normalizedApiKey,
    model: normalizeSeedanceModelId(payload.modelId),
    content: buildSeedanceContentPayload({
      prompt: normalizedPrompt,
      inputMode,
      referenceImages,
      referenceVideos,
      referenceAudios,
    }),
    ratio: normalizeSeedanceAspectRatio(payload.aspectRatio),
    duration: normalizeSeedanceDurationSeconds(payload.durationSeconds),
    resolution: normalizeSeedanceResolution(payload.resolution),
    generateAudio: payload.generateAudio ?? true,
    returnLastFrame: payload.returnLastFrame ?? false,
    watermark: false,
  };

  const submitResponse = await createSeedanceVideoTask(createPayload);
  await payload.onSubmitted?.({ taskId: submitResponse.task_id });

  return {
    taskId: submitResponse.task_id,
    status: 'queued',
  };
}
