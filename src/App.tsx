import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { relaunch } from "@tauri-apps/plugin-process";
import { useTranslation } from "react-i18next";
import { AppBootScreen, AppContentLoader } from "./components/AppBootScreen";
import { CloseWithActiveGenerationDialog } from "./components/CloseWithActiveGenerationDialog";
import { TitleBar } from "./components/TitleBar";
import { GlobalErrorDialog } from "./components/GlobalErrorDialog";
import { PsImageToast } from "./components/PsImageToast";
import { useThemeStore } from "./stores/themeStore";
import { useProjectStore } from "./stores/projectStore";
import { useSettingsStore } from "./stores/settingsStore";
import { useCanvasStore } from "./stores/canvasStore";
import { stopCanvasThumbnailBackfill } from "./features/canvas/application/canvasThumbnailBackfill";
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
import { minimizeMainWindowToTray } from "./commands/system";
import { useJimengVideoQueueStore } from "./stores/jimengVideoQueueStore";
import { isJimengVideoQueueTerminalStatus } from "./features/jimeng/domain/jimengVideoQueue";
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
import { isTauriRuntime } from "./lib/tauriRuntime";

const WINDOW_CLOSE_FLUSH_TIMEOUT_MS = 2500;
const WINDOW_CLOSE_REQUEST_TIMEOUT_MS = 1200;
const MAIN_WINDOW_CLOSE_REQUEST_EVENT = "app:request-main-close";

function hasActiveGenerationFlag(data: unknown): boolean {
  return Boolean((data as { isGenerating?: boolean } | null)?.isGenerating);
}

function isWindowsRuntime(): boolean {
  return (
    isTauriRuntime() &&
    typeof navigator !== "undefined" &&
    /Windows/i.test(navigator.userAgent)
  );
}

function isWindowsUpdaterRuntime(): boolean {
  return isWindowsRuntime();
}

const CanvasScreen = lazy(() => {
  const startedAt = performance.now();
  if (import.meta.env.DEV) {
    console.debug("[canvas-perf] CanvasScreen import:start", {
      at: Math.round(startedAt),
    });
  }
  return import("./features/canvas/CanvasScreen").then((module) => {
    if (import.meta.env.DEV) {
      console.debug("[canvas-perf] CanvasScreen import:done", {
        elapsedMs: Math.round(performance.now() - startedAt),
      });
    }
    return {
      default: module.CanvasScreen,
    };
  });
});
const AdProjectWorkspace = lazy(() =>
  import("./features/ad/AdProjectWorkspace").then((module) => ({
    default: module.AdProjectWorkspace,
  })),
);
const CommerceAdProjectWorkspace = lazy(() =>
  import("./features/commerce-ad/CommerceAdProjectWorkspace").then(
    (module) => ({
      default: module.CommerceAdProjectWorkspace,
    }),
  ),
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
const ApiPlatformNoticeDialog = lazy(() =>
  import("./components/ApiPlatformNoticeDialog").then((module) => ({
    default: module.ApiPlatformNoticeDialog,
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
    const normalized =
      theme === "light"
        ? "#222222"
        : accentColor.startsWith("#")
          ? accentColor
          : `#${accentColor}`;
    root.style.setProperty("--accent", normalized);
    root.style.setProperty("--accent-rgb", toRgbCssValue(normalized));
  }, [accentColor, theme]);
}

function CanvasExitSavingOverlay() {
  const { t } = useTranslation();

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-bg-dark/80 px-6 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-lg border border-border-dark bg-surface-dark p-5 shadow-2xl">
        <div className="mb-4">
          <p className="text-sm font-medium text-text-dark">
            {t("project.exitSaving.title")}
          </p>
          <p className="mt-1 text-xs leading-5 text-text-muted">
            {t("project.exitSaving.description")}
          </p>
        </div>
        <div
          className="h-1.5 overflow-hidden rounded-full bg-bg-dark"
          role="progressbar"
          aria-label={t("project.exitSaving.progressLabel")}
        >
          <div className="h-full w-1/2 animate-[canvas-exit-save_1.15s_ease-in-out_infinite] rounded-full bg-accent" />
        </div>
      </div>
    </div>
  );
}

function waitForNextPaint(): Promise<void> {
  if (typeof window === "undefined") {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    window.requestAnimationFrame(() => {
      resolve();
    });
  });
}

async function waitForPaints(count: number): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    await waitForNextPaint();
  }
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
  const hasAcceptedApiPlatformNotice = useSettingsStore(
    (state) => state.hasAcceptedApiPlatformNotice,
  );
  const setEnableUpdateDialog = useSettingsStore(
    (state) => state.setEnableUpdateDialog,
  );
  const setAutoCheckAppUpdateOnLaunch = useSettingsStore(
    (state) => state.setAutoCheckAppUpdateOnLaunch,
  );
  const setHasAcceptedApiPlatformNotice = useSettingsStore(
    (state) => state.setHasAcceptedApiPlatformNotice,
  );
  const settingsHydrated = useSettingsStore((state) => state.isHydrated);
  const projectFullAutosaveIntervalMinutes = useSettingsStore(
    (state) => state.projectFullAutosaveIntervalMinutes,
  );
  const [showSettings, setShowSettings] = useState(false);
  const [showExtensions, setShowExtensions] = useState(false);
  const [showApiPlatformNotice, setShowApiPlatformNotice] = useState(false);
  const [settingsDialogLoaded, setSettingsDialogLoaded] = useState(false);
  const [apiPlatformNoticeDialogLoaded, setApiPlatformNoticeDialogLoaded] =
    useState(false);
  const [extensionsDialogLoaded, setExtensionsDialogLoaded] = useState(false);
  const [updateDialogLoaded, setUpdateDialogLoaded] = useState(false);
  const [dreaminaDialogLoaded, setDreaminaDialogLoaded] = useState(false);
  const [settingsInitialCategory, setSettingsInitialCategory] =
    useState<SettingsCategory>("general");
  const [settingsInitialProviderTab, setSettingsInitialProviderTab] =
    useState<ProviderTab>("script");
  const [settingsInitialProviderId, setSettingsInitialProviderId] = useState<
    string | undefined
  >(undefined);
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
  const [showAppCloseDialog, setShowAppCloseDialog] = useState(false);
  const [closeDialogActionState, setCloseDialogActionState] = useState<
    "idle" | "minimize" | "close"
  >("idle");
  const [isCanvasExitSaving, setIsCanvasExitSaving] = useState(false);

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
  const hasActiveCanvasGeneration = useCanvasStore((state) =>
    state.nodes.some((node) => hasActiveGenerationFlag(node.data)),
  );
  const closeProject = useProjectStore((state) => state.closeProject);
  const setCurrentProjectAssetLibrary = useProjectStore(
    (state) => state.setCurrentProjectAssetLibrary,
  );
  const updateNodeData = useCanvasStore((state) => state.updateNodeData);
  const saveCurrentProjectFully = useProjectStore(
    (state) => state.saveCurrentProjectFully,
  );
  const waitForCurrentProjectPersistenceIdle = useProjectStore(
    (state) => state.waitForCurrentProjectPersistenceIdle,
  );
  const finalizeCurrentProjectBeforeClose = useProjectStore(
    (state) => state.finalizeCurrentProjectBeforeClose,
  );
  const openJimengVideoQueueProject = useJimengVideoQueueStore(
    (state) => state.openProject,
  );
  const initializeJimengVideoQueue = useJimengVideoQueueStore(
    (state) => state.initialize,
  );
  const closeJimengVideoQueueProject = useJimengVideoQueueStore(
    (state) => state.closeProject,
  );
  const allJimengQueueJobs = useJimengVideoQueueStore((state) => state.allJobs);
  const isWindowCloseInProgressRef = useRef(false);
  const hasAttemptedDreaminaAutoUpdateRef = useRef(false);
  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  useEffect(() => {
    if (!isTauriRuntime()) {
      return;
    }

    if (!isHydrated) {
      return;
    }

    void initializeJimengVideoQueue();
  }, [initializeJimengVideoQueue, isHydrated]);

  useEffect(() => {
    if (!isTauriRuntime()) {
      return;
    }

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
    if (!settingsHydrated || hasAcceptedApiPlatformNotice) {
      return;
    }

    setApiPlatformNoticeDialogLoaded(true);
    setShowApiPlatformNotice(true);
  }, [hasAcceptedApiPlatformNotice, settingsHydrated]);

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

  useEffect(() => {
    if (
      !currentProjectId ||
      currentProjectType === "ad" ||
      currentProjectType === "commerceAd"
    ) {
      return;
    }

    void import("./features/canvas/CanvasScreen");
  }, [currentProjectId, currentProjectType]);

  const shouldShowProjectLoader = isOpeningProject;
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

  const clipLibraryPanelProjectContext =
    useMemo<ClipLibraryPanelProjectContext>(
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
    if (!isTauriRuntime()) {
      return;
    }

    void emitToAssetPanel(
      ASSET_PANEL_CONTEXT_EVENT,
      assetPanelProjectContext,
    ).catch((error) => {
      console.warn("failed to sync asset panel context", error);
    });
  }, [assetPanelProjectContext]);

  useEffect(() => {
    setLatestClipLibraryPanelProjectContext(clipLibraryPanelProjectContext);
    if (!isTauriRuntime()) {
      return;
    }

    void emitToClipLibraryPanel(
      CLIP_LIBRARY_PANEL_CONTEXT_EVENT,
      clipLibraryPanelProjectContext,
    ).catch((error) => {
      console.warn("failed to sync clip library panel context", error);
    });
  }, [clipLibraryPanelProjectContext]);

  useEffect(() => {
    if (!isTauriRuntime()) {
      return;
    }

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
            console.warn(
              "failed to deliver initial asset panel context",
              error,
            );
          });
        },
      );
      if (disposed) {
        nextUnlistenAssetPanelReady();
        return;
      }
      unlistenAssetPanelReady = nextUnlistenAssetPanelReady;

      const nextUnlistenAssetPanelLibraryChange = await appWindow.listen<
        string | null
      >(ASSET_PANEL_SET_LIBRARY_EVENT, (event) => {
        setCurrentProjectAssetLibrary(event.payload?.trim() || null);
      });
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
    if (!isTauriRuntime()) {
      return;
    }

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
            console.warn(
              "failed to deliver initial clip library panel context",
              error,
            );
          });

          if (queuedNavigation.libraryId !== undefined) {
            void emitToClipLibraryPanel(
              CLIP_LIBRARY_PANEL_SET_LIBRARY_EVENT,
              queuedNavigation.libraryId,
            ).catch((error) => {
              console.warn(
                "failed to deliver queued clip library selection",
                error,
              );
            });
          }

          if (queuedNavigation.focusTarget) {
            void emitToClipLibraryPanel(
              CLIP_LIBRARY_PANEL_FOCUS_TARGET_EVENT,
              queuedNavigation.focusTarget,
            ).catch((error) => {
              console.warn(
                "failed to deliver queued clip library focus target",
                error,
              );
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
    const unsubscribe = subscribeOpenSettingsDialog(
      ({ category, providerTab, providerId }) => {
        setSettingsInitialCategory(category ?? "general");
        setSettingsInitialProviderTab(providerTab ?? "script");
        setSettingsInitialProviderId(providerId);
        setSettingsDialogLoaded(true);
        setShowSettings(true);
      },
    );
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

  const openUpdateDialogForResult = useCallback((result: UpdateCheckResult) => {
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
  }, []);

  useEffect(() => {
    if (dreaminaSetupDetail) {
      setDreaminaDialogLoaded(true);
    }
  }, [dreaminaSetupDetail]);

  useEffect(() => {
    if (!isTauriRuntime()) {
      return;
    }

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
    if (!isTauriRuntime()) {
      return;
    }

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
    if (!isTauriRuntime()) {
      return;
    }

    if (!isHydrated) {
      return;
    }

    void ensureDailyDatabaseBackup().catch((error) => {
      console.warn("failed to ensure daily database backup", error);
    });
  }, [isHydrated]);

  const hasPendingJimengQueueJobs = useMemo(
    () =>
      allJimengQueueJobs.some(
        (job) => !isJimengVideoQueueTerminalStatus(job.status),
      ),
    [allJimengQueueJobs],
  );

  const hasMainWindowActiveGeneration =
    hasPendingJimengQueueJobs ||
    (currentProjectId != null &&
      currentProjectType !== "ad" &&
      hasActiveCanvasGeneration);

  useEffect(() => {
    if (
      !currentProjectId ||
      isOpeningProject ||
      isCanvasExitSaving ||
      isWindowCloseInProgressRef.current
    ) {
      return;
    }

    const timer = window.setInterval(() => {
      if (isWindowCloseInProgressRef.current) {
        return;
      }
      void saveCurrentProjectFully({ reason: "interval" }).catch((error) => {
        console.error("timed full project autosave failed", error);
      });
    }, projectFullAutosaveIntervalMinutes * 60 * 1000);

    return () => {
      window.clearInterval(timer);
    };
  }, [
    currentProjectId,
    isCanvasExitSaving,
    isOpeningProject,
    projectFullAutosaveIntervalMinutes,
    saveCurrentProjectFully,
  ]);

  const handleProjectBackClick = useCallback(async () => {
    if (!currentProjectId || isCanvasExitSaving) {
      return;
    }

    setIsCanvasExitSaving(true);
    try {
      await waitForNextPaint();
      await finalizeCurrentProjectBeforeClose();
      await stopCanvasThumbnailBackfill();
      closeProject({ skipPersist: true });
      await waitForPaints(2);
      await waitForCurrentProjectPersistenceIdle();
    } catch (error) {
      console.error("failed to save project before leaving canvas", error);
      setGlobalError({
        title: t("project.exitSaving.errorTitle"),
        message: t("project.exitSaving.errorMessage"),
        details:
          error instanceof Error
            ? error.stack || error.message
            : String(error),
      });
    } finally {
      setIsCanvasExitSaving(false);
    }
  }, [
    closeProject,
    currentProjectId,
    finalizeCurrentProjectBeforeClose,
    isCanvasExitSaving,
    t,
    waitForCurrentProjectPersistenceIdle,
  ]);

  const requestWindowClose = useCallback(async () => {
    if (isWindowCloseInProgressRef.current) {
      return;
    }

    isWindowCloseInProgressRef.current = true;

    const projectSaved = await settleWithinTimeout(
      finalizeCurrentProjectBeforeClose(),
      WINDOW_CLOSE_FLUSH_TIMEOUT_MS,
      "Project flush before window close",
    );
    if (!projectSaved) {
      isWindowCloseInProgressRef.current = false;
      setGlobalError({
        title: t("project.exitSaving.errorTitle"),
        message: t("project.exitSaving.errorMessage"),
      });
      return;
    }

    const exitRequested = await settleWithinTimeout(
      invoke<void>("request_app_exit"),
      WINDOW_CLOSE_REQUEST_TIMEOUT_MS,
      "App exit request",
    );

    if (!exitRequested) {
      isWindowCloseInProgressRef.current = false;
    }
  }, [finalizeCurrentProjectBeforeClose, t]);

  const handleMainWindowCloseIntent = useCallback(async () => {
    if (isWindowCloseInProgressRef.current) {
      return;
    }

    if (showAppCloseDialog || closeDialogActionState !== "idle") {
      return;
    }

    setCloseDialogActionState("idle");
    setShowAppCloseDialog(true);
  }, [closeDialogActionState, showAppCloseDialog]);

  const handleMinimizeToTray = useCallback(async () => {
    if (closeDialogActionState !== "idle") {
      return;
    }

    setCloseDialogActionState("minimize");
    const minimized = await minimizeMainWindowToTray();
    if (minimized) {
      setShowAppCloseDialog(false);
    }
    setCloseDialogActionState("idle");
  }, [closeDialogActionState]);

  const handleForceCloseWithActiveGeneration = useCallback(async () => {
    if (closeDialogActionState !== "idle") {
      return;
    }

    setCloseDialogActionState("close");
    await requestWindowClose();
    if (!isWindowCloseInProgressRef.current) {
      setCloseDialogActionState("idle");
    }
  }, [closeDialogActionState, requestWindowClose]);

  useEffect(() => {
    if (!isTauriRuntime()) {
      return;
    }

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
        await handleMainWindowCloseIntent();
      });
    };

    void registerWindowCloseHandler().catch((error) => {
      console.error("Failed to register window close handler", error);
    });

    return () => {
      disposed = true;
      detachWindowCloseListener();
    };
  }, [handleMainWindowCloseIntent]);

  useEffect(() => {
    if (!isTauriRuntime()) {
      return;
    }

    const appWindow = getCurrentWindow();
    let disposed = false;
    let unlistenMainCloseRequest: (() => void) | null = null;

    const registerMainCloseRequestListener = async () => {
      unlistenMainCloseRequest = await appWindow.listen(
        MAIN_WINDOW_CLOSE_REQUEST_EVENT,
        () => {
          if (disposed) {
            return;
          }
          void handleMainWindowCloseIntent();
        },
      );
    };

    void registerMainCloseRequestListener().catch((error) => {
      console.error("Failed to register tray close request listener", error);
    });

    return () => {
      disposed = true;
      unlistenMainCloseRequest?.();
    };
  }, [handleMainWindowCloseIntent]);

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
    setAutoCheckAppUpdateOnLaunch(false);
    setShowUpdateDialog(false);
  }, [setAutoCheckAppUpdateOnLaunch, setEnableUpdateDialog]);

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
        : null,
    );
    await openClipLibraryPanelWindow(t("clipLibrary.windowTitle"));

    if (libraryId) {
      await emitToClipLibraryPanel(
        CLIP_LIBRARY_PANEL_SET_LIBRARY_EVENT,
        libraryId,
      );
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
        onCloseRequest={handleMainWindowCloseIntent}
        showBackButton={!!currentProjectId}
        onBackClick={handleProjectBackClick}
        isBackDisabled={isCanvasExitSaving}
        projectName={currentProjectName}
        projectType={currentProjectType}
      />

      <main className="relative flex-1 min-h-0 overflow-hidden">
        {isHydrated ? (
          <Suspense
            fallback={
              currentProjectId ? (
                <CanvasProjectLoadingScreen
                  projectName={currentProjectName}
                  phase="project"
                  totalCount={0}
                  loadedCount={0}
                  failedCount={0}
                />
              ) : (
                <AppContentLoader />
              )
            }
          >
            {!shouldRenderProjectWorkspace && shouldShowProjectLoader ? (
              <CanvasProjectLoadingScreen
                projectName={currentProjectName}
                phase="project"
                totalCount={0}
                loadedCount={0}
                failedCount={0}
              />
            ) : shouldRenderProjectWorkspace ? (
              <div className="relative h-full w-full">
                {currentProjectType === "ad" ? (
                  <AdProjectWorkspace />
                ) : currentProjectType === "commerceAd" ? (
                  <CommerceAdProjectWorkspace />
                ) : (
                  <CanvasScreen />
                )}
                {shouldShowProjectLoader ? (
                  <div className="absolute inset-0 z-20">
                    <CanvasProjectLoadingScreen
                      projectName={currentProjectName}
                      phase="project"
                      totalCount={0}
                      loadedCount={0}
                      failedCount={0}
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
        {isCanvasExitSaving ? <CanvasExitSavingOverlay /> : null}
      </main>

      {apiPlatformNoticeDialogLoaded ? (
        <Suspense fallback={null}>
          <ApiPlatformNoticeDialog
            isOpen={showApiPlatformNotice}
            onClose={() => {
              setHasAcceptedApiPlatformNotice(true);
              setShowApiPlatformNotice(false);
            }}
            onAcknowledge={() => {
              setHasAcceptedApiPlatformNotice(true);
              setShowApiPlatformNotice(false);
            }}
          />
        </Suspense>
      ) : null}
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
      <CloseWithActiveGenerationDialog
        isOpen={showAppCloseDialog}
        hasActiveGeneration={hasMainWindowActiveGeneration}
        actionState={closeDialogActionState}
        canMinimizeToTray={isWindowsRuntime()}
        onClose={() => {
          if (closeDialogActionState !== "idle") {
            return;
          }
          setShowAppCloseDialog(false);
        }}
        onMinimize={handleMinimizeToTray}
        onForceClose={handleForceCloseWithActiveGeneration}
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
  if (!isTauriRuntime()) {
    return <MainApp />;
  }

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
