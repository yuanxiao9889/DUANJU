import {
  type JimengDreaminaGeneratedVideoResult,
  submitJimengDreaminaVideos,
  queryJimengDreaminaVideoResult,
} from "@/commands/dreaminaCli";
import { persistImageSource } from "@/commands/image";
import { captureVideoFrameFromSource } from "@/features/canvas/application/videoData";
import {
  prepareNodeImage,
  reduceAspectRatio,
} from "@/features/canvas/application/imageData";
import type {
  JimengAspectRatio,
  JimengDurationSeconds,
  JimengGeneratedVideoItem,
  JimengReferenceMode,
  JimengVideoModelId,
  JimengVideoResolution,
} from "@/features/canvas/domain/canvasNodes";
import {
  buildJimengSubmissionPrompt,
  prepareJimengReferenceAudios,
  prepareJimengReferenceImages,
  prepareJimengReferenceVideos,
} from "@/features/jimeng/application/jimengSubmission";
import {
  normalizeJimengReferenceMode,
  normalizeJimengVideoModel,
  resolveJimengVideoRequiredReferenceImageCount,
} from "@/features/jimeng/domain/jimengOptions";
import { convertFileSrc, isTauri } from "@tauri-apps/api/core";

const LEGACY_VIDEO_MODEL_MAP: Record<string, JimengVideoModelId> = {
  "seedance-2.0-fast": "seedance2.0fast",
  "seedance-2.0": "seedance2.0",
  "seedance-1.5-pro": "seedance2.0",
  "seedance-1.0": "seedance2.0",
  "seedance-1.0-fast": "seedance2.0fast",
  "seedance-1.0-mini": "seedance2.0fast",
};

const VIDEO_RESULT_POLL_INTERVAL_MS = 2_500;
const VIDEO_RESULT_TIMEOUT_MS = 10 * 60 * 1000;
const DREAMINA_MULTIMODAL_MAX_REFERENCE_VIDEOS = 3;

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, delayMs);
  });
}

function normalizeVideoModelVersion(
  value: JimengVideoModelId | string | null | undefined,
): JimengVideoModelId | undefined {
  const normalized = value?.trim().toLowerCase() ?? "";
  if (!normalized) {
    return undefined;
  }

  if (normalized in LEGACY_VIDEO_MODEL_MAP) {
    return LEGACY_VIDEO_MODEL_MAP[normalized];
  }

  return normalizeJimengVideoModel(normalized);
}

function normalizeReferenceMode(
  value: JimengReferenceMode | string | null | undefined,
): JimengReferenceMode | undefined {
  const normalized = value?.trim() ?? "";
  return normalized ? normalizeJimengReferenceMode(normalized) : undefined;
}

function normalizeAspectRatio(
  value: JimengAspectRatio | string | null | undefined,
): JimengAspectRatio | undefined {
  const normalized = value?.trim() ?? "";
  const allowed: JimengAspectRatio[] = [
    "21:9",
    "16:9",
    "4:3",
    "1:1",
    "3:4",
    "9:16",
  ];
  return allowed.find((item) => item === normalized) ?? undefined;
}

function normalizeDuration(
  value: JimengDurationSeconds | number | null | undefined,
): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }

  return Math.max(4, Math.min(15, Math.round(value)));
}

function normalizeVideoResolution(
  value: JimengVideoResolution | string | null | undefined,
): JimengVideoResolution | undefined {
  const normalized = value?.trim().toLowerCase() ?? "";
  const allowed: JimengVideoResolution[] = ["720p", "1080p"];
  return allowed.find((item) => item === normalized) ?? "1080p";
}

export interface GenerateJimengVideosPayload {
  prompt: string;
  modelVersion?: JimengVideoModelId | string;
  referenceMode?: JimengReferenceMode | string;
  aspectRatio?: JimengAspectRatio | string;
  durationSeconds?: JimengDurationSeconds | number;
  videoResolution?: JimengVideoResolution | string;
  referenceImageSources?: string[];
  referenceVideoSources?: string[];
  referenceAudioSources?: string[];
  onSubmitted?: (payload: { submitId: string }) => void | Promise<void>;
}

export interface GeneratedJimengVideosResponse {
  videos: JimengGeneratedVideoItem[];
  submitId: string;
}

export interface QueryJimengVideoResultPayload {
  submitId: string;
}

export interface QueryJimengVideoResultResponse {
  videos: JimengGeneratedVideoItem[];
  submitId: string;
  pending: boolean;
  warnings: string[];
}

function resolveVideoCaptureSource(source: string): string {
  const trimmedSource = source.trim();
  if (!trimmedSource) {
    return trimmedSource;
  }

  if (
    trimmedSource.startsWith("blob:") ||
    trimmedSource.startsWith("data:") ||
    trimmedSource.startsWith("asset:") ||
    trimmedSource.startsWith("http://") ||
    trimmedSource.startsWith("https://")
  ) {
    return trimmedSource;
  }

  return isTauri() ? convertFileSrc(trimmedSource) : trimmedSource;
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

async function prepareJimengVideoPreviewImage(
  posterSourceUrl: string | null | undefined,
  videoUrl: string,
  durationSeconds?: number | null,
): Promise<string | null> {
  const normalizedPosterSource = posterSourceUrl?.trim() ?? "";
  if (normalizedPosterSource && !normalizedPosterSource.startsWith("blob:")) {
    try {
      const preparedPoster = await prepareNodeImage(
        normalizedPosterSource,
        640,
      );
      return preparedPoster.previewImageUrl ?? preparedPoster.imageUrl;
    } catch (error) {
      console.warn(
        "[jimengVideo] failed to prepare poster image, falling back to video capture",
        error,
      );
    }
  }

  try {
    const capturedPosterDataUrl = await captureVideoFrameFromSource(
      resolveVideoCaptureSource(videoUrl),
      resolvePosterCaptureTime(durationSeconds),
      960,
    );
    const preparedPoster = await prepareNodeImage(capturedPosterDataUrl, 640);
    return preparedPoster.previewImageUrl ?? preparedPoster.imageUrl;
  } catch (error) {
    console.warn("[jimengVideo] failed to capture video poster", error);
    return null;
  }
}

async function buildGeneratedVideoItem(
  sourceResult: JimengDreaminaGeneratedVideoResult,
  index: number,
): Promise<JimengGeneratedVideoItem> {
  const rawSourceUrl = sourceResult.sourceUrl?.trim() ?? "";
  if (!rawSourceUrl) {
    throw new Error("Jimeng video result is missing a source URL");
  }

  const persistedVideoUrl = isTauri()
    ? await persistImageSource(rawSourceUrl)
    : rawSourceUrl;
  const previewImageUrl = await prepareJimengVideoPreviewImage(
    null,
    persistedVideoUrl,
    sourceResult.durationSeconds,
  );
  const aspectRatio =
    sourceResult.width && sourceResult.height
      ? reduceAspectRatio(sourceResult.width, sourceResult.height)
      : "16:9";

  return {
    id: `jimeng-video-${Date.now()}-${index + 1}`,
    sourceUrl: rawSourceUrl,
    posterSourceUrl: null,
    videoUrl: persistedVideoUrl,
    previewImageUrl,
    aspectRatio,
    duration: sourceResult.durationSeconds ?? undefined,
    width: sourceResult.width ?? undefined,
    height: sourceResult.height ?? undefined,
    fileName: sourceResult.fileName ?? `jimeng-video-${index + 1}.mp4`,
  } satisfies JimengGeneratedVideoItem;
}

export async function generateJimengVideos(
  payload: GenerateJimengVideosPayload,
): Promise<GeneratedJimengVideosResponse> {
  const normalizedPrompt = buildJimengSubmissionPrompt(payload.prompt);
  if (!normalizedPrompt) {
    throw new Error("Prompt is required for Jimeng video submission");
  }

  const normalizedReferenceMode = normalizeReferenceMode(payload.referenceMode);

  const [referenceImages, referenceVideos, referenceAudios] = await Promise.all(
    [
      prepareJimengReferenceImages(payload.referenceImageSources),
      prepareJimengReferenceVideos(payload.referenceVideoSources),
      prepareJimengReferenceAudios(payload.referenceAudioSources),
    ],
  );

  const hasReferenceVideos = referenceVideos.length > 0;
  if (referenceVideos.length > DREAMINA_MULTIMODAL_MAX_REFERENCE_VIDEOS) {
    throw new Error(
      `Dreamina CLI currently supports at most ${DREAMINA_MULTIMODAL_MAX_REFERENCE_VIDEOS} reference videos in multimodal2video.`,
    );
  }
  const requiredReferenceImageCount = hasReferenceVideos
    ? null
    : resolveJimengVideoRequiredReferenceImageCount(normalizedReferenceMode);
  if (
    typeof requiredReferenceImageCount === "number" &&
    referenceImages.length !== requiredReferenceImageCount
  ) {
    throw new Error(
      `Jimeng video mode ${normalizedReferenceMode} requires exactly ${requiredReferenceImageCount} reference images`,
    );
  }

  const submitResponse = await submitJimengDreaminaVideos({
    prompt: normalizedPrompt,
    referenceMode: normalizedReferenceMode,
    aspectRatio: normalizeAspectRatio(payload.aspectRatio),
    durationSeconds: normalizeDuration(payload.durationSeconds),
    videoResolution: normalizeVideoResolution(payload.videoResolution),
    modelVersion: normalizeVideoModelVersion(payload.modelVersion),
    referenceImages,
    referenceVideos,
    referenceAudios,
    timeoutMs: VIDEO_RESULT_TIMEOUT_MS,
  });

  await payload.onSubmitted?.({ submitId: submitResponse.submitId });

  const deadlineAt = Date.now() + VIDEO_RESULT_TIMEOUT_MS;
  let lastResponse: QueryJimengVideoResultResponse | null = null;

  while (Date.now() < deadlineAt) {
    lastResponse = await queryJimengVideoResult({
      submitId: submitResponse.submitId,
    });

    if (!lastResponse.pending) {
      break;
    }

    await sleep(VIDEO_RESULT_POLL_INTERVAL_MS);
  }

  if (!lastResponse) {
    throw new Error("Jimeng video generation did not return any query result");
  }

  if (lastResponse.videos.length === 0) {
    if (lastResponse.pending) {
      throw new Error(
        `Dreamina video generation timed out while waiting for submit_id=${submitResponse.submitId}`,
      );
    }

    throw new Error(
      "Dreamina video generation did not return any downloadable results",
    );
  }

  return {
    videos: lastResponse.videos,
    submitId: lastResponse.submitId,
  };
}

export async function queryJimengVideoResult(
  payload: QueryJimengVideoResultPayload,
): Promise<QueryJimengVideoResultResponse> {
  const response = await queryJimengDreaminaVideoResult({
    submitId: payload.submitId,
  });

  return {
    videos: await Promise.all(
      response.results.map((result, index) =>
        buildGeneratedVideoItem(result, index),
      ),
    ),
    submitId: response.submitId,
    pending: response.pending,
    warnings: response.warnings,
  };
}
