import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, RefreshCcw, Sparkles, Waypoints } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { UiScrollArea } from '@/components/ui';
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
import type { SmartDirectorStoryboardNodeData } from '@/features/canvas/domain/canvasNodes';
import { useCanvasStore } from '@/stores/canvasStore';

type SmartDirectorStoryboardWorkbenchPanelProps = {
  nodeId: string;
  nodeData: SmartDirectorStoryboardNodeData;
};

function SectionCard({
  title,
  description,
  isOpen,
  onToggle,
  actions,
  children,
}: {
  title: string;
  description?: string;
  isOpen: boolean;
  onToggle: () => void;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-border-dark bg-surface-dark/80">
      <div className="flex items-start justify-between gap-3 border-b border-border-dark/80 px-4 py-3">
        <button type="button" onClick={onToggle} className="flex min-w-0 flex-1 items-start gap-2 text-left">
          <span className="mt-0.5 text-text-muted">
            {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-text-dark">{title}</span>
            {description ? <span className="mt-1 block text-xs leading-5 text-text-muted">{description}</span> : null}
          </span>
        </button>
        {actions ? <div className="shrink-0">{actions}</div> : null}
      </div>
      {isOpen ? <div className="px-4 py-4">{children}</div> : null}
    </section>
  );
}

export function SmartDirectorStoryboardWorkbenchPanel({
  nodeId,
  nodeData,
}: SmartDirectorStoryboardWorkbenchPanelProps) {
  const { t } = useTranslation();
  const nodes = useCanvasStore((state) => state.nodes);
  const edges = useCanvasStore((state) => state.edges);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isOpeningStoryboard, setIsOpeningStoryboard] = useState(false);
  const [openSections, setOpenSections] = useState({
    source: true,
    result: true,
  });

  const resolvedSource = useMemo(
    () =>
      resolveSmartDirectorStoryboardSource({
        nodeId,
        nodes,
        edges,
      }),
    [edges, nodeId, nodes]
  );
  const bindingState = useMemo(
    () =>
      resolveSmartDirectorStoryboardBindingState({
        nodeId,
        nodes,
        edges,
      }),
    [edges, nodeId, nodes]
  );
  const activeResultNode = useMemo(
    () =>
      nodeData.activeResultNodeId
        ? nodes.find((node) => node.id === nodeData.activeResultNodeId) ?? null
        : null,
    [nodeData.activeResultNodeId, nodes]
  );
  const canUseNode = canUseSmartDirectorStoryboard(bindingState);
  const unavailableReason = resolveSmartDirectorStoryboardUnavailableReason(bindingState);
  const assetGroups = buildSmartDirectorStoryboardAssetGroups(
    bindingState?.extractionResult ?? null
  );
  const assetCount = countSmartDirectorStoryboardAssets(
    bindingState?.extractionResult ?? null
  );

  const handleGenerate = async () => {
    setIsGenerating(true);
    try {
      await runSmartDirectorStoryboardGeneration({ nodeId });
    } finally {
      setIsGenerating(false);
    }
  };

  const handleOpenStoryboard = async () => {
    setIsOpeningStoryboard(true);
    try {
      await openStoryboardFromSmartDirectorStoryboard({ nodeId });
    } finally {
      setIsOpeningStoryboard(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <UiScrollArea
        className="min-h-0 flex-1"
        viewportClassName="h-full"
        contentClassName="space-y-4 p-4"
      >
        <SectionCard
          title={t('script.smartDirectorStoryboard.sourceTitle')}
          description={t('script.smartDirectorStoryboard.sourceSubtitle')}
          isOpen={openSections.source}
          onToggle={() => setOpenSections((current) => ({ ...current, source: !current.source }))}
        >
          {!resolvedSource ? (
            <div className="rounded-xl border border-dashed border-border-dark px-3 py-5 text-sm text-text-muted">
              {unavailableReason || t('script.smartDirectorStoryboard.sourceMissing')}
            </div>
          ) : (
            <div className="space-y-3">
              <div className="rounded-2xl border border-border-dark bg-bg-dark/35 p-4">
                <div className="text-sm font-semibold text-text-dark">
                  {resolvedSource.sourceLabel}
                </div>
                <div className="mt-2 text-xs leading-6 text-text-muted">
                  {resolvedSource.resolvedSourceSnapshot.mode === 'connectedText'
                    ? t('script.smartDirectorStoryboard.sourceConnectedText')
                    : t('script.smartDirectorStoryboard.sourceChapterSelection', {
                        count: resolvedSource.resolvedSourceSnapshot.chapterCount,
                      })}
                </div>
                <div className="mt-3 rounded-xl border border-border-dark bg-bg-dark/25 p-3 text-xs leading-6 text-text-muted">
                  {t('script.smartDirectorStoryboard.assetSummary', {
                    characters: resolvedSource.extractionResult.charactersCatalog.length,
                    scenes: resolvedSource.extractionResult.scenesCatalog.length,
                    items: resolvedSource.extractionResult.itemsCatalog.length,
                  })}
                </div>
                {assetGroups.length > 0 ? (
                  <div className="mt-3 rounded-xl border border-border-dark bg-bg-dark/25 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-text-dark">
                          {t('script.smartDirectorStoryboard.availableAssetsTitle')}
                        </div>
                        <div className="mt-1 text-xs text-text-muted">
                          {t('script.smartDirectorStoryboard.availableAssetsSubtitle')}
                        </div>
                      </div>
                      <div className="rounded-full bg-bg-dark px-2.5 py-1 text-xs text-text-muted">
                        {t('script.smartDirectorStoryboard.assetCount', { count: assetCount })}
                      </div>
                    </div>
                    <div className="mt-3 space-y-3">
                      {assetGroups.map((group) => (
                        <div key={group.key}>
                          <div className="text-[11px] uppercase tracking-[0.08em] text-text-muted">
                            {t(`script.smartDirectorStoryboard.assetGroups.${group.key}`)}
                          </div>
                          <div className="mt-2 flex flex-wrap gap-2">
                            {group.items.map((item) => (
                              <span
                                key={`${group.key}-${item}`}
                                className="rounded-full border border-border-dark bg-bg-dark/65 px-2.5 py-1 text-[11px] text-text-muted"
                              >
                                {item}
                              </span>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          )}
        </SectionCard>

        <SectionCard
          title={t('script.smartDirectorStoryboard.resultTitle')}
          description={nodeData.generationState.statusText || t('script.smartDirectorStoryboard.resultSubtitle')}
          isOpen={openSections.result}
          onToggle={() => setOpenSections((current) => ({ ...current, result: !current.result }))}
          actions={(
            <div className="flex gap-2">
              <button
                type="button"
                className="inline-flex items-center gap-1.5 rounded-lg border border-border-dark bg-bg-dark px-3 py-1.5 text-xs font-medium text-text-dark hover:bg-bg-dark/80 disabled:opacity-60"
                onClick={() => void handleGenerate()}
                disabled={isGenerating || !canUseNode}
              >
                {activeResultNode ? <RefreshCcw className="h-3.5 w-3.5" /> : <Sparkles className="h-3.5 w-3.5" />}
                {isGenerating
                  ? t('script.smartDirectorStoryboard.generating')
                  : activeResultNode
                  ? t('script.smartDirectorStoryboard.regenerate')
                  : t('script.smartDirectorStoryboard.generate')}
              </button>
              <button
                type="button"
                className="inline-flex items-center gap-1.5 rounded-lg border border-border-dark bg-bg-dark px-3 py-1.5 text-xs font-medium text-text-dark hover:bg-bg-dark/80 disabled:opacity-60"
                onClick={() => void handleOpenStoryboard()}
                disabled={!activeResultNode || isOpeningStoryboard}
              >
                <Waypoints className="h-3.5 w-3.5" />
                {isOpeningStoryboard
                  ? t('script.smartDirectorStoryboard.openingStoryboard')
                  : t('script.smartDirectorStoryboard.expandToStoryboard')}
              </button>
            </div>
          )}
        >
          {!activeResultNode ? (
            <div className="rounded-xl border border-dashed border-border-dark px-3 py-8 text-center text-sm text-text-muted">
              {t('script.smartDirectorStoryboard.emptyResult')}
            </div>
          ) : (
            <div className="rounded-2xl border border-border-dark bg-bg-dark/30 p-4 text-sm leading-6 text-text-muted">
              <div className="font-semibold text-text-dark">
                {t('script.smartDirectorStoryboard.resultLinked')}
              </div>
              <div className="mt-2">
                {t('script.smartDirectorStoryboard.resultLinkedHint')}
              </div>
            </div>
          )}
        </SectionCard>
      </UiScrollArea>
    </div>
  );
}
