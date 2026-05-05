import { invoke } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';
import { Copy, Download, RefreshCw, Search, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import * as XLSX from 'xlsx';

import {
  clearErrorLogItems,
  deleteErrorLogItem,
  listErrorLogItems,
  type ErrorLogItemRecord,
} from '@/commands/errorLog';
import { UiButton, UiModal, UiSelect } from '@/components/ui';

interface ErrorLogDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

function normalizeText(value: string | null | undefined): string {
  return (value ?? '').trim();
}

function formatDateTime(timestamp: number): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return '';
  }
  return new Date(timestamp).toLocaleString();
}

function formatDateInputValue(timestamp: number): string {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function resolveStartOfDay(value: string): number | null {
  if (!value) {
    return null;
  }
  const timestamp = new Date(`${value}T00:00:00`).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function resolveEndOfDay(value: string): number | null {
  if (!value) {
    return null;
  }
  const timestamp = new Date(`${value}T23:59:59.999`).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function resolveDiagnosticId(record: ErrorLogItemRecord): string {
  return normalizeText(record.requestId)
    || normalizeText(record.externalTaskId)
    || normalizeText(record.jobId);
}

function resolveDiagnosticIdKind(record: ErrorLogItemRecord): 'requestId' | 'externalTaskId' | 'jobId' | 'none' {
  if (normalizeText(record.requestId)) {
    return 'requestId';
  }
  if (normalizeText(record.externalTaskId)) {
    return 'externalTaskId';
  }
  if (normalizeText(record.jobId)) {
    return 'jobId';
  }
  return 'none';
}

function buildXlsxRows(records: ErrorLogItemRecord[]) {
  return records.map((record, index) => ({
    id: index + 1,
    diagnostic_id: resolveDiagnosticId(record),
    diagnostic_id_type: resolveDiagnosticIdKind(record),
    user_id: record.userId,
    created_at: Math.floor(record.createdAt / 1000),
    local_time: formatDateTime(record.createdAt),
    type: record.type,
    content: record.content || record.message || '',
    username: record.username,
    token_name: record.tokenName,
    model_name: record.modelName || record.model || '',
    quota: record.quota,
    prompt_tokens: record.promptTokens,
    completion_tokens: record.completionTokens,
    use_time: record.useTime,
    is_stream: record.isStream,
    channel: record.channel,
    channel_name: record.channelName || record.providerId || '',
    token_id: record.tokenId,
    group: record.group,
    ip: record.ip,
    request_id: record.requestId || '',
    other: record.other || '',
  }));
}

function buildDefaultExportFileName(): string {
  const now = new Date();
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('');
  return `storyboard-error-logs-last-7-days-${stamp}.xlsx`;
}

export function ErrorLogDialog({ isOpen, onClose }: ErrorLogDialogProps) {
  const { t } = useTranslation();
  const [records, setRecords] = useState<ErrorLogItemRecord[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const showNotice = useCallback((message: string, timeout = 1400) => {
    setNotice(message);
    window.setTimeout(() => setNotice(null), timeout);
  }, []);

  const loadRecords = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      setRecords(await listErrorLogItems());
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      void loadRecords();
    }
  }, [isOpen, loadRecords]);

  const sourceOptions = useMemo(() => (
    Array.from(new Set(records.map((record) => record.sourceType).filter(Boolean))).sort()
  ), [records]);

  const categoryOptions = useMemo(() => (
    Array.from(new Set(records.map((record) => record.category).filter(Boolean) as string[])).sort()
  ), [records]);

  const filteredRecords = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const start = resolveStartOfDay(startDate);
    const end = resolveEndOfDay(endDate);

    return records.filter((record) => {
      if (sourceFilter && record.sourceType !== sourceFilter) {
        return false;
      }
      if (categoryFilter && record.category !== categoryFilter) {
        return false;
      }
      if (start !== null && record.createdAt < start) {
        return false;
      }
      if (end !== null && record.createdAt > end) {
        return false;
      }
      if (!normalizedQuery) {
        return true;
      }
      const haystack = [
        record.requestId,
        record.traceId,
        record.jobId,
        record.externalTaskId,
        record.modelName,
        record.model,
        record.tokenName,
        record.channelName,
        record.providerId,
        record.content,
        record.message,
        record.details,
        record.other,
      ].map((value) => normalizeText(value).toLowerCase()).join('\n');
      return haystack.includes(normalizedQuery);
    });
  }, [categoryFilter, endDate, query, records, sourceFilter, startDate]);

  const recentRecords = useMemo(() => {
    const cutoff = Date.now() - SEVEN_DAYS_MS;
    return records.filter((record) => record.createdAt >= cutoff);
  }, [records]);

  const handleCopy = useCallback(async (value: string | null | undefined) => {
    const content = normalizeText(value);
    if (!content) {
      return;
    }
    await navigator.clipboard.writeText(content);
    showNotice(t('errorLog.copied'));
  }, [showNotice, t]);

  const handleDelete = useCallback(async (record: ErrorLogItemRecord) => {
    await deleteErrorLogItem(record.id);
    setRecords((current) => current.filter((item) => item.id !== record.id));
  }, []);

  const handleClear = useCallback(async () => {
    if (!window.confirm(t('errorLog.clearConfirm'))) {
      return;
    }
    await clearErrorLogItems();
    setRecords([]);
  }, [t]);

  const handleExport = useCallback(async () => {
    setIsExporting(true);
    setLoadError(null);
    try {
      if (recentRecords.length === 0) {
        showNotice(t('errorLog.exportEmpty'), 1600);
        return;
      }

      const targetPath = await save({
        defaultPath: buildDefaultExportFileName(),
        filters: [{ name: 'Excel Workbook', extensions: ['xlsx'] }],
      });
      if (!targetPath) {
        return;
      }

      const worksheet = XLSX.utils.json_to_sheet(buildXlsxRows(recentRecords));
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Error Logs');
      const output = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
      await invoke('save_binary_file', {
        path: targetPath,
        content: Array.from(new Uint8Array(output)),
      });
      showNotice(t('errorLog.exported'), 1600);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsExporting(false);
    }
  }, [recentRecords, showNotice, t]);

  const handlePresetSevenDays = useCallback(() => {
    const now = Date.now();
    setStartDate(formatDateInputValue(now - SEVEN_DAYS_MS));
    setEndDate(formatDateInputValue(now));
  }, []);

  return (
    <UiModal
      isOpen={isOpen}
      title={t('errorLog.title')}
      onClose={onClose}
      widthClassName="w-[1040px]"
      bodyClassName="p-0"
      footer={(
        <UiButton variant="muted" size="sm" onClick={onClose}>
          {t('common.close')}
        </UiButton>
      )}
    >
      <div className="flex h-[72vh] min-h-[520px] flex-col">
        <div className="border-b border-border-dark p-4">
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex h-9 min-w-[260px] flex-1 items-center gap-2 rounded-lg border border-border-dark bg-surface-dark px-3 text-sm text-text-muted">
              <Search className="h-4 w-4" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t('errorLog.searchPlaceholder')}
                className="min-w-0 flex-1 bg-transparent text-text-dark outline-none placeholder:text-text-muted"
              />
            </label>
            <UiSelect
              value={sourceFilter}
              onChange={(event) => setSourceFilter(event.target.value)}
              className="h-9 min-w-[150px]"
              aria-label={t('errorLog.sourceFilter')}
            >
              <option value="">{t('errorLog.allSources')}</option>
              {sourceOptions.map((source) => (
                <option key={source} value={source}>
                  {t(`errorLog.sources.${source}`, { defaultValue: source })}
                </option>
              ))}
            </UiSelect>
            <UiSelect
              value={categoryFilter}
              onChange={(event) => setCategoryFilter(event.target.value)}
              className="h-9 min-w-[150px]"
              aria-label={t('errorLog.categoryFilter')}
            >
              <option value="">{t('errorLog.allCategories')}</option>
              {categoryOptions.map((category) => (
                <option key={category} value={category}>
                  {t(`aiError.categoryLabels.${category}`, { defaultValue: category })}
                </option>
              ))}
            </UiSelect>
            <input
              type="date"
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
              className="h-9 rounded-lg border border-border-dark bg-surface-dark px-3 text-sm text-text-dark outline-none"
              aria-label={t('errorLog.startDate')}
            />
            <input
              type="date"
              value={endDate}
              onChange={(event) => setEndDate(event.target.value)}
              className="h-9 rounded-lg border border-border-dark bg-surface-dark px-3 text-sm text-text-dark outline-none"
              aria-label={t('errorLog.endDate')}
            />
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs text-text-muted">
              {t('errorLog.summary', {
                count: filteredRecords.length,
                total: records.length,
                exportCount: recentRecords.length,
              })}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {notice && <span className="text-xs text-accent">{notice}</span>}
              <UiButton variant="ghost" size="sm" onClick={handlePresetSevenDays}>
                {t('errorLog.lastSevenDays')}
              </UiButton>
              <UiButton variant="muted" size="sm" onClick={() => void loadRecords()} disabled={isLoading}>
                <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                {t('common.refresh')}
              </UiButton>
              <UiButton variant="muted" size="sm" onClick={() => void handleExport()} disabled={isExporting}>
                <Download className="mr-1.5 h-3.5 w-3.5" />
                {t('errorLog.exportLastSevenDays')}
              </UiButton>
              <UiButton variant="ghost" size="sm" onClick={() => void handleClear()} disabled={records.length === 0}>
                <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                {t('errorLog.clear')}
              </UiButton>
            </div>
          </div>
        </div>

        {loadError && (
          <div className="border-b border-red-500/20 bg-red-500/10 px-4 py-2 text-xs text-red-300">
            {loadError}
          </div>
        )}

        <div className="ui-scrollbar min-h-0 flex-1 overflow-auto">
          {isLoading ? (
            <div className="flex h-full items-center justify-center text-sm text-text-muted">
              {t('errorLog.loading')}
            </div>
          ) : filteredRecords.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-text-muted">
              {t('errorLog.empty')}
            </div>
          ) : (
            <table className="min-w-full border-separate border-spacing-0 text-left text-xs">
              <thead className="sticky top-0 z-10 bg-bg-dark text-text-muted">
                <tr>
                  <th className="border-b border-border-dark px-4 py-3 font-medium">{t('errorLog.time')}</th>
                  <th className="border-b border-border-dark px-4 py-3 font-medium">{t('errorLog.source')}</th>
                  <th className="border-b border-border-dark px-4 py-3 font-medium">{t('errorLog.model')}</th>
                  <th className="border-b border-border-dark px-4 py-3 font-medium">{t('errorLog.diagnosticId')}</th>
                  <th className="border-b border-border-dark px-4 py-3 font-medium">{t('errorLog.status')}</th>
                  <th className="border-b border-border-dark px-4 py-3 font-medium">{t('errorLog.message')}</th>
                  <th className="border-b border-border-dark px-4 py-3 text-right font-medium">{t('errorLog.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {filteredRecords.map((record) => {
                  const diagnosticId = resolveDiagnosticId(record);
                  const diagnosticKind = resolveDiagnosticIdKind(record);
                  return (
                    <tr key={record.id} className="text-text-dark hover:bg-bg-dark/60">
                      <td className="max-w-[150px] border-b border-border-dark/70 px-4 py-3 text-text-muted">
                        {formatDateTime(record.createdAt)}
                      </td>
                      <td className="border-b border-border-dark/70 px-4 py-3">
                        <div>{t(`errorLog.sources.${record.sourceType}`, { defaultValue: record.sourceType })}</div>
                        <div className="mt-1 text-text-muted">
                          {t(`errorLog.stages.${record.failureStage}`, { defaultValue: record.failureStage })}
                        </div>
                      </td>
                      <td className="max-w-[190px] border-b border-border-dark/70 px-4 py-3">
                        <div className="truncate">{record.modelName || record.model || t('errorLog.unknown')}</div>
                        <div className="mt-1 truncate text-text-muted">
                          {record.channelName || record.providerId || t('errorLog.unknown')}
                        </div>
                      </td>
                      <td className="max-w-[210px] border-b border-border-dark/70 px-4 py-3">
                        <button
                          type="button"
                          className="max-w-full truncate text-left text-accent hover:underline disabled:text-text-muted disabled:no-underline"
                          disabled={!diagnosticId}
                          onClick={() => void handleCopy(diagnosticId)}
                        >
                          {diagnosticId || t('errorLog.notExtracted')}
                        </button>
                        <div className="mt-1 text-text-muted">
                          {t(`errorLog.idKinds.${diagnosticKind}`)}
                        </div>
                      </td>
                      <td className="border-b border-border-dark/70 px-4 py-3">
                        <div>{record.statusCode ?? t('errorLog.noStatusCode')}</div>
                        <div className="mt-1 text-text-muted">
                          {record.category
                            ? t(`aiError.categoryLabels.${record.category}`, { defaultValue: record.category })
                            : t('errorLog.unknown')}
                        </div>
                      </td>
                      <td className="max-w-[260px] border-b border-border-dark/70 px-4 py-3">
                        <div className="line-clamp-2">{record.content || record.message}</div>
                      </td>
                      <td className="border-b border-border-dark/70 px-4 py-3">
                        <div className="flex justify-end gap-1">
                          <button
                            type="button"
                            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-text-muted hover:bg-surface-dark hover:text-text-dark disabled:opacity-40"
                            title={t('errorLog.copyDiagnosticId')}
                            disabled={!diagnosticId}
                            onClick={() => void handleCopy(diagnosticId)}
                          >
                            <Copy className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-text-muted hover:bg-surface-dark hover:text-red-300"
                            title={t('errorLog.delete')}
                            onClick={() => void handleDelete(record)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </UiModal>
  );
}
