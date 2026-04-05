import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Handle,
  Position,
  useUpdateNodeInternals,
  type NodeProps,
} from "@xyflow/react";
import { convertFileSrc, isTauri } from "@tauri-apps/api/core";
import { Loader2, Sparkles, TriangleAlert, Video } from "lucide-react";
import { useTranslation } from "react-i18next";

import { UiButton } from "@/components/ui";
import {
  resolveErrorContent,
  showErrorDialog,
} from "@/features/canvas/application/errorDialog";
import { resolveImageDisplayUrl } from "@/features/canvas/application/imageData";
import { flushCurrentProjectToDiskSafely } from "@/features/canvas/application/projectPersistence";
import { formatVideoTime } from "@/features/canvas/application/videoData";
import {
  CANVAS_NODE_TYPES,
  SEEDANCE_VIDEO_RESULT_NODE_DEFAULT_WIDTH,
  SEEDANCE_VIDEO_RESULT_NODE_MIN_HEIGHT,
  SEEDANCE_VIDEO_RESULT_NODE_MIN_WIDTH,
  type SeedanceVideoResultNodeData,
} from "@/features/canvas/domain/canvasNodes";
import { resolveNodeDisplayName } from "@/features/canvas/domain/nodeDisplay";
import { useCanvasNodeById } from "@/features/canvas/hooks/useCanvasNodeGraph";
import {
  NodeHeader,
  NODE_HEADER_FLOATING_POSITION_CLASS,
} from "@/features/canvas/ui/NodeHeader";
import { NodeResizeHandle } from "@/features/canvas/ui/NodeResizeHandle";
import { NodeStatusBadge } from "@/features/canvas/ui/NodeStatusBadge";
import { NODE_CONTROL_ACTION_BUTTON_CLASS } from "@/features/canvas/ui/nodeControlStyles";
import { querySeedanceVideoResult } from "@/features/seedance/application/seedanceVideoSubmission";
import { useCanvasStore } from "@/stores/canvasStore";
import { useSettingsStore } from "@/stores/settingsStore";

type SeedanceVideoResultNodeProps = NodeProps & {
  id: string;
  data: SeedanceVideoResultNodeData;
  selected?: boolean;
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

export const SeedanceVideoResultNode = memo(
  ({ id, data, selected, width }: SeedanceVideoResultNodeProps) => {
    const { t, i18n } = useTranslation();
    const updateNodeInternals = useUpdateNodeInternals();
    const currentNode = useCanvasNodeById(id);
    const storyboardApiKeys = useSettingsStore((state) => state.storyboardApiKeys);
    const setSelectedNode = useCanvasStore((state) => state.setSelectedNode);
    const updateNodeData = useCanvasStore((state) => state.updateNodeData);
    const [playbackError, setPlaybackError] = useState<string | null>(null);
    const [isRequerying, setIsRequerying] = useState(false);
    const [statusNotice, setStatusNotice] = useState<string | null>(null);
    const lastAutoRequeryTaskIdRef = useRef<string | null>(null);

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
    const explicitHeight =
      typeof currentNode?.height === "number" &&
      Number.isFinite(currentNode.height)
        ? currentNode.height
        : typeof currentNode?.style?.height === "number" &&
            Number.isFinite(currentNode.style.height)
          ? currentNode.style.height
          : null;
    const hasExplicitHeight = typeof explicitHeight === "number";
    const resolvedHeight = hasExplicitHeight
      ? Math.max(
          SEEDANCE_VIDEO_RESULT_NODE_MIN_HEIGHT,
          Math.round(explicitHeight),
        )
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

    useEffect(() => {
      updateNodeInternals(id);
    }, [
      hasExplicitHeight,
      id,
      resolvedHeight,
      resolvedWidth,
      updateNodeInternals,
      videoSource,
    ]);

    const handleRequeryResult = useCallback(
      async (options?: { suppressErrorDialog?: boolean }) => {
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

        setStatusNotice(null);
        setIsRequerying(true);
        updateNodeData(id, {
          isGenerating: true,
          generationStartedAt: data.generationStartedAt ?? Date.now(),
          lastError: null,
        });
        await flushCurrentProjectToDiskSafely("starting Seedance video requery");

        try {
          const response = await querySeedanceVideoResult({
            apiKey,
            taskId,
          });

          if (response.pending) {
            const pendingMessage = t("node.seedanceVideoResult.requeryPending");
            setStatusNotice(pendingMessage);
            updateNodeData(id, {
              taskId: response.taskId,
              isGenerating: true,
              generationStartedAt: data.generationStartedAt ?? Date.now(),
              lastError: null,
            });
            await flushCurrentProjectToDiskSafely(
              "saving Seedance video pending requery result",
            );
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
            isGenerating: false,
            generationStartedAt: null,
            lastError: content.message,
          });
          await flushCurrentProjectToDiskSafely(
            "saving Seedance video requery error",
          );
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
      },
      [
        apiKey,
        data.aspectRatio,
        data.duration,
        data.generationStartedAt,
        data.generateAudio,
        data.modelId,
        data.resolution,
        data.taskId,
        id,
        t,
        updateNodeData,
      ],
    );

    useEffect(() => {
      const taskId = data.taskId?.trim() ?? "";
      if (!data.isGenerating || !taskId || !apiKey) {
        return;
      }

      if (lastAutoRequeryTaskIdRef.current === taskId) {
        return;
      }

      lastAutoRequeryTaskIdRef.current = taskId;
      void handleRequeryResult({ suppressErrorDialog: true });
    }, [apiKey, data.isGenerating, data.taskId, handleRequeryResult]);

    const combinedError = playbackError ?? data.lastError ?? null;
    const headerStatus = useMemo(() => {
      if (data.isGenerating) {
        return (
          <NodeStatusBadge
            icon={<Loader2 className="h-3 w-3" />}
            label={t("node.seedanceVideoResult.generating")}
            tone="processing"
            animate
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
            label={t("node.seedanceVideoResult.ready")}
            tone="warning"
          />
        );
      }

      return null;
    }, [combinedError, data.isGenerating, t, videoSource]);

    const statusInfoText =
      combinedError ??
      (data.isGenerating
        ? t("node.seedanceVideoResult.statusGenerating")
        : (statusNotice ??
          (lastGeneratedTime
            ? t("node.seedanceVideoResult.generatedAt", {
                time: lastGeneratedTime,
              })
            : t("node.seedanceVideoResult.empty"))));

    return (
      <div
        className={`
          group relative flex flex-col overflow-visible rounded-[var(--node-radius)] border bg-surface-dark/90 p-2 transition-colors duration-150
          ${hasExplicitHeight ? "h-full" : ""}
          ${
            selected
              ? "border-accent shadow-[0_0_0_1px_rgba(59,130,246,0.32)]"
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
                  {data.isGenerating
                    ? t("node.seedanceVideoResult.pending")
                    : t("node.seedanceVideoResult.empty")}
                </div>
              )}
            </div>
          </div>

          <div className="mt-2 flex flex-wrap gap-1.5 text-[10px] leading-4 text-text-muted">
            {durationLabel ? (
              <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5">
                {t("node.seedanceVideoResult.duration", {
                  duration: durationLabel,
                })}
              </span>
            ) : null}
            {data.resolution ? (
              <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5">
                {data.resolution}
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
            {isRequerying ? (
              <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.3} />
            ) : null}
            {t("node.seedanceVideoResult.requery")}
          </UiButton>
        </div>

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
          minHeight={SEEDANCE_VIDEO_RESULT_NODE_MIN_HEIGHT}
        />
      </div>
    );
  },
);

SeedanceVideoResultNode.displayName = "SeedanceVideoResultNode";
