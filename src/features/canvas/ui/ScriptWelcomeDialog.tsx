import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, FileText, Sparkles, Upload, Wand2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { UiButton, UiLoadingOverlay } from '@/components/ui';
import { CANVAS_NODE_TYPES, createDefaultSceneCard } from '../domain/canvasNodes';
import { planStory, type StoryPlan, type StoryPlannerInput } from '../application/storyPlanner';
import {
  importScriptFile,
  type ImportedScriptDocument,
  type ScriptImportFormat,
  type ScriptImportWarningCode,
} from '../application/scriptImporter';
import { useCanvasStore } from '@/stores/canvasStore';
import { useProjectStore } from '@/stores/projectStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { ChapterCountDialog } from './ChapterCountDialog';
import { ScriptImportDialog } from './ScriptImportDialog';
import { ScriptImportPreview } from './ScriptImportPreview';
import { openSettingsDialog } from '@/features/settings/settingsEvents';
import {
  resolveActivatedScriptProvider,
  resolveConfiguredScriptModel,
} from '@/features/canvas/models';

interface ScriptWelcomeDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

type WelcomeMode = 'select' | 'import' | 'create';

const INITIAL_FORM: StoryPlannerInput = {
  premise: '',
  protagonist: '',
  want: '',
  stakes: '',
  genre: '',
  theme: '',
  tone: '',
  directorVision: '',
  worldviewDescription: '',
  chapterCount: 5,
};

function mapScenesForChapter(plan: StoryPlan, chapterIndex: number) {
  return plan.chapters[chapterIndex]?.scenes.map((scene, sceneIndex) => ({
    ...createDefaultSceneCard(sceneIndex),
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
    status: 'idea' as const,
  })) ?? [createDefaultSceneCard(0)];
}

function mapImportedScenes(document: ImportedScriptDocument, chapterIndex: number) {
  return document.chapters[chapterIndex]?.scenes.map((scene, sceneIndex) => ({
    ...createDefaultSceneCard(sceneIndex),
    title: scene.title,
    summary: scene.summary,
    draftHtml: scene.draftHtml,
    sourceDraftHtml: scene.draftHtml,
    sourceDraftLabel: document.sourceName,
    status: 'drafting' as const,
  })) ?? [createDefaultSceneCard(0)];
}

export function ScriptWelcomeDialog({ isOpen, onClose }: ScriptWelcomeDialogProps) {
  const { t } = useTranslation();
  const { addNode, addEdge, setSelectedNode } = useCanvasStore();
  const closeProject = useProjectStore((state) => state.closeProject);
  const settings = useSettingsStore();
  const activeScriptProvider = resolveActivatedScriptProvider(settings);
  const activeScriptModel = activeScriptProvider
    ? resolveConfiguredScriptModel(activeScriptProvider, settings).trim()
    : '';
  const hasScriptProvider =
    Boolean(activeScriptProvider)
    && Boolean(activeScriptModel)
    && Boolean(activeScriptProvider ? settings.scriptApiKeys[activeScriptProvider]?.trim() : '');

  const [mode, setMode] = useState<WelcomeMode>('select');
  const [form, setForm] = useState<StoryPlannerInput>(INITIAL_FORM);
  const [isPlanning, setIsPlanning] = useState(false);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [plannedStory, setPlannedStory] = useState<StoryPlan | null>(null);
  const [showChapterCountDialog, setShowChapterCountDialog] = useState(false);
  const [importedScript, setImportedScript] = useState<ImportedScriptDocument | null>(null);
  const [isParsingImport, setIsParsingImport] = useState(false);
  const [importError, setImportError] = useState('');
  const importInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    setMode('select');
    setForm({ ...INITIAL_FORM });
    setShowImportDialog(false);
    setPlannedStory(null);
    setShowChapterCountDialog(false);
    setImportedScript(null);
    setImportError('');
    setIsPlanning(false);
    setIsParsingImport(false);
  }, [isOpen]);

  const updateForm = useCallback(<T extends keyof StoryPlannerInput>(
    key: T,
    value: StoryPlannerInput[T]
  ) => {
    setForm((current) => ({ ...current, [key]: value }));
  }, []);

  const handleChapterCountChange = useCallback((value: string) => {
    const nextCount = Math.floor(Number(value));
    updateForm('chapterCount', Number.isFinite(nextCount) && nextCount > 0 ? nextCount : 1);
  }, [updateForm]);

  const canGenerateStory = useMemo(() => {
    return form.premise.trim().length > 0;
  }, [form.premise]);

  const importFormatLabels = useMemo<Record<ScriptImportFormat, string>>(() => ({
    txt: t('script.storyStart.importFormatTxt'),
    markdown: t('script.storyStart.importFormatMarkdown'),
    fountain: t('script.storyStart.importFormatFountain'),
    fdx: t('script.storyStart.importFormatFdx'),
    docx: t('script.storyStart.importFormatDocx'),
  }), [t]);

  const importWarningLabels = useMemo<Record<ScriptImportWarningCode, string>>(() => ({
    preserved_as_single_chapter: t('script.storyStart.importWarningSingleChapter'),
    preserved_as_single_scene: t('script.storyStart.importWarningSingleScene'),
    scene_split_is_heuristic: t('script.storyStart.importWarningSceneHeuristic'),
    docx_formatting_simplified: t('script.storyStart.importWarningDocxFormatting'),
    fdx_without_scene_headings: t('script.storyStart.importWarningFdxNoSceneHeading'),
  }), [t]);

  const handlePickImportFile = useCallback(() => {
    importInputRef.current?.click();
  }, []);

  const handleImportFileChange = useCallback(async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const selectedFile = event.target.files?.[0];
    if (!selectedFile) {
      return;
    }

    setImportError('');
    setImportedScript(null);
    setIsParsingImport(true);

    try {
      const parsedImport = await importScriptFile(selectedFile);
      setImportedScript(parsedImport);
    } catch (error) {
      setImportError(
        error instanceof Error
          ? error.message
          : t('script.storyStart.importParseError')
      );
    } finally {
      setIsParsingImport(false);
      event.target.value = '';
    }
  }, [t]);

  const handleGenerateStory = useCallback(async () => {
    if (!canGenerateStory) {
      return;
    }

    if (!hasScriptProvider) {
      openSettingsDialog({ category: 'providers' });
      return;
    }

    setIsPlanning(true);
    try {
      const nextPlan = await planStory(form);
      setPlannedStory(nextPlan);
    } finally {
      setIsPlanning(false);
    }
  }, [canGenerateStory, form, hasScriptProvider]);

  const createGraphFromPlan = useCallback((plan: StoryPlan) => {
    const CHAPTER_NODE_HEIGHT = 380;
    const ROOT_NODE_WIDTH = 320;
    const ROOT_NODE_HEIGHT = 120;
    const GAP = 60;
    const HORIZONTAL_GAP = 150;

    const chapterCount = plan.chapters.length;
    const totalChaptersHeight = chapterCount * CHAPTER_NODE_HEIGHT + (chapterCount - 1) * GAP;
    const chapterStartY = 100;
    const rootY = chapterStartY + totalChaptersHeight / 2 - ROOT_NODE_HEIGHT / 2;
    const rootX = 100;
    const chapterX = rootX + ROOT_NODE_WIDTH + HORIZONTAL_GAP;

    const rootId = addNode(CANVAS_NODE_TYPES.scriptRoot, { x: rootX, y: rootY }, {
      displayName: plan.title,
      title: plan.title,
      genre: plan.genre,
      totalChapters: chapterCount,
      premise: plan.premise,
      theme: plan.theme,
      protagonist: plan.protagonist,
      want: plan.want,
      need: plan.need,
      stakes: plan.stakes,
      tone: plan.tone,
      directorVision: plan.directorVision,
      beats: plan.beats.map((beat, index) => ({
        ...beat,
        id: `beat-${index + 1}`,
      })),
    });

    let firstChapterId: string | null = null;

    plan.chapters.forEach((chapter, index) => {
      const scenes = mapScenesForChapter(plan, index);
      const chapterId = addNode(
        CANVAS_NODE_TYPES.scriptChapter,
        { x: chapterX, y: chapterStartY + index * (CHAPTER_NODE_HEIGHT + GAP) },
        {
          displayName: `${t('script.storyStart.chapterLabel', { number: chapter.number })} ${chapter.title}`.trim(),
          chapterNumber: chapter.number,
          title: chapter.title,
          summary: chapter.summary,
          chapterPurpose: chapter.chapterPurpose,
          chapterQuestion: chapter.chapterQuestion,
          content: '',
          sceneHeadings: scenes.map((scene) => scene.title).filter((value) => value.trim().length > 0),
          scenes,
          characters: [],
          locations: [],
          items: [],
          emotionalShift: '',
          isBranchPoint: false,
          branchType: 'main',
          depth: 1,
          tables: [],
          plotPoints: [],
        }
      );

      if (!firstChapterId) {
        firstChapterId = chapterId;
      }

      if (rootId && chapterId) {
        addEdge(rootId, chapterId);
      }
    });

    if (plan.worldview && plan.worldview.description.trim()) {
      addNode(CANVAS_NODE_TYPES.scriptWorldview, { x: 900, y: 100 }, {
        displayName: plan.worldview.name || t('script.storyStart.worldview'),
        worldviewName: plan.worldview.name || '',
        description: plan.worldview.description,
        era: plan.worldview.era,
        technology: plan.worldview.technology,
        magic: plan.worldview.magic,
        society: plan.worldview.society,
        geography: plan.worldview.geography,
        rules: [],
      });
    }

    if (firstChapterId) {
      setSelectedNode(firstChapterId);
    }

    onClose();
  }, [addEdge, addNode, onClose, setSelectedNode, t]);

  const createGraphFromImportedScript = useCallback((document: ImportedScriptDocument) => {
    const CHAPTER_NODE_HEIGHT = 380;
    const ROOT_NODE_WIDTH = 320;
    const ROOT_NODE_HEIGHT = 120;
    const GAP = 60;
    const HORIZONTAL_GAP = 150;

    const chapterCount = document.chapters.length;
    const totalChaptersHeight = chapterCount * CHAPTER_NODE_HEIGHT + (chapterCount - 1) * GAP;
    const chapterStartY = 100;
    const rootY = chapterStartY + totalChaptersHeight / 2 - ROOT_NODE_HEIGHT / 2;
    const rootX = 100;
    const chapterX = rootX + ROOT_NODE_WIDTH + HORIZONTAL_GAP;

    const rootId = addNode(CANVAS_NODE_TYPES.scriptRoot, { x: rootX, y: rootY }, {
      displayName: document.title,
      title: document.title,
      genre: '',
      totalChapters: chapterCount,
      premise: '',
      theme: '',
      protagonist: '',
      want: '',
      need: '',
      stakes: '',
      tone: '',
      directorVision: '',
      beats: [],
    });

    let firstChapterId: string | null = null;

    document.chapters.forEach((chapter, index) => {
      const scenes = mapImportedScenes(document, index);
      const chapterId = addNode(
        CANVAS_NODE_TYPES.scriptChapter,
        { x: chapterX, y: chapterStartY + index * (CHAPTER_NODE_HEIGHT + GAP) },
        {
          displayName: `${t('script.storyStart.chapterLabel', { number: index + 1 })} ${chapter.title}`.trim(),
          chapterNumber: index + 1,
          title: chapter.title,
          summary: chapter.summary,
          chapterPurpose: '',
          chapterQuestion: '',
          content: chapter.contentHtml,
          sceneHeadings: scenes.map((scene) => scene.title).filter((value) => value.trim().length > 0),
          scenes,
          characters: [],
          locations: [],
          items: [],
          emotionalShift: '',
          isBranchPoint: false,
          branchType: 'main',
          depth: 1,
          tables: [],
          plotPoints: [],
        }
      );

      if (!firstChapterId) {
        firstChapterId = chapterId;
      }

      if (rootId && chapterId) {
        addEdge(rootId, chapterId);
      }
    });

    if (firstChapterId) {
      setSelectedNode(firstChapterId);
    }

    onClose();
  }, [addEdge, addNode, onClose, setSelectedNode, t]);

  const handleCreateBlankScript = useCallback((count: number) => {
    const blankPlan: StoryPlan = {
      title: t('script.storyStart.blankTitle'),
      genre: '',
      premise: '',
      theme: '',
      protagonist: '',
      want: '',
      need: '',
      stakes: '',
      tone: '',
      directorVision: '',
      beats: [],
      chapters: Array.from({ length: count }, (_, index) => ({
        number: index + 1,
        title: t('script.storyStart.blankChapterTitle', { number: index + 1 }),
        summary: '',
        chapterPurpose: '',
        chapterQuestion: '',
        scenes: [],
      })),
    };

    createGraphFromPlan(blankPlan);
  }, [createGraphFromPlan, t]);

  if (!isOpen) {
    return null;
  }

  if (showImportDialog) {
    return (
      <ScriptImportDialog
        isOpen
        onClose={() => setShowImportDialog(false)}
        onImported={onClose}
      />
    );
  }

  return (
    <div className="fixed inset-0 z-[10100] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/80" />

      <div className="relative flex max-h-[92vh] w-[1180px] max-w-[calc(100vw-1.5rem)] flex-col overflow-hidden rounded-2xl border border-border-dark bg-surface-dark shadow-2xl">
        <div className="flex items-center justify-between border-b border-border-dark px-5 py-4">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-amber-400" />
            <div>
              <h2 className="text-lg font-semibold text-text-dark">
                {mode === 'select'
                  ? t('script.storyStart.title')
                  : mode === 'import'
                    ? t('script.storyStart.importTitle')
                    : t('script.storyStart.createTitle')}
              </h2>
              <p className="text-sm text-text-muted">
                {mode === 'create'
                  ? t('script.storyStart.createSubtitle')
                  : t('script.storyStart.subtitle')}
              </p>
            </div>
          </div>
        </div>

        {mode === 'select' ? (
          <div className="grid gap-4 p-6 md:grid-cols-2">
            <button
              type="button"
              onClick={() => setMode('create')}
              className="rounded-2xl border border-amber-500/20 bg-gradient-to-br from-amber-500/10 to-transparent p-5 text-left transition-colors hover:border-amber-500/40 hover:bg-amber-500/10"
            >
              <div className="flex items-start gap-3">
                <div className="rounded-xl bg-amber-500/15 p-2.5">
                  <Wand2 className="h-6 w-6 text-amber-300" />
                </div>
                <div className="min-w-0">
                  <div className="text-base font-semibold text-text-dark">
                    {t('script.storyStart.createCardTitle')}
                  </div>
                  <p className="mt-2 text-sm leading-6 text-text-muted">
                    {t('script.storyStart.createCardDesc')}
                  </p>
                </div>
              </div>
            </button>

            <button
              type="button"
              onClick={() => setShowImportDialog(true)}
              className="rounded-2xl border border-border-dark bg-bg-dark/35 p-5 text-left transition-colors hover:border-border-dark/80 hover:bg-bg-dark/55"
            >
              <div className="flex items-start gap-3">
                <div className="rounded-xl bg-accent/10 p-2.5">
                  <Upload className="h-6 w-6 text-accent" />
                </div>
                <div className="min-w-0">
                  <div className="text-base font-semibold text-text-dark">
                    {t('script.storyStart.importCardTitle')}
                  </div>
                  <p className="mt-2 text-sm leading-6 text-text-muted">
                    {t('script.storyStart.importCardDesc')}
                  </p>
                </div>
              </div>
            </button>

            <button
              type="button"
              onClick={closeProject}
              className="md:col-span-2 inline-flex items-center justify-center gap-2 rounded-xl border border-border-dark bg-bg-dark/25 px-4 py-3 text-sm text-text-muted transition-colors hover:bg-bg-dark hover:text-text-dark"
            >
              <ArrowLeft className="h-4 w-4" />
              {t('script.storyStart.backToProjects')}
            </button>
          </div>
        ) : null}

        {mode === 'import' ? (
          <div className="p-6">
            <ChapterCountDialog
              isOpen={showChapterCountDialog}
              onClose={() => setShowChapterCountDialog(false)}
              onConfirm={handleCreateBlankScript}
            />

            <input
              ref={importInputRef}
              type="file"
              accept=".txt,.md,.markdown,.fountain,.spmd,.fdx,.docx"
              className="hidden"
              onChange={handleImportFileChange}
            />

            <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
              <div className="space-y-4">
                <div className="rounded-2xl border border-border-dark bg-bg-dark/30 p-5">
                  <div className="flex items-start gap-3">
                    <div className="rounded-xl bg-accent/10 p-2.5">
                      <Upload className="h-6 w-6 text-accent" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-base font-semibold text-text-dark">
                        {t('script.storyStart.importFileTitle')}
                      </div>
                      <p className="mt-2 text-sm leading-6 text-text-muted">
                        {t('script.storyStart.importFileDesc')}
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 rounded-xl border border-border-dark/80 bg-surface-dark/45 px-3 py-2 text-xs leading-6 text-text-muted">
                    {t('script.storyStart.importSupportedFormats')}
                  </div>

                  {importError ? (
                    <div className="mt-4 rounded-xl border border-red-500/20 bg-red-500/8 px-3 py-2 text-sm leading-6 text-red-200">
                      {importError}
                    </div>
                  ) : null}

                  <div className="mt-4 flex flex-col gap-3">
                    <UiButton
                      variant="primary"
                      onClick={handlePickImportFile}
                      disabled={isParsingImport}
                    >
                      {isParsingImport ? t('script.storyStart.importParsing') : importedScript ? (
                        t('script.storyStart.importChooseAnother')
                      ) : (
                        t('script.storyStart.importChooseFile')
                      )}
                    </UiButton>

                    <UiButton
                      variant="ghost"
                      onClick={() => importedScript && createGraphFromImportedScript(importedScript)}
                      disabled={!importedScript || isParsingImport}
                    >
                      {t('script.storyStart.importCreateWorkspace')}
                    </UiButton>
                  </div>
                </div>

                <div className="rounded-2xl border border-border-dark bg-bg-dark/20 p-5">
                  <div className="text-sm font-semibold text-text-dark">
                    {t('script.storyStart.importBlankFallbackTitle')}
                  </div>
                  <p className="mt-2 text-sm leading-6 text-text-muted">
                    {t('script.storyStart.importDesc')}
                  </p>
                  <div className="mt-4 flex flex-col gap-3">
                    <UiButton variant="ghost" onClick={() => setShowChapterCountDialog(true)}>
                      {t('script.storyStart.startBlank')}
                    </UiButton>
                    <UiButton variant="ghost" onClick={() => setMode('select')}>
                      {t('common.back')}
                    </UiButton>
                  </div>
                </div>
              </div>

              <div className="min-w-0 rounded-2xl border border-border-dark bg-bg-dark/25 p-5">
                {importedScript ? (
                  <ScriptImportPreview
                    document={importedScript}
                    title={t('script.storyStart.importPreviewTitle')}
                    formatLabel={t('script.storyStart.importPreviewFormat')}
                    chapterCountLabel={t('script.storyStart.importPreviewChapters')}
                    sceneCountLabel={t('script.storyStart.importPreviewScenes')}
                    wordCountLabel={t('script.storyStart.importPreviewWords')}
                    warningsTitle={t('script.storyStart.importPreviewWarnings')}
                    warningLabels={importWarningLabels}
                    formatLabels={importFormatLabels}
                    chapterLabel={(index, title) =>
                      t('script.storyStart.importPreviewChapterLabel', {
                        number: index + 1,
                        title,
                      })
                    }
                    sceneLabel={(index, title) =>
                      t('script.storyStart.importPreviewSceneLabel', {
                        number: index + 1,
                        title,
                      })
                    }
                    sceneCountBadge={(count) =>
                      t('script.storyStart.importPreviewSceneCount', { count })
                    }
                    moreScenesLabel={(count) =>
                      t('script.storyStart.importPreviewMoreScenes', { count })
                    }
                  />
                ) : (
                  <div className="flex h-full min-h-[420px] items-center justify-center">
                    <div className="max-w-[360px] text-center">
                      <FileText className="mx-auto h-14 w-14 text-accent/65" />
                      <h3 className="mt-4 text-lg font-semibold text-text-dark">
                        {t('script.storyStart.importPreviewEmptyTitle')}
                      </h3>
                      <p className="mt-3 text-sm leading-6 text-text-muted">
                        {t('script.storyStart.importPreviewEmptyDesc')}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : null}

        {mode === 'create' ? (
          <div className="grid min-h-0 flex-1 gap-0 lg:grid-cols-[360px_minmax(0,1fr)]">
            <div className="overflow-y-auto border-r border-border-dark p-5">
              {!hasScriptProvider ? (
                <div className="mb-4 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-300">
                  {t('script.storyStart.providerMissing')}
                </div>
              ) : null}

              <div className="space-y-4">
                <label className="block">
                  <span className="mb-1.5 block text-sm font-medium text-text-dark">
                    {t('script.storyStart.premise')}
                  </span>
                  <textarea
                    value={form.premise}
                    onChange={(event) => updateForm('premise', event.target.value)}
                    rows={5}
                    placeholder={t('script.storyStart.premisePlaceholder')}
                    className="w-full resize-none rounded-xl border border-border-dark bg-bg-dark px-3 py-2 text-sm text-text-dark outline-none transition-colors placeholder:text-text-muted/60 focus:border-amber-500/45"
                  />
                </label>

                <div className="grid grid-cols-2 gap-3">
                  <label className="block">
                    <span className="mb-1.5 block text-sm font-medium text-text-dark">
                      {t('script.storyStart.protagonist')}
                    </span>
                    <input
                      type="text"
                      value={form.protagonist}
                      onChange={(event) => updateForm('protagonist', event.target.value)}
                      placeholder={t('script.storyStart.protagonistPlaceholder')}
                      className="w-full rounded-xl border border-border-dark bg-bg-dark px-3 py-2 text-sm text-text-dark outline-none transition-colors placeholder:text-text-muted/60 focus:border-amber-500/45"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1.5 block text-sm font-medium text-text-dark">
                      {t('script.storyStart.want')}
                    </span>
                    <input
                      type="text"
                      value={form.want}
                      onChange={(event) => updateForm('want', event.target.value)}
                      placeholder={t('script.storyStart.wantPlaceholder')}
                      className="w-full rounded-xl border border-border-dark bg-bg-dark px-3 py-2 text-sm text-text-dark outline-none transition-colors placeholder:text-text-muted/60 focus:border-amber-500/45"
                    />
                  </label>
                </div>

                <label className="block">
                  <span className="mb-1.5 block text-sm font-medium text-text-dark">
                    {t('script.storyStart.stakes')}
                  </span>
                  <textarea
                    value={form.stakes}
                    onChange={(event) => updateForm('stakes', event.target.value)}
                    rows={3}
                    placeholder={t('script.storyStart.stakesPlaceholder')}
                    className="w-full resize-none rounded-xl border border-border-dark bg-bg-dark px-3 py-2 text-sm text-text-dark outline-none transition-colors placeholder:text-text-muted/60 focus:border-amber-500/45"
                  />
                </label>

                <div className="grid grid-cols-2 gap-3">
                  <label className="block">
                    <span className="mb-1.5 block text-sm font-medium text-text-dark">
                      {t('script.storyStart.genre')}
                    </span>
                    <input
                      type="text"
                      value={form.genre}
                      onChange={(event) => updateForm('genre', event.target.value)}
                      placeholder={t('script.storyStart.genrePlaceholder')}
                      className="w-full rounded-xl border border-border-dark bg-bg-dark px-3 py-2 text-sm text-text-dark outline-none transition-colors placeholder:text-text-muted/60 focus:border-amber-500/45"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1.5 block text-sm font-medium text-text-dark">
                      {t('script.storyStart.theme')}
                    </span>
                    <input
                      type="text"
                      value={form.theme}
                      onChange={(event) => updateForm('theme', event.target.value)}
                      placeholder={t('script.storyStart.themePlaceholder')}
                      className="w-full rounded-xl border border-border-dark bg-bg-dark px-3 py-2 text-sm text-text-dark outline-none transition-colors placeholder:text-text-muted/60 focus:border-amber-500/45"
                    />
                  </label>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <label className="block">
                    <span className="mb-1.5 block text-sm font-medium text-text-dark">
                      {t('script.storyStart.tone')}
                    </span>
                    <input
                      type="text"
                      value={form.tone}
                      onChange={(event) => updateForm('tone', event.target.value)}
                      placeholder={t('script.storyStart.tonePlaceholder')}
                      className="w-full rounded-xl border border-border-dark bg-bg-dark px-3 py-2 text-sm text-text-dark outline-none transition-colors placeholder:text-text-muted/60 focus:border-amber-500/45"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1.5 block text-sm font-medium text-text-dark">
                      {t('script.storyStart.chapterCount')}
                    </span>
                    <div className="rounded-xl border border-border-dark bg-bg-dark px-3 py-2">
                      <input
                        type="number"
                        min={1}
                        step={1}
                        value={form.chapterCount}
                        onChange={(event) => handleChapterCountChange(event.target.value)}
                        className="w-full bg-transparent text-sm font-medium text-amber-300 outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                      />
                    </div>
                  </label>
                </div>

                <label className="block">
                  <span className="mb-1.5 block text-sm font-medium text-text-dark">
                    {t('script.storyStart.directorVision')}
                  </span>
                  <textarea
                    value={form.directorVision}
                    onChange={(event) => updateForm('directorVision', event.target.value)}
                    rows={3}
                    placeholder={t('script.storyStart.directorVisionPlaceholder')}
                    className="w-full resize-none rounded-xl border border-border-dark bg-bg-dark px-3 py-2 text-sm text-text-dark outline-none transition-colors placeholder:text-text-muted/60 focus:border-amber-500/45"
                  />
                </label>

                <label className="block">
                  <span className="mb-1.5 block text-sm font-medium text-text-dark">
                    {t('script.storyStart.worldview')}
                  </span>
                  <textarea
                    value={form.worldviewDescription}
                    onChange={(event) => updateForm('worldviewDescription', event.target.value)}
                    rows={3}
                    placeholder={t('script.storyStart.worldviewPlaceholder')}
                    className="w-full resize-none rounded-xl border border-border-dark bg-bg-dark px-3 py-2 text-sm text-text-dark outline-none transition-colors placeholder:text-text-muted/60 focus:border-amber-500/45"
                  />
                </label>
              </div>

              <div className="mt-5 flex gap-3">
                <UiButton variant="ghost" onClick={() => setMode('select')}>
                  {t('common.cancel')}
                </UiButton>
                <UiButton
                  variant="primary"
                  onClick={handleGenerateStory}
                  disabled={!canGenerateStory || isPlanning}
                  className="flex-1"
                >
                  {isPlanning ? t('script.storyStart.generating') : plannedStory ? (
                    t('script.storyStart.regenerate')
                  ) : (
                    t('script.storyStart.generate')
                  )}
                </UiButton>
              </div>
            </div>

            <div className="flex min-h-0 flex-col overflow-hidden">
              {plannedStory ? (
                <>
                  <div className="border-b border-border-dark px-5 py-4">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <div className="text-xs uppercase tracking-[0.08em] text-text-muted">
                          {t('script.storyStart.preview')}
                        </div>
                        <h3 className="mt-1 text-xl font-semibold text-text-dark">
                          {plannedStory.title}
                        </h3>
                        <p className="mt-2 text-sm leading-6 text-text-muted">
                          {plannedStory.premise}
                        </p>
                      </div>
                      <UiButton
                        variant="primary"
                        onClick={() => createGraphFromPlan(plannedStory)}
                      >
                        {t('script.storyStart.createWorkspace')}
                      </UiButton>
                    </div>
                  </div>

                  <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
                    <div className="mx-auto flex max-w-5xl flex-col gap-4">
                      <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
                        <div className="rounded-2xl border border-border-dark bg-bg-dark/28 p-4">
                          <div className="text-xs uppercase tracking-[0.08em] text-text-muted">
                            {t('script.storyStart.storyProfile')}
                          </div>
                          <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                            <div className="rounded-xl border border-border-dark bg-surface-dark/70 px-3 py-2">
                              <div className="text-[11px] text-text-muted">{t('script.storyStart.genre')}</div>
                              <div className="mt-1 text-sm font-medium text-text-dark">{plannedStory.genre || '-'}</div>
                            </div>
                            <div className="rounded-xl border border-border-dark bg-surface-dark/70 px-3 py-2">
                              <div className="text-[11px] text-text-muted">{t('script.storyStart.theme')}</div>
                              <div className="mt-1 text-sm font-medium text-text-dark">{plannedStory.theme || '-'}</div>
                            </div>
                            <div className="rounded-xl border border-border-dark bg-surface-dark/70 px-3 py-2">
                              <div className="text-[11px] text-text-muted">{t('script.storyStart.protagonist')}</div>
                              <div className="mt-1 text-sm font-medium text-text-dark">{plannedStory.protagonist || '-'}</div>
                            </div>
                            <div className="rounded-xl border border-border-dark bg-surface-dark/70 px-3 py-2">
                              <div className="text-[11px] text-text-muted">{t('script.storyStart.want')}</div>
                              <div className="mt-1 text-sm font-medium text-text-dark">{plannedStory.want || '-'}</div>
                            </div>
                            <div className="rounded-xl border border-border-dark bg-surface-dark/70 px-3 py-2 sm:col-span-2 xl:col-span-1">
                              <div className="text-[11px] text-text-muted">{t('script.storyStart.stakes')}</div>
                              <div className="mt-1 text-sm leading-6 text-text-dark">{plannedStory.stakes || '-'}</div>
                            </div>
                          </div>
                        </div>

                        <div className="rounded-2xl border border-border-dark bg-bg-dark/28 p-4">
                          <div className="text-xs uppercase tracking-[0.08em] text-text-muted">
                            {t('script.storyStart.beats')}
                          </div>
                          <div className="mt-3 grid gap-2 lg:grid-cols-2">
                            {plannedStory.beats.map((beat) => (
                              <div key={beat.key} className="rounded-xl border border-border-dark bg-surface-dark/70 px-3 py-3">
                                <div className="text-sm font-medium text-text-dark">{beat.title}</div>
                                <div className="mt-1 text-xs leading-6 text-text-muted">
                                  {beat.summary || beat.dramaticQuestion}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>

                      <div className="space-y-4">
                        {plannedStory.chapters.map((chapter) => (
                          <div key={chapter.number} className="rounded-2xl border border-border-dark bg-bg-dark/35 p-4">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div className="min-w-0 flex-1">
                                <div className="text-base font-semibold text-text-dark">
                                  {t('script.storyStart.chapterLabel', { number: chapter.number })} {chapter.title}
                                </div>
                                <p className="mt-2 break-words text-sm leading-7 text-text-muted">
                                  {chapter.summary}
                                </p>
                              </div>
                              <span className="shrink-0 rounded-full border border-amber-500/25 bg-amber-500/10 px-2 py-1 text-[11px] text-amber-300">
                                {t('script.storyStart.sceneCount', { count: chapter.scenes.length })}
                              </span>
                            </div>
                            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                              {chapter.scenes.map((scene, sceneIndex) => (
                                <div key={`${chapter.number}-${sceneIndex}`} className="rounded-xl border border-border-dark bg-surface-dark/80 px-3 py-3">
                                  <div className="text-sm font-medium text-text-dark">{scene.title}</div>
                                  <div className="mt-2 text-xs leading-6 text-text-muted">
                                    {scene.summary || scene.purpose}
                                  </div>
                                  <div className="mt-3 text-[11px] leading-5 text-amber-300">
                                    {scene.visualHook || scene.goal}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </>
              ) : (
                <div className="flex flex-1 items-center justify-center p-10">
                  <div className="max-w-[420px] rounded-2xl border border-dashed border-border-dark bg-bg-dark/35 p-6 text-center">
                    <Sparkles className="mx-auto h-10 w-10 text-amber-400" />
                    <h3 className="mt-3 text-lg font-semibold text-text-dark">
                      {t('script.storyStart.previewEmptyTitle')}
                    </h3>
                    <p className="mt-2 text-sm leading-6 text-text-muted">
                      {t('script.storyStart.previewEmptyDesc')}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : null}

        <UiLoadingOverlay visible={isPlanning || isParsingImport} insetClassName="inset-0" />
      </div>
    </div>
  );
}
