import { useTranslation } from "react-i18next";

import { PresetImageCropModal } from "@/components/ui/PresetImageCropModal";
import {
  createStyleTemplateThumbnailDataUrl,
  STYLE_TEMPLATE_IMAGE_ASPECT_RATIO,
} from "@/features/project/styleTemplateImage";

interface StyleTemplateImageCropModalProps {
  isOpen: boolean;
  sourceImageUrl: string | null;
  onClose: () => void;
  onConfirm: (imageDataUrl: string) => Promise<void> | void;
}

export function StyleTemplateImageCropModal({
  isOpen,
  sourceImageUrl,
  onClose,
  onConfirm,
}: StyleTemplateImageCropModalProps) {
  const { t } = useTranslation();
  return (
    <PresetImageCropModal
      isOpen={isOpen}
      sourceImageUrl={sourceImageUrl}
      title={t("styleTemplate.cropImage")}
      hint={t("styleTemplate.cropHint")}
      imageAlt={t("styleTemplate.templateImage")}
      cancelLabel={t("common.cancel")}
      savingLabel={t("common.saving")}
      confirmLabel={t("styleTemplate.cropConfirm")}
      aspectRatio={STYLE_TEMPLATE_IMAGE_ASPECT_RATIO}
      minCropWidth={48}
      minCropHeight={64}
      renderCroppedImage={createStyleTemplateThumbnailDataUrl}
      onClose={onClose}
      onConfirm={onConfirm}
    />
  );
}
