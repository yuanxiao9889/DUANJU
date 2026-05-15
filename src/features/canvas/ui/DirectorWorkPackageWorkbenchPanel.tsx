import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, RefreshCcw, Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { UiScrollArea } from '@/components/ui';
import {
  resolveScriptAssetExtractSource,
  runScriptAssetExtractionForNode,
} from '@/features/canvas/application/directorWorkPackage';
import { useCanvasNodesByTypes } from '@/features/canvas/hooks/useCanvasNodeGraph';
import {
  CANVAS_NODE_TYPES,
  normalizeScriptChapterNodeData,
  type ScriptAssetExtractNodeData,
  type ScriptChapterNodeData,
} from '@/features/canvas/domain/canvasNodes';
import { useCanvasStore } from '@/stores/canvasStore';

type DirectorWorkPackageWorkbenchPanelProps = {
  nodeId: string;
  nodeData: ScriptAssetExtractNodeData;
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

export function DirectorWorkPackageWorkbenchPanel({
  nodeId,
  nodeData,
}: DirectorWorkPackageWorkbenchPanelProps) {
  const { t } = useTranslation();
  const updateNodeData = useCanvasStore((state) => state.updateNodeData);
  const nodes = useCanvasStore((state) => state.nodes);
  const edges = useCanvasStore((state) => state.edges);
  const chapterNodes = useCanvasNodesByTypes([CANVAS_NODE_TYPES.scriptChapter]);
  const [isExtracting, setIsExtracting] = useState(false);
  const [openSections, setOpenSections] = useState({
    source: true,
    result: true,
  });

  const sortedChapters = useMemo(() => (
    chapterNodes
      .filter((node): node is typeof node & { data: ScriptChapterNodeData } => node.type === CANVAS_NODE_TYPES.scriptChapter)
      .map((node) => ({
        id: node.id,
        data: normalizeScriptChapterNodeData(node.data as ScriptChapterNodeData),
      }))
      .sort((left, right) => left.data.chapterNumber - right.data.chapterNumber)
  ), [chapterNodes]);

  const resolvedSourceSnapshot = useMemo(() => (
    resolveScriptAssetExtractSource({
      nodeId,
      sourceMode: nodeData.sourceMode,
      selectedChapterIds: nodeData.selectedChapterIds,
      nodes,
      edges,
    })
  ), [edges, nodeData.selectedChapterIds, nodeData.sourceMode, nodeId, nodes]);

  const hasConnectedTextSource = resolvedSourceSnapshot.mode === 'connectedText';
  const extractionResult = nodeData.extractionResult;

  const refreshSourceSnapshot = () => {
    updateNodeData(nodeId, {
      sourceMode: resolvedSourceSnapshot.mode,
      resolvedSourceSnapshot,
    }, { historyMode: 'skip' });
  };

  const handleExtract = async () => {
    setIsExtracting(true);
    try {
      await runScriptAssetExtractionForNode(nodeId);
    } finally {
      setIsExtracting(false);
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
          title={t('script.scriptAssetExtract.sourceTitle')}
          description={t('script.scriptAssetExtract.sourceSubtitle')}
          isOpen={openSections.source}
          onToggle={() => setOpenSections((current) => ({ ...current, source: !current.source }))}
          actions={(
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-lg border border-border-dark bg-bg-dark px-3 py-1.5 text-xs font-medium text-text-dark hover:bg-bg-dark/80"
              onClick={refreshSourceSnapshot}
            >
              <RefreshCcw className="h-3.5 w-3.5" />
              {t('script.scriptAssetExtract.refreshSource')}
            </button>
          )}
        >
          {hasConnectedTextSource ? (
            <div className="rounded-2xl border border-border-dark bg-bg-dark/35 p-4">
              <div className="text-sm font-semibold text-text-dark">
                {t('script.scriptAssetExtract.connectedTextTitle')}
              </div>
              <div className="mt-1 text-xs leading-5 text-text-muted">
                {resolvedSourceSnapshot.sourceNodeTitle || t('node.menu.textAnnotation')}
              </div>
              <div className="mt-3 rounded-xl border border-dashed border-border-dark bg-bg-dark/25 p-3 text-xs leading-6 text-text-muted">
                {t('script.scriptAssetExtract.connectedTextLockedHint')}
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              {sortedChapters.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border-dark px-3 py-4 text-sm text-text-muted">
                  {t('script.scriptAssetExtract.noChapters')}
                </div>
              ) : sortedChapters.map((chapter) => {
                const checked = nodeData.selectedChapterIds.includes(chapter.id);
                return (
                  <label
                    key={chapter.id}
                    className="flex items-start gap-3 rounded-xl border border-border-dark bg-bg-dark/35 px-3 py-3 text-sm text-text-dark"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(event) => {
                        const nextSelectedChapterIds = event.target.checked
                          ? [...nodeData.selectedChapterIds, chapter.id]
                          : nodeData.selectedChapterIds.filter((item) => item !== chapter.id);

                        updateNodeData(nodeId, {
                          sourceMode: 'chapterSelection',
                          selectedChapterIds: nextSelectedChapterIds,
                          resolvedSourceSnapshot: resolveScriptAssetExtractSource({
                            nodeId,
                            sourceMode: 'chapterSelection',
                            selectedChapterIds: nextSelectedChapterIds,
                            nodes,
                            edges,
                          }),
                        }, { historyMode: 'skip' });
                      }}
                      className="mt-1"
                    />
                    <span className="min-w-0">
                      <span className="block font-medium">
                        {t('script.sceneStudio.chapterLabel', { number: chapter.data.chapterNumber || 1 })} {chapter.data.title || chapter.data.displayName || t('script.sceneCatalog.untitledChapter')}
                      </span>
                      <span className="mt-1 block text-xs leading-5 text-text-muted">
                        {chapter.data.summary || t('script.sceneCatalog.emptySummary')}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-text-muted">
            <span className="rounded-full bg-bg-dark px-2.5 py-1">
              {hasConnectedTextSource
                ? t('script.scriptAssetExtract.sourceMode.connectedText')
                : t('script.scriptAssetExtract.chapterCount', { count: resolvedSourceSnapshot.chapterCount })}
            </span>
            <span className="rounded-full bg-bg-dark px-2.5 py-1">
              {t('script.scriptAssetExtract.sceneCount', { count: resolvedSourceSnapshot.sceneCount })}
            </span>
          </div>
        </SectionCard>

        <SectionCard
          title={t('script.scriptAssetExtract.resultTitle')}
          description={nodeData.extractionState.statusText || t('script.scriptAssetExtract.resultSubtitle')}
          isOpen={openSections.result}
          onToggle={() => setOpenSections((current) => ({ ...current, result: !current.result }))}
          actions={(
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-lg border border-border-dark bg-bg-dark px-3 py-1.5 text-xs font-medium text-text-dark hover:bg-bg-dark/80 disabled:opacity-60"
              onClick={() => void handleExtract()}
              disabled={isExtracting}
            >
              <Sparkles className="h-3.5 w-3.5" />
              {isExtracting ? t('script.scriptAssetExtract.extracting') : t('script.scriptAssetExtract.extract')}
            </button>
          )}
        >
          {!extractionResult ? (
            <div className="rounded-xl border border-dashed border-border-dark px-3 py-8 text-center text-sm text-text-muted">
              {t('script.scriptAssetExtract.emptyResult')}
            </div>
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl border border-border-dark bg-bg-dark/35 p-3">
                  <div className="text-[11px] uppercase tracking-[0.08em] text-text-muted">
                    {t('script.scriptAssetExtract.tabs.characters')}
                  </div>
                  <div className="mt-2 text-2xl font-semibold text-text-dark">
                    {extractionResult.charactersCatalog.length || extractionResult.characters.length}
                  </div>
                </div>
                <div className="rounded-xl border border-border-dark bg-bg-dark/35 p-3">
                  <div className="text-[11px] uppercase tracking-[0.08em] text-text-muted">
                    {t('script.scriptAssetExtract.tabs.scenes')}
                  </div>
                  <div className="mt-2 text-2xl font-semibold text-text-dark">
                    {extractionResult.scenesCatalog.length || extractionResult.scenes.length}
                  </div>
                </div>
                <div className="rounded-xl border border-border-dark bg-bg-dark/35 p-3">
                  <div className="text-[11px] uppercase tracking-[0.08em] text-text-muted">
                    {t('script.scriptAssetExtract.tabs.items')}
                  </div>
                  <div className="mt-2 text-2xl font-semibold text-text-dark">
                    {extractionResult.itemsCatalog.length || extractionResult.items.length}
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-border-dark bg-bg-dark/35 p-3 text-xs leading-6 text-text-muted">
                {t('script.scriptAssetExtract.expandHint')}
              </div>
            </div>
          )}
        </SectionCard>
      </UiScrollArea>
    </div>
  );
}
