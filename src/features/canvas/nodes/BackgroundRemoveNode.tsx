import { memo, useEffect, useMemo, useState } from 'react';
import { Handle, Position, useUpdateNodeInternals, type NodeProps } from '@xyflow/react';
import { Image as ImageIcon, Scissors, Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { UiButton, UiLoadingAnimation } from '@/components/ui';
import {
  persistImageLocally,
  resolveImageDisplayUrl,
} from '@/features/canvas/application/imageData';
import {
  BACKGROUND_REMOVE_NODE_DEFAULT_HEIGHT,
  BACKGROUND_REMOVE_NODE_DEFAULT_WIDTH,
  CANVAS_NODE_TYPES,
  resolveSingleImageConnectionSource,
  type BackgroundRemoveNodeData,
} from '@/features/canvas/domain/canvasNodes';
import { resolveNodeDisplayName } from '@/features/canvas/domain/nodeDisplay';
import { useCanvasIncomingSourceNodes } from '@/features/canvas/hooks/useCanvasNodeGraph';
import { NodeHeader, NODE_HEADER_FLOATING_POSITION_CLASS } from '@/features/canvas/ui/NodeHeader';
import { NodeStatusBadge } from '@/features/canvas/ui/NodeStatusBadge';
import { useCanvasStore } from '@/stores/canvasStore';
import { useExtensionsStore } from '@/stores/extensionsStore';
import {
  removeBackgroundWithRmbg,
  resolveRmbgExtensionState,
} from '@/features/extensions/application/rmbgRuntime';

import { formatGeneratedTime, resolveRuntimeTone } from './voxCpmShared';

type BackgroundRemoveNodeProps = NodeProps & {
  id: string;
  data: BackgroundRemoveNodeData;
  selected?: boolean;
};

type BackgroundInputState =
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

export const BackgroundRemoveNode = memo(({
  id,
  data,
  selected,
}: BackgroundRemoveNodeProps) => {
  const { t, i18n } = useTranslation();
  const updateNodeInternals = useUpdateNodeInternals();
  const setSelectedNode = useCanvasStore((state) => state.setSelectedNode);
  const updateNodeData = useCanvasStore((state) => state.updateNodeData);
  const addDerivedExportNode = useCanvasStore((state) => state.addDerivedExportNode);
  const incomingSourceNodes = useCanvasIncomingSourceNodes(id);
  const extensionPackages = useExtensionsStore((state) => state.packages);
  const enabledExtensionIds = useExtensionsStore((state) => state.enabledExtensionIds);
  const runtimeById = useExtensionsStore((state) => state.runtimeById);
  const [isRemoving, setIsRemoving] = useState(false);

  const extensionState = useMemo(
    () => resolveRmbgExtensionState(extensionPackages, enabledExtensionIds, runtimeById),
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

  const inputState = useMemo<BackgroundInputState>(() => {
    if (incomingSourceNodes.length === 0) {
      return {
        kind: 'empty',
        message: t('node.backgroundRemove.noInputImage'),
        previewName: t('node.backgroundRemove.waitingForInput'),
        previewImageUrl: null,
      };
    }

    if (incomingSourceNodes.length > 1) {
      return {
        kind: 'multiple',
        message: t('node.backgroundRemove.multipleInputImages'),
        previewName: t('node.backgroundRemove.multipleInputTitle'),
        previewImageUrl: null,
      };
    }

    const sourceNode = incomingSourceNodes[0]?.node;
    const source = resolveSingleImageConnectionSource(sourceNode);
    const previewName = sourceNode
      ? resolveNodeDisplayName(sourceNode.type, sourceNode.data)
      : t('node.backgroundRemove.waitingForInput');

    if (!source) {
      return {
        kind: 'unsupported',
        message: t('node.backgroundRemove.unsupportedInput'),
        previewName,
        previewImageUrl: null,
      };
    }

    return {
      kind: 'ready',
      message: t('node.backgroundRemove.inputReady'),
      previewName,
      previewImageUrl: source.previewImageUrl,
      imageUrl: source.imageUrl,
      aspectRatio: source.aspectRatio,
    };
  }, [incomingSourceNodes, t]);

  const runtimeMessage = useMemo(() => {
    if (isExtensionReady) {
      return t('node.backgroundRemove.runtimeReady');
    }

    if (isExtensionStarting) {
      return currentRuntimeStep?.description ?? t('node.backgroundRemove.extensionStarting');
    }

    if (extensionRuntime?.status === 'error') {
      return extensionRuntime.error?.trim() || t('node.backgroundRemove.runtimeErrored');
    }

    return t('node.backgroundRemove.runtimeDisabled');
  }, [currentRuntimeStep?.description, extensionRuntime?.error, extensionRuntime?.status, isExtensionReady, isExtensionStarting, t]);

  const helperMessage = useMemo(() => {
    if (isRemoving) {
      return t('node.backgroundRemove.processing');
    }

    if (!isExtensionReady) {
      if (extensionRuntime?.status === 'error') {
        return extensionRuntime.error?.trim() || t('node.backgroundRemove.runtimeErrored');
      }

      return isExtensionStarting
        ? t('node.backgroundRemove.extensionStarting')
        : t('node.backgroundRemove.extensionDisabled');
    }

    return inputState.message;
  }, [extensionRuntime?.error, extensionRuntime?.status, inputState.message, isExtensionReady, isExtensionStarting, isRemoving, t]);

  const canExecute = isExtensionReady && inputState.kind === 'ready' && !isRemoving;

  useEffect(() => {
    updateNodeInternals(id);
  }, [
    data.lastError,
    data.lastGeneratedAt,
    helperMessage,
    id,
    inputState.kind,
    inputState.previewName,
    runtimeProgress,
    selected,
    updateNodeInternals,
  ]);

  const handleExecute = async () => {
    setSelectedNode(id);

    if (!readyExtensionPackage || !isExtensionReady) {
      updateNodeData(
        id,
        {
          lastError:
            extensionRuntime?.status === 'error'
              ? extensionRuntime.error?.trim() || t('node.backgroundRemove.runtimeErrored')
              : t('node.backgroundRemove.extensionDisabled'),
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

    setIsRemoving(true);
    updateNodeData(
      id,
      {
        lastError: null,
        statusText: t('node.backgroundRemove.persistingInput'),
      },
      { historyMode: 'skip' }
    );

    try {
      const localImagePath = await persistImageLocally(inputState.imageUrl);

      updateNodeData(
        id,
        {
          statusText: t('node.backgroundRemove.processing'),
        },
        { historyMode: 'skip' }
      );

      const preparedImage = await removeBackgroundWithRmbg(readyExtensionPackage, {
        imagePath: localImagePath,
        outputPrefix: `background-removed-${Date.now()}`,
      });

      const resultNodeId = addDerivedExportNode(
        id,
        preparedImage.imageUrl,
        preparedImage.aspectRatio,
        preparedImage.previewImageUrl,
        {
          connectToSource: true,
          resultKind: 'backgroundRemoved',
        }
      );

      if (!resultNodeId) {
        throw new Error(t('node.backgroundRemove.resultNodeCreateFailed'));
      }

      updateNodeData(
        id,
        {
          lastError: null,
          statusText: t('node.backgroundRemove.completed'),
          lastGeneratedAt: Date.now(),
        },
        { historyMode: 'skip' }
      );
    } catch (error) {
      const errorMessage = resolveErrorMessage(error, t('node.backgroundRemove.processFailed'));
      updateNodeData(
        id,
        {
          lastError: errorMessage,
          statusText: errorMessage,
        },
        { historyMode: 'skip' }
      );
    } finally {
      setIsRemoving(false);
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
        width: BACKGROUND_REMOVE_NODE_DEFAULT_WIDTH,
        minHeight: BACKGROUND_REMOVE_NODE_DEFAULT_HEIGHT,
      }}
      onClick={() => setSelectedNode(id)}
    >
      <NodeHeader
        className={NODE_HEADER_FLOATING_POSITION_CLASS}
        icon={<Scissors className="h-4 w-4" />}
        titleText={resolveNodeDisplayName(CANVAS_NODE_TYPES.backgroundRemove, data)}
        editable
        onTitleChange={(nextTitle) => updateNodeData(id, { displayName: nextTitle })}
        rightSlot={(
          isRemoving ? (
            <NodeStatusBadge
              label={t('node.backgroundRemove.processingShort')}
              tone="warning"
              animate
            />
          ) : data.lastError ? (
            <NodeStatusBadge
              icon={<Scissors className="h-3.5 w-3.5" />}
              label={t('node.backgroundRemove.errorShort')}
              tone="danger"
              title={data.lastError}
            />
          ) : data.lastGeneratedAt ? (
            <NodeStatusBadge
              icon={<Sparkles className="h-3.5 w-3.5" />}
              label={t('node.backgroundRemove.readyShort')}
              tone="processing"
              title={t('node.backgroundRemove.generatedAt', {
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
                {t('node.backgroundRemove.runtimeTitle')}
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
          {t('node.backgroundRemove.licenseNotice')}
        </div>

        <div className="rounded-xl border border-white/10 bg-black/10 px-3 py-3">
          <div className="mb-2 flex items-center gap-2 text-xs font-medium text-text-muted">
            <ImageIcon className="h-4 w-4" />
            <span>{t('node.backgroundRemove.upstreamImage')}</span>
          </div>

          <div className="flex items-start gap-3">
            {inputState.previewImageUrl ? (
              <img
                src={resolveImageDisplayUrl(inputState.previewImageUrl)}
                alt={t('node.backgroundRemove.sourcePreviewAlt')}
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
                  {t('node.backgroundRemove.sourceAspectRatio', {
                    aspectRatio: inputState.aspectRatio,
                  })}
                </div>
              ) : null}
            </div>
          </div>
        </div>

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
            {isRemoving ? <UiLoadingAnimation size="sm" /> : <Scissors className="h-4 w-4" />}
            <span>
              {isRemoving
                ? t('node.backgroundRemove.executing')
                : t('node.backgroundRemove.execute')}
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

BackgroundRemoveNode.displayName = 'BackgroundRemoveNode';
