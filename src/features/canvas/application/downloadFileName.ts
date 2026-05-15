import {
  getNodePrimaryDownloadSource,
  isAudioNode,
  type CanvasNode,
} from '@/features/canvas/domain/canvasNodes';

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function stripUrlSearchAndHash(value: string): string {
  const separatorIndex = value.search(/[?#]/);
  return separatorIndex >= 0 ? value.slice(0, separatorIndex) : value;
}

function getFileNameFromPathLike(value: string): string {
  const cleaned = stripUrlSearchAndHash(value.trim()).replace(/\\/g, '/');
  const segments = cleaned.split('/').filter(Boolean);
  return segments.length > 0 ? segments[segments.length - 1] : '';
}

export function stripFileExtension(value: string): string {
  return value.replace(/\.[^.]+$/, '').trim();
}

function getFileExtension(value: string): string {
  const fileName = getFileNameFromPathLike(value);
  const dotIndex = fileName.lastIndexOf('.');
  if (dotIndex < 0 || dotIndex >= fileName.length - 1) {
    return '';
  }
  return fileName.slice(dotIndex + 1).toLowerCase();
}

function resolveAudioExtensionFromMime(mimeType: unknown): string {
  const normalized = normalizeText(mimeType).split(';', 1)[0]?.toLowerCase() ?? '';
  if (normalized === 'audio/mpeg' || normalized === 'audio/mp3') return 'mp3';
  if (
    normalized === 'audio/wav'
    || normalized === 'audio/x-wav'
    || normalized === 'audio/wave'
    || normalized === 'audio/x-pn-wav'
  ) {
    return 'wav';
  }
  if (normalized === 'audio/ogg') return 'ogg';
  if (normalized === 'audio/webm') return 'webm';
  if (normalized === 'audio/mp4' || normalized === 'audio/x-m4a') return 'm4a';
  if (normalized === 'audio/aac') return 'aac';
  if (normalized === 'audio/flac' || normalized === 'audio/x-flac') return 'flac';
  return '';
}

function resolveVideoExtensionFromMime(mimeType: unknown): string {
  const normalized = normalizeText(mimeType).split(';', 1)[0]?.toLowerCase() ?? '';
  if (normalized === 'video/mp4') return 'mp4';
  if (normalized === 'video/webm') return 'webm';
  if (normalized === 'video/ogg') return 'ogv';
  if (normalized === 'video/quicktime') return 'mov';
  if (normalized === 'video/x-msvideo') return 'avi';
  if (normalized === 'video/x-matroska') return 'mkv';
  return '';
}

export function sanitizeDownloadFileName(value: string): string {
  const sanitized = value
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
    .trim()
    .replace(/^\.+|\.+$/g, '');
  return sanitized || 'node-media';
}

export function resolveNodeDownloadDefaultFileName(node: CanvasNode): string {
  const downloadSource = getNodePrimaryDownloadSource(node);
  if (!downloadSource) {
    return sanitizeDownloadFileName(`node-${node.id}.png`);
  }

  if (downloadSource.mediaType === 'audio' && isAudioNode(node)) {
    const sourceExtension = getFileExtension(downloadSource.source);
    const audioExtension =
      getFileExtension(normalizeText(node.data.audioFileName))
      || sourceExtension
      || resolveAudioExtensionFromMime(node.data.mimeType)
      || 'mp3';
    const baseName =
      normalizeText(node.data.audioFileName)
      || normalizeText(node.data.assetName)
      || getFileNameFromPathLike(downloadSource.source)
      || `node-${node.id}`;
    const safeName = sanitizeDownloadFileName(baseName);
    return getFileExtension(safeName) ? safeName : `${safeName}.${audioExtension}`;
  }

  if (downloadSource.mediaType === 'video') {
    const sourceExtension = getFileExtension(downloadSource.source);
    const videoFileName = normalizeText((node.data as { videoFileName?: unknown }).videoFileName);
    const videoExtension =
      getFileExtension(videoFileName)
      || sourceExtension
      || resolveVideoExtensionFromMime((node.data as { mimeType?: unknown }).mimeType)
      || 'mp4';
    const baseName =
      videoFileName
      || getFileNameFromPathLike(downloadSource.source)
      || `node-${node.id}`;
    const safeName = sanitizeDownloadFileName(baseName);
    return getFileExtension(safeName) ? safeName : `${safeName}.${videoExtension}`;
  }

  const imageFileName =
    getFileNameFromPathLike(normalizeText(downloadSource.fileName))
    || getFileNameFromPathLike(downloadSource.source);
  const imageExtension = getFileExtension(imageFileName) || 'png';
  const baseName = imageFileName || `node-${node.id}`;
  const safeName = sanitizeDownloadFileName(baseName);
  return getFileExtension(safeName) ? safeName : `${safeName}.${imageExtension}`;
}

export function resolveNodeDownloadSuggestedFileStem(node: CanvasNode): string {
  return stripFileExtension(resolveNodeDownloadDefaultFileName(node)) || `node-${node.id}`;
}
