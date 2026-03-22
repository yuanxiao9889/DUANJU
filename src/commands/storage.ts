import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';

export interface StorageInfo {
  currentPath: string;
  defaultPath: string;
  isCustom: boolean;
  dbSize: number;
  imagesSize: number;
  totalSize: number;
}

export async function getStorageInfo(): Promise<StorageInfo> {
  return invoke<StorageInfo>('get_storage_info');
}

export async function migrateStorage(
  newPath: string,
  deleteOld: boolean
): Promise<string> {
  return invoke<string>('migrate_storage', { newPath, deleteOld });
}

export async function resetStorageToDefault(
  deleteCustom: boolean
): Promise<string> {
  return invoke<string>('reset_storage_to_default', { deleteCustom });
}

export async function openStorageFolder(): Promise<void> {
  return invoke<void>('open_storage_folder');
}

export async function selectStorageFolder(): Promise<string | null> {
  const selected = await open({
    directory: true,
    multiple: false,
    title: '选择项目存储位置',
  });

  if (typeof selected === 'string') {
    return selected;
  }

  return null;
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';

  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}
