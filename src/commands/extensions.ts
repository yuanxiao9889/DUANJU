import { invoke, isTauri } from '@tauri-apps/api/core';

import type { ExtensionPackageManifest } from '@/features/extensions/domain/types';

export interface ExtensionRuntimeStatus {
  extensionId: string;
  runtime: string;
  supportsPersistentRuntime: boolean;
  running: boolean;
  pid: number | null;
  startedAt: number | null;
}

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

export async function listLocalExtensionPackages(): Promise<string[]> {
  if (!isTauri()) {
    return [];
  }

  return await invoke<string[]>('list_local_extension_packages');
}

export async function startExtensionRuntime(
  folderPath: string
): Promise<ExtensionRuntimeStatus> {
  if (!isTauri()) {
    throw new Error('Extensions are only available in the desktop runtime.');
  }

  return await invoke<ExtensionRuntimeStatus>('start_extension_runtime', {
    folderPath,
  });
}

export async function stopExtensionRuntime(
  folderPath: string
): Promise<ExtensionRuntimeStatus> {
  if (!isTauri()) {
    throw new Error('Extensions are only available in the desktop runtime.');
  }

  return await invoke<ExtensionRuntimeStatus>('stop_extension_runtime', {
    folderPath,
  });
}

export async function getExtensionRuntimeStatus(
  folderPath: string
): Promise<ExtensionRuntimeStatus> {
  if (!isTauri()) {
    throw new Error('Extensions are only available in the desktop runtime.');
  }

  return await invoke<ExtensionRuntimeStatus>('get_extension_runtime_status', {
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
