import { memo, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { Handle, Position, useUpdateNodeInternals, type NodeProps } from '@xyflow/react';
import { AudioLines, LibraryBig, Loader2, Pause, Play, Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { UiButton, UiSelect } from '@/components/ui';
import { resolveAudioDisplayUrl } from '@/features/canvas/application/audioData';
import { useAssetStore } from '@/stores/assetStore';
import { useCanvasStore } from '@/stores/canvasStore';
import { useExtensionsStore } from '@/stores/extensionsStore';
import { enqueueTtsAudioGeneration } from '@/features/canvas/application/ttsAudioQueue';
import {
  AUDIO_NODE_DEFAULT_HEIGHT,
  AUDIO_NODE_DEFAULT_WIDTH,
  CANVAS_NODE_TYPES,
  VOXCPM_ULTIMATE_CLONE_NODE_DEFAULT_HEIGHT,
  VOXCPM_ULTIMATE_CLONE_NODE_DEFAULT_WIDTH,
  type AudioNodeData,
  type VoxCpmUltimateCloneNodeData,
} from '@/features/canvas/domain/canvasNodes';
import { resolveNodeDisplayName } from '@/features/canvas/domain/nodeDisplay';
import { NodeHeader, NODE_HEADER_FLOATING_POSITION_CLASS } from '@/features/canvas/ui/NodeHeader';
import { NodeStatusBadge } from '@/features/canvas/ui/NodeStatusBadge';
import {
  generateVoxCpmUltimateCloneAudio,
  resolveVoxCpmExtensionState,
} from '@/features/extensions/application/voxCpmRuntime';

import {
  clamp,
  collectAudioAssetGroups,
  collectVoicePresetGroups,
  DEFAULT_VOXCPM_CFG_VALUE,
  DEFAULT_VOXCPM_INFERENCE_TIMESTEPS,
  findSelectedAudioAsset,
  formatGeneratedTime,
  PresetDetailCard,
  resolveConnectedReferenceAudio,
  resolveConnectedVoxText,
  resolveReferenceAudioName,
  resolveReferenceAudioPath,
  resolveReferenceSourceLabel,
  resolveRuntimeTone,
  resolveSelectedPresetMetadata,
  resolveVoicePresetHint,
  SliderField,
  SummaryCard,
} from './voxCpmShared';

type VoxCpmUltimateCloneNodeProps = NodeProps & {
  id: string;
  data: VoxCpmUltimateCloneNodeData;
  selected?: boolean;
};

export const VoxCpmUltimateCloneNode = memo(({
  id,
  data,
  selected,
}: VoxCpmUltimateCloneNodeProps) => {
  const { t, i18n } = useTranslation();
  const updateNodeInternals = useUpdateNodeInternals();
  const hydrateAssets = useAssetStore((state) => state.hydrate);
  const assetLibraries = useAssetStore((state) => state.libraries);
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
  const presetPreviewAudioRef = useRef<HTMLAudioElement | null>(null);
  const [isPresetPreviewPlaying, setIsPresetPreviewPlaying] = useState(false);
  const [presetPreviewError, setPresetPreviewError] = useState<string | null>(null);

  useEffect(() => {
    void hydrateAssets();
  }, [hydrateAssets]);

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
  const connectedReferenceAudio = useMemo(
    () => resolveConnectedReferenceAudio(id, nodes, edges),
    [edges, id, nodes]
  );
  const availablePresetGroups = useMemo(
    () => collectVoicePresetGroups(assetLibraries),
    [assetLibraries]
  );
  const availableAudioAssetGroups = useMemo(
    () => collectAudioAssetGroups(assetLibraries),
    [assetLibraries]
  );
  const selectedPresetAsset = useMemo(
    () => findSelectedAudioAsset(assetLibraries, data.presetAssetId),
    [assetLibraries, data.presetAssetId]
  );
  const selectedReferenceAsset = useMemo(
    () => findSelectedAudioAsset(assetLibraries, data.referenceAssetId),
    [assetLibraries, data.referenceAssetId]
  );
  const selectedPresetMetadata = useMemo(
    () => resolveSelectedPresetMetadata(selectedPresetAsset),
    [selectedPresetAsset]
  );
  const connectedTextTrimmed = connectedText.trim();
  const connectedTextPreview = connectedTextTrimmed.length > 0
    ? connectedTextTrimmed
    : t('node.voxCpm.waitingForText');
  const promptText = typeof data.promptText === 'string' ? data.promptText : '';
  const promptTextTrimmed = promptText.trim();
  const presetHint = resolveVoicePresetHint(
    selectedPresetMetadata,
    selectedPresetAsset?.description
  );
  const presetTranscript =
    selectedPresetMetadata?.promptText?.trim()
    || selectedPresetMetadata?.referenceTranscript?.trim()
    || '';
  const referenceAudioPath = resolveReferenceAudioPath(
    selectedPresetAsset,
    selectedReferenceAsset,
    connectedReferenceAudio
  );
  const resolvedPreviewAudioSource = useMemo(
    () => (referenceAudioPath ? resolveAudioDisplayUrl(referenceAudioPath) : null),
    [referenceAudioPath]
  );
  const referenceAudioName = resolveReferenceAudioName(
    selectedPresetAsset,
    selectedReferenceAsset,
    connectedReferenceAudio
  );
  const referenceSourceLabel = resolveReferenceSourceLabel(
    Boolean(selectedPresetAsset),
    Boolean(selectedReferenceAsset),
    Boolean(connectedReferenceAudio),
    {
      preset: t('node.voxCpm.referenceSourcePreset'),
      asset: t('node.voxCpm.referenceSourceAsset'),
      connected: t('node.voxCpm.referenceSourceConnected'),
      missing: t('node.voxCpm.referenceMissing'),
    }
  );
  const useReferenceAsReference = data.useReferenceAsReference !== false;
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
    id,
    promptTextTrimmed,
    referenceAudioName,
    runtimeProgress,
    selected,
    updateNodeInternals,
  ]);

  useEffect(() => {
    const previewAudio = presetPreviewAudioRef.current;
    if (previewAudio) {
      previewAudio.pause();
      previewAudio.currentTime = 0;
    }

    setIsPresetPreviewPlaying(false);
    setPresetPreviewError(null);
  }, [resolvedPreviewAudioSource, referenceAudioPath]);

  useEffect(() => () => {
    presetPreviewAudioRef.current?.pause();
  }, []);

  const handleFieldChange = (field: keyof VoxCpmUltimateCloneNodeData, value: unknown) => {
    updateNodeData(id, { [field]: value }, { historyMode: 'skip' });
  };

  const handleApplyPresetTranscript = () => {
    if (!presetTranscript) {
      return;
    }

    handleFieldChange('promptText', presetTranscript);
  };

  const handleTogglePresetPreview = async () => {
    const previewAudio = presetPreviewAudioRef.current;
    if (!previewAudio || !resolvedPreviewAudioSource) {
      return;
    }

    try {
      setPresetPreviewError(null);
      if (previewAudio.paused) {
        previewAudio.currentTime = 0;
        await previewAudio.play();
      } else {
        previewAudio.pause();
      }
    } catch (error) {
      console.error('Failed to preview Vox preset voice', error);
      setIsPresetPreviewPlaying(false);
      setPresetPreviewError(t('node.audioNode.playFailed'));
    }
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

    if (!referenceAudioPath) {
      updateNodeData(
        id,
        {
          lastError: t('node.voxCpm.referenceMissing'),
          statusText: t('node.voxCpm.referenceMissing'),
        },
        { historyMode: 'skip' }
      );
      return;
    }

    if (!promptTextTrimmed) {
      updateNodeData(
        id,
        {
          lastError: t('node.voxCpm.promptTextRequired'),
          statusText: t('node.voxCpm.promptTextRequired'),
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
        generationSource: 'voxCpmUltimateClone',
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
        voicePresetSource: {
          referenceText: connectedTextTrimmed,
          promptText: connectedTextTrimmed,
          useReferenceAsReference,
          sourceGeneration: 'voxCpmUltimateClone',
        },
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
        generateVoxCpmUltimateCloneAudio(readyExtensionPackage, {
          text: connectedTextTrimmed,
          referenceAudio: referenceAudioPath,
          promptText: promptTextTrimmed,
          useReferenceAsReference,
          cfgValue,
          inferenceTimesteps,
        }),
    });
  };

  return (
    <>
      <audio
        ref={presetPreviewAudioRef}
        src={resolvedPreviewAudioSource ?? undefined}
        preload="metadata"
        className="hidden"
        onPlay={() => setIsPresetPreviewPlaying(true)}
        onPause={() => setIsPresetPreviewPlaying(false)}
        onEnded={() => setIsPresetPreviewPlaying(false)}
        onError={() => {
          setIsPresetPreviewPlaying(false);
          setPresetPreviewError(t('node.audioNode.playFailed'));
        }}
      />

      <div
        className={`
          group relative overflow-visible rounded-[var(--node-radius)] border bg-surface-dark/90 p-3 transition-colors duration-150
          ${selected
            ? 'border-accent shadow-[0_0_0_1px_rgba(59,130,246,0.32)]'
            : 'border-[rgba(15,23,42,0.22)] hover:border-[rgba(15,23,42,0.34)] dark:border-[rgba(255,255,255,0.22)] dark:hover:border-[rgba(255,255,255,0.34)]'}
        `}
        style={{
          width: VOXCPM_ULTIMATE_CLONE_NODE_DEFAULT_WIDTH,
          minHeight: VOXCPM_ULTIMATE_CLONE_NODE_DEFAULT_HEIGHT,
        }}
        onClick={() => setSelectedNode(id)}
      >
        <NodeHeader
          className={NODE_HEADER_FLOATING_POSITION_CLASS}
          icon={<LibraryBig className="h-4 w-4" />}
          titleText={resolveNodeDisplayName(CANVAS_NODE_TYPES.voxCpmUltimateClone, data)}
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

        <div className="rounded-xl border border-white/10 bg-black/10 px-3 py-3">
          <div className="mb-3">
            <div className="mb-1 text-xs font-medium text-text-muted">
              {t('node.voxCpm.presetVoice')}
            </div>
            <UiSelect
              value={selectedPresetAsset?.id ?? ''}
              onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                handleFieldChange('presetAssetId', event.target.value || null)}
              className="!h-10 !rounded-xl !border-white/10 !bg-black/10 !px-3 !text-sm"
            >
              <option value="">{t('node.voxCpm.presetAssetPlaceholder')}</option>
              {availablePresetGroups.map((library) => (
                <optgroup key={library.id} label={library.name}>
                  {library.items.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </UiSelect>
            <div className="mt-2 text-[11px] leading-4 text-text-muted">
              {t('node.voxCpm.presetHint')}
            </div>
          </div>

          <div className="mb-2 flex items-start justify-between gap-3">
            <div>
              <div className="text-xs font-medium text-text-muted">{t('node.voxCpm.referenceAudio')}</div>
              <div className="mt-1 text-[11px] leading-4 text-text-muted">
                {t('node.voxCpm.ultimateReferenceHint')}
              </div>
            </div>
            <div className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] text-text-muted">
              {referenceSourceLabel}
            </div>
          </div>

          <UiSelect
            value={selectedReferenceAsset?.id ?? ''}
            onChange={(event: ChangeEvent<HTMLSelectElement>) =>
              handleFieldChange('referenceAssetId', event.target.value || null)}
            className="!h-10 !rounded-xl !border-white/10 !bg-black/10 !px-3 !text-sm"
          >
            <option value="">{t('node.voxCpm.referenceAssetPlaceholder')}</option>
            {availableAudioAssetGroups.map((library) => (
              <optgroup key={library.id} label={library.name}>
                {library.items.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </UiSelect>

          <div className="mt-3 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-sm text-text-dark">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="text-xs font-medium text-text-muted">{t('node.voxCpm.referenceResolved')}</div>
                <div className="mt-1 truncate">
                  {referenceAudioName || t('node.voxCpm.referenceMissing')}
                </div>
              </div>
              <UiButton
                type="button"
                variant="ghost"
                size="sm"
                className="shrink-0 gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-3 text-xs hover:border-white/20 hover:bg-white/[0.06]"
                onClick={() => void handleTogglePresetPreview()}
                disabled={!resolvedPreviewAudioSource}
              >
                {isPresetPreviewPlaying ? (
                  <Pause className="h-3.5 w-3.5" />
                ) : (
                  <Play className="h-3.5 w-3.5" />
                )}
                {isPresetPreviewPlaying
                  ? t('node.voxCpm.stopPreview')
                  : selectedPresetAsset
                    ? t('node.voxCpm.previewPreset')
                    : t('node.voxCpm.previewReference')}
              </UiButton>
            </div>
          </div>

          {presetPreviewError ? (
            <div className="mt-3 rounded-xl border border-red-400/25 bg-red-400/10 px-3 py-2 text-xs text-red-200">
              {presetPreviewError}
            </div>
          ) : null}

          {selectedPresetAsset ? (
            <div className="mt-3 space-y-2">
              <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5">
                <div className="text-xs font-medium text-text-muted">
                  {t('node.voxCpm.presetVoice')}
                </div>
                <div className="mt-1 truncate text-sm font-medium text-text-dark">
                  {selectedPresetAsset.name}
                </div>
                <div className="mt-1 text-[11px] text-text-muted">
                  {t('node.voxCpm.presetPreviewHint')}
                </div>
              </div>
              {presetHint ? (
                <PresetDetailCard
                  title={t('node.voxCpm.presetDescriptionTitle')}
                  value={presetHint}
                />
              ) : null}
              <PresetDetailCard
                title={t('node.voxCpm.presetTranscriptTitle')}
                value={presetTranscript || t('node.voxCpm.presetTranscriptEmpty')}
                actionLabel={presetTranscript ? t('node.voxCpm.applyPresetTranscript') : undefined}
                onAction={presetTranscript ? handleApplyPresetTranscript : undefined}
              />
            </div>
          ) : null}
        </div>

        <label className="block rounded-xl border border-white/10 bg-black/10 px-3 py-2.5">
          <div className="mb-2 text-xs font-medium text-text-muted">
            {t('node.voxCpm.promptText')}
          </div>
          <textarea
            value={promptText}
            onChange={(event) => handleFieldChange('promptText', event.target.value)}
            placeholder={t('node.voxCpm.promptTextPlaceholder')}
            className="nodrag nowheel min-h-[96px] w-full resize-y rounded-lg border border-white/10 bg-black/10 px-3 py-2 text-sm text-text-dark outline-none transition-colors placeholder:text-text-muted/70 focus:border-accent"
          />
          <div className="mt-2 text-[11px] leading-4 text-text-muted">
            {t('node.voxCpm.promptTextHint')}
          </div>
        </label>

        <label className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/10 px-3 py-2.5 text-sm text-text-dark">
          <input
            type="checkbox"
            checked={useReferenceAsReference}
            onChange={(event) => handleFieldChange('useReferenceAsReference', event.target.checked)}
            className="nodrag h-4 w-4 rounded border-white/20 bg-black/10 text-accent"
          />
          <span>{t('node.voxCpm.useReferenceAsReference')}</span>
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
          {t('node.voxCpm.ultimateCloneGenerate')}
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
    </>
  );
});

VoxCpmUltimateCloneNode.displayName = 'VoxCpmUltimateCloneNode';
