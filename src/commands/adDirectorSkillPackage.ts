import { invoke } from '@tauri-apps/api/core';

import type {
  AdDirectorSkillPackageData,
  ImportedAdDirectorSkillPackageResult,
} from '@/features/ad/types';

export interface ExportAdDirectorSkillPackagePayload {
  targetPath: string;
  data: AdDirectorSkillPackageData;
}

export async function exportAdDirectorSkillPackage(
  payload: ExportAdDirectorSkillPackagePayload
): Promise<void> {
  await invoke('export_ad_director_skill_package', { payload });
}

export async function importAdDirectorSkillPackage(
  packagePath: string
): Promise<ImportedAdDirectorSkillPackageResult> {
  return await invoke<ImportedAdDirectorSkillPackageResult>(
    'import_ad_director_skill_package',
    { packagePath }
  );
}
