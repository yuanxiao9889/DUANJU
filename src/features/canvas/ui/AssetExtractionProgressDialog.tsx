import { AlertTriangle, CheckCircle2, Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { UiButton, UiLoadingAnimation, UiModal } from '@/components/ui';

export type AssetExtractionBatchStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface AssetExtractionBatchProgressItem {
  id: string;
  label: string;
  detail: string;
  status: AssetExtractionBatchStatus;
}

export interface AssetExtractionProgressState {
  isOpen: boolean;
  isRunning: boolean;
  totalBatches: number;
  completedBatches: number;
  currentLabel: string;
  summary: {
    characters: number;
    locations: number;
    items: number;
  };
  logs: AssetExtractionBatchProgressItem[];
  error: string;
}

interface AssetExtractionProgressDialogProps {
  progress: AssetExtractionProgressState;
  onClose: () => void;
}

export function AssetExtractionProgressDialog({
  progress,
  onClose,
}: AssetExtractionProgressDialogProps) {
  const { t } = useTranslation();
  const percent = progress.totalBatches > 0
    ? Math.round((progress.completedBatches / progress.totalBatches) * 100)
    : 0;

  return (
    <UiModal
      isOpen={progress.isOpen}
      title={t('script.assetExtraction.dialogTitle')}
      onClose={progress.isRunning ? () => undefined : onClose}
      widthClassName="w-[560px]"
      draggable={false}
      footer={(
        <UiButton onClick={onClose} disabled={progress.isRunning}>
          {progress.isRunning ? t('script.assetExtraction.running') : t('common.close')}
        </UiButton>
      )}
    >
      <div className="space-y-4">
        <div className="rounded-2xl border border-amber-500/20 bg-amber-500/8 p-4">
          <div className="flex items-start gap-3">
            <div className="rounded-xl bg-amber-500/12 p-2 text-amber-300">
              {progress.isRunning ? (
                <UiLoadingAnimation size="md" />
              ) : progress.error ? (
                <AlertTriangle className="h-5 w-5" />
              ) : (
                <Sparkles className="h-5 w-5" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-text-dark">
                {progress.isRunning
                  ? t('script.assetExtraction.currentBatch', {
                      current: Math.min(progress.completedBatches + 1, Math.max(progress.totalBatches, 1)),
                      total: Math.max(progress.totalBatches, 1),
                    })
                  : progress.error
                    ? t('script.assetExtraction.failedTitle')
                    : t('script.assetExtraction.completedTitle')}
              </div>
              <div className="mt-1 text-xs leading-5 text-text-muted">
                {progress.currentLabel || t('script.assetExtraction.preparing')}
              </div>
            </div>
            <div className="text-right">
              <div className="text-lg font-semibold text-text-dark">{percent}%</div>
              <div className="text-[11px] uppercase tracking-[0.08em] text-text-muted">
                {t('script.assetExtraction.progress')}
              </div>
            </div>
          </div>

          <div className="mt-4 h-2 overflow-hidden rounded-full bg-bg-dark/70">
            <div
              className="h-full rounded-full bg-gradient-to-r from-amber-400 to-cyan-400 transition-[width] duration-300"
              style={{ width: `${percent}%` }}
            />
          </div>

          <div className="mt-3 grid grid-cols-3 gap-2 text-center">
            <div className="rounded-xl border border-border-dark bg-bg-dark/40 px-2 py-2">
              <div className="text-lg font-semibold text-text-dark">{progress.summary.characters}</div>
              <div className="text-[11px] text-text-muted">{t('script.assetExtraction.summaryCharacters')}</div>
            </div>
            <div className="rounded-xl border border-border-dark bg-bg-dark/40 px-2 py-2">
              <div className="text-lg font-semibold text-text-dark">{progress.summary.locations}</div>
              <div className="text-[11px] text-text-muted">{t('script.assetExtraction.summaryLocations')}</div>
            </div>
            <div className="rounded-xl border border-border-dark bg-bg-dark/40 px-2 py-2">
              <div className="text-lg font-semibold text-text-dark">{progress.summary.items}</div>
              <div className="text-[11px] text-text-muted">{t('script.assetExtraction.summaryItems')}</div>
            </div>
          </div>
        </div>

        {progress.error ? (
          <div className="rounded-2xl border border-red-500/25 bg-red-500/8 px-4 py-3 text-sm leading-6 text-red-200">
            {progress.error}
          </div>
        ) : null}

        <div className="rounded-2xl border border-border-dark bg-bg-dark/25">
          <div className="border-b border-border-dark px-4 py-3 text-xs font-medium uppercase tracking-[0.08em] text-text-muted">
            {t('script.assetExtraction.batchLog')}
          </div>
          <div className="max-h-[320px] space-y-2 overflow-y-auto px-4 py-3 ui-scrollbar">
            {progress.logs.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border-dark px-3 py-4 text-sm text-text-muted">
                {t('script.assetExtraction.preparing')}
              </div>
            ) : (
              progress.logs.map((log) => (
                <div
                  key={log.id}
                  className="flex items-start gap-3 rounded-xl border border-border-dark bg-surface-dark/70 px-3 py-3"
                >
                  <div className="pt-0.5">
                    {log.status === 'running' ? (
                      <UiLoadingAnimation size="sm" />
                    ) : log.status === 'completed' ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-300" />
                    ) : log.status === 'failed' ? (
                      <AlertTriangle className="h-4 w-4 text-red-300" />
                    ) : (
                      <div className="h-4 w-4 rounded-full border border-border-dark bg-bg-dark/70" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-text-dark">{log.label}</div>
                    <div className="mt-1 text-xs leading-5 text-text-muted">{log.detail}</div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </UiModal>
  );
}
