import { invoke } from '@tauri-apps/api/core';

export type MediaPersistType = 'image' | 'video' | 'audio';
export type MediaPersistRole = 'original' | 'preview' | 'thumbnail' | 'cache';

export interface MediaPersistContext {
  projectId?: string | null;
  projectName?: string | null;
  mediaType: MediaPersistType;
  role?: MediaPersistRole;
}

export interface ExtractAudioFromVideoPayload {
  source: string;
  outputFileStem?: string | null;
  mediaContext?: MediaPersistContext;
}

export interface ExtractAudioFromVideoResult {
  audioPath: string;
  duration: number;
  mimeType: string;
  outputFileName: string;
}

function normalizeMediaContext(
  context: MediaPersistContext | undefined,
  fallbackMediaType: MediaPersistType,
  fallbackRole: MediaPersistRole = 'original'
): MediaPersistContext {
  return {
    projectId: context?.projectId?.trim() || null,
    projectName: context?.projectName?.trim() || null,
    mediaType: context?.mediaType ?? fallbackMediaType,
    role: context?.role ?? fallbackRole,
  };
}

export async function persistMediaSource(
  source: string,
  context: MediaPersistContext
): Promise<string> {
  return await invoke<string>('persist_image_source', {
    source,
    mediaContext: normalizeMediaContext(context, context.mediaType),
  });
}

export async function persistMediaBinary(
  bytes: Uint8Array,
  extension: string,
  context: MediaPersistContext
): Promise<string> {
  return await invoke<string>('persist_image_binary', {
    bytes: Array.from(bytes),
    extension,
    mediaContext: normalizeMediaContext(context, context.mediaType),
  });
}

export function normalizeImageMediaContext(
  context?: MediaPersistContext,
  role: MediaPersistRole = 'original'
): MediaPersistContext {
  return normalizeMediaContext(context, 'image', role);
}

export async function extractAudioFromVideo(
  payload: ExtractAudioFromVideoPayload
): Promise<ExtractAudioFromVideoResult> {
  return await invoke<ExtractAudioFromVideoResult>('extract_audio_from_video', {
    payload: {
      source: payload.source,
      outputFileStem: payload.outputFileStem?.trim() || null,
    },
    mediaContext: normalizeMediaContext(payload.mediaContext, 'audio'),
  });
}
