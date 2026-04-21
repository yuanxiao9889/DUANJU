import { useEffect, useMemo, useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { ImagePlus, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { loadImage, persistImageSource } from '@/commands/image';
import { UiButton, UiInput, UiModal } from '@/components/ui';
import { PresetImageCropModal } from '@/components/ui/PresetImageCropModal';
import {
  normalizeMjPersonalizationCode,
  parseMjPersonalizationCodeInput,
  type MjStyleCodePreset,
} from '@/features/midjourney/domain/styleCodePresets';
import { MjStyleCodePresetCard } from '@/features/midjourney/ui/MjStyleCodePresetCard';
import {
  createMjStyleCodeThumbnailDataUrl,
  MJ_STYLE_CODE_IMAGE_ASPECT_RATIO,
} from '@/features/project/styleTemplateImage';
import { useSettingsStore } from '@/stores/settingsStore';

interface MjStyleCodeEditorModalProps {
  isOpen: boolean;
  initialPreset?: MjStyleCodePreset | null;
  onClose: () => void;
  onSaved: (payload: {
    preset: MjStyleCodePreset;
    previousCode: string | null;
  }) => void;
}

const MJ_STYLE_CODE_IMAGE_VERIFY_ERROR = 'mj-style-code-image-verify-error';
const MJ_STYLE_CODE_IMAGE_FILTERS = ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif', 'avif'] as const;

function normalizeEditorCodeInput(value: string): string {
  return (
    parseMjPersonalizationCodeInput(value)[0] ??
    normalizeMjPersonalizationCode(value)
  );
}

export function MjStyleCodeEditorModal({
  isOpen,
  initialPreset = null,
  onClose,
  onSaved,
}: MjStyleCodeEditorModalProps) {
  const { t } = useTranslation();
  const presets = useSettingsStore((state) => state.mjStyleCodePresets);
  const addMjStyleCodePreset = useSettingsStore((state) => state.addMjStyleCodePreset);
  const updateMjStyleCodePreset = useSettingsStore((state) => state.updateMjStyleCodePreset);
  const deleteMjStyleCodePreset = useSettingsStore((state) => state.deleteMjStyleCodePreset);

  const [titleValue, setTitleValue] = useState('');
  const [code, setCode] = useState('');
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [pendingImageDataUrl, setPendingImageDataUrl] = useState<string | null>(null);
  const [cropSourceImageUrl, setCropSourceImageUrl] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    setTitleValue(initialPreset?.name ?? '');
    setCode(initialPreset?.code ?? '');
    setImageUrl(initialPreset?.imageUrl ?? null);
    setPendingImageDataUrl(null);
    setCropSourceImageUrl(null);
    setIsSaving(false);
    setFormError(null);
  }, [initialPreset, isOpen]);

  const normalizedTitle = titleValue.trim();
  const normalizedPreviewCode = normalizeEditorCodeInput(code);
  const previewPreset = useMemo<MjStyleCodePreset>(
    () => ({
      id: initialPreset?.id ?? '__preview__',
      name: normalizedTitle || t('node.midjourney.personalization.previewName'),
      code: normalizedPreviewCode,
      imageUrl: pendingImageDataUrl ?? imageUrl,
      sortOrder: initialPreset?.sortOrder ?? 0,
      createdAt: initialPreset?.createdAt ?? 0,
      updatedAt: initialPreset?.updatedAt ?? 0,
      lastUsedAt: initialPreset?.lastUsedAt ?? null,
    }),
    [imageUrl, initialPreset, normalizedPreviewCode, normalizedTitle, pendingImageDataUrl, t]
  );

  const handlePickImage = async () => {
    setFormError(null);

    try {
      const selected = await open({
        multiple: false,
        filters: [
          {
            name: 'Images',
            extensions: [...MJ_STYLE_CODE_IMAGE_FILTERS],
          },
        ],
      });

      if (!selected || Array.isArray(selected)) {
        return;
      }

      setCropSourceImageUrl(selected);
    } catch (error) {
      console.error('[MjStyleCodeEditorModal] failed to pick image', error);
      setFormError(t('node.midjourney.personalization.selectImageFailed'));
    }
  };

  const resolvePersistedImageUrl = async (): Promise<string | null> => {
    if (!pendingImageDataUrl) {
      return imageUrl;
    }

    const persistedImageUrl = await persistImageSource(pendingImageDataUrl);
    try {
      await loadImage(persistedImageUrl);
    } catch (error) {
      console.error('[MjStyleCodeEditorModal] persisted preset image could not be reloaded', {
        imageUrl: persistedImageUrl,
        error,
      });
      throw new Error(MJ_STYLE_CODE_IMAGE_VERIFY_ERROR);
    }

    return persistedImageUrl;
  };

  const handleSubmit = async () => {
    const nextTitle = titleValue.trim();
    const normalizedCode = normalizeEditorCodeInput(code);
    if (!nextTitle) {
      setFormError(t('node.midjourney.personalization.titleRequired'));
      return;
    }
    if (!normalizedCode) {
      setFormError(t('node.midjourney.personalization.inputRequired'));
      return;
    }

    setIsSaving(true);
    setFormError(null);

    try {
      const nextImageUrl = await resolvePersistedImageUrl();
      const hasImageMutation =
        pendingImageDataUrl !== null || imageUrl !== (initialPreset?.imageUrl ?? null);
      const duplicatePreset =
        presets.find(
          (preset) => preset.code === normalizedCode && preset.id !== initialPreset?.id
        ) ?? null;
      const nextUpdates: Partial<Pick<MjStyleCodePreset, 'name' | 'code' | 'imageUrl'>> = {
        name: nextTitle,
        code: normalizedCode,
        ...(hasImageMutation ? { imageUrl: nextImageUrl } : {}),
      };

      let resolvedPresetId = initialPreset?.id ?? '';

      if (duplicatePreset) {
        updateMjStyleCodePreset(duplicatePreset.id, nextUpdates);
        if (initialPreset) {
          deleteMjStyleCodePreset(initialPreset.id);
        }
        resolvedPresetId = duplicatePreset.id;
      } else if (initialPreset) {
        updateMjStyleCodePreset(initialPreset.id, nextUpdates);
        resolvedPresetId = initialPreset.id;
      } else {
        resolvedPresetId = addMjStyleCodePreset({
          name: nextTitle,
          code: normalizedCode,
          imageUrl: nextImageUrl,
        });
      }

      const latestPreset =
        useSettingsStore
          .getState()
          .mjStyleCodePresets.find((preset) => preset.id === resolvedPresetId) ??
        ({
          id: resolvedPresetId || '__unknown__',
          name: nextTitle,
          code: normalizedCode,
          imageUrl: nextImageUrl,
          sortOrder: duplicatePreset?.sortOrder ?? initialPreset?.sortOrder ?? 0,
          createdAt: duplicatePreset?.createdAt ?? initialPreset?.createdAt ?? Date.now(),
          updatedAt: Date.now(),
          lastUsedAt: duplicatePreset?.lastUsedAt ?? initialPreset?.lastUsedAt ?? null,
        } satisfies MjStyleCodePreset);

      onSaved({
        preset: latestPreset,
        previousCode: initialPreset?.code ?? null,
      });
    } catch (error) {
      console.error('[MjStyleCodeEditorModal] failed to save preset', error);
      setFormError(
        error instanceof Error && error.message === MJ_STYLE_CODE_IMAGE_VERIFY_ERROR
          ? t('node.midjourney.personalization.imagePersistVerifyFailed')
          : t('node.midjourney.personalization.editorSaveFailed')
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <>
      <UiModal
        isOpen={isOpen}
        title={
          initialPreset
            ? t('node.midjourney.personalization.editPreset')
            : t('node.midjourney.personalization.newPreset')
        }
        onClose={() => {
          if (!isSaving) {
            onClose();
          }
        }}
        widthClassName="w-[calc(100vw-36px)] max-w-[820px]"
        footer={
          <>
            <UiButton
              type="button"
              variant="ghost"
              disabled={isSaving}
              onClick={onClose}
            >
              {t('common.cancel')}
            </UiButton>
            <UiButton
              type="button"
              variant="primary"
              disabled={!normalizedTitle || !normalizeEditorCodeInput(code) || isSaving}
              onClick={() => {
                void handleSubmit();
              }}
            >
              {isSaving ? (
                <>
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                  {t('common.saving')}
                </>
              ) : (
                t('common.save')
              )}
            </UiButton>
          </>
        }
      >
        <div className="grid gap-5 md:grid-cols-[260px_minmax(0,1fr)]">
          <div className="space-y-3">
            <MjStyleCodePresetCard preset={previewPreset} />

            <div className="flex flex-wrap gap-2">
              <UiButton
                type="button"
                variant="muted"
                onClick={() => void handlePickImage()}
              >
                <ImagePlus className="mr-1 h-4 w-4" />
                {previewPreset.imageUrl
                  ? t('node.midjourney.personalization.replaceCover')
                  : t('node.midjourney.personalization.uploadCover')}
              </UiButton>
              {previewPreset.imageUrl ? (
                <UiButton
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setImageUrl(null);
                    setPendingImageDataUrl(null);
                    setFormError(null);
                  }}
                >
                  {t('node.midjourney.personalization.removeCover')}
                </UiButton>
              ) : null}
            </div>

            <p className="text-xs leading-5 text-text-muted">
              {t('node.midjourney.personalization.coverHint')}
            </p>
          </div>

          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-xs font-medium uppercase tracking-[0.12em] text-text-muted">
                {t('node.midjourney.personalization.titleLabel')}
              </label>
              <UiInput
                value={titleValue}
                onChange={(event) => {
                  setTitleValue(event.target.value);
                  if (formError) {
                    setFormError(null);
                  }
                }}
                placeholder={t('node.midjourney.personalization.titlePlaceholder')}
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs font-medium uppercase tracking-[0.12em] text-text-muted">
                {t('node.midjourney.personalization.customInputLabel')}
              </label>
              <UiInput
                value={code}
                onChange={(event) => {
                  setCode(normalizeEditorCodeInput(event.target.value));
                  if (formError) {
                    setFormError(null);
                  }
                }}
                placeholder={t('node.midjourney.personalization.customInputPlaceholder')}
              />
            </div>

            {formError ? (
              <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
                {formError}
              </div>
            ) : null}
          </div>
        </div>
      </UiModal>

      <PresetImageCropModal
        isOpen={Boolean(cropSourceImageUrl)}
        sourceImageUrl={cropSourceImageUrl}
        title={t('node.midjourney.personalization.cropTitle')}
        hint={t('node.midjourney.personalization.cropHint')}
        imageAlt={t('node.midjourney.personalization.coverAlt')}
        cancelLabel={t('common.cancel')}
        savingLabel={t('common.saving')}
        confirmLabel={t('node.midjourney.personalization.cropConfirm')}
        aspectRatio={MJ_STYLE_CODE_IMAGE_ASPECT_RATIO}
        minCropWidth={64}
        minCropHeight={48}
        renderCroppedImage={createMjStyleCodeThumbnailDataUrl}
        onClose={() => setCropSourceImageUrl(null)}
        onConfirm={async (imageDataUrl) => {
          setPendingImageDataUrl(imageDataUrl);
          setCropSourceImageUrl(null);
          setFormError(null);
        }}
      />
    </>
  );
}
