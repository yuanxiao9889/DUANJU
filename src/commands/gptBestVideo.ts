import { invoke } from '@tauri-apps/api/core';

import type { MediaPersistContext } from './media';

export type OopiiVideoImageInput = string | { url: string };

export interface CreateGptBestVideoTaskPayload {
  apiKey: string;
  baseUrl: string;
  model: string;
  prompt: string;
  seconds: number;
  size: string;
  image?: OopiiVideoImageInput | null;
  referenceImages?: OopiiVideoImageInput[];
}

export interface CreateGptBestVideoTaskResponse {
  task_id: string;
}

export interface GetGptBestVideoTaskPayload {
  apiKey: string;
  baseUrl: string;
  taskId: string;
}

export interface GetGptBestVideoTaskResponse {
  task_id: string;
  status: string;
  model?: string | null;
  cover_url?: string | null;
  output_url?: string | null;
  size?: string | null;
  seconds?: number | null;
  error_message?: string | null;
  created_at?: number | null;
  updated_at?: number | null;
}

export interface DownloadGptBestVideoContentPayload {
  apiKey: string;
  baseUrl: string;
  taskId: string;
  mediaContext?: MediaPersistContext;
}

export interface DownloadGptBestVideoContentResponse {
  video_url: string;
  file_name?: string | null;
}

export async function createGptBestVideoTask(
  payload: CreateGptBestVideoTaskPayload
): Promise<CreateGptBestVideoTaskResponse> {
  return await invoke<CreateGptBestVideoTaskResponse>('create_gpt_best_video_task', {
    payload: {
      api_key: payload.apiKey,
      base_url: payload.baseUrl,
      model: payload.model,
      prompt: payload.prompt,
      seconds: payload.seconds,
      size: payload.size,
      image: payload.image ?? null,
      reference_images: payload.referenceImages ?? [],
    },
  });
}

export async function getGptBestVideoTask(
  payload: GetGptBestVideoTaskPayload
): Promise<GetGptBestVideoTaskResponse> {
  return await invoke<GetGptBestVideoTaskResponse>('get_gpt_best_video_task', {
    payload: {
      api_key: payload.apiKey,
      base_url: payload.baseUrl,
      task_id: payload.taskId,
    },
  });
}

export async function downloadGptBestVideoContent(
  payload: DownloadGptBestVideoContentPayload
): Promise<DownloadGptBestVideoContentResponse> {
  return await invoke<DownloadGptBestVideoContentResponse>('download_gpt_best_video_content', {
    payload: {
      api_key: payload.apiKey,
      base_url: payload.baseUrl,
      task_id: payload.taskId,
      media_context: payload.mediaContext,
    },
  });
}
