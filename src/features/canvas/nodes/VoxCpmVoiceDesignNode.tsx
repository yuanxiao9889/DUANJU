import { memo, useEffect, useMemo } from 'react';
import { Handle, Position, useUpdateNodeInternals, type NodeProps } from '@xyflow/react';
import { AudioLines, Loader2, Sparkles, WandSparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { UiButton } from '@/components/ui';
import { enqueueTtsAudioGeneration } from '@/features/canvas/application/ttsAudioQueue';
import {
  AUDIO_NODE_DEFAULT_HEIGHT,
  AUDIO_NODE_DEFAULT_WIDTH,
  CANVAS_NODE_TYPES,
  VOXCPM_VOICE_DESIGN_NODE_DEFAULT_HEIGHT,
  VOXCPM_VOICE_DESIGN_NODE_DEFAULT_WIDTH,
  type AudioNodeData,
  type VoxCpmVoiceDesignNodeData,
} from '@/features/canvas/domain/canvasNodes';
import { resolveNodeDisplayName } from '@/features/canvas/domain/nodeDisplay';
import { NodeHeader, NODE_HEADER_FLOATING_POSITION_CLASS } from '@/features/canvas/ui/NodeHeader';
import { NodeStatusBadge } from '@/features/canvas/ui/NodeStatusBadge';
import {
  generateVoxCpmVoiceDesignAudio,
  resolveVoxCpmExtensionState,
} from '@/features/extensions/application/voxCpmRuntime';
import { useCanvasStore } from '@/stores/canvasStore';
import { useExtensionsStore } from '@/stores/extensionsStore';

import {
  clamp,
  DEFAULT_VOXCPM_CFG_VALUE,
  DEFAULT_VOXCPM_INFERENCE_TIMESTEPS,
  formatGeneratedTime,
  resolveConnectedVoxText,
  resolveRuntimeTone,
  SliderField,
  SummaryCard,
} from './voxCpmShared';

type VoxCpmVoiceDesignNodeProps = NodeProps & {
  id: string;
  data: VoxCpmVoiceDesignNodeData;
  selected?: boolean;
};

export const VoxCpmVoiceDesignNode = memo(({
  id,
  data,
  selected,
}: VoxCpmVoiceDesignNodeProps) => {
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

  const extensionState = useMemo(
    () => resolveVoxCpmExtensionState(extensionPackages, enabledExtensionIds, runtimeById),
    [enabledExtensionIds, extensionPackages, runtimeById]
  );
  const readyExtensionPackage = extensionState.readyPackage;
  const activeExtensionPackage = readyExtensionPackage ?? extensionState.pendingPackage;
  const extensionRuntime = extensionState.runtime;
  const isExtensionReady = Boolean(readyExtensionPackage);
  const isExtensionStarting = extensionRuntime?.status === 'starting';
  const connectedText = useMemo(
    () => resolveConnectedVoxText(id, nodes, edges),
    [edges, id, nodes]
  );

  const connectedTextTrimmed = connectedText.trim();
  const connectedTextPreview = connectedTextTrimmed.length > 0
    ? connectedTextTrimmed
    : t('node.voxCpm.waitingForText');
  const cfgValue = typeof data.cfgValue === 'number'
    ? clamp(data.cfgValue, 0.1, 5)
    : DEFAULT_VOXCPM_CFG_VALUE;
  const inferenceTimesteps = typeof data.inferenceTimesteps === 'number'
    ? clamp(Math.round(data.inferenceTimesteps), 1, 40)
    : DEFAULT_VOXCPM_INFERENCE_TIMESTEPS;
  const runtimeTone = resolveRuntimeTone(isExtensionReady, isExtensionStarting);
  const runtimeProgress = extensionRuntime?.progress ?? 0;
  const currentRuntimeStep = activeExtensionPackage?.startupSteps.find(
    (step) => step.id === extensionRuntime?.currentStepId
  ) ?? null;

  useEffect(() => {
    updateNodeInternals(id);
  }, [
    connectedTextPreview,
    currentRuntimeStep?.id,
    id,
    runtimeProgress,
    selected,
    updateNodeInternals,
  ]);

  const handleFieldChange = (field: keyof VoxCpmVoiceDesignNodeData, value: unknown) => {
    updateNodeData(id, { [field]: value }, { historyMode: 'skip' });
  };

  const handleGenerate = () => {
    if (!isExtensionReady || !readyExtensionPackage) {
      updateNodeData(
        id,
        {
          lastError: t('node.voxCpm.extensionDisabled'),
          statusText: isExtensionStarting
            ? t('node.voxCpm.extensionStarting')
            : t('node.voxCpm.extensionDisabled'),
        },
        { historyMode: 'skip' }
      );
      return;
    }

    if (!connectedTextTrimmed) {
      updateNodeData(
        id,
        {
          lastError: t('node.voxCpm.noInputText'),
          statusText: t('node.voxCpm.noInputText'),
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
        generationSource: 'voxCpmVoiceDesign',
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
      } satisfies Partial<AudioNodeData>,
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

    enqueueTtsAudioGeneration({
      audioNodeId,
      sourceNodeId: id,
      run: () =>
        generateVoxCpmVoiceDesignAudio(readyExtensionPackage, {
          text: connectedTextTrimmed,
          voicePrompt: data.voicePrompt ?? '',
          cfgValue,
          inferenceTimesteps,
        }),
    });
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
        width: VOXCPM_VOICE_DESIGN_NODE_DEFAULT_WIDTH,
        minHeight: VOXCPM_VOICE_DESIGN_NODE_DEFAULT_HEIGHT,
      }}
      onClick={() => setSelectedNode(id)}
    >
      <NodeHeader
        className={NODE_HEADER_FLOATING_POSITION_CLASS}
        icon={<WandSparkles className="h-4 w-4" />}
        titleText={resolveNodeDisplayName(CANVAS_NODE_TYPES.voxCpmVoiceDesign, data)}
        editable
        onTitleChange={(nextTitle) => updateNodeData(id, { displayName: nextTitle })}
        rightSlot={(
          data.lastError ? (
            <NodeStatusBadge
              icon={<AudioLines className="h-3.5 w-3.5" />}
              label={t('node.voxCpm.errorShort')}
              tone="danger"
              title={data.lastError}
            />
          ) : data.lastGeneratedAt ? (
            <NodeStatusBadge
              icon={<Sparkles className="h-3.5 w-3.5" />}
              label={t('node.voxCpm.readyShort')}
              tone="processing"
              title={t('node.voxCpm.generatedAt', {
                time: formatGeneratedTime(data.lastGeneratedAt, i18n.language),
              })}
            />
          ) : null
        )}
      />

      <div className="space-y-3">
        <div className={`rounded-xl border px-3 py-2.5 ${runtimeTone}`}>
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-xs font-medium text-current">{t('node.voxCpm.runtimeTitle')}</div>
              <div className="mt-1 text-[11px] leading-4 text-current/80">
                {isExtensionReady
                  ? t('node.voxCpm.runtimeReady')
                  : isExtensionStarting
                    ? currentRuntimeStep?.description ?? t('node.voxCpm.extensionStarting')
                    : t('node.voxCpm.runtimeDisabled')}
              </div>
            </div>
            {isExtensionStarting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          </div>
          {isExtensionStarting ? (
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-black/20">
              <div
                className="h-full rounded-full bg-current/80 transition-[width] duration-300"
                style={{ width: `${Math.max(8, runtimeProgress)}%` }}
              />
            </div>
          ) : null}
        </div>

        <SummaryCard
          icon={<AudioLines className="h-4 w-4" />}
          title={t('node.voxCpm.upstreamText')}
          subtitle={connectedTextPreview}
        />

        <label className="block rounded-xl border border-white/10 bg-black/10 px-3 py-2.5">
          <div className="mb-2 text-xs font-medium text-text-muted">
            {t('node.voxCpm.voicePrompt')}
          </div>
          <textarea
            value={typeof data.voicePrompt === 'string' ? data.voicePrompt : ''}
            onChange={(event) => handleFieldChange('voicePrompt', event.target.value)}
            placeholder={t('node.voxCpm.voicePromptPlaceholder')}
            className="nodrag nowheel min-h-[88px] w-full resize-y rounded-lg border border-white/10 bg-black/10 px-3 py-2 text-sm text-text-dark outline-none transition-colors placeholder:text-text-muted/70 focus:border-accent"
          />
          <div className="mt-2 text-[11px] leading-4 text-text-muted">
            {t('node.voxCpm.voicePromptHint')}
          </div>
        </label>

        <div className="grid gap-3 md:grid-cols-2">
          <SliderField
            label={t('node.voxCpm.cfgValue')}
            valueLabel={cfgValue.toFixed(1)}
            helperText={t('node.voxCpm.cfgValueHint')}
            min={0.1}
            max={5}
            step={0.1}
            value={cfgValue}
            onChange={(value) => handleFieldChange('cfgValue', value)}
          />
          <SliderField
            label={t('node.voxCpm.inferenceTimesteps')}
            valueLabel={String(inferenceTimesteps)}
            helperText={t('node.voxCpm.inferenceTimestepsHint')}
            min={1}
            max={40}
            step={1}
            value={inferenceTimesteps}
            onChange={(value) => handleFieldChange('inferenceTimesteps', value)}
          />
        </div>

        {data.lastError ? (
          <div className="rounded-xl border border-red-400/25 bg-red-400/10 px-3 py-2 text-[11px] leading-4 text-red-100">
            {data.lastError}
          </div>
        ) : null}

        <UiButton
          type="button"
          onClick={handleGenerate}
          className="nodrag h-10 w-full rounded-lg"
        >
          {t('node.voxCpm.voiceDesignGenerate')}
        </UiButton>
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

VoxCpmVoiceDesignNode.displayName = 'VoxCpmVoiceDesignNode';
