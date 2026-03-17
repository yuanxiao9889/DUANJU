import { memo, useState, useCallback } from 'react';
import { User, Edit2, Check, X, Trash2 } from 'lucide-react';
import { CANVAS_NODE_TYPES, type ScriptCharacterNodeData } from '@/features/canvas/domain/canvasNodes';
import { resolveNodeDisplayName } from '@/features/canvas/domain/nodeDisplay';
import { useCanvasStore } from '@/stores/canvasStore';

type ScriptCharacterNodeProps = {
  id: string;
  data: ScriptCharacterNodeData;
  selected?: boolean;
};

const DEFAULT_WIDTH = 280;

export const ScriptCharacterNode = memo(({
  id,
  data,
  selected,
}: ScriptCharacterNodeProps) => {
  const updateNodeData = useCanvasStore((state) => state.updateNodeData);
  const deleteNode = useCanvasStore((state) => state.deleteNode);
  const [isEditing, setIsEditing] = useState(false);
  const [editData, setEditData] = useState({
    name: data.name || '',
    description: data.description || '',
    personality: data.personality || '',
    appearance: data.appearance || '',
  });

  const resolvedTitle = resolveNodeDisplayName(CANVAS_NODE_TYPES.scriptCharacter, data);

  const handleSaveEdit = useCallback(() => {
    updateNodeData(id, editData);
    setIsEditing(false);
  }, [id, editData, updateNodeData]);

  const handleCancelEdit = useCallback(() => {
    setEditData({
      name: data.name || '',
      description: data.description || '',
      personality: data.personality || '',
      appearance: data.appearance || '',
    });
    setIsEditing(false);
  }, [data]);

  const hasContent = data.description || data.personality || data.appearance;

  return (
    <div
      className={`
        group relative overflow-visible rounded-[18px] border-2 transition-all duration-200
        ${selected
          ? 'border-purple-500/50 shadow-[0_0_0_2px_rgba(168,85,247,0.25)] shadow-purple-500/20'
          : 'border-purple-500/20 hover:border-purple-500/40'}
        bg-gradient-to-br from-purple-950/30 via-slate-900/90 to-slate-900/95
      `}
      style={{ width: DEFAULT_WIDTH, minHeight: 120 }}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-purple-500/20">
        <div className="p-1.5 rounded-lg bg-purple-500/20">
          <User className="w-4 h-4 text-purple-400" />
        </div>
        <span className="flex-1 text-sm font-medium text-purple-100 truncate">
          {data.name || resolvedTitle}
        </span>
        <button
          onClick={(e) => {
            e.stopPropagation();
            setIsEditing(!isEditing);
          }}
          className="flex items-center justify-center w-11 h-11 rounded-lg hover:bg-purple-500/20 active:bg-purple-500/30 transition-all duration-150"
          title="编辑"
        >
          <Edit2 className="w-4 h-4 text-purple-400" />
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
              <label className="block text-xs text-purple-300/70 mb-1">角色名称</label>
              <input
                type="text"
                value={editData.name}
                onChange={(e) => setEditData({ ...editData, name: e.target.value })}
                className="w-full px-2 py-1 text-sm bg-purple-950/50 border border-purple-500/30 rounded text-purple-100 outline-none focus:border-purple-400"
                placeholder="输入角色名称..."
              />
            </div>
            <div>
              <label className="block text-xs text-purple-300/70 mb-1">描述</label>
              <textarea
                value={editData.description}
                onChange={(e) => setEditData({ ...editData, description: e.target.value })}
                className="w-full px-2 py-1 text-sm bg-purple-950/50 border border-purple-500/30 rounded text-purple-100 outline-none focus:border-purple-400 resize-none"
                rows={2}
                placeholder="角色简介..."
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs text-purple-300/70 mb-1">性格</label>
                <input
                  type="text"
                  value={editData.personality}
                  onChange={(e) => setEditData({ ...editData, personality: e.target.value })}
                  className="w-full px-2 py-1 text-xs bg-purple-950/50 border border-purple-500/30 rounded text-purple-100 outline-none focus:border-purple-400"
                  placeholder="性格特点..."
                />
              </div>
              <div>
                <label className="block text-xs text-purple-300/70 mb-1">外貌</label>
                <input
                  type="text"
                  value={editData.appearance}
                  onChange={(e) => setEditData({ ...editData, appearance: e.target.value })}
                  className="w-full px-2 py-1 text-xs bg-purple-950/50 border border-purple-500/30 rounded text-purple-100 outline-none focus:border-purple-400"
                  placeholder="外貌特征..."
                />
              </div>
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
                className="px-2 py-1 text-xs rounded bg-purple-500/30 text-purple-200 hover:bg-purple-500/40 transition-colors"
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
                  <p className="text-purple-100/80 leading-relaxed">{data.description}</p>
                )}
                <div className="grid grid-cols-2 gap-x-3 gap-y-1 pt-1">
                  {data.personality && (
                    <div className="flex gap-1.5">
                      <span className="text-purple-400/60">性格:</span>
                      <span className="text-purple-100/70">{data.personality}</span>
                    </div>
                  )}
                  {data.appearance && (
                    <div className="flex gap-1.5">
                      <span className="text-purple-400/60">外貌:</span>
                      <span className="text-purple-100/70">{data.appearance}</span>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="text-center py-2 text-purple-300/50 text-xs">
                点击编辑按钮添加角色信息
              </div>
            )}
          </>
        )}
      </div>

      {/* Decorative corner accent */}
      <div className="absolute top-0 right-0 w-8 h-8 overflow-hidden rounded-tr-[16px]">
        <div className="absolute -top-4 -right-4 w-8 h-8 bg-purple-500/10 rotate-45" />
      </div>
    </div>
  );
});

ScriptCharacterNode.displayName = 'ScriptCharacterNode';
