import type { CSSProperties } from "react";
import {
  Handle,
  Position,
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

const BASE_ANCHOR_SIZE_PX = 2;
const BASE_HIT_SIZE_PX = 20;
const BASE_DOT_SIZE_PX = 10;
const BASE_HOVER_RING_SIZE_PX = 5;
const BASE_CONNECTING_RING_SIZE_PX = 8;
const BASE_VALID_RING_SIZE_PX = 6;

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

export function CanvasHandle({
  children,
  className,
  style,
  position,
  ...props
}: HandleProps) {
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
    "--canvas-handle-dot-size": `${dotSize}px`,
    "--canvas-handle-hover-ring-size": `${hoverRingSize}px`,
    "--canvas-handle-connecting-ring-size": `${connectingRingSize}px`,
    "--canvas-handle-valid-ring-size": `${validRingSize}px`,
  };

  return (
    <Handle
      {...props}
      id={resolvedHandleId}
      className={sanitizedClassName}
      position={resolvedPosition}
      style={mergedStyle}
    >
      {children}
      <span className="canvas-handle__dot" aria-hidden="true" />
      <span className="canvas-handle__hit-target" aria-hidden="true" />
    </Handle>
  );
}
