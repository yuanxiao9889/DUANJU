import { isTauri as isTauriApiRuntime } from '@tauri-apps/api/core';

export function hasTauriInternalsBridge(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  const maybeWindow = window as Window & {
    __TAURI_INTERNALS__?: unknown;
  };
  return typeof maybeWindow.__TAURI_INTERNALS__ === 'object'
    && maybeWindow.__TAURI_INTERNALS__ !== null;
}

export function isTauriRuntime(): boolean {
  return isTauriApiRuntime() && hasTauriInternalsBridge();
}
