import { memo, type ReactNode, useEffect, useState } from 'react';
import { Check, Palette } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { resolveImageDisplayUrl } from '@/features/canvas/application/imageData';
import type { MjStyleCodePreset } from '@/features/midjourney/domain/styleCodePresets';

interface MjStyleCodePresetCardProps {
  preset: MjStyleCodePreset;
  selected?: boolean;
  onClick?: () => void;
  actions?: ReactNode;
  className?: string;
}

function MjStyleCodePresetCardComponent({
  preset,
  selected = false,
  onClick,
  actions,
  className = '',
}: MjStyleCodePresetCardProps) {
  const { t } = useTranslation();
  const resolvedImageUrl = preset.imageUrl ? resolveImageDisplayUrl(preset.imageUrl) : null;
  const [hasImageError, setHasImageError] = useState(false);
  const displayImageUrl = resolvedImageUrl && !hasImageError ? resolvedImageUrl : null;
  const titleText = preset.name.trim() || preset.code.trim();
  const codeText = preset.code.trim();

  useEffect(() => {
    setHasImageError(false);
  }, [resolvedImageUrl]);

  const content = (
    <div className="relative overflow-hidden rounded-[12px] bg-[#283138] shadow-[0_8px_24px_rgba(0,0,0,0.18)]">
      <div className="relative">
        <div className="aspect-[4/3] w-full">
          {displayImageUrl ? (
            <img
              src={displayImageUrl}
              alt={preset.name}
              className="h-full w-full object-cover"
              draggable={false}
              onError={() => setHasImageError(true)}
            />
          ) : (
            <div className="flex h-full w-full flex-col items-center justify-center gap-3 bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.1),_transparent_55%),linear-gradient(180deg,rgba(27,40,58,0.95),rgba(19,30,45,0.82))] px-4 text-center">
              <div className="flex h-10 w-10 items-center justify-center rounded-[12px] border border-white/12 bg-white/8 text-text-dark">
                <Palette className="h-5 w-5" />
              </div>
              <div className="space-y-1">
                <div className="text-sm font-medium text-text-dark">
                  {t('node.midjourney.personalization.noPresetCover')}
                </div>
                <div className="text-[11px] leading-5 text-text-muted">
                  {t('node.midjourney.personalization.coverHint')}
                </div>
              </div>
            </div>
          )}
        </div>

        {actions ? (
          <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-end p-1.5">
            <div className="pointer-events-auto flex gap-1 rounded-full border border-white/10 bg-surface-dark/88 p-1 shadow-[0_10px_30px_rgba(0,0,0,0.26)]">
              {actions}
            </div>
          </div>
        ) : null}

        {selected ? (
          <div className="pointer-events-none absolute bottom-2 right-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-full border border-accent/60 bg-accent text-white shadow-[0_10px_24px_rgba(59,130,246,0.28)]">
              <Check className="h-4 w-4" />
            </div>
          </div>
        ) : null}
      </div>

      <div className="min-w-0 bg-[#2f3940] px-3 py-2.5">
        {titleText ? (
          <div className="truncate text-sm font-semibold leading-none text-white">
            {titleText}
          </div>
        ) : null}
        {codeText ? (
          <div className="mt-1 truncate text-[11px] leading-none text-white/55">
            {codeText}
          </div>
        ) : null}
      </div>
    </div>
  );

  if (onClick) {
    return (
      <button
        type="button"
        className={`group block w-full overflow-hidden rounded-[12px] text-left transition-all ${
          selected
            ? 'shadow-[0_0_0_1px_rgba(59,130,246,0.55),0_12px_28px_rgba(59,130,246,0.16)]'
            : 'hover:-translate-y-0.5 hover:shadow-[0_12px_28px_rgba(0,0,0,0.22)]'
        } ${className}`}
        onClick={onClick}
      >
        {content}
      </button>
    );
  }

  return (
    <div
      className={`group w-full overflow-hidden rounded-[12px] ${className}`}
    >
      {content}
    </div>
  );
}

export const MjStyleCodePresetCard = memo(MjStyleCodePresetCardComponent);

MjStyleCodePresetCard.displayName = 'MjStyleCodePresetCard';
