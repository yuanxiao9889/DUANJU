import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Clapperboard,
  FileText,
  Plus,
  RefreshCcw,
  SendHorizonal,
  Sparkles,
  Trash2,
  Wand2,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { UiLoadingAnimation } from '@/components/ui';
import { LazyRichTextEditor } from './LazyRichTextEditor';
import {
  runSceneCopilot,
  type SceneCopilotMode,
} from '@/features/canvas/application/sceneCopilot';
import {
  buildSceneContinuityContext,
  generateSceneContinuityMemory,
  type SceneContinuityContext,
} from '@/features/canvas/application/sceneContinuity';
import { runSceneContinuityCheck } from '@/features/canvas/application/sceneContinuityCheck';
import {
  buildEpisodeTemplateHtml,
  createManualEpisodeCard,
  generateEpisodesFromSceneNode,
  htmlToPlainText,
} from '@/features/canvas/application/sceneEpisodeGenerator';
import {
  CANVAS_NODE_TYPES,
  createDefaultSceneCard,
  normalizeSceneCards,
  type EpisodeCard,
  type SceneContinuityCheck,
  type SceneCopilotMessageMode,
  type SceneCopilotThreadMessage,
  type ScriptChapterNodeData,
  type ScriptRootNodeData,
  type ScriptSceneNodeData,
} from '@/features/canvas/domain/canvasNodes';
import {
  useCanvasFirstNodeByType,
  useCanvasNodeById,
  useCanvasNodesByTypes,
} from '@/features/canvas/hooks/useCanvasNodeGraph';
import { useCanvasStore } from '@/stores/canvasStore';
import { useScriptEditorStore } from '@/stores/scriptEditorStore';

const SCENE_STUDIO_PANEL_WIDTH_STORAGE_KEY = 'scene-studio-panel-width';
const SCENE_STUDIO_PANEL_COLLAPSED_STORAGE_KEY = 'scene-studio-panel-collapsed';
const SCENE_STUDIO_PANEL_DEFAULT_WIDTH = 640;
const SCENE_STUDIO_PANEL_MIN_WIDTH = 440;
const SCENE_STUDIO_PANEL_MAX_WIDTH = 980;
const SCENE_STUDIO_PANEL_COLLAPSED_WIDTH = 52;
const SCENE_STUDIO_SCENE_NODE_TYPES = [CANVAS_NODE_TYPES.scriptScene] as const;
const SCENE_STUDIO_CONTINUITY_NODE_TYPES = [
  CANVAS_NODE_TYPES.scriptChapter,
  CANVAS_NODE_TYPES.scriptScene,
  CANVAS_NODE_TYPES.scriptCharacter,
  CANVAS_NODE_TYPES.scriptLocation,
  CANVAS_NODE_TYPES.scriptItem,
  CANVAS_NODE_TYPES.scriptWorldview,
] as const;

function clampPanelWidth(value: number): number {
  return Math.min(
    SCENE_STUDIO_PANEL_MAX_WIDTH,
    Math.max(SCENE_STUDIO_PANEL_MIN_WIDTH, Math.round(value))
  );
}

function readPanelWidth(): number {
  if (typeof window === 'undefined') {
    return SCENE_STUDIO_PANEL_DEFAULT_WIDTH;
  }

  const raw = Number(window.localStorage.getItem(SCENE_STUDIO_PANEL_WIDTH_STORAGE_KEY));
  if (!Number.isFinite(raw) || raw <= 0) {
    return SCENE_STUDIO_PANEL_DEFAULT_WIDTH;
  }

  return clampPanelWidth(raw);
}

function readPanelCollapsed(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  return window.localStorage.getItem(SCENE_STUDIO_PANEL_COLLAPSED_STORAGE_KEY) === 'true';
}

function parseMultilineItems(text: string): string[] {
  const items: string[] = [];
  const seen = new Set<string>();

  text.split(/\n+/g).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || seen.has(trimmed)) {
      return;
    }

    seen.add(trimmed);
    items.push(trimmed);
  });

  return items;
}

function plainTextToHtml(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) {
    return '';
  }

  return trimmed
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${paragraph
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
      .replace(/\n/g, '<br />')}</p>`)
    .join('');
}

function seedCopilotThread(episode: EpisodeCard): SceneCopilotThreadMessage[] {
  const summary = episode.copilotSummary?.trim() ?? '';
  if (!summary) {
    return [];
  }

  return [
    {
      id: `seed-${episode.id}`,
      role: 'assistant',
      content: summary,
      mode: 'seed',
      createdAt: 0,
    },
  ];
}

function createCopilotMessage(
  role: 'user' | 'assistant',
  content: string,
  mode: SceneCopilotMessageMode
): SceneCopilotThreadMessage {
  return {
    id: `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role,
    content,
    mode,
    createdAt: Date.now(),
  };
}

function buildDefaultChapterContext(sceneNode: ScriptSceneNodeData): ScriptChapterNodeData {
  return {
    displayName: '',
    chapterNumber: sceneNode.chapterNumber,
    title: '',
    content: '',
    summary: '',
    chapterPurpose: '',
    chapterQuestion: '',
    sceneHeadings: [],
    scenes: [],
    characters: [],
    locations: [],
    items: [],
    emotionalShift: '',
    isBranchPoint: false,
    branchType: 'main',
    tables: [],
    plotPoints: [],
    depth: 1,
  };
}

function updateEpisodeList(
  episodes: EpisodeCard[],
  targetEpisodeId: string,
  updater: (episode: EpisodeCard) => EpisodeCard
): EpisodeCard[] {
  return episodes.map((episode) => (
    episode.id === targetEpisodeId ? updater(episode) : episode
  ));
}

function normalizeEpisodeStatus(value: string): EpisodeCard['status'] {
  switch (value) {
    case 'drafting':
    case 'reviewed':
    case 'locked':
      return value;
    case 'idea':
    default:
      return 'idea';
  }
}

function Section({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-border-dark bg-surface-dark/80">
      <div className="flex items-start justify-between gap-3 border-b border-border-dark/80 px-4 py-3">
        <div>
          <div className="text-sm font-semibold text-text-dark">{title}</div>
          {description ? <p className="mt-1 text-xs leading-5 text-text-muted">{description}</p> : null}
        </div>
        {actions ? <div className="shrink-0">{actions}</div> : null}
      </div>
      <div className="px-4 py-4">{children}</div>
    </section>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  multiline = false,
  rows = 3,
  readOnly = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  multiline?: boolean;
  rows?: number;
  readOnly?: boolean;
}) {
  const className =
    'w-full rounded-xl border border-border-dark bg-bg-dark/60 px-3 py-2 text-sm text-text-dark outline-none transition-colors placeholder:text-text-muted/60 focus:border-cyan-500/35';

  return (
    <label className="block">
      <div className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.08em] text-text-muted">
        {label}
      </div>
      {multiline ? (
        <textarea
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className={`${className} resize-none`}
          rows={rows}
          placeholder={placeholder}
          readOnly={readOnly}
        />
      ) : (
        <input
          type="text"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className={className}
          placeholder={placeholder}
          readOnly={readOnly}
        />
      )}
    </label>
  );
}

export function SceneStudioPanel() {
  const { t } = useTranslation();
  const updateNodeData = useCanvasStore((state) => state.updateNodeData);
  const selectedNodeId = useCanvasStore((state) => state.selectedNodeId);
  const setSelectedNode = useCanvasStore((state) => state.setSelectedNode);
  const createScriptSceneNodeFromChapterScene = useCanvasStore(
    (state) => state.createScriptSceneNodeFromChapterScene
  );
  const activeSceneNodeId = useScriptEditorStore((state) => state.activeSceneNodeId);
  const activeEpisodeId = useScriptEditorStore((state) => state.activeEpisodeId);
  const focusSceneNode = useScriptEditorStore((state) => state.focusSceneNode);
  const continuityNodes = useCanvasNodesByTypes(SCENE_STUDIO_CONTINUITY_NODE_TYPES);
  const scriptSceneNodes = useCanvasNodesByTypes(SCENE_STUDIO_SCENE_NODE_TYPES);
  const selectedWorkbenchNode = useCanvasNodeById(selectedNodeId ?? '');
  const rootNode = useCanvasFirstNodeByType(CANVAS_NODE_TYPES.scriptRoot);
  const [panelWidth, setPanelWidth] = useState(() => readPanelWidth());
  const [isPanelCollapsed, setIsPanelCollapsed] = useState(() => readPanelCollapsed());
  const [isPanelResizing, setIsPanelResizing] = useState(false);
  const [copilotInput, setCopilotInput] = useState('');
  const [copilotError, setCopilotError] = useState('');
  const [isCopilotLoading, setIsCopilotLoading] = useState(false);
  const [isContinuityLoading, setIsContinuityLoading] = useState(false);
  const [continuityError, setContinuityError] = useState('');
  const [latestContinuityCheck, setLatestContinuityCheck] = useState<SceneContinuityCheck | null>(null);
  const [isEpisodeGenerating, setIsEpisodeGenerating] = useState(false);
  const [episodeGenerationError, setEpisodeGenerationError] = useState('');
  const panelResizeStateRef = useRef<{ startX: number; startWidth: number } | null>(null);

  const sceneNodeRecord = selectedWorkbenchNode?.type === CANVAS_NODE_TYPES.scriptScene
    ? selectedWorkbenchNode
    : null;
  const sceneNodeData = sceneNodeRecord
    ? sceneNodeRecord.data as ScriptSceneNodeData
    : null;
  const sceneNodeId = sceneNodeRecord?.id ?? null;
  const chapterNodeRecord = selectedWorkbenchNode?.type === CANVAS_NODE_TYPES.scriptChapter
    ? selectedWorkbenchNode
    : null;
  const chapterNodeData = chapterNodeRecord
    ? chapterNodeRecord.data as ScriptChapterNodeData
    : null;
  const chapterNodeId = chapterNodeRecord?.id ?? null;
  const sourceChapterNode = useCanvasNodeById(sceneNodeData?.sourceChapterId ?? '');
  const sourceChapterData = sourceChapterNode?.type === CANVAS_NODE_TYPES.scriptChapter
    ? sourceChapterNode.data as ScriptChapterNodeData
    : null;
  const rootData = rootNode?.type === CANVAS_NODE_TYPES.scriptRoot
    ? rootNode.data as ScriptRootNodeData
    : null;
  const chapterScenes = useMemo(() => {
    if (!chapterNodeData) {
      return [];
    }

    return normalizeSceneCards(chapterNodeData.scenes, chapterNodeData.content)
      .slice()
      .sort((left, right) => left.order - right.order);
  }, [chapterNodeData?.content, chapterNodeData?.scenes]);
  const chapterSceneNodeBySceneId = useMemo(() => {
    if (!chapterNodeId) {
      return new Map<string, { id: string; data: ScriptSceneNodeData }>();
    }

    const nextMap = new Map<string, { id: string; data: ScriptSceneNodeData }>();
    scriptSceneNodes.forEach((node) => {
      if (node.type !== CANVAS_NODE_TYPES.scriptScene) {
        return;
      }

      const nodeData = node.data as ScriptSceneNodeData;
      if (nodeData.sourceChapterId !== chapterNodeId) {
        return;
      }

      nextMap.set(nodeData.sourceSceneId, {
        id: node.id,
        data: nodeData,
      });
    });
    return nextMap;
  }, [chapterNodeId, scriptSceneNodes]);
  const isChapterMode = chapterNodeData !== null;
  const isSceneMode = sceneNodeData !== null;

  const selectedEpisode = useMemo(() => {
    if (!sceneNodeData) {
      return null;
    }

    if (activeEpisodeId) {
      const matchedEpisode = sceneNodeData.episodes.find((episode) => episode.id === activeEpisodeId);
      if (matchedEpisode) {
        return matchedEpisode;
      }
    }

    return sceneNodeData.episodes[0] ?? null;
  }, [activeEpisodeId, sceneNodeData]);

  const chapterContext = useMemo(
    () => sourceChapterData ?? (sceneNodeData ? buildDefaultChapterContext(sceneNodeData) : null),
    [sceneNodeData, sourceChapterData]
  );

  const currentCopilotMessages = useMemo(() => {
    if (!selectedEpisode) {
      return [];
    }

    if (selectedEpisode.copilotThread?.length) {
      return selectedEpisode.copilotThread;
    }

    return seedCopilotThread(selectedEpisode);
  }, [selectedEpisode]);

  const continuityContext = useMemo<SceneContinuityContext | null>(() => {
    if (!sceneNodeData || !selectedEpisode) {
      return null;
    }

    return buildSceneContinuityContext({
      nodes: continuityNodes,
      currentChapterId: sceneNodeData.sourceChapterId,
      currentSceneId: selectedEpisode.id,
      currentScene: selectedEpisode,
      storyRoot: rootData ?? null,
    });
  }, [continuityNodes, rootData, sceneNodeData, selectedEpisode]);

  useEffect(() => {
    if (!sceneNodeData || !sceneNodeId) {
      return;
    }

    const fallbackEpisodeId = selectedEpisode?.id ?? null;
    if (activeSceneNodeId === sceneNodeId && activeEpisodeId === fallbackEpisodeId) {
      return;
    }

    focusSceneNode(sceneNodeId, fallbackEpisodeId);
  }, [activeEpisodeId, activeSceneNodeId, focusSceneNode, sceneNodeData, sceneNodeId, selectedEpisode]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(SCENE_STUDIO_PANEL_WIDTH_STORAGE_KEY, String(panelWidth));
  }, [panelWidth]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(
      SCENE_STUDIO_PANEL_COLLAPSED_STORAGE_KEY,
      isPanelCollapsed ? 'true' : 'false'
    );
  }, [isPanelCollapsed]);

  useEffect(() => {
    if (!isPanelResizing) {
      return;
    }

    const handlePointerMove = (event: PointerEvent) => {
      const resizeState = panelResizeStateRef.current;
      if (!resizeState) {
        return;
      }

      const nextWidth = clampPanelWidth(resizeState.startWidth + (resizeState.startX - event.clientX));
      setPanelWidth(nextWidth);
    };

    const handlePointerUp = () => {
      panelResizeStateRef.current = null;
      setIsPanelResizing(false);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [isPanelResizing]);

  const updateScenePatch = useCallback((patch: Partial<ScriptSceneNodeData>) => {
    if (!sceneNodeData || !sceneNodeId) {
      return;
    }

    updateNodeData(sceneNodeId, patch, { historyMode: 'skip' });
  }, [sceneNodeData, sceneNodeId, updateNodeData]);

  const updateChapterPatch = useCallback((patch: Partial<ScriptChapterNodeData>) => {
    if (!chapterNodeData || !chapterNodeId) {
      return;
    }

    updateNodeData(chapterNodeId, patch, { historyMode: 'skip' });
  }, [chapterNodeData, chapterNodeId, updateNodeData]);

  const handleAddChapterScene = useCallback(() => {
    if (!chapterNodeId || !chapterNodeData) {
      return;
    }

    const nextScene = createDefaultSceneCard(chapterScenes.length);
    const nextScenes = [...chapterScenes, nextScene];
    updateNodeData(chapterNodeId, {
      scenes: nextScenes,
      sceneHeadings: nextScenes
        .map((scene) => scene.title.trim())
        .filter((value) => value.length > 0),
    }, { historyMode: 'skip' });
  }, [chapterNodeData, chapterNodeId, chapterScenes, updateNodeData]);

  const handleOpenChapterSceneNode = useCallback((sceneId: string) => {
    if (!chapterNodeId) {
      return;
    }

    const nextSceneNodeId = createScriptSceneNodeFromChapterScene(chapterNodeId, sceneId);
    if (!nextSceneNodeId) {
      return;
    }

    const storeState = useCanvasStore.getState();
    const selectionChanges = storeState.nodes
      .filter((node) => node.selected || node.id === nextSceneNodeId)
      .map((node) => ({
        id: node.id,
        type: 'select' as const,
        selected: node.id === nextSceneNodeId,
      }));
    if (selectionChanges.length > 0) {
      storeState.onNodesChange(selectionChanges);
    } else {
      setSelectedNode(nextSceneNodeId);
    }

    const createdSceneNode = storeState.nodes.find(
      (node) => node.id === nextSceneNodeId && node.type === CANVAS_NODE_TYPES.scriptScene
    );
    const createdSceneData = createdSceneNode?.data as ScriptSceneNodeData | undefined;

    focusSceneNode(nextSceneNodeId, createdSceneData?.episodes[0]?.id ?? null);
  }, [
    chapterNodeId,
    createScriptSceneNodeFromChapterScene,
    focusSceneNode,
    setSelectedNode,
  ]);

  const updateSelectedEpisode = useCallback((patch: Partial<EpisodeCard>) => {
    if (!sceneNodeData || !sceneNodeId || !selectedEpisode) {
      return;
    }

    const nextEpisodes = updateEpisodeList(sceneNodeData.episodes, selectedEpisode.id, (episode) => ({
      ...episode,
      ...patch,
    }));
    updateNodeData(sceneNodeId, { episodes: nextEpisodes }, { historyMode: 'skip' });
  }, [sceneNodeData, sceneNodeId, selectedEpisode, updateNodeData]);

  const handleAddEpisode = useCallback(() => {
    if (!sceneNodeData || !sceneNodeId) {
      return;
    }

    const nextEpisode = createManualEpisodeCard(sceneNodeData.episodes.length);
    const nextEpisodes = [...sceneNodeData.episodes, nextEpisode];
    updateNodeData(sceneNodeId, { episodes: nextEpisodes }, { historyMode: 'skip' });
    focusSceneNode(sceneNodeId, nextEpisode.id);
  }, [focusSceneNode, sceneNodeData, sceneNodeId, updateNodeData]);

  const handleDeleteEpisode = useCallback((episodeId: string) => {
    if (!sceneNodeData || !sceneNodeId) {
      return;
    }

    const nextEpisodes = sceneNodeData.episodes.filter((episode) => episode.id !== episodeId);
    updateNodeData(sceneNodeId, { episodes: nextEpisodes }, { historyMode: 'skip' });
    focusSceneNode(sceneNodeId, nextEpisodes[0]?.id ?? null);
  }, [focusSceneNode, sceneNodeData, sceneNodeId, updateNodeData]);

  const handleGenerateEpisodes = useCallback(async (mode: 'initial' | 'regenerate') => {
    if (!sceneNodeData || !sceneNodeId || !chapterContext) {
      return;
    }

    setEpisodeGenerationError('');
    setIsEpisodeGenerating(true);
    try {
      const defaultCount = mode === 'regenerate'
        ? Math.max(1, sceneNodeData.episodes.length || 3)
        : Math.max(3, sceneNodeData.episodes.length);
      const nextEpisodes = await generateEpisodesFromSceneNode(sceneNodeData, chapterContext, {
        episodeCount: defaultCount,
        sourceDraftLabel: t('script.sceneWorkbench.generatedSourceLabel'),
      });
      updateNodeData(sceneNodeId, { episodes: nextEpisodes }, { historyMode: 'skip' });
      focusSceneNode(sceneNodeId, nextEpisodes[0]?.id ?? null);
    } catch (error) {
      setEpisodeGenerationError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsEpisodeGenerating(false);
    }
  }, [chapterContext, focusSceneNode, sceneNodeData, sceneNodeId, t, updateNodeData]);

  const handleRunCopilot = useCallback(async (
    mode: SceneCopilotMode,
    userPrompt?: string
  ) => {
    if (!selectedEpisode || !chapterContext) {
      return;
    }

    setCopilotError('');
    setIsCopilotLoading(true);
    try {
      const response = await runSceneCopilot({
        mode,
        userPrompt,
        scene: selectedEpisode,
        chapter: chapterContext,
        storyRoot: rootData ?? null,
        history: currentCopilotMessages,
        continuityContext,
      });

      const nextMessages = [
        ...currentCopilotMessages,
        ...(userPrompt?.trim()
          ? [createCopilotMessage('user', userPrompt.trim(), mode)]
          : []),
        createCopilotMessage('assistant', response, mode),
      ];

      if (mode === 'continue') {
        const currentText = htmlToPlainText(selectedEpisode.draftHtml);
        const nextDraft = plainTextToHtml(
          [currentText, response].filter((value) => value.length > 0).join('\n\n')
        );
        updateSelectedEpisode({
          draftHtml: nextDraft,
          status: nextDraft.trim() ? 'drafting' : selectedEpisode.status,
          copilotThread: nextMessages,
          copilotSummary: response,
        });
      } else {
        updateSelectedEpisode({
          copilotThread: nextMessages,
          copilotSummary: response,
        });
      }
    } catch (error) {
      setCopilotError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsCopilotLoading(false);
    }
  }, [
    chapterContext,
    continuityContext,
    currentCopilotMessages,
    rootData,
    selectedEpisode,
    updateSelectedEpisode,
  ]);

  const handleRewriteEpisode = useCallback(async () => {
    if (!selectedEpisode || !chapterContext) {
      return;
    }

    setCopilotError('');
    setIsCopilotLoading(true);
    try {
      const rewrittenText = await runSceneCopilot({
        mode: 'selection',
        userPrompt: t('script.sceneWorkbench.defaultRewritePrompt'),
        selectionText: htmlToPlainText(selectedEpisode.draftHtml),
        scene: selectedEpisode,
        chapter: chapterContext,
        storyRoot: rootData ?? null,
        history: currentCopilotMessages,
        continuityContext,
      });

      const nextDraftHtml = plainTextToHtml(rewrittenText);
      const nextMessages = [
        ...currentCopilotMessages,
        createCopilotMessage('user', t('script.sceneWorkbench.defaultRewritePrompt'), 'selection'),
        createCopilotMessage('assistant', rewrittenText, 'selection'),
      ];

      updateSelectedEpisode({
        draftHtml: nextDraftHtml || buildEpisodeTemplateHtml({ plot: rewrittenText }),
        status: rewrittenText.trim() ? 'drafting' : selectedEpisode.status,
        copilotThread: nextMessages,
        copilotSummary: rewrittenText,
      });
    } catch (error) {
      setCopilotError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsCopilotLoading(false);
    }
  }, [
    chapterContext,
    continuityContext,
    currentCopilotMessages,
    rootData,
    selectedEpisode,
    t,
    updateSelectedEpisode,
  ]);

  const handleSendCopilotInput = useCallback(async () => {
    const prompt = copilotInput.trim();
    if (!prompt) {
      return;
    }

    await handleRunCopilot('custom', prompt);
    setCopilotInput('');
  }, [copilotInput, handleRunCopilot]);

  const handleRefreshContinuityMemory = useCallback(async () => {
    if (!selectedEpisode || !chapterContext) {
      return;
    }

    setContinuityError('');
    setIsContinuityLoading(true);
    try {
      const memory = await generateSceneContinuityMemory({
        scene: selectedEpisode,
        chapter: chapterContext,
        storyRoot: rootData ?? null,
        continuityContext,
      });
      updateSelectedEpisode({
        continuitySummary: memory.summary,
        continuityFacts: memory.facts,
        continuityOpenLoops: memory.openLoops,
        continuityUpdatedAt: memory.updatedAt,
      });
    } catch (error) {
      setContinuityError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsContinuityLoading(false);
    }
  }, [
    chapterContext,
    continuityContext,
    rootData,
    selectedEpisode,
    updateSelectedEpisode,
  ]);

  const handleRunContinuityCheck = useCallback(async () => {
    if (!selectedEpisode || !chapterContext) {
      return;
    }

    setContinuityError('');
    setIsContinuityLoading(true);
    try {
      const check = await runSceneContinuityCheck({
        candidateText: htmlToPlainText(selectedEpisode.draftHtml),
        candidateLabel: t('script.sceneWorkbench.currentDraftLabel'),
        scene: selectedEpisode,
        chapter: chapterContext,
        storyRoot: rootData ?? null,
        continuityContext,
      });
      setLatestContinuityCheck(check);
    } catch (error) {
      setContinuityError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsContinuityLoading(false);
    }
  }, [
    chapterContext,
    continuityContext,
    rootData,
    selectedEpisode,
    t,
  ]);

  const panelWidthStyle = isPanelCollapsed ? SCENE_STUDIO_PANEL_COLLAPSED_WIDTH : panelWidth;

  return (
    <aside
      className="relative z-20 h-full shrink-0 border-l border-border-dark bg-bg-dark/92 backdrop-blur"
      style={{ width: panelWidthStyle }}
    >
      <div
        className={`absolute left-0 top-0 h-full w-1 cursor-col-resize transition-colors ${
          isPanelCollapsed ? 'pointer-events-none opacity-0' : 'hover:bg-cyan-500/25'
        }`}
        onPointerDown={(event) => {
          if (isPanelCollapsed) {
            return;
          }

          panelResizeStateRef.current = {
            startX: event.clientX,
            startWidth: panelWidth,
          };
          setIsPanelResizing(true);
        }}
      />

      <div className="flex h-full flex-col">
        <div className="flex items-center justify-between gap-3 border-b border-border-dark px-3 py-3">
          {isPanelCollapsed ? (
            <button
              type="button"
              onClick={() => setIsPanelCollapsed(false)}
              className="flex h-9 w-9 items-center justify-center rounded-xl border border-border-dark bg-surface-dark text-text-dark transition-colors hover:bg-bg-dark"
              title={t('script.sceneStudio.panelExpand')}
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
          ) : (
            <>
              <div className="min-w-0">
                <div className="text-sm font-semibold text-text-dark">
                  {isSceneMode ? t('script.sceneWorkbench.title') : t('script.sceneStudio.title')}
                </div>
                <p className="mt-1 text-xs leading-5 text-text-muted">
                  {isSceneMode
                    ? t('script.sceneWorkbench.subtitle')
                    : isChapterMode
                      ? t('script.sceneStudio.subtitle')
                      : t('script.sceneStudio.emptyHint')}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsPanelCollapsed(true)}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border-dark bg-surface-dark text-text-dark transition-colors hover:bg-bg-dark"
                title={t('script.sceneStudio.panelCollapse')}
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </>
          )}
        </div>

        {isPanelCollapsed ? null : chapterNodeData ? (
          <div className="ui-scrollbar flex-1 overflow-y-auto px-3 py-3">
            <div className="space-y-3">
              <Section
                title={t('script.sceneStudio.chapterFocusTitle')}
                description={t('script.sceneStudio.chapterFocusSubtitle')}
              >
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <Field
                      label={t('script.sceneStudio.chapterLabel', { number: chapterNodeData.chapterNumber || 1 })}
                      value={chapterNodeData.title || chapterNodeData.displayName || ''}
                      onChange={(value) => updateChapterPatch({ title: value, displayName: value })}
                      placeholder={t('script.sceneStudio.untitledChapter')}
                    />
                    <Field
                      label={t('script.sceneStudio.chapterQuestion')}
                      value={chapterNodeData.chapterQuestion ?? ''}
                      onChange={(value) => updateChapterPatch({ chapterQuestion: value })}
                      placeholder={t('script.sceneStudio.chapterQuestionPlaceholder')}
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <Field
                      label={t('script.sceneStudio.chapterSummary')}
                      value={chapterNodeData.summary}
                      onChange={(value) => updateChapterPatch({ summary: value })}
                      placeholder={t('script.sceneStudio.chapterSummaryPlaceholder')}
                      multiline
                      rows={3}
                    />
                    <Field
                      label={t('script.sceneStudio.chapterPurpose')}
                      value={chapterNodeData.chapterPurpose ?? ''}
                      onChange={(value) => updateChapterPatch({ chapterPurpose: value })}
                      placeholder={t('script.sceneStudio.chapterPurposePlaceholder')}
                      multiline
                      rows={3}
                    />
                  </div>

                  <Field
                    label={t('script.sceneStudio.emotionalShift')}
                    value={chapterNodeData.emotionalShift}
                    onChange={(value) => updateChapterPatch({ emotionalShift: value })}
                    placeholder={t('script.sceneStudio.emotionalShiftPlaceholder')}
                    multiline
                    rows={2}
                  />

                  <div>
                    <div className="mb-2 text-[11px] font-medium uppercase tracking-[0.08em] text-text-muted">
                      {t('script.sceneStudio.chapterDraft')}
                    </div>
                    <div className="h-[260px] rounded-2xl border border-border-dark bg-bg-dark/40 p-2">
                      <LazyRichTextEditor
                        content={chapterNodeData.content}
                        onChange={(content) => updateChapterPatch({ content })}
                        placeholder={t('script.sceneStudio.chapterDraftPlaceholder')}
                        className="h-full"
                      />
                    </div>
                  </div>
                </div>
              </Section>

              <Section
                title={t('script.chapterCatalog.title')}
                actions={(
                  <button
                    type="button"
                    onClick={handleAddChapterScene}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-border-dark bg-bg-dark px-3 py-1.5 text-xs font-medium text-text-dark transition-colors hover:bg-bg-dark/80"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    {t('script.chapterCatalog.addScene')}
                  </button>
                )}
              >
                <div className="space-y-2">
                  {chapterScenes.map((scene) => {
                    const sceneNode = chapterSceneNodeBySceneId.get(scene.id);
                    const isActive = activeSceneNodeId === sceneNode?.id;
                    const previewText = htmlToPlainText(
                      scene.summary || scene.visualHook || scene.draftHtml
                    ) || t('script.sceneCatalog.emptySummary');

                    return (
                      <div
                        key={scene.id}
                        className={`rounded-xl border px-3 py-3 transition-colors ${
                          isActive
                            ? 'border-cyan-400/35 bg-cyan-500/10'
                            : sceneNode
                              ? 'border-cyan-500/20 bg-cyan-500/5'
                              : 'border-border-dark bg-bg-dark/35'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-200">
                                {t('script.sceneCatalog.sceneLabel', { number: scene.order + 1 })}
                              </span>
                              <span className="truncate text-sm font-medium text-text-dark">
                                {scene.title || t('script.sceneStudio.untitledScene')}
                              </span>
                            </div>
                            <p className="mt-1 line-clamp-2 text-xs leading-5 text-text-muted">
                              {previewText}
                            </p>
                            {sceneNode ? (
                              <div className="mt-2 text-[11px] text-cyan-200/80">
                                {t('script.sceneWorkbench.episodeCount', {
                                  count: sceneNode.data.episodes.length,
                                })}
                              </div>
                            ) : null}
                          </div>
                          <button
                            type="button"
                            onClick={() => handleOpenChapterSceneNode(scene.id)}
                            className={`shrink-0 rounded-lg border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                              sceneNode
                                ? 'border-cyan-500/35 bg-cyan-500/10 text-cyan-200 hover:bg-cyan-500/18'
                                : 'border-amber-500/35 bg-amber-500/10 text-amber-300 hover:bg-amber-500/18'
                            }`}
                          >
                            {sceneNode
                              ? t('script.chapterCatalog.openEpisodes')
                              : t('script.chapterCatalog.generateNode')}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </Section>
            </div>
          </div>
        ) : !sceneNodeData ? (
          <div className="flex flex-1 items-center justify-center px-6 text-center">
            <div>
              <div className="text-base font-semibold text-text-dark">
                {t('script.sceneStudio.emptyTitle')}
              </div>
              <p className="mt-2 text-sm leading-6 text-text-muted">
                {t('script.sceneStudio.emptyHint')}
              </p>
            </div>
          </div>
        ) : (
          <div className="ui-scrollbar flex-1 overflow-y-auto px-3 py-3">
            <div className="space-y-3">
              <Section
                title={t('script.sceneWorkbench.sceneCardTitle')}
                description={t('script.sceneWorkbench.sceneCardSubtitle')}
                actions={(
                  <button
                    type="button"
                    onClick={() => void handleGenerateEpisodes(sceneNodeData.episodes.length > 0 ? 'regenerate' : 'initial')}
                    disabled={isEpisodeGenerating || !chapterContext}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-teal-500/30 bg-teal-500/10 px-3 py-1.5 text-xs font-medium text-teal-200 transition-colors hover:bg-teal-500/18 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {sceneNodeData.episodes.length > 0 ? (
                      <RefreshCcw className="h-3.5 w-3.5" />
                    ) : (
                      <Sparkles className="h-3.5 w-3.5" />
                    )}
                    {sceneNodeData.episodes.length > 0
                      ? t('script.sceneWorkbench.regenerateEpisodes')
                      : t('script.sceneWorkbench.generateEpisodes')}
                  </button>
                )}
              >
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <Field
                      label={t('script.sceneStudio.chapterLabel', { number: sceneNodeData.chapterNumber || 1 })}
                      value={sourceChapterData?.title || sourceChapterData?.displayName || ''}
                      onChange={() => {}}
                      placeholder=""
                      readOnly
                    />
                    <Field
                      label={t('script.sceneCatalog.sceneLabel', { number: sceneNodeData.sourceSceneOrder + 1 })}
                      value={sceneNodeData.title}
                      onChange={(value) => updateScenePatch({ title: value, displayName: value })}
                      placeholder={t('script.sceneStudio.untitledScene')}
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <Field
                      label={t('script.sceneStudio.chapterSummary')}
                      value={sceneNodeData.summary}
                      onChange={(value) => updateScenePatch({ summary: value })}
                      placeholder={t('script.sceneWorkbench.sceneSummaryPlaceholder')}
                      multiline
                      rows={3}
                    />
                    <Field
                      label={t('script.sceneStudio.chapterPurpose')}
                      value={sceneNodeData.purpose}
                      onChange={(value) => updateScenePatch({ purpose: value })}
                      placeholder={t('script.sceneWorkbench.scenePurposePlaceholder')}
                      multiline
                      rows={3}
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <Field
                      label={t('script.sceneWorkbench.pov')}
                      value={sceneNodeData.povCharacter}
                      onChange={(value) => updateScenePatch({ povCharacter: value })}
                      placeholder={t('script.sceneWorkbench.povPlaceholder')}
                    />
                    <Field
                      label={t('script.sceneStudio.sceneGoal')}
                      value={sceneNodeData.goal}
                      onChange={(value) => updateScenePatch({ goal: value })}
                      placeholder={t('script.sceneWorkbench.goalPlaceholder')}
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <Field
                      label={t('script.sceneStudio.sceneConflict')}
                      value={sceneNodeData.conflict}
                      onChange={(value) => updateScenePatch({ conflict: value })}
                      placeholder={t('script.sceneWorkbench.conflictPlaceholder')}
                    />
                    <Field
                      label={t('script.sceneStudio.sceneTurn')}
                      value={sceneNodeData.turn}
                      onChange={(value) => updateScenePatch({ turn: value })}
                      placeholder={t('script.sceneWorkbench.turnPlaceholder')}
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <Field
                      label={t('script.sceneStudio.sceneEmotionalShift')}
                      value={sceneNodeData.emotionalShift}
                      onChange={(value) => updateScenePatch({ emotionalShift: value })}
                      placeholder={t('script.sceneWorkbench.emotionPlaceholder')}
                    />
                    <Field
                      label={t('script.sceneStudio.sceneVisualHook')}
                      value={sceneNodeData.visualHook}
                      onChange={(value) => updateScenePatch({ visualHook: value })}
                      placeholder={t('script.sceneWorkbench.visualHookPlaceholder')}
                    />
                  </div>

                  <Field
                    label={t('script.sceneStudio.sceneSubtext')}
                    value={sceneNodeData.subtext}
                    onChange={(value) => updateScenePatch({ subtext: value })}
                    placeholder={t('script.sceneWorkbench.subtextPlaceholder')}
                    multiline
                    rows={2}
                  />

                  <div>
                    <div className="mb-2 text-[11px] font-medium uppercase tracking-[0.08em] text-text-muted">
                      {t('script.sceneWorkbench.sceneSourceTitle')}
                    </div>
                    <div className="h-[220px] rounded-2xl border border-border-dark bg-bg-dark/40 p-2">
                      <LazyRichTextEditor
                        content={sceneNodeData.draftHtml}
                        onChange={(content) => updateScenePatch({ draftHtml: content })}
                        placeholder={t('script.sceneWorkbench.sceneSourcePlaceholder')}
                        className="h-full"
                      />
                    </div>
                  </div>

                  {episodeGenerationError ? (
                    <div className="rounded-xl border border-red-400/20 bg-red-500/8 px-3 py-2 text-xs leading-5 text-red-200">
                      {episodeGenerationError}
                    </div>
                  ) : null}
                </div>
              </Section>

              <Section
                title={t('script.sceneWorkbench.episodeWorkbench')}
                description={t('script.sceneWorkbench.episodeWorkbenchSubtitle')}
                actions={(
                  <button
                    type="button"
                    onClick={handleAddEpisode}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-border-dark bg-bg-dark px-3 py-1.5 text-xs font-medium text-text-dark transition-colors hover:bg-bg-dark/80"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    {t('script.sceneWorkbench.addEpisode')}
                  </button>
                )}
              >
                <div className="space-y-2">
                  {sceneNodeData.episodes.length > 0 ? (
                    sceneNodeData.episodes.map((episode) => {
                      const isActive = selectedEpisode?.id === episode.id;
                      const previewText = htmlToPlainText(episode.draftHtml || episode.summary);

                      return (
                        <div
                          key={episode.id}
                          className={`rounded-xl border px-3 py-3 transition-colors ${
                            isActive
                              ? 'border-cyan-400/35 bg-cyan-500/10'
                              : 'border-border-dark bg-bg-dark/35'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <button
                              type="button"
                              onClick={() => {
                                if (!sceneNodeId) {
                                  return;
                                }
                                focusSceneNode(sceneNodeId, episode.id);
                              }}
                              className="min-w-0 flex-1 text-left"
                            >
                              <div className="flex items-center gap-2">
                                <span className="rounded-full bg-cyan-500/10 px-2 py-0.5 text-[11px] text-cyan-200">
                                  {`${sceneNodeData.chapterNumber || 1}-${episode.episodeNumber}`}
                                </span>
                                <span className="truncate text-sm font-medium text-text-dark">
                                  {episode.title || t('script.sceneWorkbench.untitledEpisode')}
                                </span>
                              </div>
                              <p className="mt-1 line-clamp-2 text-xs leading-5 text-text-muted">
                                {previewText || t('script.sceneWorkbench.emptyEpisodePreview')}
                              </p>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteEpisode(episode.id)}
                              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-transparent text-text-muted transition-colors hover:border-red-400/25 hover:bg-red-500/10 hover:text-red-200"
                              title={t('common.delete')}
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <div className="rounded-xl border border-dashed border-border-dark/70 bg-bg-dark/35 px-3 py-5 text-center text-xs text-text-muted">
                      {isEpisodeGenerating ? (
                        <div className="flex items-center justify-center gap-2">
                          <UiLoadingAnimation size="sm" />
                          <span>{t('script.sceneWorkbench.generating')}</span>
                        </div>
                      ) : (
                        t('script.sceneWorkbench.emptyEpisodes')
                      )}
                    </div>
                  )}
                </div>
              </Section>
              {selectedEpisode ? (
                <>
                  <Section
                    title={t('script.sceneWorkbench.episodeBlueprint')}
                    description={t('script.sceneWorkbench.episodeBlueprintSubtitle')}
                  >
                    <div className="space-y-3">
                      <div className="grid grid-cols-2 gap-3">
                        <Field
                          label={t('script.sceneWorkbench.episodeTitle')}
                          value={selectedEpisode.title}
                          onChange={(value) => updateSelectedEpisode({ title: value })}
                          placeholder={t('script.sceneWorkbench.untitledEpisode')}
                        />
                        <Field
                          label={t('script.sceneWorkbench.status')}
                          value={selectedEpisode.status}
                          onChange={(value) => updateSelectedEpisode({ status: normalizeEpisodeStatus(value) })}
                          placeholder="idea / drafting / reviewed / locked"
                        />
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <Field
                          label={t('script.sceneStudio.chapterSummary')}
                          value={selectedEpisode.summary}
                          onChange={(value) => updateSelectedEpisode({ summary: value })}
                          placeholder={t('script.sceneWorkbench.episodeSummaryPlaceholder')}
                          multiline
                          rows={3}
                        />
                        <Field
                          label={t('script.sceneStudio.chapterPurpose')}
                          value={selectedEpisode.purpose}
                          onChange={(value) => updateSelectedEpisode({ purpose: value })}
                          placeholder={t('script.sceneWorkbench.episodePurposePlaceholder')}
                          multiline
                          rows={3}
                        />
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <Field
                          label={t('script.sceneStudio.sceneGoal')}
                          value={selectedEpisode.goal}
                          onChange={(value) => updateSelectedEpisode({ goal: value })}
                          placeholder={t('script.sceneWorkbench.goalPlaceholder')}
                        />
                        <Field
                          label={t('script.sceneStudio.sceneConflict')}
                          value={selectedEpisode.conflict}
                          onChange={(value) => updateSelectedEpisode({ conflict: value })}
                          placeholder={t('script.sceneWorkbench.conflictPlaceholder')}
                        />
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <Field
                          label={t('script.sceneStudio.sceneTurn')}
                          value={selectedEpisode.turn}
                          onChange={(value) => updateSelectedEpisode({ turn: value })}
                          placeholder={t('script.sceneWorkbench.turnPlaceholder')}
                        />
                        <Field
                          label={t('script.sceneStudio.sceneEmotionalShift')}
                          value={selectedEpisode.emotionalShift}
                          onChange={(value) => updateSelectedEpisode({ emotionalShift: value })}
                          placeholder={t('script.sceneWorkbench.emotionPlaceholder')}
                        />
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <Field
                          label={t('script.sceneStudio.sceneVisualHook')}
                          value={selectedEpisode.visualHook}
                          onChange={(value) => updateSelectedEpisode({ visualHook: value })}
                          placeholder={t('script.sceneWorkbench.visualHookPlaceholder')}
                        />
                        <Field
                          label={t('script.sceneWorkbench.pov')}
                          value={selectedEpisode.povCharacter}
                          onChange={(value) => updateSelectedEpisode({ povCharacter: value })}
                          placeholder={t('script.sceneWorkbench.povPlaceholder')}
                        />
                      </div>

                      <Field
                        label={t('script.sceneStudio.sceneSubtext')}
                        value={selectedEpisode.subtext}
                        onChange={(value) => updateSelectedEpisode({ subtext: value })}
                        placeholder={t('script.sceneWorkbench.subtextPlaceholder')}
                        multiline
                        rows={2}
                      />
                    </div>
                  </Section>

                  <Section
                    title={t('script.sceneWorkbench.episodeDraft')}
                    description={t('script.sceneWorkbench.episodeDraftSubtitle')}
                    actions={(
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => void handleRunCopilot('continue')}
                          disabled={isCopilotLoading}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-3 py-1.5 text-xs font-medium text-cyan-200 transition-colors hover:bg-cyan-500/18 disabled:opacity-60"
                        >
                          <Sparkles className="h-3.5 w-3.5" />
                          {t('script.sceneWorkbench.continueDraft')}
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleRewriteEpisode()}
                          disabled={isCopilotLoading}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-border-dark bg-bg-dark px-3 py-1.5 text-xs font-medium text-text-dark transition-colors hover:bg-bg-dark/80 disabled:opacity-60"
                        >
                          <Wand2 className="h-3.5 w-3.5" />
                          {t('script.sceneWorkbench.rewriteDraft')}
                        </button>
                      </div>
                    )}
                  >
                    <div className="h-[320px] rounded-2xl border border-border-dark bg-bg-dark/40 p-2">
                      <LazyRichTextEditor
                        content={selectedEpisode.draftHtml}
                        onChange={(content) => updateSelectedEpisode({ draftHtml: content })}
                        placeholder={t('script.sceneWorkbench.episodeDraftPlaceholder')}
                        className="h-full"
                      />
                    </div>
                  </Section>

                  <div className="grid grid-cols-2 gap-3">
                    <Section
                      title={t('script.sceneWorkbench.directorNotes')}
                      description={t('script.sceneWorkbench.directorNotesSubtitle')}
                    >
                      <Field
                        label={t('script.sceneWorkbench.directorNotes')}
                        value={selectedEpisode.directorNotes}
                        onChange={(value) => updateSelectedEpisode({ directorNotes: value })}
                        placeholder={t('script.sceneWorkbench.directorNotesPlaceholder')}
                        multiline
                        rows={8}
                      />
                    </Section>

                    <Section
                      title={t('script.sceneWorkbench.continuity')}
                      description={t('script.sceneWorkbench.continuitySubtitle')}
                      actions={(
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => void handleRefreshContinuityMemory()}
                            disabled={isContinuityLoading}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-border-dark bg-bg-dark px-3 py-1.5 text-xs font-medium text-text-dark transition-colors hover:bg-bg-dark/80 disabled:opacity-60"
                          >
                            <RefreshCcw className="h-3.5 w-3.5" />
                            {t('script.sceneWorkbench.refreshMemory')}
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleRunContinuityCheck()}
                            disabled={isContinuityLoading}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-200 transition-colors hover:bg-amber-500/18 disabled:opacity-60"
                          >
                            <AlertTriangle className="h-3.5 w-3.5" />
                            {t('script.sceneWorkbench.checkContinuity')}
                          </button>
                        </div>
                      )}
                    >
                      <div className="space-y-3">
                        <Field
                          label={t('script.sceneWorkbench.continuitySummary')}
                          value={selectedEpisode.continuitySummary}
                          onChange={(value) => updateSelectedEpisode({ continuitySummary: value })}
                          placeholder={t('script.sceneWorkbench.continuitySummaryPlaceholder')}
                          multiline
                          rows={3}
                        />
                        <Field
                          label={t('script.sceneWorkbench.continuityFacts')}
                          value={selectedEpisode.continuityFacts.join('\n')}
                          onChange={(value) => updateSelectedEpisode({ continuityFacts: parseMultilineItems(value) })}
                          placeholder={t('script.sceneWorkbench.continuityFactsPlaceholder')}
                          multiline
                          rows={4}
                        />
                        <Field
                          label={t('script.sceneWorkbench.continuityLoops')}
                          value={selectedEpisode.continuityOpenLoops.join('\n')}
                          onChange={(value) => updateSelectedEpisode({ continuityOpenLoops: parseMultilineItems(value) })}
                          placeholder={t('script.sceneWorkbench.continuityLoopsPlaceholder')}
                          multiline
                          rows={4}
                        />

                        {latestContinuityCheck ? (
                          <div className={`rounded-xl border px-3 py-2 text-xs leading-5 ${
                            latestContinuityCheck.status === 'warning'
                              ? 'border-amber-500/25 bg-amber-500/10 text-amber-100'
                              : 'border-emerald-500/20 bg-emerald-500/8 text-emerald-100'
                          }`}>
                            <div className="font-medium">{latestContinuityCheck.summary}</div>
                            {latestContinuityCheck.issues.length > 0 ? (
                              <div className="mt-2 space-y-2">
                                {latestContinuityCheck.issues.map((issue) => (
                                  <div key={issue.id}>
                                    <div className="font-medium">{issue.title}</div>
                                    <div>{issue.detail}</div>
                                  </div>
                                ))}
                              </div>
                            ) : null}
                          </div>
                        ) : null}

                        {continuityError ? (
                          <div className="rounded-xl border border-red-400/20 bg-red-500/8 px-3 py-2 text-xs leading-5 text-red-200">
                            {continuityError}
                          </div>
                        ) : null}
                      </div>
                    </Section>
                  </div>

                  <Section
                    title={t('script.sceneWorkbench.copilot')}
                    description={t('script.sceneWorkbench.copilotSubtitle')}
                    actions={(
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => void handleRunCopilot('analysis')}
                          disabled={isCopilotLoading}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-border-dark bg-bg-dark px-3 py-1.5 text-xs font-medium text-text-dark transition-colors hover:bg-bg-dark/80 disabled:opacity-60"
                        >
                          <FileText className="h-3.5 w-3.5" />
                          {t('script.sceneWorkbench.analysis')}
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleRunCopilot('director')}
                          disabled={isCopilotLoading}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-border-dark bg-bg-dark px-3 py-1.5 text-xs font-medium text-text-dark transition-colors hover:bg-bg-dark/80 disabled:opacity-60"
                        >
                          <Clapperboard className="h-3.5 w-3.5" />
                          {t('script.sceneWorkbench.directorPass')}
                        </button>
                      </div>
                    )}
                  >
                    <div className="space-y-3">
                      <div className="max-h-[260px] space-y-2 overflow-y-auto rounded-2xl border border-border-dark bg-bg-dark/35 p-3">
                        {currentCopilotMessages.length > 0 ? (
                          currentCopilotMessages.map((message) => (
                            <div
                              key={message.id}
                              className={`rounded-xl px-3 py-2 text-sm leading-6 ${
                                message.role === 'assistant'
                                  ? 'bg-cyan-500/10 text-text-dark'
                                  : 'bg-surface-dark text-text-dark'
                              }`}
                            >
                              <div className="mb-1 text-[11px] uppercase tracking-[0.08em] text-text-muted">
                                {message.role === 'assistant'
                                  ? t('script.sceneWorkbench.copilotAssistant')
                                  : t('script.sceneWorkbench.copilotYou')}
                              </div>
                              <div className="whitespace-pre-wrap">{message.content}</div>
                            </div>
                          ))
                        ) : (
                          <div className="rounded-xl border border-dashed border-border-dark/70 bg-bg-dark/35 px-3 py-5 text-center text-xs text-text-muted">
                            {t('script.sceneWorkbench.copilotEmpty')}
                          </div>
                        )}
                      </div>

                      <div className="rounded-2xl border border-border-dark bg-bg-dark/35 p-3">
                        <textarea
                          value={copilotInput}
                          onChange={(event) => setCopilotInput(event.target.value)}
                          rows={4}
                          className="w-full resize-none bg-transparent text-sm leading-6 text-text-dark outline-none placeholder:text-text-muted/60"
                          placeholder={t('script.sceneWorkbench.copilotInputPlaceholder')}
                        />
                        <div className="mt-3 flex items-center justify-between gap-3">
                          {copilotError ? (
                            <div className="text-xs text-red-200">{copilotError}</div>
                          ) : (
                            <div className="text-xs text-text-muted">
                              {t('script.sceneWorkbench.copilotHint')}
                            </div>
                          )}
                          <button
                            type="button"
                            onClick={() => void handleSendCopilotInput()}
                            disabled={isCopilotLoading || copilotInput.trim().length === 0}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-3 py-1.5 text-xs font-medium text-cyan-200 transition-colors hover:bg-cyan-500/18 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {isCopilotLoading ? <UiLoadingAnimation size="sm" /> : <SendHorizonal className="h-3.5 w-3.5" />}
                            {t('script.sceneWorkbench.sendCopilot')}
                          </button>
                        </div>
                      </div>
                    </div>
                  </Section>
                </>
              ) : null}
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
