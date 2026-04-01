import {
  generateJimengDreaminaImages,
  queryJimengDreaminaImageResults,
} from '@/commands/dreaminaCli';
import { prepareNodeImage } from '@/features/canvas/application/imageData';
import type {
  JimengAspectRatio,
  JimengGeneratedImageItem,
  JimengImageModelVersion,
  JimengImageResolutionType,
} from '@/features/canvas/domain/canvasNodes';
import {
  buildJimengSubmissionPrompt,
  prepareJimengReferenceImages,
} from '@/features/jimeng/application/jimengSubmission';

const LEGACY_IMAGE_MODEL_VERSION_MAP: Record<string, JimengImageModelVersion> = {
  'seedance-2.0-fast': '5.0',
  'seedance-2.0': '5.0',
  'seedance-1.5-pro': '4.6',
  'seedance-1.0': '4.1',
  'seedance-1.0-fast': '4.0',
  'seedance-1.0-mini': '3.1',
};

function normalizeImageModelVersion(
  value: JimengImageModelVersion | string | null | undefined
): JimengImageModelVersion | undefined {
  const normalized = value?.trim().toLowerCase() ?? '';
  if (!normalized) {
    return undefined;
  }

  if (normalized in LEGACY_IMAGE_MODEL_VERSION_MAP) {
    return LEGACY_IMAGE_MODEL_VERSION_MAP[normalized];
  }

  const allowed: JimengImageModelVersion[] = ['3.0', '3.1', '4.0', '4.1', '4.5', '4.6', '5.0', 'lab'];
  return allowed.find((item) => item === normalized) ?? undefined;
}

function normalizeImageResolutionType(
  value: JimengImageResolutionType | string | null | undefined
): JimengImageResolutionType | undefined {
  const normalized = value?.trim().toLowerCase() ?? '';
  const allowed: JimengImageResolutionType[] = ['1k', '2k', '4k'];
  return allowed.find((item) => item === normalized) ?? undefined;
}

function normalizeAspectRatio(value: JimengAspectRatio | string | null | undefined): JimengAspectRatio | undefined {
  const normalized = value?.trim() ?? '';
  const allowed: JimengAspectRatio[] = ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'];
  return allowed.find((item) => item === normalized) ?? undefined;
}

export interface GenerateJimengImagesPayload {
  prompt: string;
  aspectRatio?: JimengAspectRatio | string;
  resolutionType?: JimengImageResolutionType | string;
  modelVersion?: JimengImageModelVersion | string;
  referenceImageSources?: string[];
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
  generatedImages: Awaited<ReturnType<typeof generateJimengDreaminaImages>>['results'],
  aspectRatio: JimengAspectRatio | undefined
): Promise<JimengGeneratedImageItem[]> {
  return await Promise.all(
    generatedImages.map(async (result, index) => {
      const prepared = await prepareNodeImage(result.sourceUrl);
      return {
        id: `jimeng-image-${Date.now()}-${index + 1}`,
        sourceUrl: result.sourceUrl,
        imageUrl: prepared.imageUrl,
        previewImageUrl: prepared.previewImageUrl,
        aspectRatio: aspectRatio ?? '1:1',
        width: result.width ?? undefined,
        height: result.height ?? undefined,
        fileName: result.fileName ?? `jimeng-image-${index + 1}.png`,
      } satisfies JimengGeneratedImageItem;
    })
  );
}

export async function generateJimengImages(
  payload: GenerateJimengImagesPayload
): Promise<GeneratedJimengImagesResponse> {
  const normalizedPrompt = buildJimengSubmissionPrompt(payload.prompt);
  if (!normalizedPrompt) {
    throw new Error('Prompt is required for Jimeng image generation');
  }

  const referenceImages = await prepareJimengReferenceImages(payload.referenceImageSources);
  const normalizedAspectRatio = normalizeAspectRatio(payload.aspectRatio);
  const generationResponse = await generateJimengDreaminaImages({
    prompt: normalizedPrompt,
    aspectRatio: normalizedAspectRatio,
    resolutionType: normalizeImageResolutionType(payload.resolutionType),
    modelVersion: normalizeImageModelVersion(payload.modelVersion),
    referenceImages,
    imageCount: 4,
    timeoutMs: 12 * 60 * 1000,
  });

  return {
    images: await buildGeneratedImageItems(generationResponse.results, normalizedAspectRatio),
    submitIds: generationResponse.submitIds,
  };
}

export async function queryJimengImagesResult(
  payload: QueryJimengImagesResultPayload
): Promise<QueryJimengImagesResultResponse> {
  const normalizedAspectRatio = normalizeAspectRatio(payload.aspectRatio);
  const response = await queryJimengDreaminaImageResults({
    submitIds: payload.submitIds,
  });

  return {
    images: await buildGeneratedImageItems(response.results, normalizedAspectRatio),
    submitIds: response.submitIds,
    pendingSubmitIds: response.pendingSubmitIds,
    failedSubmitIds: response.failedSubmitIds,
    warnings: response.warnings,
  };
}
