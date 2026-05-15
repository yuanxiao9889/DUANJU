import { memo, useMemo } from 'react';
import { LayoutGrid } from 'lucide-react';

import { NodeHeader, NODE_HEADER_FLOATING_POSITION_CLASS } from '@/features/canvas/ui/NodeHeader';
import { NodeResizeHandle } from '@/features/canvas/ui/NodeResizeHandle';
import { CANVAS_NODE_TYPES, type GroupNodeData } from '@/features/canvas/domain/canvasNodes';
import { resolveNodeDisplayName } from '@/features/canvas/domain/nodeDisplay';
import { useCanvasStore } from '@/stores/canvasStore';

type GroupNodeProps = {
  id: string;
  data: GroupNodeData;
  selected?: boolean;
};

export const GroupNode = memo(({ id, data, selected }: GroupNodeProps) => {
  const updateNodeData = useCanvasStore((state) => state.updateNodeData);
  const resolvedTitle = useMemo(
    () => resolveNodeDisplayName(CANVAS_NODE_TYPES.group, data),
    [data]
  );
  const isPlotLinePanel = data.visualStyle === 'scriptPlotLinePanel';

  return (
    <div
      className={`group relative h-full w-full overflow-visible border ${
        isPlotLinePanel
          ? selected
            ? 'rounded-[26px] border-[#f0a34b]/28 bg-[#151515]/94 shadow-[0_0_0_1px_rgba(240,163,75,0.12),0_18px_44px_rgba(0,0,0,0.24)]'
            : 'rounded-[26px] border-[#f0a34b]/18 bg-[#151515]/88 shadow-[0_12px_36px_rgba(0,0,0,0.18)]'
          : selected
            ? 'rounded-[18px] border-accent shadow-[0_0_0_1px_rgba(59,130,246,0.35)]'
            : 'rounded-[18px] border-[rgba(15,23,42,0.2)] dark:border-[rgba(255,255,255,0.26)]'
      }`}
      style={{
        backgroundColor: isPlotLinePanel ? undefined : 'var(--group-node-bg)',
      }}
    >
      {isPlotLinePanel ? (
        <div className="pointer-events-none absolute inset-0 rounded-[26px] bg-[radial-gradient(circle_at_top_left,rgba(255,178,92,0.08),transparent_28%),linear-gradient(180deg,rgba(255,255,255,0.03),transparent_52%)]" />
      ) : null}
      <NodeHeader
        className={NODE_HEADER_FLOATING_POSITION_CLASS}
        icon={<LayoutGrid className="h-4 w-4" />}
        titleText={resolvedTitle}
        titleClassName={isPlotLinePanel ? 'text-[#f0a34b]' : undefined}
        editable
        onTitleChange={(nextTitle) => updateNodeData(id, {
          displayName: nextTitle,
          label: nextTitle,
        })}
      />
      <NodeResizeHandle minWidth={220} minHeight={140} maxWidth={2200} maxHeight={1600} isVisible={selected} />
    </div>
  );
});

GroupNode.displayName = 'GroupNode';
