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

export function pct(n, dp = 0) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return `${num(n * 100, dp)}%`;
}

export function esc(s) {
  const d = document.createElement('div');
  d.textContent = s ?? '';
  return d.innerHTML;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * "2026-12-21" -> "21 Dec", or "21 Dec 27" when it is not this calendar year.
 * Anything that is not a plain YYYY-MM-DD comes back untouched, so a bad date
 * shows up as itself rather than as "NaN Undefined".
 */
export function shortDate(iso, { today = new Date() } = {}) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  if (!m) return iso || '';
  const [, y, mo, d] = m;
  const name = MONTHS[Number(mo) - 1];
  if (!name) return iso;
  const day = String(Number(d));
  return Number(y) === today.getFullYear() ? `${day} ${name}` : `${day} ${name} ${y.slice(2)}`;
}

/** Today as YYYY-MM-DD in the device's own timezone (toISOString would give UTC's date). */
export function todayLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
