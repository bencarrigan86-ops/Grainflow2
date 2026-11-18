// When the money lands: unpaid invoices coming in and unpaid bills going out, by the month each falls due.
//
// Anything already past its due date is one line, "Overdue", at the top: it is owed now, not in a month. Then the next
// months, then "Later", and "No due date" for the ones nobody dated. A running balance carries down the list. Grain that
// is delivered but not yet invoiced is not in it; it has no date to land on. Pure.

import { receivables, payablesDue } from './outstanding.js?v=407';

const round2 = (n) => Math.round(n * 100) / 100;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const monthKey = (iso) => String(iso).slice(0, 7);
const addMonths = (key, n) => {
  const [y, m] = key.split('-').map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
};
const monthLabel = (key) => `${MONTHS[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`;

/**
 * @param {string} today 'YYYY-MM-DD'
 * @param {number} months how many months ahead get a line of their own
 * @param {{date: string|null, amount: number}[]} expected forecast receipts for grain not yet invoiced (see deliveryplan.js)
 * @returns {{rows: {key: string, label: string, in: number, expected: number, out: number, net: number, balance: number, inCount: number, outCount: number}[],
 *            totalIn: number, totalExpected: number, totalOut: number, net: number}}
 */
export function cashflow(invoices, sales, payables, today, months = 6, expected = []) {
  const owedToYou = receivables(invoices, sales, today).rows;
  const youOwe = payablesDue(payables, today).rows;

  const first = monthKey(today);
  const last = addMonths(first, months - 1);
  const slots = [{ key: 'overdue', label: 'Overdue' }];
  for (let i = 0; i < months; i += 1) { const k = addMonths(first, i); slots.push({ key: k, label: monthLabel(k) }); }
  slots.push({ key: 'later', label: 'Later' }, { key: 'nodate', label: 'No due date' }, { key: 'unscheduled', label: 'Not yet scheduled' });
  const rows = slots.map((s) => ({ ...s, in: 0, expected: 0, out: 0, inCount: 0, outCount: 0 }));
  const by = Object.fromEntries(rows.map((r) => [r.key, r]));

  const slotFor = (r) => {
    if (!r.dueDate) return 'nodate';
    if (r.overdue) return 'overdue';
    const k = monthKey(r.dueDate);
    return k > last ? 'later' : k < first ? 'overdue' : k;
  };
  for (const r of owedToYou) { const s = by[slotFor(r)]; s.in += r.amount; s.inCount += 1; }
  for (const r of youOwe) { const s = by[slotFor(r)]; s.out += r.amount; s.outCount += 1; }
  // money expected from grain not yet invoiced: a forecast, kept in its own column beside what is already invoiced.
  // A date already gone is this month (it is due as soon as it can be); no date at all is "not yet scheduled".
  for (const e of expected || []) {
    const k = e.date ? monthKey(e.date < today ? today : e.date) : null;
    const s = by[!k ? 'unscheduled' : k > last ? 'later' : k];
    s.expected += e.amount;
  }

  let balance = 0;
  for (const r of rows) {
    r.in = round2(r.in); r.expected = round2(r.expected); r.out = round2(r.out); r.net = round2(r.in + r.expected - r.out);
    balance = round2(balance + r.net); r.balance = balance;
  }
  // every dated month stays so the gaps show; the other lines appear only when they hold something
  const shown = rows.filter((r) => r.in || r.expected || r.out || /^\d{4}-/.test(r.key));
  const totalIn = round2(rows.reduce((s, r) => s + r.in, 0));
  const totalExpected = round2(rows.reduce((s, r) => s + r.expected, 0));
  const totalOut = round2(rows.reduce((s, r) => s + r.out, 0));
  return { rows: shown, totalIn, totalExpected, totalOut, net: round2(totalIn + totalExpected - totalOut) };
}
