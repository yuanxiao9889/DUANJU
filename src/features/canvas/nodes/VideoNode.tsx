import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from 'react';
import {
  Handle,
  useUpdateNodeInternals,
  Position,
  type NodeProps,
} from '@xyflow/react';
import {
  AlertTriangle,
  Camera,
  ChevronLeft,
  ChevronRight,
  Pause,
  Play,
  RefreshCw,
  Upload,
  Video,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  CANVAS_NODE_TYPES,
  EXPORT_RESULT_NODE_MIN_HEIGHT,
  EXPORT_RESULT_NODE_MIN_WIDTH,
  type VideoNodeData,
} from '@/features/canvas/domain/canvasNodes';
import {
  resolveMinEdgeFittedSize,
  resolveResizeMinConstraintsByAspect,
} from '@/features/canvas/application/imageNodeSizing';
import {
  isNodeUsingDefaultDisplayName,
  resolveNodeDisplayName,
} from '@/features/canvas/domain/nodeDisplay';
import { NodeHeader, NODE_HEADER_FLOATING_POSITION_CLASS } from '@/features/canvas/ui/NodeHeader';
import { NodeResizeHandle } from '@/features/canvas/ui/NodeResizeHandle';
import {
  captureVideoFrame,
  captureVideoFrameFromSource,
  formatVideoTime,
  isSupportedVideoFile,
  prepareNodeVideoFromFile,
  resolveVideoDisplayUrl,
  waitForVideoFrameReady,
} from '@/features/canvas/application/videoData';
import {
  prepareNodeImage,
  resolveImageDisplayUrl,
} from '@/features/canvas/application/imageData';
import { useCanvasNodeById } from '@/features/canvas/hooks/useCanvasNodeGraph';
import { useCanvasStore } from '@/stores/canvasStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { NodeStatusBadge } from '@/features/canvas/ui/NodeStatusBadge';
import {
  NodeDescriptionPanel,
  NODE_DESCRIPTION_PANEL_EXPANDED_TOTAL_HEIGHT,
} from '@/features/canvas/ui/NodeDescriptionPanel';
import { resolveNodeStyleDimension } from '@/features/canvas/ui/nodeDimensionUtils';

type VideoNodeProps = NodeProps & {
  id: string;
  data: VideoNodeData;
  selected?: boolean;
};

const DEFAULT_FRAME_RATE = 24;
const FRAME_TIME = 1 / DEFAULT_FRAME_RATE;
const VIDEO_NODE_CONTROL_BAR_HEIGHT = 54;

function resolveNodeDimension(value: number | undefined, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 1) {
    return Math.round(value);
  }
  return fallback;
}

function resolveDroppedVideoFile(event: DragEvent<HTMLElement>): File | null {
  const directFile = event.dataTransfer.files?.[0];
  if (directFile && directFile.type.startsWith('video/')) {
    return directFile;
  }

  const item = Array.from(event.dataTransfer.items || []).find(
    (candidate) => candidate.kind === 'file' && candidate.type.startsWith('video/')
  );
  return item?.getAsFile() ?? null;
}

export const VideoNode = memo(({ id, data, selected, width }: VideoNodeProps) => {
  const { t } = useTranslation();
  const updateNodeInternals = useUpdateNodeInternals();
  const setSelectedNode = useCanvasStore((state) => state.setSelectedNode);
  const updateNodeData = useCanvasStore((state) => state.updateNodeData);
  const isDescriptionPanelOpen = useCanvasStore(
    (state) => Boolean(state.nodeDescriptionPanelOpenById[id])
  );
  const isReferenceSourceHighlighted = useCanvasStore(
    (state) => state.highlightedReferenceSourceNodeId === id
  );
  const addNode = useCanvasStore((state) => state.addNode);
  const addEdge = useCanvasStore((state) => state.addEdge);
  const currentNode = useCanvasNodeById(id);
  const useUploadFilenameAsNodeTitle = useSettingsStore((state) => state.useUploadFilenameAsNodeTitle);
  
  const inputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const screenshotCountRef = useRef(0);
  const screenshotStatusTimeoutRef = useRef<number | null>(null);
  const posterBackfillAttemptRef = useRef<string | null>(null);
  
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [flashFrame, setFlashFrame] = useState(false);
  const [isProcessingFile, setIsProcessingFile] = useState(false);
  const [isCapturingScreenshot, setIsCapturingScreenshot] = useState(false);
  const [screenshotStatus, setScreenshotStatus] = useState<{
    tone: 'info' | 'success' | 'danger';
    message: string;
  } | null>(null);
  const [videoError, setVideoError] = useState<string | null>(null);
  const [isVideoReady, setIsVideoReady] = useState(false);
  
  const resolvedAspectRatio = data.aspectRatio || '16:9';
  const compactSize = resolveMinEdgeFittedSize(resolvedAspectRatio, {
    minWidth: EXPORT_RESULT_NODE_MIN_WIDTH,
    minHeight: EXPORT_RESULT_NODE_MIN_HEIGHT,
  });
  const mediaMinWidth = compactSize.width;
  const mediaMinHeight = compactSize.height;
  const resizeConstraints = resolveResizeMinConstraintsByAspect(resolvedAspectRatio, {
    minWidth: EXPORT_RESULT_NODE_MIN_WIDTH,
    minHeight: EXPORT_RESULT_NODE_MIN_HEIGHT,
  });
  const resizeMinWidth = Math.max(resizeConstraints.minWidth, mediaMinWidth);
  const explicitHeight = resolveNodeStyleDimension(currentNode?.style?.height);
  const collapsedMinHeight = resizeConstraints.minHeight + VIDEO_NODE_CONTROL_BAR_HEIGHT;
  const collapsedHeight = Math.max(
    explicitHeight ?? (mediaMinHeight + VIDEO_NODE_CONTROL_BAR_HEIGHT),
    collapsedMinHeight
  );
  const resizeMinHeight = collapsedMinHeight
    + (isDescriptionPanelOpen ? NODE_DESCRIPTION_PANEL_EXPANDED_TOTAL_HEIGHT : 0);
  const resolvedWidth = Math.max(resolveNodeDimension(width, mediaMinWidth), resizeMinWidth);
  const resolvedHeight = collapsedHeight
    + (isDescriptionPanelOpen ? NODE_DESCRIPTION_PANEL_EXPANDED_TOTAL_HEIGHT : 0);
  const nodeDescription =
    typeof data.nodeDescription === 'string' ? data.nodeDescription : '';
  
  const resolvedTitle = useMemo(() => {
    const videoFileName = typeof data.videoFileName === 'string' ? data.videoFileName.trim() : '';
    if (
      useUploadFilenameAsNodeTitle
      && videoFileName
      && isNodeUsingDefaultDisplayName(CANVAS_NODE_TYPES.video, data)
    ) {
      return videoFileName;
    }
    return resolveNodeDisplayName(CANVAS_NODE_TYPES.video, data);
  }, [data, useUploadFilenameAsNodeTitle]);

  const videoSource = useMemo(() => {
    if (!data.videoUrl) return null;
    return resolveVideoDisplayUrl(data.videoUrl);
  }, [data.videoUrl]);

  const posterSource = useMemo(() => {
    if (!data.previewImageUrl) {
      return null;
    }
    return resolveImageDisplayUrl(data.previewImageUrl);
  }, [data.previewImageUrl]);
  const nodePosition = currentNode?.position ?? null;

  const headerStatus = useMemo(() => {
    if (isProcessingFile) {
      return (
        <NodeStatusBadge
          icon={<RefreshCw className="h-3 w-3" />}
          label={t('node.videoNode.processing')}
          tone="processing"
          animate
        />
      );
    }

    if (videoError) {
      return (
        <NodeStatusBadge
          icon={<AlertTriangle className="h-3 w-3" />}
          label={t('node.videoNode.loadFailedShort')}
          tone="danger"
          title={videoError}
        />
      );
    }

    return null;
  }, [isProcessingFile, t, videoError]);

  const processFile = useCallback(
    async (file: File) => {
      if (!isSupportedVideoFile(file)) {
        setVideoError(t('node.videoNode.unsupportedFormat'));
        return;
      }

      try {
        setIsProcessingFile(true);
        setVideoError(null);
        setIsPlaying(false);
        setIsVideoReady(false);
        const prepared = await prepareNodeVideoFromFile(file);
        const nextData: Partial<VideoNodeData> = {
          videoUrl: prepared.videoUrl,
          previewImageUrl: prepared.previewImageUrl,
          videoFileName: file.name,
          aspectRatio: prepared.aspectRatio,
          duration: prepared.duration,
        };
        if (useUploadFilenameAsNodeTitle) {
          nextData.displayName = file.name;
        }
        updateNodeData(id, nextData);
        setDuration(prepared.duration);
        setCurrentTime(0);
        screenshotCountRef.current = 0;
      } catch (error) {
        console.error('Failed to process video file:', error);
        setVideoError(
          error instanceof Error && error.message.trim().length > 0
            ? error.message
            : t('node.videoNode.processFailed')
        );
      } finally {
        setIsProcessingFile(false);
      }
    },
    [id, t, updateNodeData, useUploadFilenameAsNodeTitle]
  );

  const handleDrop = useCallback(
    async (event: DragEvent<HTMLElement>) => {
      event.preventDefault();
      event.stopPropagation();
      const file = resolveDroppedVideoFile(event);
      if (file) {
        await processFile(file);
      }
    },
    [processFile]
  );

  const handleDragOver = useCallback((event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
  }, []);

  const handleFileChange = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (file) {
        await processFile(file);
      }
      event.target.value = '';
    },
    [processFile]
  );

  const handleNodeClick = useCallback(() => {
    setSelectedNode(id);
    if (!data.videoUrl) {
      inputRef.current?.click();
    }
  }, [data.videoUrl, id, setSelectedNode]);

  const togglePlay = useCallback(() => {
    if (!videoRef.current) return;
    
    if (isPlaying) {
      videoRef.current.pause();
    } else {
      void videoRef.current.play().catch(() => {
        setIsPlaying(false);
      });
    }
  }, [isPlaying]);

  const seekToPrevFrame = useCallback(() => {
    if (!videoRef.current || isPlaying) return;
    const newTime = Math.max(0, videoRef.current.currentTime - FRAME_TIME);
    videoRef.current.currentTime = newTime;
    setCurrentTime(newTime);
  }, [isPlaying]);

  const seekToNextFrame = useCallback(() => {
    if (!videoRef.current || isPlaying) return;
    const newTime = Math.min(duration, videoRef.current.currentTime + FRAME_TIME);
    videoRef.current.currentTime = newTime;
    setCurrentTime(newTime);
  }, [isPlaying, duration]);

  const handleVideoPlay = useCallback(() => {
    setIsPlaying(true);
  }, []);

  const handleVideoPause = useCallback(() => {
    setIsPlaying(false);
  }, []);

  const handleTimeUpdate = useCallback(() => {
    if (!videoRef.current) return;
    setCurrentTime(videoRef.current.currentTime);
  }, []);

  const handleLoadedMetadata = useCallback(() => {
    if (!videoRef.current) return;
    const nextDuration = Number.isFinite(videoRef.current.duration) ? videoRef.current.duration : 0;
    setDuration(nextDuration);
    if (Math.abs((data.duration ?? 0) - nextDuration) > 0.01) {
      updateNodeData(id, { duration: nextDuration });
    }
    if (videoRef.current.videoWidth > 0 && videoRef.current.videoHeight > 0 && videoRef.current.readyState >= 2) {
      setIsVideoReady(true);
    }
    setVideoError(null);
  }, [data.duration, id, updateNodeData]);

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

  const showScreenshotStatus = useCallback(
    (
      tone: 'info' | 'success' | 'danger',
      message: string,
      durationMs: number | null = 2600
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
    },
    []
  );

  const resolveScreenshotFailureMessage = useCallback(
    (error: unknown): string => {
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
    },
    [t]
  );

  const handleScreenshot = useCallback(async () => {
    if (!videoRef.current || !data.videoUrl || isCapturingScreenshot) return;
    
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

        console.warn('[videoNode] direct screenshot capture failed, trying fallback source capture', {
          error: directCaptureError,
          id,
          currentTime: captureTime,
          source: preferredSource,
        });

        dataUrl = await captureVideoFrameFromSource(preferredSource, captureTime);
      }

      const prepared = await prepareNodeImage(dataUrl);
      
      if (!nodePosition) {
        showScreenshotStatus('danger', t('node.videoNode.screenshotFailed'), 4200);
        return;
      }
      
      const screenshotIndex = screenshotCountRef.current + 1;
      screenshotCountRef.current = screenshotIndex;
      
      const newNodePosition = {
        x: nodePosition.x + resolvedWidth + 40,
        y: nodePosition.y + (screenshotIndex - 1) * 50,
      };
      
      const newNodeId = addNode(CANVAS_NODE_TYPES.upload, newNodePosition, {
        imageUrl: prepared.imageUrl,
        previewImageUrl: prepared.previewImageUrl,
        aspectRatio: prepared.aspectRatio,
        displayName: t('node.videoNode.screenshotName', {
          name: data.videoFileName || t('node.videoNode.title'),
          index: screenshotIndex,
        }),
      }, { inheritParentFromNodeId: id });
      
      addEdge(id, newNodeId);

      setFlashFrame(true);
      setTimeout(() => setFlashFrame(false), 150);
      showScreenshotStatus('success', t('node.videoNode.screenshotSuccess'));
    } catch (error) {
      console.error('Failed to capture screenshot:', {
        error,
        id,
        videoSource: videoRef.current?.currentSrc || videoSource || data.videoUrl,
        readyState: videoRef.current?.readyState,
        videoWidth: videoRef.current?.videoWidth,
        videoHeight: videoRef.current?.videoHeight,
        currentTime: videoRef.current?.currentTime,
      });
      showScreenshotStatus('danger', resolveScreenshotFailureMessage(error), 4200);
    } finally {
      setIsCapturingScreenshot(false);
    }
  }, [
    addEdge,
    addNode,
    data.videoFileName,
    data.videoUrl,
    id,
    isCapturingScreenshot,
    nodePosition,
    resolveScreenshotFailureMessage,
    resolvedWidth,
    showScreenshotStatus,
    t,
    videoSource,
  ]);

  useEffect(() => {
    if (!selected) return;
    
    const handleKeyDown = (e: globalThis.KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        (e.target as HTMLElement).isContentEditable
      ) {
        return;
      }
      
      if (e.key === 's' || e.key === 'S') {
        e.preventDefault();
        handleScreenshot();
      }
    };
    
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [selected, handleScreenshot]);

  useEffect(() => {
    return () => {
      if (screenshotStatusTimeoutRef.current !== null) {
        window.clearTimeout(screenshotStatusTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    updateNodeInternals(id);
  }, [id, resolvedHeight, resolvedWidth, updateNodeInternals]);

  useEffect(() => {
    if (!data.videoUrl) {
      posterBackfillAttemptRef.current = null;
      setVideoError(null);
      setIsVideoReady(false);
      setCurrentTime(0);
      return;
    }

    setVideoError(null);
    setIsVideoReady(false);
  }, [data.videoUrl]);

  useEffect(() => {
    const normalizedVideoUrl =
      typeof data.videoUrl === 'string' ? data.videoUrl.trim() : '';
    const normalizedPreviewImageUrl =
      typeof data.previewImageUrl === 'string' ? data.previewImageUrl.trim() : '';

    if (!normalizedVideoUrl) {
      posterBackfillAttemptRef.current = null;
      return;
    }

    if (normalizedPreviewImageUrl) {
      posterBackfillAttemptRef.current = normalizedVideoUrl;
      return;
    }

    const captureSource = videoRef.current?.currentSrc || videoSource || '';
    if (!captureSource || posterBackfillAttemptRef.current === normalizedVideoUrl) {
      return;
    }

    posterBackfillAttemptRef.current = normalizedVideoUrl;
    let cancelled = false;

    void (async () => {
      try {
        const captureTime =
          typeof data.duration === 'number' &&
          Number.isFinite(data.duration) &&
          data.duration > 0.18
            ? Math.min(0.12, Math.max(data.duration / 10, 0.04))
            : 0;

        let posterDataUrl: string;
        const videoElement = videoRef.current;
        if (
          videoElement &&
          videoElement.readyState >= 2 &&
          videoElement.videoWidth > 0 &&
          videoElement.videoHeight > 0
        ) {
          try {
            posterDataUrl = captureVideoFrame(videoElement, 960);
          } catch {
            posterDataUrl = await captureVideoFrameFromSource(
              captureSource,
              captureTime,
              960
            );
          }
        } else {
          posterDataUrl = await captureVideoFrameFromSource(
            captureSource,
            captureTime,
            960
          );
        }

        const preparedPoster = await prepareNodeImage(posterDataUrl, 640);
        const nextPreviewImageUrl =
          preparedPoster.previewImageUrl ?? preparedPoster.imageUrl;
        if (!cancelled && nextPreviewImageUrl) {
          updateNodeData(id, { previewImageUrl: nextPreviewImageUrl });
        }
      } catch (error) {
        console.warn('[videoNode] failed to backfill preview image', {
          error,
          id,
          videoUrl: normalizedVideoUrl,
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    data.duration,
    data.previewImageUrl,
    data.videoUrl,
    id,
    updateNodeData,
    videoSource,
  ]);

  const screenshotButtonDisabled =
    isProcessingFile || isCapturingScreenshot || Boolean(videoError) || !data.videoUrl || !isVideoReady;

  return (
      <div
        className={`
          group relative flex flex-col overflow-visible rounded-[var(--node-radius)] border bg-surface-dark/85 p-0 transition-all duration-150
          ${selected
            ? 'border-accent shadow-[0_0_0_2px_rgba(59,130,246,0.5),0_4px_20px_rgba(59,130,246,0.2)]'
            : isReferenceSourceHighlighted
              ? 'border-accent/80 shadow-[0_0_0_2px_rgba(59,130,246,0.28),0_4px_18px_rgba(59,130,246,0.12)]'
            : 'border-[rgba(15,23,42,0.22)] hover:border-[rgba(15,23,42,0.34)] hover:shadow-[0_4px_16px_rgba(0,0,0,0.12)] dark:border-[rgba(255,255,255,0.22)] dark:hover:border-[rgba(255,255,255,0.34)] dark:hover:shadow-[0_4px_16px_rgba(0,0,0,0.25)]'}
        `}
      style={{ width: resolvedWidth, height: resolvedHeight }}
      onClick={handleNodeClick}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
    >
      <NodeHeader
        className={NODE_HEADER_FLOATING_POSITION_CLASS}
        icon={<Video className="h-4 w-4" />}
        titleText={resolvedTitle}
        rightSlot={headerStatus}
        editable
        onTitleChange={(nextTitle) => updateNodeData(id, { displayName: nextTitle })}
      />

      <div className="min-h-0 flex-1">
        {data.videoUrl ? (
          <>
            <div className="flex h-full flex-col overflow-hidden rounded-[var(--node-radius)] bg-[linear-gradient(165deg,rgba(255,255,255,0.05),rgba(255,255,255,0.015))]">
            <div className={`relative min-h-0 flex-1 overflow-hidden bg-black ${flashFrame ? 'animate-pulse bg-white/20' : ''}`}>
              {posterSource && (!isVideoReady || Boolean(videoError)) ? (
                <img
                  src={posterSource}
                  alt={t('node.videoNode.posterAlt')}
                  className="absolute inset-0 h-full w-full object-cover"
                />
              ) : null}
              <div
                className="absolute inset-0"
                onClick={(event) => event.stopPropagation()}
                onPointerDown={(event) => event.stopPropagation()}
              >
                <video
                  ref={videoRef}
                  src={videoSource ?? undefined}
                  poster={posterSource ?? undefined}
                  preload="metadata"
                  controls
                  className={`nodrag nowheel h-full w-full bg-black object-contain transition-opacity duration-150 ${
                    videoError ? 'opacity-35' : 'opacity-100'
                  }`}
                  onPlay={handleVideoPlay}
                  onPause={handleVideoPause}
                  onTimeUpdate={handleTimeUpdate}
                  onSeeked={handleTimeUpdate}
                  onLoadedMetadata={handleLoadedMetadata}
                  onLoadedData={handleLoadedData}
                  onCanPlay={handleCanPlay}
                  onError={handleVideoError}
                  playsInline
                />
              </div>

              {videoError ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[rgba(15,23,42,0.56)] px-5 text-center">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full border border-red-400/25 bg-red-500/12 text-red-200">
                    <AlertTriangle className="h-5 w-5" />
                  </div>
                  <div className="space-y-1">
                    <div className="text-sm font-medium text-text-dark">
                      {t('node.videoNode.loadFailed')}
                    </div>
                    <div className="text-xs leading-5 text-text-muted">{videoError}</div>
                  </div>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      handleRetryLoad();
                    }}
                    className="nodrag inline-flex items-center gap-2 rounded-full border border-border-dark/70 bg-bg-dark/92 px-3 py-2 text-xs font-medium text-text-dark transition-colors hover:border-accent/40 hover:bg-bg-dark"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    {t('node.videoNode.retryLoad')}
                  </button>
                </div>
              ) : null}
            </div>

            <div
              className="border-t border-[rgba(255,255,255,0.08)] bg-[linear-gradient(180deg,rgba(8,10,16,0.88),rgba(8,10,16,0.96))] px-3 py-2"
              onClick={(event) => event.stopPropagation()}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    seekToPrevFrame();
                  }}
                  disabled={isPlaying || !isVideoReady}
                  className={`nodrag inline-flex h-8 w-8 items-center justify-center rounded-full border transition-colors ${
                    isPlaying || !isVideoReady
                      ? 'cursor-not-allowed border-white/[0.06] bg-white/[0.02] text-text-muted/40'
                      : 'border-white/[0.08] bg-white/[0.05] text-text-dark hover:border-accent/35 hover:bg-accent/10 hover:text-accent'
                  }`}
                  title={t('node.videoNode.prevFrame')}
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>

                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    togglePlay();
                  }}
                  disabled={!isVideoReady}
                  className={`nodrag inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border transition-colors ${
                    !isVideoReady
                      ? 'cursor-not-allowed border-white/[0.06] bg-white/[0.02] text-text-muted/40'
                      : 'border-white/[0.1] bg-white/[0.06] text-text-dark hover:border-accent/40 hover:bg-accent/12 hover:text-accent'
                  }`}
                  title={isPlaying ? t('node.videoNode.pause') : t('node.videoNode.play')}
                >
                  {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                </button>

                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    seekToNextFrame();
                  }}
                  disabled={isPlaying || !isVideoReady}
                  className={`nodrag inline-flex h-8 w-8 items-center justify-center rounded-full border transition-colors ${
                    isPlaying || !isVideoReady
                      ? 'cursor-not-allowed border-white/[0.06] bg-white/[0.02] text-text-muted/40'
                      : 'border-white/[0.08] bg-white/[0.05] text-text-dark hover:border-accent/35 hover:bg-accent/10 hover:text-accent'
                  }`}
                  title={t('node.videoNode.nextFrame')}
                >
                  <ChevronRight className="h-4 w-4" />
                </button>

                <div className="min-w-0 flex-1 px-1">
                  <div className="truncate text-[11px] text-text-muted">
                    {formatVideoTime(currentTime)} / {formatVideoTime(duration)}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    void handleScreenshot();
                  }}
                  disabled={screenshotButtonDisabled}
                  title={!isVideoReady ? t('node.videoNode.screenshotNotReady') : t('node.videoNode.screenshot')}
                  className={`nodrag inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                    screenshotButtonDisabled
                      ? 'cursor-not-allowed border-accent/10 bg-accent/8 text-accent/45'
                      : 'border-accent/18 bg-accent/14 text-accent hover:border-accent/30 hover:bg-accent/20'
                  }`}
                >
                  {isCapturingScreenshot ? (
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Camera className="h-3.5 w-3.5" />
                  )}
                  {isCapturingScreenshot ? t('node.videoNode.screenshotPending') : t('node.videoNode.screenshot')}
                </button>
              </div>

              {screenshotStatus ? (
                <div
                  className={`mt-2 truncate rounded-full px-2.5 py-1 text-[11px] ${
                    screenshotStatus.tone === 'success'
                      ? 'bg-emerald-500/12 text-emerald-200'
                      : screenshotStatus.tone === 'danger'
                        ? 'bg-red-500/12 text-red-200'
                        : 'bg-white/8 text-text-muted'
                  }`}
                  title={screenshotStatus.message}
                >
                  {screenshotStatus.message}
                </div>
              ) : null}
            </div>
            </div>
          </>
        ) : (
          <label className="block h-full w-full overflow-hidden rounded-[var(--node-radius)] bg-bg-dark">
            <div className="flex h-full w-full cursor-pointer flex-col items-center justify-center gap-3 text-text-muted/85">
            <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-accent/10">
              {isProcessingFile ? (
                <RefreshCw className="h-7 w-7 animate-spin text-accent/75" />
              ) : videoError ? (
                <AlertTriangle className="h-7 w-7 text-red-300/80" />
              ) : (
                <Upload className="h-7 w-7 text-accent/60" />
              )}
            </div>
            <span className="px-4 text-center text-sm">
              {isProcessingFile
                ? t('node.videoNode.processing')
                : videoError || t('node.videoNode.uploadHint')}
            </span>
            <span className="text-xs text-text-muted/50">{t('node.videoNode.supportedFormats')}</span>
            </div>
          </label>
        )}
      </div>
      <NodeDescriptionPanel
        isOpen={isDescriptionPanelOpen}
        value={nodeDescription}
        placeholder={t('nodeToolbar.descriptionPlaceholder')}
        onChange={(value) => updateNodeData(id, { nodeDescription: value })}
      />
      
      <input
        ref={inputRef}
        type="file"
        accept="video/*"
        className="hidden"
        onChange={handleFileChange}
      />

      <Handle
        type="target"
        id="target"
        position={Position.Left}
        className="!h-3 !w-3 !border-2 !border-white !bg-accent"
      />

      <Handle
        type="source"
        id="source"
        position={Position.Right}
        className="!h-3 !w-3 !border-2 !border-white !bg-accent"
      />
      <NodeResizeHandle
        minWidth={resizeMinWidth}
        minHeight={resizeMinHeight}
        maxWidth={1400}
        maxHeight={1400}
        isVisible={selected}
      />
    </div>
  );
});

VideoNode.displayName = 'VideoNode';
