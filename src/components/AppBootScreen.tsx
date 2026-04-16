import { useTranslation } from "react-i18next";

import { UiLoadingBanner } from "@/components/ui";

function SkeletonBar({ className }: { className: string }) {
  return <div className={`animate-pulse rounded-full bg-white/8 ${className}`} />;
}

function SkeletonCard() {
  return (
    <div className="rounded-3xl border border-border-dark/60 bg-surface-dark/80 p-5 shadow-[0_12px_40px_rgba(0,0,0,0.18)] backdrop-blur-sm">
      <div className="flex items-start gap-3">
        <div className="h-11 w-11 animate-pulse rounded-2xl bg-accent/14" />
        <div className="min-w-0 flex-1 space-y-3">
          <SkeletonBar className="h-4 w-2/3" />
          <SkeletonBar className="h-3 w-1/3 bg-accent/18" />
        </div>
      </div>
      <div className="mt-6 space-y-3">
        <SkeletonBar className="h-3 w-5/6" />
        <SkeletonBar className="h-3 w-2/3" />
      </div>
    </div>
  );
}

export function AppBootScreen() {
  const { t } = useTranslation();

  return (
    <div className="relative h-full overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(var(--accent-rgb),0.18),transparent_34%),radial-gradient(circle_at_bottom_right,rgba(255,255,255,0.06),transparent_28%)]" />

      <div className="relative ui-scrollbar h-full overflow-y-auto px-8 py-10">
        <div className="mx-auto max-w-6xl">
          <div className="max-w-2xl">
            <UiLoadingBanner className="justify-start" panelClassName="shadow-none" />
            <h1 className="mt-5 text-3xl font-semibold tracking-tight text-text-dark">
              {t("app.bootTitle")}
            </h1>
            <p className="mt-3 text-sm leading-6 text-text-muted">
              {t("app.bootDescription")}
            </p>
          </div>

          <div className="mt-10 grid gap-5 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
            <section className="rounded-[28px] border border-border-dark/60 bg-surface-dark/82 p-6 shadow-[0_18px_60px_rgba(0,0,0,0.22)] backdrop-blur-sm">
              <div className="flex items-center justify-between gap-4">
                <div className="space-y-3">
                  <SkeletonBar className="h-4 w-28" />
                  <SkeletonBar className="h-3 w-56" />
                </div>
                <SkeletonBar className="h-9 w-28 rounded-2xl bg-accent/14" />
              </div>

              <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                <SkeletonCard />
                <SkeletonCard />
                <SkeletonCard />
              </div>
            </section>

            <section className="space-y-5">
              <div className="rounded-[28px] border border-border-dark/60 bg-surface-dark/82 p-6 shadow-[0_18px_60px_rgba(0,0,0,0.18)] backdrop-blur-sm">
                <SkeletonBar className="h-4 w-24" />
                <div className="mt-6 space-y-4">
                  <SkeletonBar className="h-12 w-full rounded-2xl" />
                  <SkeletonBar className="h-12 w-full rounded-2xl" />
                  <SkeletonBar className="h-12 w-full rounded-2xl" />
                </div>
              </div>

              <div className="rounded-[28px] border border-border-dark/60 bg-surface-dark/82 p-6 shadow-[0_18px_60px_rgba(0,0,0,0.18)] backdrop-blur-sm">
                <SkeletonBar className="h-4 w-20" />
                <div className="mt-6 space-y-3">
                  <SkeletonBar className="h-3 w-4/5" />
                  <SkeletonBar className="h-3 w-3/5" />
                  <SkeletonBar className="h-3 w-2/3" />
                </div>
              </div>
            </section>
          </div>
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
