import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { Position, useUpdateNodeInternals, type NodeProps } from '@xyflow/react';
import { ChevronDown, Database, Package, User, MapPin } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { UiScrollArea, UiSelect } from '@/components/ui';
import {
  ASSET_MATERIAL_NODE_DEFAULT_HEIGHT,
  ASSET_MATERIAL_NODE_DEFAULT_WIDTH,
  CANVAS_NODE_TYPES,
  type AssetMaterialNodeData,
} from '@/features/canvas/domain/canvasNodes';
import { resolveNodeDisplayName } from '@/features/canvas/domain/nodeDisplay';
import { CanvasHandle } from '@/features/canvas/ui/CanvasHandle';
import { NodeHeader, NODE_HEADER_FLOATING_POSITION_CLASS } from '@/features/canvas/ui/NodeHeader';
import { NodeResizeHandle } from '@/features/canvas/ui/NodeResizeHandle';
import type { AssetCategory, AssetItemRecord } from '@/features/assets/domain/types';
import { useAssetStore } from '@/stores/assetStore';
import { useCanvasStore } from '@/stores/canvasStore';
import { useProjectStore } from '@/stores/projectStore';

type AssetMaterialNodeProps = NodeProps & {
  id: string;
  data: AssetMaterialNodeData;
  selected?: boolean;
};

const MIN_WIDTH = 340;
const MIN_HEIGHT = 360;
const MAX_WIDTH = 760;
const MAX_HEIGHT = 980;
const VISIBLE_CATEGORIES: AssetCategory[] = ['character', 'scene', 'prop'];

type DisplayAssetItem = AssetItemRecord & {
  duplicateAssetIds: string[];
};

function getCategoryIcon(category: AssetCategory) {
  switch (category) {
    case 'character':
      return User;
    case 'scene':
      return MapPin;
    case 'prop':
      return Package;
    default:
      return Database;
  }
}

function normalizeName(value: string): string {
  return value.trim().toLowerCase();
}

function buildAssetNameKey(category: AssetCategory, name: string): string {
  return `${category}:${normalizeName(name)}`;
}

export const AssetMaterialNode = memo(function AssetMaterialNode({
  id,
  data,
  selected,
  width,
  height,
}: AssetMaterialNodeProps) {
  const { t } = useTranslation();
  const updateNodeInternals = useUpdateNodeInternals();
  const setSelectedNode = useCanvasStore((state) => state.setSelectedNode);
  const updateNodeData = useCanvasStore((state) => state.updateNodeData);
  const libraries = useAssetStore((state) => state.libraries);
  const hydrateAssets = useAssetStore((state) => state.hydrate);
  const currentProjectAssetLibraryId = useProjectStore((state) => state.currentProject?.assetLibraryId ?? null);
  const [openCategories, setOpenCategories] = useState<Set<AssetCategory>>(
    () => new Set(VISIBLE_CATEGORIES)
  );

  const resolvedWidth = Math.max(MIN_WIDTH, Math.round(width ?? ASSET_MATERIAL_NODE_DEFAULT_WIDTH));
  const resolvedHeight = Math.max(MIN_HEIGHT, Math.round(height ?? ASSET_MATERIAL_NODE_DEFAULT_HEIGHT));
  const selectedLibraryId =
    data.assetLibraryId
    ?? currentProjectAssetLibraryId
    ?? libraries[0]?.id
    ?? null;
  const selectedLibrary = libraries.find((library) => library.id === selectedLibraryId) ?? null;
  const selectedIdSet = useMemo(() => new Set(data.selectedAssetIds), [data.selectedAssetIds]);
  const matchedNameSet = useMemo(
    () => new Set((data.defaultMatchedAssetNames ?? []).map(normalizeName)),
    [data.defaultMatchedAssetNames]
  );

  useEffect(() => {
    void hydrateAssets();
  }, [hydrateAssets]);

  useEffect(() => {
    updateNodeInternals(id);
  }, [id, resolvedHeight, resolvedWidth, updateNodeInternals]);

  useEffect(() => {
    if (!data.assetLibraryId && selectedLibraryId) {
      updateNodeData(id, { assetLibraryId: selectedLibraryId }, { historyMode: 'skip' });
    }
  }, [data.assetLibraryId, id, selectedLibraryId, updateNodeData]);

  useEffect(() => {
    if (!selectedLibrary || data.selectedAssetIds.length === 0) {
      return;
    }

    const itemById = new Map(selectedLibrary.items.map((item) => [item.id, item] as const));
    const nextSelectedIds: string[] = [];
    const seenNameKeys = new Set<string>();

    data.selectedAssetIds.forEach((assetId) => {
      const item = itemById.get(assetId);
      if (!item || item.mediaType !== 'image' || !VISIBLE_CATEGORIES.includes(item.category)) {
        return;
      }

      const nameKey = buildAssetNameKey(item.category, item.name);
      if (seenNameKeys.has(nameKey)) {
        return;
      }

      seenNameKeys.add(nameKey);
      nextSelectedIds.push(assetId);
    });

    const hasChanged =
      nextSelectedIds.length !== data.selectedAssetIds.length
      || nextSelectedIds.some((assetId, index) => assetId !== data.selectedAssetIds[index]);

    if (hasChanged) {
      updateNodeData(id, { selectedAssetIds: nextSelectedIds }, { historyMode: 'skip' });
    }
  }, [data.selectedAssetIds, id, selectedLibrary, updateNodeData]);

  const subcategoryNameById = useMemo(() => {
    const map = new Map<string, string>();
    selectedLibrary?.subcategories.forEach((subcategory) => {
      map.set(subcategory.id, subcategory.name);
    });
    return map;
  }, [selectedLibrary]);

  const itemsByCategory = useMemo(() => {
    const map = new Map<AssetCategory, DisplayAssetItem[]>();
    VISIBLE_CATEGORIES.forEach((category) => map.set(category, []));
    const uniqueItemMap = new Map<string, DisplayAssetItem>();

    selectedLibrary?.items.forEach((item) => {
      if (!VISIBLE_CATEGORIES.includes(item.category) || item.mediaType !== 'image') {
        return;
      }

      const nameKey = buildAssetNameKey(item.category, item.name);
      const existing = uniqueItemMap.get(nameKey);
      if (existing) {
        existing.duplicateAssetIds.push(item.id);
        if (!selectedIdSet.has(existing.id) && selectedIdSet.has(item.id)) {
          existing.id = item.id;
          existing.subcategoryId = item.subcategoryId;
          existing.sourcePath = item.sourcePath;
          existing.previewPath = item.previewPath;
          existing.updatedAt = item.updatedAt;
          existing.createdAt = item.createdAt;
        }
        return;
      }

      uniqueItemMap.set(nameKey, {
        ...item,
        duplicateAssetIds: [item.id],
      });
    });

    uniqueItemMap.forEach((item) => {
      map.get(item.category)?.push(item);
    });

    map.forEach((items) => {
      items.sort((left, right) => left.name.localeCompare(right.name, 'zh-Hans-CN'));
    });
    return map;
  }, [selectedIdSet, selectedLibrary]);

  const toggleCategory = useCallback((category: AssetCategory) => {
    setOpenCategories((current) => {
      const next = new Set(current);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  }, []);

  const toggleAsset = useCallback((item: DisplayAssetItem) => {
    const duplicateIdSet = new Set(item.duplicateAssetIds);
    const isSelected = item.duplicateAssetIds.some((assetId) => selectedIdSet.has(assetId));
    const nextIds = isSelected
      ? data.selectedAssetIds.filter((idValue) => !duplicateIdSet.has(idValue))
      : [...data.selectedAssetIds.filter((idValue) => !duplicateIdSet.has(idValue)), item.id];
    updateNodeData(id, { selectedAssetIds: nextIds }, { historyMode: 'skip' });
  }, [data.selectedAssetIds, id, selectedIdSet, updateNodeData]);

  const groupedBySubcategory = useCallback((items: DisplayAssetItem[]) => {
    const groups = new Map<string, DisplayAssetItem[]>();
    items.forEach((item) => {
      const key = item.subcategoryId ?? '__uncategorized__';
      const group = groups.get(key) ?? [];
      group.push(item);
      groups.set(key, group);
    });
    return Array.from(groups.entries());
  }, []);

  return (
    <div
      className={`group relative h-full w-full overflow-visible rounded-[var(--node-radius)] border bg-surface-dark/90 p-2 transition-all duration-150 ${
        selected
          ? 'border-[#222222] shadow-[0_0_0_2px_rgba(34,34,34,0.38),0_4px_14px_rgba(15,23,42,0.12)] dark:border-white/70 dark:shadow-[0_0_0_2px_rgba(245,245,245,0.2),0_4px_14px_rgba(0,0,0,0.24)]'
          : 'border-[rgba(15,23,42,0.22)] hover:border-[rgba(15,23,42,0.34)] hover:shadow-[0_4px_16px_rgba(0,0,0,0.12)] dark:border-[rgba(255,255,255,0.22)] dark:hover:border-[rgba(255,255,255,0.34)] dark:hover:shadow-[0_4px_16px_rgba(0,0,0,0.25)]'
      }`}
      style={{ width: resolvedWidth, height: resolvedHeight }}
      onClick={() => setSelectedNode(id)}
    >
      <NodeHeader
        className={NODE_HEADER_FLOATING_POSITION_CLASS}
        icon={<Database className="h-4 w-4" />}
        titleText={resolveNodeDisplayName(CANVAS_NODE_TYPES.assetMaterial, data)}
        editable
        onTitleChange={(displayName) => updateNodeData(id, { displayName })}
      />
      <CanvasHandle type="source" position={Position.Right} />

      <div className="nodrag nopan flex h-full min-h-0 flex-col gap-3 px-3 pb-3 pt-10">
        <div className="rounded-lg border border-[rgba(255,255,255,0.1)] bg-bg-dark/45 p-2">
          <div className="mb-1.5 text-[11px] font-medium text-text-muted">
            {t('node.assetMaterial.library')}
          </div>
          <UiSelect
            value={selectedLibraryId ?? ''}
            onChange={(event) => updateNodeData(id, { assetLibraryId: event.target.value || null })}
            aria-label={t('node.assetMaterial.library')}
            className="w-full"
          >
            {libraries.length === 0 ? (
              <option value="">{t('node.assetMaterial.noLibrary')}</option>
            ) : null}
            {libraries.map((library) => (
              <option key={library.id} value={library.id}>
                {library.name}
              </option>
            ))}
          </UiSelect>
        </div>

        <UiScrollArea
          className="nowheel min-h-0 flex-1 rounded-lg border border-[rgba(255,255,255,0.1)] bg-bg-dark/45"
          viewportClassName="h-full"
          contentClassName="p-2 pr-5"
        >
          {selectedLibrary ? (
            <div className="space-y-2">
              {VISIBLE_CATEGORIES.map((category) => {
                const Icon = getCategoryIcon(category);
                const items = itemsByCategory.get(category) ?? [];
                const isOpen = openCategories.has(category);
                return (
                  <section key={category} className="overflow-hidden rounded-lg border border-[rgba(255,255,255,0.1)] bg-bg-dark/45">
                    <button
                      type="button"
                      className="flex w-full items-center justify-between px-3 py-2 text-left text-xs font-semibold text-text-dark"
                      onClick={(event) => {
                        event.stopPropagation();
                        toggleCategory(category);
                      }}
                    >
                      <span className="inline-flex items-center gap-2">
                        <Icon className="h-3.5 w-3.5 text-accent" />
                        {t(`node.assetMaterial.category.${category}`)}
                        <span className="text-text-muted">({items.length})</span>
                      </span>
                      <ChevronDown className={`h-3.5 w-3.5 text-text-muted transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                    </button>
                    {isOpen ? (
                      <div className="border-t border-[rgba(255,255,255,0.1)] px-2 py-2">
                        {items.length > 0 ? (
                          <div className="space-y-2">
                            {groupedBySubcategory(items).map(([subcategoryId, groupItems]) => (
                              <div key={subcategoryId}>
                                <div className="mb-1.5 flex items-center gap-2 text-[10px] text-text-muted">
                                  <span className="h-px flex-1 bg-white/7" />
                                  <span>
                                    {subcategoryId === '__uncategorized__'
                                      ? t('node.assetMaterial.uncategorized')
                                      : subcategoryNameById.get(subcategoryId) ?? t('node.assetMaterial.uncategorized')}
                                  </span>
                                  <span className="h-px flex-1 bg-white/7" />
                                </div>
                                <div className="flex flex-wrap gap-1.5">
                                  {groupItems.map((item) => {
                                    const isSelected = item.duplicateAssetIds.some((assetId) => selectedIdSet.has(assetId));
                                    const isMatched = matchedNameSet.has(normalizeName(item.name));
                                    return (
                                      <button
                                        key={item.id}
                                        type="button"
                                        className={`inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
                                          isSelected
                                            ? 'border-emerald-400 bg-emerald-400/12 text-emerald-100'
                                            : isMatched
                                              ? 'border-accent/45 bg-accent/10 text-text-dark'
                                              : 'border-white/10 bg-white/7 text-text-dark hover:border-accent/40'
                                        }`}
                                        onClick={(event) => {
                                          event.stopPropagation();
                                          toggleAsset(item);
                                        }}
                                      >
                                        <span className="truncate">@{item.name}</span>
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="px-2 py-3 text-xs text-text-muted">
                            {t('node.assetMaterial.emptyCategory')}
                          </div>
                        )}
                      </div>
                    ) : null}
                  </section>
                );
              })}
            </div>
          ) : (
            <div className="flex h-full items-center justify-center px-4 text-center text-xs text-text-muted">
              {t('node.assetMaterial.empty')}
            </div>
          )}
        </UiScrollArea>
      </div>

      <NodeResizeHandle minWidth={MIN_WIDTH} minHeight={MIN_HEIGHT} maxWidth={MAX_WIDTH} maxHeight={MAX_HEIGHT} isVisible={selected} />
    </div>
  );
});

AssetMaterialNode.displayName = 'AssetMaterialNode';
