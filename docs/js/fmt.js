export function num(n, dp = 1) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return Number(n).toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

export function tons(n, dp = 1) {
  return `${num(n, dp)} t`;
}

export function ha(n, dp = 1) {
  return `${num(n, dp)} ha`;
}

export function money(n, dp = 0) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  const sign = n < 0 ? '-' : '';
  return `${sign}$${num(Math.abs(n), dp)}`;
}

/**
 * Dollars in millions: 12345678 -> "$12.35m". For a column that would otherwise outgrow a
 * phone screen once its figures reach eight digits.
 */
export function moneyMillions(n, dp = 2) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  const sign = n < 0 ? '-' : '';
  return `${sign}$${num(Math.abs(n) / 1e6, dp)}m`;
}

export function pct(n, dp = 0) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return `${num(n * 100, dp)}%`;
}

export function esc(s) {
  const d = document.createElement('div');
  d.textContent = s ?? '';
  return d.innerHTML;
}

/**
 * "2026-12-21" -> "21-12-2026": day-month-year, with the whole year while there is room. Where the line is
 * crowded (two dates side by side, a row of details) pass { tight: true } for "21-12-26".
 * Anything that is not a plain YYYY-MM-DD comes back untouched, so a bad date
 * shows up as itself rather than as "NaN Undefined".
 */
export function shortDate(iso, { tight = false } = {}) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  if (!m) return iso || '';
  const [, y, mo, d] = m;
  if (Number(mo) < 1 || Number(mo) > 12) return iso;
  return `${d}-${mo}-${tight ? y.slice(2) : y}`;
}

/** shortDate for a crowded line: the two-digit year. Handy as the formatter passed to windowText. */
export const tightDate = (iso) => shortDate(iso, { tight: true });

/** A Date (a moment, in the device's own timezone) as "21-12-26", or "21-12-2026" when `full`. */
export function dmyOfDate(date, full = false) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${p(date.getDate())}-${p(date.getMonth() + 1)}-${full ? date.getFullYear() : p(date.getFullYear() % 100)}`;
}

/** Today as YYYY-MM-DD in the device's own timezone (toISOString would give UTC's date). */
export function todayLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** "30-01-2026" for a 'YYYY-MM-DD' date, as it is written on paperwork. Anything else comes back as it was. */
export function dmy(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  return m ? `${m[3]}-${m[2]}-${m[1]}` : (iso || '');
}
