import { memo, useCallback, useEffect, useMemo, useState } from "react";
import {
  Handle,
  Position,
  useUpdateNodeInternals,
  type NodeProps,
} from "@xyflow/react";
import {
  Camera,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Loader2,
  Pause,
  Play,
  Sparkles,
  TriangleAlert,
  Video,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import { UiButton, UiCheckbox, UiLoadingAnimation, UiSelect } from "@/components/ui";
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
import {
  formatVideoTime,
  resolveVideoDisplayUrl,
} from "@/features/canvas/application/videoData";
import { resolveNodeDisplayName } from "@/features/canvas/domain/nodeDisplay";
import { useNodeVideoPlaybackControls } from "@/features/canvas/hooks/useNodeVideoPlaybackControls";
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
    const { t } = useTranslation();
    const updateNodeInternals = useUpdateNodeInternals();
    const currentNode = useCanvasNodeById(id);
    const setSelectedNode = useCanvasStore((state) => state.setSelectedNode);
    const updateNodeData = useCanvasStore((state) => state.updateNodeData);
    const addNode = useCanvasStore((state) => state.addNode);
    const addEdge = useCanvasStore((state) => state.addEdge);
    const isDescriptionPanelOpen = useCanvasStore(
      (state) => Boolean(state.nodeDescriptionPanelOpenById[id]),
    );
    const isReferenceSourceHighlighted = useCanvasStore(
      (state) => state.highlightedReferenceSourceNodeId === id,
    );
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
      return resolveVideoDisplayUrl(source);
    }, [data.videoUrl]);
    const posterSource = useMemo(() => {
      const source = data.previewImageUrl?.trim() ?? "";
      return source ? resolveImageDisplayUrl(source) : null;
    }, [data.previewImageUrl]);
    const queueStatus = (data.queueStatus ?? null) as
      | JimengVideoQueueJobStatus
      | null;
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
      resolvedAspectRatio,
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
        if (response.status === "failed") {
          const message =
            response.failureMessage?.trim() ||
            response.warnings.find((warning) => warning.trim().length > 0) ||
            t("node.jimengVideoResult.requeryFailed");
          setStatusNotice(message);
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
          await flushCurrentProjectToDiskSafely(
            "saving Jimeng video requery failure",
          );
          if (!options?.suppressErrorDialog) {
            await showErrorDialog(message, t("common.error"));
          }
          return;
        }

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

    const placeholderText = useMemo(() => {
      if (queueStatus) {
        return t(`jimengQueue.status.${queueStatus}`);
      }

      return data.isGenerating
        ? t("node.jimengVideoResult.pending")
        : t("node.jimengVideoResult.empty");
    }, [data.isGenerating, queueStatus, t]);
    const queueStatusMessage = useMemo(() => {
      if (queueStatus === "waiting") {
        return t("jimengQueue.result.waiting");
      }

      if (queueStatus === "waitingConcurrency") {
        return t("jimengQueue.result.waitingConcurrency");
      }

      if (queueStatus === "retrying") {
        const current =
          typeof data.queueAttemptCount === "number" &&
          Number.isFinite(data.queueAttemptCount)
            ? data.queueAttemptCount
            : 0;
        const max =
          typeof data.queueMaxAttempts === "number" &&
          Number.isFinite(data.queueMaxAttempts) &&
          data.queueMaxAttempts > 0
            ? data.queueMaxAttempts
            : 3;
        return t("jimengQueue.result.retrying", {
          current,
          max,
        });
      }

      if (queueStatus === "submitting") {
        return t("jimengQueue.result.submitting");
      }

      if (queueStatus === "submitted") {
        return t("jimengQueue.result.submitted");
      }

      if (queueStatus === "failed") {
        return t("jimengQueue.result.failed", {
          current:
            typeof data.queueAttemptCount === "number" &&
            Number.isFinite(data.queueAttemptCount)
              ? data.queueAttemptCount
              : 0,
          max:
            typeof data.queueMaxAttempts === "number" &&
            Number.isFinite(data.queueMaxAttempts) &&
            data.queueMaxAttempts > 0
              ? data.queueMaxAttempts
              : 3,
        });
      }

      if (queueStatus === "cancelled") {
        return t("jimengQueue.result.cancelled");
      }

      return statusNotice;
    }, [
      data.queueAttemptCount,
      data.queueMaxAttempts,
      queueStatus,
      statusNotice,
      t,
    ]);
    const resolutionText = useMemo(() => {
      if (
        typeof data.width === "number" &&
        Number.isFinite(data.width) &&
        data.width > 0 &&
        typeof data.height === "number" &&
        Number.isFinite(data.height) &&
        data.height > 0
      ) {
        return `${Math.round(data.width)} × ${Math.round(data.height)}`;
      }

      return null;
    }, [data.height, data.width]);
    const nodeDescription =
      typeof data.nodeDescription === "string" ? data.nodeDescription : "";
    const showBlockingOverlay = Boolean(data.isGenerating || isRequerying);
    const {
      videoRef,
      isPlaying,
      currentTime,
      duration,
      flashFrame,
      isCapturingScreenshot,
      screenshotStatus,
      videoError,
      isVideoReady,
      screenshotButtonDisabled,
      togglePlay,
      seekToPrevFrame,
      seekToNextFrame,
      handleVideoPlay,
      handleVideoPause,
      handleTimeUpdate,
      handleLoadedMetadata,
      handleLoadedData,
      handleCanPlay,
      handleVideoError,
      handleRetryLoad,
      handleScreenshot,
    } = useNodeVideoPlaybackControls({
      nodeId: id,
      videoUrl: data.videoUrl,
      videoSource,
      videoFileName: data.videoFileName,
      fallbackTitle: resolvedTitle,
      nodePosition: currentNode?.position ?? null,
      nodeWidth: resolvedWidth,
      initialDuration: data.duration,
      t,
      addNode,
      addEdge,
      onDurationChange: (nextDuration) => {
        if (Math.abs((data.duration ?? 0) - nextDuration) > 0.01) {
          updateNodeData(id, { duration: nextDuration });
        }
      },
    });
    const combinedError = videoError ?? data.lastError ?? null;
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
          <span
            title={
              queueStatus
                ? t(`jimengQueue.status.${queueStatus}`)
                : t("node.jimengVideoResult.generating")
            }
            className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-accent/30 bg-accent/12 shadow-[0_8px_16px_rgba(var(--accent-rgb),0.12)]"
          >
            <UiLoadingAnimation
              width={18}
              height={18}
              fit="cover"
              className="overflow-hidden rounded-full"
            />
          </span>
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

        <div className={`flex flex-col pt-5 ${hasExplicitHeight ? "min-h-0 flex-1" : ""}`}>
          <div
            className={`flex flex-col overflow-hidden rounded-[var(--node-radius)] bg-[linear-gradient(165deg,rgba(255,255,255,0.05),rgba(255,255,255,0.015))] ${hasExplicitHeight ? "min-h-0 flex-1" : ""}`}
          >
            <div
              className={`relative overflow-hidden bg-black ${flashFrame ? "animate-pulse bg-white/20" : ""} ${hasExplicitHeight ? "min-h-0 flex-1" : ""}`}
              style={hasExplicitHeight ? undefined : { aspectRatio: resolvedAspectRatio }}
            >
              {posterSource && (!isVideoReady || Boolean(videoError)) ? (
                <img
                  src={posterSource}
                  alt={t("node.videoNode.posterAlt")}
                  className="absolute inset-0 h-full w-full object-cover"
                />
              ) : null}
              <div
                className="absolute inset-0"
                onClick={(event) => event.stopPropagation()}
                onPointerDown={(event) => event.stopPropagation()}
              >
                {videoSource ? (
                  <video
                    ref={videoRef}
                    src={videoSource}
                    controls
                    preload="metadata"
                    playsInline
                    poster={posterSource ?? undefined}
                    className={`h-full w-full bg-black object-contain transition-opacity duration-150 ${
                      videoError ? "opacity-35" : "opacity-100"
                    }`}
                    onPlay={handleVideoPlay}
                    onPause={handleVideoPause}
                    onTimeUpdate={handleTimeUpdate}
                    onSeeked={handleTimeUpdate}
                    onLoadedMetadata={handleLoadedMetadata}
                    onLoadedData={handleLoadedData}
                    onCanPlay={handleCanPlay}
                    onError={handleVideoError}
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center bg-[radial-gradient(circle_at_top,#1f2937_0%,#0f172a_72%)] text-sm text-text-muted">
                    {showBlockingOverlay ? null : placeholderText}
                  </div>
                )}
              </div>
              {showBlockingOverlay ? (
                <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-black/12">
                  <div className="overflow-hidden rounded-[22px]">
                    <UiLoadingAnimation
                      className="drop-shadow-[0_16px_36px_rgba(0,0,0,0.32)]"
                      width="min(220px, calc(100% - 2rem))"
                      height="96px"
                      fit="cover"
                    />
                  </div>
                  <span className="sr-only">{t("common.loading")}</span>
                </div>
              ) : null}
              {videoError ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[rgba(15,23,42,0.56)] px-5 text-center">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full border border-red-400/25 bg-red-500/12 text-red-200">
                    <TriangleAlert className="h-5 w-5" />
                  </div>
                  <div className="space-y-1">
                    <div className="text-sm font-medium text-text-dark">
                      {t("node.videoNode.loadFailed")}
                    </div>
                    <div className="text-xs leading-5 text-text-muted">{videoError}</div>
                  </div>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      handleRetryLoad();
                    }}
                    className="inline-flex items-center gap-2 rounded-full border border-border-dark/70 bg-bg-dark/92 px-3 py-2 text-xs font-medium text-text-dark transition-colors hover:border-accent/40 hover:bg-bg-dark"
                  >
                    <Loader2 className="h-3.5 w-3.5" />
                    {t("node.videoNode.retryLoad")}
                  </button>
                </div>
              ) : null}
            </div>

            <div
              className="border-t border-[rgba(255,255,255,0.08)] bg-[linear-gradient(180deg,rgba(8,10,16,0.88),rgba(8,10,16,0.96))] px-3 py-2"
              onClick={(event) => event.stopPropagation()}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => seekToPrevFrame()}
                  disabled={isPlaying || !isVideoReady}
                  className={`inline-flex h-8 w-8 items-center justify-center rounded-full border transition-colors ${
                    isPlaying || !isVideoReady
                      ? "cursor-not-allowed border-white/[0.06] bg-white/[0.02] text-text-muted/40"
                      : "border-white/[0.08] bg-white/[0.05] text-text-dark hover:border-accent/35 hover:bg-accent/10 hover:text-accent"
                  }`}
                  title={t("node.videoNode.prevFrame")}
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => togglePlay()}
                  disabled={!isVideoReady}
                  className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border transition-colors ${
                    !isVideoReady
                      ? "cursor-not-allowed border-white/[0.06] bg-white/[0.02] text-text-muted/40"
                      : "border-white/[0.1] bg-white/[0.06] text-text-dark hover:border-accent/40 hover:bg-accent/12 hover:text-accent"
                  }`}
                  title={isPlaying ? t("node.videoNode.pause") : t("node.videoNode.play")}
                >
                  {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                </button>
                <button
                  type="button"
                  onClick={() => seekToNextFrame()}
                  disabled={isPlaying || !isVideoReady}
                  className={`inline-flex h-8 w-8 items-center justify-center rounded-full border transition-colors ${
                    isPlaying || !isVideoReady
                      ? "cursor-not-allowed border-white/[0.06] bg-white/[0.02] text-text-muted/40"
                      : "border-white/[0.08] bg-white/[0.05] text-text-dark hover:border-accent/35 hover:bg-accent/10 hover:text-accent"
                  }`}
                  title={t("node.videoNode.nextFrame")}
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
                <div className="min-w-0 flex-1 px-1">
                  <div className="truncate text-[11px] text-text-muted">
                    {formatVideoTime(currentTime)} / {formatVideoTime(duration)}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void handleScreenshot()}
                  disabled={screenshotButtonDisabled || showBlockingOverlay}
                  title={!isVideoReady ? t("node.videoNode.screenshotNotReady") : t("node.videoNode.screenshot")}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                    screenshotButtonDisabled || showBlockingOverlay
                      ? "cursor-not-allowed border-accent/10 bg-accent/8 text-accent/45"
                      : "border-accent/18 bg-accent/14 text-accent hover:border-accent/30 hover:bg-accent/20"
                  }`}
                >
                  {isCapturingScreenshot ? (
                    <UiLoadingAnimation size="xs" />
                  ) : (
                    <Camera className="h-3.5 w-3.5" />
                  )}
                  {isCapturingScreenshot ? t("node.videoNode.screenshotPending") : t("node.videoNode.screenshot")}
                </button>
              </div>

              {screenshotStatus ? (
                <div
                  className={`mt-2 truncate rounded-full px-2.5 py-1 text-[11px] ${
                    screenshotStatus.tone === "success"
                      ? "bg-emerald-500/12 text-emerald-200"
                      : screenshotStatus.tone === "danger"
                        ? "bg-red-500/12 text-red-200"
                        : "bg-white/8 text-text-muted"
                  }`}
                  title={screenshotStatus.message}
                >
                  {screenshotStatus.message}
                </div>
              ) : combinedError || queueStatusMessage ? (
                <div
                  className={`mt-2 truncate rounded-full px-2.5 py-1 text-[11px] ${
                    combinedError
                      ? "bg-red-500/12 text-red-200"
                      : "bg-white/8 text-text-muted"
                  }`}
                  title={combinedError ?? queueStatusMessage ?? undefined}
                >
                  {combinedError ?? queueStatusMessage}
                </div>
              ) : null}
            </div>
          </div>
        </div>

        <div className="mt-2 flex min-h-[28px] items-center justify-between gap-2">
          <div className="min-w-0 flex-1">
            {resolutionText ? (
              <div
                className="inline-flex max-w-full items-center rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[10px] leading-4 text-text-muted"
                title={resolutionText}
              >
                <span className="truncate">{resolutionText}</span>
              </div>
            ) : null}
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
