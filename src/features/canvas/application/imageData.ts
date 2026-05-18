import { convertFileSrc, isTauri } from '@tauri-apps/api/core';

import {
  prepareNodeImageBinary,
  createNodeThumbnailSource,
  persistImageSource,
  prepareNodeImageSource,
  readLocalImageBinary,
} from '@/commands/image';
import type { MediaPersistContext } from '@/commands/media';
import { createCurrentProjectMediaContext } from './mediaPersistenceContext';

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

const DEFAULT_PREVIEW_MAX_DIMENSION = 256;
export const OVERVIEW_THUMBNAIL_MAX_DIMENSION = 96;
const LOCAL_PATH_PREFIX_PATTERN = /^(?:[A-Za-z]:[\\/]|\\\\|\/)/;
const URL_SCHEME_PREFIX_PATTERN = /^[a-z][a-z0-9+\-.]*:\/\//i;
const LOCAL_IMAGE_DISPLAY_SOURCE_CACHE_LIMIT = 512;
const BUNDLED_APP_ASSET_PREFIXES = [
  '/assets/',
  './assets/',
  'assets/',
  '/src/assets/',
  './src/assets/',
  'src/assets/',
  '/style-templates/',
  './style-templates/',
  'style-templates/',
  '/shot-params/',
  './shot-params/',
  'shot-params/',
  '/vendor/',
  './vendor/',
  'vendor/',
] as const;
const BUNDLED_APP_ASSET_PATHS = new Set([
  '/app-icon.png',
  './app-icon.png',
  'app-icon.png',
  '/community-qq-835213642.jpg',
  './community-qq-835213642.jpg',
  'community-qq-835213642.jpg',
  '/tauri.svg',
  './tauri.svg',
  'tauri.svg',
  '/vite.svg',
  './vite.svg',
  'vite.svg',
]);

export interface PreparedNodeImage {
  imageUrl: string;
  previewImageUrl: string;
  thumbnailImageUrl: string;
  aspectRatio: string;
}

export interface ImagePixelDimensions {
  width: number;
  height: number;
}

const LOCAL_IMAGE_READABILITY_RETRY_DELAYS_MS = [80, 160, 320, 640, 1280] as const;
const localImageDisplaySourceCache = new Map<string, string>();
const localImageDisplaySourceInflight = new Map<string, Promise<string>>();
const localImageDisplaySourceFailureCache = new Map<string, number>();
let localImageDisplaySourceCleanupRegistered = false;

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

function stripUrlSearchAndHash(source: string): string {
  const separatorIndex = source.search(/[?#]/);
  return separatorIndex >= 0 ? source.slice(0, separatorIndex) : source;
}

function isBundledAppAssetPath(source: string): boolean {
  const trimmedSource = source.trim();
  if (!trimmedSource) {
    return false;
  }

  const lower = trimmedSource.toLowerCase();
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

  const normalizedSource = stripUrlSearchAndHash(trimmedSource);
  if (BUNDLED_APP_ASSET_PATHS.has(normalizedSource)) {
    return true;
  }

  return BUNDLED_APP_ASSET_PREFIXES.some((prefix) =>
    normalizedSource.startsWith(prefix)
  );
}

export function isLikelyLocalImagePath(imageUrl: string): boolean {
  if (!imageUrl) {
    return false;
  }

  if (isBundledAppAssetPath(imageUrl)) {
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
  return (
    host === 'tauri.localhost'
    || host === 'asset.localhost'
    || host === 'localhost'
    || host === '127.0.0.1'
    || host === '[::1]'
  );
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

function rememberLocalImageDisplaySource(localFilePath: string, displaySource: string): void {
  if (!displaySource) {
    return;
  }

  installLocalImageDisplaySourceUnloadCleanup();
  const previousDisplaySource = localImageDisplaySourceCache.get(localFilePath);
  if (previousDisplaySource && previousDisplaySource !== displaySource) {
    URL.revokeObjectURL(previousDisplaySource);
  }
  if (localImageDisplaySourceCache.has(localFilePath)) {
    localImageDisplaySourceCache.delete(localFilePath);
  }
  localImageDisplaySourceCache.set(localFilePath, displaySource);

  while (localImageDisplaySourceCache.size > LOCAL_IMAGE_DISPLAY_SOURCE_CACHE_LIMIT) {
    const oldestKey = localImageDisplaySourceCache.keys().next().value;
    if (!oldestKey) {
      break;
    }
    const oldestDisplaySource = localImageDisplaySourceCache.get(oldestKey);
    if (oldestDisplaySource) {
      URL.revokeObjectURL(oldestDisplaySource);
    }
    localImageDisplaySourceCache.delete(oldestKey);
  }
}

function releaseAllStableImageDisplaySources(): void {
  localImageDisplaySourceCache.forEach((displaySource) => {
    URL.revokeObjectURL(displaySource);
  });
  localImageDisplaySourceCache.clear();
  localImageDisplaySourceInflight.clear();
  localImageDisplaySourceFailureCache.clear();
}

function installLocalImageDisplaySourceUnloadCleanup(): void {
  if (localImageDisplaySourceCleanupRegistered || typeof window === 'undefined') {
    return;
  }

  localImageDisplaySourceCleanupRegistered = true;
  window.addEventListener('beforeunload', () => {
    releaseAllStableImageDisplaySources();
  });
}

export function getCachedStableImageDisplaySource(source: string): string | null {
  const localFilePath = resolveLocalFileSourcePath(source);
  if (!localFilePath) {
    return null;
  }

  return localImageDisplaySourceCache.get(localFilePath) ?? null;
}

function shouldSkipStableImageDisplaySourceRetry(localFilePath: string): boolean {
  const failedAt = localImageDisplaySourceFailureCache.get(localFilePath);
  if (!failedAt) {
    return false;
  }

  if (Date.now() - failedAt < 5_000) {
    return true;
  }

  localImageDisplaySourceFailureCache.delete(localFilePath);
  return false;
}

export async function loadStableImageDisplaySource(source: string): Promise<string> {
  const normalizedSource = source.trim();
  if (!normalizedSource) {
    return normalizedSource;
  }

  const localFilePath = resolveLocalFileSourcePath(normalizedSource);
  if (!localFilePath || !isTauri()) {
    return resolveImageDisplayUrl(normalizedSource);
  }

  if (shouldSkipStableImageDisplaySourceRetry(localFilePath)) {
    throw new Error(`Local image file is unavailable: ${localFilePath}`);
  }

  const cachedDisplaySource = localImageDisplaySourceCache.get(localFilePath);
  if (cachedDisplaySource) {
    return cachedDisplaySource;
  }

  const inflightRequest = localImageDisplaySourceInflight.get(localFilePath);
  if (inflightRequest) {
    return await inflightRequest;
  }

  const request = readLocalImageBinary(localFilePath)
    .then(({ bytes, mimeType }) => {
      const blob = new Blob([new Uint8Array(bytes)], {
        type: mimeType || 'image/png',
      });
      const displaySource = URL.createObjectURL(blob);
      rememberLocalImageDisplaySource(localFilePath, displaySource);
      localImageDisplaySourceInflight.delete(localFilePath);
      return displaySource;
    })
    .catch((error) => {
      localImageDisplaySourceInflight.delete(localFilePath);
      localImageDisplaySourceFailureCache.set(localFilePath, Date.now());
      throw error;
    });

  localImageDisplaySourceInflight.set(localFilePath, request);
  return await request;
}

export async function persistImageLocally(
  source: string,
  mediaContext: MediaPersistContext = createCurrentProjectMediaContext('image')
): Promise<string> {
  const localFilePath = resolveLocalFileSourcePath(source);
  if (localFilePath) {
    // Keep Tauri-side image sources inside the app storage pool so the node's
    // original image path stays stable across imports, reloads, and drag flows.
    if (isTauri()) {
      return await persistImageSource(localFilePath, mediaContext);
    }
    return localFilePath;
  }

  if (!isTauri()) {
    return source;
  }

  return await persistImageSource(source, mediaContext);
}

async function canReadLocalImageSource(source: string): Promise<boolean> {
  const localFilePath = resolveLocalFileSourcePath(source);
  if (!localFilePath) {
    return true;
  }

  if (isTauri()) {
    try {
      await loadStableImageDisplaySource(localFilePath);
      return true;
    } catch {
      return false;
    }
  }

  try {
    const response = await fetch(resolveImageDisplayUrl(localFilePath));
    return response.ok;
  } catch {
    return false;
  }
}

export async function resolveReadableImageSource(
  source: string,
  fallbackSource?: string | null
): Promise<string> {
  const normalizedSource = source.trim();
  const normalizedFallback =
    typeof fallbackSource === 'string' ? fallbackSource.trim() : '';

  if (!normalizedSource) {
    return normalizedFallback;
  }

  if (!normalizedFallback || normalizedFallback === normalizedSource) {
    return normalizedSource;
  }

  return (await canReadLocalImageSource(normalizedSource))
    ? normalizedSource
    : normalizedFallback;
}

async function canRenderLocalImageSource(source: string): Promise<boolean> {
  const localFilePath = resolveLocalFileSourcePath(source);
  if (!localFilePath) {
    return true;
  }

  try {
    await loadStableImageDisplaySource(localFilePath);
    return true;
  } catch {
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

async function waitForLocalImageSourceReadiness(source: string): Promise<boolean> {
  const normalizedSource = source.trim();
  if (!normalizedSource) {
    return false;
  }

  for (let index = 0; index < LOCAL_IMAGE_READABILITY_RETRY_DELAYS_MS.length; index += 1) {
    if (await canRenderLocalImageSource(normalizedSource)) {
      return true;
    }

    const retryDelayMs = LOCAL_IMAGE_READABILITY_RETRY_DELAYS_MS[index];
    await sleep(retryDelayMs);
  }

  return await canRenderLocalImageSource(normalizedSource);
}

export async function waitForReadableLocalImageSource(
  source: string,
  fallbackSource?: string | null
): Promise<string> {
  const normalizedSource = source.trim();
  const normalizedFallback =
    typeof fallbackSource === 'string' ? fallbackSource.trim() : '';

  if (!normalizedSource) {
    return normalizedFallback;
  }

  const sourceReadable = await waitForLocalImageSourceReadiness(normalizedSource);
  if (sourceReadable) {
    return normalizedSource;
  }

  if (normalizedFallback && normalizedFallback !== normalizedSource) {
    const fallbackReadable = await waitForLocalImageSourceReadiness(normalizedFallback);
    if (fallbackReadable) {
      return normalizedFallback;
    }
  }

  throw createImagePipelineError(
    '链路中的本地图片尚未准备就绪',
    `source=${normalizedSource}\nfallback=${normalizedFallback || 'none'}`
  );
}

export async function ensurePreparedNodeImageReadable(
  prepared: PreparedNodeImage
): Promise<PreparedNodeImage> {
  const resolvedPreviewSource = await waitForReadableLocalImageSource(
    prepared.previewImageUrl,
    prepared.imageUrl
  );

  if (resolvedPreviewSource === prepared.previewImageUrl) {
    return prepared;
  }

  return {
    ...prepared,
    previewImageUrl: prepared.imageUrl,
  };
}

export async function createNodeOverviewThumbnail(
  source: string,
  mediaContext: MediaPersistContext = createCurrentProjectMediaContext('image')
): Promise<string> {
  const trimmedSource = source.trim();
  if (!trimmedSource) {
    throw createImagePipelineError('Thumbnail source is empty', 'source is empty');
  }

  if (isTauri()) {
    return await createNodeThumbnailSource(trimmedSource, mediaContext);
  }

  const thumbnailDataUrl = await createPreviewDataUrl(
    trimmedSource,
    OVERVIEW_THUMBNAIL_MAX_DIMENSION,
    { forceRender: true, mimeType: 'image/png' }
  );
  return await persistImageLocally(
    thumbnailDataUrl,
    { ...mediaContext, mediaType: 'image', role: 'thumbnail' }
  );
}

export async function loadImageElement(source: string): Promise<HTMLImageElement> {
  const image = new Image();
  const displaySource = await loadStableImageDisplaySource(source);
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
        const { bytes, mimeType } = await readLocalImageBinary(localFilePath);
        return await blobToDataUrl(new Blob([new Uint8Array(bytes)], {
          type: mimeType || 'image/png',
        }));
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
  maxPreviewDimension = DEFAULT_PREVIEW_MAX_DIMENSION,
  mediaContext: MediaPersistContext = createCurrentProjectMediaContext('image')
): Promise<PreparedNodeImage> {
  const started = performance.now();
  const tauriFilePath = (file as File & { path?: string }).path;
  const normalizedPath = typeof tauriFilePath === 'string' ? tauriFilePath.trim() : '';
  const canUseLocalPath =
    normalizedPath.length > 0
    && (isLikelyLocalImagePath(normalizedPath) || normalizedPath.toLowerCase().startsWith('file://'));
  if (canUseLocalPath) {
    const prepared = await prepareNodeImage(normalizedPath, maxPreviewDimension, mediaContext);
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
    const prepared = await prepareNodeImageBinary(bytes, extension, safeMaxDimension, mediaContext);
    const tauriElapsed = Math.round(performance.now() - tauriStarted);
    console.info(
      `[upload-perf][imageData] prepareNodeImageFromFile binary-mode name="${file.name}" size=${file.size}B readArrayBuffer=${readElapsed}ms tauriPrepare=${tauriElapsed}ms total=${Math.round(performance.now() - started)}ms`
    );
    return {
      imageUrl: prepared.imagePath,
      previewImageUrl: prepared.previewImagePath,
      thumbnailImageUrl: prepared.thumbnailImagePath,
      aspectRatio: prepared.aspectRatio,
    };
  }

  const dataUrlStarted = performance.now();
  const source = await readFileAsDataUrl(file);
  const dataUrlElapsed = Math.round(performance.now() - dataUrlStarted);
  const prepared = await prepareNodeImage(source, maxPreviewDimension, mediaContext);
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

export interface CreatePreviewDataUrlOptions {
  mimeType?: 'image/jpeg' | 'image/png' | 'image/webp';
  quality?: number;
  forceRender?: boolean;
}

export async function createPreviewDataUrl(
  imageUrl: string,
  maxDimension = DEFAULT_PREVIEW_MAX_DIMENSION,
  options: CreatePreviewDataUrlOptions = {}
): Promise<string> {
  const normalizedDataUrl = await imageUrlToDataUrl(imageUrl);
  const image = await loadImageElement(normalizedDataUrl);
  const safeMaxDimension = Math.max(64, Math.floor(maxDimension));
  if (!options.forceRender && !options.mimeType && !options.quality) {
    return renderPreviewDataUrl(image, normalizedDataUrl, safeMaxDimension);
  }

  const longestSide = Math.max(image.naturalWidth, image.naturalHeight);
  const scale = longestSide > safeMaxDimension ? safeMaxDimension / longestSide : 1;
  const targetWidth = Math.max(1, Math.round(image.naturalWidth * scale));
  const targetHeight = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;

  const context = canvas.getContext('2d');
  if (!context) {
    return renderPreviewDataUrl(image, normalizedDataUrl, safeMaxDimension);
  }

  const mimeType = options.mimeType ?? resolvePreviewMimeType(normalizedDataUrl);
  if (mimeType === 'image/jpeg') {
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, targetWidth, targetHeight);
  }
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(image, 0, 0, targetWidth, targetHeight);

  return canvas.toDataURL(mimeType, options.quality);
}

export async function prepareNodeImage(
  imageUrl: string,
  maxPreviewDimension = DEFAULT_PREVIEW_MAX_DIMENSION,
  mediaContext: MediaPersistContext = createCurrentProjectMediaContext('image')
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
      const prepared = await prepareNodeImageSource(
        trimmedImageUrl,
        safeMaxDimension,
        mediaContext
      );
      console.info(
        `[upload-perf][imageData] prepareNodeImage tauri-source elapsed=${Math.round(performance.now() - tauriStarted)}ms total=${Math.round(performance.now() - started)}ms`
      );
      return {
        imageUrl: prepared.imagePath,
        previewImageUrl: prepared.previewImagePath,
        thumbnailImageUrl: prepared.thumbnailImagePath,
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
    const persistedImagePath = await persistImageLocally(trimmedImageUrl, mediaContext);
    const normalizedDataUrl = await imageUrlToDataUrl(persistedImagePath);
    const image = await loadImageElement(normalizedDataUrl);
    const safeMaxDimension = Math.max(64, Math.floor(maxPreviewDimension));
    const previewDataUrl = renderPreviewDataUrl(image, normalizedDataUrl, safeMaxDimension);
    const previewImagePath =
      previewDataUrl === normalizedDataUrl
        ? persistedImagePath
        : await persistImageLocally(
          previewDataUrl,
          { ...mediaContext, mediaType: 'image', role: 'preview' }
        );
    const thumbnailDataUrl = await createPreviewDataUrl(
      persistedImagePath,
      OVERVIEW_THUMBNAIL_MAX_DIMENSION,
      { forceRender: true, mimeType: 'image/png' }
    );
    const thumbnailImagePath =
      thumbnailDataUrl === normalizedDataUrl
        ? persistedImagePath
        : await persistImageLocally(
          thumbnailDataUrl,
          { ...mediaContext, mediaType: 'image', role: 'thumbnail' }
        );

    console.info(
      `[upload-perf][imageData] prepareNodeImage browser-fallback total=${Math.round(performance.now() - started)}ms`
    );
    return {
      imageUrl: persistedImagePath,
      previewImageUrl: previewImagePath,
      thumbnailImageUrl: thumbnailImagePath,
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
