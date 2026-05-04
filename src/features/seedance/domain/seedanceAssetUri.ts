const SEEDANCE_ASSET_URI_PREFIX = 'asset://';

function normalizeSeedanceAssetId(value: string): string | null {
  const assetId = value.trim();
  if (!assetId || /[\s\u0000-\u001f\u007f]/.test(assetId)) {
    return null;
  }

  return assetId;
}

export function normalizeSeedanceAssetUri(input: string): string | null {
  const normalizedInput = input.trim();
  if (!normalizedInput) {
    return null;
  }

  const assetId = normalizedInput.toLowerCase().startsWith(SEEDANCE_ASSET_URI_PREFIX)
    ? normalizedInput.slice(SEEDANCE_ASSET_URI_PREFIX.length)
    : normalizedInput;
  const normalizedAssetId = normalizeSeedanceAssetId(assetId);

  return normalizedAssetId ? `${SEEDANCE_ASSET_URI_PREFIX}${normalizedAssetId}` : null;
}

export function isSeedanceAssetUri(input: string | null | undefined): boolean {
  if (typeof input !== 'string') {
    return false;
  }

  return normalizeSeedanceAssetUri(input) !== null
    && input.trim().toLowerCase().startsWith(SEEDANCE_ASSET_URI_PREFIX);
}

export function extractSeedanceAssetId(input: string | null | undefined): string | null {
  if (typeof input !== 'string') {
    return null;
  }

  const normalizedUri = normalizeSeedanceAssetUri(input);
  return normalizedUri ? normalizedUri.slice(SEEDANCE_ASSET_URI_PREFIX.length) : null;
}
