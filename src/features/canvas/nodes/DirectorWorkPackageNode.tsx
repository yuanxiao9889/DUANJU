import { memo, useMemo, useState } from "react";
import { Position } from "@xyflow/react";
import { CanvasHandle } from "@/features/canvas/ui/CanvasHandle";
import {
  ExternalLink,
  PackageSearch,
  RefreshCcw,
  Rows3,
  Sparkles,
  Users,
  Waypoints,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { UiScrollArea } from "@/components/ui";
import {
  expandScriptAssetExtractionResultForNode,
  resolveScriptAssetExtractSource,
  runScriptAssetExtractionForNode,
} from "@/features/canvas/application/directorWorkPackage";
import { openStoryboardExpandDialogForAssetNode } from "@/features/canvas/application/storyboardAssetExpand";
import {
  CANVAS_NODE_TYPES,
  SCRIPT_ASSET_EXTRACT_NODE_DEFAULT_HEIGHT,
  SCRIPT_ASSET_EXTRACT_NODE_DEFAULT_WIDTH,
  type ScriptAssetExtractNodeData,
} from "@/features/canvas/domain/canvasNodes";
import { resolveNodeDisplayName } from "@/features/canvas/domain/nodeDisplay";
import { NodeResizeHandle } from "@/features/canvas/ui/NodeResizeHandle";
import { useCanvasStore } from "@/stores/canvasStore";
import { useScriptEditorStore } from "@/stores/scriptEditorStore";

type ScriptAssetExtractNodeProps = {
  id: string;
  data: ScriptAssetExtractNodeData;
  selected?: boolean;
  width?: number;
  height?: number;
};

type ResultTabKey = "characters" | "scenes" | "items";

const MIN_NODE_WIDTH = 540;
const MIN_NODE_HEIGHT = 320;
const MAX_NODE_WIDTH = 980;
const MAX_NODE_HEIGHT = 1280;
const NODE_BASE_CLASS =
  "group relative overflow-visible rounded-[var(--node-radius)] border bg-surface-dark/90 transition-all duration-150";
const NODE_SELECTED_CLASS =
  "border-[#222222] shadow-[0_0_0_2px_rgba(34,34,34,0.38),0_4px_14px_rgba(15,23,42,0.12)] dark:border-white/70 dark:shadow-[0_0_0_2px_rgba(245,245,245,0.2),0_4px_14px_rgba(0,0,0,0.24)]";
const NODE_IDLE_CLASS =
  "border-[rgba(15,23,42,0.22)] hover:border-[rgba(15,23,42,0.34)] hover:shadow-[0_4px_16px_rgba(0,0,0,0.12)] dark:border-[rgba(255,255,255,0.22)] dark:hover:border-[rgba(255,255,255,0.34)] dark:hover:shadow-[0_4px_16px_rgba(0,0,0,0.25)]";
const HANDLE_CLASS = "!rounded-full !border-2 !border-surface-dark !bg-accent";
const ACTION_BUTTON_CLASS =
  "nodrag inline-flex items-center gap-1.5 rounded-lg border border-border-dark bg-bg-dark px-3 py-1.5 text-xs font-medium text-text-dark transition-colors hover:bg-bg-dark/80 disabled:opacity-50";
const TAB_CLASS =
  "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors";
const TAB_ACTIVE_CLASS =
  "border-[#222222] bg-[#222222] text-white dark:border-white/80 dark:bg-white dark:text-black";
const TAB_IDLE_CLASS =
  "border-border-dark bg-bg-dark/60 text-text-muted hover:bg-bg-dark hover:text-text-dark";

function resolveNodeDimension(
  value: number | undefined,
  fallback: number,
): number {
  if (typeof value === "number" && Number.isFinite(value) && value > 1) {
    return Math.round(value);
  }
  return fallback;
}

export const DirectorWorkPackageNode = memo(
  ({ id, data, selected, width, height }: ScriptAssetExtractNodeProps) => {
    const { t } = useTranslation();
    const setSelectedNode = useCanvasStore((state) => state.setSelectedNode);
    const nodes = useCanvasStore((state) => state.nodes);
    const edges = useCanvasStore((state) => state.edges);
    const focusScriptAssetExtract = useScriptEditorStore(
      (state) => state.focusScriptAssetExtract,
    );
    const [isExtracting, setIsExtracting] = useState(false);
    const [activeTab, setActiveTab] = useState<ResultTabKey>("characters");
    const isStoryboardMirror = data.presentationMode === "storyboardMirror";

    const resolvedWidth = resolveNodeDimension(
      width,
      SCRIPT_ASSET_EXTRACT_NODE_DEFAULT_WIDTH,
    );
    const resolvedHeight = resolveNodeDimension(
      height,
      SCRIPT_ASSET_EXTRACT_NODE_DEFAULT_HEIGHT,
    );
    const resolvedTitle = resolveNodeDisplayName(
      CANVAS_NODE_TYPES.scriptAssetExtract,
      data,
    );
    const extractionResult = data.extractionResult;
    const hasResult = Boolean(extractionResult);
    const expandToStoryboardLabelRaw = t(
      "node.scriptAssetExtract.expandToStoryboard",
    );
    const expandToStoryboardLabel =
      expandToStoryboardLabelRaw.trim().length > 0 &&
      expandToStoryboardLabelRaw !== "node.scriptAssetExtract.expandToStoryboard"
        ? expandToStoryboardLabelRaw
        : "在分镜画布展开";
    const tabs = useMemo(
      () => [
        {
          key: "characters" as const,
          label: t("node.scriptAssetExtract.tabs.characters"),
          count:
            extractionResult?.charactersCatalog.length
            ?? extractionResult?.characters.length
            ?? 0,
          items: (
            extractionResult?.charactersCatalog
            ?? extractionResult?.characters
            ?? []
          ).map((item) => ({
            title: item.name,
            summary:
              item.visualDesc
              || item.appearance
              || item.description
              || item.personality,
            prompt: item.referencePrompt || item.continuityNotes,
            meta: [
              item.aliases?.length
                ? t("node.scriptAssetExtract.meta.aliases", {
                    value: item.aliases.join(" / "),
                  })
                : "",
              item.continuityNotes
                ? t("node.scriptAssetExtract.meta.continuity", {
                    value: item.continuityNotes,
                  })
                : "",
            ].filter(Boolean),
          })),
        },
        {
          key: "scenes" as const,
          label: t("node.scriptAssetExtract.tabs.scenes"),
          count:
            extractionResult?.scenesCatalog.length
            ?? extractionResult?.scenes.length
            ?? 0,
          items: (
            extractionResult?.scenesCatalog
            ?? extractionResult?.scenes
            ?? []
          ).map((item) => ({
            title: item.name,
            summary: item.sceneDesc || item.description,
            prompt: item.referencePrompt || item.lightLock,
            meta: [
              item.timeTone
                ? t("node.scriptAssetExtract.meta.lighting", {
                    value: item.timeTone,
                  })
                : "",
              item.spaceLayout
                ? t("node.scriptAssetExtract.meta.space", {
                    value: item.spaceLayout,
                  })
                : "",
            ].filter(Boolean),
          })),
        },
        {
          key: "items" as const,
          label: t("node.scriptAssetExtract.tabs.items"),
          count:
            extractionResult?.itemsCatalog.length
            ?? extractionResult?.items.length
            ?? 0,
          items: (
            extractionResult?.itemsCatalog
            ?? extractionResult?.items
            ?? []
          ).map((item) => ({
            title: item.name,
            summary: item.visualDesc || item.description || item.function,
            prompt: item.continuityNotes,
            meta: [
              item.function
                ? t("node.scriptAssetExtract.meta.function", {
                    value: item.function,
                  })
                : "",
              item.ownerCharacterIds?.length
                ? t("node.scriptAssetExtract.meta.owner", {
                    value: item.ownerCharacterIds.join(" / "),
                  })
                : "",
            ].filter(Boolean),
          })),
        },
      ],
      [extractionResult, t],
    );

    const activeTabItems =
      tabs.find((tab) => tab.key === activeTab)?.items ?? [];
    const resolvedSourceSnapshot = useMemo(
      () =>
        resolveScriptAssetExtractSource({
          nodeId: id,
          sourceMode: data.sourceMode,
          selectedChapterIds: data.selectedChapterIds,
          nodes,
          edges,
        }),
      [data.selectedChapterIds, data.sourceMode, edges, id, nodes],
    );
    const hasConnectedTextSource =
      resolvedSourceSnapshot.mode === "connectedText";

    const openWorkbench = () => {
      setSelectedNode(id);
      focusScriptAssetExtract(id);
    };

    const handleExtract = async () => {
      setIsExtracting(true);
      try {
        await runScriptAssetExtractionForNode(id);
      } finally {
        setIsExtracting(false);
      }
    };

    const handleExpand = () => {
      expandScriptAssetExtractionResultForNode(id);
    };

    const handleExpandToStoryboard = () => {
      openStoryboardExpandDialogForAssetNode(id);
    };

    return (
      <div
        className={`${NODE_BASE_CLASS} ${selected ? NODE_SELECTED_CLASS : NODE_IDLE_CLASS}`}
        style={{ width: resolvedWidth, height: resolvedHeight }}
        onClick={openWorkbench}
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
                <span className="rounded-full bg-bg-dark px-2.5 py-1">
                  {hasConnectedTextSource
                    ? t("node.scriptAssetExtract.source.connectedText")
                    : t("node.scriptAssetExtract.source.chapterSelection", {
                        count: resolvedSourceSnapshot.chapterCount,
                      })}
                </span>
                <span className="rounded-full bg-bg-dark px-2.5 py-1">
                  {t(
                    `node.scriptAssetExtract.status.${data.extractionState.phase}`,
                  )}
                </span>
              </div>
              <div className="mt-2 flex items-center gap-2">
                <PackageSearch className="h-4 w-4 text-text-muted" />
                <span className="truncate text-sm font-semibold text-text-dark">
                  {resolvedTitle}
                </span>
              </div>
              <div className="mt-1 line-clamp-2 text-xs leading-5 text-text-muted">
                {data.extractionState.statusText
                  || t("node.scriptAssetExtract.emptyHint")}
              </div>
            </div>

            {!isStoryboardMirror ? (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  openWorkbench();
                }}
                className="nodrag flex h-8 w-8 items-center justify-center rounded-lg border border-transparent text-text-muted transition-colors hover:border-border-dark hover:bg-bg-dark hover:text-text-dark"
                title={t("node.scriptAssetExtract.openWorkbench")}
              >
                <ExternalLink className="h-4 w-4" />
              </button>
            ) : null}
          </div>

          {isStoryboardMirror && data.expansionSource?.sourceLabel ? (
            <div className="mt-3 rounded-2xl border border-border-dark bg-bg-dark/30 px-3 py-2 text-xs text-text-muted">
              {t("node.scriptAssetExtract.storyboardMirrorHint", {
                source: data.expansionSource.sourceLabel,
              })}
            </div>
          ) : null}

          {!hasResult ? (
            <div className="mt-4 flex min-h-0 flex-1 flex-col justify-between">
              <div className="rounded-2xl border border-dashed border-border-dark bg-bg-dark/20 p-4 text-sm leading-6 text-text-muted">
                {t("node.scriptAssetExtract.startHint")}
              </div>
              {!isStoryboardMirror ? (
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      void handleExtract();
                    }}
                    className={ACTION_BUTTON_CLASS}
                    disabled={isExtracting}
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    {isExtracting
                      ? t("node.scriptAssetExtract.extracting")
                      : t("node.scriptAssetExtract.extract")}
                  </button>
                </div>
              ) : null}
            </div>
          ) : (
            <>
              <div className="mt-3 flex flex-wrap gap-2">
                {tabs.map((tab) => (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      setActiveTab(tab.key);
                    }}
                    className={`${TAB_CLASS} ${activeTab === tab.key ? TAB_ACTIVE_CLASS : TAB_IDLE_CLASS}`}
                  >
                    {tab.key === "characters" ? (
                      <Users className="h-3.5 w-3.5" />
                    ) : (
                      <Rows3 className="h-3.5 w-3.5" />
                    )}
                    {tab.label}
                    <span>{tab.count}</span>
                  </button>
                ))}
              </div>

              <UiScrollArea
                className="nodrag nowheel mt-3 min-h-0 flex-1 rounded-2xl border border-border-dark bg-bg-dark/25"
                viewportClassName="h-full"
                contentClassName="space-y-2 p-3 pr-5"
              >
                {activeTabItems.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-border-dark p-4 text-sm text-text-muted">
                    {t("node.scriptAssetExtract.emptyTab")}
                  </div>
                ) : (
                  activeTabItems.map((item, index) => (
                    <div
                      key={`${item.title}-${index}`}
                      className="rounded-2xl border border-border-dark bg-surface-dark/80 p-3"
                    >
                      <div className="text-sm font-semibold text-text-dark">
                        {item.title}
                      </div>
                      <div className="mt-1 line-clamp-3 text-xs leading-5 text-text-muted">
                        {item.summary
                          || t("node.scriptAssetExtract.emptyRowSummary")}
                      </div>
                      {item.meta && item.meta.length > 0 ? (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {item.meta.map((meta) => (
                            <span
                              key={meta}
                              className="rounded-full border border-border-dark bg-bg-dark/50 px-2 py-0.5 text-[10px] text-text-muted"
                            >
                              {meta}
                            </span>
                          ))}
                        </div>
                      ) : null}
                      {item.prompt ? (
                        <div className="mt-2 rounded-xl border border-border-dark bg-bg-dark/35 p-2 text-[11px] leading-5 text-text-muted">
                          {item.prompt}
                        </div>
                      ) : null}
                    </div>
                  ))
                )}
              </UiScrollArea>

              {!isStoryboardMirror ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      void handleExtract();
                    }}
                    className={ACTION_BUTTON_CLASS}
                    disabled={isExtracting}
                  >
                    <RefreshCcw className="h-3.5 w-3.5" />
                    {isExtracting
                      ? t("node.scriptAssetExtract.extracting")
                      : t("node.scriptAssetExtract.reextract")}
                  </button>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      handleExpand();
                    }}
                    className={ACTION_BUTTON_CLASS}
                  >
                    {t("node.scriptAssetExtract.expand")}
                  </button>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      handleExpandToStoryboard();
                    }}
                    className={`${ACTION_BUTTON_CLASS} border-accent/35 bg-accent/10 text-text-dark hover:border-accent/55 hover:bg-accent/16`}
                    title={expandToStoryboardLabel}
                  >
                    <Waypoints className="h-3.5 w-3.5" />
                    {expandToStoryboardLabel}
                  </button>
                </div>
              ) : null}
            </>
          )}
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

DirectorWorkPackageNode.displayName = "DirectorWorkPackageNode";
