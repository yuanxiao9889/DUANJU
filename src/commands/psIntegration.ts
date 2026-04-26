import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

export interface ServerStatus {
  running: boolean;
  port: number | null;
  ps_connected: boolean;
}

export type PsServerStatus = ServerStatus;

export interface PsImageReceived {
  id: string;
  base64: string;
  width: number;
  height: number;
}

export interface PsSelectionInfo {
  type: string;
  hasSelection: boolean;
  bounds?: {
    left: number;
    top: number;
    right: number;
    bottom: number;
  };
  width?: number;
  height?: number;
  documentName?: string;
  error?: string;
}

export interface PsSelectionImage {
  type: string;
  success: boolean;
  data?: {
    base64: string;
    width: number;
    height: number;
    originalWidth: number;
    originalHeight: number;
    scale: number;
  };
  error?: string;
}

export async function startPsServer(port?: number): Promise<number> {
  return await invoke('start_ps_server', { port });
}

export async function stopPsServer(): Promise<void> {
  return await invoke('stop_ps_server');
}

export async function getPsServerStatus(): Promise<ServerStatus> {
  return await invoke('get_ps_server_status');
}

export async function sendImageToPhotoshop(imagePath: string): Promise<void> {
  console.log('[psIntegration] sendImageToPhotoshop called with:', imagePath?.substring(0, 100));
  try {
    const result = await invoke('send_image_to_photoshop', { imagePath });
    console.log('[psIntegration] sendImageToPhotoshop result:', result);
    return result as void;
  } catch (error) {
    console.error('[psIntegration] sendImageToPhotoshop error:', error);
    throw error;
  }
}

export async function getPsSelection(): Promise<PsSelectionInfo> {
  return await invoke('get_ps_selection');
}

export async function getPsSelectionImage(): Promise<PsSelectionImage> {
  return await invoke('get_ps_selection_image');
}

export function onPsImageReceived(
  callback: (data: PsImageReceived) => void
): Promise<UnlistenFn> {
  return listen<PsImageReceived>('ps:image-received', (event) => {
    callback(event.payload);
  });
}

export function onPsRequestSelectionImage(
  callback: () => void
): Promise<UnlistenFn> {
  return listen('ps:request-selection-image', () => {
    callback();
  });
}
