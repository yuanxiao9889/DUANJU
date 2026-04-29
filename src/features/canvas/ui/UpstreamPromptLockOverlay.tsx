import { memo } from 'react';
import { useTranslation } from 'react-i18next';

interface UpstreamPromptLockOverlayProps {
  empty: boolean;
  className?: string;
}

export const UpstreamPromptLockOverlay = memo(({
  empty,
  className = '',
}: UpstreamPromptLockOverlayProps) => {
  const { t } = useTranslation();

  return (
    <div
      className={`absolute inset-0 z-40 flex items-center justify-center rounded-xl bg-black/58 px-4 text-center backdrop-blur-[1px] ${className}`.trim()}
    >
      <div className="max-w-[240px] space-y-2">
        <div className="inline-flex rounded-full border border-accent/35 bg-accent/12 px-2.5 py-1 text-[10px] font-medium text-accent">
          {t('common.upstreamTextDriven')}
        </div>
        <div className="text-xs leading-5 text-text-dark">
          {empty
            ? t('common.upstreamTextEmpty')
            : t('common.upstreamTextDisconnectHint')}
        </div>
      </div>
    </div>
  );
});

UpstreamPromptLockOverlay.displayName = 'UpstreamPromptLockOverlay';
