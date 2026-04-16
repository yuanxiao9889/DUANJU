import type {
  DreaminaCliStatusCode,
  DreaminaCliStatusResponse,
} from "@/commands/dreaminaCli";
import { checkDreaminaCliStatus } from "@/commands/dreaminaCli";
import {
  openDreaminaSetupDialog,
  type DreaminaSetupAction,
  type DreaminaSetupFeature,
} from "@/features/jimeng/dreaminaSetupDialogEvents";
import type { TFunction } from "i18next";

interface EnsureDreaminaCliReadyOptions {
  feature?: DreaminaSetupFeature;
  action?: DreaminaSetupAction;
}

function normalizeDreaminaCheckFailure(
  error: unknown,
): DreaminaCliStatusResponse {
  const detail =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : (JSON.stringify(error) ?? String(error));

  return {
    ready: false,
    code: "unknown",
    message: "Dreamina CLI is not ready.",
    detail,
  };
}

export async function ensureDreaminaCliReady(
  options: EnsureDreaminaCliReadyOptions = {},
): Promise<DreaminaCliStatusResponse> {
  try {
    const status = await checkDreaminaCliStatus();
    if (!status.ready) {
      openDreaminaSetupDialog({
        ...options,
        initialStatus: status,
      });
    }
    return status;
  } catch (error) {
    const status = normalizeDreaminaCheckFailure(error);
    openDreaminaSetupDialog({
      ...options,
      initialStatus: status,
    });
    return status;
  }
}

export function resolveDreaminaSetupBlockedMessage(
  t: TFunction,
  code: DreaminaCliStatusCode | null | undefined,
): string {
  switch (code) {
    case "gitBashMissing":
      return t("dreaminaSetup.blocked.gitBashMissing");
    case "cliMissing":
      return t("dreaminaSetup.blocked.cliMissing");
    case "loginRequired":
      return t("dreaminaSetup.blocked.loginRequired");
    case "membershipRequired":
      return t("dreaminaSetup.blocked.membershipRequired");
    default:
      return t("dreaminaSetup.blocked.unknown");
  }
}
