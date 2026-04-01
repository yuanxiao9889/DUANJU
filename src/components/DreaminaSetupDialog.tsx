import { useCallback, useEffect, useMemo, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  CheckCircle2,
  Copy,
  Download,
  Loader2,
  RefreshCw,
  TerminalSquare,
  Wrench,
} from "lucide-react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";

import {
  checkDreaminaCliStatus,
  installDreaminaCli,
  openDreaminaLoginTerminal,
  type DreaminaCliStatusCode,
  type DreaminaCliStatusResponse,
} from "@/commands/dreaminaCli";
import { UiButton, UiModal, UiPanel } from "@/components/ui";
import type { DreaminaSetupDialogDetail } from "@/features/jimeng/dreaminaSetupDialogEvents";

const GIT_DOWNLOAD_URL = "https://git-scm.com/download/win";
const DREAMINA_CLI_PAGE_URL = "https://jimeng.jianying.com/cli";

type SetupStepState = "done" | "active" | "pending";

interface DreaminaSetupDialogProps {
  isOpen: boolean;
  detail?: DreaminaSetupDialogDetail | null;
  onClose: () => void;
}

interface SetupStepViewModel {
  key: "git" | "cli" | "login";
  title: string;
  description: string;
  state: SetupStepState;
}

function resolveStatusCode(
  status: DreaminaCliStatusResponse | null,
): DreaminaCliStatusCode | "checking" {
  if (!status) {
    return "checking";
  }

  return status.code;
}

function resolveCurrentStepIndex(
  code: DreaminaCliStatusCode | "checking",
): number {
  switch (code) {
    case "gitBashMissing":
      return 0;
    case "cliMissing":
      return 1;
    case "loginRequired":
      return 2;
    case "ready":
      return 3;
    default:
      return -1;
  }
}

function resolveStepState(
  currentStepIndex: number,
  index: number,
): SetupStepState {
  if (currentStepIndex === 3) {
    return "done";
  }

  if (currentStepIndex === -1) {
    return "pending";
  }

  if (index < currentStepIndex) {
    return "done";
  }

  return index === currentStepIndex ? "active" : "pending";
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

function resolveCopyCommand(
  code: DreaminaCliStatusCode | "checking",
  t: TFunction,
): string | null {
  switch (code) {
    case "gitBashMissing":
      return t("dreaminaSetup.commands.git");
    case "cliMissing":
      return t("dreaminaSetup.commands.installCli");
    case "loginRequired":
      return t("dreaminaSetup.commands.login");
    case "unknown":
      return `${t("dreaminaSetup.commands.installCli")}\n${t(
        "dreaminaSetup.commands.login",
      )}`;
    default:
      return null;
  }
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
        body: t("dreaminaSetup.status.checking"),
      };
  }
}

function resolveStepClasses(state: SetupStepState): string {
  if (state === "done") {
    return "border-emerald-400/30 bg-emerald-500/10";
  }

  if (state === "active") {
    return "border-accent/45 bg-accent/10";
  }

  return "border-[rgba(255,255,255,0.08)] bg-[rgba(15,23,42,0.32)]";
}

function resolveStepBadgeClasses(state: SetupStepState): string {
  if (state === "done") {
    return "bg-emerald-500/18 text-emerald-200";
  }

  if (state === "active") {
    return "bg-accent/18 text-accent";
  }

  return "bg-[rgba(255,255,255,0.08)] text-text-muted";
}

export function DreaminaSetupDialog({
  isOpen,
  detail,
  onClose,
}: DreaminaSetupDialogProps) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<DreaminaCliStatusResponse | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [isInstalling, setIsInstalling] = useState(false);
  const [isOpeningLogin, setIsOpeningLogin] = useState(false);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const refreshStatus =
    useCallback(async (): Promise<DreaminaCliStatusResponse> => {
      setIsChecking(true);

      try {
        const nextStatus = await checkDreaminaCliStatus();
        setStatus(nextStatus);
        return nextStatus;
      } catch (error) {
        const fallbackStatus = {
          ready: false,
          code: "unknown",
          message: "Dreamina CLI is not ready.",
          detail:
            error instanceof Error
              ? error.message
              : typeof error === "string"
                ? error
                : (JSON.stringify(error) ?? String(error)),
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

    setActionNotice(null);
    setCopied(false);
    setStatus(detail?.initialStatus ?? null);

    if (!detail?.initialStatus) {
      void refreshStatus();
    }
  }, [detail?.initialStatus, isOpen, refreshStatus]);

  const statusCode = resolveStatusCode(status);
  const statusCopy = useMemo(
    () => resolveStatusCopy(statusCode, t),
    [statusCode, t],
  );
  const copyCommand = useMemo(
    () => resolveCopyCommand(statusCode, t),
    [statusCode, t],
  );
  const currentStepIndex = useMemo(
    () => resolveCurrentStepIndex(statusCode),
    [statusCode],
  );
  const steps = useMemo<SetupStepViewModel[]>(
    () => [
      {
        key: "git",
        title: t("dreaminaSetup.steps.git.title"),
        description: t("dreaminaSetup.steps.git.description"),
        state: resolveStepState(currentStepIndex, 0),
      },
      {
        key: "cli",
        title: t("dreaminaSetup.steps.cli.title"),
        description: t("dreaminaSetup.steps.cli.description"),
        state: resolveStepState(currentStepIndex, 1),
      },
      {
        key: "login",
        title: t("dreaminaSetup.steps.login.title"),
        description: t("dreaminaSetup.steps.login.description"),
        state: resolveStepState(currentStepIndex, 2),
      },
    ],
    [currentStepIndex, t],
  );
  const canInstallCli = statusCode === "cliMissing" || statusCode === "unknown";
  const canOpenLogin =
    statusCode === "loginRequired" || statusCode === "unknown";

  const handleDownloadGit = useCallback(() => {
    void openUrl(GIT_DOWNLOAD_URL);
  }, []);

  const handleOpenCliPage = useCallback(() => {
    void openUrl(DREAMINA_CLI_PAGE_URL);
  }, []);

  const handleInstallCli = useCallback(async () => {
    setIsInstalling(true);
    setActionNotice(null);

    try {
      await installDreaminaCli();
      const nextStatus = await refreshStatus();
      setActionNotice(
        nextStatus.ready
          ? t("dreaminaSetup.notice.readyAfterInstall")
          : t("dreaminaSetup.notice.installDone"),
      );
    } catch (error) {
      setActionNotice(
        error instanceof Error
          ? error.message
          : typeof error === "string"
            ? error
            : (JSON.stringify(error) ?? String(error)),
      );
    } finally {
      setIsInstalling(false);
    }
  }, [refreshStatus, t]);

  const handleOpenLoginTerminal = useCallback(async () => {
    setIsOpeningLogin(true);
    setActionNotice(null);

    try {
      await openDreaminaLoginTerminal();
      setActionNotice(t("dreaminaSetup.notice.loginOpened"));
    } catch (error) {
      setActionNotice(
        error instanceof Error
          ? error.message
          : typeof error === "string"
            ? error
            : (JSON.stringify(error) ?? String(error)),
      );
    } finally {
      setIsOpeningLogin(false);
    }
  }, [t]);

  const handleCopyCommand = useCallback(async () => {
    if (!copyCommand) {
      return;
    }

    try {
      await navigator.clipboard.writeText(copyCommand);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch (error) {
      console.error("failed to copy Dreamina setup command", error);
    }
  }, [copyCommand]);

  return (
    <UiModal
      isOpen={isOpen}
      title={t("dreaminaSetup.title")}
      onClose={onClose}
      widthClassName="w-[720px]"
      footer={
        <>
          <UiButton
            variant="muted"
            size="sm"
            onClick={() => {
              setActionNotice(null);
              void refreshStatus();
            }}
            disabled={isChecking || isInstalling || isOpeningLogin}
          >
            {isChecking ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-1.5 h-4 w-4" />
            )}
            {t("dreaminaSetup.actions.recheck")}
          </UiButton>
          <UiButton variant="primary" size="sm" onClick={onClose}>
            {t("common.close")}
          </UiButton>
        </>
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
                  <Wrench className="h-4 w-4 text-amber-200" />
                )}
                <div className="text-sm font-medium text-text-dark">
                  {statusCopy.title}
                </div>
              </div>
              <div className="text-xs leading-5 text-text-muted">
                {statusCopy.body}
              </div>
            </div>
            {status?.detail ? (
              <div className="max-w-[280px] rounded-lg border border-[rgba(255,255,255,0.08)] bg-black/20 px-3 py-2 text-[11px] leading-5 text-text-muted">
                <div className="mb-1 font-medium text-text-dark">
                  {t("dreaminaSetup.detailTitle")}
                </div>
                <div className="whitespace-pre-wrap break-words">
                  {status.detail}
                </div>
              </div>
            ) : null}
          </div>
        </UiPanel>

        <div className="grid gap-3 md:grid-cols-3">
          {steps.map((step, index) => (
            <UiPanel
              key={step.key}
              className={`p-4 ${resolveStepClasses(step.state)}`}
            >
              <div className="mb-3 flex items-center justify-between gap-2">
                <div className="text-sm font-medium text-text-dark">
                  {index + 1}. {step.title}
                </div>
                <span
                  className={`rounded-full px-2 py-1 text-[11px] font-medium ${resolveStepBadgeClasses(
                    step.state,
                  )}`}
                >
                  {t(`dreaminaSetup.stepState.${step.state}`)}
                </span>
              </div>
              <div className="text-xs leading-5 text-text-muted">
                {step.description}
              </div>
            </UiPanel>
          ))}
        </div>

        <div className="flex flex-wrap gap-2">
          <UiButton
            variant="muted"
            size="sm"
            onClick={handleDownloadGit}
            disabled={isInstalling || isOpeningLogin}
          >
            <Download className="mr-1.5 h-4 w-4" />
            {t("dreaminaSetup.actions.downloadGit")}
          </UiButton>

          <UiButton
            variant="muted"
            size="sm"
            onClick={handleOpenCliPage}
            disabled={isInstalling || isOpeningLogin}
          >
            <Wrench className="mr-1.5 h-4 w-4" />
            {t("dreaminaSetup.actions.openCliPage")}
          </UiButton>

          {canInstallCli ? (
            <UiButton
              variant="primary"
              size="sm"
              onClick={() => {
                void handleInstallCli();
              }}
              disabled={isInstalling || isOpeningLogin}
            >
              {isInstalling ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : (
                <Download className="mr-1.5 h-4 w-4" />
              )}
              {t("dreaminaSetup.actions.installCli")}
            </UiButton>
          ) : null}

          {canOpenLogin ? (
            <UiButton
              variant="primary"
              size="sm"
              onClick={() => {
                void handleOpenLoginTerminal();
              }}
              disabled={isInstalling || isOpeningLogin}
            >
              {isOpeningLogin ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : (
                <TerminalSquare className="mr-1.5 h-4 w-4" />
              )}
              {t("dreaminaSetup.actions.openLogin")}
            </UiButton>
          ) : null}

          {copyCommand ? (
            <UiButton
              variant="muted"
              size="sm"
              onClick={() => {
                void handleCopyCommand();
              }}
              disabled={isInstalling || isOpeningLogin}
            >
              <Copy className="mr-1.5 h-4 w-4" />
              {copied
                ? t("dreaminaSetup.copied")
                : t("dreaminaSetup.actions.copyCommand")}
            </UiButton>
          ) : null}
        </div>

        {actionNotice ? (
          <UiPanel className="border-[rgba(255,255,255,0.1)] bg-[rgba(15,23,42,0.42)] p-3 text-xs leading-5 text-text-muted">
            {actionNotice}
          </UiPanel>
        ) : null}
      </div>
    </UiModal>
  );
}
