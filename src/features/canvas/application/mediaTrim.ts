import { resolveAudioDisplayUrl } from './audioData';
import { resolveImageDisplayUrl } from './imageData';

export type TrimmableMediaType = 'video' | 'audio';

export interface TrimmedMediaResult {
  blob: Blob;
  mimeType: string;
  extension: string;
}

const MIN_TRIM_DURATION_SECONDS = 0.1;
const TRIM_TIME_EPSILON_SECONDS = 0.03;
const MEDIA_POLL_INTERVAL_MS = 16;

const VIDEO_MIME_CANDIDATES = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
] as const;

const AUDIO_MIME_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
] as const;

type CaptureCapableMediaElement = HTMLMediaElement & {
  captureStream?: () => MediaStream;
  mozCaptureStream?: () => MediaStream;
};

function resolveAudioContextConstructor():
  | (new () => AudioContext)
  | undefined {
  return window.AudioContext
    ?? (window as typeof window & { webkitAudioContext?: new () => AudioContext }).webkitAudioContext;
}

function createMediaElement(mediaType: TrimmableMediaType): HTMLMediaElement {
  return mediaType === 'video'
    ? document.createElement('video')
    : document.createElement('audio');
}

function cleanupMediaElement(mediaElement: HTMLMediaElement): void {
  mediaElement.pause();
  mediaElement.removeAttribute('src');
  mediaElement.load();
}

function resolveMediaDisplayUrl(source: string, mediaType: TrimmableMediaType): string {
  return mediaType === 'video'
    ? resolveImageDisplayUrl(source)
    : resolveAudioDisplayUrl(source);
}

function normalizeTrimRange(
  startTime: number,
  endTime: number,
  duration: number
): { startTime: number; endTime: number } {
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error('Media duration is not available');
  }

  const safeStart = Math.max(0, Math.min(startTime, duration - MIN_TRIM_DURATION_SECONDS));
  const safeEnd = Math.max(
    safeStart + MIN_TRIM_DURATION_SECONDS,
    Math.min(endTime, duration)
  );

  if (safeEnd - safeStart < MIN_TRIM_DURATION_SECONDS) {
    throw new Error('Trim range is too short');
  }

  return {
    startTime: safeStart,
    endTime: safeEnd,
  };
}

function resolveRecorderMimeType(mediaType: TrimmableMediaType): string {
  const candidates = mediaType === 'video' ? VIDEO_MIME_CANDIDATES : AUDIO_MIME_CANDIDATES;

  if (typeof MediaRecorder === 'undefined') {
    throw new Error('MediaRecorder is not supported in this runtime');
  }

  if (typeof MediaRecorder.isTypeSupported !== 'function') {
    return candidates[0];
  }

  return candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate))
    ?? candidates[candidates.length - 1];
}

function resolveRecorderExtension(mediaType: TrimmableMediaType, mimeType: string): string {
  const lowerMimeType = mimeType.toLowerCase();
  if (lowerMimeType.includes('ogg')) {
    return 'ogg';
  }

  return mediaType === 'video' ? 'webm' : 'webm';
}

function waitForMediaMetadata(mediaElement: HTMLMediaElement): Promise<void> {
  if (Number.isFinite(mediaElement.duration) && mediaElement.duration > 0) {
    return Promise.resolve();
  }

  return new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      mediaElement.removeEventListener('loadedmetadata', handleReady);
      mediaElement.removeEventListener('durationchange', handleReady);
      mediaElement.removeEventListener('error', handleError);
    };

    const handleReady = () => {
      if (Number.isFinite(mediaElement.duration) && mediaElement.duration > 0) {
        cleanup();
        resolve();
      }
    };

    const handleError = () => {
      cleanup();
      reject(new Error('Failed to load media metadata'));
    };

    mediaElement.addEventListener('loadedmetadata', handleReady);
    mediaElement.addEventListener('durationchange', handleReady);
    mediaElement.addEventListener('error', handleError);
  });
}

function seekMedia(mediaElement: HTMLMediaElement, targetTime: number): Promise<void> {
  if (Math.abs(mediaElement.currentTime - targetTime) <= TRIM_TIME_EPSILON_SECONDS) {
    return Promise.resolve();
  }

  return new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      mediaElement.removeEventListener('seeked', handleSeeked);
      mediaElement.removeEventListener('error', handleError);
    };

    const handleSeeked = () => {
      cleanup();
      resolve();
    };

    const handleError = () => {
      cleanup();
      reject(new Error('Failed to seek media to requested time'));
    };

    mediaElement.addEventListener('seeked', handleSeeked);
    mediaElement.addEventListener('error', handleError);

    try {
      mediaElement.currentTime = targetTime;
    } catch (error) {
      cleanup();
      reject(
        error instanceof Error
          ? error
          : new Error('Failed to seek media to requested time')
      );
    }
  });
}

function getVideoCaptureStream(mediaElement: HTMLMediaElement): MediaStream {
  const captureElement = mediaElement as CaptureCapableMediaElement;
  const captureStream = captureElement.captureStream?.()
    ?? captureElement.mozCaptureStream?.();

  if (!captureStream) {
    throw new Error('Video capture is not supported in this runtime');
  }

  return captureStream;
}

export async function trimMediaSource(
  source: string,
  mediaType: TrimmableMediaType,
  startTime: number,
  endTime: number
): Promise<TrimmedMediaResult> {
  const trimmedSource = source.trim();
  if (!trimmedSource) {
    throw new Error('Media source is empty');
  }

  const AudioContextConstructor = resolveAudioContextConstructor();
  if (!AudioContextConstructor) {
    throw new Error('AudioContext is not supported in this runtime');
  }

  const mediaElement = createMediaElement(mediaType);
  const audioContext = new AudioContextConstructor();
  const cleanupTasks: Array<() => void> = [
    () => {
      void audioContext.close().catch(() => undefined);
    },
    () => {
      cleanupMediaElement(mediaElement);
    },
  ];

  try {
    mediaElement.preload = 'auto';
    mediaElement.muted = true;
    mediaElement.volume = 0;
    if (mediaElement instanceof HTMLVideoElement) {
      mediaElement.playsInline = true;
    }

    mediaElement.src = resolveMediaDisplayUrl(trimmedSource, mediaType);
    await waitForMediaMetadata(mediaElement);

    const resolvedRange = normalizeTrimRange(startTime, endTime, mediaElement.duration);
    await seekMedia(mediaElement, resolvedRange.startTime);
    await audioContext.resume();

    const sourceNode = audioContext.createMediaElementSource(mediaElement);
    const destination = audioContext.createMediaStreamDestination();
    sourceNode.connect(destination);

    const streamTracks = mediaType === 'video'
      ? [
          ...getVideoCaptureStream(mediaElement).getVideoTracks(),
          ...destination.stream.getAudioTracks(),
        ]
      : destination.stream.getAudioTracks();
    const recordingStream = new MediaStream(streamTracks);
    cleanupTasks.push(() => {
      recordingStream.getTracks().forEach((track) => track.stop());
    });

    const preferredMimeType = resolveRecorderMimeType(mediaType);
    const recorder = preferredMimeType
      ? new MediaRecorder(recordingStream, { mimeType: preferredMimeType })
      : new MediaRecorder(recordingStream);

    const chunks: BlobPart[] = [];
    const result = await new Promise<TrimmedMediaResult>((resolve, reject) => {
      let settled = false;
      let pollTimer: number | null = null;

      const cleanup = () => {
        if (pollTimer !== null) {
          window.clearInterval(pollTimer);
          pollTimer = null;
        }
        recorder.removeEventListener('dataavailable', handleDataAvailable);
        recorder.removeEventListener('stop', handleStop);
        recorder.removeEventListener('error', handleError);
        mediaElement.removeEventListener('ended', handleEnded);
      };

      const finishResolve = (value: TrimmedMediaResult) => {
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
        try {
          mediaElement.pause();
        } catch {
          // ignore pause cleanup error
        }
        if (recorder.state !== 'inactive') {
          recorder.stop();
        }
        reject(error);
      };

      const stopRecording = () => {
        if (recorder.state === 'inactive') {
          return;
        }

        try {
          mediaElement.pause();
        } catch {
          // ignore pause cleanup error
        }
        recorder.stop();
      };

      const handleDataAvailable = (event: BlobEvent) => {
        if (event.data.size > 0) {
          chunks.push(event.data);
        }
      };

      const handleStop = () => {
        const mimeType = recorder.mimeType || preferredMimeType;
        const blob = new Blob(chunks, { type: mimeType });
        if (blob.size <= 0) {
          finishReject(new Error('Failed to capture trimmed media'));
          return;
        }

        finishResolve({
          blob,
          mimeType,
          extension: resolveRecorderExtension(mediaType, mimeType),
        });
      };

      const handleError = (event: Event) => {
        const error = 'error' in event && event.error instanceof Error
          ? event.error
          : new Error('Failed to record trimmed media');
        finishReject(error);
      };

      const handleEnded = () => {
        stopRecording();
      };

      recorder.addEventListener('dataavailable', handleDataAvailable);
      recorder.addEventListener('stop', handleStop);
      recorder.addEventListener('error', handleError as EventListener);
      mediaElement.addEventListener('ended', handleEnded);

      recorder.start();

      void mediaElement.play().then(() => {
        pollTimer = window.setInterval(() => {
          if (
            mediaElement.currentTime >= resolvedRange.endTime - TRIM_TIME_EPSILON_SECONDS
            || mediaElement.ended
          ) {
            stopRecording();
          }
        }, MEDIA_POLL_INTERVAL_MS);
      }).catch((error) => {
        finishReject(
          error instanceof Error
            ? error
            : new Error('Failed to start media playback for trimming')
        );
      });
    });

    return result;
  } finally {
    cleanupTasks.reverse().forEach((task) => task());
  }
}
