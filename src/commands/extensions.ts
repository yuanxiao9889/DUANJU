import { invoke, isTauri } from '@tauri-apps/api/core';

import type { ExtensionPackageManifest } from '@/features/extensions/domain/types';

export async function readExtensionPackage(
  folderPath: string
): Promise<ExtensionPackageManifest> {
  if (!isTauri()) {
    throw new Error('Extensions are only available in the desktop runtime.');
  }

  return await invoke<ExtensionPackageManifest>('read_extension_package', {
    folderPath,
  });
}

export async function runExtensionCommand<TResponse = Record<string, unknown>>(
  folderPath: string,
  command: string,
  payload?: Record<string, unknown>
): Promise<TResponse> {
  if (!isTauri()) {
    throw new Error('Extensions are only available in the desktop runtime.');
  }

  return await invoke<TResponse>('run_extension_command', {
    folderPath,
    command,
    payload,
  });
}
