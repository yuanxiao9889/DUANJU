import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

interface CanvasProjectLoadingScreenProps {
  projectName?: string | null;
  phase: 'project' | 'images';
  totalCount?: number;
  loadedCount?: number;
  failedCount?: number;
}

function clampProgress(value: number): number {
  return Math.max(0, Math.min(100, value));
}

export function CanvasProjectLoadingScreen({
  projectName,
  phase,
  totalCount = 0,
  loadedCount = 0,
  failedCount = 0,
}: CanvasProjectLoadingScreenProps) {
  const { t } = useTranslation();

  const progress = useMemo(() => {
    if (phase === 'project') {
      return 32;
    }

    if (totalCount <= 0) {
      return 100;
    }

    return clampProgress(Math.round(((loadedCount + failedCount) / totalCount) * 100));
  }, [failedCount, loadedCount, phase, totalCount]);

  return (
    <div className="relative h-full overflow-hidden bg-bg-dark">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(var(--accent-rgb),0.14),transparent_32%)]" />

      <div className="relative flex h-full items-center justify-center px-6">
        <div className="w-full max-w-lg rounded-[28px] border border-border-dark/60 bg-surface-dark/88 p-8 shadow-[0_18px_56px_rgba(0,0,0,0.22)] backdrop-blur-lg">
          <p className="text-sm font-medium text-text-dark">
            {projectName || t('canvas.loading.badge')}
          </p>
          <p className="mt-3 text-sm leading-6 text-text-muted">
            {phase === 'project'
              ? t('canvas.loading.projectHint')
              : t('canvas.loading.description')}
          </p>

          <div className="mt-8 flex items-end justify-between gap-4">
            <p className="text-xs uppercase tracking-[0.22em] text-text-muted">
              {t('canvas.loading.progressLabel')}
            </p>
            <p className="text-3xl font-semibold tracking-tight text-text-dark">
              {progress}%
            </p>
          </div>

          <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/8">
            <div
              className="h-full rounded-full bg-accent transition-[width] duration-300 ease-out"
              style={{ width: `${phase === 'project' ? 38 : progress}%` }}
            />
          </div>

          {phase === 'images' && failedCount > 0 ? (
            <p className="mt-3 text-xs text-text-muted">
              {t('canvas.loading.failed', { count: failedCount })}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
