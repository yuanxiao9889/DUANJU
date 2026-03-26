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

const HAVE_CURRENT_DATA = 2;
const VIDEO_FRAME_READY_TIMEOUT_MS = 3000;

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
  if (video.videoWidth <= 0 || video.videoHeight <= 0) {
    throw new Error('Video dimensions are not available yet');
  }

  if (video.readyState < HAVE_CURRENT_DATA) {
    throw new Error(`Video frame is not ready yet (readyState=${video.readyState})`);
  }

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

function cleanupVideoElement(video: HTMLVideoElement): void {
  if (video.src) {
    video.pause();
    video.removeAttribute('src');
    video.load();
  }
}

export async function waitForVideoFrameReady(
  video: HTMLVideoElement,
  timeoutMs = VIDEO_FRAME_READY_TIMEOUT_MS
): Promise<void> {
  if (video.videoWidth > 0 && video.videoHeight > 0 && video.readyState >= HAVE_CURRENT_DATA) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const timeoutId = window.setTimeout(() => {
      finishReject(new Error('Timed out waiting for video frame data'));
    }, timeoutMs);

    const cleanup = () => {
      window.clearTimeout(timeoutId);
      video.removeEventListener('loadeddata', handleReady);
      video.removeEventListener('canplay', handleReady);
      video.removeEventListener('seeked', handleReady);
      video.removeEventListener('error', handleError);
    };

    const finishResolve = () => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve();
    };

    const finishReject = (error: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      reject(error);
    };

    const handleReady = () => {
      if (video.videoWidth > 0 && video.videoHeight > 0 && video.readyState >= HAVE_CURRENT_DATA) {
        finishResolve();
      }
    };

    const handleError = () => {
      finishReject(new Error('Failed to load video frame data'));
    };

    video.addEventListener('loadeddata', handleReady);
    video.addEventListener('canplay', handleReady);
    video.addEventListener('seeked', handleReady);
    video.addEventListener('error', handleError);
    handleReady();
  });
}

function clampCaptureTime(duration: number, targetTime: number): number {
  if (!Number.isFinite(targetTime) || targetTime < 0) {
    return 0;
  }

  if (!Number.isFinite(duration) || duration <= 0) {
    return targetTime;
  }

  if (duration <= 0.05) {
    return 0;
  }

  return Math.max(0, Math.min(targetTime, duration - 0.05));
}

async function waitForVideoSeek(
  video: HTMLVideoElement,
  targetTime: number,
  timeoutMs = VIDEO_FRAME_READY_TIMEOUT_MS
): Promise<void> {
  if (Math.abs(video.currentTime - targetTime) <= 0.02) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const timeoutId = window.setTimeout(() => {
      finishReject(new Error('Timed out waiting for video seek'));
    }, timeoutMs);

    const cleanup = () => {
      window.clearTimeout(timeoutId);
      video.removeEventListener('seeked', handleSeeked);
      video.removeEventListener('error', handleError);
    };

    const finishResolve = () => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve();
    };

    const finishReject = (error: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      reject(error);
    };

    const handleSeeked = () => finishResolve();
    const handleError = () => finishReject(new Error('Failed while seeking video frame'));

    video.addEventListener('seeked', handleSeeked);
    video.addEventListener('error', handleError);

    try {
      video.currentTime = targetTime;
    } catch (error) {
      finishReject(
        error instanceof Error ? error : new Error('Failed to seek to requested video frame')
      );
    }
  });
}

async function createCaptureSourceObjectUrl(source: string): Promise<{
  captureSource: string;
  revoke?: () => void;
}> {
  const trimmedSource = source.trim();
  if (!trimmedSource) {
    throw new Error('Video source is empty');
  }

  const normalizedSource = trimmedSource.toLowerCase();
  if (normalizedSource.startsWith('blob:') || normalizedSource.startsWith('data:')) {
    return { captureSource: trimmedSource };
  }

  if (
    normalizedSource.startsWith('http://') ||
    normalizedSource.startsWith('https://') ||
    normalizedSource.startsWith('asset:') ||
    normalizedSource.startsWith('tauri:')
  ) {
    const response = await fetch(trimmedSource);
    if (!response.ok) {
      throw new Error(`Failed to fetch video source (${response.status})`);
    }

    const videoBlob = await response.blob();
    const objectUrl = URL.createObjectURL(videoBlob);
    return {
      captureSource: objectUrl,
      revoke: () => URL.revokeObjectURL(objectUrl),
    };
  }

  return { captureSource: trimmedSource };
}

export async function captureVideoFrameFromSource(
  source: string,
  currentTime = 0,
  maxDimension: number = Number.POSITIVE_INFINITY
): Promise<string> {
  const { captureSource, revoke } = await createCaptureSourceObjectUrl(source);
  const video = document.createElement('video');
  video.preload = 'auto';
  video.muted = true;
  video.playsInline = true;

  try {
    video.src = captureSource;
    await waitForVideoFrameReady(video);
    const targetTime = clampCaptureTime(video.duration, currentTime);
    await waitForVideoSeek(video, targetTime);
    await waitForVideoFrameReady(video);
    return captureVideoFrame(video, maxDimension);
  } finally {
    cleanupVideoElement(video);
    revoke?.();
  }
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
