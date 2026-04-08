import { memo, useCallback, useEffect, useMemo, useState } from "react";
import {
  Handle,
  Position,
  useUpdateNodeInternals,
  type NodeProps,
} from "@xyflow/react";
import { convertFileSrc, isTauri } from "@tauri-apps/api/core";
import { Clock3, Loader2, Sparkles, TriangleAlert, Video } from "lucide-react";
import { useTranslation } from "react-i18next";

import { UiButton, UiCheckbox, UiSelect } from "@/components/ui";
import {
  CANVAS_NODE_TYPES,
  JIMENG_VIDEO_RESULT_NODE_DEFAULT_WIDTH,
  JIMENG_VIDEO_RESULT_NODE_MIN_HEIGHT,
  JIMENG_VIDEO_RESULT_NODE_MIN_WIDTH,
  type JimengVideoResultNodeData,
} from "@/features/canvas/domain/canvasNodes";
import {
  resolveErrorContent,
  showErrorDialog,
} from "@/features/canvas/application/errorDialog";
import { resolveImageDisplayUrl } from "@/features/canvas/application/imageData";
import { flushCurrentProjectToDiskSafely } from "@/features/canvas/application/projectPersistence";
import { formatVideoTime } from "@/features/canvas/application/videoData";
import { resolveNodeDisplayName } from "@/features/canvas/domain/nodeDisplay";
import {
  NodeHeader,
  NODE_HEADER_FLOATING_POSITION_CLASS,
} from "@/features/canvas/ui/NodeHeader";
import { NodeResizeHandle } from "@/features/canvas/ui/NodeResizeHandle";
import { NodeStatusBadge } from "@/features/canvas/ui/NodeStatusBadge";
import { NODE_CONTROL_ACTION_BUTTON_CLASS } from "@/features/canvas/ui/nodeControlStyles";
import {
  NodeDescriptionPanel,
  NODE_DESCRIPTION_PANEL_EXPANDED_TOTAL_HEIGHT,
} from "@/features/canvas/ui/NodeDescriptionPanel";
import { resolveNodeStyleDimension } from "@/features/canvas/ui/nodeDimensionUtils";
import { queryJimengVideoResult } from "@/features/jimeng/application/jimengVideoSubmission";
import {
  type JimengVideoQueueJobStatus,
  isJimengVideoQueueTerminalStatus,
} from "@/features/jimeng/domain/jimengVideoQueue";
import {
  ensureDreaminaCliReady,
  resolveDreaminaSetupBlockedMessage,
} from "@/features/jimeng/application/dreaminaSetup";
import { useCanvasNodeById } from "@/features/canvas/hooks/useCanvasNodeGraph";
import { useCanvasStore } from "@/stores/canvasStore";

type JimengVideoResultNodeProps = NodeProps & {
  id: string;
  data: JimengVideoResultNodeData;
  selected?: boolean;
};

const AUTO_REQUERY_INTERVAL_OPTIONS = [900, 1800, 2700] as const;
const DEFAULT_AUTO_REQUERY_INTERVAL_SECONDS = 900;

type RequeryOptions = {
  suppressErrorDialog?: boolean;
  keepPollingOnFailure?: boolean;
  suppressStartFlush?: boolean;
};

function formatTimestamp(
  timestamp: number | null | undefined,
  locale: string,
): string | null {
  if (
    typeof timestamp !== "number" ||
    !Number.isFinite(timestamp) ||
    timestamp <= 0
  ) {
    return null;
  }

  return new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

function toCssAspectRatio(aspectRatio: string): string {
  const [rawWidth = "16", rawHeight = "9"] = aspectRatio.split(":");
  const width = Number(rawWidth);
  const height = Number(rawHeight);

  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return "16 / 9";
  }

  return `${width} / ${height}`;
}

function resolveAutoRequeryIntervalSeconds(
  value: number | null | undefined,
): number {
  if (
    typeof value === "number" &&
    Number.isFinite(value) &&
    AUTO_REQUERY_INTERVAL_OPTIONS.includes(
      value as (typeof AUTO_REQUERY_INTERVAL_OPTIONS)[number],
    )
  ) {
    return value;
  }

  return DEFAULT_AUTO_REQUERY_INTERVAL_SECONDS;
}

export const JimengVideoResultNode = memo(
  ({ id, data, selected, width }: JimengVideoResultNodeProps) => {
    const { t, i18n } = useTranslation();
    const updateNodeInternals = useUpdateNodeInternals();
    const currentNode = useCanvasNodeById(id);
    const setSelectedNode = useCanvasStore((state) => state.setSelectedNode);
    const updateNodeData = useCanvasStore((state) => state.updateNodeData);
    const isDescriptionPanelOpen = useCanvasStore(
      (state) => Boolean(state.nodeDescriptionPanelOpenById[id]),
    );
    const isReferenceSourceHighlighted = useCanvasStore(
      (state) => state.highlightedReferenceSourceNodeId === id,
    );
    const [playbackError, setPlaybackError] = useState<string | null>(null);
    const [isRequerying, setIsRequerying] = useState(false);
    const [statusNotice, setStatusNotice] = useState<string | null>(null);
    const autoRequeryEnabled = Boolean(data.autoRequeryEnabled);
    const autoRequeryIntervalSeconds = useMemo(
      () => resolveAutoRequeryIntervalSeconds(data.autoRequeryIntervalSeconds),
      [data.autoRequeryIntervalSeconds],
    );
    const normalizedSubmitId = useMemo(
      () => data.submitId?.trim() ?? "",
      [data.submitId],
    );

    const resolvedTitle = useMemo(
      () => resolveNodeDisplayName(CANVAS_NODE_TYPES.jimengVideoResult, data),
      [data],
    );
    const resolvedWidth = Math.max(
      JIMENG_VIDEO_RESULT_NODE_MIN_WIDTH,
      Math.round(width ?? JIMENG_VIDEO_RESULT_NODE_DEFAULT_WIDTH),
    );
    const explicitHeight = resolveNodeStyleDimension(currentNode?.style?.height);
    const hasExplicitHeight = typeof explicitHeight === "number";
    const descriptionPanelHeight = isDescriptionPanelOpen
      ? NODE_DESCRIPTION_PANEL_EXPANDED_TOTAL_HEIGHT
      : 0;
    const collapsedHeight = Math.max(
      explicitHeight ?? JIMENG_VIDEO_RESULT_NODE_MIN_HEIGHT,
      JIMENG_VIDEO_RESULT_NODE_MIN_HEIGHT,
    );
    const resolvedMinHeight = JIMENG_VIDEO_RESULT_NODE_MIN_HEIGHT + descriptionPanelHeight;
    const resolvedHeight = hasExplicitHeight
      ? collapsedHeight + descriptionPanelHeight
      : null;
    const resolvedAspectRatio = useMemo(
      () => toCssAspectRatio(data.aspectRatio ?? "16:9"),
      [data.aspectRatio],
    );
    const videoSource = useMemo(() => {
      const source = data.videoUrl?.trim() ?? "";
      if (!source) {
        return null;
      }
      if (
        source.startsWith("blob:") ||
        source.startsWith("data:") ||
        source.startsWith("asset:") ||
        source.startsWith("http://") ||
        source.startsWith("https://")
      ) {
        return source;
      }
      return isTauri() ? convertFileSrc(source) : source;
    }, [data.videoUrl]);
    const posterSource = useMemo(() => {
      const source = data.previewImageUrl?.trim() ?? "";
      return source ? resolveImageDisplayUrl(source) : null;
    }, [data.previewImageUrl]);
    const lastGeneratedTime = useMemo(
      () => formatTimestamp(data.lastGeneratedAt ?? null, i18n.language),
      [data.lastGeneratedAt, i18n.language],
    );
    const durationLabel = useMemo(() => {
      if (
        typeof data.duration !== "number" ||
        !Number.isFinite(data.duration) ||
        data.duration <= 0
      ) {
        return null;
      }
      return formatVideoTime(data.duration);
    }, [data.duration]);
    const resolutionLabel = useMemo(() => {
      if (!data.width || !data.height) {
        return null;
      }
      return `${data.width} x ${data.height}`;
    }, [data.height, data.width]);
    const queueStatus = (data.queueStatus ?? null) as
      | JimengVideoQueueJobStatus
      | null;
    const queueScheduledTime = useMemo(
      () => formatTimestamp(data.queueScheduledAt ?? null, i18n.language),
      [data.queueScheduledAt, i18n.language],
    );
    const queueAttemptCount =
      typeof data.queueAttemptCount === "number" &&
      Number.isFinite(data.queueAttemptCount)
        ? data.queueAttemptCount
        : 0;
    const queueMaxAttempts =
      typeof data.queueMaxAttempts === "number" &&
      Number.isFinite(data.queueMaxAttempts) &&
      data.queueMaxAttempts > 0
        ? data.queueMaxAttempts
        : 3;
    const canRequery =
      Boolean(normalizedSubmitId) &&
      queueStatus !== "waiting" &&
      queueStatus !== "waitingConcurrency" &&
      queueStatus !== "retrying" &&
      queueStatus !== "submitting";
    const hasPendingResult =
      Boolean(data.isGenerating) ||
      queueStatus === "submitted" ||
      queueStatus === "generating";
    const shouldAutoRequery =
      autoRequeryEnabled && canRequery && hasPendingResult;

    useEffect(() => {
      updateNodeInternals(id);
    }, [
      hasExplicitHeight,
      id,
      isDescriptionPanelOpen,
      resolvedHeight,
      resolvedWidth,
      updateNodeInternals,
      videoSource,
    ]);

    const handleRequeryResult = useCallback(async (options?: RequeryOptions) => {
      const submitId = normalizedSubmitId;
      const historyOptions = options?.suppressErrorDialog
        ? { historyMode: "skip" as const }
        : undefined;
      if (!submitId) {
        const message = t("node.jimengVideoResult.requeryUnavailable");
        setStatusNotice(message);
        if (options?.keepPollingOnFailure) {
          updateNodeData(
            id,
            {
              autoRequeryEnabled: false,
              isGenerating: false,
              generationStartedAt: null,
              lastError: message,
            },
            historyOptions,
          );
        }
        if (!options?.suppressErrorDialog) {
          await showErrorDialog(message, t("common.error"));
        }
        return;
      }

      const dreaminaStatus = await ensureDreaminaCliReady({
        feature: "video",
        action: "requery",
      });
      if (!dreaminaStatus.ready) {
        const message = resolveDreaminaSetupBlockedMessage(
          t,
          dreaminaStatus.code,
        );
        setStatusNotice(message);
        updateNodeData(
          id,
          {
            autoRequeryEnabled: options?.keepPollingOnFailure
              ? false
              : autoRequeryEnabled,
            isGenerating: options?.keepPollingOnFailure
              ? false
              : data.isGenerating,
            generationStartedAt: options?.keepPollingOnFailure
              ? null
              : data.generationStartedAt,
            lastError: message,
          },
          historyOptions,
        );
        return;
      }

      setStatusNotice(null);
      setIsRequerying(true);
      updateNodeData(
        id,
        {
          isGenerating: true,
          generationStartedAt: data.generationStartedAt ?? Date.now(),
          lastError: null,
        },
        historyOptions,
      );
      if (!options?.suppressStartFlush) {
        await flushCurrentProjectToDiskSafely("starting Jimeng video requery");
      }

      try {
        const response = await queryJimengVideoResult({ submitId });
        const primaryResult = response.videos[0] ?? null;
        const hasResult = primaryResult !== null;
        const completedAt = hasResult
          ? Date.now()
          : (data.lastGeneratedAt ?? null);
        const nextNoticeParts = [
          response.pending ? t("node.jimengVideoResult.requeryPending") : null,
          response.warnings.length > 0 ? response.warnings.join(" | ") : null,
        ].filter(Boolean);
        setStatusNotice(
          nextNoticeParts.length > 0 ? nextNoticeParts.join(" | ") : null,
        );

        updateNodeData(
          id,
          {
            submitId: response.submitId,
            sourceUrl: primaryResult?.sourceUrl ?? data.sourceUrl ?? null,
            posterSourceUrl:
              primaryResult?.posterSourceUrl ?? data.posterSourceUrl ?? null,
            videoUrl: primaryResult?.videoUrl ?? data.videoUrl ?? null,
            previewImageUrl:
              primaryResult?.previewImageUrl ?? data.previewImageUrl ?? null,
            videoFileName: primaryResult?.fileName ?? data.videoFileName ?? null,
            aspectRatio: primaryResult?.aspectRatio ?? data.aspectRatio,
            duration: primaryResult?.duration ?? data.duration,
            width: primaryResult?.width ?? data.width,
            height: primaryResult?.height ?? data.height,
            isGenerating: response.pending,
            generationStartedAt: response.pending
              ? (data.generationStartedAt ?? Date.now())
              : null,
            lastGeneratedAt: completedAt,
            lastError: null,
          },
          historyOptions,
        );
        await flushCurrentProjectToDiskSafely(
          "saving Jimeng video requery result",
        );
      } catch (error) {
        const content = resolveErrorContent(
          error,
          t("node.jimengVideoResult.requeryFailed"),
        );
        setStatusNotice(content.message);
        updateNodeData(
          id,
          {
            isGenerating: Boolean(options?.keepPollingOnFailure),
            generationStartedAt: options?.keepPollingOnFailure
              ? (data.generationStartedAt ?? Date.now())
              : null,
            lastError: content.message,
          },
          historyOptions,
        );
        if (!options?.keepPollingOnFailure) {
          await flushCurrentProjectToDiskSafely(
            "saving Jimeng video requery error",
          );
        }
        if (!options?.suppressErrorDialog) {
          await showErrorDialog(
            content.message,
            t("common.error"),
            content.details,
          );
        }
      } finally {
        setIsRequerying(false);
      }
    }, [
      autoRequeryEnabled,
      data.aspectRatio,
      data.duration,
      data.generationStartedAt,
      data.height,
      data.isGenerating,
      data.lastGeneratedAt,
      data.posterSourceUrl,
      data.previewImageUrl,
      data.sourceUrl,
      data.videoFileName,
      data.videoUrl,
      data.width,
      flushCurrentProjectToDiskSafely,
      id,
      normalizedSubmitId,
      t,
      updateNodeData,
    ]);

    useEffect(() => {
      if (!shouldAutoRequery || isRequerying) {
        return;
      }

      const timer = window.setTimeout(() => {
        void handleRequeryResult({
          suppressErrorDialog: true,
          keepPollingOnFailure: true,
          suppressStartFlush: true,
        });
      }, autoRequeryIntervalSeconds * 1000);

      return () => {
        window.clearTimeout(timer);
      };
    }, [
      autoRequeryIntervalSeconds,
      handleRequeryResult,
      isRequerying,
      shouldAutoRequery,
    ]);

    const handleAutoRequeryToggle = useCallback(
      (enabled: boolean) => {
        updateNodeData(id, {
          autoRequeryEnabled: enabled,
          autoRequeryIntervalSeconds,
          ...(enabled && canRequery && !videoSource
            ? {
                isGenerating: true,
                generationStartedAt: data.generationStartedAt ?? Date.now(),
                lastError: null,
              }
            : {}),
        });
      },
      [
        autoRequeryIntervalSeconds,
        canRequery,
        data.generationStartedAt,
        id,
        updateNodeData,
        videoSource,
      ],
    );

    const handleAutoRequeryIntervalChange = useCallback(
      (value: string) => {
        updateNodeData(id, {
          autoRequeryIntervalSeconds: resolveAutoRequeryIntervalSeconds(
            Number(value),
          ),
        });
      },
      [id, updateNodeData],
    );

    const combinedError = playbackError ?? data.lastError ?? null;
    const headerStatus = useMemo(() => {
      if (
        queueStatus === "waiting" ||
        queueStatus === "waitingConcurrency" ||
        queueStatus === "retrying"
      ) {
        return (
          <NodeStatusBadge
            icon={<Clock3 className="h-3 w-3" />}
            label={t(`jimengQueue.status.${queueStatus}`)}
            tone="warning"
          />
        );
      }

      if (
        queueStatus === "submitting" ||
        queueStatus === "submitted" ||
        queueStatus === "generating" ||
        data.isGenerating
      ) {
        return (
          <NodeStatusBadge
            icon={<Loader2 className="h-3 w-3" />}
            label={
              queueStatus
                ? t(`jimengQueue.status.${queueStatus}`)
                : t("node.jimengVideoResult.generating")
            }
            tone="processing"
            animate
          />
        );
      }

      if (queueStatus === "failed" || queueStatus === "cancelled") {
        return (
          <NodeStatusBadge
            icon={<TriangleAlert className="h-3 w-3" />}
            label={t(`jimengQueue.status.${queueStatus}`)}
            tone="danger"
            title={combinedError ?? undefined}
          />
        );
      }

      if (combinedError) {
        return (
          <NodeStatusBadge
            icon={<TriangleAlert className="h-3 w-3" />}
            label={t("nodeStatus.error")}
            tone="danger"
            title={combinedError}
          />
        );
      }

      if (videoSource) {
        return (
          <NodeStatusBadge
            icon={<Sparkles className="h-3 w-3" />}
            label={t("node.jimengVideoResult.ready")}
            tone="warning"
          />
        );
      }

      return null;
    }, [combinedError, data.isGenerating, queueStatus, t, videoSource]);

    const statusInfoText = useMemo(() => {
      if (queueStatus === "waiting") {
        return queueScheduledTime
          ? t("jimengQueue.result.waitingUntil", {
              time: queueScheduledTime,
            })
          : t("jimengQueue.result.waiting");
      }

      if (queueStatus === "waitingConcurrency") {
        return t("jimengQueue.result.waitingConcurrency");
      }

      if (queueStatus === "retrying") {
        return combinedError
          ? t("jimengQueue.result.retryingWithReason", {
              current: queueAttemptCount,
              max: queueMaxAttempts,
              reason: combinedError,
            })
          : t("jimengQueue.result.retrying", {
              current: queueAttemptCount,
              max: queueMaxAttempts,
            });
      }

      if (queueStatus === "submitting") {
        return t("jimengQueue.result.submitting");
      }

      if (queueStatus === "submitted") {
        return t("jimengQueue.result.submitted");
      }

      if (queueStatus === "generating" || data.isGenerating) {
        return t("node.jimengVideoResult.statusGenerating");
      }

      if (queueStatus === "failed") {
        return combinedError
          ? t("jimengQueue.result.failedWithReason", {
              current: queueAttemptCount,
              max: queueMaxAttempts,
              reason: combinedError,
            })
          : t("jimengQueue.result.failed", {
              current: queueAttemptCount,
              max: queueMaxAttempts,
            });
      }

      if (queueStatus === "cancelled") {
        return t("jimengQueue.result.cancelled");
      }

      return (
        combinedError ??
        statusNotice ??
        (lastGeneratedTime
          ? t("node.jimengVideoResult.generatedAt", {
              time: lastGeneratedTime,
            })
          : t("node.jimengVideoResult.empty"))
      );
    }, [
      combinedError,
      data.isGenerating,
      lastGeneratedTime,
      queueAttemptCount,
      queueMaxAttempts,
      queueScheduledTime,
      queueStatus,
      statusNotice,
      t,
    ]);
    const placeholderText = useMemo(() => {
      if (queueStatus) {
        return t(`jimengQueue.status.${queueStatus}`);
      }

      return data.isGenerating
        ? t("node.jimengVideoResult.pending")
        : t("node.jimengVideoResult.empty");
    }, [data.isGenerating, queueStatus, t]);
    const nodeDescription =
      typeof data.nodeDescription === "string" ? data.nodeDescription : "";

    return (
      <div
        className={`
        group relative flex flex-col overflow-visible rounded-[var(--node-radius)] border bg-surface-dark/90 p-2 transition-colors duration-150
        ${hasExplicitHeight ? "h-full" : ""}
        ${
          selected
            ? "border-accent shadow-[0_0_0_1px_rgba(59,130,246,0.32)]"
            : isReferenceSourceHighlighted
              ? "border-accent/80 shadow-[0_0_0_2px_rgba(59,130,246,0.24),0_4px_18px_rgba(59,130,246,0.1)]"
            : "border-[rgba(15,23,42,0.22)] hover:border-[rgba(15,23,42,0.34)] dark:border-[rgba(255,255,255,0.22)] dark:hover:border-[rgba(255,255,255,0.34)]"
        }
      `}
        style={{
          width: `${resolvedWidth}px`,
          ...(resolvedHeight ? { height: `${resolvedHeight}px` } : {}),
        }}
        onClick={() => setSelectedNode(id)}
      >
        <NodeHeader
          className={NODE_HEADER_FLOATING_POSITION_CLASS}
          icon={<Video className="h-3.5 w-3.5" />}
          titleText={resolvedTitle}
          rightSlot={headerStatus ?? undefined}
          editable
          onTitleChange={(nextTitle) =>
            updateNodeData(id, { displayName: nextTitle })
          }
        />

        <div className="flex min-h-0 flex-1 flex-col pt-5">
          <div className="relative overflow-hidden rounded-xl border border-white/10 bg-black/30">
            <div
              className="overflow-hidden bg-black"
              style={{ aspectRatio: resolvedAspectRatio }}
            >
              {videoSource ? (
                <video
                  src={videoSource}
                  controls
                  preload="metadata"
                  playsInline
                  poster={posterSource ?? undefined}
                  className="h-full w-full bg-black object-contain"
                  onLoadedData={() => setPlaybackError(null)}
                  onError={() =>
                    setPlaybackError(t("node.videoNode.loadFailed"))
                  }
                  onMouseDown={(event) => event.stopPropagation()}
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-[radial-gradient(circle_at_top,#1f2937_0%,#0f172a_72%)] text-sm text-text-muted">
                  {placeholderText}
                </div>
              )}
            </div>
          </div>

          <div className="mt-2 flex flex-wrap gap-1.5 text-[10px] leading-4 text-text-muted">
            {queueStatus ? (
              <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5">
                {t("jimengQueue.result.attemptCount", {
                  current: queueAttemptCount,
                  max: queueMaxAttempts,
                })}
              </span>
            ) : null}
            {queueScheduledTime &&
            queueStatus &&
            !isJimengVideoQueueTerminalStatus(queueStatus) ? (
              <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5">
                {t("jimengQueue.result.scheduledAt", {
                  time: queueScheduledTime,
                })}
              </span>
            ) : null}
            {durationLabel ? (
              <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5">
                {t("node.jimengVideoResult.duration", {
                  duration: durationLabel,
                })}
              </span>
            ) : null}
            {resolutionLabel ? (
              <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5">
                {resolutionLabel}
              </span>
            ) : null}
            <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5">
              {data.aspectRatio ?? "16:9"}
            </span>
          </div>
        </div>

        <div className="mt-2 flex min-h-[28px] items-center justify-between gap-2">
          <div
            className={`min-w-0 flex-1 truncate text-[10px] leading-4 ${
              combinedError ? "text-rose-300" : "text-text-muted"
            }`}
            title={statusInfoText}
          >
            {statusInfoText}
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            <div
              className="flex items-center gap-1.5 text-[10px] text-text-muted"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => event.stopPropagation()}
            >
              <UiCheckbox
                checked={autoRequeryEnabled}
                className="h-4 w-4 rounded-[5px]"
                aria-label={t("node.jimengVideoResult.autoRequery")}
                onClick={(event) => event.stopPropagation()}
                onCheckedChange={(checked) =>
                  handleAutoRequeryToggle(Boolean(checked))
                }
              />
              <span
                className="cursor-pointer whitespace-nowrap"
                onClick={(event) => {
                  event.stopPropagation();
                  handleAutoRequeryToggle(!autoRequeryEnabled);
                }}
              >
                {t("node.jimengVideoResult.autoRequery")}
              </span>
            </div>

            <div
              className="w-[66px] shrink-0"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => event.stopPropagation()}
            >
              <UiSelect
                value={String(autoRequeryIntervalSeconds)}
                disabled={!autoRequeryEnabled}
                className="w-full"
                aria-label={t("node.jimengVideoResult.autoRequeryInterval")}
                onChange={(event) =>
                  handleAutoRequeryIntervalChange(event.target.value)
                }
              >
                {AUTO_REQUERY_INTERVAL_OPTIONS.map((seconds) => (
                  <option key={seconds} value={seconds}>
                    {t("node.jimengVideoResult.autoRequeryIntervalOption", {
                      minutes: Math.round(seconds / 60),
                    })}
                  </option>
                ))}
              </UiSelect>
            </div>

            <UiButton
              type="button"
              size="sm"
              variant="muted"
              disabled={isRequerying || !canRequery}
              className={`${NODE_CONTROL_ACTION_BUTTON_CLASS} shrink-0`}
              onClick={(event) => {
                event.stopPropagation();
                void handleRequeryResult();
              }}
            >
              {isRequerying ? (
                <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.3} />
              ) : null}
              {t("node.jimengVideoResult.requery")}
            </UiButton>
          </div>
        </div>

        <NodeDescriptionPanel
          isOpen={isDescriptionPanelOpen}
          value={nodeDescription}
          placeholder={t("nodeToolbar.descriptionPlaceholder")}
          onChange={(value) => updateNodeData(id, { nodeDescription: value })}
        />

        <Handle
          type="target"
          id="target"
          position={Position.Left}
          className="!h-2.5 !w-2.5 !border-2 !border-surface-dark !bg-accent"
        />
        <Handle
          type="source"
          id="source"
          position={Position.Right}
          className="!h-2.5 !w-2.5 !border-2 !border-surface-dark !bg-accent"
        />
        <NodeResizeHandle
          minWidth={JIMENG_VIDEO_RESULT_NODE_MIN_WIDTH}
          minHeight={resolvedMinHeight}
        />
      </div>
    );
  },
);

JimengVideoResultNode.displayName = "JimengVideoResultNode";
