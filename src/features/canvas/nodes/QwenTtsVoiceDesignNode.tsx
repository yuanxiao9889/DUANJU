import { memo, useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import { Handle, Position, useUpdateNodeInternals, type NodeProps } from '@xyflow/react';
import {
  AudioLines,
  Languages,
  Loader2,
  Settings2,
  SlidersHorizontal,
  Sparkles,
  Undo2,
  Volume2,
  Wand2,
  WandSparkles,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { UiButton, UiLoadingOverlay, UiModal, UiSelect } from '@/components/ui';
import { createUiRangeStyle } from '@/components/ui/rangeStyle';
import { optimizeCanvasPrompt } from '@/features/canvas/application/promptOptimization';
import { enqueueQwenTtsAudioGeneration } from '@/features/canvas/application/qwenTtsAudioQueue';
import { showErrorDialog } from '@/features/canvas/application/errorDialog';
import {
  AUDIO_NODE_DEFAULT_HEIGHT,
  AUDIO_NODE_DEFAULT_WIDTH,
  CANVAS_NODE_TYPES,
  TTS_VOICE_DESIGN_NODE_DEFAULT_HEIGHT,
  TTS_VOICE_DESIGN_NODE_DEFAULT_WIDTH,
  type AudioNodeData,
  type TtsVoiceDesignNodeData,
} from '@/features/canvas/domain/canvasNodes';
import { resolveNodeDisplayName } from '@/features/canvas/domain/nodeDisplay';
import { NodeHeader, NODE_HEADER_FLOATING_POSITION_CLASS } from '@/features/canvas/ui/NodeHeader';
import { NodeStatusBadge } from '@/features/canvas/ui/NodeStatusBadge';
import {
  generateQwenTtsVoiceDesignAudio,
  resolveQwenTtsExtensionState,
} from '@/features/extensions/application/extensionRuntime';
import { QWEN_TTS_COMPLETE_EXTENSION_ID } from '@/features/extensions/domain/types';
import { useCanvasStore } from '@/stores/canvasStore';
import { useExtensionsStore } from '@/stores/extensionsStore';
import {
  clamp,
  DEFAULT_MAX_NEW_TOKENS,
  DEFAULT_QWEN_TTS_PAUSE_CONFIG,
  DEFAULT_REPETITION_PENALTY,
  DEFAULT_TEMPERATURE,
  DEFAULT_TOP_K,
  DEFAULT_TOP_P,
  formatGeneratedTime,
  LANGUAGE_OPTIONS,
  MAX_NEW_TOKEN_OPTIONS,
  OUTPUT_FORMAT_OPTIONS,
  QWEN_TTS_PAUSE_FIELDS,
  resolveConnectedTtsText,
  resolvePauseConfig,
  resolvePitchDescriptorKey,
  resolveRuntimeTone,
  resolveSpeakingRateDescriptorKey,
  STYLE_OPTIONS,
  type VoiceLanguage,
} from './qwenTtsShared';

type QwenTtsVoiceDesignNodeProps = NodeProps & {
  id: string;
  data: TtsVoiceDesignNodeData;
  selected?: boolean;
};

type EditableVoiceDesignField =
  | 'voicePrompt'
  | 'language'
  | 'outputFormat'
  | 'stylePreset'
  | 'speakingRate'
  | 'pitch'
  | 'maxNewTokens'
  | 'topP'
  | 'topK'
  | 'temperature'
  | 'repetitionPenalty'
  | 'pauseLinebreak'
  | 'periodPause'
  | 'commaPause'
  | 'questionPause'
  | 'hyphenPause';

interface SummaryActionCardProps {
  icon: ReactNode;
  title: string;
  actionLabel: string;
  statusLabel?: string | null;
  active?: boolean;
  onClick: () => void;
}

function SummaryActionCard({
  icon,
  title,
  actionLabel,
  statusLabel = null,
  active = false,
  onClick,
}: SummaryActionCardProps) {
  return (
    <button
      type="button"
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      className={`nodrag min-h-[104px] rounded-xl border p-3 text-left transition-colors ${
        active
          ? 'border-accent/30 bg-accent/10'
          : 'border-white/10 bg-white/[0.03] hover:border-white/20 hover:bg-white/[0.05]'
      }`}
    >
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-between gap-2">
          <div
            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
              active ? 'bg-accent/16 text-accent' : 'bg-black/10 text-text-dark'
            }`}
          >
            {icon}
          </div>
          <div className="min-h-[20px]">
            {statusLabel ? (
              <span
                className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[9px] font-medium ${
                  active
                    ? 'border-accent/35 bg-accent/12 text-accent'
                    : 'border-white/10 bg-white/[0.04] text-text-muted'
                }`}
              >
                {statusLabel}
              </span>
            ) : null}
          </div>
        </div>

        <div className="mt-2.5 text-[13px] font-semibold leading-5 text-text-dark">
          {title}
        </div>

        <div className="mt-auto pt-2.5 text-[10px] leading-4 text-text-muted">{actionLabel}</div>
      </div>
    </button>
  );
}

interface SliderFieldProps {
  label: string;
  valueLabel: string;
  helperText: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (value: number) => void;
}

interface VoicePromptOptimizationUndoState {
  previousPrompt: string;
  appliedPrompt: string;
}

function SliderField({
  label,
  valueLabel,
  helperText,
  min,
  max,
  step,
  value,
  onChange,
}: SliderFieldProps) {
  const sliderStyle = createUiRangeStyle(value, min, max);

  return (
    <label className="block rounded-xl border border-white/10 bg-black/10 px-3 py-2.5">
      <div className="mb-2 flex items-center justify-between gap-3 text-xs font-medium text-text-muted">
        <span>{label}</span>
        <span>{valueLabel}</span>
      </div>
      <div className="text-[11px] leading-4 text-text-muted">{helperText}</div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="ui-range nodrag nowheel mt-1.5 w-full"
        style={sliderStyle}
      />
    </label>
  );
}

export const QwenTtsVoiceDesignNode = memo(({
  id,
  data,
  selected,
}: QwenTtsVoiceDesignNodeProps) => {
  const { t, i18n } = useTranslation();
  const updateNodeInternals = useUpdateNodeInternals();
  const setSelectedNode = useCanvasStore((state) => state.setSelectedNode);
  const updateNodeData = useCanvasStore((state) => state.updateNodeData);
  const addNode = useCanvasStore((state) => state.addNode);
  const addEdge = useCanvasStore((state) => state.addEdge);
  const findNodePosition = useCanvasStore((state) => state.findNodePosition);
  const nodes = useCanvasStore((state) => state.nodes);
  const edges = useCanvasStore((state) => state.edges);
  const voicePromptTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const voicePromptValueRef = useRef(data.voicePrompt ?? '');
  const extensionPackages = useExtensionsStore((state) => state.packages);
  const enabledExtensionIds = useExtensionsStore((state) => state.enabledExtensionIds);
  const runtimeById = useExtensionsStore((state) => state.runtimeById);
  const [isOptimizingVoicePrompt, setIsOptimizingVoicePrompt] = useState(false);
  const [voicePromptOptimizationError, setVoicePromptOptimizationError] = useState<string | null>(null);
  const [lastVoicePromptOptimizationUndoState, setLastVoicePromptOptimizationUndoState] =
    useState<VoicePromptOptimizationUndoState | null>(null);
  const [isRecipeModalOpen, setIsRecipeModalOpen] = useState(false);
  const [isRhythmModalOpen, setIsRhythmModalOpen] = useState(false);
  const [isPauseModalOpen, setIsPauseModalOpen] = useState(false);
  const [isAdvancedModalOpen, setIsAdvancedModalOpen] = useState(false);

  const qwenTtsExtensionState = useMemo(
    () => resolveQwenTtsExtensionState(extensionPackages, enabledExtensionIds, runtimeById),
    [enabledExtensionIds, extensionPackages, runtimeById]
  );
  const readyExtensionPackage = qwenTtsExtensionState.readyPackage;
  const activeExtensionPackage = readyExtensionPackage ?? qwenTtsExtensionState.pendingPackage;
  const extensionRuntime = qwenTtsExtensionState.runtime;
  const isExtensionReady = Boolean(readyExtensionPackage);
  const isExtensionStarting = extensionRuntime?.status === 'starting';
  const supportsMp3Output = activeExtensionPackage?.id === QWEN_TTS_COMPLETE_EXTENSION_ID;

  const connectedText = useMemo(
    () => resolveConnectedTtsText(id, nodes, edges),
    [edges, id, nodes]
  );

  const speakingRate = typeof data.speakingRate === 'number' ? data.speakingRate : 1;
  const pitch = typeof data.pitch === 'number' ? data.pitch : 0;
  const maxNewTokens = typeof data.maxNewTokens === 'number'
    ? data.maxNewTokens
    : DEFAULT_MAX_NEW_TOKENS;
  const topP = typeof data.topP === 'number' ? data.topP : DEFAULT_TOP_P;
  const topK = typeof data.topK === 'number' ? data.topK : DEFAULT_TOP_K;
  const outputFormat = supportsMp3Output && data.outputFormat === 'mp3' ? 'mp3' : 'wav';
  const availableOutputFormatOptions = supportsMp3Output
    ? OUTPUT_FORMAT_OPTIONS
    : OUTPUT_FORMAT_OPTIONS.filter((option) => option.value === 'wav');
  const temperature = typeof data.temperature === 'number'
    ? data.temperature
    : DEFAULT_TEMPERATURE;
  const repetitionPenalty = typeof data.repetitionPenalty === 'number'
    ? data.repetitionPenalty
    : DEFAULT_REPETITION_PENALTY;
  const pauseConfig = resolvePauseConfig(data);
  const pauseLinebreak = pauseConfig.pauseLinebreak;
  const periodPause = pauseConfig.periodPause;
  const commaPause = pauseConfig.commaPause;
  const questionPause = pauseConfig.questionPause;
  const hyphenPause = pauseConfig.hyphenPause;
  const connectedTextTrimmed = connectedText.trim();
  const connectedTextPreview = connectedTextTrimmed.length > 0
    ? connectedTextTrimmed
    : t('node.qwenTts.waitingForText');
  const connectedCharacterCount = connectedTextTrimmed.length;
  const styleOption = STYLE_OPTIONS.find(
    (option) => option.value === (data.stylePreset ?? 'natural')
  ) ?? STYLE_OPTIONS[0];
  const hasAdvancedOverrides =
    maxNewTokens !== DEFAULT_MAX_NEW_TOKENS ||
    topP !== DEFAULT_TOP_P ||
    topK !== DEFAULT_TOP_K ||
    temperature !== DEFAULT_TEMPERATURE ||
    repetitionPenalty !== DEFAULT_REPETITION_PENALTY;
  const hasRhythmOverrides = speakingRate !== 1 || pitch !== 0;
  const hasPauseOverrides =
    pauseLinebreak !== DEFAULT_QWEN_TTS_PAUSE_CONFIG.pauseLinebreak ||
    periodPause !== DEFAULT_QWEN_TTS_PAUSE_CONFIG.periodPause ||
    commaPause !== DEFAULT_QWEN_TTS_PAUSE_CONFIG.commaPause ||
    questionPause !== DEFAULT_QWEN_TTS_PAUSE_CONFIG.questionPause ||
    hyphenPause !== DEFAULT_QWEN_TTS_PAUSE_CONFIG.hyphenPause;
  const runtimeProgress = extensionRuntime?.progress ?? 0;
  const currentRuntimeStep = activeExtensionPackage?.startupSteps.find(
    (step) => step.id === extensionRuntime?.currentStepId
  ) ?? null;
  const runtimeHint = isExtensionReady
    ? t('node.qwenTts.runtimeStateReady')
    : isExtensionStarting
      ? currentRuntimeStep?.description ?? t('node.qwenTts.runtimeStateStarting')
      : t('node.qwenTts.runtimeStateDisabled');
  const speakingRateDescriptor = t(resolveSpeakingRateDescriptorKey(speakingRate));
  const pitchDescriptor = t(resolvePitchDescriptorKey(pitch));
  const pitchValueLabel = pitch > 0 ? `+${pitch}` : `${pitch}`;
  const pendingAudioTaskCount = useMemo(() => {
    const nodeMap = new Map(nodes.map((node) => [node.id, node] as const));
    return edges
      .filter((edge) => edge.source === id)
      .map((edge) => nodeMap.get(edge.target))
      .filter((node): node is NonNullable<typeof node> => Boolean(node))
      .filter((node) => node.type === CANVAS_NODE_TYPES.audio)
      .map((node) => node.data as AudioNodeData)
      .filter((audioData) => {
        if (audioData.generationSource !== 'ttsVoiceDesign' || audioData.audioUrl) {
          return false;
        }

        return audioData.isGenerating || typeof audioData.queuePosition === 'number';
      })
      .length;
  }, [edges, id, nodes]);
  const combinedError = voicePromptOptimizationError ?? data.lastError;
  const showBlockingOverlay = Boolean(pendingAudioTaskCount > 0 || isOptimizingVoicePrompt);

  useEffect(() => {
    voicePromptValueRef.current = data.voicePrompt ?? '';
  }, [data.voicePrompt]);

  useEffect(() => {
    updateNodeInternals(id);
  }, [
    currentRuntimeStep?.id,
    data.lastError,
    data.lastGeneratedAt,
    id,
    pendingAudioTaskCount,
    updateNodeInternals,
  ]);

  const generationStatus = useMemo(() => {
    if (pendingAudioTaskCount > 0) {
      return (
        <NodeStatusBadge
          icon={<Loader2 className="h-3 w-3" />}
          label={t('node.qwenTts.generating')}
          tone="processing"
          animate
        />
      );
    }

    if (!isExtensionReady) {
      if (isExtensionStarting) {
        return (
          <NodeStatusBadge
            icon={<Loader2 className="h-3 w-3" />}
            label={t('node.qwenTts.runtimeStartingLabel')}
            tone="processing"
            animate
            title={runtimeHint}
          />
        );
      }

      return (
        <NodeStatusBadge
          icon={<AudioLines className="h-3 w-3" />}
          label={t('node.qwenTts.runtimeDisabledLabel')}
          tone="warning"
          title={runtimeHint}
        />
      );
    }

    if (data.lastError) {
      return (
        <NodeStatusBadge
          icon={<Sparkles className="h-3 w-3" />}
          label={t('node.qwenTts.errorShort')}
          tone="danger"
          title={data.lastError}
        />
      );
    }

    if (data.lastGeneratedAt) {
      return (
        <NodeStatusBadge
          icon={<Volume2 className="h-3 w-3" />}
          label={t('node.qwenTts.readyShort')}
          tone="processing"
          title={t('node.qwenTts.generatedAt', {
            time: formatGeneratedTime(data.lastGeneratedAt, i18n.language),
          })}
        />
      );
    }

    return null;
  }, [
    data.lastError,
    data.lastGeneratedAt,
    i18n.language,
    isExtensionReady,
    isExtensionStarting,
    pendingAudioTaskCount,
    runtimeHint,
    t,
  ]);

  const focusVoicePromptToEnd = useCallback(() => {
    requestAnimationFrame(() => {
      const textarea = voicePromptTextareaRef.current;
      if (!textarea) {
        return;
      }
      const nextCursor = textarea.value.length;
      textarea.focus();
      textarea.setSelectionRange(nextCursor, nextCursor);
    });
  }, []);

  const handleFieldChange = <TKey extends EditableVoiceDesignField>(
    key: TKey,
    value: TtsVoiceDesignNodeData[TKey]
  ) => {
    setVoicePromptOptimizationError(null);
    if (key === 'voicePrompt') {
      voicePromptValueRef.current = typeof value === 'string' ? value : voicePromptValueRef.current;
    }
    updateNodeData(
      id,
      {
        [key]: value,
        lastError: null,
      } as Partial<TtsVoiceDesignNodeData>,
      { historyMode: 'skip' }
    );
  };

  const handleOptimizeVoicePrompt = async () => {
    const sourcePrompt = voicePromptValueRef.current;
    const trimmedPrompt = sourcePrompt.trim();

    if (!trimmedPrompt) {
      const errorMessage = t('node.qwenTts.voicePromptRequired');
      setVoicePromptOptimizationError(errorMessage);
      await showErrorDialog(errorMessage, t('common.error'));
      return;
    }

    setIsOptimizingVoicePrompt(true);
    setVoicePromptOptimizationError(null);

    try {
      const result = await optimizeCanvasPrompt({
        mode: 'ttsVoice',
        prompt: trimmedPrompt,
      });

      const latestNode = useCanvasStore.getState().nodes.find((candidate) => candidate.id === id);
      const latestPrompt = typeof latestNode?.data === 'object' &&
        latestNode?.data &&
        'voicePrompt' in latestNode.data &&
        typeof latestNode.data.voicePrompt === 'string'
        ? latestNode.data.voicePrompt
        : '';

      if (latestPrompt !== sourcePrompt) {
        return;
      }

      setLastVoicePromptOptimizationUndoState(
        result.prompt === sourcePrompt
          ? null
          : {
              previousPrompt: sourcePrompt,
              appliedPrompt: result.prompt,
            }
      );
      voicePromptValueRef.current = result.prompt;
      updateNodeData(id, {
        voicePrompt: result.prompt,
        lastError: null,
      });
      focusVoicePromptToEnd();
    } catch (optimizationError) {
      const errorMessage =
        optimizationError instanceof Error && optimizationError.message.trim().length > 0
          ? optimizationError.message
          : t('node.qwenTts.optimizePromptFailed');
      setVoicePromptOptimizationError(errorMessage);
      await showErrorDialog(errorMessage, t('common.error'));
    } finally {
      setIsOptimizingVoicePrompt(false);
    }
  };

  const handleUndoOptimizedVoicePrompt = useCallback(() => {
    if (!lastVoicePromptOptimizationUndoState) {
      return;
    }

    if (voicePromptValueRef.current !== lastVoicePromptOptimizationUndoState.appliedPrompt) {
      return;
    }

    const restoredPrompt = lastVoicePromptOptimizationUndoState.previousPrompt;
    setLastVoicePromptOptimizationUndoState(null);
    setVoicePromptOptimizationError(null);
    voicePromptValueRef.current = restoredPrompt;
    updateNodeData(id, {
      voicePrompt: restoredPrompt,
      lastError: null,
    });
    focusVoicePromptToEnd();
  }, [focusVoicePromptToEnd, lastVoicePromptOptimizationUndoState, updateNodeData, id]);

  const canUndoOptimizedVoicePrompt = Boolean(
    lastVoicePromptOptimizationUndoState &&
      (data.voicePrompt ?? '') === lastVoicePromptOptimizationUndoState.appliedPrompt
  );

  const handleGenerate = () => {
    setVoicePromptOptimizationError(null);

    if (!isExtensionReady) {
      updateNodeData(
        id,
        {
          lastError: t('node.qwenTts.extensionDisabled'),
          statusText: t('node.qwenTts.extensionDisabled'),
        },
        { historyMode: 'skip' }
      );
      return;
    }

    if (!connectedTextTrimmed) {
      updateNodeData(
        id,
        {
          lastError: t('node.qwenTts.noInputText'),
          statusText: t('node.qwenTts.noInputText'),
        },
        { historyMode: 'skip' }
      );
      return;
    }

    if (!readyExtensionPackage) {
      updateNodeData(
        id,
        {
          lastError: t('node.qwenTts.extensionDisabled'),
          statusText: t('node.qwenTts.extensionDisabled'),
        },
        { historyMode: 'skip' }
      );
      return;
    }

    const audioNodePosition = findNodePosition(
      id,
      AUDIO_NODE_DEFAULT_WIDTH,
      AUDIO_NODE_DEFAULT_HEIGHT
    );
    const audioNodeId = addNode(
      CANVAS_NODE_TYPES.audio,
      audioNodePosition,
      {
        generationSource: 'ttsVoiceDesign',
        sourceNodeId: id,
        audioUrl: null,
        previewImageUrl: null,
        audioFileName: null,
        duration: undefined,
        mimeType: null,
        isGenerating: false,
        generationProgress: 0,
        queuePosition: 0,
        statusText: t('node.audioNode.queueStarting'),
        lastError: null,
        ttsPresetSource: {
          referenceText: connectedTextTrimmed,
          voicePrompt: data.voicePrompt ?? '',
          stylePreset: data.stylePreset ?? 'natural',
          language: data.language ?? 'auto',
          speakingRate,
          pitch,
        },
      },
      {
        inheritParentFromNodeId: id,
      }
    );

    addEdge(id, audioNodeId);

    updateNodeData(
      id,
      {
        lastError: null,
        statusText: null,
      },
      { historyMode: 'skip' }
    );

    enqueueQwenTtsAudioGeneration({
      audioNodeId,
      sourceNodeId: id,
      run: () => generateQwenTtsVoiceDesignAudio(readyExtensionPackage, {
        text: connectedTextTrimmed,
        voicePrompt: data.voicePrompt ?? '',
        stylePreset: data.stylePreset ?? 'natural',
        language: data.language ?? 'auto',
        outputFormat,
        speakingRate,
        pitch,
        maxNewTokens,
        topP,
        topK,
        temperature,
        repetitionPenalty,
        pauseLinebreak,
        periodPause,
        commaPause,
        questionPause,
        hyphenPause,
      }),
    });
  };

  return (
    <>
      <div
        className={`
          group relative overflow-visible rounded-[var(--node-radius)] border bg-surface-dark/90 p-3 transition-colors duration-150
          ${selected
            ? 'border-accent shadow-[0_0_0_1px_rgba(59,130,246,0.32)]'
            : 'border-[rgba(15,23,42,0.22)] hover:border-[rgba(15,23,42,0.34)] dark:border-[rgba(255,255,255,0.22)] dark:hover:border-[rgba(255,255,255,0.34)]'}
        `}
        style={{
          width: TTS_VOICE_DESIGN_NODE_DEFAULT_WIDTH,
          minHeight: TTS_VOICE_DESIGN_NODE_DEFAULT_HEIGHT,
        }}
        onClick={() => setSelectedNode(id)}
      >
        <NodeHeader
          className={NODE_HEADER_FLOATING_POSITION_CLASS}
          icon={<AudioLines className="h-4 w-4" />}
          titleText={resolveNodeDisplayName(CANVAS_NODE_TYPES.ttsVoiceDesign, data)}
          rightSlot={generationStatus}
          editable
          onTitleChange={(nextTitle) => updateNodeData(id, { displayName: nextTitle })}
        />

        <div className="space-y-3">
          <div className="rounded-2xl border border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(56,189,248,0.16),transparent_42%),linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.02))] p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0 text-sm font-semibold text-text-dark">
                {t('node.qwenTts.modelBadge')}
              </div>
              {generationStatus ? null : (
                <div
                  className={`rounded-full border px-2 py-1 text-[11px] font-medium ${resolveRuntimeTone(
                    isExtensionReady,
                    isExtensionStarting
                  )}`}
                >
                  {isExtensionReady
                    ? t('node.qwenTts.runtimeReadyLabel')
                    : isExtensionStarting
                      ? t('node.qwenTts.runtimeStartingLabel')
                      : t('node.qwenTts.runtimeDisabledLabel')}
                </div>
              )}
            </div>

            <div className="mt-3 rounded-xl border border-white/10 bg-black/10 px-3 py-2.5">
              <div className="mb-2 flex items-center justify-between gap-3">
                <div>
                  <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-text-muted">
                    {t('node.qwenTts.connectedText')}
                  </div>
                  <div className="mt-1 text-xs text-text-muted">
                    {t('node.qwenTts.connectedTextHint')}
                  </div>
                </div>
                <div className="rounded-full border border-white/10 px-2 py-1 text-[11px] text-text-muted">
                  {t('node.qwenTts.connectedCharacterCount', { count: connectedCharacterCount })}
                </div>
              </div>
              <div className="max-h-20 overflow-auto whitespace-pre-wrap text-sm leading-5 text-text-dark">
                {connectedTextPreview}
              </div>
            </div>

            {isExtensionStarting ? (
              <div className="mt-3 space-y-2">
                <div className="flex items-center justify-between text-[11px] text-text-muted">
                  <span>
                    {currentRuntimeStep
                      ? `${t('node.qwenTts.runtimeProgress')}: ${currentRuntimeStep.label}`
                      : t('node.qwenTts.runtimeProgress')}
                  </span>
                  <span>{runtimeProgress}%</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-white/10">
                  <div
                    className="h-full rounded-full bg-accent transition-[width] duration-300"
                    style={{ width: `${runtimeProgress}%` }}
                  />
                </div>
              </div>
            ) : null}
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-1.5">
                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-accent/14 text-accent">
                  <WandSparkles className="h-3.5 w-3.5" />
                </div>
                <div className="text-sm font-semibold text-text-dark">
                  {t('node.qwenTts.recipeTitle')}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  disabled={isOptimizingVoicePrompt || (data.voicePrompt?.trim().length ?? 0) === 0}
                  aria-label={
                    isOptimizingVoicePrompt
                      ? t('node.qwenTts.optimizingPrompt')
                      : t('node.qwenTts.optimizePrompt')
                  }
                  title={
                    isOptimizingVoicePrompt
                      ? t('node.qwenTts.optimizingPrompt')
                      : t('node.qwenTts.optimizePrompt')
                  }
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation();
                    void handleOptimizeVoicePrompt();
                  }}
                  className="nodrag inline-flex h-7 w-7 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] text-text-muted transition-colors hover:border-accent/45 hover:bg-accent/14 hover:text-text-dark disabled:cursor-not-allowed disabled:border-white/8 disabled:bg-white/[0.02] disabled:text-text-muted/45"
                >
                  <Wand2 className="h-3.5 w-3.5" strokeWidth={2.25} />
                </button>
                {canUndoOptimizedVoicePrompt ? (
                  <button
                    type="button"
                    title={t('node.qwenTts.undoOptimizedPrompt')}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.stopPropagation();
                      handleUndoOptimizedVoicePrompt();
                    }}
                    className="nodrag inline-flex h-7 w-7 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] text-text-muted transition-colors hover:border-white/20 hover:bg-white/[0.06] hover:text-text-dark"
                  >
                    <Undo2 className="h-3.5 w-3.5" strokeWidth={2.2} />
                  </button>
                ) : null}
                <button
                  type="button"
                  aria-label={t('node.qwenTts.openSettingsShort')}
                  title={t('node.qwenTts.openSettingsShort')}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation();
                    setIsRecipeModalOpen(true);
                  }}
                  className="nodrag inline-flex h-7 w-7 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] text-text-muted transition-colors hover:border-white/20 hover:bg-white/[0.06] hover:text-text-dark"
                >
                  <Settings2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            <textarea
              ref={voicePromptTextareaRef}
              value={data.voicePrompt ?? ''}
              onChange={(event) => handleFieldChange('voicePrompt', event.target.value)}
              placeholder={t('node.qwenTts.voicePromptPlaceholder')}
              className="nodrag nowheel h-28 w-full resize-none rounded-xl border border-white/10 bg-black/10 px-3 py-2.5 text-sm text-text-dark outline-none transition-colors placeholder:text-text-muted/70 focus:border-accent"
            />

            <label className="mt-2 block">
              <div className="mb-1.5 flex items-center justify-between gap-2 text-[11px] font-medium text-text-muted">
                <span>{t('node.qwenTts.stylePreset')}</span>
                <span className="truncate text-[10px] text-text-muted/80">
                  {t(styleOption.labelKey)}
                </span>
              </div>
              <UiSelect
                value={data.stylePreset ?? 'natural'}
                onChange={(event: ChangeEvent<HTMLSelectElement>) => {
                  handleFieldChange(
                    'stylePreset',
                    event.target.value as TtsVoiceDesignNodeData['stylePreset']
                  );
                }}
                className="!h-8 !rounded-lg !border-white/10 !bg-black/10 !px-2.5 !text-xs"
              >
                {STYLE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {t(option.labelKey)}
                  </option>
                ))}
              </UiSelect>
              <div className="mt-1.5 text-[11px] leading-4 text-text-muted">
                {t(styleOption.descriptionKey)}
              </div>
            </label>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <SummaryActionCard
              icon={<Languages className="h-4 w-4" />}
              title={t('node.qwenTts.rhythmTitle')}
              actionLabel={t('node.qwenTts.openSettingsShort')}
              statusLabel={hasRhythmOverrides ? t('node.qwenTts.customizedShort') : null}
              active={hasRhythmOverrides}
              onClick={() => setIsRhythmModalOpen(true)}
            />
            <SummaryActionCard
              icon={<Volume2 className="h-4 w-4" />}
              title={t('node.qwenTts.pauseTitle')}
              actionLabel={t('node.qwenTts.openSettingsShort')}
              statusLabel={hasPauseOverrides ? t('node.qwenTts.customizedShort') : null}
              active={hasPauseOverrides}
              onClick={() => setIsPauseModalOpen(true)}
            />
            <SummaryActionCard
              icon={<SlidersHorizontal className="h-4 w-4" />}
              title={t('node.qwenTts.advancedSettings')}
              actionLabel={t('node.qwenTts.openSettingsShort')}
              statusLabel={hasAdvancedOverrides ? t('node.qwenTts.customizedShort') : null}
              active={hasAdvancedOverrides}
              onClick={() => setIsAdvancedModalOpen(true)}
            />
          </div>

          {combinedError ? (
            <div className="rounded-xl border border-red-400/25 bg-red-400/10 px-3 py-2 text-xs text-red-200">
              {combinedError}
            </div>
          ) : null}

          {!isExtensionReady ? (
            <div className="rounded-xl border border-amber-400/20 bg-amber-400/10 px-3 py-2 text-xs text-amber-200">
              {isExtensionStarting
                ? t('node.qwenTts.extensionStarting')
                : t('node.qwenTts.extensionDisabled')}
            </div>
          ) : null}

          <button
            type="button"
            disabled={!isExtensionReady}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              handleGenerate();
            }}
            className="nodrag inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-accent px-4 text-sm font-medium text-white transition-colors hover:bg-accent/85 disabled:cursor-not-allowed disabled:bg-accent/35"
          >
            <Sparkles className="h-4 w-4" />
            {t('node.qwenTts.generate')}
          </button>
        </div>

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
        <UiLoadingOverlay
          visible={showBlockingOverlay}
          insetClassName="inset-3"
          backdropClassName="bg-transparent"
          variant="bare"
        />
      </div>

      <UiModal
        isOpen={isRecipeModalOpen}
        title={t('node.qwenTts.recipeTitle')}
        onClose={() => setIsRecipeModalOpen(false)}
        widthClassName="w-[520px]"
        footer={(
          <UiButton variant="ghost" onClick={() => setIsRecipeModalOpen(false)}>
            {t('common.close')}
          </UiButton>
        )}
      >
        <div className="space-y-3">
          <label className="block rounded-xl border border-white/10 bg-black/10 px-3 py-2.5">
            <div className="mb-1 text-xs font-medium text-text-muted">
              {t('node.qwenTts.language')}
            </div>
            <UiSelect
              value={data.language ?? 'auto'}
              onChange={(event: ChangeEvent<HTMLSelectElement>) => {
                handleFieldChange('language', event.target.value as VoiceLanguage);
              }}
              className="!h-10 !rounded-xl !border-white/10 !bg-white/[0.04] !px-3 !text-sm"
            >
              {LANGUAGE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {t(option.labelKey)}
                </option>
              ))}
            </UiSelect>
            <div className="mt-2 text-[11px] leading-4 text-text-muted">
              {t('node.qwenTts.languageHint')}
            </div>
          </label>

          <label className="block rounded-xl border border-white/10 bg-black/10 px-3 py-2.5">
            <div className="mb-1 text-xs font-medium text-text-muted">
              {t('node.qwenTts.outputFormat')}
            </div>
            <UiSelect
              value={outputFormat}
              onChange={(event: ChangeEvent<HTMLSelectElement>) => {
                handleFieldChange(
                  'outputFormat',
                  event.target.value as TtsVoiceDesignNodeData['outputFormat']
                );
              }}
              className="!h-10 !rounded-xl !border-white/10 !bg-white/[0.04] !px-3 !text-sm"
            >
              {availableOutputFormatOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {t(option.labelKey)}
                </option>
              ))}
            </UiSelect>
            <div className="mt-2 text-[11px] leading-4 text-text-muted">
              {t('node.qwenTts.outputFormatHint')}
            </div>
          </label>
        </div>
      </UiModal>

      <UiModal
        isOpen={isRhythmModalOpen}
        title={t('node.qwenTts.rhythmTitle')}
        onClose={() => setIsRhythmModalOpen(false)}
        widthClassName="w-[560px]"
        footer={(
          <UiButton variant="ghost" onClick={() => setIsRhythmModalOpen(false)}>
            {t('common.close')}
          </UiButton>
        )}
      >
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <SliderField
              label={t('node.qwenTts.speakingRate')}
              valueLabel={`${speakingRate.toFixed(2)}x`}
              helperText={speakingRateDescriptor}
              min={0.7}
              max={1.4}
              step={0.05}
              value={speakingRate}
              onChange={(value) => handleFieldChange('speakingRate', value)}
            />
            <SliderField
              label={t('node.qwenTts.pitch')}
              valueLabel={pitchValueLabel}
              helperText={pitchDescriptor}
              min={-6}
              max={6}
              step={1}
              value={pitch}
              onChange={(value) => handleFieldChange('pitch', value)}
            />
          </div>
        </div>
      </UiModal>

      <UiModal
        isOpen={isPauseModalOpen}
        title={t('node.qwenTts.pauseTitle')}
        onClose={() => setIsPauseModalOpen(false)}
        widthClassName="w-[620px]"
        footer={(
          <UiButton variant="ghost" onClick={() => setIsPauseModalOpen(false)}>
            {t('common.close')}
          </UiButton>
        )}
      >
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            {QWEN_TTS_PAUSE_FIELDS.map((field) => {
              const fieldValue = pauseConfig[field.key];

              return (
                <SliderField
                  key={field.key}
                  label={t(field.labelKey)}
                  valueLabel={`${fieldValue.toFixed(1)}s`}
                  helperText={t(field.descriptionKey)}
                  min={0}
                  max={5}
                  step={0.1}
                  value={fieldValue}
                  onChange={(value) => {
                    handleFieldChange(
                      field.key as EditableVoiceDesignField,
                      clamp(value, 0, 5)
                    );
                  }}
                />
              );
            })}
          </div>
        </div>
      </UiModal>

      <UiModal
        isOpen={isAdvancedModalOpen}
        title={t('node.qwenTts.advancedSettings')}
        onClose={() => setIsAdvancedModalOpen(false)}
        widthClassName="w-[620px]"
        footer={(
          <UiButton variant="ghost" onClick={() => setIsAdvancedModalOpen(false)}>
            {t('common.close')}
          </UiButton>
        )}
      >
        <div className="space-y-3">
          <label className="block rounded-xl border border-white/10 bg-black/10 px-3 py-2.5">
            <div className="mb-2 flex items-center justify-between gap-3 text-xs font-medium text-text-muted">
              <span>{t('node.qwenTts.maxNewTokens')}</span>
              <span>{maxNewTokens}</span>
            </div>
            <div className="text-[11px] leading-4 text-text-muted">
              {t('node.qwenTts.parameterDescriptions.maxNewTokens')}
            </div>
            <UiSelect
              value={String(maxNewTokens)}
              onChange={(event: ChangeEvent<HTMLSelectElement>) => {
                handleFieldChange('maxNewTokens', Number(event.target.value));
              }}
              className="mt-2 !h-10 !rounded-xl !border-white/10 !bg-white/[0.04] !px-3 !text-sm"
            >
              {MAX_NEW_TOKEN_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </UiSelect>
          </label>

          <div className="grid grid-cols-2 gap-3">
            <SliderField
              label={t('node.qwenTts.temperature')}
              valueLabel={temperature.toFixed(2)}
              helperText={t('node.qwenTts.parameterDescriptions.temperature')}
              min={0.1}
              max={2}
              step={0.05}
              value={temperature}
              onChange={(value) => {
                handleFieldChange('temperature', clamp(value, 0.1, 2));
              }}
            />
            <SliderField
              label={t('node.qwenTts.repetitionPenalty')}
              valueLabel={repetitionPenalty.toFixed(2)}
              helperText={t('node.qwenTts.parameterDescriptions.repetitionPenalty')}
              min={1}
              max={2}
              step={0.05}
              value={repetitionPenalty}
              onChange={(value) => {
                handleFieldChange('repetitionPenalty', clamp(value, 1, 2));
              }}
            />
            <SliderField
              label={t('node.qwenTts.topP')}
              valueLabel={topP.toFixed(2)}
              helperText={t('node.qwenTts.parameterDescriptions.topP')}
              min={0}
              max={1}
              step={0.05}
              value={topP}
              onChange={(value) => {
                handleFieldChange('topP', clamp(value, 0, 1));
              }}
            />
            <SliderField
              label={t('node.qwenTts.topK')}
              valueLabel={`${topK}`}
              helperText={t('node.qwenTts.parameterDescriptions.topK')}
              min={0}
              max={100}
              step={1}
              value={topK}
              onChange={(value) => {
                handleFieldChange('topK', clamp(Math.round(value), 0, 100));
              }}
            />
          </div>
        </div>
      </UiModal>
    </>
  );
});

QwenTtsVoiceDesignNode.displayName = 'QwenTtsVoiceDesignNode';
