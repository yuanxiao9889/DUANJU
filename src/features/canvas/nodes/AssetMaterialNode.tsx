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

  const subcategoryNameById = useMemo(() => {
    const map = new Map<string, string>();
    selectedLibrary?.subcategories.forEach((subcategory) => {
      map.set(subcategory.id, subcategory.name);
    });
    return map;
  }, [selectedLibrary]);

  const itemsByCategory = useMemo(() => {
    const map = new Map<AssetCategory, AssetItemRecord[]>();
    VISIBLE_CATEGORIES.forEach((category) => map.set(category, []));
    selectedLibrary?.items.forEach((item) => {
      if (!VISIBLE_CATEGORIES.includes(item.category) || item.mediaType !== 'image') {
        return;
      }
      map.get(item.category)?.push(item);
    });
    map.forEach((items) => {
      items.sort((left, right) => left.name.localeCompare(right.name, 'zh-Hans-CN'));
    });
    return map;
  }, [selectedLibrary]);

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

  const toggleAsset = useCallback((assetId: string) => {
    const nextIds = selectedIdSet.has(assetId)
      ? data.selectedAssetIds.filter((idValue) => idValue !== assetId)
      : [...data.selectedAssetIds, assetId];
    updateNodeData(id, { selectedAssetIds: nextIds }, { historyMode: 'skip' });
  }, [data.selectedAssetIds, id, selectedIdSet, updateNodeData]);

  const groupedBySubcategory = useCallback((items: AssetItemRecord[]) => {
    const groups = new Map<string, AssetItemRecord[]>();
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
      className={`group relative h-full w-full overflow-visible rounded-[22px] border bg-surface-dark/95 p-1.5 transition-colors ${
        selected
          ? 'border-accent shadow-[0_0_0_1px_rgba(59,130,246,0.34),0_18px_40px_rgba(0,0,0,0.24)]'
          : 'border-[rgba(255,255,255,0.16)] shadow-[0_14px_34px_rgba(0,0,0,0.2)]'
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
        <div className="rounded-2xl border border-white/10 bg-bg-dark/55 p-2">
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
          className="nowheel min-h-0 flex-1 rounded-2xl border border-white/10 bg-[#151515]"
          viewportClassName="h-full"
          contentClassName="p-2"
        >
          {selectedLibrary ? (
            <div className="space-y-2">
              {VISIBLE_CATEGORIES.map((category) => {
                const Icon = getCategoryIcon(category);
                const items = itemsByCategory.get(category) ?? [];
                const isOpen = openCategories.has(category);
                return (
                  <section key={category} className="overflow-hidden rounded-xl border border-white/8 bg-white/[0.025]">
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
                      <div className="border-t border-white/8 px-2 py-2">
                        {items.length > 0 ? (
                          <div className="space-y-2">
                            {groupedBySubcategory(items).map(([subcategoryId, groupItems]) => (
                              <div key={subcategoryId}>
                                <div className="mb-1.5 flex items-center gap-2 text-[10px] text-text-muted">
                                  <span className="h-px flex-1 bg-white/10" />
                                  <span>
                                    {subcategoryId === '__uncategorized__'
                                      ? t('node.assetMaterial.uncategorized')
                                      : subcategoryNameById.get(subcategoryId) ?? t('node.assetMaterial.uncategorized')}
                                  </span>
                                  <span className="h-px flex-1 bg-white/10" />
                                </div>
                                <div className="flex flex-wrap gap-1.5">
                                  {groupItems.map((item) => {
                                    const isSelected = selectedIdSet.has(item.id);
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
                                          toggleAsset(item.id);
                                        }}
                                      >
                                        <span className="rounded bg-white/10 px-1 text-[10px] text-text-muted">
                                          {t(`node.assetMaterial.categoryShort.${category}`)}
                                        </span>
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
