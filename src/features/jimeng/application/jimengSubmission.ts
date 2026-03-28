import { createPreviewDataUrl } from '@/features/canvas/application/imageData';
import { audioUrlToDataUrl } from '@/features/canvas/application/audioData';
import {
  ensureJimengChromeSession,
  submitJimengChromeTask,
  syncJimengChromeDraftOptions,
} from '@/commands/jimengPanel';
import { useJimengPanelStore, type JimengPanelMode } from '@/stores/jimengPanelStore';
import type { JimengInspectionReport } from '@/features/jimeng/domain/jimengInspection';

const REFERENCE_TOKEN_PATTERN = /@\u56fe(?:\u7247)?\d+/g;
const JIMENG_REFERENCE_IMAGE_MAX_DIMENSION = 1600;

export interface JimengReferenceImagePayload {
  fileName: string;
  dataUrl: string;
}

export interface JimengReferenceAudioPayload {
  fileName: string;
  dataUrl: string;
}

export interface JimengTaskSubmission {
  prompt: string;
  referenceImageSources?: string[];
  referenceAudioSources?: string[];
}

export interface JimengDraftSyncPayload {
  prompt?: string;
}

function normalizeWhitespace(value: string): string {
  return value
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function buildJimengSubmissionPrompt(prompt: string): string {
  return normalizeWhitespace(prompt.replace(REFERENCE_TOKEN_PATTERN, ' '));
}

function resolveSubmitMode(mode: JimengPanelMode): Exclude<JimengPanelMode, 'hidden'> {
  return mode === 'hidden' ? 'expanded' : mode;
}

function sanitizeJimengReferenceFileName(rawName: string): string {
  const sanitized = rawName
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '');

  return sanitized || 'jimeng-reference';
}

function resolveDataUrlExtension(dataUrl: string): string {
  const mimeSegment = dataUrl.slice(5, dataUrl.indexOf(';'));
  const normalizedMime = mimeSegment.toLowerCase();
  if (normalizedMime === 'image/jpeg' || normalizedMime === 'image/jpg') {
    return 'jpg';
  }
  if (normalizedMime === 'image/webp') {
    return 'webp';
  }
  if (normalizedMime === 'image/gif') {
    return 'gif';
  }
  if (normalizedMime === 'image/bmp') {
    return 'bmp';
  }
  if (normalizedMime === 'image/avif') {
    return 'avif';
  }
  return 'png';
}

function resolveAudioDataUrlExtension(dataUrl: string): string {
  const mimeSegment = dataUrl.slice(5, dataUrl.indexOf(';'));
  const normalizedMime = mimeSegment.toLowerCase();
  if (normalizedMime === 'audio/mpeg' || normalizedMime === 'audio/mp3') {
    return 'mp3';
  }
  if (
    normalizedMime === 'audio/wav'
    || normalizedMime === 'audio/x-wav'
    || normalizedMime === 'audio/wave'
    || normalizedMime === 'audio/x-pn-wav'
  ) {
    return 'wav';
  }
  if (normalizedMime === 'audio/ogg') {
    return 'ogg';
  }
  if (normalizedMime === 'audio/webm') {
    return 'webm';
  }
  if (normalizedMime === 'audio/mp4' || normalizedMime === 'audio/x-m4a') {
    return 'm4a';
  }
  if (normalizedMime === 'audio/aac') {
    return 'aac';
  }
  if (normalizedMime === 'audio/flac' || normalizedMime === 'audio/x-flac') {
    return 'flac';
  }
  return 'mp3';
}

function resolveJimengReferenceFileName(source: string, dataUrl: string, index: number): string {
  const normalizedSource = source.trim();
  const basename = normalizedSource
    .split(/[\\/]/)
    .pop()
    ?.split('?')[0]
    ?.split('#')[0]
    ?.trim();

  if (basename && basename.includes('.')) {
    return sanitizeJimengReferenceFileName(basename);
  }

  const extension = resolveDataUrlExtension(dataUrl);
  return sanitizeJimengReferenceFileName(`jimeng-reference-${index + 1}.${extension}`);
}

function resolveJimengReferenceAudioFileName(
  source: string,
  dataUrl: string,
  index: number
): string {
  const normalizedSource = source.trim();
  const basename = normalizedSource
    .split(/[\\/]/)
    .pop()
    ?.split('?')[0]
    ?.split('#')[0]
    ?.trim();

  if (basename && basename.includes('.')) {
    return sanitizeJimengReferenceFileName(basename);
  }

  const extension = resolveAudioDataUrlExtension(dataUrl);
  return sanitizeJimengReferenceFileName(`jimeng-audio-${index + 1}.${extension}`);
}

async function prepareJimengReferenceImages(
  sources: string[] | undefined
): Promise<JimengReferenceImagePayload[]> {
  const uniqueSources = [...new Set((sources ?? []).map((source) => source.trim()).filter(Boolean))];
  if (uniqueSources.length === 0) {
    return [];
  }

  return await Promise.all(
    uniqueSources.map(async (source, index) => {
      const dataUrl = await createPreviewDataUrl(source, JIMENG_REFERENCE_IMAGE_MAX_DIMENSION);
      return {
        fileName: resolveJimengReferenceFileName(source, dataUrl, index),
        dataUrl,
      };
    })
  );
}

async function prepareJimengReferenceAudios(
  sources: string[] | undefined
): Promise<JimengReferenceAudioPayload[]> {
  const uniqueSources = [...new Set((sources ?? []).map((source) => source.trim()).filter(Boolean))];
  if (uniqueSources.length === 0) {
    return [];
  }

  return await Promise.all(
    uniqueSources.map(async (source, index) => {
      const dataUrl = await audioUrlToDataUrl(source);
      return {
        fileName: resolveJimengReferenceAudioFileName(source, dataUrl, index),
        dataUrl,
      };
    })
  );
}

export async function submitJimengTask(payload: JimengTaskSubmission): Promise<void> {
  const chromeSessionPromise = ensureJimengChromeSession();
  const referenceImagesPromise = prepareJimengReferenceImages(payload.referenceImageSources);
  const referenceAudiosPromise = prepareJimengReferenceAudios(payload.referenceAudioSources);

  await chromeSessionPromise;
  const referenceImages = await referenceImagesPromise;
  const referenceAudios = await referenceAudiosPromise;

  await submitJimengChromeTask({
    prompt: payload.prompt,
    skipToolbarAutomation: true,
    referenceImages,
    referenceAudios,
    autoSubmit: true,
  });
}

export async function syncJimengDraftControls(
  payload: JimengDraftSyncPayload,
  options: {
    revealIfHidden?: boolean;
  } = {}
): Promise<JimengInspectionReport | null> {
  const panelStore = useJimengPanelStore.getState();
  const revealIfHidden = options.revealIfHidden ?? false;

  if (panelStore.mode === 'hidden' && !revealIfHidden) {
    return null;
  }

  const targetMode = resolveSubmitMode(panelStore.mode);

  if (panelStore.mode === 'hidden') {
    panelStore.setMode(targetMode);
  }

  return await syncJimengChromeDraftOptions<JimengInspectionReport>({
    prompt: payload.prompt ?? '',
    autoSubmit: false,
  });
}
