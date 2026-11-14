// What is still outstanding: grain still to deliver on contracts, and money still to come in on invoices.
//
// Deliveries: each contract that has not been filled, with when its delivery window ends (so you can see what is
// about to fall outside the contract), the orders that are open against it, and how much is not yet ordered.
//
// Receivables: each unpaid invoice with its due date, how many days overdue it is, and the total aged into
// what is not yet due, 1 to 30 days over, 31 to 60, and over 60.
//
// Pure: the screens use it; it touches neither storage nor the page.

import { saleEconomics, invoicedMovementIds, movementsForEndpoint, invoiceLineItems } from './derived.js?v=234';
import { orderState, daysBetween } from './orders.js?v=234';
import { billTotal } from './payables.js?v=234';

// A contract whose window ends within this many days is flagged as ending soon.
export const ENDING_SOON_DAYS = 30;

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const round2 = (n) => Math.round(n * 100) / 100;
const round3 = (n) => Math.round(n * 1000) / 1000;

// --- receivables ------------------------------------------------------------

export const AGE_BUCKETS = [
  { key: 'notdue', label: 'Not yet due' },
  { key: 'd30', label: '1 to 30 days over' },
  { key: 'd60', label: '31 to 60 days over' },
  { key: 'd60plus', label: 'Over 60 days' },
  { key: 'nodate', label: 'No due date' },
];

/** Which age bucket an invoice falls in, from the days it is overdue (negative: not yet due; null: no due date). */
export function ageBucket(daysOver) {
  if (daysOver === null || daysOver === undefined) return 'nodate';
  if (daysOver <= 0) return 'notdue';
  if (daysOver <= 30) return 'd30';
  if (daysOver <= 60) return 'd60';
  return 'd60plus';
}

/**
 * The unpaid invoices, oldest due first (those with no due date last), with the money gathered by age.
 * @param {string} today 'YYYY-MM-DD'
 * @returns {{
 *   rows: {invoice: object, sale: object|undefined, amount: number, dueDate: string, daysOver: number|null, bucket: string, overdue: boolean}[],
 *   outstanding: {count: number, total: number},
 *   overdue: {count: number, total: number},
 *   buckets: Object<string, {count: number, total: number}>
 * }}
 */
export function receivables(invoices, sales, today) {
  const rows = (invoices || [])
    .filter((inv) => inv.status !== 'paid')
    .map((inv) => {
      const daysOver = inv.dueDate ? daysBetween(inv.dueDate, today) : null;
      return {
        invoice: inv,
        sale: (sales || []).find((s) => s.id === inv.saleId),
        amount: num(inv.totalPayable),
        dueDate: inv.dueDate || '',
        daysOver,
        bucket: ageBucket(daysOver),
        overdue: daysOver !== null && daysOver > 0,
      };
    })
    .sort((a, b) => String(a.dueDate || '9999').localeCompare(String(b.dueDate || '9999')) || num(a.invoice.invoiceNo) - num(b.invoice.invoiceNo));

  return { rows, ...gather(rows) };
}

/** What is outstanding and what is overdue in a list of {amount, bucket, overdue} rows, and the money by age. */
function gather(rows) {
  const buckets = Object.fromEntries(AGE_BUCKETS.map((b) => [b.key, { count: 0, total: 0 }]));
  const outstanding = { count: 0, total: 0 };
  const overdue = { count: 0, total: 0 };
  for (const r of rows) {
    outstanding.count += 1; outstanding.total += r.amount;
    buckets[r.bucket].count += 1; buckets[r.bucket].total += r.amount;
    if (r.overdue) { overdue.count += 1; overdue.total += r.amount; }
  }
  outstanding.total = round2(outstanding.total);
  overdue.total = round2(overdue.total);
  for (const b of Object.values(buckets)) b.total = round2(b.total);
  return { outstanding, overdue, buckets };
}

/**
 * The bills the farm has not paid, the same way: oldest due first, with how many days overdue and the money by age.
 * What is owed is the total of the bill, GST included, as that is what is paid.
 * @param {string} today 'YYYY-MM-DD'
 */
export function payablesDue(payables, today) {
  const rows = (payables || [])
    .filter((p) => p.status !== 'paid')
    .map((bill) => {
      const daysOver = bill.dueDate ? daysBetween(bill.dueDate, today) : null;
      return {
        bill, amount: billTotal(bill), dueDate: bill.dueDate || '',
        daysOver, bucket: ageBucket(daysOver), overdue: daysOver !== null && daysOver > 0,
      };
    })
    .sort((a, b) => String(a.dueDate || '9999').localeCompare(String(b.dueDate || '9999')));
  return { rows, ...gather(rows) };
}

/** What is owed to the farm and what it owes, side by side: the net is what is left once both are settled. */
export function moneyPosition(invoices, sales, payables, today) {
  const owedToYou = receivables(invoices, sales, today);
  const youOwe = payablesDue(payables, today);
  return {
    owedToYou, youOwe,
    net: round2(owedToYou.outstanding.total - youOwe.outstanding.total),
    netOverdue: round2(owedToYou.overdue.total - youOwe.overdue.total),
  };
}

// --- deliveries -------------------------------------------------------------

const END_RANK = { ended: 0, soon: 1, ok: 2, none: 3 };

/**
 * The contracts still to deliver on, the ones past or near the end of their window first.
 *
 *   state   ended   the window has ended and grain is still owed
 *           soon    it ends within ENDING_SOON_DAYS days
 *           ok      it ends later
 *           none    the contract has no end date
 *
 * A contract that is filled (within its tolerance) is left out.
 *
 * @param {string} today 'YYYY-MM-DD'
 */
export function deliveries(sales, movements, orders, today) {
  const rows = [];
  for (const sale of sales || []) {
    const tons = num(sale.tons);
    if (!(tons > 0)) continue;
    const econ = saleEconomics(sale, movements);
    if (econ.isFull || econ.tonsDue <= 0.005) continue;

    const end = sale.deliveryEnd || '';
    const daysToEnd = end ? daysBetween(today, end) : null;
    const state = daysToEnd === null ? 'none' : daysToEnd < 0 ? 'ended' : daysToEnd <= ENDING_SOON_DAYS ? 'soon' : 'ok';

    const open = (orders || [])
      .filter((o) => o.saleId === sale.id)
      .map((o) => ({ o, st: orderState(o, movements, today) }))
      .filter((x) => x.st.active);
    const ordersLeft = round3(open.reduce((s, x) => s + x.st.left, 0));
    const nextBy = open.map((x) => x.o.deliverBy).filter(Boolean).sort()[0] || '';

    rows.push({
      sale, tons,
      delivered: round3(econ.tonsDelivered),
      due: round3(econ.tonsDue),
      start: sale.deliveryStart || '', end, daysToEnd, state,
      orders: {
        count: open.length, left: ordersLeft, nextBy, overdue: open.filter((x) => x.st.state === 'overdue').length,
        items: open.map((x) => ({ by: x.o.deliverBy || '', left: x.st.left, overdue: x.st.state === 'overdue' })),
      },
      unordered: Math.max(0, round3(econ.tonsDue - ordersLeft)),
    });
  }
  rows.sort((a, b) => END_RANK[a.state] - END_RANK[b.state]
    || String(a.end || '9999').localeCompare(String(b.end || '9999')));

  const sum = (list) => round3(list.reduce((s, r) => s + r.due, 0));
  return {
    rows,
    total: { count: rows.length, due: sum(rows) },
    ended: { count: rows.filter((r) => r.state === 'ended').length, due: sum(rows.filter((r) => r.state === 'ended')) },
    soon: { count: rows.filter((r) => r.state === 'soon').length, due: sum(rows.filter((r) => r.state === 'soon')) },
    ordersOverdue: rows.reduce((n, r) => n + r.orders.overdue, 0),
  };
}

const addDays = (iso, n) => {
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * The deliveries laid out on one time axis, like a Gantt chart: each contract is a bar from the start of its window
 * to its end, filled by how much has been delivered, with a tick where each open order is due. Positions are
 * percentages of the axis. Contracts with no dates at all cannot be placed and are counted in `unplaced`.
 * Returns null when nothing can be placed.
 */
export function timeline(rows, today) {
  const placed = (rows || []).filter((r) => r.start || r.end);
  const unplaced = (rows || []).length - placed.length;
  if (!placed.length) return null;

  const dates = [today];
  for (const r of placed) {
    if (r.start) dates.push(r.start);
    if (r.end) dates.push(r.end);
    for (const o of r.orders?.items || []) if (o.by) dates.push(o.by);
  }
  dates.sort();
  const lo = addDays(dates[0], -7);
  const hi = addDays(dates[dates.length - 1], 7);
  const span = Math.max(1, daysBetween(lo, hi));
  const at = (d) => Math.min(100, Math.max(0, (daysBetween(lo, d) / span) * 100));

  const months = [];
  const first = new Date(`${lo}T00:00:00Z`);
  let y = first.getUTCFullYear();
  let m = first.getUTCMonth() + 1;
  for (;;) {
    if (m > 11) { m = 0; y += 1; }
    const iso = `${y}-${String(m + 1).padStart(2, '0')}-01`;
    if (iso > hi) break;
    months.push({ pct: at(iso), label: m === 0 ? `${MONTHS[m]} ${String(y).slice(2)}` : MONTHS[m] });
    m += 1;
  }

  const bars = placed.map((r) => {
    // no start: the bar runs from today (or from the end, if that has gone). no end: it runs off the right edge
    const from = r.start || (r.end && r.end < today ? r.end : today);
    const to = r.end || hi;
    const left = at(from);
    const right = at(to);
    const width = Math.max(1.5, right - left);
    const fill = r.tons > 0 ? Math.min(100, (r.delivered / r.tons) * 100) : 0;
    return {
      row: r, left: Math.min(left, 100 - width), width, fill, openEnded: !r.end,
      ticks: (r.orders?.items || []).filter((o) => o.by).map((o) => ({ pct: at(o.by), overdue: o.overdue, left: o.left })),
    };
  });
  return { lo, hi, todayPct: at(today), months, bars, unplaced };
}

/** "Ends in 12 days", "Ended 4 days ago", "Ends today", "No end date". */
export function endText(daysToEnd) {
  if (daysToEnd === null || daysToEnd === undefined) return 'No end date';
  if (daysToEnd === 0) return 'Ends today';
  if (daysToEnd > 0) return `Ends in ${daysToEnd} day${daysToEnd === 1 ? '' : 's'}`;
  return `Ended ${-daysToEnd} day${daysToEnd === -1 ? '' : 's'} ago`;
}

/** "Due in 5 days", "12 days overdue", "Due today", "No due date". */
export function dueText(daysOver) {
  if (daysOver === null || daysOver === undefined) return 'No due date';
  if (daysOver === 0) return 'Due today';
  if (daysOver < 0) return `Due in ${-daysOver} day${daysOver === -1 ? '' : 's'}`;
  return `${daysOver} day${daysOver === 1 ? '' : 's'} overdue`;
}

// --- delivered but not invoiced ---------------------------------------------

/**
 * Grain that has gone to a buyer but is on no invoice yet: for each contract, the loads delivered into it that no
 * invoice lists, what they come to at the contract's price (each load at its own grade and oil adjustment), and how
 * long the oldest has waited. Longest waiting first.
 *
 * @returns {{rows: {sale: object, loads: object[], tons: number, value: number, oldest: string, days: number|null}[],
 *            total: {count: number, tons: number, value: number}}}
 */
export function uninvoiced(sales, movements, invoices, today) {
  const rows = [];
  for (const sale of sales || []) {
    const used = invoicedMovementIds((invoices || []).filter((i) => i.saleId === sale.id));
    const loads = movementsForEndpoint('sale', sale.id, movements).filter((m) => !used.has(m.id));
    if (!loads.length) continue;
    const lines = invoiceLineItems(sale, loads).filter((l) => num(l.tons) > 0);
    if (!lines.length) continue;
    const dates = lines.map((l) => l.date).filter(Boolean).sort();
    rows.push({
      sale, loads: lines,
      tons: round3(lines.reduce((s, l) => s + num(l.tons), 0)),
      value: round2(lines.reduce((s, l) => s + num(l.subtotal), 0)),
      oldest: dates[0] || '',
      days: dates[0] ? daysBetween(dates[0], today) : null,
    });
  }
  rows.sort((a, b) => num(b.days ?? -1) - num(a.days ?? -1));
  return {
    rows,
    total: { count: rows.length, tons: round3(rows.reduce((s, r) => s + r.tons, 0)), value: round2(rows.reduce((s, r) => s + r.value, 0)) },
  };
}
