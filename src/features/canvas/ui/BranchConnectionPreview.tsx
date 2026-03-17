import { useMemo } from 'react';
import type { Node } from '@xyflow/react';
import { calculateNodesBounds } from '../application/nodeBounds';

interface BranchConnectionPreviewProps {
  sourceNodes: Node[];
  currentPosition: { x: number; y: number };
  viewport: { x: number; y: number; zoom: number };
}

export function BranchConnectionPreview({ 
  sourceNodes, 
  currentPosition,
  viewport 
}: BranchConnectionPreviewProps) {
  const sourcePositions = useMemo(() => {
    return sourceNodes.map(node => {
      const width = node.width ?? node.measured?.width ?? 200;
      const height = node.height ?? node.measured?.height ?? 100;
      return {
        x: node.position.x + width,
        y: node.position.y + height / 2,
      };
    });
  }, [sourceNodes]);

  const bounds = useMemo(() => calculateNodesBounds(sourceNodes), [sourceNodes]);
  
  const mergePoint = useMemo(() => ({
    x: bounds.right + 30,
    y: bounds.centerY,
  }), [bounds]);

  const screenMergePoint = {
    x: mergePoint.x * viewport.zoom + viewport.x,
    y: mergePoint.y * viewport.zoom + viewport.y,
  };

  const screenCurrentPosition = {
    x: currentPosition.x,
    y: currentPosition.y,
  };

  const screenSourcePositions = sourcePositions.map(pos => ({
    x: pos.x * viewport.zoom + viewport.x,
    y: pos.y * viewport.zoom + viewport.y,
  }));

  return (
    <svg
      className="pointer-events-none absolute inset-0"
      style={{ zIndex: 9999, width: '100%', height: '100%' }}
    >
      <defs>
        <marker
          id="preview-arrowhead"
          markerWidth="10"
          markerHeight="7"
          refX="9"
          refY="3.5"
          orient="auto"
        >
          <polygon points="0 0, 10 3.5, 0 7" fill="#3b82f6" />
        </marker>
      </defs>

      {screenSourcePositions.map((pos, index) => (
        <path
          key={index}
          d={`M ${pos.x} ${pos.y} Q ${(pos.x + screenMergePoint.x) / 2} ${pos.y} ${screenMergePoint.x} ${screenMergePoint.y}`}
          stroke="#3b82f6"
          strokeWidth="2"
          fill="none"
          strokeDasharray="5,5"
          opacity="0.7"
        />
      ))}

      <path
        d={`M ${screenMergePoint.x} ${screenMergePoint.y} L ${screenCurrentPosition.x} ${screenCurrentPosition.y}`}
        stroke="#3b82f6"
        strokeWidth="2"
        fill="none"
        strokeDasharray="5,5"
        markerEnd="url(#preview-arrowhead)"
      />

      <circle
        cx={screenMergePoint.x}
        cy={screenMergePoint.y}
        r="6"
        fill="#3b82f6"
        opacity="0.8"
      />
    </svg>
  );
}
