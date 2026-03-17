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

  return (
    <>
      <path
        id={id}
        style={style}
        className="react-flow__edge-path"
        d={edgePath}
        markerEnd={markerEnd}
        stroke="#3b82f6"
        strokeWidth={2}
        fill="none"
      />
      <circle
        cx={(sourceX + targetX) / 2}
        cy={(sourceY + targetY) / 2}
        r="4"
        fill="#3b82f6"
        opacity="0.6"
      />
    </>
  );
}
