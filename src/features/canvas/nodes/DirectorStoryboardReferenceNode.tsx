import { memo, useMemo, useState } from "react";
import { Position } from "@xyflow/react";
import { CanvasHandle } from "@/features/canvas/ui/CanvasHandle";
import {
  Clapperboard,
  Image as ImageIcon,
  Layers3,
  Lock,
  LockOpen,
  RefreshCcw,
  Rows3,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { UiScrollArea } from "@/components/ui";
import {
  expandDirectorSectionsToCanvas,
  enqueueStoryboardImageGeneration,
  syncStoryboardDirectorReference,
} from "@/features/canvas/application/productionTaskExpander";
import {
  CANVAS_NODE_TYPES,
  DIRECTOR_STORYBOARD_REFERENCE_NODE_DEFAULT_HEIGHT,
  DIRECTOR_STORYBOARD_REFERENCE_NODE_DEFAULT_WIDTH,
  type DirectorStoryboardReferenceNodeData,
} from "@/features/canvas/domain/canvasNodes";
import { resolveNodeDisplayName } from "@/features/canvas/domain/nodeDisplay";
import { NodeResizeHandle } from "@/features/canvas/ui/NodeResizeHandle";
import { useCanvasStore } from "@/stores/canvasStore";

type DirectorStoryboardReferenceNodeProps = {
  id: string;
  data: DirectorStoryboardReferenceNodeData;
  selected?: boolean;
  width?: number;
  height?: number;
};

const MIN_NODE_WIDTH = 620;
const MIN_NODE_HEIGHT = 460;
const MAX_NODE_WIDTH = 1080;
const MAX_NODE_HEIGHT = 1200;
const NODE_BASE_CLASS =
  "group relative overflow-visible rounded-[var(--node-radius)] border bg-surface-dark/90 transition-all duration-150";
const NODE_SELECTED_CLASS =
  "border-[#222222] shadow-[0_0_0_2px_rgba(34,34,34,0.38),0_4px_14px_rgba(15,23,42,0.12)] dark:border-white/70 dark:shadow-[0_0_0_2px_rgba(245,245,245,0.2),0_4px_14px_rgba(0,0,0,0.24)]";
const NODE_IDLE_CLASS =
  "border-[rgba(15,23,42,0.22)] hover:border-[rgba(15,23,42,0.34)] hover:shadow-[0_4px_16px_rgba(0,0,0,0.12)] dark:border-[rgba(255,255,255,0.22)] dark:hover:border-[rgba(255,255,255,0.34)] dark:hover:shadow-[0_4px_16px_rgba(0,0,0,0.25)]";
const HANDLE_CLASS = "!rounded-full !border-2 !border-surface-dark !bg-accent";
const ACTION_BUTTON_CLASS =
  "nodrag inline-flex items-center gap-1.5 rounded-lg border border-border-dark bg-bg-dark px-3 py-1.5 text-xs font-medium text-text-dark transition-colors hover:bg-bg-dark/80 disabled:opacity-50";
const PILL_CLASS =
  "rounded-full bg-bg-dark px-2.5 py-1 text-[11px] text-text-muted";

function resolveNodeDimension(
  value: number | undefined,
  fallback: number,
): number {
  if (typeof value === "number" && Number.isFinite(value) && value > 1) {
    return Math.round(value);
  }
  return fallback;
}

export const DirectorStoryboardReferenceNode = memo(
  ({
    id,
    data,
    selected,
    width,
    height,
  }: DirectorStoryboardReferenceNodeProps) => {
    const { t } = useTranslation();
    const updateNodeData = useCanvasStore((state) => state.updateNodeData);
    const [isSyncing, setIsSyncing] = useState(false);

    const resolvedWidth = resolveNodeDimension(
      width,
      DIRECTOR_STORYBOARD_REFERENCE_NODE_DEFAULT_WIDTH,
    );
    const resolvedHeight = resolveNodeDimension(
      height,
      DIRECTOR_STORYBOARD_REFERENCE_NODE_DEFAULT_HEIGHT,
    );
    const resolvedTitle = resolveNodeDisplayName(
      CANVAS_NODE_TYPES.directorStoryboardReference,
      data,
    );
    const snapshot = data.directorStoryboardSnapshot;
    const overrides = data.directorStoryboardOverrides;
    const sections = snapshot?.sections ?? [];
    const totalShots = useMemo(
      () => sections.reduce((sum, section) => sum + section.shots.length, 0),
      [sections],
    );
    const lockedSectionIds = new Set(overrides.lockedSectionIds);
    const expandedSectionIds = new Set(overrides.expandedSectionIds);
    const completedImageJobs = data.productionQueue.imageJobs.filter(
      (job) => job.status === "completed",
    ).length;

    const handleSync = async () => {
      setIsSyncing(true);
      try {
        await syncStoryboardDirectorReference(id);
      } finally {
        setIsSyncing(false);
      }
    };

    return (
      <div
        className={`${NODE_BASE_CLASS} ${selected ? NODE_SELECTED_CLASS : NODE_IDLE_CLASS}`}
        style={{ width: resolvedWidth, height: resolvedHeight }}
      >
        <CanvasHandle
          type="target"
          id="target"
          position={Position.Left}
          className={HANDLE_CLASS}
        />
        <CanvasHandle
          type="source"
          id="source"
          position={Position.Right}
          className={HANDLE_CLASS}
        />

        <div className="relative flex h-full flex-col overflow-hidden rounded-[var(--node-radius)] p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2 text-[11px] text-text-muted">
                <span className={PILL_CLASS}>
                  {t("node.directorStoryboardReference.sourceScript")}
                </span>
                <span className={PILL_CLASS}>
                  {snapshot
                    ? t("node.directorStoryboardReference.versionLabel", {
                        version: snapshot.version,
                      })
                    : t("node.directorStoryboardReference.noPackage")}
                </span>
              </div>
              <div className="mt-2 flex items-center gap-2">
                <Clapperboard className="h-4 w-4 text-text-muted" />
                <span className="truncate text-sm font-semibold text-text-dark">
                  {resolvedTitle}
                </span>
              </div>
              <div className="mt-1 line-clamp-1 text-xs text-text-muted">
                {data.syncMessage ||
                  t(
                    `node.directorStoryboardReference.syncStatus.${data.syncStatus}`,
                  )}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  void handleSync();
                }}
                className={ACTION_BUTTON_CLASS}
                disabled={isSyncing}
              >
                <RefreshCcw
                  className={`h-3.5 w-3.5 ${isSyncing ? "animate-spin" : ""}`}
                />
                {t("node.directorStoryboardReference.sync")}
              </button>
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  expandDirectorSectionsToCanvas(id);
                }}
                className={ACTION_BUTTON_CLASS}
                disabled={!snapshot}
              >
                <Layers3 className="h-3.5 w-3.5" />
                {t("node.directorStoryboardReference.expandAll")}
              </button>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
            <span className={PILL_CLASS}>
              {t("node.directorStoryboardReference.sectionCount", {
                count: sections.length,
              })}
            </span>
            <span className={PILL_CLASS}>
              {t("node.directorStoryboardReference.shotCount", {
                count: totalShots,
              })}
            </span>
            <span className={PILL_CLASS}>
              {t("node.directorStoryboardReference.referenceCount", {
                count: snapshot?.referenceAssets.length ?? 0,
              })}
            </span>
            <span className={PILL_CLASS}>
              {t("node.directorStoryboardReference.queueSummary", {
                total: data.productionQueue.imageJobs.length,
                completed: completedImageJobs,
              })}
            </span>
          </div>

          <UiScrollArea
            className="nodrag nowheel mt-3 min-h-0 flex-1 rounded-2xl border border-border-dark bg-bg-dark/25"
            viewportClassName="h-full"
            contentClassName="space-y-3 p-3 pr-5"
          >
            {sections.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border-dark p-4 text-sm text-text-muted">
                {t("node.directorStoryboardReference.empty")}
              </div>
            ) : (
              sections.map((section) => {
                const isLocked = lockedSectionIds.has(section.id);
                const isExpanded = expandedSectionIds.has(section.id);
                const referenceCount = new Set(
                  section.shots.flatMap((shot) =>
                    shot.referenceBindings.map(
                      (binding) => binding.referenceId,
                    ),
                  ),
                ).size;

                return (
                  <div
                    key={section.id}
                    className="rounded-2xl border border-border-dark bg-surface-dark/80 p-3"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-text-dark">
                          {section.title ||
                            t(
                              "node.directorStoryboardReference.untitledSection",
                              { number: section.order + 1 },
                            )}
                        </div>
                        <div className="mt-1 line-clamp-2 text-xs text-text-muted">
                          {section.summary ||
                            section.visualIntent ||
                            t("node.directorStoryboardReference.emptySummary")}
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 text-[11px]">
                        <span className={PILL_CLASS}>
                          <Rows3 className="mr-1 inline h-3 w-3" />
                          {t("node.directorStoryboardReference.shotCount", {
                            count: section.shots.length,
                          })}
                        </span>
                        <span className={PILL_CLASS}>
                          <ImageIcon className="mr-1 inline h-3 w-3" />
                          {t(
                            "node.directorStoryboardReference.referenceCount",
                            { count: referenceCount },
                          )}
                        </span>
                      </div>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          expandDirectorSectionsToCanvas(id, [section.id]);
                        }}
                        className={ACTION_BUTTON_CLASS}
                      >
                        <Layers3 className="h-3.5 w-3.5" />
                        {isExpanded
                          ? t("node.directorStoryboardReference.expanded")
                          : t("node.directorStoryboardReference.expandSection")}
                      </button>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          enqueueStoryboardImageGeneration(
                            id,
                            section.shots.map((shot) => shot.id),
                          );
                        }}
                        className={ACTION_BUTTON_CLASS}
                      >
                        <ImageIcon className="h-3.5 w-3.5" />
                        {t("node.directorStoryboardReference.queueImages")}
                      </button>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          updateNodeData(id, {
                            directorStoryboardOverrides: {
                              ...overrides,
                              lockedSectionIds: isLocked
                                ? overrides.lockedSectionIds.filter(
                                    (sectionId) => sectionId !== section.id,
                                  )
                                : [...overrides.lockedSectionIds, section.id],
                            },
                          });
                        }}
                        className={ACTION_BUTTON_CLASS}
                      >
                        {isLocked ? (
                          <Lock className="h-3.5 w-3.5" />
                        ) : (
                          <LockOpen className="h-3.5 w-3.5" />
                        )}
                        {isLocked
                          ? t("node.directorStoryboardReference.unlockSection")
                          : t("node.directorStoryboardReference.lockSection")}
                      </button>
                    </div>

                    <div className="mt-3 space-y-2">
                      {section.shots.slice(0, 4).map((shot) => (
                        <div
                          key={shot.id}
                          className="rounded-xl bg-bg-dark/60 px-3 py-2"
                        >
                          <div className="text-xs font-medium text-text-dark">
                            {shot.shotLabel ||
                              t(
                                "node.directorStoryboardReference.shotFallback",
                                { number: shot.order + 1 },
                              )}
                          </div>
                          <div className="mt-1 line-clamp-2 text-[11px] text-text-muted">
                            {shot.promptDraft ||
                              shot.shotPurpose ||
                              t(
                                "node.directorStoryboardReference.emptyShotPrompt",
                              )}
                          </div>
                        </div>
                      ))}
                      {section.shots.length > 4 ? (
                        <div className="text-[11px] text-text-muted">
                          {t("node.directorStoryboardReference.moreShots", {
                            count: section.shots.length - 4,
                          })}
                        </div>
                      ) : null}
                    </div>
                  </div>
                );
              })
            )}
          </UiScrollArea>
        </div>

        <NodeResizeHandle
          minWidth={MIN_NODE_WIDTH}
          minHeight={MIN_NODE_HEIGHT}
          maxWidth={MAX_NODE_WIDTH}
          maxHeight={MAX_NODE_HEIGHT}
        />
      </div>
    );
  },
);

DirectorStoryboardReferenceNode.displayName = "DirectorStoryboardReferenceNode";
