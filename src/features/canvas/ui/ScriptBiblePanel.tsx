import { useState, useMemo, useCallback } from 'react';
import { useReactFlow } from '@xyflow/react';
import { ChevronDown, ChevronRight, ChevronLeft, ChevronRight as ExpandIcon, Users, MapPin, Package, Link2, FileText, Plus, Pencil, Download, Sparkles, Globe, Eye, FilePlus } from 'lucide-react';
import { useProjectStore } from '@/stores/projectStore';
import { useCanvasStore } from '@/stores/canvasStore';
import { extractAssetsFromChapters } from '../application/assetExtractor';
import { AssetEditDialog, type AssetType } from './AssetEditDialog';
import { BranchSelectionDialog } from './BranchSelectionDialog';
import { PlotTreeView } from './PlotTreeView';
import { ChapterCountDialog } from './ChapterCountDialog';
import {
  CANVAS_NODE_TYPES,
  type ScriptChapterNodeData,
  type ScriptCharacterNodeData,
  type ScriptLocationNodeData,
  type ScriptItemNodeData,
  type ScriptPlotPointNodeData,
  type ScriptWorldviewNodeData,
} from '../domain/canvasNodes';

interface CollapsibleSectionProps {
  title: string;
  icon: React.ReactNode;
  count: number;
  onAdd?: () => void;
  children: React.ReactNode;
}

function CollapsibleSection({ title, icon, count, onAdd, children }: CollapsibleSectionProps) {
  const [isExpanded, setIsExpanded] = useState(true);

  return (
    <div className="border-b border-border-dark">
      <div className="flex items-center justify-between px-3 py-2 hover:bg-bg-dark transition-colors">
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex items-center gap-2 flex-1"
        >
          {isExpanded ? <ChevronDown className="w-4 h-4 text-text-muted" /> : <ChevronRight className="w-4 h-4 text-text-muted" />}
          {icon}
          <span className="text-sm font-medium text-text-dark">{title}</span>
          <span className="text-xs text-text-muted">({count})</span>
        </button>
        {onAdd && (
          <button
            onClick={onAdd}
            className="p-1 rounded hover:bg-border-dark text-text-muted hover:text-text-dark"
            title={`添加${title}`}
          >
            <Plus className="w-4 h-4" />
          </button>
        )}
      </div>
      {isExpanded && <div className="px-3 pb-3">{children}</div>}
    </div>
  );
}

interface AssetItemProps {
  label: string;
  description?: string;
  onClick?: () => void;
  onEdit?: () => void;
  onShowOnCanvas?: () => void;
  showOnCanvasDisabled?: boolean;
}

function AssetItem({ label, description, onClick, onEdit, onShowOnCanvas, showOnCanvasDisabled }: AssetItemProps) {
  return (
    <div className="group flex items-center gap-1">
      <button
        onClick={onClick}
        className="flex-1 text-left p-2 rounded hover:bg-bg-dark transition-colors"
      >
        <div className="text-sm text-text-dark truncate">{label}</div>
        {description && <div className="text-xs text-text-muted truncate">{description}</div>}
      </button>
      {onShowOnCanvas && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onShowOnCanvas();
          }}
          disabled={showOnCanvasDisabled}
          className="p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-cyan-500/20 text-cyan-400 disabled:opacity-50"
          title="显示到画布"
        >
          <Eye className="w-3 h-3" />
        </button>
      )}
      {onEdit && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onEdit();
          }}
          className="p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-border-dark text-text-muted hover:text-text-dark"
          title="编辑"
        >
          <Pencil className="w-3 h-3" />
        </button>
      )}
    </div>
  );
}

export function ScriptBiblePanel() {
  const currentProject = useProjectStore((state) => state.getCurrentProject());
  const { nodes, addNode } = useCanvasStore();
  const { setCenter } = useReactFlow();
  const [showChapterCountDialog, setShowChapterCountDialog] = useState(false);
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [isPanelCollapsed, setIsPanelCollapsed] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const [editDialogState, setEditDialogState] = useState<{
    isOpen: boolean;
    assetType: AssetType;
    nodeId?: string;
    editData?: any;
  }>({ isOpen: false, assetType: 'character' });

  const projectType = currentProject?.projectType;

  const scriptNodes = useMemo(() => {
    return {
      chapters: nodes.filter((n) => n.type === CANVAS_NODE_TYPES.scriptChapter) as Array<{ id: string; data: ScriptChapterNodeData; position: { x: number; y: number } }>,
      characters: nodes.filter((n) => n.type === CANVAS_NODE_TYPES.scriptCharacter) as Array<{ id: string; data: ScriptCharacterNodeData; position: { x: number; y: number } }>,
      locations: nodes.filter((n) => n.type === CANVAS_NODE_TYPES.scriptLocation) as Array<{ id: string; data: ScriptLocationNodeData; position: { x: number; y: number } }>,
      items: nodes.filter((n) => n.type === CANVAS_NODE_TYPES.scriptItem) as Array<{ id: string; data: ScriptItemNodeData; position: { x: number; y: number } }>,
      plotPoints: nodes.filter((n) => n.type === CANVAS_NODE_TYPES.scriptPlotPoint) as Array<{ id: string; data: ScriptPlotPointNodeData; position: { x: number; y: number } }>,
      worldviews: nodes.filter((n) => n.type === CANVAS_NODE_TYPES.scriptWorldview) as Array<{ id: string; data: ScriptWorldviewNodeData; position: { x: number; y: number } }>,
    };
  }, [nodes]);

  const getNextPosition = useCallback((baseX: number, baseY: number, index: number) => {
    const offsetX = (index % 3) * 350;
    const offsetY = Math.floor(index / 3) * 250;
    return { x: baseX + offsetX, y: baseY + offsetY };
  }, []);

  const handleShowOnCanvas = useCallback((type: AssetType, data: any, existingNodeId?: string) => {
    if (existingNodeId) {
      const node = nodes.find(n => n.id === existingNodeId);
      if (node) {
        const nodeWidth = node.measured?.width ?? 200;
        const nodeHeight = node.measured?.height ?? 150;
        setCenter(
          node.position.x + nodeWidth / 2,
          node.position.y + nodeHeight / 2,
          { zoom: 1, duration: 300 }
        );
      }
      return;
    }

    const existingNodes = nodes.filter(n => 
      n.type === CANVAS_NODE_TYPES.scriptCharacter ||
      n.type === CANVAS_NODE_TYPES.scriptLocation ||
      n.type === CANVAS_NODE_TYPES.scriptItem ||
      n.type === CANVAS_NODE_TYPES.scriptWorldview
    );
    const position = getNextPosition(900, 100, existingNodes.length);

    switch (type) {
      case 'character':
        addNode(CANVAS_NODE_TYPES.scriptCharacter, position, {
          displayName: data.name || '新角色',
          name: data.name || '',
          description: data.description || '',
        });
        break;
      case 'location':
        addNode(CANVAS_NODE_TYPES.scriptLocation, position, {
          displayName: data.name || '新场景',
          name: data.name || '',
          description: data.description || '',
        });
        break;
      case 'item':
        addNode(CANVAS_NODE_TYPES.scriptItem, position, {
          displayName: data.name || '新道具',
          name: data.name || '',
          description: data.description || '',
        });
        break;
      case 'worldview':
        addNode(CANVAS_NODE_TYPES.scriptWorldview, position, {
          displayName: data.worldviewName || '世界观',
          worldviewName: data.worldviewName || '',
          description: data.description || '',
          era: data.era || '',
          technology: data.technology || '',
          magic: data.magic || '',
          society: data.society || '',
          geography: data.geography || '',
          rules: data.rules || [],
        });
        break;
    }
  }, [nodes, addNode, getNextPosition, setCenter]);

  const handleExtractAssets = useCallback(() => {
    setIsExtracting(true);
    setTimeout(() => {
      extractAssetsFromChapters();
      setIsExtracting(false);
    }, 100);
  }, []);

  const handlePanelCollapse = useCallback(() => {
    setIsPanelCollapsed(true);
  }, []);

  const handlePanelExpand = useCallback(() => {
    setIsPanelCollapsed(false);
  }, []);

  const handleNodeClick = useCallback((nodeId: string) => {
    const node = nodes.find(n => n.id === nodeId);
    if (node) {
      const nodeWidth = node.measured?.width ?? 200;
      const nodeHeight = node.measured?.height ?? 150;
      setCenter(
        node.position.x + nodeWidth / 2,
        node.position.y + nodeHeight / 2,
        { zoom: 1, duration: 300 }
      );
    }
  }, [nodes, setCenter]);

  const handleImportScript = useCallback(() => {
    setShowChapterCountDialog(true);
  }, []);

  const handleChapterCountConfirm = useCallback((count: number) => {
    const CHAPTER_NODE_HEIGHT = 380;
    const ROOT_NODE_WIDTH = 320;
    const ROOT_NODE_HEIGHT = 120;
    const GAP = 60;
    const HORIZONTAL_GAP = 150;

    // 计算章节列表的总高度
    const totalChaptersHeight = count * CHAPTER_NODE_HEIGHT + (count - 1) * GAP;
    
    // 章节起始Y坐标（从100开始）
    const chapterStartY = 100;
    
    // 根节点垂直居中：章节列表中心 - 根节点高度/2
    const rootY = chapterStartY + totalChaptersHeight / 2 - ROOT_NODE_HEIGHT / 2;
    // 根节点在章节左侧，保持横向间距
    const rootX = 100;
    
    // 章节节点在根节点右侧
    const chapterX = rootX + ROOT_NODE_WIDTH + HORIZONTAL_GAP;

    addNode(CANVAS_NODE_TYPES.scriptRoot, { x: rootX, y: rootY }, {
      displayName: '剧本',
      title: '新剧本',
      genre: '',
      totalChapters: count,
    });

    for (let i = 1; i <= count; i++) {
      const position = {
        x: chapterX,
        y: chapterStartY + (i - 1) * (CHAPTER_NODE_HEIGHT + GAP),
      };
      
      addNode(CANVAS_NODE_TYPES.scriptChapter, position, {
        displayName: `第${i}章`,
        chapterNumber: i,
        title: `第${i}章`,
        content: '',
        summary: '',
        sceneHeadings: [],
        characters: [],
        locations: [],
        items: [],
        emotionalShift: '',
        isBranchPoint: false,
        branchType: 'main',
        depth: 1,
        tables: [],
        plotPoints: [],
      } as ScriptChapterNodeData);
    }

    setShowChapterCountDialog(false);
    console.log(`[ScriptImport] 创建了 ${count} 个章节节点`);
  }, [addNode]);

  const handleAddAsset = useCallback((type: AssetType) => {
    setEditDialogState({ isOpen: true, assetType: type });
  }, []);

  const handleEditAsset = useCallback((type: AssetType, nodeId: string, data: any) => {
    setEditDialogState({ isOpen: true, assetType: type, nodeId, editData: data });
  }, []);

  const handleCloseEditDialog = useCallback(() => {
    setEditDialogState({ isOpen: false, assetType: 'character' });
  }, []);

  if (projectType !== 'script') {
    return null;
  }

  if (isPanelCollapsed) {
    return (
      <div className="flex flex-col h-full bg-surface-dark border-r border-border-dark transition-all duration-300">
        <button
          onClick={handlePanelExpand}
          className="flex flex-col items-center justify-center py-4 px-1 hover:bg-bg-dark transition-colors group"
          title="展开资产栏"
        >
          <ExpandIcon className="w-5 h-5 text-text-muted group-hover:text-amber-400 transition-colors" />
          <FileText className="w-4 h-4 text-amber-400 mt-2" />
          <span className="text-xs text-text-muted mt-1">资产</span>
        </button>
      </div>
    );
  }

  return (
    <div className="w-64 h-full bg-surface-dark border-r border-border-dark overflow-hidden flex flex-col transition-all duration-300">
      <ChapterCountDialog
        isOpen={showChapterCountDialog}
        onClose={() => setShowChapterCountDialog(false)}
        onConfirm={handleChapterCountConfirm}
      />
      <div className="sticky top-0 bg-surface-dark border-b border-border-dark px-3 py-2 flex items-center justify-between z-10">
        <div className="flex items-center gap-2 flex-1">
          <FileText className="w-4 h-4 text-amber-400" />
          <span className="text-sm font-semibold text-text-dark">剧本资产</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={handleExtractAssets}
            disabled={isExtracting}
            className="p-1 rounded hover:bg-bg-dark text-amber-400 hover:text-amber-300"
            title="一键提取资产"
          >
            <Sparkles className={`w-4 h-4 ${isExtracting ? 'animate-pulse' : ''}`} />
          </button>
          <button
            onClick={() => setShowExportDialog(true)}
            className="p-1 rounded hover:bg-bg-dark text-text-muted hover:text-text-dark"
            title="导出剧本"
          >
            <Download className="w-4 h-4" />
          </button>
          <button
                onClick={handleImportScript}
                className="p-1 rounded hover:bg-bg-dark cursor-pointer"
                title="导入剧本"
              >
                <FilePlus className="w-4 h-4 text-text-muted" />
              </button>
          <button
            onClick={handlePanelCollapse}
            className="p-1 rounded hover:bg-bg-dark text-text-muted hover:text-text-dark"
            title="收起面板"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto ui-scrollbar">
        <CollapsibleSection
            title="剧情摘要"
            icon={<FileText className="w-4 h-4 text-text-muted" />}
            count={scriptNodes.chapters.length}
          >
            <PlotTreeView 
              chapters={scriptNodes.chapters} 
              onNodeClick={handleNodeClick}
            />
          </CollapsibleSection>

          <CollapsibleSection
            title="世界观"
            icon={<Globe className="w-4 h-4 text-cyan-400" />}
            count={scriptNodes.worldviews.length}
            onAdd={() => handleAddAsset('worldview')}
          >
            {scriptNodes.worldviews.length === 0 ? (
              <p className="text-xs text-text-muted py-2">暂无世界观设定</p>
            ) : (
              <div className="space-y-1">
                {scriptNodes.worldviews.map((node) => (
                  <AssetItem
                    key={node.id}
                    label={node.data.worldviewName || node.data.displayName || '未命名'}
                    description={node.data.description}
                    onClick={() => handleNodeClick(node.id)}
                    onEdit={() => handleEditAsset('worldview', node.id, node.data)}
                    onShowOnCanvas={() => handleShowOnCanvas('worldview', node.data, node.id)}
                    showOnCanvasDisabled={true}
                  />
                ))}
              </div>
            )}
          </CollapsibleSection>

          <CollapsibleSection
            title="角色档案"
            icon={<Users className="w-4 h-4 text-text-muted" />}
            count={scriptNodes.characters.length}
            onAdd={() => handleAddAsset('character')}
          >
            {scriptNodes.characters.length === 0 ? (
              <p className="text-xs text-text-muted py-2">暂无角色</p>
            ) : (
              <div className="space-y-1">
                {scriptNodes.characters.map((node) => (
                  <AssetItem
                    key={node.id}
                    label={node.data.name || '未命名'}
                    description={node.data.description}
                    onClick={() => handleNodeClick(node.id)}
                    onEdit={() => handleEditAsset('character', node.id, node.data)}
                    onShowOnCanvas={() => handleShowOnCanvas('character', node.data, node.id)}
                    showOnCanvasDisabled={true}
                  />
                ))}
              </div>
            )}
          </CollapsibleSection>

          <CollapsibleSection
            title="场景地点"
            icon={<MapPin className="w-4 h-4 text-text-muted" />}
            count={scriptNodes.locations.length}
            onAdd={() => handleAddAsset('location')}
          >
            {scriptNodes.locations.length === 0 ? (
              <p className="text-xs text-text-muted py-2">暂无场景</p>
            ) : (
              <div className="space-y-1">
                {scriptNodes.locations.map((node) => (
                  <AssetItem
                    key={node.id}
                    label={node.data.name || '未命名'}
                    description={node.data.description}
                    onClick={() => handleNodeClick(node.id)}
                    onEdit={() => handleEditAsset('location', node.id, node.data)}
                    onShowOnCanvas={() => handleShowOnCanvas('location', node.data, node.id)}
                    showOnCanvasDisabled={true}
                  />
                ))}
              </div>
            )}
          </CollapsibleSection>

          <CollapsibleSection
            title="关键道具"
            icon={<Package className="w-4 h-4 text-text-muted" />}
            count={scriptNodes.items.length}
            onAdd={() => handleAddAsset('item')}
          >
            {scriptNodes.items.length === 0 ? (
              <p className="text-xs text-text-muted py-2">暂无道具</p>
            ) : (
              <div className="space-y-1">
                {scriptNodes.items.map((node) => (
                  <AssetItem
                    key={node.id}
                    label={node.data.name || '未命名'}
                    description={node.data.description}
                    onClick={() => handleNodeClick(node.id)}
                    onEdit={() => handleEditAsset('item', node.id, node.data)}
                    onShowOnCanvas={() => handleShowOnCanvas('item', node.data, node.id)}
                    showOnCanvasDisabled={true}
                  />
                ))}
              </div>
            )}
          </CollapsibleSection>

          <CollapsibleSection
            title="埋点追踪"
            icon={<Link2 className="w-4 h-4 text-text-muted" />}
            count={scriptNodes.plotPoints.length}
          >
            {scriptNodes.plotPoints.length === 0 ? (
              <p className="text-xs text-text-muted py-2">暂无埋点</p>
            ) : (
              <div className="space-y-1">
                {scriptNodes.plotPoints.map((node) => (
                  <AssetItem
                    key={node.id}
                    label={node.data.pointType === 'setup' ? '🔗 伏笔' : '✅ 响应'}
                    description={node.data.description}
                    onClick={() => handleNodeClick(node.id)}
                  />
                ))}
              </div>
            )}
          </CollapsibleSection>
        </div>

      <AssetEditDialog
        isOpen={editDialogState.isOpen}
        assetType={editDialogState.assetType}
        editData={editDialogState.editData}
        nodeId={editDialogState.nodeId}
        onClose={handleCloseEditDialog}
      />

      <BranchSelectionDialog
        isOpen={showExportDialog}
        onClose={() => setShowExportDialog(false)}
      />
    </div>
  );
}
