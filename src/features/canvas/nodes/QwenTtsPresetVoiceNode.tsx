import { memo, useCallback, useEffect, useMemo, useState, type ChangeEvent } from 'react';
import { Handle, Position, useUpdateNodeInternals, type NodeProps } from '@xyflow/react';
import {
  AudioLines,
  Languages,
  Loader2,
  SlidersHorizontal,
  Sparkles,
  Volume2,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { UiButton, UiModal, UiSelect, UiTextArea } from '@/components/ui';
import { enqueueQwenTtsAudioGeneration } from '@/features/canvas/application/qwenTtsAudioQueue';
import {
  AUDIO_NODE_DEFAULT_HEIGHT,
  AUDIO_NODE_DEFAULT_WIDTH,
  CANVAS_NODE_TYPES,
  TTS_PRESET_VOICE_NODE_DEFAULT_HEIGHT,
  TTS_PRESET_VOICE_NODE_DEFAULT_WIDTH,
  type AudioNodeData,
  type TtsPresetVoiceNodeData,
} from '@/features/canvas/domain/canvasNodes';
import { resolveNodeDisplayName } from '@/features/canvas/domain/nodeDisplay';
import { NodeHeader, NODE_HEADER_FLOATING_POSITION_CLASS } from '@/features/canvas/ui/NodeHeader';
import { NodeStatusBadge } from '@/features/canvas/ui/NodeStatusBadge';
import {
  generateQwenTtsPresetVoiceAudio,
  resolveQwenTtsExtensionState,
} from '@/features/extensions/application/extensionRuntime';
import { useCanvasStore } from '@/stores/canvasStore';
import { useExtensionsStore } from '@/stores/extensionsStore';
import {
  DEFAULT_MAX_NEW_TOKENS,
  DEFAULT_REPETITION_PENALTY,
  DEFAULT_TEMPERATURE,
  DEFAULT_TOP_K,
  DEFAULT_TOP_P,
  formatGeneratedTime,
  LANGUAGE_OPTIONS,
  MAX_NEW_TOKEN_OPTIONS,
  PRESET_VOICE_OPTIONS,
  resolveConnectedTtsText,
  resolveRuntimeTone,
  type PresetVoiceSpeaker,
  type VoiceLanguage,
} from './qwenTtsShared';

type QwenTtsPresetVoiceNodeProps = NodeProps & {
  id: string;
  data: TtsPresetVoiceNodeData;
  selected?: boolean;
};

type EditablePresetVoiceField =
  | 'speaker'
  | 'language'
  | 'instruct'
  | 'maxNewTokens'
  | 'topP'
  | 'topK'
  | 'temperature'
  | 'repetitionPenalty';

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
        className="nodrag nowheel mt-2 w-full accent-[var(--accent)]"
      />
    </label>
  );
}

export const QwenTtsPresetVoiceNode = memo(({
  id,
  data,
  selected,
}: QwenTtsPresetVoiceNodeProps) => {
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

  const connectedText = useMemo(
    () => resolveConnectedTtsText(id, nodes, edges),
    [edges, id, nodes]
  );
  const connectedTextTrimmed = connectedText.trim();
  const connectedTextPreview = connectedTextTrimmed.length > 0
    ? connectedTextTrimmed
    : t('node.qwenTts.waitingForText');
  const connectedCharacterCount = connectedTextTrimmed.length;
  const connectedLineCount = connectedTextTrimmed.length > 0
    ? connectedTextTrimmed.split(/\n+/).filter((line) => line.trim().length > 0).length
    : 0;

  const speaker = data.speaker ?? PRESET_VOICE_OPTIONS[0].value;
  const language = data.language ?? 'auto';
  const instruct = typeof data.instruct === 'string' ? data.instruct : '';
  const maxNewTokens = typeof data.maxNewTokens === 'number' ? data.maxNewTokens : DEFAULT_MAX_NEW_TOKENS;
  const topP = typeof data.topP === 'number' ? data.topP : DEFAULT_TOP_P;
  const topK = typeof data.topK === 'number' ? data.topK : DEFAULT_TOP_K;
  const temperature = typeof data.temperature === 'number' ? data.temperature : DEFAULT_TEMPERATURE;
  const repetitionPenalty = typeof data.repetitionPenalty === 'number'
    ? data.repetitionPenalty
    : DEFAULT_REPETITION_PENALTY;

  const selectedSpeaker = PRESET_VOICE_OPTIONS.find((option) => option.value === speaker)
    ?? PRESET_VOICE_OPTIONS[0];
  const speakerDescription = t(selectedSpeaker.descriptionKey);
  const runtimeProgress = extensionRuntime?.progress ?? 0;
  const currentRuntimeStep = activeExtensionPackage?.startupSteps.find(
    (step) => step.id === extensionRuntime?.currentStepId
  ) ?? null;
  const runtimeHint = isExtensionReady
    ? t('node.qwenTts.runtimeStateReady')
    : isExtensionStarting
      ? currentRuntimeStep?.description ?? t('node.qwenTts.runtimeStateStarting')
      : t('node.qwenTts.runtimeStateDisabled');
  const hasAdvancedOverrides =
    maxNewTokens !== DEFAULT_MAX_NEW_TOKENS ||
    topP !== DEFAULT_TOP_P ||
    topK !== DEFAULT_TOP_K ||
    temperature !== DEFAULT_TEMPERATURE ||
    repetitionPenalty !== DEFAULT_REPETITION_PENALTY;

  const pendingAudioTaskCount = useMemo(() => {
    const nodeMap = new Map(nodes.map((node) => [node.id, node] as const));
    return edges
      .filter((edge) => edge.source === id)
      .map((edge) => nodeMap.get(edge.target))
      .filter((node): node is NonNullable<typeof node> => Boolean(node))
      .filter((node) => node.type === CANVAS_NODE_TYPES.audio)
      .map((node) => node.data as AudioNodeData)
      .filter((audioData) => {
        if (audioData.generationSource !== 'ttsPresetVoice' || audioData.audioUrl) {
          return false;
        }

        return audioData.isGenerating || typeof audioData.queuePosition === 'number';
      })
      .length;
  }, [edges, id, nodes]);

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

  const headerStatus = useMemo(() => {
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

  const handleFieldChange = <TKey extends EditablePresetVoiceField>(
    key: TKey,
    value: TtsPresetVoiceNodeData[TKey]
  ) => {
    updateNodeData(
      id,
      {
        [key]: value,
        lastError: null,
      } as Partial<TtsPresetVoiceNodeData>,
      { historyMode: 'skip' }
    );
  };

  const updateErrorState = useCallback((message: string) => {
    updateNodeData(
      id,
      {
        lastError: message,
        statusText: message,
      },
      { historyMode: 'skip' }
    );
  }, [id, updateNodeData]);

  const handleGenerate = useCallback(() => {
    if (!connectedTextTrimmed) {
      updateErrorState(t('node.qwenTts.noInputText'));
      return;
    }

    if (!readyExtensionPackage) {
      updateErrorState(t('node.qwenTts.extensionDisabled'));
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
        generationSource: 'ttsPresetVoice',
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
      run: () => generateQwenTtsPresetVoiceAudio(readyExtensionPackage, {
        text: connectedTextTrimmed,
        speaker,
        language,
        instruct,
        maxNewTokens,
        topP,
        topK,
        temperature,
        repetitionPenalty,
      }),
    });
  }, [
    addEdge,
    addNode,
    connectedTextTrimmed,
    findNodePosition,
    id,
    instruct,
    language,
    maxNewTokens,
    readyExtensionPackage,
    repetitionPenalty,
    speaker,
    t,
    temperature,
    topK,
    topP,
    updateErrorState,
    updateNodeData,
  ]);

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
          width: TTS_PRESET_VOICE_NODE_DEFAULT_WIDTH,
          minHeight: TTS_PRESET_VOICE_NODE_DEFAULT_HEIGHT,
        }}
        onClick={() => setSelectedNode(id)}
      >
        <NodeHeader
          className={NODE_HEADER_FLOATING_POSITION_CLASS}
          icon={<AudioLines className="h-4 w-4" />}
          titleText={resolveNodeDisplayName(CANVAS_NODE_TYPES.ttsPresetVoice, data)}
          rightSlot={headerStatus}
          editable
          onTitleChange={(nextTitle) => updateNodeData(id, { displayName: nextTitle })}
        />

        <div className="space-y-3">
          <div className="rounded-2xl border border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(56,189,248,0.16),transparent_42%),linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.02))] p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0 text-sm font-semibold text-text-dark">
                {t('node.qwenTts.presetVoice.modelBadge')}
              </div>
              {headerStatus ? null : (
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

            <div className="mt-3 grid grid-cols-3 gap-2">
              <div className="rounded-xl border border-white/10 bg-black/10 px-3 py-2">
                <div className="text-[10px] uppercase tracking-[0.14em] text-text-muted">
                  {t('node.qwenTts.presetVoice.speaker')}
                </div>
                <div className="mt-1 truncate text-sm font-semibold text-text-dark">
                  {t(selectedSpeaker.labelKey)}
                </div>
                <div className="text-[11px] text-text-muted">
                  {t('node.qwenTts.presetVoice.libraryTitle')}
                </div>
              </div>
              <div className="rounded-xl border border-white/10 bg-black/10 px-3 py-2">
                <div className="text-[10px] uppercase tracking-[0.14em] text-text-muted">
                  {t('node.qwenTts.connectedText')}
                </div>
                <div className="mt-1 text-sm font-semibold text-text-dark">
                  {connectedCharacterCount}
                </div>
                <div className="text-[11px] text-text-muted">
                  {t('node.qwenTts.connectedTextStats', { count: connectedLineCount })}
                </div>
              </div>
              <div className="rounded-xl border border-white/10 bg-black/10 px-3 py-2">
                <div className="text-[10px] uppercase tracking-[0.14em] text-text-muted">
                  {t('node.qwenTts.language')}
                </div>
                <div className="mt-1 text-sm font-semibold text-text-dark">
                  {t(LANGUAGE_OPTIONS.find((option) => option.value === language)?.labelKey
                    ?? 'node.qwenTts.languages.auto')}
                </div>
                <div className="text-[11px] text-text-muted">
                  {t('node.qwenTts.languageHint')}
                </div>
              </div>
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
            <div className="mb-3 flex items-center gap-1.5">
              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-accent/14 text-accent">
                <Volume2 className="h-3.5 w-3.5" />
              </div>
              <div className="text-sm font-semibold text-text-dark">
                {t('node.qwenTts.presetVoice.libraryTitle')}
              </div>
            </div>

            <div className="grid gap-2 md:grid-cols-2">
              <label
                className="block rounded-xl border border-white/10 bg-black/10 px-3 py-2.5"
                onPointerDown={(event) => event.stopPropagation()}
              >
                <div className="mb-1 text-xs font-medium text-text-muted">
                  {t('node.qwenTts.presetVoice.speaker')}
                </div>
                <UiSelect
                  value={speaker}
                  onChange={(event: ChangeEvent<HTMLSelectElement>) => {
                    handleFieldChange('speaker', event.target.value as PresetVoiceSpeaker);
                  }}
                  className="!h-10 !rounded-xl !border-white/10 !bg-white/[0.04] !px-3 !text-sm"
                >
                  {PRESET_VOICE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {t(option.labelKey)}
                    </option>
                  ))}
                </UiSelect>
                <div className="mt-2 text-[11px] leading-4 text-text-muted">
                  {t('node.qwenTts.presetVoice.speakerHint')}
                </div>
              </label>

              <label
                className="block rounded-xl border border-white/10 bg-black/10 px-3 py-2.5"
                onPointerDown={(event) => event.stopPropagation()}
              >
                <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-text-muted">
                  <Languages className="h-3.5 w-3.5" />
                  {t('node.qwenTts.language')}
                </div>
                <UiSelect
                  value={language}
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
            </div>

            <div className="mt-2 rounded-xl border border-white/10 bg-black/10 px-3 py-2.5">
              <div className="text-xs font-medium text-text-muted">
                {t('node.qwenTts.presetVoice.currentVoice')}
              </div>
              <div className="mt-1 text-sm font-medium text-text-dark">
                {t(selectedSpeaker.labelKey)}
              </div>
              <div className="mt-1 text-[11px] leading-4 text-text-muted">
                {speakerDescription}
              </div>
            </div>

            <label
              className="mt-2 block rounded-xl border border-white/10 bg-black/10 px-3 py-2.5"
              onPointerDown={(event) => event.stopPropagation()}
            >
              <div className="mb-1 text-xs font-medium text-text-muted">
                {t('node.qwenTts.presetVoice.instruction')}
              </div>
              <UiTextArea
                value={instruct}
                onChange={(event) => handleFieldChange('instruct', event.target.value)}
                placeholder={t('node.qwenTts.presetVoice.instructionPlaceholder')}
                rows={3}
                className="nodrag nowheel !rounded-xl !border-white/10 !bg-white/[0.04] !px-3 !text-sm"
              />
              <div className="mt-2 text-[11px] leading-4 text-text-muted">
                {t('node.qwenTts.presetVoice.instructionHint')}
              </div>
            </label>
          </div>

          <button
            type="button"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              setIsAdvancedModalOpen(true);
            }}
            className="nodrag flex w-full items-center justify-between rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-left transition-colors hover:border-white/20 hover:bg-white/[0.05]"
          >
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent/14 text-accent">
                <SlidersHorizontal className="h-4 w-4" />
              </div>
              <div>
                <div className="text-sm font-medium text-text-dark">
                  {t('node.qwenTts.advancedSettings')}
                </div>
                <div className="text-[11px] leading-4 text-text-muted">
                  {hasAdvancedOverrides
                    ? t('node.qwenTts.advancedSummary', {
                      temperature: temperature.toFixed(2),
                      topP: topP.toFixed(2),
                      topK,
                      repetitionPenalty: repetitionPenalty.toFixed(2),
                      maxNewTokens,
                    })
                    : t('node.qwenTts.advancedSettingsHint')}
                </div>
              </div>
            </div>
            <div className="text-xs font-medium text-text-muted">
              {hasAdvancedOverrides
                ? t('node.qwenTts.customizedShort')
                : t('node.qwenTts.openSettingsShort')}
            </div>
          </button>

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
      </div>

      <UiModal
        isOpen={isAdvancedModalOpen}
        title={t('node.qwenTts.advancedSettings')}
        onClose={() => setIsAdvancedModalOpen(false)}
        widthClassName="w-[520px]"
        footer={(
          <UiButton variant="ghost" onClick={() => setIsAdvancedModalOpen(false)}>
            {t('common.close')}
          </UiButton>
        )}
      >
        <div className="space-y-3">
          <label className="block rounded-xl border border-white/10 bg-black/10 px-3 py-2.5">
            <div className="mb-1 text-xs font-medium text-text-muted">
              {t('node.qwenTts.maxNewTokens')}
            </div>
            <UiSelect
              value={String(maxNewTokens)}
              onChange={(event: ChangeEvent<HTMLSelectElement>) => {
                handleFieldChange('maxNewTokens', Number(event.target.value));
              }}
              className="!h-10 !rounded-xl !border-white/10 !bg-white/[0.04] !px-3 !text-sm"
            >
              {MAX_NEW_TOKEN_OPTIONS.map((option) => (
                <option key={option} value={String(option)}>
                  {option}
                </option>
              ))}
            </UiSelect>
            <div className="mt-2 text-[11px] leading-4 text-text-muted">
              {t('node.qwenTts.parameterDescriptions.maxNewTokens')}
            </div>
          </label>

          <SliderField
            label={t('node.qwenTts.temperature')}
            valueLabel={temperature.toFixed(2)}
            helperText={t('node.qwenTts.parameterDescriptions.temperature')}
            min={0.1}
            max={2}
            step={0.05}
            value={temperature}
            onChange={(value) => handleFieldChange('temperature', value)}
          />

          <SliderField
            label={t('node.qwenTts.topP')}
            valueLabel={topP.toFixed(2)}
            helperText={t('node.qwenTts.parameterDescriptions.topP')}
            min={0}
            max={1}
            step={0.01}
            value={topP}
            onChange={(value) => handleFieldChange('topP', value)}
          />

          <SliderField
            label={t('node.qwenTts.topK')}
            valueLabel={String(topK)}
            helperText={t('node.qwenTts.parameterDescriptions.topK')}
            min={0}
            max={100}
            step={1}
            value={topK}
            onChange={(value) => handleFieldChange('topK', Math.round(value))}
          />

          <SliderField
            label={t('node.qwenTts.repetitionPenalty')}
            valueLabel={repetitionPenalty.toFixed(2)}
            helperText={t('node.qwenTts.parameterDescriptions.repetitionPenalty')}
            min={1}
            max={2}
            step={0.01}
            value={repetitionPenalty}
            onChange={(value) => handleFieldChange('repetitionPenalty', value)}
          />
        </div>
      </UiModal>
    </>
  );
});

QwenTtsPresetVoiceNode.displayName = 'QwenTtsPresetVoiceNode';
