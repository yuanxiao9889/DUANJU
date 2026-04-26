import {
  prepareNodeImage,
  type PreparedNodeImage,
} from '@/features/canvas/application/imageData';
import {
  getExtensionRuntimeStatus,
  runExtensionCommand,
  startExtensionRuntime,
} from '@/commands/extensions';
import {
  RMBG2_COMPLETE_EXTENSION_ID,
  type ExtensionRuntimeState,
  type LoadedExtensionPackage,
} from '@/features/extensions/domain/types';

interface RmbgGeneratedOutput {
  path: string;
  name?: string;
  mimeType?: string;
}

interface RmbgRemoveBackgroundResponse {
  ok: boolean;
  command: string;
  output?: RmbgGeneratedOutput;
  outputs?: RmbgGeneratedOutput[];
}

export interface RemoveBackgroundWithRmbgRequest {
  imagePath: string;
  outputPrefix?: string;
}

export interface GeneratedRmbgImageAsset extends PreparedNodeImage {
  imageFileName: string | null;
  sourcePath: string | null;
  mimeType: string;
}

export interface ResolvedRmbgExtensionState {
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

export async function removeBackgroundWithRmbg(
  extensionPackage: LoadedExtensionPackage,
  request: RemoveBackgroundWithRmbgRequest
): Promise<GeneratedRmbgImageAsset> {
  const response = await runResilientExtensionCommand<RmbgRemoveBackgroundResponse>(
    extensionPackage,
    'remove_background',
    {
      imagePath: request.imagePath,
      outputPrefix: request.outputPrefix ?? `background-removed-${Date.now()}`,
    }
  );

  const firstOutput = response.output ?? response.outputs?.[0] ?? null;
  const outputPath = firstOutput?.path ?? null;
  if (!outputPath) {
    throw new Error('The RMBG extension runtime did not return a PNG output file.');
  }

  const preparedImage = await prepareNodeImage(outputPath);

  return {
    ...preparedImage,
    imageFileName: firstOutput?.name ?? getFileNameFromPath(outputPath),
    sourcePath: outputPath,
    mimeType: firstOutput?.mimeType ?? 'image/png',
  };
}

export function resolveRmbgExtensionState(
  packages: Record<string, LoadedExtensionPackage>,
  enabledExtensionIds: string[],
  runtimeById: Record<string, ExtensionRuntimeState>
): ResolvedRmbgExtensionState {
  const extensionPackage = packages[RMBG2_COMPLETE_EXTENSION_ID] ?? null;
  const runtime = extensionPackage
    ? runtimeById[RMBG2_COMPLETE_EXTENSION_ID] ?? null
    : null;

  const readyPackage =
    extensionPackage
    && enabledExtensionIds.includes(RMBG2_COMPLETE_EXTENSION_ID)
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
