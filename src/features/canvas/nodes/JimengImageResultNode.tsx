import { memo, useCallback, useEffect, useMemo, useState } from "react";
import {
  Handle,
  Position,
  useUpdateNodeInternals,
  type NodeProps,
} from "@xyflow/react";
import {
  Loader2,
  Sparkles,
  SquareArrowOutUpRight,
  TriangleAlert,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import { UiButton } from "@/components/ui";
import { flushCurrentProjectToDiskSafely } from "@/features/canvas/application/projectPersistence";
import { prepareNodeImage } from "@/features/canvas/application/imageData";
import {
  CANVAS_NODE_TYPES,
  JIMENG_IMAGE_RESULT_NODE_DEFAULT_WIDTH,
  JIMENG_IMAGE_RESULT_NODE_MIN_HEIGHT,
  JIMENG_IMAGE_RESULT_NODE_MIN_WIDTH,
  type JimengGeneratedImageItem,
  type JimengImageResultNodeData,
} from "@/features/canvas/domain/canvasNodes";
import { resolveNodeDisplayName } from "@/features/canvas/domain/nodeDisplay";
import {
  resolveErrorContent,
  showErrorDialog,
} from "@/features/canvas/application/errorDialog";
import { resolveImageDisplayUrl } from "@/features/canvas/application/imageData";
import { CanvasNodeImage } from "@/features/canvas/ui/CanvasNodeImage";
import {
  NodeHeader,
  NODE_HEADER_FLOATING_POSITION_CLASS,
} from "@/features/canvas/ui/NodeHeader";
import { NodeResizeHandle } from "@/features/canvas/ui/NodeResizeHandle";
import { NodeStatusBadge } from "@/features/canvas/ui/NodeStatusBadge";
import { NODE_CONTROL_ACTION_BUTTON_CLASS } from "@/features/canvas/ui/nodeControlStyles";
import { queryJimengImagesResult } from "@/features/jimeng/application/jimengImageGeneration";
import { jimengImageModelUsesFourGridDisplay } from "@/features/jimeng/domain/jimengOptions";
import { useCanvasStore } from "@/stores/canvasStore";

type JimengImageResultNodeProps = NodeProps & {
  id: string;
  data: JimengImageResultNodeData;
  selected?: boolean;
};

const RESULT_GRID_SLOT_COUNT = 4;
const SINGLE_RESULT_SLOT_COUNT = 1;

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

function buildResultSlots(
  results: JimengGeneratedImageItem[],
  slotCount: number,
): Array<JimengGeneratedImageItem | null> {
  return Array.from(
    { length: slotCount },
    (_value, index) => results[index] ?? null,
  );
}

function toCssAspectRatio(aspectRatio: string): string {
  const [rawWidth = "1", rawHeight = "1"] = aspectRatio.split(":");
  const width = Number(rawWidth);
  const height = Number(rawHeight);

  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return "1 / 1";
  }

  return `${width} / ${height}`;
}

export const JimengImageResultNode = memo(
  ({ id, data, selected, width }: JimengImageResultNodeProps) => {
    const { t, i18n } = useTranslation();
    const updateNodeInternals = useUpdateNodeInternals();
    const currentNode = useCanvasStore(
      (state) => state.nodes.find((node) => node.id === id) ?? null,
    );
    const setSelectedNode = useCanvasStore((state) => state.setSelectedNode);
    const updateNodeData = useCanvasStore((state) => state.updateNodeData);
    const addDerivedExportNode = useCanvasStore(
      (state) => state.addDerivedExportNode,
    );
    const addEdge = useCanvasStore((state) => state.addEdge);
    const [isRequerying, setIsRequerying] = useState(false);
    const [statusNotice, setStatusNotice] = useState<string | null>(null);

    const resultImages = useMemo(
      () => (Array.isArray(data.resultImages) ? data.resultImages : []),
      [data.resultImages],
    );
    const usesFourGridLayout = useMemo(
      () =>
        jimengImageModelUsesFourGridDisplay(data.modelVersion) ||
        resultImages.length > 1,
      [data.modelVersion, resultImages.length],
    );
    const resultSlots = useMemo(
      () =>
        buildResultSlots(
          resultImages,
          usesFourGridLayout
            ? RESULT_GRID_SLOT_COUNT
            : SINGLE_RESULT_SLOT_COUNT,
        ),
      [resultImages, usesFourGridLayout],
    );
    const viewerImageList = useMemo(
      () =>
        resultImages
          .map(
            (item) =>
              item.imageUrl ?? item.previewImageUrl ?? item.sourceUrl ?? "",
          )
          .filter(
            (value): value is string =>
              typeof value === "string" && value.trim().length > 0,
          )
          .map((value) => resolveImageDisplayUrl(value)),
      [resultImages],
    );
    const resolvedTitle = useMemo(
      () => resolveNodeDisplayName(CANVAS_NODE_TYPES.jimengImageResult, data),
      [data],
    );
    const resolvedWidth = Math.max(
      JIMENG_IMAGE_RESULT_NODE_MIN_WIDTH,
      Math.round(width ?? JIMENG_IMAGE_RESULT_NODE_DEFAULT_WIDTH),
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
          JIMENG_IMAGE_RESULT_NODE_MIN_HEIGHT,
          Math.round(explicitHeight),
        )
      : null;
    const resolvedAspectRatio = useMemo(
      () => toCssAspectRatio(data.aspectRatio ?? "1:1"),
      [data.aspectRatio],
    );
    const lastGeneratedTime = useMemo(
      () => formatTimestamp(data.lastGeneratedAt ?? null, i18n.language),
      [data.lastGeneratedAt, i18n.language],
    );

    useEffect(() => {
      updateNodeInternals(id);
    }, [
      hasExplicitHeight,
      id,
      resolvedHeight,
      resolvedWidth,
      resultImages.length,
      updateNodeInternals,
    ]);

    const handleRequeryResults = useCallback(async () => {
      const submitIds = Array.isArray(data.submitIds)
        ? data.submitIds
            .map((submitId) => submitId.trim())
            .filter((submitId) => submitId.length > 0)
        : [];
      if (submitIds.length === 0) {
        const message = t("node.jimengImageResult.requeryUnavailable");
        setStatusNotice(message);
        await showErrorDialog(message, t("common.error"));
        return;
      }

      setStatusNotice(null);
      setIsRequerying(true);
      updateNodeData(id, {
        isGenerating: true,
        generationStartedAt: data.generationStartedAt ?? Date.now(),
        lastError: null,
      });
      await flushCurrentProjectToDiskSafely("starting Jimeng image requery");

      try {
        const response = await queryJimengImagesResult({
          submitIds,
          aspectRatio: data.aspectRatio,
        });
        const hasImages = response.images.length > 0;
        const hasPending = response.pendingSubmitIds.length > 0;
        const completedAt = hasImages
          ? Date.now()
          : (data.lastGeneratedAt ?? null);
        const nextNoticeParts = [
          hasPending
            ? t("node.jimengImageResult.requeryPendingCount", {
                count: response.pendingSubmitIds.length,
              })
            : hasImages
              ? t("node.jimengImageResult.requeryReadyCount", {
                  count: response.images.length,
                })
              : null,
          response.warnings.length > 0 ? response.warnings.join(" | ") : null,
        ].filter(Boolean);
        setStatusNotice(
          nextNoticeParts.length > 0 ? nextNoticeParts.join(" | ") : null,
        );

        updateNodeData(id, {
          submitIds: response.submitIds,
          resultImages: hasImages ? response.images : resultImages,
          isGenerating: hasPending,
          generationStartedAt: hasPending
            ? (data.generationStartedAt ?? Date.now())
            : null,
          lastGeneratedAt: completedAt,
          lastError: null,
        });
        await flushCurrentProjectToDiskSafely(
          "saving Jimeng image requery result",
        );
      } catch (error) {
        const content = resolveErrorContent(
          error,
          t("node.jimengImageResult.requeryFailed"),
        );
        setStatusNotice(content.message);
        updateNodeData(id, {
          isGenerating: false,
          generationStartedAt: null,
          lastError: content.message,
        });
        await flushCurrentProjectToDiskSafely(
          "saving Jimeng image requery error",
        );
        await showErrorDialog(
          content.message,
          t("common.error"),
          content.details,
        );
      } finally {
        setIsRequerying(false);
      }
    }, [
      data.aspectRatio,
      data.generationStartedAt,
      data.lastGeneratedAt,
      data.submitIds,
      flushCurrentProjectToDiskSafely,
      id,
      resultImages,
      t,
      updateNodeData,
    ]);

    const handleExtractResult = useCallback(
      async (item: JimengGeneratedImageItem, index: number) => {
        try {
          const sourceImage =
            item.imageUrl ?? item.previewImageUrl ?? item.sourceUrl ?? null;
          if (!sourceImage) {
            setStatusNotice(t("node.jimengImageResult.extractEmpty"));
            return;
          }

          const prepared = await prepareNodeImage(sourceImage);
          const createdNodeId = addDerivedExportNode(
            id,
            prepared.imageUrl,
            prepared.aspectRatio || item.aspectRatio || data.aspectRatio,
            prepared.previewImageUrl,
            {
              defaultTitle: t("node.jimengImageResult.extractedTitle", {
                index: index + 1,
              }),
            },
          );

          if (createdNodeId) {
            addEdge(id, createdNodeId);
            setStatusNotice(
              t("node.jimengImageResult.extractSuccess", { index: index + 1 }),
            );
          }
        } catch (error) {
          setStatusNotice(
            error instanceof Error && error.message.trim()
              ? error.message
              : t("node.jimengImageResult.extractFailed"),
          );
        }
      },
      [addDerivedExportNode, addEdge, data.aspectRatio, id, t],
    );

    const headerStatus = useMemo(() => {
      if (data.isGenerating) {
        return (
          <NodeStatusBadge
            icon={<Loader2 className="h-3 w-3" />}
            label={t("node.jimengImageResult.generating")}
            tone="processing"
            animate
          />
        );
      }

      if (data.lastError) {
        return (
          <NodeStatusBadge
            icon={<TriangleAlert className="h-3 w-3" />}
            label={t("nodeStatus.error")}
            tone="danger"
            title={data.lastError}
          />
        );
      }

      if (resultImages.length > 0) {
        return (
          <NodeStatusBadge
            icon={<Sparkles className="h-3 w-3" />}
            label={t("node.jimengImageResult.readyCount", {
              count: resultImages.length,
            })}
            tone="warning"
          />
        );
      }

      return null;
    }, [data.isGenerating, data.lastError, resultImages.length, t]);

    const statusInfoText =
      data.lastError ??
      (data.isGenerating
        ? t("node.jimengImageResult.statusGenerating")
        : (statusNotice ??
          (lastGeneratedTime
            ? t("node.jimengImageResult.generatedAt", {
                time: lastGeneratedTime,
              })
            : t("node.jimengImageResult.empty"))));

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
          icon={<Sparkles className="h-3.5 w-3.5" />}
          titleText={resolvedTitle}
          rightSlot={headerStatus ?? undefined}
          editable
          onTitleChange={(nextTitle) =>
            updateNodeData(id, { displayName: nextTitle })
          }
        />

        <div
          className="ui-scrollbar nowheel min-h-0 flex-1 overflow-auto pt-5"
          onWheelCapture={(event) => event.stopPropagation()}
        >
          <div
            className={
              usesFourGridLayout
                ? "grid grid-cols-2 gap-2"
                : "grid grid-cols-1 gap-2"
            }
          >
            {resultSlots.map((item, index) => {
              const source =
                item?.previewImageUrl ??
                item?.imageUrl ??
                item?.sourceUrl ??
                null;
              const viewerSource =
                item?.imageUrl ??
                item?.previewImageUrl ??
                item?.sourceUrl ??
                null;
              return (
                <div
                  key={item?.id ?? `jimeng-result-slot-${index + 1}`}
                  className="group/result-card relative overflow-hidden rounded-xl border border-white/10 bg-black/10"
                >
                  <div
                    className="overflow-hidden bg-surface-dark"
                    style={{ aspectRatio: resolvedAspectRatio }}
                  >
                    {source && viewerSource ? (
                      <CanvasNodeImage
                        src={resolveImageDisplayUrl(source)}
                        alt={
                          item?.fileName ??
                          t("node.jimengImageResult.slotLabel", {
                            index: index + 1,
                          })
                        }
                        viewerSourceUrl={resolveImageDisplayUrl(viewerSource)}
                        viewerImageList={viewerImageList}
                        className="h-full w-full object-cover"
                        draggable={false}
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center bg-[radial-gradient(circle_at_top,#1f2937_0%,#0f172a_72%)] text-sm text-text-muted">
                        {data.isGenerating
                          ? t("node.jimengImageResult.pending")
                          : t("node.jimengImageResult.slotLabel", {
                              index: index + 1,
                            })}
                      </div>
                    )}
                  </div>
                  {item && source ? (
                    <button
                      type="button"
                      className="absolute right-2 top-2 rounded bg-black/60 p-1 text-white opacity-0 transition-all duration-150 hover:bg-black/75 group-hover/result-card:opacity-100"
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={(event) => {
                        event.stopPropagation();
                        void handleExtractResult(item, index);
                      }}
                      title={t("node.jimengImageResult.extractImage")}
                    >
                      <SquareArrowOutUpRight className="h-3 w-3" />
                    </button>
                  ) : null}
                  {usesFourGridLayout ? (
                    <div className="pointer-events-none absolute left-2 top-2 rounded-full bg-black/45 px-2 py-1 text-[11px] font-medium text-white">
                      {index + 1}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>

        <div className="mt-2 flex min-h-[28px] items-center justify-between gap-2">
          <div
            className={`min-w-0 flex-1 truncate text-[10px] leading-4 ${
              data.lastError ? "text-rose-300" : "text-text-muted"
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
              void handleRequeryResults();
            }}
          >
            {isRequerying ? (
              <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.3} />
            ) : null}
            {t("node.jimengImageResult.requery")}
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
          minWidth={JIMENG_IMAGE_RESULT_NODE_MIN_WIDTH}
          minHeight={JIMENG_IMAGE_RESULT_NODE_MIN_HEIGHT}
        />
      </div>
    );
  },
);

JimengImageResultNode.displayName = "JimengImageResultNode";
