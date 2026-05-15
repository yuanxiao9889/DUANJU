import { invoke } from '@tauri-apps/api/core';

export type MediaPersistType = 'image' | 'video' | 'audio';
export type MediaPersistRole = 'original' | 'preview' | 'thumbnail' | 'cache';

export interface MediaPersistContext {
  projectId?: string | null;
  mediaType: MediaPersistType;
  role?: MediaPersistRole;
}

function normalizeMediaContext(
  context: MediaPersistContext | undefined,
  fallbackMediaType: MediaPersistType,
  fallbackRole: MediaPersistRole = 'original'
): MediaPersistContext {
  return {
    projectId: context?.projectId?.trim() || null,
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
