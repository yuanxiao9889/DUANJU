import { memo, useMemo, useState } from 'react';
import { Position } from '@xyflow/react';
import { ExternalLink, Film, RefreshCcw, Sparkles, Waypoints } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { UiScrollArea } from '@/components/ui';
import { CanvasHandle } from '@/features/canvas/ui/CanvasHandle';
import {
  buildSmartDirectorStoryboardAssetGroups,
  canUseSmartDirectorStoryboard,
  countSmartDirectorStoryboardAssets,
  openStoryboardFromSmartDirectorStoryboard,
  resolveSmartDirectorStoryboardBindingState,
  resolveSmartDirectorStoryboardSource,
  resolveSmartDirectorStoryboardUnavailableReason,
  runSmartDirectorStoryboardGeneration,
} from '@/features/canvas/application/smartDirectorStoryboard';
import {
  CANVAS_NODE_TYPES,
  SMART_DIRECTOR_STORYBOARD_NODE_DEFAULT_HEIGHT,
  SMART_DIRECTOR_STORYBOARD_NODE_DEFAULT_WIDTH,
  type ScriptStoryboardTableNodeData,
  type SmartDirectorStoryboardNodeData,
} from '@/features/canvas/domain/canvasNodes';
import { resolveNodeDisplayName } from '@/features/canvas/domain/nodeDisplay';
import { NodeResizeHandle } from '@/features/canvas/ui/NodeResizeHandle';
import { useCanvasNodeById, useCanvasRelatedGraph } from '@/features/canvas/hooks/useCanvasNodeGraph';
import { useCanvasStore } from '@/stores/canvasStore';
import { useScriptEditorStore } from '@/stores/scriptEditorStore';

type SmartDirectorStoryboardNodeProps = {
  id: string;
  data: SmartDirectorStoryboardNodeData;
  selected?: boolean;
  width?: number;
  height?: number;
};

const MIN_NODE_WIDTH = 680;
const MIN_NODE_HEIGHT = 320;
const MAX_NODE_WIDTH = 1240;
const MAX_NODE_HEIGHT = 960;
const NODE_BASE_CLASS =
  'group relative overflow-visible rounded-[var(--node-radius)] border bg-surface-dark/90 transition-all duration-150';
const NODE_SELECTED_CLASS =
  'border-[#222222] shadow-[0_0_0_2px_rgba(34,34,34,0.38),0_4px_14px_rgba(15,23,42,0.12)] dark:border-white/70 dark:shadow-[0_0_0_2px_rgba(245,245,245,0.2),0_4px_14px_rgba(0,0,0,0.24)]';
const NODE_IDLE_CLASS =
  'border-[rgba(15,23,42,0.22)] hover:border-[rgba(15,23,42,0.34)] hover:shadow-[0_4px_16px_rgba(0,0,0,0.12)] dark:border-[rgba(255,255,255,0.22)] dark:hover:border-[rgba(255,255,255,0.34)] dark:hover:shadow-[0_4px_16px_rgba(0,0,0,0.25)]';
const HANDLE_CLASS = '!rounded-full !border-2 !border-surface-dark !bg-accent';
const ACTION_BUTTON_CLASS =
  'nodrag inline-flex items-center gap-1.5 rounded-lg border border-border-dark bg-bg-dark px-3 py-1.5 text-xs font-medium text-text-dark transition-colors hover:bg-bg-dark/80 disabled:opacity-50';
const ASSET_CHIP_CLASS =
  'rounded-full border border-border-dark bg-bg-dark/65 px-2.5 py-1 text-[11px] text-text-muted';

function resolveNodeDimension(value: number | undefined, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 1) {
    return Math.round(value);
  }
  return fallback;
}

export const SmartDirectorStoryboardNode = memo(
  ({ id, data, selected, width, height }: SmartDirectorStoryboardNodeProps) => {
    const { t } = useTranslation();
    const setSelectedNode = useCanvasStore((state) => state.setSelectedNode);
    const { nodes: relatedNodes, edges: relatedEdges } = useCanvasRelatedGraph(id);
    const activeResultNodeCandidate = useCanvasNodeById(data.activeResultNodeId ?? '');
    const focusSmartDirectorStoryboard = useScriptEditorStore(
      (state) => state.focusSmartDirectorStoryboard
    );
    const [isGenerating, setIsGenerating] = useState(false);
    const [isOpeningStoryboard, setIsOpeningStoryboard] = useState(false);
    const isStoryboardMirror = data.presentationMode === 'storyboardMirror';

    const resolvedWidth = resolveNodeDimension(
      width,
      SMART_DIRECTOR_STORYBOARD_NODE_DEFAULT_WIDTH
    );
    const resolvedHeight = resolveNodeDimension(
      height,
      SMART_DIRECTOR_STORYBOARD_NODE_DEFAULT_HEIGHT
    );
    const resolvedTitle = resolveNodeDisplayName(
      CANVAS_NODE_TYPES.smartDirectorStoryboard,
      data
    );
    const resolvedSource = useMemo(
      () =>
        resolveSmartDirectorStoryboardSource({
          nodeId: id,
          nodes: relatedNodes,
          edges: relatedEdges,
        }),
      [id, relatedEdges, relatedNodes]
    );
    const bindingState = useMemo(
      () =>
        resolveSmartDirectorStoryboardBindingState({
          nodeId: id,
          nodes: relatedNodes,
          edges: relatedEdges,
        }),
      [id, relatedEdges, relatedNodes]
    );
    const activeResultNode = useMemo(
      () =>
        activeResultNodeCandidate?.id === data.activeResultNodeId
          && activeResultNodeCandidate.type === CANVAS_NODE_TYPES.scriptStoryboardTable
          ? activeResultNodeCandidate as typeof activeResultNodeCandidate & {
            type: typeof CANVAS_NODE_TYPES.scriptStoryboardTable;
            data: ScriptStoryboardTableNodeData;
          }
          : null,
      [activeResultNodeCandidate, data.activeResultNodeId]
    );
    const canUseNode = canUseSmartDirectorStoryboard(bindingState);
    const unavailableReason = resolveSmartDirectorStoryboardUnavailableReason(bindingState);
    const assetGroups = buildSmartDirectorStoryboardAssetGroups(
      bindingState?.extractionResult ?? null
    );
    const assetCount = countSmartDirectorStoryboardAssets(
      bindingState?.extractionResult ?? null
    );

    const openWorkbench = () => {
      setSelectedNode(id);
      focusSmartDirectorStoryboard(id);
    };

    const handleGenerate = async () => {
      setIsGenerating(true);
      try {
        await runSmartDirectorStoryboardGeneration({ nodeId: id });
      } finally {
        setIsGenerating(false);
      }
    };

    const handleOpenStoryboard = async () => {
      setIsOpeningStoryboard(true);
      try {
        await openStoryboardFromSmartDirectorStoryboard({ nodeId: id });
      } finally {
        setIsOpeningStoryboard(false);
      }
    };

    const sourceSummary = resolvedSource
      ? resolvedSource.sourceLabel
      : data.expansionSource?.sourceLabel || t('node.smartDirectorStoryboard.missingAsset');

    return (
      <div
        className={`${NODE_BASE_CLASS} ${selected ? NODE_SELECTED_CLASS : NODE_IDLE_CLASS}`}
        style={{ width: resolvedWidth, height: resolvedHeight }}
        onClick={openWorkbench}
      >
        <CanvasHandle type="target" id="target" position={Position.Left} className={HANDLE_CLASS} />
        <CanvasHandle type="source" id="source" position={Position.Right} className={HANDLE_CLASS} />

        <div className="relative flex h-full flex-col overflow-hidden rounded-[var(--node-radius)] p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2 text-[11px] text-text-muted">
                <span className="rounded-full bg-bg-dark px-2.5 py-1">
                  {canUseNode || isStoryboardMirror
                    ? t('node.smartDirectorStoryboard.boundAssetReady')
                    : t('node.smartDirectorStoryboard.boundAssetMissing')}
                </span>
                {canUseNode ? (
                  <span className="rounded-full bg-bg-dark px-2.5 py-1">
                    {t('script.smartDirectorStoryboard.assetCount', { count: assetCount })}
                  </span>
                ) : null}
                <span className="rounded-full bg-bg-dark px-2.5 py-1">
                  {t(`node.smartDirectorStoryboard.status.${data.generationState.phase}`)}
                </span>
              </div>
              <div className="mt-2 flex items-center gap-2">
                <Film className="h-4 w-4 text-text-muted" />
                <span className="truncate text-sm font-semibold text-text-dark">
                  {resolvedTitle}
                </span>
              </div>
              <div className="mt-1 line-clamp-2 text-xs leading-5 text-text-muted">
                {data.generationState.statusText || sourceSummary}
              </div>
            </div>

            {!isStoryboardMirror ? (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  openWorkbench();
                }}
                className="nodrag flex h-8 w-8 items-center justify-center rounded-lg border border-transparent text-text-muted transition-colors hover:border-border-dark hover:bg-bg-dark hover:text-text-dark"
                title={t('node.smartDirectorStoryboard.openWorkbench')}
              >
                <ExternalLink className="h-4 w-4" />
              </button>
            ) : null}
          </div>

          {data.expansionSource?.sourceLabel ? (
            <div className="mt-3 rounded-2xl border border-border-dark bg-bg-dark/30 px-3 py-2 text-xs text-text-muted">
              {t('node.smartDirectorStoryboard.storyboardMirrorHint', {
                source: data.expansionSource.sourceLabel,
              })}
            </div>
          ) : null}

          <div className="mt-4 flex min-h-0 flex-1 flex-col">
            <UiScrollArea
              className="nodrag nowheel min-h-0 flex-1 rounded-2xl border border-border-dark bg-bg-dark/18"
              viewportClassName="h-full"
              contentClassName="space-y-3 p-3 pr-5"
            >
              <div className="rounded-2xl border border-dashed border-border-dark bg-bg-dark/20 p-4 text-sm leading-6 text-text-muted">
                {canUseNode
                  ? t('node.smartDirectorStoryboard.startHint')
                  : unavailableReason || t('node.smartDirectorStoryboard.requireAssetHint')}
              </div>

              {assetGroups.length > 0 ? (
                <div className="rounded-2xl border border-border-dark bg-bg-dark/25 p-4">
                  <div className="text-sm font-semibold text-text-dark">
                    {t('script.smartDirectorStoryboard.availableAssetsTitle')}
                  </div>
                  <div className="mt-1 text-xs text-text-muted">
                    {t('script.smartDirectorStoryboard.availableAssetsSubtitle')}
                  </div>
                  <div className="mt-3 space-y-3">
                    {assetGroups.map((group) => (
                      <div key={group.key}>
                        <div className="text-[11px] uppercase tracking-[0.08em] text-text-muted">
                          {t(`script.smartDirectorStoryboard.assetGroups.${group.key}`)}
                        </div>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {group.items.map((item) => (
                            <span key={`${group.key}-${item}`} className={ASSET_CHIP_CLASS}>
                              {item}
                            </span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {activeResultNode ? (
                <div className="rounded-2xl border border-border-dark bg-bg-dark/25 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-text-dark">
                        {t('script.smartDirectorStoryboard.resultTitle')}
                      </div>
                      <div className="mt-1 text-xs text-text-muted">
                        {activeResultNode.data.streamState.statusText
                          || t('script.smartDirectorStoryboard.resultLinked')}
                      </div>
                    </div>
                    <span className="rounded-full bg-bg-dark px-2.5 py-1 text-xs text-text-muted">
                      {t('script.smartDirectorStoryboard.resultLinkedBadge')}
                    </span>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-text-muted">
                    <div className="rounded-xl border border-border-dark bg-bg-dark/30 px-3 py-2">
                      {t('scriptStoryboardTable.summary.rows')}: {activeResultNode.data.summary.rowCount}
                    </div>
                    <div className="rounded-xl border border-border-dark bg-bg-dark/30 px-3 py-2">
                      {t('scriptStoryboardTable.summary.duration')}: {activeResultNode.data.summary.totalDurationSeconds}s
                    </div>
                  </div>
                </div>
              ) : null}
            </UiScrollArea>

            {!isStoryboardMirror ? (
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    void handleGenerate();
                  }}
                  className={ACTION_BUTTON_CLASS}
                  disabled={isGenerating || !canUseNode}
                >
                  {activeResultNode ? <RefreshCcw className="h-3.5 w-3.5" /> : <Sparkles className="h-3.5 w-3.5" />}
                  {isGenerating
                    ? t('node.smartDirectorStoryboard.generating')
                    : activeResultNode
                    ? t('node.smartDirectorStoryboard.regenerate')
                    : t('node.smartDirectorStoryboard.generate')}
                </button>
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    if (activeResultNode) {
                      setSelectedNode(activeResultNode.id);
                    }
                  }}
                  className={ACTION_BUTTON_CLASS}
                  disabled={!activeResultNode}
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  {t('script.smartDirectorStoryboard.viewResult')}
                </button>
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    void handleOpenStoryboard();
                  }}
                  className={`${ACTION_BUTTON_CLASS} border-accent/35 bg-accent/10 text-text-dark hover:border-accent/55 hover:bg-accent/16`}
                  disabled={isOpeningStoryboard || !activeResultNode}
                >
                  <Waypoints className="h-3.5 w-3.5" />
                  {isOpeningStoryboard
                    ? t('node.smartDirectorStoryboard.openingStoryboard')
                    : t('node.smartDirectorStoryboard.expandToStoryboard')}
                </button>
              </div>
            ) : null}
          </div>
        </div>

        <NodeResizeHandle
          minWidth={MIN_NODE_WIDTH}
          minHeight={MIN_NODE_HEIGHT}
          maxWidth={MAX_NODE_WIDTH}
          maxHeight={MAX_NODE_HEIGHT}
          isVisible={Boolean(selected)}
        />
      </div>
    );
  }
);

SmartDirectorStoryboardNode.displayName = 'SmartDirectorStoryboardNode';
