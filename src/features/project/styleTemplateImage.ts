import { blobToDataUrl, loadImageElement } from "@/features/canvas/application/imageData";

export const STYLE_TEMPLATE_IMAGE_ASPECT_RATIO = 3 / 4;
export const STYLE_TEMPLATE_IMAGE_RATIO_LABEL = "3:4";
export const STYLE_TEMPLATE_IMAGE_OUTPUT_WIDTH = 720;
export const STYLE_TEMPLATE_IMAGE_OUTPUT_HEIGHT = 960;
export const STYLE_TEMPLATE_IMAGE_OUTPUT_QUALITY = 0.86;

export interface StyleTemplateImageCropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  mimeType: string,
  quality?: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
          return;
        }
        reject(new Error("Failed to render style template thumbnail."));
      },
      mimeType,
      quality,
    );
  });
}

export async function createStyleTemplateThumbnailDataUrl(
  sourceImageUrl: string,
  cropRect: StyleTemplateImageCropRect,
): Promise<string> {
  const image = await loadImageElement(sourceImageUrl);
  const naturalWidth = Math.max(1, image.naturalWidth);
  const naturalHeight = Math.max(1, image.naturalHeight);

  const cropX = clamp(Math.round(cropRect.x), 0, naturalWidth - 1);
  const cropY = clamp(Math.round(cropRect.y), 0, naturalHeight - 1);
  const cropWidth = clamp(Math.round(cropRect.width), 1, naturalWidth - cropX);
  const cropHeight = clamp(Math.round(cropRect.height), 1, naturalHeight - cropY);

  const canvas = document.createElement("canvas");
  canvas.width = STYLE_TEMPLATE_IMAGE_OUTPUT_WIDTH;
  canvas.height = STYLE_TEMPLATE_IMAGE_OUTPUT_HEIGHT;

  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Failed to create style template thumbnail context.");
  }

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(
    image,
    cropX,
    cropY,
    cropWidth,
    cropHeight,
    0,
    0,
    STYLE_TEMPLATE_IMAGE_OUTPUT_WIDTH,
    STYLE_TEMPLATE_IMAGE_OUTPUT_HEIGHT,
  );

  const blob = await canvasToBlob(
    canvas,
    "image/jpeg",
    STYLE_TEMPLATE_IMAGE_OUTPUT_QUALITY,
  );
  return await blobToDataUrl(blob);
}
