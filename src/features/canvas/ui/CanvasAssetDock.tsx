import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { useTranslation } from 'react-i18next';
import { getCurrentWindow } from '@tauri-apps/api/window';
import {
  AudioLines,
  ChevronDown,
  ExternalLink,
  MapPin,
  Package,
  Search,
  UserRound,
  X,
} from 'lucide-react';

import { UiButton, UiInput, UiSelect } from '@/components/ui';
import {
  ASSET_CATEGORIES,
  ASSET_DRAG_MIME_TYPE,
  type AssetCategory,
  serializeAssetDragPayload,
  toCanvasAssetDragPayload,
} from '@/features/assets/domain/types';
import {
  ASSET_PANEL_CLOSED_EVENT,
  focusAssetPanelWindow,
  getAssetPanelWindow,
  openAssetPanelWindow,
} from '@/features/assets/application/assetPanelBridge';
import { AssetPreviewImage } from '@/features/assets/ui/AssetPreviewImage';
import { formatAudioDuration } from '@/features/canvas/application/audioData';
import { useAssetStore } from '@/stores/assetStore';
import { useProjectStore } from '@/stores/projectStore';

const DOCK_PANEL_TRANSITION_MS = 220;
const DOCK_PANEL_HEIGHT_STORAGE_KEY = 'storyboard.asset-dock.height';
const DOCK_PANEL_DEFAULT_HEIGHT_PX = 520;
const DOCK_PANEL_MIN_HEIGHT_PX = 150;
const DOCK_PANEL_VIEWPORT_VERTICAL_MARGIN_PX = 96;
const ASSET_GRID_MIN_HEIGHT_PX = 0;
const ASSET_GRID_RESERVED_HEIGHT_PX = 172;

function resolveDockPanelMaxHeight(): number {
  if (typeof window === 'undefined') {
    return DOCK_PANEL_DEFAULT_HEIGHT_PX;
  }

  return Math.max(
    DOCK_PANEL_MIN_HEIGHT_PX,
    Math.round(window.innerHeight - DOCK_PANEL_VIEWPORT_VERTICAL_MARGIN_PX)
  );
}

function clampDockPanelHeight(value: number): number {
  if (!Number.isFinite(value)) {
    return DOCK_PANEL_DEFAULT_HEIGHT_PX;
  }

  return Math.min(
    resolveDockPanelMaxHeight(),
    Math.max(DOCK_PANEL_MIN_HEIGHT_PX, Math.round(value))
  );
}

function readDockPanelHeight(): number {
  if (typeof window === 'undefined') {
    return DOCK_PANEL_DEFAULT_HEIGHT_PX;
  }

  const raw = Number(window.localStorage.getItem(DOCK_PANEL_HEIGHT_STORAGE_KEY));
  if (!Number.isFinite(raw) || raw <= 0) {
    return clampDockPanelHeight(DOCK_PANEL_DEFAULT_HEIGHT_PX);
  }

  return clampDockPanelHeight(raw);
}

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
  const [isDetachedPanelOpen, setIsDetachedPanelOpen] = useState(false);
  const [dockPanelHeight, setDockPanelHeight] = useState(readDockPanelHeight);
  const [isPanelResizing, setIsPanelResizing] = useState(false);
  const dockRootRef = useRef<HTMLDivElement | null>(null);
  const panelResizeStateRef = useRef<{ startY: number; startHeight: number } | null>(null);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(DOCK_PANEL_HEIGHT_STORAGE_KEY, String(dockPanelHeight));
  }, [dockPanelHeight]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const handleResize = () => {
      setDockPanelHeight((current) => clampDockPanelHeight(current));
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

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

  useEffect(() => {
    let unlistenDetachedClosed: (() => void) | null = null;
    let disposed = false;

    const syncDetachedWindowState = async () => {
      const assetPanelWindow = await getAssetPanelWindow();
      const isWindowVisible = assetPanelWindow ? await assetPanelWindow.isVisible() : false;
      if (!disposed) {
        setIsDetachedPanelOpen(isWindowVisible);
      }
    };

    const registerDetachedCloseListener = async () => {
      const nextUnlistenDetachedClosed = await getCurrentWindow().listen(ASSET_PANEL_CLOSED_EVENT, () => {
        setIsDetachedPanelOpen(false);
      });
      if (disposed) {
        nextUnlistenDetachedClosed();
        return;
      }
      unlistenDetachedClosed = nextUnlistenDetachedClosed;
    };

    void syncDetachedWindowState();
    void registerDetachedCloseListener().catch((error) => {
      console.error('Failed to listen for detached asset panel close events', error);
    });

    return () => {
      disposed = true;
      unlistenDetachedClosed?.();
    };
  }, []);

  const isExpanded = Boolean(activeCategory && selectedLibrary);
  const visibleCategory = activeCategory ?? renderedCategory;
  const isDockOpen = isExpanded || isPanelMounted;
  const assetGridMaxHeight = Math.max(
    ASSET_GRID_MIN_HEIGHT_PX,
    dockPanelHeight - ASSET_GRID_RESERVED_HEIGHT_PX
  );

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

  useEffect(() => {
    if (!isPanelResizing) {
      return;
    }

    if (typeof document !== 'undefined') {
      document.body.style.cursor = 'row-resize';
      document.body.style.userSelect = 'none';
      window.getSelection()?.removeAllRanges();
    }

    const handlePointerMove = (event: PointerEvent) => {
      const resizeState = panelResizeStateRef.current;
      if (!resizeState) {
        return;
      }

      setDockPanelHeight(
        clampDockPanelHeight(resizeState.startHeight + (resizeState.startY - event.clientY))
      );
    };

    const handlePointerUp = () => {
      panelResizeStateRef.current = null;
      setIsPanelResizing(false);
    };

    const handleSelectStart = (event: Event) => {
      event.preventDefault();
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('selectstart', handleSelectStart);
    return () => {
      if (typeof document !== 'undefined') {
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('selectstart', handleSelectStart);
    };
  }, [isPanelResizing]);

  useEffect(() => {
    if (!isExpanded || isPanelResizing || typeof document === 'undefined') {
      return;
    }

    const handleOutsidePointerDown = (event: PointerEvent) => {
      const dockRoot = dockRootRef.current;
      const eventTarget = event.target;
      if (!dockRoot || !(eventTarget instanceof Node) || dockRoot.contains(eventTarget)) {
        return;
      }

      setActiveCategory(null);
    };

    document.addEventListener('pointerdown', handleOutsidePointerDown, true);
    return () => {
      document.removeEventListener('pointerdown', handleOutsidePointerDown, true);
    };
  }, [isExpanded, isPanelResizing]);

  const handleStartPanelResize = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0 || !isPanelVisible) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      panelResizeStateRef.current = {
        startY: event.clientY,
        startHeight: dockPanelHeight,
      };
      setIsPanelResizing(true);
    },
    [dockPanelHeight, isPanelVisible]
  );

  const handlePanelResizeKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!isPanelVisible) {
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setDockPanelHeight((current) => clampDockPanelHeight(current + 24));
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setDockPanelHeight((current) => clampDockPanelHeight(current - 24));
      return;
    }

    if (event.key === 'Home') {
      event.preventDefault();
      setDockPanelHeight(DOCK_PANEL_MIN_HEIGHT_PX);
      return;
    }

    if (event.key === 'End') {
      event.preventDefault();
      setDockPanelHeight(resolveDockPanelMaxHeight());
    }
  }, [isPanelVisible]);

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

      return [item.name, item.description, item.sourcePath, ...item.tags]
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

  const handleOpenDetachedPanel = async () => {
    if (isDetachedPanelOpen) {
      await focusAssetPanelWindow();
      return;
    }

    const assetPanelWindow = await openAssetPanelWindow(t('assets.detachedTitle'));
    setIsDetachedPanelOpen(true);

    void assetPanelWindow.once('tauri://error', (event) => {
      console.error('Failed to create detached asset panel window', event.payload);
      setIsDetachedPanelOpen(false);
    });
  };

  if (projectType !== 'storyboard') {
    return null;
  }

  if (isDetachedPanelOpen) {
    return null;
  }

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-4 z-[10010] flex justify-center px-4">
      <div
        ref={dockRootRef}
        className={`pointer-events-auto relative transition-transform duration-200 ease-out ${
          isDockOpen
            ? 'w-full max-w-[760px] -translate-y-0.5'
            : 'w-fit max-w-[calc(100vw-2rem)] translate-y-0'
        }`}
      >
        {isPanelMounted && visibleCategory && selectedLibrary ? (
          <div
            className={`absolute bottom-[calc(100%+8px)] left-1/2 w-[min(760px,calc(100vw-2rem))] -translate-x-1/2 overflow-visible transition-[height,opacity] duration-200 ease-out ${
              isPanelVisible
                ? 'opacity-100'
                : 'pointer-events-none opacity-0'
            }`}
            style={{
              height: isPanelVisible ? `${dockPanelHeight}px` : '0px',
              transitionDuration: isPanelResizing ? '0ms' : undefined,
            }}
          >
            <button
              type="button"
              className={`absolute left-1/2 top-0 z-20 flex h-6 w-6 -translate-x-1/2 -translate-y-[calc(100%+2px)] items-center justify-center rounded-full border border-[rgba(255,255,255,0.14)] bg-surface-dark text-text-muted shadow-lg transition-[opacity,transform,background-color,color] duration-200 ease-out hover:bg-white/[0.06] hover:text-text-dark ${
                isPanelVisible ? 'opacity-100' : 'pointer-events-none opacity-0'
              }`}
              onClick={() => setActiveCategory(null)}
              title={t('common.close')}
            >
              <ChevronDown className="h-3.5 w-3.5" />
            </button>

            <div
              role="separator"
              aria-label={t('assets.resizeDockHeight')}
              aria-orientation="horizontal"
              aria-valuemin={DOCK_PANEL_MIN_HEIGHT_PX}
              aria-valuemax={resolveDockPanelMaxHeight()}
              aria-valuenow={dockPanelHeight}
              tabIndex={0}
              className={`absolute left-8 right-8 top-0 z-10 flex h-4 -translate-y-1/2 cursor-row-resize items-center justify-center rounded-full outline-none transition-opacity duration-200 focus-visible:ring-2 focus-visible:ring-accent/70 ${
                isPanelVisible ? 'opacity-100' : 'pointer-events-none opacity-0'
              }`}
              onPointerDown={handleStartPanelResize}
              onKeyDown={handlePanelResizeKeyDown}
              title={t('assets.resizeDockHeight')}
            >
              <span
                className={`h-1 w-24 rounded-full border border-white/[0.08] bg-white/[0.12] shadow-[0_6px_18px_rgba(0,0,0,0.24)] transition-[background-color,border-color,width] ${
                  isPanelResizing
                    ? 'w-32 border-accent/35 bg-accent/35'
                    : 'hover:border-white/[0.16] hover:bg-white/[0.2]'
                }`}
              />
            </div>

            <div
              className="absolute inset-x-0 bottom-0 overflow-hidden rounded-lg border border-[rgba(255,255,255,0.1)] bg-surface-dark/94 shadow-[0_24px_60px_rgba(0,0,0,0.38)] backdrop-blur-md"
              style={{
                height: '100%',
              }}
            >
              <div
                className={`h-full min-h-0 p-3 transition-[opacity,transform] duration-200 ease-out ${
                  isPanelVisible ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0'
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
                    <UiButton
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="gap-1.5"
                      onClick={() => void handleOpenDetachedPanel()}
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      <span>
                        {t(
                          isDetachedPanelOpen
                            ? 'assets.focusDetachedPanel'
                            : 'assets.detachPanel'
                        )}
                      </span>
                    </UiButton>
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
                      style={{ maxHeight: `${assetGridMaxHeight}px` }}
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
                                serializeAssetDragPayload(toCanvasAssetDragPayload(item))
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
                            title={item.name}
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
                            ) : item.mediaType === 'model' ? (
                              <div className="flex h-[72px] w-full flex-col justify-between rounded-md border border-[rgba(255,255,255,0.08)] bg-[linear-gradient(160deg,rgba(255,255,255,0.07),rgba(255,255,255,0.02))] px-3 py-2">
                                <div className="flex items-center gap-2 text-emerald-300">
                                  <Package className="h-4 w-4 shrink-0" />
                                  <span className="truncate text-xs font-medium text-text-dark">
                                    {item.name}
                                  </span>
                                </div>
                                <div className="text-[11px] text-text-muted">
                                  {t('assets.mediaTypes.model')}
                                </div>
                              </div>
                            ) : (
                              <AssetPreviewImage
                                assetId={item.id}
                                previewSource={item.previewPath}
                                sourceSource={item.sourcePath}
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
          </div>
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

              {isDetachedPanelOpen ? (
                <UiButton
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="gap-1.5 rounded-xl px-2.5"
                  onClick={() => void handleOpenDetachedPanel()}
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  <span>{t('assets.focusDetachedPanel')}</span>
                </UiButton>
              ) : null}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
