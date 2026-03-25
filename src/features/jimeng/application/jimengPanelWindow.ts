import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import {
  PhysicalPosition,
  PhysicalSize,
  currentMonitor,
  getCurrentWindow,
} from '@tauri-apps/api/window';

import { ensureJimengPanelWindow } from '@/commands/jimengPanel';
import type { JimengPanelMode } from '@/stores/jimengPanelStore';

const JIMENG_PANEL_LABEL = 'jimeng-panel';
const JIMENG_PANEL_GAP_PX = 10;
const JIMENG_PANEL_EXPANDED_WIDTH_PX = 540;
const JIMENG_PANEL_COLLAPSED_WIDTH_PX = 72;
const JIMENG_PANEL_MIN_EXPANDED_WIDTH_PX = 360;
const JIMENG_PANEL_MIN_FULLSCREEN_WIDTH_PX = 960;
const JIMENG_PANEL_MIN_HEIGHT_PX = 480;
const JIMENG_PANEL_MIN_MARGIN_PX = 8;

interface PanelLayout {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface MonitorBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface MainWindowSnapshot {
  x: number;
  y: number;
  width: number;
  height: number;
  monitorBounds: MonitorBounds;
}

let panelCreationPromise: Promise<WebviewWindow> | null = null;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function toErrorMessage(error: unknown): string {
  if (typeof error === 'string') {
    return error;
  }

  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  return 'Failed to open Jimeng panel';
}

async function getMainWindowSnapshot(): Promise<MainWindowSnapshot> {
  const appWindow = getCurrentWindow();
  const [position, size, monitor] = await Promise.all([
    appWindow.outerPosition(),
    appWindow.outerSize(),
    currentMonitor(),
  ]);

  const fallbackBounds: MonitorBounds = {
    left: position.x - JIMENG_PANEL_MIN_MARGIN_PX,
    top: position.y - JIMENG_PANEL_MIN_MARGIN_PX,
    right: position.x + size.width + JIMENG_PANEL_EXPANDED_WIDTH_PX + JIMENG_PANEL_MIN_MARGIN_PX,
    bottom: position.y + size.height + JIMENG_PANEL_MIN_MARGIN_PX,
  };

  const workArea = monitor?.workArea;
  const monitorBounds: MonitorBounds = workArea
    ? {
        left: workArea.position.x,
        top: workArea.position.y,
        right: workArea.position.x + workArea.size.width,
        bottom: workArea.position.y + workArea.size.height,
      }
    : fallbackBounds;

  return {
    x: position.x,
    y: position.y,
    width: size.width,
    height: size.height,
    monitorBounds,
  };
}

function resolvePanelLayout(
  mode: Exclude<JimengPanelMode, 'hidden'>,
  main: MainWindowSnapshot
): PanelLayout {
  if (mode === 'fullscreen') {
    const workWidth = Math.max(
      320,
      main.monitorBounds.right - main.monitorBounds.left - JIMENG_PANEL_MIN_MARGIN_PX * 2
    );
    const workHeight = Math.max(
      320,
      main.monitorBounds.bottom - main.monitorBounds.top - JIMENG_PANEL_MIN_MARGIN_PX * 2
    );
    const width = clamp(workWidth, Math.min(JIMENG_PANEL_MIN_FULLSCREEN_WIDTH_PX, workWidth), workWidth);
    const height = clamp(workHeight, Math.min(JIMENG_PANEL_MIN_HEIGHT_PX, workHeight), workHeight);

    return {
      x: main.monitorBounds.left + JIMENG_PANEL_MIN_MARGIN_PX,
      y: main.monitorBounds.top + JIMENG_PANEL_MIN_MARGIN_PX,
      width,
      height,
    };
  }

  const desiredWidth =
    mode === 'expanded' ? JIMENG_PANEL_EXPANDED_WIDTH_PX : JIMENG_PANEL_COLLAPSED_WIDTH_PX;
  const minimumWidth =
    mode === 'expanded' ? JIMENG_PANEL_MIN_EXPANDED_WIDTH_PX : JIMENG_PANEL_COLLAPSED_WIDTH_PX;

  const maxHeight = Math.max(
    JIMENG_PANEL_MIN_HEIGHT_PX,
    main.monitorBounds.bottom - main.monitorBounds.top - JIMENG_PANEL_MIN_MARGIN_PX * 2
  );
  const height = clamp(main.height, JIMENG_PANEL_MIN_HEIGHT_PX, maxHeight);
  const y = clamp(
    main.y,
    main.monitorBounds.top + JIMENG_PANEL_MIN_MARGIN_PX,
    Math.max(
      main.monitorBounds.top + JIMENG_PANEL_MIN_MARGIN_PX,
      main.monitorBounds.bottom - height - JIMENG_PANEL_MIN_MARGIN_PX
    )
  );

  const availableRight =
    main.monitorBounds.right
    - (main.x + main.width)
    - JIMENG_PANEL_GAP_PX
    - JIMENG_PANEL_MIN_MARGIN_PX;
  const availableLeft =
    main.x - main.monitorBounds.left - JIMENG_PANEL_GAP_PX - JIMENG_PANEL_MIN_MARGIN_PX;

  if (availableRight >= minimumWidth) {
    const width = clamp(desiredWidth, minimumWidth, availableRight);
    return {
      x: main.x + main.width + JIMENG_PANEL_GAP_PX,
      y,
      width,
      height,
    };
  }

  if (availableLeft >= minimumWidth) {
    const width = clamp(desiredWidth, minimumWidth, availableLeft);
    return {
      x: main.x - width - JIMENG_PANEL_GAP_PX,
      y,
      width,
      height,
    };
  }

  const maxOverlayWidth = Math.max(
    minimumWidth,
    main.monitorBounds.right - main.monitorBounds.left - JIMENG_PANEL_MIN_MARGIN_PX * 2
  );
  const width = clamp(desiredWidth, minimumWidth, maxOverlayWidth);
  const x = clamp(
    main.monitorBounds.right - width - JIMENG_PANEL_MIN_MARGIN_PX,
    main.monitorBounds.left + JIMENG_PANEL_MIN_MARGIN_PX,
    main.monitorBounds.right - width - JIMENG_PANEL_MIN_MARGIN_PX
  );

  return {
    x,
    y,
    width,
    height,
  };
}

async function applyPanelLayout(
  window: WebviewWindow,
  layout: PanelLayout,
  mode: Exclude<JimengPanelMode, 'hidden'>
): Promise<void> {
  if (mode === 'fullscreen') {
    await window.setDecorations(true);
    await window.setResizable(true);
    await window.setSkipTaskbar(false);
  } else {
    await window.setDecorations(false);
    await window.setResizable(false);
    await window.setSkipTaskbar(true);
  }

  await window.setSize(new PhysicalSize(layout.width, layout.height));
  await window.setPosition(new PhysicalPosition(layout.x, layout.y));
  await window.show();
  await window.setFocus();
}

async function getExistingPanelWindow(): Promise<WebviewWindow | null> {
  return await WebviewWindow.getByLabel(JIMENG_PANEL_LABEL);
}

async function createPanelWindow(
  layout: PanelLayout,
  mode: Exclude<JimengPanelMode, 'hidden'>
): Promise<WebviewWindow> {
  await ensureJimengPanelWindow({
    x: layout.x,
    y: layout.y,
    width: layout.width,
    height: layout.height,
    minWidth: JIMENG_PANEL_COLLAPSED_WIDTH_PX,
    minHeight: JIMENG_PANEL_MIN_HEIGHT_PX,
    decorations: mode === 'fullscreen',
    resizable: mode === 'fullscreen',
    skipTaskbar: mode !== 'fullscreen',
    focus: true,
  });

  const panelWindow = await getExistingPanelWindow();
  if (!panelWindow) {
    throw new Error('Jimeng panel window was not created');
  }

  return panelWindow;
}

async function ensurePanelWindow(
  layout: PanelLayout,
  mode: Exclude<JimengPanelMode, 'hidden'>
): Promise<WebviewWindow> {
  const existingWindow = await getExistingPanelWindow();
  if (existingWindow) {
    return existingWindow;
  }

  if (!panelCreationPromise) {
    panelCreationPromise = createPanelWindow(layout, mode).finally(() => {
      panelCreationPromise = null;
    });
  }

  return await panelCreationPromise;
}

export async function syncJimengPanelWindow(
  mode: Exclude<JimengPanelMode, 'hidden'>
): Promise<void> {
  const mainWindow = await getMainWindowSnapshot();
  const layout = resolvePanelLayout(mode, mainWindow);
  const panelWindow = await ensurePanelWindow(layout, mode);
  await applyPanelLayout(panelWindow, layout, mode);
}

export async function hideJimengPanelWindow(): Promise<void> {
  const panelWindow = await getExistingPanelWindow();
  if (!panelWindow) {
    return;
  }

  await panelWindow.hide();
}

export { JIMENG_PANEL_LABEL };
export { toErrorMessage as resolveJimengPanelErrorMessage };
