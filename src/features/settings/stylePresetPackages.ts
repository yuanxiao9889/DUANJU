import { persistImageSource } from '@/commands/image';
import {
  loadImageElement,
  resolveLocalFileSourcePath,
} from '@/features/canvas/application/imageData';
import {
  normalizeMjPersonalizationCode,
  sortMjStyleCodePresets,
  type MjStyleCodePreset,
} from '@/features/midjourney/domain/styleCodePresets';
import {
  sortStyleTemplateCategories,
  sortStyleTemplates,
  type StyleTemplate,
  type StyleTemplateCategory,
} from '@/features/project/styleTemplateUtils';

export const STYLE_TEMPLATE_PACKAGE_SCHEMA =
  'storyboard-copilot/style-template-package';
export const MJ_STYLE_CODE_PACKAGE_SCHEMA =
  'storyboard-copilot/mj-style-code-package';
export const STYLE_TEMPLATE_PACKAGE_KIND = 'style-template';
export const MJ_STYLE_CODE_PACKAGE_KIND = 'mj-style-code';
export const STYLE_PRESET_PACKAGE_VERSION = 1;
export const STYLE_PRESET_ASSET_REF_PREFIX = '__scpreset_asset__:';
export const STYLE_PRESET_PACKAGE_ERROR_PREFIX = 'scpreset::';
export const STYLE_TEMPLATE_PACKAGE_FILE_NAME = 'style-templates.scpreset';
export const MJ_STYLE_CODE_PACKAGE_FILE_NAME = 'mj-style-codes.scpreset';

export interface StylePresetPackageAssetEntry {
  id: string;
  originalFileName: string;
  byteSize: number;
}

export interface StylePresetPackageManifest {
  schema: string;
  version: number;
  exportedAt: string;
  appVersion: string | null;
  packageKind: string;
  assetCount: number;
  categoryCount: number;
  templateCount: number;
  presetCount: number;
  assets: StylePresetPackageAssetEntry[];
}

export interface StyleTemplatePackageData {
  categories: StyleTemplateCategory[];
  templates: StyleTemplate[];
}

export interface MjStyleCodePackageData {
  presets: MjStyleCodePreset[];
}

export interface ImportedStyleTemplatePackageResult {
  packagePath: string;
  manifest: StylePresetPackageManifest;
  data: StyleTemplatePackageData;
}

export interface ImportedMjStyleCodePackageResult {
  packagePath: string;
  manifest: StylePresetPackageManifest;
  data: MjStyleCodePackageData;
}

export interface StylePresetImportSummary {
  added: number;
  updated: number;
  skipped: number;
}

export interface StyleTemplateImportSummary extends StylePresetImportSummary {
  addedCategories: number;
  updatedCategories: number;
  skippedCategories: number;
  addedTemplates: number;
  updatedTemplates: number;
  skippedTemplates: number;
}

export interface MjStyleCodeImportSummary extends StylePresetImportSummary {
  addedPresets: number;
  updatedPresets: number;
  skippedPresets: number;
}

interface MergeStyleTemplatePackageInput {
  currentCategories: StyleTemplateCategory[];
  currentTemplates: StyleTemplate[];
  importedCategories: StyleTemplateCategory[];
  importedTemplates: StyleTemplate[];
}

interface MergeMjStyleCodePackageInput {
  currentPresets: MjStyleCodePreset[];
  importedPresets: MjStyleCodePreset[];
}

interface ParsedStylePresetPackageError {
  code: string | null;
  detail: string | null;
  rawMessage: string;
}

function normalizeNameKey(value: string | null | undefined): string {
  return (value ?? '').trim().toLocaleLowerCase();
}

function normalizePromptKey(value: string | null | undefined): string {
  return (value ?? '').trim().replace(/\s+/g, ' ');
}

function buildTemplateMatchKey(template: Pick<StyleTemplate, 'name' | 'prompt'>): string {
  return `${normalizeNameKey(template.name)}::${normalizePromptKey(template.prompt)}`;
}

function isBundledStyleTemplatePreview(imageUrl: string | null | undefined): boolean {
  const normalizedImageUrl = (imageUrl ?? '').trim();
  return (
    normalizedImageUrl.startsWith('/style-templates/')
    || normalizedImageUrl.startsWith('./style-templates/')
    || normalizedImageUrl.startsWith('style-templates/')
  );
}

function isImportedTemplateNewer(
  importedTemplate: StyleTemplate,
  currentTemplate: StyleTemplate
): boolean {
  if (importedTemplate.updatedAt > currentTemplate.updatedAt) {
    return true;
  }

  if (importedTemplate.updatedAt < currentTemplate.updatedAt) {
    return false;
  }

  const importedImageUrl = importedTemplate.imageUrl?.trim() ?? '';
  const currentImageUrl = currentTemplate.imageUrl?.trim() ?? '';
  if (!importedImageUrl || importedImageUrl === currentImageUrl) {
    return false;
  }

  if (!currentImageUrl) {
    return true;
  }

  return (
    isBuiltinStyleTemplateId(currentTemplate.id) &&
    isBundledStyleTemplatePreview(currentImageUrl) &&
    !isBundledStyleTemplatePreview(importedImageUrl)
  );
}

function isImportedCategoryNewer(
  importedCategory: StyleTemplateCategory,
  currentCategory: StyleTemplateCategory
): boolean {
  return importedCategory.updatedAt > currentCategory.updatedAt;
}

function isImportedPresetNewer(
  importedPreset: MjStyleCodePreset,
  currentPreset: MjStyleCodePreset
): boolean {
  return importedPreset.updatedAt > currentPreset.updatedAt;
}

export function isBuiltinStyleTemplateId(templateId: string): boolean {
  return templateId.trim().startsWith('builtin-');
}

export function buildStyleTemplatePackageData(
  categories: StyleTemplateCategory[],
  templates: StyleTemplate[]
): StyleTemplatePackageData {
  return {
    categories: sortStyleTemplateCategories(categories),
    templates: sortStyleTemplates(
      templates.filter((template) => !isBuiltinStyleTemplateId(template.id))
    ),
  };
}

export function buildMjStyleCodePackageData(
  presets: MjStyleCodePreset[]
): MjStyleCodePackageData {
  return {
    presets: sortMjStyleCodePresets(presets),
  };
}

function renderImageElementToPngDataUrl(image: HTMLImageElement): string {
  const width = Math.max(1, image.naturalWidth);
  const height = Math.max(1, image.naturalHeight);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Failed to create style preset export canvas context.');
  }

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(image, 0, 0, width, height);

  return canvas.toDataURL('image/png');
}

async function materializeStylePresetImageUrlForExport(
  imageUrl: string | null | undefined
): Promise<string | null> {
  const trimmedImageUrl = typeof imageUrl === 'string' ? imageUrl.trim() : '';
  if (!trimmedImageUrl) {
    return null;
  }

  const localFilePath = resolveLocalFileSourcePath(trimmedImageUrl);
  if (localFilePath) {
    return localFilePath;
  }

  try {
    const image = await loadImageElement(trimmedImageUrl);
    const rasterizedDataUrl = renderImageElementToPngDataUrl(image);
    return await persistImageSource(rasterizedDataUrl);
  } catch (rasterizeError) {
    try {
      return await persistImageSource(trimmedImageUrl);
    } catch {
      throw rasterizeError;
    }
  }
}

export async function prepareStyleTemplatePackageDataForExport(
  categories: StyleTemplateCategory[],
  templates: StyleTemplate[]
): Promise<StyleTemplatePackageData> {
  const baseData = buildStyleTemplatePackageData(categories, templates);

  return {
    categories: baseData.categories,
    templates: await Promise.all(
      baseData.templates.map(async (template) => ({
        ...template,
        imageUrl: await materializeStylePresetImageUrlForExport(template.imageUrl),
      }))
    ),
  };
}

export async function prepareMjStyleCodePackageDataForExport(
  presets: MjStyleCodePreset[]
): Promise<MjStyleCodePackageData> {
  const baseData = buildMjStyleCodePackageData(presets);

  return {
    presets: await Promise.all(
      baseData.presets.map(async (preset) => ({
        ...preset,
        imageUrl: await materializeStylePresetImageUrlForExport(preset.imageUrl),
      }))
    ),
  };
}

export function mergeImportedStyleTemplatePackageData(
  input: MergeStyleTemplatePackageInput
): {
  categories: StyleTemplateCategory[];
  templates: StyleTemplate[];
  summary: StyleTemplateImportSummary;
} {
  const summary: StyleTemplateImportSummary = {
    added: 0,
    updated: 0,
    skipped: 0,
    addedCategories: 0,
    updatedCategories: 0,
    skippedCategories: 0,
    addedTemplates: 0,
    updatedTemplates: 0,
    skippedTemplates: 0,
  };

  const nextCategories = sortStyleTemplateCategories(
    input.currentCategories.map((category) => ({ ...category }))
  );
  const nextTemplates = sortStyleTemplates(
    input.currentTemplates.map((template) => ({ ...template }))
  );

  let nextCategorySortOrder = nextCategories.reduce(
    (maxSortOrder, category) => Math.max(maxSortOrder, category.sortOrder),
    -1
  );
  let nextTemplateSortOrder = nextTemplates.reduce(
    (maxSortOrder, template) => Math.max(maxSortOrder, template.sortOrder),
    -1
  );

  const categoryIdToIndex = new Map(
    nextCategories.map((category, index) => [category.id, index] as const)
  );
  const categoryNameToId = new Map<string, string>();
  nextCategories.forEach((category) => {
    const key = normalizeNameKey(category.name);
    if (key && !categoryNameToId.has(key)) {
      categoryNameToId.set(key, category.id);
    }
  });

  const importedCategoryIdToLocalId = new Map<string, string>();
  const importedCategories = sortStyleTemplateCategories(input.importedCategories);

  for (const importedCategory of importedCategories) {
    const normalizedName = importedCategory.name.trim();
    const matchedCategoryId =
      categoryIdToIndex.has(importedCategory.id)
        ? importedCategory.id
        : categoryNameToId.get(normalizeNameKey(normalizedName)) ?? null;

    if (matchedCategoryId) {
      importedCategoryIdToLocalId.set(importedCategory.id, matchedCategoryId);
      const matchedCategoryIndex = categoryIdToIndex.get(matchedCategoryId);
      if (typeof matchedCategoryIndex !== 'number') {
        continue;
      }

      const matchedCategory = nextCategories[matchedCategoryIndex];
      if (isImportedCategoryNewer(importedCategory, matchedCategory)) {
        const previousCategoryNameKey = normalizeNameKey(matchedCategory.name);
        nextCategories[matchedCategoryIndex] = {
          ...matchedCategory,
          name: normalizedName || matchedCategory.name,
          updatedAt: importedCategory.updatedAt,
        };
        if (previousCategoryNameKey) {
          categoryNameToId.delete(previousCategoryNameKey);
        }
        categoryNameToId.set(
          normalizeNameKey(nextCategories[matchedCategoryIndex].name),
          nextCategories[matchedCategoryIndex].id
        );
        summary.updated += 1;
        summary.updatedCategories += 1;
      } else {
        summary.skipped += 1;
        summary.skippedCategories += 1;
      }
      continue;
    }

    nextCategorySortOrder += 1;
    const nextCategory: StyleTemplateCategory = {
      id: importedCategory.id,
      name: normalizedName,
      sortOrder: nextCategorySortOrder,
      createdAt: importedCategory.createdAt,
      updatedAt: importedCategory.updatedAt,
    };
    nextCategories.push(nextCategory);
    categoryIdToIndex.set(nextCategory.id, nextCategories.length - 1);
    categoryNameToId.set(normalizeNameKey(nextCategory.name), nextCategory.id);
    importedCategoryIdToLocalId.set(importedCategory.id, importedCategory.id);
    summary.added += 1;
    summary.addedCategories += 1;
  }

  const templateIdToIndex = new Map<string, number>();
  const templateMatchKeyToId = new Map<string, string>();
  nextTemplates.forEach((template, index) => {
    templateIdToIndex.set(template.id, index);
    const matchKey = buildTemplateMatchKey(template);
    if (matchKey && !templateMatchKeyToId.has(matchKey)) {
      templateMatchKeyToId.set(matchKey, template.id);
    }
  });

  const importedTemplates = sortStyleTemplates(input.importedTemplates);
  for (const importedTemplate of importedTemplates) {
    const matchedTemplateId =
      templateIdToIndex.has(importedTemplate.id)
        ? importedTemplate.id
        : templateMatchKeyToId.get(buildTemplateMatchKey(importedTemplate)) ?? null;
    const remappedCategoryId =
      importedTemplate.categoryId
        ? importedCategoryIdToLocalId.get(importedTemplate.categoryId) ?? null
        : null;

    if (matchedTemplateId) {
      const matchedTemplateIndex = templateIdToIndex.get(matchedTemplateId);
      if (typeof matchedTemplateIndex !== 'number') {
        continue;
      }

      const matchedTemplate = nextTemplates[matchedTemplateIndex];
      if (isImportedTemplateNewer(importedTemplate, matchedTemplate)) {
        const previousTemplateMatchKey = buildTemplateMatchKey(matchedTemplate);
        const nextTemplate: StyleTemplate = {
          ...matchedTemplate,
          name: importedTemplate.name.trim() || matchedTemplate.name,
          prompt: importedTemplate.prompt.trim() || matchedTemplate.prompt,
          imageUrl: importedTemplate.imageUrl,
          categoryId: remappedCategoryId,
          updatedAt: importedTemplate.updatedAt,
        };
        nextTemplates[matchedTemplateIndex] = nextTemplate;
        if (previousTemplateMatchKey) {
          templateMatchKeyToId.delete(previousTemplateMatchKey);
        }
        templateMatchKeyToId.set(buildTemplateMatchKey(nextTemplate), nextTemplate.id);
        summary.updated += 1;
        summary.updatedTemplates += 1;
      } else {
        summary.skipped += 1;
        summary.skippedTemplates += 1;
      }
      continue;
    }

    nextTemplateSortOrder += 1;
    const nextTemplate: StyleTemplate = {
      id: importedTemplate.id,
      name: importedTemplate.name.trim(),
      prompt: importedTemplate.prompt.trim(),
      imageUrl: importedTemplate.imageUrl,
      categoryId: remappedCategoryId,
      sortOrder: nextTemplateSortOrder,
      createdAt: importedTemplate.createdAt,
      updatedAt: importedTemplate.updatedAt,
      lastUsedAt: null,
    };
    nextTemplates.push(nextTemplate);
    templateIdToIndex.set(nextTemplate.id, nextTemplates.length - 1);
    templateMatchKeyToId.set(buildTemplateMatchKey(nextTemplate), nextTemplate.id);
    summary.added += 1;
    summary.addedTemplates += 1;
  }

  return {
    categories: sortStyleTemplateCategories(nextCategories),
    templates: sortStyleTemplates(nextTemplates),
    summary,
  };
}

export function mergeImportedMjStyleCodePackageData(
  input: MergeMjStyleCodePackageInput
): {
  presets: MjStyleCodePreset[];
  summary: MjStyleCodeImportSummary;
} {
  const summary: MjStyleCodeImportSummary = {
    added: 0,
    updated: 0,
    skipped: 0,
    addedPresets: 0,
    updatedPresets: 0,
    skippedPresets: 0,
  };

  const nextPresets = sortMjStyleCodePresets(
    input.currentPresets.map((preset) => ({ ...preset }))
  );
  let nextPresetSortOrder = nextPresets.reduce(
    (maxSortOrder, preset) => Math.max(maxSortOrder, preset.sortOrder),
    -1
  );

  const presetIdToIndex = new Map(
    nextPresets.map((preset, index) => [preset.id, index] as const)
  );
  const presetCodeToId = new Map<string, string>();
  nextPresets.forEach((preset) => {
    const normalizedCode = normalizeMjPersonalizationCode(preset.code);
    if (normalizedCode && !presetCodeToId.has(normalizedCode)) {
      presetCodeToId.set(normalizedCode, preset.id);
    }
  });

  const importedPresets = sortMjStyleCodePresets(input.importedPresets);
  for (const importedPreset of importedPresets) {
    const normalizedCode = normalizeMjPersonalizationCode(importedPreset.code);
    const matchedPresetId =
      presetCodeToId.get(normalizedCode) ??
      (presetIdToIndex.has(importedPreset.id) ? importedPreset.id : null);

    if (matchedPresetId) {
      const matchedPresetIndex = presetIdToIndex.get(matchedPresetId);
      if (typeof matchedPresetIndex !== 'number') {
        continue;
      }

      const matchedPreset = nextPresets[matchedPresetIndex];
      if (isImportedPresetNewer(importedPreset, matchedPreset)) {
        nextPresets[matchedPresetIndex] = {
          ...matchedPreset,
          name: importedPreset.name.trim() || matchedPreset.name,
          imageUrl: importedPreset.imageUrl,
          updatedAt: importedPreset.updatedAt,
        };
        summary.updated += 1;
        summary.updatedPresets += 1;
      } else {
        summary.skipped += 1;
        summary.skippedPresets += 1;
      }
      continue;
    }

    nextPresetSortOrder += 1;
    const nextPreset: MjStyleCodePreset = {
      id: importedPreset.id,
      name: importedPreset.name.trim() || normalizedCode,
      code: normalizedCode,
      imageUrl: importedPreset.imageUrl,
      sortOrder: nextPresetSortOrder,
      createdAt: importedPreset.createdAt,
      updatedAt: importedPreset.updatedAt,
      lastUsedAt: null,
    };
    nextPresets.push(nextPreset);
    presetIdToIndex.set(nextPreset.id, nextPresets.length - 1);
    presetCodeToId.set(normalizedCode, nextPreset.id);
    summary.added += 1;
    summary.addedPresets += 1;
  }

  return {
    presets: sortMjStyleCodePresets(nextPresets),
    summary,
  };
}

export function parseStylePresetPackageError(
  error: unknown
): ParsedStylePresetPackageError {
  const rawMessage =
    error instanceof Error ? error.message : typeof error === 'string' ? error : '';

  if (!rawMessage.startsWith(STYLE_PRESET_PACKAGE_ERROR_PREFIX)) {
    return {
      code: null,
      detail: null,
      rawMessage,
    };
  }

  const [, code = '', ...detailParts] = rawMessage.split('::');
  return {
    code: code || null,
    detail: detailParts.length > 0 ? detailParts.join('::') : null,
    rawMessage,
  };
}
