import { useState } from 'react';
import { ChevronDown, ChevronRight, Plus, RefreshCcw, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { EpisodeCard, ShotRow } from '@/features/canvas/domain/canvasNodes';

interface EpisodeShotScriptTableProps {
  episode: EpisodeCard;
  isGenerating: boolean;
  error: string;
  onGenerate: (mode: 'initial' | 'regenerate') => Promise<void>;
  onAddRow: () => void;
  onUpdateRow: (rowId: string, patch: Partial<ShotRow>) => void;
  onRegenerateRow: (rowId: string) => Promise<void>;
  onDeleteRow: (rowId: string) => void;
  onMoveRow: (rowId: string, direction: 'up' | 'down') => void;
}

const GEN_TARGET_OPTIONS: ShotRow['genTarget'][] = ['image', 'video', 'storyboard'];
const STATUS_OPTIONS: ShotRow['status'][] = ['draft', 'ready', 'locked'];

function CellInput({
  value,
  onChange,
  placeholder,
  multiline = false,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  multiline?: boolean;
}) {
  const className = 'w-full rounded-lg border border-border-dark bg-bg-dark/60 px-2 py-1.5 text-xs text-text-dark outline-none placeholder:text-text-muted/60 focus:border-cyan-500/35';
  return multiline ? (
    <textarea
      rows={3}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      className={`${className} resize-y`}
    />
  ) : (
    <input
      type="text"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      className={className}
    />
  );
}

export function EpisodeShotScriptTable({
  episode,
  isGenerating,
  error,
  onGenerate,
  onAddRow,
  onUpdateRow,
  onRegenerateRow,
  onDeleteRow,
  onMoveRow,
}: EpisodeShotScriptTableProps) {
  const { t } = useTranslation();
  const [expandedRowIds, setExpandedRowIds] = useState<Record<string, boolean>>({});

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void onGenerate(episode.shotRows.length > 0 ? 'regenerate' : 'initial')}
          disabled={isGenerating}
          className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-3 py-1.5 text-xs font-medium text-cyan-200 disabled:opacity-60"
        >
          <RefreshCcw className="h-3.5 w-3.5" />
          {episode.shotRows.length > 0
            ? t('script.sceneWorkbench.regenerateShotScript')
            : t('script.sceneWorkbench.generateShotScript')}
        </button>
        <button
          type="button"
          onClick={onAddRow}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border-dark bg-surface-dark px-3 py-1.5 text-xs font-medium text-text-dark hover:bg-bg-dark"
        >
          <Plus className="h-3.5 w-3.5" />
          {t('script.sceneWorkbench.addShotRow')}
        </button>
        <span className="rounded-full bg-bg-dark/60 px-2.5 py-1 text-xs text-text-muted">
          {t('script.sceneWorkbench.shotRowCount', { count: episode.shotRows.length })}
        </span>
      </div>

      {error ? (
        <div className="rounded-xl border border-red-400/20 bg-red-500/8 px-3 py-2 text-xs leading-5 text-red-200">
          {error}
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-2xl border border-border-dark bg-surface-dark/70">
        <table className="min-w-[1100px] w-full text-left text-xs">
          <thead className="bg-bg-dark/80 text-text-muted">
            <tr>
              <th className="px-3 py-2">{t('script.sceneWorkbench.shotTable.shotNumber')}</th>
              <th className="px-3 py-2">{t('script.sceneWorkbench.shotTable.beat')}</th>
              <th className="px-3 py-2">{t('script.sceneWorkbench.shotTable.action')}</th>
              <th className="px-3 py-2">{t('script.sceneWorkbench.shotTable.composition')}</th>
              <th className="px-3 py-2">{t('script.sceneWorkbench.shotTable.camera')}</th>
              <th className="px-3 py-2">{t('script.sceneWorkbench.shotTable.rhythm')}</th>
              <th className="px-3 py-2">{t('script.sceneWorkbench.shotTable.audio')}</th>
              <th className="px-3 py-2">{t('script.sceneWorkbench.shotTable.genTarget')}</th>
              <th className="px-3 py-2">{t('script.sceneWorkbench.shotTable.genPrompt')}</th>
              <th className="px-3 py-2">{t('common.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {episode.shotRows.map((row, index) => {
              const isExpanded = expandedRowIds[row.id] ?? false;
              return (
                <FragmentRow
                  key={row.id}
                  row={row}
                  index={index}
                  isExpanded={isExpanded}
                  canMoveUp={index > 0}
                  canMoveDown={index < episode.shotRows.length - 1}
                  onToggleExpanded={() => setExpandedRowIds((current) => ({ ...current, [row.id]: !current[row.id] }))}
                  onUpdateRow={onUpdateRow}
                  onRegenerateRow={onRegenerateRow}
                  onDeleteRow={onDeleteRow}
                  onMoveRow={onMoveRow}
                />
              );
            })}
            {episode.shotRows.length === 0 ? (
              <tr>
                <td colSpan={10} className="px-3 py-8 text-center text-text-muted">
                  {t('script.sceneWorkbench.emptyShotRows')}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FragmentRow({
  row,
  index,
  isExpanded,
  canMoveUp,
  canMoveDown,
  onToggleExpanded,
  onUpdateRow,
  onRegenerateRow,
  onDeleteRow,
  onMoveRow,
}: {
  row: ShotRow;
  index: number;
  isExpanded: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onToggleExpanded: () => void;
  onUpdateRow: (rowId: string, patch: Partial<ShotRow>) => void;
  onRegenerateRow: (rowId: string) => Promise<void>;
  onDeleteRow: (rowId: string) => void;
  onMoveRow: (rowId: string, direction: 'up' | 'down') => void;
}) {
  const { t } = useTranslation();

  return (
    <>
      <tr className="border-t border-border-dark/70 align-top">
        <td className="px-3 py-3">
          <button type="button" onClick={onToggleExpanded} className="mb-2 flex h-6 w-6 items-center justify-center rounded-md border border-border-dark bg-bg-dark text-text-muted hover:text-text-dark">
            {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </button>
          <CellInput value={row.shotNumber} onChange={(value) => onUpdateRow(row.id, { shotNumber: value })} placeholder={String(index + 1)} />
        </td>
        <td className="px-3 py-3"><CellInput value={row.beat} onChange={(value) => onUpdateRow(row.id, { beat: value })} placeholder={t('script.sceneWorkbench.shotBeatPlaceholder')} multiline /></td>
        <td className="px-3 py-3"><CellInput value={row.action} onChange={(value) => onUpdateRow(row.id, { action: value })} placeholder={t('script.sceneWorkbench.shotActionPlaceholder')} multiline /></td>
        <td className="px-3 py-3 space-y-2">
          <CellInput value={row.shotSize} onChange={(value) => onUpdateRow(row.id, { shotSize: value })} placeholder={t('script.sceneWorkbench.shotSizePlaceholder')} />
          <CellInput value={row.framingAngle} onChange={(value) => onUpdateRow(row.id, { framingAngle: value })} placeholder={t('script.sceneWorkbench.framingAnglePlaceholder')} />
        </td>
        <td className="px-3 py-3"><CellInput value={row.cameraMove} onChange={(value) => onUpdateRow(row.id, { cameraMove: value })} placeholder={t('script.sceneWorkbench.cameraMovePlaceholder')} multiline /></td>
        <td className="px-3 py-3"><CellInput value={row.rhythmDuration} onChange={(value) => onUpdateRow(row.id, { rhythmDuration: value })} placeholder={t('script.sceneWorkbench.rhythmDurationPlaceholder')} /></td>
        <td className="px-3 py-3 space-y-2">
          <CellInput value={row.dialogueCue} onChange={(value) => onUpdateRow(row.id, { dialogueCue: value })} placeholder={t('script.sceneWorkbench.dialogueCuePlaceholder')} />
          <CellInput value={row.audioCue} onChange={(value) => onUpdateRow(row.id, { audioCue: value })} placeholder={t('script.sceneWorkbench.audioCuePlaceholder')} />
        </td>
        <td className="px-3 py-3">
          <select value={row.genTarget} onChange={(event) => onUpdateRow(row.id, { genTarget: event.target.value as ShotRow['genTarget'] })} className="w-full rounded-lg border border-border-dark bg-bg-dark/60 px-2 py-1.5 text-xs text-text-dark outline-none focus:border-cyan-500/35">
            {GEN_TARGET_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
        </td>
        <td className="px-3 py-3"><CellInput value={row.genPrompt} onChange={(value) => onUpdateRow(row.id, { genPrompt: value })} placeholder={t('script.sceneWorkbench.genPromptPlaceholder')} multiline /></td>
        <td className="px-3 py-3">
          <div className="flex flex-col gap-2">
            <button type="button" onClick={() => void onRegenerateRow(row.id)} className="rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-2 py-1 text-[11px] font-medium text-cyan-200 hover:bg-cyan-500/18">{t('common.regenerate')}</button>
            <button type="button" disabled={!canMoveUp} onClick={() => onMoveRow(row.id, 'up')} className="rounded-lg border border-border-dark bg-bg-dark px-2 py-1 text-[11px] font-medium text-text-dark disabled:opacity-40">{t('common.moveUp')}</button>
            <button type="button" disabled={!canMoveDown} onClick={() => onMoveRow(row.id, 'down')} className="rounded-lg border border-border-dark bg-bg-dark px-2 py-1 text-[11px] font-medium text-text-dark disabled:opacity-40">{t('common.moveDown')}</button>
            <button type="button" onClick={() => onDeleteRow(row.id)} className="inline-flex items-center justify-center rounded-lg border border-red-400/25 bg-red-500/10 px-2 py-1 text-[11px] font-medium text-red-200 hover:bg-red-500/18"><Trash2 className="h-3.5 w-3.5" /></button>
          </div>
        </td>
      </tr>
      {isExpanded ? (
        <tr className="border-t border-border-dark/50 bg-bg-dark/30">
          <td colSpan={10} className="px-3 py-3">
            <div className="grid grid-cols-2 gap-3">
              <CellInput value={row.blocking} onChange={(value) => onUpdateRow(row.id, { blocking: value })} placeholder={t('script.sceneWorkbench.blockingPlaceholder')} multiline />
              <CellInput value={row.artLighting} onChange={(value) => onUpdateRow(row.id, { artLighting: value })} placeholder={t('script.sceneWorkbench.artLightingPlaceholder')} multiline />
              <CellInput value={row.continuityNote} onChange={(value) => onUpdateRow(row.id, { continuityNote: value })} placeholder={t('script.sceneWorkbench.continuityNotePlaceholder')} multiline />
              <div className="space-y-2">
                <select value={row.status} onChange={(event) => onUpdateRow(row.id, { status: event.target.value as ShotRow['status'] })} className="w-full rounded-lg border border-border-dark bg-bg-dark/60 px-2 py-1.5 text-xs text-text-dark outline-none focus:border-cyan-500/35">
                  {STATUS_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
                </select>
              </div>
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}
