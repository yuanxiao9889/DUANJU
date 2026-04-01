import {
  type JimengDreaminaGeneratedImageResult,
  submitJimengDreaminaImages,
  queryJimengDreaminaImageResults,
} from "@/commands/dreaminaCli";
import { prepareNodeImage } from "@/features/canvas/application/imageData";
import type {
  JimengAspectRatio,
  JimengGeneratedImageItem,
  JimengImageModelVersion,
  JimengImageResolutionType,
} from "@/features/canvas/domain/canvasNodes";
import {
  buildJimengSubmissionPrompt,
  prepareJimengReferenceImages,
} from "@/features/jimeng/application/jimengSubmission";
import {
  jimengImageModelSupportsReferenceImages,
  normalizeJimengImageResolutionForModel,
} from "@/features/jimeng/domain/jimengOptions";

const LEGACY_IMAGE_MODEL_VERSION_MAP: Record<string, JimengImageModelVersion> =
  {
    "seedance-2.0-fast": "5.0",
    "seedance-2.0": "5.0",
    "seedance-1.5-pro": "4.6",
    "seedance-1.0": "4.1",
    "seedance-1.0-fast": "4.0",
    "seedance-1.0-mini": "3.1",
  };

const IMAGE_RESULT_POLL_INTERVAL_MS = 2_500;
const IMAGE_RESULT_TIMEOUT_MS = 12 * 60 * 1000;

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, delayMs);
  });
}

function normalizeImageModelVersion(
  value: JimengImageModelVersion | string | null | undefined,
): JimengImageModelVersion | undefined {
  const normalized = value?.trim().toLowerCase() ?? "";
  if (!normalized) {
    return undefined;
  }

  if (normalized in LEGACY_IMAGE_MODEL_VERSION_MAP) {
    return LEGACY_IMAGE_MODEL_VERSION_MAP[normalized];
  }

  const allowed: JimengImageModelVersion[] = [
    "3.0",
    "3.1",
    "4.0",
    "4.1",
    "4.5",
    "4.6",
    "5.0",
    "lab",
  ];
  return allowed.find((item) => item === normalized) ?? undefined;
}

function normalizeImageResolutionType(
  value: JimengImageResolutionType | string | null | undefined,
): JimengImageResolutionType | undefined {
  const normalized = value?.trim().toLowerCase() ?? "";
  const allowed: JimengImageResolutionType[] = ["1k", "2k", "4k"];
  return allowed.find((item) => item === normalized) ?? undefined;
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

export interface GenerateJimengImagesPayload {
  prompt: string;
  aspectRatio?: JimengAspectRatio | string;
  resolutionType?: JimengImageResolutionType | string;
  modelVersion?: JimengImageModelVersion | string;
  referenceImageSources?: string[];
  onSubmitted?: (payload: { submitIds: string[] }) => void | Promise<void>;
}

export interface GeneratedJimengImagesResponse {
  images: JimengGeneratedImageItem[];
  submitIds: string[];
}

export interface QueryJimengImagesResultPayload {
  submitIds: string[];
  aspectRatio?: JimengAspectRatio | string;
}

export interface QueryJimengImagesResultResponse {
  images: JimengGeneratedImageItem[];
  submitIds: string[];
  pendingSubmitIds: string[];
  failedSubmitIds: string[];
  warnings: string[];
}

async function buildGeneratedImageItems(
  generatedImages: JimengDreaminaGeneratedImageResult[],
  aspectRatio: JimengAspectRatio | undefined,
): Promise<JimengGeneratedImageItem[]> {
  return await Promise.all(
    generatedImages.map(async (result, index) => {
      const prepared = await prepareNodeImage(result.sourceUrl);
      return {
        id: `jimeng-image-${Date.now()}-${index + 1}`,
        sourceUrl: result.sourceUrl,
        imageUrl: prepared.imageUrl,
        previewImageUrl: prepared.previewImageUrl,
        aspectRatio: aspectRatio ?? "1:1",
        width: result.width ?? undefined,
        height: result.height ?? undefined,
        fileName: result.fileName ?? `jimeng-image-${index + 1}.png`,
      } satisfies JimengGeneratedImageItem;
    }),
  );
}

export async function generateJimengImages(
  payload: GenerateJimengImagesPayload,
): Promise<GeneratedJimengImagesResponse> {
  const normalizedPrompt = buildJimengSubmissionPrompt(payload.prompt);
  if (!normalizedPrompt) {
    throw new Error("Prompt is required for Jimeng image generation");
  }

  const normalizedModelVersion = normalizeImageModelVersion(
    payload.modelVersion,
  );
  const referenceImages = await prepareJimengReferenceImages(
    payload.referenceImageSources,
  );
  if (
    !jimengImageModelSupportsReferenceImages(normalizedModelVersion) &&
    referenceImages.length > 0
  ) {
    throw new Error(
      "Jimeng image models 3.0 and 3.1 do not support reference images",
    );
  }

  const normalizedAspectRatio = normalizeAspectRatio(payload.aspectRatio);
  const submitResponse = await submitJimengDreaminaImages({
    prompt: normalizedPrompt,
    aspectRatio: normalizedAspectRatio,
    resolutionType: normalizeJimengImageResolutionForModel(
      normalizedModelVersion,
      normalizeImageResolutionType(payload.resolutionType),
    ),
    modelVersion: normalizedModelVersion,
    referenceImages,
    imageCount: 1,
    timeoutMs: IMAGE_RESULT_TIMEOUT_MS,
  });

  await payload.onSubmitted?.({ submitIds: submitResponse.submitIds });

  const deadlineAt = Date.now() + IMAGE_RESULT_TIMEOUT_MS;
  let lastResponse: QueryJimengImagesResultResponse | null = null;

  while (Date.now() < deadlineAt) {
    lastResponse = await queryJimengImagesResult({
      submitIds: submitResponse.submitIds,
      aspectRatio: normalizedAspectRatio,
    });

    if (lastResponse.pendingSubmitIds.length === 0) {
      break;
    }

    await sleep(IMAGE_RESULT_POLL_INTERVAL_MS);
  }

  if (!lastResponse) {
    throw new Error("Jimeng image generation did not return any query result");
  }

  if (lastResponse.images.length > 0) {
    return {
      images: lastResponse.images,
      submitIds: lastResponse.submitIds,
    };
  }

  const timeoutSubmitId = lastResponse.pendingSubmitIds[0];
  if (timeoutSubmitId) {
    throw new Error(
      `Dreamina image generation timed out while waiting for submit_id=${timeoutSubmitId}`,
    );
  }

  if (lastResponse.failedSubmitIds.length > 0) {
    throw new Error(
      `Dreamina image generation failed for submit_id=${lastResponse.failedSubmitIds[0]}`,
    );
  }

  throw new Error(
    "Dreamina image generation did not return any downloadable results",
  );
}

export async function queryJimengImagesResult(
  payload: QueryJimengImagesResultPayload,
): Promise<QueryJimengImagesResultResponse> {
  const normalizedAspectRatio = normalizeAspectRatio(payload.aspectRatio);
  const response = await queryJimengDreaminaImageResults({
    submitIds: payload.submitIds,
  });

  return {
    images: await buildGeneratedImageItems(
      response.results,
      normalizedAspectRatio,
    ),
    submitIds: response.submitIds,
    pendingSubmitIds: response.pendingSubmitIds,
    failedSubmitIds: response.failedSubmitIds,
    warnings: response.warnings,
  };
}
