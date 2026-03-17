import { memo, useState, useCallback } from 'react';
import { Link2, Edit2, Check, X, Trash2 } from 'lucide-react';
import type { ScriptPlotPointNodeData } from '@/features/canvas/domain/canvasNodes';
import { useCanvasStore } from '@/stores/canvasStore';

type ScriptPlotPointNodeProps = {
  id: string;
  data: ScriptPlotPointNodeData;
  selected?: boolean;
};

const DEFAULT_WIDTH = 280;

export const ScriptPlotPointNode = memo(({
  id,
  data,
  selected,
}: ScriptPlotPointNodeProps) => {
  const updateNodeData = useCanvasStore((state) => state.updateNodeData);
  const deleteNode = useCanvasStore((state) => state.deleteNode);
  const [isEditing, setIsEditing] = useState(false);
  const [editData, setEditData] = useState({
    pointType: data.pointType || 'setup',
    description: data.description || '',
  });

  const isSetup = data.pointType === 'setup';

  const handleSaveEdit = useCallback(() => {
    updateNodeData(id, editData);
    setIsEditing(false);
  }, [id, editData, updateNodeData]);

  const handleCancelEdit = useCallback(() => {
    setEditData({
      pointType: data.pointType || 'setup',
      description: data.description || '',
    });
    setIsEditing(false);
  }, [data]);

  return (
    <div
      className={`
        group relative overflow-visible rounded-[18px] border-2 transition-all duration-200
        ${selected
          ? 'border-pink-500/50 shadow-[0_0_0_2px_rgba(236,72,153,0.25)] shadow-pink-500/20'
          : 'border-pink-500/20 hover:border-pink-500/40'}
        bg-gradient-to-br from-pink-950/30 via-slate-900/90 to-slate-900/95
      `}
      style={{ width: DEFAULT_WIDTH, minHeight: 120 }}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-pink-500/20">
        <div className="p-1.5 rounded-lg bg-pink-500/20">
          <Link2 className="w-4 h-4 text-pink-400" />
        </div>
        <span className="flex-1 text-sm font-medium text-pink-100 truncate">
          {isSetup ? '🔗 伏笔' : '✅ 响应'}
        </span>
        <button
          onClick={(e) => {
            e.stopPropagation();
            setIsEditing(!isEditing);
          }}
          className="flex items-center justify-center w-11 h-11 rounded-lg hover:bg-pink-500/20 active:bg-pink-500/30 transition-all duration-150"
          title="编辑"
        >
          <Edit2 className="w-4 h-4 text-pink-400" />
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
              <label className="block text-xs text-pink-300/70 mb-1">类型</label>
              <select
                value={editData.pointType}
                onChange={(e) => setEditData({ ...editData, pointType: e.target.value as 'setup' | 'payoff' })}
                className="w-full px-2 py-1.5 text-sm bg-pink-950/50 border border-pink-500/30 rounded text-pink-100 outline-none focus:border-pink-400"
              >
                <option value="setup">🔗 伏笔</option>
                <option value="payoff">✅ 响应</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-pink-300/70 mb-1">描述</label>
              <textarea
                value={editData.description}
                onChange={(e) => setEditData({ ...editData, description: e.target.value })}
                className="w-full px-2 py-1 text-sm bg-pink-950/50 border border-pink-500/30 rounded text-pink-100 outline-none focus:border-pink-400 resize-none"
                rows={3}
                placeholder="描述这个埋点..."
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
                className="px-2 py-1 text-xs rounded bg-pink-500/30 text-pink-200 hover:bg-pink-500/40 transition-colors"
              >
                <Check className="w-3 h-3 inline mr-1" />
                保存
              </button>
            </div>
          </div>
        ) : (
          <>
            {data.description ? (
              <p className="text-xs text-pink-100/80 leading-relaxed">{data.description}</p>
            ) : (
              <div className="text-center py-2 text-pink-300/50 text-xs">
                点击编辑按钮添加埋点信息
              </div>
            )}
          </>
        )}
      </div>

      {/* Decorative corner accent */}
      <div className="absolute top-0 right-0 w-8 h-8 overflow-hidden rounded-tr-[16px]">
        <div className="absolute -top-4 -right-4 w-8 h-8 bg-pink-500/10 rotate-45" />
      </div>
    </div>
  );
});

ScriptPlotPointNode.displayName = 'ScriptPlotPointNode';
