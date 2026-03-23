import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import {
  Handle,
  useUpdateNodeInternals,
  NodeToolbar,
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
import { convertFileSrc, isTauri } from '@tauri-apps/api/core';

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
  NODE_TOOLBAR_ALIGN,
  NODE_TOOLBAR_CLASS,
  NODE_TOOLBAR_OFFSET,
} from '@/features/canvas/ui/nodeToolbarConfig';
import {
  captureVideoFrame,
  formatVideoTime,
  isSupportedVideoType,
  prepareNodeVideoFromFile,
} from '@/features/canvas/application/videoData';
import {
  prepareNodeImage,
  resolveImageDisplayUrl,
} from '@/features/canvas/application/imageData';
import { useCanvasStore } from '@/stores/canvasStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { NodeStatusBadge } from '@/features/canvas/ui/NodeStatusBadge';

type VideoNodeProps = NodeProps & {
  id: string;
  data: VideoNodeData;
  selected?: boolean;
};

const DEFAULT_FRAME_RATE = 24;
const FRAME_TIME = 1 / DEFAULT_FRAME_RATE;

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

export const VideoNode = memo(({ id, data, selected, width, height }: VideoNodeProps) => {
  const { t } = useTranslation();
  const updateNodeInternals = useUpdateNodeInternals();
  const setSelectedNode = useCanvasStore((state) => state.setSelectedNode);
  const updateNodeData = useCanvasStore((state) => state.updateNodeData);
  const addNode = useCanvasStore((state) => state.addNode);
  const addEdge = useCanvasStore((state) => state.addEdge);
  const nodes = useCanvasStore((state) => state.nodes);
  const useUploadFilenameAsNodeTitle = useSettingsStore((state) => state.useUploadFilenameAsNodeTitle);
  
  const inputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const screenshotCountRef = useRef(0);
  
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isDraggingProgress, setIsDraggingProgress] = useState(false);
  const [flashFrame, setFlashFrame] = useState(false);
  const [screenshots, setScreenshots] = useState<Array<{ time: number; nodeId: string }>>([]);
  const [isProcessingFile, setIsProcessingFile] = useState(false);
  const [videoError, setVideoError] = useState<string | null>(null);
  const [isVideoReady, setIsVideoReady] = useState(false);
  
  const resolvedAspectRatio = data.aspectRatio || '16:9';
  const compactSize = resolveMinEdgeFittedSize(resolvedAspectRatio, {
    minWidth: EXPORT_RESULT_NODE_MIN_WIDTH,
    minHeight: EXPORT_RESULT_NODE_MIN_HEIGHT,
  });
  const resolvedWidth = resolveNodeDimension(width, compactSize.width);
  const resolvedHeight = resolveNodeDimension(height, compactSize.height);
  const resizeConstraints = resolveResizeMinConstraintsByAspect(resolvedAspectRatio, {
    minWidth: EXPORT_RESULT_NODE_MIN_WIDTH,
    minHeight: EXPORT_RESULT_NODE_MIN_HEIGHT,
  });
  const resizeMinWidth = resizeConstraints.minWidth;
  const resizeMinHeight = resizeConstraints.minHeight;
  
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
    if (data.videoUrl.startsWith('blob:')) return data.videoUrl;
    if (isTauri()) {
      return convertFileSrc(data.videoUrl);
    }
    return data.videoUrl;
  }, [data.videoUrl]);

  const posterSource = useMemo(() => {
    if (!data.previewImageUrl) {
      return null;
    }
    return resolveImageDisplayUrl(data.previewImageUrl);
  }, [data.previewImageUrl]);

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
      if (!isSupportedVideoType(file.type)) {
        setVideoError(t('node.videoNode.unsupportedFormat'));
        return;
      }

      try {
        setIsProcessingFile(true);
        setVideoError(null);
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
        setScreenshots([]);
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
      videoRef.current.play();
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
    if (!videoRef.current || isDraggingProgress) return;
    setCurrentTime(videoRef.current.currentTime);
  }, [isDraggingProgress]);

  const handleLoadedMetadata = useCallback(() => {
    if (!videoRef.current) return;
    setDuration(videoRef.current.duration);
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

  const handleProgressClick = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    if (!videoRef.current || !progressRef.current) return;
    
    const rect = progressRef.current.getBoundingClientRect();
    const pos = (event.clientX - rect.left) / rect.width;
    const newTime = pos * duration;
    
    videoRef.current.currentTime = newTime;
    setCurrentTime(newTime);
  }, [duration]);

  const handleScreenshot = useCallback(async () => {
    if (!videoRef.current || !data.videoUrl) return;
    
    try {
      const dataUrl = captureVideoFrame(videoRef.current);
      const prepared = await prepareNodeImage(dataUrl);
      
      const nodePosition = nodes.find(n => n.id === id)?.position;
      if (!nodePosition) return;
      
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
      
      setScreenshots(prev => [...prev, {
        time: currentTime,
        nodeId: newNodeId,
      }]);
      
      setFlashFrame(true);
      setTimeout(() => setFlashFrame(false), 150);
    } catch (error) {
      console.error('Failed to capture screenshot:', error);
    }
  }, [addEdge, addNode, currentTime, data.videoFileName, data.videoUrl, id, nodes, resolvedWidth, t]);

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
    if (!isDraggingProgress || !videoRef.current || !progressRef.current) return;

    const handleGlobalPointerMove = (e: PointerEvent) => {
      const rect = progressRef.current!.getBoundingClientRect();
      const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const newTime = pos * duration;
      
      setCurrentTime(newTime);
      if (videoRef.current) {
        videoRef.current.currentTime = newTime;
      }
    };

    const handleGlobalPointerUp = () => {
      setIsDraggingProgress(false);
    };

    document.addEventListener('pointermove', handleGlobalPointerMove);
    document.addEventListener('pointerup', handleGlobalPointerUp);
    
    return () => {
      document.removeEventListener('pointermove', handleGlobalPointerMove);
      document.removeEventListener('pointerup', handleGlobalPointerUp);
    };
  }, [isDraggingProgress, duration]);

  useEffect(() => {
    updateNodeInternals(id);
  }, [id, resolvedHeight, resolvedWidth, updateNodeInternals]);

  useEffect(() => {
    if (!data.videoUrl) {
      setVideoError(null);
      setIsVideoReady(false);
      setCurrentTime(0);
      return;
    }

    setVideoError(null);
    setIsVideoReady(false);
  }, [data.videoUrl]);

  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div
      className={`
        group relative overflow-visible rounded-[var(--node-radius)] border bg-surface-dark/85 p-0 transition-all duration-150
        ${selected
          ? 'border-accent shadow-[0_0_0_2px_rgba(59,130,246,0.5),0_4px_20px_rgba(59,130,246,0.2)]'
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

      {data.videoUrl ? (
        <>
          <div className={`relative h-full w-full overflow-hidden rounded-[var(--node-radius)] ${flashFrame ? 'animate-pulse bg-white/20' : ''}`}>
            {posterSource && (!isVideoReady || Boolean(videoError)) ? (
              <img
                src={posterSource}
                alt={t('node.videoNode.posterAlt')}
                className="absolute inset-0 h-full w-full object-cover"
              />
            ) : null}
            <video
              ref={videoRef}
              src={videoSource ?? undefined}
              poster={posterSource ?? undefined}
              preload="metadata"
              className={`h-full w-full object-cover bg-black transition-opacity duration-150 ${
                videoError ? 'opacity-35' : 'opacity-100'
              }`}
              onPlay={handleVideoPlay}
              onPause={handleVideoPause}
              onTimeUpdate={handleTimeUpdate}
              onLoadedMetadata={handleLoadedMetadata}
              onCanPlay={handleCanPlay}
              onError={handleVideoError}
              playsInline
            />

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
                  className="inline-flex items-center gap-2 rounded-full border border-border-dark/70 bg-bg-dark/92 px-3 py-2 text-xs font-medium text-text-dark transition-colors hover:border-accent/40 hover:bg-bg-dark"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  {t('node.videoNode.retryLoad')}
                </button>
              </div>
            ) : null}
          </div>
          
          <NodeToolbar
            isVisible={selected}
            position={Position.Bottom}
            align={NODE_TOOLBAR_ALIGN}
            offset={NODE_TOOLBAR_OFFSET}
            className={NODE_TOOLBAR_CLASS}
          >
            <div className="flex items-center gap-2 rounded-lg border border-border-dark/30 bg-bg-dark/95 backdrop-blur-sm px-3 py-2 shadow-lg">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  seekToPrevFrame();
                }}
                disabled={isPlaying}
                className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors ${
                  isPlaying
                    ? 'bg-bg-dark/40 text-text-muted/40 cursor-not-allowed'
                    : 'bg-bg-dark/80 text-text-dark hover:bg-accent/20 hover:text-accent'
                }`}
                title={t('node.videoNode.prevFrame')}
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  togglePlay();
                }}
                className="flex h-7 w-7 items-center justify-center rounded-md bg-bg-dark/80 text-text-dark hover:bg-accent/20 hover:text-accent transition-colors"
              >
                {isPlaying ? (
                  <Pause className="h-4 w-4" />
                ) : (
                  <Play className="h-4 w-4" />
                )}
              </button>
              
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  seekToNextFrame();
                }}
                disabled={isPlaying}
                className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors ${
                  isPlaying
                    ? 'bg-bg-dark/40 text-text-muted/40 cursor-not-allowed'
                    : 'bg-bg-dark/80 text-text-dark hover:bg-accent/20 hover:text-accent'
                }`}
                title={t('node.videoNode.nextFrame')}
              >
                <ChevronRight className="h-4 w-4" />
              </button>
              
              <div
                ref={progressRef}
                className="relative w-48 h-2 cursor-pointer rounded-full bg-bg-dark/80 group/progress"
                onClick={handleProgressClick}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  (e.target as HTMLElement).setPointerCapture(e.pointerId);
                  setIsDraggingProgress(true);
                  const rect = progressRef.current!.getBoundingClientRect();
                  const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                  const newTime = pos * duration;
                  setCurrentTime(newTime);
                  if (videoRef.current) {
                    videoRef.current.currentTime = newTime;
                  }
                }}
              >
                <div
                  className="absolute left-0 top-0 h-full rounded-full bg-accent"
                  style={{ width: `${progressPercent}%` }}
                />
                <div
                  className="absolute top-1/2 w-4 h-4 -translate-y-1/2 -translate-x-1/2 rounded-full bg-accent border-2 border-white shadow-lg cursor-grab active:cursor-grabbing transition-transform hover:scale-125"
                  style={{ left: `${progressPercent}%` }}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    (e.target as HTMLElement).setPointerCapture(e.pointerId);
                    setIsDraggingProgress(true);
                  }}
                />
                {screenshots.map((screenshot, index) => (
                  <div
                    key={index}
                    className="absolute top-1/2 h-3 w-1 -translate-y-1/2 rounded-full bg-yellow-400"
                    style={{ left: `${(screenshot.time / duration) * 100}%` }}
                    title={t('node.videoNode.screenshotMarker', { index: index + 1 })}
                  />
                ))}
              </div>
              
              <span className="min-w-[70px] text-right text-xs text-text-muted font-mono">
                {formatVideoTime(currentTime)} / {formatVideoTime(duration)}
              </span>
              
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleScreenshot();
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-accent/20 text-accent text-xs font-medium hover:bg-accent/30 transition-colors"
              >
                <Camera className="h-3.5 w-3.5" />
                {t('node.videoNode.screenshot')}
              </button>
            </div>
          </NodeToolbar>
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
      
      <input
        ref={inputRef}
        type="file"
        accept="video/*"
        className="hidden"
        onChange={handleFileChange}
      />

      <Handle
        type="source"
        id="source"
        position={Position.Right}
        className="!h-2.5 !w-2.5 !border-2 !border-surface-dark !bg-accent"
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
