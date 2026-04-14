import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { ChapterWorkbenchPanel } from './ChapterWorkbenchPanel';
import { type SelectionRange } from './RichTextEditor';
import { SceneNodeWorkbenchPanel } from './SceneNodeWorkbenchPanel';
import {
  runSceneCopilot,
  runSceneSelectionRewriteVariants,
  type SceneCopilotMode,
} from '@/features/canvas/application/sceneCopilot';
import {
  buildSceneContinuityContext,
  generateSceneContinuityMemory,
  type SceneContinuityContext,
} from '@/features/canvas/application/sceneContinuity';
import { runSceneContinuityCheck } from '@/features/canvas/application/sceneContinuityCheck';
import {
  createManualEpisodeCard,
  generateEpisodesFromSceneNode,
  htmlToPlainText,
} from '@/features/canvas/application/sceneEpisodeGenerator';
import {
  CANVAS_NODE_TYPES,
  createDefaultSceneCard,
  normalizeSceneCards,
  type EpisodeCard,
  type SceneCard,
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

function seedCopilotThread(scene: SceneCard): SceneCopilotThreadMessage[] {
  const summary = scene.copilotSummary?.trim() ?? '';
  if (!summary) {
    return [];
  }

  return [
    {
      id: `seed-${scene.id}`,
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
  mode: SceneCopilotMessageMode,
  extras: Partial<
    Pick<
      SceneCopilotThreadMessage,
      'selectionSourceText' | 'selectionVariants' | 'selectedVariantIndex' | 'selectionResolution'
    >
  > = {},
): SceneCopilotThreadMessage {
  return {
    id: `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role,
    content,
    mode,
    createdAt: Date.now(),
    ...extras,
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

function composeChapterContentFromScenes(scenes: SceneCard[], fallbackContent: string): string {
  const parts = scenes
    .map((scene) => scene.draftHtml.trim())
    .filter((value) => value.length > 0);

  if (parts.length === 0) {
    return fallbackContent;
  }

  return parts.join('<hr />');
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

export function SceneStudioPanel() {
  const { t } = useTranslation();
  const updateNodeData = useCanvasStore((state) => state.updateNodeData);
  const selectedNodeId = useCanvasStore((state) => state.selectedNodeId);
  const activeChapterId = useScriptEditorStore((state) => state.activeChapterId);
  const activeChapterSceneId = useScriptEditorStore((state) => state.activeChapterSceneId);
  const focusChapter = useScriptEditorStore((state) => state.focusChapter);
  const focusChapterScene = useScriptEditorStore((state) => state.focusChapterScene);
  const activeSceneNodeId = useScriptEditorStore((state) => state.activeSceneNodeId);
  const activeEpisodeId = useScriptEditorStore((state) => state.activeEpisodeId);
  const focusSceneNode = useScriptEditorStore((state) => state.focusSceneNode);
  const continuityNodes = useCanvasNodesByTypes(SCENE_STUDIO_CONTINUITY_NODE_TYPES);
  const scriptSceneNodes = useCanvasNodesByTypes(SCENE_STUDIO_SCENE_NODE_TYPES);
  const selectedWorkbenchNode = useCanvasNodeById(selectedNodeId ?? '');
  const activeChapterWorkbenchNode = useCanvasNodeById(activeChapterId ?? '');
  const activeSceneWorkbenchNode = useCanvasNodeById(activeSceneNodeId ?? '');
  const rootNode = useCanvasFirstNodeByType(CANVAS_NODE_TYPES.scriptRoot);
  const [panelWidth, setPanelWidth] = useState(() => readPanelWidth());
  const [isPanelCollapsed, setIsPanelCollapsed] = useState(() => readPanelCollapsed());
  const [isPanelResizing, setIsPanelResizing] = useState(false);
  const [copilotInput, setCopilotInput] = useState('');
  const [copilotError, setCopilotError] = useState('');
  const [isCopilotLoading, setIsCopilotLoading] = useState(false);
  const [selectedDraftText, setSelectedDraftText] = useState('');
  const [selectedDraftRange, setSelectedDraftRange] = useState<SelectionRange | null>(null);
  const [selectionRewriteInput, setSelectionRewriteInput] = useState('');
  const [selectionRewriteError, setSelectionRewriteError] = useState('');
  const [isSelectionRewriteLoading, setIsSelectionRewriteLoading] = useState(false);
  const [pendingSelectionReplacement, setPendingSelectionReplacement] = useState<{
    requestId: number;
    text: string;
    range: SelectionRange | null;
    mode: 'replace' | 'insertBelow';
  } | null>(null);
  const [selectionRewriteTargets, setSelectionRewriteTargets] = useState<Record<string, SelectionRange>>({});
  const [expandedSelectionComparisons, setExpandedSelectionComparisons] = useState<Record<string, boolean>>({});
  const [isContinuityLoading, setIsContinuityLoading] = useState(false);
  const [continuityError, setContinuityError] = useState('');
  const [latestContinuityCheck, setLatestContinuityCheck] = useState<SceneContinuityCheck | null>(null);
  const [isEpisodeGenerating, setIsEpisodeGenerating] = useState(false);
  const [episodeGenerationError, setEpisodeGenerationError] = useState('');
  const [activeChapterTab, setActiveChapterTab] = useState<'overview' | 'draft' | 'director'>('overview');
  const [activeSceneTab, setActiveSceneTab] = useState<'overview' | 'draft' | 'director'>('overview');
  const panelResizeStateRef = useRef<{ startX: number; startWidth: number } | null>(null);

  const resolvedWorkbenchNode = useMemo(() => {
    if (activeSceneWorkbenchNode?.type === CANVAS_NODE_TYPES.scriptScene) {
      return activeSceneWorkbenchNode;
    }

    if (activeChapterWorkbenchNode?.type === CANVAS_NODE_TYPES.scriptChapter) {
      return activeChapterWorkbenchNode;
    }

    if (
      selectedWorkbenchNode?.type === CANVAS_NODE_TYPES.scriptScene
      || selectedWorkbenchNode?.type === CANVAS_NODE_TYPES.scriptChapter
    ) {
      return selectedWorkbenchNode;
    }

    return null;
  }, [activeChapterWorkbenchNode, activeSceneWorkbenchNode, selectedWorkbenchNode]);

  const sceneNodeRecord = resolvedWorkbenchNode?.type === CANVAS_NODE_TYPES.scriptScene
    ? resolvedWorkbenchNode
    : null;
  const sceneNodeData = sceneNodeRecord
    ? sceneNodeRecord.data as ScriptSceneNodeData
    : null;
  const sceneNodeId = sceneNodeRecord?.id ?? null;
  const chapterNodeRecord = resolvedWorkbenchNode?.type === CANVAS_NODE_TYPES.scriptChapter
    ? resolvedWorkbenchNode
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
  const selectedChapterScene = useMemo(() => {
    if (!chapterNodeData) {
      return null;
    }

    if (activeChapterId === chapterNodeId && activeChapterSceneId) {
      const matchedScene = chapterScenes.find((scene) => scene.id === activeChapterSceneId);
      if (matchedScene) {
        return matchedScene;
      }
    }

    return chapterScenes[0] ?? null;
  }, [
    activeChapterId,
    activeChapterSceneId,
    chapterNodeData,
    chapterNodeId,
    chapterScenes,
  ]);
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
    () => chapterNodeData ?? sourceChapterData ?? (sceneNodeData ? buildDefaultChapterContext(sceneNodeData) : null),
    [chapterNodeData, sceneNodeData, sourceChapterData]
  );
  const selectedSceneDraft = isChapterMode ? selectedChapterScene : selectedEpisode;

  const currentCopilotMessages = useMemo(() => {
    if (!selectedSceneDraft) {
      return [];
    }

    if (selectedSceneDraft.copilotThread?.length) {
      return selectedSceneDraft.copilotThread;
    }

    return seedCopilotThread(selectedSceneDraft);
  }, [selectedSceneDraft]);

  const continuityContext = useMemo<SceneContinuityContext | null>(() => {
    if (!chapterContext || !selectedSceneDraft) {
      return null;
    }

    return buildSceneContinuityContext({
      nodes: continuityNodes,
      currentChapterId: isChapterMode
        ? chapterNodeId ?? ''
        : sceneNodeData?.sourceChapterId ?? '',
      currentSceneId: selectedSceneDraft.id,
      currentScene: selectedSceneDraft,
      storyRoot: rootData ?? null,
    });
  }, [
    chapterContext,
    chapterNodeId,
    continuityNodes,
    isChapterMode,
    rootData,
    sceneNodeData?.sourceChapterId,
    selectedSceneDraft,
  ]);

  useEffect(() => {
    if (!chapterNodeData || !chapterNodeId || !selectedChapterScene) {
      return;
    }

    if (activeChapterId === chapterNodeId && activeChapterSceneId === selectedChapterScene.id) {
      return;
    }

    focusChapter(chapterNodeId, selectedChapterScene.id);
  }, [
    activeChapterId,
    activeChapterSceneId,
    chapterNodeData,
    chapterNodeId,
    focusChapter,
    selectedChapterScene,
  ]);

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
    setActiveChapterTab('overview');
  }, [chapterNodeId, selectedChapterScene?.id]);

  useEffect(() => {
    setActiveSceneTab('overview');
  }, [sceneNodeId]);

  useEffect(() => {
    setCopilotInput('');
    setCopilotError('');
    setSelectedDraftText('');
    setSelectedDraftRange(null);
    setSelectionRewriteInput('');
    setSelectionRewriteError('');
    setIsSelectionRewriteLoading(false);
    setPendingSelectionReplacement(null);
    setSelectionRewriteTargets({});
    setExpandedSelectionComparisons({});
    setContinuityError('');
    setLatestContinuityCheck(null);
  }, [isChapterMode, selectedSceneDraft?.id]);

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

    if (typeof document !== 'undefined') {
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      window.getSelection()?.removeAllRanges();
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

    const handleSelectStart = (event: Event) => {
      event.preventDefault();
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('selectstart', handleSelectStart);
    return () => {
      if (typeof document !== 'undefined') {
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('selectstart', handleSelectStart);
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
      content: composeChapterContentFromScenes(nextScenes, chapterNodeData.content),
    }, { historyMode: 'skip' });
    focusChapterScene(chapterNodeId, nextScene.id);
  }, [chapterNodeData, chapterNodeId, chapterScenes, focusChapterScene, updateNodeData]);

  const updateSelectedChapterScene = useCallback((patch: Partial<SceneCard>) => {
    if (!chapterNodeData || !chapterNodeId || !selectedChapterScene) {
      return;
    }

    if (chapterSceneNodeBySceneId.has(selectedChapterScene.id)) {
      return;
    }

    const nextScenes = chapterScenes.map((scene) => (
      scene.id === selectedChapterScene.id
        ? { ...scene, ...patch }
        : scene
    ));
    updateNodeData(chapterNodeId, {
      scenes: nextScenes,
      sceneHeadings: nextScenes
        .map((scene) => scene.title.trim())
        .filter((value) => value.length > 0),
      content: composeChapterContentFromScenes(nextScenes, chapterNodeData.content),
    }, { historyMode: 'skip' });
  }, [
    chapterNodeData,
    chapterNodeId,
    chapterScenes,
    chapterSceneNodeBySceneId,
    selectedChapterScene,
    updateNodeData,
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

  const applySelectedScenePatch = useCallback((patch: Partial<SceneCard>) => {
    if (isChapterMode) {
      updateSelectedChapterScene(patch);
      return;
    }

    updateSelectedEpisode(patch as Partial<EpisodeCard>);
  }, [isChapterMode, updateSelectedChapterScene, updateSelectedEpisode]);

  const updateCurrentCopilotMessage = useCallback((
    messageId: string,
    updater: (message: SceneCopilotThreadMessage) => SceneCopilotThreadMessage,
  ) => {
    if (!selectedSceneDraft) {
      return;
    }

    const nextMessages = currentCopilotMessages.map((message) => (
      message.id === messageId ? updater(message) : message
    ));
    const latestAssistantMessage = [...nextMessages]
      .reverse()
      .find((message) => message.role === 'assistant');

    applySelectedScenePatch({
      copilotThread: nextMessages,
      copilotSummary: latestAssistantMessage?.content ?? selectedSceneDraft.copilotSummary,
    });
  }, [applySelectedScenePatch, currentCopilotMessages, selectedSceneDraft]);

  const handleDraftSelectionChange = useCallback((selection: { text: string; range: SelectionRange | null }) => {
    setSelectedDraftText(selection.text);
    setSelectedDraftRange(selection.range);
    setSelectionRewriteError('');
  }, []);

  const resolveSelectionTargetRange = useCallback((messageId: string): SelectionRange | null => {
    return selectionRewriteTargets[messageId] ?? selectedDraftRange ?? null;
  }, [selectedDraftRange, selectionRewriteTargets]);

  const hasSelectionTarget = useCallback((messageId: string): boolean => {
    return Boolean(resolveSelectionTargetRange(messageId));
  }, [resolveSelectionTargetRange]);

  const handleApplySelectionVariant = useCallback((
    messageId: string,
    variant: string,
    variantIndex: number,
    mode: 'replace' | 'insertBelow',
  ) => {
    const targetRange = resolveSelectionTargetRange(messageId);
    if (!targetRange || !selectedSceneDraft) {
      return;
    }

    setPendingSelectionReplacement({
      requestId: Date.now(),
      text: variant,
      range: targetRange,
      mode,
    });

    updateCurrentCopilotMessage(messageId, (message) => ({
      ...message,
      selectedVariantIndex: variantIndex,
      selectionResolution: mode === 'replace' ? 'replaced' : 'inserted',
    }));

    applySelectedScenePatch({
      status: variant.trim() ? 'drafting' : selectedSceneDraft.status,
      copilotSummary: variant,
    });
  }, [
    applySelectedScenePatch,
    resolveSelectionTargetRange,
    selectedSceneDraft,
    updateCurrentCopilotMessage,
  ]);

  const handleDismissSelectionVariants = useCallback((messageId: string) => {
    updateCurrentCopilotMessage(messageId, (message) => ({
      ...message,
      selectedVariantIndex: null,
      selectionResolution: 'dismissed',
    }));
  }, [updateCurrentCopilotMessage]);

  const toggleSelectionComparison = useCallback((messageId: string, variantIndex: number) => {
    const comparisonKey = `${messageId}-${variantIndex}`;
    setExpandedSelectionComparisons((currentState) => ({
      ...currentState,
      [comparisonKey]: !currentState[comparisonKey],
    }));
  }, []);

  const handleRewriteSelection = useCallback(async (instruction: string) => {
    if (
      !selectedSceneDraft
      || !chapterContext
      || !selectedDraftText.trim()
      || !selectedDraftRange
      || isSelectionRewriteLoading
    ) {
      return;
    }

    const trimmedInstruction = instruction.trim();
    if (!trimmedInstruction) {
      return;
    }

    setSelectionRewriteError('');
    setIsSelectionRewriteLoading(true);

    try {
      const userMessage = createCopilotMessage('user', trimmedInstruction, 'selection');
      const history = [...currentCopilotMessages, userMessage];
      const variants = await runSceneSelectionRewriteVariants({
        mode: 'selection',
        userPrompt: trimmedInstruction,
        selectionText: selectedDraftText,
        scene: selectedSceneDraft,
        chapter: chapterContext,
        storyRoot: rootData ?? null,
        history,
        continuityContext,
      });
      const resolvedVariants = variants.filter((variant) => variant.trim().length > 0);
      if (resolvedVariants.length === 0) {
        throw new Error(t('script.sceneStudio.copilotUnknownError'));
      }

      const assistantMessage = createCopilotMessage(
        'assistant',
        t('script.sceneStudio.selectionVariantsReady', { count: resolvedVariants.length }),
        'selection',
        {
          selectionSourceText: selectedDraftText,
          selectionVariants: resolvedVariants,
          selectedVariantIndex: null,
          selectionResolution: 'pending',
        },
      );
      const nextMessages = [...history, assistantMessage];

      applySelectedScenePatch({
        copilotThread: nextMessages,
        copilotSummary: resolvedVariants[0] ?? selectedSceneDraft.copilotSummary,
      });
      setSelectionRewriteTargets((currentTargets) => ({
        ...currentTargets,
        [assistantMessage.id]: selectedDraftRange,
      }));
      setSelectionRewriteInput('');
    } catch (error) {
      setSelectionRewriteError(error instanceof Error ? error.message : t('script.sceneStudio.copilotUnknownError'));
    } finally {
      setIsSelectionRewriteLoading(false);
    }
  }, [
    applySelectedScenePatch,
    chapterContext,
    continuityContext,
    currentCopilotMessages,
    isSelectionRewriteLoading,
    rootData,
    selectedDraftRange,
    selectedDraftText,
    selectedSceneDraft,
    t,
  ]);

  const handleRunCopilot = useCallback(async (
    mode: SceneCopilotMode,
    userPrompt?: string
  ) => {
    if (!selectedSceneDraft || !chapterContext) {
      return;
    }

    setCopilotError('');
    setIsCopilotLoading(true);
    try {
      const response = await runSceneCopilot({
        mode,
        userPrompt,
        scene: selectedSceneDraft,
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
        const currentText = htmlToPlainText(selectedSceneDraft.draftHtml);
        const nextDraft = plainTextToHtml(
          [currentText, response].filter((value) => value.length > 0).join('\n\n')
        );
        applySelectedScenePatch({
          draftHtml: nextDraft,
          status: nextDraft.trim() ? 'drafting' : selectedSceneDraft.status,
          copilotThread: nextMessages,
          copilotSummary: response,
        });
      } else {
        applySelectedScenePatch({
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
    selectedSceneDraft,
    applySelectedScenePatch,
  ]);

  const handleRewriteEpisode = useCallback(async () => {
    if (!selectedSceneDraft || !chapterContext) {
      return;
    }

    setCopilotError('');
    setIsCopilotLoading(true);
    try {
      const rewrittenText = await runSceneCopilot({
        mode: 'selection',
        userPrompt: isChapterMode
          ? t('script.sceneStudio.defaultRewritePrompt')
          : t('script.sceneWorkbench.defaultRewritePrompt'),
        selectionText: htmlToPlainText(selectedSceneDraft.draftHtml),
        scene: selectedSceneDraft,
        chapter: chapterContext,
        storyRoot: rootData ?? null,
        history: currentCopilotMessages,
        continuityContext,
      });

      const nextDraftHtml = plainTextToHtml(rewrittenText);
      const nextMessages = [
        ...currentCopilotMessages,
        createCopilotMessage(
          'user',
          isChapterMode
            ? t('script.sceneStudio.defaultRewritePrompt')
            : t('script.sceneWorkbench.defaultRewritePrompt'),
          'selection'
        ),
        createCopilotMessage('assistant', rewrittenText, 'selection'),
      ];

      applySelectedScenePatch({
        draftHtml: nextDraftHtml,
        status: rewrittenText.trim() ? 'drafting' : selectedSceneDraft.status,
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
    isChapterMode,
    rootData,
    selectedSceneDraft,
    t,
    applySelectedScenePatch,
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
    if (!selectedSceneDraft || !chapterContext) {
      return;
    }

    setContinuityError('');
    setIsContinuityLoading(true);
    try {
      const memory = await generateSceneContinuityMemory({
        scene: selectedSceneDraft,
        chapter: chapterContext,
        storyRoot: rootData ?? null,
        continuityContext,
      });
      applySelectedScenePatch({
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
    selectedSceneDraft,
    applySelectedScenePatch,
  ]);

  const handleRunContinuityCheck = useCallback(async () => {
    if (!selectedSceneDraft || !chapterContext) {
      return;
    }

    setContinuityError('');
    setIsContinuityLoading(true);
    try {
      const check = await runSceneContinuityCheck({
        candidateText: htmlToPlainText(selectedSceneDraft.draftHtml),
        candidateLabel: isChapterMode
          ? t('script.sceneStudio.currentDraftLabel')
          : t('script.sceneWorkbench.currentDraftLabel'),
        scene: selectedSceneDraft,
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
    isChapterMode,
    rootData,
    selectedSceneDraft,
    t,
  ]);

  const panelWidthStyle = isPanelCollapsed ? SCENE_STUDIO_PANEL_COLLAPSED_WIDTH : panelWidth;

  return (
    <aside
      className={`relative z-20 h-full shrink-0 border-l border-border-dark bg-bg-dark/92 backdrop-blur ${
        isPanelResizing ? 'transition-none' : 'transition-[width] duration-300'
      }`}
      style={{ width: panelWidthStyle }}
    >
      <div
        className={`absolute -left-1 top-0 z-30 h-full w-3 cursor-col-resize touch-none transition-colors ${
          isPanelCollapsed ? 'pointer-events-none opacity-0' : 'hover:bg-cyan-500/25'
        }`}
        onPointerDown={(event) => {
          if (isPanelCollapsed) {
            return;
          }

          event.preventDefault();
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
          <ChapterWorkbenchPanel
            chapterNodeData={chapterNodeData}
            chapterScenes={chapterScenes}
            selectedChapterScene={selectedChapterScene}
            chapterSceneNodeBySceneId={chapterSceneNodeBySceneId}
            activeTab={activeChapterTab}
            onChangeTab={setActiveChapterTab}
            onUpdateChapterPatch={updateChapterPatch}
            onSelectScene={(sceneId) => {
              if (!chapterNodeId) {
                return;
              }
              focusChapterScene(chapterNodeId, sceneId);
            }}
            onAddScene={handleAddChapterScene}
            onUpdateSelectedScene={updateSelectedChapterScene}
            currentCopilotMessages={currentCopilotMessages}
            selectedDraftText={selectedDraftText}
            selectionRewriteInput={selectionRewriteInput}
            onSelectionRewriteInputChange={setSelectionRewriteInput}
            selectionRewriteError={selectionRewriteError}
            isSelectionRewriteLoading={isSelectionRewriteLoading}
            onRunSelectionRewrite={handleRewriteSelection}
            copilotInput={copilotInput}
            onCopilotInputChange={setCopilotInput}
            copilotError={copilotError}
            isCopilotLoading={isCopilotLoading}
            onRunCopilot={handleRunCopilot}
            onSendCopilotInput={handleSendCopilotInput}
            onRewriteDraft={handleRewriteEpisode}
            pendingSelectionReplacement={pendingSelectionReplacement}
            onSelectionReplacementApplied={() => setPendingSelectionReplacement(null)}
            onDraftSelectionChange={handleDraftSelectionChange}
            expandedSelectionComparisons={expandedSelectionComparisons}
            onToggleSelectionComparison={toggleSelectionComparison}
            hasSelectionTarget={hasSelectionTarget}
            onApplySelectionVariant={handleApplySelectionVariant}
            onDismissSelectionVariants={handleDismissSelectionVariants}
            isContinuityLoading={isContinuityLoading}
            onRefreshContinuityMemory={handleRefreshContinuityMemory}
            onRunContinuityCheck={handleRunContinuityCheck}
            continuityError={continuityError}
            latestContinuityCheck={latestContinuityCheck}
          />
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
          <SceneNodeWorkbenchPanel
            sceneNodeData={sceneNodeData}
            sourceChapterTitle={sourceChapterData?.title || sourceChapterData?.displayName || ''}
            selectedEpisode={selectedEpisode}
            activeTab={activeSceneTab}
            onChangeTab={setActiveSceneTab}
            onSelectEpisode={(episodeId) => {
              if (!sceneNodeId) {
                return;
              }
              focusSceneNode(sceneNodeId, episodeId);
            }}
            onAddEpisode={handleAddEpisode}
            onDeleteEpisode={handleDeleteEpisode}
            onGenerateEpisodes={handleGenerateEpisodes}
            isEpisodeGenerating={isEpisodeGenerating}
            episodeGenerationError={episodeGenerationError}
            onUpdateScenePatch={updateScenePatch}
            onUpdateSelectedEpisode={updateSelectedEpisode}
            currentCopilotMessages={currentCopilotMessages}
            selectedDraftText={selectedDraftText}
            selectionRewriteInput={selectionRewriteInput}
            onSelectionRewriteInputChange={setSelectionRewriteInput}
            selectionRewriteError={selectionRewriteError}
            isSelectionRewriteLoading={isSelectionRewriteLoading}
            onRunSelectionRewrite={handleRewriteSelection}
            copilotInput={copilotInput}
            onCopilotInputChange={setCopilotInput}
            copilotError={copilotError}
            isCopilotLoading={isCopilotLoading}
            onRunCopilot={handleRunCopilot}
            onSendCopilotInput={handleSendCopilotInput}
            onRewriteDraft={handleRewriteEpisode}
            pendingSelectionReplacement={pendingSelectionReplacement}
            onSelectionReplacementApplied={() => setPendingSelectionReplacement(null)}
            onDraftSelectionChange={handleDraftSelectionChange}
            expandedSelectionComparisons={expandedSelectionComparisons}
            onToggleSelectionComparison={toggleSelectionComparison}
            hasSelectionTarget={hasSelectionTarget}
            onApplySelectionVariant={handleApplySelectionVariant}
            onDismissSelectionVariants={handleDismissSelectionVariants}
            isContinuityLoading={isContinuityLoading}
            onRefreshContinuityMemory={handleRefreshContinuityMemory}
            onRunContinuityCheck={handleRunContinuityCheck}
            continuityError={continuityError}
            latestContinuityCheck={latestContinuityCheck}
          />
        )}
      </div>
    </aside>
  );
}
