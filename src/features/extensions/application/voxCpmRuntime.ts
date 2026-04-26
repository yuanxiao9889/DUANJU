import {
  prepareNodeAudio,
  type PreparedAudio,
} from '@/features/canvas/application/audioData';
import {
  getExtensionRuntimeStatus,
  runExtensionCommand,
  startExtensionRuntime,
} from '@/commands/extensions';
import {
  VOXCPM2_COMPLETE_EXTENSION_ID,
  type ExtensionRuntimeState,
  type LoadedExtensionPackage,
} from '@/features/extensions/domain/types';

interface VoxCpmGeneratedOutput {
  path: string;
  name?: string;
  duration?: number;
  mimeType?: string;
}

interface VoxCpmGenerateResponse {
  ok: boolean;
  command: string;
  outputs?: VoxCpmGeneratedOutput[];
}

export interface GenerateVoxCpmVoiceDesignRequest {
  text: string;
  voicePrompt: string;
  cfgValue: number;
  inferenceTimesteps: number;
}

export interface GenerateVoxCpmVoiceCloneRequest {
  text: string;
  referenceAudio: string;
  controlText: string;
  cfgValue: number;
  inferenceTimesteps: number;
}

export interface GenerateVoxCpmUltimateCloneRequest {
  text: string;
  referenceAudio: string;
  promptText: string;
  useReferenceAsReference: boolean;
  cfgValue: number;
  inferenceTimesteps: number;
}

export interface GeneratedVoxCpmAudioAsset extends PreparedAudio {
  audioFileName: string | null;
  sourcePath: string | null;
}

export interface ResolvedVoxCpmExtensionState {
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

function normalizeFloat(
  value: number,
  fallback: number,
  min: number,
  max: number
): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, value));
}

function normalizePositiveInteger(
  value: number,
  fallback: number,
  min: number,
  max: number
): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, Math.round(value)));
}

async function prepareGeneratedAudio(
  response: VoxCpmGenerateResponse,
  fallbackPrefix: string
): Promise<GeneratedVoxCpmAudioAsset> {
  const firstOutput = response.outputs?.[0];
  const outputPath = firstOutput?.path ?? null;
  if (!outputPath) {
    throw new Error('The extension runtime did not return an audio file.');
  }

  const preparedAudio = await prepareNodeAudio(outputPath, {
    duration: firstOutput?.duration,
    mimeType: firstOutput?.mimeType ?? 'audio/wav',
  });

  return {
    ...preparedAudio,
    audioFileName: firstOutput?.name ?? getFileNameFromPath(outputPath) ?? `${fallbackPrefix}.wav`,
    sourcePath: outputPath,
  };
}

export async function generateVoxCpmVoiceDesignAudio(
  extensionPackage: LoadedExtensionPackage,
  request: GenerateVoxCpmVoiceDesignRequest
): Promise<GeneratedVoxCpmAudioAsset> {
  const response = await runResilientExtensionCommand<VoxCpmGenerateResponse>(
    extensionPackage,
    'generate_voice_design',
    {
      text: request.text,
      voicePrompt: request.voicePrompt,
      cfgValue: normalizeFloat(request.cfgValue, 1.3, 0.1, 5),
      inferenceTimesteps: normalizePositiveInteger(request.inferenceTimesteps, 10, 1, 40),
      outputPrefix: `voice-design-${Date.now()}`,
    }
  );

  return await prepareGeneratedAudio(response, 'voice-design');
}

export async function generateVoxCpmVoiceCloneAudio(
  extensionPackage: LoadedExtensionPackage,
  request: GenerateVoxCpmVoiceCloneRequest
): Promise<GeneratedVoxCpmAudioAsset> {
  const response = await runResilientExtensionCommand<VoxCpmGenerateResponse>(
    extensionPackage,
    'generate_voice_clone',
    {
      text: request.text,
      referenceAudio: request.referenceAudio,
      controlText: request.controlText,
      cfgValue: normalizeFloat(request.cfgValue, 1.3, 0.1, 5),
      inferenceTimesteps: normalizePositiveInteger(request.inferenceTimesteps, 10, 1, 40),
      outputPrefix: `voice-clone-${Date.now()}`,
    }
  );

  return await prepareGeneratedAudio(response, 'voice-clone');
}

export async function generateVoxCpmUltimateCloneAudio(
  extensionPackage: LoadedExtensionPackage,
  request: GenerateVoxCpmUltimateCloneRequest
): Promise<GeneratedVoxCpmAudioAsset> {
  const response = await runResilientExtensionCommand<VoxCpmGenerateResponse>(
    extensionPackage,
    'generate_ultimate_clone',
    {
      text: request.text,
      referenceAudio: request.referenceAudio,
      promptText: request.promptText,
      useReferenceAsReference: request.useReferenceAsReference,
      cfgValue: normalizeFloat(request.cfgValue, 1.3, 0.1, 5),
      inferenceTimesteps: normalizePositiveInteger(request.inferenceTimesteps, 10, 1, 40),
      outputPrefix: `ultimate-clone-${Date.now()}`,
    }
  );

  return await prepareGeneratedAudio(response, 'ultimate-clone');
}

export function resolveVoxCpmExtensionState(
  packages: Record<string, LoadedExtensionPackage>,
  enabledExtensionIds: string[],
  runtimeById: Record<string, ExtensionRuntimeState>
): ResolvedVoxCpmExtensionState {
  const extensionPackage = packages[VOXCPM2_COMPLETE_EXTENSION_ID] ?? null;
  const runtime = extensionPackage
    ? runtimeById[VOXCPM2_COMPLETE_EXTENSION_ID] ?? null
    : null;

  const readyPackage =
    extensionPackage
    && enabledExtensionIds.includes(VOXCPM2_COMPLETE_EXTENSION_ID)
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
