import { memo, useState, useCallback, useEffect, useRef } from 'react';
import { Handle, Position } from '@xyflow/react';
import { FileText, GitBranch, Sparkles, Pencil, PlusCircle } from 'lucide-react';
import { NodeHeader, NODE_HEADER_FLOATING_POSITION_CLASS } from '@/features/canvas/ui/NodeHeader';
import { NodeResizeHandle } from '@/features/canvas/ui/NodeResizeHandle';
import { AiWriterDialog } from '@/features/canvas/ui/AiWriterDialog';
import { RichTextEditor } from '@/features/canvas/ui/RichTextEditor';
import { CANVAS_NODE_TYPES, type ScriptChapterNodeData } from '@/features/canvas/domain/canvasNodes';
import { resolveNodeDisplayName } from '@/features/canvas/domain/nodeDisplay';
import { useCanvasStore } from '@/stores/canvasStore';

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
  const resolvedTitle = resolveNodeDisplayName(CANVAS_NODE_TYPES.scriptChapter, data);
  const [aiDialogMode, setAiDialogMode] = useState<'expand' | 'rewrite' | null>(null);
  const [selectedText, setSelectedText] = useState('');
  const [contextMenuPosition, setContextMenuPosition] = useState<ContextMenuPosition>(null);
  const nodeContainerRef = useRef<HTMLDivElement>(null);

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
    }
  }, [selectedText]);

  const handleAiConfirm = useCallback(
    (result: string) => {
      updateNodeData(id, { content: result });
      setAiDialogMode(null);
      setSelectedText('');
    },
    [id, updateNodeData]
  );

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

          <div className="flex-1 min-h-0 mt-3 overflow-hidden">
            <RichTextEditor
              content={data.content || ''}
              onChange={handleContentChange}
              onSelect={handleTextSelect}
              onContextMenu={handleContextMenu}
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
              <p className="text-xs text-text-muted">
                <span className="font-medium">摘要:</span> {data.summary}
              </p>
            </div>
          )}
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
          originalText={selectedText}
          onClose={() => setAiDialogMode(null)}
          onConfirm={handleAiConfirm}
          anchorRef={nodeContainerRef}
          preferredPosition="right"
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
