import { memo, useState, useCallback } from 'react';
import { Globe, Edit2, Check, X, Trash2 } from 'lucide-react';
import { CANVAS_NODE_TYPES, type ScriptWorldviewNodeData } from '@/features/canvas/domain/canvasNodes';
import { resolveNodeDisplayName } from '@/features/canvas/domain/nodeDisplay';
import { useCanvasStore } from '@/stores/canvasStore';

type ScriptWorldviewNodeProps = {
  id: string;
  data: ScriptWorldviewNodeData;
  selected?: boolean;
};

const DEFAULT_WIDTH = 320;
const MIN_HEIGHT = 150;

export const ScriptWorldviewNode = memo(({
  id,
  data,
  selected,
}: ScriptWorldviewNodeProps) => {
  const setSelectedNode = useCanvasStore((state) => state.setSelectedNode);
  const updateNodeData = useCanvasStore((state) => state.updateNodeData);
  const deleteNode = useCanvasStore((state) => state.deleteNode);
  const [isEditing, setIsEditing] = useState(false);
  const [editData, setEditData] = useState({
    worldviewName: data.worldviewName || '',
    description: data.description || '',
    era: data.era || '',
    technology: data.technology || '',
    magic: data.magic || '',
    society: data.society || '',
    geography: data.geography || '',
  });

  const resolvedTitle = resolveNodeDisplayName(CANVAS_NODE_TYPES.scriptWorldview, data);

  const handleSaveEdit = useCallback(() => {
    updateNodeData(id, editData);
    setIsEditing(false);
  }, [id, editData, updateNodeData]);

  const handleCancelEdit = useCallback(() => {
    setEditData({
      worldviewName: data.worldviewName || '',
      description: data.description || '',
      era: data.era || '',
      technology: data.technology || '',
      magic: data.magic || '',
      society: data.society || '',
      geography: data.geography || '',
    });
    setIsEditing(false);
  }, [data]);

  const hasContent = data.description || data.era || data.technology || data.magic || data.society || data.geography;

  return (
    <div
      className={`
        group relative overflow-visible rounded-[18px] border-2 transition-all duration-200
        ${selected
          ? 'border-cyan-500/50 shadow-[0_0_0_2px_rgba(6,182,212,0.25)] shadow-cyan-500/20'
          : 'border-cyan-500/20 hover:border-cyan-500/40'}
        bg-gradient-to-br from-cyan-950/30 via-slate-900/90 to-slate-900/95
      `}
      style={{ width: DEFAULT_WIDTH, minHeight: MIN_HEIGHT }}
      onClick={() => setSelectedNode(id)}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-cyan-500/20">
        <div className="p-1.5 rounded-lg bg-cyan-500/20">
          <Globe className="w-4 h-4 text-cyan-400" />
        </div>
        <span className="flex-1 text-sm font-medium text-cyan-100 truncate">
          {data.worldviewName || resolvedTitle}
        </span>
        <button
          onClick={(e) => {
            e.stopPropagation();
            setIsEditing(!isEditing);
          }}
          className="flex items-center justify-center w-11 h-11 rounded-lg hover:bg-cyan-500/20 active:bg-cyan-500/30 transition-all duration-150"
          title="编辑"
        >
          <Edit2 className="w-4 h-4 text-cyan-400" />
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
      <div className="p-3 space-y-2">
        {isEditing ? (
          <div className="space-y-2">
            <div>
              <label className="block text-xs text-cyan-300/70 mb-1">世界观名称</label>
              <input
                type="text"
                value={editData.worldviewName}
                onChange={(e) => setEditData({ ...editData, worldviewName: e.target.value })}
                className="w-full px-2 py-1 text-sm bg-cyan-950/50 border border-cyan-500/30 rounded text-cyan-100 outline-none focus:border-cyan-400"
                placeholder="输入世界观名称..."
              />
            </div>
            <div>
              <label className="block text-xs text-cyan-300/70 mb-1">概述</label>
              <textarea
                value={editData.description}
                onChange={(e) => setEditData({ ...editData, description: e.target.value })}
                className="w-full px-2 py-1 text-sm bg-cyan-950/50 border border-cyan-500/30 rounded text-cyan-100 outline-none focus:border-cyan-400 resize-none"
                rows={2}
                placeholder="描述这个世界的基本设定..."
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs text-cyan-300/70 mb-1">时代背景</label>
                <input
                  type="text"
                  value={editData.era}
                  onChange={(e) => setEditData({ ...editData, era: e.target.value })}
                  className="w-full px-2 py-1 text-xs bg-cyan-950/50 border border-cyan-500/30 rounded text-cyan-100 outline-none focus:border-cyan-400"
                  placeholder="如：中世纪、未来..."
                />
              </div>
              <div>
                <label className="block text-xs text-cyan-300/70 mb-1">科技水平</label>
                <input
                  type="text"
                  value={editData.technology}
                  onChange={(e) => setEditData({ ...editData, technology: e.target.value })}
                  className="w-full px-2 py-1 text-xs bg-cyan-950/50 border border-cyan-500/30 rounded text-cyan-100 outline-none focus:border-cyan-400"
                  placeholder="如：蒸汽朋克、高科技..."
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs text-cyan-300/70 mb-1">魔法/超自然</label>
                <input
                  type="text"
                  value={editData.magic}
                  onChange={(e) => setEditData({ ...editData, magic: e.target.value })}
                  className="w-full px-2 py-1 text-xs bg-cyan-950/50 border border-cyan-500/30 rounded text-cyan-100 outline-none focus:border-cyan-400"
                  placeholder="如：元素魔法、无魔法..."
                />
              </div>
              <div>
                <label className="block text-xs text-cyan-300/70 mb-1">社会结构</label>
                <input
                  type="text"
                  value={editData.society}
                  onChange={(e) => setEditData({ ...editData, society: e.target.value })}
                  className="w-full px-2 py-1 text-xs bg-cyan-950/50 border border-cyan-500/30 rounded text-cyan-100 outline-none focus:border-cyan-400"
                  placeholder="如：封建制、民主制..."
                />
              </div>
            </div>
            <div>
              <label className="block text-xs text-cyan-300/70 mb-1">地理环境</label>
              <input
                type="text"
                value={editData.geography}
                onChange={(e) => setEditData({ ...editData, geography: e.target.value })}
                className="w-full px-2 py-1 text-xs bg-cyan-950/50 border border-cyan-500/30 rounded text-cyan-100 outline-none focus:border-cyan-400"
                placeholder="如：大陆、岛屿、太空..."
              />
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button
                onClick={handleCancelEdit}
                className="px-3 py-1.5 text-xs rounded-lg bg-slate-700/50 text-slate-300 hover:bg-slate-600/50 transition-colors"
              >
                <X className="w-3 h-3 inline mr-1" />
                取消
              </button>
              <button
                onClick={handleSaveEdit}
                className="px-3 py-1.5 text-xs rounded-lg bg-cyan-500/30 text-cyan-200 hover:bg-cyan-500/40 transition-colors"
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
                  <p className="text-cyan-100/80 leading-relaxed">{data.description}</p>
                )}
                <div className="grid grid-cols-2 gap-x-3 gap-y-1 pt-1">
                  {data.era && (
                    <div className="flex gap-1.5">
                      <span className="text-cyan-400/60">时代:</span>
                      <span className="text-cyan-100/70">{data.era}</span>
                    </div>
                  )}
                  {data.technology && (
                    <div className="flex gap-1.5">
                      <span className="text-cyan-400/60">科技:</span>
                      <span className="text-cyan-100/70">{data.technology}</span>
                    </div>
                  )}
                  {data.magic && (
                    <div className="flex gap-1.5">
                      <span className="text-cyan-400/60">魔法:</span>
                      <span className="text-cyan-100/70">{data.magic}</span>
                    </div>
                  )}
                  {data.society && (
                    <div className="flex gap-1.5">
                      <span className="text-cyan-400/60">社会:</span>
                      <span className="text-cyan-100/70">{data.society}</span>
                    </div>
                  )}
                  {data.geography && (
                    <div className="flex gap-1.5 col-span-2">
                      <span className="text-cyan-400/60">地理:</span>
                      <span className="text-cyan-100/70">{data.geography}</span>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="text-center py-4 text-cyan-300/50 text-xs">
                点击编辑按钮添加世界观设定
              </div>
            )}
          </>
        )}
      </div>

      {/* Decorative corner accent */}
      <div className="absolute top-0 right-0 w-8 h-8 overflow-hidden rounded-tr-[16px]">
        <div className="absolute -top-4 -right-4 w-8 h-8 bg-cyan-500/10 rotate-45" />
      </div>
    </div>
  );
});

ScriptWorldviewNode.displayName = 'ScriptWorldviewNode';
