import { useCallback, useEffect, useMemo, useState } from 'react';
import { save } from '@tauri-apps/plugin-dialog';
import { FileSpreadsheet, FileText, FolderOpen, GitBranch } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import {
  UiButton,
  UiCheckbox,
  UiInput,
  UiModal,
} from '@/components/ui';
import { useCanvasStore } from '@/stores/canvasStore';
import {
  buildDefaultExportFileName,
  buildScriptExportPreview,
  buildShootingScriptFilePath,
  detectBranches,
  exportScriptPreview,
  replaceFileExtension,
  type ExportFormat,
} from '@/features/canvas/application/scriptExporter';

interface ScriptExportDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

type ExportScopeMode = 'main' | 'all' | 'custom';
type PreviewTab = 'script' | 'shooting';

function resolveFilterConfig(format: ExportFormat) {
  switch (format) {
    case 'txt':
      return [{ name: 'Text', extensions: ['txt'] }];
    case 'markdown':
      return [{ name: 'Markdown', extensions: ['md'] }];
    case 'docx':
      return [{ name: 'Word', extensions: ['docx'] }];
    default:
      return [];
  }
}

function ReadOnlyRichTextContent({
  html,
}: {
  html: string;
}) {
  return (
    <div
      className="ProseMirror min-h-0 whitespace-normal break-words bg-transparent p-0 text-sm leading-relaxed text-text-dark"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

export function ScriptExportDialog({
  isOpen,
  onClose,
}: ScriptExportDialogProps) {
  const { t } = useTranslation();
  const nodes = useCanvasStore((state) => state.nodes);
  const edges = useCanvasStore((state) => state.edges);
  const [scopeMode, setScopeMode] = useState<ExportScopeMode>('main');
  const [customBranchIds, setCustomBranchIds] = useState<string[]>([]);
  const [format, setFormat] = useState<ExportFormat>('docx');
  const [mainFilePath, setMainFilePath] = useState('');
  const [includeShootingScript, setIncludeShootingScript] = useState(false);
  const [previewTab, setPreviewTab] = useState<PreviewTab>('script');
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState('');

  const chapterNodes = useMemo(() => (
    nodes
      .filter((node) => node.type === 'scriptChapterNode')
      .map((node) => ({
        id: node.id,
        data: node.data as any,
      }))
  ), [nodes]);
  const branches = useMemo(() => detectBranches(chapterNodes as any, edges), [chapterNodes, edges]);
  const nonMainBranches = useMemo(() => branches.filter((branch) => !branch.isMainBranch), [branches]);

  const selectedBranchIds = useMemo(() => {
    if (scopeMode === 'main') {
      return ['main'];
    }

    if (scopeMode === 'all') {
      return branches.map((branch) => branch.id);
    }

    if (customBranchIds.length > 0) {
      return customBranchIds;
    }

    return nonMainBranches.length > 0
      ? [nonMainBranches[0].id]
      : ['main'];
  }, [branches, customBranchIds, nonMainBranches, scopeMode]);

  const preview = useMemo(() => (
    buildScriptExportPreview(nodes as any, edges as any, {
      branchIds: selectedBranchIds,
    })
  ), [edges, nodes, selectedBranchIds]);
  const hasShootingScript = preview.shootingScriptSheets.length > 0;
  const shootingScriptPath = useMemo(
    () => buildShootingScriptFilePath(mainFilePath),
    [mainFilePath]
  );

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    setScopeMode('main');
    setCustomBranchIds(nonMainBranches.length > 0 ? [nonMainBranches[0].id] : []);
    setFormat('docx');
    setMainFilePath(buildDefaultExportFileName(preview.title, 'docx'));
    setIncludeShootingScript(false);
    setPreviewTab('script');
    setError('');
  }, [isOpen, nonMainBranches, preview.title]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    setMainFilePath((current) => {
      if (!current.trim()) {
        return buildDefaultExportFileName(preview.title, format);
      }
      return replaceFileExtension(current, format);
    });
  }, [format, isOpen, preview.title]);

  useEffect(() => {
    if (hasShootingScript) {
      return;
    }

    setIncludeShootingScript(false);
    if (previewTab === 'shooting') {
      setPreviewTab('script');
    }
  }, [hasShootingScript, previewTab]);

  const handlePickMainFilePath = useCallback(async () => {
    const selected = await save({
      defaultPath: mainFilePath || buildDefaultExportFileName(preview.title, format),
      filters: resolveFilterConfig(format),
    });

    if (typeof selected === 'string') {
      setMainFilePath(selected);
    }
  }, [format, mainFilePath, preview.title]);

  const handleToggleCustomBranch = useCallback((branchId: string) => {
    setCustomBranchIds((current) => (
      current.includes(branchId)
        ? current.filter((item) => item !== branchId)
        : [...current, branchId]
    ));
  }, []);

  const handleExport = useCallback(async () => {
    setIsExporting(true);
    setError('');

    try {
      await exportScriptPreview(preview, {
        format,
        mainFilePath,
        includeShootingScript,
        shootingScriptFilePath: includeShootingScript ? shootingScriptPath : undefined,
      });
      onClose();
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : t('common.error')
      );
    } finally {
      setIsExporting(false);
    }
  }, [
    format,
    includeShootingScript,
    mainFilePath,
    onClose,
    preview,
    shootingScriptPath,
    t,
  ]);

  return (
    <UiModal
      isOpen={isOpen}
      onClose={onClose}
      title={t('scriptExportDialog.title')}
      widthClassName="w-[min(1240px,calc(100vw-40px))]"
    >
      <div className="flex h-[min(820px,calc(100vh-140px))] min-h-0 flex-col gap-4 overflow-hidden">
        <div className="shrink-0 rounded-2xl border border-border-dark bg-bg-dark/25 p-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-xs uppercase tracking-[0.08em] text-text-muted">
                <GitBranch className="h-3.5 w-3.5" />
                {t('scriptExportDialog.scopeTitle')}
              </div>
              <div className="mt-2 text-sm leading-6 text-text-muted">
                {t('scriptExportDialog.scopeDescription')}
              </div>
            </div>

            <div className="flex flex-wrap gap-2 text-xs">
              <span className="rounded-full border border-border-dark px-3 py-1 text-text-muted">
                {t('scriptExportDialog.chapterCount')}: {preview.chapters.length}
              </span>
              <span className="rounded-full border border-border-dark px-3 py-1 text-text-muted">
                {t('scriptExportDialog.scopeSelected')}: {preview.branchLabels.join(', ') || t('scriptExportDialog.scopeMain')}
              </span>
              <span className="rounded-full border border-border-dark px-3 py-1 text-text-muted">
                {t('scriptExportDialog.shootingScriptRows')}: {preview.shootingScriptSheets.reduce((count, sheet) => count + sheet.rows.length, 0)}
              </span>
            </div>
          </div>

          <div className="mt-4 grid gap-3 lg:grid-cols-[260px_260px_minmax(0,1fr)]">
            <label className="rounded-xl border border-border-dark bg-surface-dark/45 px-3 py-3 text-sm text-text-dark">
              <div className="flex items-center gap-2">
                <input
                  type="radio"
                  checked={scopeMode === 'main'}
                  onChange={() => setScopeMode('main')}
                  className="accent-amber-500"
                />
                <span className="font-medium">{t('scriptExportDialog.scopeMain')}</span>
              </div>
              <div className="mt-2 text-xs leading-5 text-text-muted">
                {t('scriptExportDialog.scopeMainDescription')}
              </div>
            </label>

            <label className="rounded-xl border border-border-dark bg-surface-dark/45 px-3 py-3 text-sm text-text-dark">
              <div className="flex items-center gap-2">
                <input
                  type="radio"
                  checked={scopeMode === 'all'}
                  onChange={() => setScopeMode('all')}
                  className="accent-amber-500"
                />
                <span className="font-medium">{t('scriptExportDialog.scopeAll')}</span>
              </div>
              <div className="mt-2 text-xs leading-5 text-text-muted">
                {t('scriptExportDialog.scopeAllDescription')}
              </div>
            </label>

            <div className="rounded-xl border border-border-dark bg-surface-dark/45 px-3 py-3 text-sm text-text-dark">
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  checked={scopeMode === 'custom'}
                  onChange={() => setScopeMode('custom')}
                  className="accent-amber-500"
                />
                <span className="font-medium">{t('scriptExportDialog.scopeCustom')}</span>
              </label>

              <div className="mt-3 grid gap-2">
                {nonMainBranches.length > 0 ? (
                  nonMainBranches.map((branch) => (
                    <label
                      key={branch.id}
                      className="flex items-center gap-2 rounded-lg border border-border-dark/80 bg-bg-dark/35 px-2.5 py-2 text-xs text-text-muted"
                    >
                      <UiCheckbox
                        checked={customBranchIds.includes(branch.id)}
                        onCheckedChange={() => handleToggleCustomBranch(branch.id)}
                      />
                      <span>
                        {branch.name} ({branch.startChapter}-{branch.endChapter})
                      </span>
                    </label>
                  ))
                ) : (
                  <div className="text-xs leading-5 text-text-muted">
                    {t('scriptExportDialog.noExtraBranches')}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="flex min-h-[260px] flex-1 flex-col overflow-hidden rounded-2xl border border-border-dark bg-bg-dark/25">
          <div className="shrink-0 flex items-center gap-2 border-b border-border-dark px-4 py-3">
            <button
              type="button"
              onClick={() => setPreviewTab('script')}
              className={`rounded-lg px-3 py-1.5 text-sm transition-colors ${
                previewTab === 'script'
                  ? 'bg-amber-500/20 text-amber-300'
                  : 'text-text-muted hover:bg-bg-dark'
              }`}
            >
              <FileText className="mr-2 inline h-4 w-4" />
              {t('scriptExportDialog.scriptPreviewTab')}
            </button>

            {includeShootingScript && hasShootingScript ? (
              <button
                type="button"
                onClick={() => setPreviewTab('shooting')}
                className={`rounded-lg px-3 py-1.5 text-sm transition-colors ${
                  previewTab === 'shooting'
                    ? 'bg-amber-500/20 text-amber-300'
                    : 'text-text-muted hover:bg-bg-dark'
                }`}
              >
                <FileSpreadsheet className="mr-2 inline h-4 w-4" />
                {t('scriptExportDialog.shootingPreviewTab')}
              </button>
            ) : null}
          </div>

          <div className="ui-scrollbar min-h-0 flex-1 overflow-y-auto px-5 py-4">
            {previewTab === 'script' ? (
              <div className="mx-auto max-w-5xl space-y-4">
                <section className="rounded-[28px] border border-border-dark bg-surface-dark/55 px-8 py-7">
                  <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-text-muted">
                    {t('scriptExportDialog.scriptPreviewTab')}
                  </div>
                  <h1 className="mt-3 text-3xl font-semibold tracking-tight text-text-dark">
                    {preview.title}
                  </h1>
                  <p className="mt-3 max-w-3xl text-sm leading-7 text-text-muted">
                    {preview.branchLabels.join(', ') || t('scriptExportDialog.scopeMain')}
                  </p>
                </section>

                {preview.chapters.map((chapter) => (
                  <section
                    key={chapter.id}
                    className="overflow-hidden rounded-[28px] border border-border-dark bg-surface-dark/55"
                  >
                    <div className="border-b border-border-dark/80 px-6 py-5">
                      <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-amber-200/80">
                        Chapter {chapter.chapterNumber}
                      </div>
                      <h2 className="mt-2 text-2xl font-semibold tracking-tight text-text-dark">
                        {chapter.title || `Chapter ${chapter.chapterNumber}`}
                      </h2>
                      {chapter.summary.trim() ? (
                        <p className="mt-3 max-w-3xl text-sm leading-7 text-text-muted">
                          {chapter.summary}
                        </p>
                      ) : null}
                    </div>

                    <div className="space-y-4 px-5 py-5">
                      {chapter.units.map((unit) => (
                        <article
                          key={unit.id}
                          className="rounded-2xl border border-border-dark bg-bg-dark/30"
                        >
                          <div className="border-b border-border-dark/70 px-5 py-4">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="rounded-full border border-amber-500/20 bg-amber-500/10 px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.08em] text-amber-200">
                                {unit.label}
                              </span>
                              <span className="text-base font-semibold text-text-dark">
                                {unit.title}
                              </span>
                            </div>
                            {unit.summary.trim() ? (
                              <p className="mt-3 text-sm leading-7 text-text-muted">
                                {unit.summary}
                              </p>
                            ) : null}
                          </div>

                          <div className="px-5 py-5">
                            <ReadOnlyRichTextContent html={unit.html || '<p></p>'} />
                          </div>
                        </article>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            ) : (
              <div className="space-y-4">
                {preview.shootingScriptSheets.map((sheet) => (
                  <div
                    key={sheet.id}
                    className="rounded-2xl border border-border-dark bg-surface-dark/55 p-4"
                  >
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-text-dark">
                          {sheet.name}
                        </div>
                        <div className="mt-1 text-xs text-text-muted">
                          {t('scriptExportDialog.sheetMeta', {
                            chapter: sheet.chapterNumber,
                            scene: sheet.sceneNumber,
                            episode: sheet.episodeNumber,
                            title: sheet.episodeTitle,
                          })}
                        </div>
                      </div>
                      <div className="text-xs text-text-muted">
                        {t('scriptExportDialog.sheetRowCount', { count: sheet.rows.length })}
                      </div>
                    </div>

                    <div className="overflow-x-auto">
                      <table className="min-w-full border-collapse text-xs">
                        <thead>
                          <tr>
                            {[
                              t('scriptExportDialog.table.shotNumber'),
                              t('scriptExportDialog.table.beat'),
                              t('scriptExportDialog.table.action'),
                              t('scriptExportDialog.table.composition'),
                              t('scriptExportDialog.table.camera'),
                              t('scriptExportDialog.table.duration'),
                              t('scriptExportDialog.table.audio'),
                              t('scriptExportDialog.table.blocking'),
                              t('scriptExportDialog.table.artLighting'),
                              t('scriptExportDialog.table.continuityNote'),
                              t('scriptExportDialog.table.directorIntent'),
                              t('scriptExportDialog.table.genTarget'),
                              t('scriptExportDialog.table.genPrompt'),
                            ].map((label) => (
                              <th
                                key={label}
                                className="border border-border-dark bg-bg-dark/50 px-2 py-2 text-left font-medium text-text-dark"
                              >
                                {label}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {sheet.rows.map((row) => (
                            <tr key={row.id}>
                              <td className="border border-border-dark px-2 py-2 text-text-muted">{row.shotNumber}</td>
                              <td className="border border-border-dark px-2 py-2 text-text-muted">{row.beat}</td>
                              <td className="border border-border-dark px-2 py-2 text-text-muted">{row.action}</td>
                              <td className="border border-border-dark px-2 py-2 text-text-muted">{row.composition}</td>
                              <td className="border border-border-dark px-2 py-2 text-text-muted">{row.camera}</td>
                              <td className="border border-border-dark px-2 py-2 text-text-muted">{row.duration}</td>
                              <td className="border border-border-dark px-2 py-2 text-text-muted">{row.audio}</td>
                              <td className="border border-border-dark px-2 py-2 text-text-muted">{row.blocking}</td>
                              <td className="border border-border-dark px-2 py-2 text-text-muted">{row.artLighting}</td>
                              <td className="border border-border-dark px-2 py-2 text-text-muted">{row.continuityNote}</td>
                              <td className="border border-border-dark px-2 py-2 text-text-muted">{row.directorIntent}</td>
                              <td className="border border-border-dark px-2 py-2 text-text-muted">{row.genTarget}</td>
                              <td className="border border-border-dark px-2 py-2 text-text-muted">{row.genPrompt}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="shrink-0 rounded-2xl border border-border-dark bg-bg-dark/25 p-4">
          <div className="space-y-4">
            <div className="grid gap-4 xl:grid-cols-[180px_minmax(0,1fr)] xl:items-end">
              <label className="block">
                <div className="mb-2 text-sm font-medium text-text-dark">
                  {t('scriptExportDialog.format')}
                </div>
                <select
                  value={format}
                  onChange={(event) => setFormat(event.target.value as ExportFormat)}
                  className="w-full rounded-xl border border-border-dark bg-surface-dark px-3 py-2 text-sm text-text-dark outline-none"
                >
                  <option value="docx">DOCX</option>
                  <option value="markdown">Markdown</option>
                  <option value="txt">TXT</option>
                </select>
              </label>

              <div className="min-w-0">
                <div className="mb-2 text-sm font-medium text-text-dark">
                  {t('scriptExportDialog.mainFilePath')}
                </div>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <UiInput
                    value={mainFilePath}
                    onChange={(event) => setMainFilePath(event.target.value)}
                    placeholder={buildDefaultExportFileName(preview.title, format)}
                    className="min-w-0 flex-1"
                  />
                  <UiButton
                    variant="ghost"
                    size="sm"
                    onClick={handlePickMainFilePath}
                    className="shrink-0 whitespace-nowrap"
                  >
                    <FolderOpen className="mr-2 h-4 w-4" />
                    {t('scriptExportDialog.pickPath')}
                  </UiButton>
                </div>
              </div>
            </div>

            {includeShootingScript && hasShootingScript ? (
              <div>
                <div className="mb-2 text-sm font-medium text-text-dark">
                  {t('scriptExportDialog.shootingFilePath')}
                </div>
                <UiInput value={shootingScriptPath} readOnly />
              </div>
            ) : null}

            <div className="flex flex-col gap-4 border-t border-border-dark/80 pt-4 xl:flex-row xl:items-center xl:justify-between">
              <div className="min-w-0 flex-1 rounded-xl border border-border-dark bg-surface-dark/35 px-3.5 py-3">
                <div className="flex items-start gap-3">
                  <UiCheckbox
                    checked={includeShootingScript}
                    onCheckedChange={setIncludeShootingScript}
                    disabled={!hasShootingScript}
                    className="mt-0.5 shrink-0"
                  />
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-text-dark">
                      {t('scriptExportDialog.includeShootingScript')}
                    </div>
                    <div className="mt-1 text-xs leading-5 text-text-muted">
                      {hasShootingScript
                        ? t('scriptExportDialog.includeShootingScriptHint')
                        : t('scriptExportDialog.noShootingScriptHint')}
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex shrink-0 justify-end gap-3">
                <UiButton
                  variant="ghost"
                  size="sm"
                  onClick={onClose}
                  disabled={isExporting}
                  className="whitespace-nowrap"
                >
                  {t('common.cancel')}
                </UiButton>
                <UiButton
                  variant="primary"
                  size="sm"
                  onClick={handleExport}
                  disabled={isExporting || !mainFilePath.trim()}
                  className="whitespace-nowrap"
                >
                  {isExporting
                    ? t('scriptExportDialog.exporting')
                    : t('scriptExportDialog.export')}
                </UiButton>
              </div>
            </div>

            {error ? (
              <div className="rounded-xl border border-red-500/25 bg-red-500/10 px-3 py-2 text-sm leading-6 text-red-100">
                {error}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </UiModal>
  );
}
