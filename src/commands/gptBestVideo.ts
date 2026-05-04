import { invoke } from '@tauri-apps/api/core';

export interface CreateGptBestVideoTaskPayload {
  apiKey: string;
  baseUrl: string;
  model: string;
  prompt: string;
  images?: string[];
  ratio?: string;
  duration?: number;
  resolution?: string;
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
  video_url?: string | null;
  last_frame_url?: string | null;
  ratio?: string | null;
  resolution?: string | null;
  duration?: number | null;
  error_message?: string | null;
  created_at?: number | null;
  updated_at?: number | null;
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
      images: payload.images,
      ratio: payload.ratio,
      duration: payload.duration,
      resolution: payload.resolution,
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
