import { invoke } from '@tauri-apps/api/core';

import type {
  ScriptProjectPackageImportRecord,
  ScriptProjectPackagePreviewRecord,
  ScriptProjectPackageSnapshot,
} from '@/features/canvas/application/scriptImportExportTypes';

export interface ExportScriptProjectPackageAssetInput {
  id: string;
  sourcePath: string;
  matchValues: string[];
  archiveFileName?: string;
}

export interface ExportScriptProjectPackageInfoInput {
  projectId?: string | null;
  projectName: string;
  title: string;
  projectType: 'script';
  exportedAt: string;
}

export interface ExportScriptProjectPackagePayload {
  targetPath: string;
  info: ExportScriptProjectPackageInfoInput;
  project: ScriptProjectPackageSnapshot;
  assets: ExportScriptProjectPackageAssetInput[];
}

export async function exportScriptProjectPackage(
  payload: ExportScriptProjectPackagePayload
): Promise<void> {
  await invoke('export_script_project_package', { payload });
}

export async function previewScriptProjectPackage(
  packagePath: string
): Promise<ScriptProjectPackagePreviewRecord> {
  return await invoke<ScriptProjectPackagePreviewRecord>('preview_script_project_package', {
    packagePath,
  });
}

export async function importScriptProjectPackage(
  packagePath: string
): Promise<ScriptProjectPackageImportRecord> {
  return await invoke<ScriptProjectPackageImportRecord>('import_script_project_package', {
    packagePath,
  });
}
