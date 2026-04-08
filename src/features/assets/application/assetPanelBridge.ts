import { getCurrentWindow } from '@tauri-apps/api/window';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';

export const ASSET_PANEL_WINDOW_LABEL = 'asset-panel';
export const ASSET_PANEL_READY_EVENT = 'asset-panel:ready';
export const ASSET_PANEL_CONTEXT_EVENT = 'asset-panel:project-context';
export const ASSET_PANEL_INSERT_EVENT = 'asset-panel:insert-asset';
export const ASSET_PANEL_SET_LIBRARY_EVENT = 'asset-panel:set-library';
export const ASSET_PANEL_CLOSED_EVENT = 'asset-panel:closed';

const MAIN_WINDOW_LABEL = 'main';
const ASSET_PANEL_BOUNDS_STORAGE_KEY = 'storyboard.asset-panel.bounds';
const DEFAULT_ASSET_PANEL_WIDTH = 1320;
const DEFAULT_ASSET_PANEL_HEIGHT = 860;
const MIN_ASSET_PANEL_WIDTH = 560;
const MIN_ASSET_PANEL_HEIGHT = 560;

export type AssetPanelProjectType = 'storyboard' | 'script';

export interface AssetPanelProjectContext {
  projectId: string | null;
  projectName: string | null;
  projectType: AssetPanelProjectType | null;
  assetLibraryId: string | null;
}

interface AssetPanelStoredBounds {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function readStoredBounds(): AssetPanelStoredBounds {
  if (typeof window === 'undefined') {
    return {};
  }

  try {
    const raw = window.localStorage.getItem(ASSET_PANEL_BOUNDS_STORAGE_KEY);
    if (!raw) {
      return {};
    }

    const parsed = JSON.parse(raw) as Partial<AssetPanelStoredBounds>;
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

function writeStoredBounds(bounds: AssetPanelStoredBounds) {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(ASSET_PANEL_BOUNDS_STORAGE_KEY, JSON.stringify(bounds));
  } catch {
    // Ignore storage write failures and fall back to default bounds next time.
  }
}

export async function getAssetPanelWindow(): Promise<WebviewWindow | null> {
  return await WebviewWindow.getByLabel(ASSET_PANEL_WINDOW_LABEL);
}

export async function openAssetPanelWindow(title: string): Promise<WebviewWindow> {
  const existingWindow = await getAssetPanelWindow();
  if (existingWindow) {
    await existingWindow.show();
    await existingWindow.setFocus();
    return existingWindow;
  }

  const storedBounds = readStoredBounds();
  const hasStoredPosition = isFiniteNumber(storedBounds.x) && isFiniteNumber(storedBounds.y);

  const assetPanelWindow = new WebviewWindow(ASSET_PANEL_WINDOW_LABEL, {
    title,
    width: storedBounds.width ?? DEFAULT_ASSET_PANEL_WIDTH,
    height: storedBounds.height ?? DEFAULT_ASSET_PANEL_HEIGHT,
    minWidth: MIN_ASSET_PANEL_WIDTH,
    minHeight: MIN_ASSET_PANEL_HEIGHT,
    x: hasStoredPosition ? storedBounds.x : undefined,
    y: hasStoredPosition ? storedBounds.y : undefined,
    center: !hasStoredPosition,
    resizable: true,
    decorations: false,
    shadow: true,
    visible: false,
    focus: false,
    parent: MAIN_WINDOW_LABEL,
  });

  return assetPanelWindow;
}

export async function focusAssetPanelWindow() {
  const assetPanelWindow = await getAssetPanelWindow();
  if (!assetPanelWindow) {
    return;
  }

  await assetPanelWindow.show();
  await assetPanelWindow.setFocus();
}

export async function closeAssetPanelWindow() {
  const assetPanelWindow = await getAssetPanelWindow();
  if (!assetPanelWindow) {
    return;
  }

  await assetPanelWindow.close();
}

export async function focusMainWindow() {
  const mainWindow = await WebviewWindow.getByLabel(MAIN_WINDOW_LABEL);
  if (!mainWindow) {
    return;
  }

  await mainWindow.show();
  await mainWindow.setFocus();
}

export async function emitToAssetPanel<T>(event: string, payload?: T): Promise<boolean> {
  const assetPanelWindow = await getAssetPanelWindow();
  if (!assetPanelWindow) {
    return false;
  }

  await getCurrentWindow().emitTo(ASSET_PANEL_WINDOW_LABEL, event, payload);
  return true;
}

export async function emitToMainWindow<T>(event: string, payload?: T) {
  await getCurrentWindow().emitTo(MAIN_WINDOW_LABEL, event, payload);
}

export async function persistCurrentAssetPanelBounds() {
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
