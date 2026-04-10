import {
  prepareNodeAudio,
  prepareNodeAudioFromFile,
  type PreparedAudio,
} from '@/features/canvas/application/audioData';
import type {
  QwenTtsOutputFormat,
  QwenTtsPauseConfig,
  TtsVoiceDesignNodeData,
} from '@/features/canvas/domain/canvasNodes';
import {
  getExtensionRuntimeStatus,
  runExtensionCommand,
  startExtensionRuntime,
} from '@/commands/extensions';

import { createMockQwenTtsAudioFile } from './mockQwenTts';
import {
  HUNYUANWORLD_PANORAMA_EXTENSION_ID,
  QWEN_TTS_COMPLETE_EXTENSION_ID,
  QWEN_TTS_SIMPLE_EXTENSION_ID,
  type ExtensionRuntimeState,
  type ExtensionStartupStep,
  type LoadedExtensionPackage,
} from '@/features/extensions/domain/types';

const REAL_STEP_MAX_DELAY_MS = 220;
const SIMULATED_STEP_DURATION_FALLBACK_MS = 260;
const QWEN_TTS_EXTENSION_PRIORITY = [
  QWEN_TTS_COMPLETE_EXTENSION_ID,
  QWEN_TTS_SIMPLE_EXTENSION_ID,
] as const;

type QwenTtsVoicePreset = TtsVoiceDesignNodeData['stylePreset'];
type QwenTtsVoiceLanguage = TtsVoiceDesignNodeData['language'];

interface ExtensionHealthResponse {
  ok: boolean;
  command: 'health';
  checks: Record<string, boolean>;
}

interface ExtensionListedModel {
  id: string;
  path: string;
  exists: boolean;
}

interface ExtensionListModelsResponse {
  ok: boolean;
  command: 'list_models';
  models: ExtensionListedModel[];
}

interface QwenTtsGeneratedOutput {
  path: string;
  name?: string;
  duration?: number;
  mimeType?: string;
}

interface QwenTtsGenerateVoiceDesignResponse {
  ok: boolean;
  command: 'generate_voice_design';
  outputs?: QwenTtsGeneratedOutput[];
  files?: string[];
}

interface QwenTtsCreateVoiceClonePromptResponse {
  ok: boolean;
  command: 'create_voice_clone_prompt';
  promptFile?: string;
  promptLabel?: string;
}

interface QwenTtsGenerateVoiceCloneResponse {
  ok: boolean;
  command: 'generate_voice_clone';
  outputs?: QwenTtsGeneratedOutput[];
  files?: string[];
}

interface QwenTtsWarmupResponse {
  ok: boolean;
  command: 'warmup';
  warmedModels?: Array<{
    model: string;
    device: string;
    elapsedMs: number;
  }>;
  cachedModels?: string[];
}

export interface GenerateQwenTtsVoiceDesignRequest extends QwenTtsPauseConfig {
  text: string;
  voicePrompt: string;
  stylePreset: QwenTtsVoicePreset;
  language: QwenTtsVoiceLanguage;
  outputFormat?: QwenTtsOutputFormat;
  speakingRate: number;
  pitch: number;
  maxNewTokens: number;
  topP: number;
  topK: number;
  temperature: number;
  repetitionPenalty: number;
}

export interface CreateQwenTtsSavedVoicePromptRequest {
  refAudio: string;
  refText: string;
  voiceName: string;
}

export interface SavedQwenTtsVoicePromptAsset {
  promptFile: string;
  promptLabel: string;
}

export interface GenerateQwenTtsSavedVoiceRequest extends QwenTtsPauseConfig {
  text: string;
  language: QwenTtsVoiceLanguage;
  outputFormat?: QwenTtsOutputFormat;
  voiceName: string;
  promptFile: string;
  maxNewTokens: number;
  topP: number;
  topK: number;
  temperature: number;
  repetitionPenalty: number;
}

export interface GeneratedQwenTtsAudioAsset extends PreparedAudio {
  audioFileName: string | null;
  sourcePath: string | null;
}

export interface ResolvedQwenTtsExtensionState {
  readyPackage: LoadedExtensionPackage | null;
  pendingPackage: LoadedExtensionPackage | null;
  runtime: ExtensionRuntimeState | null;
}

function sleep(durationMs: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, durationMs);
  });
}

async function withMinimumDuration<T>(
  work: Promise<T>,
  durationMs: number
): Promise<T> {
  const startedAt = Date.now();

  try {
    const result = await work;
    const remainingMs = Math.max(0, durationMs - (Date.now() - startedAt));
    if (remainingMs > 0) {
      await sleep(remainingMs);
    }
    return result;
  } catch (error) {
    const remainingMs = Math.max(0, durationMs - (Date.now() - startedAt));
    if (remainingMs > 0) {
      await sleep(remainingMs);
    }
    throw error;
  }
}

function resolveStepDelay(step: ExtensionStartupStep): number {
  const durationMs = step.durationMs ?? SIMULATED_STEP_DURATION_FALLBACK_MS;
  return Math.max(80, Math.min(durationMs, REAL_STEP_MAX_DELAY_MS));
}

function ensurePackageHasPythonEntry(extensionPackage: LoadedExtensionPackage): void {
  if (extensionPackage.runtime !== 'python-bridge') {
    return;
  }

  if (!extensionPackage.entry || extensionPackage.entry.kind !== 'python') {
    throw new Error('The extension package is missing a valid Python runtime entry.');
  }

  if (!extensionPackage.entry.python || !extensionPackage.entry.script) {
    throw new Error('The extension package is missing its Python executable or runner script.');
  }
}

function formatHealthCheckLabel(
  extensionPackage: LoadedExtensionPackage,
  checkName: string
): string {
  if (extensionPackage.id === HUNYUANWORLD_PANORAMA_EXTENSION_ID) {
    switch (checkName) {
      case 'repo':
        return 'local HunyuanWorld repo';
      case 'script':
        return 'panorama entry script';
      case 'outputsDir':
        return 'outputs folder';
      case 'numpy':
        return 'NumPy';
      case 'pillow':
        return 'Pillow';
      default:
        break;
    }
  }

  switch (checkName) {
    case 'python':
      return 'embedded Python runtime';
    case 'qwen_tts':
      return 'qwen_tts package';
    case 'base':
      return 'Base model';
    case 'voiceDesign':
      return 'VoiceDesign model';
    case 'tokenizer':
      return 'Tokenizer model';
    case 'sox':
      return 'SoX tools';
    default:
      return checkName;
  }
}

function formatListedModelLabel(
  extensionPackage: LoadedExtensionPackage,
  modelId: string
): string {
  if (extensionPackage.id === HUNYUANWORLD_PANORAMA_EXTENSION_ID) {
    if (modelId === 'hunyuanworld-panogen') {
      return 'HunyuanWorld panorama script';
    }

    return modelId;
  }

  switch (modelId) {
    case 'voice_design':
      return 'VoiceDesign model';
    case 'base':
      return 'Base model';
    case 'tokenizer':
      return 'Tokenizer model';
    default:
      return modelId;
  }
}

function describeFailedHealthChecks(
  extensionPackage: LoadedExtensionPackage,
  failedChecks: string[]
): string {
  if (extensionPackage.id === HUNYUANWORLD_PANORAMA_EXTENSION_ID) {
    const hints: string[] = [];

    if (failedChecks.includes('repo')) {
      hints.push('set HUNYUANWORLD_REPO to your local HunyuanWorld-1.0 checkout');
    }

    if (failedChecks.includes('script')) {
      hints.push('make sure demo_panogen.py exists, or set HUNYUANWORLD_SCRIPT to the correct entry file');
    }

    if (failedChecks.includes('numpy') || failedChecks.includes('pillow')) {
      hints.push('use a Python environment with NumPy and Pillow available via HUNYUANWORLD_PYTHON or your system python');
    }

    const remainingChecks = failedChecks.filter(
      (checkName) => !['repo', 'script', 'numpy', 'pillow'].includes(checkName)
    );
    if (remainingChecks.length > 0) {
      hints.push(
        `check ${remainingChecks.map((checkName) => formatHealthCheckLabel(extensionPackage, checkName)).join(', ')}`
      );
    }

    return hints.length > 0
      ? `${extensionPackage.name} setup is incomplete: ${hints.join('; ')}.`
      : `${extensionPackage.name} runtime checks failed.`;
  }

  return `${extensionPackage.name} runtime checks failed: ${failedChecks
    .map((checkName) => formatHealthCheckLabel(extensionPackage, checkName))
    .join(', ')}.`;
}

function describeMissingModels(
  extensionPackage: LoadedExtensionPackage,
  missingModels: string[]
): string {
  if (extensionPackage.id === HUNYUANWORLD_PANORAMA_EXTENSION_ID) {
    return `${extensionPackage.name} could not find the local panorama script. Check HUNYUANWORLD_REPO, and set HUNYUANWORLD_SCRIPT if your entry file is not demo_panogen.py.`;
  }

  return `${extensionPackage.name} is missing required assets: ${missingModels
    .map((modelId) => formatListedModelLabel(extensionPackage, modelId))
    .join(', ')}.`;
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

async function verifyPythonRuntime(
  extensionPackage: LoadedExtensionPackage
): Promise<void> {
  const response = await runExtensionCommand<ExtensionHealthResponse>(
    extensionPackage.folderPath,
    'health'
  );

  const failedChecks = Object.entries(response.checks ?? {})
    .filter(([, passed]) => !passed)
    .map(([checkName]) => checkName);

  if (failedChecks.length > 0) {
    throw new Error(describeFailedHealthChecks(extensionPackage, failedChecks));
  }
}

async function verifyPythonModels(
  extensionPackage: LoadedExtensionPackage
): Promise<void> {
  const response = await runExtensionCommand<ExtensionListModelsResponse>(
    extensionPackage.folderPath,
    'list_models'
  );

  const missingModels = (response.models ?? [])
    .filter((model) => !model.exists)
    .map((model) => model.id);

  if (missingModels.length > 0) {
    throw new Error(describeMissingModels(extensionPackage, missingModels));
  }
}

async function warmupPythonRuntime(
  extensionPackage: LoadedExtensionPackage
): Promise<void> {
  await runResilientExtensionCommand<QwenTtsWarmupResponse>(
    extensionPackage,
    'warmup',
    {
      models: ['voice_design', 'base'],
    }
  );
}

export async function runExtensionStartupStep(
  extensionPackage: LoadedExtensionPackage,
  step: ExtensionStartupStep
): Promise<void> {
  if (extensionPackage.runtime !== 'python-bridge') {
    await sleep(step.durationMs ?? SIMULATED_STEP_DURATION_FALLBACK_MS);
    return;
  }

  ensurePackageHasPythonEntry(extensionPackage);

  if (step.id === 'validate') {
    await sleep(resolveStepDelay(step));
    return;
  }

  if (step.id === 'verify-runtime' || step.id === 'prepare-runtime') {
    await withMinimumDuration(
      verifyPythonRuntime(extensionPackage),
      resolveStepDelay(step)
    );
    return;
  }

  if (step.id === 'verify-models') {
    await withMinimumDuration(
      verifyPythonModels(extensionPackage),
      resolveStepDelay(step)
    );
    return;
  }

  if (step.id === 'warmup') {
    await withMinimumDuration(
      warmupPythonRuntime(extensionPackage),
      step.durationMs ?? 0
    );
    return;
  }

  await sleep(resolveStepDelay(step));
}

function resolveStyleDescription(stylePreset: QwenTtsVoicePreset): string {
  switch (stylePreset) {
    case 'narrator':
      return 'narration-focused, clear articulation, stronger storytelling tone';
    case 'bright':
      return 'brighter tone, lighter and more energetic presence';
    case 'calm':
      return 'calm, restrained, stable delivery without exaggerated emotion';
    case 'natural':
    default:
      return 'natural delivery, close to everyday speech';
  }
}

function resolveRateDescription(rate: number): string {
  if (rate >= 1.2) {
    return 'slightly faster speaking rate';
  }
  if (rate >= 1.05) {
    return 'a bit faster than normal';
  }
  if (rate <= 0.8) {
    return 'slower speaking rate';
  }
  if (rate <= 0.95) {
    return 'a bit slower than normal';
  }
  return 'natural speaking rate';
}

function resolvePitchDescription(pitch: number): string {
  if (pitch >= 4) {
    return 'clearly higher pitch';
  }
  if (pitch >= 1) {
    return 'slightly higher pitch';
  }
  if (pitch <= -4) {
    return 'clearly lower pitch';
  }
  if (pitch <= -1) {
    return 'slightly lower pitch';
  }
  return 'natural pitch';
}

function buildVoiceDesignInstruction(
  request: GenerateQwenTtsVoiceDesignRequest
): string {
  const segments = [
    request.voicePrompt.trim(),
    resolveStyleDescription(request.stylePreset),
    resolveRateDescription(request.speakingRate),
    resolvePitchDescription(request.pitch),
  ].filter((value) => value.length > 0);

  return segments.join('; ');
}

function buildSavedVoiceInstruction(
  request: GenerateQwenTtsSavedVoiceRequest
): string {
  const segments = [
    request.voiceName.trim(),
    request.promptFile.trim() ? 'use the saved reference voice prompt' : '',
  ].filter((value) => value.length > 0);

  return segments.join('; ');
}

function getFileNameFromPath(filePath: string): string | null {
  const normalized = filePath.trim().replace(/\\/g, '/');
  if (!normalized) {
    return null;
  }

  const parts = normalized.split('/');
  return parts[parts.length - 1] || null;
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

function normalizePauseValue(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }

  return normalizeFloat(value, fallback, 0, 5);
}

function buildPausePayload(config: QwenTtsPauseConfig): Record<string, number> {
  return {
    pause_linebreak: normalizePauseValue(config.pauseLinebreak, 0.5),
    period_pause: normalizePauseValue(config.periodPause, 0.4),
    comma_pause: normalizePauseValue(config.commaPause, 0.2),
    question_pause: normalizePauseValue(config.questionPause, 0.6),
    hyphen_pause: normalizePauseValue(config.hyphenPause, 0.3),
  };
}

function resolveOutputFormat(outputFormat: QwenTtsOutputFormat | undefined): QwenTtsOutputFormat {
  return outputFormat === 'mp3' ? 'mp3' : 'wav';
}

function resolveAudioMimeType(
  outputPath: string | null,
  fallbackFormat: QwenTtsOutputFormat
): string {
  const normalizedPath = outputPath?.trim().toLowerCase() ?? '';
  if (normalizedPath.endsWith('.mp3')) {
    return 'audio/mpeg';
  }
  if (normalizedPath.endsWith('.wav')) {
    return 'audio/wav';
  }
  return fallbackFormat === 'mp3' ? 'audio/mpeg' : 'audio/wav';
}

function sanitizeOutputPrefix(value: string, fallback: string): string {
  const sanitized = value.trim().replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return sanitized || fallback;
}

async function generateRealVoiceDesignAudio(
  extensionPackage: LoadedExtensionPackage,
  request: GenerateQwenTtsVoiceDesignRequest
): Promise<GeneratedQwenTtsAudioAsset> {
  const outputFormat = resolveOutputFormat(request.outputFormat);
  const response = await runResilientExtensionCommand<QwenTtsGenerateVoiceDesignResponse>(
    extensionPackage,
    'generate_voice_design',
    {
      text: request.text,
      language: request.language,
      outputFormat,
      voicePrompt: buildVoiceDesignInstruction(request),
      outputPrefix: `voice-design-${Date.now()}`,
      max_new_tokens: normalizePositiveInteger(request.maxNewTokens, 2048, 512, 4096),
      temperature: normalizeFloat(request.temperature, 1, 0.1, 2),
      top_k: normalizePositiveInteger(request.topK, 20, 0, 100),
      top_p: normalizeFloat(request.topP, 0.8, 0, 1),
      repetition_penalty: normalizeFloat(request.repetitionPenalty, 1.05, 1, 2),
      ...buildPausePayload(request),
    }
  );

  const firstOutput = response.outputs?.[0];
  const outputPath = firstOutput?.path ?? response.files?.[0] ?? null;
  if (!outputPath) {
    throw new Error('The extension runtime did not return an audio file.');
  }

  const preparedAudio = await prepareNodeAudio(outputPath, {
    duration: firstOutput?.duration,
    mimeType: firstOutput?.mimeType ?? resolveAudioMimeType(outputPath, outputFormat),
  });

  return {
    ...preparedAudio,
    audioFileName: firstOutput?.name ?? getFileNameFromPath(outputPath),
    sourcePath: outputPath,
  };
}

async function generateMockVoiceDesignAudio(
  request: GenerateQwenTtsVoiceDesignRequest
): Promise<GeneratedQwenTtsAudioAsset> {
  const audioFile = await createMockQwenTtsAudioFile({
    text: request.text,
    voicePrompt: request.voicePrompt,
    stylePreset: request.stylePreset,
    language: request.language,
    speakingRate: request.speakingRate,
    pitch: request.pitch,
  });

  const preparedAudio = await prepareNodeAudioFromFile(audioFile);
  return {
    ...preparedAudio,
    audioFileName: audioFile.name,
    sourcePath: null,
  };
}

export async function generateQwenTtsVoiceDesignAudio(
  extensionPackage: LoadedExtensionPackage,
  request: GenerateQwenTtsVoiceDesignRequest
): Promise<GeneratedQwenTtsAudioAsset> {
  if (extensionPackage.id === QWEN_TTS_COMPLETE_EXTENSION_ID) {
    return await generateRealVoiceDesignAudio(extensionPackage, request);
  }

  return await generateMockVoiceDesignAudio(request);
}

async function createRealSavedVoicePrompt(
  extensionPackage: LoadedExtensionPackage,
  request: CreateQwenTtsSavedVoicePromptRequest
): Promise<SavedQwenTtsVoicePromptAsset> {
  const fallbackLabel = `${sanitizeOutputPrefix(request.voiceName, 'saved-voice')}.qvp`;
  const response = await runResilientExtensionCommand<QwenTtsCreateVoiceClonePromptResponse>(
    extensionPackage,
    'create_voice_clone_prompt',
    {
      refAudio: request.refAudio,
      refText: request.refText,
      voiceName: request.voiceName,
      outputPrefix: sanitizeOutputPrefix(request.voiceName, `saved-voice-${Date.now()}`),
    }
  );

  const promptFile = response.promptFile?.trim();
  if (!promptFile) {
    throw new Error('The extension runtime did not return a saved voice prompt file.');
  }

  return {
    promptFile,
    promptLabel: response.promptLabel?.trim() || getFileNameFromPath(promptFile) || fallbackLabel,
  };
}

async function createMockSavedVoicePrompt(
  request: CreateQwenTtsSavedVoicePromptRequest
): Promise<SavedQwenTtsVoicePromptAsset> {
  const normalizedName = sanitizeOutputPrefix(request.voiceName, `saved-voice-${Date.now()}`);
  return {
    promptFile: `mock://${normalizedName}`,
    promptLabel: `${normalizedName}.qvp`,
  };
}

export async function createQwenTtsSavedVoicePrompt(
  extensionPackage: LoadedExtensionPackage,
  request: CreateQwenTtsSavedVoicePromptRequest
): Promise<SavedQwenTtsVoicePromptAsset> {
  if (extensionPackage.id === QWEN_TTS_COMPLETE_EXTENSION_ID) {
    return await createRealSavedVoicePrompt(extensionPackage, request);
  }

  return await createMockSavedVoicePrompt(request);
}

async function generateRealSavedVoiceAudio(
  extensionPackage: LoadedExtensionPackage,
  request: GenerateQwenTtsSavedVoiceRequest
): Promise<GeneratedQwenTtsAudioAsset> {
  const outputFormat = resolveOutputFormat(request.outputFormat);
  const response = await runResilientExtensionCommand<QwenTtsGenerateVoiceCloneResponse>(
    extensionPackage,
    'generate_voice_clone',
    {
      text: request.text,
      language: request.language,
      outputFormat,
      promptFile: request.promptFile,
      outputPrefix: sanitizeOutputPrefix(request.voiceName, `saved-voice-${Date.now()}`),
      max_new_tokens: normalizePositiveInteger(request.maxNewTokens, 2048, 512, 4096),
      temperature: normalizeFloat(request.temperature, 1, 0.1, 2),
      top_k: normalizePositiveInteger(request.topK, 20, 0, 100),
      top_p: normalizeFloat(request.topP, 0.8, 0, 1),
      repetition_penalty: normalizeFloat(request.repetitionPenalty, 1.05, 1, 2),
      ...buildPausePayload(request),
    }
  );

  const firstOutput = response.outputs?.[0];
  const outputPath = firstOutput?.path ?? response.files?.[0] ?? null;
  if (!outputPath) {
    throw new Error('The extension runtime did not return a generated audio file.');
  }

  const preparedAudio = await prepareNodeAudio(outputPath, {
    duration: firstOutput?.duration,
    mimeType: firstOutput?.mimeType ?? resolveAudioMimeType(outputPath, outputFormat),
  });

  return {
    ...preparedAudio,
    audioFileName: firstOutput?.name ?? getFileNameFromPath(outputPath),
    sourcePath: outputPath,
  };
}

async function generateMockSavedVoiceAudio(
  request: GenerateQwenTtsSavedVoiceRequest
): Promise<GeneratedQwenTtsAudioAsset> {
  const audioFile = await createMockQwenTtsAudioFile({
    text: request.text,
    voicePrompt: buildSavedVoiceInstruction(request),
    stylePreset: 'natural',
    language: request.language,
    speakingRate: 1,
    pitch: 0,
  });

  const preparedAudio = await prepareNodeAudioFromFile(audioFile);
  return {
    ...preparedAudio,
    audioFileName: audioFile.name,
    sourcePath: null,
  };
}

export async function generateQwenTtsSavedVoiceAudio(
  extensionPackage: LoadedExtensionPackage,
  request: GenerateQwenTtsSavedVoiceRequest
): Promise<GeneratedQwenTtsAudioAsset> {
  if (extensionPackage.id === QWEN_TTS_COMPLETE_EXTENSION_ID) {
    return await generateRealSavedVoiceAudio(extensionPackage, request);
  }

  return await generateMockSavedVoiceAudio(request);
}

export function resolveQwenTtsExtensionState(
  packages: Record<string, LoadedExtensionPackage>,
  enabledExtensionIds: string[],
  runtimeById: Record<string, ExtensionRuntimeState>
): ResolvedQwenTtsExtensionState {
  const readyPackage =
    QWEN_TTS_EXTENSION_PRIORITY
      .map((extensionId) => (
        enabledExtensionIds.includes(extensionId) && runtimeById[extensionId]?.status === 'ready'
          ? packages[extensionId]
          : null
      ))
      .find((extensionPackage) => extensionPackage !== null) ?? null;

  const pendingPackage =
    readyPackage
    ?? QWEN_TTS_EXTENSION_PRIORITY
      .map((extensionId) => {
        const extensionPackage = packages[extensionId];
        if (!extensionPackage) {
          return null;
        }

        return runtimeById[extensionId]?.status === 'starting'
          ? extensionPackage
          : null;
      })
      .find((extensionPackage) => extensionPackage !== null)
    ?? null;

  return {
    readyPackage,
    pendingPackage,
    runtime: pendingPackage ? runtimeById[pendingPackage.id] ?? null : null,
  };
}
