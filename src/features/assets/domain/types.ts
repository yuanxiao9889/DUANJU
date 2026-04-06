export const ASSET_CATEGORIES = ['character', 'scene', 'prop', 'voice'] as const;
export const ASSET_MEDIA_TYPES = ['image', 'audio'] as const;

export type AssetCategory = (typeof ASSET_CATEGORIES)[number];
export type AssetMediaType = (typeof ASSET_MEDIA_TYPES)[number];

export interface VoicePresetAssetMetadata {
  type: 'qwen_tts_voice_preset';
  referenceTranscript: string;
  promptFile?: string | null;
  promptLabel?: string | null;
  voicePrompt?: string | null;
  stylePreset?: string | null;
  language?: string | null;
  speakingRate?: number | null;
  pitch?: number | null;
  sourceGeneration?: string | null;
  savedAt?: number | null;
}

export interface AssetMetadata {
  voicePreset?: VoicePresetAssetMetadata;
  [key: string]: unknown;
}

export interface AssetSubcategoryRecord {
  id: string;
  libraryId: string;
  category: AssetCategory;
  name: string;
  createdAt: number;
  updatedAt: number;
}

export interface AssetItemRecord {
  id: string;
  libraryId: string;
  category: AssetCategory;
  mediaType: AssetMediaType;
  subcategoryId: string | null;
  name: string;
  description: string;
  tags: string[];
  sourcePath: string;
  previewPath: string | null;
  mimeType: string | null;
  durationMs: number | null;
  aspectRatio: string;
  metadata: AssetMetadata | null;
  createdAt: number;
  updatedAt: number;
}

export interface AssetLibraryRecord {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  subcategories: AssetSubcategoryRecord[];
  items: AssetItemRecord[];
}

export interface CreateAssetLibraryPayload {
  name: string;
}

export interface UpdateAssetLibraryPayload extends CreateAssetLibraryPayload {
  id: string;
}

export interface CreateAssetSubcategoryPayload {
  libraryId: string;
  category: AssetCategory;
  name: string;
}

export interface UpdateAssetSubcategoryPayload {
  id: string;
  name: string;
}

export interface AssetItemMutationPayload {
  libraryId: string;
  category: AssetCategory;
  mediaType: AssetMediaType;
  subcategoryId: string | null;
  name: string;
  description: string;
  tags: string[];
  sourcePath: string;
  previewPath: string | null;
  mimeType: string | null;
  durationMs: number | null;
  aspectRatio: string;
  metadata?: AssetMetadata | null;
}

export interface CreateAssetItemPayload extends AssetItemMutationPayload {}

export interface UpdateAssetItemPayload extends AssetItemMutationPayload {
  id: string;
}

export const ASSET_DRAG_MIME_TYPE = 'application/x-storyboard-asset';

export interface CanvasAssetDragPayload {
  assetId: string;
  assetLibraryId: string;
  assetName: string;
  assetCategory: AssetCategory;
  mediaType: AssetMediaType;
  sourcePath: string;
  previewPath: string | null;
  mimeType: string | null;
  durationMs: number | null;
  aspectRatio: string;
}

export function resolveAssetMediaType(category: AssetCategory): AssetMediaType {
  return category === 'voice' ? 'audio' : 'image';
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function resolveVoicePresetAssetMetadata(
  value: AssetItemRecord | AssetMetadata | null | undefined
): VoicePresetAssetMetadata | null {
  const metadata = isObjectRecord(value)
    ? ('metadata' in value ? value.metadata : value)
    : null;
  if (!isObjectRecord(metadata)) {
    return null;
  }

  const voicePreset = metadata.voicePreset;
  if (!isObjectRecord(voicePreset)) {
    return null;
  }

  const referenceTranscript = normalizeText(voicePreset.referenceTranscript);
  if (!referenceTranscript) {
    return null;
  }

  const type = normalizeText(voicePreset.type) || 'qwen_tts_voice_preset';

  return {
    type: 'qwen_tts_voice_preset',
    referenceTranscript,
    promptFile: normalizeText(voicePreset.promptFile) || null,
    promptLabel: normalizeText(voicePreset.promptLabel) || null,
    voicePrompt: normalizeText(voicePreset.voicePrompt) || null,
    stylePreset: normalizeText(voicePreset.stylePreset) || null,
    language: normalizeText(voicePreset.language) || null,
    speakingRate:
      typeof voicePreset.speakingRate === 'number' && Number.isFinite(voicePreset.speakingRate)
        ? voicePreset.speakingRate
        : null,
    pitch:
      typeof voicePreset.pitch === 'number' && Number.isFinite(voicePreset.pitch)
        ? voicePreset.pitch
        : null,
    sourceGeneration: normalizeText(voicePreset.sourceGeneration || type) || null,
    savedAt:
      typeof voicePreset.savedAt === 'number' && Number.isFinite(voicePreset.savedAt)
        ? voicePreset.savedAt
        : null,
  };
}

export function isReusableVoicePresetAsset(item: AssetItemRecord): boolean {
  if (item.category !== 'voice' || item.mediaType !== 'audio') {
    return false;
  }

  return resolveVoicePresetAssetMetadata(item) !== null;
}

export function getAssetCategoryOrder(category: AssetCategory): number {
  return ASSET_CATEGORIES.indexOf(category);
}

export function getAssetCategoriesForMediaType(mediaType: AssetMediaType): AssetCategory[] {
  return ASSET_CATEGORIES.filter((category) => resolveAssetMediaType(category) === mediaType);
}

export function serializeAssetDragPayload(payload: CanvasAssetDragPayload): string {
  return JSON.stringify(payload);
}

export function parseAssetDragPayload(value: string | null | undefined): CanvasAssetDragPayload | null {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as Partial<CanvasAssetDragPayload>;
    if (
      typeof parsed.assetId !== 'string' ||
      typeof parsed.assetLibraryId !== 'string' ||
      typeof parsed.assetName !== 'string' ||
      typeof parsed.assetCategory !== 'string' ||
      typeof parsed.mediaType !== 'string' ||
      typeof parsed.sourcePath !== 'string' ||
      (parsed.previewPath !== null && parsed.previewPath !== undefined && typeof parsed.previewPath !== 'string') ||
      (parsed.mimeType !== null && parsed.mimeType !== undefined && typeof parsed.mimeType !== 'string') ||
      (parsed.durationMs !== null && parsed.durationMs !== undefined && typeof parsed.durationMs !== 'number') ||
      typeof parsed.aspectRatio !== 'string'
    ) {
      return null;
    }

    if (!ASSET_CATEGORIES.includes(parsed.assetCategory as AssetCategory)) {
      return null;
    }

    if (!ASSET_MEDIA_TYPES.includes(parsed.mediaType as AssetMediaType)) {
      return null;
    }

    return {
      assetId: parsed.assetId,
      assetLibraryId: parsed.assetLibraryId,
      assetName: parsed.assetName,
      assetCategory: parsed.assetCategory as AssetCategory,
      mediaType: parsed.mediaType as AssetMediaType,
      sourcePath: parsed.sourcePath,
      previewPath: parsed.previewPath ?? null,
      mimeType: parsed.mimeType ?? null,
      durationMs: parsed.durationMs ?? null,
      aspectRatio: parsed.aspectRatio,
    };
  } catch {
    return null;
  }
}
