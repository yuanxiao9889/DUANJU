import type { CameraParamsSelection } from "@/features/canvas/domain/canvasNodes";
import {
  normalizeCameraParamsSelection,
  resolveCameraBodyPreset,
  resolveCameraLensPreset,
} from "@/features/canvas/camera/cameraPresets";

export function buildCameraSetupPrompt(
  value: Partial<CameraParamsSelection> | null | undefined,
): string {
  const normalized = normalizeCameraParamsSelection(value);
  const cameraBody = resolveCameraBodyPreset(normalized.cameraBodyId);
  const lens = resolveCameraLensPreset(normalized.lensId);
  const promptParts: string[] = [];

  if (cameraBody) {
    promptParts.push(cameraBody.fallbackLabel);
  }
  if (lens) {
    promptParts.push(lens.fallbackLabel);
  }
  if (normalized.focalLengthMm) {
    promptParts.push(`${normalized.focalLengthMm}mm`);
  }
  if (normalized.aperture) {
    promptParts.push(normalized.aperture);
  }

  if (promptParts.length === 0) {
    return "";
  }

  return `Camera setup: ${promptParts.join(", ")}.`;
}

export function appendCameraParamsToPrompt(
  prompt: string,
  value: Partial<CameraParamsSelection> | null | undefined,
): string {
  const normalizedPrompt = prompt.trim();
  const cameraSetupPrompt = buildCameraSetupPrompt(value);

  if (!cameraSetupPrompt) {
    return normalizedPrompt;
  }

  if (!normalizedPrompt) {
    return cameraSetupPrompt;
  }

  return `${normalizedPrompt}\n\n${cameraSetupPrompt}`;
}
