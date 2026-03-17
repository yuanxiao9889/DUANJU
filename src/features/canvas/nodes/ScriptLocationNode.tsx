import { memo, useState, useCallback } from 'react';
import { MapPin, Edit2, Check, X, Trash2 } from 'lucide-react';
import { CANVAS_NODE_TYPES, type ScriptLocationNodeData } from '@/features/canvas/domain/canvasNodes';
import { resolveNodeDisplayName } from '@/features/canvas/domain/nodeDisplay';
import { useCanvasStore } from '@/stores/canvasStore';

type ScriptLocationNodeProps = {
  id: string;
  data: ScriptLocationNodeData;
  selected?: boolean;
};

const DEFAULT_WIDTH = 280;

export const ScriptLocationNode = memo(({
  id,
  data,
  selected,
}: ScriptLocationNodeProps) => {
  const updateNodeData = useCanvasStore((state) => state.updateNodeData);
  const deleteNode = useCanvasStore((state) => state.deleteNode);
  const [isEditing, setIsEditing] = useState(false);
  const [editData, setEditData] = useState({
    name: data.name || '',
    description: data.description || '',
    appearances: data.appearances || [],
  });

  const resolvedTitle = resolveNodeDisplayName(CANVAS_NODE_TYPES.scriptLocation, data);

  const handleSaveEdit = useCallback(() => {
    updateNodeData(id, editData);
    setIsEditing(false);
  }, [id, editData, updateNodeData]);

  const handleCancelEdit = useCallback(() => {
    setEditData({
      name: data.name || '',
      description: data.description || '',
      appearances: data.appearances || [],
    });
    setIsEditing(false);
  }, [data]);

  const hasContent = data.description || (data.appearances && data.appearances.length > 0);

  return (
    <div
      className={`
        group relative overflow-visible rounded-[18px] border-2 transition-all duration-200
        ${selected
          ? 'border-green-500/50 shadow-[0_0_0_2px_rgba(34,197,94,0.25)] shadow-green-500/20'
          : 'border-green-500/20 hover:border-green-500/40'}
        bg-gradient-to-br from-green-950/30 via-slate-900/90 to-slate-900/95
      `}
      style={{ width: DEFAULT_WIDTH, minHeight: 120 }}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-green-500/20">
        <div className="p-1.5 rounded-lg bg-green-500/20">
          <MapPin className="w-4 h-4 text-green-400" />
        </div>
        <span className="flex-1 text-sm font-medium text-green-100 truncate">
          {data.name || resolvedTitle}
        </span>
        <button
          onClick={(e) => {
            e.stopPropagation();
            setIsEditing(!isEditing);
          }}
          className="flex items-center justify-center w-11 h-11 rounded-lg hover:bg-green-500/20 active:bg-green-500/30 transition-all duration-150"
          title="编辑"
        >
          <Edit2 className="w-4 h-4 text-green-400" />
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            deleteNode(id);
          }}
          className="flex items-center justify-center w-11 h-11 rounded-lg hover:bg-red-500/20 active:bg-red-500/40 transition-all duration-150 group/btn"
          title="从画布移除"
        >
          <Trash2 className="w-4 h-4 text-red-400 group-hover/btn:scale-110 transition-transform" />
        </button>
      </div>

      {/* Content */}
      <div className="p-3">
        {isEditing ? (
          <div className="space-y-2">
            <div>
              <label className="block text-xs text-green-300/70 mb-1">场景名称</label>
              <input
                type="text"
                value={editData.name}
                onChange={(e) => setEditData({ ...editData, name: e.target.value })}
                className="w-full px-2 py-1 text-sm bg-green-950/50 border border-green-500/30 rounded text-green-100 outline-none focus:border-green-400"
                placeholder="输入场景名称..."
              />
            </div>
            <div>
              <label className="block text-xs text-green-300/70 mb-1">描述</label>
              <textarea
                value={editData.description}
                onChange={(e) => setEditData({ ...editData, description: e.target.value })}
                className="w-full px-2 py-1 text-sm bg-green-950/50 border border-green-500/30 rounded text-green-100 outline-none focus:border-green-400 resize-none"
                rows={2}
                placeholder="场景描述..."
              />
            </div>
            <div>
              <label className="block text-xs text-green-300/70 mb-1">出现章节</label>
              <input
                type="text"
                value={editData.appearances.join(', ')}
                onChange={(e) => setEditData({ ...editData, appearances: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}
                className="w-full px-2 py-1 text-xs bg-green-950/50 border border-green-500/30 rounded text-green-100 outline-none focus:border-green-400"
                placeholder="章节1, 章节2, 章节3"
              />
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button
                onClick={handleCancelEdit}
                className="px-2 py-1 text-xs rounded bg-slate-700/50 text-slate-300 hover:bg-slate-600/50 transition-colors"
              >
                <X className="w-3 h-3 inline mr-1" />
                取消
              </button>
              <button
                onClick={handleSaveEdit}
                className="px-2 py-1 text-xs rounded bg-green-500/30 text-green-200 hover:bg-green-500/40 transition-colors"
              >
                <Check className="w-3 h-3 inline mr-1" />
                保存
              </button>
            </div>
          </div>
        ) : (
          <>
            {hasContent ? (
              <div className="space-y-1.5 text-xs">
                {data.description && (
                  <p className="text-green-100/80 leading-relaxed">{data.description}</p>
                )}
                {data.appearances && data.appearances.length > 0 && (
                  <div className="flex gap-1.5 pt-1">
                    <span className="text-green-400/60">出现章节:</span>
                    <span className="text-green-100/70">{data.appearances.join(', ')}</span>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center py-2 text-green-300/50 text-xs">
                点击编辑按钮添加场景信息
              </div>
            )}
          </>
        )}
      </div>

      {/* Decorative corner accent */}
      <div className="absolute top-0 right-0 w-8 h-8 overflow-hidden rounded-tr-[16px]">
        <div className="absolute -top-4 -right-4 w-8 h-8 bg-green-500/10 rotate-45" />
      </div>
    </div>
  );
});

ScriptLocationNode.displayName = 'ScriptLocationNode';
