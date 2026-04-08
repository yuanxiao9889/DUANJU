import { convertFileSrc, isTauri } from '@tauri-apps/api/core';

import {
  loadImage,
  prepareNodeImageBinary,
  persistImageSource,
  prepareNodeImageSource,
} from '@/commands/image';

export function parseAspectRatio(value: string): number {
  const [width, height] = value.split(':').map((item) => Number(item));
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return 1;
  }

  return width / height;
}

export function reduceAspectRatio(width: number, height: number): string {
  if (width <= 0 || height <= 0) {
    return '1:1';
  }

  const gcd = greatestCommonDivisor(Math.round(width), Math.round(height));
  return `${Math.round(width / gcd)}:${Math.round(height / gcd)}`;
}

function greatestCommonDivisor(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);

  while (y !== 0) {
    const temp = y;
    y = x % y;
    x = temp;
  }

  return x || 1;
}

const DEFAULT_PREVIEW_MAX_DIMENSION = 512;
const LOCAL_PATH_PREFIX_PATTERN = /^(?:[A-Za-z]:[\\/]|\\\\|\/)/;
const URL_SCHEME_PREFIX_PATTERN = /^[a-z][a-z0-9+\-.]*:\/\//i;

export interface PreparedNodeImage {
  imageUrl: string;
  previewImageUrl: string;
  aspectRatio: string;
}

export interface ImagePixelDimensions {
  width: number;
  height: number;
}

interface ErrorWithDetails extends Error {
  details?: string;
}

function stringifyUnknown(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (value instanceof Error) {
    return value.message;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function createImagePipelineError(message: string, details?: string, cause?: unknown): ErrorWithDetails {
  const error: ErrorWithDetails = new Error(message);
  const detailParts: string[] = [];
  if (details) {
    detailParts.push(details);
  }
  if (cause !== undefined) {
    detailParts.push(`cause: ${stringifyUnknown(cause)}`);
  }
  if (detailParts.length > 0) {
    error.details = detailParts.join('\n');
  }
  return error;
}

const ORIGINAL_IMAGE_ZOOM_THRESHOLD = 1.45;

export function shouldUseOriginalImageByZoom(zoom: number): boolean {
  return Number.isFinite(zoom) && zoom >= ORIGINAL_IMAGE_ZOOM_THRESHOLD;
}

export function isLikelyLocalImagePath(imageUrl: string): boolean {
  if (!imageUrl) {
    return false;
  }

  const lower = imageUrl.toLowerCase();
  if (
    lower.startsWith('data:') ||
    lower.startsWith('http://') ||
    lower.startsWith('https://') ||
    lower.startsWith('blob:') ||
    lower.startsWith('asset:') ||
    lower.startsWith('tauri:') ||
    lower.startsWith('file://')
  ) {
    return false;
  }

  return LOCAL_PATH_PREFIX_PATTERN.test(imageUrl);
}

function normalizeLocalFilePath(localPath: string): string {
  const trimmedPath = localPath.trim();
  if (!trimmedPath) {
    return trimmedPath;
  }

  const slashNormalizedPath = trimmedPath.replace(/\\/g, '/');
  if (/^\/[A-Za-z]:\//.test(slashNormalizedPath)) {
    return slashNormalizedPath.slice(1);
  }

  return slashNormalizedPath;
}

function parseKnownLocalPathUrl(source: string): URL | null {
  try {
    return new URL(source);
  } catch {
    if (source.startsWith('//asset.localhost/')) {
      try {
        return new URL(`https:${source}`);
      } catch {
        return null;
      }
    }

    if (source.startsWith('asset.localhost/')) {
      try {
        return new URL(`https://${source}`);
      } catch {
        return null;
      }
    }

    return null;
  }
}

function resolveLocalPathFromUrl(source: string): string | null {
  const parsed = parseKnownLocalPathUrl(source);
  if (!parsed) {
    return null;
  }

  const isFileProtocol = parsed.protocol === 'file:';
  const isAssetProtocol = parsed.protocol === 'asset:' && parsed.hostname === 'localhost';
  const isAssetHostProtocol =
    (parsed.protocol === 'http:' || parsed.protocol === 'https:')
    && parsed.hostname === 'asset.localhost';

  if (!isFileProtocol && !isAssetProtocol && !isAssetHostProtocol) {
    return null;
  }

  const decodedPathname = decodeURIComponent(parsed.pathname);
  const candidatePath =
    isFileProtocol && parsed.host && !/^[A-Za-z]:/.test(decodedPathname)
      ? `//${parsed.host}${decodedPathname}`
      : decodedPathname;
  const normalizedPath = normalizeLocalFilePath(candidatePath);
  return isLikelyLocalImagePath(normalizedPath) ? normalizedPath : null;
}

function decodePercentEncodedPathLike(source: string): string | null {
  if (!source.includes('%') || URL_SCHEME_PREFIX_PATTERN.test(source)) {
    return null;
  }

  try {
    const decoded = decodeURIComponent(source);
    if (!decoded || decoded === source) {
      return null;
    }
    return decoded;
  } catch {
    return null;
  }
}

export function resolveLocalFileSourcePath(source: string): string | null {
  const trimmedSource = source.trim();
  if (!trimmedSource) {
    return null;
  }

  if (isLikelyLocalImagePath(trimmedSource)) {
    return normalizeLocalFilePath(trimmedSource);
  }

  const encodedPathCandidate = decodePercentEncodedPathLike(trimmedSource);
  if (encodedPathCandidate && isLikelyLocalImagePath(encodedPathCandidate)) {
    return normalizeLocalFilePath(encodedPathCandidate);
  }

  const resolvedFromUrl = resolveLocalPathFromUrl(trimmedSource);
  if (resolvedFromUrl) {
    return resolvedFromUrl;
  }

  if (encodedPathCandidate) {
    return resolveLocalPathFromUrl(encodedPathCandidate);
  }

  return null;
}

function hasTauriInternalsBridge(): boolean {
  const maybeGlobal = globalThis as typeof globalThis & {
    __TAURI_INTERNALS__?: unknown;
  };
  return typeof maybeGlobal.__TAURI_INTERNALS__ === 'object' && maybeGlobal.__TAURI_INTERNALS__ !== null;
}

function isLikelyTauriRuntime(): boolean {
  if (isTauri() || hasTauriInternalsBridge()) {
    return true;
  }

  if (typeof window === 'undefined') {
    return false;
  }

  const host = window.location.hostname.toLowerCase();
  return host === 'tauri.localhost' || host === 'asset.localhost';
}

function encodeLocalPathForAssetHost(localFilePath: string): string {
  return localFilePath
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

export function resolveImageDisplayUrl(imageUrl: string): string {
  const localFilePath = resolveLocalFileSourcePath(imageUrl);
  if (!localFilePath) {
    return imageUrl;
  }

  try {
    return convertFileSrc(localFilePath);
  } catch {
    if (isLikelyTauriRuntime()) {
      return `https://asset.localhost/${encodeLocalPathForAssetHost(localFilePath)}`;
    }

    return imageUrl.toLowerCase().startsWith('file://') ? imageUrl : localFilePath;
  }
}

export async function persistImageLocally(source: string): Promise<string> {
  const localFilePath = resolveLocalFileSourcePath(source);
  if (localFilePath) {
    return localFilePath;
  }

  if (!isTauri()) {
    return source;
  }

  return await persistImageSource(source);
}

export async function loadImageElement(source: string): Promise<HTMLImageElement> {
  const image = new Image();
  const displaySource = resolveImageDisplayUrl(source);
  if (
    displaySource.startsWith('http://') ||
    displaySource.startsWith('https://') ||
    displaySource.startsWith('asset:')
  ) {
    image.crossOrigin = 'anonymous';
  }

  return await new Promise((resolve, reject) => {
    image.onload = () => resolve(image);
    image.onerror = () =>
      reject(
        createImagePipelineError('图片加载失败', `source=${source}\ndisplaySource=${displaySource}`)
      );
    image.src = displaySource;
  });
}

export async function imageUrlToDataUrl(imageUrl: string): Promise<string> {
  if (imageUrl.startsWith('data:')) {
    return imageUrl;
  }

  const localFilePath = resolveLocalFileSourcePath(imageUrl);
  if (localFilePath) {
    if (isTauri()) {
      try {
        return await loadImage(localFilePath);
      } catch (error) {
        throw createImagePipelineError('无法读取本地图片数据', `source=${imageUrl}`, error);
      }
    }
    const localResponse = await fetch(resolveImageDisplayUrl(localFilePath));
    if (!localResponse.ok) {
      throw createImagePipelineError(
        '无法读取本地图片数据',
        `source=${imageUrl}\nstatus=${localResponse.status}`
      );
    }
    const localBlob = await localResponse.blob();
    return await blobToDataUrl(localBlob);
  }

  const response = await fetch(imageUrl);
  if (!response.ok) {
    throw createImagePipelineError('无法下载图片数据', `url=${imageUrl}\nstatus=${response.status}`);
  }

  const blob = await response.blob();
  return await blobToDataUrl(blob);
}

export async function blobToDataUrl(blob: Blob): Promise<string> {
  const reader = new FileReader();

  return await new Promise((resolve, reject) => {
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('图片转换失败'));
    reader.readAsDataURL(blob);
  });
}

export function extractBase64Payload(dataUrl: string): string {
  const [, payload = ''] = dataUrl.split(',');
  return payload;
}

export async function readFileAsDataUrl(file: File): Promise<string> {
  const reader = new FileReader();

  return await new Promise((resolve, reject) => {
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('文件读取失败'));
    reader.readAsDataURL(file);
  });
}

function resolveFileExtension(file: File): string {
  const mime = file.type.toLowerCase();
  if (mime === 'image/png') return 'png';
  if (mime === 'image/jpeg' || mime === 'image/jpg') return 'jpg';
  if (mime === 'image/webp') return 'webp';
  if (mime === 'image/gif') return 'gif';
  if (mime === 'image/bmp') return 'bmp';
  if (mime === 'image/tiff') return 'tiff';
  if (mime === 'image/avif') return 'avif';

  const name = file.name.trim();
  const dot = name.lastIndexOf('.');
  if (dot >= 0 && dot < name.length - 1) {
    return name.slice(dot + 1).toLowerCase();
  }
  return 'png';
}

export async function prepareNodeImageFromFile(
  file: File,
  maxPreviewDimension = DEFAULT_PREVIEW_MAX_DIMENSION
): Promise<PreparedNodeImage> {
  const started = performance.now();
  const tauriFilePath = (file as File & { path?: string }).path;
  const normalizedPath = typeof tauriFilePath === 'string' ? tauriFilePath.trim() : '';
  const canUseLocalPath =
    normalizedPath.length > 0
    && (isLikelyLocalImagePath(normalizedPath) || normalizedPath.toLowerCase().startsWith('file://'));
  if (canUseLocalPath) {
    const prepared = await prepareNodeImage(normalizedPath, maxPreviewDimension);
    console.info(
      `[upload-perf][imageData] prepareNodeImageFromFile path-mode name="${file.name}" size=${file.size}B elapsed=${Math.round(performance.now() - started)}ms`
    );
    return prepared;
  }

  if (isTauri()) {
    const safeMaxDimension = Math.max(64, Math.floor(maxPreviewDimension));
    const readStarted = performance.now();
    const bytes = new Uint8Array(await file.arrayBuffer());
    const readElapsed = Math.round(performance.now() - readStarted);
    const extension = resolveFileExtension(file);
    const tauriStarted = performance.now();
    const prepared = await prepareNodeImageBinary(bytes, extension, safeMaxDimension);
    const tauriElapsed = Math.round(performance.now() - tauriStarted);
    console.info(
      `[upload-perf][imageData] prepareNodeImageFromFile binary-mode name="${file.name}" size=${file.size}B readArrayBuffer=${readElapsed}ms tauriPrepare=${tauriElapsed}ms total=${Math.round(performance.now() - started)}ms`
    );
    return {
      imageUrl: prepared.imagePath,
      previewImageUrl: prepared.previewImagePath,
      aspectRatio: prepared.aspectRatio,
    };
  }

  const dataUrlStarted = performance.now();
  const source = await readFileAsDataUrl(file);
  const dataUrlElapsed = Math.round(performance.now() - dataUrlStarted);
  const prepared = await prepareNodeImage(source, maxPreviewDimension);
  console.info(
    `[upload-perf][imageData] prepareNodeImageFromFile dataurl-fallback name="${file.name}" size=${file.size}B readDataUrl=${dataUrlElapsed}ms total=${Math.round(performance.now() - started)}ms`
  );
  return prepared;
}

export async function detectAspectRatio(imageUrl: string): Promise<string> {
  const { width, height } = await detectImageDimensions(imageUrl);
  return reduceAspectRatio(width, height);
}

export async function detectImageDimensions(imageUrl: string): Promise<ImagePixelDimensions> {
  const image = await loadImageElement(imageUrl);
  return {
    width: Math.max(1, image.naturalWidth),
    height: Math.max(1, image.naturalHeight),
  };
}

export function canvasToDataUrl(canvas: HTMLCanvasElement): string {
  return canvas.toDataURL('image/png');
}

function resolvePreviewMimeType(imageUrl: string): string {
  if (imageUrl.startsWith('data:image/png')) {
    return 'image/png';
  }
  if (imageUrl.startsWith('data:image/webp')) {
    return 'image/webp';
  }
  return 'image/jpeg';
}

function renderPreviewDataUrl(
  image: HTMLImageElement,
  sourceDataUrl: string,
  maxDimension: number
): string {
  const longestSide = Math.max(image.naturalWidth, image.naturalHeight);
  if (longestSide <= maxDimension) {
    return sourceDataUrl;
  }

  const scale = maxDimension / longestSide;
  const targetWidth = Math.max(1, Math.round(image.naturalWidth * scale));
  const targetHeight = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;

  const context = canvas.getContext('2d');
  if (!context) {
    return sourceDataUrl;
  }

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(image, 0, 0, targetWidth, targetHeight);

  const mimeType = resolvePreviewMimeType(sourceDataUrl);
  if (mimeType === 'image/jpeg') {
    return canvas.toDataURL(mimeType, 0.86);
  }
  return canvas.toDataURL(mimeType);
}

export async function createPreviewDataUrl(
  imageUrl: string,
  maxDimension = DEFAULT_PREVIEW_MAX_DIMENSION
): Promise<string> {
  const normalizedDataUrl = await imageUrlToDataUrl(imageUrl);
  const image = await loadImageElement(normalizedDataUrl);
  const safeMaxDimension = Math.max(64, Math.floor(maxDimension));
  return renderPreviewDataUrl(image, normalizedDataUrl, safeMaxDimension);
}

export async function prepareNodeImage(
  imageUrl: string,
  maxPreviewDimension = DEFAULT_PREVIEW_MAX_DIMENSION
): Promise<PreparedNodeImage> {
  const trimmedImageUrl = imageUrl.trim();
  if (!trimmedImageUrl) {
    throw createImagePipelineError('未获取到可用图片结果', 'imageUrl is empty');
  }

  const started = performance.now();
  if (isTauri()) {
    const safeMaxDimension = Math.max(64, Math.floor(maxPreviewDimension));
    try {
      const tauriStarted = performance.now();
      const prepared = await prepareNodeImageSource(trimmedImageUrl, safeMaxDimension);
      console.info(
        `[upload-perf][imageData] prepareNodeImage tauri-source elapsed=${Math.round(performance.now() - tauriStarted)}ms total=${Math.round(performance.now() - started)}ms`
      );
      return {
        imageUrl: prepared.imagePath,
        previewImageUrl: prepared.previewImagePath,
        aspectRatio: prepared.aspectRatio,
      };
    } catch (error) {
      console.warn('[imageData] prepareNodeImage tauri-source failed, fallback to browser path', {
        source: trimmedImageUrl,
        error,
      });
      // fallback to browser path for compatibility
    }
  }

  try {
    const persistedImagePath = await persistImageLocally(trimmedImageUrl);
    const normalizedDataUrl = await imageUrlToDataUrl(persistedImagePath);
    const image = await loadImageElement(normalizedDataUrl);
    const safeMaxDimension = Math.max(64, Math.floor(maxPreviewDimension));
    const previewDataUrl = renderPreviewDataUrl(image, normalizedDataUrl, safeMaxDimension);
    const previewImagePath =
      previewDataUrl === normalizedDataUrl
        ? persistedImagePath
        : await persistImageLocally(previewDataUrl);

    console.info(
      `[upload-perf][imageData] prepareNodeImage browser-fallback total=${Math.round(performance.now() - started)}ms`
    );
    return {
      imageUrl: persistedImagePath,
      previewImageUrl: previewImagePath,
      aspectRatio: reduceAspectRatio(image.naturalWidth, image.naturalHeight),
    };
  } catch (error) {
    throw createImagePipelineError(
      '生成结果无法解析为图片',
      `source=${trimmedImageUrl}`,
      error
    );
  }
}
