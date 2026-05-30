import { useCallback, useEffect, useRef, useState } from 'react';
import { Maximize2, Minus, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import {
  DIRECTOR_STAGE_CLOSED_EVENT,
  DIRECTOR_STAGE_CONTEXT_EVENT,
  DIRECTOR_STAGE_READY_EVENT,
  emitToMainWindow,
  focusMainWindow,
  getStableCurrentWindow,
  persistCurrentDirectorStageBounds,
  requestDirectorStageCloseFromMainWindow,
  type DirectorStageWindowContext,
} from '../application/directorStageWindowBridge';
import { DirectorStageWorkspace } from './DirectorStageWorkspace';

export function DetachedDirectorStageWindow() {
  const { t } = useTranslation();
  const appWindow = getStableCurrentWindow();
  const [context, setContext] = useState<DirectorStageWindowContext | null>(null);
  const [isMaximized, setIsMaximized] = useState(false);
  const persistBoundsTimerRef = useRef<number | null>(null);
  const isClosingWindowRef = useRef(false);

  const persistBounds = useCallback(async () => {
    try {
      await persistCurrentDirectorStageBounds();
    } catch (error) {
      console.warn('Failed to persist director stage bounds', error);
    }
  }, []);

  const schedulePersistBounds = useCallback(() => {
    if (persistBoundsTimerRef.current !== null) {
      window.clearTimeout(persistBoundsTimerRef.current);
    }

    persistBoundsTimerRef.current = window.setTimeout(() => {
      persistBoundsTimerRef.current = null;
      void persistBounds();
    }, 180);
  }, [persistBounds]);

  const syncWindowMaximizeState = useCallback(async () => {
    try {
      setIsMaximized(await appWindow.isMaximized());
    } catch (error) {
      console.warn('Failed to read director stage maximize state', error);
    }
  }, [appWindow]);

  const handleCloseWindow = useCallback(async () => {
    if (isClosingWindowRef.current) {
      return;
    }

    isClosingWindowRef.current = true;
    requestDirectorStageCloseFromMainWindow();
    await persistBounds();
    await emitToMainWindow(DIRECTOR_STAGE_CLOSED_EVENT).catch((error) => {
      console.warn('Failed to notify main window that director stage closed', error);
    });
    void focusMainWindow().catch((error) => {
      console.warn('Failed to focus main window after closing director stage', error);
    });

    try {
      await appWindow.destroy();
    } catch (destroyError) {
      isClosingWindowRef.current = false;
      console.warn('Failed to destroy director stage window', destroyError);
    }
  }, [appWindow, persistBounds]);

  useEffect(() => {
    let unlistenContext: (() => void) | null = null;
    let unlistenMove: (() => void) | null = null;
    let unlistenResize: (() => void) | null = null;
    let unlistenClose: (() => void) | null = null;

    const registerListeners = async () => {
      unlistenContext = await appWindow.listen<DirectorStageWindowContext>(
        DIRECTOR_STAGE_CONTEXT_EVENT,
        (event) => {
          setContext(event.payload ?? null);
        }
      );
      unlistenMove = await appWindow.onMoved(() => {
        schedulePersistBounds();
      });
      unlistenResize = await appWindow.onResized(() => {
        schedulePersistBounds();
        void syncWindowMaximizeState();
      });
      unlistenClose = await appWindow.onCloseRequested((event) => {
        if (isClosingWindowRef.current) {
          return;
        }
        event.preventDefault();
        void handleCloseWindow();
      });

      await emitToMainWindow(DIRECTOR_STAGE_READY_EVENT);
      await appWindow.show();
      await syncWindowMaximizeState();
    };

    void registerListeners().catch((error) => {
      console.error('Failed to register director stage window listeners', error);
    });

    return () => {
      if (persistBoundsTimerRef.current !== null) {
        window.clearTimeout(persistBoundsTimerRef.current);
      }
      unlistenContext?.();
      unlistenMove?.();
      unlistenResize?.();
      unlistenClose?.();
    };
  }, [appWindow, handleCloseWindow, schedulePersistBounds, syncWindowMaximizeState]);

  const handleMinimize = useCallback(async () => {
    await appWindow.minimize();
  }, [appWindow]);

  const handleToggleMaximize = useCallback(async () => {
    const nextIsMaximized = await appWindow.isMaximized();
    if (nextIsMaximized) {
      await appWindow.unmaximize();
    } else {
      await appWindow.maximize();
    }
    await syncWindowMaximizeState();
  }, [appWindow, syncWindowMaximizeState]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#0f1012] text-white">
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-white/10 bg-[#17191d] px-3">
        <div
          className="min-w-0 flex-1 truncate text-sm font-semibold text-white/86"
          data-tauri-drag-region
        >
          {t('directorStage.detachedTitle')}
        </div>
        <div className="ml-2 flex items-center gap-1" data-no-drag="true">
          <button
            type="button"
            className="rounded-md p-2 text-white/58 transition-colors hover:bg-white/[0.06] hover:text-white"
            onClick={() => void handleMinimize()}
            title={t('titleBar.minimize')}
          >
            <Minus className="h-4 w-4" />
          </button>
          <button
            type="button"
            className="rounded-md p-2 text-white/58 transition-colors hover:bg-white/[0.06] hover:text-white"
            onClick={() => void handleToggleMaximize()}
            title={isMaximized ? t('titleBar.restore') : t('titleBar.maximize')}
          >
            <Maximize2 className="h-4 w-4" />
          </button>
          <button
            type="button"
            className="rounded-md p-2 text-white/58 transition-colors hover:bg-red-500/10 hover:text-red-300"
            onClick={() => void handleCloseWindow()}
            title={t('titleBar.close')}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <main className="min-h-0 flex-1 overflow-hidden">
        {context ? (
          <DirectorStageWorkspace
            nodeId={context.nodeId}
            data={context.data}
            connectedEnvironments={context.connectedEnvironments}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-white/48">
            {t('directorStage.loading')}
          </div>
        )}
      </main>
    </div>
  );
}
