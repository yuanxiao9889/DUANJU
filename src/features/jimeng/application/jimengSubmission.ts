import { audioUrlToDataUrl } from '@/features/canvas/application/audioData';
import { createPreviewDataUrl } from '@/features/canvas/application/imageData';
import { videoUrlToDataUrl } from '@/features/canvas/application/videoData';

const DREAMINA_REFERENCE_TOKEN_AT_PREFIX_PATTERN =
  /@(?=(?:\u56fe(?:\u7247)?|\u89c6\u9891|\u97f3(?:\u9891)?)\d+)/g;
const JIMENG_REFERENCE_IMAGE_MAX_DIMENSION = 1600;

export interface JimengReferenceImagePayload {
  fileName: string;
  dataUrl: string;
}

export interface JimengReferenceAudioPayload {
  fileName: string;
  dataUrl: string;
}

export interface JimengReferenceVideoPayload {
  fileName: string;
  dataUrl: string;
}

function normalizeWhitespace(value: string): string {
  return value
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function buildJimengSubmissionPrompt(prompt: string): string {
  return normalizeWhitespace(
    prompt.replace(DREAMINA_REFERENCE_TOKEN_AT_PREFIX_PATTERN, '')
  );
}

function sanitizeJimengReferenceFileName(rawName: string): string {
  const sanitized = rawName
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '');

  return sanitized || 'jimeng-reference';
}

function resolveDataUrlExtension(dataUrl: string): string {
  const mimeSegment = dataUrl.slice(5, dataUrl.indexOf(';'));
  const normalizedMime = mimeSegment.toLowerCase();
  if (normalizedMime === 'image/jpeg' || normalizedMime === 'image/jpg') {
    return 'jpg';
  }
  if (normalizedMime === 'image/webp') {
    return 'webp';
  }
  if (normalizedMime === 'image/gif') {
    return 'gif';
  }
  if (normalizedMime === 'image/bmp') {
    return 'bmp';
  }
  if (normalizedMime === 'image/avif') {
    return 'avif';
  }
  return 'png';
}

function resolveAudioDataUrlExtension(dataUrl: string): string {
  const mimeSegment = dataUrl.slice(5, dataUrl.indexOf(';'));
  const normalizedMime = mimeSegment.toLowerCase();
  if (normalizedMime === 'audio/mpeg' || normalizedMime === 'audio/mp3') {
    return 'mp3';
  }
  if (
    normalizedMime === 'audio/wav'
    || normalizedMime === 'audio/x-wav'
    || normalizedMime === 'audio/wave'
    || normalizedMime === 'audio/x-pn-wav'
  ) {
    return 'wav';
  }
  if (normalizedMime === 'audio/ogg') {
    return 'ogg';
  }
  if (normalizedMime === 'audio/webm') {
    return 'webm';
  }
  if (normalizedMime === 'audio/mp4' || normalizedMime === 'audio/x-m4a') {
    return 'm4a';
  }
  if (normalizedMime === 'audio/aac') {
    return 'aac';
  }
  if (normalizedMime === 'audio/flac' || normalizedMime === 'audio/x-flac') {
    return 'flac';
  }
  return 'mp3';
}

function resolveVideoDataUrlExtension(dataUrl: string): string {
  const mimeSegment = dataUrl.slice(5, dataUrl.indexOf(';'));
  const normalizedMime = mimeSegment.toLowerCase();
  if (normalizedMime === 'video/mp4') {
    return 'mp4';
  }
  if (normalizedMime === 'video/webm') {
    return 'webm';
  }
  if (normalizedMime === 'video/ogg') {
    return 'ogv';
  }
  if (normalizedMime === 'video/quicktime') {
    return 'mov';
  }
  if (normalizedMime === 'video/x-msvideo') {
    return 'avi';
  }
  if (normalizedMime === 'video/x-matroska') {
    return 'mkv';
  }
  return 'mp4';
}

function resolveJimengReferenceFileName(source: string, dataUrl: string, index: number): string {
  const normalizedSource = source.trim();
  const basename = normalizedSource
    .split(/[\\/]/)
    .pop()
    ?.split('?')[0]
    ?.split('#')[0]
    ?.trim();

  if (basename && basename.includes('.')) {
    return sanitizeJimengReferenceFileName(basename);
  }

  const extension = resolveDataUrlExtension(dataUrl);
  return sanitizeJimengReferenceFileName(`jimeng-reference-${index + 1}.${extension}`);
}

function resolveJimengReferenceAudioFileName(
  source: string,
  dataUrl: string,
  index: number
): string {
  const normalizedSource = source.trim();
  const basename = normalizedSource
    .split(/[\\/]/)
    .pop()
    ?.split('?')[0]
    ?.split('#')[0]
    ?.trim();

  if (basename && basename.includes('.')) {
    return sanitizeJimengReferenceFileName(basename);
  }

  const extension = resolveAudioDataUrlExtension(dataUrl);
  return sanitizeJimengReferenceFileName(`jimeng-audio-${index + 1}.${extension}`);
}

function resolveJimengReferenceVideoFileName(
  source: string,
  dataUrl: string,
  index: number
): string {
  const normalizedSource = source.trim();
  const basename = normalizedSource
    .split(/[\\/]/)
    .pop()
    ?.split('?')[0]
    ?.split('#')[0]
    ?.trim();

  if (basename && basename.includes('.')) {
    return sanitizeJimengReferenceFileName(basename);
  }

  const extension = resolveVideoDataUrlExtension(dataUrl);
  return sanitizeJimengReferenceFileName(`jimeng-video-${index + 1}.${extension}`);
}

export async function prepareJimengReferenceImages(
  sources: string[] | undefined
): Promise<JimengReferenceImagePayload[]> {
  const uniqueSources = [...new Set((sources ?? []).map((source) => source.trim()).filter(Boolean))];
  if (uniqueSources.length === 0) {
    return [];
  }

  return await Promise.all(
    uniqueSources.map(async (source, index) => {
      const dataUrl = await createPreviewDataUrl(source, JIMENG_REFERENCE_IMAGE_MAX_DIMENSION);
      return {
        fileName: resolveJimengReferenceFileName(source, dataUrl, index),
        dataUrl,
      };
    })
  );
}

export async function prepareJimengReferenceAudios(
  sources: string[] | undefined
): Promise<JimengReferenceAudioPayload[]> {
  const uniqueSources = [...new Set((sources ?? []).map((source) => source.trim()).filter(Boolean))];
  if (uniqueSources.length === 0) {
    return [];
  }

  return await Promise.all(
    uniqueSources.map(async (source, index) => {
      const dataUrl = await audioUrlToDataUrl(source);
      return {
        fileName: resolveJimengReferenceAudioFileName(source, dataUrl, index),
        dataUrl,
      };
    })
  );
}

export async function prepareJimengReferenceVideos(
  sources: string[] | undefined
): Promise<JimengReferenceVideoPayload[]> {
  const uniqueSources = [...new Set((sources ?? []).map((source) => source.trim()).filter(Boolean))];
  if (uniqueSources.length === 0) {
    return [];
  }

  return await Promise.all(
    uniqueSources.map(async (source, index) => {
      const dataUrl = await videoUrlToDataUrl(source);
      return {
        fileName: resolveJimengReferenceVideoFileName(source, dataUrl, index),
        dataUrl,
      };
    })
  );
}
