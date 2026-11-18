// Searching a list of invoices or bills: every word typed has to be somewhere in the row's text, in any order, ignoring case.
// An amount matches as typed with or without the cents and the thousands comma ("1,250", "1250", "1250.50").

/** The words of a search, lower case. */
export const words = (q) => String(q || '').toLowerCase().split(/\s+/).map((w) => w.replace(/,/g, '')).filter(Boolean);

/** An amount in the ways it might be typed, to be put in a row's search text. */
export function amountText(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '';
  const abs = Math.abs(v);
  return [abs.toFixed(2), abs.toFixed(0), String(Math.round(abs * 100) / 100)].join(' ');
}

/** Does every word of the search appear in the text? A blank search matches everything. */
export function matchesAll(text, q) {
  const ws = words(q);
  if (!ws.length) return true;
  const hay = String(text || '').toLowerCase().replace(/,/g, '');
  return ws.every((w) => hay.includes(w));
}
