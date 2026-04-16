export function resolveNodeStyleDimension(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 1) {
    return Math.round(value);
  }

  if (typeof value !== 'string') {
    return null;
  }

  const normalizedValue = value.trim();
  if (!normalizedValue) {
    return null;
  }

  const parsedValue = Number.parseFloat(normalizedValue.replace(/px$/i, ''));
  if (!Number.isFinite(parsedValue) || parsedValue <= 1) {
    return null;
  }

  return Math.round(parsedValue);
}
