import { memo, useEffect, useMemo, useState, type ChangeEvent } from 'react';
import { Handle, Position, useUpdateNodeInternals, type NodeProps } from '@xyflow/react';
import {
  ChevronDown,
  Languages,
  LibraryBig,
  Loader2,
  Save,
  SlidersHorizontal,
  Sparkles,
  Volume2,
  Waves,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { formatAudioDuration } from '@/features/canvas/application/audioData';
import {
  AUDIO_NODE_DEFAULT_HEIGHT,
  AUDIO_NODE_DEFAULT_WIDTH,
  CANVAS_NODE_TYPES,
  TTS_SAVED_VOICE_NODE_DEFAULT_HEIGHT,
  TTS_SAVED_VOICE_NODE_DEFAULT_WIDTH,
  type AudioNodeData,
  type CanvasEdge,
  type CanvasNode,
  type TtsSavedVoiceNodeData,
} from '@/features/canvas/domain/canvasNodes';
import { resolveNodeDisplayName } from '@/features/canvas/domain/nodeDisplay';
import {
  createQwenTtsSavedVoicePrompt,
  generateQwenTtsSavedVoiceAudio,
  resolveQwenTtsExtensionState,
} from '@/features/extensions/application/extensionRuntime';
import { NodeHeader, NODE_HEADER_FLOATING_POSITION_CLASS } from '@/features/canvas/ui/NodeHeader';
import { NodeStatusBadge } from '@/features/canvas/ui/NodeStatusBadge';
import { useCanvasStore } from '@/stores/canvasStore';
import { useExtensionsStore } from '@/stores/extensionsStore';
import {
  clamp,
  DEFAULT_MAX_NEW_TOKENS,
  DEFAULT_REPETITION_PENALTY,
  DEFAULT_TEMPERATURE,
  DEFAULT_TOP_K,
  DEFAULT_TOP_P,
  formatGeneratedTime,
  LANGUAGE_OPTIONS,
  MAX_NEW_TOKEN_OPTIONS,
  QWEN_TTS_PAUSE_FIELDS,
  resolveConnectedTtsText,
  resolvePauseConfig,
  resolveRuntimeTone,
  type VoiceLanguage,
} from './qwenTtsShared';

type QwenTtsSavedVoiceNodeProps = NodeProps & {
  id: string;
  data: TtsSavedVoiceNodeData;
  selected?: boolean;
};

type EditableSavedVoiceField =
  | 'voiceName'
  | 'referenceTranscript'
  | 'language'
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

function getConnectedAudioNodes(
  nodeId: string,
  nodes: CanvasNode[],
  edges: CanvasEdge[]
): CanvasNode[] {
  const incomingEdges = edges.filter((edge) => edge.target === nodeId);
  if (incomingEdges.length === 0) {
    return [];
  }

  const nodeMap = new Map(nodes.map((node) => [node.id, node] as const));
  return incomingEdges
    .map((edge) => nodeMap.get(edge.source))
    .filter(
      (node): node is CanvasNode =>
        Boolean(
          node &&
          node.type === CANVAS_NODE_TYPES.audio &&
          typeof (node.data as AudioNodeData).audioUrl === 'string' &&
          (node.data as AudioNodeData).audioUrl?.trim().length
        )
    );
}

function stripFileExtension(value: string): string {
  return value.replace(/\.[^.]+$/, '');
}

export const QwenTtsSavedVoiceNode = memo(({
  id,
  data,
  selected,
}: QwenTtsSavedVoiceNodeProps) => {
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

  const connectedText = useMemo(
    () => resolveConnectedTtsText(id, nodes, edges),
    [edges, id, nodes]
  );
  const connectedAudioNodes = useMemo(
    () => getConnectedAudioNodes(id, nodes, edges),
    [edges, id, nodes]
  );
  const referenceAudioNode = connectedAudioNodes[0] ?? null;
  const referenceAudioData = (referenceAudioNode?.data as AudioNodeData | undefined) ?? null;
  const referenceAudioPath = referenceAudioData?.audioUrl?.trim() ?? '';
  const referenceAudioName = referenceAudioData?.audioFileName?.trim() ?? '';
  const referenceAudioDuration = formatAudioDuration(referenceAudioData?.duration);
  const referenceTranscript = typeof data.referenceTranscript === 'string'
    ? data.referenceTranscript
    : '';
  const referenceTranscriptTrimmed = referenceTranscript.trim();
  const suggestedVoiceName = (
    (typeof data.voiceName === 'string' ? data.voiceName.trim() : '')
    || (referenceAudioName ? stripFileExtension(referenceAudioName) : '')
    || t('node.qwenTts.savedVoice.defaultVoiceName')
  );
  const connectedTextTrimmed = connectedText.trim();
  const connectedTextPreview = connectedTextTrimmed.length > 0
    ? connectedTextTrimmed
    : t('node.qwenTts.waitingForText');
  const connectedCharacterCount = connectedTextTrimmed.length;
  const connectedLineCount = connectedTextTrimmed.length > 0
    ? connectedTextTrimmed.split(/\n+/).filter((line) => line.trim().length > 0).length
    : 0;
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
  const pauseConfig = resolvePauseConfig(data);
  const runtimeProgress = extensionRuntime?.progress ?? 0;
  const currentRuntimeStep = activeExtensionPackage?.startupSteps.find(
    (step) => step.id === extensionRuntime?.currentStepId
  ) ?? null;
  const runtimeHint = isExtensionReady
    ? t('node.qwenTts.runtimeStateReady')
    : isExtensionStarting
      ? currentRuntimeStep?.description ?? t('node.qwenTts.runtimeStateStarting')
      : t('node.qwenTts.runtimeStateDisabled');
  const progressValue = typeof data.generationProgress === 'number'
    ? Math.max(0, Math.min(100, data.generationProgress))
    : 0;
  const hasAdvancedOverrides =
    maxNewTokens !== DEFAULT_MAX_NEW_TOKENS ||
    topP !== DEFAULT_TOP_P ||
    topK !== DEFAULT_TOP_K ||
    temperature !== DEFAULT_TEMPERATURE ||
    repetitionPenalty !== DEFAULT_REPETITION_PENALTY;
  const advancedSummary = t('node.qwenTts.advancedSummary', {
    temperature: temperature.toFixed(2),
    topP: topP.toFixed(2),
    topK,
    repetitionPenalty: repetitionPenalty.toFixed(2),
    maxNewTokens,
  });
  const promptFile = typeof data.promptFile === 'string' ? data.promptFile.trim() : '';
  const promptLabel = typeof data.promptLabel === 'string' ? data.promptLabel.trim() : '';
  const hasSavedPrompt = promptFile.length > 0;
  const canExtractPrompt =
    isExtensionReady &&
    !isSubmitting &&
    !data.isExtracting &&
    !data.isGenerating &&
    referenceAudioPath.length > 0 &&
    referenceTranscriptTrimmed.length > 0;
  const canGenerate =
    isExtensionReady &&
    !isSubmitting &&
    !data.isGenerating &&
    !data.isExtracting &&
    connectedTextTrimmed.length > 0 &&
    (hasSavedPrompt || canExtractPrompt);

  useEffect(() => {
    if (hasAdvancedOverrides) {
      setShowAdvancedControls(true);
    }
  }, [hasAdvancedOverrides]);

  useEffect(() => {
    updateNodeInternals(id);
  }, [
    currentRuntimeStep?.id,
    data.isExtracting,
    data.isGenerating,
    data.lastError,
    data.lastGeneratedAt,
    data.lastSavedAt,
    hasSavedPrompt,
    id,
    progressValue,
    showAdvancedControls,
    updateNodeInternals,
  ]);

  const headerStatus = useMemo(() => {
    if (data.isExtracting || data.isGenerating || isSubmitting) {
      return (
        <NodeStatusBadge
          icon={<Loader2 className="h-3 w-3" />}
          label={t(
            data.isExtracting
              ? 'node.qwenTts.savedVoice.extractingShort'
              : 'node.qwenTts.generating'
          )}
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

    if (data.lastSavedAt) {
      return (
        <NodeStatusBadge
          icon={<Save className="h-3 w-3" />}
          label={t('node.qwenTts.savedVoice.savedShort')}
          tone="processing"
          title={t('node.qwenTts.savedVoice.savedAt', {
            time: formatGeneratedTime(data.lastSavedAt, i18n.language),
          })}
        />
      );
    }

    return null;
  }, [
    data.isExtracting,
    data.isGenerating,
    data.lastError,
    data.lastGeneratedAt,
    data.lastSavedAt,
    i18n.language,
    isSubmitting,
    t,
  ]);

  const handleFieldChange = <TKey extends EditableSavedVoiceField>(
    key: TKey,
    value: TtsSavedVoiceNodeData[TKey]
  ) => {
    updateNodeData(
      id,
      {
        [key]: value,
        lastError: null,
      } as Partial<TtsSavedVoiceNodeData>,
      { historyMode: 'skip' }
    );
  };

  const updateErrorState = (message: string) => {
    updateNodeData(
      id,
      {
        isExtracting: false,
        isGenerating: false,
        generationProgress: 0,
        statusText: null,
        lastError: message,
      },
      { historyMode: 'skip' }
    );
  };

  const handleExtractVoice = async (): Promise<{
    promptFile: string;
    promptLabel: string;
  } | null> => {
    if (isSubmitting || data.isExtracting || data.isGenerating) {
      return null;
    }

    if (!isExtensionReady || !readyExtensionPackage) {
      updateErrorState(t('node.qwenTts.extensionDisabled'));
      return null;
    }

    if (!referenceAudioPath) {
      updateErrorState(t('node.qwenTts.savedVoice.noReferenceAudio'));
      return null;
    }

    if (!referenceTranscriptTrimmed) {
      updateErrorState(t('node.qwenTts.savedVoice.noReferenceTranscript'));
      return null;
    }

    setIsSubmitting(true);
    try {
      updateNodeData(
        id,
        {
          isExtracting: true,
          isGenerating: false,
          generationProgress: 18,
          statusText: t('node.qwenTts.savedVoice.statusExtracting'),
          lastError: null,
        },
        { historyMode: 'skip' }
      );

      const savedPrompt = await createQwenTtsSavedVoicePrompt(readyExtensionPackage, {
        refAudio: referenceAudioPath,
        refText: referenceTranscriptTrimmed,
        voiceName: suggestedVoiceName,
      });

      updateNodeData(
        id,
        {
          voiceName: suggestedVoiceName,
          promptFile: savedPrompt.promptFile,
          promptLabel: savedPrompt.promptLabel,
          isExtracting: false,
          generationProgress: 100,
          statusText: t('node.qwenTts.savedVoice.promptReady'),
          lastError: null,
          lastSavedAt: Date.now(),
        },
        { historyMode: 'skip' }
      );

      return savedPrompt;
    } catch (error) {
      updateErrorState(
        error instanceof Error && error.message.trim().length > 0
          ? error.message
          : t('node.qwenTts.savedVoice.extractFailed')
      );
      return null;
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleGenerate = async () => {
    if (isSubmitting || data.isGenerating || data.isExtracting) {
      return;
    }

    if (!isExtensionReady) {
      updateErrorState(t('node.qwenTts.extensionDisabled'));
      return;
    }

    if (!connectedTextTrimmed) {
      updateErrorState(t('node.qwenTts.noInputText'));
      return;
    }

    try {
      let resolvedPromptFile = promptFile;
      let resolvedPromptLabel = promptLabel;

      if (!resolvedPromptFile) {
        const extracted = await handleExtractVoice();
        if (!extracted) {
          return;
        }

        resolvedPromptFile = extracted.promptFile;
        resolvedPromptLabel = extracted.promptLabel;
      }

      setIsSubmitting(true);

      if (!readyExtensionPackage) {
        throw new Error(t('node.qwenTts.extensionDisabled'));
      }

      updateNodeData(
        id,
        {
          voiceName: suggestedVoiceName,
          promptFile: resolvedPromptFile,
          promptLabel: resolvedPromptLabel,
          isExtracting: false,
          isGenerating: true,
          generationProgress: 36,
          statusText: t('node.qwenTts.statusRendering'),
          lastError: null,
        },
        { historyMode: 'skip' }
      );

      const generatedAudio = await generateQwenTtsSavedVoiceAudio(readyExtensionPackage, {
        text: connectedTextTrimmed,
        language: data.language ?? 'auto',
        voiceName: suggestedVoiceName,
        promptFile: resolvedPromptFile,
        maxNewTokens,
        topP,
        topK,
        temperature,
        repetitionPenalty,
        pauseLinebreak: pauseConfig.pauseLinebreak,
        periodPause: pauseConfig.periodPause,
        commaPause: pauseConfig.commaPause,
        questionPause: pauseConfig.questionPause,
        hyphenPause: pauseConfig.hyphenPause,
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
      updateErrorState(
        error instanceof Error && error.message.trim().length > 0
          ? error.message
          : t('node.qwenTts.generateFailed')
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
        width: TTS_SAVED_VOICE_NODE_DEFAULT_WIDTH,
        minHeight: TTS_SAVED_VOICE_NODE_DEFAULT_HEIGHT,
      }}
      onClick={() => setSelectedNode(id)}
    >
      <NodeHeader
        className={NODE_HEADER_FLOATING_POSITION_CLASS}
        icon={<LibraryBig className="h-4 w-4" />}
        titleText={resolveNodeDisplayName(CANVAS_NODE_TYPES.ttsSavedVoice, data)}
        rightSlot={headerStatus}
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
                {t('node.qwenTts.savedVoice.modelBadge')}
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
                {t('node.qwenTts.savedVoice.referenceAudio')}
              </div>
              <div className="mt-1 text-sm font-semibold text-text-dark">
                {referenceAudioPath
                  ? t('node.qwenTts.savedVoice.referenceReady')
                  : t('node.qwenTts.savedVoice.referenceMissing')}
              </div>
              <div className="text-[11px] text-text-muted">
                {t('node.qwenTts.savedVoice.referenceCount', {
                  count: connectedAudioNodes.length,
                })}
              </div>
            </div>
            <div className="rounded-xl border border-white/10 bg-black/10 px-3 py-2">
              <div className="text-[10px] uppercase tracking-[0.14em] text-text-muted">
                {t('node.qwenTts.savedVoice.voiceBundle')}
              </div>
              <div className="mt-1 text-sm font-semibold text-text-dark">
                {hasSavedPrompt
                  ? promptLabel || suggestedVoiceName
                  : t('node.qwenTts.savedVoice.bundlePending')}
              </div>
              <div className="text-[11px] text-text-muted">
                {hasSavedPrompt
                  ? t('node.qwenTts.savedVoice.bundleReady')
                  : t('node.qwenTts.savedVoice.bundleHint')}
              </div>
            </div>
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
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-accent/14 text-accent">
              <Waves className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-text-dark">
                {t('node.qwenTts.savedVoice.referenceTitle')}
              </div>
              <p className="mt-1 text-xs leading-5 text-text-muted">
                {t('node.qwenTts.savedVoice.referenceDescription')}
              </p>
            </div>
          </div>

          <div className="mt-3 grid gap-2 md:grid-cols-2">
            <div className="rounded-xl border border-white/10 bg-black/10 px-3 py-2.5">
              <div className="text-xs font-medium text-text-muted">
                {t('node.qwenTts.savedVoice.referenceAudio')}
              </div>
              <div className="mt-1 truncate text-sm font-medium text-text-dark">
                {referenceAudioName || t('node.qwenTts.savedVoice.referenceMissing')}
              </div>
              <div className="mt-1 text-[11px] text-text-muted">
                {referenceAudioPath
                  ? t('node.qwenTts.savedVoice.referenceMeta', {
                    duration: referenceAudioDuration,
                  })
                  : t('node.qwenTts.savedVoice.referenceAudioHint')}
              </div>
            </div>

            <label className="block rounded-xl border border-white/10 bg-black/10 px-3 py-2.5">
              <div className="mb-1 text-xs font-medium text-text-muted">
                {t('node.qwenTts.savedVoice.voiceName')}
              </div>
              <input
                type="text"
                value={data.voiceName ?? ''}
                onChange={(event) => handleFieldChange('voiceName', event.target.value)}
                placeholder={suggestedVoiceName}
                className="nodrag nowheel h-10 w-full rounded-lg border border-white/10 bg-white/[0.04] px-3 text-sm text-text-dark outline-none transition-colors placeholder:text-text-muted/70 focus:border-accent"
              />
            </label>
          </div>

          <label className="mt-3 block">
            <div className="mb-1 text-xs font-medium text-text-muted">
              {t('node.qwenTts.savedVoice.referenceTranscript')}
            </div>
            <textarea
              value={referenceTranscript}
              onChange={(event) => handleFieldChange('referenceTranscript', event.target.value)}
              placeholder={t('node.qwenTts.savedVoice.referenceTranscriptPlaceholder')}
              className="nodrag nowheel h-20 w-full resize-none rounded-xl border border-white/10 bg-black/10 px-3 py-2.5 text-sm text-text-dark outline-none transition-colors placeholder:text-text-muted/70 focus:border-accent"
            />
          </label>

          <div className="mt-3 rounded-xl border border-white/10 bg-black/10 px-3 py-2.5 text-xs text-text-muted">
            {hasSavedPrompt
              ? t('node.qwenTts.savedVoice.savedBundleMeta', {
                label: promptLabel || suggestedVoiceName,
              })
              : t('node.qwenTts.savedVoice.bundleStorageHint')}
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
          <div className="mb-2 flex items-center justify-between gap-3">
            <div>
              <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-text-muted">
                {t('node.qwenTts.connectedText')}
              </div>
              <div className="mt-1 text-xs text-text-muted">
                {t('node.qwenTts.savedVoice.generationTextHint')}
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
            <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-white/[0.06] text-text-dark">
              <Languages className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-text-dark">
                {t('node.qwenTts.savedVoice.languageTitle')}
              </div>
              <p className="mt-1 text-xs leading-5 text-text-muted">
                {t('node.qwenTts.savedVoice.languageDescription')}
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
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-white/[0.06] text-text-dark">
              <Volume2 className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-text-dark">
                {t('node.qwenTts.pauseTitle')}
              </div>
              <p className="mt-1 text-xs leading-5 text-text-muted">
                {t('node.qwenTts.pauseDescription')}
              </p>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-1 gap-2.5">
            {QWEN_TTS_PAUSE_FIELDS.map((field) => {
              const fieldValue = pauseConfig[field.key];

              return (
                <label
                  key={field.key}
                  className="block rounded-xl border border-white/10 bg-black/10 px-3 py-2.5"
                >
                  <div className="mb-1 flex items-center justify-between gap-2 text-xs font-medium text-text-muted">
                    <span>{t(field.labelKey)}</span>
                    <span>{fieldValue.toFixed(1)}s</span>
                  </div>
                  <div className="text-[11px] text-text-muted">
                    {t(field.descriptionKey)}
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={5}
                    step={0.1}
                    value={fieldValue}
                    onChange={(event) => {
                      handleFieldChange(
                        field.key as EditableSavedVoiceField,
                        clamp(Number(event.target.value), 0, 5)
                      );
                    }}
                    className="nodrag nowheel mt-2 w-full accent-[var(--accent)]"
                  />
                </label>
              );
            })}
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

        {(data.isExtracting || data.isGenerating) ? (
          <div className="space-y-2 rounded-xl border border-accent/20 bg-accent/10 px-3 py-2.5">
            <div className="h-2 overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-accent transition-[width] duration-200"
                style={{ width: `${progressValue}%` }}
              />
            </div>
            <div className="text-xs text-text-muted">
              {data.statusText
                ?? t(
                  data.isExtracting
                    ? 'node.qwenTts.savedVoice.statusExtracting'
                    : 'node.qwenTts.generating'
                )}
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

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            disabled={!canExtractPrompt}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              void handleExtractVoice();
            }}
            className="nodrag inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-4 text-sm font-medium text-text-dark transition-colors hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {data.isExtracting || isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                {t('node.qwenTts.savedVoice.savingVoice')}
              </>
            ) : (
              <>
                <Save className="h-4 w-4" />
                {t('node.qwenTts.savedVoice.saveVoice')}
              </>
            )}
          </button>

          <button
            type="button"
            disabled={!canGenerate}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              void handleGenerate();
            }}
            className="nodrag inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-accent px-4 text-sm font-medium text-white transition-colors hover:bg-accent/85 disabled:cursor-not-allowed disabled:bg-accent/35"
          >
            {data.isGenerating || isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                {t('node.qwenTts.generating')}
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4" />
                {t('node.qwenTts.savedVoice.generateWithSavedVoice')}
              </>
            )}
          </button>
        </div>
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

QwenTtsSavedVoiceNode.displayName = 'QwenTtsSavedVoiceNode';
