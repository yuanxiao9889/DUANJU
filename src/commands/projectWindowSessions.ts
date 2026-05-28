import { invoke } from '@tauri-apps/api/core';

export interface ProjectEditSession {
  projectId: string;
  windowLabel: string;
}

export interface ClaimProjectEditSessionResult {
  claimed: boolean;
  ownerWindowLabel: string | null;
}

export async function registerProjectWindow(windowLabel: string): Promise<void> {
  await invoke('register_project_window', { windowLabel });
}

export async function unregisterProjectWindow(windowLabel: string): Promise<void> {
  await invoke('unregister_project_window', { windowLabel });
}

export async function claimProjectEditSession(
  projectId: string,
  windowLabel: string,
): Promise<ClaimProjectEditSessionResult> {
  return await invoke<ClaimProjectEditSessionResult>('claim_project_edit_session', {
    projectId,
    windowLabel,
  });
}

export async function releaseProjectEditSession(
  projectId: string,
  windowLabel: string,
): Promise<void> {
  await invoke('release_project_edit_session', { projectId, windowLabel });
}

export async function listProjectEditSessions(): Promise<ProjectEditSession[]> {
  return await invoke<ProjectEditSession[]>('list_project_edit_sessions');
}

export async function focusProjectWindow(windowLabel: string): Promise<void> {
  await invoke('focus_project_window', { windowLabel });
}
