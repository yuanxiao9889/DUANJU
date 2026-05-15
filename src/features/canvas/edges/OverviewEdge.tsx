import { memo, useMemo } from "react";
import { BaseEdge, getBezierPath, type EdgeProps } from "@xyflow/react";

export const OverviewEdge = memo(function OverviewEdge({
  id,
  markerEnd,
  selected,
  sourcePosition,
  sourceX,
  sourceY,
  style,
  targetPosition,
  targetX,
  targetY,
}: EdgeProps) {
  const edgePath = useMemo(() => {
    const [path] = getBezierPath({
      sourceX,
      sourceY,
      sourcePosition,
      targetX,
      targetY,
      targetPosition,
    });
    return path;
  }, [
    sourcePosition,
    sourceX,
    sourceY,
    targetPosition,
    targetX,
    targetY,
  ]);

  return (
    <BaseEdge
      id={id}
      markerEnd={markerEnd}
      path={edgePath}
      style={{
        stroke: selected
          ? "rgb(var(--accent-rgb) / 0.86)"
          : "rgb(var(--text-muted-rgb) / 0.46)",
        strokeWidth: selected ? 2.4 : 1.8,
        ...style,
      }}
    />
  );
});
