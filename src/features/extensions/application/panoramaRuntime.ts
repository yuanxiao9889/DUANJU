import {
  getExtensionRuntimeStatus,
  runExtensionCommand,
  startExtensionRuntime,
} from '@/commands/extensions';
import {
  prepareNodeImage,
  persistImageLocally,
  type PreparedNodeImage,
} from '@/features/canvas/application/imageData';
import type {
  PanoramaOutputResolution,
  PanoramaSceneClass,
} from '@/features/canvas/domain/canvasNodes';
import {
  HUNYUANWORLD_PANORAMA_EXTENSION_ID,
  type ExtensionRuntimeState,
  type LoadedExtensionPackage,
} from '@/features/extensions/domain/types';

interface PanoramaCommandOutput {
  path: string;
  name?: string;
  width?: number;
  height?: number;
  aspectRatio?: string;
}

interface PanoramaCommandResponse {
  ok: boolean;
  command: string;
  outputs?: PanoramaCommandOutput[];
}

export interface GeneratePanoramaRequest {
  imagePath: string;
  prompt: string;
  outputResolution: PanoramaOutputResolution;
  sceneClass: PanoramaSceneClass;
  useCache: boolean;
  useFp8Attention: boolean;
  useFp8Gemm: boolean;
  outputPrefix?: string;
}

export interface ExtractPanoramaPerspectiveRequest {
  panoramaImagePath: string;
  yaw: number;
  pitch: number;
  fov: number;
  width: number;
  height: number;
  outputPrefix?: string;
}

export interface GeneratedPanoramaAsset extends PreparedNodeImage {
  fileName: string | null;
  sourcePath: string | null;
}

export interface ResolvedPanoramaExtensionState {
  readyPackage: LoadedExtensionPackage | null;
  pendingPackage: LoadedExtensionPackage | null;
  runtime: ExtensionRuntimeState | null;
}

function resolveCommandErrorMessage(error: unknown): string | null {
  if (error instanceof Error) {
    const message = error.message.trim();
    return message.length > 0 ? message : null;
  }

  if (typeof error === 'string') {
    const message = error.trim();
    return message.length > 0 ? message : null;
  }

  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>;
    const candidate = [
      record.message,
      record.error,
      record.details,
      record.msg,
    ].find((value) => typeof value === 'string' && value.trim().length > 0);

    if (typeof candidate === 'string') {
      return candidate.trim();
    }

    try {
      return JSON.stringify(record);
    } catch {
      return null;
    }
  }

  return null;
}

function createCommandError(error: unknown, fallbackMessage: string): Error {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error;
  }

  return new Error(resolveCommandErrorMessage(error) ?? fallbackMessage);
}

function shouldRetryPersistentRuntimeCommand(errorMessage: string | null): boolean {
  const normalizedMessage = errorMessage?.toLowerCase() ?? '';
  return normalizedMessage.includes('is not started')
    || normalizedMessage.includes('start the extension first')
    || normalizedMessage.includes('exited unexpectedly');
}

async function runResilientExtensionCommand<TResponse = Record<string, unknown>>(
  extensionPackage: LoadedExtensionPackage,
  command: string,
  payload?: Record<string, unknown>
): Promise<TResponse> {
  const executeCommand = async () => await runExtensionCommand<TResponse>(
    extensionPackage.folderPath,
    command,
    payload
  );

  try {
    return await executeCommand();
  } catch (error) {
    const initialMessage = resolveCommandErrorMessage(error);
    if (
      extensionPackage.runtime !== 'python-bridge'
      || !shouldRetryPersistentRuntimeCommand(initialMessage)
    ) {
      throw createCommandError(error, `Extension command '${command}' failed.`);
    }

    const runtimeStatus = await getExtensionRuntimeStatus(extensionPackage.folderPath)
      .catch(() => null);
    if (runtimeStatus?.running) {
      throw createCommandError(error, `Extension command '${command}' failed.`);
    }

    await startExtensionRuntime(extensionPackage.folderPath);

    try {
      return await executeCommand();
    } catch (retryError) {
      throw createCommandError(
        retryError,
        initialMessage ?? `Extension command '${command}' failed.`
      );
    }
  }
}

function getFileNameFromPath(filePath: string): string | null {
  const normalized = filePath.trim().replace(/\\/g, '/');
  if (!normalized) {
    return null;
  }

  const parts = normalized.split('/');
  return parts[parts.length - 1] || null;
}

function clampNumber(value: number, fallback: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, value));
}

function clampInteger(value: number, fallback: number, min: number, max: number): number {
  return Math.round(clampNumber(value, fallback, min, max));
}

async function prepareGeneratedImageAsset(
  response: PanoramaCommandResponse,
  fallbackPrefix: string
): Promise<GeneratedPanoramaAsset> {
  const firstOutput = response.outputs?.[0];
  const outputPath = firstOutput?.path ?? null;
  if (!outputPath) {
    throw new Error('The panorama extension did not return an image file.');
  }

  const preparedImage = await prepareNodeImage(outputPath);

  return {
    ...preparedImage,
    fileName: firstOutput?.name ?? getFileNameFromPath(outputPath) ?? `${fallbackPrefix}.png`,
    sourcePath: outputPath,
  };
}

export async function generatePanoramaImage(
  extensionPackage: LoadedExtensionPackage,
  request: GeneratePanoramaRequest
): Promise<GeneratedPanoramaAsset> {
  const localImagePath = await persistImageLocally(request.imagePath);
  const response = await runResilientExtensionCommand<PanoramaCommandResponse>(
    extensionPackage,
    'generate_panorama',
    {
      imagePath: localImagePath,
      prompt: request.prompt.trim(),
      outputResolution: request.outputResolution,
      sceneClass: request.sceneClass,
      useCache: request.useCache,
      useFp8Attention: request.useFp8Attention,
      useFp8Gemm: request.useFp8Gemm,
      outputPrefix: request.outputPrefix ?? `panorama-${Date.now()}`,
    }
  );

  return await prepareGeneratedImageAsset(response, 'panorama');
}

export async function extractPanoramaPerspectiveView(
  extensionPackage: LoadedExtensionPackage,
  request: ExtractPanoramaPerspectiveRequest
): Promise<GeneratedPanoramaAsset> {
  const localPanoramaPath = await persistImageLocally(request.panoramaImagePath);
  const response = await runResilientExtensionCommand<PanoramaCommandResponse>(
    extensionPackage,
    'extract_perspective',
    {
      panoramaImagePath: localPanoramaPath,
      yaw: clampNumber(request.yaw, 0, -180, 180),
      pitch: clampNumber(request.pitch, 0, -89, 89),
      fov: clampNumber(request.fov, 90, 30, 120),
      width: clampInteger(request.width, 1280, 256, 4096),
      height: clampInteger(request.height, 720, 256, 4096),
      outputPrefix: request.outputPrefix ?? `perspective-${Date.now()}`,
    }
  );

  return await prepareGeneratedImageAsset(response, 'panorama-view');
}

export function resolvePanoramaExtensionState(
  packages: Record<string, LoadedExtensionPackage>,
  enabledExtensionIds: string[],
  runtimeById: Record<string, ExtensionRuntimeState>
): ResolvedPanoramaExtensionState {
  const extensionPackage = packages[HUNYUANWORLD_PANORAMA_EXTENSION_ID] ?? null;
  const runtime = extensionPackage
    ? runtimeById[HUNYUANWORLD_PANORAMA_EXTENSION_ID] ?? null
    : null;

  const readyPackage =
    extensionPackage
    && enabledExtensionIds.includes(HUNYUANWORLD_PANORAMA_EXTENSION_ID)
    && runtime?.status === 'ready'
      ? extensionPackage
      : null;

  const pendingPackage =
    readyPackage
    ?? (
      extensionPackage && runtime?.status === 'starting'
        ? extensionPackage
        : null
    );

  return {
    readyPackage,
    pendingPackage,
    runtime,
  };
}
