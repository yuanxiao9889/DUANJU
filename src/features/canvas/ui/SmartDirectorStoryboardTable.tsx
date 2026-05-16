import { ArrowDown, ArrowUp, Check, ChevronDown, Eye, Film, Link2, Loader2, Minus, Plus, Trash2 } from 'lucide-react';
import { memo, useCallback, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';

import { UiButton, UiModal, UiScrollArea } from '@/components/ui';
import {
  DEFAULT_SCRIPT_STORYBOARD_VISIBLE_COLUMN_KEYS,
  SCRIPT_STORYBOARD_TABLE_COLUMNS,
  SCRIPT_STORYBOARD_TABLE_DEFAULT_ROW_HEIGHT,
  SCRIPT_STORYBOARD_TABLE_MAX_ROW_HEIGHT,
  SCRIPT_STORYBOARD_TABLE_MIN_ROW_HEIGHT,
  SCRIPT_STORYBOARD_TABLE_ROW_HEIGHT_STEP,
  addScriptStoryboardTableRow,
  deleteScriptStoryboardTableRow,
  expandScriptStoryboardTableToProductionGroups,
  moveScriptStoryboardTableRow,
  setScriptStoryboardActiveEditingCell,
  setScriptStoryboardTableContinuousReference,
  setScriptStoryboardTableRowHeight,
  setScriptStoryboardVisibleColumns,
  updateScriptStoryboardTableCell,
  type ScriptStoryboardProductionVideoKind,
} from '@/features/canvas/application/smartDirectorStoryboard';
import type {
  DirectorStoryboardTableRow,
  ScriptStoryboardTableEditingCell,
  ScriptStoryboardTableNodeData,
  ScriptStoryboardTableSummary,
} from '@/features/canvas/domain/canvasNodes';

interface SmartDirectorStoryboardSummaryProps {
  summary: ScriptStoryboardTableSummary;
  className?: string;
}

interface SmartDirectorStoryboardTableProps {
  nodeId: string;
  data: ScriptStoryboardTableNodeData;
  summary?: ScriptStoryboardTableSummary;
  className?: string;
}

type TableStyle = CSSProperties & {
  '--storyboard-row-min-height': string;
  '--storyboard-cell-content-height': string;
};

const HEADER_CELL_CLASS =
  'border-b border-border-dark px-2 py-2 whitespace-nowrap text-[11px] uppercase tracking-[0.08em] text-text-muted';
const BODY_CELL_CLASS = 'border-b border-border-dark/70 px-1.5 py-1.5 align-top';
const ACTION_COLUMN_WIDTH = 62;

function formatDuration(value: number): string {
  return `${Number.isInteger(value) ? value : value.toFixed(1)}s`;
}

function formatDurationWithMinutes(value: number): string {
  const seconds = Math.max(0, Math.round(value));
  const minutes = Math.floor(seconds / 60);
  const restSeconds = seconds % 60;
  if (minutes <= 0) {
    return `${formatDuration(value)} · ${restSeconds}秒`;
  }
  return `${formatDuration(value)} · ${minutes}分${restSeconds}秒`;
}

function buildEstimatedVideoText(summary: ScriptStoryboardTableSummary): string {
  return `15s x ${summary.groups15sCount} / 10s x ${summary.groups10sCount}`;
}

function stopInteractionPropagation(event: { stopPropagation: () => void }) {
  event.stopPropagation();
}

function readCellValue(row: DirectorStoryboardTableRow, key: string): string {
  switch (key) {
    case 'duration':
      return String(row.durationSeconds ?? '');
    case 'assets':
      return row.assetRefs.join('\n');
    default:
      return String((row as unknown as Record<string, unknown>)[key] ?? '');
  }
}

function isRowEditable(row: DirectorStoryboardTableRow): boolean {
  return row.rowState !== 'generating';
}

export function SmartDirectorStoryboardSummary({
  summary,
  className = '',
}: SmartDirectorStoryboardSummaryProps) {
  const { t } = useTranslation();
  const items = [
    { label: t('scriptStoryboardTable.summary.rows'), value: summary.rowCount },
    {
      label: t('scriptStoryboardTable.summary.duration'),
      value: formatDurationWithMinutes(summary.totalDurationSeconds),
    },
    {
      label: t('scriptStoryboardTable.summary.estimatedVideos'),
      value: buildEstimatedVideoText(summary),
    },
  ];

  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`}>
      {items.map((item) => (
        <div
          key={item.label}
          className="inline-flex max-w-full items-center gap-2 rounded-lg border border-border-dark bg-bg-dark/35 px-3 py-1.5"
        >
          <span className="shrink-0 text-[11px] text-text-muted">
            {item.label}
          </span>
          <span className="truncate text-sm font-semibold text-accent">{item.value}</span>
        </div>
      ))}
    </div>
  );
}

export const SmartDirectorStoryboardTable = memo(function SmartDirectorStoryboardTable({
  nodeId,
  data,
  summary,
  className = '',
}: SmartDirectorStoryboardTableProps) {
  const { t } = useTranslation();
  const [editingValue, setEditingValue] = useState('');
  const [isColumnMenuOpen, setIsColumnMenuOpen] = useState(false);
  const [pendingProductionMode, setPendingProductionMode] = useState<'10s' | '15s' | null>(null);
  const [selectedVideoKind, setSelectedVideoKind] = useState<ScriptStoryboardProductionVideoKind | null>(null);
  const [isExpandingProduction, setIsExpandingProduction] = useState(false);
  const [productionExpandError, setProductionExpandError] = useState<string | null>(null);

  const rowHeight = data.rowHeight ?? SCRIPT_STORYBOARD_TABLE_DEFAULT_ROW_HEIGHT;
  const visibleColumnKeys =
    data.visibleColumnKeys && data.visibleColumnKeys.length > 0
      ? data.visibleColumnKeys
      : DEFAULT_SCRIPT_STORYBOARD_VISIBLE_COLUMN_KEYS;
  const activeEditingCell: ScriptStoryboardTableEditingCell | null =
    data.activeEditingCell ?? null;

  const visibleColumns = useMemo(() => {
    const visibleKeySet = new Set(visibleColumnKeys);
    const nextColumns = SCRIPT_STORYBOARD_TABLE_COLUMNS.filter((column) =>
      visibleKeySet.has(column.key)
    );
    return nextColumns.length > 0 ? nextColumns : [SCRIPT_STORYBOARD_TABLE_COLUMNS[0]];
  }, [visibleColumnKeys]);

  const tableStyle = useMemo<TableStyle>(() => ({
    '--storyboard-row-min-height': `${rowHeight}px`,
    '--storyboard-cell-content-height': `${Math.max(34, rowHeight - 18)}px`,
  }), [rowHeight]);

  const visibleColumnCount = visibleColumns.length;
  const visibleTableMinWidth = useMemo(
    () =>
      visibleColumns.reduce((sum, column) => sum + column.widthPx, ACTION_COLUMN_WIDTH),
    [visibleColumns]
  );
  const resolveColumnWidthPercent = useCallback(
    (widthPx: number) => `${(widthPx / visibleTableMinWidth) * 100}%`,
    [visibleTableMinWidth]
  );

  const startEditingCell = useCallback((row: DirectorStoryboardTableRow, columnKey: string) => {
    if (!isRowEditable(row)) {
      return;
    }
    setEditingValue(readCellValue(row, columnKey));
    setScriptStoryboardActiveEditingCell({
      nodeId,
      activeEditingCell: {
        rowId: row.id,
        columnKey,
      },
    });
  }, [nodeId]);

  const clearEditingCell = useCallback(() => {
    setScriptStoryboardActiveEditingCell({
      nodeId,
      activeEditingCell: null,
    });
  }, [nodeId]);

  const commitCellEdit = useCallback(() => {
    if (!activeEditingCell) {
      return;
    }
    updateScriptStoryboardTableCell({
      nodeId,
      rowId: activeEditingCell.rowId,
      columnKey: activeEditingCell.columnKey,
      value: editingValue,
    });
  }, [activeEditingCell, editingValue, nodeId]);

  const toggleColumnVisibility = useCallback((columnKey: string) => {
    const nextKeys = visibleColumnKeys.includes(columnKey)
      ? visibleColumnKeys.length <= 1
        ? visibleColumnKeys
        : visibleColumnKeys.filter((key) => key !== columnKey)
      : SCRIPT_STORYBOARD_TABLE_COLUMNS
          .map((column) => column.key)
          .filter((key) => new Set([...visibleColumnKeys, columnKey]).has(key));
    setScriptStoryboardVisibleColumns({
      nodeId,
      visibleColumnKeys: nextKeys,
    });
  }, [nodeId, visibleColumnKeys]);

  const adjustRowHeight = useCallback((direction: -1 | 1) => {
    setScriptStoryboardTableRowHeight({
      nodeId,
      rowHeight: Math.min(
        SCRIPT_STORYBOARD_TABLE_MAX_ROW_HEIGHT,
        Math.max(
          SCRIPT_STORYBOARD_TABLE_MIN_ROW_HEIGHT,
          rowHeight + direction * SCRIPT_STORYBOARD_TABLE_ROW_HEIGHT_STEP
        )
      ),
    });
  }, [nodeId, rowHeight]);

  const handleProductionExpand = useCallback((mode: '10s' | '15s') => {
    setPendingProductionMode(mode);
    setSelectedVideoKind(null);
    setProductionExpandError(null);
  }, []);

  const closeProductionModal = useCallback(() => {
    if (isExpandingProduction) {
      return;
    }
    setPendingProductionMode(null);
    setSelectedVideoKind(null);
    setProductionExpandError(null);
  }, [isExpandingProduction]);

  const confirmProductionExpand = useCallback(async () => {
    if (!pendingProductionMode || !selectedVideoKind || isExpandingProduction) {
      return;
    }
    setIsExpandingProduction(true);
    setProductionExpandError(null);
    await Promise.resolve();
    const resultNodeId = expandScriptStoryboardTableToProductionGroups({
      nodeId,
      mode: pendingProductionMode,
      videoKind: selectedVideoKind,
    });
    setIsExpandingProduction(false);
    if (!resultNodeId) {
      setProductionExpandError(t('scriptStoryboardTable.production.noGroups'));
      return;
    }
    setPendingProductionMode(null);
    setSelectedVideoKind(null);
  }, [isExpandingProduction, nodeId, pendingProductionMode, selectedVideoKind, t]);

  const toggleContinuousReference = useCallback(() => {
    setScriptStoryboardTableContinuousReference({
      nodeId,
      enabled: data.continuousReferenceEnabled !== true,
    });
  }, [data.continuousReferenceEnabled, nodeId]);

  const isStoryboardMirror = data.presentationMode === 'storyboardMirror';

  return (
    <div className={`flex min-h-0 flex-1 flex-col ${className}`}>
      {isStoryboardMirror ? (
        <div
          className="nodrag mb-2 flex flex-wrap items-center gap-2 rounded-2xl border border-border-dark bg-bg-dark/45 px-3 py-2 text-xs shadow-sm"
          onPointerDown={stopInteractionPropagation}
          onMouseDown={stopInteractionPropagation}
          onDoubleClick={stopInteractionPropagation}
        >
          <span className="shrink-0 text-[11px] font-medium text-text-muted">
            {t('scriptStoryboardTable.production.generateGroups')}
          </span>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              handleProductionExpand('15s');
            }}
            className="inline-flex items-center gap-1.5 rounded-xl border border-border-dark bg-surface-dark px-3 py-1.5 font-semibold text-text-dark transition-colors hover:border-accent/45 hover:bg-accent/12"
          >
            <Film className="h-3.5 w-3.5 text-accent" />
            {t('scriptStoryboardTable.production.video15s')}
          </button>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              handleProductionExpand('10s');
            }}
            className="inline-flex items-center gap-1.5 rounded-xl border border-border-dark bg-surface-dark px-3 py-1.5 font-semibold text-text-dark transition-colors hover:border-accent/45 hover:bg-accent/12"
          >
            <Film className="h-3.5 w-3.5 text-accent" />
            {t('scriptStoryboardTable.production.video10s')}
          </button>
          <button
            type="button"
            aria-pressed={data.continuousReferenceEnabled === true}
            onClick={(event) => {
              event.stopPropagation();
              toggleContinuousReference();
            }}
            className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 font-semibold transition-colors ${
              data.continuousReferenceEnabled === true
                ? 'border-emerald-400/35 bg-emerald-400/12 text-emerald-200'
                : 'border-border-dark bg-surface-dark text-text-muted hover:border-accent/45 hover:bg-accent/12 hover:text-text-dark'
            }`}
          >
            <Link2 className="h-3.5 w-3.5" />
            {data.continuousReferenceEnabled === true
              ? t('scriptStoryboardTable.production.continuousEnabled')
              : t('scriptStoryboardTable.production.continuous')}
          </button>
        </div>
      ) : null}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs">
        {summary ? <SmartDirectorStoryboardSummary summary={summary} /> : null}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              setIsColumnMenuOpen((current) => !current);
            }}
            className="nodrag inline-flex items-center gap-1.5 rounded-lg border border-border-dark bg-bg-dark px-3 py-1.5 text-xs font-medium text-text-dark transition-colors hover:bg-bg-dark/80"
          >
            <Eye className="h-3.5 w-3.5" />
            {t('scriptStoryboardTable.viewColumns')}
            <ChevronDown
              className={`h-3.5 w-3.5 transition-transform ${isColumnMenuOpen ? 'rotate-180' : ''}`}
            />
          </button>
          {isColumnMenuOpen ? (
            <div
              className="nodrag nowheel absolute left-0 top-[calc(100%+6px)] z-30 w-[220px] overflow-hidden rounded-xl border border-border-dark bg-surface-dark/98 py-1.5 text-xs shadow-[0_18px_36px_rgba(0,0,0,0.36)] backdrop-blur"
              onPointerDown={stopInteractionPropagation}
              onMouseDown={stopInteractionPropagation}
              onClick={stopInteractionPropagation}
              onDoubleClick={stopInteractionPropagation}
            >
              <div className="border-b border-border-dark/70 px-3 pb-1.5 pt-0.5 text-[11px] font-medium text-text-muted">
                {t('scriptStoryboardTable.toggleColumns')}
              </div>
              {SCRIPT_STORYBOARD_TABLE_COLUMNS.map((column) => {
                const isVisible = visibleColumnKeys.includes(column.key);
                const isLastVisible = isVisible && visibleColumnCount <= 1;
                return (
                  <button
                    key={column.key}
                    type="button"
                    disabled={isLastVisible}
                    onClick={() => toggleColumnVisibility(column.key)}
                    className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left font-medium text-text-dark transition-colors hover:bg-bg-dark/80 disabled:cursor-not-allowed disabled:opacity-55"
                  >
                    <span className="min-w-0 truncate">{t(column.labelKey)}</span>
                    {isVisible ? (
                      <Check className="h-3.5 w-3.5 shrink-0 text-text-muted" />
                    ) : (
                      <span className="h-3.5 w-3.5 shrink-0" />
                    )}
                  </button>
                );
              })}
            </div>
          ) : null}
          </div>

          <div className="inline-flex items-center gap-2 rounded-lg border border-border-dark bg-bg-dark px-2 py-1.5 text-xs text-text-muted">
          <span>{t('scriptStoryboardTable.rowHeight')}</span>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              adjustRowHeight(-1);
            }}
            className="nodrag rounded-md p-0.5 text-text-dark transition-colors hover:bg-bg-dark/80"
          >
            <Minus className="h-3.5 w-3.5" />
          </button>
          <span className="min-w-[28px] text-center font-medium text-text-dark">{rowHeight}</span>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              adjustRowHeight(1);
            }}
            className="nodrag rounded-md p-0.5 text-text-dark transition-colors hover:bg-bg-dark/80"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
          </div>
        </div>
      </div>

      <UiScrollArea
        className="nodrag nowheel min-h-0 flex-1 rounded-2xl border border-border-dark bg-bg-dark/25"
        viewportClassName="h-full"
        contentClassName="min-w-full pr-5"
        onPointerDown={stopInteractionPropagation}
        onMouseDown={stopInteractionPropagation}
        onDoubleClick={stopInteractionPropagation}
      >
        <table
          className="w-full table-fixed border-separate border-spacing-0 text-left"
          style={{ ...tableStyle, minWidth: visibleTableMinWidth, width: '100%' }}
        >
          <colgroup>
            {visibleColumns.map((column) => (
              <col
                key={column.key}
                style={{ width: resolveColumnWidthPercent(column.widthPx) }}
              />
            ))}
            <col style={{ width: resolveColumnWidthPercent(ACTION_COLUMN_WIDTH) }} />
          </colgroup>
          <thead className="sticky top-0 z-10 bg-surface-dark/95 text-text-muted backdrop-blur">
            <tr>
              {visibleColumns.map((column) => (
                <th key={column.key} className={HEADER_CELL_CLASS}>
                  {t(column.labelKey)}
                </th>
              ))}
              <th className={HEADER_CELL_CLASS}>{t('common.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.length > 0 ? (
              data.rows.map((row, index) => (
                <tr key={row.id} className="align-top text-xs text-text-dark">
                  {visibleColumns.map((column) => {
                    const isActiveEditingCell =
                      activeEditingCell?.rowId === row.id && activeEditingCell?.columnKey === column.key;
                    const isEditable = Boolean(column.editable) && isRowEditable(row);
                    const cellValue = readCellValue(row, column.key);

                    return (
                      <td key={column.key} className={BODY_CELL_CLASS}>
                        {isActiveEditingCell ? (
                          <textarea
                            autoFocus
                            value={editingValue}
                            onChange={(event) => setEditingValue(event.target.value)}
                            onBlur={commitCellEdit}
                            onPointerDown={stopInteractionPropagation}
                            onMouseDown={stopInteractionPropagation}
                            onClick={stopInteractionPropagation}
                            onKeyDown={(event) => {
                              if (event.key === 'Escape') {
                                event.preventDefault();
                                clearEditingCell();
                              }
                              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                                event.preventDefault();
                                commitCellEdit();
                              }
                            }}
                            className="nodrag nowheel w-full resize-none rounded-lg border border-border-dark bg-bg-dark px-2 py-1.5 text-text-dark outline-none focus:border-text-muted/60 [overflow-wrap:anywhere]"
                            style={{ height: 'var(--storyboard-cell-content-height)' }}
                          />
                        ) : (
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                            }}
                            onDoubleClick={(event) => {
                              event.stopPropagation();
                              if (isEditable) {
                                startEditingCell(row, column.key);
                              }
                            }}
                            className={`nodrag flex w-full min-w-0 rounded-lg border px-2 py-1.5 text-left transition-colors ${
                              isEditable
                                ? 'border-transparent bg-transparent text-text-dark hover:border-[rgba(15,23,42,0.24)] hover:bg-bg-dark/70 dark:hover:border-white/20'
                                : 'cursor-default border-transparent bg-transparent text-text-dark/90'
                            }`}
                            style={{ minHeight: 'var(--storyboard-row-min-height)' }}
                          >
                            <div
                              className="nowheel min-w-0 flex-1 overflow-y-auto pr-1"
                              style={{ maxHeight: 'var(--storyboard-cell-content-height)' }}
                            >
                              {column.key === 'shotNumber' ? (
                                <div className="font-semibold">{cellValue || '-'}</div>
                              ) : column.key === 'duration' ? (
                                <div>{formatDuration(row.durationSeconds)}</div>
                              ) : column.key === 'assets' ? (
                                row.assetRefs.length > 0 ? (
                                  <div className="flex flex-wrap gap-1">
                                    {row.assetRefs.map((asset) => (
                                      <span
                                        key={`${row.id}-${asset}`}
                                        className="max-w-full truncate rounded-full border border-border-dark bg-bg-dark/65 px-1.5 py-0.5 text-[11px] text-text-muted"
                                      >
                                        {asset}
                                      </span>
                                    ))}
                                  </div>
                                ) : (
                                  <span className="text-text-muted/65">-</span>
                                )
                              ) : (
                                <div className="whitespace-pre-wrap break-words leading-5 [overflow-wrap:anywhere]">
                                  {cellValue || <span className="text-text-muted/65">{t('scriptStoryboardTable.emptyCell')}</span>}
                                </div>
                              )}
                              {column.key === 'shotNumber' && row.rowError ? (
                                <div className="mt-2 whitespace-pre-wrap text-[11px] leading-5 text-rose-200">
                                  {row.rowError}
                                </div>
                              ) : null}
                            </div>
                          </button>
                        )}
                      </td>
                    );
                  })}
                  <td className={BODY_CELL_CLASS}>
                    <div
                      className="nowheel grid grid-cols-2 gap-1 overflow-y-auto pr-1"
                      style={{ maxHeight: 'var(--storyboard-cell-content-height)' }}
                    >
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          const rowId = addScriptStoryboardTableRow({
                            nodeId,
                            afterRowId: row.id,
                          });
                          if (rowId) {
                            setEditingValue('');
                          }
                        }}
                        className="nodrag flex h-7 w-7 items-center justify-center rounded-lg border border-border-dark bg-bg-dark text-text-dark transition-colors hover:bg-bg-dark/80"
                        title={t('scriptStoryboardTable.insertRow')}
                        aria-label={t('scriptStoryboardTable.insertRow')}
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        disabled={index === 0}
                        onClick={(event) => {
                          event.stopPropagation();
                          moveScriptStoryboardTableRow({
                            nodeId,
                            rowId: row.id,
                            direction: 'up',
                          });
                        }}
                        className="nodrag flex h-7 w-7 items-center justify-center rounded-lg border border-border-dark bg-bg-dark text-text-dark transition-colors hover:bg-bg-dark/80 disabled:opacity-40"
                        title={t('common.moveUp')}
                        aria-label={t('common.moveUp')}
                      >
                        <ArrowUp className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        disabled={index === data.rows.length - 1}
                        onClick={(event) => {
                          event.stopPropagation();
                          moveScriptStoryboardTableRow({
                            nodeId,
                            rowId: row.id,
                            direction: 'down',
                          });
                        }}
                        className="nodrag flex h-7 w-7 items-center justify-center rounded-lg border border-border-dark bg-bg-dark text-text-dark transition-colors hover:bg-bg-dark/80 disabled:opacity-40"
                        title={t('common.moveDown')}
                        aria-label={t('common.moveDown')}
                      >
                        <ArrowDown className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          deleteScriptStoryboardTableRow({
                            nodeId,
                            rowId: row.id,
                          });
                        }}
                        className="nodrag flex h-7 w-7 items-center justify-center rounded-lg border border-red-900/30 bg-red-950/[0.06] text-red-900 transition-colors hover:border-red-900/45 hover:bg-red-950/[0.1] dark:border-red-400/25 dark:bg-red-500/10 dark:text-red-200 dark:hover:bg-red-500/18"
                        title={t('common.delete')}
                        aria-label={t('common.delete')}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td
                  colSpan={visibleColumns.length + 1}
                  className="px-3 py-12 text-center text-sm text-text-muted"
                >
                  {t('scriptStoryboardTable.emptyRows')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </UiScrollArea>
      <UiModal
        isOpen={pendingProductionMode !== null}
        title={t('scriptStoryboardTable.production.chooseVideoTitle')}
        onClose={closeProductionModal}
        widthClassName="w-[420px]"
        draggable
        footer={(
          <div className="flex w-full items-center justify-end gap-2">
            <UiButton
              type="button"
              variant="ghost"
              disabled={isExpandingProduction}
              onClick={closeProductionModal}
            >
              {t('common.cancel')}
            </UiButton>
            <UiButton
              type="button"
              variant="primary"
              disabled={!selectedVideoKind || isExpandingProduction}
              onClick={() => void confirmProductionExpand()}
            >
              {isExpandingProduction ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : null}
              {isExpandingProduction
                ? t('scriptStoryboardTable.production.generating')
                : t('scriptStoryboardTable.production.confirmGenerate')}
            </UiButton>
          </div>
        )}
      >
        <div className="space-y-3 text-sm text-text-dark">
          <p className="text-xs leading-5 text-text-muted">
            {t('scriptStoryboardTable.production.chooseVideoDescription')}
          </p>
          <div className="grid gap-2">
            <button
              type="button"
              aria-pressed={selectedVideoKind === 'jimeng'}
              disabled={isExpandingProduction}
              className={`rounded-2xl border px-4 py-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-70 ${
                selectedVideoKind === 'jimeng'
                  ? 'border-accent/70 bg-accent/12 shadow-[0_0_0_1px_rgba(59,130,246,0.18)]'
                  : 'border-border-dark bg-bg-dark/60 hover:border-accent/45 hover:bg-accent/10'
              }`}
              onClick={() => {
                setSelectedVideoKind('jimeng');
                setProductionExpandError(null);
              }}
            >
              <div className="font-semibold text-text-dark">
                {t('scriptStoryboardTable.production.videoKindJimeng')}
              </div>
              <div className="mt-1 text-xs text-text-muted">
                {t('scriptStoryboardTable.production.videoKindJimengHint')}
              </div>
            </button>
            <button
              type="button"
              aria-pressed={selectedVideoKind === 'seedanceOfficial'}
              disabled={isExpandingProduction}
              className={`rounded-2xl border px-4 py-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-70 ${
                selectedVideoKind === 'seedanceOfficial'
                  ? 'border-accent/70 bg-accent/12 shadow-[0_0_0_1px_rgba(59,130,246,0.18)]'
                  : 'border-border-dark bg-bg-dark/60 hover:border-accent/45 hover:bg-accent/10'
              }`}
              onClick={() => {
                setSelectedVideoKind('seedanceOfficial');
                setProductionExpandError(null);
              }}
            >
              <div className="font-semibold text-text-dark">
                {t('scriptStoryboardTable.production.videoKindSeedance')}
              </div>
              <div className="mt-1 text-xs text-text-muted">
                {t('scriptStoryboardTable.production.videoKindSeedanceHint')}
              </div>
            </button>
          </div>
          {productionExpandError ? (
            <div className="rounded-xl border border-red-500/25 bg-red-500/10 px-3 py-2 text-xs leading-5 text-red-200">
              {productionExpandError}
            </div>
          ) : null}
        </div>
      </UiModal>
    </div>
  );
});
