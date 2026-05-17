import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { ImageIcon, LayoutGrid, LockKeyhole, Play, Sparkles, Wand2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { UiButton, UiCheckbox, UiModal } from '@/components/ui';
import {
  runAssetBatchGeneration,
  runAssetBatchPromptOptimization,
} from '@/features/canvas/application/imageEditBatchActions';
import {
  runStoryboardProductionGroupImageGeneration,
} from '@/features/canvas/application/smartDirectorStoryboard';
import {
  AUTO_REQUEST_ASPECT_RATIO,
  CANVAS_NODE_TYPES,
  type ExportImageNodeData,
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
  const [isRunningStoryboardImage, setIsRunningStoryboardImage] = useState(false);
  const [showMissingPreviousConfirm, setShowMissingPreviousConfirm] = useState(false);
  const [storyboardImageError, setStoryboardImageError] = useState<string | null>(null);
  const autoRelayoutAttemptedRef = useRef(false);

  const resolvedTitle = useMemo(
    () => resolveNodeDisplayName(CANVAS_NODE_TYPES.group, data),
    [data]
  );
  const isPlotLinePanel = data.visualStyle === 'scriptPlotLinePanel';
  const isAssetBatchGroup = data.visualStyle === 'assetBatchGroup';
  const isStoryboardProductionGroup = data.visualStyle === 'storyboardProductionGroup';
  const isProductionLikeGroup = isAssetBatchGroup || isStoryboardProductionGroup;
  const directChildNodes = useMemo(
    () => nodes.filter((node) => (
      node.parentId === id
      && (isStoryboardProductionGroup || node.type === CANVAS_NODE_TYPES.imageEdit)
    )),
    [id, isStoryboardProductionGroup, nodes]
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
  const productionImageResultNode = useMemo(
    () =>
      directChildNodes.find((node): node is typeof directChildNodes[number] & {
        type: typeof CANVAS_NODE_TYPES.exportImage;
        data: ExportImageNodeData;
      } => (
        node.type === CANVAS_NODE_TYPES.exportImage
        && (node.data as ExportImageNodeData).isStoryboardProductionPlaceholder === true
      )) ?? null,
    [directChildNodes]
  );
  const selectedProductionResultId =
    productionImageResultNode?.data.selectedStoryboardProductionResultId ?? null;

  useEffect(() => {
    if (!isProductionLikeGroup || autoRelayoutAttemptedRef.current) {
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
  }, [directChildNodes, id, isProductionLikeGroup, layoutGroupNode]);

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

  const handleStoryboardImageGenerate = async (confirmWithoutPrevious = false) => {
    setIsRunningStoryboardImage(true);
    setStoryboardImageError(null);
    try {
      const result = await runStoryboardProductionGroupImageGeneration({
        groupNodeId: id,
        confirmWithoutPrevious,
      });
      if (result.missingPrevious) {
        setShowMissingPreviousConfirm(true);
        return;
      }
      if (!result.ok) {
        setStoryboardImageError(result.error ?? t('common.error'));
      }
    } finally {
      setIsRunningStoryboardImage(false);
    }
  };

  if (isStoryboardProductionGroup) {
    const shotLabels = Array.isArray(data.sourceStoryboardShotLabels)
      ? data.sourceStoryboardShotLabels.filter((item): item is string => typeof item === 'string')
      : [];
    const shotSummaries = Array.isArray(data.sourceStoryboardShotSummaries)
      ? data.sourceStoryboardShotSummaries
          .map((item) => {
            if (!item || typeof item !== 'object' || Array.isArray(item)) {
              return null;
            }
            const record = item as {
              shotNumber?: unknown;
              durationSeconds?: unknown;
              content?: unknown;
            };
            const shotNumber = typeof record.shotNumber === 'string'
              ? record.shotNumber.trim()
              : '';
            const content = typeof record.content === 'string'
              ? record.content.trim()
              : '';
            return {
              shotNumber,
              durationSeconds:
                typeof record.durationSeconds === 'number' && Number.isFinite(record.durationSeconds)
                  ? record.durationSeconds
                  : null,
              content,
            };
          })
          .filter((item): item is { shotNumber: string; durationSeconds: number | null; content: string } =>
            Boolean(item && (item.shotNumber || item.content))
          )
      : [];
    const totalDurationSeconds =
      typeof data.totalDurationSeconds === 'number' && Number.isFinite(data.totalDurationSeconds)
        ? data.totalDurationSeconds
        : 0;
    const storyboardMetaPillClass =
      'rounded-full border border-white/10 bg-white/5 px-2.5 py-1';

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

        <div
          className="pointer-events-none absolute left-5 right-5 top-4 z-10 flex justify-end"
          onPointerDown={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.stopPropagation()}
          onDoubleClick={(event) => event.stopPropagation()}
        >
          <div className="pointer-events-auto nodrag nowheel flex max-w-full flex-wrap items-center justify-end gap-2 text-[11px] text-text-muted">
            <span className={storyboardMetaPillClass}>
              {t('node.storyboardProductionGroup.nodeCount', { count: directChildNodes.length })}
            </span>
            <span className={storyboardMetaPillClass}>
              {t('node.storyboardProductionGroup.shotCount', { count: shotLabels.length })}
            </span>
            <span className={storyboardMetaPillClass}>
              {t('node.storyboardProductionGroup.totalDuration', { value: `${totalDurationSeconds}s` })}
            </span>
            {data.continuousReferenceEnabled === true ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-400/25 bg-emerald-400/12 px-2.5 py-1 text-emerald-200">
                <LockKeyhole className="h-3.5 w-3.5" />
                {t('node.storyboardProductionGroup.continuousEnabled')}
              </span>
            ) : null}
          </div>
        </div>

        <div
          className="nodrag nowheel absolute left-5 right-5 top-14 z-10 rounded-2xl border border-white/10 bg-[#171513]/92 px-4 py-3"
          onPointerDown={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.stopPropagation()}
          onDoubleClick={(event) => event.stopPropagation()}
        >
          <div className="flex min-w-0 items-center gap-2 text-[11px] text-text-muted">
            <div className="min-w-0 flex-1 truncate text-xs font-semibold text-[#f5d59b]">
              {resolvedTitle}
              {shotLabels.length > 0 ? ` · ${t('node.storyboardProductionGroup.shots')}: ${shotLabels.join(' / ')}` : ''}
            </div>
          </div>
          {shotSummaries.length > 0 ? (
            <div
              className="nodrag nowheel mt-3 grid max-h-[204px] grid-cols-4 gap-3 overflow-y-auto pr-1"
              onPointerDown={(event) => event.stopPropagation()}
              onMouseDown={(event) => event.stopPropagation()}
              onDoubleClick={(event) => event.stopPropagation()}
            >
              {shotSummaries.map((shot, index) => (
                <div
                  key={`${shot.shotNumber || 'shot'}-${index}`}
                  className="min-h-[136px] rounded-2xl border border-white/10 bg-[#2a2520] px-3 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
                >
                  <div className="mb-2 flex items-center justify-between gap-2 text-xs">
                    <span className="min-w-0 truncate font-semibold text-[#f5d59b]">
                      {shot.shotNumber || `${index + 1}`}
                    </span>
                    {shot.durationSeconds !== null ? (
                      <span className="shrink-0 rounded-full border border-white/10 bg-black/20 px-2 py-0.5 text-text-muted">
                        {shot.durationSeconds}s
                      </span>
                    ) : null}
                  </div>
                  <div
                    className="nodrag nowheel ui-scrollbar max-h-[92px] overflow-y-auto whitespace-pre-wrap break-words pr-1 text-sm leading-6 text-text-dark"
                    onPointerDown={(event) => event.stopPropagation()}
                    onMouseDown={(event) => event.stopPropagation()}
                    onDoubleClick={(event) => event.stopPropagation()}
                  >
                    {shot.content || '-'}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-3 rounded-2xl border border-white/10 bg-white/[0.035] px-3 py-4 text-xs text-text-muted">
              {shotLabels.length > 0 ? shotLabels.join(' / ') : t('node.storyboardProductionGroup.shots')}
            </div>
          )}
        </div>

        <div
          className="nodrag nowheel absolute bottom-5 left-5 z-20 flex max-w-[360px] items-center gap-2 rounded-2xl border border-white/10 bg-[#171513]/94 p-2 shadow-[0_18px_36px_rgba(0,0,0,0.28)]"
          onPointerDown={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.stopPropagation()}
          onDoubleClick={(event) => event.stopPropagation()}
        >
          <div className="flex min-w-0 items-center gap-2">
            <UiButton
              type="button"
              size="sm"
              disabled={isRunningStoryboardImage || Boolean(queueState.runningNodeId)}
              onClick={() => void handleStoryboardImageGenerate(false)}
            >
              {isRunningStoryboardImage || queueState.runningNodeId ? (
                <>
                  <Sparkles className="h-3.5 w-3.5 animate-pulse" />
                  {t('scriptStoryboardTable.production.generatingImage')}
                </>
              ) : (
                <>
                  <ImageIcon className="h-3.5 w-3.5" />
                  {t('scriptStoryboardTable.production.generateImage')}
                </>
              )}
            </UiButton>
            {storyboardImageError ? (
              <div className="max-w-[180px] truncate text-[11px] text-red-200">
                {storyboardImageError}
              </div>
            ) : (
              <div className="max-w-[180px] truncate text-[11px] text-text-muted">
                {selectedProductionResultId
                  ? t('scriptStoryboardTable.production.selectedReference')
                  : t('scriptStoryboardTable.production.noSelectedReference')}
              </div>
            )}
          </div>
        </div>

        <UiModal
          isOpen={showMissingPreviousConfirm}
          title={t('scriptStoryboardTable.production.missingPreviousTitle')}
          onClose={() => setShowMissingPreviousConfirm(false)}
          widthClassName="w-[420px]"
          footer={(
            <>
              <UiButton
                type="button"
                variant="ghost"
                onClick={() => setShowMissingPreviousConfirm(false)}
              >
                {t('common.cancel')}
              </UiButton>
              <UiButton
                type="button"
                onClick={() => {
                  setShowMissingPreviousConfirm(false);
                  void handleStoryboardImageGenerate(true);
                }}
              >
                {t('scriptStoryboardTable.production.continueWithoutPrevious')}
              </UiButton>
            </>
          )}
        >
          <p className="text-sm leading-6 text-text-muted">
            {t('scriptStoryboardTable.production.missingPreviousBody')}
          </p>
        </UiModal>

        <NodeResizeHandle minWidth={720} minHeight={360} maxWidth={2600} maxHeight={1600} isVisible={selected} />
      </div>
    );
  }

  if (isProductionLikeGroup) {
    const groupNodeCountLabel = isStoryboardProductionGroup
      ? t('node.storyboardProductionGroup.nodeCount', { count: directChildNodes.length })
      : t('node.assetBatchGroup.nodeCount', { count: directChildNodes.length });
    const groupKindLabel = isStoryboardProductionGroup
      ? t(`node.storyboardProductionGroup.batchKind.${data.batchKind === 'storyboard10s' ? 'storyboard10s' : 'storyboard15s'}`)
      : t(`node.assetBatchGroup.batchKind.${data.batchKind ?? 'character'}`);
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
              {groupNodeCountLabel}
            </span>
            <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] text-text-muted">
              {groupKindLabel}
            </span>
            {isStoryboardProductionGroup && data.continuousReferenceEnabled === true ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-400/25 bg-emerald-400/12 px-2.5 py-1 text-[11px] text-emerald-200">
                <LockKeyhole className="h-3.5 w-3.5" />
                {t('node.storyboardProductionGroup.continuousEnabled')}
              </span>
            ) : null}
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
              {!isStoryboardProductionGroup ? (
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
              ) : null}
            </div>
          </div>

          <div className="rounded-2xl border border-white/8 bg-black/20 px-4 py-3 text-xs text-text-muted">
            {isStoryboardProductionGroup ? (
              <div className="leading-5">
                {t('node.storyboardProductionGroup.prepareHint')}
              </div>
            ) : (
              <>
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
              </>
            )}
          </div>

          {!isStoryboardProductionGroup ? (
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
          ) : null}
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
