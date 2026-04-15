import type { ProjectRecord } from '@/commands/projectState';
import {
  CANVAS_NODE_TYPES,
  normalizeScriptRootNodeData,
  type CanvasNode,
  type ScriptCharacterAsset,
  type ScriptCharacterNodeData,
  type ScriptCharacterReferenceSnapshot,
  type ScriptItemAsset,
  type ScriptItemNodeData,
  type ScriptItemReferenceSnapshot,
  type ScriptLocationAsset,
  type ScriptLocationNodeData,
  type ScriptLocationReferenceSnapshot,
  type ScriptRootNodeData,
} from '@/features/canvas/domain/canvasNodes';
import {
  getAssetLookupKey,
  mergeCharacterAssetData,
  mergeItemAssetData,
  mergeLocationAssetData,
  toCharacterAsset,
  toItemAsset,
  toLocationAsset,
} from '@/features/canvas/application/scriptAssetLibrary';

interface PersistedNodesPayload {
  nodes?: CanvasNode[];
}

export interface LinkedScriptAssetLibraries {
  characters: ScriptCharacterAsset[];
  locations: ScriptLocationAsset[];
  items: ScriptItemAsset[];
}

function parsePersistedNodesPayload(value: string): CanvasNode[] {
  try {
    const parsed = JSON.parse(value) as CanvasNode[] | PersistedNodesPayload;
    if (Array.isArray(parsed)) {
      return parsed;
    }
    return Array.isArray(parsed?.nodes) ? parsed.nodes : [];
  } catch {
    return [];
  }
}

function mergeNamedAssets<TAsset extends { name: string }>(
  items: TAsset[],
  mergeFn: (primary: TAsset, secondary: TAsset) => TAsset
): TAsset[] {
  const map = new Map<string, TAsset>();

  items.forEach((item) => {
    const key = getAssetLookupKey(item.name);
    if (!key) {
      return;
    }

    const existing = map.get(key);
    map.set(key, existing ? mergeFn(existing, item) : item);
  });

  return Array.from(map.values()).sort((left, right) => left.name.localeCompare(right.name, 'zh-Hans-CN'));
}

export function extractLinkedScriptAssetLibraries(
  record: ProjectRecord
): LinkedScriptAssetLibraries {
  const nodes = parsePersistedNodesPayload(record.nodesJson);
  const rootNode = nodes.find((node) => node.type === CANVAS_NODE_TYPES.scriptRoot);
  const normalizedRootData = rootNode
    ? normalizeScriptRootNodeData(rootNode.data as ScriptRootNodeData)
    : null;

  const characterAssets: ScriptCharacterAsset[] = [...(normalizedRootData?.assetLibraryCharacters ?? [])];
  const locationAssets: ScriptLocationAsset[] = [...(normalizedRootData?.assetLibraryLocations ?? [])];
  const itemAssets: ScriptItemAsset[] = [...(normalizedRootData?.assetLibraryItems ?? [])];

  nodes.forEach((node) => {
    if (node.type === CANVAS_NODE_TYPES.scriptCharacter) {
      const asset = toCharacterAsset(node.data as ScriptCharacterNodeData);
      if (asset.name) {
        characterAssets.push(asset);
      }
      return;
    }

    if (node.type === CANVAS_NODE_TYPES.scriptLocation) {
      const asset = toLocationAsset(node.data as ScriptLocationNodeData);
      if (asset.name) {
        locationAssets.push(asset);
      }
      return;
    }

    if (node.type === CANVAS_NODE_TYPES.scriptItem) {
      const asset = toItemAsset(node.data as ScriptItemNodeData);
      if (asset.name) {
        itemAssets.push(asset);
      }
    }
  });

  return {
    characters: mergeNamedAssets(characterAssets, mergeCharacterAssetData),
    locations: mergeNamedAssets(locationAssets, mergeLocationAssetData),
    items: mergeNamedAssets(itemAssets, mergeItemAssetData),
  };
}

function findNamedAsset<TAsset extends { name: string }>(
  items: TAsset[],
  assetName: string | null | undefined
): TAsset | null {
  const key = getAssetLookupKey(assetName ?? '');
  if (!key) {
    return null;
  }

  return items.find((item) => getAssetLookupKey(item.name) === key) ?? null;
}

export function findLinkedScriptCharacterAsset(
  libraries: LinkedScriptAssetLibraries,
  assetName: string | null | undefined
): ScriptCharacterAsset | null {
  return findNamedAsset(libraries.characters, assetName);
}

export function findLinkedScriptLocationAsset(
  libraries: LinkedScriptAssetLibraries,
  assetName: string | null | undefined
): ScriptLocationAsset | null {
  return findNamedAsset(libraries.locations, assetName);
}

export function findLinkedScriptItemAsset(
  libraries: LinkedScriptAssetLibraries,
  assetName: string | null | undefined
): ScriptItemAsset | null {
  return findNamedAsset(libraries.items, assetName);
}

export function buildScriptCharacterReferenceSnapshot(
  asset: ScriptCharacterAsset
): ScriptCharacterReferenceSnapshot {
  return {
    name: asset.name,
    description: asset.description,
    personality: asset.personality,
    appearance: asset.appearance,
  };
}

export function buildScriptLocationReferenceSnapshot(
  asset: ScriptLocationAsset
): ScriptLocationReferenceSnapshot {
  return {
    name: asset.name,
    description: asset.description,
    appearances: [...asset.appearances],
  };
}

export function buildScriptItemReferenceSnapshot(
  asset: ScriptItemAsset
): ScriptItemReferenceSnapshot {
  return {
    name: asset.name,
    description: asset.description,
    appearances: [...asset.appearances],
  };
}

function areStringArraysEqual(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((item, index) => item === right[index]);
}

export function isScriptCharacterReferenceSnapshotStale(
  snapshot: ScriptCharacterReferenceSnapshot | null | undefined,
  asset: ScriptCharacterAsset
): boolean {
  if (!snapshot) {
    return false;
  }

  return snapshot.name !== asset.name
    || snapshot.description !== asset.description
    || snapshot.personality !== asset.personality
    || snapshot.appearance !== asset.appearance;
}

export function isScriptLocationReferenceSnapshotStale(
  snapshot: ScriptLocationReferenceSnapshot | null | undefined,
  asset: ScriptLocationAsset
): boolean {
  if (!snapshot) {
    return false;
  }

  return snapshot.name !== asset.name
    || snapshot.description !== asset.description
    || !areStringArraysEqual(snapshot.appearances, asset.appearances);
}

export function isScriptItemReferenceSnapshotStale(
  snapshot: ScriptItemReferenceSnapshot | null | undefined,
  asset: ScriptItemAsset
): boolean {
  if (!snapshot) {
    return false;
  }

  return snapshot.name !== asset.name
    || snapshot.description !== asset.description
    || !areStringArraysEqual(snapshot.appearances, asset.appearances);
}
