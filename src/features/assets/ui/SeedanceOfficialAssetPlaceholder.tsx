import { BadgeCheck, UserRound } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { extractSeedanceAssetId } from '@/features/seedance/domain/seedanceAssetUri';

interface SeedanceOfficialAssetPlaceholderProps {
  uri: string | null | undefined;
  className?: string;
  compact?: boolean;
}

export function SeedanceOfficialAssetPlaceholder({
  uri,
  className = '',
  compact = false,
}: SeedanceOfficialAssetPlaceholderProps) {
  const { t } = useTranslation();
  const assetId = extractSeedanceAssetId(uri);

  return (
    <div
      className={`flex h-full min-h-[72px] w-full flex-col items-center justify-center border border-dashed border-emerald-300/25 bg-[linear-gradient(145deg,rgba(16,185,129,0.16),rgba(15,23,42,0.34))] text-center ${className}`}
    >
      <div className="flex h-10 w-10 items-center justify-center rounded-full border border-emerald-300/25 bg-emerald-300/10 text-emerald-200">
        <UserRound className="h-5 w-5" />
      </div>
      <div className={compact ? 'mt-1.5 space-y-0.5 px-2' : 'mt-2 space-y-1 px-3'}>
        <div className="inline-flex max-w-full items-center justify-center gap-1 rounded-full bg-emerald-300/12 px-2 py-0.5 text-[10px] font-medium text-emerald-100">
          <BadgeCheck className="h-3 w-3 shrink-0" />
          <span className="truncate">{t('assets.seedanceOfficialBadge')}</span>
        </div>
        <div className="truncate text-[11px] font-medium leading-4 text-text-dark">
          {assetId ?? t('assets.seedanceOfficialPreview')}
        </div>
      </div>
    </div>
  );
}
