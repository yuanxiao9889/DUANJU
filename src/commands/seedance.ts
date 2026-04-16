import { invoke } from '@tauri-apps/api/core';

export interface SeedanceContentUrlPayload {
  url: string;
}

export interface SeedanceContentItemPayload {
  type: 'text' | 'image_url' | 'video_url' | 'audio_url';
  text?: string;
  image_url?: SeedanceContentUrlPayload;
  video_url?: SeedanceContentUrlPayload;
  audio_url?: SeedanceContentUrlPayload;
  role?: string;
}

export interface CreateSeedanceVideoTaskPayload {
  apiKey: string;
  model: string;
  content: SeedanceContentItemPayload[];
  ratio?: string;
  duration?: number;
  resolution?: string;
  generateAudio?: boolean;
  returnLastFrame?: boolean;
  watermark?: boolean;
}

export interface CreateSeedanceVideoTaskResponse {
  task_id: string;
}

export interface GetSeedanceVideoTaskPayload {
  apiKey: string;
  taskId: string;
}

export interface GetSeedanceVideoTaskResponse {
  task_id: string;
  status: string;
  model?: string | null;
  video_url?: string | null;
  last_frame_url?: string | null;
  resolution?: string | null;
  ratio?: string | null;
  duration?: number | null;
  generate_audio?: boolean | null;
  created_at?: number | null;
  updated_at?: number | null;
  error_message?: string | null;
}

export async function createSeedanceVideoTask(
  payload: CreateSeedanceVideoTaskPayload
): Promise<CreateSeedanceVideoTaskResponse> {
  return await invoke<CreateSeedanceVideoTaskResponse>('create_seedance_video_task', {
    payload: {
      api_key: payload.apiKey,
      model: payload.model,
      content: payload.content,
      ratio: payload.ratio,
      duration: payload.duration,
      resolution: payload.resolution,
      generate_audio: payload.generateAudio,
      return_last_frame: payload.returnLastFrame,
      watermark: payload.watermark,
    },
  });
}

export async function getSeedanceVideoTask(
  payload: GetSeedanceVideoTaskPayload
): Promise<GetSeedanceVideoTaskResponse> {
  return await invoke<GetSeedanceVideoTaskResponse>('get_seedance_video_task', {
    payload: {
      api_key: payload.apiKey,
      task_id: payload.taskId,
    },
  });
}
