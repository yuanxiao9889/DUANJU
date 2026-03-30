import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  Clapperboard,
  CornerDownLeft,
  FileText,
  Link2,
  Loader2,
  Plus,
  RefreshCcw,
  Save,
  SendHorizonal,
  Sparkles,
  X,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { RichTextEditor } from './RichTextEditor';
import { SelectionDiffPreview } from './SelectionDiffPreview';
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
  CANVAS_NODE_TYPES,
  createDefaultSceneCard,
  normalizeSceneCards,
  type SceneCard,
  type SceneContinuityCheck,
  type SceneContinuityIssue,
  type SceneCopilotMessageMode,
  type SceneCopilotSelectionResolution,
  type SceneCopilotThreadMessage,
  type ScriptChapterNodeData,
  type ScriptRootNodeData,
} from '@/features/canvas/domain/canvasNodes';
import { useCanvasStore } from '@/stores/canvasStore';
import { useProjectStore } from '@/stores/projectStore';
import { useScriptEditorStore } from '@/stores/scriptEditorStore';

const AUTOSAVE_DELAY_MS = 1200;
const SCENE_STUDIO_SECTION_STORAGE_KEY = 'scene-studio-sections';

type SceneStudioSectionKey =
  | 'chapterFocus'
  | 'sceneBlueprint'
  | 'importedSource'
  | 'continuity'
  | 'copilot'
  | 'draft';

type SceneStudioSectionState = Record<SceneStudioSectionKey, boolean>;

const DEFAULT_SCENE_STUDIO_SECTION_STATE: SceneStudioSectionState = {
  chapterFocus: false,
  sceneBlueprint: true,
  importedSource: false,
  continuity: false,
  copilot: false,
  draft: true,
};

type SelectionRange = {
  from: number;
  to: number;
};

function cloneScene(scene: SceneCard): SceneCard {
  return JSON.parse(JSON.stringify(scene)) as SceneCard;
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

function createCopilotMessage(
  role: 'user' | 'assistant',
  content: string,
  mode: SceneCopilotMessageMode,
  extras: Partial<
    Pick<
      SceneCopilotThreadMessage,
      | 'selectionSourceText'
      | 'selectionVariants'
      | 'selectedVariantIndex'
      | 'selectionResolution'
      | 'continuityCheck'
    >
  > = {}
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

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function plainTextToHtml(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) {
    return '';
  }

  return trimmed
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, '<br />')}</p>`)
    .join('');
}

function htmlToPlainText(html: string): string {
  const trimmed = html.trim();
  if (!trimmed) {
    return '';
  }

  if (typeof DOMParser === 'undefined') {
    return trimmed
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>\s*<p[^>]*>/gi, '\n\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&#39;/g, '\'')
      .replace(/&quot;/g, '"')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  const parser = new DOMParser();
  const document = parser.parseFromString(trimmed, 'text/html');
  const text = document.body.innerText || document.body.textContent || '';
  return text
    .replace(/\u00a0/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function parseMultilineItems(text: string): string[] {
  const seen = new Set<string>();
  const items: string[] = [];

  for (const line of text.split(/\n+/g)) {
    const trimmed = line.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }

    seen.add(trimmed);
    items.push(trimmed);
  }

  return items;
}

function buildDraftTextWithContinuation(draftHtml: string, continuationText: string): string {
  const currentDraftText = htmlToPlainText(draftHtml);
  const nextText = continuationText.trim();
  return [currentDraftText, nextText].filter((value) => value.length > 0).join('\n\n');
}

function buildDraftTextWithSelectionChange(
  draftHtml: string,
  range: SelectionRange,
  replacementText: string,
  mode: 'replace' | 'insertBelow'
): string {
  const sourceText = htmlToPlainText(draftHtml);
  if (!sourceText) {
    return replacementText.trim();
  }

  const safeFrom = Math.max(0, Math.min(range.from, sourceText.length));
  const safeTo = Math.max(safeFrom, Math.min(range.to, sourceText.length));
  const nextText = replacementText.trim();

  if (mode === 'insertBelow') {
    const insertSuffix = nextText ? `\n\n${nextText}` : '';
    return `${sourceText.slice(0, safeTo)}${insertSuffix}${sourceText.slice(safeTo)}`.trim();
  }

  return `${sourceText.slice(0, safeFrom)}${nextText}${sourceText.slice(safeTo)}`.trim();
}

function readSceneStudioSectionState(): SceneStudioSectionState {
  if (typeof window === 'undefined') {
    return DEFAULT_SCENE_STUDIO_SECTION_STATE;
  }

  try {
    const raw = window.localStorage.getItem(SCENE_STUDIO_SECTION_STORAGE_KEY);
    if (!raw) {
      return DEFAULT_SCENE_STUDIO_SECTION_STATE;
    }

    const parsed = JSON.parse(raw) as Partial<Record<SceneStudioSectionKey, unknown>>;
    return {
      chapterFocus: typeof parsed.chapterFocus === 'boolean'
        ? parsed.chapterFocus
        : DEFAULT_SCENE_STUDIO_SECTION_STATE.chapterFocus,
      sceneBlueprint: typeof parsed.sceneBlueprint === 'boolean'
        ? parsed.sceneBlueprint
        : DEFAULT_SCENE_STUDIO_SECTION_STATE.sceneBlueprint,
      importedSource: typeof parsed.importedSource === 'boolean'
        ? parsed.importedSource
        : DEFAULT_SCENE_STUDIO_SECTION_STATE.importedSource,
      continuity: typeof parsed.continuity === 'boolean'
        ? parsed.continuity
        : DEFAULT_SCENE_STUDIO_SECTION_STATE.continuity,
      copilot: typeof parsed.copilot === 'boolean'
        ? parsed.copilot
        : DEFAULT_SCENE_STUDIO_SECTION_STATE.copilot,
      draft: typeof parsed.draft === 'boolean'
        ? parsed.draft
        : DEFAULT_SCENE_STUDIO_SECTION_STATE.draft,
    };
  } catch {
    return DEFAULT_SCENE_STUDIO_SECTION_STATE;
  }
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-text-muted">
        {label}
      </span>
      {children}
    </label>
  );
}

function Input({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <input
      type="text"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="rounded-lg border border-border-dark bg-bg-dark px-3 py-2 text-sm text-text-dark outline-none transition-colors placeholder:text-text-muted/60 focus:border-accent/50"
      placeholder={placeholder}
    />
  );
}

function Textarea({
  value,
  onChange,
  placeholder,
  rows = 3,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  rows?: number;
}) {
  return (
    <textarea
      value={value}
      rows={rows}
      onChange={(event) => onChange(event.target.value)}
      className="resize-none rounded-lg border border-border-dark bg-bg-dark px-3 py-2 text-sm text-text-dark outline-none transition-colors placeholder:text-text-muted/60 focus:border-accent/50"
      placeholder={placeholder}
    />
  );
}

function SceneStudioSection({
  icon,
  title,
  description,
  isOpen,
  onToggle,
  actions,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  isOpen: boolean;
  onToggle: () => void;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-border-dark bg-bg-dark/25">
      <div className="flex items-start justify-between gap-3 px-3 py-3">
        <button
          type="button"
          onClick={onToggle}
          className="flex min-w-0 flex-1 items-start gap-3 text-left"
        >
          <div className="rounded-xl bg-surface-dark/65 p-2">
            {icon}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-text-dark">
              {title}
            </div>
            <p className="mt-1 text-xs leading-5 text-text-muted">
              {description}
            </p>
          </div>
        </button>

        <div className="flex shrink-0 items-center gap-2">
          {actions}
          <button
            type="button"
            onClick={onToggle}
            className="rounded-lg border border-border-dark px-2 py-1.5 text-text-muted transition-colors hover:bg-bg-dark hover:text-text-dark"
          >
            {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {isOpen ? (
        <div className="border-t border-border-dark/80 px-3 py-3">
          {children}
        </div>
      ) : null}
    </section>
  );
}

export function SceneStudioPanel() {
  const { t } = useTranslation();
  const currentProject = useProjectStore((state) => state.currentProject);
  const nodes = useCanvasStore((state) => state.nodes);
  const updateNodeData = useCanvasStore((state) => state.updateNodeData);
  const activeChapterId = useScriptEditorStore((state) => state.activeChapterId);
  const activeSceneId = useScriptEditorStore((state) => state.activeSceneId);
  const focusScene = useScriptEditorStore((state) => state.focusScene);
  const clearSelection = useScriptEditorStore((state) => state.clearSelection);

  const chapterNode = useMemo(() => {
    if (!activeChapterId) {
      return null;
    }

    return nodes.find(
      (node) => node.id === activeChapterId && node.type === CANVAS_NODE_TYPES.scriptChapter
    ) ?? null;
  }, [activeChapterId, nodes]);

  const chapterData = chapterNode?.data as ScriptChapterNodeData | undefined;
  const rootNode = useMemo(() => {
    return nodes.find((node) => node.type === CANVAS_NODE_TYPES.scriptRoot) ?? null;
  }, [nodes]);
  const rootData = rootNode?.data as ScriptRootNodeData | undefined;
  const scenes = useMemo(
    () => normalizeSceneCards(chapterData?.scenes, chapterData?.content),
    [chapterData?.content, chapterData?.scenes]
  );

  const resolvedScene = useMemo(() => {
    if (scenes.length === 0) {
      return null;
    }

    if (activeSceneId) {
      const matchingScene = scenes.find((scene) => scene.id === activeSceneId);
      if (matchingScene) {
        return matchingScene;
      }
    }

    return scenes[0] ?? null;
  }, [activeSceneId, scenes]);

  const [chapterSummary, setChapterSummary] = useState('');
  const [chapterPurpose, setChapterPurpose] = useState('');
  const [chapterQuestion, setChapterQuestion] = useState('');
  const [sceneDraft, setSceneDraft] = useState<SceneCard | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [copilotInput, setCopilotInput] = useState('');
  const [copilotError, setCopilotError] = useState('');
  const [isCopilotLoading, setIsCopilotLoading] = useState(false);
  const [selectedDraftText, setSelectedDraftText] = useState('');
  const [selectedDraftRange, setSelectedDraftRange] = useState<SelectionRange | null>(null);
  const [selectionRewriteInput, setSelectionRewriteInput] = useState('');
  const [selectionRewriteError, setSelectionRewriteError] = useState('');
  const [isSelectionRewriteLoading, setIsSelectionRewriteLoading] = useState(false);
  const [continuityError, setContinuityError] = useState('');
  const [isContinuityRefreshing, setIsContinuityRefreshing] = useState(false);
  const [checkingContinuityByMessageId, setCheckingContinuityByMessageId] = useState<
    Record<string, boolean>
  >({});
  const [pendingContinuityGuard, setPendingContinuityGuard] = useState<{
    requestId: number;
    title: string;
    actionLabel: string;
    check: SceneContinuityCheck;
  } | null>(null);
  const [pendingSelectionReplacement, setPendingSelectionReplacement] = useState<{
    requestId: number;
    text: string;
    range: SelectionRange | null;
    mode: 'replace' | 'insertBelow';
  } | null>(null);
  const [selectionRewriteTargets, setSelectionRewriteTargets] = useState<Record<string, SelectionRange>>({});
  const [expandedSelectionComparisons, setExpandedSelectionComparisons] = useState<Record<string, boolean>>({});
  const [isImportedComparisonVisible, setIsImportedComparisonVisible] = useState(false);
  const [hasRestoredImportedOriginal, setHasRestoredImportedOriginal] = useState(false);
  const [sectionState, setSectionState] = useState<SceneStudioSectionState>(() => (
    readSceneStudioSectionState()
  ));

  const currentBindingRef = useRef<{ chapterId: string | null; sceneId: string | null }>({
    chapterId: null,
    sceneId: null,
  });
  const chapterDraftRef = useRef({
    chapterSummary: '',
    chapterPurpose: '',
    chapterQuestion: '',
  });
  const sceneDraftRef = useRef<SceneCard | null>(null);
  const pendingContinuityActionRef = useRef<(() => void) | null>(null);

  const currentCopilotMessages = useMemo(() => {
    if (!sceneDraft) {
      return [];
    }

    if (sceneDraft.copilotThread?.length) {
      return sceneDraft.copilotThread;
    }

    return seedCopilotThread(sceneDraft);
  }, [sceneDraft]);

  const importedOriginalHtml = sceneDraft?.sourceDraftHtml?.trim() ?? '';
  const importedOriginalLabel = sceneDraft?.sourceDraftLabel?.trim() ?? '';
  const importedOriginalText = useMemo(
    () => htmlToPlainText(importedOriginalHtml),
    [importedOriginalHtml]
  );
  const currentDraftText = useMemo(
    () => htmlToPlainText(sceneDraft?.draftHtml ?? ''),
    [sceneDraft?.draftHtml]
  );
  const hasImportedOriginal = importedOriginalHtml.length > 0;
  const canRestoreImportedOriginal = hasImportedOriginal
    && importedOriginalText.length > 0
    && importedOriginalText !== currentDraftText;
  const importedOriginalDiffLabel = importedOriginalLabel
    ? t('script.sceneStudio.importOriginalLabelWithSource', { label: importedOriginalLabel })
    : t('script.sceneStudio.importOriginalLabel');
  const continuityContext = useMemo(() => {
    if (!chapterNode || !sceneDraft) {
      return null;
    }

    return buildSceneContinuityContext({
      nodes,
      currentChapterId: chapterNode.id,
      currentSceneId: sceneDraft.id,
      currentScene: sceneDraft,
      storyRoot: rootData ?? null,
    });
  }, [chapterNode, nodes, rootData, sceneDraft]);

  const persistSceneDraftSnapshot = useCallback((sceneSnapshot: SceneCard, historyMode: 'push' | 'skip') => {
    const { chapterId, sceneId } = currentBindingRef.current;
    if (!chapterId || !sceneId) {
      return;
    }

    const currentChapterNode = useCanvasStore
      .getState()
      .nodes.find(
        (node) => node.id === chapterId && node.type === CANVAS_NODE_TYPES.scriptChapter
      );
    if (!currentChapterNode) {
      return;
    }

    const currentChapterData = currentChapterNode.data as ScriptChapterNodeData;
    const normalizedScenes = normalizeSceneCards(
      currentChapterData.scenes,
      currentChapterData.content
    );
    const nextScenes = normalizedScenes.map((scene) =>
      scene.id === sceneId ? cloneScene(sceneSnapshot) : scene
    );

    updateNodeData(
      chapterId,
      {
        summary: chapterDraftRef.current.chapterSummary,
        chapterPurpose: chapterDraftRef.current.chapterPurpose,
        chapterQuestion: chapterDraftRef.current.chapterQuestion,
        scenes: nextScenes,
        content: composeChapterContentFromScenes(nextScenes, currentChapterData.content),
      },
      { historyMode }
    );

    setIsDirty(false);
    setLastSavedAt(Date.now());
  }, [updateNodeData]);

  const persistDraft = useCallback((historyMode: 'push' | 'skip') => {
    const currentSceneDraft = sceneDraftRef.current;
    if (!currentSceneDraft) {
      return;
    }

    persistSceneDraftSnapshot(currentSceneDraft, historyMode);
  }, [persistSceneDraftSnapshot]);

  const toggleSection = useCallback((sectionKey: SceneStudioSectionKey) => {
    setSectionState((currentState) => ({
      ...currentState,
      [sectionKey]: !currentState[sectionKey],
    }));
  }, []);

  const openSection = useCallback((sectionKey: SceneStudioSectionKey) => {
    setSectionState((currentState) => (
      currentState[sectionKey]
        ? currentState
        : { ...currentState, [sectionKey]: true }
    ));
  }, []);

  useEffect(() => {
    chapterDraftRef.current = {
      chapterSummary,
      chapterPurpose,
      chapterQuestion,
    };
  }, [chapterPurpose, chapterQuestion, chapterSummary]);

  useEffect(() => {
    sceneDraftRef.current = sceneDraft ? cloneScene(sceneDraft) : null;
  }, [sceneDraft]);

  useEffect(() => {
    if (currentProject?.projectType !== 'script') {
      return;
    }

    if (!chapterNode) {
      setSceneDraft(null);
      setIsDirty(false);
      currentBindingRef.current = { chapterId: null, sceneId: null };
      return;
    }

    if (!resolvedScene) {
      return;
    }

    if (!activeSceneId || activeSceneId !== resolvedScene.id) {
      focusScene(chapterNode.id, resolvedScene.id);
      return;
    }

    const bindingChanged =
      currentBindingRef.current.chapterId !== chapterNode.id
      || currentBindingRef.current.sceneId !== resolvedScene.id;

    if (bindingChanged && isDirty) {
      persistDraft('skip');
    }

    if (bindingChanged || !sceneDraft) {
      currentBindingRef.current = {
        chapterId: chapterNode.id,
        sceneId: resolvedScene.id,
      };
      setChapterSummary(chapterData?.summary ?? '');
      setChapterPurpose(chapterData?.chapterPurpose ?? '');
      setChapterQuestion(chapterData?.chapterQuestion ?? '');
      setSceneDraft(cloneScene(resolvedScene));
      setIsDirty(false);
    }
  }, [
    activeSceneId,
    chapterData?.chapterPurpose,
    chapterData?.chapterQuestion,
    chapterData?.summary,
    chapterNode,
    currentProject?.projectType,
    focusScene,
    isDirty,
    persistDraft,
    resolvedScene,
    sceneDraft,
  ]);

  useEffect(() => {
    if (!isDirty || !sceneDraft) {
      return;
    }

    const timer = window.setTimeout(() => {
      persistDraft('skip');
    }, AUTOSAVE_DELAY_MS);

    return () => {
      window.clearTimeout(timer);
    };
  }, [isDirty, persistDraft, sceneDraft]);

  useEffect(() => {
    setCopilotInput('');
    setCopilotError('');
    setSelectedDraftText('');
    setSelectedDraftRange(null);
    setSelectionRewriteInput('');
    setSelectionRewriteError('');
    setContinuityError('');
    setIsSelectionRewriteLoading(false);
    setIsContinuityRefreshing(false);
    setCheckingContinuityByMessageId({});
    setPendingContinuityGuard(null);
    setPendingSelectionReplacement(null);
    setSelectionRewriteTargets({});
    setExpandedSelectionComparisons({});
    setIsImportedComparisonVisible(false);
    setHasRestoredImportedOriginal(false);
    pendingContinuityActionRef.current = null;
  }, [sceneDraft?.id]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(
      SCENE_STUDIO_SECTION_STORAGE_KEY,
      JSON.stringify(sectionState)
    );
  }, [sectionState]);

  const handleAddScene = useCallback(() => {
    if (!chapterNode || !chapterData) {
      return;
    }

    const normalizedScenes = normalizeSceneCards(chapterData.scenes, chapterData.content);
    const nextScene = createDefaultSceneCard(normalizedScenes.length);
    const nextScenes = [...normalizedScenes, nextScene];

    updateNodeData(chapterNode.id, {
      scenes: nextScenes,
      content: composeChapterContentFromScenes(nextScenes, chapterData.content),
    });
    focusScene(chapterNode.id, nextScene.id);
  }, [chapterData, chapterNode, focusScene, updateNodeData]);

  const updateSceneDraft = useCallback((updater: (draft: SceneCard) => SceneCard) => {
    setSceneDraft((currentDraft) => {
      if (!currentDraft) {
        return currentDraft;
      }

      const nextDraft = updater(currentDraft);
      setIsDirty(true);
      return nextDraft;
    });
  }, []);

  const appendCopilotThreadMessage = useCallback((message: SceneCopilotThreadMessage) => {
    updateSceneDraft((draft) => ({
      ...draft,
      copilotThread: [
        ...(draft.copilotThread?.length ? draft.copilotThread : seedCopilotThread(draft)),
        message,
      ],
    }));
  }, [updateSceneDraft]);

  const updateCopilotThreadMessage = useCallback((
    messageId: string,
    updater: (message: SceneCopilotThreadMessage) => SceneCopilotThreadMessage
  ) => {
    updateSceneDraft((draft) => ({
      ...draft,
      copilotThread: (draft.copilotThread?.length ? draft.copilotThread : seedCopilotThread(draft))
        .map((message) => (message.id === messageId ? updater(message) : message)),
    }));
  }, [updateSceneDraft]);

  const setContinuityChecking = useCallback((messageId: string, isChecking: boolean) => {
    setCheckingContinuityByMessageId((currentState) => {
      if (isChecking) {
        if (currentState[messageId]) {
          return currentState;
        }

        return {
          ...currentState,
          [messageId]: true,
        };
      }

      if (!currentState[messageId]) {
        return currentState;
      }

      const nextState = { ...currentState };
      delete nextState[messageId];
      return nextState;
    });
  }, []);

  const closeContinuityGuard = useCallback(() => {
    pendingContinuityActionRef.current = null;
    setPendingContinuityGuard(null);
  }, []);

  const openContinuityGuard = useCallback((options: {
    title: string;
    actionLabel: string;
    check: SceneContinuityCheck;
    onConfirm: () => void;
  }) => {
    pendingContinuityActionRef.current = options.onConfirm;
    setPendingContinuityGuard({
      requestId: Date.now(),
      title: options.title,
      actionLabel: options.actionLabel,
      check: options.check,
    });
  }, []);

  const confirmContinuityGuard = useCallback(() => {
    const pendingAction = pendingContinuityActionRef.current;
    closeContinuityGuard();
    pendingAction?.();
  }, [closeContinuityGuard]);

  const runCandidateContinuityCheck = useCallback(async (options: {
    messageId: string;
    candidateText: string;
    candidateLabel: string;
    scene: SceneCard;
    chapter: ScriptChapterNodeData;
    continuityContextSnapshot?: SceneContinuityContext | null;
    storyRootSnapshot?: ScriptRootNodeData | null;
    persistToMessage?: boolean;
  }): Promise<SceneContinuityCheck | null> => {
    setContinuityChecking(options.messageId, true);

    try {
      const check = await runSceneContinuityCheck({
        candidateText: options.candidateText,
        candidateLabel: options.candidateLabel,
        scene: options.scene,
        chapter: options.chapter,
        storyRoot: options.storyRootSnapshot ?? rootData ?? null,
        continuityContext: options.continuityContextSnapshot ?? continuityContext,
      });

      if (options.persistToMessage) {
        updateCopilotThreadMessage(options.messageId, (currentMessage) => ({
          ...currentMessage,
          continuityCheck: check,
        }));
      }

      return check;
    } catch (error) {
      console.warn('Failed to run scene continuity check', error);
      return null;
    } finally {
      setContinuityChecking(options.messageId, false);
    }
  }, [
    continuityContext,
    rootData,
    setContinuityChecking,
    updateCopilotThreadMessage,
  ]);

  const getCopilotModeLabel = useCallback((mode: SceneCopilotMessageMode) => {
    switch (mode) {
      case 'analysis':
        return t('script.sceneStudio.copilotActionAnalysis');
      case 'continue':
        return t('script.sceneStudio.copilotActionContinue');
      case 'director':
        return t('script.sceneStudio.copilotActionDirector');
      case 'selection':
        return t('script.sceneStudio.copilotActionSelection');
      case 'custom':
        return t('script.sceneStudio.copilotActionCustom');
      case 'seed':
      default:
        return t('script.sceneStudio.copilotLatestInsight');
    }
  }, [t]);

  const appendCopilotToDraft = useCallback((content: string) => {
    const nextHtml = plainTextToHtml(content);
    if (!nextHtml) {
      return;
    }

    updateSceneDraft((draft) => ({
      ...draft,
      draftHtml: draft.draftHtml.trim()
        ? `${draft.draftHtml}<p><br /></p>${nextHtml}`
        : nextHtml,
      status: 'drafting',
    }));
  }, [updateSceneDraft]);

  const appendCopilotToDirectorNotes = useCallback((content: string) => {
    const nextText = content.trim();
    if (!nextText) {
      return;
    }

    updateSceneDraft((draft) => ({
      ...draft,
      directorNotes: draft.directorNotes.trim()
        ? `${draft.directorNotes}\n\n${nextText}`
        : nextText,
    }));
  }, [updateSceneDraft]);

  const applySelectionVariant = useCallback((
    messageId: string,
    variant: string,
    variantIndex: number,
    range: SelectionRange,
    mode: 'replace' | 'insertBelow'
  ) => {
    setPendingSelectionReplacement({
      requestId: Date.now(),
      text: variant,
      range,
      mode,
    });
    updateCopilotThreadMessage(messageId, (currentMessage) => ({
      ...currentMessage,
      selectedVariantIndex: variantIndex,
      selectionResolution: mode === 'replace' ? 'replaced' : 'inserted',
    }));
  }, [updateCopilotThreadMessage]);

  const handleCopilotApply = useCallback(async (message: SceneCopilotThreadMessage) => {
    if (message.mode === 'selection') {
      const targetRange = selectionRewriteTargets[message.id] ?? selectedDraftRange;
      if (!targetRange) {
        return;
      }

      setPendingSelectionReplacement({
        requestId: Date.now(),
        text: message.content,
        range: targetRange,
        mode: 'replace',
      });
      return;
    }

    if (message.mode === 'continue') {
      if (!chapterData || !sceneDraft || checkingContinuityByMessageId[message.id]) {
        return;
      }

      const applyContinuation = () => {
        appendCopilotToDraft(message.content);
      };

      const continuityCheck = message.continuityCheck ?? await runCandidateContinuityCheck({
        messageId: message.id,
        candidateText: buildDraftTextWithContinuation(sceneDraft.draftHtml, message.content),
        candidateLabel: t('script.sceneStudio.continuityCheckContinueLabel'),
        scene: cloneScene(sceneDraft),
        chapter: {
          ...chapterData,
          summary: chapterSummary,
          chapterPurpose,
          chapterQuestion,
        },
        continuityContextSnapshot: continuityContext,
        storyRootSnapshot: rootData ?? null,
        persistToMessage: true,
      });

      if (continuityCheck?.status === 'warning') {
        openContinuityGuard({
          title: t('script.sceneStudio.continuityCheckReviewTitle', {
            label: t('script.sceneStudio.continuityCheckContinueLabel'),
          }),
          actionLabel: t('script.sceneStudio.continuityCheckApplyAnyway'),
          check: continuityCheck,
          onConfirm: applyContinuation,
        });
        return;
      }

      applyContinuation();
      return;
    }

    appendCopilotToDirectorNotes(message.content);
  }, [
    appendCopilotToDirectorNotes,
    appendCopilotToDraft,
    chapterData,
    chapterPurpose,
    chapterQuestion,
    chapterSummary,
    checkingContinuityByMessageId,
    continuityContext,
    openContinuityGuard,
    rootData,
    runCandidateContinuityCheck,
    sceneDraft,
    selectedDraftRange,
    selectionRewriteTargets,
    t,
  ]);

  const resolveSelectionTargetRange = useCallback((messageId: string): SelectionRange | null => {
    return selectionRewriteTargets[messageId] ?? selectedDraftRange ?? null;
  }, [selectedDraftRange, selectionRewriteTargets]);

  const hasSelectionTarget = useCallback((messageId: string): boolean => {
    return Boolean(resolveSelectionTargetRange(messageId));
  }, [resolveSelectionTargetRange]);

  const getSelectionResolutionLabel = useCallback((
    resolution: SceneCopilotSelectionResolution | null | undefined,
    selectedVariantIndex?: number | null
  ): string => {
    const number = (selectedVariantIndex ?? 0) + 1;

    switch (resolution) {
      case 'replaced':
        return t('script.sceneStudio.selectionStatusReplaced', { number });
      case 'inserted':
        return t('script.sceneStudio.selectionStatusInserted', { number });
      case 'dismissed':
        return t('script.sceneStudio.selectionStatusDismissed');
      case 'pending':
      default:
        return t('script.sceneStudio.selectionVariantsHint');
    }
  }, [t]);

  const handleApplySelectionVariant = useCallback(async (
    message: SceneCopilotThreadMessage,
    variant: string,
    variantIndex: number,
    mode: 'replace' | 'insertBelow'
  ) => {
    const targetRange = resolveSelectionTargetRange(message.id);
    if (
      !targetRange
      || !chapterData
      || !sceneDraft
      || checkingContinuityByMessageId[message.id]
    ) {
      return;
    }

    const applyVariant = () => {
      applySelectionVariant(message.id, variant, variantIndex, targetRange, mode);
    };

    const continuityCheck = await runCandidateContinuityCheck({
      messageId: message.id,
      candidateText: buildDraftTextWithSelectionChange(
        sceneDraft.draftHtml,
        targetRange,
        variant,
        mode
      ),
      candidateLabel: t('script.sceneStudio.continuityCheckSelectionLabel'),
      scene: cloneScene(sceneDraft),
      chapter: {
        ...chapterData,
        summary: chapterSummary,
        chapterPurpose,
        chapterQuestion,
      },
      continuityContextSnapshot: continuityContext,
      storyRootSnapshot: rootData ?? null,
      persistToMessage: false,
    });

    if (continuityCheck?.status === 'warning') {
      openContinuityGuard({
        title: t('script.sceneStudio.continuityCheckReviewTitle', {
          label: t('script.sceneStudio.continuityCheckSelectionLabel'),
        }),
        actionLabel: t('script.sceneStudio.continuityCheckApplyAnyway'),
        check: continuityCheck,
        onConfirm: applyVariant,
      });
      return;
    }

    applyVariant();
  }, [
    applySelectionVariant,
    chapterData,
    chapterPurpose,
    chapterQuestion,
    chapterSummary,
    checkingContinuityByMessageId,
    continuityContext,
    openContinuityGuard,
    resolveSelectionTargetRange,
    rootData,
    runCandidateContinuityCheck,
    sceneDraft,
    t,
  ]);

  const handleDismissSelectionVariants = useCallback((messageId: string) => {
    updateCopilotThreadMessage(messageId, (currentMessage) => ({
      ...currentMessage,
      selectedVariantIndex: null,
      selectionResolution: 'dismissed',
    }));
  }, [updateCopilotThreadMessage]);

  const toggleSelectionComparison = useCallback((messageId: string, variantIndex: number) => {
    const comparisonKey = `${messageId}-${variantIndex}`;
    setExpandedSelectionComparisons((currentState) => ({
      ...currentState,
      [comparisonKey]: !currentState[comparisonKey],
    }));
  }, []);

  const handleRunCopilot = useCallback(async (mode: SceneCopilotMode) => {
    if (!chapterData || !sceneDraft || isCopilotLoading) {
      return;
    }

    openSection('copilot');

    const trimmedInput = copilotInput.trim();
    if (mode === 'custom' && !trimmedInput) {
      return;
    }

    const sceneForRequest = cloneScene(sceneDraft);
    const sceneId = sceneForRequest.id;
    const seededThread = sceneForRequest.copilotThread?.length
      ? sceneForRequest.copilotThread
      : seedCopilotThread(sceneForRequest);
    const userContent = mode === 'custom' ? trimmedInput : getCopilotModeLabel(mode);
    const userMessage = createCopilotMessage('user', userContent, mode);
    const nextThread = [...seededThread, userMessage];

    appendCopilotThreadMessage(userMessage);
    setCopilotError('');
    setIsCopilotLoading(true);
    if (mode === 'custom') {
      setCopilotInput('');
    }

    try {
      const chapterForRequest: ScriptChapterNodeData = {
        ...chapterData,
        summary: chapterSummary,
        chapterPurpose,
        chapterQuestion,
      };
      const history = nextThread.map((message) => ({
        role: message.role,
        content: message.content,
        selectionVariants: message.selectionVariants,
      }));
      const reply = await runSceneCopilot({
        mode,
        userPrompt: trimmedInput,
        scene: sceneForRequest,
        chapter: chapterForRequest,
        storyRoot: rootData ?? null,
        history,
        continuityContext,
      });
      const assistantMessage = createCopilotMessage('assistant', reply, mode);

      appendCopilotThreadMessage(assistantMessage);

      if (mode === 'continue') {
        void runCandidateContinuityCheck({
          messageId: assistantMessage.id,
          candidateText: buildDraftTextWithContinuation(sceneForRequest.draftHtml, reply),
          candidateLabel: t('script.sceneStudio.continuityCheckContinueLabel'),
          scene: sceneForRequest,
          chapter: chapterForRequest,
          continuityContextSnapshot: continuityContext,
          storyRootSnapshot: rootData ?? null,
          persistToMessage: true,
        });
      }

      setSceneDraft((currentDraft) => {
        if (!currentDraft || currentDraft.id !== sceneId) {
          return currentDraft;
        }

        setIsDirty(true);
        return {
          ...currentDraft,
          copilotSummary: reply,
        };
      });
    } catch (error) {
      setCopilotError(
        error instanceof Error ? error.message : t('script.sceneStudio.copilotUnknownError')
      );
    } finally {
      setIsCopilotLoading(false);
    }
  }, [
    appendCopilotThreadMessage,
    chapterData,
    chapterPurpose,
    chapterQuestion,
    chapterSummary,
    copilotInput,
    getCopilotModeLabel,
    isCopilotLoading,
    rootData,
    runCandidateContinuityCheck,
    sceneDraft,
    t,
    continuityContext,
    openSection,
  ]);

  const handleRewriteSelection = useCallback(async (instruction: string) => {
    if (
      !chapterData
      || !sceneDraft
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

    openSection('copilot');
    openSection('draft');

    const sceneForRequest = cloneScene(sceneDraft);
    const threadBase = sceneForRequest.copilotThread?.length
      ? sceneForRequest.copilotThread
      : seedCopilotThread(sceneForRequest);
    const userMessage = createCopilotMessage('user', trimmedInstruction, 'selection');
    const nextThread = [...threadBase, userMessage];

    appendCopilotThreadMessage(userMessage);
    setSelectionRewriteError('');
    setIsSelectionRewriteLoading(true);
    setSelectionRewriteInput('');

    try {
      const chapterForRequest: ScriptChapterNodeData = {
        ...chapterData,
        summary: chapterSummary,
        chapterPurpose,
        chapterQuestion,
      };
      const history = nextThread.map((message) => ({
        role: message.role,
        content: message.content,
        selectionVariants: message.selectionVariants,
      }));
      const variants = await runSceneSelectionRewriteVariants({
        mode: 'selection',
        userPrompt: trimmedInstruction,
        selectionText: selectedDraftText,
        scene: sceneForRequest,
        chapter: chapterForRequest,
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
        }
      );

      appendCopilotThreadMessage(assistantMessage);
      setSelectionRewriteTargets((currentTargets) => ({
        ...currentTargets,
        [assistantMessage.id]: selectedDraftRange,
      }));
      setSceneDraft((currentDraft) => {
        if (!currentDraft || currentDraft.id !== sceneForRequest.id) {
          return currentDraft;
        }

        setIsDirty(true);
        return {
          ...currentDraft,
          copilotSummary: resolvedVariants[0] ?? '',
        };
      });
    } catch (error) {
      setSelectionRewriteError(
        error instanceof Error ? error.message : t('script.sceneStudio.copilotUnknownError')
      );
    } finally {
      setIsSelectionRewriteLoading(false);
    }
  }, [
    appendCopilotThreadMessage,
    chapterData,
    chapterPurpose,
    chapterQuestion,
    chapterSummary,
    isSelectionRewriteLoading,
    rootData,
    sceneDraft,
    selectedDraftRange,
    selectedDraftText,
    t,
    continuityContext,
    openSection,
  ]);

  const handleRestoreImportedOriginal = useCallback(() => {
    if (!sceneDraft || !sceneDraft.sourceDraftHtml?.trim()) {
      return;
    }

    const restoredScene: SceneCard = {
      ...sceneDraft,
      draftHtml: sceneDraft.sourceDraftHtml,
      status: 'drafting',
    };

    setSceneDraft(restoredScene);
    sceneDraftRef.current = cloneScene(restoredScene);
    setSelectedDraftText('');
    setSelectedDraftRange(null);
    setSelectionRewriteError('');
    setPendingSelectionReplacement(null);
    setIsImportedComparisonVisible(false);
    setHasRestoredImportedOriginal(true);
    persistSceneDraftSnapshot(restoredScene, 'push');
  }, [persistSceneDraftSnapshot, sceneDraft]);

  const handleRefreshContinuityMemory = useCallback(async () => {
    if (!chapterData || !sceneDraft || isContinuityRefreshing) {
      return;
    }

    openSection('continuity');

    setContinuityError('');
    setIsContinuityRefreshing(true);

    try {
      const chapterForRequest: ScriptChapterNodeData = {
        ...chapterData,
        summary: chapterSummary,
        chapterPurpose,
        chapterQuestion,
      };
      const memory = await generateSceneContinuityMemory({
        scene: cloneScene(sceneDraft),
        chapter: chapterForRequest,
        storyRoot: rootData ?? null,
        continuityContext,
      });

      updateSceneDraft((draft) => ({
        ...draft,
        continuitySummary: memory.summary,
        continuityFacts: memory.facts,
        continuityOpenLoops: memory.openLoops,
        continuityUpdatedAt: memory.updatedAt,
      }));
    } catch (error) {
      setContinuityError(
        error instanceof Error
          ? error.message
          : t('script.sceneStudio.continuityRefreshError')
      );
    } finally {
      setIsContinuityRefreshing(false);
    }
  }, [
    chapterData,
    chapterPurpose,
    chapterQuestion,
    chapterSummary,
    continuityContext,
    isContinuityRefreshing,
    rootData,
    sceneDraft,
    t,
    updateSceneDraft,
    openSection,
  ]);

  if (currentProject?.projectType !== 'script') {
    return null;
  }

  return (
    <aside
      className="flex h-full shrink-0 flex-col border-l border-border-dark bg-surface-dark"
      style={{ width: 'clamp(500px, 42vw, 680px)' }}
    >
      <div className="flex items-center justify-between border-b border-border-dark px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Clapperboard className="h-4 w-4 text-amber-400" />
            <span className="text-sm font-semibold text-text-dark">
              {t('script.sceneStudio.title')}
            </span>
          </div>
          <p className="mt-1 text-xs text-text-muted">
            {t('script.sceneStudio.subtitle')}
          </p>
        </div>
        <button
          type="button"
          onClick={clearSelection}
          className="rounded-lg border border-border-dark px-2 py-1 text-xs text-text-muted transition-colors hover:bg-bg-dark hover:text-text-dark"
        >
          {t('common.close')}
        </button>
      </div>

      {!chapterNode || !chapterData || !sceneDraft ? (
        <div className="flex flex-1 items-center justify-center p-6">
          <div className="max-w-[280px] rounded-2xl border border-dashed border-border-dark bg-bg-dark/45 p-5 text-center">
            <FileText className="mx-auto h-9 w-9 text-text-muted" />
            <h3 className="mt-3 text-sm font-semibold text-text-dark">
              {t('script.sceneStudio.emptyTitle')}
            </h3>
            <p className="mt-2 text-sm leading-6 text-text-muted">
              {t('script.sceneStudio.emptyHint')}
            </p>
          </div>
        </div>
      ) : (
        <>
          <div className="border-b border-border-dark px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-xs text-text-muted">
                  {t('script.sceneStudio.chapterLabel', {
                    number: chapterData.chapterNumber || 1,
                  })}
                </div>
                <div className="truncate text-sm font-semibold text-text-dark">
                  {chapterData.title || t('script.sceneStudio.untitledChapter')}
                </div>
              </div>
              <button
                type="button"
                onClick={handleAddScene}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border-dark bg-bg-dark px-2.5 py-1.5 text-xs font-medium text-text-dark transition-colors hover:border-border-dark/80 hover:bg-bg-dark/80"
              >
                <Plus className="h-3.5 w-3.5" />
                {t('script.sceneStudio.addScene')}
              </button>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {scenes.map((scene) => {
                const isActive = scene.id === sceneDraft.id;
                return (
                  <button
                    key={scene.id}
                    type="button"
                    onClick={() => focusScene(chapterNode.id, scene.id)}
                    className={`rounded-lg border px-2.5 py-1.5 text-left text-xs transition-colors ${
                      isActive
                        ? 'border-amber-500/45 bg-amber-500/12 text-amber-200'
                        : 'border-border-dark bg-bg-dark text-text-muted hover:text-text-dark'
                    }`}
                  >
                    <div className="font-medium">
                      {scene.title || t('script.sceneStudio.untitledScene')}
                    </div>
                    <div className="mt-0.5 text-[11px] opacity-70">
                      {t('script.sceneStudio.sceneLabel', { number: scene.order + 1 })}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-4">
            <div className="space-y-4">
              <SceneStudioSection
                icon={<FileText className="h-4 w-4 text-sky-300" />}
                title={t('script.sceneStudio.chapterFocusTitle')}
                description={t('script.sceneStudio.chapterFocusSubtitle')}
                isOpen={sectionState.chapterFocus}
                onToggle={() => toggleSection('chapterFocus')}
              >
                <div className="space-y-3">
                  <Field label={t('script.sceneStudio.chapterSummary')}>
                    <Textarea
                      value={chapterSummary}
                      onChange={(value) => {
                        setChapterSummary(value);
                        setIsDirty(true);
                      }}
                      placeholder={t('script.sceneStudio.chapterSummaryPlaceholder')}
                    />
                  </Field>

                  <div className="grid grid-cols-2 gap-3">
                    <Field label={t('script.sceneStudio.chapterPurpose')}>
                      <Input
                        value={chapterPurpose}
                        onChange={(value) => {
                          setChapterPurpose(value);
                          setIsDirty(true);
                        }}
                        placeholder={t('script.sceneStudio.chapterPurposePlaceholder')}
                      />
                    </Field>
                    <Field label={t('script.sceneStudio.chapterQuestion')}>
                      <Input
                        value={chapterQuestion}
                        onChange={(value) => {
                          setChapterQuestion(value);
                          setIsDirty(true);
                        }}
                        placeholder={t('script.sceneStudio.chapterQuestionPlaceholder')}
                      />
                    </Field>
                  </div>
                </div>
              </SceneStudioSection>

              <SceneStudioSection
                icon={<Clapperboard className="h-4 w-4 text-amber-300" />}
                title={t('script.sceneStudio.sceneBlueprintTitle')}
                description={t('script.sceneStudio.sceneBlueprintSubtitle')}
                isOpen={sectionState.sceneBlueprint}
                onToggle={() => toggleSection('sceneBlueprint')}
              >
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <Field label={t('script.sceneStudio.sceneTitle')}>
                      <Input
                        value={sceneDraft.title}
                        onChange={(value) => {
                          updateSceneDraft((draft) => ({ ...draft, title: value }));
                        }}
                        placeholder={t('script.sceneStudio.sceneTitlePlaceholder')}
                      />
                    </Field>
                    <Field label={t('script.sceneStudio.povCharacter')}>
                      <Input
                        value={sceneDraft.povCharacter}
                        onChange={(value) => {
                          updateSceneDraft((draft) => ({ ...draft, povCharacter: value }));
                        }}
                        placeholder={t('script.sceneStudio.povCharacterPlaceholder')}
                      />
                    </Field>
                  </div>

                  <Field label={t('script.sceneStudio.sceneSummary')}>
                    <Textarea
                      value={sceneDraft.summary}
                      onChange={(value) => {
                        updateSceneDraft((draft) => ({ ...draft, summary: value }));
                      }}
                      placeholder={t('script.sceneStudio.sceneSummaryPlaceholder')}
                    />
                  </Field>

                  <div className="grid grid-cols-2 gap-3">
                    <Field label={t('script.sceneStudio.scenePurpose')}>
                      <Input
                        value={sceneDraft.purpose}
                        onChange={(value) => {
                          updateSceneDraft((draft) => ({ ...draft, purpose: value }));
                        }}
                        placeholder={t('script.sceneStudio.scenePurposePlaceholder')}
                      />
                    </Field>
                    <Field label={t('script.sceneStudio.emotionalShift')}>
                      <Input
                        value={sceneDraft.emotionalShift}
                        onChange={(value) => {
                          updateSceneDraft((draft) => ({ ...draft, emotionalShift: value }));
                        }}
                        placeholder={t('script.sceneStudio.emotionalShiftPlaceholder')}
                      />
                    </Field>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <Field label={t('script.sceneStudio.goal')}>
                      <Input
                        value={sceneDraft.goal}
                        onChange={(value) => {
                          updateSceneDraft((draft) => ({ ...draft, goal: value }));
                        }}
                        placeholder={t('script.sceneStudio.goalPlaceholder')}
                      />
                    </Field>
                    <Field label={t('script.sceneStudio.conflict')}>
                      <Input
                        value={sceneDraft.conflict}
                        onChange={(value) => {
                          updateSceneDraft((draft) => ({ ...draft, conflict: value }));
                        }}
                        placeholder={t('script.sceneStudio.conflictPlaceholder')}
                      />
                    </Field>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <Field label={t('script.sceneStudio.turn')}>
                      <Input
                        value={sceneDraft.turn}
                        onChange={(value) => {
                          updateSceneDraft((draft) => ({ ...draft, turn: value }));
                        }}
                        placeholder={t('script.sceneStudio.turnPlaceholder')}
                      />
                    </Field>
                    <Field label={t('script.sceneStudio.visualHook')}>
                      <Input
                        value={sceneDraft.visualHook}
                        onChange={(value) => {
                          updateSceneDraft((draft) => ({ ...draft, visualHook: value }));
                        }}
                        placeholder={t('script.sceneStudio.visualHookPlaceholder')}
                      />
                    </Field>
                  </div>

                  <Field label={t('script.sceneStudio.subtext')}>
                    <Textarea
                      value={sceneDraft.subtext}
                      onChange={(value) => {
                        updateSceneDraft((draft) => ({ ...draft, subtext: value }));
                      }}
                      placeholder={t('script.sceneStudio.subtextPlaceholder')}
                    />
                  </Field>

                  <Field label={t('script.sceneStudio.directorNotes')}>
                    <Textarea
                      value={sceneDraft.directorNotes}
                      onChange={(value) => {
                        updateSceneDraft((draft) => ({ ...draft, directorNotes: value }));
                      }}
                      placeholder={t('script.sceneStudio.directorNotesPlaceholder')}
                    />
                  </Field>
                </div>
              </SceneStudioSection>

              <SceneStudioSection
                icon={<Link2 className="h-4 w-4 text-cyan-300" />}
                title={t('script.sceneStudio.continuityTitle')}
                description={t('script.sceneStudio.continuitySubtitle')}
                isOpen={sectionState.continuity}
                onToggle={() => toggleSection('continuity')}
                actions={(
                  <button
                    type="button"
                    onClick={() => void handleRefreshContinuityMemory()}
                    disabled={isContinuityRefreshing}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-cyan-500/25 bg-cyan-500/10 px-2.5 py-1.5 text-xs font-medium text-cyan-200 transition-colors hover:bg-cyan-500/18 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isContinuityRefreshing ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <RefreshCcw className="h-3.5 w-3.5" />
                    )}
                    {isContinuityRefreshing
                      ? t('script.sceneStudio.continuityRefreshing')
                      : t('script.sceneStudio.continuityRefresh')}
                  </button>
                )}
              >
                <div className="space-y-3">
                  <div className="rounded-xl border border-cyan-500/15 bg-cyan-500/8 px-3 py-2 text-[11px] leading-5 text-cyan-100">
                    {t('script.sceneStudio.continuityHint')}
                  </div>

                  {continuityError ? (
                    <div className="rounded-xl border border-red-500/20 bg-red-500/8 px-3 py-2 text-xs leading-5 text-red-200">
                      {continuityError}
                    </div>
                  ) : null}

                  <Field label={t('script.sceneStudio.continuitySummary')}>
                    <Textarea
                      value={sceneDraft.continuitySummary}
                      onChange={(value) => {
                        updateSceneDraft((draft) => ({
                          ...draft,
                          continuitySummary: value,
                          continuityUpdatedAt: Date.now(),
                        }));
                      }}
                      placeholder={t('script.sceneStudio.continuitySummaryPlaceholder')}
                      rows={3}
                    />
                  </Field>

                  <Field label={t('script.sceneStudio.continuityFacts')}>
                    <Textarea
                      value={sceneDraft.continuityFacts.join('\n')}
                      onChange={(value) => {
                        updateSceneDraft((draft) => ({
                          ...draft,
                          continuityFacts: parseMultilineItems(value),
                          continuityUpdatedAt: Date.now(),
                        }));
                      }}
                      placeholder={t('script.sceneStudio.continuityFactsPlaceholder')}
                      rows={4}
                    />
                  </Field>

                  <Field label={t('script.sceneStudio.continuityOpenLoops')}>
                    <Textarea
                      value={sceneDraft.continuityOpenLoops.join('\n')}
                      onChange={(value) => {
                        updateSceneDraft((draft) => ({
                          ...draft,
                          continuityOpenLoops: parseMultilineItems(value),
                          continuityUpdatedAt: Date.now(),
                        }));
                      }}
                      placeholder={t('script.sceneStudio.continuityOpenLoopsPlaceholder')}
                      rows={4}
                    />
                  </Field>

                  <div className="text-[11px] leading-5 text-text-muted">
                    {sceneDraft.continuityUpdatedAt
                      ? t('script.sceneStudio.continuityUpdatedAt', {
                          time: new Date(sceneDraft.continuityUpdatedAt).toLocaleTimeString(),
                        })
                      : t('script.sceneStudio.continuityNotGenerated')}
                  </div>
                </div>
              </SceneStudioSection>

              <SceneStudioSection
                icon={<Sparkles className="h-4 w-4 text-amber-300" />}
                title={t('script.sceneStudio.copilotTitle')}
                description={t('script.sceneStudio.copilotSubtitle')}
                isOpen={sectionState.copilot}
                onToggle={() => toggleSection('copilot')}
              >
                <div className="space-y-3">
                  <div className="flex flex-wrap gap-2">
                  {(['analysis', 'continue', 'director'] as SceneCopilotMode[]).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => void handleRunCopilot(mode)}
                      disabled={isCopilotLoading}
                      className="rounded-lg border border-border-dark bg-surface-dark px-2.5 py-1.5 text-xs text-text-dark transition-colors hover:border-amber-500/30 hover:bg-amber-500/8 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {getCopilotModeLabel(mode)}
                    </button>
                  ))}
                  </div>

                  <div className="max-h-[220px] space-y-3 overflow-y-auto pr-1">
                  {currentCopilotMessages.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-border-dark px-3 py-4 text-sm text-text-muted">
                      {t('script.sceneStudio.copilotEmpty')}
                    </div>
                  ) : (
                    currentCopilotMessages.map((message) => (
                      <div
                        key={message.id}
                        className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                      >
                        <div
                          className={`max-w-[92%] rounded-2xl px-3 py-2 ${
                            message.role === 'user'
                              ? 'border border-amber-500/30 bg-amber-500/10 text-amber-100'
                              : 'border border-border-dark bg-surface-dark text-text-dark'
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-text-muted">
                              {message.role === 'user'
                                ? t('script.sceneStudio.copilotUserLabel')
                                : t('script.sceneStudio.copilotAssistantLabel')}
                            </span>
                            <span className="rounded-full border border-border-dark px-2 py-0.5 text-[10px] text-text-muted">
                              {getCopilotModeLabel(message.mode)}
                            </span>
                          </div>
                          {message.mode === 'selection' && message.selectionVariants?.length ? (
                            <div className="mt-2 space-y-3">
                              <div className="text-sm leading-6 text-text-muted">
                                {message.content}
                              </div>
                              <div className="rounded-xl border border-cyan-500/15 bg-cyan-500/8 px-3 py-2 text-[11px] leading-5 text-cyan-100">
                                {getSelectionResolutionLabel(
                                  message.selectionResolution,
                                  message.selectedVariantIndex
                                )}
                              </div>
                              {message.selectionVariants.map((variant, index) => (
                                <div
                                  key={`${message.id}-${index}`}
                                  className="rounded-xl border border-border-dark/80 bg-bg-dark/45 p-3"
                                >
                                  {(() => {
                                    const comparisonKey = `${message.id}-${index}`;
                                    const isComparisonOpen = Boolean(
                                      expandedSelectionComparisons[comparisonKey]
                                    );
                                    const sourceText = message.selectionSourceText?.trim() ?? '';

                                    return (
                                      <>
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-text-muted">
                                      {t('script.sceneStudio.selectionVariantLabel', {
                                        number: index + 1,
                                      })}
                                    </span>
                                    {message.selectedVariantIndex === index
                                    && message.selectionResolution
                                    && message.selectionResolution !== 'pending'
                                    && message.selectionResolution !== 'dismissed' ? (
                                      <span className="rounded-full border border-cyan-500/25 bg-cyan-500/12 px-2 py-0.5 text-[10px] text-cyan-100">
                                        {t('script.sceneStudio.selectionChosen')}
                                      </span>
                                    ) : null}
                                  </div>
                                  <div className="mt-2 whitespace-pre-wrap text-sm leading-6">
                                    {variant}
                                  </div>
                                  {sourceText ? (
                                    <div className="mt-3 flex justify-start">
                                      <button
                                        type="button"
                                        onClick={() => toggleSelectionComparison(message.id, index)}
                                        className="rounded-lg border border-border-dark px-2 py-1 text-[11px] text-text-muted transition-colors hover:bg-bg-dark hover:text-text-dark"
                                      >
                                        {isComparisonOpen
                                          ? t('script.sceneStudio.selectionCompareClose')
                                          : t('script.sceneStudio.selectionCompareOpen')}
                                      </button>
                                    </div>
                                  ) : null}
                                  {sourceText && isComparisonOpen ? (
                                    <SelectionDiffPreview
                                      originalText={sourceText}
                                      rewrittenText={variant}
                                      originalLabel={t('script.sceneStudio.selectionOriginalLabel')}
                                      rewrittenLabel={t('script.sceneStudio.selectionRewriteLabel')}
                                      addedLabel={t('script.sceneStudio.selectionDiffAdded')}
                                      removedLabel={t('script.sceneStudio.selectionDiffRemoved')}
                                    />
                                  ) : null}
                                  {message.selectionResolution === 'pending' ? (
                                    <div className="mt-3 flex flex-wrap justify-end gap-2">
                                      <button
                                        type="button"
                                        onClick={() => handleApplySelectionVariant(
                                          message,
                                          variant,
                                          index,
                                          'replace'
                                        )}
                                        disabled={
                                          !hasSelectionTarget(message.id)
                                          || Boolean(checkingContinuityByMessageId[message.id])
                                        }
                                        className="inline-flex items-center gap-1 rounded-lg border border-cyan-500/25 px-2 py-1 text-[11px] text-cyan-100 transition-colors hover:bg-cyan-500/12 disabled:cursor-not-allowed disabled:opacity-50"
                                      >
                                        <Check className="h-3.5 w-3.5" />
                                        {t('script.sceneStudio.selectionApplyReplace')}
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => handleApplySelectionVariant(
                                          message,
                                          variant,
                                          index,
                                          'insertBelow'
                                        )}
                                        disabled={
                                          !hasSelectionTarget(message.id)
                                          || Boolean(checkingContinuityByMessageId[message.id])
                                        }
                                        className="inline-flex items-center gap-1 rounded-lg border border-border-dark px-2 py-1 text-[11px] text-text-muted transition-colors hover:bg-bg-dark hover:text-text-dark disabled:cursor-not-allowed disabled:opacity-50"
                                      >
                                        <CornerDownLeft className="h-3.5 w-3.5" />
                                        {t('script.sceneStudio.selectionApplyInsertBelow')}
                                      </button>
                                    </div>
                                  ) : null}
                                      </>
                                    );
                                  })()}
                                </div>
                              ))}
                              {message.selectionResolution === 'pending' ? (
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <div className="text-[11px] leading-5 text-text-muted">
                                    {checkingContinuityByMessageId[message.id]
                                      ? t('script.sceneStudio.continuityCheckRunning')
                                      : hasSelectionTarget(message.id)
                                      ? t('script.sceneStudio.selectionVariantsHint')
                                      : t('script.sceneStudio.selectionNeedTarget')}
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => handleDismissSelectionVariants(message.id)}
                                    className="inline-flex items-center gap-1 rounded-lg border border-border-dark px-2 py-1 text-[11px] text-text-muted transition-colors hover:bg-bg-dark hover:text-text-dark"
                                  >
                                    <X className="h-3.5 w-3.5" />
                                    {t('script.sceneStudio.selectionDismiss')}
                                  </button>
                                </div>
                              ) : null}
                            </div>
                          ) : (
                            <>
                            <div className="mt-2 whitespace-pre-wrap text-sm leading-6">
                                {message.content}
                              </div>
                              {message.role === 'assistant' && message.mode === 'continue' ? (
                                Boolean(checkingContinuityByMessageId[message.id]) ? (
                                  <div className="mt-3 inline-flex items-center gap-2 rounded-xl border border-border-dark bg-bg-dark/45 px-3 py-2 text-[11px] text-text-muted">
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                    {t('script.sceneStudio.continuityCheckRunning')}
                                  </div>
                                ) : message.continuityCheck?.status === 'warning' ? (
                                  <div className="mt-3 rounded-xl border border-amber-500/25 bg-amber-500/10 px-3 py-2">
                                    <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.08em] text-amber-100">
                                      <AlertTriangle className="h-3.5 w-3.5" />
                                      {t('script.sceneStudio.continuityCheckWarning')}
                                    </div>
                                    <div className="mt-1 text-xs leading-5 text-amber-100/90">
                                      {message.continuityCheck.summary}
                                    </div>
                                    <div className="mt-2 text-[11px] leading-5 text-amber-100/75">
                                      {message.continuityCheck.issues.length > 0
                                        ? t('script.sceneStudio.continuityCheckIssues', {
                                            count: message.continuityCheck.issues.length,
                                          })
                                        : t('script.sceneStudio.continuityCheckNoIssues')}
                                    </div>
                                  </div>
                                ) : null
                              ) : null}
                              {message.role === 'assistant'
                              && message.mode !== 'seed'
                              && (message.mode !== 'selection' || Boolean(selectionRewriteTargets[message.id] ?? selectedDraftRange)) ? (
                                <div className="mt-3 flex justify-end">
                                  <button
                                    type="button"
                                    onClick={() => handleCopilotApply(message)}
                                    disabled={Boolean(
                                      message.mode === 'continue'
                                      && checkingContinuityByMessageId[message.id]
                                    )}
                                    className="rounded-lg border border-border-dark px-2 py-1 text-[11px] text-text-muted transition-colors hover:bg-bg-dark hover:text-text-dark disabled:cursor-not-allowed disabled:opacity-50"
                                  >
                                    {message.mode === 'continue'
                                      ? t('script.sceneStudio.copilotApplyDraft')
                                      : message.mode === 'selection'
                                        ? t('script.sceneStudio.copilotApplySelection')
                                        : t('script.sceneStudio.copilotApplyNotes')}
                                  </button>
                                </div>
                              ) : null}
                            </>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                  </div>

                  {copilotError || selectionRewriteError ? (
                  <div className="rounded-xl border border-red-500/20 bg-red-500/8 px-3 py-2 text-xs leading-5 text-red-200">
                    {copilotError || selectionRewriteError}
                  </div>
                ) : null}

                <Field label={t('script.sceneStudio.copilotInputLabel')}>
                  <Textarea
                    value={copilotInput}
                    onChange={setCopilotInput}
                    rows={3}
                    placeholder={t('script.sceneStudio.copilotInputPlaceholder')}
                  />
                </Field>

                  <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => void handleRunCopilot('custom')}
                    disabled={isCopilotLoading || copilotInput.trim().length === 0}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/35 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-300 transition-colors hover:bg-amber-500/18 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isCopilotLoading ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <SendHorizonal className="h-3.5 w-3.5" />
                    )}
                    {isCopilotLoading
                      ? t('script.sceneStudio.copilotThinking')
                      : t('script.sceneStudio.copilotAsk')}
                  </button>
                  </div>
                </div>
              </SceneStudioSection>

              {hasImportedOriginal ? (
                <SceneStudioSection
                  icon={<FileText className="h-4 w-4 text-amber-300" />}
                  title={t('script.sceneStudio.importOriginalTitle')}
                  description={t('script.sceneStudio.importOriginalHint')}
                  isOpen={sectionState.importedSource}
                  onToggle={() => toggleSection('importedSource')}
                >
                  <div className="space-y-3">
                    {importedOriginalLabel ? (
                      <div className="text-[11px] leading-5 text-amber-100/80">
                        {t('script.sceneStudio.importOriginalSource', {
                          label: importedOriginalLabel,
                        })}
                      </div>
                    ) : null}

                    {hasRestoredImportedOriginal ? (
                      <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1.5 text-[11px] leading-5 text-emerald-100">
                        {t('script.sceneStudio.importOriginalRestored')}
                      </div>
                    ) : null}

                    <div className="flex flex-wrap justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setIsImportedComparisonVisible((visible) => !visible)}
                        className="rounded-lg border border-border-dark px-2.5 py-1.5 text-xs text-text-muted transition-colors hover:bg-bg-dark hover:text-text-dark"
                      >
                        {isImportedComparisonVisible
                          ? t('script.sceneStudio.importOriginalCompareClose')
                          : t('script.sceneStudio.importOriginalCompareOpen')}
                      </button>
                      <button
                        type="button"
                        onClick={handleRestoreImportedOriginal}
                        disabled={!canRestoreImportedOriginal}
                        className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-xs text-amber-200 transition-colors hover:bg-amber-500/16 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {t('script.sceneStudio.importOriginalRestore')}
                      </button>
                    </div>

                    {isImportedComparisonVisible ? (
                      <SelectionDiffPreview
                        originalText={importedOriginalText}
                        rewrittenText={currentDraftText}
                        originalLabel={importedOriginalDiffLabel}
                        rewrittenLabel={t('script.sceneStudio.currentDraftLabel')}
                        addedLabel={t('script.sceneStudio.selectionDiffAdded')}
                        removedLabel={t('script.sceneStudio.selectionDiffRemoved')}
                      />
                    ) : null}
                  </div>
                </SceneStudioSection>
              ) : null}

              <SceneStudioSection
                icon={<FileText className="h-4 w-4 text-emerald-300" />}
                title={t('script.sceneStudio.draft')}
                description={t('script.sceneStudio.draftSubtitle')}
                isOpen={sectionState.draft}
                onToggle={() => toggleSection('draft')}
              >
                <div className="flex min-h-[620px] flex-col">
                  {selectedDraftText.trim() ? (
                    <div className="mb-3 rounded-xl border border-cyan-500/20 bg-cyan-500/8 p-3">
                      <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-cyan-200">
                        {t('script.sceneStudio.selectionTitle')}
                      </div>
                      <div className="mt-2 line-clamp-3 whitespace-pre-wrap text-sm leading-6 text-text-dark">
                        {selectedDraftText}
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => void handleRewriteSelection(t('script.sceneStudio.selectionActionTightenPrompt'))}
                          disabled={isSelectionRewriteLoading}
                          className="rounded-lg border border-border-dark bg-surface-dark px-2.5 py-1.5 text-xs text-text-dark transition-colors hover:border-cyan-500/30 hover:bg-cyan-500/8 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {t('script.sceneStudio.selectionActionTighten')}
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleRewriteSelection(t('script.sceneStudio.selectionActionSubtextPrompt'))}
                          disabled={isSelectionRewriteLoading}
                          className="rounded-lg border border-border-dark bg-surface-dark px-2.5 py-1.5 text-xs text-text-dark transition-colors hover:border-cyan-500/30 hover:bg-cyan-500/8 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {t('script.sceneStudio.selectionActionSubtext')}
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleRewriteSelection(t('script.sceneStudio.selectionActionDialoguePrompt'))}
                          disabled={isSelectionRewriteLoading}
                          className="rounded-lg border border-border-dark bg-surface-dark px-2.5 py-1.5 text-xs text-text-dark transition-colors hover:border-cyan-500/30 hover:bg-cyan-500/8 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {t('script.sceneStudio.selectionActionDialogue')}
                        </button>
                      </div>
                      <div className="mt-3 flex gap-2">
                        <input
                          type="text"
                          value={selectionRewriteInput}
                          onChange={(event) => setSelectionRewriteInput(event.target.value)}
                          placeholder={t('script.sceneStudio.selectionInputPlaceholder')}
                          className="flex-1 rounded-lg border border-border-dark bg-bg-dark px-3 py-2 text-sm text-text-dark outline-none transition-colors placeholder:text-text-muted/60 focus:border-cyan-500/35"
                        />
                        <button
                          type="button"
                          onClick={() => void handleRewriteSelection(selectionRewriteInput)}
                          disabled={isSelectionRewriteLoading || selectionRewriteInput.trim().length === 0}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-500/35 bg-cyan-500/10 px-3 py-1.5 text-xs font-medium text-cyan-200 transition-colors hover:bg-cyan-500/18 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {isSelectionRewriteLoading ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Sparkles className="h-3.5 w-3.5" />
                          )}
                          {isSelectionRewriteLoading
                            ? t('script.sceneStudio.selectionActionBusy')
                            : t('script.sceneStudio.selectionActionCustom')}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="mb-3 rounded-xl border border-dashed border-border-dark bg-bg-dark/25 px-3 py-2 text-xs leading-5 text-text-muted">
                      {t('script.sceneStudio.selectionEmpty')}
                    </div>
                  )}

                  <div className="min-h-0 flex-1">
                    <RichTextEditor
                      content={sceneDraft.draftHtml}
                      onChange={(value) => {
                        updateSceneDraft((draft) => ({ ...draft, draftHtml: value }));
                      }}
                      onSelect={({ text, range }) => {
                        setSelectedDraftText(text);
                        setSelectedDraftRange(range);
                        setSelectionRewriteError('');
                      }}
                      pendingSelectionReplacement={pendingSelectionReplacement}
                      onSelectionReplacementApplied={() => {
                        setPendingSelectionReplacement(null);
                      }}
                      placeholder={t('script.sceneStudio.draftPlaceholder')}
                      className="h-full"
                    />
                  </div>
                </div>
              </SceneStudioSection>
            </div>
          </div>

          {pendingContinuityGuard ? (
            <div className="border-t border-border-dark px-4 py-3">
              <div className="rounded-2xl border border-amber-500/25 bg-amber-500/10 p-4">
                <div className="flex items-start gap-3">
                  <div className="rounded-xl bg-amber-500/12 p-2 text-amber-200">
                    <AlertTriangle className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-amber-100">
                      {pendingContinuityGuard.title}
                    </div>
                    <p className="mt-1 text-xs leading-5 text-amber-100/90">
                      {pendingContinuityGuard.check.summary}
                    </p>
                    <div className="mt-3 text-[11px] font-medium uppercase tracking-[0.08em] text-amber-100/80">
                      {pendingContinuityGuard.check.issues.length > 0
                        ? t('script.sceneStudio.continuityCheckIssues', {
                            count: pendingContinuityGuard.check.issues.length,
                          })
                        : t('script.sceneStudio.continuityCheckNoIssues')}
                    </div>
                    {pendingContinuityGuard.check.issues.length > 0 ? (
                      <div className="mt-2 space-y-2">
                        {pendingContinuityGuard.check.issues.map((issue: SceneContinuityIssue) => (
                          <div
                            key={issue.id}
                            className="rounded-xl border border-amber-500/15 bg-black/10 px-3 py-2"
                          >
                            <div className="flex items-center gap-2">
                              <span className="rounded-full border border-amber-500/20 px-2 py-0.5 text-[10px] uppercase tracking-[0.08em] text-amber-100/75">
                                {issue.severity}
                              </span>
                              <span className="text-xs font-medium text-amber-100">
                                {issue.title}
                              </span>
                            </div>
                            <div className="mt-1 text-xs leading-5 text-amber-100/85">
                              {issue.detail}
                            </div>
                            {issue.evidence ? (
                              <div className="mt-1 text-[11px] leading-5 text-amber-100/70">
                                {issue.evidence}
                              </div>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    ) : null}
                    <div className="mt-4 flex flex-wrap justify-end gap-2">
                      <button
                        type="button"
                        onClick={closeContinuityGuard}
                        className="rounded-lg border border-border-dark px-3 py-1.5 text-xs text-text-muted transition-colors hover:bg-bg-dark hover:text-text-dark"
                      >
                        {t('script.sceneStudio.continuityCheckCancel')}
                      </button>
                      <button
                        type="button"
                        onClick={confirmContinuityGuard}
                        className="rounded-lg border border-amber-500/35 bg-amber-500/12 px-3 py-1.5 text-xs font-medium text-amber-100 transition-colors hover:bg-amber-500/18"
                      >
                        {pendingContinuityGuard.actionLabel}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          <div className="flex items-center justify-between border-t border-border-dark px-4 py-3">
            <div className="text-xs text-text-muted">
              {isDirty
                ? t('script.sceneStudio.autosavePending')
                : lastSavedAt
                  ? t('script.sceneStudio.savedAt', {
                      time: new Date(lastSavedAt).toLocaleTimeString(),
                    })
                  : t('script.sceneStudio.autosaveIdle')}
            </div>
            <button
              type="button"
              onClick={() => persistDraft('push')}
              className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/35 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-300 transition-colors hover:bg-amber-500/18"
            >
              <Save className="h-3.5 w-3.5" />
              {t('common.save')}
            </button>
          </div>
        </>
      )}
    </aside>
  );
}
