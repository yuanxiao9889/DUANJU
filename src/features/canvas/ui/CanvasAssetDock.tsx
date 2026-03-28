import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AudioLines, ChevronUp, MapPin, Package, Search, UserRound, X } from 'lucide-react';

import { UiButton, UiInput, UiSelect } from '@/components/ui';
import {
  ASSET_CATEGORIES,
  ASSET_DRAG_MIME_TYPE,
  type AssetCategory,
  serializeAssetDragPayload,
} from '@/features/assets/domain/types';
import { formatAudioDuration } from '@/features/canvas/application/audioData';
import { resolveImageDisplayUrl } from '@/features/canvas/application/imageData';
import { useAssetStore } from '@/stores/assetStore';
import { useProjectStore } from '@/stores/projectStore';

const ASSET_GRID_FIXED_MAX_HEIGHT_PX = 248;
const DOCK_PANEL_TRANSITION_MS = 220;
const DOCK_PANEL_MAX_HEIGHT_PX = 520;

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
    case 'voice':
      return <AudioLines className="h-4 w-4" />;
  }
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
  const [renderedCategory, setRenderedCategory] = useState<AssetCategory | null>(null);
  const [isPanelMounted, setIsPanelMounted] = useState(false);
  const [isPanelVisible, setIsPanelVisible] = useState(false);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  const selectedLibrary = libraries.find((library) => library.id === assetLibraryId) ?? null;

  useEffect(() => {
    setSelectedSubcategoryId('');
    setSelectedTag('');
    setSearchQuery('');
  }, [assetLibraryId]);

  useEffect(() => {
    if (!activeCategory) {
      return;
    }

    setSelectedSubcategoryId('');
    setSelectedTag('');
    setSearchQuery('');
  }, [activeCategory]);

  useEffect(() => {
    if (!assetLibraryId) {
      return;
    }

    if (!libraries.some((library) => library.id === assetLibraryId)) {
      setCurrentProjectAssetLibrary(null);
    }
  }, [assetLibraryId, libraries, setCurrentProjectAssetLibrary]);

  useEffect(() => {
    setActiveCategory(null);
  }, [assetLibraryId]);

  const isExpanded = Boolean(activeCategory && selectedLibrary);
  const visibleCategory = activeCategory ?? renderedCategory;
  const isDockOpen = isExpanded || isPanelMounted;

  useEffect(() => {
    if (isExpanded && activeCategory) {
      setRenderedCategory(activeCategory);
      setIsPanelMounted(true);

      const frameId = window.requestAnimationFrame(() => {
        setIsPanelVisible(true);
      });

      return () => window.cancelAnimationFrame(frameId);
    }

    if (!isPanelMounted && !renderedCategory) {
      return;
    }

    setIsPanelVisible(false);
    const timeoutId = window.setTimeout(() => {
      setIsPanelMounted(false);
      setRenderedCategory(null);
    }, DOCK_PANEL_TRANSITION_MS);

    return () => window.clearTimeout(timeoutId);
  }, [activeCategory, isExpanded, isPanelMounted, renderedCategory]);

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
    if (!selectedLibrary || !visibleCategory) {
      return [];
    }

    return selectedLibrary.subcategories.filter(
      (subcategory) => subcategory.category === visibleCategory
    );
  }, [selectedLibrary, visibleCategory]);

  const tags = useMemo(() => {
    if (!selectedLibrary || !visibleCategory) {
      return [];
    }

    return Array.from(
      new Set(
        selectedLibrary.items
          .filter((item) => item.category === visibleCategory)
          .flatMap((item) => item.tags)
      )
    ).sort((left, right) => left.localeCompare(right, 'zh-Hans-CN', { sensitivity: 'base' }));
  }, [selectedLibrary, visibleCategory]);

  const filteredItems = useMemo(() => {
    if (!selectedLibrary || !visibleCategory) {
      return [];
    }

    const normalizedSearch = searchQuery.trim().toLowerCase();
    return selectedLibrary.items.filter((item) => {
      if (item.category !== visibleCategory) {
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
  }, [searchQuery, selectedLibrary, selectedSubcategoryId, selectedTag, visibleCategory]);

  const activeFilterCount = useMemo(
    () =>
      Number(searchQuery.trim().length > 0)
      + Number(selectedSubcategoryId.length > 0)
      + Number(selectedTag.length > 0),
    [searchQuery, selectedSubcategoryId, selectedTag]
  );
  if (projectType !== 'storyboard') {
    return null;
  }

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-4 z-[10010] flex justify-center px-4">
      <div
        className={`pointer-events-auto relative transition-[max-width,transform] duration-200 ease-out ${
          isDockOpen
            ? 'w-full max-w-[760px] -translate-y-0.5'
            : 'w-fit max-w-[calc(100vw-2rem)] translate-y-0'
        }`}
      >
        {isDockOpen ? (
          <button
            type="button"
            className={`absolute left-1/2 top-0 z-20 flex h-6 w-6 -translate-x-1/2 -translate-y-[calc(100%+2px)] items-center justify-center rounded-full border border-[rgba(255,255,255,0.14)] bg-surface-dark text-text-muted shadow-lg transition-[opacity,transform,background-color,color] duration-200 ease-out hover:bg-white/[0.06] hover:text-text-dark ${
              isPanelVisible ? 'opacity-100' : 'pointer-events-none opacity-0'
            }`}
            onClick={() => setActiveCategory(null)}
            title={t('common.close')}
          >
            <ChevronUp className="h-3.5 w-3.5" />
          </button>
        ) : null}

        <div
          className={`rounded-lg border border-[rgba(255,255,255,0.12)] bg-surface-dark/92 p-3 backdrop-blur-md transition-[transform,box-shadow,border-color,background-color] duration-200 ease-out ${
            isDockOpen
              ? 'shadow-[0_20px_44px_rgba(0,0,0,0.32)]'
              : 'shadow-[0_14px_30px_rgba(0,0,0,0.24)]'
          }`}
        >
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
                const isActive = visibleCategory === category;
                return (
                  <UiButton
                    key={category}
                    type="button"
                    variant={isActive ? 'primary' : 'ghost'}
                    size="sm"
                    className={`gap-1.5 rounded-xl px-2.5 ${
                      !selectedLibrary ? 'opacity-45' : ''
                    } transition-[transform,box-shadow,background-color,color] duration-200 ease-out ${
                      isActive ? '-translate-y-px shadow-[0_10px_22px_rgba(0,0,0,0.16)]' : ''
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

          {isPanelMounted && visibleCategory && selectedLibrary ? (
            <div
              className={`mt-2 overflow-hidden rounded-lg border border-[rgba(255,255,255,0.08)] bg-bg-dark/35 transition-[max-height,opacity,transform,margin] duration-200 ease-out ${
                isPanelVisible ? 'translate-y-0 opacity-100' : 'pointer-events-none -translate-y-1 opacity-0'
              }`}
              style={{
                maxHeight: isPanelVisible ? `${DOCK_PANEL_MAX_HEIGHT_PX}px` : '0px',
              }}
            >
              <div
                className={`p-3 transition-[opacity,transform] duration-200 ease-out ${
                  isPanelVisible ? 'translate-y-0 opacity-100' : 'translate-y-1 opacity-0'
                }`}
              >
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

                  {filteredItems.length === 0 ? (
                    <div className="mt-3 rounded-2xl border border-dashed border-[rgba(255,255,255,0.12)] px-5 py-10 text-center text-sm text-text-muted">
                      {t(activeFilterCount > 0 ? 'assets.emptyFilterResult' : 'assets.emptyAssets')}
                    </div>
                  ) : (
                    <div
                      className="ui-scrollbar mt-3 overflow-y-auto pr-1"
                      style={{ maxHeight: `${ASSET_GRID_FIXED_MAX_HEIGHT_PX}px` }}
                    >
                      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
                        {filteredItems.map((item, index) => (
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
                                  mediaType: item.mediaType,
                                  sourcePath: item.sourcePath,
                                  previewPath: item.previewPath,
                                  mimeType: item.mimeType,
                                  durationMs: item.durationMs,
                                  aspectRatio: item.aspectRatio,
                                })
                              );
                              event.dataTransfer.setData('text/plain', item.name);
                            }}
                            onDragEnd={() => setDraggingAssetId(null)}
                            className={`group w-full text-left transition-[transform,opacity,filter] duration-200 ease-out ${
                              draggingAssetId === item.id
                                ? 'scale-[0.98] opacity-80'
                                : isPanelVisible
                                  ? 'translate-y-0 opacity-100 hover:-translate-y-0.5'
                                  : 'translate-y-1 opacity-0'
                            }`}
                            style={{
                              transitionDelay: isPanelVisible
                                ? `${Math.min(index, 7) * 18}ms`
                                : '0ms',
                            }}
                            title={t('assets.dragHint')}
                          >
                            {item.mediaType === 'audio' ? (
                              <div className="flex h-[72px] w-full flex-col justify-between rounded-md border border-[rgba(255,255,255,0.08)] bg-[linear-gradient(160deg,rgba(255,255,255,0.07),rgba(255,255,255,0.02))] px-3 py-2">
                                <div className="flex items-center gap-2 text-rose-300">
                                  <AudioLines className="h-4 w-4 shrink-0" />
                                  <span className="truncate text-xs font-medium text-text-dark">
                                    {item.name}
                                  </span>
                                </div>
                                <div className="text-[11px] text-text-muted">
                                  {formatAudioDuration(item.durationMs ? item.durationMs / 1000 : null)}
                                </div>
                              </div>
                            ) : (
                              <img
                                src={resolveImageDisplayUrl(item.previewPath || item.sourcePath)}
                                alt={item.name}
                                className="block h-auto w-full rounded-md transition-transform duration-200 group-hover:scale-[1.02]"
                              />
                            )}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
