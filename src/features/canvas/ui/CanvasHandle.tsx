import type { CSSProperties } from "react";
import {
  Handle,
  Position,
  ViewportPortal,
  useInternalNode,
  useNodeId,
  type HandleProps,
} from "@xyflow/react";

import { useCanvasZoom } from "@/features/canvas/hooks/useCanvasZoom";

type CanvasHandleStyle = CSSProperties & {
  "--canvas-handle-anchor-size"?: string;
  "--canvas-handle-hit-size"?: string;
  "--canvas-handle-dot-size"?: string;
  "--canvas-handle-hover-ring-size"?: string;
  "--canvas-handle-connecting-ring-size"?: string;
  "--canvas-handle-valid-ring-size"?: string;
};

type CanvasHandlePosition = {
  x: number;
  y: number;
};

const BASE_ANCHOR_SIZE_PX = 2;
const BASE_HIT_SIZE_PX = 20;
const BASE_DOT_SIZE_PX = 10;
const BASE_HOVER_RING_SIZE_PX = 5;
const BASE_CONNECTING_RING_SIZE_PX = 8;
const BASE_VALID_RING_SIZE_PX = 6;

function resolveNodeDimension(
  measured: number | undefined,
  explicit: number | undefined,
): number {
  if (
    typeof measured === "number" &&
    Number.isFinite(measured) &&
    measured > 0
  ) {
    return measured;
  }

  if (
    typeof explicit === "number" &&
    Number.isFinite(explicit) &&
    explicit > 0
  ) {
    return explicit;
  }

  return 0;
}

function stripHandleSizeClasses(
  className: string | undefined,
): string | undefined {
  if (!className) {
    return undefined;
  }

  const tokens = className
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean)
    .filter((token) => !/^[!]?(?:w|h)-/.test(token));

  return tokens.length > 0 ? tokens.join(" ") : undefined;
}

function resolveFallbackHandleCenter({
  nodeHeight,
  nodeWidth,
  positionAbsolute,
  position,
}: {
  nodeHeight: number;
  nodeWidth: number;
  positionAbsolute: { x: number; y: number } | undefined;
  position: Position;
}): CanvasHandlePosition | null {
  if (!positionAbsolute || nodeWidth <= 0 || nodeHeight <= 0) {
    return null;
  }

  if (position === Position.Left) {
    return {
      x: positionAbsolute.x,
      y: positionAbsolute.y + nodeHeight / 2,
    };
  }

  if (position === Position.Right) {
    return {
      x: positionAbsolute.x + nodeWidth,
      y: positionAbsolute.y + nodeHeight / 2,
    };
  }

  if (position === Position.Top) {
    return {
      x: positionAbsolute.x + nodeWidth / 2,
      y: positionAbsolute.y,
    };
  }

  return {
    x: positionAbsolute.x + nodeWidth / 2,
    y: positionAbsolute.y + nodeHeight,
  };
}

export function CanvasHandle({
  children,
  className,
  style,
  position,
  ...props
}: HandleProps) {
  const nodeId = useNodeId();
  const internalNode = useInternalNode(nodeId ?? "");
  const zoom = useCanvasZoom();
  const normalizedZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  const scale = normalizedZoom < 1 ? 1 / normalizedZoom : 1;
  const dotSize = BASE_DOT_SIZE_PX * scale;
  const hoverRingSize = BASE_HOVER_RING_SIZE_PX * scale;
  const connectingRingSize = BASE_CONNECTING_RING_SIZE_PX * scale;
  const validRingSize = BASE_VALID_RING_SIZE_PX * scale;
  const sanitizedClassName = stripHandleSizeClasses(className);
  const resolvedPosition = position ?? Position.Top;
  const resolvedType = props.type ?? "source";
  const resolvedHandleId = props.id ?? resolvedType;

  const mergedStyle: CanvasHandleStyle = {
    ...style,
    "--canvas-handle-anchor-size": `${BASE_ANCHOR_SIZE_PX}px`,
    "--canvas-handle-hit-size": `${BASE_HIT_SIZE_PX * scale}px`,
    "--canvas-handle-hover-ring-size": `${hoverRingSize}px`,
    "--canvas-handle-connecting-ring-size": `${connectingRingSize}px`,
    "--canvas-handle-valid-ring-size": `${validRingSize}px`,
  };

  const nodeWidth = resolveNodeDimension(
    internalNode?.measured.width,
    internalNode?.width,
  );
  const nodeHeight = resolveNodeDimension(
    internalNode?.measured.height,
    internalNode?.height,
  );
  const positionAbsolute = internalNode?.internals.positionAbsolute;
  const measuredHandles =
    internalNode?.internals.handleBounds?.[resolvedType] ?? null;
  const measuredHandle =
    resolvedHandleId === null
      ? (measuredHandles?.[0] ?? null)
      : (measuredHandles?.find((handle) => handle.id === resolvedHandleId) ??
        null);
  const measuredHandleCenter =
    positionAbsolute && measuredHandle
      ? {
          x: positionAbsolute.x + measuredHandle.x + measuredHandle.width / 2,
          y: positionAbsolute.y + measuredHandle.y + measuredHandle.height / 2,
        }
      : null;
  const fallbackHandleCenter = resolveFallbackHandleCenter({
    nodeHeight,
    nodeWidth,
    positionAbsolute,
    position: resolvedPosition,
  });
  const dotPosition = fallbackHandleCenter ?? measuredHandleCenter;

  const shouldRenderDot = dotPosition !== null;

  return (
    <>
      <Handle
        {...props}
        id={resolvedHandleId}
        className={sanitizedClassName}
        position={resolvedPosition}
        style={mergedStyle}
      >
        {children}
        <span className="canvas-handle__hit-target" aria-hidden="true" />
      </Handle>
      {shouldRenderDot ? (
        <ViewportPortal>
          <span
            className="canvas-handle__dot"
            style={
              {
                left: dotPosition?.x,
                top: dotPosition?.y,
                width: dotSize,
                height: dotSize,
                "--canvas-handle-hover-ring-size": `${hoverRingSize}px`,
                "--canvas-handle-connecting-ring-size": `${connectingRingSize}px`,
                "--canvas-handle-valid-ring-size": `${validRingSize}px`,
              } as CSSProperties
            }
          />
        </ViewportPortal>
      ) : null}
    </>
  );
}
