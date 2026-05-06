import { isTauri } from '@tauri-apps/api/core';

import {
  createGptBestVideoTask,
  getGptBestVideoTask,
  type CreateGptBestVideoTaskPayload,
} from '@/commands/gptBestVideo';
import { persistMediaSource } from '@/commands/media';
import {
  createPreviewDataUrl,
  prepareNodeImage,
} from '@/features/canvas/application/imageData';
import { createCurrentProjectMediaContext } from '@/features/canvas/application/mediaPersistenceContext';
import {
  captureVideoFrameFromSource,
  resolveVideoDisplayUrl,
} from '@/features/canvas/application/videoData';
import {
  GPT_BEST_GROK_VIDEO_MODEL_IDS,
  GPT_BEST_SEEDANCE_INPUT_MODES,
  GPT_BEST_SEEDANCE_MODEL_IDS,
  GPT_BEST_VIDEO_ASPECT_RATIOS,
  GPT_BEST_VIDEO_DURATION_SECONDS,
  GPT_BEST_VIDEO_RESOLUTIONS,
  type GptBestSeedanceInputMode,
  type GptBestVideoAspectRatio,
  type GptBestVideoDurationSeconds,
  type GptBestVideoResolution,
  type GptBestVideoSourceKind,
} from '@/features/canvas/domain/canvasNodes';

export const GPT_BEST_VIDEO_RESULT_POLL_INTERVAL_MS = 2_500;
const GPT_BEST_REFERENCE_IMAGE_MAX_DIMENSION = 1600;

export interface GenerateGptBestVideoPayload {
  apiKey: string;
  baseUrl: string;
  sourceKind: GptBestVideoSourceKind;
  prompt: string;
  modelId: string;
  inputMode?: GptBestSeedanceInputMode | string | null;
  aspectRatio?: GptBestVideoAspectRatio | string | null;
  durationSeconds?: GptBestVideoDurationSeconds | number | null;
  resolution?: GptBestVideoResolution | string | null;
  referenceImageSources?: string[];
  onSubmitted?: (payload: { taskId: string }) => void | Promise<void>;
}

export interface SubmittedGptBestVideoTaskResponse {
  taskId: string;
  status: 'queued';
}

export interface GptBestGeneratedVideoItem {
  taskId: string;
  modelId?: string | null;
  videoUrl: string;
  previewImageUrl?: string | null;
  aspectRatio: string;
  duration?: number;
  resolution?: string | null;
  fileName?: string | null;
}

export interface QueryGptBestVideoResultPayload {
  apiKey: string;
  baseUrl: string;
  taskId: string;
}

export interface QueryGptBestVideoResultResponse {
  taskId: string;
  pending: boolean;
  status: string;
  createdAt?: number | null;
  updatedAt?: number | null;
  video?: GptBestGeneratedVideoItem;
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

export function normalizeGptBestSeedanceInputMode(
  inputMode: GptBestSeedanceInputMode | string | null | undefined
): GptBestSeedanceInputMode {
  return GPT_BEST_SEEDANCE_INPUT_MODES.includes(inputMode as GptBestSeedanceInputMode)
    ? (inputMode as GptBestSeedanceInputMode)
    : 'textToVideo';
}

export function normalizeGptBestVideoAspectRatio(
  aspectRatio: GptBestVideoAspectRatio | string | null | undefined
): GptBestVideoAspectRatio {
  return GPT_BEST_VIDEO_ASPECT_RATIOS.includes(aspectRatio as GptBestVideoAspectRatio)
    ? (aspectRatio as GptBestVideoAspectRatio)
    : '16:9';
}

export function normalizeGptBestVideoDurationSeconds(
  duration: GptBestVideoDurationSeconds | number | null | undefined
): GptBestVideoDurationSeconds {
  return GPT_BEST_VIDEO_DURATION_SECONDS.includes(duration as GptBestVideoDurationSeconds)
    ? (duration as GptBestVideoDurationSeconds)
    : 5;
}

export function normalizeGptBestVideoResolution(
  resolution: GptBestVideoResolution | string | null | undefined
): GptBestVideoResolution {
  return GPT_BEST_VIDEO_RESOLUTIONS.includes(resolution as GptBestVideoResolution)
    ? (resolution as GptBestVideoResolution)
    : '720p';
}

export function normalizeGptBestVideoModel(
  sourceKind: GptBestVideoSourceKind,
  modelId: string | null | undefined
): string {
  const normalized = modelId?.trim() ?? '';
  if (sourceKind === 'grok') {
    return normalized || GPT_BEST_GROK_VIDEO_MODEL_IDS[0];
  }
  return normalized || GPT_BEST_SEEDANCE_MODEL_IDS[0];
}

async function prepareReferenceImages(sources: string[] | undefined): Promise<string[]> {
  const uniqueSources = normalizeUniqueSources(sources);
  if (uniqueSources.length === 0) {
    return [];
  }

  return await Promise.all(
    uniqueSources.map((source) =>
      createPreviewDataUrl(source, GPT_BEST_REFERENCE_IMAGE_MAX_DIMENSION)
    )
  );
}

function buildGrokPrompt(prompt: string, imageCount: number): string {
  if (imageCount <= 0) {
    return prompt;
  }

  const imageLabels = Array.from({ length: imageCount }, (_, index) => `@img${index + 1}`).join(', ');
  return [
    `Reference images are attached in order as ${imageLabels}.`,
    'When the prompt mentions one of these image tags, use the corresponding attached image.',
    '',
    prompt,
  ].join('\n');
}

function normalizeTaskStatus(
  status: string | null | undefined
): 'queued' | 'running' | 'succeeded' | 'failed' | 'unknown' {
  const normalized = status?.trim().toLowerCase() ?? '';
  switch (normalized) {
    case 'not_start':
    case 'not-start':
    case 'not start':
    case 'queued':
    case 'pending':
      return 'queued';
    case 'in_progress':
    case 'in-progress':
    case 'in progress':
    case 'running':
    case 'processing':
      return 'running';
    case 'success':
    case 'succeeded':
    case 'completed':
      return 'succeeded';
    case 'failure':
    case 'failed':
    case 'error':
      return 'failed';
    default:
      return 'unknown';
  }
}

function resolveVideoCaptureSource(source: string): string {
  const trimmedSource = source.trim();
  return trimmedSource ? resolveVideoDisplayUrl(trimmedSource) : trimmedSource;
}

function resolvePosterCaptureTime(durationSeconds?: number | null): number {
  if (!durationSeconds || !Number.isFinite(durationSeconds) || durationSeconds <= 0.18) {
    return 0;
  }
  return Math.min(0.12, Math.max(durationSeconds / 10, 0.04));
}

async function prepareGptBestVideoPreviewImage(
  lastFrameSourceUrl: string | null | undefined,
  videoUrl: string,
  durationSeconds?: number | null
): Promise<string | null> {
  const normalizedLastFrameSource = lastFrameSourceUrl?.trim() ?? '';
  if (normalizedLastFrameSource) {
    try {
      const preparedPoster = await prepareNodeImage(
        normalizedLastFrameSource,
        640,
        createCurrentProjectMediaContext('image', 'preview')
      );
      return preparedPoster.previewImageUrl ?? preparedPoster.imageUrl;
    } catch (error) {
      console.warn('[third-party-video] failed to prepare returned poster', error);
    }
  }

  try {
    const capturedPosterDataUrl = await captureVideoFrameFromSource(
      resolveVideoCaptureSource(videoUrl),
      resolvePosterCaptureTime(durationSeconds),
      960
    );
    const preparedPoster = await prepareNodeImage(
      capturedPosterDataUrl,
      640,
      createCurrentProjectMediaContext('image', 'preview')
    );
    return preparedPoster.previewImageUrl ?? preparedPoster.imageUrl;
  } catch (error) {
    console.warn('[third-party-video] failed to capture video poster', error);
    return null;
  }
}

async function buildGeneratedVideoItem(
  task: Awaited<ReturnType<typeof getGptBestVideoTask>>
): Promise<GptBestGeneratedVideoItem> {
  const rawVideoUrl = task.video_url?.trim() ?? '';
  if (!rawVideoUrl) {
    throw new Error('Third-party video result is missing a video URL');
  }

  const persistedVideoUrl = isTauri()
    ? await persistMediaSource(rawVideoUrl, createCurrentProjectMediaContext('video'))
    : rawVideoUrl;
  const previewImageUrl = await prepareGptBestVideoPreviewImage(
    task.last_frame_url ?? null,
    persistedVideoUrl,
    task.duration ?? null
  );

  return {
    taskId: task.task_id,
    modelId: task.model ?? null,
    videoUrl: persistedVideoUrl,
    previewImageUrl,
    aspectRatio: task.ratio ?? '16:9',
    duration: task.duration ?? undefined,
    resolution: task.resolution ?? null,
    fileName: `third-party-video-${task.task_id}.mp4`,
  };
}

export async function queryGptBestVideoResult(
  payload: QueryGptBestVideoResultPayload
): Promise<QueryGptBestVideoResultResponse> {
  const task = await getGptBestVideoTask({
    apiKey: payload.apiKey,
    baseUrl: payload.baseUrl,
    taskId: payload.taskId,
  });

  const normalizedStatus = normalizeTaskStatus(task.status);
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
      status: normalizedStatus,
      createdAt: task.created_at ?? null,
      updatedAt: task.updated_at ?? null,
      errorMessage: task.error_message ?? 'Third-party video task did not complete successfully',
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

export async function submitGptBestVideoTask(
  payload: GenerateGptBestVideoPayload
): Promise<SubmittedGptBestVideoTaskResponse> {
  const normalizedApiKey = payload.apiKey.trim();
  if (!normalizedApiKey) {
    throw new Error('Third-party video API key is required');
  }

  const normalizedBaseUrl = payload.baseUrl.trim();
  if (!normalizedBaseUrl) {
    throw new Error('Third-party video Base URL is required');
  }

  const normalizedPrompt = normalizeWhitespace(payload.prompt);
  if (!normalizedPrompt) {
    throw new Error('Prompt is required for third-party video generation');
  }

  const referenceImages = await prepareReferenceImages(payload.referenceImageSources);
  const createPayload: CreateGptBestVideoTaskPayload = {
    apiKey: normalizedApiKey,
    baseUrl: normalizedBaseUrl,
    model: normalizeGptBestVideoModel(payload.sourceKind, payload.modelId),
    prompt: payload.sourceKind === 'grok'
      ? buildGrokPrompt(normalizedPrompt, referenceImages.length)
      : normalizedPrompt,
    images: referenceImages,
    ratio: normalizeGptBestVideoAspectRatio(payload.aspectRatio),
    duration: normalizeGptBestVideoDurationSeconds(payload.durationSeconds),
    resolution: normalizeGptBestVideoResolution(payload.resolution),
  };

  const submitResponse = await createGptBestVideoTask(createPayload);
  await payload.onSubmitted?.({ taskId: submitResponse.task_id });

  return {
    taskId: submitResponse.task_id,
    status: 'queued',
  };
}
