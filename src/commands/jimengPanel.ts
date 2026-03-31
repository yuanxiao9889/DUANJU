import { invoke } from '@tauri-apps/api/core';

export interface EnsureJimengPanelWindowPayload {
  x: number;
  y: number;
  width: number;
  height: number;
  minWidth: number;
  minHeight: number;
  decorations: boolean;
  resizable: boolean;
  skipTaskbar: boolean;
  focus: boolean;
}

export async function ensureJimengPanelWindow(
  payload: EnsureJimengPanelWindowPayload
): Promise<void> {
  await invoke('ensure_jimeng_panel_window', { payload });
}

export interface SubmitJimengPanelPayload {
  prompt: string;
  creationType?: string;
  model?: string;
  referenceMode?: string;
  aspectRatio?: string;
  durationSeconds?: number;
  skipToolbarAutomation?: boolean;
  referenceImages?: Array<{
    fileName: string;
    dataUrl: string;
  }>;
  referenceAudios?: Array<{
    fileName: string;
    dataUrl: string;
  }>;
  extraControls?: Array<{
    controlIndex: number;
    triggerText: string;
    optionText: string;
  }>;
  autoSubmit?: boolean;
}

export async function submitJimengPanelTask(
  payload: SubmitJimengPanelPayload
): Promise<void> {
  await invoke('submit_jimeng_panel_task', { payload });
}

export async function inspectJimengPanelOptions<T = unknown>(): Promise<T> {
  return await invoke<T>('inspect_jimeng_panel_options');
}

export async function syncJimengPanelDraftOptions<T = unknown>(
  payload: SubmitJimengPanelPayload
): Promise<T> {
  return await invoke<T>('sync_jimeng_panel_draft_options', { payload });
}

export interface JimengChromeSessionInfo {
  executablePath: string;
  userDataDir: string;
  remoteDebuggingPort: number;
  targetUrl: string;
}

export interface JimengChromeWorkspacePayload {
  creationType?: string;
}

export interface JimengChromeGeneratedImageResult {
  index: number;
  sourceUrl: string;
  signature: string;
  width?: number | null;
  height?: number | null;
  altText?: string | null;
}

export async function ensureJimengChromeSession(
  payload?: JimengChromeWorkspacePayload
): Promise<JimengChromeSessionInfo> {
  return await invoke<JimengChromeSessionInfo>('ensure_jimeng_chrome_session', { payload });
}

export async function focusJimengChromeWorkspace(
  payload?: JimengChromeWorkspacePayload
): Promise<JimengChromeSessionInfo> {
  return await invoke<JimengChromeSessionInfo>('focus_jimeng_chrome_workspace', { payload });
}

export async function submitJimengChromeTask(
  payload: SubmitJimengPanelPayload
): Promise<void> {
  await invoke('submit_jimeng_chrome_task', { payload });
}

export async function generateJimengChromeImages(
  payload: SubmitJimengPanelPayload
): Promise<JimengChromeGeneratedImageResult[]> {
  return await invoke<JimengChromeGeneratedImageResult[]>('generate_jimeng_chrome_images', {
    payload,
  });
}

export async function inspectJimengChromeOptions<T = unknown>(
  payload?: JimengChromeWorkspacePayload
): Promise<T> {
  return await invoke<T>('inspect_jimeng_chrome_options', { payload });
}

export async function syncJimengChromeDraftOptions<T = unknown>(
  payload: SubmitJimengPanelPayload
): Promise<T> {
  return await invoke<T>('sync_jimeng_chrome_draft_options', { payload });
}
