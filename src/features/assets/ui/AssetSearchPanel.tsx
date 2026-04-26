import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AudioLines,
  ChevronDown,
  ChevronRight,
  Grid3x3,
  List,
  MapPin,
  Package,
  Search,
  UserRound,
} from 'lucide-react';

import { UiButton, UiInput, UiLoadingAnimation, UiLoadingBanner, UiPanel, UiSelect } from '@/components/ui';
import type { AssetPanelProjectContext } from '@/features/assets/application/assetPanelBridge';
import {
  ASSET_CATEGORIES,
  type AssetCategory,
  type AssetItemRecord,
  type AssetLibraryRecord,
  type CanvasAssetDragPayload,
  toCanvasAssetDragPayload,
} from '@/features/assets/domain/types';
import { formatAudioDuration, resolveAudioDisplayUrl } from '@/features/canvas/application/audioData';
import { resolveImageDisplayUrl } from '@/features/canvas/application/imageData';
import { useAssetStore } from '@/stores/assetStore';
import { AssetExternalDragHandle } from './AssetExternalDragHandle';

type AssetSearchCategory = AssetCategory | 'all';
type AssetSearchSort = 'updatedAt' | 'name';
type AssetSearchViewMode = 'grid' | 'list';
type AssetSearchCompactPanel = 'library' | 'details';
type ExpandedCategoryState = Record<AssetCategory, boolean>;

const COMPACT_LAYOUT_MEDIA_QUERY = '(max-width: 859px)';

const DEFAULT_EXPANDED_CATEGORIES: ExpandedCategoryState = {
  character: true,
  scene: true,
  prop: true,
  voice: true,
};

interface AssetSearchPanelProps {
  projectContext: AssetPanelProjectContext;
  onChangeLibrary: (libraryId: string | null) => void | Promise<void>;
  onInsertAsset: (payload: CanvasAssetDragPayload) => void | Promise<void>;
  onFocusCanvas: () => void | Promise<void>;
}

function resolveCategoryLabel(
  t: (key: string, options?: Record<string, unknown>) => string,
  category: AssetSearchCategory
) {
  return category === 'all' ? t('assets.all') : t(`assets.categories.${category}`);
}

function resolveCategoryIcon(category: AssetCategory) {
  switch (category) {
    case 'character':
      return <UserRound className="h-4 w-4" />;
    case 'scene':
      return <MapPin className="h-4 w-4" />;
    case 'prop':
      return <Package className="h-4 w-4" />;
    case 'voice':
      return <AudioLines className="h-4 w-4" />;
  }
}

function resolveCategorySummary(
  library: AssetLibraryRecord | null,
  category: AssetSearchCategory
): AssetItemRecord[] {
  const items = library?.items ?? [];
  if (category === 'all') {
    return items;
  }

  return items.filter((item) => item.category === category);
}

function formatUpdatedAt(timestamp: number, locale: string) {
  return new Intl.DateTimeFormat(locale, {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(timestamp));
}

export function AssetSearchPanel({
  projectContext,
  onChangeLibrary,
  onInsertAsset,
  onFocusCanvas,
}: AssetSearchPanelProps) {
  const { t, i18n } = useTranslation();
  const hydrate = useAssetStore((state) => state.hydrate);
  const libraries = useAssetStore((state) => state.libraries);
  const isLoading = useAssetStore((state) => state.isLoading);

  const [activeCategory, setActiveCategory] = useState<AssetSearchCategory>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSubcategoryId, setSelectedSubcategoryId] = useState('');
  const [selectedTag, setSelectedTag] = useState('');
  const [sortBy, setSortBy] = useState<AssetSearchSort>('updatedAt');
  const [viewMode, setViewMode] = useState<AssetSearchViewMode>('list');
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const [lastInsertedAssetId, setLastInsertedAssetId] = useState<string | null>(null);
  const [compactPanel, setCompactPanel] = useState<AssetSearchCompactPanel>('library');
  const [isCompactLayout, setIsCompactLayout] = useState(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return false;
    }

    return window.matchMedia(COMPACT_LAYOUT_MEDIA_QUERY).matches;
  });
  const [expandedCategories, setExpandedCategories] = useState<ExpandedCategoryState>(
    DEFAULT_EXPANDED_CATEGORIES
  );

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }

    const mediaQuery = window.matchMedia(COMPACT_LAYOUT_MEDIA_QUERY);
    const syncCompactLayout = () => {
      setIsCompactLayout(mediaQuery.matches);
    };

    syncCompactLayout();

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', syncCompactLayout);
      return () => mediaQuery.removeEventListener('change', syncCompactLayout);
    }

    mediaQuery.addListener(syncCompactLayout);
    return () => mediaQuery.removeListener(syncCompactLayout);
  }, []);

  const hasStoryboardProject =
    projectContext.projectType === 'storyboard' && Boolean(projectContext.projectId);
  const selectedLibrary =
    libraries.find((library) => library.id === projectContext.assetLibraryId) ?? null;

  useEffect(() => {
    setActiveCategory('all');
    setSearchQuery('');
    setSelectedSubcategoryId('');
    setSelectedTag('');
    setSelectedAssetId(null);
    setCompactPanel('library');
    setExpandedCategories(DEFAULT_EXPANDED_CATEGORIES);
  }, [projectContext.assetLibraryId]);

  const categoryStats = useMemo(
    () =>
      Object.fromEntries(
        ASSET_CATEGORIES.map((category) => [
          category,
          selectedLibrary?.items.filter((item) => item.category === category).length ?? 0,
        ])
      ) as Record<AssetCategory, number>,
    [selectedLibrary]
  );

  const categoryItems = useMemo(
    () => resolveCategorySummary(selectedLibrary, activeCategory),
    [activeCategory, selectedLibrary]
  );

  const subcategoriesByCategory = useMemo(
    () =>
      Object.fromEntries(
        ASSET_CATEGORIES.map((category) => [
          category,
          (selectedLibrary?.subcategories ?? []).filter(
            (subcategory) => subcategory.category === category
          ),
        ])
      ) as Record<AssetCategory, AssetLibraryRecord['subcategories']>,
    [selectedLibrary]
  );

  const tags = useMemo(
    () =>
      Array.from(new Set(categoryItems.flatMap((item) => item.tags))).sort((left, right) =>
        left.localeCompare(right, 'zh-Hans-CN', { sensitivity: 'base' })
      ),
    [categoryItems]
  );

  const filteredItems = useMemo(() => {
    const normalizedSearch = searchQuery.trim().toLowerCase();
    const nextItems = categoryItems.filter((item) => {
      if (selectedSubcategoryId && item.subcategoryId !== selectedSubcategoryId) {
        return false;
      }

      if (selectedTag && !item.tags.includes(selectedTag)) {
        return false;
      }

      if (!normalizedSearch) {
        return true;
      }

      return [item.name, item.description, ...item.tags].join(' ').toLowerCase().includes(
        normalizedSearch
      );
    });

    nextItems.sort((left, right) => {
      if (sortBy === 'name') {
        return left.name.localeCompare(right.name, 'zh-Hans-CN', { sensitivity: 'base' });
      }

      return right.updatedAt - left.updatedAt;
    });

    return nextItems;
  }, [categoryItems, searchQuery, selectedSubcategoryId, selectedTag, sortBy]);

  useEffect(() => {
    if (!selectedSubcategoryId) {
      return;
    }

    const subcategoryExists = (selectedLibrary?.subcategories ?? []).some(
      (subcategory) => subcategory.id === selectedSubcategoryId
    );
    if (!subcategoryExists) {
      setSelectedSubcategoryId('');
    }
  }, [selectedLibrary, selectedSubcategoryId]);

  useEffect(() => {
    if (!selectedTag) {
      return;
    }

    if (!tags.includes(selectedTag)) {
      setSelectedTag('');
    }
  }, [selectedTag, tags]);

  useEffect(() => {
    if (filteredItems.length === 0) {
      setSelectedAssetId(null);
      return;
    }

    if (!selectedAssetId || !filteredItems.some((item) => item.id === selectedAssetId)) {
      setSelectedAssetId(filteredItems[0].id);
    }
  }, [filteredItems, selectedAssetId]);

  useEffect(() => {
    if (!lastInsertedAssetId) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setLastInsertedAssetId(null);
    }, 1400);

    return () => window.clearTimeout(timeoutId);
  }, [lastInsertedAssetId]);

  const selectedAsset =
    filteredItems.find((item) => item.id === selectedAssetId)
    ?? filteredItems[0]
    ?? null;
  const activeFilterCount =
    Number(searchQuery.trim().length > 0)
    + Number(selectedSubcategoryId.length > 0)
    + Number(selectedTag.length > 0);

  const handleInsertAsset = (item: AssetItemRecord) => {
    onInsertAsset(toCanvasAssetDragPayload(item));
    setSelectedAssetId(item.id);
    setLastInsertedAssetId(item.id);
  };

  const handleSelectAsset = (assetId: string) => {
    setSelectedAssetId(assetId);

    if (isCompactLayout) {
      setCompactPanel('details');
    }
  };

  const handleSelectAllAssets = () => {
    setActiveCategory('all');
    setSelectedSubcategoryId('');
    setSelectedTag('');
  };

  const handleSelectCategory = (category: AssetCategory) => {
    setActiveCategory(category);
    setSelectedSubcategoryId('');
    setSelectedTag('');
    setExpandedCategories((current) => ({
      ...current,
      [category]: true,
    }));
  };

  const handleSelectSubcategory = (category: AssetCategory, subcategoryId: string) => {
    setActiveCategory(category);
    setSelectedSubcategoryId(subcategoryId);
    setSelectedTag('');
    setExpandedCategories((current) => ({
      ...current,
      [category]: true,
    }));
  };

  const handleToggleCategoryExpanded = (category: AssetCategory) => {
    setExpandedCategories((current) => ({
      ...current,
      [category]: !current[category],
    }));
  };

  const libraryPanel = (
    <UiPanel className="flex h-full min-h-0 flex-col !rounded-2xl p-4">
      <div className="space-y-4">
        <div>
          <label className="mb-1.5 block text-xs font-medium uppercase tracking-[0.14em] text-text-muted/80">
            {t('assets.library')}
          </label>
          <UiSelect
            value={projectContext.assetLibraryId ?? ''}
            onChange={(event) => onChangeLibrary(event.target.value.trim() || null)}
            className="h-11 text-sm"
          >
            <option value="">{t('assets.selectLibrary')}</option>
            {libraries.map((library) => (
              <option key={library.id} value={library.id}>
                {library.name}
              </option>
            ))}
          </UiSelect>
        </div>

        {selectedLibrary ? (
          <div className="rounded-2xl border border-[rgba(255,255,255,0.08)] bg-white/[0.03] p-3">
            <div className="text-sm font-semibold text-text-dark">{selectedLibrary.name}</div>
            <div className="mt-1 text-xs text-text-muted">
              {t('assets.libraryMeta', {
                count: selectedLibrary.items.length,
                updatedAt: formatUpdatedAt(selectedLibrary.updatedAt, i18n.language),
              })}
            </div>
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-[rgba(255,255,255,0.12)] px-3 py-4 text-xs leading-5 text-text-muted">
            {libraries.length === 0 ? t('assets.emptyHint') : t('assets.selectLibraryToBrowseHint')}
          </div>
        )}
      </div>

      <div className="mt-4 space-y-2 overflow-y-auto pr-1 max-[859px]:max-h-[34vh]">
        <button
          type="button"
          disabled={!selectedLibrary}
          className={`flex w-full items-center justify-between rounded-xl border px-3 py-2.5 text-left transition-colors ${
            activeCategory === 'all' && !selectedSubcategoryId
              ? 'border-accent/35 bg-accent/12 text-text-dark'
              : 'border-[rgba(255,255,255,0.08)] bg-white/[0.03] text-text-muted hover:text-text-dark'
          } ${!selectedLibrary ? 'cursor-not-allowed opacity-45' : ''}`}
          onClick={handleSelectAllAssets}
        >
          <span className="text-sm font-medium">{resolveCategoryLabel(t, 'all')}</span>
          <span className="text-xs">{selectedLibrary?.items.length ?? 0}</span>
        </button>

        <div className="space-y-1">
          {ASSET_CATEGORIES.map((category) => {
            const categorySubcategories = subcategoriesByCategory[category];
            const isExpanded = expandedCategories[category];
            const isCategorySelected =
              activeCategory === category && !selectedSubcategoryId;

            return (
              <div
                key={category}
                className="rounded-xl border border-[rgba(255,255,255,0.08)] bg-white/[0.03]"
              >
                <div
                  className={`flex items-center gap-1 px-2 py-1.5 ${
                    !selectedLibrary ? 'opacity-45' : ''
                  }`}
                >
                  <button
                    type="button"
                    disabled={!selectedLibrary}
                    className="rounded-lg p-1.5 text-text-muted transition-colors hover:bg-white/[0.06] hover:text-text-dark disabled:cursor-not-allowed"
                    onClick={() => handleToggleCategoryExpanded(category)}
                    title={isExpanded ? t('common.close') : t('assets.expandTree')}
                  >
                    {isExpanded ? (
                      <ChevronDown className="h-4 w-4" />
                    ) : (
                      <ChevronRight className="h-4 w-4" />
                    )}
                  </button>
                  <button
                    type="button"
                    disabled={!selectedLibrary}
                    className={`flex min-w-0 flex-1 items-center justify-between rounded-lg px-2 py-2 text-left transition-colors ${
                      isCategorySelected
                        ? 'bg-accent/12 text-text-dark'
                        : 'text-text-muted hover:bg-white/[0.04] hover:text-text-dark'
                    } disabled:cursor-not-allowed`}
                    onClick={() => handleSelectCategory(category)}
                  >
                    <span className="flex min-w-0 items-center gap-2 text-sm font-medium">
                      {resolveCategoryIcon(category)}
                      <span className="truncate">{resolveCategoryLabel(t, category)}</span>
                    </span>
                    <span className="ml-3 text-xs">{categoryStats[category]}</span>
                  </button>
                </div>

                {selectedLibrary && isExpanded && categorySubcategories.length > 0 ? (
                  <div className="space-y-1 pb-2 pl-9 pr-2">
                    {categorySubcategories.map((subcategory) => {
                      const subcategoryCount = selectedLibrary.items.filter(
                        (item) => item.subcategoryId === subcategory.id
                      ).length;
                      const isSubcategorySelected =
                        activeCategory === category
                        && selectedSubcategoryId === subcategory.id;

                      return (
                        <button
                          key={subcategory.id}
                          type="button"
                          className={`flex w-full items-center justify-between rounded-lg px-2 py-2 text-left text-sm transition-colors ${
                            isSubcategorySelected
                              ? 'bg-accent/12 text-accent'
                              : 'text-text-muted hover:bg-white/[0.04] hover:text-text-dark'
                          }`}
                          onClick={() => handleSelectSubcategory(category, subcategory.id)}
                        >
                          <span className="truncate">{subcategory.name}</span>
                          <span className="ml-3 text-[11px]">{subcategoryCount}</span>
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>

        {tags.length > 0 ? (
          <div className="pt-4">
            <div className="mb-2 text-xs font-medium uppercase tracking-[0.16em] text-text-muted/75">
              {t('assets.tags')}
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                  !selectedTag
                    ? 'border-accent/30 bg-accent/12 text-accent'
                    : 'border-[rgba(255,255,255,0.08)] bg-white/[0.03] text-text-muted hover:text-text-dark'
                }`}
                onClick={() => setSelectedTag('')}
              >
                {t('assets.allTags')}
              </button>
              {tags.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                    selectedTag === tag
                      ? 'border-accent/30 bg-accent/12 text-accent'
                      : 'border-[rgba(255,255,255,0.08)] bg-white/[0.03] text-text-muted hover:text-text-dark'
                  }`}
                  onClick={() => setSelectedTag((current) => (current === tag ? '' : tag))}
                >
                  {tag}
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </UiPanel>
  );

  const resultsPanel = (
    <UiPanel className={`flex h-full min-h-0 flex-col !rounded-2xl p-4 ${isCompactLayout ? 'flex-1' : ''}`}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3 max-[859px]:items-stretch">
        <div>
          {selectedLibrary ? (
            <div className="text-sm font-semibold text-text-dark">
              {t('assets.filteredCount', {
                shown: filteredItems.length,
                total: categoryItems.length,
              })}
            </div>
          ) : isLoading ? (
            <UiLoadingAnimation size="sm" />
          ) : (
            <div className="text-sm font-semibold text-text-dark">
              {libraries.length === 0
                ? t('assets.emptyTitle')
                : t('assets.selectLibraryToBrowse')}
            </div>
          )}
          <div className="text-xs text-text-muted">
            {selectedLibrary
              ? t('assets.doubleClickOrDragOut')
              : libraries.length === 0
                ? t('assets.emptyHint')
                : t('assets.selectLibraryToBrowseHint')}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 max-[859px]:w-full">
          {activeFilterCount > 0 ? (
            <UiButton
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setSearchQuery('');
                setSelectedSubcategoryId('');
                setSelectedTag('');
              }}
            >
              {t('assets.clearFilters')}
            </UiButton>
          ) : null}

          <UiSelect
            aria-label={t('assets.sortLabel')}
            value={sortBy}
            disabled={!selectedLibrary}
            onChange={(event) => setSortBy(event.target.value as AssetSearchSort)}
            className="h-10 min-w-[156px] flex-1 text-sm disabled:cursor-not-allowed"
          >
            <option value="updatedAt">{t('assets.sortUpdated')}</option>
            <option value="name">{t('assets.sortName')}</option>
          </UiSelect>

          <div className="flex items-center gap-1 rounded-xl border border-[rgba(255,255,255,0.08)] bg-white/[0.03] p-1">
            <button
              type="button"
              disabled={!selectedLibrary}
              className={`rounded-lg p-2 transition-colors ${
                viewMode === 'list'
                  ? 'bg-white/[0.1] text-text-dark'
                  : 'text-text-muted hover:text-text-dark'
              } disabled:cursor-not-allowed disabled:opacity-45`}
              onClick={() => setViewMode('list')}
              title={t('assets.viewList')}
            >
              <List className="h-4 w-4" />
            </button>
            <button
              type="button"
              disabled={!selectedLibrary}
              className={`rounded-lg p-2 transition-colors ${
                viewMode === 'grid'
                  ? 'bg-white/[0.1] text-text-dark'
                  : 'text-text-muted hover:text-text-dark'
              } disabled:cursor-not-allowed disabled:opacity-45`}
              onClick={() => setViewMode('grid')}
              title={t('assets.viewGrid')}
            >
              <Grid3x3 className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {!selectedLibrary ? (
        <div className="flex flex-1 items-center justify-center rounded-2xl border border-dashed border-[rgba(255,255,255,0.12)] px-6 py-10 text-center">
          {isLoading ? (
            <UiLoadingBanner />
          ) : (
            <div className="max-w-md space-y-2">
              <div className="text-lg font-semibold text-text-dark">
                {libraries.length === 0
                  ? t('assets.emptyTitle')
                  : t('assets.selectLibraryToBrowse')}
              </div>
              <p className="text-sm text-text-muted">
                {libraries.length === 0
                  ? t('assets.emptyHint')
                  : t('assets.selectLibraryToBrowseHint')}
              </p>
            </div>
          )}
        </div>
      ) : isLoading && selectedLibrary.items.length === 0 ? (
        <div className="flex flex-1 items-center justify-center">
          <UiLoadingBanner />
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="flex flex-1 items-center justify-center rounded-2xl border border-dashed border-[rgba(255,255,255,0.12)] text-sm text-text-muted">
          {t(activeFilterCount > 0 ? 'assets.emptyFilterResult' : 'assets.emptyAssets')}
        </div>
      ) : viewMode === 'grid' ? (
        <div className="ui-scrollbar min-h-0 flex-1 overflow-y-auto pr-1">
          <div className={`gap-3 ${isCompactLayout ? 'columns-1' : 'columns-2 2xl:columns-3'}`}>
            {filteredItems.map((item) => {
              const isSelected = item.id === selectedAsset?.id;
              return (
                <div key={item.id} className="mb-3 break-inside-avoid">
                  <button
                    type="button"
                    className={`group block w-full overflow-hidden rounded-2xl border text-left transition-all ${
                      isSelected
                        ? 'border-accent/35 bg-accent/[0.05] shadow-[0_0_0_1px_rgba(var(--accent-rgb),0.16)]'
                        : 'border-[rgba(255,255,255,0.08)] bg-white/[0.03] hover:border-[rgba(255,255,255,0.14)]'
                    }`}
                    onClick={() => handleSelectAsset(item.id)}
                    onDoubleClick={() => handleInsertAsset(item)}
                  >
                    <div className="overflow-hidden bg-bg-dark/70">
                      {item.mediaType === 'audio' ? (
                        <div className="flex min-h-[132px] flex-col justify-between p-3">
                          <AudioLines className="h-6 w-6 text-rose-300" />
                          <div>
                            <div className="truncate text-sm font-medium text-text-dark">
                              {item.name}
                            </div>
                            <div className="text-xs text-text-muted">
                              {formatAudioDuration(item.durationMs ? item.durationMs / 1000 : null)}
                            </div>
                          </div>
                        </div>
                      ) : (
                        <img
                          src={resolveImageDisplayUrl(item.previewPath || item.sourcePath)}
                          alt={item.name}
                          className="block h-auto max-h-[420px] w-full transition-transform duration-200 group-hover:scale-[1.03]"
                        />
                      )}
                    </div>
                    <div className="space-y-1 border-t border-[rgba(255,255,255,0.08)] px-3 py-2">
                      <div className="flex items-start gap-2">
                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="truncate text-sm font-medium text-text-dark">
                            {item.name}
                          </div>
                          <div className="truncate text-xs text-text-muted">
                            {resolveCategoryLabel(t, item.category)}
                          </div>
                        </div>
                        <AssetExternalDragHandle
                          item={item}
                          className="inline-flex h-8 w-8 shrink-0 cursor-grab items-center justify-center rounded-lg border border-[rgba(255,255,255,0.08)] bg-white/[0.03] text-text-muted transition-colors hover:text-text-dark active:cursor-grabbing"
                        />
                      </div>
                    </div>
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="ui-scrollbar flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-1">
          {filteredItems.map((item) => {
            const isSelected = item.id === selectedAsset?.id;
            return (
              <button
                key={item.id}
                type="button"
                className={`flex items-center gap-3 rounded-2xl border px-3 py-3 text-left transition-all ${
                  isSelected
                    ? 'border-accent/35 bg-accent/[0.05] shadow-[0_0_0_1px_rgba(var(--accent-rgb),0.16)]'
                    : 'border-[rgba(255,255,255,0.08)] bg-white/[0.03] hover:border-[rgba(255,255,255,0.14)]'
                }`}
                onClick={() => handleSelectAsset(item.id)}
                onDoubleClick={() => handleInsertAsset(item)}
              >
                <div className="h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-bg-dark/70">
                  {item.mediaType === 'audio' ? (
                    <div className="flex h-full items-center justify-center text-rose-300">
                      <AudioLines className="h-6 w-6" />
                    </div>
                  ) : (
                    <img
                      src={resolveImageDisplayUrl(item.previewPath || item.sourcePath)}
                      alt={item.name}
                      className="h-full w-full object-cover"
                    />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-3">
                    <div className="truncate text-sm font-medium text-text-dark">{item.name}</div>
                    <div className="flex shrink-0 items-center gap-2">
                      <div className="text-xs text-text-muted">
                        {formatUpdatedAt(item.updatedAt, i18n.language)}
                      </div>
                      <AssetExternalDragHandle
                        item={item}
                        className="inline-flex h-8 w-8 cursor-grab items-center justify-center rounded-lg border border-[rgba(255,255,255,0.08)] bg-white/[0.03] text-text-muted transition-colors hover:text-text-dark active:cursor-grabbing"
                      />
                    </div>
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-xs text-text-muted">
                    <span>{resolveCategoryLabel(t, item.category)}</span>
                    {item.mediaType === 'audio' ? (
                      <span>
                        {formatAudioDuration(item.durationMs ? item.durationMs / 1000 : null)}
                      </span>
                    ) : null}
                  </div>
                  {item.description ? (
                    <div className="mt-2 max-h-10 overflow-hidden text-xs text-text-muted">
                      {item.description}
                    </div>
                  ) : null}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </UiPanel>
  );

  const detailsPanel = (
    <UiPanel className="flex h-full min-h-0 flex-col !rounded-2xl p-4">
      {!selectedLibrary ? (
        <div className="flex flex-1 items-center justify-center text-center text-sm text-text-muted">
          {libraries.length === 0 ? t('assets.emptyHint') : t('assets.selectLibraryToBrowseHint')}
        </div>
      ) : selectedAsset ? (
        <>
          <div className="overflow-hidden rounded-2xl border border-[rgba(255,255,255,0.08)] bg-bg-dark/70">
            <div className="aspect-[16/10] min-[1360px]:aspect-[4/3]">
              {selectedAsset.mediaType === 'audio' ? (
                <div className="flex h-full flex-col justify-between p-5">
                  <AudioLines className="h-8 w-8 text-rose-300" />
                  <div>
                    <div className="text-lg font-semibold text-text-dark">
                      {selectedAsset.name}
                    </div>
                    <div className="mt-1 text-sm text-text-muted">
                      {formatAudioDuration(
                        selectedAsset.durationMs ? selectedAsset.durationMs / 1000 : null
                      )}
                    </div>
                    <audio
                      controls
                      src={resolveAudioDisplayUrl(selectedAsset.sourcePath)}
                      className="mt-4 h-10 w-full"
                    />
                  </div>
                </div>
              ) : (
                <img
                  src={resolveImageDisplayUrl(
                    selectedAsset.previewPath || selectedAsset.sourcePath
                  )}
                  alt={selectedAsset.name}
                  className="h-full w-full object-cover"
                />
              )}
            </div>
          </div>

          <div className="mt-4 space-y-3 overflow-y-auto pr-1 max-[859px]:max-h-[40vh]">
            <div>
              <div className="text-lg font-semibold text-text-dark">
                {selectedAsset.name}
              </div>
              <div className="mt-1 text-sm text-text-muted">
                {resolveCategoryLabel(t, selectedAsset.category)}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <UiButton
                type="button"
                variant="primary"
                className="min-w-0 flex-1"
                onClick={() => handleInsertAsset(selectedAsset)}
              >
                {lastInsertedAssetId === selectedAsset.id
                  ? t('assets.insertedToCanvas')
                  : t('assets.insertToCanvas')}
              </UiButton>
              <AssetExternalDragHandle
                item={selectedAsset}
                showLabel
                className="inline-flex h-11 shrink-0 cursor-grab items-center gap-2 rounded-xl border border-[rgba(255,255,255,0.08)] bg-white/[0.03] px-3 text-sm font-medium text-text-muted transition-colors hover:text-text-dark active:cursor-grabbing"
              />
            </div>

            <div className="rounded-2xl border border-[rgba(255,255,255,0.08)] bg-white/[0.03] p-4">
              <div className="mb-2 text-xs font-medium uppercase tracking-[0.16em] text-text-muted/75">
                {t('assets.description')}
              </div>
              <div className="text-sm leading-6 text-text-muted">
                {selectedAsset.description || t('assets.emptyDescription')}
              </div>
            </div>

            <div className="rounded-2xl border border-[rgba(255,255,255,0.08)] bg-white/[0.03] p-4">
              <div className="mb-2 text-xs font-medium uppercase tracking-[0.16em] text-text-muted/75">
                {t('assets.tags')}
              </div>
              {selectedAsset.tags.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {selectedAsset.tags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded-full border border-[rgba(255,255,255,0.08)] bg-white/[0.04] px-2.5 py-1 text-xs text-text-muted"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              ) : (
                <div className="text-sm text-text-muted">{t('assets.emptyDescription')}</div>
              )}
            </div>
          </div>
        </>
      ) : (
        <div className="flex flex-1 items-center justify-center text-center text-sm text-text-muted">
          {t('assets.emptyAssets')}
        </div>
      )}
    </UiPanel>
  );

  const compactPanelSwitcher = (
    <UiPanel className="shrink-0 !rounded-2xl p-2">
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          className={`rounded-xl px-3 py-2 text-sm font-medium transition-colors ${
            compactPanel === 'library'
              ? 'bg-accent text-white'
              : 'bg-white/[0.03] text-text-muted hover:text-text-dark'
          }`}
          onClick={() => setCompactPanel('library')}
        >
          {t('assets.compactShowLibrary')}
        </button>
        <button
          type="button"
          className={`rounded-xl px-3 py-2 text-sm font-medium transition-colors ${
            compactPanel === 'details'
              ? 'bg-accent text-white'
              : 'bg-white/[0.03] text-text-muted hover:text-text-dark'
          }`}
          onClick={() => setCompactPanel('details')}
        >
          {t('assets.compactShowDetails')}
        </button>
      </div>
    </UiPanel>
  );

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      {!hasStoryboardProject ? (
        <UiPanel className="flex flex-1 items-center justify-center !rounded-2xl border-dashed px-6 py-10 text-center">
          <div className="max-w-md space-y-2">
            <div className="text-lg font-semibold text-text-dark">
              {t('assets.noStoryboardProject')}
            </div>
            <p className="text-sm text-text-muted">{t('assets.noStoryboardProjectHint')}</p>
            <div className="pt-2">
              <UiButton type="button" variant="primary" onClick={onFocusCanvas}>
                {t('assets.focusCanvas')}
              </UiButton>
            </div>
          </div>
        </UiPanel>
      ) : (
        <>
          <UiPanel className="!rounded-2xl p-4">
            <div className="relative">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
              <UiInput
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder={t('assets.searchPlaceholder')}
                className="h-12 w-full pl-10 text-sm"
              />
            </div>
          </UiPanel>

          {isCompactLayout ? (
            <div className="flex min-h-0 flex-1 flex-col gap-4">
              {compactPanelSwitcher}
              <div className="shrink-0">
                {compactPanel === 'library' ? libraryPanel : detailsPanel}
              </div>
              {resultsPanel}
            </div>
          ) : (
            <div className="grid flex-1 min-h-0 gap-4 min-[860px]:grid-cols-[220px_minmax(0,1fr)] min-[860px]:grid-rows-[minmax(0,1fr)_minmax(0,1fr)] min-[1360px]:grid-cols-[220px_minmax(0,1fr)_320px] min-[1360px]:grid-rows-1 2xl:grid-cols-[240px_minmax(0,1fr)_340px]">
              <div className="min-h-0 min-[860px]:row-span-2 min-[1360px]:row-span-1">
                {libraryPanel}
              </div>
              {resultsPanel}
              {detailsPanel}
            </div>
          )}
        </>
      )}
    </div>
  );
}
