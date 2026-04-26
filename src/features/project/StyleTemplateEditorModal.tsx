import { useEffect, useMemo, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import {
  UiButton,
  UiInput,
  UiModal,
  UiSelect,
  UiTextArea,
} from "@/components/ui";
import { loadImage, persistImageSource } from "@/commands/image";
import { StyleTemplateCard } from "@/features/project/StyleTemplateCard";
import { StyleTemplateImageCropModal } from "@/features/project/StyleTemplateImageCropModal";
import {
  STYLE_TEMPLATE_UNGROUPED_CATEGORY_ID,
  type StyleTemplate,
  type StyleTemplateCategory,
} from "@/features/project/styleTemplateUtils";

const STYLE_TEMPLATE_IMAGE_VERIFY_ERROR = "style-template-image-verify-error";

interface StyleTemplateEditorModalProps {
  isOpen: boolean;
  title: string;
  initialTemplate?: StyleTemplate | null;
  initialCategoryId: string | null;
  categories: StyleTemplateCategory[];
  onClose: () => void;
  onSave: (input: {
    name: string;
    prompt: string;
    imageUrl: string | null;
    categoryId: string | null;
  }) => Promise<void> | void;
}

const STYLE_TEMPLATE_IMAGE_FILTERS = [
  "png",
  "jpg",
  "jpeg",
  "webp",
  "bmp",
  "gif",
  "avif",
] as const;

export function StyleTemplateEditorModal({
  isOpen,
  title,
  initialTemplate,
  initialCategoryId,
  categories,
  onClose,
  onSave,
}: StyleTemplateEditorModalProps) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [categoryId, setCategoryId] = useState<string>(
    STYLE_TEMPLATE_UNGROUPED_CATEGORY_ID,
  );
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [pendingImageDataUrl, setPendingImageDataUrl] = useState<string | null>(null);
  const [cropSourceImageUrl, setCropSourceImageUrl] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    setName(initialTemplate?.name ?? "");
    setPrompt(initialTemplate?.prompt ?? "");
    setCategoryId(
      initialTemplate?.categoryId ??
        initialCategoryId ??
        STYLE_TEMPLATE_UNGROUPED_CATEGORY_ID,
    );
    setImageUrl(initialTemplate?.imageUrl ?? null);
    setPendingImageDataUrl(null);
    setCropSourceImageUrl(null);
    setIsSaving(false);
    setFormError(null);
  }, [initialCategoryId, initialTemplate, isOpen]);

  const previewImageUrl = pendingImageDataUrl ?? imageUrl;
  const previewTemplate = useMemo<StyleTemplate>(
    () => ({
      id: initialTemplate?.id ?? "__preview__",
      name: name.trim() || t("styleTemplate.templateName"),
      prompt: prompt.trim() || t("styleTemplate.templatePrompt"),
      imageUrl: previewImageUrl,
      categoryId:
        categoryId === STYLE_TEMPLATE_UNGROUPED_CATEGORY_ID ? null : categoryId,
      sortOrder: initialTemplate?.sortOrder ?? 0,
      createdAt: initialTemplate?.createdAt ?? 0,
      updatedAt: initialTemplate?.updatedAt ?? 0,
      lastUsedAt: initialTemplate?.lastUsedAt ?? null,
    }),
    [categoryId, imageUrl, initialTemplate, name, pendingImageDataUrl, prompt, t],
  );

  const handlePickImage = async () => {
    setFormError(null);

    try {
      const selected = await open({
        multiple: false,
        filters: [
          {
            name: "Images",
            extensions: [...STYLE_TEMPLATE_IMAGE_FILTERS],
          },
        ],
      });

      if (!selected || Array.isArray(selected)) {
        return;
      }

      setCropSourceImageUrl(selected);
    } catch (error) {
      console.error("[StyleTemplateEditorModal] failed to pick image", error);
      setFormError(t("styleTemplate.selectImageFailed"));
    }
  };

  const handleSubmit = async () => {
    const trimmedName = name.trim();
    const trimmedPrompt = prompt.trim();
    if (!trimmedName || !trimmedPrompt) {
      return;
    }

    setIsSaving(true);
    setFormError(null);

    try {
      const nextImageUrl = pendingImageDataUrl
        ? await (async () => {
            const persistedImageUrl = await persistImageSource(pendingImageDataUrl);
            try {
              await loadImage(persistedImageUrl);
            } catch (error) {
              console.error(
                "[StyleTemplateEditorModal] persisted style template image could not be reloaded",
                {
                  imageUrl: persistedImageUrl,
                  error,
                },
              );
              throw new Error(STYLE_TEMPLATE_IMAGE_VERIFY_ERROR);
            }
            return persistedImageUrl;
          })()
        : imageUrl;

      await onSave({
        name: trimmedName,
        prompt: trimmedPrompt,
        imageUrl: nextImageUrl,
        categoryId:
          categoryId === STYLE_TEMPLATE_UNGROUPED_CATEGORY_ID ? null : categoryId,
      });
    } catch (error) {
      console.error("[StyleTemplateEditorModal] failed to save template", error);
      setFormError(
        error instanceof Error &&
          error.message === STYLE_TEMPLATE_IMAGE_VERIFY_ERROR
          ? t("styleTemplate.imagePersistVerifyFailed")
          : t("styleTemplate.saveFailed"),
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <>
      <UiModal
        isOpen={isOpen}
        title={title}
        onClose={() => {
          if (!isSaving) {
            onClose();
          }
        }}
        widthClassName="w-[calc(100vw-36px)] max-w-[860px]"
        footer={
          <>
            <UiButton
              type="button"
              variant="ghost"
              disabled={isSaving}
              onClick={onClose}
            >
              {t("common.cancel")}
            </UiButton>
            <UiButton
              type="button"
              variant="primary"
              disabled={!name.trim() || !prompt.trim() || isSaving}
              onClick={() => {
                void handleSubmit();
              }}
            >
              {isSaving ? (
                <>
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                  {t("common.saving")}
                </>
              ) : (
                t("common.save")
              )}
            </UiButton>
          </>
        }
      >
        <div className="grid gap-5 md:grid-cols-[280px_minmax(0,1fr)]">
          <div className="space-y-3">
            <div className="rounded-[28px] border border-white/10 bg-black/10 p-2">
              <StyleTemplateCard template={previewTemplate} />
            </div>

            <div className="flex flex-wrap gap-2">
              <UiButton type="button" variant="muted" onClick={() => void handlePickImage()}>
                {previewImageUrl
                  ? t("styleTemplate.replaceImage")
                  : t("styleTemplate.uploadImage")}
              </UiButton>
              {previewImageUrl ? (
                <UiButton
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setImageUrl(null);
                    setPendingImageDataUrl(null);
                    setFormError(null);
                  }}
                >
                  {t("styleTemplate.removeImage")}
                </UiButton>
              ) : null}
            </div>

            <p className="text-xs leading-5 text-text-muted">
              {t("styleTemplate.imageHint")}
            </p>
          </div>

          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-xs font-medium uppercase tracking-[0.12em] text-text-muted">
                {t("styleTemplate.templateName")}
              </label>
              <UiInput
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={t("styleTemplate.templateNamePlaceholder")}
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs font-medium uppercase tracking-[0.12em] text-text-muted">
                {t("styleTemplate.category")}
              </label>
              <UiSelect
                value={categoryId}
                onChange={(event) => setCategoryId(event.target.value)}
              >
                <option value={STYLE_TEMPLATE_UNGROUPED_CATEGORY_ID}>
                  {t("styleTemplate.uncategorized")}
                </option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </UiSelect>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-medium uppercase tracking-[0.12em] text-text-muted">
                {t("styleTemplate.templatePrompt")}
              </label>
              <UiTextArea
                rows={9}
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder={t("styleTemplate.templatePromptPlaceholder")}
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

      <StyleTemplateImageCropModal
        isOpen={Boolean(cropSourceImageUrl)}
        sourceImageUrl={cropSourceImageUrl}
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
