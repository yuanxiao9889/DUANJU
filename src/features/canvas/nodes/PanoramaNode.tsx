import { memo, useCallback, useEffect, useMemo } from 'react';
import { Handle, Position, useUpdateNodeInternals, type NodeProps } from '@xyflow/react';
import { Globe2, Loader2, Sparkles, TriangleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import {
  CANVAS_NODE_TYPES,
  PANORAMA_NODE_DEFAULT_HEIGHT,
  PANORAMA_NODE_DEFAULT_WIDTH,
  PANORAMA_RESULT_NODE_DEFAULT_HEIGHT,
  PANORAMA_RESULT_NODE_DEFAULT_WIDTH,
  PANORAMA_OUTPUT_RESOLUTIONS,
  PANORAMA_SCENE_CLASSES,
  type PanoramaNodeData,
  type PanoramaOutputResolution,
  type PanoramaResultNodeData,
  type PanoramaSceneClass,
} from '@/features/canvas/domain/canvasNodes';
import { resolveNodeDisplayName } from '@/features/canvas/domain/nodeDisplay';
import { useCanvasConnectedReferenceImages } from '@/features/canvas/hooks/useCanvasNodeGraph';
import { CanvasNodeImage } from '@/features/canvas/ui/CanvasNodeImage';
import { NodeHeader, NODE_HEADER_FLOATING_POSITION_CLASS } from '@/features/canvas/ui/NodeHeader';
import { NodeStatusBadge } from '@/features/canvas/ui/NodeStatusBadge';
import { flushCurrentProjectToDiskSafely } from '@/features/canvas/application/projectPersistence';
import {
  resolveErrorContent,
  showErrorDialog,
} from '@/features/canvas/application/errorDialog';
import {
  generatePanoramaImage,
  resolvePanoramaExtensionState,
} from '@/features/extensions/application/panoramaRuntime';
import { UiButton, UiCheckbox, UiSelect, UiTextAreaField } from '@/components/ui';
import { useCanvasStore } from '@/stores/canvasStore';
import { useExtensionsStore } from '@/stores/extensionsStore';

type PanoramaNodeProps = NodeProps & {
  id: string;
  data: PanoramaNodeData;
  selected?: boolean;
};

const RESOLUTION_OPTIONS = PANORAMA_OUTPUT_RESOLUTIONS;
const SCENE_CLASS_OPTIONS = PANORAMA_SCENE_CLASSES;

export const PanoramaNode = memo(({
  id,
  data,
  selected,
}: PanoramaNodeProps) => {
  const { t, i18n } = useTranslation();
  const updateNodeInternals = useUpdateNodeInternals();
  const setSelectedNode = useCanvasStore((state) => state.setSelectedNode);
  const addNode = useCanvasStore((state) => state.addNode);
  const addEdge = useCanvasStore((state) => state.addEdge);
  const findNodePosition = useCanvasStore((state) => state.findNodePosition);
  const updateNodeData = useCanvasStore((state) => state.updateNodeData);
  const connectedReferenceImages = useCanvasConnectedReferenceImages(id);
  const extensionPackages = useExtensionsStore((state) => state.packages);
  const enabledExtensionIds = useExtensionsStore((state) => state.enabledExtensionIds);
  const runtimeById = useExtensionsStore((state) => state.runtimeById);

  const extensionState = useMemo(
    () => resolvePanoramaExtensionState(extensionPackages, enabledExtensionIds, runtimeById),
    [enabledExtensionIds, extensionPackages, runtimeById]
  );
  const readyExtensionPackage = extensionState.readyPackage;
  const activeExtensionPackage = readyExtensionPackage ?? extensionState.pendingPackage;
  const extensionRuntime = extensionState.runtime;
  const isExtensionReady = Boolean(readyExtensionPackage);
  const isExtensionStarting = extensionRuntime?.status === 'starting';
  const isExtensionErrored = extensionRuntime?.status === 'error';
  const extensionRuntimeError = extensionRuntime?.error?.trim() || null;
  const prompt = typeof data.prompt === 'string' ? data.prompt : '';
  const sceneClass = SCENE_CLASS_OPTIONS.includes(data.sceneClass ?? 'auto')
    ? (data.sceneClass ?? 'auto')
    : 'auto';
  const outputResolution = RESOLUTION_OPTIONS.includes(data.outputResolution ?? '4096x2048')
    ? (data.outputResolution ?? '4096x2048')
    : '4096x2048';
  const runtimeProgress = extensionRuntime?.progress ?? 0;
  const currentRuntimeStep = activeExtensionPackage?.startupSteps.find(
    (step) => step.id === extensionRuntime?.currentStepId
  ) ?? null;
  const primaryReference = connectedReferenceImages[0] ?? null;
  const referenceCount = connectedReferenceImages.length;
  const lastGeneratedTime = useMemo(() => {
    if (
      typeof data.lastGeneratedAt !== 'number'
      || !Number.isFinite(data.lastGeneratedAt)
      || data.lastGeneratedAt <= 0
    ) {
      return null;
    }

    return new Intl.DateTimeFormat(i18n.language, {
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(data.lastGeneratedAt));
  }, [data.lastGeneratedAt, i18n.language]);

  useEffect(() => {
    updateNodeInternals(id);
  }, [
    currentRuntimeStep?.id,
    id,
    referenceCount,
    runtimeProgress,
    selected,
    updateNodeInternals,
  ]);

  const setField = useCallback((patch: Partial<PanoramaNodeData>) => {
    updateNodeData(id, patch, { historyMode: 'skip' });
  }, [id, updateNodeData]);

  const handleGenerate = useCallback(async () => {
    if (!isExtensionReady || !readyExtensionPackage) {
      setField({
        lastError: isExtensionStarting
          ? t('node.panorama.extensionStarting')
          : extensionRuntimeError ?? t('node.panorama.extensionDisabled'),
      });
      return;
    }

    if (!primaryReference?.imageUrl) {
      const message = t('node.panorama.referenceRequired');
      setField({ lastError: message });
      await showErrorDialog(message, t('common.error'));
      return;
    }

    const promptText = prompt.trim();
    const startedAt = Date.now();
    let createdResultNodeId: string | null = null;

    setField({
      isGenerating: true,
      generationStartedAt: startedAt,
      lastError: null,
    });

    try {
      const resultNodePosition = findNodePosition(
        id,
        PANORAMA_RESULT_NODE_DEFAULT_WIDTH,
        PANORAMA_RESULT_NODE_DEFAULT_HEIGHT
      );
      createdResultNodeId = addNode(
        CANVAS_NODE_TYPES.panoramaResult,
        resultNodePosition,
        {
          sourceNodeId: id,
          sourceImageUrl: primaryReference.imageUrl,
          displayName: t('node.panorama.resultNodeTitle'),
          imageUrl: null,
          previewImageUrl: null,
          aspectRatio: '2:1',
          prompt: promptText,
          sceneClass,
          outputResolution,
          projection: 'equirectangular',
          perspectiveYaw: 0,
          perspectivePitch: 0,
          perspectiveFov: 90,
          perspectiveWidth: 1280,
          perspectiveHeight: 720,
          isGenerating: true,
          generationStartedAt: startedAt,
          generationDurationMs: 240000,
          lastGeneratedAt: null,
          lastError: null,
        } satisfies Partial<PanoramaResultNodeData>,
        {
          inheritParentFromNodeId: id,
        }
      );
      addEdge(id, createdResultNodeId);
      await flushCurrentProjectToDiskSafely('creating panorama result node');

      const generated = await generatePanoramaImage(readyExtensionPackage, {
        imagePath: primaryReference.imageUrl,
        prompt: promptText,
        outputResolution,
        sceneClass,
        useCache: data.useCache !== false,
        useFp8Attention: data.useFp8Attention !== false,
        useFp8Gemm: data.useFp8Gemm !== false,
      });
      const completedAt = Date.now();

      setField({
        isGenerating: false,
        generationStartedAt: null,
        lastGeneratedAt: completedAt,
        lastError: null,
      });

      if (createdResultNodeId) {
        updateNodeData(createdResultNodeId, {
          imageUrl: generated.imageUrl,
          previewImageUrl: generated.previewImageUrl,
          aspectRatio: generated.aspectRatio || '2:1',
          isGenerating: false,
          generationStartedAt: null,
          lastGeneratedAt: completedAt,
          lastError: null,
        });
      }

      await flushCurrentProjectToDiskSafely('saving panorama generation result');
    } catch (error) {
      const content = resolveErrorContent(error, t('node.panorama.generateFailed'));
      setField({
        isGenerating: false,
        generationStartedAt: null,
        lastError: content.message,
      });
      if (createdResultNodeId) {
        updateNodeData(createdResultNodeId, {
          isGenerating: false,
          generationStartedAt: null,
          lastError: content.message,
        });
      }
      await flushCurrentProjectToDiskSafely('saving panorama generation error');
      await showErrorDialog(content.message, t('common.error'), content.details);
    }
  }, [
    addEdge,
    addNode,
    data.useCache,
    data.useFp8Attention,
    data.useFp8Gemm,
    extensionRuntimeError,
    findNodePosition,
    id,
    isExtensionReady,
    isExtensionStarting,
    outputResolution,
    primaryReference,
    prompt,
    readyExtensionPackage,
    sceneClass,
    setField,
    t,
    updateNodeData,
  ]);

  return (
    <div
      className={`
        group relative overflow-visible rounded-[var(--node-radius)] border bg-surface-dark/90 p-3 transition-colors duration-150
        ${selected
          ? 'border-accent shadow-[0_0_0_1px_rgba(59,130,246,0.32)]'
          : 'border-[rgba(15,23,42,0.22)] hover:border-[rgba(15,23,42,0.34)] dark:border-[rgba(255,255,255,0.22)] dark:hover:border-[rgba(255,255,255,0.34)]'}
      `}
      style={{
        width: PANORAMA_NODE_DEFAULT_WIDTH,
        minHeight: PANORAMA_NODE_DEFAULT_HEIGHT,
      }}
      onClick={() => setSelectedNode(id)}
    >
      <NodeHeader
        className={NODE_HEADER_FLOATING_POSITION_CLASS}
        icon={<Globe2 className="h-4 w-4" />}
        titleText={resolveNodeDisplayName(CANVAS_NODE_TYPES.panorama, data)}
        editable
        onTitleChange={(nextTitle) => updateNodeData(id, { displayName: nextTitle })}
        rightSlot={(
          data.lastError ? (
            <NodeStatusBadge
              icon={<TriangleAlert className="h-3.5 w-3.5" />}
              label={t('node.panorama.errorShort')}
              tone="danger"
              title={data.lastError}
            />
          ) : data.isGenerating ? (
            <NodeStatusBadge
              icon={<Loader2 className="h-3.5 w-3.5 animate-spin" />}
              label={t('node.panorama.generatingShort')}
              tone="processing"
            />
          ) : lastGeneratedTime ? (
            <NodeStatusBadge
              icon={<Sparkles className="h-3.5 w-3.5" />}
              label={t('node.panorama.readyShort')}
              tone="processing"
              title={t('node.panorama.generatedAt', { time: lastGeneratedTime })}
            />
          ) : null
        )}
      />

      <div className="space-y-3">
        <div className={`rounded-xl border px-3 py-2.5 ${
          isExtensionReady
            ? 'border-emerald-400/25 bg-emerald-400/10 text-emerald-50'
            : isExtensionStarting
              ? 'border-amber-400/25 bg-amber-400/10 text-amber-50'
              : isExtensionErrored
                ? 'border-red-400/25 bg-red-400/10 text-red-100'
                : 'border-white/10 bg-black/20 text-white/70'
        }`}>
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-xs font-medium text-current">{t('node.panorama.runtimeTitle')}</div>
              <div className="mt-1 text-[11px] leading-4 text-current/80">
                {isExtensionReady
                  ? t('node.panorama.runtimeReady')
                  : isExtensionStarting
                    ? currentRuntimeStep?.description ?? t('node.panorama.extensionStarting')
                    : extensionRuntimeError ?? t('node.panorama.runtimeDisabled')}
              </div>
            </div>
            {isExtensionStarting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : isExtensionErrored ? (
              <TriangleAlert className="h-4 w-4" />
            ) : null}
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

        <div className="rounded-xl border border-white/10 bg-black/20 p-3">
          <div className="mb-2 flex items-center justify-between gap-3">
            <div>
              <div className="text-xs font-medium text-white">{t('node.panorama.referenceTitle')}</div>
              <div className="mt-1 text-[11px] leading-4 text-white/60">
                {referenceCount > 0
                  ? t('node.panorama.referenceCount', { count: referenceCount })
                  : t('node.panorama.referenceHint')}
              </div>
            </div>
          </div>
          {primaryReference ? (
            <div className="flex items-center gap-3">
              <CanvasNodeImage
                src={primaryReference.imageUrl}
                viewerSourceUrl={primaryReference.imageUrl}
                className="h-16 w-24 rounded-md border border-white/10 object-cover"
                alt={t('node.panorama.referencePreviewAlt')}
                draggable={false}
              />
              <div className="text-[11px] leading-5 text-white/70">
                {referenceCount > 1
                  ? t('node.panorama.referenceFirstOnly')
                  : t('node.panorama.referenceSingle')}
              </div>
            </div>
          ) : null}
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-white/80">
            {t('node.panorama.prompt')}
          </label>
          <UiTextAreaField
            value={prompt}
            rows={5}
            placeholder={t('node.panorama.promptPlaceholder')}
            onChange={(event) => setField({ prompt: event.currentTarget.value })}
          />
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-white/80">
              {t('node.panorama.sceneClass')}
            </label>
            <UiSelect
              value={sceneClass}
              onChange={(event) => setField({
                sceneClass: event.currentTarget.value as PanoramaSceneClass,
              })}
            >
              {SCENE_CLASS_OPTIONS.map((item) => (
                <option key={item} value={item}>
                  {t(`node.panorama.sceneClassOptions.${item}`)}
                </option>
              ))}
            </UiSelect>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-white/80">
              {t('node.panorama.outputResolution')}
            </label>
            <UiSelect
              value={outputResolution}
              onChange={(event) => setField({
                outputResolution: event.currentTarget.value as PanoramaOutputResolution,
              })}
            >
              {RESOLUTION_OPTIONS.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </UiSelect>
          </div>
        </div>

        <div className="grid gap-2 text-xs text-white/80 md:grid-cols-3">
          <label className="flex items-center gap-2 rounded-lg border border-white/10 bg-black/15 px-3 py-2">
            <UiCheckbox
              checked={data.useCache !== false}
              onCheckedChange={(checked) => setField({ useCache: checked })}
            />
            <span>{t('node.panorama.useCache')}</span>
          </label>
          <label className="flex items-center gap-2 rounded-lg border border-white/10 bg-black/15 px-3 py-2">
            <UiCheckbox
              checked={data.useFp8Attention !== false}
              onCheckedChange={(checked) => setField({ useFp8Attention: checked })}
            />
            <span>{t('node.panorama.useFp8Attention')}</span>
          </label>
          <label className="flex items-center gap-2 rounded-lg border border-white/10 bg-black/15 px-3 py-2">
            <UiCheckbox
              checked={data.useFp8Gemm !== false}
              onCheckedChange={(checked) => setField({ useFp8Gemm: checked })}
            />
            <span>{t('node.panorama.useFp8Gemm')}</span>
          </label>
        </div>

        {data.lastError ? (
          <div className="rounded-xl border border-red-400/25 bg-red-400/10 px-3 py-2 text-[11px] leading-4 text-red-100">
            {data.lastError}
          </div>
        ) : null}

        <UiButton
          type="button"
          onClick={() => {
            void handleGenerate();
          }}
          className="nodrag h-10 w-full rounded-lg"
          disabled={data.isGenerating}
        >
          {data.isGenerating ? t('node.panorama.generating') : t('node.panorama.generate')}
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

PanoramaNode.displayName = 'PanoramaNode';
