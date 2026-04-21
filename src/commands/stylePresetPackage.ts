import { invoke } from '@tauri-apps/api/core';

import type {
  ImportedMjStyleCodePackageResult,
  ImportedStyleTemplatePackageResult,
  MjStyleCodePackageData,
  StyleTemplatePackageData,
} from '@/features/settings/stylePresetPackages';

export interface ExportStyleTemplatePackagePayload {
  targetPath: string;
  data: StyleTemplatePackageData;
}

export interface ExportMjStyleCodePackagePayload {
  targetPath: string;
  data: MjStyleCodePackageData;
}

export async function exportStyleTemplatePackage(
  payload: ExportStyleTemplatePackagePayload
): Promise<void> {
  await invoke('export_style_template_package', { payload });
}

export async function importStyleTemplatePackage(
  packagePath: string
): Promise<ImportedStyleTemplatePackageResult> {
  return await invoke<ImportedStyleTemplatePackageResult>(
    'import_style_template_package',
    { packagePath }
  );
}

export async function exportMjStyleCodePackage(
  payload: ExportMjStyleCodePackagePayload
): Promise<void> {
  await invoke('export_mj_style_code_package', { payload });
}

export async function importMjStyleCodePackage(
  packagePath: string
): Promise<ImportedMjStyleCodePackageResult> {
  return await invoke<ImportedMjStyleCodePackageResult>(
    'import_mj_style_code_package',
    { packagePath }
  );
}
