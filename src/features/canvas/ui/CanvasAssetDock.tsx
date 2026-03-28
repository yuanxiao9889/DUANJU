import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronUp, MapPin, Package, Search, UserRound, X } from 'lucide-react';

import { UiButton, UiInput, UiSelect } from '@/components/ui';
import {
  ASSET_CATEGORIES,
  ASSET_DRAG_MIME_TYPE,
  type AssetCategory,
  type AssetLibraryRecord,
  serializeAssetDragPayload,
} from '@/features/assets/domain/types';
import { resolveImageDisplayUrl } from '@/features/canvas/application/imageData';
import { useAssetStore } from '@/stores/assetStore';
import { useProjectStore } from '@/stores/projectStore';

function resolveCategoryLabel(t: (key: string) => string, category: AssetCategory): string {
  return t(`assets.categories.${category}`);
}

function resolveCategoryIcon(category: AssetCategory) {
  switch (category) {
    case 'character':
      return <UserRound className="h-4 w-4" />;
    case 'scene':
      return <MapPin className="h-4 w-4" />;
    case 'prop':
      return <Package className="h-4 w-4" />;
  }
}

function resolvePreferredCategory(library: AssetLibraryRecord | null): AssetCategory | null {
  if (!library) {
    return null;
  }

  for (const category of ASSET_CATEGORIES) {
    if (library.items.some((item) => item.category === category)) {
      return category;
    }
  }

  return null;
}

export function CanvasAssetDock() {
  const { t } = useTranslation();
  const hydrate = useAssetStore((state) => state.hydrate);
  const libraries = useAssetStore((state) => state.libraries);
  const projectType = useProjectStore((state) => state.currentProject?.projectType ?? null);
  const assetLibraryId = useProjectStore((state) => state.currentProject?.assetLibraryId ?? null);
  const setCurrentProjectAssetLibrary = useProjectStore(
    (state) => state.setCurrentProjectAssetLibrary
  );

  const [activeCategory, setActiveCategory] = useState<AssetCategory | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSubcategoryId, setSelectedSubcategoryId] = useState<string>('');
  const [selectedTag, setSelectedTag] = useState<string>('');
  const [draggingAssetId, setDraggingAssetId] = useState<string | null>(null);
  const resolvedLibraryIdRef = useRef<string | null>(null);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  const selectedLibrary = libraries.find((library) => library.id === assetLibraryId) ?? null;

  useEffect(() => {
    setSelectedSubcategoryId('');
    setSelectedTag('');
    setSearchQuery('');
  }, [activeCategory, assetLibraryId]);

  useEffect(() => {
    if (!assetLibraryId) {
      return;
    }

    if (!libraries.some((library) => library.id === assetLibraryId)) {
      setCurrentProjectAssetLibrary(null);
    }
  }, [assetLibraryId, libraries, setCurrentProjectAssetLibrary]);

  useEffect(() => {
    const resolvedLibraryId = selectedLibrary?.id ?? null;
    if (resolvedLibraryId === resolvedLibraryIdRef.current) {
      return;
    }

    resolvedLibraryIdRef.current = resolvedLibraryId;
    setActiveCategory(resolvePreferredCategory(selectedLibrary));
  }, [selectedLibrary]);

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

  const subcategories = useMemo(() => {
    if (!selectedLibrary || !activeCategory) {
      return [];
    }

    return selectedLibrary.subcategories.filter(
      (subcategory) => subcategory.category === activeCategory
    );
  }, [activeCategory, selectedLibrary]);

  const tags = useMemo(() => {
    if (!selectedLibrary || !activeCategory) {
      return [];
    }

    return Array.from(
      new Set(
        selectedLibrary.items
          .filter((item) => item.category === activeCategory)
          .flatMap((item) => item.tags)
      )
    ).sort((left, right) => left.localeCompare(right, 'zh-Hans-CN', { sensitivity: 'base' }));
  }, [activeCategory, selectedLibrary]);

  const filteredItems = useMemo(() => {
    if (!selectedLibrary || !activeCategory) {
      return [];
    }

    const normalizedSearch = searchQuery.trim().toLowerCase();
    return selectedLibrary.items.filter((item) => {
      if (item.category !== activeCategory) {
        return false;
      }

      if (selectedSubcategoryId && item.subcategoryId !== selectedSubcategoryId) {
        return false;
      }

      if (selectedTag && !item.tags.includes(selectedTag)) {
        return false;
      }

      if (!normalizedSearch) {
        return true;
      }

      return [item.name, item.description, ...item.tags]
        .join(' ')
        .toLowerCase()
        .includes(normalizedSearch);
    });
  }, [activeCategory, searchQuery, selectedLibrary, selectedSubcategoryId, selectedTag]);

  const activeFilterCount = useMemo(
    () =>
      Number(searchQuery.trim().length > 0)
      + Number(selectedSubcategoryId.length > 0)
      + Number(selectedTag.length > 0),
    [searchQuery, selectedSubcategoryId, selectedTag]
  );

  const isExpanded = Boolean(activeCategory && selectedLibrary);

  if (projectType !== 'storyboard') {
    return null;
  }

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-4 z-[10010] flex justify-center px-4">
      <div
        className={`pointer-events-auto relative ${
          isExpanded ? 'w-full max-w-[760px]' : 'w-fit max-w-[calc(100vw-2rem)]'
        }`}
      >
        {isExpanded ? (
          <button
            type="button"
            className="absolute left-1/2 top-0 z-20 flex h-6 w-6 -translate-x-1/2 -translate-y-[calc(100%+2px)] items-center justify-center rounded-full border border-[rgba(255,255,255,0.14)] bg-surface-dark text-text-muted shadow-lg transition-colors hover:bg-white/[0.06] hover:text-text-dark"
            onClick={() => setActiveCategory(null)}
            title={t('common.close')}
          >
            <ChevronUp className="h-3.5 w-3.5" />
          </button>
        ) : null}

        <div className="rounded-lg border border-[rgba(255,255,255,0.12)] bg-surface-dark/92 p-3 shadow-[0_18px_40px_rgba(0,0,0,0.28)] backdrop-blur-md">
          <div className="flex flex-wrap items-center gap-2">
            <div className="w-[220px] shrink-0 sm:w-[240px]">
              <UiSelect
                aria-label={t('assets.library')}
                value={assetLibraryId ?? ''}
                onChange={(event) =>
                  setCurrentProjectAssetLibrary(event.target.value.trim() || null)
                }
                className="h-10 text-sm"
              >
                <option value="">{t('assets.selectLibrary')}</option>
                {libraries.map((library) => (
                  <option key={library.id} value={library.id}>
                    {library.name}
                  </option>
                ))}
              </UiSelect>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              {ASSET_CATEGORIES.map((category) => {
                const isActive = activeCategory === category;
                return (
                  <UiButton
                    key={category}
                    type="button"
                    variant={isActive ? 'primary' : 'ghost'}
                    size="sm"
                    className={`gap-1.5 rounded-xl px-2.5 ${
                      !selectedLibrary ? 'opacity-45' : ''
                    }`}
                    disabled={!selectedLibrary}
                    onClick={() =>
                      setActiveCategory((current) => (current === category ? null : category))
                    }
                  >
                    {resolveCategoryIcon(category)}
                    <span>{resolveCategoryLabel(t, category)}</span>
                    <span
                      className={`rounded-full px-1.5 py-0.5 text-[10px] leading-none ${
                        isActive ? 'bg-black/15 text-white' : 'bg-black/10 text-text-muted'
                      }`}
                    >
                      {categoryStats[category]}
                    </span>
                  </UiButton>
                );
              })}
            </div>
          </div>

          {activeCategory && selectedLibrary ? (
            <div className="mt-2 overflow-hidden rounded-lg border border-[rgba(255,255,255,0.08)] bg-bg-dark/35 p-3">
              <div className="space-y-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative min-w-[220px] flex-1">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
                    <UiInput
                      value={searchQuery}
                      onChange={(event) => setSearchQuery(event.target.value)}
                      placeholder={t('assets.searchPlaceholder')}
                      className="pl-9"
                    />
                  </div>
                  {activeFilterCount > 0 ? (
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 rounded-full border border-[rgba(255,255,255,0.08)] bg-white/[0.03] px-2.5 py-1.5 text-xs text-text-muted transition-colors hover:bg-white/[0.08] hover:text-text-dark"
                      onClick={() => {
                        setSearchQuery('');
                        setSelectedSubcategoryId('');
                        setSelectedTag('');
                      }}
                    >
                      <X className="h-3 w-3" />
                      {t('assets.clearFilters')}
                    </button>
                  ) : null}
                </div>

                <div className="space-y-2">
                  <div className="flex items-start gap-2">
                    <span className="shrink-0 pt-1 text-[10px] uppercase tracking-[0.18em] text-text-muted/70">
                      {t('assets.subcategories')}
                    </span>
                    <div className="ui-scrollbar flex min-w-0 flex-1 gap-2 overflow-x-auto pb-1">
                      <button
                        type="button"
                        className={`whitespace-nowrap rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
                          !selectedSubcategoryId
                            ? 'border-accent/30 bg-accent/12 text-accent'
                            : 'border-transparent bg-white/[0.03] text-text-muted hover:border-[rgba(255,255,255,0.1)] hover:bg-white/[0.06] hover:text-text-dark'
                        }`}
                        onClick={() => setSelectedSubcategoryId('')}
                      >
                        {t('assets.allSubcategories')}
                      </button>
                      {subcategories.map((subcategory) => (
                        <button
                          key={subcategory.id}
                          type="button"
                          className={`whitespace-nowrap rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
                            selectedSubcategoryId === subcategory.id
                              ? 'border-accent/30 bg-accent/12 text-accent'
                              : 'border-transparent bg-white/[0.03] text-text-muted hover:border-[rgba(255,255,255,0.1)] hover:bg-white/[0.06] hover:text-text-dark'
                          }`}
                          onClick={() =>
                            setSelectedSubcategoryId((current) =>
                              current === subcategory.id ? '' : subcategory.id
                            )
                          }
                        >
                          {subcategory.name}
                        </button>
                      ))}
                    </div>
                  </div>

                  {tags.length > 0 ? (
                    <div className="flex items-start gap-2">
                      <span className="shrink-0 pt-1 text-[10px] uppercase tracking-[0.18em] text-text-muted/70">
                        {t('assets.tags')}
                      </span>
                      <div className="ui-scrollbar flex min-w-0 flex-1 gap-2 overflow-x-auto pb-1">
                        <button
                          type="button"
                          className={`whitespace-nowrap rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
                            !selectedTag
                              ? 'border-accent/30 bg-accent/12 text-accent'
                              : 'border-transparent bg-white/[0.03] text-text-muted hover:border-[rgba(255,255,255,0.1)] hover:bg-white/[0.06] hover:text-text-dark'
                          }`}
                          onClick={() => setSelectedTag('')}
                        >
                          {t('assets.allTags')}
                        </button>
                        {tags.map((tag) => (
                          <button
                            key={tag}
                            type="button"
                            className={`whitespace-nowrap rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
                              selectedTag === tag
                                ? 'border-accent/30 bg-accent/12 text-accent'
                                : 'border-transparent bg-white/[0.03] text-text-muted hover:border-[rgba(255,255,255,0.1)] hover:bg-white/[0.06] hover:text-text-dark'
                            }`}
                            onClick={() =>
                              setSelectedTag((current) => (current === tag ? '' : tag))
                            }
                          >
                            {tag}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>

              {filteredItems.length === 0 ? (
                <div className="mt-3 rounded-2xl border border-dashed border-[rgba(255,255,255,0.12)] px-5 py-10 text-center text-sm text-text-muted">
                  {t(activeFilterCount > 0 ? 'assets.emptyFilterResult' : 'assets.emptyAssets')}
                </div>
              ) : (
                <div className="ui-scrollbar mt-3 max-h-[320px] overflow-y-auto pr-1">
                  <div className="columns-2 gap-2.5 sm:columns-3 lg:columns-5">
                    {filteredItems.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        draggable
                        onDragStart={(event) => {
                          setDraggingAssetId(item.id);
                          event.dataTransfer.effectAllowed = 'copy';
                          event.dataTransfer.setData(
                            ASSET_DRAG_MIME_TYPE,
                            serializeAssetDragPayload({
                              assetId: item.id,
                              assetLibraryId: item.libraryId,
                              assetName: item.name,
                              assetCategory: item.category,
                              imagePath: item.imagePath,
                              previewImagePath: item.previewImagePath,
                              aspectRatio: item.aspectRatio,
                            })
                          );
                          event.dataTransfer.setData('text/plain', item.name);
                        }}
                        onDragEnd={() => setDraggingAssetId(null)}
                        className={`group mb-2.5 inline-block w-full break-inside-avoid align-top text-left transition-transform duration-200 ${
                          draggingAssetId === item.id
                            ? 'scale-[0.98] opacity-80'
                            : 'hover:-translate-y-0.5'
                        }`}
                        title={t('assets.dragHint')}
                      >
                        <img
                          src={resolveImageDisplayUrl(item.previewImagePath || item.imagePath)}
                          alt={item.name}
                          className="block h-auto w-full rounded-md transition-transform duration-200 group-hover:scale-[1.02]"
                        />
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
