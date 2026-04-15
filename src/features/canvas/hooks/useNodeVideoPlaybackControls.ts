import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import type { TFunction } from 'i18next';

import {
  CANVAS_NODE_TYPES,
  type CanvasNodeData,
  type CanvasNodeType,
} from '@/features/canvas/domain/canvasNodes';
import {
  captureVideoFrame,
  captureVideoFrameFromSource,
  waitForVideoFrameReady,
} from '@/features/canvas/application/videoData';
import { prepareNodeImage } from '@/features/canvas/application/imageData';

const DEFAULT_FRAME_RATE = 24;
const FRAME_TIME = 1 / DEFAULT_FRAME_RATE;

type ScreenshotStatusTone = 'info' | 'success' | 'danger';

interface ScreenshotStatus {
  tone: ScreenshotStatusTone;
  message: string;
}

interface UseNodeVideoPlaybackControlsOptions {
  nodeId: string;
  videoUrl: string | null | undefined;
  videoSource: string | null;
  videoFileName?: string | null;
  fallbackTitle: string;
  nodePosition: { x: number; y: number } | null;
  nodeWidth: number;
  initialDuration?: number | null;
  t: TFunction;
  addNode: (
    type: CanvasNodeType,
    position: { x: number; y: number },
    data?: Partial<CanvasNodeData>,
    options?: { inheritParentFromNodeId?: string },
  ) => string;
  addEdge: (source: string, target: string) => string | null;
  onDurationChange?: (duration: number) => void;
}

interface UseNodeVideoPlaybackControlsResult {
  videoRef: MutableRefObject<HTMLVideoElement | null>;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  flashFrame: boolean;
  isCapturingScreenshot: boolean;
  screenshotStatus: ScreenshotStatus | null;
  videoError: string | null;
  isVideoReady: boolean;
  screenshotButtonDisabled: boolean;
  togglePlay: () => void;
  seekToPrevFrame: () => void;
  seekToNextFrame: () => void;
  handleVideoPlay: () => void;
  handleVideoPause: () => void;
  handleTimeUpdate: () => void;
  handleLoadedMetadata: () => void;
  handleLoadedData: () => void;
  handleCanPlay: () => void;
  handleVideoError: () => void;
  handleRetryLoad: () => void;
  handleScreenshot: () => Promise<void>;
}

function resolveScreenshotFailureMessage(error: unknown, t: TFunction): string {
  const rawMessage = error instanceof Error ? error.message : String(error);
  const normalizedMessage = rawMessage.toLowerCase();

  if (
    normalizedMessage.includes('video frame is not ready') ||
    normalizedMessage.includes('timed out waiting for video frame data') ||
    normalizedMessage.includes('failed to load video frame data') ||
    normalizedMessage.includes('video dimensions are not available')
  ) {
    return t('node.videoNode.screenshotNotReady');
  }

  return t('node.videoNode.screenshotFailed');
}

export function useNodeVideoPlaybackControls({
  nodeId,
  videoUrl,
  videoSource,
  videoFileName,
  fallbackTitle,
  nodePosition,
  nodeWidth,
  initialDuration,
  t,
  addNode,
  addEdge,
  onDurationChange,
}: UseNodeVideoPlaybackControlsOptions): UseNodeVideoPlaybackControlsResult {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const screenshotCountRef = useRef(0);
  const screenshotStatusTimeoutRef = useRef<number | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(
    typeof initialDuration === 'number' && Number.isFinite(initialDuration)
      ? initialDuration
      : 0,
  );
  const [flashFrame, setFlashFrame] = useState(false);
  const [isCapturingScreenshot, setIsCapturingScreenshot] = useState(false);
  const [screenshotStatus, setScreenshotStatus] = useState<ScreenshotStatus | null>(null);
  const [videoError, setVideoError] = useState<string | null>(null);
  const [isVideoReady, setIsVideoReady] = useState(false);

  const showScreenshotStatus = useCallback((
    tone: ScreenshotStatusTone,
    message: string,
    durationMs: number | null = 2600,
  ) => {
    if (screenshotStatusTimeoutRef.current !== null) {
      window.clearTimeout(screenshotStatusTimeoutRef.current);
      screenshotStatusTimeoutRef.current = null;
    }

    setScreenshotStatus({ tone, message });

    if (durationMs !== null) {
      screenshotStatusTimeoutRef.current = window.setTimeout(() => {
        setScreenshotStatus(null);
        screenshotStatusTimeoutRef.current = null;
      }, durationMs);
    }
  }, []);

  const togglePlay = useCallback(() => {
    if (!videoRef.current) {
      return;
    }

    if (isPlaying) {
      videoRef.current.pause();
      return;
    }

    void videoRef.current.play().catch(() => {
      setIsPlaying(false);
    });
  }, [isPlaying]);

  const seekToPrevFrame = useCallback(() => {
    if (!videoRef.current || isPlaying) {
      return;
    }

    const nextTime = Math.max(0, videoRef.current.currentTime - FRAME_TIME);
    videoRef.current.currentTime = nextTime;
    setCurrentTime(nextTime);
  }, [isPlaying]);

  const seekToNextFrame = useCallback(() => {
    if (!videoRef.current || isPlaying) {
      return;
    }

    const nextTime = Math.min(duration, videoRef.current.currentTime + FRAME_TIME);
    videoRef.current.currentTime = nextTime;
    setCurrentTime(nextTime);
  }, [duration, isPlaying]);

  const handleVideoPlay = useCallback(() => {
    setIsPlaying(true);
  }, []);

  const handleVideoPause = useCallback(() => {
    setIsPlaying(false);
  }, []);

  const handleTimeUpdate = useCallback(() => {
    if (!videoRef.current) {
      return;
    }

    setCurrentTime(videoRef.current.currentTime);
  }, []);

  const handleLoadedMetadata = useCallback(() => {
    if (!videoRef.current) {
      return;
    }

    const nextDuration = Number.isFinite(videoRef.current.duration)
      ? videoRef.current.duration
      : 0;
    setDuration(nextDuration);

    if (typeof onDurationChange === 'function') {
      onDurationChange(nextDuration);
    }

    if (
      videoRef.current.videoWidth > 0 &&
      videoRef.current.videoHeight > 0 &&
      videoRef.current.readyState >= 2
    ) {
      setIsVideoReady(true);
    }

    setVideoError(null);
  }, [onDurationChange]);

  const handleLoadedData = useCallback(() => {
    setIsVideoReady(true);
    setVideoError(null);
  }, []);

  const handleCanPlay = useCallback(() => {
    setIsVideoReady(true);
    setVideoError(null);
  }, []);

  const handleVideoError = useCallback(() => {
    setIsPlaying(false);
    setIsVideoReady(false);
    setVideoError(t('node.videoNode.loadFailed'));
  }, [t]);

  const handleRetryLoad = useCallback(() => {
    if (!videoRef.current) {
      return;
    }

    setVideoError(null);
    setIsVideoReady(false);
    videoRef.current.load();
  }, []);

  const handleScreenshot = useCallback(async () => {
    if (!videoRef.current || !videoUrl || isCapturingScreenshot) {
      return;
    }

    try {
      setIsCapturingScreenshot(true);
      showScreenshotStatus('info', t('node.videoNode.screenshotPending'), null);

      const captureTime = videoRef.current.currentTime;
      const preferredSource = videoRef.current.currentSrc || videoSource || '';
      let dataUrl: string;

      try {
        await waitForVideoFrameReady(videoRef.current, 1200);
        dataUrl = captureVideoFrame(videoRef.current);
      } catch (directCaptureError) {
        if (!preferredSource) {
          throw directCaptureError;
        }

        dataUrl = await captureVideoFrameFromSource(preferredSource, captureTime);
      }

      const prepared = await prepareNodeImage(dataUrl);
      if (!nodePosition) {
        showScreenshotStatus('danger', t('node.videoNode.screenshotFailed'), 4200);
        return;
      }

      const screenshotIndex = screenshotCountRef.current + 1;
      screenshotCountRef.current = screenshotIndex;

      const screenshotNodeId = addNode(
        CANVAS_NODE_TYPES.upload,
        {
          x: nodePosition.x + nodeWidth + 40,
          y: nodePosition.y + (screenshotIndex - 1) * 50,
        },
        {
          imageUrl: prepared.imageUrl,
          previewImageUrl: prepared.previewImageUrl,
          aspectRatio: prepared.aspectRatio,
          displayName: t('node.videoNode.screenshotName', {
            name: videoFileName || fallbackTitle || t('node.videoNode.title'),
            index: screenshotIndex,
          }),
        },
        { inheritParentFromNodeId: nodeId },
      );

      addEdge(nodeId, screenshotNodeId);
      setFlashFrame(true);
      window.setTimeout(() => setFlashFrame(false), 150);
      showScreenshotStatus('success', t('node.videoNode.screenshotSuccess'));
    } catch (error) {
      showScreenshotStatus(
        'danger',
        resolveScreenshotFailureMessage(error, t),
        4200,
      );
    } finally {
      setIsCapturingScreenshot(false);
    }
  }, [
    addEdge,
    addNode,
    fallbackTitle,
    isCapturingScreenshot,
    nodeId,
    nodePosition,
    nodeWidth,
    showScreenshotStatus,
    t,
    videoFileName,
    videoSource,
    videoUrl,
  ]);

  useEffect(() => {
    if (!videoUrl) {
      setIsPlaying(false);
      setCurrentTime(0);
      setDuration(0);
      setVideoError(null);
      setIsVideoReady(false);
      screenshotCountRef.current = 0;
      return;
    }

    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(
      typeof initialDuration === 'number' && Number.isFinite(initialDuration)
        ? initialDuration
        : 0,
    );
    setVideoError(null);
    setIsVideoReady(false);
    screenshotCountRef.current = 0;
  }, [initialDuration, videoUrl]);

  useEffect(() => {
    return () => {
      if (screenshotStatusTimeoutRef.current !== null) {
        window.clearTimeout(screenshotStatusTimeoutRef.current);
      }
    };
  }, []);

  const screenshotButtonDisabled =
    isCapturingScreenshot ||
    Boolean(videoError) ||
    !videoUrl ||
    !isVideoReady;

  return {
    videoRef,
    isPlaying,
    currentTime,
    duration,
    flashFrame,
    isCapturingScreenshot,
    screenshotStatus,
    videoError,
    isVideoReady,
    screenshotButtonDisabled,
    togglePlay,
    seekToPrevFrame,
    seekToNextFrame,
    handleVideoPlay,
    handleVideoPause,
    handleTimeUpdate,
    handleLoadedMetadata,
    handleLoadedData,
    handleCanPlay,
    handleVideoError,
    handleRetryLoad,
    handleScreenshot,
  };
}
