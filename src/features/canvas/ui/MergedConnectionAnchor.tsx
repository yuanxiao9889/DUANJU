import { useMemo } from 'react';
import type { Node } from '@xyflow/react';
import { useCanvasStore } from '@/stores/canvasStore';
import { getMergedAnchorPosition } from '../application/nodeBounds';

interface MergedConnectionAnchorProps {
  selectedNodes: Node[];
  onMouseDown: (e: React.MouseEvent) => void;
}

export function MergedConnectionAnchor({ 
  selectedNodes, 
  onMouseDown 
}: MergedConnectionAnchorProps) {
  const viewport = useCanvasStore((state) => state.currentViewport);
  const anchorPosition = useMemo(() => {
    if (selectedNodes.length < 2) return null;
    return getMergedAnchorPosition(selectedNodes, 'right');
  }, [selectedNodes]);

  if (!anchorPosition || selectedNodes.length < 2) return null;

  const screenX = anchorPosition.x * viewport.zoom + viewport.x;
  const screenY = anchorPosition.y * viewport.zoom + viewport.y;

  return (
    <div
      className="absolute flex items-center justify-center cursor-pointer"
      style={{
        left: screenX,
        top: screenY,
        transform: 'translate(-50%, -50%)',
        zIndex: 1000,
      }}
      onMouseDown={onMouseDown}
    >
      <div
        className="flex items-center justify-center rounded-full bg-accent shadow-lg transition-transform hover:scale-110"
        style={{
          width: '32px',
          height: '32px',
        }}
      >
        <svg 
          width="18" 
          height="18" 
          viewBox="0 0 24 24" 
          fill="none" 
          stroke="white" 
          strokeWidth="2.5"
        >
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      </div>
      <div
        className="absolute -top-1 -right-1 flex items-center justify-center rounded-full bg-blue-500 text-white"
        style={{
          width: '18px',
          height: '18px',
          fontSize: '10px',
          fontWeight: 'bold',
        }}
      >
        {selectedNodes.length}
      </div>
    </div>
  );
}
