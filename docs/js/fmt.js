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
