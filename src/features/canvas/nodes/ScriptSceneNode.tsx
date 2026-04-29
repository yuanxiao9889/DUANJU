import { memo, useCallback, useMemo, useState } from 'react';
import { Handle, Position } from '@xyflow/react';
import {
  Clapperboard,
  ExternalLink,
  Plus,
  RotateCcw,
  Sparkles,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { UiLoadingOverlay, UiScrollArea } from '@/components/ui';
import { NodeResizeHandle } from '@/features/canvas/ui/NodeResizeHandle';
import {
  CANVAS_NODE_TYPES,
  SCRIPT_SCENE_NODE_DEFAULT_HEIGHT,
  SCRIPT_SCENE_NODE_DEFAULT_WIDTH,
  type ScriptChapterNodeData,
  type ScriptSceneNodeData,
} from '@/features/canvas/domain/canvasNodes';
import { resolveNodeDisplayName } from '@/features/canvas/domain/nodeDisplay';
import {
  createManualEpisodeCard,
  generateEpisodesFromSceneNode,
} from '@/features/canvas/application/sceneEpisodeGenerator';
import { collectEnabledScriptStoryNotes } from '@/features/canvas/application/scriptStoryNotes';
import { useCanvasStore } from '@/stores/canvasStore';
import { useScriptEditorStore } from '@/stores/scriptEditorStore';

type ScriptSceneNodeProps = {
  id: string;
  data: ScriptSceneNodeData;
  selected?: boolean;
  width?: number;
  height?: number;
};

const MIN_NODE_WIDTH = 360;
const MIN_NODE_HEIGHT = 320;
const MAX_NODE_WIDTH = 760;
const MAX_NODE_HEIGHT = 920;

function resolveNodeDimension(value: number | undefined, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 1) {
    return Math.round(value);
  }
  return fallback;
}

function normalizeErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  return 'Failed to generate episodes.';
}

export const ScriptSceneNode = memo(({
  id,
  data,
  selected,
  width,
  height,
}: ScriptSceneNodeProps) => {
  const { t } = useTranslation();
  const nodes = useCanvasStore((state) => state.nodes);
  const updateNodeData = useCanvasStore((state) => state.updateNodeData);
  const setSelectedNode = useCanvasStore((state) => state.setSelectedNode);
  const focusSceneNode = useScriptEditorStore((state) => state.focusSceneNode);
  const activeSceneNodeId = useScriptEditorStore((state) => state.activeSceneNodeId);
  const activeEpisodeId = useScriptEditorStore((state) => state.activeEpisodeId);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationError, setGenerationError] = useState('');

  const resolvedWidth = resolveNodeDimension(width, SCRIPT_SCENE_NODE_DEFAULT_WIDTH);
  const resolvedHeight = resolveNodeDimension(height, SCRIPT_SCENE_NODE_DEFAULT_HEIGHT);
  const sourceChapterNode = useMemo(() => {
    return nodes.find(
      (node) => node.id === data.sourceChapterId && node.type === CANVAS_NODE_TYPES.scriptChapter
    ) ?? null;
  }, [data.sourceChapterId, nodes]);
  const sourceChapterData = sourceChapterNode?.data as ScriptChapterNodeData | undefined;
  const resolvedTitle = resolveNodeDisplayName(CANVAS_NODE_TYPES.scriptScene, data);
  const sourceChapterTitle = sourceChapterData?.title || sourceChapterData?.displayName || '';
  const previewEpisodes = useMemo(() => {
    return [...data.episodes]
      .sort((left, right) => left.order - right.order)
      .slice(0, 6);
  }, [data.episodes]);

  const openWorkbench = useCallback((episodeId?: string | null) => {
    setSelectedNode(id);
    focusSceneNode(id, episodeId ?? data.episodes[0]?.id ?? null);
  }, [data.episodes, focusSceneNode, id, setSelectedNode]);

  const handleAddEpisode = useCallback(() => {
    const nextEpisode = createManualEpisodeCard(data.episodes.length);
    const nextEpisodes = [...data.episodes, nextEpisode];
    updateNodeData(id, { episodes: nextEpisodes }, { historyMode: 'skip' });
    openWorkbench(nextEpisode.id);
  }, [data.episodes, id, openWorkbench, updateNodeData]);

  const handleGenerateEpisodes = useCallback(async (mode: 'initial' | 'regenerate') => {
    if (!sourceChapterData) {
      return;
    }

    setGenerationError('');
    setIsGenerating(true);
    try {
      const defaultCount = mode === 'regenerate'
        ? Math.max(1, data.episodes.length || 3)
        : Math.max(3, data.episodes.length);
      const storyNotes = collectEnabledScriptStoryNotes(nodes);
      const nextEpisodes = await generateEpisodesFromSceneNode(data, sourceChapterData, {
        episodeCount: defaultCount,
        sourceDraftLabel: t('script.sceneWorkbench.generatedSourceLabel'),
        storyNotes,
      });
      updateNodeData(id, { episodes: nextEpisodes }, { historyMode: 'skip' });
      openWorkbench(nextEpisodes[0]?.id ?? null);
    } catch (error) {
      setGenerationError(normalizeErrorMessage(error));
    } finally {
      setIsGenerating(false);
    }
  }, [data, id, nodes, openWorkbench, sourceChapterData, t, updateNodeData]);

  return (
    <div
      className={`group relative overflow-visible rounded-[20px] border bg-surface-dark shadow-[0_20px_40px_rgba(2,6,23,0.22)] transition-[border-color,box-shadow] duration-200 ${
        selected
          ? 'border-cyan-300/55 shadow-[0_0_0_1px_rgba(103,232,249,0.4),0_22px_42px_rgba(6,78,110,0.25)]'
          : 'border-cyan-300/18 hover:border-cyan-300/32'
      }`}
      style={{ width: resolvedWidth, height: resolvedHeight }}
      onClick={() => openWorkbench(activeSceneNodeId === id ? activeEpisodeId : undefined)}
    >
      <Handle
        type="target"
        id="target"
        position={Position.Left}
        className="!h-3 !w-3 !-left-1.5 !rounded-full !border-surface-dark !bg-cyan-400"
      />
      <Handle
        type="source"
        id="source"
        position={Position.Right}
        className="!h-3 !w-3 !-right-1.5 !rounded-full !border-surface-dark !bg-teal-400"
      />

      <div className="relative flex h-full flex-col overflow-hidden rounded-[20px] p-3">
        <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-[20px]">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(45,212,191,0.14),transparent_42%)]" />
          <div className="absolute inset-x-0 top-0 h-[2px] bg-cyan-300/70" />
        </div>
        <div className="flex items-start gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-cyan-200/85">
              <span className="rounded-full bg-amber-500/12 px-2 py-0.5 text-amber-200">
                {t('script.sceneStudio.chapterLabel', { number: data.chapterNumber || 1 })}
              </span>
              <span className="rounded-full bg-cyan-500/10 px-2 py-0.5">
                {t('script.sceneCatalog.sceneLabel', { number: data.sourceSceneOrder + 1 })}
              </span>
            </div>
            <div className="mt-2 truncate text-sm font-semibold text-text-dark">
              {data.title || resolvedTitle}
            </div>
            <div className="mt-1 line-clamp-1 text-xs text-text-muted">
              {sourceChapterTitle || t('script.sceneCatalog.untitledChapter')}
            </div>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              openWorkbench();
            }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-500/35 bg-cyan-500/10 px-3 py-1.5 text-xs font-medium text-cyan-200 transition-colors hover:bg-cyan-500/18"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            {t('script.sceneWorkbench.openWorkbench')}
          </button>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              handleAddEpisode();
            }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border-dark bg-bg-dark px-3 py-1.5 text-xs font-medium text-text-dark transition-colors hover:bg-bg-dark/80"
          >
            <Plus className="h-3.5 w-3.5" />
            {t('script.sceneWorkbench.addEpisode')}
          </button>
          <button
            type="button"
            disabled={isGenerating || !sourceChapterData}
            onClick={(event) => {
              event.stopPropagation();
              void handleGenerateEpisodes(data.episodes.length > 0 ? 'regenerate' : 'initial');
            }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-teal-500/30 bg-teal-500/10 px-3 py-1.5 text-xs font-medium text-teal-200 transition-colors hover:bg-teal-500/18 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {data.episodes.length > 0 ? (
              <RotateCcw className="h-3.5 w-3.5" />
            ) : (
              <Sparkles className="h-3.5 w-3.5" />
            )}
            {data.episodes.length > 0
              ? t('script.sceneWorkbench.regenerateEpisodes')
              : t('script.sceneWorkbench.generateEpisodes')}
          </button>
        </div>

        <div className="mt-3 flex items-center justify-between gap-2 text-xs text-text-muted">
          <span className="inline-flex items-center gap-1.5">
            <Clapperboard className="h-3.5 w-3.5 text-cyan-300" />
            {t('script.sceneWorkbench.episodeCount', { count: data.episodes.length })}
          </span>
          {isGenerating ? (
            <span className="text-teal-200">{t('script.sceneWorkbench.generating')}</span>
          ) : null}
        </div>

        <UiScrollArea
          className="mt-3 min-h-0 flex-1"
          viewportClassName="h-full"
          contentClassName="space-y-2 pr-3"
        >
          {previewEpisodes.length > 0 ? (
            previewEpisodes.map((episode) => {
              const isActive = activeSceneNodeId === id && activeEpisodeId === episode.id;

              return (
                <button
                  key={episode.id}
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    openWorkbench(episode.id);
                  }}
                  className={`w-full rounded-xl border px-3 py-2 text-left transition-colors ${
                    isActive
                      ? 'border-cyan-400/35 bg-cyan-500/12'
                      : 'border-border-dark bg-bg-dark/45 hover:border-cyan-500/25 hover:bg-cyan-500/[0.08]'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="truncate text-sm font-medium text-text-dark">
                      {episode.title || t('script.sceneWorkbench.untitledEpisode')}
                    </div>
                    <span className="shrink-0 rounded-full bg-cyan-500/10 px-2 py-0.5 text-[11px] text-cyan-200">
                      {`${data.chapterNumber || 1}-${episode.episodeNumber}`}
                    </span>
                  </div>
                </button>
              );
            })
          ) : (
            <div className="rounded-xl border border-dashed border-border-dark/70 bg-bg-dark/40 px-3 py-5 text-center text-xs text-text-muted">
              {t('script.sceneWorkbench.emptyEpisodes')}
            </div>
          )}
        </UiScrollArea>

        {generationError ? (
          <div className="mt-3 rounded-xl border border-red-400/20 bg-red-500/8 px-3 py-2 text-xs leading-5 text-red-200">
            {generationError}
          </div>
        ) : null}
      </div>

      <NodeResizeHandle
        minWidth={MIN_NODE_WIDTH}
        minHeight={MIN_NODE_HEIGHT}
        maxWidth={MAX_NODE_WIDTH}
        maxHeight={MAX_NODE_HEIGHT}
        isVisible={selected}
      />
      <UiLoadingOverlay
        visible={isGenerating}
        insetClassName="inset-3"
        backdropClassName="bg-transparent"
        variant="bare"
      />
    </div>
  );
});

ScriptSceneNode.displayName = 'ScriptSceneNode';
