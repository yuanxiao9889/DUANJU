import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { FileText, Package, Settings, Upload } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import {
  UiButton,
  UiLoadingOverlay,
  UiModal,
} from '@/components/ui';
import { openSettingsDialog } from '@/features/settings/settingsEvents';
import {
  resolveActivatedScriptProvider,
  resolveConfiguredScriptModel,
} from '@/features/canvas/models';
import { useSettingsStore } from '@/stores/settingsStore';
import { useCanvasStore } from '@/stores/canvasStore';
import {
  MissingScriptImportModelError,
  prepareScriptImportPreview,
} from '@/features/canvas/application/scriptImportWorkflow';
import {
  materializeScriptProjectPackageImport,
  prepareScriptProjectPackagePreview,
} from '@/features/canvas/application/scriptProjectPackage';
import type {
  ScriptImportPreviewModel,
  ScriptImportPreviewNotice,
} from '@/features/canvas/application/scriptImportExportTypes';
import { useProjectStore } from '@/stores/projectStore';

interface ScriptImportDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onImported?: () => void;
}

function resolveNoticeClassName(kind: ScriptImportPreviewNotice['kind']): string {
  if (kind === 'error') {
    return 'border-red-500/25 bg-red-500/10 text-red-100';
  }

  if (kind === 'warning') {
    return 'border-amber-500/25 bg-amber-500/10 text-amber-100';
  }

  return 'border-border-dark bg-bg-dark/45 text-text-muted';
}

export function ScriptImportDialog({
  isOpen,
  onClose,
  onImported,
}: ScriptImportDialogProps) {
  const { t } = useTranslation();
  const setCanvasData = useCanvasStore((state) => state.setCanvasData);
  const setSelectedNode = useCanvasStore((state) => state.setSelectedNode);
  const setViewportState = useCanvasStore((state) => state.setViewportState);
  const setCurrentProjectColorLabels = useProjectStore((state) => state.setCurrentProjectColorLabels);
  const settings = useSettingsStore();
  const activeScriptProvider = resolveActivatedScriptProvider(settings);
  const activeScriptModel = activeScriptProvider
    ? resolveConfiguredScriptModel(activeScriptProvider, settings).trim()
    : '';
  const hasScriptProvider =
    Boolean(activeScriptProvider)
    && Boolean(activeScriptModel)
    && Boolean(activeScriptProvider ? settings.scriptApiKeys[activeScriptProvider]?.trim() : '');

  const [preview, setPreview] = useState<ScriptImportPreviewModel | null>(null);
  const [isPreparing, setIsPreparing] = useState(false);
  const [preparingKind, setPreparingKind] = useState<'document' | 'package' | null>(null);
  const [isApplying, setIsApplying] = useState(false);
  const [error, setError] = useState('');
  const [needsModelSetup, setNeedsModelSetup] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setPreview(null);
      setIsPreparing(false);
      setPreparingKind(null);
      setIsApplying(false);
      setError('');
      setNeedsModelSetup(false);
    }
  }, [isOpen]);

  const formatLabelMap = useMemo<Record<string, string>>(() => ({
    txt: t('script.storyStart.importFormatTxt'),
    markdown: t('script.storyStart.importFormatMarkdown'),
    fountain: t('script.storyStart.importFormatFountain'),
    fdx: t('script.storyStart.importFormatFdx'),
    docx: t('script.storyStart.importFormatDocx'),
    nativePackage: t('scriptImportDialog.nativePackageLabel'),
  }), [t]);

  const resolveNoticeMessage = useCallback((notice: ScriptImportPreviewNotice) => {
    switch (notice.code) {
      case 'replace_current_content':
        return t('scriptImportDialog.replaceNotice');
      case 'llm_analysis_failed':
        return t('scriptImportDialog.llmFallbackNotice');
      case 'preserved_as_single_chapter':
        return t('script.storyStart.importWarningSingleChapter');
      case 'preserved_as_single_scene':
        return t('script.storyStart.importWarningSingleScene');
      case 'scene_split_is_heuristic':
        return t('script.storyStart.importWarningSceneHeuristic');
      case 'docx_formatting_simplified':
        return t('script.storyStart.importWarningDocxFormatting');
      case 'fdx_without_scene_headings':
        return t('script.storyStart.importWarningFdxNoSceneHeading');
      default:
        return notice.message;
    }
  }, [t]);

  const handlePickFile = useCallback(() => {
    inputRef.current?.click();
  }, []);

  const handlePickPackage = useCallback(async () => {
    setError('');
    setNeedsModelSetup(false);

    const selectedPath = await open({
      multiple: false,
      filters: [{ name: 'Script Project Package', extensions: ['scpkg'] }],
    });

    if (typeof selectedPath !== 'string') {
      return;
    }

    setIsPreparing(true);
    setPreparingKind('package');
    setPreview(null);

    try {
      const nextPreview = await prepareScriptProjectPackagePreview(selectedPath);
      setPreview(nextPreview);
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : t('scriptImportDialog.packageParseError')
      );
    } finally {
      setIsPreparing(false);
      setPreparingKind(null);
    }
  }, [t]);

  const handleFileChange = useCallback(async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const selectedFile = event.target.files?.[0];
    if (!selectedFile) {
      return;
    }

    setIsPreparing(true);
    setPreparingKind('document');
    setPreview(null);
    setError('');
    setNeedsModelSetup(false);

    try {
      const nextPreview = await prepareScriptImportPreview(selectedFile, {
        llm: hasScriptProvider && activeScriptProvider
          ? {
              provider: activeScriptProvider,
              model: activeScriptModel,
            }
          : null,
      });
      setPreview(nextPreview);
    } catch (nextError) {
      if (nextError instanceof MissingScriptImportModelError) {
        setNeedsModelSetup(true);
        setError(t('scriptImportDialog.modelRequired'));
      } else {
        setError(
          nextError instanceof Error
            ? nextError.message
            : t('script.storyStart.importParseError')
        );
      }
    } finally {
      setIsPreparing(false);
      setPreparingKind(null);
      event.target.value = '';
    }
  }, [
    activeScriptModel,
    activeScriptProvider,
    hasScriptProvider,
    t,
  ]);

  const handleOpenSettings = useCallback(() => {
    openSettingsDialog({ category: 'providers' });
  }, []);

  const handleApplyImport = useCallback(async () => {
    if (!preview) {
      return;
    }

    setIsApplying(true);
    setError('');

    try {
      if (preview.kind === 'nativePackage' && preview.nativePackage?.packagePath) {
        const importedProject = await materializeScriptProjectPackageImport(
          preview.nativePackage.packagePath
        );
        setCanvasData(importedProject.nodes, importedProject.edges, importedProject.history);
        if (importedProject.viewport) {
          setViewportState(importedProject.viewport);
        }
        if (importedProject.colorLabels) {
          setCurrentProjectColorLabels(importedProject.colorLabels);
        }
        if (importedProject.selectedNodeId) {
          setSelectedNode(importedProject.selectedNodeId);
        }
      } else {
        setCanvasData(
          preview.applyPayload.nodes,
          preview.applyPayload.edges,
          preview.applyPayload.history
        );
        if (preview.applyPayload.viewport) {
          setViewportState(preview.applyPayload.viewport);
        }
        if (preview.applyPayload.colorLabels) {
          setCurrentProjectColorLabels(preview.applyPayload.colorLabels);
        }
        if (preview.applyPayload.selectedNodeId) {
          setSelectedNode(preview.applyPayload.selectedNodeId);
        }
      }

      onImported?.();
      onClose();
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : t('scriptImportDialog.applyFailed')
      );
    } finally {
      setIsApplying(false);
    }
  }, [
    onClose,
    onImported,
    preview,
    setCanvasData,
    setCurrentProjectColorLabels,
    setSelectedNode,
    setViewportState,
    t,
  ]);

  const detectedModeTitle = preview
    ? preview.kind === 'nativePackage'
      ? t('scriptImportDialog.nativeModeTitle')
      : t('scriptImportDialog.externalModeTitle')
    : t('scriptImportDialog.detectionPendingLabel');

  const detectedModeDescription = preview
    ? preview.kind === 'nativePackage'
      ? t('scriptImportDialog.nativeModeDescription')
      : t('scriptImportDialog.externalModeDescription')
    : t('scriptImportDialog.detectionDescription');

  return (
    <UiModal
      isOpen={isOpen}
      onClose={onClose}
      title={t('scriptImportDialog.title')}
      widthClassName="w-[calc(100vw-32px)] max-w-[1120px]"
      draggable={false}
    >
      <div className="relative">
        <input
          ref={inputRef}
          type="file"
          accept=".txt,.md,.markdown,.fountain,.spmd,.fdx,.docx"
          className="hidden"
          onChange={handleFileChange}
        />

        <div className="ui-scrollbar grid h-[calc(100vh-160px)] min-h-[320px] max-h-[780px] gap-5 overflow-y-auto lg:grid-cols-[320px_minmax(0,1fr)] lg:overflow-hidden">
          <div className="space-y-4 lg:min-h-0 lg:overflow-y-auto lg:pr-1">
            <div className="rounded-2xl border border-border-dark bg-bg-dark/30 p-5">
              <div className="flex items-start gap-3">
                <div className="rounded-xl bg-accent/10 p-2.5">
                  <Upload className="h-6 w-6 text-accent" />
                </div>
                <div className="min-w-0">
                  <div className="text-base font-semibold text-text-dark">
                    {t('scriptImportDialog.pickTitle')}
                  </div>
                  <p className="mt-2 text-sm leading-6 text-text-muted">
                    {t('scriptImportDialog.pickDescription')}
                  </p>
                </div>
              </div>

              <div className="mt-4 rounded-xl border border-border-dark/80 bg-surface-dark/45 px-3 py-2 text-xs leading-6 text-text-muted">
                {t('script.storyStart.importSupportedFormats')}
              </div>

              <div className="mt-3 rounded-xl border border-border-dark/80 bg-surface-dark/45 px-3 py-2 text-xs leading-6 text-text-muted">
                {t('scriptImportDialog.packageSupportedFormats')}
              </div>

              <div className="mt-4 flex flex-col gap-3">
                <UiButton
                  variant={preview?.kind === 'external' ? 'primary' : 'muted'}
                  onClick={handlePickFile}
                  disabled={isPreparing || isApplying}
                >
                  {isPreparing && preparingKind === 'document'
                    ? t('script.storyStart.importParsing')
                    : preview?.kind === 'external'
                      ? t('script.storyStart.importChooseAnother')
                      : t('script.storyStart.importChooseFile')}
                </UiButton>

                <UiButton
                  variant={preview?.kind === 'nativePackage' ? 'primary' : 'muted'}
                  onClick={handlePickPackage}
                  disabled={isPreparing || isApplying}
                >
                  {isPreparing && preparingKind === 'package'
                    ? t('scriptImportDialog.packageParsing')
                    : preview?.kind === 'nativePackage'
                      ? t('scriptImportDialog.chooseAnotherPackage')
                      : t('scriptImportDialog.choosePackage')}
                </UiButton>

                <UiButton
                  variant="ghost"
                  onClick={handleApplyImport}
                  disabled={!preview || isPreparing || isApplying}
                >
                  {isApplying ? t('scriptImportDialog.applying') : t('scriptImportDialog.apply')}
                </UiButton>
              </div>
            </div>

            <div className="rounded-2xl border border-border-dark bg-bg-dark/20 p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-text-dark">
                    {t('scriptImportDialog.detectionTitle')}
                  </div>
                  <p className="mt-2 text-sm leading-6 text-text-muted">
                    {detectedModeDescription}
                  </p>
                </div>
                <span className="shrink-0 rounded-full border border-border-dark bg-surface-dark/40 px-3 py-1 text-xs text-text-muted">
                  {detectedModeTitle}
                </span>
              </div>
            </div>

            {error ? (
              <div className="rounded-2xl border border-red-500/25 bg-red-500/10 p-4 text-sm leading-6 text-red-100">
                <div>{error}</div>
                {needsModelSetup ? (
                  <div className="mt-3">
                    <UiButton variant="ghost" onClick={handleOpenSettings}>
                      <Settings className="mr-2 h-4 w-4" />
                      {t('scriptImportDialog.openSettings')}
                    </UiButton>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="min-w-0 rounded-2xl border border-border-dark bg-bg-dark/25 p-5 lg:min-h-0 lg:overflow-hidden">
            {preview ? (
              <div className="flex h-full min-h-0 flex-col">
                <div className="rounded-2xl border border-border-dark bg-surface-dark/55 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-xs uppercase tracking-[0.08em] text-text-muted">
                        {preview.kind === 'nativePackage' ? (
                          <Package className="h-3.5 w-3.5" />
                        ) : (
                          <FileText className="h-3.5 w-3.5" />
                        )}
                        {t('scriptImportDialog.previewTitle')}
                      </div>
                      <div className="mt-1 text-lg font-semibold text-text-dark">
                        {preview.title}
                      </div>
                      <div className="mt-1 text-sm text-text-muted">
                        {preview.sourceName}
                      </div>
                      <div className="mt-2 text-sm leading-6 text-text-muted">
                        {preview.description}
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2 text-xs">
                      <span className="rounded-full border border-border-dark px-3 py-1 text-text-muted">
                        {t('scriptImportDialog.format')}: {formatLabelMap[preview.format] ?? preview.format}
                      </span>
                      <span className="rounded-full border border-border-dark px-3 py-1 text-text-muted">
                        {t('script.storyStart.importPreviewChapters')}: {preview.stats.chapterCount}
                      </span>
                      <span className="rounded-full border border-border-dark px-3 py-1 text-text-muted">
                        {t('script.storyStart.importPreviewScenes')}: {preview.stats.sceneCount}
                      </span>
                      <span className="rounded-full border border-border-dark px-3 py-1 text-text-muted">
                        {t('script.storyStart.importPreviewWords')}: {preview.stats.wordCount}
                      </span>
                      {preview.kind === 'nativePackage' ? (
                        <>
                          <span className="rounded-full border border-border-dark px-3 py-1 text-text-muted">
                            {t('scriptImportDialog.bundledFilesCount')}: {preview.nativePackage?.assetCount ?? 0}
                          </span>
                          <span className="rounded-full border border-border-dark px-3 py-1 text-text-muted">
                            {t('scriptImportDialog.sceneNodeCount')}: {preview.stats.scriptSceneNodeCount}
                          </span>
                          <span className="rounded-full border border-border-dark px-3 py-1 text-text-muted">
                            {t('scriptImportDialog.shootingScriptCount')}: {preview.stats.shootingScriptNodeCount}
                          </span>
                          <span className="rounded-full border border-border-dark px-3 py-1 text-text-muted">
                            {t('scriptImportDialog.assetNodeCount')}: {preview.stats.assetNodeCount}
                          </span>
                        </>
                      ) : null}
                    </div>
                  </div>
                </div>

                {preview.notices.length > 0 ? (
                  <div className="mt-4 space-y-2">
                    {preview.notices.map((notice) => (
                      <div
                        key={notice.code}
                        className={`rounded-xl border px-3 py-2 text-sm leading-6 ${resolveNoticeClassName(notice.kind)}`}
                      >
                        {resolveNoticeMessage(notice)}
                      </div>
                    ))}
                  </div>
                ) : null}

                <div className="ui-scrollbar mt-4 min-h-0 flex-1 overflow-y-auto pr-1">
                  <div className="space-y-3">
                    {preview.document.chapters.map((chapter, chapterIndex) => (
                      <div
                        key={`${chapter.title}-${chapterIndex}`}
                        className="rounded-2xl border border-border-dark bg-surface-dark/45 p-4"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-sm font-semibold text-text-dark">
                              {t('script.storyStart.importPreviewChapterLabel', {
                                number: chapterIndex + 1,
                                title: chapter.title,
                              })}
                            </div>
                            <div className="mt-1 text-sm leading-6 text-text-muted">
                              {chapter.summary}
                            </div>
                          </div>
                          <span className="rounded-full border border-border-dark px-2.5 py-1 text-[11px] text-text-muted">
                            {t('script.storyStart.importPreviewSceneCount', {
                              count: chapter.scenes.length,
                            })}
                          </span>
                        </div>

                        <div className="mt-3 grid gap-2 md:grid-cols-2">
                          {chapter.scenes.map((scene, sceneIndex) => (
                            <div
                              key={`${scene.title}-${sceneIndex}`}
                              className="rounded-xl border border-border-dark/80 bg-bg-dark/35 px-3 py-3"
                            >
                              <div className="text-xs font-medium text-text-dark">
                                {t('script.storyStart.importPreviewSceneLabel', {
                                  number: sceneIndex + 1,
                                  title: scene.title,
                                })}
                              </div>
                              <div className="mt-1 text-xs leading-5 text-text-muted">
                                {scene.summary}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex h-full min-h-0 items-center justify-center">
                <div className="max-w-[380px] text-center">
                  <FileText className="mx-auto h-14 w-14 text-accent/65" />
                  <h3 className="mt-4 text-lg font-semibold text-text-dark">
                    {t('script.storyStart.importPreviewEmptyTitle')}
                  </h3>
                  <p className="mt-3 text-sm leading-6 text-text-muted">
                    {t('scriptImportDialog.emptyDescription')}
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>

        <UiLoadingOverlay
          visible={isPreparing || isApplying}
          insetClassName="inset-0"
          blockInteractions
        />
      </div>
    </UiModal>
  );
}
