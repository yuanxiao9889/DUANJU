import { memo, useMemo, type CSSProperties } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";

import { resolveImageDisplayUrl } from "@/features/canvas/application/imageData";
import {
  CANVAS_NODE_TYPES,
  DEFAULT_NODE_WIDTH,
  type CanvasNodeData,
  type CanvasNodeType,
} from "@/features/canvas/domain/canvasNodes";
import {
  nodeHasSourceHandle,
  nodeHasTargetHandle,
} from "@/features/canvas/domain/nodeRegistry";
import { resolveNodeDisplayName } from "@/features/canvas/domain/nodeDisplay";
import { useCanvasZoom } from "@/features/canvas/hooks/useCanvasZoom";

type CanvasOverviewNodeProps = NodeProps & {
  data: CanvasNodeData;
  type?: string;
  selected?: boolean;
};

interface OverviewMediaSource {
  src: string;
  kind: "image" | "video";
}

type OverviewHandleStyle = CSSProperties & {
  "--canvas-handle-anchor-size"?: string;
  "--canvas-handle-hit-size"?: string;
};

const DEFAULT_OVERVIEW_NODE_HEIGHT = 160;
const MAX_MEDIA_SCAN_DEPTH = 3;
const MAX_MEDIA_SCAN_ITEMS = 24;
const OVERVIEW_DIRECT_MEDIA_NODE_TYPES = new Set<string>([
  CANVAS_NODE_TYPES.exportImage,
  CANVAS_NODE_TYPES.upload,
  CANVAS_NODE_TYPES.video,
  CANVAS_NODE_TYPES.jimengImageResult,
  CANVAS_NODE_TYPES.jimengVideoResult,
  CANVAS_NODE_TYPES.seedanceVideoResult,
  CANVAS_NODE_TYPES.viduVideoResult,
  CANVAS_NODE_TYPES.gptBestVideoResult,
  CANVAS_NODE_TYPES.storyboardSplitResult,
  CANVAS_NODE_TYPES.storyboardSplit,
]);

function normalizeSource(value: unknown): string | null {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized || normalized === "white-placeholder") {
    return null;
  }
  return normalized;
}

function isCanvasNodeType(value: string | undefined): value is CanvasNodeType {
  return Boolean(
    value && (Object.values(CANVAS_NODE_TYPES) as string[]).includes(value),
  );
}

function resolveRecordMediaSource(
  record: Record<string, unknown>,
): OverviewMediaSource | null {
  const thumbnailUrl = normalizeSource(record.thumbnailUrl);
  const previewImageUrl = normalizeSource(record.previewImageUrl);
  const imageUrl = normalizeSource(record.imageUrl);
  const posterSourceUrl = normalizeSource(record.posterSourceUrl);
  const sourceUrl = normalizeSource(record.sourceUrl);
  const hasVideo = Boolean(normalizeSource(record.videoUrl));
  const src =
    thumbnailUrl ?? previewImageUrl ?? imageUrl ?? posterSourceUrl ?? sourceUrl;

  return src ? { src, kind: hasVideo ? "video" : "image" } : null;
}

function resolveOverviewMediaSource(
  data: CanvasNodeData,
  nodeType: CanvasNodeType,
): OverviewMediaSource | null {
  const directSource = resolveRecordMediaSource(
    data as Record<string, unknown>,
  );
  if (directSource) {
    return directSource;
  }

  if (!OVERVIEW_DIRECT_MEDIA_NODE_TYPES.has(nodeType)) {
    return null;
  }

  const queue: Array<{ value: unknown; depth: number }> = [
    { value: data, depth: 0 },
  ];
  const visited = new WeakSet<object>();
  let scannedItems = 0;

  while (queue.length > 0 && scannedItems < MAX_MEDIA_SCAN_ITEMS) {
    const item = queue.shift();
    if (!item || item.depth > MAX_MEDIA_SCAN_DEPTH) {
      continue;
    }

    const { value, depth } = item;
    if (!value || typeof value !== "object") {
      continue;
    }

    if (visited.has(value)) {
      continue;
    }
    visited.add(value);
    scannedItems += 1;

    const recordSource = resolveRecordMediaSource(
      value as Record<string, unknown>,
    );
    if (recordSource) {
      return recordSource;
    }

    const nestedValues = Array.isArray(value)
      ? value
      : Object.entries(value as Record<string, unknown>)
          .filter(
            ([key]) =>
              key !== "legacyData" &&
              key !== "project" &&
              key !== "buttons" &&
              key !== "properties",
          )
          .map(([, nestedValue]) => nestedValue);

    nestedValues.forEach((nestedValue) => {
      if (nestedValue && typeof nestedValue === "object") {
        queue.push({ value: nestedValue, depth: depth + 1 });
      }
    });
  }

  return null;
}

function OverviewHandle({
  id,
  position,
  type,
}: {
  id: string;
  position: Position;
  type: "source" | "target";
}) {
  const zoom = useCanvasZoom();
  const normalizedZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  const scale = normalizedZoom < 1 ? 1 / normalizedZoom : 1;

  return (
    <Handle
      id={id}
      type={type}
      position={position}
      className="canvas-overview-handle"
      style={
        {
          "--canvas-handle-anchor-size": "2px",
          "--canvas-handle-hit-size": `${Math.max(24, 22 * scale)}px`,
        } as OverviewHandleStyle
      }
    >
      <span className="canvas-handle__hit-target" aria-hidden="true" />
      <span className="canvas-overview-handle__dot" aria-hidden="true" />
    </Handle>
  );
}

export const CanvasOverviewNode = memo(function CanvasOverviewNode({
  data,
  height,
  selected,
  type,
  width,
}: CanvasOverviewNodeProps) {
  const resolvedWidth = Math.max(96, Math.round(width ?? DEFAULT_NODE_WIDTH));
  const resolvedHeight = Math.max(
    72,
    Math.round(height ?? DEFAULT_OVERVIEW_NODE_HEIGHT),
  );
  const nodeType = useMemo(
    () => (isCanvasNodeType(type) ? type : CANVAS_NODE_TYPES.legacy),
    [type],
  );
  const title = useMemo(
    () => resolveNodeDisplayName(nodeType, data),
    [data, nodeType],
  );
  const mediaSource = useMemo(
    () => resolveOverviewMediaSource(data, nodeType),
    [data, nodeType],
  );
  const displayMediaSource = useMemo(
    () => (mediaSource ? resolveImageDisplayUrl(mediaSource.src) : null),
    [mediaSource],
  );
  const hasTargetHandle = nodeHasTargetHandle(nodeType);
  const hasSourceHandle = nodeHasSourceHandle(nodeType);

  return (
    <>
      {hasTargetHandle ? (
        <OverviewHandle id="target" type="target" position={Position.Left} />
      ) : null}
      {hasSourceHandle ? (
        <OverviewHandle id="source" type="source" position={Position.Right} />
      ) : null}
      <div
        className={[
          "canvas-overview-node",
          selected ? "canvas-overview-node--selected" : "",
          mediaSource ? "canvas-overview-node--media" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        style={{
          width: resolvedWidth,
          height: resolvedHeight,
        }}
      >
        {displayMediaSource ? (
          <img
            className="canvas-overview-node__media"
            src={displayMediaSource}
            alt=""
            draggable={false}
            loading="lazy"
            decoding="async"
          />
        ) : null}
        <div className="canvas-overview-node__shade" />
        <div className="canvas-overview-node__label">
          <span className="canvas-overview-node__marker" aria-hidden="true" />
          <span className="canvas-overview-node__title">{title}</span>
          {mediaSource?.kind === "video" ? (
            <span
              className="canvas-overview-node__video-mark"
              aria-hidden="true"
            />
          ) : null}
        </div>
      </div>
    </>
  );
});
