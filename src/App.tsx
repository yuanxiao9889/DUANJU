import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { relaunch } from "@tauri-apps/plugin-process";
import { useTranslation } from "react-i18next";
import {
  AppBootScreen,
  AppContentLoader,
} from "./components/AppBootScreen";
import { TitleBar } from "./components/TitleBar";
import { GlobalErrorDialog } from "./components/GlobalErrorDialog";
import { PsImageToast } from "./components/PsImageToast";
import { useThemeStore } from "./stores/themeStore";
import { useProjectStore } from "./stores/projectStore";
import { useSettingsStore } from "./stores/settingsStore";
import { useCanvasStore } from "./stores/canvasStore";
import {
  collectProjectImageUrls,
  preloadProjectImages,
} from "./features/canvas/application/projectImagePreloader";
import { CanvasProjectLoadingScreen } from "./features/canvas/ui/CanvasProjectLoadingScreen";
import {
  checkForUpdate,
  downloadAndInstallUpdate,
  isUpdateVersionSuppressed,
  suppressUpdateVersion,
  type UpdateCheckResult,
  type UpdateDownloadProgress,
  type UpdateErrorCode,
} from "./features/update/application/checkForUpdate";
import {
  subscribeOpenGlobalErrorDialog,
  type GlobalErrorDialogDetail,
} from "./features/app/errorDialogEvents";
import {
  subscribeOpenSettingsDialog,
  type SettingsCategory,
  type ProviderTab,
} from "./features/settings/settingsEvents";
import {
  subscribeOpenDreaminaSetupDialog,
  type DreaminaSetupDialogDetail,
} from "./features/jimeng/dreaminaSetupDialogEvents";
import { initializePsIntegration } from "./stores/psIntegrationStore";
import { ensureDailyDatabaseBackup } from "./commands/storage";
import { useJimengVideoQueueStore } from "./stores/jimengVideoQueueStore";
import {
  checkDreaminaCliUpdate,
  updateDreaminaCli,
} from "./commands/dreaminaCli";
import {
  ASSET_PANEL_CONTEXT_EVENT,
  ASSET_PANEL_READY_EVENT,
  ASSET_PANEL_SET_LIBRARY_EVENT,
  ASSET_PANEL_WINDOW_LABEL,
  emitToAssetPanel,
  type AssetPanelProjectContext,
} from "./features/assets/application/assetPanelBridge";
import { DetachedAssetPanelWindow } from "./features/assets/ui/DetachedAssetPanelWindow";
import {
  CLIP_LIBRARY_PANEL_CLOSED_EVENT,
  CLIP_LIBRARY_PANEL_CONTEXT_EVENT,
  CLIP_LIBRARY_PANEL_FOCUS_TARGET_EVENT,
  CLIP_LIBRARY_PANEL_NODE_BOUND_EVENT,
  CLIP_LIBRARY_PANEL_READY_EVENT,
  CLIP_LIBRARY_PANEL_SET_LIBRARY_EVENT,
  CLIP_LIBRARY_PANEL_WINDOW_LABEL,
  blockClipLibraryPanelOpenFor,
  consumeClipLibraryPanelNavigationQueue,
  emitToClipLibraryPanel,
  isClipLibraryPanelOpenBlocked,
  openClipLibraryPanelWindow,
  queueClipLibraryPanelFocusTarget,
  queueClipLibraryPanelLibrary,
  setLatestClipLibraryPanelProjectContext,
  type ClipLibraryPanelNodeBoundPayload,
  type ClipLibraryPanelProjectContext,
} from "./features/clip-library/application/clipLibraryPanelBridge";
import { DetachedClipLibraryWindow } from "./features/clip-library/ui/DetachedClipLibraryWindow";

const WINDOW_CLOSE_FLUSH_TIMEOUT_MS = 2500;
const WINDOW_CLOSE_REQUEST_TIMEOUT_MS = 1200;
const MIN_CANVAS_ENTRY_LOADING_MS = 420;

function isWindowsUpdaterRuntime(): boolean {
  return (
    isTauri() &&
    typeof navigator !== "undefined" &&
    /Windows/i.test(navigator.userAgent)
  );
}

const CanvasScreen = lazy(() =>
  import("./features/canvas/CanvasScreen").then((module) => ({
    default: module.CanvasScreen,
  })),
);
const AdProjectWorkspace = lazy(() =>
  import("./features/ad/AdProjectWorkspace").then((module) => ({
    default: module.AdProjectWorkspace,
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

function useApplyGlobalAppearance() {
  const { theme } = useThemeStore();
  const uiRadiusPreset = useSettingsStore((state) => state.uiRadiusPreset);
  const themeTonePreset = useSettingsStore((state) => state.themeTonePreset);
  const accentColor = useSettingsStore((state) => state.accentColor);

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
}

interface CanvasEntryLoadingState {
  projectId: string | null;
  phase: "project" | "images";
  totalCount: number;
  loadedCount: number;
  failedCount: number;
}

function MainApp() {
  useApplyGlobalAppearance();
  const { t } = useTranslation();

  const autoCheckAppUpdateOnLaunch = useSettingsStore(
    (state) => state.autoCheckAppUpdateOnLaunch,
  );
  const enableUpdateDialog = useSettingsStore(
    (state) => state.enableUpdateDialog,
  );
  const autoUpdateDreaminaCliOnLaunch = useSettingsStore(
    (state) => state.autoUpdateDreaminaCliOnLaunch,
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
  const [settingsInitialProviderTab, setSettingsInitialProviderTab] =
    useState<ProviderTab>("script");
  const [settingsInitialProviderId, setSettingsInitialProviderId] =
    useState<string | undefined>(undefined);
  const [showUpdateDialog, setShowUpdateDialog] = useState(false);
  const [latestVersion, setLatestVersion] = useState<string>("");
  const [currentVersion, setCurrentVersion] = useState<string>("");
  const [updateReleaseNotes, setUpdateReleaseNotes] = useState<string>("");
  const [updatePublishedAt, setUpdatePublishedAt] = useState<string>("");
  const [updateDialogErrorCode, setUpdateDialogErrorCode] =
    useState<UpdateErrorCode | null>(null);
  const [updateCanInstallInApp, setUpdateCanInstallInApp] = useState(
    isWindowsUpdaterRuntime(),
  );
  const [updateInstallState, setUpdateInstallState] = useState<
    "idle" | "downloading" | "installing" | "restarting"
  >("idle");
  const [updateDownloadProgress, setUpdateDownloadProgress] =
    useState<UpdateDownloadProgress | null>(null);
  const [globalError, setGlobalError] =
    useState<GlobalErrorDialogDetail | null>(null);
  const [dreaminaSetupDetail, setDreaminaSetupDetail] =
    useState<DreaminaSetupDialogDetail | null>(null);

  const isHydrated = useProjectStore((state) => state.isHydrated);
  const isOpeningProject = useProjectStore((state) => state.isOpeningProject);
  const hydrate = useProjectStore((state) => state.hydrate);
  const currentProjectId = useProjectStore((state) => state.currentProjectId);
  const currentProjectName = useProjectStore(
    (state) => state.currentProject?.name ?? null,
  );
  const currentProjectType = useProjectStore(
    (state) => state.currentProject?.projectType ?? null,
  );
  const currentProjectAssetLibraryId = useProjectStore(
    (state) => state.currentProject?.assetLibraryId ?? null,
  );
  const currentProjectClipLibraryId = useProjectStore(
    (state) => state.currentProject?.clipLibraryId ?? null,
  );
  const currentProjectClipLastFolderId = useProjectStore(
    (state) => state.currentProject?.clipLastFolderId ?? null,
  );
  const closeProject = useProjectStore((state) => state.closeProject);
  const setCurrentProjectAssetLibrary = useProjectStore(
    (state) => state.setCurrentProjectAssetLibrary,
  );
  const updateNodeData = useCanvasStore((state) => state.updateNodeData);
  const flushCurrentProjectToDisk = useProjectStore(
    (state) => state.flushCurrentProjectToDisk,
  );
  const openJimengVideoQueueProject = useJimengVideoQueueStore(
    (state) => state.openProject,
  );
  const closeJimengVideoQueueProject = useJimengVideoQueueStore(
    (state) => state.closeProject,
  );
  const [canvasEntryLoadingState, setCanvasEntryLoadingState] =
    useState<CanvasEntryLoadingState>({
      projectId: null,
      phase: "project",
      totalCount: 0,
      loadedCount: 0,
      failedCount: 0,
    });
  const isWindowCloseInProgressRef = useRef(false);
  const hasAttemptedDreaminaAutoUpdateRef = useRef(false);
  const canvasEntryPreloadRunRef = useRef(0);

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
    if (!currentProjectId) {
      closeJimengVideoQueueProject();
      return;
    }

    void openJimengVideoQueueProject(currentProjectId);
  }, [
    closeJimengVideoQueueProject,
    currentProjectId,
    openJimengVideoQueueProject,
  ]);

  useLayoutEffect(() => {
    const currentProject = useProjectStore.getState().currentProject;

    if (
      !currentProjectId ||
      !currentProject ||
      currentProject.id !== currentProjectId ||
      currentProjectType === "ad"
    ) {
      canvasEntryPreloadRunRef.current += 1;
      setCanvasEntryLoadingState({
        projectId: null,
        phase: "project",
        totalCount: 0,
        loadedCount: 0,
        failedCount: 0,
      });
      return;
    }

    const runId = canvasEntryPreloadRunRef.current + 1;
    canvasEntryPreloadRunRef.current = runId;
    const imageUrls = collectProjectImageUrls(currentProject.nodes);
    void import("./features/canvas/CanvasScreen");

    if (imageUrls.length === 0) {
      setCanvasEntryLoadingState({
        projectId: null,
        phase: "project",
        totalCount: 0,
        loadedCount: 0,
        failedCount: 0,
      });
      return;
    }

    const startedAt = performance.now();

    setCanvasEntryLoadingState({
      projectId: currentProjectId,
      phase: "images",
      totalCount: imageUrls.length,
      loadedCount: 0,
      failedCount: 0,
    });

    void (async () => {
      try {
        await preloadProjectImages(imageUrls, {
          onProgress: ({ totalCount, loadedCount, failedCount }) => {
            if (canvasEntryPreloadRunRef.current !== runId) {
              return;
            }

            setCanvasEntryLoadingState({
              projectId: currentProjectId,
              phase: "images",
              totalCount,
              loadedCount,
              failedCount,
            });
          },
        });
      } finally {
        const elapsedMs = performance.now() - startedAt;
        const remainingMs = Math.max(0, MIN_CANVAS_ENTRY_LOADING_MS - elapsedMs);
        if (remainingMs > 0) {
          await new Promise<void>((resolve) => {
            window.setTimeout(resolve, remainingMs);
          });
        }

        if (canvasEntryPreloadRunRef.current !== runId) {
          return;
        }

        setCanvasEntryLoadingState({
          projectId: null,
          phase: "project",
          totalCount: 0,
          loadedCount: 0,
          failedCount: 0,
        });
      }
    })();
  }, [currentProjectId, currentProjectType]);

  const isCanvasEntryLoading =
    currentProjectType !== "ad" &&
    currentProjectId != null &&
    canvasEntryLoadingState.projectId === currentProjectId;
  const shouldShowProjectLoader = isOpeningProject || isCanvasEntryLoading;
  const shouldRenderProjectWorkspace = Boolean(currentProjectId);

  const assetPanelProjectContext = useMemo<AssetPanelProjectContext>(
    () => ({
      projectId: currentProjectId,
      projectName: currentProjectName,
      projectType: currentProjectType,
      assetLibraryId: currentProjectAssetLibraryId,
    }),
    [
      currentProjectAssetLibraryId,
      currentProjectId,
      currentProjectName,
      currentProjectType,
    ],
  );

  const clipLibraryPanelProjectContext = useMemo<ClipLibraryPanelProjectContext>(
    () => ({
      projectId: currentProjectId,
      projectName: currentProjectName,
      projectType: currentProjectType,
      clipLibraryId: currentProjectClipLibraryId,
      clipLastFolderId: currentProjectClipLastFolderId,
    }),
    [
      currentProjectClipLastFolderId,
      currentProjectClipLibraryId,
      currentProjectId,
      currentProjectName,
      currentProjectType,
    ],
  );

  useEffect(() => {
    void emitToAssetPanel(ASSET_PANEL_CONTEXT_EVENT, assetPanelProjectContext).catch(
      (error) => {
        console.warn("failed to sync asset panel context", error);
      },
    );
  }, [assetPanelProjectContext]);

  useEffect(() => {
    setLatestClipLibraryPanelProjectContext(clipLibraryPanelProjectContext);
    void emitToClipLibraryPanel(
      CLIP_LIBRARY_PANEL_CONTEXT_EVENT,
      clipLibraryPanelProjectContext,
    ).catch((error) => {
      console.warn("failed to sync clip library panel context", error);
    });
  }, [clipLibraryPanelProjectContext]);

  useEffect(() => {
    const appWindow = getCurrentWindow();
    let unlistenAssetPanelReady: (() => void) | null = null;
    let unlistenAssetPanelLibraryChange: (() => void) | null = null;
    let disposed = false;

    const registerAssetPanelBridge = async () => {
      const nextUnlistenAssetPanelReady = await appWindow.listen(
        ASSET_PANEL_READY_EVENT,
        () => {
          void emitToAssetPanel(
            ASSET_PANEL_CONTEXT_EVENT,
            assetPanelProjectContext,
          ).catch((error) => {
            console.warn("failed to deliver initial asset panel context", error);
          });
        },
      );
      if (disposed) {
        nextUnlistenAssetPanelReady();
        return;
      }
      unlistenAssetPanelReady = nextUnlistenAssetPanelReady;

      const nextUnlistenAssetPanelLibraryChange = await appWindow.listen<string | null>(
        ASSET_PANEL_SET_LIBRARY_EVENT,
        (event) => {
          setCurrentProjectAssetLibrary(event.payload?.trim() || null);
        },
      );
      if (disposed) {
        nextUnlistenAssetPanelLibraryChange();
        return;
      }
      unlistenAssetPanelLibraryChange = nextUnlistenAssetPanelLibraryChange;
    };

    void registerAssetPanelBridge().catch((error) => {
      console.error("Failed to register asset panel bridge", error);
    });

    return () => {
      disposed = true;
      unlistenAssetPanelReady?.();
      unlistenAssetPanelLibraryChange?.();
    };
  }, [assetPanelProjectContext, setCurrentProjectAssetLibrary]);

  useEffect(() => {
    const appWindow = getCurrentWindow();
    let unlistenClipPanelReady: (() => void) | null = null;
    let unlistenClipNodeBound: (() => void) | null = null;
    let unlistenClipPanelClosed: (() => void) | null = null;
    let disposed = false;

    const registerClipPanelBridge = async () => {
      const nextUnlistenClipPanelReady = await appWindow.listen(
        CLIP_LIBRARY_PANEL_READY_EVENT,
        () => {
          const queuedNavigation = consumeClipLibraryPanelNavigationQueue();

          void emitToClipLibraryPanel(
            CLIP_LIBRARY_PANEL_CONTEXT_EVENT,
            clipLibraryPanelProjectContext,
          ).catch((error) => {
            console.warn("failed to deliver initial clip library panel context", error);
          });

          if (queuedNavigation.libraryId !== undefined) {
            void emitToClipLibraryPanel(
              CLIP_LIBRARY_PANEL_SET_LIBRARY_EVENT,
              queuedNavigation.libraryId,
            ).catch((error) => {
              console.warn("failed to deliver queued clip library selection", error);
            });
          }

          if (queuedNavigation.focusTarget) {
            void emitToClipLibraryPanel(
              CLIP_LIBRARY_PANEL_FOCUS_TARGET_EVENT,
              queuedNavigation.focusTarget,
            ).catch((error) => {
              console.warn("failed to deliver queued clip library focus target", error);
            });
          }
        },
      );
      if (disposed) {
        nextUnlistenClipPanelReady();
        return;
      }
      unlistenClipPanelReady = nextUnlistenClipPanelReady;

      const nextUnlistenClipNodeBound =
        await appWindow.listen<ClipLibraryPanelNodeBoundPayload>(
          CLIP_LIBRARY_PANEL_NODE_BOUND_EVENT,
          (event) => {
            const payload = event.payload;
            if (!payload || payload.projectId !== currentProjectId) {
              return;
            }

            updateNodeData(payload.nodeId, {
              clipLibraryId: payload.clipLibraryId,
              clipFolderId: payload.clipFolderId,
              clipItemId: payload.clipItemId,
            });
          },
        );
      if (disposed) {
        nextUnlistenClipNodeBound();
        return;
      }
      unlistenClipNodeBound = nextUnlistenClipNodeBound;

      const nextUnlistenClipPanelClosed = await appWindow.listen(
        CLIP_LIBRARY_PANEL_CLOSED_EVENT,
        () => {
          blockClipLibraryPanelOpenFor();
        },
      );
      if (disposed) {
        nextUnlistenClipPanelClosed();
        return;
      }
      unlistenClipPanelClosed = nextUnlistenClipPanelClosed;
    };

    void registerClipPanelBridge().catch((error) => {
      console.error("Failed to register clip library panel bridge", error);
    });

    return () => {
      disposed = true;
      unlistenClipPanelReady?.();
      unlistenClipNodeBound?.();
      unlistenClipPanelClosed?.();
    };
  }, [clipLibraryPanelProjectContext, currentProjectId, updateNodeData]);

  useEffect(() => {
    const unsubscribe = subscribeOpenGlobalErrorDialog((detail) => {
      setGlobalError(detail);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeOpenSettingsDialog(({ category, providerTab, providerId }) => {
      setSettingsInitialCategory(category ?? "general");
      setSettingsInitialProviderTab(providerTab ?? "script");
      setSettingsInitialProviderId(providerId);
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

  const openUpdateDialogForResult = useCallback(
    (result: UpdateCheckResult) => {
      setLatestVersion(result.latestVersion ?? "");
      setCurrentVersion(result.currentVersion ?? "");
      setUpdateReleaseNotes(result.releaseNotes ?? "");
      setUpdatePublishedAt(result.publishedAt ?? "");
      setUpdateDialogErrorCode(result.error ?? null);
      setUpdateCanInstallInApp(isWindowsUpdaterRuntime() && !result.error);
      setUpdateInstallState("idle");
      setUpdateDownloadProgress(null);
      setUpdateDialogLoaded(true);
      setShowUpdateDialog(true);
    },
    [],
  );

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
        openUpdateDialogForResult(result);
      }
    };

    void runUpdateCheck();
    return () => {
      cancelled = true;
    };
  }, [
    isHydrated,
    autoCheckAppUpdateOnLaunch,
    enableUpdateDialog,
    openUpdateDialogForResult,
  ]);

  useEffect(() => {
    if (!settingsHydrated || !autoUpdateDreaminaCliOnLaunch) {
      return;
    }

    if (hasAttemptedDreaminaAutoUpdateRef.current) {
      return;
    }
    hasAttemptedDreaminaAutoUpdateRef.current = true;

    let cancelled = false;

    const runDreaminaAutoUpdate = async () => {
      try {
        const info = await checkDreaminaCliUpdate();
        if (cancelled || info.checkError || !info.hasUpdate) {
          return;
        }

        await updateDreaminaCli();
      } catch (error) {
        if (!cancelled) {
          console.warn("failed to auto update Dreamina CLI", error);
        }
      }
    };

    void runDreaminaAutoUpdate();

    return () => {
      cancelled = true;
    };
  }, [settingsHydrated, autoUpdateDreaminaCliOnLaunch]);

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

    openUpdateDialogForResult(result);
    return "has-update";
  };

  const handleIgnoreUpdateToday = useCallback(() => {
    if (!latestVersion) {
      return;
    }

    suppressUpdateVersion(latestVersion, "today");
    setShowUpdateDialog(false);
  }, [latestVersion]);

  const handleIgnoreUpdateVersion = useCallback(() => {
    if (!latestVersion) {
      return;
    }

    suppressUpdateVersion(latestVersion, "forever");
    setShowUpdateDialog(false);
  }, [latestVersion]);

  const handleDisableUpdateReminders = useCallback(() => {
    setEnableUpdateDialog(false);
    setShowUpdateDialog(false);
  }, [setEnableUpdateDialog]);

  const handleInstallUpdateNow = useCallback(async () => {
    setUpdateDialogErrorCode(null);
    setUpdateInstallState("downloading");
    setUpdateDownloadProgress({
      phase: "downloading",
      downloadedBytes: 0,
    });

    try {
      await downloadAndInstallUpdate((progress) => {
        setUpdateInstallState(progress.phase);
        setUpdateDownloadProgress(progress);
      });

      setUpdateInstallState("restarting");
      await relaunch();
    } catch (error) {
      console.error("failed to install app update", error);
      setUpdateInstallState("idle");
      setUpdateDialogErrorCode("install");
    }
  }, []);

  const handleOpenClipLibraryPanel = useCallback(async () => {
    if (isClipLibraryPanelOpenBlocked()) {
      return;
    }

    const libraryId = currentProjectClipLibraryId?.trim() || null;
    const clipLastFolderId = currentProjectClipLastFolderId?.trim() || null;
    queueClipLibraryPanelLibrary(libraryId);
    queueClipLibraryPanelFocusTarget(
      libraryId && clipLastFolderId
        ? {
            clipLibraryId: libraryId,
            clipFolderId: clipLastFolderId,
          }
        : null
    );
    await openClipLibraryPanelWindow(t("clipLibrary.windowTitle"));

    if (libraryId) {
      await emitToClipLibraryPanel(CLIP_LIBRARY_PANEL_SET_LIBRARY_EVENT, libraryId);
      if (clipLastFolderId) {
        await emitToClipLibraryPanel(CLIP_LIBRARY_PANEL_FOCUS_TARGET_EVENT, {
          clipLibraryId: libraryId,
          clipFolderId: clipLastFolderId,
        });
      }
    }
  }, [currentProjectClipLastFolderId, currentProjectClipLibraryId, t]);

  return (
    <div className="w-full h-full flex flex-col bg-bg-dark">
      <TitleBar
        onExtensionsClick={() => {
          setExtensionsDialogLoaded(true);
          setShowExtensions(true);
        }}
        onClipLibraryClick={handleOpenClipLibraryPanel}
        onSettingsClick={() => {
          setSettingsInitialCategory("general");
          setSettingsInitialProviderTab("script");
          setSettingsInitialProviderId(undefined);
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
            {!shouldRenderProjectWorkspace && shouldShowProjectLoader ? (
              <CanvasProjectLoadingScreen
                projectName={currentProjectName}
                phase={currentProjectId ? canvasEntryLoadingState.phase : "project"}
                totalCount={canvasEntryLoadingState.totalCount}
                loadedCount={canvasEntryLoadingState.loadedCount}
                failedCount={canvasEntryLoadingState.failedCount}
              />
            ) : shouldRenderProjectWorkspace ? (
              <div className="relative h-full w-full">
                {currentProjectType === "ad" ? <AdProjectWorkspace /> : <CanvasScreen />}
                {shouldShowProjectLoader ? (
                  <div className="absolute inset-0 z-20">
                    <CanvasProjectLoadingScreen
                      projectName={currentProjectName}
                      phase={currentProjectId ? canvasEntryLoadingState.phase : "project"}
                      totalCount={canvasEntryLoadingState.totalCount}
                      loadedCount={canvasEntryLoadingState.loadedCount}
                      failedCount={canvasEntryLoadingState.failedCount}
                    />
                  </div>
                ) : null}
              </div>
            ) : (
              <ProjectManager />
            )}
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
            initialProviderTab={settingsInitialProviderTab}
            initialProviderId={settingsInitialProviderId}
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
            releaseNotes={updateReleaseNotes}
            publishedAt={updatePublishedAt}
            canInstallInApp={updateCanInstallInApp}
            installState={updateInstallState}
            downloadProgress={updateDownloadProgress}
            errorCode={updateDialogErrorCode}
            onInstallNow={() => {
              void handleInstallUpdateNow();
            }}
            onIgnoreToday={handleIgnoreUpdateToday}
            onIgnoreVersion={handleIgnoreUpdateVersion}
            onDisableReminders={handleDisableUpdateReminders}
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

function DetachedAssetPanelApp() {
  useApplyGlobalAppearance();

  return <DetachedAssetPanelWindow />;
}

function DetachedClipLibraryPanelApp() {
  useApplyGlobalAppearance();

  return <DetachedClipLibraryWindow />;
}

function App() {
  const currentWindowLabel = getCurrentWindow().label;

  if (currentWindowLabel === CLIP_LIBRARY_PANEL_WINDOW_LABEL) {
    return <DetachedClipLibraryPanelApp />;
  }

  if (currentWindowLabel === ASSET_PANEL_WINDOW_LABEL) {
    return <DetachedAssetPanelApp />;
  }

  return <MainApp />;
}

export default App;
