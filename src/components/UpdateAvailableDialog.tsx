import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import ReactMarkdown from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import { openUrl } from '@tauri-apps/plugin-opener';
import { UiButton, UiModal } from '@/components/ui';
import type {
  UpdateDownloadProgress,
  UpdateErrorCode,
} from '@/features/update/application/checkForUpdate';

const UPDATE_DOWNLOAD_URL = 'https://pan.quark.cn/s/d855a55e54c0';

interface UpdateAvailableDialogProps {
  isOpen: boolean;
  onClose: () => void;
  latestVersion?: string;
  currentVersion?: string;
  releaseNotes?: string;
  publishedAt?: string;
  canInstallInApp: boolean;
  installState: 'idle' | 'downloading' | 'installing' | 'restarting';
  downloadProgress: UpdateDownloadProgress | null;
  errorCode?: UpdateErrorCode | null;
  onInstallNow?: () => void;
  onIgnoreToday?: () => void;
  onIgnoreVersion?: () => void;
  onDisableReminders?: () => void;
}

function formatPublishedAt(value?: string): string | null {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleString();
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 B';
  }

  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const precision = value >= 100 || unitIndex === 0 ? 0 : 1;
  return `${value.toFixed(precision)} ${units[unitIndex]}`;
}

export function UpdateAvailableDialog({
  isOpen,
  onClose,
  latestVersion,
  currentVersion,
  releaseNotes,
  publishedAt,
  canInstallInApp,
  installState,
  downloadProgress,
  errorCode,
  onInstallNow,
  onIgnoreToday,
  onIgnoreVersion,
  onDisableReminders,
}: UpdateAvailableDialogProps) {
  const { t } = useTranslation();

  const publishedAtLabel = useMemo(() => formatPublishedAt(publishedAt), [publishedAt]);
  const downloadPercent = downloadProgress?.percent
    ? Math.round(downloadProgress.percent * 100)
    : 0;
  const isInstalling = installState !== 'idle';

  const statusText = useMemo(() => {
    if (installState === 'restarting') {
      return t('update.restarting');
    }

    if (installState === 'installing') {
      return t('update.installing');
    }

    if (installState === 'downloading') {
      if (downloadProgress?.totalBytes) {
        return t('update.downloadProgress', {
          downloaded: formatBytes(downloadProgress.downloadedBytes),
          total: formatBytes(downloadProgress.totalBytes),
          percent: downloadPercent,
        });
      }

      if (downloadProgress) {
        return t('update.downloadingUnknownSize', {
          downloaded: formatBytes(downloadProgress.downloadedBytes),
        });
      }

      return t('update.downloading');
    }

    return null;
  }, [downloadPercent, downloadProgress, installState, t]);

  const bannerText = useMemo(() => {
    if (errorCode === 'install') {
      return t('update.installFailed');
    }

    if (errorCode === 'no-endpoint') {
      return t('update.noEndpointFallback');
    }

    if (errorCode === 'network') {
      return t('update.networkFallback');
    }

    if (errorCode === 'unknown') {
      return t('update.unknownFallback');
    }

    if (!canInstallInApp) {
      return t('update.manualOnlyPlatformNotice');
    }

    return null;
  }, [canInstallInApp, errorCode, t]);

  const handleOpenDownload = useCallback(() => {
    void openUrl(UPDATE_DOWNLOAD_URL);
  }, []);

  return (
    <UiModal
      isOpen={isOpen}
      onClose={onClose}
      title={t('update.dialogTitle')}
      widthClassName="w-[min(760px,calc(100vw-32px))]"
      bodyClassName="space-y-4"
      footer={(
        <div className="flex w-full flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            {onIgnoreToday ? (
              <UiButton
                variant="ghost"
                size="sm"
                onClick={onIgnoreToday}
                disabled={isInstalling}
              >
                {t('update.ignoreToday')}
              </UiButton>
            ) : null}
            <button
              type="button"
              onClick={handleOpenDownload}
              className="text-xs text-text-muted transition-colors hover:text-text-dark"
            >
              {t('update.quarkFallbackLink')}
            </button>
          </div>

          <div className="flex flex-wrap justify-end gap-2">
            <UiButton variant="muted" size="sm" onClick={onClose} disabled={isInstalling}>
              {t('update.later')}
            </UiButton>
            <UiButton variant="muted" size="sm" onClick={handleOpenDownload}>
              {t('update.manualDownload')}
            </UiButton>
            {onIgnoreVersion ? (
              <UiButton
                variant="ghost"
                size="sm"
                onClick={onIgnoreVersion}
                disabled={isInstalling}
              >
                {t('update.ignoreThisVersion')}
              </UiButton>
            ) : null}
            {onDisableReminders ? (
              <UiButton
                variant="ghost"
                size="sm"
                onClick={onDisableReminders}
                disabled={isInstalling}
              >
                {t('update.disableReminders')}
              </UiButton>
            ) : null}
            {canInstallInApp && onInstallNow ? (
              <UiButton
                variant="primary"
                size="sm"
                onClick={onInstallNow}
                disabled={isInstalling}
              >
                {isInstalling ? statusText ?? t('update.installing') : t('update.installNow')}
              </UiButton>
            ) : null}
          </div>
        </div>
      )}
    >
      <div className="space-y-4 text-sm text-text-muted">
        <div className="space-y-2">
          <p className="leading-6">{t('update.dialogDescription')}</p>
          {(latestVersion || currentVersion) && (
            <p className="text-xs">
              {t('update.versionLine', {
                currentVersion: currentVersion ?? '-',
                latestVersion: latestVersion ?? '-',
              })}
            </p>
          )}
          {publishedAtLabel ? (
            <p className="text-xs">
              {t('update.publishedAt')}: {publishedAtLabel}
            </p>
          ) : null}
        </div>

        {bannerText ? (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs leading-5 text-amber-200">
            {bannerText}
          </div>
        ) : null}

        {statusText ? (
          <div className="rounded-lg border border-border-dark bg-surface-dark px-3 py-3">
            <div className="flex items-center justify-between gap-3 text-xs text-text-muted">
              <span>{statusText}</span>
              {downloadProgress?.phase === 'downloading' && downloadProgress.percent != null ? (
                <span>{downloadPercent}%</span>
              ) : null}
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-bg-dark">
              <div
                className="h-full rounded-full bg-accent transition-[width]"
                style={{
                  width:
                    downloadProgress?.phase === 'downloading'
                      ? `${Math.max(6, downloadPercent)}%`
                      : '100%',
                }}
              />
            </div>
          </div>
        ) : null}

        <div className="rounded-lg border border-border-dark bg-surface-dark">
          <div className="border-b border-border-dark px-4 py-3">
            <div className="text-sm font-medium text-text-dark">
              {t('update.releaseNotesTitle')}
            </div>
            <p className="mt-1 text-xs text-text-muted">
              {t('update.manualDownloadHint')}
            </p>
          </div>

          <div className="ui-scrollbar max-h-[360px] overflow-y-auto px-4 py-4">
            {releaseNotes?.trim() ? (
              <div className="prose prose-sm max-w-none text-text-muted prose-headings:text-text-dark prose-strong:text-text-dark prose-a:text-accent prose-code:text-text-dark prose-pre:bg-bg-dark">
                <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]}>
                  {releaseNotes}
                </ReactMarkdown>
              </div>
            ) : (
              <p className="text-sm text-text-muted">{t('update.releaseNotesEmpty')}</p>
            )}
          </div>
        </div>
      </div>
    </UiModal>
  );
}
