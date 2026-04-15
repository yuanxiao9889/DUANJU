import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  Loader2,
  Pause,
  Play,
  Sparkles,
  TriangleAlert,
  Video,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import { UiButton, UiLoadingAnimation } from "@/components/ui";
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
import {
  CANVAS_NODE_TYPES,
  SEEDANCE_VIDEO_RESULT_NODE_DEFAULT_WIDTH,
  SEEDANCE_VIDEO_RESULT_NODE_MIN_HEIGHT,
  SEEDANCE_VIDEO_RESULT_NODE_MIN_WIDTH,
  type SeedanceVideoResultNodeData,
} from "@/features/canvas/domain/canvasNodes";
import { resolveNodeDisplayName } from "@/features/canvas/domain/nodeDisplay";
import { useNodeVideoPlaybackControls } from "@/features/canvas/hooks/useNodeVideoPlaybackControls";
import { useCanvasNodeById } from "@/features/canvas/hooks/useCanvasNodeGraph";
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
import {
  SEEDANCE_RESULT_POLL_INTERVAL_MS,
  querySeedanceVideoResult,
} from "@/features/seedance/application/seedanceVideoSubmission";
import { useCanvasStore } from "@/stores/canvasStore";
import { useSettingsStore } from "@/stores/settingsStore";

type SeedanceVideoResultNodeProps = NodeProps & {
  id: string;
  data: SeedanceVideoResultNodeData;
  selected?: boolean;
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

function normalizeSeedanceTaskStatus(
  status: string | null | undefined,
): "queued" | "running" | "succeeded" | "failed" | "cancelled" | "expired" | "unknown" {
  const normalized = status?.trim().toLowerCase() ?? "";

  switch (normalized) {
    case "queued":
    case "running":
    case "succeeded":
    case "failed":
    case "cancelled":
    case "expired":
      return normalized;
    default:
      return "unknown";
  }
}

export const SeedanceVideoResultNode = memo(
  ({ id, data, selected, width }: SeedanceVideoResultNodeProps) => {
    const { t } = useTranslation();
    const updateNodeInternals = useUpdateNodeInternals();
    const currentNode = useCanvasNodeById(id);
    const storyboardApiKeys = useSettingsStore((state) => state.storyboardApiKeys);
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
    const pollTimerRef = useRef<number | null>(null);
    const isPollingRef = useRef(false);

    const apiKey = storyboardApiKeys.volcengine?.trim() ?? "";
    const resolvedTitle = useMemo(
      () =>
        resolveNodeDisplayName(CANVAS_NODE_TYPES.seedanceVideoResult, data),
      [data],
    );
    const resolvedWidth = Math.max(
      SEEDANCE_VIDEO_RESULT_NODE_MIN_WIDTH,
      Math.round(width ?? SEEDANCE_VIDEO_RESULT_NODE_DEFAULT_WIDTH),
    );
    const explicitHeight = resolveNodeStyleDimension(currentNode?.style?.height);
    const hasExplicitHeight = typeof explicitHeight === "number";
    const descriptionPanelHeight = isDescriptionPanelOpen
      ? NODE_DESCRIPTION_PANEL_EXPANDED_TOTAL_HEIGHT
      : 0;
    const collapsedHeight = Math.max(
      explicitHeight ?? SEEDANCE_VIDEO_RESULT_NODE_MIN_HEIGHT,
      SEEDANCE_VIDEO_RESULT_NODE_MIN_HEIGHT,
    );
    const resolvedMinHeight = SEEDANCE_VIDEO_RESULT_NODE_MIN_HEIGHT + descriptionPanelHeight;
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
    const normalizedTaskStatus = useMemo(
      () => normalizeSeedanceTaskStatus(data.taskStatus),
      [data.taskStatus],
    );
    const taskStatusLabel = useMemo(
      () => t(`node.seedanceVideoResult.taskStatuses.${normalizedTaskStatus}`),
      [normalizedTaskStatus, t],
    );
    const taskStatusNotice = useMemo(() => {
      if (normalizedTaskStatus === "queued") {
        return t("node.seedanceVideoResult.statusQueued");
      }

      if (normalizedTaskStatus === "running") {
        return t("node.seedanceVideoResult.statusRunning");
      }

      return null;
    }, [normalizedTaskStatus, t]);

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

    const clearScheduledPoll = useCallback(() => {
      if (pollTimerRef.current !== null) {
        window.clearTimeout(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    }, []);

    const handleRequeryResult = useCallback(
      async (options?: {
        suppressErrorDialog?: boolean;
        scheduleNextPoll?: boolean;
      }) => {
        const taskId = data.taskId?.trim() ?? "";
        if (!taskId) {
          const message = t("node.seedanceVideoResult.requeryUnavailable");
          setStatusNotice(message);
          if (!options?.suppressErrorDialog) {
            await showErrorDialog(message, t("common.error"));
          }
          return;
        }

        if (!apiKey) {
          const message = t("node.seedance.apiKeyRequired");
          setStatusNotice(message);
          updateNodeData(id, { lastError: message });
          if (!options?.suppressErrorDialog) {
            await showErrorDialog(message, t("common.error"));
          }
          return;
        }

        if (isPollingRef.current) {
          return;
        }

        clearScheduledPoll();
        setStatusNotice(null);
        isPollingRef.current = true;
        setIsRequerying(true);
        updateNodeData(id, {
          isGenerating: true,
          generationStartedAt: data.generationStartedAt ?? Date.now(),
          taskStatus: data.taskStatus ?? null,
          lastError: null,
        });
        if (!options?.suppressErrorDialog) {
          await flushCurrentProjectToDiskSafely("starting Seedance video requery");
        }

        try {
          const response = await querySeedanceVideoResult({
            apiKey,
            taskId,
          });
          const normalizedStatus = normalizeSeedanceTaskStatus(response.status);
          const nextTaskUpdatedAt = response.updatedAt ?? Date.now();

          if (response.pending) {
            const pendingMessage =
              normalizedStatus === "queued"
                ? t("node.seedanceVideoResult.statusQueued")
                : t("node.seedanceVideoResult.statusRunning");
            setStatusNotice(pendingMessage);
            updateNodeData(id, {
              taskId: response.taskId,
              isGenerating: true,
              generationStartedAt: data.generationStartedAt ?? Date.now(),
              taskStatus: normalizedStatus,
              taskUpdatedAt: nextTaskUpdatedAt,
              lastError: null,
            });
            if (options?.scheduleNextPoll) {
              pollTimerRef.current = window.setTimeout(() => {
                void handleRequeryResult({
                  suppressErrorDialog: true,
                  scheduleNextPoll: true,
                });
              }, SEEDANCE_RESULT_POLL_INTERVAL_MS);
            }
            return;
          }

          if (!response.video) {
            const errorMessage =
              response.errorMessage ??
              t("node.seedanceVideoResult.requeryFailed");
            setStatusNotice(errorMessage);
            updateNodeData(id, {
              taskId: response.taskId,
              isGenerating: false,
              generationStartedAt: null,
              taskStatus: normalizedStatus,
              taskUpdatedAt: nextTaskUpdatedAt,
              lastError: errorMessage,
            });
            await flushCurrentProjectToDiskSafely(
              "saving Seedance video failed requery result",
            );
            if (!options?.suppressErrorDialog) {
              await showErrorDialog(errorMessage, t("common.error"));
            }
            return;
          }

          const completedAt = Date.now();
          setStatusNotice(null);
          updateNodeData(id, {
            taskId: response.taskId,
            taskStatus: normalizedStatus,
            taskUpdatedAt: response.updatedAt ?? completedAt,
            modelId: response.video.modelId ?? data.modelId ?? null,
            videoUrl: response.video.videoUrl,
            previewImageUrl: response.video.previewImageUrl ?? null,
            videoFileName: response.video.fileName ?? null,
            aspectRatio: response.video.aspectRatio ?? data.aspectRatio,
            resolution: response.video.resolution ?? data.resolution ?? null,
            duration: response.video.duration ?? data.duration ?? undefined,
            generateAudio:
              response.video.generateAudio ?? data.generateAudio ?? undefined,
            isGenerating: false,
            generationStartedAt: null,
            lastGeneratedAt: completedAt,
            lastError: null,
          });
          await flushCurrentProjectToDiskSafely(
            "saving Seedance video requery result",
          );
        } catch (error) {
          const content = resolveErrorContent(
            error,
            t("node.seedanceVideoResult.requeryFailed"),
          );
          setStatusNotice(content.message);
          updateNodeData(id, {
            ...(options?.scheduleNextPoll
              ? {
                  isGenerating: true,
                  generationStartedAt: data.generationStartedAt ?? Date.now(),
                }
              : {
                  isGenerating: false,
                  generationStartedAt: null,
                }),
            lastError: options?.scheduleNextPoll ? null : content.message,
          });
          if (options?.scheduleNextPoll) {
            pollTimerRef.current = window.setTimeout(() => {
              void handleRequeryResult({
                suppressErrorDialog: true,
                scheduleNextPoll: true,
              });
            }, SEEDANCE_RESULT_POLL_INTERVAL_MS * 2);
          } else {
            await flushCurrentProjectToDiskSafely(
              "saving Seedance video requery error",
            );
          }
          if (!options?.suppressErrorDialog && !options?.scheduleNextPoll) {
            await showErrorDialog(
              content.message,
              t("common.error"),
              content.details,
            );
          }
        } finally {
          isPollingRef.current = false;
          setIsRequerying(false);
        }
      },
      [
        apiKey,
        data.aspectRatio,
        data.duration,
        data.generationStartedAt,
        data.generateAudio,
        data.modelId,
        data.resolution,
        data.taskStatus,
        data.taskId,
        clearScheduledPoll,
        id,
        t,
        updateNodeData,
      ],
    );

    useEffect(() => {
      const taskId = data.taskId?.trim() ?? "";
      if (!data.isGenerating || !taskId || !apiKey) {
        clearScheduledPoll();
        return;
      }

      void handleRequeryResult({
        suppressErrorDialog: true,
        scheduleNextPoll: true,
      });
      return () => {
        clearScheduledPoll();
      };
    }, [apiKey, clearScheduledPoll, data.isGenerating, data.taskId, handleRequeryResult]);

    useEffect(() => () => {
      clearScheduledPoll();
    }, [clearScheduledPoll]);

    const placeholderText = data.isGenerating
      ? taskStatusLabel
      : t("node.seedanceVideoResult.empty");
    const resolutionText = useMemo(() => {
      const resolution =
        typeof data.resolution === "string" ? data.resolution.trim() : "";
      return resolution.length > 0 ? resolution : null;
    }, [data.resolution]);
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
      if (data.isGenerating) {
        return (
          <span
            title={taskStatusLabel}
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
            label={t("node.seedanceVideoResult.ready")}
            tone="warning"
          />
        );
      }

      return null;
    }, [combinedError, data.isGenerating, t, taskStatusLabel, videoSource]);

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
              ) : combinedError || statusNotice || taskStatusNotice ? (
                <div
                  className={`mt-2 truncate rounded-full px-2.5 py-1 text-[11px] ${
                    combinedError
                      ? "bg-red-500/12 text-red-200"
                      : "bg-white/8 text-text-muted"
                  }`}
                  title={combinedError ?? statusNotice ?? taskStatusNotice ?? undefined}
                >
                  {combinedError ?? statusNotice ?? taskStatusNotice}
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
          <UiButton
            type="button"
            size="sm"
            variant="muted"
            disabled={isRequerying}
            className={`${NODE_CONTROL_ACTION_BUTTON_CLASS} shrink-0`}
            onClick={(event) => {
              event.stopPropagation();
              void handleRequeryResult();
            }}
          >
            {t("node.seedanceVideoResult.requery")}
          </UiButton>
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
          minWidth={SEEDANCE_VIDEO_RESULT_NODE_MIN_WIDTH}
          minHeight={resolvedMinHeight}
        />
      </div>
    );
  },
);

SeedanceVideoResultNode.displayName = "SeedanceVideoResultNode";
