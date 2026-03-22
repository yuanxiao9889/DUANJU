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
  Position,
  useUpdateNodeInternals,
  NodeToolbar,
  type NodeProps,
} from '@xyflow/react';
import { Video, Play, Pause, Camera, Upload, ChevronLeft, ChevronRight } from 'lucide-react';
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
import { prepareNodeImage } from '@/features/canvas/application/imageData';
import { useCanvasStore } from '@/stores/canvasStore';
import { useSettingsStore } from '@/stores/settingsStore';

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

  const processFile = useCallback(
    async (file: File) => {
      if (!isSupportedVideoType(file.type)) {
        console.error('Unsupported video type:', file.type);
        return;
      }

      try {
        const prepared = await prepareNodeVideoFromFile(file);
        const nextData: Partial<VideoNodeData> = {
          videoUrl: prepared.videoUrl,
          videoFileName: file.name,
          aspectRatio: prepared.aspectRatio,
          duration: prepared.duration,
        };
        if (useUploadFilenameAsNodeTitle) {
          nextData.displayName = file.name;
        }
        updateNodeData(id, nextData);
        setDuration(prepared.duration);
        screenshotCountRef.current = 0;
        setScreenshots([]);
      } catch (error) {
        console.error('Failed to process video file:', error);
      }
    },
    [id, updateNodeData, useUploadFilenameAsNodeTitle]
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
  }, []);

  const handleProgressClick = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
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
        displayName: `${data.videoFileName || 'video'} - 截图 ${screenshotIndex}`,
      });
      
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
  }, [id, data.videoUrl, data.videoFileName, currentTime, resolvedWidth, nodes, addNode, addEdge]);

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
        editable
        onTitleChange={(nextTitle) => updateNodeData(id, { displayName: nextTitle })}
      />

      {data.videoUrl ? (
        <>
          <div className={`h-full w-full overflow-hidden rounded-[var(--node-radius)] ${flashFrame ? 'animate-pulse bg-white/20' : ''}`}>
            <video
              ref={videoRef}
              src={videoSource ?? undefined}
              className="h-full w-full object-cover bg-black"
              onPlay={handleVideoPlay}
              onPause={handleVideoPause}
              onTimeUpdate={handleTimeUpdate}
              onLoadedMetadata={handleLoadedMetadata}
              playsInline
            />
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
                    title={`截图 ${index + 1}`}
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
              <Upload className="h-7 w-7 text-accent/60" />
            </div>
            <span className="px-4 text-center text-sm">{t('node.videoNode.uploadHint')}</span>
            <span className="text-xs text-text-muted/50">MP4, WebM, MOV, AVI</span>
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
