import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { v4 as uuidv4 } from 'uuid';

import { focusProjectWindow } from '@/commands/projectWindowSessions';

export const MAIN_WINDOW_LABEL = 'main';
export const WORKSPACE_WINDOW_PREFIX = 'workspace-';

export function isWorkspaceWindowLabel(label: string): boolean {
  return label === MAIN_WINDOW_LABEL || label.startsWith(WORKSPACE_WINDOW_PREFIX);
}

export async function openWorkspaceWindow(title: string): Promise<WebviewWindow> {
  const label = `${WORKSPACE_WINDOW_PREFIX}${uuidv4()}`;
  return new WebviewWindow(label, {
    title,
    width: 1600,
    height: 920,
    minWidth: 960,
    minHeight: 600,
    center: true,
    resizable: true,
    decorations: false,
    minimizable: true,
    maximizable: true,
    closable: true,
    shadow: true,
    visible: true,
    focus: true,
  });
}

export async function focusWorkspaceWindow(label: string): Promise<void> {
  await focusProjectWindow(label);
}
