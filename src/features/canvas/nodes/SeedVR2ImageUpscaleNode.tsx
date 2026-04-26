import { memo, useEffect, useMemo } from 'react';
import { Handle, Position, useUpdateNodeInternals, type NodeProps } from '@xyflow/react';
import { Image as ImageIcon, Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { UiButton, UiLoadingAnimation } from '@/components/ui';
import { persistImageLocally, resolveImageDisplayUrl } from '@/features/canvas/application/imageData';
import {
  CANVAS_NODE_TYPES,
  SEEDVR2_IMAGE_TARGET_RESOLUTIONS,
  SEEDVR2_IMAGE_UPSCALE_NODE_DEFAULT_HEIGHT,
  SEEDVR2_IMAGE_UPSCALE_NODE_DEFAULT_WIDTH,
  type Seedvr2ImageTargetResolution,
  resolveSingleImageConnectionSource,
  type Seedvr2ImageUpscaleNodeData,
} from '@/features/canvas/domain/canvasNodes';
import { resolveNodeDisplayName } from '@/features/canvas/domain/nodeDisplay';
import { useCanvasIncomingSourceNodes } from '@/features/canvas/hooks/useCanvasNodeGraph';
import { NodeHeader, NODE_HEADER_FLOATING_POSITION_CLASS } from '@/features/canvas/ui/NodeHeader';
import { NodeStatusBadge } from '@/features/canvas/ui/NodeStatusBadge';
import {
  resolveSeedvr2ExtensionState,
  upscaleImageWithSeedvr2,
} from '@/features/extensions/application/seedvr2Runtime';
import { useCanvasStore } from '@/stores/canvasStore';
import { useExtensionsStore } from '@/stores/extensionsStore';

import { formatGeneratedTime, resolveRuntimeTone } from './voxCpmShared';

const ACTIVE_SEEDVR2_IMAGE_JOBS = new Set<string>();

type SeedVR2ImageUpscaleNodeProps = NodeProps & {
  id: string;
  data: Seedvr2ImageUpscaleNodeData;
  selected?: boolean;
};

type ImageInputState =
  | {
      kind: 'empty' | 'multiple' | 'unsupported';
      message: string;
      previewName: string;
      previewImageUrl: string | null;
    }
  | {
      kind: 'ready';
      message: string;
      previewName: string;
      previewImageUrl: string;
      imageUrl: string;
      aspectRatio: string;
    };

function resolveErrorMessage(error: unknown, fallbackMessage: string): string {
  if (error instanceof Error) {
    const message = error.message.trim();
    if (message) {
      return message;
    }
  }

  if (typeof error === 'string') {
    const message = error.trim();
    if (message) {
      return message;
    }
  }

  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>;
    const candidate = [
      record.message,
      record.error,
      record.details,
      record.msg,
    ].find((value) => typeof value === 'string' && value.trim().length > 0);
    if (typeof candidate === 'string') {
      return candidate.trim();
    }
  }

  return fallbackMessage;
}

function localizeSeedvr2ImageError(errorMessage: string, t: ReturnType<typeof useTranslation>['t']): string {
  const normalized = errorMessage.toLowerCase();
  if (normalized.includes('model files are missing')) {
    return t('node.seedvr2ImageUpscale.modelMissing');
  }
  if (normalized.includes('gpu memory is insufficient') || normalized.includes('out of memory')) {
    return t('node.seedvr2ImageUpscale.insufficientMemory');
  }
  if (
    normalized.includes('cuda-capable nvidia gpu')
    || normalized.includes('requires a cuda-capable')
  ) {
    return t('node.seedvr2ImageUpscale.gpuRequired');
  }

  return errorMessage;
}

export const SeedVR2ImageUpscaleNode = memo(({
  id,
  data,
  selected,
}: SeedVR2ImageUpscaleNodeProps) => {
  const { t, i18n } = useTranslation();
  const updateNodeInternals = useUpdateNodeInternals();
  const setSelectedNode = useCanvasStore((state) => state.setSelectedNode);
  const updateNodeData = useCanvasStore((state) => state.updateNodeData);
  const addDerivedExportNode = useCanvasStore((state) => state.addDerivedExportNode);
  const incomingSourceNodes = useCanvasIncomingSourceNodes(id);
  const extensionPackages = useExtensionsStore((state) => state.packages);
  const enabledExtensionIds = useExtensionsStore((state) => state.enabledExtensionIds);
  const runtimeById = useExtensionsStore((state) => state.runtimeById);
  const isUpscaling = data.isProcessing === true;

  const extensionState = useMemo(
    () => resolveSeedvr2ExtensionState(extensionPackages, enabledExtensionIds, runtimeById),
    [enabledExtensionIds, extensionPackages, runtimeById]
  );
  const readyExtensionPackage = extensionState.readyPackage;
  const activeExtensionPackage = readyExtensionPackage ?? extensionState.pendingPackage;
  const extensionRuntime = extensionState.runtime;
  const isExtensionReady = Boolean(readyExtensionPackage);
  const isExtensionStarting = extensionRuntime?.status === 'starting';
  const runtimeTone = resolveRuntimeTone(isExtensionReady, isExtensionStarting);
  const runtimeProgress = extensionRuntime?.progress ?? 0;
  const currentRuntimeStep = activeExtensionPackage?.startupSteps.find(
    (step) => step.id === extensionRuntime?.currentStepId
  ) ?? null;
  const targetResolution = SEEDVR2_IMAGE_TARGET_RESOLUTIONS.includes(
    data.targetResolution as Seedvr2ImageTargetResolution
  )
    ? data.targetResolution
    : SEEDVR2_IMAGE_TARGET_RESOLUTIONS[1];

  const inputState = useMemo<ImageInputState>(() => {
    if (incomingSourceNodes.length === 0) {
      return {
        kind: 'empty',
        message: t('node.seedvr2ImageUpscale.noInputImage'),
        previewName: t('node.seedvr2ImageUpscale.waitingForInput'),
        previewImageUrl: null,
      };
    }

    if (incomingSourceNodes.length > 1) {
      return {
        kind: 'multiple',
        message: t('node.seedvr2ImageUpscale.multipleInputImages'),
        previewName: t('node.seedvr2ImageUpscale.multipleInputTitle'),
        previewImageUrl: null,
      };
    }

    const sourceNode = incomingSourceNodes[0]?.node;
    const source = resolveSingleImageConnectionSource(sourceNode);
    const previewName = sourceNode
      ? resolveNodeDisplayName(sourceNode.type, sourceNode.data)
      : t('node.seedvr2ImageUpscale.waitingForInput');

    if (!source) {
      return {
        kind: 'unsupported',
        message: t('node.seedvr2ImageUpscale.unsupportedInput'),
        previewName,
        previewImageUrl: null,
      };
    }

    return {
      kind: 'ready',
      message: t('node.seedvr2ImageUpscale.inputReady'),
      previewName,
      previewImageUrl: source.previewImageUrl,
      imageUrl: source.imageUrl,
      aspectRatio: source.aspectRatio,
    };
  }, [incomingSourceNodes, t]);

  const runtimeMessage = useMemo(() => {
    if (isExtensionReady) {
      return t('node.seedvr2ImageUpscale.runtimeReady');
    }

    if (isExtensionStarting) {
      return currentRuntimeStep?.description ?? t('node.seedvr2ImageUpscale.extensionStarting');
    }

    if (extensionRuntime?.status === 'error') {
      return extensionRuntime.error?.trim() || t('node.seedvr2ImageUpscale.runtimeErrored');
    }

    return t('node.seedvr2ImageUpscale.runtimeDisabled');
  }, [currentRuntimeStep?.description, extensionRuntime?.error, extensionRuntime?.status, isExtensionReady, isExtensionStarting, t]);

  const helperMessage = useMemo(() => {
    if (isUpscaling) {
      return t('node.seedvr2ImageUpscale.processing');
    }

    if (!isExtensionReady) {
      if (extensionRuntime?.status === 'error') {
        return extensionRuntime.error?.trim() || t('node.seedvr2ImageUpscale.runtimeErrored');
      }

      return isExtensionStarting
        ? t('node.seedvr2ImageUpscale.extensionStarting')
        : t('node.seedvr2ImageUpscale.extensionDisabled');
    }

    return inputState.message;
  }, [extensionRuntime?.error, extensionRuntime?.status, inputState.message, isExtensionReady, isExtensionStarting, isUpscaling, t]);

  const canExecute = isExtensionReady && inputState.kind === 'ready' && !isUpscaling;

  useEffect(() => {
    if (!data.isProcessing || ACTIVE_SEEDVR2_IMAGE_JOBS.has(id)) {
      return;
    }

    updateNodeData(
      id,
      {
        isProcessing: false,
      },
      { historyMode: 'skip' }
    );
  }, [data.isProcessing, id, updateNodeData]);

  useEffect(() => {
    updateNodeInternals(id);
  }, [
    data.lastError,
    data.lastGeneratedAt,
    data.targetResolution,
    helperMessage,
    id,
    inputState.kind,
    inputState.previewName,
    runtimeProgress,
    selected,
    updateNodeInternals,
  ]);

  const handleResolutionChange = (value: string) => {
    const nextResolution = Number.parseInt(value, 10);
    if (!SEEDVR2_IMAGE_TARGET_RESOLUTIONS.includes(nextResolution as Seedvr2ImageTargetResolution)) {
      return;
    }

    updateNodeData(id, { targetResolution: nextResolution as Seedvr2ImageTargetResolution });
  };

  const handleExecute = async () => {
    setSelectedNode(id);

    if (!readyExtensionPackage || !isExtensionReady) {
      updateNodeData(
        id,
        {
          lastError:
            extensionRuntime?.status === 'error'
              ? extensionRuntime.error?.trim() || t('node.seedvr2ImageUpscale.runtimeErrored')
              : t('node.seedvr2ImageUpscale.extensionDisabled'),
          statusText: helperMessage,
        },
        { historyMode: 'skip' }
      );
      return;
    }

    if (inputState.kind !== 'ready') {
      updateNodeData(
        id,
        {
          lastError: inputState.message,
          statusText: inputState.message,
        },
        { historyMode: 'skip' }
      );
      return;
    }

    ACTIVE_SEEDVR2_IMAGE_JOBS.add(id);
    updateNodeData(
      id,
      {
        isProcessing: true,
        lastError: null,
        statusText: t('node.seedvr2ImageUpscale.persistingInput'),
      },
      { historyMode: 'skip' }
    );

    try {
      const localImagePath = await persistImageLocally(inputState.imageUrl);

      updateNodeData(
        id,
        {
          statusText: t('node.seedvr2ImageUpscale.processing'),
        },
        { historyMode: 'skip' }
      );

      const preparedImage = await upscaleImageWithSeedvr2(readyExtensionPackage, {
        imagePath: localImagePath,
        targetResolution,
        outputPrefix: `seedvr2-image-${Date.now()}`,
      });

      const resultNodeId = addDerivedExportNode(
        id,
        preparedImage.imageUrl,
        preparedImage.aspectRatio,
        preparedImage.previewImageUrl,
        {
          connectToSource: true,
          defaultTitle: t('node.seedvr2ImageUpscale.resultTitle'),
        }
      );

      if (!resultNodeId) {
        throw new Error(t('node.seedvr2ImageUpscale.resultNodeCreateFailed'));
      }

      updateNodeData(
        id,
        {
          isProcessing: false,
          lastError: null,
          statusText: t('node.seedvr2ImageUpscale.completed'),
          lastGeneratedAt: Date.now(),
        },
        { historyMode: 'skip' }
      );
    } catch (error) {
      const errorMessage = localizeSeedvr2ImageError(
        resolveErrorMessage(error, t('node.seedvr2ImageUpscale.processFailed')),
        t
      );
      updateNodeData(
        id,
        {
          isProcessing: false,
          lastError: errorMessage,
          statusText: errorMessage,
        },
        { historyMode: 'skip' }
      );
    } finally {
      ACTIVE_SEEDVR2_IMAGE_JOBS.delete(id);
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
        width: SEEDVR2_IMAGE_UPSCALE_NODE_DEFAULT_WIDTH,
        minHeight: SEEDVR2_IMAGE_UPSCALE_NODE_DEFAULT_HEIGHT,
      }}
      onClick={() => setSelectedNode(id)}
    >
      <NodeHeader
        className={NODE_HEADER_FLOATING_POSITION_CLASS}
        icon={<Sparkles className="h-4 w-4" />}
        titleText={resolveNodeDisplayName(CANVAS_NODE_TYPES.seedvr2ImageUpscale, data)}
        editable
        onTitleChange={(nextTitle) => updateNodeData(id, { displayName: nextTitle })}
        rightSlot={(
          isUpscaling ? (
            <NodeStatusBadge
              label={t('node.seedvr2ImageUpscale.processingShort')}
              tone="warning"
              animate
            />
          ) : data.lastError ? (
            <NodeStatusBadge
              icon={<Sparkles className="h-3.5 w-3.5" />}
              label={t('node.seedvr2ImageUpscale.errorShort')}
              tone="danger"
              title={data.lastError}
            />
          ) : data.lastGeneratedAt ? (
            <NodeStatusBadge
              icon={<Sparkles className="h-3.5 w-3.5" />}
              label={t('node.seedvr2ImageUpscale.readyShort')}
              tone="processing"
              title={t('node.seedvr2ImageUpscale.generatedAt', {
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
              <div className="text-xs font-medium text-current">
                {t('node.seedvr2ImageUpscale.runtimeTitle')}
              </div>
              <div className="mt-1 text-[11px] leading-4 text-current/80">
                {runtimeMessage}
              </div>
            </div>
            {isExtensionStarting ? <UiLoadingAnimation size="sm" /> : null}
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

        <div className="rounded-xl border border-amber-400/25 bg-amber-400/10 px-3 py-2.5 text-[11px] leading-4 text-amber-100">
          {t('node.seedvr2ImageUpscale.hardwareNotice')}
        </div>

        <div className="rounded-xl border border-white/10 bg-black/10 px-3 py-3">
          <div className="mb-2 flex items-center gap-2 text-xs font-medium text-text-muted">
            <ImageIcon className="h-4 w-4" />
            <span>{t('node.seedvr2ImageUpscale.upstreamImage')}</span>
          </div>

          <div className="flex items-start gap-3">
            {inputState.previewImageUrl ? (
              <img
                src={resolveImageDisplayUrl(inputState.previewImageUrl)}
                alt={t('node.seedvr2ImageUpscale.sourcePreviewAlt')}
                className="h-20 w-20 rounded-xl border border-white/10 object-cover"
                draggable={false}
              />
            ) : (
              <div className="flex h-20 w-20 items-center justify-center rounded-xl border border-dashed border-white/10 bg-white/[0.03] text-text-muted">
                <ImageIcon className="h-5 w-5" />
              </div>
            )}

            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-text-dark">
                {inputState.previewName}
              </div>
              <div className="mt-1 text-[11px] leading-4 text-text-muted">
                {inputState.message}
              </div>
              {inputState.kind === 'ready' ? (
                <div className="mt-2 text-[11px] leading-4 text-text-muted">
                  {t('node.seedvr2ImageUpscale.sourceAspectRatio', {
                    aspectRatio: inputState.aspectRatio,
                  })}
                </div>
              ) : null}
            </div>
          </div>
        </div>

        <label className="block rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5">
          <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-text-muted">
            {t('node.seedvr2ImageUpscale.targetResolution')}
          </div>
          <select
            value={String(targetResolution)}
            onChange={(event) => handleResolutionChange(event.target.value)}
            disabled={isUpscaling}
            className="nodrag mt-2 h-10 w-full rounded-lg border border-white/10 bg-bg-dark px-3 text-sm text-text-dark outline-none transition-colors focus:border-accent"
          >
            {SEEDVR2_IMAGE_TARGET_RESOLUTIONS.map((resolution) => (
              <option key={resolution} value={resolution}>
                {t('node.seedvr2ImageUpscale.targetResolutionOption', { value: resolution })}
              </option>
            ))}
          </select>
        </label>

        {data.lastError ? (
          <div className="rounded-xl border border-red-400/25 bg-red-400/10 px-3 py-2 text-[11px] leading-4 text-red-100">
            {data.lastError}
          </div>
        ) : data.statusText ? (
          <div className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-[11px] leading-4 text-text-muted">
            {data.statusText}
          </div>
        ) : null}

        <UiButton
          type="button"
          onClick={() => {
            void handleExecute();
          }}
          disabled={!canExecute}
          className="nodrag h-10 w-full rounded-lg"
        >
          <span className="inline-flex items-center gap-2">
            {isUpscaling ? <UiLoadingAnimation size="sm" /> : <Sparkles className="h-4 w-4" />}
            <span>
              {isUpscaling
                ? t('node.seedvr2ImageUpscale.executing')
                : t('node.seedvr2ImageUpscale.execute')}
            </span>
          </span>
        </UiButton>

        {!canExecute ? (
          <div className="text-[11px] leading-4 text-text-muted">
            {helperMessage}
          </div>
        ) : null}
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

SeedVR2ImageUpscaleNode.displayName = 'SeedVR2ImageUpscaleNode';
