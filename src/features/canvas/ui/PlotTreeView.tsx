import { useState, useCallback, useMemo } from 'react';
import { ChevronRight, ChevronDown, FileText, GitBranch, Sparkles, Circle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  normalizeSceneCards,
  type ScriptChapterNodeData,
} from '@/features/canvas/domain/canvasNodes';
import { useScriptEditorStore } from '@/stores/scriptEditorStore';

type ChapterNode = { id: string; data: ScriptChapterNodeData };

interface PlotTreeNodeProps {
  node: ChapterNode;
  children: ChapterNode[];
  allNodes: ChapterNode[];
  level: number;
  isExpanded: boolean;
  onToggle: (nodeId: string) => void;
  onNodeClick: (nodeId: string) => void;
  expandedIds: Set<string>;
  activeChapterId: string | null;
  activeSceneId: string | null;
}

function PlotTreeNode({
  node,
  children,
  allNodes,
  level,
  isExpanded,
  onToggle,
  onNodeClick,
  expandedIds,
  activeChapterId,
  activeSceneId,
}: PlotTreeNodeProps) {
  const { t } = useTranslation();
  const focusChapter = useScriptEditorStore((state) => state.focusChapter);
  const focusScene = useScriptEditorStore((state) => state.focusScene);
  const data = node.data;
  const hasChildren = children.length > 0;
  const isBranchPoint = data.isBranchPoint;
  const branchType = data.branchType || 'main';
  const scenes = useMemo(
    () => normalizeSceneCards(data.scenes, data.content),
    [data.content, data.scenes]
  );
  
  const getBranchTypeIcon = () => {
    switch (branchType) {
      case 'branch':
        return <GitBranch className="w-3 h-3 text-purple-400" />;
      case 'supplement':
        return <Sparkles className="w-3 h-3 text-green-400" />;
      default:
        return <FileText className="w-3 h-3 text-amber-400" />;
    }
  };
  
  const getBranchTypeColor = () => {
    switch (branchType) {
      case 'branch':
        return 'border-l-purple-400';
      case 'supplement':
        return 'border-l-green-400';
      default:
        return 'border-l-amber-400';
    }
  };

  const childNodes = useMemo(() => {
    return children.map(child => ({
      node: child,
      children: allNodes.filter(n => n.data.parentId === child.id),
    }));
  }, [children, allNodes]);

  return (
    <div className="select-none">
      <div
        className={`
          group flex items-center gap-1.5 py-1.5 px-2 rounded-md cursor-pointer
          hover:bg-bg-dark transition-colors duration-150
          border-l-2 ${getBranchTypeColor()}
          ${isBranchPoint ? 'bg-purple-500/10' : ''}
        `}
        style={{ paddingLeft: `${level * 12 + 8}px` }}
        onClick={() => {
          focusChapter(node.id, scenes[0]?.id ?? null);
          onNodeClick(node.id);
        }}
      >
        {hasChildren ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggle(node.id);
            }}
            className="p-0.5 hover:bg-surface-dark rounded transition-colors"
          >
            {isExpanded ? (
              <ChevronDown className="w-3.5 h-3.5 text-text-muted" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5 text-text-muted" />
            )}
          </button>
        ) : (
          <span className="w-4.5" />
        )}
        
        {getBranchTypeIcon()}
        
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-medium text-text-dark truncate">
              {branchType === 'main' 
                ? `第${data.chapterNumber || 1}章` 
                : data.displayName || `${data.chapterNumber || 1}-${data.branchIndex || 1}`
              }
            </span>
            {data.title && (
              <span className="text-xs text-text-muted truncate">
                {data.title}
              </span>
            )}
          </div>
          {data.summary && (
            <p className="text-[10px] text-text-muted/70 line-clamp-1 mt-0.5">
              {data.summary}
            </p>
          )}
        </div>
        
        {isBranchPoint && (
          <Circle className="w-2 h-2 text-purple-400 fill-purple-400" />
        )}
      </div>

      {isExpanded && scenes.length > 0 ? (
        <div className="space-y-1 py-1">
          {scenes.map((scene) => {
            const isActive = activeChapterId === node.id && activeSceneId === scene.id;
            return (
              <button
                key={scene.id}
                type="button"
                onClick={() => {
                  focusScene(node.id, scene.id);
                  onNodeClick(node.id);
                }}
                className={`ml-5 flex w-[calc(100%-20px)] items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors ${
                  isActive
                    ? 'bg-amber-500/12 text-amber-200'
                    : 'text-text-muted hover:bg-bg-dark hover:text-text-dark'
                }`}
                style={{ marginLeft: `${level * 12 + 28}px` }}
              >
                <Circle className={`h-2.5 w-2.5 ${isActive ? 'fill-amber-300 text-amber-300' : 'fill-current text-text-muted/60'}`} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[11px] font-medium">
                    {scene.title || t('script.sceneStudio.untitledScene')}
                  </div>
                  <div className="truncate text-[10px] opacity-70">
                    {scene.summary || t('script.sceneStudio.sceneLabel', { number: scene.order + 1 })}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      ) : null}
      
      {hasChildren && isExpanded && (
        <div className="relative">
          {childNodes.map(({ node: childNode, children: grandChildren }) => (
            <PlotTreeNode
              key={childNode.id}
              node={childNode}
              children={grandChildren}
              allNodes={allNodes}
              level={level + 1}
              isExpanded={expandedIds.has(childNode.id)}
              onToggle={onToggle}
              onNodeClick={onNodeClick}
              expandedIds={expandedIds}
              activeChapterId={activeChapterId}
              activeSceneId={activeSceneId}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface PlotTreeViewProps {
  chapters: ChapterNode[];
  onNodeClick: (nodeId: string) => void;
}

export function PlotTreeView({ chapters, onNodeClick }: PlotTreeViewProps) {
  const activeChapterId = useScriptEditorStore((state) => state.activeChapterId);
  const activeSceneId = useScriptEditorStore((state) => state.activeSceneId);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => {
    const initialExpanded = new Set<string>();
    chapters.forEach(chapter => {
      if (chapter.data.branchType === 'main' || !chapter.data.branchType) {
        initialExpanded.add(chapter.id);
      }
    });
    return initialExpanded;
  });

  const handleToggle = useCallback((nodeId: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return next;
    });
  }, []);

  const treeData = useMemo(() => {
    const rootNodes = chapters.filter(
      chapter => !chapter.data.parentId || chapter.data.branchType === 'main'
    );
    
    const mainLineNodes = rootNodes.filter(
      chapter => !chapter.data.parentId || chapter.data.parentId === ''
    );
    
    const childrenMap = new Map<string, ChapterNode[]>();
    chapters.forEach(chapter => {
      if (chapter.data.parentId) {
        const children = childrenMap.get(chapter.data.parentId) || [];
        children.push(chapter);
        childrenMap.set(chapter.data.parentId, children);
      }
    });

    return {
      rootNodes: mainLineNodes,
      childrenMap,
    };
  }, [chapters]);

  const getChildNodes = useCallback(
    (parentId: string) => treeData.childrenMap.get(parentId) || [],
    [treeData.childrenMap]
  );

  if (chapters.length === 0) {
    return <p className="text-xs text-text-muted py-2 px-2">暂无章节</p>;
  }

  return (
    <div className="space-y-0.5 py-1">
      {treeData.rootNodes.map(rootNode => (
        <PlotTreeNode
          key={rootNode.id}
          node={rootNode}
          children={getChildNodes(rootNode.id)}
          allNodes={chapters}
          level={0}
          isExpanded={expandedIds.has(rootNode.id)}
          onToggle={handleToggle}
          onNodeClick={onNodeClick}
          expandedIds={expandedIds}
          activeChapterId={activeChapterId}
          activeSceneId={activeSceneId}
        />
      ))}
    </div>
  );
}
