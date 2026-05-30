import { getCurrentWindow } from '@tauri-apps/api/window';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';

import type {
  DirectorStageNodeData,
  ExportImageNodeResultKind,
} from '@/features/canvas/domain/canvasNodes';
import type { DirectorStageConnectedEnvironment } from '../domain/types';

export const DIRECTOR_STAGE_WINDOW_LABEL = 'director-stage';
export const DIRECTOR_STAGE_READY_EVENT = 'director-stage:ready';
export const DIRECTOR_STAGE_CONTEXT_EVENT = 'director-stage:context';
export const DIRECTOR_STAGE_UPDATE_NODE_EVENT = 'director-stage:update-node';
export const DIRECTOR_STAGE_ADD_EXPORT_NODE_EVENT = 'director-stage:add-export-node';
export const DIRECTOR_STAGE_ADD_VIDEO_NODE_EVENT = 'director-stage:add-video-node';
export const DIRECTOR_STAGE_CLOSED_EVENT = 'director-stage:closed';
export const DIRECTOR_STAGE_CLOSE_REQUEST_STORAGE_KEY = 'storyboard.director-stage.closeRequest';

const MAIN_WINDOW_LABEL = 'main';
const DIRECTOR_STAGE_BOUNDS_STORAGE_KEY = 'storyboard.director-stage.bounds';
const DEFAULT_DIRECTOR_STAGE_WIDTH = 1480;
const DEFAULT_DIRECTOR_STAGE_HEIGHT = 920;
const MIN_DIRECTOR_STAGE_WIDTH = 980;
const MIN_DIRECTOR_STAGE_HEIGHT = 680;
let currentWindowHandle: ReturnType<typeof getCurrentWindow> | null = null;

export interface DirectorStageWindowContext {
  nodeId: string;
  data: DirectorStageNodeData;
  connectedEnvironments: DirectorStageConnectedEnvironment[];
}

export interface DirectorStageUpdateNodePayload {
  nodeId: string;
  data: Partial<DirectorStageNodeData>;
  historyMode?: 'push' | 'skip';
}

export interface DirectorStageAddExportNodePayload {
  sourceNodeId: string;
  imageUrl: string;
  aspectRatio: string;
  previewImageUrl?: string;
  options?: {
    thumbnailUrl?: string | null;
    thumbnailMaxDimension?: number | null;
    defaultTitle?: string;
    resultKind?: ExportImageNodeResultKind;
    aspectRatioStrategy?: 'provided' | 'derivedFromSource';
    sizeStrategy?: 'generated' | 'autoMinEdge' | 'matchSource';
    matchSourceNodeSize?: boolean;
    connectToSource?: boolean;
  };
}

export interface DirectorStageAddVideoNodePayload {
  sourceNodeId: string;
  videoUrl: string;
  previewImageUrl: string | null;
  aspectRatio: string;
  duration: number;
  options?: {
    defaultTitle?: string;
    videoFileName?: string | null;
    connectToSource?: boolean;
  };
}

interface DirectorStageStoredBounds {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function readStoredBounds(): DirectorStageStoredBounds {
  if (typeof window === 'undefined') {
    return {};
  }

  try {
    const raw = window.localStorage.getItem(DIRECTOR_STAGE_BOUNDS_STORAGE_KEY);
    if (!raw) {
      return {};
    }

    const parsed = JSON.parse(raw) as Partial<DirectorStageStoredBounds>;
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

function writeStoredBounds(bounds: DirectorStageStoredBounds) {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(DIRECTOR_STAGE_BOUNDS_STORAGE_KEY, JSON.stringify(bounds));
  } catch {
    // Ignore storage failures and use default bounds next time.
  }
}

export async function getDirectorStageWindow(): Promise<WebviewWindow | null> {
  return await WebviewWindow.getByLabel(DIRECTOR_STAGE_WINDOW_LABEL);
}

export async function openDirectorStageWindow(title: string): Promise<WebviewWindow> {
  const existingWindow = await getDirectorStageWindow();
  if (existingWindow) {
    await existingWindow.show();
    await existingWindow.setFocus();
    return existingWindow;
  }

  const storedBounds = readStoredBounds();
  const hasStoredPosition = isFiniteNumber(storedBounds.x) && isFiniteNumber(storedBounds.y);

  return new WebviewWindow(DIRECTOR_STAGE_WINDOW_LABEL, {
    title,
    width: storedBounds.width ?? DEFAULT_DIRECTOR_STAGE_WIDTH,
    height: storedBounds.height ?? DEFAULT_DIRECTOR_STAGE_HEIGHT,
    minWidth: MIN_DIRECTOR_STAGE_WIDTH,
    minHeight: MIN_DIRECTOR_STAGE_HEIGHT,
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

export async function emitToDirectorStage<T>(event: string, payload?: T): Promise<boolean> {
  const directorStageWindow = await getDirectorStageWindow();
  if (!directorStageWindow) {
    return false;
  }

  await getStableCurrentWindow().emitTo(DIRECTOR_STAGE_WINDOW_LABEL, event, payload);
  return true;
}

export async function emitToMainWindow<T>(event: string, payload?: T) {
  await getStableCurrentWindow().emitTo(MAIN_WINDOW_LABEL, event, payload);
}

export function getStableCurrentWindow() {
  currentWindowHandle ??= getCurrentWindow();
  return currentWindowHandle;
}

export async function focusMainWindow() {
  const mainWindow = await WebviewWindow.getByLabel(MAIN_WINDOW_LABEL);
  if (!mainWindow) {
    return;
  }

  await mainWindow.show();
  await mainWindow.setFocus();
}

export function requestDirectorStageCloseFromMainWindow() {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(
      DIRECTOR_STAGE_CLOSE_REQUEST_STORAGE_KEY,
      String(Date.now())
    );
  } catch {
    // The direct window close path still runs if local storage is unavailable.
  }
}

export async function closeDirectorStageWindowHandle() {
  const directorStageWindow = await getDirectorStageWindow();
  if (!directorStageWindow) {
    return;
  }

  try {
    await directorStageWindow.close();
  } catch (closeError) {
    console.warn('Failed to close director stage window from main, trying destroy', closeError);
    await directorStageWindow.destroy();
  }
}

export async function persistCurrentDirectorStageBounds() {
  const currentWindow = getStableCurrentWindow();
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
