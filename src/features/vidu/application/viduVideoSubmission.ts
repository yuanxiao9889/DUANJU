import { isTauri } from '@tauri-apps/api/core';

import {
  createViduVoiceClone,
  createViduVideoTask,
  getViduVideoTask,
  type CreateViduVideoTaskPayload,
} from '@/commands/vidu';
import { persistMediaSource } from '@/commands/media';
import {
  createPreviewDataUrl,
  prepareNodeImage,
} from '@/features/canvas/application/imageData';
import { createCurrentProjectMediaContext } from '@/features/canvas/application/mediaPersistenceContext';
import {
  captureVideoFrameFromSource,
  prepareNodeVideoFromSource,
  resolveVideoDisplayUrl,
  videoUrlToDataUrl,
} from '@/features/canvas/application/videoData';
import { useSettingsStore } from '@/stores/settingsStore';
import type {
  ViduAspectRatio,
  ViduDurationSeconds,
  ViduInputMode,
  ViduModelId,
  ViduResolution,
} from '@/features/canvas/domain/canvasNodes';
import {
  VIDU_REFERENCE_VIDEO_MAX_BASE64_BYTES,
  normalizeViduAspectRatio,
  normalizeViduDurationSecondsForRequest,
  normalizeViduInputMode,
  normalizeViduModelIdForInputMode,
  normalizeViduResolutionForRequest,
  isViduQ3Model,
} from '@/features/vidu/domain/viduOptions';

export const VIDU_VIDEO_RESULT_POLL_INTERVAL_MS = 2_500;
const VIDU_REFERENCE_IMAGE_MAX_DIMENSION = 1600;

export interface GenerateViduVideoPayload {
  apiKey: string;
  prompt: string;
  inputMode?: ViduInputMode | string | null;
  modelId?: ViduModelId | string | null;
  aspectRatio?: ViduAspectRatio | string | null;
  durationSeconds?: ViduDurationSeconds | number | null;
  resolution?: ViduResolution | string | null;
  audio?: boolean;
  bgm?: boolean;
  referenceImageSources?: string[];
  referenceVideoSources?: string[];
  referenceAudioSources?: string[];
}

export interface SubmittedViduVideoTaskResponse {
  taskId: string;
  status: 'queued';
}

export interface ViduGeneratedVideoItem {
  taskId: string;
  modelId?: string | null;
  videoUrl: string;
  previewImageUrl?: string | null;
  aspectRatio: string;
  duration?: number;
  resolution?: string | null;
  fileName?: string | null;
}

export interface QueryViduVideoResultPayload {
  apiKey: string;
  taskId: string;
}

export interface QueryViduVideoResultResponse {
  taskId: string;
  pending: boolean;
  status: string;
  createdAt?: number | null;
  updatedAt?: number | null;
  video?: ViduGeneratedVideoItem;
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

function isPublicHttpUrl(source: string): boolean {
  return /^https?:\/\//i.test(source.trim());
}

function createViduVoiceId(): string {
  const randomSuffix =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 18)
      : Math.random().toString(36).slice(2, 14);
  return `v${Date.now().toString(36)}${randomSuffix}`.slice(0, 32);
}

function buildVoiceCloneText(prompt: string): string {
  const normalized = normalizeWhitespace(prompt).slice(0, 600);
  return normalized || 'Vidu voice reference';
}

async function prepareReferenceImages(sources: string[] | undefined): Promise<string[]> {
  const uniqueSources = normalizeUniqueSources(sources);
  if (uniqueSources.length === 0) {
    return [];
  }

  return await Promise.all(
    uniqueSources.map((source) =>
      createPreviewDataUrl(source, VIDU_REFERENCE_IMAGE_MAX_DIMENSION)
    )
  );
}

function estimateBase64Bytes(dataUrl: string): number {
  const payload = dataUrl.split(',', 2)[1] ?? dataUrl;
  const padding = payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((payload.length * 3) / 4) - padding);
}

async function prepareReferenceVideos(sources: string[] | undefined): Promise<string[]> {
  const uniqueSources = normalizeUniqueSources(sources);
  if (uniqueSources.length === 0) {
    return [];
  }

  const videos = await Promise.all(uniqueSources.map((source) => videoUrlToDataUrl(source)));
  const oversized = videos.find((video) => estimateBase64Bytes(video) > VIDU_REFERENCE_VIDEO_MAX_BASE64_BYTES);
  if (oversized) {
    throw new Error('Vidu reference video exceeds the official size limit');
  }
  return videos;
}

async function prepareVoiceReferenceId(input: {
  apiKey: string;
  inputMode: ViduInputMode;
  model: string;
  prompt: string;
  referenceAudioSources?: string[];
}): Promise<string | undefined> {
  const uniqueAudioSources = normalizeUniqueSources(input.referenceAudioSources);
  if (uniqueAudioSources.length === 0) {
    return undefined;
  }

  if (uniqueAudioSources.length > 1) {
    throw new Error('Vidu voice reference supports one audio source at a time');
  }

  if (input.inputMode !== 'firstFrame' && input.inputMode !== 'reference') {
    throw new Error('Vidu voice reference is only available for image-to-video or reference-to-video modes');
  }

  if (input.inputMode === 'reference' && isViduQ3Model(input.model)) {
    throw new Error('Vidu Q3 reference-to-video does not support voice_id voice reference. Switch to a Q2/Q1/2.0 model.');
  }

  const audioUrl = uniqueAudioSources[0];
  if (!isPublicHttpUrl(audioUrl)) {
    throw new Error('Vidu voice clone requires a public https audio URL. Local audio files cannot be used as Vidu voice references yet.');
  }

  const voiceId = createViduVoiceId();
  const response = await createViduVoiceClone({
    apiKey: input.apiKey,
    audioUrl,
    voiceId,
    text: buildVoiceCloneText(input.prompt),
  });

  return response.voice_id?.trim() || voiceId;
}

function normalizeTaskStatus(
  status: string | null | undefined
): 'queued' | 'running' | 'succeeded' | 'failed' | 'unknown' {
  const normalized = status?.trim().toLowerCase() ?? '';
  switch (normalized) {
    case 'created':
    case 'queueing':
    case 'queued':
    case 'pending':
      return 'queued';
    case 'processing':
    case 'running':
      return 'running';
    case 'success':
    case 'succeeded':
    case 'completed':
      return 'succeeded';
    case 'failed':
    case 'failure':
    case 'error':
      return 'failed';
    default:
      return 'unknown';
  }
}

function parseViduTimestamp(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
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

async function prepareViduVideoPreviewImage(
  coverSourceUrl: string | null | undefined,
  videoUrl: string,
  durationSeconds?: number | null
): Promise<string | null> {
  const normalizedCoverSource = coverSourceUrl?.trim() ?? '';
  if (normalizedCoverSource) {
    try {
      const preparedPoster = await prepareNodeImage(
        normalizedCoverSource,
        640,
        createCurrentProjectMediaContext('image', 'preview'),
        useSettingsStore.getState().canvasOverviewThumbnailMaxDimension
      );
      return preparedPoster.previewImageUrl ?? preparedPoster.imageUrl;
    } catch (error) {
      console.warn('[vidu] failed to prepare returned cover', error);
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
      createCurrentProjectMediaContext('image', 'preview'),
      useSettingsStore.getState().canvasOverviewThumbnailMaxDimension
    );
    return preparedPoster.previewImageUrl ?? preparedPoster.imageUrl;
  } catch (error) {
    console.warn('[vidu] failed to capture video poster', error);
    return null;
  }
}

async function buildGeneratedVideoItem(
  task: Awaited<ReturnType<typeof getViduVideoTask>>
): Promise<ViduGeneratedVideoItem> {
  const primaryCreation = task.creations[0] ?? null;
  const rawVideoUrl =
    primaryCreation?.url?.trim()
    || primaryCreation?.watermarked_url?.trim()
    || '';
  if (!rawVideoUrl) {
    throw new Error('Vidu result is missing a video URL');
  }

  let preparedVideo: Awaited<ReturnType<typeof prepareNodeVideoFromSource>> | null = null;
  let persistedVideoUrl = rawVideoUrl;

  try {
    preparedVideo = await prepareNodeVideoFromSource(
      rawVideoUrl,
      createCurrentProjectMediaContext('video')
    );
    persistedVideoUrl = preparedVideo.videoUrl;
  } catch (error) {
    console.warn('[vidu] failed to inspect generated video metadata', error);
    persistedVideoUrl = isTauri()
      ? await persistMediaSource(rawVideoUrl, createCurrentProjectMediaContext('video'))
      : rawVideoUrl;
  }

  let previewImageUrl = preparedVideo?.previewImageUrl ?? null;
  if (primaryCreation?.cover_url || !previewImageUrl) {
    previewImageUrl = await prepareViduVideoPreviewImage(
      primaryCreation?.cover_url ?? null,
      persistedVideoUrl,
      task.duration ?? preparedVideo?.duration ?? null
    );
  }

  return {
    taskId: task.id,
    modelId: task.model ?? null,
    videoUrl: persistedVideoUrl,
    previewImageUrl,
    aspectRatio: task.aspect_ratio ?? preparedVideo?.aspectRatio ?? '16:9',
    duration: task.duration ?? preparedVideo?.duration ?? undefined,
    resolution: task.resolution ?? null,
    fileName: `vidu-video-${task.id}.mp4`,
  };
}

export async function queryViduVideoResult(
  payload: QueryViduVideoResultPayload
): Promise<QueryViduVideoResultResponse> {
  const task = await getViduVideoTask({
    apiKey: payload.apiKey,
    taskId: payload.taskId,
  });

  const normalizedStatus = normalizeTaskStatus(task.state);
  const createdAt = parseViduTimestamp(task.created_at);
  const updatedAt = parseViduTimestamp(task.updated_at);

  if (normalizedStatus === 'queued' || normalizedStatus === 'running') {
    return {
      taskId: task.id,
      pending: true,
      status: normalizedStatus,
      createdAt,
      updatedAt,
      errorMessage: null,
    };
  }

  if (normalizedStatus !== 'succeeded') {
    return {
      taskId: task.id,
      pending: false,
      status: normalizedStatus,
      createdAt,
      updatedAt,
      errorMessage: task.err_code ?? 'Vidu task did not complete successfully',
    };
  }

  return {
    taskId: task.id,
    pending: false,
    status: normalizedStatus,
    createdAt,
    updatedAt,
    video: await buildGeneratedVideoItem(task),
    errorMessage: null,
  };
}

export async function submitViduVideoTask(
  payload: GenerateViduVideoPayload
): Promise<SubmittedViduVideoTaskResponse> {
  const normalizedApiKey = payload.apiKey.trim();
  if (!normalizedApiKey) {
    throw new Error('Vidu API key is required');
  }

  const normalizedPrompt = normalizeWhitespace(payload.prompt);
  if (!normalizedPrompt) {
    throw new Error('Prompt is required for Vidu video generation');
  }

  const inputMode = normalizeViduInputMode(payload.inputMode);
  const [referenceImages, referenceVideos] = await Promise.all([
    prepareReferenceImages(payload.referenceImageSources),
    prepareReferenceVideos(payload.referenceVideoSources),
  ]);

  const model = normalizeViduModelIdForInputMode(payload.modelId, inputMode);
  const q3Model = isViduQ3Model(model);
  const duration = normalizeViduDurationSecondsForRequest(
    payload.durationSeconds,
    model,
    inputMode
  );
  const resolution = normalizeViduResolutionForRequest(
    payload.resolution,
    model,
    duration
  );
  const voiceId = await prepareVoiceReferenceId({
    apiKey: normalizedApiKey,
    inputMode,
    model,
    prompt: normalizedPrompt,
    referenceAudioSources: payload.referenceAudioSources,
  });

  const createPayload: CreateViduVideoTaskPayload = {
    apiKey: normalizedApiKey,
    inputMode,
    model,
    prompt: normalizedPrompt,
    images: referenceImages,
    videos: inputMode === 'reference' ? referenceVideos : [],
    aspectRatio: inputMode === 'textToVideo' || inputMode === 'reference'
      ? normalizeViduAspectRatio(payload.aspectRatio)
      : undefined,
    duration,
    resolution,
    audio: voiceId ? true : q3Model ? (payload.audio ?? true) : undefined,
    bgm: !q3Model && payload.bgm ? true : undefined,
    voiceId,
  };

  const submitResponse = await createViduVideoTask(createPayload);

  return {
    taskId: submitResponse.task_id,
    status: 'queued',
  };
}
