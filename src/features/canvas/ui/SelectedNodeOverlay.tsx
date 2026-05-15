import { memo, useMemo, useRef } from 'react';

import { useCanvasNodeById } from '@/features/canvas/hooks/useCanvasNodeGraph';
import { useCanvasStore } from '@/stores/canvasStore';
import { NodeActionToolbar } from './NodeActionToolbar';

export const SelectedNodeOverlay = memo(() => {
  const selectedNodeId = useCanvasStore((state) => state.selectedNodeId);
  const selectedNode = useCanvasNodeById(selectedNodeId ?? '');
  const toolbarNodeRef = useRef(selectedNode);
  const toolbarNode = useMemo(() => {
    const previousNode = toolbarNodeRef.current;
    if (!selectedNode) {
      toolbarNodeRef.current = null;
      return null;
    }

    if (
      previousNode
      && previousNode.id === selectedNode.id
      && previousNode.type === selectedNode.type
      && previousNode.data === selectedNode.data
      && previousNode.parentId === selectedNode.parentId
      && previousNode.selected === selectedNode.selected
    ) {
      return previousNode;
    }

    toolbarNodeRef.current = selectedNode;
    return selectedNode;
  }, [selectedNode]);

  if (!toolbarNode) {
    return null;
  }

  return (
    <>
      <NodeActionToolbar node={toolbarNode} />
    </>
  );
});

SelectedNodeOverlay.displayName = 'SelectedNodeOverlay';
