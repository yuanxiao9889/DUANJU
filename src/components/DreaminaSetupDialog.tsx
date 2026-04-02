import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type UnlistenFn } from "@tauri-apps/api/event";
import { CheckCircle2, Loader2, RefreshCw, Sparkles } from "lucide-react";
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
import { UiButton, UiModal, UiPanel } from "@/components/ui";
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

export function DreaminaSetupDialog({
  isOpen,
  detail,
  onClose,
}: DreaminaSetupDialogProps) {
  const { t } = useTranslation();
  const autoPrepareTriggeredRef = useRef(false);
  const [status, setStatus] = useState<DreaminaCliStatusResponse | null>(null);
  const [setupProgress, setSetupProgress] =
    useState<DreaminaSetupProgressEvent | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [isAutoPreparing, setIsAutoPreparing] = useState(false);
  const [actionNotice, setActionNotice] = useState<string | null>(null);

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
    setActionNotice(null);
    setStatus(detail?.initialStatus ?? null);
    setSetupProgress(
      detail?.initialStatus?.ready
        ? {
            stage: "completed",
            progress: 100,
            detail: detail.initialStatus.detail ?? null,
            loginQrDataUrl: null,
          }
        : null,
    );

    if (!detail?.initialStatus) {
      void refreshStatus();
    }
  }, [detail?.initialStatus, isOpen, refreshStatus]);

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
  const isLoginFlowVisible =
    !status?.ready &&
    (statusCode === "loginRequired" ||
      setupProgress?.stage === "openingLogin" ||
      setupProgress?.stage === "waitingForLogin");
  const runtimeSourceCopy = useMemo(
    () => resolveRuntimeSourceCopy(setupProgress?.gitSource, t),
    [setupProgress?.gitSource, t],
  );

  const handleAutoPrepare = useCallback(async () => {
    autoPrepareTriggeredRef.current = true;
    setIsAutoPreparing(true);
    setActionNotice(null);
    setSetupProgress({
      stage: "checking",
      progress: 8,
      detail: null,
      loginQrDataUrl: null,
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
        });
        setActionNotice(t("dreaminaSetup.notice.autoReady"));
      } else if (response.loginWaitTimedOut) {
        setSetupProgress((previous) =>
          previous ?? {
            stage: "waitingForLogin",
            progress: 94,
            gitSource: response.gitSource ?? null,
            detail: response.status.detail ?? null,
            loginQrDataUrl: null,
          },
        );
        setActionNotice(t("dreaminaSetup.notice.loginStillPending"));
      } else {
        setActionNotice(t("dreaminaSetup.notice.autoNeedsAttention"));
      }
    } catch (error) {
      const message = toErrorMessage(error);
      setStatus({
        ready: false,
        code: "unknown",
        message: "Dreamina CLI is not ready.",
        detail: message,
      });
      setActionNotice(message);
    } finally {
      setIsAutoPreparing(false);
    }
  }, [t]);

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

  return (
    <UiModal
      isOpen={isOpen}
      title={t("dreaminaSetup.title")}
      onClose={onClose}
      widthClassName="w-[720px]"
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
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
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
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
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
            {t("dreaminaSetup.subtitle")}
          </p>
        </div>

        <UiPanel className="border-[rgba(255,255,255,0.1)] bg-[rgba(15,23,42,0.52)] p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                {statusCode === "ready" ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-300" />
                ) : isChecking ? (
                  <Loader2 className="h-4 w-4 animate-spin text-accent" />
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
          </div>
        </UiPanel>

        {isLoginFlowVisible ? (
          <UiPanel className="border-[rgba(255,255,255,0.1)] bg-[rgba(15,23,42,0.5)] p-4">
            <div className="grid gap-4 lg:grid-cols-[220px,minmax(0,1fr)] lg:items-center">
              <div className="mx-auto w-[220px]">
                {loginQrDataUrl ? (
                  <div className="rounded-[28px] bg-white p-3 shadow-[0_18px_60px_rgba(15,23,42,0.28)]">
                    <img
                      src={loginQrDataUrl}
                      alt={t("dreaminaSetup.qr.alt")}
                      className="w-full rounded-[20px]"
                    />
                  </div>
                ) : (
                  <div className="flex aspect-square w-[220px] items-center justify-center rounded-[28px] border border-[rgba(255,255,255,0.08)] bg-black/20 text-text-muted">
                    <Loader2 className="h-8 w-8 animate-spin" />
                  </div>
                )}
              </div>

              <div className="space-y-3">
                <div className="space-y-1">
                  <div className="text-sm font-medium text-text-dark">
                    {loginQrDataUrl
                      ? t("dreaminaSetup.qr.title")
                      : t("dreaminaSetup.qr.waitingTitle")}
                  </div>
                  <div className="text-xs leading-5 text-text-muted">
                    {loginQrDataUrl
                      ? t("dreaminaSetup.qr.body")
                      : t("dreaminaSetup.qr.waitingBody")}
                  </div>
                </div>

                {loginQrDataUrl ? (
                  <div className="grid gap-2">
                    {[
                      t("dreaminaSetup.qr.step1"),
                      t("dreaminaSetup.qr.step2"),
                      t("dreaminaSetup.qr.step3"),
                    ].map((step) => (
                      <div
                        key={step}
                        className="rounded-xl border border-[rgba(255,255,255,0.06)] bg-black/10 px-3 py-2 text-sm text-text-dark"
                      >
                        {step}
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          </UiPanel>
        ) : null}

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

        {actionNotice ? (
          <UiPanel className="border-[rgba(255,255,255,0.08)] bg-[rgba(15,23,42,0.32)] p-4 text-xs leading-5 text-text-muted">
            <div className="mb-1 text-sm font-medium text-text-dark">
              {t("dreaminaSetup.noticeTitle")}
            </div>
            <div className="whitespace-pre-wrap break-words">{actionNotice}</div>
          </UiPanel>
        ) : null}

        {status?.detail ? (
          <UiPanel className="border-[rgba(255,255,255,0.08)] bg-black/20 p-4 text-xs leading-5 text-text-muted">
            <div className="mb-1 text-sm font-medium text-text-dark">
              {t("dreaminaSetup.detailTitle")}
            </div>
            <div className="whitespace-pre-wrap break-words">
              {status.detail}
            </div>
          </UiPanel>
        ) : null}
      </div>
    </UiModal>
  );
}
