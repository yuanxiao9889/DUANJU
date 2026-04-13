import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type UnlistenFn } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { CheckCircle2, RefreshCw, Sparkles, TriangleAlert } from "lucide-react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";

import {
  checkDreaminaCliStatus,
  onDreaminaSetupProgress,
  runDreaminaGuidedSetup,
  type DreaminaCliStatusCode,
  type DreaminaCliStatusResponse,
  type DreaminaGitSource,
  type DreaminaSetupProgressEvent,
} from "@/commands/dreaminaCli";
import { UiButton, UiLoadingAnimation, UiModal, UiPanel } from "@/components/ui";
import type { DreaminaSetupDialogDetail } from "@/features/jimeng/dreaminaSetupDialogEvents";

const READY_AUTO_CLOSE_DELAY_MS = 1200;

interface DreaminaSetupDialogProps {
  isOpen: boolean;
  detail?: DreaminaSetupDialogDetail | null;
  onClose: () => void;
}

function resolveContextKey(detail?: DreaminaSetupDialogDetail | null): string {
  if (detail?.feature === "image" && detail.action === "generate") {
    return "dreaminaSetup.context.imageGenerate";
  }

  if (detail?.feature === "video" && detail.action === "generate") {
    return "dreaminaSetup.context.videoGenerate";
  }

  if (detail?.feature === "image" && detail.action === "requery") {
    return "dreaminaSetup.context.imageRequery";
  }

  if (detail?.feature === "video" && detail.action === "requery") {
    return "dreaminaSetup.context.videoRequery";
  }

  return "dreaminaSetup.context.default";
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : typeof error === "string"
      ? error
      : (JSON.stringify(error) ?? String(error));
}

function resolveStatusCode(
  status: DreaminaCliStatusResponse | null,
): DreaminaCliStatusCode | "checking" {
  if (!status) {
    return "checking";
  }

  return status.code;
}

function resolveStatusCopy(
  code: DreaminaCliStatusCode | "checking",
  t: TFunction,
): { title: string; body: string } {
  switch (code) {
    case "ready":
      return {
        title: t("dreaminaSetup.status.readyTitle"),
        body: t("dreaminaSetup.status.readyBody"),
      };
    case "gitBashMissing":
      return {
        title: t("dreaminaSetup.status.gitBashMissingTitle"),
        body: t("dreaminaSetup.status.gitBashMissingBody"),
      };
    case "cliMissing":
      return {
        title: t("dreaminaSetup.status.cliMissingTitle"),
        body: t("dreaminaSetup.status.cliMissingBody"),
      };
    case "membershipRequired":
      return {
        title: t("dreaminaSetup.status.membershipRequiredTitle"),
        body: t("dreaminaSetup.status.membershipRequiredBody"),
      };
    case "loginRequired":
      return {
        title: t("dreaminaSetup.status.loginRequiredTitle"),
        body: t("dreaminaSetup.status.loginRequiredBody"),
      };
    case "unknown":
      return {
        title: t("dreaminaSetup.status.unknownTitle"),
        body: t("dreaminaSetup.status.unknownBody"),
      };
    default:
      return {
        title: t("dreaminaSetup.status.checking"),
        body: t("dreaminaSetup.status.checkingBody"),
      };
  }
}

function resolveProgressCopy(
  progress: DreaminaSetupProgressEvent | null,
  t: TFunction,
): { title: string; body: string } {
  if (!progress) {
    return {
      title: t("dreaminaSetup.progress.idleTitle"),
      body: t("dreaminaSetup.progress.idleBody"),
    };
  }

  switch (progress.stage) {
    case "checking":
      return {
        title: t("dreaminaSetup.progress.checkingTitle"),
        body: t("dreaminaSetup.progress.checkingBody"),
      };
    case "preparingGit":
      return progress.gitSource === "bundled"
        ? {
            title: t("dreaminaSetup.progress.preparingBundledGitTitle"),
            body: t("dreaminaSetup.progress.preparingBundledGitBody"),
          }
        : {
            title: t("dreaminaSetup.progress.preparingSystemGitTitle"),
            body: t("dreaminaSetup.progress.preparingSystemGitBody"),
          };
    case "installingCli":
      return {
        title: t("dreaminaSetup.progress.installingCliTitle"),
        body: t("dreaminaSetup.progress.installingCliBody"),
      };
    case "openingLogin":
      return {
        title: t("dreaminaSetup.progress.openingLoginTitle"),
        body: t("dreaminaSetup.progress.openingLoginBody"),
      };
    case "waitingForLogin":
      return {
        title: t("dreaminaSetup.progress.waitingForLoginTitle"),
        body: t("dreaminaSetup.progress.waitingForLoginBody"),
      };
    case "failed":
      return {
        title: t("dreaminaSetup.progress.failedTitle"),
        body: t("dreaminaSetup.progress.failedBody"),
      };
    case "verifying":
      return {
        title: t("dreaminaSetup.progress.verifyingTitle"),
        body: t("dreaminaSetup.progress.verifyingBody"),
      };
    case "completed":
      return {
        title: t("dreaminaSetup.progress.completedTitle"),
        body: t("dreaminaSetup.progress.completedBody"),
      };
    default:
      return {
        title: t("dreaminaSetup.progress.idleTitle"),
        body: t("dreaminaSetup.progress.idleBody"),
      };
  }
}

function resolveRuntimeSourceCopy(
  source: DreaminaGitSource | null | undefined,
  t: TFunction,
): string | null {
  if (source === "bundled") {
    return t("dreaminaSetup.runtime.bundled");
  }

  if (source === "system") {
    return t("dreaminaSetup.runtime.system");
  }

  return null;
}

function resolveDiagnosticSummary(detail: string, t: TFunction): string[] {
  const lowered = detail.toLowerCase();
  const summaries: string[] = [];

  if (
    lowered.includes("credential.json does not contain a usable login session")
    || lowered.includes("credential.json is missing")
    || lowered.includes("credential.json exists but is still empty")
  ) {
    summaries.push(t("dreaminaSetup.detailSummary.loginSessionMissing"));
  }

  if (
    lowered.includes("get_qrcode")
    || lowered.includes("empty response body")
    || lowered.includes("login qr code")
  ) {
    summaries.push(t("dreaminaSetup.detailSummary.qrNotReturned"));
  }

  if (
    lowered.includes("callback server")
    || lowered.includes("listen tcp")
    || lowered.includes("port is already in use")
    || lowered.includes("bind:")
  ) {
    summaries.push(t("dreaminaSetup.detailSummary.callbackPortBusy"));
  }

  if (lowered.includes("premium member")) {
    summaries.push(t("dreaminaSetup.detailSummary.membershipRequired"));
  }

  if (lowered.includes("dreamina user_credit") || lowered.includes("require usable credential")) {
    summaries.push(t("dreaminaSetup.detailSummary.recheckPending"));
  }

  if (summaries.length > 0) {
    return Array.from(new Set(summaries)).slice(0, 3);
  }

  const fallbackLine = detail
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .find((line) => {
      const normalized = line.toLowerCase();
      return (
        !normalized.startsWith("error ")
        && !normalized.startsWith("info ")
        && !normalized.includes("original error:")
        && !normalized.includes(":\\users\\")
        && !normalized.includes(".dreamina_cli\\logs\\")
        && normalized !== "dreamina cli failed."
      );
    });

  return [fallbackLine ?? t("dreaminaSetup.detailSummary.fallback")];
}

export function DreaminaSetupDialog({
  isOpen,
  detail,
  onClose,
}: DreaminaSetupDialogProps) {
  const { t } = useTranslation();
  const autoPrepareTriggeredRef = useRef(false);
  const autoOpenedLoginUrlRef = useRef<string | null>(null);
  const [status, setStatus] = useState<DreaminaCliStatusResponse | null>(null);
  const [setupProgress, setSetupProgress] =
    useState<DreaminaSetupProgressEvent | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [isAutoPreparing, setIsAutoPreparing] = useState(false);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [isRawDetailVisible, setIsRawDetailVisible] = useState(false);
  const [diagnosticCopied, setDiagnosticCopied] = useState(false);

  const refreshStatus =
    useCallback(async (): Promise<DreaminaCliStatusResponse> => {
      setIsChecking(true);

      try {
        const nextStatus = await checkDreaminaCliStatus();
        setStatus(nextStatus);
        if (nextStatus.ready) {
        setSetupProgress({
          stage: "completed",
          progress: 100,
          detail: nextStatus.detail ?? null,
          loginPageUrl: null,
        });
      }
      return nextStatus;
      } catch (error) {
        const fallbackStatus = {
          ready: false,
          code: "unknown",
          message: "Dreamina CLI is not ready.",
          detail: toErrorMessage(error),
        } satisfies DreaminaCliStatusResponse;
        setStatus(fallbackStatus);
        return fallbackStatus;
      } finally {
        setIsChecking(false);
      }
    }, []);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    let disposed = false;
    let unlisten: UnlistenFn | null = null;

    void onDreaminaSetupProgress((event) => {
      if (!disposed) {
        setSetupProgress((previous) => ({
          stage: event.stage,
          progress: event.progress,
          gitSource: event.gitSource ?? previous?.gitSource ?? null,
          detail: event.detail ?? previous?.detail ?? null,
          loginQrDataUrl:
            event.loginQrDataUrl ?? previous?.loginQrDataUrl ?? null,
          loginPageUrl: event.loginPageUrl ?? previous?.loginPageUrl ?? null,
        }));
      }
    }).then((nextUnlisten) => {
      if (disposed) {
        void nextUnlisten();
        return;
      }
      unlisten = nextUnlisten;
    });

    return () => {
      disposed = true;
      if (unlisten) {
        void unlisten();
      }
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    autoPrepareTriggeredRef.current = false;
    autoOpenedLoginUrlRef.current = null;
    setActionNotice(null);
    setStatus(detail?.initialStatus ?? null);
    setSetupProgress(
      detail?.initialStatus?.ready
        ? {
            stage: "completed",
            progress: 100,
            detail: detail.initialStatus.detail ?? null,
            loginQrDataUrl: null,
            loginPageUrl: null,
          }
        : null,
    );

    if (!detail?.initialStatus) {
      void refreshStatus();
    }
  }, [detail?.initialStatus, isOpen, refreshStatus]);

  useEffect(() => {
    if (!isOpen) {
      setIsRawDetailVisible(false);
      setDiagnosticCopied(false);
      autoOpenedLoginUrlRef.current = null;
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !status?.ready || detail?.initialStatus?.ready) {
      return;
    }

    setActionNotice(t("dreaminaSetup.notice.autoClosing"));
    const timer = window.setTimeout(() => {
      onClose();
    }, READY_AUTO_CLOSE_DELAY_MS);

    return () => {
      window.clearTimeout(timer);
    };
  }, [detail?.initialStatus?.ready, isOpen, onClose, status?.ready, t]);

  const statusCode = resolveStatusCode(status);
  const statusCopy = useMemo(
    () => resolveStatusCopy(statusCode, t),
    [statusCode, t],
  );
  const progressCopy = useMemo(
    () => resolveProgressCopy(setupProgress, t),
    [setupProgress, t],
  );
  const progressPercent = setupProgress?.progress ?? 0;
  const loginQrDataUrl = setupProgress?.loginQrDataUrl ?? null;
  const loginPageUrl = setupProgress?.loginPageUrl ?? null;
  const diagnosticDetail = useMemo(() => {
    if (setupProgress?.detail && !status?.ready) {
      return setupProgress.detail;
    }

    return status?.detail ?? setupProgress?.detail ?? null;
  }, [setupProgress?.detail, status?.detail, status?.ready]);
  const isMembershipRequired = statusCode === "membershipRequired";
  const isLoginFlowFailed =
    setupProgress?.stage === "failed" &&
    !status?.ready &&
    (Boolean(loginQrDataUrl) ||
      isMembershipRequired ||
      statusCode === "loginRequired" ||
      progressPercent >= 72);
  const isLoginFlowVisible =
    !status?.ready &&
    (Boolean(loginQrDataUrl) ||
      Boolean(loginPageUrl) ||
      isMembershipRequired ||
      statusCode === "loginRequired" ||
      isLoginFlowFailed ||
      setupProgress?.stage === "openingLogin" ||
      setupProgress?.stage === "waitingForLogin");
  const showCompactQrLayout = isLoginFlowVisible;
  const showQrFailureState = isLoginFlowVisible && !loginQrDataUrl && isLoginFlowFailed;
  const hasManualLoginFallback = Boolean(loginPageUrl) && !loginQrDataUrl;
  const runtimeSourceCopy = useMemo(
    () => resolveRuntimeSourceCopy(setupProgress?.gitSource, t),
    [setupProgress?.gitSource, t],
  );
  const diagnosticSummary = useMemo(
    () => (diagnosticDetail ? resolveDiagnosticSummary(diagnosticDetail, t) : []),
    [diagnosticDetail, t],
  );
  const qrCopy = useMemo(() => {
    if (hasManualLoginFallback) {
      return {
        title: t("dreaminaSetup.manualLogin.title"),
        body: t("dreaminaSetup.manualLogin.body"),
      };
    }

    if (showQrFailureState) {
      return {
        title: t("dreaminaSetup.qr.failedTitle"),
        body: t("dreaminaSetup.qr.failedBody"),
      };
    }

    if (loginQrDataUrl) {
      return {
        title: t("dreaminaSetup.qr.title"),
        body: t("dreaminaSetup.qr.body"),
      };
    }

    return {
      title: t("dreaminaSetup.qr.waitingTitle"),
      body: t("dreaminaSetup.qr.waitingBody"),
    };
  }, [hasManualLoginFallback, loginQrDataUrl, showQrFailureState, t]);
  const membershipHintCopy = useMemo(
    () =>
      isMembershipRequired
        ? {
            title: t("dreaminaSetup.membershipRequired.title"),
            body: t("dreaminaSetup.membershipRequired.body"),
          }
        : null,
    [isMembershipRequired, t],
  );
  const diagnosticCopyText = useMemo(() => {
    if (!diagnosticDetail) {
      return "";
    }

    const sections = [
      "Dreamina Setup Diagnostic",
      `Status Code: ${statusCode}`,
      `Status: ${status?.message ?? statusCopy.title}`,
      setupProgress?.stage ? `Progress Stage: ${setupProgress.stage}` : null,
      setupProgress?.progress != null
        ? `Progress: ${setupProgress.progress}%`
        : null,
      runtimeSourceCopy ? `Runtime: ${runtimeSourceCopy}` : null,
      loginQrDataUrl ? "QR Visible: yes" : "QR Visible: no",
      loginPageUrl ? `Login Page: ${loginPageUrl}` : null,
      diagnosticSummary.length > 0
        ? `Summary:\n${diagnosticSummary.map((line) => `- ${line}`).join("\n")}`
        : null,
      `Detail:\n${diagnosticDetail}`,
    ].filter(Boolean);

    return sections.join("\n\n");
  }, [
    diagnosticDetail,
      diagnosticSummary,
      loginPageUrl,
      loginQrDataUrl,
      runtimeSourceCopy,
      setupProgress?.progress,
    setupProgress?.stage,
    status?.message,
    statusCode,
    statusCopy.title,
  ]);

  const handleCopyDiagnostic = useCallback(async () => {
    if (!diagnosticCopyText) {
      return;
    }

    try {
      await navigator.clipboard.writeText(diagnosticCopyText);
      setDiagnosticCopied(true);
      window.setTimeout(() => {
        setDiagnosticCopied(false);
      }, 1200);
    } catch (error) {
      console.error("Failed to copy Dreamina diagnostic", error);
    }
  }, [diagnosticCopyText]);

  const handleOpenManualLogin = useCallback(async () => {
    if (!loginPageUrl) {
      return;
    }

    try {
      autoOpenedLoginUrlRef.current = loginPageUrl;
      await openUrl(loginPageUrl);
    } catch (error) {
      console.error("Failed to open Dreamina manual login page", error);
      setActionNotice(toErrorMessage(error));
    }
  }, [loginPageUrl]);

  const handleAutoPrepare = useCallback(async () => {
    autoPrepareTriggeredRef.current = true;
    autoOpenedLoginUrlRef.current = null;
    setIsAutoPreparing(true);
    setActionNotice(null);
    setSetupProgress({
      stage: "checking",
      progress: 8,
      detail: null,
      loginQrDataUrl: null,
      loginPageUrl: null,
    });

    try {
      const response = await runDreaminaGuidedSetup();
      setStatus(response.status);

      if (response.status.ready) {
        setSetupProgress({
          stage: "completed",
          progress: 100,
          gitSource: response.gitSource ?? null,
          detail: response.status.detail ?? null,
          loginQrDataUrl: null,
          loginPageUrl: null,
        });
        setActionNotice(t("dreaminaSetup.notice.autoReady"));
      } else if (response.loginWaitTimedOut) {
        const refreshedStatus = await checkDreaminaCliStatus().catch(() => null);
        const effectiveStatus = refreshedStatus ?? response.status;
        setStatus(effectiveStatus);

        if (effectiveStatus.ready) {
          setSetupProgress({
            stage: "completed",
            progress: 100,
            gitSource: response.gitSource ?? null,
            detail: effectiveStatus.detail ?? null,
            loginQrDataUrl: null,
            loginPageUrl: null,
          });
          setActionNotice(t("dreaminaSetup.notice.autoReady"));
        } else {
          setSetupProgress((previous) => {
            const preserveVerifying = previous?.stage === "verifying";
            return {
              stage: preserveVerifying ? "verifying" : "waitingForLogin",
              progress: preserveVerifying
                ? Math.max(previous?.progress ?? 96, 96)
                : 94,
              gitSource: response.gitSource ?? previous?.gitSource ?? null,
              detail: effectiveStatus.detail ?? previous?.detail ?? null,
              loginQrDataUrl: previous?.loginQrDataUrl ?? null,
              loginPageUrl: previous?.loginPageUrl ?? null,
            };
          });
          setActionNotice(t("dreaminaSetup.notice.loginStillPending"));
        }
      } else {
        if (
          response.status.code === "loginRequired"
          || response.status.code === "unknown"
          || response.status.code === "membershipRequired"
        ) {
          setSetupProgress((previous) => ({
            stage: "failed",
            progress: Math.max(previous?.progress ?? 0, 78),
            gitSource: response.gitSource ?? previous?.gitSource ?? null,
            detail: response.status.detail ?? previous?.detail ?? null,
            loginQrDataUrl: previous?.loginQrDataUrl ?? null,
            loginPageUrl: previous?.loginPageUrl ?? null,
          }));
        }
        setActionNotice(
          response.status.code === "membershipRequired"
            ? t("dreaminaSetup.notice.membershipRequired")
            : t("dreaminaSetup.notice.autoNeedsAttention"),
        );
      }
    } catch (error) {
      const message = toErrorMessage(error);
      setStatus({
        ready: false,
        code: "unknown",
        message: "Dreamina CLI is not ready.",
        detail: message,
      });
      setSetupProgress((previous) => ({
        stage: "failed",
        progress: previous?.progress ?? 0,
        gitSource: previous?.gitSource ?? null,
        detail: message,
        loginQrDataUrl: previous?.loginQrDataUrl ?? null,
        loginPageUrl: previous?.loginPageUrl ?? null,
      }));
      setActionNotice(message);
    } finally {
      setIsAutoPreparing(false);
    }
  }, [t]);

  useEffect(() => {
    if (
      !isOpen ||
      !loginPageUrl ||
      Boolean(loginQrDataUrl) ||
      autoOpenedLoginUrlRef.current === loginPageUrl
    ) {
      return;
    }

    autoOpenedLoginUrlRef.current = loginPageUrl;
    void openUrl(loginPageUrl).catch((error) => {
      console.error("Failed to auto-open Dreamina login page", error);
    });
  }, [isOpen, loginPageUrl, loginQrDataUrl]);

  useEffect(() => {
    if (
      !isOpen ||
      autoPrepareTriggeredRef.current ||
      isChecking ||
      isAutoPreparing ||
      !status ||
      status.ready
    ) {
      return;
    }

    autoPrepareTriggeredRef.current = true;
    void handleAutoPrepare();
  }, [handleAutoPrepare, isAutoPreparing, isChecking, isOpen, status]);

  const automaticTasks = useMemo(
    () => [
      t("dreaminaSetup.automatic.git"),
      t("dreaminaSetup.automatic.cli"),
      t("dreaminaSetup.automatic.login"),
    ],
    [t],
  );

  const canAutoPrepare = statusCode !== "ready";
  const primaryActionLabel =
    loginQrDataUrl || isLoginFlowVisible
      ? t("dreaminaSetup.actions.refreshQr")
      : t("dreaminaSetup.actions.startAutoSetup");
  const isBusy = isChecking || isAutoPreparing;
  const inlineWaitingNotice =
    !isAutoPreparing && setupProgress?.stage === "waitingForLogin"
      ? actionNotice
      : null;

  return (
    <UiModal
      isOpen={isOpen}
      title={t("dreaminaSetup.title")}
      onClose={onClose}
      widthClassName={showCompactQrLayout ? "w-[620px]" : "w-[720px]"}
      footer={
        <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap gap-2">
            <UiButton
              variant="muted"
              size="sm"
              onClick={() => {
                setActionNotice(null);
                void refreshStatus();
              }}
              disabled={isBusy}
            >
              {isChecking ? (
                <UiLoadingAnimation size="sm" className="mr-1.5" />
              ) : (
                <RefreshCw className="mr-1.5 h-4 w-4" />
              )}
              {t("dreaminaSetup.actions.recheck")}
            </UiButton>
          </div>

          <div className="flex flex-wrap justify-end gap-2">
            <UiButton variant="muted" size="sm" onClick={onClose}>
              {t("common.close")}
            </UiButton>

            {canAutoPrepare ? (
              <UiButton
                variant="primary"
                size="sm"
                onClick={() => {
                  void handleAutoPrepare();
                }}
                disabled={isBusy}
              >
                {isAutoPreparing ? (
                  <UiLoadingAnimation size="sm" className="mr-1.5" />
                ) : (
                  <Sparkles className="mr-1.5 h-4 w-4" />
                )}
                {primaryActionLabel}
              </UiButton>
            ) : null}
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="space-y-1">
          <p className="text-sm text-text-dark">
            {t(resolveContextKey(detail))}
          </p>
          <p className="text-xs text-text-muted">
            {showCompactQrLayout
              ? t("dreaminaSetup.qr.compactHint")
              : t("dreaminaSetup.subtitle")}
          </p>
        </div>

        {!showCompactQrLayout ? (
          <UiPanel className="border-[rgba(255,255,255,0.1)] bg-[rgba(15,23,42,0.52)] p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  {statusCode === "ready" ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-300" />
                  ) : isChecking ? (
                    <UiLoadingAnimation size="sm" />
                  ) : (
                    <Sparkles className="h-4 w-4 text-amber-200" />
                  )}
                  <div className="text-sm font-medium text-text-dark">
                    {statusCopy.title}
                  </div>
                </div>
                <div className="text-xs leading-5 text-text-muted">
                  {statusCopy.body}
                </div>
              </div>
              {statusCode === "ready" ? (
                <div className="rounded-full border border-emerald-400/25 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-medium text-emerald-200">
                  {t("dreaminaSetup.readyBadge")}
                </div>
              ) : null}
            </div>
          </UiPanel>
        ) : null}

        <UiPanel className="border-[rgba(255,255,255,0.1)] bg-[rgba(15,23,42,0.44)] p-4">
          <div className="space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <div className="text-sm font-medium text-text-dark">
                  {progressCopy.title}
                </div>
                <div className="text-xs leading-5 text-text-muted">
                  {progressCopy.body}
                </div>
              </div>
              <div className="rounded-full border border-[rgba(255,255,255,0.08)] bg-black/20 px-2.5 py-1 text-[11px] font-medium text-text-dark">
                {progressPercent}%
              </div>
            </div>

            <div className="h-2 overflow-hidden rounded-full bg-black/25">
              <div
                className={`h-full rounded-full bg-accent transition-[width] duration-500 ${
                  isAutoPreparing && setupProgress?.stage === "waitingForLogin"
                    ? "animate-pulse"
                    : ""
                }`}
                style={{ width: `${Math.min(Math.max(progressPercent, 0), 100)}%` }}
              />
            </div>

            {runtimeSourceCopy ? (
              <div className="text-[11px] leading-5 text-text-muted">
                {runtimeSourceCopy}
              </div>
            ) : null}

            {inlineWaitingNotice ? (
              <div className="rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-[11px] leading-5 text-amber-100">
                {inlineWaitingNotice}
              </div>
            ) : null}
          </div>
        </UiPanel>

        {isLoginFlowVisible ? (
          <UiPanel className="border-[rgba(255,255,255,0.1)] bg-[rgba(15,23,42,0.5)] p-4">
            <div className="grid gap-4 lg:grid-cols-[240px,minmax(0,1fr)] lg:items-center">
              <div className="mx-auto w-[240px]">
                {loginQrDataUrl ? (
                  <div className="rounded-[28px] bg-white p-3 shadow-[0_18px_60px_rgba(15,23,42,0.28)]">
                    <img
                      src={loginQrDataUrl}
                      alt={t("dreaminaSetup.qr.alt")}
                      className="w-full rounded-[20px]"
                    />
                  </div>
                ) : showQrFailureState ? (
                  <div className="flex aspect-square w-[220px] flex-col items-center justify-center gap-3 rounded-[28px] border border-amber-400/25 bg-amber-500/10 px-4 text-center">
                    <TriangleAlert className="h-10 w-10 text-amber-200" />
                    <div className="text-xs leading-5 text-amber-50/90">
                      {t("dreaminaSetup.qr.failedBody")}
                    </div>
                  </div>
                ) : (
                  <div className="flex aspect-square w-[220px] items-center justify-center rounded-[28px] border border-[rgba(255,255,255,0.08)] bg-black/20 text-text-muted">
                    <UiLoadingAnimation size="xl" />
                  </div>
                )}
              </div>

              <div className="space-y-3">
                <div className="space-y-1">
                  <div className="text-sm font-medium text-text-dark">
                    {qrCopy.title}
                  </div>
                  <div className="text-xs leading-5 text-text-muted">
                    {qrCopy.body}
                  </div>
                </div>

                {membershipHintCopy ? (
                  <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-3">
                    <div className="text-sm font-medium text-rose-200">
                      {membershipHintCopy.title}
                    </div>
                    <div className="mt-1 text-xs leading-5 text-rose-100/90">
                      {membershipHintCopy.body}
                    </div>
                  </div>
                ) : null}

                {hasManualLoginFallback ? (
                  <div className="rounded-xl border border-[rgba(255,255,255,0.08)] bg-black/10 px-3 py-3">
                    <div className="text-sm font-medium text-text-dark">
                      {t("dreaminaSetup.manualLogin.title")}
                    </div>
                    <div className="mt-1 text-xs leading-5 text-text-muted">
                      {t("dreaminaSetup.manualLogin.body")}
                    </div>
                    <div className="mt-3">
                      <UiButton
                        variant="primary"
                        size="sm"
                        onClick={() => {
                          void handleOpenManualLogin();
                        }}
                      >
                        {t("dreaminaSetup.manualLogin.open")}
                      </UiButton>
                    </div>
                  </div>
                ) : null}

                {loginQrDataUrl ? (
                  <div className="flex flex-wrap gap-2">
                    {[t("dreaminaSetup.qr.step1"), t("dreaminaSetup.qr.step2")].map(
                      (step) => (
                        <div
                          key={step}
                          className="rounded-full border border-[rgba(255,255,255,0.08)] bg-black/10 px-3 py-1.5 text-xs text-text-dark"
                        >
                          {step}
                        </div>
                      ),
                    )}
                  </div>
                ) : null}
              </div>
            </div>
          </UiPanel>
        ) : null}

        {!showCompactQrLayout ? (
          <UiPanel className="border-[rgba(255,255,255,0.08)] bg-[rgba(15,23,42,0.32)] p-4">
            <div className="space-y-3">
              <div className="text-xs font-medium uppercase tracking-[0.24em] text-text-muted">
                {t("dreaminaSetup.automatic.title")}
              </div>
              <div className="grid gap-2">
                {automaticTasks.map((task) => (
                  <div
                    key={task}
                    className="flex items-center gap-2 rounded-lg border border-[rgba(255,255,255,0.06)] bg-black/10 px-3 py-2 text-sm text-text-dark"
                  >
                    <CheckCircle2 className="h-4 w-4 text-accent" />
                    <span>{task}</span>
                  </div>
                ))}
              </div>
            </div>
          </UiPanel>
        ) : null}

        {actionNotice && !inlineWaitingNotice ? (
          <UiPanel className="border-[rgba(255,255,255,0.08)] bg-[rgba(15,23,42,0.32)] p-4 text-xs leading-5 text-text-muted">
            <div className="mb-1 text-sm font-medium text-text-dark">
              {t("dreaminaSetup.noticeTitle")}
            </div>
            <div className="whitespace-pre-wrap break-words">{actionNotice}</div>
          </UiPanel>
        ) : null}

        {diagnosticDetail ? (
          <UiPanel className="border-[rgba(255,255,255,0.08)] bg-black/20 p-4 text-xs leading-5 text-text-muted">
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-medium text-text-dark">
                  {t("dreaminaSetup.detailTitle")}
                </div>
                <UiButton
                  variant="muted"
                  size="sm"
                  onClick={() => {
                    void handleCopyDiagnostic();
                  }}
                >
                  {diagnosticCopied
                    ? t("dreaminaSetup.actions.copied")
                    : t("dreaminaSetup.actions.copyDiagnostic")}
                </UiButton>
              </div>
              <div className="space-y-2">
                {diagnosticSummary.map((line) => (
                  <div
                    key={line}
                    className="rounded-lg border border-[rgba(255,255,255,0.06)] bg-white/5 px-3 py-2 text-xs leading-5 text-text-dark"
                  >
                    {line}
                  </div>
                ))}
              </div>
              <div className="border-t border-[rgba(255,255,255,0.06)] pt-3">
                <button
                  type="button"
                  className="text-xs text-text-muted transition-colors hover:text-text-dark"
                  onClick={() => {
                    setIsRawDetailVisible((previous) => !previous);
                  }}
                >
                  {isRawDetailVisible
                    ? t("dreaminaSetup.hideRawDetail")
                    : t("dreaminaSetup.showRawDetail")}
                </button>
                {isRawDetailVisible ? (
                  <div className="mt-2 whitespace-pre-wrap break-words text-[11px] leading-5 text-text-muted">
                    {diagnosticDetail}
                  </div>
                ) : null}
              </div>
            </div>
          </UiPanel>
        ) : null}
      </div>
    </UiModal>
  );
}
