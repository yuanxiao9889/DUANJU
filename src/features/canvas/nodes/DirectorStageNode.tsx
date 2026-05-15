import { memo, useMemo } from "react";
import { Position, type NodeProps } from "@xyflow/react";
import { CanvasHandle } from "@/features/canvas/ui/CanvasHandle";
import { Box, Camera, Clapperboard, Cuboid, ExternalLink } from "lucide-react";
import { useTranslation } from "react-i18next";
import { UiButton } from "@/components/ui";
import {
  CANVAS_NODE_TYPES,
  DIRECTOR_STAGE_NODE_DEFAULT_HEIGHT,
  DIRECTOR_STAGE_NODE_DEFAULT_WIDTH,
  type DirectorStageNodeData,
} from "@/features/canvas/domain/canvasNodes";
import { resolveImageDisplayUrl } from "@/features/canvas/application/imageData";
import { resolveNodeDisplayName } from "@/features/canvas/domain/nodeDisplay";
import {
  NodeHeader,
  NODE_HEADER_FLOATING_POSITION_CLASS,
} from "@/features/canvas/ui/NodeHeader";
import { NodeResizeHandle } from "@/features/canvas/ui/NodeResizeHandle";
import { useCanvasStore } from "@/stores/canvasStore";

type DirectorStageNodeProps = NodeProps & {
  id: string;
  data: DirectorStageNodeData;
  selected?: boolean;
  width?: number;
  height?: number;
};

function resolveDimension(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 1
    ? Math.round(value)
    : fallback;
}

export const DirectorStageNode = memo(
  ({ id, data, selected, width, height }: DirectorStageNodeProps) => {
    const { t } = useTranslation();
    const openDirectorStage = useCanvasStore(
      (state) => state.openDirectorStage,
    );
    const resolvedWidth = resolveDimension(
      width,
      DIRECTOR_STAGE_NODE_DEFAULT_WIDTH,
    );
    const resolvedHeight = resolveDimension(
      height,
      DIRECTOR_STAGE_NODE_DEFAULT_HEIGHT,
    );
    const title = resolveNodeDisplayName(CANVAS_NODE_TYPES.directorStage, data);
    const snapshotSource = useMemo(() => {
      const source = data.lastSnapshotPreviewUrl || data.lastSnapshotUrl;
      return source ? resolveImageDisplayUrl(source) : null;
    }, [data.lastSnapshotPreviewUrl, data.lastSnapshotUrl]);
    const crowdGroups = data.project.crowdGroups ?? [];
    const objectCount =
      data.objectCount ??
      data.project.entities.filter((entity) => !entity.crowdGroupId).length +
        crowdGroups.length;
    const cameraShotCount =
      data.cameraShotCount ?? data.project.cameraShots.length;
    const rawActiveShotName =
      data.activeCameraShotName ??
      data.project.cameraShots.find(
        (shot) => shot.id === data.project.activeCameraShotId,
      )?.name ??
      t("node.directorStage.freeView");
    const activeShotName =
      rawActiveShotName === "Shot 1"
        ? t("node.directorStage.defaultShotName")
        : rawActiveShotName;

    return (
      <div
        className={`group relative rounded-[var(--node-radius)] border bg-surface shadow-lg transition-colors ${
          selected
            ? "border-accent/70 shadow-[0_0_0_1px_rgba(var(--accent-rgb),0.28),0_18px_48px_rgba(0,0,0,0.28)]"
            : "border-border-dark"
        }`}
        style={{ width: resolvedWidth, height: resolvedHeight }}
      >
        <NodeHeader
          className={NODE_HEADER_FLOATING_POSITION_CLASS}
          icon={<Clapperboard className="h-4 w-4" />}
          titleText={title}
          metaText={t("node.directorStage.meta")}
        />

        <CanvasHandle
          type="target"
          position={Position.Left}
          id="target"
          className="!h-3 !w-3 !border-2 !border-surface-dark !bg-accent"
        />
        <CanvasHandle
          type="source"
          position={Position.Right}
          id="source"
          className="!h-3 !w-3 !border-2 !border-surface-dark !bg-accent"
        />

        <div className="flex h-full flex-col overflow-hidden rounded-[var(--node-inner-radius)] bg-[#111214] text-white">
          <div className="relative min-h-0 flex-1 overflow-hidden bg-[#14161a]">
            {snapshotSource ? (
              <img
                src={snapshotSource}
                alt={title}
                className="h-full w-full object-cover"
                draggable={false}
              />
            ) : (
              <div className="relative h-full w-full overflow-hidden bg-[#15171b]">
                <div className="absolute inset-0 opacity-70 [background-image:linear-gradient(rgba(255,255,255,0.08)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.08)_1px,transparent_1px)] [background-size:28px_28px]" />
                <div className="absolute left-1/2 top-1/2 h-24 w-24 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/12 bg-white/[0.04]" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <Cuboid className="h-11 w-11 text-white/65" />
                </div>
              </div>
            )}

            <div className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-md border border-white/25 bg-black/65 px-2 py-1 text-[11px] font-semibold text-white shadow-none backdrop-blur">
              <Box className="h-3.5 w-3.5 text-white/90" />
              {t("node.directorStage.objectCount", { count: objectCount })}
            </div>
          </div>

          <div className="grid shrink-0 grid-cols-[1fr_auto] gap-3 border-t border-white/10 bg-[#191b20] p-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-xs font-medium text-white/76">
                <Camera className="h-3.5 w-3.5 text-white/58" />
                <span className="truncate">
                  {t("node.directorStage.cameraSummary", {
                    count: cameraShotCount,
                    name: activeShotName,
                  })}
                </span>
              </div>
              <div className="mt-1 truncate text-[11px] text-white/52">
                {data.lastSnapshotAt
                  ? t("node.directorStage.snapshotSaved")
                  : t("node.directorStage.noSnapshot")}
              </div>
            </div>

            <UiButton
              type="button"
              variant="primary"
              size="sm"
              className="nodrag nowheel h-8 gap-1.5 rounded-md px-2.5"
              onClick={(event) => {
                event.stopPropagation();
                openDirectorStage(id);
              }}
            >
              <ExternalLink className="h-3.5 w-3.5" />
              {t("node.directorStage.open")}
            </UiButton>
          </div>
        </div>

        <NodeResizeHandle minWidth={320} minHeight={240} />
      </div>
    );
  },
);

DirectorStageNode.displayName = "DirectorStageNode";
