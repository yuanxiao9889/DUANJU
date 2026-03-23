import { isTauri } from '@tauri-apps/api/core';
import { persistImageBinary, persistImageSource } from '@/commands/image';
import { prepareNodeImage, reduceAspectRatio } from './imageData';

export interface VideoMetadata {
  width: number;
  height: number;
  duration: number;
}

export interface PreparedVideo {
  videoUrl: string;
  previewImageUrl: string | null;
  aspectRatio: string;
  duration: number;
}

const SUPPORTED_VIDEO_TYPES = [
  'video/mp4',
  'video/webm',
  'video/ogg',
  'video/quicktime',
  'video/x-msvideo',
  'video/x-matroska',
];
const VIDEO_POSTER_MAX_DIMENSION = 960;

export function isSupportedVideoType(mimeType: string): boolean {
  return SUPPORTED_VIDEO_TYPES.includes(mimeType.toLowerCase());
}

function resolveVideoExtension(file: File): string {
  const mime = file.type.toLowerCase();
  if (mime === 'video/mp4') return 'mp4';
  if (mime === 'video/webm') return 'webm';
  if (mime === 'video/ogg') return 'ogv';
  if (mime === 'video/quicktime') return 'mov';
  if (mime === 'video/x-msvideo') return 'avi';
  if (mime === 'video/x-matroska') return 'mkv';

  const name = file.name.trim();
  const dot = name.lastIndexOf('.');
  if (dot >= 0 && dot < name.length - 1) {
    return name.slice(dot + 1).toLowerCase();
  }

  return 'mp4';
}

export function getVideoMetadata(file: File): Promise<VideoMetadata> {
  return getVideoMetadataAndPoster(file).then((result) => result.metadata);
}

async function getVideoMetadataAndPoster(
  file: File
): Promise<{ metadata: VideoMetadata; posterDataUrl: string | null }> {
  return await new Promise((resolve, reject) => {
    const video = document.createElement('video');
    const objectUrl = URL.createObjectURL(file);
    let settled = false;

    const cleanup = () => {
      if (video.src) {
        video.pause();
        video.removeAttribute('src');
        video.load();
      }
      URL.revokeObjectURL(objectUrl);
    };

    const finishResolve = (metadata: VideoMetadata, posterDataUrl: string | null) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve({ metadata, posterDataUrl });
    };

    const finishReject = (error: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      reject(error);
    };

    const capturePoster = (metadata: VideoMetadata) => {
      try {
        const posterDataUrl = captureVideoFrame(video, VIDEO_POSTER_MAX_DIMENSION);
        finishResolve(metadata, posterDataUrl);
      } catch {
        finishResolve(metadata, null);
      }
    };

    video.preload = 'auto';
    video.muted = true;
    video.playsInline = true;

    video.onloadeddata = () => {
      const metadata: VideoMetadata = {
        width: video.videoWidth,
        height: video.videoHeight,
        duration: video.duration,
      };

      const targetTime =
        Number.isFinite(video.duration) && video.duration > 0.18
          ? Math.min(0.12, Math.max(video.duration / 10, 0.04))
          : 0;

      if (targetTime <= 0.01 || Math.abs(video.currentTime - targetTime) <= 0.01) {
        capturePoster(metadata);
        return;
      }

      video.onseeked = () => capturePoster(metadata);
      try {
        video.currentTime = targetTime;
      } catch {
        capturePoster(metadata);
      }
    };

    video.onerror = () => {
      finishReject(new Error('Failed to load video metadata'));
    };

    video.src = objectUrl;
  });
}

async function prepareVideoPoster(posterDataUrl: string | null): Promise<string | null> {
  if (!posterDataUrl) {
    return null;
  }

  const preparedPoster = await prepareNodeImage(posterDataUrl, 640);
  return preparedPoster.previewImageUrl ?? preparedPoster.imageUrl;
}

export async function prepareNodeVideoFromFile(file: File): Promise<PreparedVideo> {
  if (!isSupportedVideoType(file.type)) {
    throw new Error(`Unsupported video type: ${file.type}`);
  }

  const { metadata, posterDataUrl } = await getVideoMetadataAndPoster(file);
  const previewImageUrl = await prepareVideoPoster(posterDataUrl).catch(() => null);
  const aspectRatio = reduceAspectRatio(metadata.width, metadata.height);

  const tauriFilePath = (file as File & { path?: string }).path;
  const normalizedPath = typeof tauriFilePath === 'string' ? tauriFilePath.trim() : '';

  if (isTauri() && normalizedPath.length > 0) {
    const persistedVideoPath = await persistImageSource(normalizedPath);
    return {
      videoUrl: persistedVideoPath,
      previewImageUrl,
      aspectRatio,
      duration: metadata.duration,
    };
  }

  if (isTauri()) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const persistedVideoPath = await persistImageBinary(bytes, resolveVideoExtension(file));
    return {
      videoUrl: persistedVideoPath,
      previewImageUrl,
      aspectRatio,
      duration: metadata.duration,
    };
  }

  const videoUrl = URL.createObjectURL(file);

  return {
    videoUrl,
    previewImageUrl,
    aspectRatio,
    duration: metadata.duration,
  };
}

export function captureVideoFrame(
  video: HTMLVideoElement,
  maxDimension: number = Number.POSITIVE_INFINITY
): string {
  const naturalWidth = video.videoWidth;
  const naturalHeight = video.videoHeight;
  const scale =
    Number.isFinite(maxDimension) && maxDimension > 0
      ? Math.min(1, maxDimension / Math.max(naturalWidth, naturalHeight))
      : 1;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(naturalHeight * scale));

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Failed to get canvas context');
  }

  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.9);
}

export function formatVideoTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

export function parseVideoTime(timeStr: string): number {
  const parts = timeStr.split(':').map(Number);
  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }
  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  return 0;
}
