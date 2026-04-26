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
      className={`relative min-w-[320px] rounded-[18px] border-2 transition-all duration-200 ${
        selected
          ? 'border-amber-500/50 shadow-[0_0_0_2px_rgba(245,158,11,0.25)] shadow-amber-500/20'
          : 'border-amber-500/20 hover:border-amber-500/40'
      }`}
      style={{
        background: 'linear-gradient(135deg, rgb(79 52 10) 0%, rgb(15 23 42) 50%, rgb(15 23 42) 100%)',
      }}
    >
      <Handle
        type="target"
        id="target"
        position={Position.Left}
        className="!h-3 !w-3 !border-surface-dark !bg-amber-400"
      />
      
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-amber-500/20">
        <div className="p-2 rounded-xl bg-amber-500/20">
          <FileText className="w-5 h-5 text-amber-400" />
        </div>
        <div className="flex-1 min-w-0">
          {isEditing ? (
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                placeholder="输入剧本名称"
                className="flex-1 px-2 py-1 text-lg font-bold bg-amber-950/50 border border-amber-500/30 rounded-lg text-amber-100 outline-none focus:border-amber-400"
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
                className="p-1.5 rounded-lg bg-amber-500/30 text-amber-200 hover:bg-amber-500/40"
              >
                <Check className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold text-amber-100 truncate">
                {data.title || resolvedTitle}
              </h2>
              <button
                onClick={() => {
                  setEditTitle(data.title || '');
                  setIsEditing(true);
                }}
                className="p-1 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-amber-500/20 transition-opacity"
              >
                <Edit2 className="w-3.5 h-3.5 text-amber-400" />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="px-4 py-3 flex items-center gap-4 text-xs text-amber-300/60">
        <div className="flex items-center gap-1.5">
          <span className="font-medium text-amber-400">{data.totalChapters || 0}</span>
          <span>章节</span>
        </div>
        {data.genre && (
          <div className="flex items-center gap-1.5">
            <span className="px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 text-xs">
              {data.genre}
            </span>
          </div>
        )}
      </div>

      <Handle
        type="source"
        id="source"
        position={Position.Right}
        className="!h-3 !w-3 !border-surface-dark !bg-amber-400"
      />

      {/* Decorative corner accent */}
      <div className="absolute top-0 right-0 w-10 h-10 overflow-hidden rounded-tr-[16px]">
        <div className="absolute -top-5 -right-5 w-10 h-10 bg-amber-500/10 rotate-45" />
      </div>
    </div>
  );
});

ScriptRootNode.displayName = 'ScriptRootNode';
