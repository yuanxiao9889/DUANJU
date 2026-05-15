import { memo, useCallback, useMemo, useState } from 'react';
import { Check, GitBranch, PenSquare, Plus, Trash2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import {
  SCRIPT_PLOT_LINE_NODE_DEFAULT_HEIGHT,
  SCRIPT_PLOT_LINE_NODE_DEFAULT_WIDTH,
  type ExtractedScriptPlotLine,
  type ScriptPlotLineNodeData,
} from '@/features/canvas/domain/canvasNodes';
import { useCanvasStore } from '@/stores/canvasStore';

import {
  SCRIPT_NODE_ICON_BUTTON_CLASS,
  SCRIPT_NODE_INPUT_CLASS,
  SCRIPT_NODE_LABEL_CLASS,
  SCRIPT_NODE_PRIMARY_BUTTON_CLASS,
  SCRIPT_NODE_SECONDARY_BUTTON_CLASS,
  SCRIPT_NODE_TEXTAREA_CLASS,
  ScriptNodeCard,
} from './ScriptNodeCard';

type ScriptPlotLineNodeProps = {
  id: string;
  data: ScriptPlotLineNodeData;
  selected?: boolean;
};

const DEFAULT_WIDTH = SCRIPT_PLOT_LINE_NODE_DEFAULT_WIDTH;
const DEFAULT_MIN_HEIGHT = SCRIPT_PLOT_LINE_NODE_DEFAULT_HEIGHT;

function resolvePlotLineTagClass(statusTag: string): string {
  const normalizedTag = statusTag.trim().toLowerCase();

  if (
    normalizedTag.includes('紧张')
    || normalizedTag.includes('爆发')
    || normalizedTag.includes('高潮')
    || normalizedTag.includes('urgent')
    || normalizedTag.includes('climax')
  ) {
    return 'border-[#f3a847]/22 bg-[#f3a847]/16 text-[#ffcc7b]';
  }

  if (
    normalizedTag.includes('燃')
    || normalizedTag.includes('冲突')
    || normalizedTag.includes('battle')
    || normalizedTag.includes('action')
  ) {
    return 'border-[#ff6f5e]/22 bg-[#ff6f5e]/16 text-[#ff9789]';
  }

  if (
    normalizedTag.includes('悬')
    || normalizedTag.includes('迷')
    || normalizedTag.includes('mystery')
    || normalizedTag.includes('suspense')
  ) {
    return 'border-white/10 bg-white/6 text-text-muted';
  }

  return 'border-[#f0a44b]/16 bg-[#f0a44b]/10 text-[#ffc97b]';
}

export const ScriptPlotLineNode = memo(({
  id,
  data,
  selected,
}: ScriptPlotLineNodeProps) => {
  const { t } = useTranslation();
  const setSelectedNode = useCanvasStore((state) => state.setSelectedNode);
  const updateNodeData = useCanvasStore((state) => state.updateNodeData);
  const deleteNode = useCanvasStore((state) => state.deleteNode);
  const [isEditing, setIsEditing] = useState(false);
  const [activeAssetRowId, setActiveAssetRowId] = useState<string | null>(null);
  const [isNewAssetRow, setIsNewAssetRow] = useState(false);
  const [assetRowDraft, setAssetRowDraft] = useState({
    title: '',
    subtitle: '',
    body: '',
  });
  const [editData, setEditData] = useState({
    title: data.title || '',
    summary: data.summary || '',
    statusTag: data.statusTag || '',
    relatedCharacterNames: data.relatedCharacterNames || [],
    relatedSceneNames: data.relatedSceneNames || [],
  });

  const openEdit = useCallback(() => {
    setEditData({
      title: data.title || '',
      summary: data.summary || '',
      statusTag: data.statusTag || '',
      relatedCharacterNames: data.relatedCharacterNames || [],
      relatedSceneNames: data.relatedSceneNames || [],
    });
    setIsEditing(true);
  }, [data.relatedCharacterNames, data.relatedSceneNames, data.statusTag, data.summary, data.title]);

  const handleSaveEdit = useCallback(() => {
    updateNodeData(id, {
      ...editData,
      displayName: editData.title || data.displayName,
    });
    setIsEditing(false);
  }, [data.displayName, editData, id, updateNodeData]);

  const handleCancelEdit = useCallback(() => {
    setEditData({
      title: data.title || '',
      summary: data.summary || '',
      statusTag: data.statusTag || '',
      relatedCharacterNames: data.relatedCharacterNames || [],
      relatedSceneNames: data.relatedSceneNames || [],
    });
    setIsEditing(false);
  }, [data.relatedCharacterNames, data.relatedSceneNames, data.statusTag, data.summary, data.title]);

  const statusTagClassName = useMemo(
    () => resolvePlotLineTagClass(data.statusTag || ''),
    [data.statusTag]
  );
  const entries = useMemo(
    () => (Array.isArray(data.entries) ? data.entries : []),
    [data.entries]
  );
  const assetPanelRows = useMemo(
    () => (Array.isArray(data.assetPanelRows) ? data.assetPanelRows : []),
    [data.assetPanelRows]
  );

  const openAssetRowEditor = useCallback((rowId: string) => {
    const row = assetPanelRows.find((item) => item.id === rowId);
    if (!row) {
      return;
    }

    setActiveAssetRowId(rowId);
    setIsNewAssetRow(false);
    setAssetRowDraft({
      title: row.title || '',
      subtitle: row.subtitle || '',
      body: row.prompt || row.body || '',
    });
  }, [assetPanelRows]);

  const handleAddAssetRow = useCallback(() => {
    const rowId = `asset-row-${Date.now()}`;
    updateNodeData(id, {
      assetPanelRows: [
        ...assetPanelRows,
        {
          id: rowId,
          title: '',
          subtitle: '',
          body: '',
          prompt: '',
          meta: [],
        },
      ],
    });
    setActiveAssetRowId(rowId);
    setIsNewAssetRow(true);
    setAssetRowDraft({
      title: '',
      subtitle: '',
      body: '',
    });
  }, [assetPanelRows, id, updateNodeData]);

  const handleDeleteAssetRow = useCallback((rowId: string) => {
    updateNodeData(id, {
      assetPanelRows: assetPanelRows.filter((row) => row.id !== rowId),
    });
    if (activeAssetRowId === rowId) {
      setActiveAssetRowId(null);
      setIsNewAssetRow(false);
      setAssetRowDraft({
        title: '',
        subtitle: '',
        body: '',
      });
    }
  }, [activeAssetRowId, assetPanelRows, id, updateNodeData]);

  const handleSaveAssetRow = useCallback((rowId: string) => {
    updateNodeData(id, {
      assetPanelRows: assetPanelRows.map((row) => (
        row.id === rowId
          ? {
            ...row,
            title: assetRowDraft.title.trim() || row.title || '未命名条目',
            subtitle: assetRowDraft.subtitle.trim(),
            body: assetRowDraft.body.trim(),
            prompt: '',
          }
          : row
      )),
    });
    setActiveAssetRowId(null);
    setIsNewAssetRow(false);
  }, [assetPanelRows, assetRowDraft.body, assetRowDraft.subtitle, assetRowDraft.title, id, updateNodeData]);

  const handleCancelAssetRow = useCallback((rowId: string) => {
    if (isNewAssetRow) {
      updateNodeData(id, {
        assetPanelRows: assetPanelRows.filter((row) => row.id !== rowId),
      });
    }
    setActiveAssetRowId(null);
    setIsNewAssetRow(false);
    setAssetRowDraft({
      title: '',
      subtitle: '',
      body: '',
    });
  }, [assetPanelRows, id, isNewAssetRow, updateNodeData]);

  if (assetPanelRows.length > 0 && !isEditing) {
    return (
      <div
        className={`group relative h-full w-full overflow-hidden rounded-[var(--node-radius)] border bg-[#151515] transition-all duration-150 ${
          selected
            ? 'border-[#f0a34b]/42 shadow-[0_0_0_1px_rgba(240,163,75,0.18),0_12px_28px_rgba(0,0,0,0.22)]'
            : 'border-white/[0.14] hover:border-[#f0a34b]/24'
        }`}
        onClick={() => setSelectedNode(id)}
        onDoubleClick={(event) => event.stopPropagation()}
      >
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,178,92,0.08),transparent_32%),linear-gradient(180deg,rgba(255,255,255,0.035),transparent_52%)]" />
        <div className="relative flex h-full min-h-0 w-full flex-col">
          <div className="flex h-12 shrink-0 items-center gap-2 border-b border-white/[0.08] px-5">
            <GitBranch className="h-4 w-4 text-[#f0a34b]" />
            <div className="min-w-0 flex-1 truncate text-sm font-semibold text-[#f0a34b]">
              {data.title || data.displayName || t('scriptNodes.plotLine.titleFallback')}
            </div>
            <span className="rounded-full border border-white/[0.08] bg-white/[0.04] px-2.5 py-1 text-[11px] text-text-muted">
              {assetPanelRows.length}
            </span>
            <div className="nodrag flex items-center gap-1">
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  handleAddAssetRow();
                }}
                className={SCRIPT_NODE_ICON_BUTTON_CLASS}
                title={t('common.add')}
              >
                <Plus className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  deleteNode(id);
                }}
                className={`${SCRIPT_NODE_ICON_BUTTON_CLASS} hover:border-red-400/25 hover:bg-red-500/10 hover:text-red-200`}
                title={t('common.delete')}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="ui-scrollbar nodrag nowheel flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overflow-x-hidden px-5 py-4 pr-6">
            {assetPanelRows.map((row) => {
              const isAssetRowEditing = activeAssetRowId === row.id;
              const displayBody = row.prompt || row.body;
              return (
                <div
                  key={row.id}
                  className="rounded-2xl border border-white/[0.08] bg-[#1d1d1d] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.035)]"
                >
                  {isAssetRowEditing ? (
                    <div className="space-y-3">
                      <div>
                        <label className={SCRIPT_NODE_LABEL_CLASS}>{t('scriptNodes.plotLine.title')}</label>
                        <input
                          type="text"
                          value={assetRowDraft.title}
                          onChange={(event) => setAssetRowDraft((previous) => ({ ...previous, title: event.target.value }))}
                          className={SCRIPT_NODE_INPUT_CLASS}
                          placeholder={t('scriptNodes.plotLine.titlePlaceholder')}
                        />
                      </div>
                      <div>
                        <label className={SCRIPT_NODE_LABEL_CLASS}>{t('scriptNodes.plotLine.statusTag')}</label>
                        <input
                          type="text"
                          value={assetRowDraft.subtitle}
                          onChange={(event) => setAssetRowDraft((previous) => ({ ...previous, subtitle: event.target.value }))}
                          className={SCRIPT_NODE_INPUT_CLASS}
                          placeholder="输入标签"
                        />
                      </div>
                      <div>
                        <label className={SCRIPT_NODE_LABEL_CLASS}>{t('scriptNodes.plotLine.summary')}</label>
                        <textarea
                          value={assetRowDraft.body}
                          onChange={(event) => setAssetRowDraft((previous) => ({ ...previous, body: event.target.value }))}
                          className={SCRIPT_NODE_TEXTAREA_CLASS}
                          rows={8}
                          placeholder={t('scriptNodes.plotLine.summaryPlaceholder')}
                        />
                      </div>
                      <div className="flex justify-end gap-2 pt-1">
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            handleCancelAssetRow(row.id);
                          }}
                          className={SCRIPT_NODE_SECONDARY_BUTTON_CLASS}
                        >
                          <X className="h-3.5 w-3.5" />
                          {t('common.cancel')}
                        </button>
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            handleSaveAssetRow(row.id);
                          }}
                          className={SCRIPT_NODE_PRIMARY_BUTTON_CLASS}
                        >
                          <Check className="h-3.5 w-3.5" />
                          {t('common.save')}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="min-w-0 flex-1 break-words text-[15px] font-semibold leading-6 text-text-dark">
                          {row.title}
                        </h3>
                        {row.subtitle ? (
                          <span className="rounded-full border border-[#f0a34b]/20 bg-[#f0a34b]/10 px-2.5 py-1 text-[11px] leading-none text-[#ffc97b]">
                            {row.subtitle}
                          </span>
                        ) : null}
                        <div className="nodrag ml-auto flex items-center gap-1">
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              openAssetRowEditor(row.id);
                            }}
                            className={SCRIPT_NODE_ICON_BUTTON_CLASS}
                            title={t('common.edit')}
                          >
                            <PenSquare className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              handleDeleteAssetRow(row.id);
                            }}
                            className={`${SCRIPT_NODE_ICON_BUTTON_CLASS} hover:border-red-400/25 hover:bg-red-500/10 hover:text-red-200`}
                            title={t('common.delete')}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                      {displayBody ? (
                        <p className="mt-2 break-words text-[13px] leading-6 text-text-dark/82">
                          {displayBody}
                        </p>
                      ) : null}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  if (entries.length > 0 && !isEditing) {
    return (
      <div
        className={`group relative h-full w-full overflow-hidden rounded-[var(--node-radius)] border bg-[#151515] transition-all duration-150 ${
          selected
            ? 'border-[#f0a34b]/42 shadow-[0_0_0_1px_rgba(240,163,75,0.18),0_12px_28px_rgba(0,0,0,0.22)]'
            : 'border-white/[0.14] hover:border-[#f0a34b]/24'
        }`}
        onClick={() => setSelectedNode(id)}
        onDoubleClick={(event) => event.stopPropagation()}
      >
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,178,92,0.08),transparent_32%),linear-gradient(180deg,rgba(255,255,255,0.035),transparent_52%)]" />
        <div className="relative flex h-full min-h-0 w-full flex-col">
          <div className="flex h-12 shrink-0 items-center gap-2 border-b border-white/[0.08] px-5">
            <GitBranch className="h-4 w-4 text-[#f0a34b]" />
            <div className="min-w-0 flex-1 truncate text-sm font-semibold text-[#f0a34b]">
              {t('scriptNodes.plotLine.titleFallback')}
            </div>
            <div className="nodrag flex items-center gap-1">
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  deleteNode(id);
                }}
                className={`${SCRIPT_NODE_ICON_BUTTON_CLASS} hover:border-red-400/25 hover:bg-red-500/10 hover:text-red-200`}
                title={t('common.delete')}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="ui-scrollbar nodrag nowheel flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto overflow-x-hidden px-5 py-5 pr-6">
            {entries.map((entry, index) => (
              <PlotLineEntryRow
                key={`${entry.title}-${index}`}
                entry={entry}
                isLast={index === entries.length - 1}
              />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (isEditing) {
    return (
      <ScriptNodeCard
        accent="rose"
        icon={<PenSquare className="h-4 w-4" />}
        title={data.title || t('scriptNodes.plotLine.titleFallback')}
        selected={selected}
        width={DEFAULT_WIDTH}
        minHeight={240}
        isEditing={isEditing}
        onToggleEdit={handleCancelEdit}
        onDelete={() => deleteNode(id)}
        onClick={() => setSelectedNode(id)}
      >
        <div className="space-y-3">
          <div>
            <label className={SCRIPT_NODE_LABEL_CLASS}>{t('scriptNodes.plotLine.title')}</label>
            <input
              type="text"
              value={editData.title}
              onChange={(event) => setEditData((previous) => ({ ...previous, title: event.target.value }))}
              className={SCRIPT_NODE_INPUT_CLASS}
              placeholder={t('scriptNodes.plotLine.titlePlaceholder')}
            />
          </div>
          <div>
            <label className={SCRIPT_NODE_LABEL_CLASS}>{t('scriptNodes.plotLine.summary')}</label>
            <textarea
              value={editData.summary}
              onChange={(event) => setEditData((previous) => ({ ...previous, summary: event.target.value }))}
              className={SCRIPT_NODE_TEXTAREA_CLASS}
              rows={4}
              placeholder={t('scriptNodes.plotLine.summaryPlaceholder')}
            />
          </div>
          <div>
            <label className={SCRIPT_NODE_LABEL_CLASS}>{t('scriptNodes.plotLine.statusTag')}</label>
            <input
              type="text"
              value={editData.statusTag}
              onChange={(event) => setEditData((previous) => ({ ...previous, statusTag: event.target.value }))}
              className={SCRIPT_NODE_INPUT_CLASS}
              placeholder={t('scriptNodes.plotLine.statusTagPlaceholder')}
            />
          </div>
          <div>
            <label className={SCRIPT_NODE_LABEL_CLASS}>{t('scriptNodes.plotLine.relatedCharacterNames')}</label>
            <input
              type="text"
              value={editData.relatedCharacterNames.join(', ')}
              onChange={(event) =>
                setEditData((previous) => ({
                  ...previous,
                  relatedCharacterNames: event.target.value.split(',').map((item) => item.trim()).filter(Boolean),
                }))
              }
              className={SCRIPT_NODE_INPUT_CLASS}
              placeholder={t('scriptNodes.plotLine.relatedCharacterNamesPlaceholder')}
            />
          </div>
          <div>
            <label className={SCRIPT_NODE_LABEL_CLASS}>{t('scriptNodes.plotLine.relatedSceneNames')}</label>
            <input
              type="text"
              value={editData.relatedSceneNames.join(', ')}
              onChange={(event) =>
                setEditData((previous) => ({
                  ...previous,
                  relatedSceneNames: event.target.value.split(',').map((item) => item.trim()).filter(Boolean),
                }))
              }
              className={SCRIPT_NODE_INPUT_CLASS}
              placeholder={t('scriptNodes.plotLine.relatedSceneNamesPlaceholder')}
            />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={handleCancelEdit}
              className={SCRIPT_NODE_SECONDARY_BUTTON_CLASS}
            >
              <X className="h-3.5 w-3.5" />
              {t('common.cancel')}
            </button>
            <button
              type="button"
              onClick={handleSaveEdit}
              className={SCRIPT_NODE_PRIMARY_BUTTON_CLASS}
            >
              <Check className="h-3.5 w-3.5" />
              {t('common.save')}
            </button>
          </div>
        </div>
      </ScriptNodeCard>
    );
  }

  return (
    <div
      className={`group relative overflow-hidden rounded-[var(--node-radius)] border bg-[#151515] transition-all duration-150 ${
        selected
          ? 'border-[#f0a34b]/42 shadow-[0_0_0_1px_rgba(240,163,75,0.18)]'
          : 'border-white/[0.14] hover:border-[#f0a34b]/24'
      }`}
      style={{ width: DEFAULT_WIDTH, minHeight: DEFAULT_MIN_HEIGHT }}
      onClick={() => setSelectedNode(id)}
    >
      <div className="relative flex gap-4 px-2 py-1">
        <div className="pointer-events-none flex w-6 flex-col items-center">
          <span className="mt-1 h-3.5 w-3.5 rounded-full border border-[#f7a34b]/80 bg-[#ff9d3f] shadow-[0_0_0_3px_rgba(255,157,63,0.16)]" />
          <span className="mt-2 min-h-[94px] w-px flex-1 bg-[linear-gradient(180deg,rgba(240,163,75,0.85),rgba(240,163,75,0.12))]" />
        </div>

        <div className="min-w-0 flex-1 rounded-[18px] border border-white/[0.03] bg-[rgba(7,15,28,0.28)] px-4 py-3 space-y-2.5">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="min-w-0 text-[18px] font-semibold leading-7 tracking-[0.01em] text-text-dark">
                  {data.title || t('scriptNodes.plotLine.titleFallback')}
                </h3>
                {data.statusTag ? (
                  <span className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-medium leading-none ${statusTagClassName}`}>
                    {data.statusTag}
                  </span>
                ) : null}
              </div>
            </div>

            <div className="nodrag flex items-center gap-1">
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  openEdit();
                }}
                className={SCRIPT_NODE_ICON_BUTTON_CLASS}
                title={t('common.edit')}
              >
                <PenSquare className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  deleteNode(id);
                }}
                className={`${SCRIPT_NODE_ICON_BUTTON_CLASS} hover:border-red-400/25 hover:bg-red-500/10 hover:text-red-200`}
                title={t('common.delete')}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </div>

          {data.summary ? (
            <p className="text-[14px] leading-7 text-text-dark/82">
              {data.summary}
            </p>
          ) : (
            <p className="text-[13px] leading-6 text-text-muted/72">
              {t('scriptNodes.plotLine.emptyHint')}
            </p>
          )}

          {data.relatedCharacterNames.length > 0 ? (
            <div className="text-[12px] leading-5 text-text-muted/82">
              {t('scriptNodes.plotLine.relatedCharactersValue', { names: data.relatedCharacterNames.join(' / ') })}
            </div>
          ) : null}
          {data.relatedSceneNames.length > 0 ? (
            <div className="text-[12px] leading-5 text-text-muted/72">
              {t('scriptNodes.plotLine.relatedScenesValue', { names: data.relatedSceneNames.join(' / ') })}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
});

ScriptPlotLineNode.displayName = 'ScriptPlotLineNode';

function PlotLineEntryRow({
  entry,
  isLast,
}: {
  entry: ExtractedScriptPlotLine;
  isLast: boolean;
}) {
  const { t } = useTranslation();
  const statusTagClassName = resolvePlotLineTagClass(entry.statusTag || '');

  return (
    <div className={`relative flex gap-4 ${isLast ? '' : 'pb-2'}`}>
      <div className="pointer-events-none flex w-6 flex-col items-center">
        <span className="mt-1 h-3.5 w-3.5 rounded-full border border-[#f7a34b]/80 bg-[#ff9d3f] shadow-[0_0_0_3px_rgba(255,157,63,0.16)]" />
        {!isLast ? (
          <span className="mt-2 w-px flex-1 bg-[linear-gradient(180deg,rgba(240,163,75,0.88),rgba(240,163,75,0.14))]" />
        ) : (
          <span className="mt-2 min-h-[18px] w-px bg-[linear-gradient(180deg,rgba(240,163,75,0.45),rgba(240,163,75,0.02))]" />
        )}
      </div>

      <div className="min-w-0 flex-1 space-y-2 pb-3 pr-8">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="min-w-0 break-words text-[17px] font-semibold leading-7 tracking-[0.01em] text-text-dark">
            {entry.title}
          </h3>
          {entry.statusTag ? (
            <span className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-medium leading-none ${statusTagClassName}`}>
              {entry.statusTag}
            </span>
          ) : null}
        </div>

        {entry.summary ? (
          <p className="break-words text-[14px] leading-7 text-text-dark/82">
            {entry.summary}
          </p>
        ) : null}

        {entry.relatedCharacterNames.length > 0 ? (
          <div className="break-words text-[12px] leading-5 text-text-muted/82">
            {t('scriptNodes.plotLine.relatedCharactersValue', { names: entry.relatedCharacterNames.join(' / ') })}
          </div>
        ) : null}
        {entry.relatedSceneNames.length > 0 ? (
          <div className="break-words text-[12px] leading-5 text-text-muted/72">
            {t('scriptNodes.plotLine.relatedScenesValue', { names: entry.relatedSceneNames.join(' / ') })}
          </div>
        ) : null}
      </div>
    </div>
  );
}
