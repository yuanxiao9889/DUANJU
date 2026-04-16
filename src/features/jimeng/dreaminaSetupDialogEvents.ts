import type { DreaminaCliStatusResponse } from "@/commands/dreaminaCli";

export type DreaminaSetupFeature = "image" | "video";
export type DreaminaSetupAction = "generate" | "requery";

export interface DreaminaSetupDialogDetail {
  feature?: DreaminaSetupFeature;
  action?: DreaminaSetupAction;
  initialStatus?: DreaminaCliStatusResponse | null;
}

const OPEN_DREAMINA_SETUP_DIALOG_EVENT =
  "storyboard:open-dreamina-setup-dialog";

export function openDreaminaSetupDialog(
  detail: DreaminaSetupDialogDetail = {},
): void {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(
    new CustomEvent<DreaminaSetupDialogDetail>(
      OPEN_DREAMINA_SETUP_DIALOG_EVENT,
      { detail },
    ),
  );
}

export function subscribeOpenDreaminaSetupDialog(
  callback: (detail: DreaminaSetupDialogDetail) => void,
): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }

  const handler = (event: Event) => {
    const customEvent = event as CustomEvent<DreaminaSetupDialogDetail>;
    callback(customEvent.detail ?? {});
  };

  window.addEventListener(
    OPEN_DREAMINA_SETUP_DIALOG_EVENT,
    handler as EventListener,
  );
  return () => {
    window.removeEventListener(
      OPEN_DREAMINA_SETUP_DIALOG_EVENT,
      handler as EventListener,
    );
  };
}
