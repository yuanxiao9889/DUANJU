import { isTauri } from '@tauri-apps/api/core';

import { persistImageBinary, persistImageSource } from '@/commands/image';
import {
  blobToDataUrl,
  resolveImageDisplayUrl,
} from './imageData';

const SUPPORTED_AUDIO_TYPES = [
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/x-wav',
  'audio/wave',
  'audio/x-pn-wav',
  'audio/ogg',
  'audio/webm',
  'audio/mp4',
  'audio/x-m4a',
  'audio/aac',
  'audio/flac',
  'audio/x-flac',
] as const;

const SUPPORTED_AUDIO_EXTENSION_PATTERN =
  /\.(mp3|wav|ogg|oga|m4a|aac|flac|webm)$/i;

export interface AudioMetadata {
  duration: number;
  mimeType: string | null;
}

export interface PreparedAudio {
  audioUrl: string;
  previewImageUrl: string | null;
  duration: number;
  mimeType: string | null;
}

interface PrepareAudioOptions {
  duration?: number | null;
  mimeType?: string | null;
}

function normalizeAudioMimeTypeValue(mimeType: string | null | undefined): string | null {
  const normalized = mimeType?.split(';', 1)[0]?.trim().toLowerCase() ?? '';
  if (!normalized) {
    return null;
  }

  if (normalized === 'audio/mp3') return 'audio/mpeg';
  if (
    normalized === 'audio/x-wav'
    || normalized === 'audio/wave'
    || normalized === 'audio/x-pn-wav'
  ) {
    return 'audio/wav';
  }
  if (normalized === 'audio/x-m4a') return 'audio/mp4';
  if (normalized === 'audio/x-flac') return 'audio/flac';

  return normalized;
}

function inferAudioMimeTypeFromSource(source: string): string | null {
  const trimmedSource = source.trim();
  if (!trimmedSource) {
    return null;
  }

  const normalizedSource = trimmedSource.split('#', 1)[0]?.split('?', 1)[0] ?? trimmedSource;
  const extension = normalizedSource.split('.').pop()?.trim().toLowerCase() ?? '';

  if (extension === 'mp3') return 'audio/mpeg';
  if (extension === 'wav') return 'audio/wav';
  if (extension === 'ogg' || extension === 'oga') return 'audio/ogg';
  if (extension === 'webm') return 'audio/webm';
  if (extension === 'm4a' || extension === 'mp4') return 'audio/mp4';
  if (extension === 'aac') return 'audio/aac';
  if (extension === 'flac') return 'audio/flac';

  return null;
}

function replaceDataUrlMimeType(dataUrl: string, mimeType: string): string {
  const commaIndex = dataUrl.indexOf(',');
  if (commaIndex < 0) {
    return dataUrl;
  }

  const metadata = dataUrl.slice(5, commaIndex);
  const semicolonIndex = metadata.indexOf(';');

  if (semicolonIndex >= 0) {
    const leadingSegment = metadata.slice(0, semicolonIndex);
    if (leadingSegment.includes('/')) {
      return `data:${mimeType}${metadata.slice(semicolonIndex)}${dataUrl.slice(commaIndex)}`;
    }
  } else if (metadata.includes('/')) {
    return `data:${mimeType}${dataUrl.slice(commaIndex)}`;
  }

  const metadataSuffix = metadata ? `;${metadata}` : '';
  return `data:${mimeType}${metadataSuffix}${dataUrl.slice(commaIndex)}`;
}

export function isSupportedAudioType(mimeType: string): boolean {
  const normalizedMimeType = normalizeAudioMimeTypeValue(mimeType);
  if (!normalizedMimeType) {
    return false;
  }

  return SUPPORTED_AUDIO_TYPES.includes(normalizedMimeType as (typeof SUPPORTED_AUDIO_TYPES)[number]);
}

export function isSupportedAudioFile(file: File): boolean {
  return isSupportedAudioType(file.type) || SUPPORTED_AUDIO_EXTENSION_PATTERN.test(file.name);
}

function resolveAudioExtension(file: File): string {
  const mime = normalizeAudioMimeTypeValue(file.type) ?? file.type.toLowerCase();
  if (mime === 'audio/mpeg' || mime === 'audio/mp3') return 'mp3';
  if (mime === 'audio/wav' || mime === 'audio/x-wav' || mime === 'audio/wave' || mime === 'audio/x-pn-wav') return 'wav';
  if (mime === 'audio/ogg') return 'ogg';
  if (mime === 'audio/webm') return 'webm';
  if (mime === 'audio/mp4' || mime === 'audio/x-m4a') return 'm4a';
  if (mime === 'audio/aac') return 'aac';
  if (mime === 'audio/flac' || mime === 'audio/x-flac') return 'flac';

  const name = file.name.trim();
  const dotIndex = name.lastIndexOf('.');
  if (dotIndex >= 0 && dotIndex < name.length - 1) {
    return name.slice(dotIndex + 1).toLowerCase();
  }

  return 'mp3';
}

export async function getAudioMetadata(file: File): Promise<AudioMetadata> {
  return await new Promise((resolve, reject) => {
    const audio = document.createElement('audio');
    const objectUrl = URL.createObjectURL(file);
    let settled = false;

    const cleanup = () => {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
      URL.revokeObjectURL(objectUrl);
    };

    const finishResolve = (value: AudioMetadata) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve(value);
    };

    const finishReject = (error: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      reject(error);
    };

    audio.preload = 'metadata';
    audio.onloadedmetadata = () => {
      finishResolve({
        duration: Number.isFinite(audio.duration) ? audio.duration : 0,
        mimeType: normalizeAudioMimeTypeValue(file.type.trim()) ?? null,
      });
    };
    audio.onerror = () => {
      finishReject(new Error('Failed to load audio metadata'));
    };
    audio.src = objectUrl;
  });
}

export async function prepareNodeAudioFromFile(file: File): Promise<PreparedAudio> {
  if (!isSupportedAudioFile(file)) {
    throw new Error(`Unsupported audio type: ${file.type || file.name}`);
  }

  const metadata = await getAudioMetadata(file);
  const tauriFilePath = (file as File & { path?: string }).path;
  const normalizedPath = typeof tauriFilePath === 'string' ? tauriFilePath.trim() : '';

  if (isTauri() && normalizedPath.length > 0) {
    const persistedAudioPath = await persistImageSource(normalizedPath);
    return {
      audioUrl: persistedAudioPath,
      previewImageUrl: null,
      duration: metadata.duration,
      mimeType: metadata.mimeType,
    };
  }

  if (isTauri()) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const persistedAudioPath = await persistImageBinary(bytes, resolveAudioExtension(file));
    return {
      audioUrl: persistedAudioPath,
      previewImageUrl: null,
      duration: metadata.duration,
      mimeType: metadata.mimeType,
    };
  }

  return {
    audioUrl: URL.createObjectURL(file),
    previewImageUrl: null,
    duration: metadata.duration,
    mimeType: metadata.mimeType,
  };
}

export async function prepareNodeAudio(
  audioUrl: string,
  options: PrepareAudioOptions = {}
): Promise<PreparedAudio> {
  const trimmedAudioUrl = audioUrl.trim();
  if (!trimmedAudioUrl) {
    throw new Error('Audio source is empty');
  }

  const normalizedMimeType = options.mimeType?.trim() || null;
  const resolvedDuration =
    typeof options.duration === 'number' && Number.isFinite(options.duration)
      ? Math.max(0, options.duration)
      : null;

  if (isTauri()) {
    const persistedAudioPath = await persistImageSource(trimmedAudioUrl);
    return {
      audioUrl: persistedAudioPath,
      previewImageUrl: null,
      duration: resolvedDuration ?? 0,
      mimeType: normalizedMimeType,
    };
  }

  let fallbackDuration = resolvedDuration ?? 0;
  let fallbackMimeType = normalizedMimeType;

  if (resolvedDuration === null || !fallbackMimeType) {
    try {
      const response = await fetch(resolveAudioDisplayUrl(trimmedAudioUrl));
      if (response.ok) {
        const blob = await response.blob();
        const metadataFile = new File([blob], 'audio', {
          type: fallbackMimeType ?? blob.type ?? 'audio/mpeg',
        });
        const metadata = await getAudioMetadata(metadataFile);
        fallbackDuration = resolvedDuration ?? metadata.duration;
        fallbackMimeType = fallbackMimeType ?? metadata.mimeType;
      }
    } catch (error) {
      console.warn('Failed to resolve audio metadata while preparing asset audio', {
        source: trimmedAudioUrl,
        error,
      });
    }
  }

  return {
    audioUrl: trimmedAudioUrl,
    previewImageUrl: null,
    duration: fallbackDuration,
    mimeType: fallbackMimeType,
  };
}

export function resolveAudioDisplayUrl(audioUrl: string): string {
  return resolveImageDisplayUrl(audioUrl);
}

export async function audioUrlToDataUrl(
  audioUrl: string,
  options: { mimeType?: string | null } = {}
): Promise<string> {
  const trimmedAudioUrl = audioUrl.trim();
  if (!trimmedAudioUrl) {
    throw new Error('Audio source is empty');
  }

  const preferredMimeType =
    normalizeAudioMimeTypeValue(options.mimeType)
    ?? inferAudioMimeTypeFromSource(trimmedAudioUrl);

  if (trimmedAudioUrl.startsWith('data:')) {
    return preferredMimeType
      ? replaceDataUrlMimeType(trimmedAudioUrl, preferredMimeType)
      : trimmedAudioUrl;
  }

  const response = await fetch(resolveAudioDisplayUrl(trimmedAudioUrl));
  if (!response.ok) {
    throw new Error(`Failed to load audio data (${response.status})`);
  }

  const sourceBlob = await response.blob();
  const resolvedMimeType =
    preferredMimeType
    ?? normalizeAudioMimeTypeValue(sourceBlob.type)
    ?? inferAudioMimeTypeFromSource(trimmedAudioUrl);

  if (!resolvedMimeType) {
    return await blobToDataUrl(sourceBlob);
  }

  const normalizedBlob =
    normalizeAudioMimeTypeValue(sourceBlob.type) === resolvedMimeType
      ? sourceBlob
      : new Blob([await sourceBlob.arrayBuffer()], { type: resolvedMimeType });

  return await blobToDataUrl(normalizedBlob);
}

export function formatAudioDuration(seconds: number | null | undefined): string {
  const totalSeconds =
    typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0
      ? Math.max(0, Math.round(seconds))
      : 0;
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const remainingSeconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours.toString().padStart(2, '0')}:${minutes
      .toString()
      .padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
  }

  return `${minutes.toString().padStart(2, '0')}:${remainingSeconds
    .toString()
    .padStart(2, '0')}`;
}
