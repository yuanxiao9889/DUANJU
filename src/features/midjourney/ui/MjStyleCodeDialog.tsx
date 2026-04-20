import { memo, useEffect, useMemo, useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { Check, ImagePlus, Palette, Plus, Trash2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { UiButton, UiInput, UiModal } from '@/components/ui';
import {
  prepareNodeImage,
  resolveImageDisplayUrl,
} from '@/features/canvas/application/imageData';
import {
  normalizeMjPersonalizationCode,
  sortMjStyleCodePresetsByUsage,
} from '@/features/midjourney/domain/styleCodePresets';
import { useSettingsStore } from '@/stores/settingsStore';

interface MjStyleCodeDialogProps {
  isOpen: boolean;
  selectedCodes: string[];
  onClose: () => void;
  onConfirm: (codes: string[]) => void;
}

const IMAGE_FILE_FILTERS = ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif', 'avif'] as const;

function MjStyleCodeDialogComponent({
  isOpen,
  selectedCodes,
  onClose,
  onConfirm,
}: MjStyleCodeDialogProps) {
  const { t } = useTranslation();
  const presets = useSettingsStore((state) => state.mjStyleCodePresets);
  const addMjStyleCodePreset = useSettingsStore((state) => state.addMjStyleCodePreset);
  const updateMjStyleCodePreset = useSettingsStore((state) => state.updateMjStyleCodePreset);
  const deleteMjStyleCodePreset = useSettingsStore((state) => state.deleteMjStyleCodePreset);
  const markMjStyleCodePresetUsed = useSettingsStore(
    (state) => state.markMjStyleCodePresetUsed
  );

  const [draftCodes, setDraftCodes] = useState<string[]>([]);
  const [customCodeInput, setCustomCodeInput] = useState('');
  const [pendingCoverImageSource, setPendingCoverImageSource] = useState<string | null>(null);
  const [isSavingPreset, setIsSavingPreset] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    setDraftCodes(selectedCodes);
    setCustomCodeInput('');
    setPendingCoverImageSource(null);
    setIsSavingPreset(false);
    setFormError(null);
  }, [isOpen, selectedCodes]);

  const sortedPresets = useMemo(
    () => sortMjStyleCodePresetsByUsage(presets),
    [presets]
  );

  const presetByCode = useMemo(
    () => new Map(sortedPresets.map((preset) => [preset.code, preset] as const)),
    [sortedPresets]
  );

  const previewCoverImageUrl = pendingCoverImageSource
    ? resolveImageDisplayUrl(pendingCoverImageSource)
    : null;

  const selectedCodeItems = useMemo(
    () =>
      draftCodes.map((code) => {
        const preset = presetByCode.get(code) ?? null;
        return {
          code,
          name: preset?.name?.trim() || code,
          fromPreset: Boolean(preset),
        };
      }),
    [draftCodes, presetByCode]
  );

  const toggleDraftCode = (code: string) => {
    setDraftCodes((current) =>
      current.includes(code)
        ? current.filter((item) => item !== code)
        : [...current, code]
    );
    setFormError(null);
  };

  const resolveNormalizedCustomCode = (): string => {
    return normalizeMjPersonalizationCode(customCodeInput);
  };

  const handleAddCurrentInputToSelection = () => {
    const normalizedCode = resolveNormalizedCustomCode();
    if (!normalizedCode) {
      setFormError(t('node.midjourney.personalization.inputRequired'));
      return;
    }

    setDraftCodes((current) =>
      current.includes(normalizedCode) ? current : [...current, normalizedCode]
    );
    setCustomCodeInput(normalizedCode);
    setFormError(null);
  };

  const handlePickCoverImage = async () => {
    setFormError(null);

    try {
      const selected = await open({
        multiple: false,
        filters: [
          {
            name: 'Images',
            extensions: [...IMAGE_FILE_FILTERS],
          },
        ],
      });

      if (!selected || Array.isArray(selected)) {
        return;
      }

      setPendingCoverImageSource(selected);
    } catch {
      setFormError(t('node.midjourney.personalization.pickCoverFailed'));
    }
  };

  const handleSavePreset = async () => {
    const normalizedCode = resolveNormalizedCustomCode();
    if (!normalizedCode) {
      setFormError(t('node.midjourney.personalization.inputRequired'));
      return;
    }

    setIsSavingPreset(true);
    setFormError(null);

    try {
      let nextImageUrl: string | null = null;
      if (pendingCoverImageSource) {
        const prepared = await prepareNodeImage(pendingCoverImageSource, 640);
        nextImageUrl = prepared.previewImageUrl || prepared.imageUrl || null;
      }

      const existingPreset = presetByCode.get(normalizedCode) ?? null;
      if (existingPreset) {
        if (nextImageUrl && nextImageUrl !== existingPreset.imageUrl) {
          updateMjStyleCodePreset(existingPreset.id, {
            imageUrl: nextImageUrl,
          });
        }
      } else {
        addMjStyleCodePreset({
          name: normalizedCode,
          code: normalizedCode,
          imageUrl: nextImageUrl,
        });
      }

      setDraftCodes((current) =>
        current.includes(normalizedCode) ? current : [...current, normalizedCode]
      );
      setCustomCodeInput(normalizedCode);
      setPendingCoverImageSource(null);
    } catch {
      setFormError(t('node.midjourney.personalization.savePresetFailed'));
    } finally {
      setIsSavingPreset(false);
    }
  };

  return (
    <UiModal
      isOpen={isOpen}
      title={t('node.midjourney.personalization.title')}
      onClose={() => {
        if (!isSavingPreset) {
          onClose();
        }
      }}
      widthClassName="w-[calc(100vw-36px)] max-w-[960px]"
      footer={
        <>
          <UiButton
            type="button"
            variant="ghost"
            disabled={isSavingPreset}
            onClick={onClose}
          >
            {t('common.cancel')}
          </UiButton>
          <UiButton
            type="button"
            variant="muted"
            disabled={isSavingPreset || draftCodes.length === 0}
            onClick={() => {
              setDraftCodes([]);
              setFormError(null);
            }}
          >
            {t('node.midjourney.personalization.clearSelection')}
          </UiButton>
          <UiButton
            type="button"
            variant="primary"
            disabled={isSavingPreset}
            onClick={() => {
              draftCodes
                .map((code) => presetByCode.get(code)?.id ?? null)
                .filter((value): value is string => Boolean(value))
                .forEach((presetId) => markMjStyleCodePresetUsed(presetId));
              onConfirm(draftCodes);
            }}
          >
            {t('common.confirm')}
          </UiButton>
        </>
      }
    >
      <div className="space-y-4">
        <div className="rounded-[22px] border border-white/10 bg-black/10 p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start">
            <div className="min-w-0 flex-1 space-y-2">
              <div className="text-xs font-medium uppercase tracking-[0.12em] text-text-muted">
                {t('node.midjourney.personalization.customInputLabel')}
              </div>
              <UiInput
                value={customCodeInput}
                placeholder={t('node.midjourney.personalization.customInputPlaceholder')}
                onChange={(event) => {
                  setCustomCodeInput(
                    normalizeMjPersonalizationCode(
                      event.target.value.replace(/\r\n?/g, ' ')
                    )
                  );
                  if (formError) {
                    setFormError(null);
                  }
                }}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter') {
                    return;
                  }
                  event.preventDefault();
                  handleAddCurrentInputToSelection();
                }}
              />
            </div>

            <div className="w-full shrink-0 lg:w-[220px]">
              <div className="text-xs font-medium uppercase tracking-[0.12em] text-text-muted">
                {t('node.midjourney.personalization.coverLabel')}
              </div>
              <div className="mt-2 rounded-[18px] border border-dashed border-white/10 bg-white/[0.03] p-2">
                <div className="overflow-hidden rounded-[14px] border border-white/8 bg-black/15">
                  <div className="aspect-[4/3] w-full">
                    {previewCoverImageUrl ? (
                      <img
                        src={previewCoverImageUrl}
                        alt={t('node.midjourney.personalization.coverAlt')}
                        className="h-full w-full object-cover"
                        draggable={false}
                      />
                    ) : (
                      <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.12),_transparent_58%),linear-gradient(180deg,rgba(15,23,42,0.92),rgba(15,23,42,0.72))] px-4 text-center">
                        <Palette className="h-5 w-5 text-text-dark" />
                        <div className="text-[11px] leading-5 text-text-muted">
                          {t('node.midjourney.personalization.coverHint')}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <UiButton
                    type="button"
                    size="sm"
                    variant="muted"
                    disabled={isSavingPreset}
                    onClick={() => void handlePickCoverImage()}
                  >
                    <ImagePlus className="h-3.5 w-3.5" />
                    {previewCoverImageUrl
                      ? t('node.midjourney.personalization.replaceCover')
                      : t('node.midjourney.personalization.uploadCover')}
                  </UiButton>
                  {previewCoverImageUrl ? (
                    <UiButton
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={isSavingPreset}
                      onClick={() => setPendingCoverImageSource(null)}
                    >
                      {t('node.midjourney.personalization.removeCover')}
                    </UiButton>
                  ) : null}
                </div>
              </div>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <UiButton
              type="button"
              size="sm"
              variant="muted"
              disabled={isSavingPreset}
              onClick={handleAddCurrentInputToSelection}
            >
              <Plus className="h-3.5 w-3.5" />
              {t('node.midjourney.personalization.addToSelection')}
            </UiButton>
            <UiButton
              type="button"
              size="sm"
              variant="muted"
              disabled={isSavingPreset}
              onClick={() => void handleSavePreset()}
            >
              <Plus className="h-3.5 w-3.5" />
              {t('node.midjourney.personalization.addPreset')}
            </UiButton>
            <UiButton
              type="button"
              size="sm"
              variant="ghost"
              disabled={isSavingPreset || (!customCodeInput && !pendingCoverImageSource)}
              onClick={() => {
                setCustomCodeInput('');
                setPendingCoverImageSource(null);
                setFormError(null);
              }}
            >
              {t('node.midjourney.personalization.clearInput')}
            </UiButton>
          </div>

          {formError ? (
            <div className="mt-3 text-xs text-rose-300">{formError}</div>
          ) : null}
        </div>

        <div className="rounded-[22px] border border-white/10 bg-black/10 p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <div className="text-xs font-medium uppercase tracking-[0.12em] text-text-muted">
                {t('node.midjourney.personalization.selectedTitle')}
              </div>
              <div className="mt-1 text-xs text-text-muted">
                {t('node.midjourney.personalization.selectedCount', {
                  count: draftCodes.length,
                })}
              </div>
            </div>
          </div>

          {selectedCodeItems.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {selectedCodeItems.map((item) => (
                <div
                  key={item.code}
                  className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.05] px-3 py-1.5 text-xs text-text-dark"
                >
                  <span className="max-w-[260px] truncate">{item.name}</span>
                  {!item.fromPreset ? (
                    <span className="rounded-full bg-white/8 px-2 py-0.5 text-[10px] text-text-muted">
                      {t('node.midjourney.personalization.orphanCode')}
                    </span>
                  ) : null}
                  <button
                    type="button"
                    className="rounded-full p-0.5 text-text-muted transition-colors hover:bg-white/[0.06] hover:text-text-dark"
                    onClick={() => toggleDraftCode(item.code)}
                    aria-label={t('node.midjourney.personalization.removeSelectedCode', {
                      code: item.code,
                    })}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-[16px] border border-dashed border-white/10 bg-white/[0.02] px-4 py-5 text-sm text-text-muted">
              {t('node.midjourney.personalization.selectedEmpty')}
            </div>
          )}
        </div>

        <div className="rounded-[22px] border border-white/10 bg-black/10 p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <div className="text-xs font-medium uppercase tracking-[0.12em] text-text-muted">
                {t('node.midjourney.personalization.presetsTitle')}
              </div>
              <div className="mt-1 text-xs text-text-muted">
                {t('node.midjourney.personalization.presetsCount', {
                  count: sortedPresets.length,
                })}
              </div>
            </div>
          </div>

          {sortedPresets.length > 0 ? (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-3">
              {sortedPresets.map((preset) => {
                const isSelected = draftCodes.includes(preset.code);
                const resolvedImageUrl = preset.imageUrl
                  ? resolveImageDisplayUrl(preset.imageUrl)
                  : null;

                return (
                  <button
                    key={preset.id}
                    type="button"
                    className={`group relative overflow-hidden rounded-[20px] border p-2 text-left transition-all ${
                      isSelected
                        ? 'border-accent bg-accent/10 shadow-[0_0_0_1px_rgba(59,130,246,0.28)]'
                        : 'border-white/8 bg-white/[0.03] hover:-translate-y-0.5 hover:border-white/14 hover:bg-white/[0.05]'
                    }`}
                    onClick={() => toggleDraftCode(preset.code)}
                  >
                    <div className="relative overflow-hidden rounded-[16px] border border-white/10 bg-black/15">
                      <div className="aspect-[4/3] w-full">
                        {resolvedImageUrl ? (
                          <img
                            src={resolvedImageUrl}
                            alt={preset.name}
                            className="h-full w-full object-cover"
                            draggable={false}
                          />
                        ) : (
                          <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.12),_transparent_58%),linear-gradient(180deg,rgba(15,23,42,0.92),rgba(15,23,42,0.72))] px-4 text-center">
                            <Palette className="h-5 w-5 text-text-dark" />
                            <div className="text-[11px] leading-5 text-text-muted">
                              {t('node.midjourney.personalization.noPresetCover')}
                            </div>
                          </div>
                        )}
                      </div>

                      <div className="pointer-events-none absolute left-2 top-2">
                        <div
                          className={`flex h-7 w-7 items-center justify-center rounded-full border ${
                            isSelected
                              ? 'border-accent/60 bg-accent text-white'
                              : 'border-white/12 bg-black/45 text-white/75'
                          }`}
                        >
                          {isSelected ? (
                            <Check className="h-4 w-4" />
                          ) : (
                            <span className="text-[11px] font-semibold">P</span>
                          )}
                        </div>
                      </div>

                      <button
                        type="button"
                        className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full border border-white/12 bg-black/55 text-white/75 transition-colors hover:border-rose-300/40 hover:bg-rose-500/14 hover:text-rose-200"
                        onClick={(event) => {
                          event.stopPropagation();
                          deleteMjStyleCodePreset(preset.id);
                        }}
                        aria-label={t('node.midjourney.personalization.deletePreset', {
                          name: preset.name,
                        })}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>

                    <div className="mt-2 min-w-0 px-0.5">
                      <div className="truncate text-sm font-medium text-text-dark">
                        {preset.name}
                      </div>
                      <div className="mt-1 truncate text-[11px] text-text-muted">
                        {preset.code}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="rounded-[16px] border border-dashed border-white/10 bg-white/[0.02] px-4 py-8 text-center text-sm text-text-muted">
              {t('node.midjourney.personalization.presetsEmpty')}
            </div>
          )}
        </div>
      </div>
    </UiModal>
  );
}

export const MjStyleCodeDialog = memo(MjStyleCodeDialogComponent);

MjStyleCodeDialog.displayName = 'MjStyleCodeDialog';
