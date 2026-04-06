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
import { AlertTriangle, AudioLines, Pause, Play, RefreshCw, Upload } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { UiButton, UiInput, UiModal, UiSelect, UiTextArea } from '@/components/ui';
import type { AssetMetadata } from '@/features/assets/domain/types';
import {
  AUDIO_NODE_DEFAULT_HEIGHT,
  AUDIO_NODE_DEFAULT_WIDTH,
  CANVAS_NODE_TYPES,
  type AudioNodeData,
} from '@/features/canvas/domain/canvasNodes';
import {
  formatAudioDuration,
  isSupportedAudioFile,
  prepareNodeAudioFromFile,
  resolveAudioDisplayUrl,
} from '@/features/canvas/application/audioData';
import { canvasEventBus } from '@/features/canvas/application/canvasServices';
import {
  isNodeUsingDefaultDisplayName,
  resolveNodeDisplayName,
} from '@/features/canvas/domain/nodeDisplay';
import { resolveConnectedTtsText } from '@/features/canvas/nodes/qwenTtsShared';
import { NodeHeader, NODE_HEADER_FLOATING_POSITION_CLASS } from '@/features/canvas/ui/NodeHeader';
import { NodeStatusBadge } from '@/features/canvas/ui/NodeStatusBadge';
import { useAssetStore } from '@/stores/assetStore';
import { useCanvasStore } from '@/stores/canvasStore';
import { useProjectStore } from '@/stores/projectStore';
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

function resolvePlaybackTime(value: number | undefined | null): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value;
  }

  return 0;
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

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function stripFileExtension(value: string): string {
  return value.replace(/\.[^.]+$/, '').trim();
}

export const AudioNode = memo(({ id, data, selected, width }: AudioNodeProps) => {
  const { t } = useTranslation();
  const updateNodeInternals = useUpdateNodeInternals();
  const setSelectedNode = useCanvasStore((state) => state.setSelectedNode);
  const updateNodeData = useCanvasStore((state) => state.updateNodeData);
  const nodes = useCanvasStore((state) => state.nodes);
  const edges = useCanvasStore((state) => state.edges);
  const useUploadFilenameAsNodeTitle = useSettingsStore((state) => state.useUploadFilenameAsNodeTitle);
  const assetLibraries = useAssetStore((state) => state.libraries);
  const hydrateAssets = useAssetStore((state) => state.hydrate);
  const isAssetStoreHydrated = useAssetStore((state) => state.isHydrated);
  const createAssetItem = useAssetStore((state) => state.createItem);
  const currentProjectAssetLibraryId = useProjectStore(
    (state) => state.currentProject?.assetLibraryId ?? null
  );
  const setCurrentProjectAssetLibrary = useProjectStore(
    (state) => state.setCurrentProjectAssetLibrary
  );

  const inputRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  const [isProcessingFile, setIsProcessingFile] = useState(false);
  const [audioError, setAudioError] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [playbackDuration, setPlaybackDuration] = useState(() => resolvePlaybackTime(data.duration));
  const [isPresetModalOpen, setIsPresetModalOpen] = useState(false);
  const [presetLibraryId, setPresetLibraryId] = useState('');
  const [presetSubcategoryId, setPresetSubcategoryId] = useState('');
  const [presetTitle, setPresetTitle] = useState('');
  const [presetTagsText, setPresetTagsText] = useState('');
  const [presetDescription, setPresetDescription] = useState('');
  const [presetError, setPresetError] = useState('');
  const [isSavingPreset, setIsSavingPreset] = useState(false);

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
  const sourceVoiceDesignNode = useMemo(() => {
    const sourceNodeId = normalizeText(data.sourceNodeId);
    if (!sourceNodeId) {
      return null;
    }

    return nodes.find(
      (node) => node.id === sourceNodeId && node.type === CANVAS_NODE_TYPES.ttsVoiceDesign
    ) ?? null;
  }, [data.sourceNodeId, nodes]);
  const fallbackPresetReferenceText = useMemo(
    () => (sourceVoiceDesignNode ? resolveConnectedTtsText(sourceVoiceDesignNode.id, nodes, edges) : ''),
    [edges, nodes, sourceVoiceDesignNode]
  );
  const ttsPresetSource = useMemo(() => {
    const source = data.ttsPresetSource;
    if (typeof source !== 'object' || source === null) {
      return null;
    }

    return source as NonNullable<AudioNodeData['ttsPresetSource']>;
  }, [data.ttsPresetSource]);
  const presetReferenceText = normalizeText(ttsPresetSource?.referenceText) || fallbackPresetReferenceText.trim();
  const presetVoicePrompt = normalizeText(ttsPresetSource?.voicePrompt);
  const defaultPresetTitle = useMemo(() => {
    const sourceNodeTitle = sourceVoiceDesignNode
      ? resolveNodeDisplayName(CANVAS_NODE_TYPES.ttsVoiceDesign, sourceVoiceDesignNode.data)
      : '';

    return (
      stripFileExtension(normalizeText(data.assetName))
      || stripFileExtension(normalizeText(data.audioFileName))
      || normalizeText(sourceNodeTitle)
      || t('node.qwenTts.savedVoice.defaultVoiceName')
    );
  }, [data.assetName, data.audioFileName, sourceVoiceDesignNode, t]);
  const canSaveAsPreset =
    data.generationSource === 'ttsVoiceDesign'
    && normalizeText(data.audioUrl).length > 0
    && presetReferenceText.length > 0;
  const targetPresetLibrary = assetLibraries.find((library) => library.id === presetLibraryId) ?? null;
  const targetPresetSubcategories = useMemo(
    () =>
      (targetPresetLibrary?.subcategories ?? []).filter(
        (subcategory) => subcategory.category === 'voice'
      ),
    [targetPresetLibrary]
  );

  const audioSource = useMemo(() => {
    if (!data.audioUrl) {
      return null;
    }
    return resolveAudioDisplayUrl(data.audioUrl);
  }, [data.audioUrl]);
  const queuePosition = typeof data.queuePosition === 'number'
    ? Math.max(0, Math.floor(data.queuePosition))
    : null;
  const taskProgress = typeof data.generationProgress === 'number'
    ? Math.max(0, Math.min(100, data.generationProgress))
    : 0;
  const isGeneratedTaskNode = Boolean(data.generationSource);
  const isTaskQueued = Boolean(isGeneratedTaskNode && !data.audioUrl && queuePosition !== null);
  const isTaskRunning = Boolean(isGeneratedTaskNode && !data.audioUrl && data.isGenerating);
  const isTaskFailed = Boolean(isGeneratedTaskNode && !data.audioUrl && data.lastError);
  const shouldRenderTaskState = isTaskQueued || isTaskRunning || isTaskFailed;
  const effectiveCurrentTime = Math.min(currentTime, playbackDuration);
  const playbackProgress = playbackDuration > 0
    ? Math.min(100, (effectiveCurrentTime / playbackDuration) * 100)
    : 0;
  const audioMetaLabel = useMemo(() => {
    const mimeType = typeof data.mimeType === 'string' ? data.mimeType.trim() : '';
    if (mimeType.startsWith('audio/')) {
      return mimeType.slice('audio/'.length).toUpperCase();
    }

    return resolvedTitle;
  }, [data.mimeType, resolvedTitle]);

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

    if (isTaskRunning) {
      return (
        <NodeStatusBadge
          icon={<RefreshCw className="h-3 w-3" />}
          label={t('node.audioNode.generatingShort')}
          tone="processing"
          animate
        />
      );
    }

    if (isTaskQueued) {
      return (
        <NodeStatusBadge
          icon={<AudioLines className="h-3 w-3" />}
          label={t('node.audioNode.queuedShort')}
          tone="warning"
          title={data.statusText ?? undefined}
        />
      );
    }

    if (isTaskFailed) {
      return (
        <NodeStatusBadge
          icon={<AlertTriangle className="h-3 w-3" />}
          label={t('node.audioNode.generationFailedShort')}
          tone="danger"
          title={data.lastError ?? undefined}
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
  }, [audioError, data.lastError, data.statusText, isProcessingFile, isTaskFailed, isTaskQueued, isTaskRunning, t]);

  useEffect(() => {
    updateNodeInternals(id);
  }, [id, resolvedHeight, resolvedWidth, updateNodeInternals]);

  useEffect(() => {
    if (!data.audioUrl) {
      setAudioError(null);
    }
  }, [data.audioUrl]);

  useEffect(() => {
    const audioElement = audioRef.current;
    if (audioElement) {
      audioElement.pause();
    }

    setIsPlaying(false);
    setCurrentTime(0);
  }, [audioSource]);

  useEffect(() => {
    setPlaybackDuration(resolvePlaybackTime(data.duration));
  }, [data.duration]);

  useEffect(() => {
    if (!isPresetModalOpen) {
      return;
    }

    if (!isAssetStoreHydrated) {
      void hydrateAssets();
    }
  }, [hydrateAssets, isAssetStoreHydrated, isPresetModalOpen]);

  useEffect(() => {
    if (!isPresetModalOpen) {
      return;
    }

    setPresetTitle(defaultPresetTitle);
    setPresetTagsText('');
    setPresetDescription(presetVoicePrompt);
    setPresetError('');
  }, [defaultPresetTitle, isPresetModalOpen, presetVoicePrompt]);

  useEffect(() => {
    if (!isPresetModalOpen) {
      return;
    }

    const preferredLibraryId =
      currentProjectAssetLibraryId && assetLibraries.some((library) => library.id === currentProjectAssetLibraryId)
        ? currentProjectAssetLibraryId
        : assetLibraries[0]?.id ?? '';

    setPresetLibraryId((current) => {
      if (current && assetLibraries.some((library) => library.id === current)) {
        return current;
      }

      return preferredLibraryId;
    });
  }, [assetLibraries, currentProjectAssetLibraryId, isPresetModalOpen]);

  useEffect(() => {
    if (!isPresetModalOpen) {
      return;
    }

    setPresetSubcategoryId((current) => {
      if (
        current
        && targetPresetSubcategories.some((subcategory) => subcategory.id === current)
      ) {
        return current;
      }

      return '';
    });
  }, [isPresetModalOpen, targetPresetSubcategories]);

  useEffect(() => () => {
    audioRef.current?.pause();
  }, []);

  const syncDurationFromAudio = useCallback(() => {
    if (!audioRef.current) {
      return;
    }

    const nextDuration = resolvePlaybackTime(audioRef.current.duration);
    setPlaybackDuration(nextDuration);
    if (Math.abs(resolvePlaybackTime(data.duration) - nextDuration) > 0.25) {
      updateNodeData(id, { duration: nextDuration });
    }
    setAudioError(null);
  }, [data.duration, id, updateNodeData]);

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
      if (shouldRenderTaskState) {
        return;
      }
      const file = resolveDroppedAudioFile(event);
      if (file) {
        await processFile(file);
      }
    },
    [processFile, shouldRenderTaskState]
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

  useEffect(() => {
    return canvasEventBus.subscribe('audio-node/open-save-preset', ({ nodeId }) => {
      if (nodeId !== id || !canSaveAsPreset) {
        return;
      }

      setIsPresetModalOpen(true);
    });
  }, [canSaveAsPreset, id]);

  const handleNodeClick = useCallback(() => {
    setSelectedNode(id);
    if (!data.audioUrl && !shouldRenderTaskState) {
      inputRef.current?.click();
    }
  }, [data.audioUrl, id, setSelectedNode, shouldRenderTaskState]);

  const togglePlayback = useCallback(async () => {
    const audioElement = audioRef.current;
    if (!audioElement || !audioSource) {
      return;
    }

    try {
      if (audioElement.paused) {
        if (
          playbackDuration > 0
          && audioElement.currentTime >= Math.max(0, playbackDuration - 0.05)
        ) {
          audioElement.currentTime = 0;
          setCurrentTime(0);
        }
        setAudioError(null);
        await audioElement.play();
      } else {
        audioElement.pause();
      }
    } catch (error) {
      console.error('Failed to play audio:', error);
      setIsPlaying(false);
      setAudioError(t('node.audioNode.playFailed'));
    }
  }, [audioSource, playbackDuration, t]);

  const handleSeekChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    if (!audioRef.current) {
      return;
    }

    const nextTime = Number(event.target.value);
    audioRef.current.currentTime = nextTime;
    setCurrentTime(nextTime);
  }, []);

  const handleSavePreset = useCallback(async () => {
    const audioUrl = normalizeText(data.audioUrl);
    const trimmedTitle = presetTitle.trim();
    const trimmedDescription = presetDescription.trim();

    if (!audioUrl) {
      setPresetError(t('node.audioNode.savePresetMissingAudio'));
      return;
    }

    if (!presetReferenceText) {
      setPresetError(t('node.audioNode.savePresetMissingReferenceText'));
      return;
    }

    if (!targetPresetLibrary) {
      setPresetError(t('node.audioNode.savePresetNoLibrary'));
      return;
    }

    if (!trimmedTitle) {
      setPresetError(t('node.audioNode.savePresetTitleRequired'));
      return;
    }

    setIsSavingPreset(true);
    setPresetError('');

    try {
      const metadata: AssetMetadata = {
        voicePreset: {
          type: 'qwen_tts_voice_preset',
          referenceTranscript: presetReferenceText,
          promptFile: null,
          promptLabel: null,
          voicePrompt: presetVoicePrompt || null,
          stylePreset: normalizeText(ttsPresetSource?.stylePreset) || null,
          language: normalizeText(ttsPresetSource?.language) || null,
          speakingRate:
            typeof ttsPresetSource?.speakingRate === 'number'
            && Number.isFinite(ttsPresetSource.speakingRate)
              ? ttsPresetSource.speakingRate
              : null,
          pitch:
            typeof ttsPresetSource?.pitch === 'number'
            && Number.isFinite(ttsPresetSource.pitch)
              ? ttsPresetSource.pitch
              : null,
          sourceGeneration: 'ttsVoiceDesign',
          savedAt: Date.now(),
        },
      };

      const item = await createAssetItem({
        libraryId: targetPresetLibrary.id,
        category: 'voice',
        mediaType: 'audio',
        subcategoryId: presetSubcategoryId || null,
        name: trimmedTitle,
        description: trimmedDescription,
        tags: presetTagsText
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean),
        sourcePath: audioUrl,
        previewPath: data.previewImageUrl ?? null,
        mimeType: normalizeText(data.mimeType) || null,
        durationMs:
          typeof data.duration === 'number' && Number.isFinite(data.duration)
            ? Math.max(0, Math.round(data.duration * 1000))
            : null,
        aspectRatio: '1:1',
        metadata,
      });

      updateNodeData(id, {
        displayName: item.name,
        audioFileName: item.name,
        assetId: item.id,
        assetLibraryId: item.libraryId,
        assetName: item.name,
        assetCategory: item.category,
      });
      setCurrentProjectAssetLibrary(item.libraryId);
      setIsPresetModalOpen(false);
    } catch (error) {
      console.error('Failed to save voice preset asset', error);
      setPresetError(t('node.audioNode.savePresetFailed'));
    } finally {
      setIsSavingPreset(false);
    }
  }, [
    createAssetItem,
    data.audioUrl,
    data.duration,
    data.mimeType,
    data.previewImageUrl,
    id,
    presetDescription,
    presetSubcategoryId,
    presetTagsText,
    presetReferenceText,
    presetTitle,
    presetVoicePrompt,
    setCurrentProjectAssetLibrary,
    t,
    targetPresetLibrary,
    ttsPresetSource?.language,
    ttsPresetSource?.pitch,
    ttsPresetSource?.speakingRate,
    ttsPresetSource?.stylePreset,
    updateNodeData,
  ]);

  return (
    <>
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
          <div
            className="flex h-full min-h-0 flex-col justify-center overflow-hidden rounded-[var(--node-radius)] bg-[linear-gradient(165deg,rgba(255,255,255,0.08),rgba(255,255,255,0.02))] px-3 py-3"
            onClick={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
          >
          <audio
            ref={audioRef}
            src={audioSource ?? undefined}
            preload="metadata"
            className="hidden"
            onLoadedMetadata={syncDurationFromAudio}
            onDurationChange={syncDurationFromAudio}
            onTimeUpdate={() => {
              if (!audioRef.current) {
                return;
              }
              setCurrentTime(audioRef.current.currentTime);
            }}
            onPlay={() => setIsPlaying(true)}
            onPause={() => setIsPlaying(false)}
            onEnded={() => {
              setIsPlaying(false);
              setCurrentTime(resolvePlaybackTime(audioRef.current?.duration));
            }}
            onError={() => {
              setIsPlaying(false);
              setAudioError(t('node.audioNode.loadFailed'));
            }}
          />

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                void togglePlayback();
              }}
              className="nodrag inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/[0.12] bg-white/[0.06] text-text-dark transition-colors hover:border-accent/35 hover:bg-accent/10 hover:text-accent"
              title={isPlaying ? t('node.audioNode.pause') : t('node.audioNode.play')}
            >
              {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 translate-x-[1px]" />}
            </button>

            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-1.5 text-[11px] text-text-muted">
                  <AudioLines className="h-3.5 w-3.5 shrink-0 text-accent/80" />
                  <span className="truncate" title={audioMetaLabel}>{audioMetaLabel}</span>
                </div>
                <div className="shrink-0 text-[11px] tabular-nums text-text-muted">
                  {formatAudioDuration(effectiveCurrentTime)} / {formatAudioDuration(playbackDuration)}
                </div>
              </div>

              <div className="relative mt-2 h-4">
                <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-white/10" />
                <div
                  className="absolute left-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-accent transition-[width] duration-150"
                  style={{ width: `${playbackProgress}%` }}
                />
                <input
                  type="range"
                  min={0}
                  max={playbackDuration > 0 ? playbackDuration : 1}
                  step={0.01}
                  value={effectiveCurrentTime}
                  onChange={handleSeekChange}
                  className="nodrag nowheel absolute inset-0 h-4 w-full cursor-pointer appearance-none bg-transparent opacity-0"
                />
              </div>
            </div>
          </div>

          {audioError ? (
            <div
              className="mt-2 truncate rounded-full border border-red-400/18 bg-red-500/10 px-2.5 py-1 text-[11px] text-red-100/90"
              title={audioError}
            >
              {audioError}
            </div>
          ) : null}
          </div>
        ) : shouldRenderTaskState ? (
          <div
            className={`flex h-full w-full flex-col justify-center rounded-[var(--node-radius)] px-3 py-3 ${
              isTaskFailed
                ? 'bg-[linear-gradient(165deg,rgba(248,113,113,0.12),rgba(127,29,29,0.08))]'
                : 'bg-[linear-gradient(165deg,rgba(96,165,250,0.14),rgba(15,23,42,0.08))]'
            }`}
          >
          {isTaskFailed ? (
            <>
              <div className="flex items-center gap-2 text-sm font-medium text-red-100">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span>{t('node.audioNode.generationFailedTitle')}</span>
              </div>
              <div className="mt-2 line-clamp-2 text-xs leading-5 text-red-100/90">
                {data.lastError}
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-medium text-text-dark">
                  {isTaskRunning
                    ? t('node.audioNode.generatingTitle')
                    : t('node.audioNode.queuedTitle')}
                </div>
                {queuePosition && queuePosition > 0 ? (
                  <div className="rounded-full border border-white/12 bg-white/[0.06] px-2 py-0.5 text-[10px] text-text-muted">
                    {t('node.audioNode.queueBadge', { count: queuePosition })}
                  </div>
                ) : null}
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10">
                <div
                  className={`h-full rounded-full transition-[width] duration-300 ${
                    isTaskRunning ? 'bg-accent' : 'bg-white/40'
                  }`}
                  style={{ width: `${Math.max(isTaskQueued ? 8 : 0, taskProgress)}%` }}
                />
              </div>
              <div className="mt-2 text-xs leading-5 text-text-muted">
                {data.statusText ?? (
                  isTaskRunning
                    ? t('node.audioNode.generatingHint')
                    : t('node.audioNode.queueStarting')
                )}
              </div>
            </>
          )}
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
          type="target"
          position={Position.Left}
          id="target"
          className="!h-3 !w-3 !border-2 !border-white !bg-accent"
        />

        <Handle
          type="source"
          position={Position.Right}
          id="source"
          className="!h-3 !w-3 !border-2 !border-white !bg-accent"
        />
      </div>

      <UiModal
        isOpen={isPresetModalOpen}
        title={t('node.audioNode.saveAsPreset')}
        onClose={() => {
          if (isSavingPreset) {
            return;
          }
          setIsPresetModalOpen(false);
        }}
        widthClassName="w-[560px]"
        footer={(
          <>
            <UiButton
              type="button"
              variant="ghost"
              disabled={isSavingPreset}
              onClick={() => setIsPresetModalOpen(false)}
            >
              {t('common.cancel')}
            </UiButton>
            <UiButton
              type="button"
              variant="primary"
              disabled={
                isSavingPreset
                || !targetPresetLibrary
                || presetTitle.trim().length === 0
                || presetReferenceText.length === 0
              }
              onClick={() => void handleSavePreset()}
            >
              {isSavingPreset ? t('common.saving') : t('common.save')}
            </UiButton>
          </>
        )}
      >
        <div className="space-y-3">
          <label className="block space-y-1.5">
            <span className="text-xs font-medium uppercase tracking-[0.14em] text-text-muted/80">
              {t('assets.library')}
            </span>
            <UiSelect
              value={presetLibraryId}
              onChange={(event) => setPresetLibraryId(event.target.value)}
              disabled={assetLibraries.length === 0}
            >
              <option value="">{t('node.audioNode.savePresetSelectLibrary')}</option>
              {assetLibraries.map((library) => (
                <option key={library.id} value={library.id}>
                  {library.name}
                </option>
              ))}
            </UiSelect>
          </label>

          <label className="block space-y-1.5">
            <span className="text-xs font-medium uppercase tracking-[0.14em] text-text-muted/80">
              {t('assets.assetName')}
            </span>
            <UiInput
              value={presetTitle}
              onChange={(event) => setPresetTitle(event.target.value)}
              placeholder={defaultPresetTitle}
            />
          </label>

          <div className="grid gap-3 md:grid-cols-2">
            <label className="block space-y-1.5">
              <span className="text-xs font-medium uppercase tracking-[0.14em] text-text-muted/80">
                {t('assets.subcategory')}
              </span>
              <UiSelect
                value={presetSubcategoryId}
                onChange={(event) => setPresetSubcategoryId(event.target.value)}
                disabled={!targetPresetLibrary}
              >
                <option value="">{t('assets.unassigned')}</option>
                {targetPresetSubcategories.map((subcategory) => (
                  <option key={subcategory.id} value={subcategory.id}>
                    {subcategory.name}
                  </option>
                ))}
              </UiSelect>
            </label>

            <label className="block space-y-1.5">
              <span className="text-xs font-medium uppercase tracking-[0.14em] text-text-muted/80">
                {t('assets.tags')}
              </span>
              <UiInput
                value={presetTagsText}
                onChange={(event) => setPresetTagsText(event.target.value)}
                placeholder={t('assets.tagsPlaceholder')}
              />
            </label>
          </div>

          <label className="block space-y-1.5">
            <span className="text-xs font-medium uppercase tracking-[0.14em] text-text-muted/80">
              {t('assets.description')}
            </span>
            <UiTextArea
              rows={4}
              value={presetDescription}
              onChange={(event) => setPresetDescription(event.target.value)}
              placeholder={t('node.audioNode.savePresetDescriptionPlaceholder')}
            />
          </label>

          <div className="rounded-xl border border-white/10 bg-black/10 px-3 py-2.5">
            <div className="mb-1 text-xs font-medium uppercase tracking-[0.14em] text-text-muted/80">
              {t('node.qwenTts.savedVoice.referenceTranscript')}
            </div>
            <div className="max-h-28 overflow-auto whitespace-pre-wrap text-sm leading-5 text-text-dark">
              {presetReferenceText || t('node.audioNode.savePresetMissingReferenceText')}
            </div>
          </div>

          {presetError ? (
            <div className="rounded-xl border border-red-400/25 bg-red-400/10 px-3 py-2 text-xs text-red-200">
              {presetError}
            </div>
          ) : null}

          {assetLibraries.length === 0 ? (
            <div className="rounded-xl border border-amber-400/20 bg-amber-400/10 px-3 py-2 text-xs text-amber-200">
              {t('node.audioNode.savePresetNoLibrary')}
            </div>
          ) : null}
        </div>
      </UiModal>
    </>
  );
});

AudioNode.displayName = 'AudioNode';
