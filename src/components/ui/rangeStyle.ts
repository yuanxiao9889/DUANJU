import type { CSSProperties } from 'react';

export function createUiRangeStyle(
  value: number,
  min: number,
  max: number,
): CSSProperties {
  const safeMin = Number.isFinite(min) ? min : 0;
  const safeMax = Number.isFinite(max) ? max : safeMin;
  const lowerBound = Math.min(safeMin, safeMax);
  const upperBound = Math.max(safeMin, safeMax);
  const span = upperBound - lowerBound;
  const safeValue = Number.isFinite(value) ? value : lowerBound;
  const clampedValue = Math.min(Math.max(safeValue, lowerBound), upperBound);
  const percent = span <= 0 ? 100 : ((clampedValue - lowerBound) / span) * 100;

  return {
    ['--ui-range-percent' as string]: `${percent}%`,
  };
}
