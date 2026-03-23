import { isTauri } from '@tauri-apps/api/core';
import { persistImageBinary, persistImageSource } from '@/commands/image';
import { reduceAspectRatio } from './imageData';

export interface VideoMetadata {
  width: number;
  height: number;
  duration: number;
}

export interface PreparedVideo {
  videoUrl: string;
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
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    
    video.onloadedmetadata = () => {
      resolve({
        width: video.videoWidth,
        height: video.videoHeight,
        duration: video.duration,
      });
      URL.revokeObjectURL(video.src);
    };
    
    video.onerror = () => {
      URL.revokeObjectURL(video.src);
      reject(new Error('Failed to load video metadata'));
    };
    
    video.src = URL.createObjectURL(file);
  });
}

export async function prepareNodeVideoFromFile(file: File): Promise<PreparedVideo> {
  if (!isSupportedVideoType(file.type)) {
    throw new Error(`Unsupported video type: ${file.type}`);
  }

  const metadata = await getVideoMetadata(file);
  const aspectRatio = reduceAspectRatio(metadata.width, metadata.height);

  const tauriFilePath = (file as File & { path?: string }).path;
  const normalizedPath = typeof tauriFilePath === 'string' ? tauriFilePath.trim() : '';

  if (isTauri() && normalizedPath.length > 0) {
    const persistedVideoPath = await persistImageSource(normalizedPath);
    return {
      videoUrl: persistedVideoPath,
      aspectRatio,
      duration: metadata.duration,
    };
  }

  if (isTauri()) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const persistedVideoPath = await persistImageBinary(bytes, resolveVideoExtension(file));
    return {
      videoUrl: persistedVideoPath,
      aspectRatio,
      duration: metadata.duration,
    };
  }

  const videoUrl = URL.createObjectURL(file);

  return {
    videoUrl,
    aspectRatio,
    duration: metadata.duration,
  };
}

export function captureVideoFrame(video: HTMLVideoElement): string {
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Failed to get canvas context');
  }
  
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/png');
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
