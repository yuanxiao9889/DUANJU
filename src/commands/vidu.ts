import { invoke } from '@tauri-apps/api/core';

export type ViduVideoInputMode =
  | 'textToVideo'
  | 'firstFrame'
  | 'firstLastFrame'
  | 'reference';

export interface CreateViduVideoTaskPayload {
  apiKey: string;
  inputMode: ViduVideoInputMode;
  model: string;
  prompt: string;
  images?: string[];
  videos?: string[];
  aspectRatio?: string;
  duration?: number;
  resolution?: string;
  audio?: boolean;
  bgm?: boolean;
  voiceId?: string;
}

export interface CreateViduVideoTaskResponse {
  task_id: string;
  state?: string | null;
}

export interface CreateViduVoiceClonePayload {
  apiKey: string;
  audioUrl: string;
  voiceId: string;
  text: string;
}

export interface CreateViduVoiceCloneResponse {
  task_id: string;
  state: string;
  voice_id?: string | null;
  demo_audio?: string | null;
  created_at?: string | null;
}

export interface GetViduVideoTaskPayload {
  apiKey: string;
  taskId: string;
}

export interface GetViduVideoCreation {
  id?: string | null;
  url?: string | null;
  cover_url?: string | null;
  watermarked_url?: string | null;
}

export interface GetViduVideoTaskResponse {
  id: string;
  state: string;
  err_code?: string | null;
  model?: string | null;
  aspect_ratio?: string | null;
  resolution?: string | null;
  duration?: number | null;
  audio?: boolean | null;
  bgm?: boolean | null;
  created_at?: string | null;
  updated_at?: string | null;
  progress?: number | null;
  creations: GetViduVideoCreation[];
}

export async function createViduVideoTask(
  payload: CreateViduVideoTaskPayload
): Promise<CreateViduVideoTaskResponse> {
  return await invoke<CreateViduVideoTaskResponse>('create_vidu_video_task', {
    payload: {
      api_key: payload.apiKey,
      input_mode: payload.inputMode,
      model: payload.model,
      prompt: payload.prompt,
      images: payload.images,
      videos: payload.videos,
      aspect_ratio: payload.aspectRatio,
      duration: payload.duration,
      resolution: payload.resolution,
      audio: payload.audio,
      bgm: payload.bgm,
      voice_id: payload.voiceId,
    },
  });
}

export async function createViduVoiceClone(
  payload: CreateViduVoiceClonePayload
): Promise<CreateViduVoiceCloneResponse> {
  return await invoke<CreateViduVoiceCloneResponse>('create_vidu_voice_clone', {
    payload: {
      api_key: payload.apiKey,
      audio_url: payload.audioUrl,
      voice_id: payload.voiceId,
      text: payload.text,
    },
  });
}

export async function getViduVideoTask(
  payload: GetViduVideoTaskPayload
): Promise<GetViduVideoTaskResponse> {
  return await invoke<GetViduVideoTaskResponse>('get_vidu_video_task', {
    payload: {
      api_key: payload.apiKey,
      task_id: payload.taskId,
    },
  });
}
