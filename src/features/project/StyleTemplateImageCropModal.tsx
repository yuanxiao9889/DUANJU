import { useEffect, useRef, useState } from "react";
import {
  centerCrop,
  convertToPixelCrop,
  makeAspectCrop,
  type Crop,
  type PixelCrop,
} from "react-image-crop";
import { Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import ReactCrop from "react-image-crop";
import "react-image-crop/dist/ReactCrop.css";

import { UiButton, UiModal } from "@/components/ui";
import { resolveImageDisplayUrl } from "@/features/canvas/application/imageData";
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

interface FittedImageSize {
  width: number;
  height: number;
}

function buildDefaultCrop(width: number, height: number): PixelCrop {
  return convertToPixelCrop(
    centerCrop(
      makeAspectCrop(
        {
          unit: "%",
          width: 84,
        },
        STYLE_TEMPLATE_IMAGE_ASPECT_RATIO,
        width,
        height,
      ),
      width,
      height,
    ),
    width,
    height,
  );
}

function fitImageIntoViewport(
  imageWidth: number,
  imageHeight: number,
  viewportWidth: number,
  viewportHeight: number,
): FittedImageSize {
  const safeImageWidth = Math.max(1, imageWidth);
  const safeImageHeight = Math.max(1, imageHeight);
  const safeViewportWidth = Math.max(1, viewportWidth);
  const safeViewportHeight = Math.max(1, viewportHeight);
  const scale = Math.min(
    safeViewportWidth / safeImageWidth,
    safeViewportHeight / safeImageHeight,
    1,
  );

  return {
    width: Math.max(1, Math.round(safeImageWidth * scale)),
    height: Math.max(1, Math.round(safeImageHeight * scale)),
  };
}

export function StyleTemplateImageCropModal({
  isOpen,
  sourceImageUrl,
  onClose,
  onConfirm,
}: StyleTemplateImageCropModalProps) {
  const { t } = useTranslation();
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const [crop, setCrop] = useState<Crop>();
  const [completedCrop, setCompletedCrop] = useState<PixelCrop | null>(null);
  const [displaySize, setDisplaySize] = useState<FittedImageSize | null>(null);
  const [isConfirming, setIsConfirming] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setCrop(undefined);
      setCompletedCrop(null);
      setDisplaySize(null);
      setIsConfirming(false);
    }
  }, [isOpen, sourceImageUrl]);

  const handleImageLoad = () => {
    const image = imageRef.current;
    const viewport = viewportRef.current;
    if (!image || !viewport) {
      return;
    }

    const nextDisplaySize = fitImageIntoViewport(
      image.naturalWidth,
      image.naturalHeight,
      viewport.clientWidth,
      viewport.clientHeight,
    );
    setDisplaySize(nextDisplaySize);

    const nextCrop = buildDefaultCrop(
      nextDisplaySize.width,
      nextDisplaySize.height,
    );
    setCrop(nextCrop);
    setCompletedCrop(nextCrop);
  };

  const handleConfirm = async () => {
    const image = imageRef.current;
    if (!image || !completedCrop || completedCrop.width <= 0 || completedCrop.height <= 0) {
      return;
    }

    const scaleX = image.naturalWidth / Math.max(1, image.width);
    const scaleY = image.naturalHeight / Math.max(1, image.height);

    setIsConfirming(true);
    try {
      const imageDataUrl = await createStyleTemplateThumbnailDataUrl(
        sourceImageUrl ?? "",
        {
          x: completedCrop.x * scaleX,
          y: completedCrop.y * scaleY,
          width: completedCrop.width * scaleX,
          height: completedCrop.height * scaleY,
        },
      );
      await onConfirm(imageDataUrl);
    } finally {
      setIsConfirming(false);
    }
  };

  return (
    <UiModal
      isOpen={isOpen}
      title={t("styleTemplate.cropImage")}
      onClose={() => {
        if (isConfirming) {
          return;
        }
        onClose();
      }}
      widthClassName="w-[calc(100vw-40px)] max-w-[980px]"
      footer={
        <>
          <UiButton
            type="button"
            variant="ghost"
            disabled={isConfirming}
            onClick={onClose}
          >
            {t("common.cancel")}
          </UiButton>
          <UiButton
            type="button"
            variant="primary"
            disabled={isConfirming || !completedCrop}
            onClick={() => {
              void handleConfirm();
            }}
          >
            {isConfirming ? (
              <>
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                {t("common.saving")}
              </>
            ) : (
              t("styleTemplate.cropConfirm")
            )}
          </UiButton>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-sm leading-6 text-text-muted">
          {t("styleTemplate.cropHint")}
        </p>

        <div className="h-[72vh] min-h-[320px] max-h-[72vh] rounded-2xl border border-white/10 bg-black/20 p-4">
          {sourceImageUrl ? (
            <div
              ref={viewportRef}
              className="flex h-full w-full items-center justify-center overflow-hidden"
            >
              <ReactCrop
                className="shrink-0"
                crop={crop}
                onChange={(nextCrop) => setCrop(nextCrop)}
                onComplete={(pixelCrop) => setCompletedCrop(pixelCrop)}
                aspect={STYLE_TEMPLATE_IMAGE_ASPECT_RATIO}
                keepSelection
                minWidth={48}
                minHeight={64}
                ruleOfThirds
                style={
                  displaySize
                    ? {
                        width: `${displaySize.width}px`,
                        height: `${displaySize.height}px`,
                      }
                    : undefined
                }
              >
                <img
                  ref={imageRef}
                  src={resolveImageDisplayUrl(sourceImageUrl)}
                  alt={t("styleTemplate.templateImage")}
                  className="block select-none"
                  style={
                    displaySize
                      ? {
                          width: `${displaySize.width}px`,
                          height: `${displaySize.height}px`,
                        }
                      : {
                          maxWidth: "100%",
                          maxHeight: "100%",
                        }
                  }
                  onLoad={handleImageLoad}
                />
              </ReactCrop>
            </div>
          ) : null}
        </div>
      </div>
    </UiModal>
  );
}
