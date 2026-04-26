import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { ChevronRight, ChevronDown, FileText, GitBranch, Circle, Clapperboard } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import {
  CANVAS_NODE_TYPES,
  normalizeSceneCards,
  type ScriptChapterNodeData,
  type ScriptSceneNodeData,
} from '@/features/canvas/domain/canvasNodes';
import { useCanvasStore } from '@/stores/canvasStore';
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
  sceneNodeBySourceKey: Map<string, { id: string; data: ScriptSceneNodeData }>;
}

function buildSceneSourceKey(chapterId: string, sceneId: string): string {
  return `${chapterId}::${sceneId}`;
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
  sceneNodeBySourceKey,
}: PlotTreeNodeProps) {
  const { t } = useTranslation();
  const setSelectedNode = useCanvasStore((state) => state.setSelectedNode);
  const focusChapterScene = useScriptEditorStore((state) => state.focusChapterScene);

  const data = node.data;
  const hasChildren = children.length > 0;
  const isBranchPoint = data.isBranchPoint;
  const branchType = data.branchType || 'main';
  const scenes = useMemo(
    () => normalizeSceneCards(data.scenes, data.content),
    [data.content, data.scenes]
  );
  const hasExpandableContent = hasChildren || scenes.length > 0;

  const childNodes = useMemo(() => {
    return children.map((child) => ({
      node: child,
      children: allNodes.filter((candidate) => candidate.data.parentId === child.id),
    }));
  }, [allNodes, children]);

  const getBranchTypeIcon = () => {
    switch (branchType) {
      case 'branch':
        return <GitBranch className="h-3 w-3 text-purple-400" />;
      default:
        return <FileText className="h-3 w-3 text-amber-400" />;
    }
  };

  const getBranchTypeColor = () => {
    switch (branchType) {
      case 'branch':
        return 'border-l-purple-400';
      default:
        return 'border-l-amber-400';
    }
  };

  const handleFocusSourceScene = useCallback((sceneId: string) => {
    setSelectedNode(node.id);
    focusChapterScene(node.id, sceneId);
    onNodeClick(node.id);
  }, [focusChapterScene, node.id, onNodeClick, setSelectedNode]);

  return (
    <div className="select-none">
      <div
        className={`
          group flex items-center gap-1.5 rounded-md border-l-2 px-2 py-1.5 transition-colors duration-150
          hover:bg-bg-dark
          ${getBranchTypeColor()}
          ${isBranchPoint ? 'bg-purple-500/10' : ''}
        `}
        style={{ paddingLeft: `${level * 12 + 8}px` }}
        onClick={() => onNodeClick(node.id)}
      >
        {hasExpandableContent ? (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onToggle(node.id);
            }}
            className="rounded p-0.5 transition-colors hover:bg-surface-dark"
          >
            {isExpanded ? (
              <ChevronDown className="h-3.5 w-3.5 text-text-muted" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 text-text-muted" />
            )}
          </button>
        ) : (
          <span className="w-4.5" />
        )}

        {getBranchTypeIcon()}

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-xs font-medium text-text-dark">
              {branchType === 'main'
                ? t('script.sceneStudio.chapterLabel', { number: data.chapterNumber || 1 })
                : data.displayName || `${data.chapterNumber || 1}-${data.branchIndex || 1}`}
            </span>
            {data.title ? (
              <span className="truncate text-xs text-text-muted">{data.title}</span>
            ) : null}
          </div>
          {data.summary ? (
            <p className="mt-0.5 line-clamp-1 text-[10px] text-text-muted/70">
              {data.summary}
            </p>
          ) : null}
        </div>

        {isBranchPoint ? (
          <Circle className="h-2 w-2 fill-purple-400 text-purple-400" />
        ) : null}
      </div>

      {isExpanded && scenes.length > 0 ? (
        <div className="space-y-1 py-1">
          {scenes.map((scene) => {
            const sceneNode = sceneNodeBySourceKey.get(buildSceneSourceKey(node.id, scene.id));
            const isActive = Boolean(sceneNode);

            return (
              <div
                key={scene.id}
                className={`ml-5 flex w-[calc(100%-20px)] items-center gap-2 rounded-md px-2 py-1.5 transition-colors ${
                  isActive
                    ? 'bg-cyan-500/12 text-cyan-200'
                    : 'text-text-muted hover:bg-bg-dark hover:text-text-dark'
                }`}
                style={{ marginLeft: `${level * 12 + 28}px` }}
              >
                <button
                  type="button"
                  onClick={() => handleFocusSourceScene(scene.id)}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                >
                  <Clapperboard className={`h-3.5 w-3.5 ${isActive ? 'text-cyan-300' : 'text-text-muted/70'}`} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[11px] font-medium">
                      {scene.title || t('script.sceneCatalog.untitledScene')}
                    </div>
                    <div className="truncate text-[10px] opacity-70">
                      {scene.summary || t('script.sceneCatalog.sceneLabel', { number: scene.order + 1 })}
                    </div>
                  </div>
                </button>
                {isActive ? (
                  <span className="shrink-0 rounded-full bg-cyan-500/12 px-2 py-0.5 text-[10px] font-medium text-cyan-200">
                    {t('script.chapterCatalog.created')}
                  </span>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}

      {hasChildren && isExpanded ? (
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
              sceneNodeBySourceKey={sceneNodeBySourceKey}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

interface PlotTreeViewProps {
  chapters: ChapterNode[];
  onNodeClick: (nodeId: string) => void;
}

export function PlotTreeView({ chapters, onNodeClick }: PlotTreeViewProps) {
  const { t } = useTranslation();
  const canvasNodes = useCanvasStore((state) => state.nodes);
  const knownChapterIdsRef = useRef<Set<string>>(new Set(chapters.map((chapter) => chapter.id)));
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => {
    const initialExpanded = new Set<string>();
    chapters.forEach((chapter) => {
      if (chapter.data.branchType === 'main' || !chapter.data.branchType) {
        initialExpanded.add(chapter.id);
      }
    });
    return initialExpanded;
  });

  const normalizedChapterIds = useMemo(
    () => new Set(chapters.map((chapter) => chapter.id)),
    [chapters]
  );

  useEffect(() => {
    setExpandedIds((previous) => {
      const knownIds = knownChapterIdsRef.current;
      const next = new Set<string>();

      previous.forEach((id) => {
        if (normalizedChapterIds.has(id)) {
          next.add(id);
        }
      });

      chapters.forEach((chapter) => {
        const isMainChapter = chapter.data.branchType === 'main' || !chapter.data.branchType;
        const isNewChapter = !knownIds.has(chapter.id);
        if (isMainChapter && isNewChapter) {
          next.add(chapter.id);
        }
      });

      knownChapterIdsRef.current = new Set(normalizedChapterIds);

      const hasChanged = next.size !== previous.size
        || Array.from(next).some((id) => !previous.has(id));

      return hasChanged ? next : previous;
    });
  }, [chapters, normalizedChapterIds]);

  const sceneNodeBySourceKey = useMemo(() => {
    const nextMap = new Map<string, { id: string; data: ScriptSceneNodeData }>();
    canvasNodes.forEach((node) => {
      if (node.type !== CANVAS_NODE_TYPES.scriptScene) {
        return;
      }

      const sceneNodeData = node.data as ScriptSceneNodeData;
      nextMap.set(
        buildSceneSourceKey(sceneNodeData.sourceChapterId, sceneNodeData.sourceSceneId),
        { id: node.id, data: sceneNodeData }
      );
    });
    return nextMap;
  }, [canvasNodes]);

  const handleToggle = useCallback((nodeId: string) => {
    setExpandedIds((previous) => {
      const next = new Set(previous);
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
      (chapter) => !chapter.data.parentId || chapter.data.branchType === 'main'
    );
    const mainLineNodes = rootNodes.filter(
      (chapter) => !chapter.data.parentId || chapter.data.parentId === ''
    );

    const childrenMap = new Map<string, ChapterNode[]>();
    chapters.forEach((chapter) => {
      if (!chapter.data.parentId) {
        return;
      }

      const children = childrenMap.get(chapter.data.parentId) || [];
      children.push(chapter);
      childrenMap.set(chapter.data.parentId, children);
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
    return <p className="px-2 py-2 text-xs text-text-muted">{t('script.chapterCatalog.empty')}</p>;
  }

  return (
    <div className="space-y-0.5 py-1">
      {treeData.rootNodes.map((rootNode) => (
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
          sceneNodeBySourceKey={sceneNodeBySourceKey}
        />
      ))}
    </div>
  );
}
