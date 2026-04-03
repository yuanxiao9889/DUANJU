import { memo, useEffect, useMemo, useState, type ChangeEvent } from 'react';
import { Handle, Position, useUpdateNodeInternals, type NodeProps } from '@xyflow/react';
import {
  AudioLines,
  ChevronDown,
  Languages,
  Loader2,
  SlidersHorizontal,
  Sparkles,
  Volume2,
  WandSparkles,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import {
  AUDIO_NODE_DEFAULT_HEIGHT,
  AUDIO_NODE_DEFAULT_WIDTH,
  CANVAS_NODE_TYPES,
  TTS_VOICE_DESIGN_NODE_DEFAULT_HEIGHT,
  TTS_VOICE_DESIGN_NODE_DEFAULT_WIDTH,
  type TtsVoiceDesignNodeData,
} from '@/features/canvas/domain/canvasNodes';
import { resolveNodeDisplayName } from '@/features/canvas/domain/nodeDisplay';
import {
  generateQwenTtsVoiceDesignAudio,
  resolveQwenTtsExtensionState,
} from '@/features/extensions/application/extensionRuntime';
import { NodeHeader, NODE_HEADER_FLOATING_POSITION_CLASS } from '@/features/canvas/ui/NodeHeader';
import { NodeStatusBadge } from '@/features/canvas/ui/NodeStatusBadge';
import { useCanvasStore } from '@/stores/canvasStore';
import { useExtensionsStore } from '@/stores/extensionsStore';

type QwenTtsVoiceDesignNodeProps = NodeProps & {
  id: string;
  data: TtsVoiceDesignNodeData;
  selected?: boolean;
};

type VoiceStylePreset = TtsVoiceDesignNodeData['stylePreset'];
type VoiceLanguage = TtsVoiceDesignNodeData['language'];
type EditableVoiceDesignField =
  | 'voicePrompt'
  | 'stylePreset'
  | 'language'
  | 'speakingRate'
  | 'pitch'
  | 'maxNewTokens'
  | 'topP'
  | 'topK'
  | 'temperature'
  | 'repetitionPenalty';

const DEFAULT_MAX_NEW_TOKENS = 2048;
const DEFAULT_TOP_P = 0.8;
const DEFAULT_TOP_K = 20;
const DEFAULT_TEMPERATURE = 1;
const DEFAULT_REPETITION_PENALTY = 1.05;

const STYLE_OPTIONS: Array<{
  value: VoiceStylePreset;
  labelKey: string;
  descriptionKey: string;
  activeClassName: string;
}> = [
  {
    value: 'natural',
    labelKey: 'node.qwenTts.styles.natural',
    descriptionKey: 'node.qwenTts.styleDescriptions.natural',
    activeClassName: 'border-sky-300/45 bg-sky-400/12 text-sky-100',
  },
  {
    value: 'narrator',
    labelKey: 'node.qwenTts.styles.narrator',
    descriptionKey: 'node.qwenTts.styleDescriptions.narrator',
    activeClassName: 'border-amber-300/45 bg-amber-400/12 text-amber-100',
  },
  {
    value: 'bright',
    labelKey: 'node.qwenTts.styles.bright',
    descriptionKey: 'node.qwenTts.styleDescriptions.bright',
    activeClassName: 'border-rose-300/45 bg-rose-400/12 text-rose-100',
  },
  {
    value: 'calm',
    labelKey: 'node.qwenTts.styles.calm',
    descriptionKey: 'node.qwenTts.styleDescriptions.calm',
    activeClassName: 'border-emerald-300/45 bg-emerald-400/12 text-emerald-100',
  },
];

const LANGUAGE_OPTIONS: Array<{ value: VoiceLanguage; labelKey: string }> = [
  { value: 'auto', labelKey: 'node.qwenTts.languages.auto' },
  { value: 'zh', labelKey: 'node.qwenTts.languages.zh' },
  { value: 'en', labelKey: 'node.qwenTts.languages.en' },
  { value: 'jp', labelKey: 'node.qwenTts.languages.jp' },
  { value: 'kr', labelKey: 'node.qwenTts.languages.kr' },
  { value: 'fr', labelKey: 'node.qwenTts.languages.fr' },
  { value: 'de', labelKey: 'node.qwenTts.languages.de' },
  { value: 'es', labelKey: 'node.qwenTts.languages.es' },
  { value: 'pt', labelKey: 'node.qwenTts.languages.pt' },
  { value: 'ru', labelKey: 'node.qwenTts.languages.ru' },
  { value: 'it', labelKey: 'node.qwenTts.languages.it' },
];

const MAX_NEW_TOKEN_OPTIONS = [512, 1024, 1536, 2048, 3072, 4096];

function formatGeneratedTime(timestamp: number, locale: string): string {
  return new Date(timestamp).toLocaleTimeString(locale, {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function resolveSpeakingRateDescriptorKey(rate: number): string {
  if (rate >= 1.15) {
    return 'node.qwenTts.rateDescriptors.fast';
  }
  if (rate <= 0.85) {
    return 'node.qwenTts.rateDescriptors.slow';
  }
  return 'node.qwenTts.rateDescriptors.natural';
}

function resolvePitchDescriptorKey(pitch: number): string {
  if (pitch >= 3) {
    return 'node.qwenTts.pitchDescriptors.high';
  }
  if (pitch <= -3) {
    return 'node.qwenTts.pitchDescriptors.low';
  }
  return 'node.qwenTts.pitchDescriptors.neutral';
}

function resolveRuntimeTone(
  isExtensionReady: boolean,
  isExtensionStarting: boolean
): string {
  if (isExtensionReady) {
    return 'border-emerald-400/30 bg-emerald-400/12 text-emerald-100';
  }
  if (isExtensionStarting) {
    return 'border-amber-400/30 bg-amber-400/12 text-amber-100';
  }
  return 'border-white/10 bg-white/[0.05] text-text-muted';
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
  const extensionPackages = useExtensionsStore((state) => state.packages);
  const enabledExtensionIds = useExtensionsStore((state) => state.enabledExtensionIds);
  const runtimeById = useExtensionsStore((state) => state.runtimeById);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showAdvancedControls, setShowAdvancedControls] = useState(false);

  const qwenTtsExtensionState = useMemo(
    () => resolveQwenTtsExtensionState(extensionPackages, enabledExtensionIds, runtimeById),
    [enabledExtensionIds, extensionPackages, runtimeById]
  );
  const readyExtensionPackage = qwenTtsExtensionState.readyPackage;
  const activeExtensionPackage = readyExtensionPackage ?? qwenTtsExtensionState.pendingPackage;
  const extensionRuntime = qwenTtsExtensionState.runtime;
  const isExtensionReady = Boolean(readyExtensionPackage);
  const isExtensionStarting = extensionRuntime?.status === 'starting';

  const connectedText = useMemo(() => {
    const incomingEdges = edges.filter((edge) => edge.target === id);
    if (incomingEdges.length === 0) {
      return '';
    }

    const nodeMap = new Map(nodes.map((node) => [node.id, node] as const));
    return incomingEdges
      .map((edge) => nodeMap.get(edge.source))
      .map((node) => {
        if (!node) {
          return '';
        }

        if (
          node.type === CANVAS_NODE_TYPES.ttsText ||
          node.type === CANVAS_NODE_TYPES.textAnnotation
        ) {
          return typeof node.data.content === 'string' ? node.data.content.trim() : '';
        }

        return '';
      })
      .filter((text) => text.length > 0)
      .join('\n\n');
  }, [edges, id, nodes]);

  const speakingRate = typeof data.speakingRate === 'number' ? data.speakingRate : 1;
  const pitch = typeof data.pitch === 'number' ? data.pitch : 0;
  const maxNewTokens = typeof data.maxNewTokens === 'number'
    ? data.maxNewTokens
    : DEFAULT_MAX_NEW_TOKENS;
  const topP = typeof data.topP === 'number' ? data.topP : DEFAULT_TOP_P;
  const topK = typeof data.topK === 'number' ? data.topK : DEFAULT_TOP_K;
  const temperature = typeof data.temperature === 'number'
    ? data.temperature
    : DEFAULT_TEMPERATURE;
  const repetitionPenalty = typeof data.repetitionPenalty === 'number'
    ? data.repetitionPenalty
    : DEFAULT_REPETITION_PENALTY;
  const progressValue = typeof data.generationProgress === 'number'
    ? Math.max(0, Math.min(100, data.generationProgress))
    : 0;
  const connectedTextTrimmed = connectedText.trim();
  const connectedTextPreview = connectedTextTrimmed.length > 0
    ? connectedTextTrimmed
    : t('node.qwenTts.waitingForText');
  const connectedCharacterCount = connectedTextTrimmed.length;
  const connectedLineCount = connectedTextTrimmed.length > 0
    ? connectedTextTrimmed.split(/\n+/).filter((line) => line.trim().length > 0).length
    : 0;
  const languageLabel = t(
    LANGUAGE_OPTIONS.find((option) => option.value === (data.language ?? 'auto'))?.labelKey
      ?? 'node.qwenTts.languages.auto'
  );
  const styleOption = STYLE_OPTIONS.find(
    (option) => option.value === (data.stylePreset ?? 'natural')
  ) ?? STYLE_OPTIONS[0];
  const hasAdvancedOverrides =
    maxNewTokens !== DEFAULT_MAX_NEW_TOKENS ||
    topP !== DEFAULT_TOP_P ||
    topK !== DEFAULT_TOP_K ||
    temperature !== DEFAULT_TEMPERATURE ||
    repetitionPenalty !== DEFAULT_REPETITION_PENALTY;
  const runtimeProgress = extensionRuntime?.progress ?? 0;
  const currentRuntimeStep = activeExtensionPackage?.startupSteps.find(
    (step) => step.id === extensionRuntime?.currentStepId
  ) ?? null;
  const runtimeHint = isExtensionReady
    ? t('node.qwenTts.runtimeStateReady')
    : isExtensionStarting
      ? currentRuntimeStep?.description ?? t('node.qwenTts.runtimeStateStarting')
      : t('node.qwenTts.runtimeStateDisabled');
  const advancedSummary = t('node.qwenTts.advancedSummary', {
    temperature: temperature.toFixed(2),
    topP: topP.toFixed(2),
    topK,
    repetitionPenalty: repetitionPenalty.toFixed(2),
    maxNewTokens,
  });

  useEffect(() => {
    if (hasAdvancedOverrides) {
      setShowAdvancedControls(true);
    }
  }, [hasAdvancedOverrides]);

  useEffect(() => {
    updateNodeInternals(id);
  }, [
    currentRuntimeStep?.id,
    data.isGenerating,
    data.lastError,
    data.lastGeneratedAt,
    id,
    progressValue,
    showAdvancedControls,
    updateNodeInternals,
  ]);

  const generationStatus = useMemo(() => {
    if (data.isGenerating || isSubmitting) {
      return (
        <NodeStatusBadge
          icon={<Loader2 className="h-3 w-3" />}
          label={t('node.qwenTts.generating')}
          tone="processing"
          animate
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
    data.isGenerating,
    data.lastError,
    data.lastGeneratedAt,
    i18n.language,
    isSubmitting,
    t,
  ]);

  const handleFieldChange = <TKey extends EditableVoiceDesignField>(
    key: TKey,
    value: TtsVoiceDesignNodeData[TKey]
  ) => {
    updateNodeData(
      id,
      {
        [key]: value,
        lastError: null,
      } as Partial<TtsVoiceDesignNodeData>,
      { historyMode: 'skip' }
    );
  };

  const handleGenerate = async () => {
    if (isSubmitting || data.isGenerating) {
      return;
    }

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

    setIsSubmitting(true);
    try {
      updateNodeData(
        id,
        {
          isGenerating: true,
          generationProgress: 12,
          statusText: t('node.qwenTts.statusPreparing'),
          lastError: null,
        },
        { historyMode: 'skip' }
      );

      if (!readyExtensionPackage) {
        throw new Error(t('node.qwenTts.extensionDisabled'));
      }

      updateNodeData(
        id,
        {
          generationProgress: 36,
          statusText: t('node.qwenTts.statusRendering'),
        },
        { historyMode: 'skip' }
      );

      const generatedAudio = await generateQwenTtsVoiceDesignAudio(readyExtensionPackage, {
        text: connectedTextTrimmed,
        voicePrompt: data.voicePrompt ?? '',
        stylePreset: data.stylePreset ?? 'natural',
        language: data.language ?? 'auto',
        speakingRate,
        pitch,
        maxNewTokens,
        topP,
        topK,
        temperature,
        repetitionPenalty,
      });

      updateNodeData(
        id,
        {
          generationProgress: 84,
          statusText: t('node.qwenTts.statusCreatingNode'),
        },
        { historyMode: 'skip' }
      );

      const audioNodePosition = findNodePosition(
        id,
        AUDIO_NODE_DEFAULT_WIDTH,
        AUDIO_NODE_DEFAULT_HEIGHT
      );
      const audioNodeId = addNode(
        CANVAS_NODE_TYPES.audio,
        audioNodePosition,
        {
          audioUrl: generatedAudio.audioUrl,
          previewImageUrl: generatedAudio.previewImageUrl,
          audioFileName: generatedAudio.audioFileName,
          duration: generatedAudio.duration,
          mimeType: generatedAudio.mimeType,
        },
        {
          inheritParentFromNodeId: id,
        }
      );

      addEdge(id, audioNodeId);

      updateNodeData(
        id,
        {
          isGenerating: false,
          generationProgress: 100,
          statusText: t('node.qwenTts.generatedToNode'),
          lastGeneratedAt: Date.now(),
          lastError: null,
        },
        { historyMode: 'skip' }
      );
    } catch (error) {
      console.error('Failed to generate Qwen TTS audio:', error);
      updateNodeData(
        id,
        {
          isGenerating: false,
          generationProgress: 0,
          statusText: null,
          lastError:
            error instanceof Error && error.message.trim().length > 0
              ? error.message
              : t('node.qwenTts.generateFailed'),
        },
        { historyMode: 'skip' }
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
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
        <div className="rounded-2xl border border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(56,189,248,0.16),transparent_42%),linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.02))] p-3.5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-text-muted">
                {t('node.qwenTts.offlineRuntime')}
              </div>
              <div className="mt-1 text-sm font-semibold text-text-dark">
                {t('node.qwenTts.modelBadge')}
              </div>
              <p className="mt-1 text-xs leading-5 text-text-muted">
                {runtimeHint}
              </p>
            </div>
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
          </div>

          <div className="mt-3 grid grid-cols-3 gap-2">
            <div className="rounded-xl border border-white/10 bg-black/10 px-3 py-2">
              <div className="text-[10px] uppercase tracking-[0.14em] text-text-muted">
                {t('node.qwenTts.connectedText')}
              </div>
              <div className="mt-1 text-sm font-semibold text-text-dark">
                {connectedCharacterCount || 0}
              </div>
              <div className="text-[11px] text-text-muted">
                {t('node.qwenTts.connectedTextStats', { count: connectedLineCount || 0 })}
              </div>
            </div>
            <div className="rounded-xl border border-white/10 bg-black/10 px-3 py-2">
              <div className="text-[10px] uppercase tracking-[0.14em] text-text-muted">
                {t('node.qwenTts.stylePreset')}
              </div>
              <div className="mt-1 text-sm font-semibold text-text-dark">
                {t(styleOption.labelKey)}
              </div>
              <div className="text-[11px] text-text-muted">
                {t(styleOption.descriptionKey)}
              </div>
            </div>
            <div className="rounded-xl border border-white/10 bg-black/10 px-3 py-2">
              <div className="text-[10px] uppercase tracking-[0.14em] text-text-muted">
                {t('node.qwenTts.language')}
              </div>
              <div className="mt-1 text-sm font-semibold text-text-dark">
                {languageLabel}
              </div>
              <div className="text-[11px] text-text-muted">
                {t('node.qwenTts.languageHint')}
              </div>
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
          <div className="max-h-28 overflow-auto whitespace-pre-wrap rounded-xl border border-white/10 bg-black/10 px-3 py-2 text-sm leading-5 text-text-dark">
            {connectedTextPreview}
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-accent/14 text-accent">
              <WandSparkles className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-text-dark">
                {t('node.qwenTts.recipeTitle')}
              </div>
              <p className="mt-1 text-xs leading-5 text-text-muted">
                {t('node.qwenTts.recipeDescription')}
              </p>
            </div>
          </div>

          <label className="mt-3 block">
            <div className="mb-1 text-xs font-medium text-text-muted">
              {t('node.qwenTts.voicePrompt')}
            </div>
            <textarea
              value={data.voicePrompt ?? ''}
              onChange={(event) => handleFieldChange('voicePrompt', event.target.value)}
              placeholder={t('node.qwenTts.voicePromptPlaceholder')}
              className="nodrag nowheel h-24 w-full resize-none rounded-xl border border-white/10 bg-black/10 px-3 py-2.5 text-sm text-text-dark outline-none transition-colors placeholder:text-text-muted/70 focus:border-accent"
            />
          </label>

          <div className="mt-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="text-xs font-medium text-text-muted">
                {t('node.qwenTts.stylePreset')}
              </div>
              <div className="text-[11px] text-text-muted">
                {t('node.qwenTts.styleHint')}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {STYLE_OPTIONS.map((option) => {
                const isActive = (data.stylePreset ?? 'natural') === option.value;

                return (
                  <button
                    key={option.value}
                    type="button"
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.stopPropagation();
                      handleFieldChange('stylePreset', option.value);
                    }}
                    className={`nodrag rounded-xl border px-3 py-2 text-left transition-colors ${
                      isActive
                        ? option.activeClassName
                        : 'border-white/10 bg-black/10 text-text-dark hover:border-white/20 hover:bg-white/[0.05]'
                    }`}
                  >
                    <div className="text-sm font-medium">{t(option.labelKey)}</div>
                    <div className="mt-1 text-[11px] leading-4 text-inherit/75">
                      {t(option.descriptionKey)}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-white/[0.06] text-text-dark">
              <Languages className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-text-dark">
                {t('node.qwenTts.rhythmTitle')}
              </div>
              <p className="mt-1 text-xs leading-5 text-text-muted">
                {t('node.qwenTts.rhythmDescription')}
              </p>
            </div>
          </div>

          <div className="mt-3">
            <label className="block">
              <div className="mb-1 text-xs font-medium text-text-muted">
                {t('node.qwenTts.language')}
              </div>
              <select
                value={data.language ?? 'auto'}
                onChange={(event: ChangeEvent<HTMLSelectElement>) => {
                  handleFieldChange('language', event.target.value as VoiceLanguage);
                }}
                className="nodrag nowheel h-10 w-full rounded-xl border border-white/10 bg-black/10 px-3 text-sm text-text-dark outline-none transition-colors focus:border-accent"
              >
                {LANGUAGE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {t(option.labelKey)}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-3">
            <label className="block rounded-xl border border-white/10 bg-black/10 px-3 py-2.5">
              <div className="mb-2 flex items-center justify-between text-xs font-medium text-text-muted">
                <span>{t('node.qwenTts.speakingRate')}</span>
                <span>{speakingRate.toFixed(2)}x</span>
              </div>
              <input
                type="range"
                min={0.7}
                max={1.4}
                step={0.05}
                value={speakingRate}
                onChange={(event) => {
                  handleFieldChange('speakingRate', Number(event.target.value));
                }}
                className="nodrag nowheel w-full accent-[var(--accent)]"
              />
              <div className="mt-2 text-[11px] text-text-muted">
                {t(resolveSpeakingRateDescriptorKey(speakingRate))}
              </div>
            </label>

            <label className="block rounded-xl border border-white/10 bg-black/10 px-3 py-2.5">
              <div className="mb-2 flex items-center justify-between text-xs font-medium text-text-muted">
                <span>{t('node.qwenTts.pitch')}</span>
                <span>{pitch > 0 ? `+${pitch}` : pitch}</span>
              </div>
              <input
                type="range"
                min={-6}
                max={6}
                step={1}
                value={pitch}
                onChange={(event) => {
                  handleFieldChange('pitch', Number(event.target.value));
                }}
                className="nodrag nowheel w-full accent-[var(--accent)]"
              />
              <div className="mt-2 text-[11px] text-text-muted">
                {t(resolvePitchDescriptorKey(pitch))}
              </div>
            </label>
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
          <button
            type="button"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              setShowAdvancedControls((previous) => !previous);
            }}
            className="nodrag flex w-full items-center justify-between gap-3 text-left"
          >
            <div className="flex min-w-0 items-start gap-3">
              <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-white/[0.06] text-text-dark">
                <SlidersHorizontal className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-semibold text-text-dark">
                  {t('node.qwenTts.advancedSettings')}
                </div>
                <p className="mt-1 text-xs leading-5 text-text-muted">
                  {showAdvancedControls
                    ? t('node.qwenTts.advancedSettingsHint')
                    : advancedSummary}
                </p>
              </div>
            </div>
            <ChevronDown
              className={`h-4 w-4 shrink-0 text-text-muted transition-transform ${
                showAdvancedControls ? 'rotate-180' : ''
              }`}
            />
          </button>

          {showAdvancedControls ? (
            <div className="mt-3 grid grid-cols-2 gap-2.5">
              <label className="col-span-2 block rounded-xl border border-white/10 bg-black/10 px-3 py-2.5">
                <div className="mb-1 flex items-center justify-between gap-2 text-xs font-medium text-text-muted">
                  <span>{t('node.qwenTts.maxNewTokens')}</span>
                  <span>{maxNewTokens}</span>
                </div>
                <div className="text-[11px] text-text-muted">
                  {t('node.qwenTts.parameterDescriptions.maxNewTokens')}
                </div>
                <select
                  value={String(maxNewTokens)}
                  onChange={(event: ChangeEvent<HTMLSelectElement>) => {
                    handleFieldChange('maxNewTokens', Number(event.target.value));
                  }}
                  className="nodrag nowheel mt-2 h-10 w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 text-sm text-text-dark outline-none transition-colors focus:border-accent"
                >
                  {MAX_NEW_TOKEN_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block rounded-xl border border-white/10 bg-black/10 px-3 py-2.5">
                <div className="mb-1 flex items-center justify-between gap-2 text-xs font-medium text-text-muted">
                  <span>{t('node.qwenTts.temperature')}</span>
                  <span>{temperature.toFixed(2)}</span>
                </div>
                <div className="text-[11px] text-text-muted">
                  {t('node.qwenTts.parameterDescriptions.temperature')}
                </div>
                <input
                  type="range"
                  min={0.1}
                  max={2}
                  step={0.05}
                  value={temperature}
                  onChange={(event) => {
                    handleFieldChange(
                      'temperature',
                      clamp(Number(event.target.value), 0.1, 2)
                    );
                  }}
                  className="nodrag nowheel mt-2 w-full accent-[var(--accent)]"
                />
              </label>

              <label className="block rounded-xl border border-white/10 bg-black/10 px-3 py-2.5">
                <div className="mb-1 flex items-center justify-between gap-2 text-xs font-medium text-text-muted">
                  <span>{t('node.qwenTts.repetitionPenalty')}</span>
                  <span>{repetitionPenalty.toFixed(2)}</span>
                </div>
                <div className="text-[11px] text-text-muted">
                  {t('node.qwenTts.parameterDescriptions.repetitionPenalty')}
                </div>
                <input
                  type="range"
                  min={1}
                  max={2}
                  step={0.05}
                  value={repetitionPenalty}
                  onChange={(event) => {
                    handleFieldChange(
                      'repetitionPenalty',
                      clamp(Number(event.target.value), 1, 2)
                    );
                  }}
                  className="nodrag nowheel mt-2 w-full accent-[var(--accent)]"
                />
              </label>

              <label className="block rounded-xl border border-white/10 bg-black/10 px-3 py-2.5">
                <div className="mb-1 flex items-center justify-between gap-2 text-xs font-medium text-text-muted">
                  <span>{t('node.qwenTts.topP')}</span>
                  <span>{topP.toFixed(2)}</span>
                </div>
                <div className="text-[11px] text-text-muted">
                  {t('node.qwenTts.parameterDescriptions.topP')}
                </div>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={topP}
                  onChange={(event) => {
                    handleFieldChange('topP', clamp(Number(event.target.value), 0, 1));
                  }}
                  className="nodrag nowheel mt-2 w-full accent-[var(--accent)]"
                />
              </label>

              <label className="block rounded-xl border border-white/10 bg-black/10 px-3 py-2.5">
                <div className="mb-1 flex items-center justify-between gap-2 text-xs font-medium text-text-muted">
                  <span>{t('node.qwenTts.topK')}</span>
                  <span>{topK}</span>
                </div>
                <div className="text-[11px] text-text-muted">
                  {t('node.qwenTts.parameterDescriptions.topK')}
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={topK}
                  onChange={(event) => {
                    handleFieldChange(
                      'topK',
                      clamp(Math.round(Number(event.target.value)), 0, 100)
                    );
                  }}
                  className="nodrag nowheel mt-2 w-full accent-[var(--accent)]"
                />
              </label>
            </div>
          ) : null}
        </div>

        {data.isGenerating ? (
          <div className="space-y-2 rounded-xl border border-accent/20 bg-accent/10 px-3 py-2.5">
            <div className="h-2 overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-accent transition-[width] duration-200"
                style={{ width: `${progressValue}%` }}
              />
            </div>
            <div className="text-xs text-text-muted">
              {data.statusText ?? t('node.qwenTts.generating')}
            </div>
          </div>
        ) : null}

        {data.lastError ? (
          <div className="rounded-xl border border-red-400/25 bg-red-400/10 px-3 py-2 text-xs text-red-200">
            {data.lastError}
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
          disabled={!isExtensionReady || isSubmitting || data.isGenerating}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            void handleGenerate();
          }}
          className="nodrag inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-accent px-4 text-sm font-medium text-white transition-colors hover:bg-accent/85 disabled:cursor-not-allowed disabled:bg-accent/35"
        >
          {data.isGenerating || isSubmitting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              {t('node.qwenTts.generating')}
            </>
          ) : (
            <>
              <Sparkles className="h-4 w-4" />
              {t('node.qwenTts.generate')}
            </>
          )}
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
    </div>
  );
});

QwenTtsVoiceDesignNode.displayName = 'QwenTtsVoiceDesignNode';
