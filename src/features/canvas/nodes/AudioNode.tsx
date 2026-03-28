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
  type NodeProps,
} from '@xyflow/react';
import { AlertTriangle, AudioLines, RefreshCw, Upload } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import {
  AUDIO_NODE_DEFAULT_HEIGHT,
  AUDIO_NODE_DEFAULT_WIDTH,
  CANVAS_NODE_TYPES,
  type AudioNodeData,
} from '@/features/canvas/domain/canvasNodes';
import {
  isSupportedAudioFile,
  prepareNodeAudioFromFile,
  resolveAudioDisplayUrl,
} from '@/features/canvas/application/audioData';
import {
  isNodeUsingDefaultDisplayName,
  resolveNodeDisplayName,
} from '@/features/canvas/domain/nodeDisplay';
import { NodeHeader, NODE_HEADER_FLOATING_POSITION_CLASS } from '@/features/canvas/ui/NodeHeader';
import { NodeStatusBadge } from '@/features/canvas/ui/NodeStatusBadge';
import { useCanvasStore } from '@/stores/canvasStore';
import { useSettingsStore } from '@/stores/settingsStore';

type AudioNodeProps = NodeProps & {
  id: string;
  data: AudioNodeData;
  selected?: boolean;
};

function resolveNodeDimension(value: number | undefined, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 1) {
    return Math.round(value);
  }
  return fallback;
}

function resolveDroppedAudioFile(event: DragEvent<HTMLElement>): File | null {
  const directFile = event.dataTransfer.files?.[0];
  if (directFile && isSupportedAudioFile(directFile)) {
    return directFile;
  }

  const item = Array.from(event.dataTransfer.items || []).find((candidate) => {
    if (candidate.kind !== 'file') {
      return false;
    }

    const file = candidate.getAsFile();
    return Boolean(file && isSupportedAudioFile(file));
  });

  return item?.getAsFile() ?? null;
}

export const AudioNode = memo(({ id, data, selected, width }: AudioNodeProps) => {
  const { t } = useTranslation();
  const updateNodeInternals = useUpdateNodeInternals();
  const setSelectedNode = useCanvasStore((state) => state.setSelectedNode);
  const updateNodeData = useCanvasStore((state) => state.updateNodeData);
  const useUploadFilenameAsNodeTitle = useSettingsStore((state) => state.useUploadFilenameAsNodeTitle);

  const inputRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  const [isProcessingFile, setIsProcessingFile] = useState(false);
  const [audioError, setAudioError] = useState<string | null>(null);

  const resolvedWidth = Math.max(
    resolveNodeDimension(width, AUDIO_NODE_DEFAULT_WIDTH),
    AUDIO_NODE_DEFAULT_WIDTH
  );
  const resolvedHeight = AUDIO_NODE_DEFAULT_HEIGHT;

  const resolvedTitle = useMemo(() => {
    const audioFileName = typeof data.audioFileName === 'string' ? data.audioFileName.trim() : '';
    if (
      useUploadFilenameAsNodeTitle &&
      audioFileName &&
      isNodeUsingDefaultDisplayName(CANVAS_NODE_TYPES.audio, data)
    ) {
      return audioFileName;
    }
    return resolveNodeDisplayName(CANVAS_NODE_TYPES.audio, data);
  }, [data, useUploadFilenameAsNodeTitle]);

  const audioSource = useMemo(() => {
    if (!data.audioUrl) {
      return null;
    }
    return resolveAudioDisplayUrl(data.audioUrl);
  }, [data.audioUrl]);

  const headerStatus = useMemo(() => {
    if (isProcessingFile) {
      return (
        <NodeStatusBadge
          icon={<RefreshCw className="h-3 w-3" />}
          label={t('node.audioNode.processing')}
          tone="processing"
          animate
        />
      );
    }

    if (audioError) {
      return (
        <NodeStatusBadge
          icon={<AlertTriangle className="h-3 w-3" />}
          label={t('node.audioNode.loadFailedShort')}
          tone="danger"
          title={audioError}
        />
      );
    }

    return null;
  }, [audioError, isProcessingFile, t]);

  useEffect(() => {
    updateNodeInternals(id);
  }, [id, resolvedHeight, resolvedWidth, updateNodeInternals]);

  useEffect(() => {
    if (!data.audioUrl) {
      setAudioError(null);
    }
  }, [data.audioUrl]);

  const processFile = useCallback(
    async (file: File) => {
      if (!isSupportedAudioFile(file)) {
        setAudioError(t('node.audioNode.unsupportedFormat'));
        return;
      }

      try {
        setIsProcessingFile(true);
        setAudioError(null);

        const prepared = await prepareNodeAudioFromFile(file);
        const nextData: Partial<AudioNodeData> = {
          audioUrl: prepared.audioUrl,
          previewImageUrl: prepared.previewImageUrl,
          audioFileName: file.name,
          duration: prepared.duration,
          mimeType: prepared.mimeType,
        };

        if (useUploadFilenameAsNodeTitle) {
          nextData.displayName = file.name;
        }

        updateNodeData(id, nextData);
      } catch (error) {
        console.error('Failed to process audio file:', error);
        setAudioError(
          error instanceof Error && error.message.trim().length > 0
            ? error.message
            : t('node.audioNode.processFailed')
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
      const file = resolveDroppedAudioFile(event);
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
    if (!data.audioUrl) {
      inputRef.current?.click();
    }
  }, [data.audioUrl, id, setSelectedNode]);

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
        icon={<AudioLines className="h-4 w-4" />}
        titleText={resolvedTitle}
        rightSlot={headerStatus}
        editable
        onTitleChange={(nextTitle) => updateNodeData(id, { displayName: nextTitle })}
      />

      <input
        ref={inputRef}
        type="file"
        accept="audio/*,.mp3,.wav,.ogg,.m4a,.aac,.flac,.webm"
        className="hidden"
        onChange={handleFileChange}
      />

      {data.audioUrl ? (
        <div className="flex h-full min-h-0 items-center overflow-hidden rounded-[var(--node-radius)] bg-[linear-gradient(165deg,rgba(255,255,255,0.08),rgba(255,255,255,0.02))] px-3 py-1.5">
          <div
            className="min-w-0 flex-1"
            onClick={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <audio
              ref={audioRef}
              src={audioSource ?? undefined}
              preload="metadata"
              controls
              className="nodrag nowheel block min-w-0 w-full [color-scheme:dark]"
              onLoadedMetadata={() => {
                if (!audioRef.current) {
                  return;
                }
                const nextDuration = Number.isFinite(audioRef.current.duration)
                  ? audioRef.current.duration
                  : 0;
                updateNodeData(id, { duration: nextDuration });
                setAudioError(null);
              }}
              onError={() => {
                setAudioError(t('node.audioNode.loadFailed'));
              }}
            />
          </div>
        </div>
      ) : (
        <button
          type="button"
          className="flex h-full w-full flex-col items-center justify-center gap-3 rounded-[var(--node-radius)] border border-dashed border-[rgba(255,255,255,0.14)] bg-white/[0.03] text-text-muted transition-colors hover:border-accent/35 hover:bg-accent/10 hover:text-text-dark"
          onClick={(event) => {
            event.stopPropagation();
            inputRef.current?.click();
          }}
        >
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white/[0.06] text-text-dark">
            <Upload className="h-5 w-5" />
          </div>
          <div className="space-y-1 text-center">
            <div className="text-sm font-medium text-text-dark">
              {t('node.audioNode.uploadHint')}
            </div>
            <div className="text-xs text-text-muted">
              {t('node.audioNode.supportedFormats')}
            </div>
          </div>
        </button>
      )}

      <Handle
        type="source"
        position={Position.Right}
        id="source"
        className="!h-3 !w-3 !border-2 !border-white !bg-accent"
      />
    </div>
  );
});

AudioNode.displayName = 'AudioNode';
