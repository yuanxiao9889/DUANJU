import { memo } from 'react';
import { Position } from '@xyflow/react';
import { Film } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { CanvasHandle } from '@/features/canvas/ui/CanvasHandle';
import { NodeResizeHandle } from '@/features/canvas/ui/NodeResizeHandle';
import {
  CANVAS_NODE_TYPES,
  SCRIPT_STORYBOARD_TABLE_NODE_DEFAULT_HEIGHT,
  SCRIPT_STORYBOARD_TABLE_NODE_DEFAULT_WIDTH,
} from '@/features/canvas/domain/canvasNodes';
import type { ScriptStoryboardTableNodeData } from '@/features/canvas/domain/canvasNodes';
import { resolveNodeDisplayName } from '@/features/canvas/domain/nodeDisplay';
import { SmartDirectorStoryboardTable } from '@/features/canvas/ui/SmartDirectorStoryboardTable';
import { useCanvasStore } from '@/stores/canvasStore';

type ScriptStoryboardTableNodeProps = {
  id: string;
  data: ScriptStoryboardTableNodeData;
  selected?: boolean;
  width?: number;
  height?: number;
};

const MIN_NODE_WIDTH = 1280;
const MIN_NODE_HEIGHT = 560;
const MAX_NODE_WIDTH = 2400;
const MAX_NODE_HEIGHT = 1400;
const NODE_BASE_CLASS =
  'group relative overflow-visible rounded-[var(--node-radius)] border bg-surface-dark/90 transition-all duration-150';
const NODE_SELECTED_CLASS =
  'border-[#222222] shadow-[0_0_0_2px_rgba(34,34,34,0.38),0_4px_14px_rgba(15,23,42,0.12)] dark:border-white/70 dark:shadow-[0_0_0_2px_rgba(245,245,245,0.2),0_4px_14px_rgba(0,0,0,0.24)]';
const NODE_IDLE_CLASS =
  'border-[rgba(15,23,42,0.22)] hover:border-[rgba(15,23,42,0.34)] hover:shadow-[0_4px_16px_rgba(0,0,0,0.12)] dark:border-[rgba(255,255,255,0.22)] dark:hover:border-[rgba(255,255,255,0.34)] dark:hover:shadow-[0_4px_16px_rgba(0,0,0,0.25)]';
const HANDLE_CLASS = '!rounded-full !border-2 !border-surface-dark !bg-accent';

function resolveNodeDimension(value: number | undefined, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 1) {
    return Math.round(value);
  }
  return fallback;
}

export const ScriptStoryboardTableNode = memo(
  ({ id, data, selected, width, height }: ScriptStoryboardTableNodeProps) => {
    const { t } = useTranslation();
    const setSelectedNode = useCanvasStore((state) => state.setSelectedNode);
    const resolvedWidth = resolveNodeDimension(
      width,
      SCRIPT_STORYBOARD_TABLE_NODE_DEFAULT_WIDTH
    );
    const resolvedHeight = resolveNodeDimension(
      height,
      SCRIPT_STORYBOARD_TABLE_NODE_DEFAULT_HEIGHT
    );
    const resolvedTitle = resolveNodeDisplayName(CANVAS_NODE_TYPES.scriptStoryboardTable, data);

    return (
      <div
        className={`${NODE_BASE_CLASS} ${selected ? NODE_SELECTED_CLASS : NODE_IDLE_CLASS}`}
        style={{ width: resolvedWidth, height: resolvedHeight }}
        onClick={() => setSelectedNode(id)}
      >
        <CanvasHandle type="target" id="target" position={Position.Left} className={HANDLE_CLASS} />
        <CanvasHandle type="source" id="source" position={Position.Right} className={HANDLE_CLASS} />

        <div className="relative flex h-full flex-col overflow-hidden rounded-[var(--node-radius)] p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2 text-[11px] text-text-muted">
                <span className="rounded-full bg-bg-dark px-2.5 py-1">
                  {t(`scriptStoryboardTable.streamPhase.${data.streamState.phase}`)}
                </span>
                <span className="rounded-full bg-bg-dark px-2.5 py-1">
                  {t('scriptStoryboardTable.generatedRows', {
                    completed: data.streamState.completedRowCount,
                    total: data.streamState.totalRowCount || data.summary.rowCount,
                  })}
                </span>
              </div>
              <div className="mt-2 flex items-center gap-2">
                <Film className="h-4 w-4 text-text-muted" />
                <span className="truncate text-sm font-semibold text-text-dark">
                  {resolvedTitle}
                </span>
              </div>
              <div className="mt-1 line-clamp-2 text-xs leading-5 text-text-muted">
                {data.streamState.statusText
                  || data.sourceLabel
                  || t('scriptStoryboardTable.emptyHint')}
              </div>
            </div>

          </div>

          <div className="mt-3 min-h-0 flex-1">
            <SmartDirectorStoryboardTable
              nodeId={id}
              data={data}
              summary={data.summary}
              className="h-full"
            />
          </div>
        </div>

        <NodeResizeHandle
          minWidth={MIN_NODE_WIDTH}
          minHeight={MIN_NODE_HEIGHT}
          maxWidth={MAX_NODE_WIDTH}
          maxHeight={MAX_NODE_HEIGHT}
          isVisible={Boolean(selected)}
        />
      </div>
    );
  }
);

ScriptStoryboardTableNode.displayName = 'ScriptStoryboardTableNode';
