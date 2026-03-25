import { useEffect, useRef } from 'react';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { getCurrentWindow } from '@tauri-apps/api/window';

import {
  JIMENG_PANEL_LABEL,
  hideJimengPanelWindow,
  resolveJimengPanelErrorMessage,
  syncJimengPanelWindow,
} from './jimengPanelWindow';
import { fetchJimengInspectionReport } from './jimengInspection';
import { useJimengPanelStore } from '@/stores/jimengPanelStore';

const JIMENG_INSPECTION_MAX_ATTEMPTS = 3;
const JIMENG_INSPECTION_RETRY_DELAY_MS = 1_200;

function waitForDelay(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, delayMs);
  });
}

export function useJimengPanelController(): void {
  const mode = useJimengPanelStore((state) => state.mode);
  const inspectionRevision = useJimengPanelStore((state) => state.inspectionRevision);
  const setMode = useJimengPanelStore((state) => state.setMode);
  const setBusy = useJimengPanelStore((state) => state.setBusy);
  const setLastError = useJimengPanelStore((state) => state.setLastError);
  const setInspectionState = useJimengPanelStore((state) => state.setInspectionState);
  const modeRef = useRef(mode);
  const panelCloseUnlistenRef = useRef<(() => void) | null>(null);
  const inspectionRequestIdRef = useRef(0);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    let cancelled = false;

    const ensurePanelCloseListener = async () => {
      if (panelCloseUnlistenRef.current) {
        return;
      }

      const panelWindow = await WebviewWindow.getByLabel(JIMENG_PANEL_LABEL);
      if (!panelWindow) {
        return;
      }

      panelCloseUnlistenRef.current = await panelWindow.onCloseRequested((event) => {
        event.preventDefault();
        if (modeRef.current !== 'hidden') {
          setLastError(null);
          setMode('hidden');
        }
      });
    };

    const applyMode = async () => {
      setBusy(true);
      setLastError(null);

      try {
        if (mode === 'hidden') {
          await hideJimengPanelWindow();
          setInspectionState({
            status: 'idle',
            error: null,
          });
        } else {
          await syncJimengPanelWindow(mode);
          await ensurePanelCloseListener();

          const requestId = ++inspectionRequestIdRef.current;
          void (async () => {
            setInspectionState({ status: 'syncing', error: null });

            try {
              let report = null;
              let lastError: unknown = null;

              for (
                let attempt = 0;
                attempt < JIMENG_INSPECTION_MAX_ATTEMPTS;
                attempt += 1
              ) {
                if (cancelled || requestId !== inspectionRequestIdRef.current) {
                  return;
                }

                if (attempt > 0) {
                  await waitForDelay(JIMENG_INSPECTION_RETRY_DELAY_MS * attempt);
                  if (cancelled || requestId !== inspectionRequestIdRef.current) {
                    return;
                  }
                }

                try {
                  report = await fetchJimengInspectionReport();
                  break;
                } catch (error) {
                  lastError = error;
                  console.warn(
                    `[jimengPanel] inspection attempt ${attempt + 1}/${JIMENG_INSPECTION_MAX_ATTEMPTS} failed`,
                    error
                  );
                }
              }

              if (!report) {
                throw lastError ?? new Error('Jimeng inspection failed');
              }

              setInspectionState({
                status: 'ready',
                report,
                error: null,
              });
            } catch (error) {
              if (cancelled || requestId !== inspectionRequestIdRef.current) {
                return;
              }

              setInspectionState({
                status: 'error',
                error: resolveJimengPanelErrorMessage(error),
              });
            }
          })();
        }
      } catch (error) {
        const message = resolveJimengPanelErrorMessage(error);
        console.error('[jimengPanel] failed to apply panel mode', error);
        if (!cancelled) {
          setLastError(message);
          setMode('hidden');
        }
      } finally {
        if (!cancelled) {
          setBusy(false);
        }
      }
    };

    void applyMode();

    return () => {
      cancelled = true;
      inspectionRequestIdRef.current += 1;
    };
  }, [inspectionRevision, mode, setBusy, setInspectionState, setLastError, setMode]);

  useEffect(() => {
    const appWindow = getCurrentWindow();
    let disposed = false;
    let cleanup: Array<() => void> = [];

    const syncWithMainWindow = async () => {
      const currentMode = modeRef.current;
      if (currentMode === 'hidden') {
        return;
      }

      try {
        await syncJimengPanelWindow(currentMode);
      } catch (error) {
        const message = resolveJimengPanelErrorMessage(error);
        console.error('[jimengPanel] failed to sync panel with main window', error);
        if (!disposed) {
          setLastError(message);
        }
      }
    };

    void Promise.all([
      appWindow.onMoved(() => {
        void syncWithMainWindow();
      }),
      appWindow.onResized(() => {
        void syncWithMainWindow();
      }),
      appWindow.onScaleChanged(() => {
        void syncWithMainWindow();
      }),
    ]).then((unlistenFns) => {
      if (disposed) {
        unlistenFns.forEach((unlisten) => unlisten());
        return;
      }

      cleanup = unlistenFns;
    });

    return () => {
      disposed = true;
      cleanup.forEach((unlisten) => unlisten());
      cleanup = [];
    };
  }, [setLastError]);

  useEffect(
    () => () => {
      panelCloseUnlistenRef.current?.();
      panelCloseUnlistenRef.current = null;
    },
    []
  );
}
