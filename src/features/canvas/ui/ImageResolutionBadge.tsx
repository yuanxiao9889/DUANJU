import { memo } from 'react';

interface ImageResolutionBadgeProps {
  width?: number | null;
  height?: number | null;
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
  className,
}: ImageResolutionBadgeProps) => {
  const resolvedWidth = normalizeDimension(width);
  const resolvedHeight = normalizeDimension(height);

  if (!resolvedWidth || !resolvedHeight) {
    return null;
  }

  return (
    <div
      className={`pointer-events-none absolute bottom-2 right-2 z-20 rounded-full border border-white/12 bg-[rgba(15,23,42,0.72)] px-2 py-1 text-[10px] font-medium leading-none text-white/92 opacity-0 shadow-[0_6px_20px_rgba(15,23,42,0.2)] backdrop-blur-sm transition-all duration-150 group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:translate-y-0 group-focus-within:opacity-100 translate-y-1 ${className ?? ''}`}
      title={`${resolvedWidth} x ${resolvedHeight}`}
    >
      {resolvedWidth}
      {' x '}
      {resolvedHeight}
    </div>
  );
});

ImageResolutionBadge.displayName = 'ImageResolutionBadge';
