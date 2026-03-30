import type {
  ImportedScriptDocument,
  ScriptImportFormat,
  ScriptImportWarningCode,
} from '@/features/canvas/application/scriptImporter';

interface ScriptImportPreviewProps {
  document: ImportedScriptDocument;
  title: string;
  formatLabel: string;
  chapterCountLabel: string;
  sceneCountLabel: string;
  wordCountLabel: string;
  warningsTitle: string;
  warningLabels: Record<ScriptImportWarningCode, string>;
  formatLabels: Record<ScriptImportFormat, string>;
  chapterLabel: (index: number, title: string) => string;
  sceneLabel: (index: number, title: string) => string;
  sceneCountBadge: (count: number) => string;
  moreScenesLabel: (count: number) => string;
}

export function ScriptImportPreview({
  document,
  title,
  formatLabel,
  chapterCountLabel,
  sceneCountLabel,
  wordCountLabel,
  warningsTitle,
  warningLabels,
  formatLabels,
  chapterLabel,
  sceneLabel,
  sceneCountBadge,
  moreScenesLabel,
}: ScriptImportPreviewProps) {
  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-border-dark bg-bg-dark/35 p-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="text-xs uppercase tracking-[0.08em] text-text-muted">
              {title}
            </div>
            <div className="mt-1 text-lg font-semibold text-text-dark">
              {document.title}
            </div>
            <div className="mt-1 text-sm text-text-muted">
              {document.sourceName}
            </div>
          </div>

          <div className="flex flex-wrap gap-2 text-xs">
            <span className="rounded-full border border-border-dark px-3 py-1 text-text-muted">
              {formatLabel}: {formatLabels[document.format]}
            </span>
            <span className="rounded-full border border-border-dark px-3 py-1 text-text-muted">
              {chapterCountLabel}: {document.stats.chapterCount}
            </span>
            <span className="rounded-full border border-border-dark px-3 py-1 text-text-muted">
              {sceneCountLabel}: {document.stats.sceneCount}
            </span>
            <span className="rounded-full border border-border-dark px-3 py-1 text-text-muted">
              {wordCountLabel}: {document.stats.wordCount}
            </span>
          </div>
        </div>
      </div>

      {document.warnings.length > 0 ? (
        <div className="rounded-2xl border border-amber-500/20 bg-amber-500/8 p-4">
          <div className="text-xs uppercase tracking-[0.08em] text-amber-200">
            {warningsTitle}
          </div>
          <div className="mt-2 space-y-2">
            {document.warnings.map((warning) => (
              <div
                key={warning}
                className="rounded-xl border border-amber-500/15 bg-black/10 px-3 py-2 text-sm leading-6 text-amber-100"
              >
                {warningLabels[warning]}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="max-h-[44vh] space-y-3 overflow-y-auto pr-1">
        {document.chapters.map((chapter, chapterIndex) => (
          <div
            key={`${chapter.title}-${chapterIndex}`}
            className="rounded-2xl border border-border-dark bg-bg-dark/25 p-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-text-dark">
                  {chapterLabel(chapterIndex, chapter.title)}
                </div>
                <div className="mt-1 text-sm leading-6 text-text-muted">
                  {chapter.summary}
                </div>
              </div>
              <span className="rounded-full border border-border-dark px-2.5 py-1 text-[11px] text-text-muted">
                {sceneCountBadge(chapter.scenes.length)}
              </span>
            </div>

            <div className="mt-3 space-y-2">
              {chapter.scenes.slice(0, 4).map((scene, sceneIndex) => (
                <div
                  key={`${scene.title}-${sceneIndex}`}
                  className="rounded-xl border border-border-dark/80 bg-surface-dark/55 px-3 py-2"
                >
                  <div className="text-xs font-medium text-text-dark">
                    {sceneLabel(sceneIndex, scene.title)}
                  </div>
                  <div className="mt-1 text-xs leading-5 text-text-muted">
                    {scene.summary}
                  </div>
                </div>
              ))}
              {chapter.scenes.length > 4 ? (
                <div className="text-xs text-text-muted">
                  {moreScenesLabel(chapter.scenes.length - 4)}
                </div>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
