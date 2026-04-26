import {
  getExtensionRuntimeStatus,
  runExtensionCommand,
  startExtensionRuntime,
} from '@/commands/extensions';
import {
  prepareNodeImage,
  type PreparedNodeImage,
} from '@/features/canvas/application/imageData';
import {
  prepareNodeVideoFromSource,
  type PreparedVideo,
} from '@/features/canvas/application/videoData';
import {
  SEEDVR2_COMPLETE_EXTENSION_ID,
  type ExtensionRuntimeState,
  type LoadedExtensionPackage,
} from '@/features/extensions/domain/types';

interface Seedvr2GeneratedOutput {
  path: string;
  name?: string;
  mimeType?: string;
  width?: number;
  height?: number;
  duration?: number;
}

interface Seedvr2Response {
  ok: boolean;
  command: string;
  output?: Seedvr2GeneratedOutput;
  outputs?: Seedvr2GeneratedOutput[];
}

export interface UpscaleImageWithSeedvr2Request {
  imagePath: string;
  targetResolution: number;
  outputPrefix?: string;
}

export interface UpscaleVideoWithSeedvr2Request {
  videoPath: string;
  targetResolution: number;
  outputPrefix?: string;
}

export interface GeneratedSeedvr2ImageAsset extends PreparedNodeImage {
  imageFileName: string | null;
  sourcePath: string | null;
  mimeType: string;
}

export interface GeneratedSeedvr2VideoAsset extends PreparedVideo {
  videoFileName: string | null;
  sourcePath: string | null;
  mimeType: string;
}

export interface ResolvedSeedvr2ExtensionState {
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

    console.warn(
      `Extension runtime '${extensionPackage.id}' stopped before '${command}', restarting once.`
    );

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

export async function upscaleImageWithSeedvr2(
  extensionPackage: LoadedExtensionPackage,
  request: UpscaleImageWithSeedvr2Request
): Promise<GeneratedSeedvr2ImageAsset> {
  const response = await runResilientExtensionCommand<Seedvr2Response>(
    extensionPackage,
    'upscale_image',
    {
      imagePath: request.imagePath,
      targetResolution: request.targetResolution,
      outputPrefix: request.outputPrefix ?? `seedvr2-image-${Date.now()}`,
    }
  );

  const firstOutput = response.output ?? response.outputs?.[0] ?? null;
  const outputPath = firstOutput?.path ?? null;
  if (!outputPath) {
    throw new Error('The SeedVR2 runtime did not return an upscaled image file.');
  }

  const preparedImage = await prepareNodeImage(outputPath);

  return {
    ...preparedImage,
    imageFileName: firstOutput?.name ?? getFileNameFromPath(outputPath),
    sourcePath: outputPath,
    mimeType: firstOutput?.mimeType ?? 'image/png',
  };
}

export async function upscaleVideoWithSeedvr2(
  extensionPackage: LoadedExtensionPackage,
  request: UpscaleVideoWithSeedvr2Request
): Promise<GeneratedSeedvr2VideoAsset> {
  const response = await runResilientExtensionCommand<Seedvr2Response>(
    extensionPackage,
    'upscale_video',
    {
      videoPath: request.videoPath,
      targetResolution: request.targetResolution,
      outputPrefix: request.outputPrefix ?? `seedvr2-video-${Date.now()}`,
    }
  );

  const firstOutput = response.output ?? response.outputs?.[0] ?? null;
  const outputPath = firstOutput?.path ?? null;
  if (!outputPath) {
    throw new Error('The SeedVR2 runtime did not return an upscaled video file.');
  }

  const preparedVideo = await prepareNodeVideoFromSource(outputPath);

  return {
    ...preparedVideo,
    videoFileName: firstOutput?.name ?? getFileNameFromPath(outputPath),
    sourcePath: outputPath,
    mimeType: firstOutput?.mimeType ?? 'video/mp4',
  };
}

export function resolveSeedvr2ExtensionState(
  packages: Record<string, LoadedExtensionPackage>,
  enabledExtensionIds: string[],
  runtimeById: Record<string, ExtensionRuntimeState>
): ResolvedSeedvr2ExtensionState {
  const extensionPackage = packages[SEEDVR2_COMPLETE_EXTENSION_ID] ?? null;
  const runtime = extensionPackage
    ? runtimeById[SEEDVR2_COMPLETE_EXTENSION_ID] ?? null
    : null;

  const readyPackage =
    extensionPackage
    && enabledExtensionIds.includes(SEEDVR2_COMPLETE_EXTENSION_ID)
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
