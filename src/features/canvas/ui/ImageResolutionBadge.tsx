import { memo } from 'react';

interface ImageResolutionBadgeProps {
  width?: number | null;
  height?: number | null;
  providerName?: string | null;
  className?: string;
}

function normalizeDimension(value: number | null | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return null;
  }

  return Math.round(value);
}

export const ImageResolutionBadge = memo(({
  width,
  height,
  providerName,
  className,
}: ImageResolutionBadgeProps) => {
  const resolvedWidth = normalizeDimension(width);
  const resolvedHeight = normalizeDimension(height);
  const resolvedProviderName =
    typeof providerName === 'string' && providerName.trim().length > 0
      ? providerName.trim()
      : null;

  if (!resolvedWidth || !resolvedHeight) {
    return null;
  }

  return (
    <div
      className={`pointer-events-none absolute bottom-2 right-2 z-20 border border-white/25 bg-black/70 px-2.5 py-1.5 text-white opacity-0 shadow-[0_4px_12px_rgba(0,0,0,0.18)] backdrop-blur-sm transition-all duration-150 group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:translate-y-0 group-focus-within:opacity-100 translate-y-1 ${
        resolvedProviderName ? 'rounded-2xl' : 'rounded-full'
      } ${className ?? ''}`}
      title={
        resolvedProviderName
          ? `${resolvedProviderName} · ${resolvedWidth} x ${resolvedHeight}`
          : `${resolvedWidth} x ${resolvedHeight}`
      }
    >
      {resolvedProviderName ? (
        <div className="flex max-w-[180px] flex-col gap-0.5 leading-none">
          <span className="truncate text-[9px] text-white/80">
            {resolvedProviderName}
          </span>
          <span className="text-[10px] font-semibold text-white">
            {resolvedWidth}
            {' x '}
            {resolvedHeight}
          </span>
        </div>
      ) : (
        <span className="text-[10px] font-semibold leading-none text-white">
          {resolvedWidth}
          {' x '}
          {resolvedHeight}
        </span>
      )}
    </div>
  );
});

ImageResolutionBadge.displayName = 'ImageResolutionBadge';
