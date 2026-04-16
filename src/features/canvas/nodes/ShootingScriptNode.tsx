import { memo, useCallback, useMemo, useState } from 'react';
import { Handle, Position } from '@xyflow/react';
import { Clapperboard, ExternalLink, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { UiScrollArea } from '@/components/ui';
import { SHOOTING_SCRIPT_PRIMARY_COLUMNS } from '@/features/canvas/application/shootingScriptSchema';
import { createManualShootingScriptRow, reindexShootingScriptRows } from '@/features/canvas/application/shootingScriptGenerator';
import {
  CANVAS_NODE_TYPES,
  SHOOTING_SCRIPT_NODE_DEFAULT_HEIGHT,
  SHOOTING_SCRIPT_NODE_DEFAULT_WIDTH,
  formatShootingScriptNodeLabel,
  normalizeShootingScriptNumberingContext,
  type ShootingScriptColumnKey,
  type ShootingScriptNodeData,
  type ShootingScriptRow,
} from '@/features/canvas/domain/canvasNodes';
import { resolveNodeDisplayName } from '@/features/canvas/domain/nodeDisplay';
import { NodeResizeHandle } from '@/features/canvas/ui/NodeResizeHandle';
import { useCanvasStore } from '@/stores/canvasStore';
import { useScriptEditorStore } from '@/stores/scriptEditorStore';

type ShootingScriptNodeProps = {
  id: string;
  data: ShootingScriptNodeData;
  selected?: boolean;
  width?: number;
  height?: number;
};

const MIN_NODE_WIDTH = 960;
const MIN_NODE_HEIGHT = 460;
const MAX_NODE_WIDTH = 2800;
const MAX_NODE_HEIGHT = 1800;

function resolveNodeDimension(value: number | undefined, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 1) {
    return Math.round(value);
  }
  return fallback;
}

function readCellValue(row: ShootingScriptRow, key: ShootingScriptColumnKey): string {
  return String(row[key] ?? '');
}

function buildRowPatch(key: ShootingScriptColumnKey, value: string): Partial<ShootingScriptRow> {
  if (key === 'genTarget') {
    return { genTarget: value as ShootingScriptRow['genTarget'] };
  }
  if (key === 'status') {
    return { status: value as ShootingScriptRow['status'] };
  }
  return { [key]: value } as Partial<ShootingScriptRow>;
}

function isEditableColumn(key: ShootingScriptColumnKey): boolean {
  return key !== 'shotNumber';
}

function stopInteractionPropagation(event: { stopPropagation: () => void }) {
  event.stopPropagation();
}

export const ShootingScriptNode = memo(({
  id,
  data,
  selected,
  width,
  height,
}: ShootingScriptNodeProps) => {
  const { t } = useTranslation();
  const updateNodeData = useCanvasStore((state) => state.updateNodeData);
  const setSelectedNode = useCanvasStore((state) => state.setSelectedNode);
  const focusShootingScript = useScriptEditorStore((state) => state.focusShootingScript);
  const focusShootingScriptCell = useScriptEditorStore((state) => state.focusShootingScriptCell);
  const activeScriptNodeId = useScriptEditorStore((state) => state.activeScriptNodeId);
  const activeScriptCell = useScriptEditorStore((state) => state.activeScriptCell);
  const [editingCell, setEditingCell] = useState<{
    rowId: string;
    columnKey: ShootingScriptColumnKey;
    value: string;
  } | null>(null);

  const resolvedWidth = resolveNodeDimension(width, SHOOTING_SCRIPT_NODE_DEFAULT_WIDTH);
  const resolvedHeight = resolveNodeDimension(height, SHOOTING_SCRIPT_NODE_DEFAULT_HEIGHT);
  const resolvedTitle = resolveNodeDisplayName(CANVAS_NODE_TYPES.shootingScript, data);
  const isActiveScriptNode = activeScriptNodeId === id;
  const numberingContext = useMemo(() => normalizeShootingScriptNumberingContext({
    chapterNumber: data.chapterNumber,
    sceneNumber: data.sceneNumber,
    episodeNumber: data.episodeNumber,
  }), [data.chapterNumber, data.episodeNumber, data.sceneNumber]);

  const commitCellEdit = useCallback(() => {
    if (!editingCell) {
      return;
    }

    const nextRows = data.rows.map((row) => (
      row.id === editingCell.rowId
        ? { ...row, ...buildRowPatch(editingCell.columnKey, editingCell.value) }
        : row
    ));
    updateNodeData(id, { rows: nextRows, status: nextRows.length > 0 ? 'drafting' : 'empty' }, { historyMode: 'skip' });
    setEditingCell(null);
  }, [data.rows, editingCell, id, updateNodeData]);

  const openWorkbench = useCallback((rowId?: string, columnKey?: ShootingScriptColumnKey) => {
    const cell = rowId && columnKey ? { rowId, columnKey } : null;
    setSelectedNode(id);
    focusShootingScript(id, {
      sceneNodeId: data.sourceSceneNodeId,
      episodeId: data.sourceEpisodeId,
      cell,
    });
  }, [data.sourceEpisodeId, data.sourceSceneNodeId, focusShootingScript, id, setSelectedNode]);

  const handleSelectCell = useCallback((rowId: string, columnKey: ShootingScriptColumnKey) => {
    setSelectedNode(id);
    focusShootingScriptCell(id, { rowId, columnKey }, {
      sceneNodeId: data.sourceSceneNodeId,
      episodeId: data.sourceEpisodeId,
    });
  }, [data.sourceEpisodeId, data.sourceSceneNodeId, focusShootingScriptCell, id, setSelectedNode]);

  const addRow = useCallback(() => {
    const nextRows = reindexShootingScriptRows([
      ...data.rows,
      createManualShootingScriptRow(data.rows.length, numberingContext),
    ], numberingContext);
    updateNodeData(id, { rows: nextRows, status: nextRows.length > 0 ? 'drafting' : 'empty' }, { historyMode: 'skip' });
    const newRow = nextRows[nextRows.length - 1];
    if (newRow) {
      handleSelectCell(newRow.id, 'beat');
    }
  }, [data.rows, handleSelectCell, id, numberingContext, updateNodeData]);

  const moveRow = useCallback((rowId: string, direction: 'up' | 'down') => {
    const currentIndex = data.rows.findIndex((row) => row.id === rowId);
    if (currentIndex < 0) {
      return;
    }

    const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
    if (targetIndex < 0 || targetIndex >= data.rows.length) {
      return;
    }

    const nextRows = [...data.rows];
    const [movedRow] = nextRows.splice(currentIndex, 1);
    nextRows.splice(targetIndex, 0, movedRow);
    updateNodeData(id, {
      rows: reindexShootingScriptRows(nextRows, numberingContext),
      status: nextRows.length > 0 ? 'drafting' : 'empty',
    }, { historyMode: 'skip' });
  }, [data.rows, id, numberingContext, updateNodeData]);

  const deleteRow = useCallback((rowId: string) => {
    const nextRows = reindexShootingScriptRows(
      data.rows.filter((row) => row.id !== rowId),
      numberingContext
    );
    updateNodeData(id, { rows: nextRows, status: nextRows.length > 0 ? 'drafting' : 'empty' }, { historyMode: 'skip' });
  }, [data.rows, id, numberingContext, updateNodeData]);

  const selectedCellKey = useMemo(() => (
    isActiveScriptNode && activeScriptCell
      ? `${activeScriptCell.rowId}:${activeScriptCell.columnKey}`
      : null
  ), [activeScriptCell, isActiveScriptNode]);
  const scriptLabel = formatShootingScriptNodeLabel(numberingContext);
  const genTargetOptions = useMemo(() => ([
    { value: 'image', label: t('script.shootingScript.genTarget.image') },
    { value: 'video', label: t('script.shootingScript.genTarget.video') },
    { value: 'storyboard', label: t('script.shootingScript.genTarget.storyboard') },
  ]), [t]);

  return (
    <div
      className={`group relative overflow-visible rounded-[22px] border bg-surface-dark shadow-[0_20px_40px_rgba(2,6,23,0.22)] transition-[border-color,box-shadow] duration-200 ${
        selected
          ? 'border-cyan-300/55 shadow-[0_0_0_1px_rgba(103,232,249,0.4),0_22px_42px_rgba(6,78,110,0.25)]'
          : 'border-cyan-300/18 hover:border-cyan-300/32'
      }`}
      style={{ width: resolvedWidth, height: resolvedHeight }}
      onClick={() => openWorkbench(activeScriptCell?.rowId, activeScriptCell?.columnKey)}
    >
      <Handle
        type="target"
        id="target"
        position={Position.Left}
        className="!h-3 !w-3 !-left-1.5 !rounded-full !border-surface-dark !bg-cyan-400"
      />

      <div className="relative flex h-full flex-col overflow-hidden rounded-[22px] p-3">
        <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-[22px]">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(34,211,238,0.12),transparent_38%)]" />
          <div className="absolute inset-x-0 top-0 h-[2px] bg-cyan-300/70" />
        </div>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-cyan-200/85">
              <span className="rounded-full bg-amber-500/12 px-2 py-0.5 text-amber-200">
                {t('script.sceneCatalog.chapterLabel', { number: data.chapterNumber || 1 })}
              </span>
              <span className="rounded-full bg-cyan-500/10 px-2.5 py-0.5 text-cyan-100">
                {t('script.shootingScript.nodeTitle', { label: scriptLabel })}
              </span>
            </div>
            <div className="mt-2 flex items-center gap-2">
              <Clapperboard className="h-4 w-4 text-cyan-300" />
              <span className="truncate text-sm font-semibold text-text-dark">{resolvedTitle}</span>
            </div>
            <div className="mt-1 line-clamp-1 text-xs text-text-muted">
              {data.sceneTitle || t('script.sceneStudio.untitledScene')}
            </div>
          </div>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                openWorkbench();
              }}
              className="nodrag flex h-8 w-8 items-center justify-center rounded-lg border border-transparent text-text-muted transition-colors hover:border-cyan-400/25 hover:bg-cyan-500/10 hover:text-cyan-100"
              title={t('script.sceneWorkbench.openWorkbench')}
            >
              <ExternalLink className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              addRow();
            }}
            className="nodrag inline-flex items-center gap-1.5 rounded-lg border border-border-dark bg-bg-dark px-3 py-1.5 text-xs font-medium text-text-dark transition-colors hover:bg-bg-dark/80"
          >
            <Plus className="h-3.5 w-3.5" />
            {t('script.shootingScript.addRow')}
          </button>
          <span className="rounded-full bg-bg-dark/60 px-2.5 py-1 text-text-muted">
            {t('script.shootingScript.rowCount', { count: data.rows.length })}
          </span>
          <span className="rounded-full bg-cyan-500/10 px-2.5 py-1 text-cyan-100">
            {t(`script.shootingScript.status.${data.status}`)}
          </span>
        </div>

        <UiScrollArea
          className="nodrag nowheel mt-3 min-h-0 flex-1 rounded-2xl border border-border-dark bg-bg-dark/25"
          viewportClassName="h-full"
          contentClassName="min-w-full"
          onPointerDown={stopInteractionPropagation}
          onMouseDown={stopInteractionPropagation}
          onDoubleClick={stopInteractionPropagation}
        >
          <table className="min-w-[2320px] w-full table-fixed border-separate border-spacing-0 text-left text-[15px]">
            <thead className="sticky top-0 z-10 bg-surface-dark/95 text-[14px] text-text-muted">
              <tr>
                {SHOOTING_SCRIPT_PRIMARY_COLUMNS.map((column) => (
                  <th key={column.key} className={`border-b border-border-dark px-3 py-2.5 font-medium ${column.widthClassName ?? ''}`}>
                    {t(column.labelKey)}
                  </th>
                ))}
                <th className="w-[128px] border-b border-border-dark px-3 py-2.5 font-medium">{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.length > 0 ? data.rows.map((row, index) => (
                <tr key={row.id} className="align-top">
                  {SHOOTING_SCRIPT_PRIMARY_COLUMNS.map((column) => {
                    const cellKey = `${row.id}:${column.key}`;
                    const isSelectedCell = selectedCellKey === cellKey;
                    const isEditingCell = editingCell?.rowId === row.id && editingCell.columnKey === column.key;
                    const isEditable = isEditableColumn(column.key);

                    return (
                      <td key={column.key} className="border-b border-border-dark/70 px-2.5 py-2.5">
                        {isEditingCell ? (
                          column.key === 'genTarget' ? (
                            <select
                              autoFocus
                              value={editingCell.value}
                              onChange={(event) => setEditingCell((current) => current ? { ...current, value: event.target.value } : current)}
                              onBlur={commitCellEdit}
                              onPointerDown={stopInteractionPropagation}
                              onMouseDown={stopInteractionPropagation}
                              onClick={stopInteractionPropagation}
                              className="nodrag nowheel w-full rounded-lg border border-cyan-500/35 bg-bg-dark px-2.5 py-2 text-[15px] text-text-dark outline-none"
                            >
                              {genTargetOptions.map((option) => (
                                <option key={option.value} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <textarea
                              autoFocus
                              rows={column.multiline ? 4 : 1}
                              value={editingCell.value}
                              onChange={(event) => setEditingCell((current) => current ? { ...current, value: event.target.value } : current)}
                              onBlur={commitCellEdit}
                              onPointerDown={stopInteractionPropagation}
                              onMouseDown={stopInteractionPropagation}
                              onClick={stopInteractionPropagation}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                                  event.preventDefault();
                                  commitCellEdit();
                                }
                              }}
                              className="nodrag nowheel w-full resize-none rounded-lg border border-cyan-500/35 bg-bg-dark px-2.5 py-2 text-[15px] leading-7 text-text-dark outline-none"
                            />
                          )
                        ) : (
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              handleSelectCell(row.id, column.key);
                            }}
                            onDoubleClick={(event) => {
                              event.stopPropagation();
                              handleSelectCell(row.id, column.key);
                              if (!isEditable) {
                                return;
                              }
                              setEditingCell({
                                rowId: row.id,
                                columnKey: column.key,
                                value: readCellValue(row, column.key),
                              });
                            }}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter' && isEditable) {
                                event.preventDefault();
                                setEditingCell({
                                  rowId: row.id,
                                  columnKey: column.key,
                                  value: readCellValue(row, column.key),
                                });
                              }
                            }}
                            className={`nodrag flex min-h-[88px] min-w-0 w-full rounded-xl border px-3 py-2.5 text-left text-[15px] transition-colors ${
                              isSelectedCell
                                ? 'border-cyan-400/40 bg-cyan-500/12 text-cyan-50'
                                : 'border-transparent bg-transparent text-text-dark hover:border-cyan-500/20 hover:bg-cyan-500/[0.05]'
                            }`}
                          >
                            <span className="min-w-0 whitespace-pre-wrap break-words leading-7">
                              {readCellValue(row, column.key) || (
                                <span className="text-text-muted/65">{t('script.shootingScript.emptyCell')}</span>
                              )}
                            </span>
                          </button>
                        )}
                      </td>
                    );
                  })}
                  <td className="border-b border-border-dark/70 px-2.5 py-2.5">
                    <div className="flex flex-col gap-2">
                      <button
                        type="button"
                        disabled={index === 0}
                        onClick={(event) => {
                          event.stopPropagation();
                          moveRow(row.id, 'up');
                        }}
                        className="nodrag rounded-lg border border-border-dark bg-bg-dark px-2.5 py-1.5 text-xs font-medium text-text-dark disabled:opacity-40"
                      >
                        {t('common.moveUp')}
                      </button>
                      <button
                        type="button"
                        disabled={index === data.rows.length - 1}
                        onClick={(event) => {
                          event.stopPropagation();
                          moveRow(row.id, 'down');
                        }}
                        className="nodrag rounded-lg border border-border-dark bg-bg-dark px-2.5 py-1.5 text-xs font-medium text-text-dark disabled:opacity-40"
                      >
                        {t('common.moveDown')}
                      </button>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          deleteRow(row.id);
                        }}
                        className="nodrag rounded-lg border border-red-400/25 bg-red-500/10 px-2.5 py-1.5 text-xs font-medium text-red-200"
                      >
                        {t('common.delete')}
                      </button>
                    </div>
                  </td>
                </tr>
              )) : (
                <tr>
                  <td colSpan={SHOOTING_SCRIPT_PRIMARY_COLUMNS.length + 1} className="px-3 py-12 text-center text-sm text-text-muted">
                    {t('script.shootingScript.emptyRows')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </UiScrollArea>
      </div>

      <NodeResizeHandle
        minWidth={MIN_NODE_WIDTH}
        minHeight={MIN_NODE_HEIGHT}
        maxWidth={MAX_NODE_WIDTH}
        maxHeight={MAX_NODE_HEIGHT}
        isVisible={selected}
      />
    </div>
  );
});

ShootingScriptNode.displayName = 'ShootingScriptNode';
