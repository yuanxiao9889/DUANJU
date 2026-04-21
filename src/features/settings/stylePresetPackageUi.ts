import type { TFunction } from 'i18next';

import {
  parseStylePresetPackageError,
  type MjStyleCodeImportSummary,
  type StyleTemplateImportSummary,
} from '@/features/settings/stylePresetPackages';

type PackageActionMode = 'import' | 'export';

function resolveUnknownErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  if (typeof error === 'string' && error.trim()) {
    return error;
  }

  return fallback;
}

export function formatStyleTemplateImportSummaryMessage(
  t: TFunction,
  summary: StyleTemplateImportSummary
): string {
  return t('styleTemplate.importSummary', {
    added: summary.added,
    updated: summary.updated,
    skipped: summary.skipped,
  });
}

export function formatStyleTemplateExportSuccessMessage(
  t: TFunction,
  categories: number,
  templates: number
): string {
  return t('styleTemplate.exportSuccess', {
    categories,
    templates,
  });
}

export function formatMjStyleCodeImportSummaryMessage(
  t: TFunction,
  summary: MjStyleCodeImportSummary
): string {
  return t('node.midjourney.personalization.importSummary', {
    added: summary.added,
    updated: summary.updated,
    skipped: summary.skipped,
  });
}

export function formatMjStyleCodeExportSuccessMessage(
  t: TFunction,
  presets: number
): string {
  return t('node.midjourney.personalization.exportSuccess', {
    presets,
  });
}

export function resolveStyleTemplatePackageErrorMessage(
  t: TFunction,
  error: unknown,
  mode: PackageActionMode
): string {
  const parsedError = parseStylePresetPackageError(error);
  switch (parsedError.code) {
    case 'package_kind_mismatch':
      return t('styleTemplate.importKindMismatch');
    case 'invalid_schema':
      return t('styleTemplate.importInvalidSchema');
    case 'invalid_version':
      return t('styleTemplate.importInvalidVersion');
    case 'missing_template_image':
      return t('styleTemplate.exportMissingImage', {
        name: parsedError.detail ?? t('styleTemplate.templateName'),
      });
    case 'invalid_asset_blob':
    case 'invalid_asset_reference':
      return t('styleTemplate.importInvalidAssets');
    default:
      return resolveUnknownErrorMessage(
        error,
        mode === 'import'
          ? t('styleTemplate.importFailed')
          : t('styleTemplate.exportFailed')
      );
  }
}

export function resolveMjStyleCodePackageErrorMessage(
  t: TFunction,
  error: unknown,
  mode: PackageActionMode
): string {
  const parsedError = parseStylePresetPackageError(error);
  switch (parsedError.code) {
    case 'package_kind_mismatch':
      return t('node.midjourney.personalization.importKindMismatch');
    case 'invalid_schema':
      return t('node.midjourney.personalization.importInvalidSchema');
    case 'invalid_version':
      return t('node.midjourney.personalization.importInvalidVersion');
    case 'missing_preset_image':
      return t('node.midjourney.personalization.exportMissingImage', {
        name: parsedError.detail ?? t('node.midjourney.personalization.previewName'),
      });
    case 'invalid_asset_blob':
    case 'invalid_asset_reference':
      return t('node.midjourney.personalization.importInvalidAssets');
    default:
      return resolveUnknownErrorMessage(
        error,
        mode === 'import'
          ? t('node.midjourney.personalization.importFailed')
          : t('node.midjourney.personalization.exportFailed')
      );
  }
}
