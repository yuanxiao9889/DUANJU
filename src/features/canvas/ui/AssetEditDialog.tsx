import { useState, useCallback, useEffect } from 'react';
import { X, Users, MapPin, Package, Trash2, Globe } from 'lucide-react';
import {
  CANVAS_NODE_TYPES,
  type ScriptCharacterNodeData,
  type ScriptLocationNodeData,
  type ScriptItemNodeData,
  type ScriptWorldviewNodeData,
} from '@/features/canvas/domain/canvasNodes';
import { useCanvasStore } from '@/stores/canvasStore';
import { UiButton } from '@/components/ui/primitives';

export type AssetType = 'character' | 'location' | 'item' | 'worldview';

interface AssetEditDialogProps {
  isOpen: boolean;
  assetType: AssetType;
  editData?: ScriptCharacterNodeData | ScriptLocationNodeData | ScriptItemNodeData | ScriptWorldviewNodeData;
  nodeId?: string;
  onClose: () => void;
}

export function AssetEditDialog({
  isOpen,
  assetType,
  editData,
  nodeId,
  onClose,
}: AssetEditDialogProps) {
  const { addNode, updateNodeData, deleteNode } = useCanvasStore();

  const [formData, setFormData] = useState<{
    name: string;
    description: string;
    personality?: string;
    appearance?: string;
    appearances?: string[];
    era?: string;
    technology?: string;
    magic?: string;
    society?: string;
    geography?: string;
  }>({
    name: '',
    description: '',
    personality: '',
    appearance: '',
    appearances: [],
    era: '',
    technology: '',
    magic: '',
    society: '',
    geography: '',
  });

  useEffect(() => {
    if (editData) {
      const worldviewData = editData as ScriptWorldviewNodeData;
      setFormData({
        name: (editData as any).name || (editData as any).worldviewName || '',
        description: editData.description || '',
        personality: (editData as ScriptCharacterNodeData).personality || '',
        appearance: (editData as ScriptCharacterNodeData).appearance || '',
        appearances: (editData as ScriptLocationNodeData).appearances || [],
        era: worldviewData.era || '',
        technology: worldviewData.technology || '',
        magic: worldviewData.magic || '',
        society: worldviewData.society || '',
        geography: worldviewData.geography || '',
      });
    } else {
      setFormData({
        name: '',
        description: '',
        personality: '',
        appearance: '',
        appearances: [],
        era: '',
        technology: '',
        magic: '',
        society: '',
        geography: '',
      });
    }
  }, [editData, isOpen]);

  const handleSave = useCallback(() => {
    if (!formData.name.trim()) return;

    const nodeType = {
      character: CANVAS_NODE_TYPES.scriptCharacter,
      location: CANVAS_NODE_TYPES.scriptLocation,
      item: CANVAS_NODE_TYPES.scriptItem,
      worldview: CANVAS_NODE_TYPES.scriptWorldview,
    }[assetType];

    if (nodeId && editData) {
      if (assetType === 'worldview') {
        updateNodeData(nodeId, {
          worldviewName: formData.name,
          description: formData.description,
          era: formData.era,
          technology: formData.technology,
          magic: formData.magic,
          society: formData.society,
          geography: formData.geography,
        });
      } else {
        updateNodeData(nodeId, formData);
      }
    } else {
      const x = 100 + Math.random() * 200;
      const y = 100 + Math.random() * 200;
      
      let nodeData: any;
      if (assetType === 'worldview') {
        nodeData = {
          displayName: formData.name,
          worldviewName: formData.name,
          description: formData.description,
          era: formData.era || '',
          technology: formData.technology || '',
          magic: formData.magic || '',
          society: formData.society || '',
          geography: formData.geography || '',
          rules: [],
        };
      } else {
        nodeData = {
          displayName: formData.name,
          ...formData,
        };
      }

      addNode(nodeType, { x, y }, nodeData);
    }
    onClose();
  }, [formData, assetType, nodeId, editData, addNode, updateNodeData, onClose]);

  const handleDelete = useCallback(() => {
    if (nodeId) {
      deleteNode(nodeId);
      onClose();
    }
  }, [nodeId, deleteNode, onClose]);

  const getTitle = () => {
    switch (assetType) {
      case 'character':
        return nodeId ? '编辑角色' : '新建角色';
      case 'location':
        return nodeId ? '编辑场景' : '新建场景';
      case 'item':
        return nodeId ? '编辑道具' : '新建道具';
      case 'worldview':
        return nodeId ? '编辑世界观' : '新建世界观';
    }
  };

  const getIcon = () => {
    switch (assetType) {
      case 'character':
        return <Users className="w-5 h-5 text-amber-400" />;
      case 'location':
        return <MapPin className="w-5 h-5 text-amber-400" />;
      case 'item':
        return <Package className="w-5 h-5 text-amber-400" />;
      case 'worldview':
        return <Globe className="w-5 h-5 text-cyan-400" />;
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative bg-surface-dark border border-border-dark rounded-xl max-w-lg w-full mx-4 shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b border-border-dark sticky top-0 bg-surface-dark">
          <div className="flex items-center gap-2">
            {getIcon()}
            <h2 className="text-lg font-semibold text-text-dark">{getTitle()}</h2>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-bg-dark rounded">
            <X className="w-5 h-5 text-text-muted" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-text-dark mb-2">
              {assetType === 'worldview' ? '世界观名称' : '名称'} *
            </label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder={
                assetType === 'character'
                  ? '角色名称'
                  : assetType === 'location'
                  ? '场景名称'
                  : assetType === 'worldview'
                  ? '世界观名称'
                  : '道具名称'
              }
              className="w-full px-3 py-2 bg-bg-dark border border-border-dark rounded-lg text-text-dark placeholder:text-text-muted focus:outline-none focus:border-amber-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-text-dark mb-2">
              描述
            </label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              placeholder="详细描述..."
              rows={3}
              className="w-full px-3 py-2 bg-bg-dark border border-border-dark rounded-lg text-text-dark placeholder:text-text-muted focus:outline-none focus:border-amber-500 resize-none"
            />
          </div>

          {assetType === 'character' && (
            <>
              <div>
                <label className="block text-sm font-medium text-text-dark mb-2">
                  性格特点
                </label>
                <textarea
                  value={formData.personality || ''}
                  onChange={(e) => setFormData({ ...formData, personality: e.target.value })}
                  placeholder="角色的性格特点..."
                  rows={2}
                  className="w-full px-3 py-2 bg-bg-dark border border-border-dark rounded-lg text-text-dark placeholder:text-text-muted focus:outline-none focus:border-amber-500 resize-none"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-text-dark mb-2">
                  外貌特征
                </label>
                <textarea
                  value={formData.appearance || ''}
                  onChange={(e) => setFormData({ ...formData, appearance: e.target.value })}
                  placeholder="角色的外貌特征..."
                  rows={2}
                  className="w-full px-3 py-2 bg-bg-dark border border-border-dark rounded-lg text-text-dark placeholder:text-text-muted focus:outline-none focus:border-amber-500 resize-none"
                />
              </div>
            </>
          )}

          {(assetType === 'location' || assetType === 'item') && (
            <div>
              <label className="block text-sm font-medium text-text-dark mb-2">
                出现章节
              </label>
              <input
                type="text"
                value={(formData.appearances || []).join(', ')}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    appearances: e.target.value.split(',').map((s) => s.trim()).filter(Boolean),
                  })
                }
                placeholder="章节1, 章节2, 章节3"
                className="w-full px-3 py-2 bg-bg-dark border border-border-dark rounded-lg text-text-dark placeholder:text-text-muted focus:outline-none focus:border-amber-500"
              />
            </div>
          )}

          {assetType === 'worldview' && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-text-dark mb-1.5">
                    时代背景
                  </label>
                  <input
                    type="text"
                    value={formData.era || ''}
                    onChange={(e) => setFormData({ ...formData, era: e.target.value })}
                    placeholder="如：中世纪、未来..."
                    className="w-full px-2 py-1.5 text-sm bg-bg-dark border border-border-dark rounded-lg text-text-dark outline-none focus:border-cyan-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-text-dark mb-1.5">
                    科技水平
                  </label>
                  <input
                    type="text"
                    value={formData.technology || ''}
                    onChange={(e) => setFormData({ ...formData, technology: e.target.value })}
                    placeholder="如：蒸汽朋克、高科技..."
                    className="w-full px-2 py-1.5 text-sm bg-bg-dark border border-border-dark rounded-lg text-text-dark outline-none focus:border-cyan-500"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-text-dark mb-1.5">
                    魔法/超自然
                  </label>
                  <input
                    type="text"
                    value={formData.magic || ''}
                    onChange={(e) => setFormData({ ...formData, magic: e.target.value })}
                    placeholder="如：元素魔法、无魔法..."
                    className="w-full px-2 py-1.5 text-sm bg-bg-dark border border-border-dark rounded-lg text-text-dark outline-none focus:border-cyan-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-text-dark mb-1.5">
                    社会结构
                  </label>
                  <input
                    type="text"
                    value={formData.society || ''}
                    onChange={(e) => setFormData({ ...formData, society: e.target.value })}
                    placeholder="如：封建制、民主制..."
                    className="w-full px-2 py-1.5 text-sm bg-bg-dark border border-border-dark rounded-lg text-text-dark outline-none focus:border-cyan-500"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-text-dark mb-1.5">
                  地理环境
                </label>
                <input
                  type="text"
                  value={formData.geography || ''}
                  onChange={(e) => setFormData({ ...formData, geography: e.target.value })}
                  placeholder="如：大陆、岛屿、太空..."
                  className="w-full px-2 py-1.5 text-sm bg-bg-dark border border-border-dark rounded-lg text-text-dark outline-none focus:border-cyan-500"
                />
              </div>
            </>
          )}
        </div>

        <div className="flex items-center justify-between p-4 border-t border-border-dark sticky bottom-0 bg-surface-dark">
          {nodeId ? (
            <button
              onClick={handleDelete}
              className="flex items-center gap-1 px-3 py-2 text-sm text-red-400 hover:bg-red-500/10 rounded"
            >
              <Trash2 className="w-4 h-4" />
              删除
            </button>
          ) : (
            <div />
          )}
          <div className="flex gap-2">
            <UiButton variant="ghost" onClick={onClose}>
              取消
            </UiButton>
            <UiButton
              variant="primary"
              onClick={handleSave}
              disabled={!formData.name.trim()}
            >
              {nodeId ? '保存' : '创建'}
            </UiButton>
          </div>
        </div>
      </div>
    </div>
  );
}
