import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { LayoutGrid, LockKeyhole, Play, Sparkles, Wand2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { UiButton, UiCheckbox } from '@/components/ui';
import {
  runAssetBatchGeneration,
  runAssetBatchPromptOptimization,
} from '@/features/canvas/application/imageEditBatchActions';
import {
  AUTO_REQUEST_ASPECT_RATIO,
  CANVAS_NODE_TYPES,
  type GroupNodeData,
  type ImageSize,
} from '@/features/canvas/domain/canvasNodes';
import { resolveNodeDisplayName } from '@/features/canvas/domain/nodeDisplay';
import {
  DEFAULT_IMAGE_MODEL_ID,
  getImageModel,
  listImageModels,
  resolveImageModelResolution,
  resolveImageModelResolutions,
} from '@/features/canvas/models';
import { NodeHeader, NODE_HEADER_FLOATING_POSITION_CLASS } from '@/features/canvas/ui/NodeHeader';
import { NodeResizeHandle } from '@/features/canvas/ui/NodeResizeHandle';
import { ModelParamsControls } from '@/features/canvas/ui/ModelParamsControls';
import { useCanvasStore } from '@/stores/canvasStore';
import { useSettingsStore } from '@/stores/settingsStore';

type GroupNodeProps = {
  id: string;
  data: GroupNodeData;
  selected?: boolean;
};

export const GroupNode = memo(({ id, data, selected }: GroupNodeProps) => {
  const { t } = useTranslation();
  const updateNodeData = useCanvasStore((state) => state.updateNodeData);
  const layoutGroupNode = useCanvasStore((state) => state.layoutGroupNode);
  const nodes = useCanvasStore((state) => state.nodes);
  const storyboardCompatibleModelConfig = useSettingsStore((state) => state.storyboardCompatibleModelConfig);
  const storyboardNewApiModelConfig = useSettingsStore((state) => state.storyboardNewApiModelConfig);
  const storyboardApi2OkModelConfig = useSettingsStore((state) => state.storyboardApi2OkModelConfig);
  const storyboardProviderCustomModels = useSettingsStore((state) => state.storyboardProviderCustomModels);
  const [isRunningBatch, setIsRunningBatch] = useState(false);
  const [isOptimizingBatch, setIsOptimizingBatch] = useState(false);
  const autoRelayoutAttemptedRef = useRef(false);

  const resolvedTitle = useMemo(
    () => resolveNodeDisplayName(CANVAS_NODE_TYPES.group, data),
    [data]
  );
  const isPlotLinePanel = data.visualStyle === 'scriptPlotLinePanel';
  const isAssetBatchGroup = data.visualStyle === 'assetBatchGroup';
  const directChildNodes = useMemo(
    () => nodes.filter((node) => node.parentId === id && node.type === CANVAS_NODE_TYPES.imageEdit),
    [id, nodes]
  );
  const imageModels = useMemo(
    () =>
      listImageModels(
        storyboardCompatibleModelConfig,
        storyboardNewApiModelConfig,
        storyboardApi2OkModelConfig,
        storyboardProviderCustomModels,
      ),
    [
      storyboardCompatibleModelConfig,
      storyboardNewApiModelConfig,
      storyboardApi2OkModelConfig,
      storyboardProviderCustomModels,
    ]
  );
  const selectedModel = useMemo(
    () => getImageModel(
      data.globalModelId ?? DEFAULT_IMAGE_MODEL_ID,
      storyboardCompatibleModelConfig,
      storyboardNewApiModelConfig,
      storyboardApi2OkModelConfig,
      storyboardProviderCustomModels,
    ),
    [
      data.globalModelId,
      storyboardCompatibleModelConfig,
      storyboardNewApiModelConfig,
      storyboardApi2OkModelConfig,
      storyboardProviderCustomModels,
    ]
  );
  const resolutionOptions = useMemo(
    () => resolveImageModelResolutions(selectedModel, {}),
    [selectedModel]
  );
  const selectedResolution = useMemo(
    () => resolveImageModelResolution(selectedModel, data.globalSize ?? undefined, {}),
    [data.globalSize, selectedModel]
  );
  const aspectRatioOptions = useMemo(
    () => [
      { value: AUTO_REQUEST_ASPECT_RATIO, label: t('modelParams.autoAspectRatio') },
      ...selectedModel.aspectRatios,
    ],
    [selectedModel.aspectRatios, t]
  );
  const selectedAspectRatio = useMemo(
    () =>
      aspectRatioOptions.find((option) => option.value === (data.globalAspectRatio ?? AUTO_REQUEST_ASPECT_RATIO))
      ?? aspectRatioOptions[0],
    [aspectRatioOptions, data.globalAspectRatio]
  );
  const queueState = data.queueState ?? {
    pendingNodeIds: [],
    runningNodeId: null,
    completedNodeIds: [],
    failedNodeIds: [],
    lastRunAt: null,
  };
  const runningNodeTitle = useMemo(() => {
    if (!queueState.runningNodeId) {
      return null;
    }

    const runningNode = directChildNodes.find((node) => node.id === queueState.runningNodeId);
    return runningNode ? resolveNodeDisplayName(CANVAS_NODE_TYPES.imageEdit, runningNode.data) : null;
  }, [directChildNodes, queueState.runningNodeId]);

  useEffect(() => {
    if (!isAssetBatchGroup || autoRelayoutAttemptedRef.current) {
      return;
    }

    if (directChildNodes.length === 0) {
      return;
    }

    const minChildY = Math.min(...directChildNodes.map((node) => Math.round(node.position.y)));
    if (minChildY >= 320) {
      autoRelayoutAttemptedRef.current = true;
      return;
    }

    autoRelayoutAttemptedRef.current = true;
    layoutGroupNode(id);
  }, [directChildNodes, id, isAssetBatchGroup, layoutGroupNode]);

  const handleBatchRun = async () => {
    setIsRunningBatch(true);
    try {
      await runAssetBatchGeneration(id);
    } finally {
      setIsRunningBatch(false);
    }
  };

  const handleBatchOptimize = async () => {
    setIsOptimizingBatch(true);
    try {
      await runAssetBatchPromptOptimization(id);
    } finally {
      setIsOptimizingBatch(false);
    }
  };

  if (isAssetBatchGroup) {
    return (
      <div
        className={`group relative h-full w-full overflow-visible rounded-[24px] border transition-all ${
          selected
            ? 'border-[#d7c6a2] bg-[#171513] shadow-[0_0_0_1px_rgba(215,198,162,0.22),0_18px_44px_rgba(0,0,0,0.24)]'
            : 'border-[rgba(255,255,255,0.12)] bg-[#141312] shadow-[0_14px_36px_rgba(0,0,0,0.2)]'
        }`}
      >
        <div className="pointer-events-none absolute inset-0 rounded-[24px] bg-[radial-gradient(circle_at_top_left,rgba(255,214,153,0.1),transparent_30%),linear-gradient(180deg,rgba(255,255,255,0.035),transparent_52%)]" />
        <NodeHeader
          className={NODE_HEADER_FLOATING_POSITION_CLASS}
          icon={<LayoutGrid className="h-4 w-4" />}
          titleText={resolvedTitle}
          titleClassName="text-[#f5d59b]"
          editable
          onTitleChange={(nextTitle) => updateNodeData(id, {
            displayName: nextTitle,
            label: nextTitle,
          })}
        />

        <div className="nodrag nopan flex h-full min-h-0 flex-col gap-3 px-5 pb-4 pt-12">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] text-text-muted">
              {t('node.assetBatchGroup.nodeCount', { count: directChildNodes.length })}
            </span>
            <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] text-text-muted">
              {t(`node.assetBatchGroup.batchKind.${data.batchKind ?? 'character'}`)}
            </span>
            {data.globalOverrideEnabled ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-400/25 bg-emerald-400/12 px-2.5 py-1 text-[11px] text-emerald-200">
                <LockKeyhole className="h-3.5 w-3.5" />
                {t('node.assetBatchGroup.globalEnabled')}
              </span>
            ) : null}
          </div>

          <label className="flex items-center gap-2 text-sm text-text-dark">
            <UiCheckbox
              checked={data.globalOverrideEnabled === true}
              onCheckedChange={(checked) => updateNodeData(id, {
                globalOverrideEnabled: checked,
              })}
            />
            <span>{t('node.assetBatchGroup.globalOverride')}</span>
          </label>

          <div className="ui-scrollbar min-w-0 overflow-x-auto overflow-y-hidden">
            <div className="flex w-max min-w-full items-center gap-2">
              <ModelParamsControls
                imageModels={imageModels}
                selectedModel={selectedModel}
                resolutionOptions={resolutionOptions}
                selectedResolution={selectedResolution}
                selectedAspectRatio={selectedAspectRatio}
                aspectRatioOptions={aspectRatioOptions}
                onModelChange={(modelId) => {
                  const nextModel = getImageModel(
                    modelId,
                    storyboardCompatibleModelConfig,
                    storyboardNewApiModelConfig,
                    storyboardApi2OkModelConfig,
                    storyboardProviderCustomModels,
                  );
                  const nextResolution = resolveImageModelResolution(nextModel, selectedResolution.value as ImageSize, {});
                  const nextAspectRatio =
                    nextModel.aspectRatios.find((option) => option.value === selectedAspectRatio.value)?.value
                    ?? AUTO_REQUEST_ASPECT_RATIO;
                  updateNodeData(id, {
                    globalModelId: nextModel.id,
                    globalSize: nextResolution.value as ImageSize,
                    globalAspectRatio: nextAspectRatio,
                  });
                }}
                onResolutionChange={(resolution) => updateNodeData(id, {
                  globalSize: resolution as ImageSize,
                })}
                onAspectRatioChange={(aspectRatio) => updateNodeData(id, {
                  globalAspectRatio: aspectRatio,
                })}
                onStyleTemplateApply={(template) => updateNodeData(id, {
                  globalStyleTemplateId: template.id,
                  globalStyleTemplateName: template.name,
                  globalStyleTemplatePrompt: template.prompt,
                })}
                onStyleTemplateClear={() => updateNodeData(id, {
                  globalStyleTemplateId: null,
                  globalStyleTemplateName: null,
                  globalStyleTemplatePrompt: null,
                })}
                selectedStyleTemplateName={data.globalStyleTemplateName}
                triggerSize="sm"
                chipClassName="border-white/10 bg-white/5 text-text-dark"
                modelChipClassName="w-auto justify-start"
                paramsChipClassName="w-auto justify-start"
                styleTemplateTriggerMode="label"
              />
              <UiButton
                type="button"
                variant="ghost"
                className="h-9 shrink-0 rounded-xl border border-white/10 bg-white/5 px-3 text-sm text-text-dark hover:border-white/20 hover:bg-white/10"
                disabled={isOptimizingBatch || isRunningBatch || directChildNodes.length === 0}
                onClick={() => void handleBatchOptimize()}
              >
                <Wand2 className="h-4 w-4" />
                {isOptimizingBatch
                  ? t('node.assetBatchGroup.optimizing')
                  : t('node.assetBatchGroup.optimizeSequential')}
              </UiButton>
            </div>
          </div>

          <div className="rounded-2xl border border-white/8 bg-black/20 px-4 py-3 text-xs text-text-muted">
            <div className="flex flex-wrap items-center gap-3">
              <span>{t('node.assetBatchGroup.queue.pending', { count: queueState.pendingNodeIds.length })}</span>
              <span>{t('node.assetBatchGroup.queue.running', { count: queueState.runningNodeId ? 1 : 0 })}</span>
              <span>{t('node.assetBatchGroup.queue.completed', { count: queueState.completedNodeIds.length })}</span>
              <span>{t('node.assetBatchGroup.queue.failed', { count: queueState.failedNodeIds.length })}</span>
            </div>
            {runningNodeTitle ? (
              <div className="mt-2 text-[11px] text-text-dark">
                {t('node.assetBatchGroup.queue.current', { name: runningNodeTitle })}
              </div>
            ) : null}
            {queueState.lastRunAt ? (
              <div className="mt-1 text-[11px]">
                {t('node.assetBatchGroup.queue.lastRunAt', {
                  value: new Date(queueState.lastRunAt).toLocaleString(),
                })}
              </div>
            ) : null}
          </div>

          <div className="mt-auto flex justify-end">
            <UiButton
              type="button"
              variant="primary"
              className="min-w-[160px]"
              disabled={isRunningBatch || isOptimizingBatch || directChildNodes.length === 0}
              onClick={() => void handleBatchRun()}
            >
              {isRunningBatch ? <Sparkles className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              {isRunningBatch
                ? t('node.assetBatchGroup.running')
                : t('node.assetBatchGroup.runSequential')}
            </UiButton>
          </div>
        </div>

        <NodeResizeHandle minWidth={360} minHeight={420} maxWidth={2600} maxHeight={2200} isVisible={selected} />
      </div>
    );
  }

  return (
    <div
      className={`group relative h-full w-full overflow-visible border ${
        isPlotLinePanel
          ? selected
            ? 'rounded-[26px] border-[#f0a34b]/28 bg-[#151515]/94 shadow-[0_0_0_1px_rgba(240,163,75,0.12),0_18px_44px_rgba(0,0,0,0.24)]'
            : 'rounded-[26px] border-[#f0a34b]/18 bg-[#151515]/88 shadow-[0_12px_36px_rgba(0,0,0,0.18)]'
          : selected
            ? 'rounded-[18px] border-accent shadow-[0_0_0_1px_rgba(59,130,246,0.35)]'
            : 'rounded-[18px] border-[rgba(15,23,42,0.2)] dark:border-[rgba(255,255,255,0.26)]'
      }`}
      style={{
        backgroundColor: isPlotLinePanel ? undefined : 'var(--group-node-bg)',
      }}
    >
      {isPlotLinePanel ? (
        <div className="pointer-events-none absolute inset-0 rounded-[26px] bg-[radial-gradient(circle_at_top_left,rgba(255,178,92,0.08),transparent_28%),linear-gradient(180deg,rgba(255,255,255,0.03),transparent_52%)]" />
      ) : null}
      <NodeHeader
        className={NODE_HEADER_FLOATING_POSITION_CLASS}
        icon={<LayoutGrid className="h-4 w-4" />}
        titleText={resolvedTitle}
        titleClassName={isPlotLinePanel ? 'text-[#f0a34b]' : undefined}
        editable
        onTitleChange={(nextTitle) => updateNodeData(id, {
          displayName: nextTitle,
          label: nextTitle,
        })}
      />
      <NodeResizeHandle minWidth={220} minHeight={140} maxWidth={2200} maxHeight={1600} isVisible={selected} />
    </div>
  );
});

GroupNode.displayName = 'GroupNode';
