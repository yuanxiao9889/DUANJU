import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  FolderTree,
  ImagePlus,
  Layers3,
  RotateCcw,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { UiButton, UiInput, UiModal, UiSelect } from '@/components/ui';
import type {
  AssetCategory,
  AssetLibraryRecord,
} from '@/features/assets/domain/types';
import {
  countBatchAssetDraftsByCategory,
  submitBatchAssetsFromDrafts,
  type BatchAssetDraft,
  type BatchAssetEditableCategory,
  type BatchAssetSourceResolution,
} from '@/features/canvas/application/batchAddToAssets';
import { CanvasNodeImage } from '@/features/canvas/ui/CanvasNodeImage';
import { useAssetStore } from '@/stores/assetStore';
import { useProjectStore } from '@/stores/projectStore';

interface BatchAddToAssetsDialogProps {
  isOpen: boolean;
  resolution: BatchAssetSourceResolution | null;
  onClose: () => void;
}

interface DraftFormState {
  name: string;
  category: BatchAssetEditableCategory | null;
  assignedSubcategoryId: string;
  status: 'idle' | 'success' | 'error';
  errorMessage: string | null;
}

interface GroupDestinationConfig {
  activeSubcategoryId: string;
}

type GroupDestinationMap = Record<BatchAssetEditableCategory, GroupDestinationConfig>;

const CATEGORY_ORDER: BatchAssetEditableCategory[] = ['character', 'scene', 'prop'];
const UNASSIGNED_SUBCATEGORY_ID = '__unassigned__';

function createDefaultGroupDestinationMap(): GroupDestinationMap {
  return {
    character: { activeSubcategoryId: '' },
    scene: { activeSubcategoryId: '' },
    prop: { activeSubcategoryId: '' },
  };
}

function resolveGroupDrafts(
  drafts: BatchAssetDraft[],
  category: BatchAssetEditableCategory
): BatchAssetDraft[] {
  return drafts.filter((draft) => draft.resolvedCategory === category);
}

function resolveLibrarySubcategories(
  library: AssetLibraryRecord | null,
  category: AssetCategory
) {
  return (library?.subcategories ?? []).filter((item) => item.category === category);
}

function resolveAssignedSubcategoryLabel(
  library: AssetLibraryRecord | null,
  category: BatchAssetEditableCategory | null,
  assignedSubcategoryId: string,
  t: (key: string) => string
): string | null {
  if (!category || !assignedSubcategoryId) {
    return null;
  }

  if (assignedSubcategoryId === UNASSIGNED_SUBCATEGORY_ID) {
    return t('assets.unassigned');
  }

  return (
    resolveLibrarySubcategories(library, category).find(
      (subcategory) => subcategory.id === assignedSubcategoryId
    )?.name ?? null
  );
}

export function BatchAddToAssetsDialog({
  isOpen,
  resolution,
  onClose,
}: BatchAddToAssetsDialogProps) {
  const { t } = useTranslation();
  const libraries = useAssetStore((state) => state.libraries);
  const isHydrated = useAssetStore((state) => state.isHydrated);
  const isLoadingLibraries = useAssetStore((state) => state.isLoading);
  const hydrate = useAssetStore((state) => state.hydrate);
  const currentProjectAssetLibraryId = useProjectStore(
    (state) => state.currentProject?.assetLibraryId ?? null
  );

  const [selectedLibraryId, setSelectedLibraryId] = useState('');
  const [groupDestinations, setGroupDestinations] = useState<GroupDestinationMap>(
    createDefaultGroupDestinationMap
  );
  const [draftStateMap, setDraftStateMap] = useState<Record<string, DraftFormState>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitErrorMessage, setSubmitErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || isHydrated || isLoadingLibraries) {
      return;
    }

    void hydrate();
  }, [hydrate, isHydrated, isLoadingLibraries, isOpen]);

  useEffect(() => {
    if (!isOpen || !resolution) {
      return;
    }

    setGroupDestinations(createDefaultGroupDestinationMap());
    setDraftStateMap(
      Object.fromEntries(
        resolution.drafts.map((draft) => [
          draft.id,
          {
            name: draft.defaultName,
            category: draft.resolvedCategory,
            assignedSubcategoryId: '',
            status: 'idle' as const,
            errorMessage: null,
          },
        ])
      )
    );
    setIsSubmitting(false);
    setSubmitErrorMessage(null);
  }, [isOpen, resolution]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    setSelectedLibraryId((current) => {
      if (currentProjectAssetLibraryId) {
        return currentProjectAssetLibraryId;
      }

      if (current && libraries.some((library) => library.id === current)) {
        return current;
      }

      return libraries[0]?.id ?? '';
    });
  }, [currentProjectAssetLibraryId, isOpen, libraries]);

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

  const drafts = resolution?.drafts ?? [];
  const unresolvedDrafts = useMemo(
    () => drafts.filter((draft) => draft.resolvedCategory === null),
    [drafts]
  );
  const groupedDrafts = useMemo(
    () =>
      CATEGORY_ORDER.map((category) => ({
        category,
        drafts: resolveGroupDrafts(drafts, category),
        assignedCount: drafts.filter((draft) => {
          const draftState = draftStateMap[draft.id];
          return draftState?.category === category && Boolean(draftState.assignedSubcategoryId);
        }).length,
      })),
    [draftStateMap, drafts]
  );

  const summaryCounts = useMemo(() => {
    const initialCounts = countBatchAssetDraftsByCategory(drafts);
    const nextCounts = {
      character: initialCounts.character,
      scene: initialCounts.scene,
      prop: initialCounts.prop,
      unresolved: 0,
    };

    unresolvedDrafts.forEach((draft) => {
      const selectedCategory = draftStateMap[draft.id]?.category ?? null;
      if (selectedCategory) {
        nextCounts[selectedCategory] += 1;
      } else {
        nextCounts.unresolved += 1;
      }
    });

    return nextCounts;
  }, [draftStateMap, drafts, unresolvedDrafts]);

  const recognizedCategoryCount = CATEGORY_ORDER.filter(
    (category) => summaryCounts[category] > 0
  ).length;
  const hasMixedTypes = recognizedCategoryCount > 1 || summaryCounts.unresolved > 0;
  const hasUnresolvedItems = summaryCounts.unresolved > 0;

  const pendingDrafts = useMemo(
    () =>
      drafts.filter((draft) => {
        const draftState = draftStateMap[draft.id];
        return draftState && draftState.status !== 'success';
      }),
    [draftStateMap, drafts]
  );
  const hasAnyPendingDraft = pendingDrafts.length > 0;
  const hasLibraryChoices = libraries.length > 0;
  const hasTargetLibrary = Boolean(targetLibrary);
  const hasDraftsMissingCategory = pendingDrafts.some(
    (draft) => !(draftStateMap[draft.id]?.category)
  );
  const hasDraftsMissingAssignment = pendingDrafts.some(
    (draft) => !(draftStateMap[draft.id]?.assignedSubcategoryId)
  );

  const canSubmit = hasAnyPendingDraft
    && hasTargetLibrary
    && !isSubmitting
    && !hasDraftsMissingCategory
    && !hasDraftsMissingAssignment
    && pendingDrafts.every((draft) => {
      const draftState = draftStateMap[draft.id];
      return Boolean(draftState && draftState.name.trim().length > 0);
    });

  const handleDraftNameChange = (draftId: string, name: string) => {
    setDraftStateMap((current) => ({
      ...current,
      [draftId]: {
        ...(current[draftId] ?? {
          name: '',
          category: null,
          assignedSubcategoryId: '',
          status: 'idle',
          errorMessage: null,
        }),
        name,
        status: current[draftId]?.status === 'success' ? 'success' : 'idle',
        errorMessage: null,
      },
    }));
  };

  const handleDraftCategoryChange = (
    draftId: string,
    category: BatchAssetEditableCategory | null
  ) => {
    setDraftStateMap((current) => ({
      ...current,
      [draftId]: {
        ...(current[draftId] ?? {
          name: '',
          category: null,
          assignedSubcategoryId: '',
          status: 'idle',
          errorMessage: null,
        }),
        category,
        assignedSubcategoryId:
          current[draftId]?.category === category ? current[draftId]?.assignedSubcategoryId ?? '' : '',
        status: current[draftId]?.status === 'success' ? 'success' : 'idle',
        errorMessage: null,
      },
    }));
  };

  const handleActiveSubcategoryChange = (
    category: BatchAssetEditableCategory,
    activeSubcategoryId: string
  ) => {
    setGroupDestinations((current) => ({
      ...current,
      [category]: {
        activeSubcategoryId,
      },
    }));
  };

  const handleAssignDraftToActiveSubcategory = (draftId: string) => {
    const draftState = draftStateMap[draftId];
    const category = draftState?.category ?? null;
    if (!draftState || !category || draftState.assignedSubcategoryId) {
      return;
    }

    const activeSubcategoryId = groupDestinations[category].activeSubcategoryId;
    if (!activeSubcategoryId) {
      return;
    }

    setDraftStateMap((current) => ({
      ...current,
      [draftId]: {
        ...current[draftId],
        assignedSubcategoryId: activeSubcategoryId,
        status: current[draftId]?.status === 'success' ? 'success' : 'idle',
        errorMessage: null,
      },
    }));
  };

  const handleClearDraftAssignment = (draftId: string) => {
    setDraftStateMap((current) => {
      if (!current[draftId]) {
        return current;
      }

      return {
        ...current,
        [draftId]: {
          ...current[draftId],
          assignedSubcategoryId: '',
          status: current[draftId].status === 'success' ? 'success' : 'idle',
          errorMessage: null,
        },
      };
    });
  };

  const handleSubmit = async () => {
    if (!resolution || !targetLibrary || !canSubmit) {
      return;
    }

    const draftInputs = pendingDrafts
      .map((draft) => {
        const draftState = draftStateMap[draft.id];
        const category = draftState?.category;
        if (!draftState || !category || !draftState.assignedSubcategoryId) {
          return null;
        }

        return {
          draftId: draft.id,
          nodeId: draft.nodeId,
          mediaSource: draft.mediaSource,
          category,
          subcategoryId:
            draftState.assignedSubcategoryId === UNASSIGNED_SUBCATEGORY_ID
              ? null
              : draftState.assignedSubcategoryId,
          name: draftState.name.trim(),
        };
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item));

    setIsSubmitting(true);
    setSubmitErrorMessage(null);
    try {
      const result = await submitBatchAssetsFromDrafts({
        libraryId: targetLibrary.id,
        drafts: draftInputs,
        bindProjectLibrary: !currentProjectAssetLibraryId,
      });

      setDraftStateMap((current) => {
        const nextState = { ...current };
        result.results.forEach((item) => {
          if (!nextState[item.draftId]) {
            return;
          }

          nextState[item.draftId] = {
            ...nextState[item.draftId],
            status: item.status === 'success' ? 'success' : 'error',
            errorMessage:
              item.status === 'error'
                ? item.error ?? t('selection.batchAddAssets.submitItemFailed')
                : null,
          };
        });
        return nextState;
      });

      const hasFailure = result.results.some((item) => item.status === 'error');
      if (hasFailure) {
        setSubmitErrorMessage(t('selection.batchAddAssets.partialFailure'));
        return;
      }

      onClose();
    } catch (error) {
      setSubmitErrorMessage(
        error instanceof Error && error.message.trim().length > 0
          ? error.message
          : t('selection.batchAddAssets.submitFailed')
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <UiModal
      isOpen={isOpen}
      title={t('selection.batchAddAssets.title')}
      onClose={() => {
        if (!isSubmitting) {
          onClose();
        }
      }}
      widthClassName="w-[calc(100vw-32px)] max-w-[1100px]"
      bodyClassName="max-h-[72vh] overflow-y-auto pr-1"
      footer={(
        <>
          <UiButton type="button" variant="ghost" onClick={onClose} disabled={isSubmitting}>
            {t('common.cancel')}
          </UiButton>
          <UiButton
            type="button"
            variant="primary"
            onClick={() => void handleSubmit()}
            disabled={!canSubmit}
          >
            {isSubmitting
              ? t('selection.batchAddAssets.submitting')
              : t('selection.batchAddAssets.confirm')}
          </UiButton>
        </>
      )}
    >
      <div className="space-y-5">
        <div className="grid gap-3 rounded-3xl border border-border-dark/80 bg-[radial-gradient(circle_at_top_left,rgba(var(--accent-rgb),0.14),transparent_48%),rgba(255,255,255,0.02)] p-4 md:grid-cols-[minmax(0,1.45fr)_minmax(280px,0.95fr)]">
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-medium text-text-dark">
              <Layers3 className="h-4 w-4 text-accent" />
              <span>{t('selection.batchAddAssets.summaryTitle')}</span>
            </div>
            <div className="flex flex-wrap gap-2">
              <div className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-text-dark">
                {t('selection.batchAddAssets.summary.total', {
                  count: drafts.length,
                })}
              </div>
              <div className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-text-dark">
                {t('selection.batchAddAssets.summary.character', {
                  count: summaryCounts.character,
                })}
              </div>
              <div className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-text-dark">
                {t('selection.batchAddAssets.summary.scene', {
                  count: summaryCounts.scene,
                })}
              </div>
              <div className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-text-dark">
                {t('selection.batchAddAssets.summary.prop', {
                  count: summaryCounts.prop,
                })}
              </div>
              <div className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-text-dark">
                {t('selection.batchAddAssets.summary.unresolved', {
                  count: summaryCounts.unresolved,
                })}
              </div>
              <div className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-text-dark">
                {t('selection.batchAddAssets.summary.skipped', {
                  count: resolution?.skippedNodeIds.length ?? 0,
                })}
              </div>
            </div>
            {hasMixedTypes ? (
              <div className="rounded-2xl border border-amber-300/25 bg-amber-400/10 px-3 py-2 text-sm text-amber-100">
                {t('selection.batchAddAssets.mixedNotice')}
              </div>
            ) : null}
          </div>

          <div className="space-y-3 rounded-2xl border border-white/8 bg-black/10 p-4">
            <div className="flex items-center gap-2 text-sm font-medium text-text-dark">
              <FolderTree className="h-4 w-4 text-accent" />
              <span>{t('selection.batchAddAssets.libraryTitle')}</span>
            </div>
            {boundLibrary ? (
              <div className="rounded-2xl border border-emerald-400/25 bg-emerald-500/10 px-3 py-3">
                <div className="text-[11px] uppercase tracking-[0.12em] text-emerald-100/80">
                  {t('selection.batchAddAssets.libraryLockedLabel')}
                </div>
                <div className="mt-1 text-sm font-medium text-text-dark">
                  {boundLibrary.name}
                </div>
                <div className="mt-1 text-xs text-text-muted">
                  {t('selection.batchAddAssets.libraryLockedHint')}
                </div>
              </div>
            ) : hasLibraryChoices ? (
              <div className="space-y-2">
                <label className="text-[11px] font-medium uppercase tracking-[0.12em] text-text-muted">
                  {t('assets.library')}
                </label>
                <UiSelect
                  value={selectedLibraryId}
                  onChange={(event) => setSelectedLibraryId(event.target.value)}
                >
                  {libraries.map((library) => (
                    <option key={library.id} value={library.id}>
                      {library.name}
                    </option>
                  ))}
                </UiSelect>
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-white/10 px-3 py-4 text-sm text-text-muted">
                {t('nodeToolbar.noAssetLibraries')}
              </div>
            )}
          </div>
        </div>

        <div className="space-y-4">
          {groupedDrafts.map(({ category, drafts: categoryDrafts, assignedCount }) => {
            const draftCount = categoryDrafts.length;
            const shouldShow = draftCount > 0 || unresolvedDrafts.length > 0;
            if (!shouldShow) {
              return null;
            }

            const subcategories = resolveLibrarySubcategories(targetLibrary, category);
            const activeSubcategoryId = groupDestinations[category].activeSubcategoryId;
            const activeSubcategoryLabel = resolveAssignedSubcategoryLabel(
              targetLibrary,
              category,
              activeSubcategoryId,
              t
            );

            return (
              <section
                key={category}
                className="rounded-3xl border border-border-dark/75 bg-surface-dark/65 p-4"
              >
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div>
                    <div className="text-base font-semibold text-text-dark">
                      {t(`assets.categories.${category}`)}
                    </div>
                    <div className="mt-1 text-sm text-text-muted">
                      {t('selection.batchAddAssets.groupSummary', { count: draftCount })}
                      {assignedCount > 0
                        ? ` · ${t('selection.batchAddAssets.groupAssigned', {
                            count: assignedCount,
                          })}`
                        : ''}
                    </div>
                    <div className="mt-1 text-xs text-text-muted/85">
                      {activeSubcategoryLabel
                        ? t('selection.batchAddAssets.groupActiveHint', {
                            name: activeSubcategoryLabel,
                          })
                        : t('selection.batchAddAssets.groupPickActiveHint')}
                    </div>
                  </div>

                  <div className="min-w-[240px] space-y-1.5">
                    <label className="text-[11px] font-medium uppercase tracking-[0.12em] text-text-muted">
                      {t('selection.batchAddAssets.activeSubcategoryLabel')}
                    </label>
                    <UiSelect
                      value={activeSubcategoryId}
                      onChange={(event) =>
                        handleActiveSubcategoryChange(category, event.target.value)
                      }
                    >
                      <option value="">
                        {t('selection.batchAddAssets.chooseActiveSubcategory')}
                      </option>
                      <option value={UNASSIGNED_SUBCATEGORY_ID}>{t('assets.unassigned')}</option>
                      {subcategories.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name}
                        </option>
                      ))}
                    </UiSelect>
                  </div>
                </div>

                {draftCount > 0 ? (
                  <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {categoryDrafts.map((draft) => {
                      const state = draftStateMap[draft.id];
                      const previewSource = draft.previewSource ?? draft.mediaSource;
                      const assignedSubcategoryLabel = resolveAssignedSubcategoryLabel(
                        targetLibrary,
                        state?.category ?? category,
                        state?.assignedSubcategoryId ?? '',
                        t
                      );
                      const isAssigned = Boolean(state?.assignedSubcategoryId);
                      const isAssignedToActiveSubcategory = Boolean(
                        isAssigned
                        && activeSubcategoryId
                        && state?.assignedSubcategoryId === activeSubcategoryId
                      );
                      const showAssignedMask = isAssigned;
                      const canAssign = Boolean(!isAssigned && activeSubcategoryId);

                      return (
                        <div
                          key={draft.id}
                          role={canAssign ? 'button' : undefined}
                          tabIndex={canAssign ? 0 : undefined}
                          onClick={() => handleAssignDraftToActiveSubcategory(draft.id)}
                          onKeyDown={(event) => {
                            if (!canAssign) {
                              return;
                            }

                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault();
                              handleAssignDraftToActiveSubcategory(draft.id);
                            }
                          }}
                          className={`overflow-hidden rounded-2xl border bg-black/10 transition-colors ${
                            isAssigned
                              ? isAssignedToActiveSubcategory
                                ? 'border-emerald-400/28'
                                : 'border-white/16'
                              : canAssign
                                ? 'cursor-pointer border-accent/35 hover:border-accent/70 hover:bg-accent/6'
                                : 'border-white/8'
                          }`}
                        >
                          <div className="relative aspect-[4/3] bg-black/35">
                            <CanvasNodeImage
                              src={previewSource}
                              fallbackSrc={draft.mediaSource}
                              alt={state?.name || draft.defaultName}
                              className={`h-full w-full object-cover transition-[filter,transform,opacity] ${
                                showAssignedMask
                                  ? isAssignedToActiveSubcategory
                                    ? 'scale-[0.985] brightness-[0.58] saturate-[0.72] opacity-[0.82]'
                                    : 'scale-[0.98] brightness-[0.32] saturate-[0.38] opacity-[0.7]'
                                  : ''
                              }`}
                              disableViewer
                            />
                            {showAssignedMask ? (
                              <div
                                className={`pointer-events-none absolute inset-0 ${
                                  isAssignedToActiveSubcategory
                                    ? 'bg-black/36'
                                    : 'bg-black/52'
                                }`}
                              />
                            ) : null}
                          </div>

                          <div className="space-y-3 p-3">
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex min-w-0 flex-wrap items-center gap-2">
                                <span className="text-xs font-medium uppercase tracking-[0.12em] text-text-muted">
                                  {t('assets.assetName')}
                                </span>
                                {assignedSubcategoryLabel ? (
                                  <span className="inline-flex items-center gap-1 rounded-full border border-emerald-400/25 bg-emerald-500/12 px-2 py-0.5 text-[11px] text-emerald-100">
                                    {t('selection.batchAddAssets.assignedBadge', {
                                      name: assignedSubcategoryLabel,
                                    })}
                                  </span>
                                ) : null}
                                {state?.status === 'success' ? (
                                  <span className="inline-flex items-center gap-1 rounded-full border border-emerald-400/25 bg-emerald-500/12 px-2 py-0.5 text-[11px] text-emerald-100">
                                    <CheckCircle2 className="h-3.5 w-3.5" />
                                    {t('selection.batchAddAssets.itemAdded')}
                                  </span>
                                ) : null}
                              </div>

                              {isAssigned ? (
                                <button
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    handleClearDraftAssignment(draft.id);
                                  }}
                                  className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-white/10 text-text-muted transition-colors hover:border-accent/50 hover:text-text-dark"
                                  title={t('selection.batchAddAssets.clearAssignment')}
                                >
                                  <RotateCcw className="h-3.5 w-3.5" />
                                </button>
                              ) : null}
                            </div>

                            <div
                              onClick={(event) => event.stopPropagation()}
                              onKeyDown={(event) => event.stopPropagation()}
                            >
                              <UiInput
                                value={state?.name ?? draft.defaultName}
                                onChange={(event) =>
                                  handleDraftNameChange(draft.id, event.target.value)
                                }
                              />
                            </div>

                            <div className="text-xs text-text-muted">
                              {assignedSubcategoryLabel
                                ? t('selection.batchAddAssets.assignedCardHint')
                                : activeSubcategoryLabel
                                  ? t('selection.batchAddAssets.clickToAssignHint', {
                                      name: activeSubcategoryLabel,
                                    })
                                  : t('selection.batchAddAssets.pickSubcategoryFirstHint')}
                            </div>

                            {state?.errorMessage ? (
                              <div className="rounded-2xl border border-red-400/25 bg-red-500/10 px-3 py-2 text-xs text-red-100">
                                {state.errorMessage}
                              </div>
                            ) : null}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="mt-4 rounded-2xl border border-dashed border-white/10 px-3 py-4 text-sm text-text-muted">
                    {t('selection.batchAddAssets.groupEmpty')}
                  </div>
                )}
              </section>
            );
          })}

          {unresolvedDrafts.length > 0 ? (
            <section className="rounded-3xl border border-amber-300/25 bg-amber-400/8 p-4">
              <div className="flex items-center gap-2 text-base font-semibold text-text-dark">
                <AlertCircle className="h-4 w-4 text-amber-200" />
                <span>{t('selection.batchAddAssets.unresolvedTitle')}</span>
              </div>
              <div className="mt-1 text-sm text-text-muted">
                {t('selection.batchAddAssets.unresolvedHint')}
              </div>

              <div className="mt-4 grid gap-3 xl:grid-cols-2">
                {unresolvedDrafts.map((draft) => {
                  const state = draftStateMap[draft.id];
                  const previewSource = draft.previewSource ?? draft.mediaSource;
                  const assignedSubcategoryLabel = resolveAssignedSubcategoryLabel(
                    targetLibrary,
                    state?.category ?? null,
                    state?.assignedSubcategoryId ?? '',
                    t
                  );
                  const activeSubcategoryId = state?.category
                    ? groupDestinations[state.category].activeSubcategoryId
                    : '';
                  const activeSubcategoryLabel = state?.category
                    ? resolveAssignedSubcategoryLabel(
                        targetLibrary,
                        state.category,
                        activeSubcategoryId,
                        t
                      )
                    : null;
                  const isAssigned = Boolean(state?.assignedSubcategoryId);
                  const isAssignedToActiveSubcategory = Boolean(
                    isAssigned
                    && activeSubcategoryId
                    && state?.assignedSubcategoryId === activeSubcategoryId
                  );
                  const showAssignedMask = isAssigned;
                  const canAssign = Boolean(!isAssigned && state?.category && activeSubcategoryId);

                  return (
                    <div
                      key={draft.id}
                      role={canAssign ? 'button' : undefined}
                      tabIndex={canAssign ? 0 : undefined}
                      onClick={() => handleAssignDraftToActiveSubcategory(draft.id)}
                      onKeyDown={(event) => {
                        if (!canAssign) {
                          return;
                        }

                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          handleAssignDraftToActiveSubcategory(draft.id);
                        }
                      }}
                      className={`overflow-hidden rounded-2xl border bg-black/10 transition-colors ${
                        isAssigned
                          ? isAssignedToActiveSubcategory
                            ? 'border-emerald-400/28'
                            : 'border-white/16'
                          : canAssign
                            ? 'cursor-pointer border-accent/35 hover:border-accent/70 hover:bg-accent/6'
                            : 'border-white/10'
                      }`}
                    >
                      <div className="grid gap-0 md:grid-cols-[180px_minmax(0,1fr)]">
                        <div className="relative aspect-[4/3] bg-black/35">
                          <CanvasNodeImage
                            src={previewSource}
                            fallbackSrc={draft.mediaSource}
                            alt={state?.name || draft.defaultName}
                            className={`h-full w-full object-cover transition-[filter,transform,opacity] ${
                              showAssignedMask
                                ? isAssignedToActiveSubcategory
                                  ? 'scale-[0.985] brightness-[0.58] saturate-[0.72] opacity-[0.82]'
                                  : 'scale-[0.98] brightness-[0.32] saturate-[0.38] opacity-[0.7]'
                                : ''
                            }`}
                            disableViewer
                          />
                          {showAssignedMask ? (
                            <div
                              className={`pointer-events-none absolute inset-0 ${
                                isAssignedToActiveSubcategory
                                  ? 'bg-black/36'
                                  : 'bg-black/52'
                              }`}
                            />
                          ) : null}
                        </div>
                        <div className="space-y-3 p-3">
                          <div
                            className="space-y-1.5"
                            onClick={(event) => event.stopPropagation()}
                            onKeyDown={(event) => event.stopPropagation()}
                          >
                            <label className="text-[11px] font-medium uppercase tracking-[0.12em] text-text-muted">
                              {t('assets.category')}
                            </label>
                            <UiSelect
                              value={state?.category ?? ''}
                              onChange={(event) =>
                                handleDraftCategoryChange(
                                  draft.id,
                                  (event.target.value || null) as BatchAssetEditableCategory | null
                                )
                              }
                            >
                              <option value="">
                                {t('selection.batchAddAssets.chooseCategory')}
                              </option>
                              {CATEGORY_ORDER.map((category) => (
                                <option key={category} value={category}>
                                  {t(`assets.categories.${category}`)}
                                </option>
                              ))}
                            </UiSelect>
                          </div>

                          <div
                            className="space-y-1.5"
                            onClick={(event) => event.stopPropagation()}
                            onKeyDown={(event) => event.stopPropagation()}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <label className="text-[11px] font-medium uppercase tracking-[0.12em] text-text-muted">
                                {t('assets.assetName')}
                              </label>
                              {assignedSubcategoryLabel ? (
                                <span className="inline-flex items-center gap-1 rounded-full border border-emerald-400/25 bg-emerald-500/12 px-2 py-0.5 text-[11px] text-emerald-100">
                                  {t('selection.batchAddAssets.assignedBadge', {
                                    name: assignedSubcategoryLabel,
                                  })}
                                </span>
                              ) : null}
                            </div>
                            <UiInput
                              value={state?.name ?? draft.defaultName}
                              onChange={(event) =>
                                handleDraftNameChange(draft.id, event.target.value)
                              }
                            />
                          </div>

                          {state?.category ? (
                            <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2 text-xs text-text-muted">
                              {assignedSubcategoryLabel
                                ? t('selection.batchAddAssets.assignedCardHint')
                                : activeSubcategoryLabel
                                  ? t('selection.batchAddAssets.clickToAssignHint', {
                                      name: activeSubcategoryLabel,
                                    })
                                  : t('selection.batchAddAssets.pickSubcategoryFirstHint')}
                            </div>
                          ) : (
                            <div className="rounded-2xl border border-dashed border-amber-300/25 bg-black/10 px-3 py-2 text-xs text-amber-100">
                              {t('selection.batchAddAssets.unresolvedPending')}
                            </div>
                          )}

                          <div className="flex items-center gap-2">
                            {state?.status === 'success' ? (
                              <div className="inline-flex items-center gap-1 rounded-full border border-emerald-400/25 bg-emerald-500/12 px-2 py-1 text-[11px] text-emerald-100">
                                <CheckCircle2 className="h-3.5 w-3.5" />
                                {t('selection.batchAddAssets.itemAdded')}
                              </div>
                            ) : null}
                            {isAssigned ? (
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  handleClearDraftAssignment(draft.id);
                                }}
                                className="inline-flex items-center gap-1 rounded-full border border-white/10 px-2 py-1 text-[11px] text-text-muted transition-colors hover:border-accent/50 hover:text-text-dark"
                              >
                                <RotateCcw className="h-3.5 w-3.5" />
                                {t('selection.batchAddAssets.clearAssignment')}
                              </button>
                            ) : null}
                          </div>

                          {state?.errorMessage ? (
                            <div className="rounded-2xl border border-red-400/25 bg-red-500/10 px-3 py-2 text-xs text-red-100">
                              {state.errorMessage}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          ) : null}
        </div>

        {submitErrorMessage ? (
          <div className="rounded-2xl border border-red-400/25 bg-red-500/10 px-3 py-2 text-sm text-red-100">
            {submitErrorMessage}
          </div>
        ) : null}

        {!hasTargetLibrary && hasLibraryChoices ? (
          <div className="rounded-2xl border border-amber-300/25 bg-amber-400/10 px-3 py-2 text-sm text-amber-100">
            {t('selection.batchAddAssets.libraryRequired')}
          </div>
        ) : null}
        {!hasLibraryChoices ? (
          <div className="rounded-2xl border border-dashed border-white/10 px-3 py-3 text-sm text-text-muted">
            {t('nodeToolbar.noAssetLibraries')}
          </div>
        ) : null}

        <div className="flex items-center justify-between rounded-2xl border border-white/8 bg-black/10 px-4 py-3">
          <div className="flex items-center gap-2 text-sm text-text-muted">
            <ImagePlus className="h-4 w-4 text-accent" />
            <span>
              {hasUnresolvedItems
                ? t('selection.batchAddAssets.footerNeedsConfirm')
                : hasDraftsMissingAssignment
                  ? t('selection.batchAddAssets.footerNeedsAssignment')
                  : t('selection.batchAddAssets.footerReady')}
            </span>
          </div>
          <div className="text-xs text-text-muted">
            {t('selection.batchAddAssets.footerPending', {
              count: pendingDrafts.length,
            })}
          </div>
        </div>
      </div>
    </UiModal>
  );
}
