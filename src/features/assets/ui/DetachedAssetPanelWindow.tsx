import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Crosshair, Maximize2, Minus, PanelLeftClose, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import {
  ASSET_PANEL_CLOSED_EVENT,
  ASSET_PANEL_CONTEXT_EVENT,
  ASSET_PANEL_INSERT_EVENT,
  ASSET_PANEL_READY_EVENT,
  ASSET_PANEL_SET_LIBRARY_EVENT,
  type AssetPanelProjectContext,
  emitToMainWindow,
  focusMainWindow,
  persistCurrentAssetPanelBounds,
} from '@/features/assets/application/assetPanelBridge';
import type { CanvasAssetDragPayload } from '@/features/assets/domain/types';
import { AssetSearchPanel } from './AssetSearchPanel';

const EMPTY_PROJECT_CONTEXT: AssetPanelProjectContext = {
  projectId: null,
  projectName: null,
  projectType: null,
  assetLibraryId: null,
};

export function DetachedAssetPanelWindow() {
  const { t } = useTranslation();
  const appWindow = getCurrentWindow();
  const [projectContext, setProjectContext] =
    useState<AssetPanelProjectContext>(EMPTY_PROJECT_CONTEXT);
  const [isWindowVisible, setIsWindowVisible] = useState(false);
  const isWindowVisibleRef = useRef(false);
  const persistBoundsTimerRef = useRef<number | null>(null);

  const persistBounds = useCallback(async () => {
    try {
      await persistCurrentAssetPanelBounds();
    } catch (error) {
      console.warn('Failed to persist detached asset panel bounds', error);
    }
  }, []);

  const schedulePersistBounds = useCallback(() => {
    if (persistBoundsTimerRef.current !== null) {
      window.clearTimeout(persistBoundsTimerRef.current);
    }

    persistBoundsTimerRef.current = window.setTimeout(() => {
      persistBoundsTimerRef.current = null;
      void persistBounds();
    }, 160);
  }, [persistBounds]);

  useEffect(() => {
    let unlistenContext: (() => void) | null = null;
    let unlistenMove: (() => void) | null = null;
    let unlistenResize: (() => void) | null = null;
    let unlistenClose: (() => void) | null = null;
    let disposed = false;

    const registerListeners = async () => {
      const nextUnlistenContext = await appWindow.listen<AssetPanelProjectContext>(
        ASSET_PANEL_CONTEXT_EVENT,
        (event) => {
          setProjectContext(event.payload ?? EMPTY_PROJECT_CONTEXT);
          if (!isWindowVisibleRef.current) {
            isWindowVisibleRef.current = true;
            setIsWindowVisible(true);
            void appWindow.show().catch((error) => {
              console.warn('Failed to show detached asset panel window', error);
            });
          }
        }
      );
      if (disposed) {
        nextUnlistenContext();
        return;
      }
      unlistenContext = nextUnlistenContext;

      const nextUnlistenMove = await appWindow.onMoved(() => {
        schedulePersistBounds();
      });
      if (disposed) {
        nextUnlistenMove();
        return;
      }
      unlistenMove = nextUnlistenMove;

      const nextUnlistenResize = await appWindow.onResized(() => {
        schedulePersistBounds();
      });
      if (disposed) {
        nextUnlistenResize();
        return;
      }
      unlistenResize = nextUnlistenResize;

      const nextUnlistenClose = await appWindow.onCloseRequested((event) => {
        event.preventDefault();
        void (async () => {
          await persistBounds();
          try {
            await appWindow.hide();
          } catch (error) {
            console.warn('Failed to hide detached asset panel window on close request', error);
          }
          try {
            await emitToMainWindow(ASSET_PANEL_CLOSED_EVENT);
          } catch (error) {
            console.warn('Failed to notify main window that asset panel closed', error);
          }
          try {
            await focusMainWindow();
          } catch (error) {
            console.warn('Failed to focus main window after closing detached asset panel', error);
          }
        })();
      });
      if (disposed) {
        nextUnlistenClose();
        return;
      }
      unlistenClose = nextUnlistenClose;

      if (!disposed) {
        await emitToMainWindow(ASSET_PANEL_READY_EVENT);
      }
    };

    void registerListeners().catch((error) => {
      console.error('Failed to register detached asset panel listeners', error);
    });

    return () => {
      disposed = true;
      if (persistBoundsTimerRef.current !== null) {
        window.clearTimeout(persistBoundsTimerRef.current);
      }

      unlistenContext?.();
      unlistenMove?.();
      unlistenResize?.();
      unlistenClose?.();
    };
  }, [appWindow, persistBounds, schedulePersistBounds]);

  const handleStartDragging = useCallback(
    async (event: ReactMouseEvent<HTMLDivElement>) => {
      if (event.button !== 0) {
        return;
      }

      const target = event.target as HTMLElement | null;
      if (target?.closest('button') || target?.closest('[data-no-drag="true"]')) {
        return;
      }

      await appWindow.startDragging();
    },
    [appWindow]
  );

  const handleMinimize = useCallback(async () => {
    await appWindow.minimize();
  }, [appWindow]);

  const handleToggleMaximize = useCallback(async () => {
    const isMaximized = await appWindow.isMaximized();
    if (isMaximized) {
      await appWindow.unmaximize();
      return;
    }

    await appWindow.maximize();
  }, [appWindow]);

  const handleDismissToCanvas = useCallback(async () => {
    await persistBounds();

    try {
      await appWindow.hide();
    } catch (error) {
      console.warn('Failed to hide detached asset panel before dismissing', error);
    }

    try {
      await emitToMainWindow(ASSET_PANEL_CLOSED_EVENT);
    } catch (error) {
      console.warn('Failed to notify main window while dismissing asset panel', error);
    }

    try {
      await focusMainWindow();
    } catch (error) {
      console.warn('Failed to focus main window after dismissing asset panel', error);
    }
  }, [appWindow, persistBounds]);

  const handleFocusCanvas = useCallback(async () => {
    try {
      await focusMainWindow();
    } catch (error) {
      console.warn('Failed to focus main window from detached asset panel', error);
    }
  }, []);

  const handleChangeLibrary = useCallback(async (libraryId: string | null) => {
    try {
      await emitToMainWindow(ASSET_PANEL_SET_LIBRARY_EVENT, libraryId);
    } catch (error) {
      console.warn('Failed to send asset library change to main window', error);
    }
  }, []);

  const handleInsertAsset = useCallback(async (payload: CanvasAssetDragPayload) => {
    try {
      await emitToMainWindow(ASSET_PANEL_INSERT_EVENT, payload);
    } catch (error) {
      console.warn('Failed to insert asset into main canvas window', error);
    }
  }, []);

  return (
    <div
      className={`flex h-full min-h-0 flex-col bg-bg-dark transition-opacity duration-150 ${
        isWindowVisible ? 'opacity-100' : 'opacity-0'
      }`}
    >
      <div
        className="flex h-10 shrink-0 items-center justify-between gap-2 border-b border-border-dark bg-surface-dark px-3 select-none"
        onMouseDown={(event) => void handleStartDragging(event)}
      >
        <div className="min-w-0 flex-1 truncate text-sm font-semibold text-text-dark max-[640px]:text-xs">
          {t('assets.detachedTitle')}
        </div>

        <div className="ml-2 flex items-center gap-1" data-no-drag="true">
          <button
            type="button"
            className="rounded-lg px-2 py-1.5 text-xs text-text-muted transition-colors hover:bg-white/[0.06] hover:text-text-dark"
            onClick={() => void handleFocusCanvas()}
            title={t('assets.focusCanvas')}
          >
            <span className="inline-flex items-center gap-1.5">
              <Crosshair className="h-3.5 w-3.5" />
              <span className="max-[760px]:hidden">{t('assets.focusCanvas')}</span>
            </span>
          </button>

          <button
            type="button"
            className="rounded-lg px-2 py-1.5 text-xs text-text-muted transition-colors hover:bg-white/[0.06] hover:text-text-dark"
            onClick={() => void handleDismissToCanvas()}
            title={t('assets.reattachPanel')}
          >
            <span className="inline-flex items-center gap-1.5">
              <PanelLeftClose className="h-3.5 w-3.5" />
              <span className="max-[760px]:hidden">{t('assets.reattachPanel')}</span>
            </span>
          </button>

          <button
            type="button"
            className="rounded-lg p-2 text-text-muted transition-colors hover:bg-white/[0.06] hover:text-text-dark"
            onClick={() => void handleMinimize()}
            title={t('titleBar.minimize')}
          >
            <Minus className="h-4 w-4" />
          </button>
          <button
            type="button"
            className="rounded-lg p-2 text-text-muted transition-colors hover:bg-white/[0.06] hover:text-text-dark"
            onClick={() => void handleToggleMaximize()}
            title={t('titleBar.maximize')}
          >
            <Maximize2 className="h-4 w-4" />
          </button>
          <button
            type="button"
            className="rounded-lg p-2 text-text-muted transition-colors hover:bg-red-500/10 hover:text-red-400"
            onClick={() => void handleDismissToCanvas()}
            title={t('titleBar.close')}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <main className="min-h-0 flex-1 overflow-hidden p-4">
        <AssetSearchPanel
          projectContext={projectContext}
          onChangeLibrary={handleChangeLibrary}
          onInsertAsset={handleInsertAsset}
          onFocusCanvas={handleFocusCanvas}
        />
      </main>
    </div>
  );
}
