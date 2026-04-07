import { Suspense, lazy, useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  AppBootScreen,
  AppContentLoader,
} from "./components/AppBootScreen";
import { TitleBar } from "./components/TitleBar";
import type { UpdateIgnoreMode } from "./components/UpdateAvailableDialog";
import { GlobalErrorDialog } from "./components/GlobalErrorDialog";
import { PsImageToast } from "./components/PsImageToast";
import { useThemeStore } from "./stores/themeStore";
import { useProjectStore } from "./stores/projectStore";
import { useSettingsStore } from "./stores/settingsStore";
import {
  checkForUpdate,
  isUpdateVersionSuppressed,
  suppressUpdateVersion,
} from "./features/update/application/checkForUpdate";
import {
  subscribeOpenGlobalErrorDialog,
  type GlobalErrorDialogDetail,
} from "./features/app/errorDialogEvents";
import {
  subscribeOpenSettingsDialog,
  type SettingsCategory,
} from "./features/settings/settingsEvents";
import {
  subscribeOpenDreaminaSetupDialog,
  type DreaminaSetupDialogDetail,
} from "./features/jimeng/dreaminaSetupDialogEvents";
import { initializePsIntegration } from "./stores/psIntegrationStore";
import { ensureDailyDatabaseBackup } from "./commands/storage";

const WINDOW_CLOSE_FLUSH_TIMEOUT_MS = 2500;
const WINDOW_CLOSE_REQUEST_TIMEOUT_MS = 1200;

const CanvasScreen = lazy(() =>
  import("./features/canvas/CanvasScreen").then((module) => ({
    default: module.CanvasScreen,
  })),
);
const ProjectManager = lazy(() =>
  import("./features/project/ProjectManager").then((module) => ({
    default: module.ProjectManager,
  })),
);
const SettingsDialog = lazy(() =>
  import("./components/SettingsDialog").then((module) => ({
    default: module.SettingsDialog,
  })),
);
const ExtensionsDialog = lazy(() =>
  import("./components/ExtensionsDialog").then((module) => ({
    default: module.ExtensionsDialog,
  })),
);
const UpdateAvailableDialog = lazy(() =>
  import("./components/UpdateAvailableDialog").then((module) => ({
    default: module.UpdateAvailableDialog,
  })),
);
const DreaminaSetupDialog = lazy(() =>
  import("./components/DreaminaSetupDialog").then((module) => ({
    default: module.DreaminaSetupDialog,
  })),
);

function toRgbCssValue(hexColor: string): string {
  const hex = hexColor.replace("#", "");
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) {
    return "59 130 246";
  }
  const r = Number.parseInt(hex.slice(0, 2), 16);
  const g = Number.parseInt(hex.slice(2, 4), 16);
  const b = Number.parseInt(hex.slice(4, 6), 16);
  return `${r} ${g} ${b}`;
}

async function settleWithinTimeout(
  promise: Promise<void>,
  timeoutMs: number,
  actionLabel: string,
): Promise<boolean> {
  let timeoutId: number | null = null;

  try {
    return await Promise.race([
      promise.then(() => true),
      new Promise<boolean>((resolve) => {
        timeoutId = window.setTimeout(() => {
          console.warn(`${actionLabel} timed out after ${timeoutMs}ms`);
          resolve(false);
        }, timeoutMs);
      }),
    ]);
  } catch (error) {
    console.error(`${actionLabel} failed`, error);
    return false;
  } finally {
    if (timeoutId !== null) {
      window.clearTimeout(timeoutId);
    }
  }
}

function App() {
  const { theme } = useThemeStore();
  const uiRadiusPreset = useSettingsStore((state) => state.uiRadiusPreset);
  const themeTonePreset = useSettingsStore((state) => state.themeTonePreset);
  const accentColor = useSettingsStore((state) => state.accentColor);
  const autoCheckAppUpdateOnLaunch = useSettingsStore(
    (state) => state.autoCheckAppUpdateOnLaunch,
  );
  const enableUpdateDialog = useSettingsStore(
    (state) => state.enableUpdateDialog,
  );
  const setEnableUpdateDialog = useSettingsStore(
    (state) => state.setEnableUpdateDialog,
  );
  const settingsHydrated = useSettingsStore((state) => state.isHydrated);
  const [showSettings, setShowSettings] = useState(false);
  const [showExtensions, setShowExtensions] = useState(false);
  const [settingsDialogLoaded, setSettingsDialogLoaded] = useState(false);
  const [extensionsDialogLoaded, setExtensionsDialogLoaded] = useState(false);
  const [updateDialogLoaded, setUpdateDialogLoaded] = useState(false);
  const [dreaminaDialogLoaded, setDreaminaDialogLoaded] = useState(false);
  const [settingsInitialCategory, setSettingsInitialCategory] =
    useState<SettingsCategory>("general");
  const [showUpdateDialog, setShowUpdateDialog] = useState(false);
  const [latestVersion, setLatestVersion] = useState<string>("");
  const [currentVersion, setCurrentVersion] = useState<string>("");
  const [globalError, setGlobalError] =
    useState<GlobalErrorDialogDetail | null>(null);
  const [dreaminaSetupDetail, setDreaminaSetupDetail] =
    useState<DreaminaSetupDialogDetail | null>(null);

  const isHydrated = useProjectStore((state) => state.isHydrated);
  const hydrate = useProjectStore((state) => state.hydrate);
  const currentProjectId = useProjectStore((state) => state.currentProjectId);
  const closeProject = useProjectStore((state) => state.closeProject);
  const flushCurrentProjectToDisk = useProjectStore(
    (state) => state.flushCurrentProjectToDisk,
  );
  const isWindowCloseInProgressRef = useRef(false);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.uiRadius = uiRadiusPreset;
  }, [uiRadiusPreset]);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.themeTone = themeTonePreset;
  }, [themeTonePreset]);

  useEffect(() => {
    const root = document.documentElement;
    const isMac =
      typeof navigator !== "undefined" &&
      /(Mac|iPhone|iPad|iPod)/i.test(
        `${navigator.platform} ${navigator.userAgent}`,
      );
    root.dataset.platform = isMac ? "macos" : "default";
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    const normalized = accentColor.startsWith("#")
      ? accentColor
      : `#${accentColor}`;
    root.style.setProperty("--accent", normalized);
    root.style.setProperty("--accent-rgb", toRgbCssValue(normalized));
  }, [accentColor]);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  useEffect(() => {
    if (!settingsHydrated) {
      return;
    }

    const { psIntegrationEnabled, psServerPort, psAutoStartServer } =
      useSettingsStore.getState();

    const unsubscribe = initializePsIntegration({
      enabled: psIntegrationEnabled,
      preferredPort: psServerPort,
      autoStart: psAutoStartServer,
    });

    return unsubscribe;
  }, [settingsHydrated]);

  useEffect(() => {
    const unsubscribe = subscribeOpenGlobalErrorDialog((detail) => {
      setGlobalError(detail);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeOpenSettingsDialog(({ category }) => {
      setSettingsInitialCategory(category ?? "general");
      setSettingsDialogLoaded(true);
      setShowSettings(true);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeOpenDreaminaSetupDialog((detail) => {
      setDreaminaDialogLoaded(true);
      setDreaminaSetupDetail(detail);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (showSettings) {
      setSettingsDialogLoaded(true);
    }
  }, [showSettings]);

  useEffect(() => {
    if (showExtensions) {
      setExtensionsDialogLoaded(true);
    }
  }, [showExtensions]);

  useEffect(() => {
    if (showUpdateDialog) {
      setUpdateDialogLoaded(true);
    }
  }, [showUpdateDialog]);

  useEffect(() => {
    if (dreaminaSetupDetail) {
      setDreaminaDialogLoaded(true);
    }
  }, [dreaminaSetupDetail]);

  useEffect(() => {
    let cancelled = false;
    let retryTimer: ReturnType<typeof window.setTimeout> | null = null;

    const notifyFrontendReady = async (attempt = 1) => {
      if (cancelled) {
        return;
      }

      try {
        await invoke("frontend_ready");
      } catch (error) {
        if (cancelled) {
          return;
        }

        if (attempt === 1 || attempt % 10 === 0) {
          console.warn("failed to notify frontend readiness", error);
        }

        const retryDelayMs = Math.min(500, 80 * attempt);
        retryTimer = setTimeout(() => {
          void notifyFrontendReady(attempt + 1);
        }, retryDelayMs) as ReturnType<typeof setTimeout>;
      }
    };

    requestAnimationFrame(() => {
      void notifyFrontendReady();
    });

    return () => {
      cancelled = true;
      if (retryTimer) {
        window.clearTimeout(retryTimer);
      }
    };
  }, []);

  useEffect(() => {
    if (!isHydrated) {
      return;
    }

    let cancelled = false;
    const runUpdateCheck = async () => {
      if (!autoCheckAppUpdateOnLaunch) {
        return;
      }
      const result = await checkForUpdate();
      if (
        !cancelled &&
        result.hasUpdate &&
        result.latestVersion &&
        enableUpdateDialog
      ) {
        if (isUpdateVersionSuppressed(result.latestVersion)) {
          return;
        }
        setLatestVersion(result.latestVersion ?? "");
        setCurrentVersion(result.currentVersion ?? "");
        setShowUpdateDialog(true);
      }
    };

    void runUpdateCheck();
    return () => {
      cancelled = true;
    };
  }, [isHydrated, autoCheckAppUpdateOnLaunch, enableUpdateDialog]);

  useEffect(() => {
    if (!isHydrated) {
      return;
    }

    void ensureDailyDatabaseBackup().catch((error) => {
      console.warn("failed to ensure daily database backup", error);
    });
  }, [isHydrated]);

  const requestWindowClose = useCallback(async () => {
    if (isWindowCloseInProgressRef.current) {
      return;
    }

    isWindowCloseInProgressRef.current = true;

    await settleWithinTimeout(
      flushCurrentProjectToDisk(),
      WINDOW_CLOSE_FLUSH_TIMEOUT_MS,
      "Project flush before window close",
    );

    const exitRequested = await settleWithinTimeout(
      invoke<void>("request_app_exit"),
      WINDOW_CLOSE_REQUEST_TIMEOUT_MS,
      "App exit request",
    );

    if (!exitRequested) {
      isWindowCloseInProgressRef.current = false;
    }
  }, [flushCurrentProjectToDisk]);

  useEffect(() => {
    const appWindow = getCurrentWindow();
    let disposed = false;
    let unlistenWindowClose: (() => void) | null = null;

    const detachWindowCloseListener = () => {
      if (!unlistenWindowClose) {
        return;
      }

      const stopListening = unlistenWindowClose;
      unlistenWindowClose = null;

      try {
        stopListening();
      } catch (error) {
        console.error("Failed to detach window close listener", error);
      }
    };

    const registerWindowCloseHandler = async () => {
      unlistenWindowClose = await appWindow.onCloseRequested(async (event) => {
        if (disposed) {
          return;
        }

        event.preventDefault();
        await requestWindowClose();
      });
    };

    void registerWindowCloseHandler().catch((error) => {
      console.error("Failed to register window close handler", error);
    });

    return () => {
      disposed = true;
      detachWindowCloseListener();
    };
  }, [requestWindowClose]);

  const handleManualCheckUpdate = async (): Promise<
    "has-update" | "up-to-date" | "failed"
  > => {
    const result = await checkForUpdate();
    if (!result.hasUpdate) {
      return result.error ? "failed" : "up-to-date";
    }

    setLatestVersion(result.latestVersion ?? "");
    setCurrentVersion(result.currentVersion ?? "");

    if (enableUpdateDialog) {
      setShowUpdateDialog(true);
    }

    return "has-update";
  };

  const handleApplyIgnore = (mode: UpdateIgnoreMode) => {
    if (mode === "forever-all") {
      setEnableUpdateDialog(false);
      return;
    }

    if (!latestVersion) {
      return;
    }

    suppressUpdateVersion(
      latestVersion,
      mode === "today-version" ? "today" : "forever",
    );
  };

  return (
    <div className="w-full h-full flex flex-col bg-bg-dark">
      <TitleBar
        onExtensionsClick={() => {
          setExtensionsDialogLoaded(true);
          setShowExtensions(true);
        }}
        onSettingsClick={() => {
          setSettingsInitialCategory("general");
          setSettingsDialogLoaded(true);
          setShowSettings(true);
        }}
        onCloseRequest={requestWindowClose}
        showBackButton={!!currentProjectId}
        onBackClick={closeProject}
      />

      <main className="relative flex-1 min-h-0 overflow-hidden">
        {isHydrated ? (
          <Suspense fallback={<AppContentLoader />}>
            {currentProjectId ? <CanvasScreen /> : <ProjectManager />}
          </Suspense>
        ) : (
          <AppBootScreen />
        )}
      </main>

      {settingsDialogLoaded ? (
        <Suspense fallback={null}>
          <SettingsDialog
            isOpen={showSettings}
            onClose={() => setShowSettings(false)}
            initialCategory={settingsInitialCategory}
            onCheckUpdate={handleManualCheckUpdate}
          />
        </Suspense>
      ) : null}
      {extensionsDialogLoaded ? (
        <Suspense fallback={null}>
          <ExtensionsDialog
            isOpen={showExtensions}
            onClose={() => setShowExtensions(false)}
          />
        </Suspense>
      ) : null}
      {updateDialogLoaded ? (
        <Suspense fallback={null}>
          <UpdateAvailableDialog
            isOpen={showUpdateDialog}
            onClose={() => setShowUpdateDialog(false)}
            latestVersion={latestVersion}
            currentVersion={currentVersion}
            onApplyIgnore={handleApplyIgnore}
          />
        </Suspense>
      ) : null}
      <GlobalErrorDialog
        isOpen={Boolean(globalError)}
        title={globalError?.title ?? ""}
        message={globalError?.message ?? ""}
        details={globalError?.details}
        copyText={globalError?.copyText}
        onClose={() => setGlobalError(null)}
      />
      {dreaminaDialogLoaded ? (
        <Suspense fallback={null}>
          <DreaminaSetupDialog
            isOpen={Boolean(dreaminaSetupDetail)}
            detail={dreaminaSetupDetail}
            onClose={() => setDreaminaSetupDetail(null)}
          />
        </Suspense>
      ) : null}
      <PsImageToast />
    </div>
  );
}

export default App;
