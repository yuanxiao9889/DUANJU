import { memo } from 'react';

import { useCanvasNodeById } from '@/features/canvas/hooks/useCanvasNodeGraph';
import { useCanvasStore } from '@/stores/canvasStore';
import { NodeActionToolbar } from './NodeActionToolbar';

export const SelectedNodeOverlay = memo(() => {
  const selectedNodeId = useCanvasStore((state) => state.selectedNodeId);
  const selectedNode = useCanvasNodeById(selectedNodeId ?? '');

  if (!selectedNode) {
    return null;
  }

  return (
    <>
      <NodeActionToolbar node={selectedNode} />
    </>
  );
});

SelectedNodeOverlay.displayName = 'SelectedNodeOverlay';
