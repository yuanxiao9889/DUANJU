import { useMemo, useState } from "react";
import {
  ListOrdered,
  LocateFixed,
  Send,
  Settings2,
  Trash2,
} from "lucide-react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { useReactFlow } from "@xyflow/react";

import { UiButton, UiLoadingAnimation, UiPanel } from "@/components/ui";
import { resolveImageDisplayUrl } from "@/features/canvas/application/imageData";
import {
  getCanvasNodeSize,
  resolveAbsoluteCanvasNodePosition,
} from "@/features/canvas/application/nodeGeometry";
import {
  JIMENG_VIDEO_QUEUE_MAX_ACTIVE_JOBS,
  canJimengVideoQueueJobBeRescheduled,
  isJimengVideoQueueActiveStatus,
  isJimengVideoQueueTerminalStatus,
  type JimengVideoQueueJob,
  type JimengVideoQueueJobStatus,
} from "@/features/jimeng/domain/jimengVideoQueue";
import { JIMENG_VIDEO_MODEL_OPTIONS } from "@/features/jimeng/domain/jimengOptions";
import { JimengVideoQueueScheduleModal } from "@/features/jimeng/ui/JimengVideoQueueScheduleModal";
import { useCanvasStore } from "@/stores/canvasStore";
import { useJimengVideoQueueStore } from "@/stores/jimengVideoQueueStore";

interface JimengVideoQueuePanelProps {
  isOpen: boolean;
  onClose: () => void;
}

function formatDateTime(
  timestamp: number | null | undefined,
  locale: string,
): string | null {
  if (!timestamp || !Number.isFinite(timestamp)) {
    return null;
  }

  return new Intl.DateTimeFormat(locale, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

function resolveStatusTone(status: JimengVideoQueueJobStatus): string {
  switch (status) {
    case "completed":
      return "border-emerald-400/28 bg-emerald-400/12 text-emerald-200";
    case "failed":
    case "cancelled":
      return "border-rose-400/28 bg-rose-400/12 text-rose-200";
    case "waiting":
    case "waitingConcurrency":
    case "retrying":
      return "border-amber-400/28 bg-amber-400/12 text-amber-200";
    default:
      return "border-accent/35 bg-accent/12 text-accent";
  }
}

function resolveModelLabel(
  modelVersion: string | null | undefined,
  t: TFunction,
): string {
  const option = JIMENG_VIDEO_MODEL_OPTIONS.find(
    (item) => item.value === modelVersion,
  );
  return option ? t(option.labelKey) : (modelVersion ?? "Seedance 2.0");
}

function resolveStatusLabel(
  status: JimengVideoQueueJobStatus,
  t: TFunction,
): string {
  switch (status) {
    case "waiting":
      return t("jimengQueue.status.waiting");
    case "waitingConcurrency":
      return t("jimengQueue.status.waitingConcurrency");
    case "submitting":
      return t("jimengQueue.status.submitting");
    case "submitted":
      return t("jimengQueue.status.submitted");
    case "generating":
      return t("jimengQueue.status.generating");
    case "retrying":
      return t("jimengQueue.status.retrying");
    case "completed":
      return t("jimengQueue.status.completed");
    case "failed":
      return t("jimengQueue.status.failed");
    case "cancelled":
      return t("jimengQueue.status.cancelled");
    default:
      return t("jimengQueue.status.waiting");
  }
}

function resolveJobStatusDescription(
  job: JimengVideoQueueJob,
  t: TFunction,
  locale: string,
): string {
  const scheduledLabel = formatDateTime(job.scheduledAt, locale);
  const retryLabel = formatDateTime(job.nextRetryAt, locale);
  const completedLabel = formatDateTime(job.completedAt, locale);

  switch (job.status) {
    case "waiting":
      return scheduledLabel
        ? t("jimengQueue.result.waitingUntil", { time: scheduledLabel })
        : t("jimengQueue.result.waiting");
    case "waitingConcurrency":
      return t("jimengQueue.result.waitingConcurrency");
    case "submitting":
      return t("jimengQueue.result.submitting");
    case "submitted":
      return t("jimengQueue.result.submitted");
    case "generating":
      return t("node.jimengVideoResult.statusGenerating");
    case "retrying":
      return retryLabel
        ? t("jimengQueue.panel.retryAt", {
            time: retryLabel,
            current: job.attemptCount,
            max: job.maxAttempts,
          })
        : job.lastError
          ? t("jimengQueue.result.retryingWithReason", {
              current: job.attemptCount,
              max: job.maxAttempts,
              reason: job.lastError,
            })
          : t("jimengQueue.result.retrying", {
              current: job.attemptCount,
              max: job.maxAttempts,
            });
    case "failed":
      return job.lastError
        ? t("jimengQueue.result.failedWithReason", {
            current: job.attemptCount,
            max: job.maxAttempts,
            reason: job.lastError,
          })
        : t("jimengQueue.result.failed", {
            current: job.attemptCount,
            max: job.maxAttempts,
          });
    case "cancelled":
      return t("jimengQueue.result.cancelled");
    case "completed":
      return completedLabel
        ? t("jimengQueue.panel.completedAt", { time: completedLabel })
        : t("jimengQueue.status.completed");
    default:
      return resolveStatusLabel(job.status, t);
  }
}

export function JimengVideoQueuePanel({
  isOpen,
  onClose,
}: JimengVideoQueuePanelProps) {
  const { t, i18n } = useTranslation();
  const reactFlow = useReactFlow();
  const jobs = useJimengVideoQueueStore((state) => state.jobs);
  const isHydrating = useJimengVideoQueueStore((state) => state.isHydrating);
  const updateJobSchedule = useJimengVideoQueueStore(
    (state) => state.updateJobSchedule,
  );
  const sendJobNow = useJimengVideoQueueStore((state) => state.sendJobNow);
  const cancelJob = useJimengVideoQueueStore((state) => state.cancelJob);
  const retryJob = useJimengVideoQueueStore((state) => state.retryJob);
  const removeJob = useJimengVideoQueueStore((state) => state.removeJob);
  const nodes = useCanvasStore((state) => state.nodes);
  const setSelectedNode = useCanvasStore((state) => state.setSelectedNode);
  const [scheduleJobId, setScheduleJobId] = useState<string | null>(null);

  const nodeMap = useMemo(
    () => new Map(nodes.map((node) => [node.id, node] as const)),
    [nodes],
  );
  const activeCount = useMemo(
    () => jobs.filter((job) => isJimengVideoQueueActiveStatus(job.status)).length,
    [jobs],
  );
  const queuedCount = useMemo(
    () =>
      jobs.filter(
        (job) =>
          job.status === "waiting" ||
          job.status === "waitingConcurrency" ||
          job.status === "retrying",
      ).length,
    [jobs],
  );
  const pendingCount = useMemo(
    () =>
      jobs.filter((job) => !isJimengVideoQueueTerminalStatus(job.status)).length,
    [jobs],
  );
  const failedCount = useMemo(
    () => jobs.filter((job) => job.status === "failed").length,
    [jobs],
  );
  const completedCount = useMemo(
    () => jobs.filter((job) => job.status === "completed").length,
    [jobs],
  );
  const scheduleJob = useMemo(
    () => jobs.find((job) => job.jobId === scheduleJobId) ?? null,
    [jobs, scheduleJobId],
  );

  const locateNode = (nodeId: string) => {
    const targetNode = nodeMap.get(nodeId);
    if (!targetNode) {
      return;
    }

    const absolutePosition = resolveAbsoluteCanvasNodePosition(
      targetNode,
      nodeMap,
    );
    const { width, height } = getCanvasNodeSize(targetNode);

    setSelectedNode(nodeId);
    reactFlow.setCenter(
      absolutePosition.x + width / 2,
      absolutePosition.y + height / 2,
      {
        zoom: Math.max(reactFlow.getZoom(), 0.82),
        duration: 240,
      },
    );
  };

  if (!isOpen) {
    return null;
  }

  return (
    <>
      <UiPanel className="absolute bottom-[72px] right-4 z-[10001] flex max-h-[72vh] w-[calc(100vw-32px)] max-w-[420px] flex-col overflow-hidden rounded-2xl border-white/10 bg-surface-dark/96 shadow-[0_24px_64px_rgba(0,0,0,0.38)]">
        <div className="flex items-start justify-between gap-3 border-b border-white/10 px-4 py-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-semibold text-text-dark">
              <ListOrdered className="h-4 w-4" />
              {t("jimengQueue.panel.title")}
            </div>
            <div className="mt-1 text-xs text-text-muted">
              {t("jimengQueue.panel.activeSummary", {
                active: activeCount,
                limit: JIMENG_VIDEO_QUEUE_MAX_ACTIVE_JOBS,
                pending: pendingCount,
              })}
            </div>
            {jobs.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-text-muted">
                <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-1">
                  {t("jimengQueue.panel.queuedCount", { count: queuedCount })}
                </span>
                <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-1">
                  {t("jimengQueue.panel.activeCount", { count: activeCount })}
                </span>
                <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-1">
                  {t("jimengQueue.panel.failedCount", { count: failedCount })}
                </span>
                <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-1">
                  {t("jimengQueue.panel.completedCount", {
                    count: completedCount,
                  })}
                </span>
              </div>
            ) : null}
          </div>
          <UiButton type="button" variant="ghost" size="sm" onClick={onClose}>
            {t("common.close")}
          </UiButton>
        </div>

        {isHydrating ? (
          <div className="flex min-h-[220px] items-center justify-center gap-2 px-6 text-center text-sm text-text-muted">
            <UiLoadingAnimation size="sm" />
            {t("jimengQueue.panel.loading")}
          </div>
        ) : jobs.length === 0 ? (
          <div className="flex min-h-[220px] items-center justify-center px-6 text-center text-sm text-text-muted">
            {t("jimengQueue.panel.empty")}
          </div>
        ) : (
          <div className="flex-1 space-y-3 overflow-y-auto px-3 py-3">
            {jobs.map((job) => {
              const resultNode = nodeMap.get(job.resultNodeId);
              const sourceNode = nodeMap.get(job.sourceNodeId);
              const resultData = (resultNode?.data ?? {}) as Record<string, unknown>;
              const rawPreviewUrl =
                (resultData.previewImageUrl as string | null | undefined) ?? "";
              const previewUrl = rawPreviewUrl
                ? resolveImageDisplayUrl(rawPreviewUrl)
                : null;
              const scheduledLabel = formatDateTime(
                job.scheduledAt,
                i18n.language,
              );
              const modelLabel = resolveModelLabel(
                job.payload.modelVersion,
                t,
              );
              const statusDescription = resolveJobStatusDescription(
                job,
                t,
                i18n.language,
              );
              const canReschedule = canJimengVideoQueueJobBeRescheduled(
                job.status,
              );
              const canLocateSource = Boolean(sourceNode);
              const canLocateResult = Boolean(resultNode);
              const showTransientError =
                Boolean(job.lastError) &&
                job.status !== "failed" &&
                job.status !== "retrying";

              return (
                <div
                  key={job.jobId}
                  className="rounded-2xl border border-white/10 bg-black/15 p-3"
                >
                  <div className="flex gap-3">
                    <div className="relative h-16 w-24 shrink-0 overflow-hidden rounded-xl border border-white/10 bg-[radial-gradient(circle_at_top,#1f2937_0%,#0f172a_78%)]">
                      {previewUrl ? (
                        <img
                          src={previewUrl}
                          alt={job.title}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center px-2 text-center text-[11px] text-text-muted">
                          {t("jimengQueue.panel.previewEmpty")}
                        </div>
                      )}
                      <span
                        className={`absolute bottom-1 right-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${resolveStatusTone(job.status)}`}
                      >
                        {resolveStatusLabel(job.status, t)}
                      </span>
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-text-dark">
                          {job.title}
                        </div>
                        <div className="mt-1 truncate text-[11px] text-text-muted">
                          {t("jimengQueue.panel.sourceNode", {
                            name:
                              (sourceNode?.data as
                                | { displayName?: string }
                                | undefined)?.displayName ??
                              sourceNode?.id ??
                              t("jimengQueue.panel.nodeMissing"),
                          })}
                        </div>
                      </div>

                      <div className="mt-2 flex flex-wrap gap-1.5 text-[10px] text-text-muted">
                        <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5">
                          {modelLabel}
                        </span>
                        <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5">
                          {job.payload.aspectRatio ?? "16:9"}
                        </span>
                        <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5">
                          {t("jimengQueue.panel.duration", {
                            seconds: job.payload.durationSeconds ?? 5,
                          })}
                        </span>
                        <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5">
                          {t("jimengQueue.panel.attemptCount", {
                            current: job.attemptCount,
                            max: job.maxAttempts,
                          })}
                        </span>
                        {scheduledLabel && !isJimengVideoQueueTerminalStatus(job.status) ? (
                          <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5">
                            {t("jimengQueue.panel.scheduledAt", {
                              time: scheduledLabel,
                            })}
                          </span>
                        ) : null}
                      </div>

                      <div className="mt-2 line-clamp-2 text-[11px] leading-5 text-text-muted">
                        {statusDescription}
                      </div>
                      {showTransientError ? (
                        <div className="mt-1 line-clamp-2 text-[11px] leading-5 text-rose-300">
                          {job.lastError}
                        </div>
                      ) : null}
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    {canReschedule ? (
                      <UiButton
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => setScheduleJobId(job.jobId)}
                      >
                        <Settings2 className="mr-1 h-3.5 w-3.5" />
                        {t("jimengQueue.actions.schedule")}
                      </UiButton>
                    ) : null}

                    {(job.status === "waiting" ||
                      job.status === "waitingConcurrency" ||
                      job.status === "retrying" ||
                      job.status === "failed") && (
                      <UiButton
                        type="button"
                        size="sm"
                        variant="muted"
                        onClick={() =>
                          job.status === "failed"
                            ? void retryJob(job.jobId)
                            : void sendJobNow(job.jobId)
                        }
                      >
                        <Send className="mr-1 h-3.5 w-3.5" />
                        {job.status === "failed"
                          ? t("jimengQueue.actions.retry")
                          : t("jimengQueue.actions.sendNow")}
                      </UiButton>
                    )}

                    {(job.status === "waiting" ||
                      job.status === "waitingConcurrency" ||
                      job.status === "retrying") && (
                      <UiButton
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => void cancelJob(job.jobId)}
                      >
                        {t("jimengQueue.actions.cancel")}
                      </UiButton>
                    )}

                    <UiButton
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={!canLocateSource}
                      onClick={() => locateNode(job.sourceNodeId)}
                    >
                      <LocateFixed className="mr-1 h-3.5 w-3.5" />
                      {t("jimengQueue.actions.locateSource")}
                    </UiButton>

                    <UiButton
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={!canLocateResult}
                      onClick={() => locateNode(job.resultNodeId)}
                    >
                      <LocateFixed className="mr-1 h-3.5 w-3.5" />
                      {t("jimengQueue.actions.locateResult")}
                    </UiButton>

                    {isJimengVideoQueueTerminalStatus(job.status) ? (
                      <UiButton
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => void removeJob(job.jobId)}
                      >
                        <Trash2 className="mr-1 h-3.5 w-3.5" />
                        {t("jimengQueue.actions.remove")}
                      </UiButton>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </UiPanel>

      <JimengVideoQueueScheduleModal
        isOpen={Boolean(scheduleJob)}
        title={t("jimengQueue.schedule.editTitle")}
        initialScheduledAt={scheduleJob?.scheduledAt ?? null}
        confirmLabel={t("common.save")}
        onClose={() => setScheduleJobId(null)}
        onConfirm={(scheduledAt) => {
          if (!scheduleJob) {
            return;
          }
          void updateJobSchedule(scheduleJob.jobId, scheduledAt);
          setScheduleJobId(null);
        }}
      />
    </>
  );
}
