import { resolveLocalFileSourcePath } from '@/features/canvas/application/imageData';

export interface ExternalFileDragPayload {
  localPath: string;
  fileUrl: string;
  fileName: string;
}

interface ExternalFileDataTransferInput extends ExternalFileDragPayload {
  mimeType: string | null;
}

function buildFileUrl(localPath: string): string {
  const normalized = localPath.replace(/\\/g, '/');
  if (normalized.startsWith('//')) {
    return `file:${normalized}`;
  }
  if (/^[A-Za-z]:\//.test(normalized)) {
    return `file:///${normalized}`;
  }
  return `file://${normalized}`;
}

function resolveFileName(localPath: string): string {
  const normalized = localPath.replace(/\\/g, '/');
  return normalized.split('/').filter(Boolean).pop() || 'asset';
}

export function resolveExternalFileDragPayload(sourcePath: string): ExternalFileDragPayload | null {
  const localPath = resolveLocalFileSourcePath(sourcePath);
  if (!localPath) {
    return null;
  }

  return {
    localPath,
    fileUrl: buildFileUrl(localPath),
    fileName: resolveFileName(localPath),
  };
}

export function applyExternalFileDragDataTransfer(
  dataTransfer: DataTransfer,
  payload: ExternalFileDataTransferInput
): void {
  dataTransfer.effectAllowed = 'copy';
  dataTransfer.dropEffect = 'copy';
  dataTransfer.setData('text/plain', payload.localPath);
  dataTransfer.setData('text/uri-list', payload.fileUrl);
  dataTransfer.setData(
    'DownloadURL',
    `${payload.mimeType || 'application/octet-stream'}:${payload.fileName}:${payload.fileUrl}`
  );
}
