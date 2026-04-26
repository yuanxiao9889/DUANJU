import { createPortal } from 'react-dom';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ImagePlus } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { UiButton, UiChipButton, UiInput, UiPanel, UiSelect } from '@/components/ui';
import {
  getAssetCategoriesForMediaType,
  type AssetCategory,
  type AssetMediaType,
} from '@/features/assets/domain/types';
import { prepareNodeAudio } from '@/features/canvas/application/audioData';
import { prepareNodeImage } from '@/features/canvas/application/imageData';
import type { CanvasNode } from '@/features/canvas/domain/canvasNodes';
import { useAssetStore } from '@/stores/assetStore';
import { useCanvasStore } from '@/stores/canvasStore';
import { useProjectStore } from '@/stores/projectStore';

interface NodeAddToAssetsButtonProps {
  node: CanvasNode;
  mediaSource: string;
  mediaType: AssetMediaType;
  className: string;
}

interface PopoverPosition {
  left: number;
  top: number;
}

const POPOVER_WIDTH_PX = 320;
const POPOVER_GAP_PX = 10;
const VIEWPORT_PADDING_PX = 12;
const SUCCESS_FEEDBACK_MS = 1400;
const UI_SELECT_LISTBOX_SELECTOR = '[data-ui-select-listbox="true"]';

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function stripFileExtension(value: string): string {
  return value.replace(/\.[^.]+$/, '').trim();
}

function resolveDefaultCategory(
  node: CanvasNode,
  mediaType: AssetMediaType
): AssetCategory {
  const assetCategory = normalizeText((node.data as { assetCategory?: unknown }).assetCategory);
  const categories = getAssetCategoriesForMediaType(mediaType);
  return categories.includes(assetCategory as AssetCategory)
    ? (assetCategory as AssetCategory)
    : (categories[0] ?? (mediaType === 'audio' ? 'voice' : 'character'));
}

function resolveDefaultAssetName(node: CanvasNode, fallbackName: string): string {
  const data = node.data as {
    assetName?: unknown;
    displayName?: unknown;
    sourceFileName?: unknown;
    audioFileName?: unknown;
    videoFileName?: unknown;
  };
  const candidates = [
    normalizeText(data.assetName),
    normalizeText(data.displayName),
    stripFileExtension(normalizeText(data.audioFileName)),
    stripFileExtension(normalizeText(data.videoFileName)),
    stripFileExtension(normalizeText(data.sourceFileName)),
  ];

  return candidates.find((candidate) => candidate.length > 0) ?? fallbackName;
}

function resolveCategoryLabel(
  t: (key: string) => string,
  category: AssetCategory
): string {
  return t(`assets.categories.${category}`);
}

export function NodeAddToAssetsButton({
  node,
  mediaSource,
  mediaType,
  className,
}: NodeAddToAssetsButtonProps) {
  const { t } = useTranslation();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const libraries = useAssetStore((state) => state.libraries);
  const isHydrated = useAssetStore((state) => state.isHydrated);
  const isLoading = useAssetStore((state) => state.isLoading);
  const hydrate = useAssetStore((state) => state.hydrate);
  const createItem = useAssetStore((state) => state.createItem);

  const currentProjectAssetLibraryId = useProjectStore(
    (state) => state.currentProject?.assetLibraryId ?? null
  );
  const setCurrentProjectAssetLibrary = useProjectStore(
    (state) => state.setCurrentProjectAssetLibrary
  );

  const updateNodeData = useCanvasStore((state) => state.updateNodeData);

  const assetId = normalizeText((node.data as { assetId?: unknown }).assetId);
  const isAssetBound = assetId.length > 0;

  const [isOpen, setIsOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isAddedSuccess, setIsAddedSuccess] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [selectedLibraryId, setSelectedLibraryId] = useState('');
  const [category, setCategory] = useState<AssetCategory>('character');
  const [subcategoryId, setSubcategoryId] = useState('');
  const [name, setName] = useState('');
  const [position, setPosition] = useState<PopoverPosition>({
    left: VIEWPORT_PADDING_PX,
    top: VIEWPORT_PADDING_PX,
  });

  const boundLibrary = useMemo(
    () =>
      libraries.find((library) => library.id === currentProjectAssetLibraryId) ?? null,
    [currentProjectAssetLibraryId, libraries]
  );
  const targetLibrary = useMemo(() => {
    if (boundLibrary) {
      return boundLibrary;
    }

    return libraries.find((library) => library.id === selectedLibraryId) ?? null;
  }, [boundLibrary, libraries, selectedLibraryId]);
  const shouldChooseLibrary = !boundLibrary;
  const subcategories = useMemo(
    () =>
      (targetLibrary?.subcategories ?? []).filter(
        (item) => item.category === category
      ),
    [category, targetLibrary]
  );

  const updatePosition = useCallback(() => {
    const triggerElement = triggerRef.current;
    if (!triggerElement) {
      return;
    }

    const triggerRect = triggerElement.getBoundingClientRect();
    const panelWidth = popoverRef.current?.offsetWidth ?? POPOVER_WIDTH_PX;
    const panelHeight = popoverRef.current?.offsetHeight ?? 0;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let left = triggerRect.left + triggerRect.width / 2 - panelWidth / 2;
    left = Math.max(
      VIEWPORT_PADDING_PX,
      Math.min(left, viewportWidth - panelWidth - VIEWPORT_PADDING_PX)
    );

    let top = triggerRect.bottom + POPOVER_GAP_PX;
    if (
      panelHeight > 0
      && top + panelHeight > viewportHeight - VIEWPORT_PADDING_PX
    ) {
      top = Math.max(
        VIEWPORT_PADDING_PX,
        triggerRect.top - panelHeight - POPOVER_GAP_PX
      );
    }

    setPosition({ left, top });
  }, []);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    if (!isHydrated && !isLoading) {
      void hydrate();
    }
  }, [hydrate, isHydrated, isLoading, isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    setCategory(resolveDefaultCategory(node, mediaType));
    setName(resolveDefaultAssetName(node, t('assets.untitledAsset')));
    setSubcategoryId('');
    setErrorMessage('');
  }, [isOpen, mediaType, node, t]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    if (boundLibrary) {
      setSelectedLibraryId(boundLibrary.id);
      return;
    }

    setSelectedLibraryId((current) => {
      if (current && libraries.some((library) => library.id === current)) {
        return current;
      }
      return libraries[0]?.id ?? '';
    });
  }, [boundLibrary, isOpen, libraries]);

  useEffect(() => {
    if (!subcategoryId) {
      return;
    }

    if (!subcategories.some((item) => item.id === subcategoryId)) {
      setSubcategoryId('');
    }
  }, [subcategoryId, subcategories]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const frameId = requestAnimationFrame(() => {
      updatePosition();
    });

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (
        target instanceof Element
        && target.closest(UI_SELECT_LISTBOX_SELECTOR)
      ) {
        return;
      }
      if (
        (target && popoverRef.current?.contains(target))
        || (target && triggerRef.current?.contains(target))
      ) {
        return;
      }

      setIsOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    };

    window.addEventListener('pointerdown', handlePointerDown, true);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);

    return () => {
      cancelAnimationFrame(frameId);
      window.removeEventListener('pointerdown', handlePointerDown, true);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [isOpen, updatePosition]);

  useEffect(() => {
    return () => {
      if (successTimerRef.current) {
        clearTimeout(successTimerRef.current);
      }
    };
  }, []);

  const canSubmit =
    !isSubmitting
    && Boolean(targetLibrary)
    && name.trim().length > 0
    && mediaSource.trim().length > 0;

  const handleSubmit = useCallback(async () => {
    if (!canSubmit || !targetLibrary) {
      return;
    }

    setIsSubmitting(true);
    setErrorMessage('');

    try {
      const nodeData = node.data as {
        duration?: unknown;
        mimeType?: unknown;
      };

      const item =
        mediaType === 'audio'
          ? await (async () => {
              const prepared = await prepareNodeAudio(mediaSource, {
                duration:
                  typeof nodeData.duration === 'number' && Number.isFinite(nodeData.duration)
                    ? nodeData.duration
                    : null,
                mimeType:
                  typeof nodeData.mimeType === 'string' && nodeData.mimeType.trim().length > 0
                    ? nodeData.mimeType
                    : null,
              });

              return await createItem({
                libraryId: targetLibrary.id,
                category,
                mediaType,
                subcategoryId: subcategoryId || null,
                name: name.trim(),
                description: '',
                tags: [],
                sourcePath: prepared.audioUrl,
                previewPath: prepared.previewImageUrl,
                mimeType: prepared.mimeType,
                durationMs: Math.round(prepared.duration * 1000),
                aspectRatio: '1:1',
                metadata: null,
              });
            })()
          : await (async () => {
              const prepared = await prepareNodeImage(mediaSource);
              return await createItem({
                libraryId: targetLibrary.id,
                category,
                mediaType,
                subcategoryId: subcategoryId || null,
                name: name.trim(),
                description: '',
                tags: [],
                sourcePath: prepared.imageUrl,
                previewPath: prepared.previewImageUrl,
                mimeType: null,
                durationMs: null,
                aspectRatio: prepared.aspectRatio,
                metadata: null,
              });
            })();

      if (mediaType === 'audio') {
        updateNodeData(node.id, {
          displayName: item.name,
          audioUrl: item.sourcePath,
          previewImageUrl: item.previewPath,
          audioFileName: item.name,
          duration: item.durationMs != null ? item.durationMs / 1000 : null,
          mimeType: item.mimeType,
          assetId: item.id,
          assetLibraryId: item.libraryId,
          assetName: item.name,
          assetCategory: item.category,
        });
      } else {
        updateNodeData(node.id, {
          displayName: item.name,
          imageUrl: item.sourcePath,
          previewImageUrl: item.previewPath,
          aspectRatio: item.aspectRatio,
          assetId: item.id,
          assetLibraryId: item.libraryId,
          assetName: item.name,
          assetCategory: item.category,
          sourceFileName: item.name,
          imageWidth: null,
          imageHeight: null,
        });
      }

      if (!boundLibrary || currentProjectAssetLibraryId !== item.libraryId) {
        setCurrentProjectAssetLibrary(item.libraryId);
      }

      setIsOpen(false);
      setIsAddedSuccess(true);
      if (successTimerRef.current) {
        clearTimeout(successTimerRef.current);
      }
      successTimerRef.current = setTimeout(() => {
        setIsAddedSuccess(false);
        successTimerRef.current = null;
      }, SUCCESS_FEEDBACK_MS);
    } catch (error) {
      console.error('Failed to add canvas media to asset library', error);
      setErrorMessage(t('nodeToolbar.addToAssetsFailed'));
    } finally {
      setIsSubmitting(false);
    }
  }, [
    boundLibrary,
    canSubmit,
    category,
    createItem,
    currentProjectAssetLibraryId,
    mediaSource,
    mediaType,
    name,
    node.id,
    node.data,
    setCurrentProjectAssetLibrary,
    subcategoryId,
    t,
    targetLibrary,
    updateNodeData,
  ]);

  if (isAssetBound && !isAddedSuccess && !isOpen) {
    return null;
  }

  const panel = isOpen
    ? createPortal(
        <div
          ref={popoverRef}
          className="fixed z-[10020] w-[320px]"
          style={{ left: `${position.left}px`, top: `${position.top}px` }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <UiPanel className="space-y-3 rounded-xl border-[rgba(255,255,255,0.14)] bg-surface-dark/96 p-3 shadow-[0_18px_40px_rgba(0,0,0,0.34)] backdrop-blur-md">
            <div className="space-y-1">
              <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-text-muted/75">
                {t('nodeToolbar.addToAssets')}
              </div>
              <div className="text-xs leading-5 text-text-muted">
                {targetLibrary
                  ? t('nodeToolbar.addToAssetsHint', {
                      library: targetLibrary.name,
                    })
                  : libraries.length > 0
                    ? t('nodeToolbar.selectAssetLibraryFirst')
                    : t('nodeToolbar.noAssetLibraries')}
              </div>
            </div>

            {libraries.length > 0 ? (
              <>
                {shouldChooseLibrary ? (
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-medium uppercase tracking-[0.14em] text-text-muted/80">
                      {t('assets.library')}
                    </label>
                    <UiSelect
                      value={selectedLibraryId}
                      onChange={(event) => setSelectedLibraryId(event.target.value)}
                      className="h-9 text-sm"
                    >
                      {libraries.map((library) => (
                        <option key={library.id} value={library.id}>
                          {library.name}
                        </option>
                      ))}
                    </UiSelect>
                  </div>
                ) : targetLibrary ? (
                  <div className="rounded-lg border border-[rgba(255,255,255,0.08)] bg-white/[0.03] px-3 py-2">
                    <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-text-muted/70">
                      {t('assets.library')}
                    </div>
                    <div className="mt-1 truncate text-sm text-text-dark">
                      {targetLibrary.name}
                    </div>
                  </div>
                ) : null}

                <div className="space-y-1.5">
                  <label className="text-[11px] font-medium uppercase tracking-[0.14em] text-text-muted/80">
                    {t('assets.assetName')}
                  </label>
                  <UiInput
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    className="h-9 text-sm"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-[11px] font-medium uppercase tracking-[0.14em] text-text-muted/80">
                    {t('assets.category')}
                  </label>
                  <div className="grid grid-cols-3 gap-1.5">
                    {getAssetCategoriesForMediaType(mediaType).map((option) => {
                      const isActive = category === option;
                      return (
                      <UiChipButton
                        key={option}
                        type="button"
                        active={isActive}
                        className={`h-8 rounded-lg px-2 text-xs ${
                          isActive
                            ? '!border-accent/75 !bg-accent/28 !text-white shadow-[0_0_0_1px_rgba(var(--accent-rgb),0.22)] hover:!bg-accent/34'
                            : 'text-text-dark/90'
                        }`}
                        onClick={() => setCategory(option)}
                      >
                        {resolveCategoryLabel(t, option)}
                      </UiChipButton>
                      );
                    })}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[11px] font-medium uppercase tracking-[0.14em] text-text-muted/80">
                    {t('assets.subcategory')}
                  </label>
                  <UiSelect
                    value={subcategoryId}
                    onChange={(event) => setSubcategoryId(event.target.value)}
                    className="h-9 text-sm"
                  >
                    <option value="">{t('assets.unassigned')}</option>
                    {subcategories.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </UiSelect>
                </div>
              </>
            ) : (
              <div className="rounded-lg border border-dashed border-[rgba(255,255,255,0.12)] px-3 py-4 text-sm text-text-muted">
                {t('nodeToolbar.noAssetLibraries')}
              </div>
            )}

            {errorMessage ? (
              <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
                {errorMessage}
              </div>
            ) : null}

            <div className="flex justify-end gap-2 pt-1">
              <UiButton
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setIsOpen(false)}
              >
                {t('common.cancel')}
              </UiButton>
              <UiButton
                type="button"
                variant="primary"
                size="sm"
                disabled={!canSubmit}
                onClick={() => {
                  void handleSubmit();
                }}
              >
                {isSubmitting
                  ? t('nodeToolbar.addingToAssets')
                  : t('nodeToolbar.addToAssets')}
              </UiButton>
            </div>
          </UiPanel>
        </div>,
        document.body
      )
    : null;

  return (
    <>
      <UiChipButton
        ref={triggerRef}
        type="button"
        className={`${className} ${
          isAddedSuccess
            ? '!border-emerald-400/70 !bg-emerald-500/20 !text-emerald-200 hover:!bg-emerald-500/30'
            : isOpen
              ? '!border-accent/50 !bg-accent/15 !text-text-dark'
              : ''
        }`}
        onClick={(event) => {
          event.stopPropagation();
          setIsOpen((current) => !current);
        }}
        disabled={isSubmitting}
      >
        <ImagePlus className="h-3.5 w-3.5" />
        {isAddedSuccess
          ? t('nodeToolbar.addedToAssets')
          : t('nodeToolbar.addToAssets')}
      </UiChipButton>
      {panel}
    </>
  );
}
