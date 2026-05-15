import { memo, useMemo } from "react";
import { Position, type NodeProps } from "@xyflow/react";
import { CanvasHandle } from "@/features/canvas/ui/CanvasHandle";
import { AlertTriangle } from "lucide-react";
import {
  CANVAS_NODE_TYPES,
  type LegacyNodeData,
} from "@/features/canvas/domain/canvasNodes";
import { resolveNodeDisplayName } from "@/features/canvas/domain/nodeDisplay";
import {
  NodeHeader,
  NODE_HEADER_FLOATING_POSITION_CLASS,
} from "@/features/canvas/ui/NodeHeader";
import { NodeResizeHandle } from "@/features/canvas/ui/NodeResizeHandle";
import { useCanvasStore } from "@/stores/canvasStore";

type LegacyNodeProps = NodeProps & {
  id: string;
  data: LegacyNodeData;
  selected?: boolean;
};

const DEFAULT_WIDTH = 420;
const DEFAULT_HEIGHT = 240;
const MIN_WIDTH = 320;
const MIN_HEIGHT = 180;
const MAX_WIDTH = 1200;
const MAX_HEIGHT = 900;

function formatLegacyValue(value: unknown): string {
  if (value === null || typeof value === "undefined") {
    return "";
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return "";
    }
    return trimmed.length > 140 ? `${trimmed.slice(0, 140)}...` : trimmed;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (Array.isArray(value)) {
    return `Array(${value.length})`;
  }

  if (typeof value === "object") {
    return `Object(${Object.keys(value as Record<string, unknown>).length})`;
  }

  return String(value);
}

export const LegacyNode = memo(
  ({ id, data, selected, width, height }: LegacyNodeProps) => {
    const setSelectedNode = useCanvasStore((state) => state.setSelectedNode);
    const updateNodeData = useCanvasStore((state) => state.updateNodeData);

    const resolvedTitle = useMemo(
      () => resolveNodeDisplayName(CANVAS_NODE_TYPES.legacy, data),
      [data],
    );

    const fieldNames = useMemo(() => {
      const keys = Object.keys(data.legacyData).filter(
        (key) => key !== "displayName",
      );
      return keys.length > 0 ? keys : ["legacyData"];
    }, [data.legacyData]);

    const fieldPreview = useMemo(() => {
      const previewNames = fieldNames.slice(0, 4);
      return fieldNames.length > previewNames.length
        ? `${previewNames.join(" | ")} | +${fieldNames.length - previewNames.length}`
        : previewNames.join(" | ");
    }, [fieldNames]);

    const contentPreview = useMemo(() => {
      const priorityKeys = [
        "prompt",
        "inferredPrompt",
        "inferError",
        "imageUrl",
        "previewImageUrl",
        "cameraState",
        "assetType",
        "style",
        "model",
        "requestAspectRatio",
        "size",
        "displayName",
      ];

      const entries = priorityKeys
        .map((key) => [key, data.legacyData[key]] as const)
        .filter(([, value]) => typeof value !== "undefined")
        .map(([key, value]) => `${key}: ${formatLegacyValue(value)}`)
        .filter((item) => item.length > 0);

      if (entries.length > 0) {
        return entries.slice(0, 5);
      }

      const rawJson = JSON.stringify(data.legacyData, null, 2);
      return rawJson
        ? [rawJson.length > 900 ? `${rawJson.slice(0, 900)}...` : rawJson]
        : [];
    }, [data.legacyData]);

    const resolvedWidth = Math.max(
      MIN_WIDTH,
      Math.round(width ?? DEFAULT_WIDTH),
    );
    const resolvedHeight = Math.max(
      MIN_HEIGHT,
      Math.round(height ?? DEFAULT_HEIGHT),
    );

    return (
      <div
        className={`
        group relative h-full w-full overflow-visible rounded-[18px] border transition-colors duration-150
        ${
          selected
            ? "border-accent shadow-[0_0_0_1px_rgba(59,130,246,0.32)]"
            : "border-[rgba(15,23,42,0.2)] hover:border-[rgba(15,23,42,0.32)] dark:border-[rgba(255,255,255,0.2)] dark:hover:border-[rgba(255,255,255,0.32)]"
        }
      `}
        style={{
          width: resolvedWidth,
          height: resolvedHeight,
          backgroundColor: "var(--group-node-bg)",
        }}
        onClick={() => setSelectedNode(id)}
      >
        <CanvasHandle
          type="target"
          id="target"
          position={Position.Left}
          className="!h-3 !w-3 !-left-1.5 !rounded-full !border-surface-dark !bg-slate-400"
        />
        <CanvasHandle
          type="source"
          id="source"
          position={Position.Right}
          className="!h-3 !w-3 !-right-1.5 !rounded-full !border-surface-dark !bg-slate-400"
        />

        <NodeHeader
          className={NODE_HEADER_FLOATING_POSITION_CLASS}
          icon={<AlertTriangle className="h-4 w-4" />}
          titleText={resolvedTitle}
          metaText={data.legacyType}
          subtitle={fieldPreview}
          editable
          onTitleChange={(nextTitle) =>
            updateNodeData(id, { displayName: nextTitle })
          }
        />

        <NodeResizeHandle
          minWidth={MIN_WIDTH}
          minHeight={MIN_HEIGHT}
          maxWidth={MAX_WIDTH}
          maxHeight={MAX_HEIGHT}
          isVisible={selected}
        />

        <div className="absolute inset-x-3 bottom-3 top-10 rounded-[14px] border border-white/10 bg-black/10 px-3 py-2">
          <div className="flex h-full flex-col gap-2 overflow-auto text-[11px] leading-4 text-text-muted">
            {contentPreview.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {contentPreview.map((item) => (
                  <span
                    key={item}
                    className="inline-flex max-w-full items-start rounded-md border border-white/10 bg-white/[0.04] px-2 py-1 text-left break-words"
                  >
                    {item}
                  </span>
                ))}
              </div>
            ) : null}
            {fieldNames.map((fieldName) => (
              <span
                key={fieldName}
                className="inline-flex w-fit items-center rounded-md border border-white/10 bg-white/[0.04] px-2 py-1"
              >
                {fieldName}
              </span>
            ))}
          </div>
        </div>
      </div>
    );
  },
);

LegacyNode.displayName = "LegacyNode";
