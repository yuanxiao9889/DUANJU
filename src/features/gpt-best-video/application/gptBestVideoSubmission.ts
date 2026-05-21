import {
  createGptBestVideoTask,
  downloadGptBestVideoContent,
  getGptBestVideoTask,
  type CreateGptBestVideoTaskPayload,
  type OopiiVideoImageInput,
} from '@/commands/gptBestVideo';
import {
  createPreviewDataUrl,
  prepareNodeImage,
} from '@/features/canvas/application/imageData';
import { createCurrentProjectMediaContext } from '@/features/canvas/application/mediaPersistenceContext';
import { findReferenceTokens } from '@/features/canvas/application/referenceTokenEditing';
import {
  captureVideoFrameFromSource,
  resolveVideoDisplayUrl,
} from '@/features/canvas/application/videoData';
import { useSettingsStore } from '@/stores/settingsStore';
import { type GptBestVideoSourceKind } from '@/features/canvas/domain/canvasNodes';
import {
  normalizeOopiiVideoModelId,
  normalizeOopiiVideoSeconds,
  normalizeOopiiVideoSize,
  resolveAllowedSecondsForOopiiVideoModel,
  resolveAspectRatioFromOopiiVideoSize,
  type OopiiVideoModelId,
  type OopiiVideoSecondsOption,
  type OopiiVideoSizeOption,
} from '@/features/gpt-best-video/domain/oopiiVideoModels';

export const GPT_BEST_VIDEO_RESULT_POLL_INTERVAL_MS = 2_500;
const OOPII_GROK_REFERENCE_IMAGE_LIMIT = 7;
const OOPII_VIDEO_REFERENCE_IMAGE_MAX_BYTES = 950 * 1024;
const OOPII_VIDEO_REFERENCE_IMAGE_COMPRESSION_STEPS = [
  { maxDimension: 1280, quality: 0.82 },
  { maxDimension: 1024, quality: 0.78 },
  { maxDimension: 896, quality: 0.74 },
  { maxDimension: 768, quality: 0.72 },
  { maxDimension: 640, quality: 0.7 },
] as const;

export interface GenerateGptBestVideoPayload {
  apiKey: string;
  baseUrl: string;
  sourceKind: GptBestVideoSourceKind;
  prompt: string;
  modelId: string;
  seconds?: OopiiVideoSecondsOption | number | null;
  size?: OopiiVideoSizeOption | string | null;
  legacyAspectRatio?: string | null;
  legacyResolution?: string | null;
  firstFrameImageSource?: string | null;
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
  size?: string | null;
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

function isGrokReferenceVideoModel(modelId: OopiiVideoModelId): boolean {
  return modelId === 'OK-video';
}

function mapPromptReferenceTokensToOopiiTokens(
  prompt: string,
  maxReferenceCount: number
): string {
  const referenceTokens = findReferenceTokens(prompt, maxReferenceCount);
  if (referenceTokens.length === 0) {
    return prompt;
  }

  let nextPrompt = prompt;
  for (let index = referenceTokens.length - 1; index >= 0; index -= 1) {
    const token = referenceTokens[index];
    nextPrompt = `${nextPrompt.slice(0, token.start)}<IMAGE_${token.value}>${nextPrompt.slice(token.end)}`;
  }
  return nextPrompt;
}

function promptHasOopiiReferenceTokens(prompt: string): boolean {
  return /<IMAGE_[1-7]>/i.test(prompt);
}

function ensurePromptReferencesOopiiImages(
  prompt: string,
  referenceImageCount: number
): string {
  if (referenceImageCount <= 0 || promptHasOopiiReferenceTokens(prompt)) {
    return prompt;
  }

  const referencePrefix = Array.from(
    { length: Math.min(referenceImageCount, OOPII_GROK_REFERENCE_IMAGE_LIMIT) },
    (_, index) => `<IMAGE_${index + 1}>`
  ).join(' ');
  return normalizeWhitespace(`${referencePrefix} ${prompt}`);
}

function isHttpsUrl(value: string): boolean {
  return /^https:\/\//i.test(value.trim());
}

async function prepareOopiiVideoImageDataUrl(source: string): Promise<string> {
  let fallback = '';
  for (const step of OOPII_VIDEO_REFERENCE_IMAGE_COMPRESSION_STEPS) {
    const dataUrl = await createPreviewDataUrl(source, step.maxDimension, {
      mimeType: 'image/jpeg',
      quality: step.quality,
      forceRender: true,
    });
    fallback = dataUrl;
    if (new Blob([dataUrl]).size <= OOPII_VIDEO_REFERENCE_IMAGE_MAX_BYTES) {
      return dataUrl;
    }
  }
  return fallback;
}

async function prepareOopiiVideoImageInput(
  source: string
): Promise<OopiiVideoImageInput> {
  const normalizedSource = source.trim();
  if (isHttpsUrl(normalizedSource)) {
    return { url: normalizedSource };
  }

  const dataUrl = await prepareOopiiVideoImageDataUrl(normalizedSource);
  return { url: dataUrl };
}

async function prepareOopiiVideoReferenceImages(
  sources: string[] | undefined
): Promise<OopiiVideoImageInput[]> {
  const uniqueSources = normalizeUniqueSources(sources).slice(0, OOPII_GROK_REFERENCE_IMAGE_LIMIT);
  if (uniqueSources.length === 0) {
    return [];
  }

  return await Promise.all(uniqueSources.map((source) => prepareOopiiVideoImageInput(source)));
}

export function normalizeGptBestVideoModel(
  sourceKind: GptBestVideoSourceKind,
  modelId: string | null | undefined
): OopiiVideoModelId {
  return normalizeOopiiVideoModelId(sourceKind, modelId);
}

export function normalizeGptBestVideoSeconds(
  sourceKind: GptBestVideoSourceKind,
  modelId: string | null | undefined,
  seconds: number | string | null | undefined
): OopiiVideoSecondsOption {
  return normalizeOopiiVideoSeconds(
    normalizeOopiiVideoModelId(sourceKind, modelId),
    seconds
  );
}

export function normalizeGptBestVideoSize(
  sourceKind: GptBestVideoSourceKind,
  size: string | null | undefined,
  legacyAspectRatio?: string | null,
  legacyResolution?: string | null
): OopiiVideoSizeOption {
  return normalizeOopiiVideoSize(sourceKind, size, legacyAspectRatio, legacyResolution);
}

export function resolveAllowedSecondsForGptBestVideoModel(
  sourceKind: GptBestVideoSourceKind,
  modelId: string | null | undefined
): readonly OopiiVideoSecondsOption[] {
  return resolveAllowedSecondsForOopiiVideoModel(
    normalizeOopiiVideoModelId(sourceKind, modelId)
  );
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
    case 'submitted':
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
    case 'canceled':
    case 'cancelled':
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
      createCurrentProjectMediaContext('image', 'preview'),
      useSettingsStore.getState().canvasOverviewThumbnailMaxDimension
    );
    return preparedPoster.previewImageUrl ?? preparedPoster.imageUrl;
  } catch (error) {
    console.warn('[third-party-video] failed to capture video poster', error);
    return null;
  }
}

async function buildGeneratedVideoItem(
  task: Awaited<ReturnType<typeof getGptBestVideoTask>>,
  payload: QueryGptBestVideoResultPayload
): Promise<GptBestGeneratedVideoItem> {
  const downloadedVideo = await downloadGptBestVideoContent({
    apiKey: payload.apiKey,
    baseUrl: payload.baseUrl,
    taskId: payload.taskId,
    mediaContext: createCurrentProjectMediaContext('video'),
  });

  const persistedVideoUrl = downloadedVideo.video_url.trim();
  if (!persistedVideoUrl) {
    throw new Error('Third-party video content download did not return a saved video path');
  }

  const normalizedSize = task.size?.trim() ?? null;
  const normalizedSeconds = task.seconds ?? undefined;
  const previewImageUrl = await prepareGptBestVideoPreviewImage(
    task.cover_url ?? null,
    persistedVideoUrl,
    normalizedSeconds ?? null
  );

  return {
    taskId: task.task_id,
    modelId: task.model ?? null,
    videoUrl: persistedVideoUrl,
    previewImageUrl,
    aspectRatio: resolveAspectRatioFromOopiiVideoSize(normalizedSize),
    duration: normalizedSeconds,
    size: normalizedSize,
    fileName: downloadedVideo.file_name ?? `third-party-video-${task.task_id}.mp4`,
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
    video: await buildGeneratedVideoItem(task, payload),
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

  const normalizedModelId = normalizeOopiiVideoModelId(payload.sourceKind, payload.modelId);
  const normalizedSeconds = normalizeOopiiVideoSeconds(normalizedModelId, payload.seconds);
  const normalizedSize = normalizeOopiiVideoSize(
    payload.sourceKind,
    payload.size,
    payload.legacyAspectRatio,
    payload.legacyResolution
  );
  const referenceImageSources = normalizeUniqueSources(payload.referenceImageSources);
  if (
    isGrokReferenceVideoModel(normalizedModelId)
    && referenceImageSources.length > OOPII_GROK_REFERENCE_IMAGE_LIMIT
  ) {
    throw new Error(`Grok video supports up to ${OOPII_GROK_REFERENCE_IMAGE_LIMIT} reference images`);
  }
  const referenceImages = isGrokReferenceVideoModel(normalizedModelId)
    ? await prepareOopiiVideoReferenceImages(referenceImageSources)
    : [];
  const firstFrameImageSource = payload.firstFrameImageSource?.trim() ?? '';
  const firstFrameImage = firstFrameImageSource
    ? await prepareOopiiVideoImageInput(firstFrameImageSource)
    : null;
  const promptWithReferenceTokens = isGrokReferenceVideoModel(normalizedModelId)
    ? ensurePromptReferencesOopiiImages(
      mapPromptReferenceTokensToOopiiTokens(
        normalizedPrompt,
        Math.min(referenceImages.length || OOPII_GROK_REFERENCE_IMAGE_LIMIT, OOPII_GROK_REFERENCE_IMAGE_LIMIT)
      ),
      referenceImages.length
    )
    : normalizedPrompt;

  const createPayload: CreateGptBestVideoTaskPayload = {
    apiKey: normalizedApiKey,
    baseUrl: normalizedBaseUrl,
    model: normalizedModelId,
    prompt: promptWithReferenceTokens,
    seconds: normalizedSeconds,
    size: normalizedSize,
    image: firstFrameImage,
    referenceImages,
  };

  const submitResponse = await createGptBestVideoTask(createPayload);
  await payload.onSubmitted?.({ taskId: submitResponse.task_id });

  return {
    taskId: submitResponse.task_id,
    status: 'queued',
  };
}
