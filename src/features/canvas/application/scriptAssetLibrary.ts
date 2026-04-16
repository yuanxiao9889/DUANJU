import type {
  ScriptCharacterAsset,
  ScriptCharacterNodeData,
  ScriptItemAsset,
  ScriptItemNodeData,
  ScriptLocationAsset,
  ScriptLocationNodeData,
} from '@/features/canvas/domain/canvasNodes';

export function normalizeAssetName(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

export function getAssetLookupKey(value: string): string {
  return normalizeAssetName(value).toLowerCase();
}

function pickLongerText(primary: string, secondary: string): string {
  return primary.length >= secondary.length ? primary : secondary;
}

function mergeStringArray(primary: string[], secondary: string[]): string[] {
  return Array.from(
    new Set(
      [...primary, ...secondary]
        .map((item) => normalizeAssetName(item))
        .filter((item) => item.length > 0)
    )
  );
}

export function mergeCharacterAssetData(
  primary: ScriptCharacterAsset,
  secondary: ScriptCharacterAsset
): ScriptCharacterAsset {
  return {
    name: primary.name,
    description: pickLongerText(primary.description, secondary.description),
    personality: pickLongerText(primary.personality, secondary.personality),
    appearance: pickLongerText(primary.appearance, secondary.appearance),
  };
}

export function mergeLocationAssetData(
  primary: ScriptLocationAsset,
  secondary: ScriptLocationAsset
): ScriptLocationAsset {
  return {
    name: primary.name,
    description: pickLongerText(primary.description, secondary.description),
    appearances: mergeStringArray(primary.appearances, secondary.appearances),
  };
}

export function mergeItemAssetData(
  primary: ScriptItemAsset,
  secondary: ScriptItemAsset
): ScriptItemAsset {
  return {
    name: primary.name,
    description: pickLongerText(primary.description, secondary.description),
    appearances: mergeStringArray(primary.appearances, secondary.appearances),
  };
}

function mergeNamedAssets<TAsset extends { name: string }>(
  items: TAsset[],
  mergeFn: (primary: TAsset, secondary: TAsset) => TAsset
): TAsset[] {
  const map = new Map<string, TAsset>();

  items.forEach((item) => {
    const name = normalizeAssetName(item.name);
    const key = getAssetLookupKey(name);
    if (!key) {
      return;
    }

    const normalizedItem = {
      ...item,
      name,
    };
    const existing = map.get(key);
    map.set(key, existing ? mergeFn(existing, normalizedItem) : normalizedItem);
  });

  return Array.from(map.values());
}

function removeAssetByName<TAsset extends { name: string }>(items: TAsset[], name: string): TAsset[] {
  const targetKey = getAssetLookupKey(name);
  return items.filter((item) => getAssetLookupKey(item.name) !== targetKey);
}

export function upsertAssetByName<TAsset extends { name: string }>(
  items: TAsset[],
  nextItem: TAsset,
  mergeFn: (primary: TAsset, secondary: TAsset) => TAsset,
  originalName?: string
): TAsset[] {
  const filteredItems = originalName
    ? removeAssetByName(items, originalName)
    : items;
  return mergeNamedAssets([...filteredItems, nextItem], mergeFn);
}

export function toCharacterAsset(
  data: Pick<ScriptCharacterNodeData, 'name' | 'description' | 'personality' | 'appearance'>
): ScriptCharacterAsset {
  return {
    name: normalizeAssetName(data.name || ''),
    description: data.description || '',
    personality: data.personality || '',
    appearance: data.appearance || '',
  };
}

export function toLocationAsset(
  data: Pick<ScriptLocationNodeData, 'name' | 'description' | 'appearances'>
): ScriptLocationAsset {
  return {
    name: normalizeAssetName(data.name || ''),
    description: data.description || '',
    appearances: Array.isArray(data.appearances) ? data.appearances : [],
  };
}

export function toItemAsset(
  data: Pick<ScriptItemNodeData, 'name' | 'description' | 'appearances'>
): ScriptItemAsset {
  return {
    name: normalizeAssetName(data.name || ''),
    description: data.description || '',
    appearances: Array.isArray(data.appearances) ? data.appearances : [],
  };
}
