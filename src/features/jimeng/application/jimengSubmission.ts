import { createPreviewDataUrl } from '@/features/canvas/application/imageData';
import {
  ensureJimengChromeSession,
  submitJimengChromeTask,
  syncJimengChromeDraftOptions,
} from '@/commands/jimengPanel';
import { useJimengPanelStore, type JimengPanelMode } from '@/stores/jimengPanelStore';
import type { JimengInspectionReport } from '@/features/jimeng/domain/jimengInspection';

const REFERENCE_TOKEN_PATTERN = /@\u56fe\u7247\d+/g;
const JIMENG_REFERENCE_IMAGE_MAX_DIMENSION = 1600;

export interface JimengReferenceImagePayload {
  fileName: string;
  dataUrl: string;
}

export interface JimengTaskSubmission {
  prompt: string;
  referenceImageSources?: string[];
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

async function prepareJimengReferenceImages(
  sources: string[] | undefined
): Promise<JimengReferenceImagePayload[] | undefined> {
  const uniqueSources = [...new Set((sources ?? []).map((source) => source.trim()).filter(Boolean))];
  if (uniqueSources.length === 0) {
    return undefined;
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

export async function submitJimengTask(payload: JimengTaskSubmission): Promise<void> {
  const chromeSessionPromise = ensureJimengChromeSession();
  const referenceImagesPromise = prepareJimengReferenceImages(payload.referenceImageSources);

  await chromeSessionPromise;
  const referenceImages = await referenceImagesPromise;

  await submitJimengChromeTask({
    prompt: payload.prompt,
    referenceImages,
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
