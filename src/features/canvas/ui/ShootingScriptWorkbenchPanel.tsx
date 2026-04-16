import { useMemo } from 'react';
import { ExternalLink, Plus, RefreshCcw, Sparkles, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { UiLoadingOverlay, UiScrollArea } from '@/components/ui';
import {
  SHOOTING_SCRIPT_DETAIL_COLUMNS,
  SHOOTING_SCRIPT_PRIMARY_COLUMNS,
} from '@/features/canvas/application/shootingScriptSchema';
import {
  formatShootingScriptNodeLabel,
  normalizeShootingScriptNumberingContext,
} from '@/features/canvas/domain/canvasNodes';
import type {
  ShootingScriptColumnKey,
  ShootingScriptNodeData,
  ShootingScriptRow,
} from '@/features/canvas/domain/canvasNodes';
import type { ShootingScriptCellSelection } from '@/stores/scriptEditorStore';

function Field({
  label,
  value,
  onChange,
  multiline = false,
  rows = 3,
  readOnly = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  multiline?: boolean;
  rows?: number;
  readOnly?: boolean;
}) {
  const className =
    `w-full rounded-xl border border-border-dark px-3 py-2 text-sm text-text-dark outline-none transition-colors placeholder:text-text-muted/60 ${
      readOnly
        ? 'bg-bg-dark/35 text-text-muted'
        : 'bg-bg-dark/60 focus:border-cyan-500/35'
    }`;

  return (
    <label className="block">
      <div className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.08em] text-text-muted">
        {label}
      </div>
      {multiline ? (
        <textarea
          rows={rows}
          value={value}
          readOnly={readOnly}
          onChange={(event) => onChange(event.target.value)}
          className={`${className} resize-none`}
        />
      ) : (
        <input
          type="text"
          value={value}
          readOnly={readOnly}
          onChange={(event) => onChange(event.target.value)}
          className={className}
        />
      )}
    </label>
  );
}

interface ShootingScriptWorkbenchPanelProps {
  nodeData: ShootingScriptNodeData;
  selectedRow: ShootingScriptRow | null;
  activeCell: ShootingScriptCellSelection | null;
  isGenerating: boolean;
  generationError: string;
  rewriteInput: string;
  rewriteError: string;
  rewriteVariants: string[];
  isRewriteLoading: boolean;
  onRewriteInputChange: (value: string) => void;
  onGenerate: (mode: 'initial' | 'regenerate') => Promise<void>;
  onAddRow: () => void;
  onUpdateRow: (rowId: string, patch: Partial<ShootingScriptRow>) => void;
  onRegenerateRow: (rowId: string) => Promise<void>;
  onDeleteRow: (rowId: string) => void;
  onMoveRow: (rowId: string, direction: 'up' | 'down') => void;
  onSelectCell: (rowId: string, columnKey: ShootingScriptColumnKey) => void;
  onApplyRewriteVariant: (variant: string) => void;
  onRunRewrite: () => Promise<void>;
  onOpenSourceEpisode: () => void;
}

export function ShootingScriptWorkbenchPanel({
  nodeData,
  selectedRow,
  activeCell,
  isGenerating,
  generationError,
  rewriteInput,
  rewriteError,
  rewriteVariants,
  isRewriteLoading,
  onRewriteInputChange,
  onGenerate,
  onAddRow,
  onUpdateRow,
  onRegenerateRow,
  onDeleteRow,
  onMoveRow,
  onSelectCell,
  onApplyRewriteVariant,
  onRunRewrite,
  onOpenSourceEpisode,
}: ShootingScriptWorkbenchPanelProps) {
  const { t } = useTranslation();
  const numberingContext = useMemo(() => normalizeShootingScriptNumberingContext({
    chapterNumber: nodeData.chapterNumber,
    sceneNumber: nodeData.sceneNumber,
    episodeNumber: nodeData.episodeNumber,
  }), [nodeData.chapterNumber, nodeData.episodeNumber, nodeData.sceneNumber]);

  const selectedColumn = useMemo(
    () => [...SHOOTING_SCRIPT_PRIMARY_COLUMNS, ...SHOOTING_SCRIPT_DETAIL_COLUMNS]
      .find((column) => column.key === activeCell?.columnKey) ?? null,
    [activeCell?.columnKey]
  );
  const isSelectedCellReadOnly = activeCell?.columnKey === 'shotNumber';
  const rewritePresets = useMemo(() => ([
    { id: 'rewrite', label: t('script.shootingScript.rewritePreset.rewrite') },
    { id: 'tighten', label: t('script.shootingScript.rewritePreset.tighten') },
    { id: 'expand', label: t('script.shootingScript.rewritePreset.expand') },
    { id: 'cinematic', label: t('script.shootingScript.rewritePreset.cinematic') },
    { id: 'shootable', label: t('script.shootingScript.rewritePreset.shootable') },
  ]), [t]);
  const genTargetOptions = useMemo(() => ([
    { value: 'image', label: t('script.shootingScript.genTarget.image') },
    { value: 'video', label: t('script.shootingScript.genTarget.video') },
    { value: 'storyboard', label: t('script.shootingScript.genTarget.storyboard') },
  ]), [t]);
  const rowStatusOptions = useMemo(() => ([
    { value: 'draft', label: t('script.shootingScript.rowStatus.draft') },
    { value: 'ready', label: t('script.shootingScript.rowStatus.ready') },
    { value: 'locked', label: t('script.shootingScript.rowStatus.locked') },
  ]), [t]);

  return (
    <div className="relative flex-1 min-h-0">
      <UiLoadingOverlay
        visible={isGenerating || isRewriteLoading}
        insetClassName="inset-3"
      />
      <UiScrollArea
        className="h-full"
        viewportClassName="h-full px-3 py-3"
        contentClassName="space-y-3 pr-3"
      >
        <section className="rounded-2xl border border-border-dark bg-surface-dark/80 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex flex-wrap items-center gap-2 text-[11px] text-cyan-200/85">
                <span className="rounded-full bg-amber-500/12 px-2 py-0.5 text-amber-200">
                  {t('script.sceneCatalog.chapterLabel', { number: nodeData.chapterNumber || 1 })}
                </span>
                <span className="rounded-full bg-cyan-500/10 px-2 py-0.5 text-cyan-100">
                  {formatShootingScriptNodeLabel(numberingContext)}
                </span>
                <span className="rounded-full bg-bg-dark/60 px-2 py-0.5 text-text-muted">
                  {t(`script.shootingScript.status.${nodeData.status}`)}
                </span>
              </div>
              <div className="mt-2 text-base font-semibold text-text-dark">
                {nodeData.episodeTitle || t('script.sceneWorkbench.untitledEpisode')}
              </div>
              <p className="mt-1 text-sm leading-6 text-text-muted">
                {nodeData.sceneTitle || t('script.sceneStudio.untitledScene')}
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={onOpenSourceEpisode}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border-dark bg-bg-dark px-3 py-1.5 text-xs font-medium text-text-dark hover:bg-bg-dark/80"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                {t('script.shootingScript.openSourceEpisode')}
              </button>
              <button
                type="button"
                onClick={() => void onGenerate(nodeData.rows.length > 0 ? 'regenerate' : 'initial')}
                disabled={isGenerating}
                className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-3 py-1.5 text-xs font-medium text-cyan-200 disabled:opacity-60"
              >
                <RefreshCcw className="h-3.5 w-3.5" />
                {nodeData.rows.length > 0
                  ? t('script.shootingScript.regenerateAll')
                  : t('script.shootingScript.generateAll')}
              </button>
              <button
                type="button"
                onClick={onAddRow}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border-dark bg-bg-dark px-3 py-1.5 text-xs font-medium text-text-dark hover:bg-bg-dark/80"
              >
                <Plus className="h-3.5 w-3.5" />
                {t('script.shootingScript.addRow')}
              </button>
            </div>
          </div>

          {generationError ? (
            <div className="mt-3 rounded-xl border border-red-400/20 bg-red-500/8 px-3 py-2 text-xs leading-5 text-red-200">
              {generationError}
            </div>
          ) : null}
        </section>

        <section className="rounded-2xl border border-border-dark bg-surface-dark/80 p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="text-sm font-semibold text-text-dark">
              {t('script.shootingScript.rowStripTitle')}
            </div>
            <span className="rounded-full bg-bg-dark/60 px-2.5 py-1 text-xs text-text-muted">
              {t('script.shootingScript.rowCount', { count: nodeData.rows.length })}
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {nodeData.rows.map((row) => {
              const isActive = selectedRow?.id === row.id;
              return (
                <button
                  key={row.id}
                  type="button"
                  onClick={() => onSelectCell(row.id, activeCell?.columnKey ?? 'beat')}
                  className={`w-[148px] rounded-xl border px-2.5 py-2 text-left transition-colors ${
                    isActive
                      ? 'border-cyan-400/40 bg-cyan-500/12 text-cyan-50'
                      : 'border-border-dark bg-bg-dark/35 text-text-muted hover:border-cyan-500/25 hover:text-text-dark'
                  }`}
                >
                  <div className="text-[10px] font-medium uppercase tracking-[0.08em]">
                    {t('script.shootingScript.rowLabel', { number: row.shotNumber })}
                  </div>
                  <div className="mt-2 line-clamp-2 text-xs leading-4">
                    {row.beat || row.action || t('script.shootingScript.emptyCell')}
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        <section className="rounded-2xl border border-border-dark bg-surface-dark/80 p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-text-dark">
                {t('script.shootingScript.cellEditorTitle')}
              </div>
              <div className="mt-1 text-xs text-text-muted">
                {selectedColumn ? t(selectedColumn.labelKey) : t('script.shootingScript.selectCellHint')}
              </div>
            </div>
            {selectedRow ? (
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void onRegenerateRow(selectedRow.id)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-3 py-1.5 text-xs font-medium text-cyan-200"
                >
                  <RefreshCcw className="h-3.5 w-3.5" />
                  {t('common.regenerate')}
                </button>
                <button
                  type="button"
                  onClick={() => onMoveRow(selectedRow.id, 'up')}
                  className="rounded-lg border border-border-dark bg-bg-dark px-3 py-1.5 text-xs font-medium text-text-dark"
                >
                  {t('common.moveUp')}
                </button>
                <button
                  type="button"
                  onClick={() => onMoveRow(selectedRow.id, 'down')}
                  className="rounded-lg border border-border-dark bg-bg-dark px-3 py-1.5 text-xs font-medium text-text-dark"
                >
                  {t('common.moveDown')}
                </button>
                <button
                  type="button"
                  onClick={() => onDeleteRow(selectedRow.id)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-red-400/25 bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-200"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  {t('common.delete')}
                </button>
              </div>
            ) : null}
          </div>

          {selectedRow && activeCell ? (
            activeCell.columnKey === 'genTarget' ? (
              <label className="block">
                <div className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.08em] text-text-muted">
                  {selectedColumn ? t(selectedColumn.labelKey) : activeCell.columnKey}
                </div>
                <select
                  value={selectedRow.genTarget}
                  onChange={(event) => onUpdateRow(selectedRow.id, {
                    genTarget: event.target.value as ShootingScriptRow['genTarget'],
                  })}
                  className="w-full rounded-xl border border-border-dark bg-bg-dark/60 px-3 py-2 text-sm text-text-dark outline-none focus:border-cyan-500/35"
                >
                  {genTargetOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <Field
                label={selectedColumn ? t(selectedColumn.labelKey) : activeCell.columnKey}
                value={String(selectedRow[activeCell.columnKey] ?? '')}
                onChange={(value) => onUpdateRow(selectedRow.id, {
                  [activeCell.columnKey]: value,
                } as Partial<ShootingScriptRow>)}
                multiline={selectedColumn?.multiline ?? true}
                rows={8}
                readOnly={isSelectedCellReadOnly}
              />
            )
          ) : (
            <div className="rounded-xl border border-dashed border-border-dark/70 bg-bg-dark/35 px-3 py-6 text-center text-sm text-text-muted">
              {t('script.shootingScript.selectCellHint')}
            </div>
          )}
        </section>

        {selectedRow ? (
          <section className="rounded-2xl border border-border-dark bg-surface-dark/80 p-4">
            <div className="mb-3 text-sm font-semibold text-text-dark">
              {t('script.shootingScript.detailEditorTitle')}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field
                label={t('script.shootingScript.detail.blocking')}
                value={selectedRow.blocking}
                onChange={(value) => onUpdateRow(selectedRow.id, { blocking: value })}
                multiline
                rows={4}
              />
              <Field
                label={t('script.shootingScript.detail.artLighting')}
                value={selectedRow.artLighting}
                onChange={(value) => onUpdateRow(selectedRow.id, { artLighting: value })}
                multiline
                rows={4}
              />
              <Field
                label={t('script.shootingScript.detail.continuityNote')}
                value={selectedRow.continuityNote}
                onChange={(value) => onUpdateRow(selectedRow.id, { continuityNote: value })}
                multiline
                rows={4}
              />
              <Field
                label={t('script.shootingScript.detail.directorIntent')}
                value={selectedRow.directorIntent}
                onChange={(value) => onUpdateRow(selectedRow.id, { directorIntent: value })}
                multiline
                rows={4}
              />
              <label className="block">
                <div className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.08em] text-text-muted">
                  {t('script.shootingScript.detail.status')}
                </div>
                <select
                  value={selectedRow.status}
                  onChange={(event) => onUpdateRow(selectedRow.id, { status: event.target.value as ShootingScriptRow['status'] })}
                  className="w-full rounded-xl border border-border-dark bg-bg-dark/60 px-3 py-2 text-sm text-text-dark outline-none focus:border-cyan-500/35"
                >
                  {rowStatusOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </section>
        ) : null}

        <section className="rounded-2xl border border-border-dark bg-surface-dark/80 p-4">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-text-dark">
            <Sparkles className="h-4 w-4 text-cyan-300" />
            {t('script.shootingScript.rewriteTitle')}
          </div>
          <Field
            label={t('script.shootingScript.rewriteInstruction')}
            value={rewriteInput}
            onChange={onRewriteInputChange}
            multiline
            rows={3}
          />
          <div className="mt-3 flex flex-wrap gap-2">
            {rewritePresets.map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => onRewriteInputChange(preset.label)}
                className="rounded-lg border border-border-dark bg-bg-dark px-3 py-1.5 text-xs font-medium text-text-dark hover:bg-bg-dark/80"
              >
                {preset.label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => void onRunRewrite()}
              disabled={!selectedRow || !activeCell || isSelectedCellReadOnly}
              className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-3 py-1.5 text-xs font-medium text-cyan-200 disabled:opacity-60"
            >
              <Sparkles className="h-3.5 w-3.5" />
              {t('script.shootingScript.runRewrite')}
            </button>
          </div>

          {rewriteError ? (
            <div className="mt-3 rounded-xl border border-red-400/20 bg-red-500/8 px-3 py-2 text-xs leading-5 text-red-200">
              {rewriteError}
            </div>
          ) : null}

          {rewriteVariants.length > 0 ? (
            <div className="mt-3 space-y-2">
              {rewriteVariants.map((variant, index) => (
                <div key={`${variant}-${index}`} className="rounded-xl border border-border-dark bg-bg-dark/35 p-3">
                  <div className="whitespace-pre-wrap text-sm leading-6 text-text-dark">{variant}</div>
                  <button
                    type="button"
                    onClick={() => onApplyRewriteVariant(variant)}
                    className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-3 py-1.5 text-xs font-medium text-cyan-200"
                  >
                    {t('script.shootingScript.applyVariant')}
                  </button>
                </div>
              ))}
            </div>
          ) : null}
        </section>
      </UiScrollArea>
    </div>
  );
}
