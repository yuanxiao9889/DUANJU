import { useMemo } from 'react';
import { getBezierPath } from '@xyflow/react';
import type { EdgeProps } from '@xyflow/react';

export function BranchEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  style,
  markerEnd,
  selected,
}: EdgeProps) {
  const [edgePath] = useMemo(() => {
    const [path] = getBezierPath({
      sourceX,
      sourceY,
      targetX,
      targetY,
    });

    return [path];
  }, [sourceX, sourceY, targetX, targetY]);

  const strokeColor = selected
    ? 'rgb(var(--accent-rgb) / 0.9)'
    : 'rgb(var(--accent-rgb) / 0.65)';
  const strokeWidth = selected ? 2.5 : 2;

  return (
    <>
      <path
        id={id}
        style={style}
        className="react-flow__edge-path"
        d={edgePath}
        markerEnd={markerEnd}
        stroke={strokeColor}
        strokeWidth={strokeWidth}
        fill="none"
      />
      <circle
        cx={(sourceX + targetX) / 2}
        cy={(sourceY + targetY) / 2}
        r={selected ? 5 : 4}
        fill={strokeColor}
        opacity={selected ? 0.8 : 0.6}
      />
    </>
  );
}
