import { Fragment, memo, useCallback, useMemo, useRef, useState } from 'react';
import { Handle, Position } from '@xyflow/react';
import { FileText, GitBranch, GitFork, GripHorizontal, Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { UiScrollArea } from '@/components/ui';
import type { SummaryExpandContinuityContext, SummaryExpandRequest } from '@/commands/textGen';
import {
  buildSceneContinuityContext,
  generateSceneContinuityMemory,
  getSortedScriptChapterNodes,
  resolveSceneContinuityMemory,
} from '@/features/canvas/application/sceneContinuity';
import { collectEnabledScriptStoryNotes } from '@/features/canvas/application/scriptStoryNotes';
import { AiWriterDialog } from '@/features/canvas/ui/AiWriterDialog';
import { NodeHeader, NODE_HEADER_FLOATING_POSITION_CLASS } from '@/features/canvas/ui/NodeHeader';
import { NodeResizeHandle } from '@/features/canvas/ui/NodeResizeHandle';
import {
  CANVAS_NODE_TYPES,
  SCRIPT_CHAPTER_NODE_DEFAULT_HEIGHT,
  SCRIPT_CHAPTER_NODE_DEFAULT_WIDTH,
  createDefaultSceneCard,
  normalizeSceneCards,
  normalizeScriptChapterNodeData,
  normalizeScriptRootNodeData,
  type SceneCard,
  type ScriptChapterNodeData,
  type ScriptRootNodeData,
  type ScriptSceneNodeData,
} from '@/features/canvas/domain/canvasNodes';
import { resolveNodeDisplayName } from '@/features/canvas/domain/nodeDisplay';
import { useCanvasNodesByIds } from '@/features/canvas/hooks/useCanvasNodeGraph';
import { useCanvasStore } from '@/stores/canvasStore';
import { useScriptEditorStore } from '@/stores/scriptEditorStore';

function stripHtmlToPlainText(html: string): string {
  const trimmed = html.trim();
  if (!trimmed) {
    return '';
  }

  if (typeof DOMParser !== 'undefined') {
    const parser = new DOMParser();
    const document = parser.parseFromString(trimmed, 'text/html');
    return (document.body.textContent || '')
      .replace(/\u00a0/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  return trimmed
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/p>\s*<p[^>]*>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, '\'')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function summarizeGeneratedSceneDraft(html: string, fallback = ''): string {
  const text = stripHtmlToPlainText(html);
  if (!text) {
    return fallback;
  }

  return text.length > 96
    ? `${text.slice(0, 96).trim()}...`
    : text;
}

function dedupeTrimmedStrings(values: Array<string | undefined | null>, limit = Number.POSITIVE_INFINITY): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const value of values) {
    const trimmed = typeof value === 'string' ? value.trim() : '';
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }

    seen.add(trimmed);
    normalized.push(trimmed);

    if (normalized.length >= limit) {
      break;
    }
  }

  return normalized;
}

function buildChapterHandoffContinuityReference(
  chapterData: ScriptChapterNodeData
): SummaryExpandContinuityContext['relevantMemories'][number] | null {
  const chapterScenes = normalizeSceneCards(chapterData.scenes, chapterData.content);
  const lastScene = chapterScenes[chapterScenes.length - 1];
  if (!lastScene) {
    return null;
  }

  const memory = resolveSceneContinuityMemory(lastScene);
  const chapterLabel = chapterData.title
    || chapterData.displayName
    || `Chapter ${chapterData.chapterNumber ?? ''}`.trim();

  return {
    label: chapterLabel ? `${chapterLabel} / ${memory.label}` : memory.label,
    summary: memory.summary || chapterData.summary || '',
    facts: memory.facts.slice(0, 4),
    openLoops: memory.openLoops.slice(0, 3),
  };
}

function splitGeneratedChapterHtmlIntoScenes(
  html: string,
  fallbackScenes: SceneCard[],
): Array<{ title: string; draftHtml: string; summary: string }> {
  const trimmed = html.trim();
  if (!trimmed) {
    return [];
  }

  if (typeof DOMParser === 'undefined') {
    const fallbackScene = fallbackScenes[0] ?? createDefaultSceneCard(0);
    return [{
      title: fallbackScene.title,
      draftHtml: trimmed,
      summary: summarizeGeneratedSceneDraft(trimmed, fallbackScene.summary),
    }];
  }

  const parser = new DOMParser();
  const document = parser.parseFromString(trimmed, 'text/html');
  const elements = Array.from(document.body.children);
  const sceneDrafts: Array<{ title: string; draftHtml: string; summary: string }> = [];
  let currentTitle = '';
  let currentParts: string[] = [];

  const commitCurrentScene = () => {
    const draftHtml = currentParts.join('').trim();
    if (!draftHtml) {
      return;
    }

    const fallbackScene = fallbackScenes[sceneDrafts.length] ?? createDefaultSceneCard(sceneDrafts.length);
    const summarySource = draftHtml.replace(/^<h[23][^>]*>.*?<\/h[23]>/i, '').trim() || draftHtml;
    sceneDrafts.push({
      title: currentTitle.trim() || fallbackScene.title,
      draftHtml,
      summary: summarizeGeneratedSceneDraft(summarySource, fallbackScene.summary),
    });
  };

  elements.forEach((element) => {
    const tagName = element.tagName.toLowerCase();
    if (tagName === 'h2' || tagName === 'h3') {
      if (currentParts.length > 0) {
        commitCurrentScene();
      }
      currentTitle = (element.textContent || '').trim();
      currentParts = [element.outerHTML];
      return;
    }

    if (tagName === 'hr') {
      return;
    }

    if (currentParts.length === 0) {
      currentTitle = fallbackScenes[sceneDrafts.length]?.title || `Scene ${sceneDrafts.length + 1}`;
    }
    currentParts.push(element.outerHTML);
  });

  if (currentParts.length > 0) {
    commitCurrentScene();
  }

  if (sceneDrafts.length === 0) {
    const fallbackScene = fallbackScenes[0] ?? createDefaultSceneCard(0);
    return [{
      title: fallbackScene.title,
      draftHtml: trimmed,
      summary: summarizeGeneratedSceneDraft(trimmed, fallbackScene.summary),
    }];
  }

  return sceneDrafts;
}

type ScriptChapterNodeProps = {
  id: string;
  data: ScriptChapterNodeData;
  selected?: boolean;
  width?: number;
  height?: number;
};

const DEFAULT_NODE_WIDTH = SCRIPT_CHAPTER_NODE_DEFAULT_WIDTH;
const DEFAULT_NODE_HEIGHT = SCRIPT_CHAPTER_NODE_DEFAULT_HEIGHT;
const MIN_NODE_WIDTH = 320;
const MIN_NODE_HEIGHT = 280;
const MAX_NODE_WIDTH = 800;
const MAX_NODE_HEIGHT = 900;
const EMPTY_NODE_IDS: string[] = [];
export const SCRIPT_CHAPTER_NODE_DRAG_HANDLE_CLASS = 'script-chapter-node__drag-handle';

function resolveNodeDimension(value: number | undefined, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 1) {
    return Math.round(value);
  }
  return fallback;
}

export const ScriptChapterNode = memo(({ id, data, selected, width, height }: ScriptChapterNodeProps) => {
  const { t } = useTranslation();
  const updateNodeData = useCanvasStore((state) => state.updateNodeData);
  const setSelectedNode = useCanvasStore((state) => state.setSelectedNode);
  const nodes = useCanvasStore((state) => state.nodes);
  const edges = useCanvasStore((state) => state.edges);
  const activeChapterId = useScriptEditorStore((state) => state.activeChapterId);
  const activeChapterSceneId = useScriptEditorStore((state) => state.activeChapterSceneId);
  const activeSceneNodeId = useScriptEditorStore((state) => state.activeSceneNodeId);
  const focusChapterScene = useScriptEditorStore((state) => state.focusChapterScene);
  const resolvedTitle = resolveNodeDisplayName(CANVAS_NODE_TYPES.scriptChapter, data);
  const [aiDialogMode, setAiDialogMode] = useState<'expandFromSummary' | 'expandFromMerged' | null>(null);
  const nodeContainerRef = useRef<HTMLDivElement>(null);

  const resolvedWidth = resolveNodeDimension(width, DEFAULT_NODE_WIDTH);
  const resolvedHeight = resolveNodeDimension(height, DEFAULT_NODE_HEIGHT);
  const scenes = useMemo(() => normalizeSceneCards(data.scenes, data.content), [data.content, data.scenes]);
  const mergedBranchNodeIds = data.mergedFromBranches ?? EMPTY_NODE_IDS;
  const mergedBranchNodes = useCanvasNodesByIds(mergedBranchNodeIds);
  const sceneNodeBySceneId = useMemo(() => {
    const nextMap = new Map<string, { id: string; data: ScriptSceneNodeData }>();
    nodes.forEach((node) => {
      if (node.type !== CANVAS_NODE_TYPES.scriptScene) {
        return;
      }

      const sceneNodeData = node.data as ScriptSceneNodeData;
      if (sceneNodeData.sourceChapterId !== id) {
        return;
      }

      nextMap.set(sceneNodeData.sourceSceneId, {
        id: node.id,
        data: sceneNodeData,
      });
    });
    return nextMap;
  }, [id, nodes]);
  const hasMaterializedSceneNodes = sceneNodeBySceneId.size > 0;
  const hasMergedBranches = Boolean(data.mergedFromBranches && data.mergedFromBranches.length > 0);
  const isMergePoint = data.isMergePoint || (hasMergedBranches && (data.mergedFromBranches?.length ?? 0) >= 2);
  const storyRootData = useMemo(() => {
    const incomingSourceIds = new Set(
      edges
        .filter((edge) => edge.target === id)
        .map((edge) => edge.source)
    );
    const connectedRootNode = nodes.find(
      (node) => incomingSourceIds.has(node.id) && node.type === CANVAS_NODE_TYPES.scriptRoot
    );
    const rootNode = connectedRootNode
      ?? nodes.find((node) => node.type === CANVAS_NODE_TYPES.scriptRoot)
      ?? null;

    return rootNode
      ? normalizeScriptRootNodeData(rootNode.data as ScriptRootNodeData)
      : null;
  }, [edges, id, nodes]);
  const adjacentChapterSummaries = useMemo(() => {
    const sortedChapters = getSortedScriptChapterNodes(nodes);
    const currentIndex = sortedChapters.findIndex((node) => node.id === id);
    if (currentIndex < 0) {
      return {
        previousChapterSummary: '',
        nextChapterSummary: '',
      };
    }

    const previousChapter = currentIndex > 0 ? sortedChapters[currentIndex - 1] : null;
    const nextChapter = currentIndex < sortedChapters.length - 1 ? sortedChapters[currentIndex + 1] : null;

    return {
      previousChapterSummary: (previousChapter?.data.summary || '').trim(),
      nextChapterSummary: (nextChapter?.data.summary || '').trim(),
    };
  }, [id, nodes]);
  const chapterContinuityContext = useMemo<SummaryExpandContinuityContext | null>(() => {
    const sortedChapters = getSortedScriptChapterNodes(nodes);
    const currentIndex = sortedChapters.findIndex((node) => node.id === id);
    if (currentIndex < 0) {
      return null;
    }

    const previousChapter = currentIndex > 0 ? sortedChapters[currentIndex - 1] : null;
    const firstScene = scenes[0];
    const baseContext = firstScene
      ? buildSceneContinuityContext({
          nodes,
          currentChapterId: id,
          currentSceneId: firstScene.id,
          currentScene: firstScene,
          storyRoot: storyRootData ?? null,
        })
      : null;
    const primaryHandoff = previousChapter
      ? buildChapterHandoffContinuityReference(previousChapter.data)
      : null;
    const relatedMemories = (baseContext?.relevantMemories ?? [])
      .filter((memory) => !primaryHandoff || (
        memory.label !== primaryHandoff.label || memory.summary !== primaryHandoff.summary
      ))
      .slice(0, 2);
    const guardrails = dedupeTrimmedStrings(baseContext?.guardrails ?? [], 6);

    if (!primaryHandoff && guardrails.length === 0 && relatedMemories.length === 0) {
      return null;
    }

    return {
      guardrails,
      relevantMemories: primaryHandoff ? [primaryHandoff, ...relatedMemories] : relatedMemories,
    };
  }, [id, nodes, scenes, storyRootData]);
  const mergedBranchContents = useMemo(
    () =>
      mergedBranchNodes.map((branchNode) => {
        const branchData = branchNode?.data as ScriptChapterNodeData | undefined;
        const branchLabel = branchData?.chapterNumber && branchData?.branchIndex
          ? `${branchData.chapterNumber}-${branchData.branchIndex}`
          : undefined;
        return {
          title: branchData?.title || '',
          content: branchData?.content || '',
          summary: branchData?.summary || '',
          branchIndex: branchData?.branchIndex,
          chapterNumber: branchData?.chapterNumber,
          branchLabel,
        };
      }),
    [mergedBranchNodes],
  );
  const storyNotes = useMemo(() => collectEnabledScriptStoryNotes(nodes), [nodes]);
  const summaryExpandContext = useMemo<Omit<SummaryExpandRequest, 'instruction'>>(() => ({
    summary: data.summary || '',
    chapterTitle: data.title || resolvedTitle || '未命名章节',
    chapterNumber: data.chapterNumber,
    chapterPurpose: data.chapterPurpose,
    chapterQuestion: data.chapterQuestion,
    scenes: scenes.map((scene) => ({
      title: scene.title,
      summary: scene.summary,
      purpose: scene.purpose,
      povCharacter: scene.povCharacter,
      goal: scene.goal,
      conflict: scene.conflict,
      turn: scene.turn,
      emotionalShift: scene.emotionalShift,
      visualHook: scene.visualHook,
      subtext: scene.subtext,
    })),
    characters: data.characters,
    locations: data.locations,
    items: data.items,
    previousChapterSummary: adjacentChapterSummaries.previousChapterSummary,
    nextChapterSummary: adjacentChapterSummaries.nextChapterSummary,
    continuityContext: chapterContinuityContext,
    storyNotes,
    storyRoot: storyRootData
      ? {
        title: storyRootData.title || storyRootData.displayName || '',
        premise: storyRootData.premise,
        theme: storyRootData.theme,
        protagonist: storyRootData.protagonist,
        want: storyRootData.want,
        stakes: storyRootData.stakes,
        tone: storyRootData.tone,
        directorVision: storyRootData.directorVision,
        beats: storyRootData.beats?.map((beat) => ({
          key: beat.key,
          title: beat.title,
          summary: beat.summary,
          dramaticQuestion: beat.dramaticQuestion,
        })),
        characterLibraryNames: storyRootData.assetLibraryCharacters.map((item) => item.name),
        locationLibraryNames: storyRootData.assetLibraryLocations.map((item) => item.name),
        itemLibraryNames: storyRootData.assetLibraryItems.map((item) => item.name),
      }
      : null,
  }), [
    adjacentChapterSummaries.nextChapterSummary,
    adjacentChapterSummaries.previousChapterSummary,
    chapterContinuityContext,
    data.chapterNumber,
    data.chapterPurpose,
    data.chapterQuestion,
    data.characters,
    data.items,
    data.locations,
    data.summary,
    data.title,
    storyNotes,
    resolvedTitle,
    scenes,
    storyRootData,
  ]);

  const handleTitleChange = useCallback((nextTitle: string) => {
    updateNodeData(id, { displayName: nextTitle });
  }, [id, updateNodeData]);

  const handleAddScene = useCallback(() => {
    const nextScene = createDefaultSceneCard(scenes.length);
    const nextScenes = [...scenes, nextScene];
    updateNodeData(id, {
      scenes: nextScenes,
      sceneHeadings: nextScenes
        .map((scene) => scene.title.trim())
        .filter((value) => value.length > 0),
    });
  }, [id, scenes, updateNodeData]);

  const handleFocusScene = useCallback((sceneId: string) => {
    setSelectedNode(id);
    focusChapterScene(id, sceneId);
  }, [focusChapterScene, id, setSelectedNode]);

  const scheduleHandoffMemoryRefresh = useCallback((sceneId: string, expectedDraftHtml: string) => {
    void (async () => {
      try {
        const initialState = useCanvasStore.getState();
        const initialNode = initialState.nodes.find((node) => node.id === id && node.type === CANVAS_NODE_TYPES.scriptChapter);
        if (!initialNode) {
          return;
        }

        const initialChapter = normalizeScriptChapterNodeData(initialNode.data as ScriptChapterNodeData);
        const initialScenes = normalizeSceneCards(initialChapter.scenes, initialChapter.content);
        const targetScene = initialScenes.find((scene) => scene.id === sceneId);
        if (!targetScene || targetScene.draftHtml.trim() !== expectedDraftHtml.trim()) {
          return;
        }

        const continuityContext = buildSceneContinuityContext({
          nodes: initialState.nodes,
          currentChapterId: id,
          currentSceneId: targetScene.id,
          currentScene: targetScene,
          storyRoot: storyRootData ?? null,
        });
        const memory = await generateSceneContinuityMemory({
          scene: targetScene,
          chapter: initialChapter,
          storyRoot: storyRootData ?? null,
          storyNotes: collectEnabledScriptStoryNotes(initialState.nodes),
          continuityContext,
        });

        const latestState = useCanvasStore.getState();
        const latestNode = latestState.nodes.find((node) => node.id === id && node.type === CANVAS_NODE_TYPES.scriptChapter);
        if (!latestNode) {
          return;
        }

        const latestChapter = normalizeScriptChapterNodeData(latestNode.data as ScriptChapterNodeData);
        const latestScenes = normalizeSceneCards(latestChapter.scenes, latestChapter.content);
        const latestScene = latestScenes.find((scene) => scene.id === sceneId);
        if (!latestScene || latestScene.draftHtml.trim() !== expectedDraftHtml.trim()) {
          return;
        }

        const nextScenes = latestScenes.map((scene) => (
          scene.id === sceneId
            ? {
                ...scene,
                continuitySummary: memory.summary,
                continuityFacts: memory.facts,
                continuityOpenLoops: memory.openLoops,
                continuityUpdatedAt: memory.updatedAt,
                sourceDraftHtml: scene.draftHtml.trim() ? scene.draftHtml : scene.sourceDraftHtml,
                sourceDraftLabel: scene.sourceDraftLabel?.trim() || t('script.sceneWorkbench.generatedSourceLabel'),
              }
            : scene
        ));
        latestState.updateNodeData(id, {
          scenes: nextScenes,
          sceneHeadings: nextScenes
            .map((scene) => scene.title.trim())
            .filter((value) => value.length > 0),
          content: latestChapter.content,
        }, { historyMode: 'skip' });
      } catch (error) {
        console.warn('[ScriptChapterNode] Failed to refresh handoff memory', error);
      }
    })();
  }, [id, storyRootData, t]);

  const handleAiConfirm = useCallback((result: string) => {
    if (aiDialogMode !== 'expandFromSummary' && aiDialogMode !== 'expandFromMerged') {
      return;
    }

    const generatedScenes = splitGeneratedChapterHtmlIntoScenes(result, scenes);
    if (generatedScenes.length > 0) {
      const nextScenes = [
        ...generatedScenes.map((generatedScene, index) => {
          const fallbackScene = scenes[index] ?? createDefaultSceneCard(index);
          return {
            ...fallbackScene,
            order: index,
            title: generatedScene.title || fallbackScene.title,
            summary: generatedScene.summary || fallbackScene.summary,
            draftHtml: generatedScene.draftHtml,
            sourceDraftHtml: generatedScene.draftHtml || fallbackScene.sourceDraftHtml,
            sourceDraftLabel: fallbackScene.sourceDraftLabel?.trim() || t('script.sceneWorkbench.generatedSourceLabel'),
            continuitySummary: '',
            continuityFacts: [],
            continuityOpenLoops: [],
            continuityUpdatedAt: null,
            status: generatedScene.draftHtml.trim() ? 'drafting' : fallbackScene.status,
          };
        }),
        ...scenes.slice(generatedScenes.length).map((scene, index) => ({
          ...scene,
          order: generatedScenes.length + index,
        })),
      ];

      updateNodeData(id, {
        content: result,
        scenes: nextScenes,
        sceneHeadings: nextScenes
          .map((scene) => scene.title.trim())
          .filter((value) => value.length > 0),
      });
      const lastGeneratedScene = nextScenes[generatedScenes.length - 1];
      if (lastGeneratedScene?.draftHtml.trim()) {
        scheduleHandoffMemoryRefresh(lastGeneratedScene.id, lastGeneratedScene.draftHtml);
      }
    } else {
      updateNodeData(id, { content: result });
    }

    setAiDialogMode(null);
  }, [aiDialogMode, id, scheduleHandoffMemoryRefresh, scenes, t, updateNodeData]);

  return (
    <>
      <div
        ref={nodeContainerRef}
        className={`group relative overflow-visible rounded-[18px] border ${
          selected
            ? 'border-amber-500/50 shadow-[0_0_0_1px_rgba(245,158,11,0.35)]'
            : 'border-[rgba(15,23,42,0.2)] dark:border-[rgba(255,255,255,0.26)]'
        }`}
        style={{
          width: `${resolvedWidth}px`,
          height: `${resolvedHeight}px`,
          backgroundColor: 'var(--surface-dark)',
        }}
      >
        <Handle
          type="target"
          id="target"
          position={Position.Left}
          className="!h-2 !w-2 !border-surface-dark !bg-amber-400"
        />
        <NodeHeader
          className={NODE_HEADER_FLOATING_POSITION_CLASS}
          icon={<FileText className="h-4 w-4 text-amber-400" />}
          titleText={resolvedTitle}
          editable
          onTitleChange={handleTitleChange}
        />

        <div className="flex h-full flex-col overflow-hidden">
          <div className="shrink-0 px-3 pt-3">
            <div
                className={`${SCRIPT_CHAPTER_NODE_DRAG_HANDLE_CLASS} flex h-7 items-center justify-center gap-2 rounded-xl border border-amber-500/18 bg-bg-dark text-[11px] text-amber-200/75 transition-colors cursor-grab active:cursor-grabbing hover:border-amber-500/28 hover:bg-surface-dark`}
            >
              <GripHorizontal className="h-3.5 w-3.5" />
              <div className="flex items-center gap-1">
                <span className="h-1 w-1 rounded-full bg-current/80" />
                <span className="h-1 w-1 rounded-full bg-current/80" />
                <span className="h-1 w-1 rounded-full bg-current/80" />
              </div>
            </div>
          </div>

          <div className="nodrag flex min-h-0 flex-1 flex-col overflow-hidden px-3 pb-3 pt-2">
            <div className="shrink-0">
              <div className="flex items-center gap-2">
                <span className={`rounded px-1.5 py-0.5 text-xs ${
                  data.branchType === 'branch'
                    ? 'bg-purple-500/20 text-purple-400'
                    : 'bg-amber-500/20 text-amber-400'
                }`}>
                  {data.branchType === 'branch'
                    ? `${data.chapterNumber || 1}-${data.branchIndex || 1}`
                    : data.chapterNumber || 1}
                </span>
                <input
                  type="text"
                  value={data.title || ''}
                  onChange={(event) => updateNodeData(id, { title: event.target.value })}
                  onMouseDown={(event) => event.stopPropagation()}
                  placeholder={t('script.sceneStudio.untitledChapter')}
                  className="nodrag flex-1 rounded border border-border-dark bg-bg-dark px-2 py-1 text-sm text-text-dark placeholder:text-text-muted focus:border-amber-500 focus:outline-none"
                />
                {data.branchType === 'branch' ? (
                  <span title="Branch chapter">
                    <GitBranch className="h-4 w-4 text-purple-400" />
                  </span>
                ) : null}
              </div>

              {hasMergedBranches ? (
                <div className="mt-1 flex flex-wrap items-center gap-1">
                  <GitFork className="h-3 w-3 text-cyan-400" />
                  <span className="text-xs text-cyan-400">鏉ヨ嚜</span>
                  {mergedBranchContents.filter((branch) => branch.branchLabel).map((branch, index, branches) => (
                    <Fragment key={branch.branchLabel ?? index}>
                      <span className="rounded bg-cyan-500/20 px-1.5 py-0.5 text-xs font-medium text-cyan-400">
                        {branch.branchLabel}
                      </span>
                      {index < branches.length - 1 ? <span className="text-xs text-cyan-400">,</span> : null}
                    </Fragment>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="mt-3 flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border-dark bg-bg-dark p-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-[11px] uppercase tracking-[0.08em] text-text-muted">
                    {t('script.chapterCatalog.title')}
                  </div>
                  <div className="mt-1 text-sm font-medium text-text-dark">
                    {t('script.sceneStudio.sceneCount', { count: scenes.length })}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {data.summary ? (
                    <>
                      {isMergePoint ? (
                        <button
                          type="button"
                          onClick={() => setAiDialogMode('expandFromMerged')}
                          disabled={hasMaterializedSceneNodes}
                          className="flex h-8 w-8 items-center justify-center rounded-lg border border-cyan-500/18 bg-cyan-500/8 text-cyan-300 transition-colors hover:bg-cyan-500/16 disabled:cursor-not-allowed disabled:opacity-45"
                          title={t('script.chapterCatalog.expandFromMerged')}
                        >
                          <GitFork className="h-4 w-4" />
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => setAiDialogMode('expandFromSummary')}
                        disabled={hasMaterializedSceneNodes}
                        className="flex h-8 w-8 items-center justify-center rounded-lg border border-amber-500/20 bg-amber-500/8 text-amber-300 transition-colors hover:bg-amber-500/16 disabled:cursor-not-allowed disabled:opacity-45"
                        title={t('script.chapterCatalog.expandFromSummary')}
                      >
                        <Sparkles className="h-4 w-4" />
                      </button>
                    </>
                  ) : null}
                  <button
                    type="button"
                    onClick={handleAddScene}
                    className="rounded-lg border border-border-dark bg-surface-dark px-2.5 py-1 text-xs text-text-dark transition-colors hover:bg-bg-dark"
                  >
                    {t('script.chapterCatalog.addScene')}
                  </button>
                </div>
              </div>

              <UiScrollArea
                className="mt-3 min-h-0 flex-1"
                viewportClassName="h-full"
                contentClassName="space-y-2 pr-3"
              >
                {scenes.map((scene) => {
                  const sceneNode = sceneNodeBySceneId.get(scene.id);
                  const isFocusedScene = activeChapterId === id && activeChapterSceneId === scene.id;
                  const isActive = isFocusedScene || activeSceneNodeId === sceneNode?.id;

                  return (
                    <button
                      key={scene.id}
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        handleFocusScene(scene.id);
                      }}
                      className={`w-full rounded-lg border px-3 py-2 text-left transition-colors ${
                        isFocusedScene
                          ? 'border-amber-400/35 bg-amber-500/10'
                          : isActive
                            ? 'border-cyan-500/35 bg-cyan-500/10'
                            : sceneNode
                              ? 'border-cyan-500/20 bg-cyan-500/5'
                              : 'border-border-dark bg-surface-dark hover:bg-bg-dark'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium text-text-dark">
                            {scene.title || t('script.sceneStudio.untitledScene')}
                          </div>
                          <div className="mt-1 text-[11px] text-text-muted">
                            {t('script.sceneStudio.sceneLabel', { number: scene.order + 1 })}
                          </div>
                        </div>
                        {sceneNode ? (
                          <div className="shrink-0 rounded-lg border border-cyan-500/25 bg-cyan-500/10 px-2.5 py-1 text-[11px] font-medium text-cyan-200">
                            {t('script.chapterCatalog.created')}
                          </div>
                        ) : null}
                      </div>
                      {sceneNode ? (
                        <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-cyan-200/80">
                          <span>{t('script.chapterCatalog.created')}</span>
                          <span>
                            {t('script.sceneWorkbench.episodeCount', {
                              count: sceneNode.data.episodes.length,
                            })}
                          </span>
                        </div>
                      ) : null}
                    </button>
                  );
                })}
              </UiScrollArea>

              {hasMaterializedSceneNodes && data.summary ? (
                <div className="mt-3 border-t border-border-dark pt-2 text-[11px] leading-5 text-cyan-200/80">
                  {t('script.chapterCatalog.summaryExpandLocked')}
                </div>
              ) : null}
            </div>

            {false ? (
              <button
                type="button"
                onClick={() => undefined}
                className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border border-purple-500/30 bg-purple-500/10 py-2 text-sm text-purple-400 transition-colors hover:bg-purple-500/20"
              >
                <GitBranch className="h-4 w-4" />
                Create branch
              </button>
            ) : null}
          </div>
        </div>

        <Handle
          type="source"
          id="source"
          position={Position.Right}
          className="!h-3 !w-3 !-right-1.5 !top-1/2 !rounded-full !border-surface-dark !bg-purple-400"
        />
        <NodeResizeHandle
          minWidth={MIN_NODE_WIDTH}
          minHeight={MIN_NODE_HEIGHT}
          maxWidth={MAX_NODE_WIDTH}
          maxHeight={MAX_NODE_HEIGHT}
          isVisible={selected}
        />
      </div>

      {aiDialogMode ? (
        <AiWriterDialog
          isOpen
          mode={aiDialogMode}
          originalText={data.summary || ''}
          chapterTitle={summaryExpandContext.chapterTitle}
          chapterNumber={data.chapterNumber}
          summaryExpandContext={aiDialogMode === 'expandFromSummary' ? summaryExpandContext : null}
          mergedBranchContents={hasMergedBranches ? mergedBranchContents : undefined}
          onClose={() => setAiDialogMode(null)}
          onConfirm={handleAiConfirm}
          anchorRef={nodeContainerRef}
          preferredPosition="right"
        />
      ) : null}
    </>
  );
});

ScriptChapterNode.displayName = 'ScriptChapterNode';
