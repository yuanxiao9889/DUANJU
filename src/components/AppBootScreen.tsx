import { useTranslation } from "react-i18next";

import { UiLoadingAnimation, UiLoadingBanner } from "@/components/ui";

export function AppBootScreen() {
  const { t } = useTranslation();

  return (
    <div className="relative h-full overflow-hidden bg-bg-dark">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(var(--accent-rgb),0.12),transparent_34%)]" />

      <div className="relative flex h-full items-center justify-center px-6">
        <div
          role="status"
          aria-live="polite"
          className="flex flex-col items-center gap-6 text-center"
        >
          <UiLoadingAnimation
            className="opacity-95"
            width="168px"
            height="84px"
            fit="contain"
          />
          <h1 className="text-2xl font-semibold text-text-dark">
            {t("app.bootTitle")}
          </h1>
          <span className="sr-only">{t("common.loading")}</span>
        </div>
      </div>
    </div>
  );
}

export function AppContentLoader() {
  return (
    <div className="relative h-full overflow-hidden bg-bg-dark">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(var(--accent-rgb),0.14),transparent_32%)]" />
      <div className="relative flex h-full items-center justify-center px-6">
        <UiLoadingBanner />
      </div>
    </div>
  );
}
