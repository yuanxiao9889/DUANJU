import { invoke } from '@tauri-apps/api/core';
import type { MediaPersistContext } from './media';

export async function splitImage(
  imageBase64: string,
  rows: number,
  cols: number,
  lineThickness = 0
): Promise<string[]> {
  return await invoke('split_image', {
    imageBase64,
    rows,
    cols,
    lineThickness,
  });
}

export async function splitImageSource(
  source: string,
  rows: number,
  cols: number,
  lineThickness: number,
  colRatios?: number[],
  rowRatios?: number[],
  mediaContext?: MediaPersistContext
): Promise<string[]> {
  return await invoke('split_image_source', {
    source,
    rows,
    cols,
    lineThickness,
    colRatios,
    rowRatios,
    mediaContext,
  });
}

export interface MergeStoryboardImagesPayload {
  frameSources: string[];
  rows: number;
  cols: number;
  cellGap: number;
  outerPadding: number;
  noteHeight: number;
  fontSize: number;
  backgroundColor: string;
  maxDimension: number;
  showFrameIndex?: boolean;
  showFrameNote?: boolean;
  notePlacement?: 'overlay' | 'bottom';
  imageFit?: 'cover' | 'contain';
  frameIndexPrefix?: string;
  textColor?: string;
  frameNotes?: string[];
}

export interface StoryboardImageMetadata {
  gridRows: number;
  gridCols: number;
  frameNotes: string[];
}

export interface PrepareNodeImageSourceResult {
  imagePath: string;
  previewImagePath: string;
  thumbnailImagePath: string;
  thumbnailMaxDimension?: number;
  aspectRatio: string;
}

export interface ReadLocalImageBinaryResult {
  bytes: number[];
  mimeType: string;
}

export interface OptimizeReferenceImagesForApiOptions {
  maxDimension?: number;
  maxBytes?: number;
}

export interface OptimizedReferenceImageForApi {
  source: string;
  imagePath: string;
  originalFormat: string;
  outputFormat: string;
  originalWidth: number;
  originalHeight: number;
  outputWidth: number;
  outputHeight: number;
  originalBytes: number;
  outputBytes: number;
  resized: boolean;
  transparent: boolean;
}

export interface CropImageSourcePayload {
  source: string;
  aspectRatio?: string;
  cropX?: number;
  cropY?: number;
  cropWidth?: number;
  cropHeight?: number;
}

export interface MergeStoryboardImagesResult {
  imagePath: string;
  canvasWidth: number;
  canvasHeight: number;
  cellWidth: number;
  cellHeight: number;
  gap: number;
  padding: number;
  noteHeight: number;
  fontSize: number;
  textOverlayApplied: boolean;
}

export async function mergeStoryboardImages(
  payload: MergeStoryboardImagesPayload,
  mediaContext?: MediaPersistContext
): Promise<MergeStoryboardImagesResult> {
  return await invoke('merge_storyboard_images', { payload, mediaContext });
}

export async function readStoryboardImageMetadata(
  source: string
): Promise<StoryboardImageMetadata | null> {
  return await invoke('read_storyboard_image_metadata', { source });
}

export async function embedStoryboardImageMetadata(
  source: string,
  metadata: StoryboardImageMetadata,
  mediaContext?: MediaPersistContext
): Promise<string> {
  return await invoke('embed_storyboard_image_metadata', { source, metadata, mediaContext });
}

export async function prepareNodeImageSource(
  source: string,
  maxPreviewDimension = 256,
  maxThumbnailDimension?: number,
  mediaContext?: MediaPersistContext
): Promise<PrepareNodeImageSourceResult> {
  return await invoke('prepare_node_image_source', {
    source,
    maxPreviewDimension,
    maxThumbnailDimension,
    mediaContext,
  });
}

export async function prepareNodeImageBinary(
  bytes: Uint8Array,
  extension?: string,
  maxPreviewDimension = 256,
  maxThumbnailDimension?: number,
  mediaContext?: MediaPersistContext
): Promise<PrepareNodeImageSourceResult> {
  return await invoke('prepare_node_image_binary', {
    bytes: Array.from(bytes),
    extension,
    maxPreviewDimension,
    maxThumbnailDimension,
    mediaContext,
  });
}

export async function createNodeThumbnailSource(
  source: string,
  mediaContext?: MediaPersistContext,
  maxDimension?: number
): Promise<string> {
  return await invoke('create_node_thumbnail_source', {
    source,
    mediaContext,
    maxDimension,
  });
}

export async function cropImageSource(
  payload: CropImageSourcePayload,
  mediaContext?: MediaPersistContext
): Promise<string> {
  return await invoke('crop_image_source', { payload, mediaContext });
}

export async function loadImage(filePath: string): Promise<string> {
  return await invoke('load_image', {
    filePath,
  });
}

export async function readLocalImageBinary(
  filePath: string
): Promise<ReadLocalImageBinaryResult> {
  return await invoke<ReadLocalImageBinaryResult>('read_local_image_binary', {
    filePath,
  });
}

export async function persistImageSource(
  source: string,
  mediaContext?: MediaPersistContext
): Promise<string> {
  return await invoke('persist_image_source', { source, mediaContext });
}

export async function persistImageBinary(
  bytes: Uint8Array,
  extension = 'png',
  mediaContext?: MediaPersistContext
): Promise<string> {
  return await invoke('persist_image_binary', {
    bytes: Array.from(bytes),
    extension,
    mediaContext,
  });
}

export async function optimizeReferenceImagesForApi(
  sources: string[],
  options?: OptimizeReferenceImagesForApiOptions,
  mediaContext?: MediaPersistContext
): Promise<OptimizedReferenceImageForApi[]> {
  return await invoke('optimize_reference_images_for_api', {
    sources,
    options,
    mediaContext,
  });
}

export async function saveImageSourceToDownloads(
  source: string,
  suggestedFileName?: string
): Promise<string> {
  return await invoke('save_image_source_to_downloads', {
    source,
    suggestedFileName,
  });
}

export async function saveImageSourceToPath(
  source: string,
  targetPath: string
): Promise<string> {
  return await invoke('save_image_source_to_path', {
    source,
    targetPath,
  });
}

export async function saveImageSourceToDirectory(
  source: string,
  targetDir: string,
  suggestedFileName?: string
): Promise<string> {
  return await invoke('save_image_source_to_directory', {
    source,
    targetDir,
    suggestedFileName,
  });
}

export async function saveImageSourceToAppDebugDir(
  source: string,
  category = 'grid',
  suggestedFileName?: string
): Promise<string> {
  return await invoke('save_image_source_to_app_debug_dir', {
    source,
    category,
    suggestedFileName,
  });
}

export async function copyImageSourceToClipboard(source: string): Promise<void> {
  await invoke('copy_image_source_to_clipboard', { source });
}
