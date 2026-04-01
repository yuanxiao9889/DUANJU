import { invoke } from "@tauri-apps/api/core";

export interface DreaminaReferenceAssetPayload {
  fileName: string;
  dataUrl: string;
}

export interface GenerateJimengDreaminaImagesPayload {
  prompt: string;
  aspectRatio?: string;
  resolutionType?: string;
  modelVersion?: string;
  referenceImages?: DreaminaReferenceAssetPayload[];
  imageCount?: number;
  timeoutMs?: number;
}

export interface GenerateJimengDreaminaVideosPayload {
  prompt: string;
  referenceMode?: string;
  aspectRatio?: string;
  durationSeconds?: number;
  videoResolution?: string;
  modelVersion?: string;
  referenceImages?: DreaminaReferenceAssetPayload[];
  referenceVideos?: DreaminaReferenceAssetPayload[];
  referenceAudios?: DreaminaReferenceAssetPayload[];
  timeoutMs?: number;
}

export interface JimengDreaminaGeneratedImageResult {
  index: number;
  sourceUrl: string;
  width?: number | null;
  height?: number | null;
  fileName?: string | null;
}

export interface JimengDreaminaGeneratedVideoResult {
  index: number;
  sourceUrl: string;
  width?: number | null;
  height?: number | null;
  durationSeconds?: number | null;
  fileName?: string | null;
}

export interface DreaminaCliStatusResponse {
  ready: boolean;
  message: string;
  detail?: string | null;
}

export interface JimengDreaminaImageGenerationResponse {
  results: JimengDreaminaGeneratedImageResult[];
  submitIds: string[];
}

export interface JimengDreaminaImageSubmitResponse {
  submitIds: string[];
}

export interface JimengDreaminaVideoGenerationResponse {
  results: JimengDreaminaGeneratedVideoResult[];
  submitId: string;
}

export interface JimengDreaminaVideoSubmitResponse {
  submitId: string;
}

export interface QueryJimengDreaminaImageResultsPayload {
  submitIds: string[];
}

export interface QueryJimengDreaminaVideoResultPayload {
  submitId: string;
}

export interface JimengDreaminaImageQueryResponse {
  submitIds: string[];
  pendingSubmitIds: string[];
  failedSubmitIds: string[];
  results: JimengDreaminaGeneratedImageResult[];
  warnings: string[];
}

export interface JimengDreaminaVideoQueryResponse {
  submitId: string;
  pending: boolean;
  results: JimengDreaminaGeneratedVideoResult[];
  warnings: string[];
}

export async function checkDreaminaCliStatus(): Promise<DreaminaCliStatusResponse> {
  return await invoke<DreaminaCliStatusResponse>("check_dreamina_cli_status");
}

export async function generateJimengDreaminaImages(
  payload: GenerateJimengDreaminaImagesPayload,
): Promise<JimengDreaminaImageGenerationResponse> {
  return await invoke<JimengDreaminaImageGenerationResponse>(
    "generate_jimeng_dreamina_images",
    {
      payload,
    },
  );
}

export async function submitJimengDreaminaImages(
  payload: GenerateJimengDreaminaImagesPayload,
): Promise<JimengDreaminaImageSubmitResponse> {
  return await invoke<JimengDreaminaImageSubmitResponse>(
    "submit_jimeng_dreamina_images",
    {
      payload,
    },
  );
}

export async function generateJimengDreaminaVideos(
  payload: GenerateJimengDreaminaVideosPayload,
): Promise<JimengDreaminaVideoGenerationResponse> {
  return await invoke<JimengDreaminaVideoGenerationResponse>(
    "generate_jimeng_dreamina_videos",
    {
      payload,
    },
  );
}

export async function submitJimengDreaminaVideos(
  payload: GenerateJimengDreaminaVideosPayload,
): Promise<JimengDreaminaVideoSubmitResponse> {
  return await invoke<JimengDreaminaVideoSubmitResponse>(
    "submit_jimeng_dreamina_videos",
    {
      payload,
    },
  );
}

export async function queryJimengDreaminaImageResults(
  payload: QueryJimengDreaminaImageResultsPayload,
): Promise<JimengDreaminaImageQueryResponse> {
  return await invoke<JimengDreaminaImageQueryResponse>(
    "query_jimeng_dreamina_image_results",
    {
      payload,
    },
  );
}

export async function queryJimengDreaminaVideoResult(
  payload: QueryJimengDreaminaVideoResultPayload,
): Promise<JimengDreaminaVideoQueryResponse> {
  return await invoke<JimengDreaminaVideoQueryResponse>(
    "query_jimeng_dreamina_video_result",
    {
      payload,
    },
  );
}
