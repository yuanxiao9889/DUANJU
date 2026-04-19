import { getCurrentWindow } from '@tauri-apps/api/window';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';

export const CLIP_LIBRARY_PANEL_WINDOW_LABEL = 'clip-library-panel';
export const CLIP_LIBRARY_PANEL_READY_EVENT = 'clip-library-panel:ready';
export const CLIP_LIBRARY_PANEL_CONTEXT_EVENT = 'clip-library-panel:project-context';
export const CLIP_LIBRARY_PANEL_FOCUS_TARGET_EVENT = 'clip-library-panel:focus-target';
export const CLIP_LIBRARY_PANEL_SET_LIBRARY_EVENT = 'clip-library-panel:set-library';
export const CLIP_LIBRARY_PANEL_CLOSED_EVENT = 'clip-library-panel:closed';
export const CLIP_LIBRARY_PANEL_NODE_BOUND_EVENT = 'clip-library-panel:node-bound';

const MAIN_WINDOW_LABEL = 'main';
const CLIP_LIBRARY_PANEL_BOUNDS_STORAGE_KEY = 'storyboard.clip-library-panel.bounds';
const DEFAULT_CLIP_LIBRARY_PANEL_WIDTH = 1440;
const DEFAULT_CLIP_LIBRARY_PANEL_HEIGHT = 900;
const MIN_CLIP_LIBRARY_PANEL_WIDTH = 900;
const MIN_CLIP_LIBRARY_PANEL_HEIGHT = 620;

export type ClipLibraryPanelProjectType = 'storyboard' | 'script';

export interface ClipLibraryPanelProjectContext {
  projectId: string | null;
  projectName: string | null;
  projectType: ClipLibraryPanelProjectType | null;
  clipLibraryId: string | null;
  clipLastFolderId: string | null;
}

export interface ClipLibraryPanelFocusTarget {
  clipLibraryId?: string | null;
  clipFolderId?: string | null;
  clipItemId?: string | null;
}

export interface ClipLibraryPanelNodeBoundPayload {
  projectId: string;
  nodeId: string;
  clipLibraryId: string;
  clipFolderId: string;
  clipItemId: string;
}

interface ClipLibraryPanelStoredBounds {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

const EMPTY_PROJECT_CONTEXT: ClipLibraryPanelProjectContext = {
  projectId: null,
  projectName: null,
  projectType: null,
  clipLibraryId: null,
  clipLastFolderId: null,
};

let latestClipLibraryPanelProjectContext: ClipLibraryPanelProjectContext = EMPTY_PROJECT_CONTEXT;
let queuedClipLibraryId: string | null | undefined;
let queuedFocusTarget: ClipLibraryPanelFocusTarget | null = null;
let clipLibraryPanelOpenBlockedUntil = 0;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function readStoredBounds(): ClipLibraryPanelStoredBounds {
  if (typeof window === 'undefined') {
    return {};
  }

  try {
    const raw = window.localStorage.getItem(CLIP_LIBRARY_PANEL_BOUNDS_STORAGE_KEY);
    if (!raw) {
      return {};
    }

    const parsed = JSON.parse(raw) as Partial<ClipLibraryPanelStoredBounds>;
    return {
      x: isFiniteNumber(parsed.x) ? parsed.x : undefined,
      y: isFiniteNumber(parsed.y) ? parsed.y : undefined,
      width: isFiniteNumber(parsed.width) ? parsed.width : undefined,
      height: isFiniteNumber(parsed.height) ? parsed.height : undefined,
    };
  } catch {
    return {};
  }
}

function writeStoredBounds(bounds: ClipLibraryPanelStoredBounds) {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(CLIP_LIBRARY_PANEL_BOUNDS_STORAGE_KEY, JSON.stringify(bounds));
  } catch {
    // Ignore storage failures and fall back to default bounds next time.
  }
}

export function setLatestClipLibraryPanelProjectContext(
  context: ClipLibraryPanelProjectContext
) {
  latestClipLibraryPanelProjectContext = context;
}

export function getLatestClipLibraryPanelProjectContext(): ClipLibraryPanelProjectContext {
  return latestClipLibraryPanelProjectContext;
}

export function blockClipLibraryPanelOpenFor(durationMs = 1000) {
  clipLibraryPanelOpenBlockedUntil = Math.max(
    clipLibraryPanelOpenBlockedUntil,
    Date.now() + Math.max(0, durationMs)
  );
}

export function isClipLibraryPanelOpenBlocked(): boolean {
  return Date.now() < clipLibraryPanelOpenBlockedUntil;
}

export function queueClipLibraryPanelLibrary(libraryId: string | null) {
  queuedClipLibraryId = libraryId?.trim() || null;
}

export function queueClipLibraryPanelFocusTarget(
  target: ClipLibraryPanelFocusTarget | null
) {
  queuedFocusTarget = target;
}

export function consumeClipLibraryPanelNavigationQueue(): {
  libraryId: string | null | undefined;
  focusTarget: ClipLibraryPanelFocusTarget | null;
} {
  const payload = {
    libraryId: queuedClipLibraryId,
    focusTarget: queuedFocusTarget,
  };
  queuedClipLibraryId = undefined;
  queuedFocusTarget = null;
  return payload;
}

export async function getClipLibraryPanelWindow(): Promise<WebviewWindow | null> {
  return await WebviewWindow.getByLabel(CLIP_LIBRARY_PANEL_WINDOW_LABEL);
}

export async function openClipLibraryPanelWindow(title: string): Promise<WebviewWindow> {
  if (import.meta.env.DEV) {
    console.info('[clip-library] open requested', {
      blocked: isClipLibraryPanelOpenBlocked(),
      queuedLibraryId: queuedClipLibraryId ?? null,
      queuedFocusTarget,
    });
  }

  const existingWindow = await getClipLibraryPanelWindow();
  if (existingWindow) {
    if (import.meta.env.DEV) {
      console.info('[clip-library] reusing existing window');
    }
    await existingWindow.show();
    await existingWindow.setFocus();
    return existingWindow;
  }

  const storedBounds = readStoredBounds();
  const hasStoredPosition = isFiniteNumber(storedBounds.x) && isFiniteNumber(storedBounds.y);

  if (import.meta.env.DEV) {
    console.info('[clip-library] creating new window');
  }

  return new WebviewWindow(CLIP_LIBRARY_PANEL_WINDOW_LABEL, {
    title,
    width: storedBounds.width ?? DEFAULT_CLIP_LIBRARY_PANEL_WIDTH,
    height: storedBounds.height ?? DEFAULT_CLIP_LIBRARY_PANEL_HEIGHT,
    minWidth: MIN_CLIP_LIBRARY_PANEL_WIDTH,
    minHeight: MIN_CLIP_LIBRARY_PANEL_HEIGHT,
    x: hasStoredPosition ? storedBounds.x : undefined,
    y: hasStoredPosition ? storedBounds.y : undefined,
    center: !hasStoredPosition,
    resizable: true,
    decorations: false,
    minimizable: true,
    maximizable: true,
    closable: true,
    shadow: true,
    visible: false,
    focus: false,
  });
}

export async function focusClipLibraryPanelWindow() {
  const clipLibraryPanelWindow = await getClipLibraryPanelWindow();
  if (!clipLibraryPanelWindow) {
    return;
  }

  await clipLibraryPanelWindow.show();
  await clipLibraryPanelWindow.setFocus();
}

export async function closeClipLibraryPanelWindow() {
  const clipLibraryPanelWindow = await getClipLibraryPanelWindow();
  if (!clipLibraryPanelWindow) {
    return;
  }

  await clipLibraryPanelWindow.close();
}

export async function focusMainWindow() {
  const mainWindow = await WebviewWindow.getByLabel(MAIN_WINDOW_LABEL);
  if (!mainWindow) {
    return;
  }

  await mainWindow.show();
  await mainWindow.setFocus();
}

export async function emitToClipLibraryPanel<T>(event: string, payload?: T): Promise<boolean> {
  const clipLibraryPanelWindow = await getClipLibraryPanelWindow();
  if (!clipLibraryPanelWindow) {
    return false;
  }

  await getCurrentWindow().emitTo(CLIP_LIBRARY_PANEL_WINDOW_LABEL, event, payload);
  return true;
}

export async function emitToMainWindow<T>(event: string, payload?: T) {
  await getCurrentWindow().emitTo(MAIN_WINDOW_LABEL, event, payload);
}

export async function persistCurrentClipLibraryPanelBounds() {
  const currentWindow = getCurrentWindow();
  const [position, size, scaleFactor] = await Promise.all([
    currentWindow.outerPosition(),
    currentWindow.outerSize(),
    currentWindow.scaleFactor(),
  ]);

  writeStoredBounds({
    x: Math.round(position.x / scaleFactor),
    y: Math.round(position.y / scaleFactor),
    width: Math.round(size.width / scaleFactor),
    height: Math.round(size.height / scaleFactor),
  });
}
