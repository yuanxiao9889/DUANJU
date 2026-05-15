import { memo, useMemo, } from 'react';
import type { NodeProps } from '@xyflow/react';
import { Image as ImageIcon } from 'lucide-react';
import {
  CANVAS_NODE_TYPES,
  IMAGE_COMPARE_NODE_DEFAULT_HEIGHT,
  IMAGE_COMPARE_NODE_DEFAULT_WIDTH,
  EXPORT_RESULT_NODE_MIN_HEIGHT,
  EXPORT_RESULT_NODE_MIN_WIDTH,
  type ImageCompareNodeData,
} from '@/features/canvas/domain/canvasNodes';
import { resolveNodeDisplayName } from '@/features/canvas/domain/nodeDisplay';
import { ImageCompareStage } from '@/features/canvas/ui/ImageCompareStage';
import { NodeHeader, NODE_HEADER_FLOATING_POSITION_CLASS } from '@/features/canvas/ui/NodeHeader';
import { NodeResizeHandle } from '@/features/canvas/ui/NodeResizeHandle';
import { useCanvasStore } from '@/stores/canvasStore';

type ImageCompareNodeProps = NodeProps & {
  id: string;
  data: ImageCompareNodeData;
  selected?: boolean;
};

function resolveNodeDimension(value: number | undefined, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 1) {
    return Math.round(value);
  }

  return fallback;
}

export const ImageCompareNode = memo(({
  id,
  data,
  selected,
  width,
  height,
}: ImageCompareNodeProps) => {
  const setSelectedNode = useCanvasStore((state) => state.setSelectedNode);
  const updateNodeData = useCanvasStore((state) => state.updateNodeData);
  const openImageCompareViewer = useCanvasStore((state) => state.openImageCompareViewer);
  const resolvedWidth = resolveNodeDimension(width, IMAGE_COMPARE_NODE_DEFAULT_WIDTH);
  const resolvedHeight = resolveNodeDimension(height, IMAGE_COMPARE_NODE_DEFAULT_HEIGHT);
  const resolvedTitle = useMemo(
    () => resolveNodeDisplayName(CANVAS_NODE_TYPES.imageCompare, data),
    [data]
  );

  return (
    <div
      className={`
        group relative flex flex-col overflow-visible rounded-[var(--node-radius)] border bg-surface-dark/85 p-0 transition-all duration-150
        ${selected
          ? 'border-accent shadow-[0_0_0_2px_rgba(59,130,246,0.5),0_4px_20px_rgba(59,130,246,0.2)]'
          : 'border-[rgba(15,23,42,0.22)] hover:border-[rgba(15,23,42,0.34)] hover:shadow-[0_4px_16px_rgba(0,0,0,0.12)] dark:border-[rgba(255,255,255,0.22)] dark:hover:border-[rgba(255,255,255,0.34)] dark:hover:shadow-[0_4px_16px_rgba(0,0,0,0.25)]'}
      `}
      style={{ width: resolvedWidth, height: resolvedHeight }}
      onClick={() => setSelectedNode(id)}
    >
      <NodeHeader
        className={NODE_HEADER_FLOATING_POSITION_CLASS}
        icon={<ImageIcon className="h-4 w-4" />}
        titleText={resolvedTitle}
        titleClassName="inline-block max-w-[220px] truncate whitespace-nowrap align-bottom"
        editable
        onTitleChange={(nextTitle) => updateNodeData(id, { displayName: nextTitle })}
      />

      <ImageCompareStage
        baseImage={data.baseImage}
        overlayImage={data.overlayImage}
        dividerRatio={data.dividerRatio}
        className="min-h-0 flex-1 rounded-[var(--node-radius)]"
        onDividerDragStart={() => setSelectedNode(id)}
        onDividerRatioCommit={(nextRatio) => updateNodeData(id, { dividerRatio: nextRatio })}
        onDoubleClick={() => openImageCompareViewer(id)}
      />

      <NodeResizeHandle
        minWidth={EXPORT_RESULT_NODE_MIN_WIDTH}
        minHeight={EXPORT_RESULT_NODE_MIN_HEIGHT}
        maxWidth={1600}
        maxHeight={1600}
        isVisible={selected}
      />
    </div>
  );
});

ImageCompareNode.displayName = 'ImageCompareNode';
