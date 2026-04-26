import { invoke } from '@tauri-apps/api/core';

import type {
  AdScriptColumnLayoutItem,
  AdScriptTableRow,
} from '@/features/ad/types';

export interface ExportAdScriptWorkbookOptions {
  rows: AdScriptTableRow[];
  columnLayout: AdScriptColumnLayoutItem[];
  filePath: string;
  headers: Record<string, string>;
}

export async function exportAdScriptWorkbook(
  options: ExportAdScriptWorkbookOptions
): Promise<void> {
  const filePath = options.filePath.trim();
  if (!filePath) {
    throw new Error('Export path is required.');
  }

  const visibleColumns = [...options.columnLayout]
    .sort((left, right) => left.order - right.order)
    .filter((item) => item.visible);

  if (visibleColumns.length === 0) {
    throw new Error('At least one column must be visible for export.');
  }

  const XLSX = await import('xlsx');
  const workbook = XLSX.utils.book_new();
  const sheetRows = [
    visibleColumns.map((column) => options.headers[column.key]),
    ...options.rows.map((row) =>
      visibleColumns.map((column) => String(row[column.key] ?? ''))
    ),
  ];
  const worksheet = XLSX.utils.aoa_to_sheet(sheetRows);

  XLSX.utils.book_append_sheet(workbook, worksheet, 'Ad Script');

  const buffer = XLSX.write(workbook, {
    type: 'array',
    bookType: 'xlsx',
  }) as ArrayBuffer;

  await invoke('save_binary_file', {
    path: filePath,
    content: Array.from(new Uint8Array(buffer)),
  });
}
