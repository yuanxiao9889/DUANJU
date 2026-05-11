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
import { collectConnectedScriptCharacterNotes } from '@/features/canvas/application/scriptCharacterNotes';
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
const SCRIPT_SCENE_NODE_BASE_CLASS =
  'group relative overflow-visible rounded-[20px] border bg-surface-dark shadow-[0_12px_24px_rgba(2,6,23,0.12)] transition-[border-color,box-shadow] duration-200 dark:shadow-[0_14px_28px_rgba(0,0,0,0.24)]';
const SCRIPT_SCENE_NODE_SELECTED_CLASS =
  'border-[rgba(15,23,42,0.42)] dark:border-white/36';
const SCRIPT_SCENE_NODE_IDLE_CLASS =
  'border-[rgba(15,23,42,0.2)] hover:border-[rgba(15,23,42,0.34)] dark:border-white/18 dark:hover:border-white/30';
const SCRIPT_SCENE_HANDLE_CLASS =
  '!h-3 !w-3 !rounded-full !border-surface-dark !bg-[#222222] dark:!bg-text-muted';
const SCRIPT_SCENE_ACTION_BUTTON_CLASS =
  'inline-flex items-center gap-1.5 rounded-lg border border-border-dark bg-bg-dark px-3 py-1.5 text-xs font-medium text-text-dark transition-colors hover:border-[rgba(15,23,42,0.34)] hover:bg-bg-dark/80 dark:hover:border-white/26 disabled:cursor-not-allowed disabled:opacity-60';

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
  const edges = useCanvasStore((state) => state.edges);
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
      const characterNotes = collectConnectedScriptCharacterNotes(id, nodes, edges);
      const nextEpisodes = await generateEpisodesFromSceneNode(data, sourceChapterData, {
        episodeCount: defaultCount,
        sourceDraftLabel: t('script.sceneWorkbench.generatedSourceLabel'),
        storyNotes,
        characterNotes,
      });
      updateNodeData(id, { episodes: nextEpisodes }, { historyMode: 'skip' });
      openWorkbench(nextEpisodes[0]?.id ?? null);
    } catch (error) {
      setGenerationError(normalizeErrorMessage(error));
    } finally {
      setIsGenerating(false);
    }
  }, [data, edges, id, nodes, openWorkbench, sourceChapterData, t, updateNodeData]);

  return (
    <div
      className={`${SCRIPT_SCENE_NODE_BASE_CLASS} ${selected ? SCRIPT_SCENE_NODE_SELECTED_CLASS : SCRIPT_SCENE_NODE_IDLE_CLASS}`}
      style={{ width: resolvedWidth, height: resolvedHeight }}
      onClick={() => openWorkbench(activeSceneNodeId === id ? activeEpisodeId : undefined)}
    >
      <Handle
        type="target"
        id="target"
        position={Position.Left}
        className={`${SCRIPT_SCENE_HANDLE_CLASS} !-left-1.5`}
      />
      <Handle
        type="source"
        id="source"
        position={Position.Right}
        className={`${SCRIPT_SCENE_HANDLE_CLASS} !-right-1.5`}
      />

      <div className="relative flex h-full flex-col overflow-hidden rounded-[20px] p-3">
        <div className="flex items-start gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-text-muted">
              <span className="rounded-full bg-bg-dark px-2 py-0.5">
                {t('script.sceneStudio.chapterLabel', { number: data.chapterNumber || 1 })}
              </span>
              <span className="rounded-full bg-bg-dark px-2 py-0.5">
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
            className={SCRIPT_SCENE_ACTION_BUTTON_CLASS}
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
            className={SCRIPT_SCENE_ACTION_BUTTON_CLASS}
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
            className={SCRIPT_SCENE_ACTION_BUTTON_CLASS}
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
            <Clapperboard className="h-3.5 w-3.5 text-text-muted" />
            {t('script.sceneWorkbench.episodeCount', { count: data.episodes.length })}
          </span>
          {isGenerating ? (
            <span className="text-text-muted">{t('script.sceneWorkbench.generating')}</span>
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
                      ? 'border-[rgba(15,23,42,0.34)] bg-surface-dark dark:border-white/28'
                      : 'border-border-dark bg-bg-dark/45 hover:border-[rgba(15,23,42,0.3)] hover:bg-bg-dark dark:hover:border-white/24'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="truncate text-sm font-medium text-text-dark">
                      {episode.title || t('script.sceneWorkbench.untitledEpisode')}
                    </div>
                    <span className="shrink-0 rounded-full bg-bg-dark px-2 py-0.5 text-[11px] text-text-muted">
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
