import { memo, useEffect, useMemo, useState, type ChangeEvent } from 'react';
import { Handle, Position, useUpdateNodeInternals, type NodeProps } from '@xyflow/react';
import { AudioLines, Loader2, Sparkles, Volume2 } from 'lucide-react';
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

const STYLE_OPTIONS: Array<{ value: VoiceStylePreset; labelKey: string }> = [
  { value: 'natural', labelKey: 'node.qwenTts.styles.natural' },
  { value: 'narrator', labelKey: 'node.qwenTts.styles.narrator' },
  { value: 'bright', labelKey: 'node.qwenTts.styles.bright' },
  { value: 'calm', labelKey: 'node.qwenTts.styles.calm' },
];

const LANGUAGE_OPTIONS: Array<{ value: VoiceLanguage; labelKey: string }> = [
  { value: 'auto', labelKey: 'node.qwenTts.languages.auto' },
  { value: 'zh', labelKey: 'node.qwenTts.languages.zh' },
  { value: 'en', labelKey: 'node.qwenTts.languages.en' },
  { value: 'jp', labelKey: 'node.qwenTts.languages.jp' },
];

function formatGeneratedTime(timestamp: number, locale: string): string {
  return new Date(timestamp).toLocaleTimeString(locale, {
    hour: '2-digit',
    minute: '2-digit',
  });
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

  const qwenTtsExtensionState = useMemo(
    () => resolveQwenTtsExtensionState(extensionPackages, enabledExtensionIds, runtimeById),
    [enabledExtensionIds, extensionPackages, runtimeById]
  );
  const readyExtensionPackage = qwenTtsExtensionState.readyPackage;
  const extensionRuntime = qwenTtsExtensionState.runtime;
  const isExtensionReady = Boolean(readyExtensionPackage);

  useEffect(() => {
    updateNodeInternals(id);
  }, [id, updateNodeInternals]);

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

  const handleFieldChange = <
    TKey extends keyof Pick<
      TtsVoiceDesignNodeData,
      'voicePrompt' | 'stylePreset' | 'language' | 'speakingRate' | 'pitch'
    >,
  >(
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

    const trimmedText = connectedText.trim();
    if (!trimmedText) {
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
        text: trimmedText,
        voicePrompt: data.voicePrompt ?? '',
        stylePreset: data.stylePreset ?? 'natural',
        language: data.language ?? 'auto',
        speakingRate: typeof data.speakingRate === 'number' ? data.speakingRate : 1,
        pitch: typeof data.pitch === 'number' ? data.pitch : 0,
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

  const connectedTextPreview = connectedText.trim().length > 0
    ? connectedText.trim()
    : t('node.qwenTts.waitingForText');

  const progressValue = typeof data.generationProgress === 'number'
    ? Math.max(0, Math.min(100, data.generationProgress))
    : 0;

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
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
          <div className="mb-1 text-[11px] font-medium uppercase tracking-[0.14em] text-text-muted">
            {t('node.qwenTts.connectedText')}
          </div>
          <div className="max-h-24 overflow-auto whitespace-pre-wrap text-sm leading-5 text-text-dark">
            {connectedTextPreview}
          </div>
        </div>

        <label className="block">
          <div className="mb-1 text-xs font-medium text-text-muted">
            {t('node.qwenTts.voicePrompt')}
          </div>
          <textarea
            value={data.voicePrompt ?? ''}
            onChange={(event) => handleFieldChange('voicePrompt', event.target.value)}
            placeholder={t('node.qwenTts.voicePromptPlaceholder')}
            className="nodrag nowheel h-20 w-full resize-none rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-text-dark outline-none transition-colors placeholder:text-text-muted/70 focus:border-accent"
          />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <div className="mb-1 text-xs font-medium text-text-muted">
              {t('node.qwenTts.stylePreset')}
            </div>
            <select
              value={data.stylePreset ?? 'natural'}
              onChange={(event: ChangeEvent<HTMLSelectElement>) => {
                handleFieldChange('stylePreset', event.target.value as VoiceStylePreset);
              }}
              className="nodrag nowheel h-9 w-full rounded-lg border border-white/10 bg-white/[0.03] px-2 text-sm text-text-dark outline-none focus:border-accent"
            >
              {STYLE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {t(option.labelKey)}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <div className="mb-1 text-xs font-medium text-text-muted">
              {t('node.qwenTts.language')}
            </div>
            <select
              value={data.language ?? 'auto'}
              onChange={(event: ChangeEvent<HTMLSelectElement>) => {
                handleFieldChange('language', event.target.value as VoiceLanguage);
              }}
              className="nodrag nowheel h-9 w-full rounded-lg border border-white/10 bg-white/[0.03] px-2 text-sm text-text-dark outline-none focus:border-accent"
            >
              {LANGUAGE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {t(option.labelKey)}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <div className="mb-1 flex items-center justify-between text-xs font-medium text-text-muted">
              <span>{t('node.qwenTts.speakingRate')}</span>
              <span>{Number(data.speakingRate ?? 1).toFixed(2)}x</span>
            </div>
            <input
              type="range"
              min={0.7}
              max={1.4}
              step={0.05}
              value={data.speakingRate ?? 1}
              onChange={(event) => {
                handleFieldChange('speakingRate', Number(event.target.value));
              }}
              className="nodrag nowheel w-full accent-[var(--accent)]"
            />
          </label>

          <label className="block">
            <div className="mb-1 flex items-center justify-between text-xs font-medium text-text-muted">
              <span>{t('node.qwenTts.pitch')}</span>
              <span>{data.pitch ?? 0}</span>
            </div>
            <input
              type="range"
              min={-6}
              max={6}
              step={1}
              value={data.pitch ?? 0}
              onChange={(event) => {
                handleFieldChange('pitch', Number(event.target.value));
              }}
              className="nodrag nowheel w-full accent-[var(--accent)]"
            />
          </label>
        </div>

        {data.isGenerating ? (
          <div className="space-y-2">
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
          <div className="rounded-lg border border-red-400/25 bg-red-400/10 px-3 py-2 text-xs text-red-200">
            {data.lastError}
          </div>
        ) : null}

        {!isExtensionReady ? (
          <div className="rounded-lg border border-amber-400/20 bg-amber-400/10 px-3 py-2 text-xs text-amber-200">
            {extensionRuntime?.status === 'starting'
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
          className="nodrag inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-accent px-4 text-sm font-medium text-white transition-colors hover:bg-accent/85 disabled:cursor-not-allowed disabled:bg-accent/35"
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
