// Generic CSV building/download — no dependency, opens directly in Excel.
// A UTF-8 BOM + CRLF line endings keep Excel from mangling special
// characters (° in angle-of-repose columns, accented names) or guessing the
// wrong encoding.

function cell(value) {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/**
 * columns: [{ label, get(row) }]
 */
export function toCSV(rows, columns) {
  const header = columns.map((c) => cell(c.label)).join(',');
  const lines = rows.map((row) => columns.map((c) => cell(c.get(row))).join(','));
  return [header, ...lines].join('\r\n');
}

export function downloadCSV(filename, csvText) {
  const blob = new Blob(['﻿' + csvText], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function exportRowsAsCSV(filename, rows, columns) {
  downloadCSV(filename, toCSV(rows, columns));
}
