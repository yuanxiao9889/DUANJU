import { invoke, isTauri } from '@tauri-apps/api/core';
import type { MidjourneyProviderId } from '@/features/midjourney/domain/providers';

export interface SubmitMidjourneyImaginePayload {
  providerId: MidjourneyProviderId;
  apiKey: string;
  prompt: string;
  referenceImages?: string[];
  styleReferenceImages?: string[];
  personalizationCodes?: string[];
  aspectRatio?: string;
  rawMode?: boolean;
  versionPreset?: string;
  advancedParams?: string;
}

export interface SubmitMidjourneyImagineResponse {
  taskId: string;
  prompt: string;
  finalPrompt: string;
  state?: string | null;
}

export interface SubmitMidjourneyActionPayload {
  providerId: MidjourneyProviderId;
  apiKey: string;
  taskId: string;
  customId: string;
}

export interface SubmitMidjourneyModalPayload {
  providerId: MidjourneyProviderId;
  apiKey: string;
  taskId: string;
  prompt?: string;
  maskBase64?: string;
}

export interface MidjourneyMutationResponse {
  code?: number | null;
  taskId?: string | null;
  description?: string | null;
  state?: Record<string, unknown> | string | null;
  properties?: Record<string, unknown> | null;
}

export interface MidjourneyTaskButtonDto {
  customId: string;
  label: string;
  type?: string | null;
  style?: string | null;
  emoji?: string | null;
  groupIndex?: number;
  order?: number;
}

export interface MidjourneyTaskDto {
  id: string;
  action?: string | null;
  status: string;
  progress: string;
  imageUrl?: string | null;
  imageUrls?: string[] | null;
  imageWidth?: number | null;
  imageHeight?: number | null;
  prompt?: string | null;
  promptEn?: string | null;
  finalPrompt?: string | null;
  buttons?: MidjourneyTaskButtonDto[] | null;
  properties?: Record<string, unknown> | null;
  state?: Record<string, unknown> | string | null;
  failReason?: string | null;
  submitTime?: number | null;
  startTime?: number | null;
  finishTime?: number | null;
}

export interface QueryMidjourneyTasksPayload {
  providerId: MidjourneyProviderId;
  apiKey: string;
  taskIds: string[];
}

function ensureTauriRuntime() {
  if (!isTauri()) {
    throw new Error('Midjourney commands require the Tauri runtime');
  }
}

export async function submitMidjourneyImagine(
  payload: SubmitMidjourneyImaginePayload
): Promise<SubmitMidjourneyImagineResponse> {
  ensureTauriRuntime();
  return await invoke<SubmitMidjourneyImagineResponse>('submit_midjourney_imagine', {
    payload: {
      provider_id: payload.providerId,
      api_key: payload.apiKey,
      prompt: payload.prompt,
      reference_images: payload.referenceImages ?? [],
      style_reference_images: payload.styleReferenceImages ?? [],
      personalization_codes: payload.personalizationCodes ?? [],
      aspect_ratio: payload.aspectRatio ?? null,
      raw_mode: payload.rawMode ?? false,
      version_preset: payload.versionPreset ?? null,
      advanced_params: payload.advancedParams ?? null,
    },
  });
}

export async function queryMidjourneyTasks(
  payload: QueryMidjourneyTasksPayload
): Promise<MidjourneyTaskDto[]> {
  ensureTauriRuntime();
  return await invoke<MidjourneyTaskDto[]>('query_midjourney_tasks', {
    payload: {
      provider_id: payload.providerId,
      api_key: payload.apiKey,
      task_ids: payload.taskIds,
    },
  });
}

export async function submitMidjourneyAction(
  payload: SubmitMidjourneyActionPayload
): Promise<MidjourneyMutationResponse> {
  ensureTauriRuntime();
  return await invoke<MidjourneyMutationResponse>('submit_midjourney_action', {
    payload: {
      provider_id: payload.providerId,
      api_key: payload.apiKey,
      task_id: payload.taskId,
      custom_id: payload.customId,
    },
  });
}

export async function submitMidjourneyModal(
  payload: SubmitMidjourneyModalPayload
): Promise<MidjourneyMutationResponse> {
  ensureTauriRuntime();
  return await invoke<MidjourneyMutationResponse>('submit_midjourney_modal', {
    payload: {
      provider_id: payload.providerId,
      api_key: payload.apiKey,
      task_id: payload.taskId,
      prompt: payload.prompt ?? null,
      mask_base64: payload.maskBase64 ?? null,
    },
  });
}
