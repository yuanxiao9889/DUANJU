import { memo, useState, useCallback, useEffect, useRef, Fragment } from 'react';
import { Handle, Position } from '@xyflow/react';
import { FileText, GitBranch, Sparkles, Pencil, PlusCircle, GitFork } from 'lucide-react';
import { NodeHeader, NODE_HEADER_FLOATING_POSITION_CLASS } from '@/features/canvas/ui/NodeHeader';
import { NodeResizeHandle } from '@/features/canvas/ui/NodeResizeHandle';
import { AiWriterDialog } from '@/features/canvas/ui/AiWriterDialog';
import { RichTextEditor } from '@/features/canvas/ui/RichTextEditor';
import { BranchPointDialog } from '@/features/canvas/ui/BranchPointDialog';
import { CANVAS_NODE_TYPES, type ScriptChapterNodeData } from '@/features/canvas/domain/canvasNodes';
import { resolveNodeDisplayName } from '@/features/canvas/domain/nodeDisplay';
import { useCanvasStore } from '@/stores/canvasStore';
import type { GeneratedBranch } from '@/commands/textGen';

function simpleMarkdownToHtml(text: string): string {
  let html = text
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^---$/gm, '<hr>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

  const blocks = html.split(/\n\n+/);
  html = blocks.map(block => {
    block = block.trim();
    if (!block) return '';
    if (block.startsWith('<h2>') || block.startsWith('<hr>')) {
      return block;
    }
    block = block.replace(/\n/g, '<br>');
    return `<p>${block}</p>`;
  }).join('\n');

  return html;
}

type ScriptChapterNodeProps = {
  id: string;
  data: ScriptChapterNodeData;
  selected?: boolean;
  width?: number;
  height?: number;
};

const DEFAULT_NODE_WIDTH = 420;
const DEFAULT_NODE_HEIGHT = 380;
const MIN_NODE_WIDTH = 320;
const MIN_NODE_HEIGHT = 280;
const MAX_NODE_WIDTH = 800;
const MAX_NODE_HEIGHT = 900;

function resolveNodeDimension(value: number | undefined, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 1) {
    return Math.round(value);
  }
  return fallback;
}

type ContextMenuPosition = { x: number; y: number } | null;

const CONTEXT_MENU_OFFSET_X = 8;
const CONTEXT_MENU_OFFSET_Y = 8;
const CONTEXT_MENU_WIDTH = 140;
const CONTEXT_MENU_HEIGHT = 80;

function TextContextMenu({
  position,
  containerRef,
  onSelectExpand,
  onSelectRewrite,
  onClose,
}: {
  position: ContextMenuPosition;
  containerRef: React.RefObject<HTMLElement>;
  onSelectExpand: () => void;
  onSelectRewrite: () => void;
  onClose: () => void;
}) {
  const [adjustedPosition, setAdjustedPosition] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!position || !containerRef.current) {
      setAdjustedPosition(null);
      return;
    }

    const containerRect = containerRef.current.getBoundingClientRect();
    const containerWidth = containerRef.current.offsetWidth;
    const containerHeight = containerRef.current.offsetHeight;

    let x = position.x - containerRect.left + CONTEXT_MENU_OFFSET_X;
    let y = position.y - containerRect.top + CONTEXT_MENU_OFFSET_Y;

    if (x + CONTEXT_MENU_WIDTH > containerWidth) {
      x = position.x - containerRect.left - CONTEXT_MENU_WIDTH - CONTEXT_MENU_OFFSET_X;
    }

    if (y + CONTEXT_MENU_HEIGHT > containerHeight) {
      y = position.y - containerRect.top - CONTEXT_MENU_HEIGHT - CONTEXT_MENU_OFFSET_Y;
    }

    x = Math.max(8, x);
    y = Math.max(8, y);

    setAdjustedPosition({ x, y });
  }, [position, containerRef]);

  if (!adjustedPosition) return null;

  return (
    <>
      <div
        className="absolute inset-0 z-40"
        onClick={onClose}
        onContextMenu={(e) => { e.preventDefault(); onClose(); }}
      />
      <div
        className="absolute z-50 min-w-[140px] py-1 bg-surface-dark border border-border-dark rounded-lg shadow-xl"
        style={{ left: adjustedPosition.x, top: adjustedPosition.y }}
      >
        <button
          type="button"
          onClick={() => { onSelectExpand(); onClose(); }}
          className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm text-text-dark hover:bg-bg-dark"
        >
          <Sparkles className="w-4 h-4 text-amber-400" />
          AI 扩写
        </button>
        <button
          type="button"
          onClick={() => { onSelectRewrite(); onClose(); }}
          className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm text-text-dark hover:bg-bg-dark"
        >
          <Pencil className="w-4 h-4 text-amber-400" />
          AI 改写
        </button>
      </div>
    </>
  );
}

export const ScriptChapterNode = memo(({ id, data, selected, width, height }: ScriptChapterNodeProps) => {
  const updateNodeData = useCanvasStore((state) => state.updateNodeData);
  const addNode = useCanvasStore((state) => state.addNode);
  const addEdge = useCanvasStore((state) => state.addEdge);
  const nodes = useCanvasStore((state) => state.nodes);
  const resolvedTitle = resolveNodeDisplayName(CANVAS_NODE_TYPES.scriptChapter, data);
  const [aiDialogMode, setAiDialogMode] = useState<'expand' | 'rewrite' | 'expandFromSummary' | 'expandFromMerged' | null>(null);
  const [selectedText, setSelectedText] = useState('');
  const [contextMenuPosition, setContextMenuPosition] = useState<ContextMenuPosition>(null);
  const [showBranchDialog, setShowBranchDialog] = useState(false);
  const [pendingReplacement, setPendingReplacement] = useState<{ requestId: number; text: string } | null>(null);
  const replacementRequestIdRef = useRef(0);
  const nodeContainerRef = useRef<HTMLDivElement>(null);
  const aiButtonRef = useRef<HTMLButtonElement>(null);
  const contextMenuAnchorRef = useRef<HTMLDivElement>(null);

  const resolvedWidth = resolveNodeDimension(width, DEFAULT_NODE_WIDTH);
  const resolvedHeight = resolveNodeDimension(height, DEFAULT_NODE_HEIGHT);

  const handleTitleChange = useCallback(
    (nextTitle: string) => {
      updateNodeData(id, { displayName: nextTitle });
    },
    [id, updateNodeData]
  );

  const handleContentChange = useCallback(
    (html: string) => {
      updateNodeData(id, { content: html });
    },
    [id, updateNodeData]
  );

  const handleTextSelect = useCallback((text: string) => {
    setSelectedText(text);
  }, []);

  const handleContextMenu = useCallback((e: { clientX: number; clientY: number }) => {
    if (selectedText.trim()) {
      setContextMenuPosition({ x: e.clientX, y: e.clientY });
      if (contextMenuAnchorRef.current) {
        contextMenuAnchorRef.current.style.left = `${e.clientX}px`;
        contextMenuAnchorRef.current.style.top = `${e.clientY}px`;
      }
    }
  }, [selectedText]);

  const handleAiConfirm = useCallback(
    (result: string) => {
      if (selectedText.trim()) {
        replacementRequestIdRef.current += 1;
        setPendingReplacement({
          requestId: replacementRequestIdRef.current,
          text: result,
        });
      } else {
        updateNodeData(id, { content: result });
      }
      setAiDialogMode(null);
      setSelectedText('');
    },
    [id, updateNodeData, selectedText]
  );

  const handleReplacementApplied = useCallback(() => {
    setPendingReplacement(null);
  }, []);

  const updateTableCell = useCallback(
    (tableId: string, rowIndex: number, column: string, value: string) => {
      const currentTables = data.tables || [];
      const updatedTables = currentTables.map((table) => {
        if (table.id === tableId) {
          const updatedRows = [...table.rows];
          updatedRows[rowIndex] = { ...updatedRows[rowIndex], [column]: value };
          return { ...table, rows: updatedRows };
        }
        return table;
      });
      updateNodeData(id, { tables: updatedTables });
    },
    [id, data.tables, updateNodeData]
  );

  const addTableRow = useCallback(
    (tableId: string) => {
      const currentTables = data.tables || [];
      const updatedTables = currentTables.map((table) => {
        if (table.id === tableId) {
          const newRow: Record<string, string> = {};
          table.columns.forEach((col) => {
            newRow[col] = '';
          });
          return { ...table, rows: [...table.rows, newRow] };
        }
        return table;
      });
      updateNodeData(id, { tables: updatedTables });
    },
    [id, data.tables, updateNodeData]
  );

  const deleteTable = useCallback(
    (tableId: string) => {
      const currentTables = data.tables || [];
      const updatedTables = currentTables.filter((table) => table.id !== tableId);
      updateNodeData(id, { tables: updatedTables });
    },
    [id, data.tables, updateNodeData]
  );

  const handleBranchConfirm = useCallback((branches: GeneratedBranch[]) => {
    const BRANCH_NODE_WIDTH = 420;
    const HORIZONTAL_GAP = 50;
    const VERTICAL_GAP = 80;

    const totalWidth = branches.length * BRANCH_NODE_WIDTH + (branches.length - 1) * HORIZONTAL_GAP;
    const nodeWidth = resolvedWidth;
    const startX = nodeWidth / 2 - totalWidth / 2;
    const startY = resolvedHeight + VERTICAL_GAP;

    updateNodeData(id, { isBranchPoint: true });

    branches.forEach((branch, index) => {
      const position = {
        x: startX + index * (BRANCH_NODE_WIDTH + HORIZONTAL_GAP),
        y: startY,
      };

      const chapterId = addNode(
        CANVAS_NODE_TYPES.scriptChapter,
        position,
        {
          displayName: branch.title,
          title: branch.title,
          summary: branch.summary,
          content: simpleMarkdownToHtml(branch.content || ''),
          chapterNumber: data.chapterNumber,
          branchType: 'branch',
          parentId: id,
          branchIndex: index + 1,
          depth: (data.depth || 1) + 1,
          sceneHeadings: [],
          characters: [],
          locations: [],
          items: [],
          emotionalShift: '',
          isBranchPoint: false,
          tables: [],
          plotPoints: [],
        } as ScriptChapterNodeData
      );

      if (chapterId) {
        addEdge(id, chapterId);
      }
    });

    setShowBranchDialog(false);
  }, [id, data.chapterNumber, data.depth, resolvedWidth, resolvedHeight, updateNodeData, addNode, addEdge]);

  const hasMergedBranches = data.mergedFromBranches && data.mergedFromBranches.length > 0;
  const isMergePoint = data.isMergePoint || (hasMergedBranches && data.mergedFromBranches!.length >= 2);

  console.log('[Debug] hasMergedBranches:', hasMergedBranches, 'mergedFromBranches:', data.mergedFromBranches);

  const collectMergedBranchContents = useCallback(() => {
    if (!data.mergedFromBranches) return [];
    console.log('[Debug] collectMergedBranchContents called, mergedFromBranches:', data.mergedFromBranches);
    return data.mergedFromBranches.map(branchId => {
      const branchNode = nodes.find(n => n.id === branchId);
      const branchData = branchNode?.data as ScriptChapterNodeData | undefined;
      const branchLabel = branchData?.chapterNumber && branchData?.branchIndex
        ? `${branchData.chapterNumber}-${branchData.branchIndex}`
        : undefined;
      return {
        title: branchData?.title || '',
        content: branchData?.content || '',
        summary: branchData?.summary || '',
        branchIndex: branchData?.branchIndex,
        chapterNumber: branchData?.chapterNumber,
        branchLabel,
      };
    });
  }, [data.mergedFromBranches, nodes]);

  return (
    <>
      <div
        ref={nodeContainerRef}
        className={`group relative rounded-[18px] border ${
          selected
            ? 'border-amber-500/50 shadow-[0_0_0_1px_rgba(245,158,11,0.35)]'
            : 'border-[rgba(15,23,42,0.2)] dark:border-[rgba(255,255,255,0.26)]'
        }`}
        style={{
          width: `${resolvedWidth}px`,
          height: `${resolvedHeight}px`,
          backgroundColor: 'var(--surface-dark)',
        }}
      >
        <Handle
          type="target"
          id="target"
          position={Position.Left}
          className="!h-2 !w-2 !border-surface-dark !bg-amber-400"
        />
        <NodeHeader
          className={NODE_HEADER_FLOATING_POSITION_CLASS}
          icon={<FileText className="h-4 w-4 text-amber-400" />}
          titleText={resolvedTitle}
          editable
          onTitleChange={handleTitleChange}
        />

        <div className="nodrag p-3 h-full flex flex-col">
          <div className="flex items-center gap-2 shrink-0">
            <span className={`text-xs px-1.5 py-0.5 rounded ${
              data.branchType === 'branch' 
                ? 'bg-purple-500/20 text-purple-400' 
                : 'bg-amber-500/20 text-amber-400'
            }`}>
              {data.branchType === 'branch' 
                ? `${data.chapterNumber || 1}-${data.branchIndex || 1}`
                : data.chapterNumber || 1
              }
            </span>
            <input
              type="text"
              value={data.title || ''}
              onChange={(e) => updateNodeData(id, { title: e.target.value })}
              onMouseDown={(e) => e.stopPropagation()}
              placeholder="章节标题"
              className="nodrag flex-1 px-2 py-1 text-sm bg-bg-dark border border-border-dark rounded text-text-dark placeholder:text-text-muted focus:outline-none focus:border-amber-500"
            />
            {data.branchType === 'branch' && (
              <span title="分支节点">
                <GitBranch className="w-4 h-4 text-purple-400" />
              </span>
            )}
          </div>

          {hasMergedBranches && (
            <div className="flex items-center gap-1 flex-wrap shrink-0 mt-1">
              <GitFork className="w-3 h-3 text-cyan-400" />
              <span className="text-xs text-cyan-400">来自</span>
              {collectMergedBranchContents().filter(b => b.branchLabel).map((branch, index, arr) => (
                <Fragment key={index}>
                  <span className="px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-400 text-xs font-medium">
                    {branch.branchLabel}
                  </span>
                  {index < arr.length - 1 && <span className="text-xs text-cyan-400">,</span>}
                </Fragment>
              ))}
            </div>
          )}

          <div className="flex-1 min-h-0 mt-3 overflow-hidden">
            <RichTextEditor
              content={data.content || ''}
              onChange={handleContentChange}
              onSelect={handleTextSelect}
              onContextMenu={handleContextMenu}
              pendingSelectionReplacement={pendingReplacement}
              onSelectionReplacementApplied={handleReplacementApplied}
              placeholder="开始编写剧本内容..."
              className="h-full"
            />
          </div>

          {data.tables && data.tables.length > 0 && (
            <div className="space-y-3 mt-3 shrink-0">
              {data.tables.map((table) => (
                <div key={table.id} className="border border-border-dark rounded overflow-hidden">
                  <div className="flex items-center justify-between bg-bg-dark px-2 py-1">
                    <span className="text-xs text-text-muted">{table.type === 'dialogue' ? '角色对白' : '场景描述'}</span>
                    <button
                      type="button"
                      onClick={() => deleteTable(table.id)}
                      className="text-xs text-red-400 hover:text-red-300 px-1"
                      title="删除表格"
                    >
                      删除
                    </button>
                  </div>
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-bg-dark border-t border-border-dark">
                        {table.columns.map((col) => (
                          <th key={col} className="px-2 py-1 text-left text-text-muted font-medium">
                            {col}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {table.rows.map((row, rowIndex) => (
                        <tr key={rowIndex} className="border-t border-border-dark">
                          {table.columns.map((col) => (
                            <td key={col} className="p-0">
                              <input
                                type="text"
                                value={row[col] || ''}
                                onChange={(e) => updateTableCell(table.id, rowIndex, col, e.target.value)}
                                onMouseDown={(e) => e.stopPropagation()}
                                className="nodrag w-full px-2 py-1 bg-transparent text-text-dark focus:outline-none"
                              />
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <button
                    type="button"
                    onClick={() => addTableRow(table.id)}
                    className="w-full py-1 text-xs text-text-muted hover:text-text-dark hover:bg-bg-dark"
                  >
                    + 添加行
                  </button>
                </div>
              ))}
            </div>
          )}

          {data.summary && (
            <div className="pt-2 border-t border-border-dark mt-3 shrink-0">
              <div className="flex items-start justify-between gap-2">
                <p className="text-xs text-text-muted flex-1">
                  <span className="font-medium">摘要:</span> {data.summary}
                </p>
                <div className="flex items-center gap-1 shrink-0">
                  {isMergePoint && (
                    <button
                      type="button"
                      onClick={() => setAiDialogMode('expandFromMerged')}
                      className="p-1.5 rounded-lg hover:bg-cyan-500/20 text-cyan-400 transition-colors"
                      title="基于分支融合扩写"
                    >
                      <GitFork className="w-4 h-4" />
                    </button>
                  )}
                  <button
                    type="button"
                    ref={aiButtonRef}
                    onClick={() => setAiDialogMode('expandFromSummary')}
                    className="p-1.5 rounded-lg hover:bg-amber-500/20 text-amber-400 transition-colors"
                    title="基于摘要扩写"
                  >
                    <Sparkles className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          )}

          {!data.branchType || data.branchType === 'main' ? (
            <button
              type="button"
              onClick={() => setShowBranchDialog(true)}
              className="mt-3 w-full flex items-center justify-center gap-2 py-2 text-sm text-purple-400 bg-purple-500/10 hover:bg-purple-500/20 rounded-lg border border-purple-500/30 transition-colors"
            >
              <GitBranch className="w-4 h-4" />
              创建分支
            </button>
          ) : null}
        </div>
        <Handle
          type="source"
          id="source"
          position={Position.Right}
          className="!h-3 !w-3 !border-surface-dark !bg-purple-400 !rounded-full !-right-1.5 !top-1/2"
        />
        <Handle
          type="source"
          id="supplement"
          position={Position.Bottom}
          className="!h-3 !w-3 !border-surface-dark !bg-green-400 !rounded-full"
        />
        <div className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-6 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
          <div className="flex items-center gap-1 text-xs text-green-400 bg-surface-dark px-1.5 py-0.5 rounded border border-green-400/30">
            <PlusCircle className="w-3 h-3" />
            <span>补充</span>
          </div>
        </div>
        <NodeResizeHandle
          minWidth={MIN_NODE_WIDTH}
          minHeight={MIN_NODE_HEIGHT}
          maxWidth={MAX_NODE_WIDTH}
          maxHeight={MAX_NODE_HEIGHT}
          isVisible={selected}
        />
      </div>

      {aiDialogMode && (
        <AiWriterDialog
          isOpen={true}
          mode={aiDialogMode}
          originalText={aiDialogMode === 'expandFromSummary' || aiDialogMode === 'expandFromMerged' ? (data.summary || '') : selectedText}
          chapterTitle={data.title}
          chapterNumber={data.chapterNumber}
          mergedBranchContents={hasMergedBranches ? collectMergedBranchContents() : undefined}
          onClose={() => setAiDialogMode(null)}
          onConfirm={handleAiConfirm}
          anchorRef={nodeContainerRef}
          preferredPosition="right"
        />
      )}

      <div
        ref={contextMenuAnchorRef}
        style={{ position: 'fixed', left: 0, top: 0, width: 1, height: 1, pointerEvents: 'none' }}
      />

      {showBranchDialog && (
        <BranchPointDialog
          isOpen={true}
          sourceNodeId={id}
          sourceChapterData={data}
          onClose={() => setShowBranchDialog(false)}
          onConfirm={handleBranchConfirm}
        />
      )}

      <TextContextMenu
        position={contextMenuPosition}
        containerRef={nodeContainerRef}
        onSelectExpand={() => setAiDialogMode('expand')}
        onSelectRewrite={() => setAiDialogMode('rewrite')}
        onClose={() => setContextMenuPosition(null)}
      />
    </>
  );
});

ScriptChapterNode.displayName = 'ScriptChapterNode';
