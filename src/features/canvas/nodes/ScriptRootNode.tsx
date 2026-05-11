import { memo, useState, useCallback } from 'react';
import { Handle, Position } from '@xyflow/react';
import { FileText, Edit2, Check, X } from 'lucide-react';
import { CANVAS_NODE_TYPES, type ScriptRootNodeData } from '@/features/canvas/domain/canvasNodes';
import { resolveNodeDisplayName } from '@/features/canvas/domain/nodeDisplay';
import { useCanvasStore } from '@/stores/canvasStore';

type ScriptRootNodeProps = {
  id: string;
  data: ScriptRootNodeData;
  selected?: boolean;
};

export const ScriptRootNode = memo(({ id, data, selected }: ScriptRootNodeProps) => {
  const updateNodeData = useCanvasStore((state) => state.updateNodeData);
  const resolvedTitle = resolveNodeDisplayName(CANVAS_NODE_TYPES.scriptRoot, data);
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(data.title || '');

  const handleSaveEdit = useCallback(() => {
    updateNodeData(id, { title: editTitle });
    setIsEditing(false);
  }, [id, editTitle, updateNodeData]);

  const handleCancelEdit = useCallback(() => {
    setEditTitle(data.title || '');
    setIsEditing(false);
  }, [data.title]);

  return (
    <div
      className={`group relative min-w-[320px] rounded-[18px] border bg-surface-dark shadow-[0_12px_24px_rgba(2,6,23,0.12)] transition-all duration-200 dark:shadow-[0_14px_28px_rgba(0,0,0,0.24)] ${
        selected
          ? 'border-[rgba(15,23,42,0.42)] dark:border-white/36'
          : 'border-[rgba(15,23,42,0.2)] hover:border-[rgba(15,23,42,0.34)] dark:border-white/18 dark:hover:border-white/30'
      }`}
    >
      <Handle
        type="target"
        id="target"
        position={Position.Left}
        className="!h-3 !w-3 !border-surface-dark !bg-[#222222] dark:!bg-text-muted"
      />
      
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-border-dark px-4 py-3">
        <div className="rounded-xl border border-border-dark bg-bg-dark p-2">
          <FileText className="h-5 w-5 text-text-muted" />
        </div>
        <div className="flex-1 min-w-0">
          {isEditing ? (
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                placeholder="输入剧本名称"
                className="flex-1 rounded-lg border border-border-dark bg-bg-dark px-2 py-1 text-lg font-bold text-text-dark outline-none focus:border-text-muted/60"
                autoFocus
              />
              <button
                onClick={handleCancelEdit}
                className="p-1.5 rounded-lg bg-slate-700/50 text-slate-300 hover:bg-slate-600/50"
              >
                <X className="w-4 h-4" />
              </button>
              <button
                onClick={handleSaveEdit}
                className="rounded-lg border border-border-dark bg-bg-dark p-1.5 text-text-dark hover:bg-bg-dark/80"
              >
                <Check className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <h2 className="truncate text-lg font-bold text-text-dark">
                {data.title || resolvedTitle}
              </h2>
              <button
                onClick={() => {
                  setEditTitle(data.title || '');
                  setIsEditing(true);
                }}
                className="rounded-lg p-1 opacity-0 transition-opacity hover:bg-bg-dark group-hover:opacity-100"
              >
                <Edit2 className="h-3.5 w-3.5 text-text-muted" />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="flex items-center gap-4 px-4 py-3 text-xs text-text-muted">
        <div className="flex items-center gap-1.5">
          <span className="font-medium text-text-dark">{data.totalChapters || 0}</span>
          <span>章节</span>
        </div>
        {data.genre && (
          <div className="flex items-center gap-1.5">
            <span className="rounded-full bg-bg-dark px-2 py-0.5 text-xs text-text-muted">
              {data.genre}
            </span>
          </div>
        )}
      </div>

      <Handle
        type="source"
        id="source"
        position={Position.Right}
        className="!h-3 !w-3 !border-surface-dark !bg-[#222222] dark:!bg-text-muted"
      />

      {/* Decorative corner accent */}
      <div className="absolute right-0 top-0 h-10 w-10 overflow-hidden rounded-tr-[16px]">
        <div className="absolute -right-5 -top-5 h-10 w-10 rotate-45 bg-border-dark/40" />
      </div>
    </div>
  );
});

ScriptRootNode.displayName = 'ScriptRootNode';
