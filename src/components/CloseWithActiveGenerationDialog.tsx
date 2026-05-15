import { useTranslation } from "react-i18next";
import { UiButton, UiModal } from "@/components/ui";

type CloseDialogAction = "idle" | "minimize" | "close";

interface CloseWithActiveGenerationDialogProps {
  isOpen: boolean;
  hasActiveGeneration: boolean;
  actionState: CloseDialogAction;
  canMinimizeToTray?: boolean;
  onClose: () => void;
  onMinimize: () => Promise<void> | void;
  onForceClose: () => Promise<void> | void;
}

export function CloseWithActiveGenerationDialog({
  isOpen,
  hasActiveGeneration,
  actionState,
  canMinimizeToTray = true,
  onClose,
  onMinimize,
  onForceClose,
}: CloseWithActiveGenerationDialogProps) {
  const { t } = useTranslation();
  const isBusy = actionState !== "idle";
  const handleClose = isBusy ? () => undefined : onClose;
  const textVariant = hasActiveGeneration ? "active" : "idle";

  return (
    <UiModal
      isOpen={isOpen}
      title={t(`appCloseDialog.${textVariant}.title`)}
      onClose={handleClose}
      widthClassName="w-[520px]"
      draggable={false}
      footer={
        <>
          <UiButton variant="muted" size="sm" onClick={handleClose} disabled={isBusy}>
            {t("appCloseDialog.cancelClose")}
          </UiButton>
          {canMinimizeToTray ? (
            <UiButton
              variant="primary"
              size="sm"
              onClick={() => {
                void onMinimize();
              }}
              disabled={isBusy}
            >
              {t("appCloseDialog.minimize")}
            </UiButton>
          ) : null}
          <UiButton
            variant={canMinimizeToTray ? "ghost" : "primary"}
            size="sm"
            className={
              canMinimizeToTray
                ? "text-red-200 hover:bg-red-500/10 hover:text-red-100"
                : undefined
            }
            onClick={() => {
              void onForceClose();
            }}
            disabled={isBusy}
          >
            {t("appCloseDialog.forceClose")}
          </UiButton>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-sm leading-6 text-text-dark">
          {t(
            `appCloseDialog.${textVariant}.${canMinimizeToTray ? "description" : "descriptionNoTray"}`,
          )}
        </p>
        {canMinimizeToTray ? (
          <div className="rounded-lg border border-[rgba(255,255,255,0.1)] bg-bg-dark/60 px-3 py-2">
            <p className="text-xs leading-5 text-text-muted">
              {t("appCloseDialog.hint")}
            </p>
          </div>
        ) : null}
      </div>
    </UiModal>
  );
}
