// When grain is expected to leave, and when the money for it is expected to arrive.
//
// A contract says how it is delivered. "Spread evenly" means what is still to deliver is carted evenly from today (or the
// start of the window, if that is later) to the end of the window, so it can be shown as tonnes a week or a month. "Buyer
// calls it" means it moves when the buyer orders it: the open grain orders are the schedule, by the date each is due, and
// whatever is not yet ordered has no date. A contract with no pattern set is treated as a buyer-calls one, which is the
// cautious reading: nothing is dated that nobody dated. "Seller's option" (the farm decides when it goes) is read the same
// way: it is dated by the grain orders, and whatever is not ordered has no date.
//
// The same plan gives the money: each tonne is paid the contract's payment terms after it is delivered. Everything here
// is a forecast at the contract price plus GST, before freight, levies and grade adjustments. Pure.

import { daysBetween } from './orders.js?v=432';

export const PATTERNS = [
  { value: '', label: 'Not set' },
  { value: 'call', label: "Buyer's call (loads ordered as needed)" },
  { value: 'sellers', label: "Seller's option (you choose when it goes)" },
  { value: 'even', label: 'Even spread over the delivery period' },
  { value: 'ginrun', label: 'Gin run order' },
];
/**
 * The delivery options a contract offers. Cotton goes by gin run order, so a cotton contract is offered that and Not set; every
 * other crop is offered the rest. Whatever the contract already carries stays on the list, so it is never lost from view.
 */
export function patternsFor(isCotton, current = '') {
  return PATTERNS.filter((p) => p.value === (current || '') || (isCotton ? ['', 'ginrun'].includes(p.value) : p.value !== 'ginrun'));
}
/** The delivery option as a contract confirmation words it: the contract's choice, without the note in brackets. */
export const PATTERN_ON_CONTRACT = Object.fromEntries(PATTERNS.filter((p) => p.value).map((p) => [p.value, p.label.replace(/\s*\(.*\)\s*$/, '')]));
/** The pattern values the farm's records keep. */
export const PATTERN_VALUES = PATTERNS.map((p) => p.value).filter(Boolean);
export const patternLabel = (v) => PATTERNS.find((p) => p.value === (v || ''))?.label || 'Not set';

export const GST_RATE = 0.1;
export const DEFAULT_TERMS_DAYS = 14;

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const round3 = (n) => Math.round(n * 1000) / 1000;
const round2 = (n) => Math.round(n * 100) / 100;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const parse = (iso) => new Date(`${String(iso).slice(0, 10)}T00:00:00Z`);
const fmt = (d) => d.toISOString().slice(0, 10);
export const addDays = (iso, n) => { const d = parse(iso); d.setUTCDate(d.getUTCDate() + n); return fmt(d); };
const mondayOf = (iso) => addDays(iso, -((parse(iso).getUTCDay() + 6) % 7));

/** The week (the Monday it starts) or the month a date falls in, as a sortable key. */
export const periodKey = (iso, grain) => (grain === 'month' ? String(iso).slice(0, 7) : mondayOf(iso));

export function periodLabel(key, grain) {
  if (grain === 'month') return `${MONTHS[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`;
  return `Week of ${Number(key.slice(8, 10))} ${MONTHS[Number(key.slice(5, 7)) - 1]}`;
}

/**
 * The day the money for grain delivered on `date` is due: the contract's payment terms from then. "End of week" terms
 * count from the Sunday of that week. With no terms on the contract, the default is used.
 */
export function payDate(date, sale) {
  const days = sale?.paymentTermsDays === '' || sale?.paymentTermsDays == null ? DEFAULT_TERMS_DAYS : num(sale.paymentTermsDays);
  const basis = String(sale?.paymentTermsBasis || '');
  const from = /end of week/i.test(basis) ? addDays(mondayOf(date), 6) : String(date).slice(0, 10);
  return addDays(from, days);
}

/**
 * What is still to deliver on a spread-evenly contract, a day at a time: [{date, tons}] from the later of today and the
 * start of the window to its end. null when it cannot be spread: no end date, or the window has ended.
 */
export function evenDays(sale, due, today) {
  const end = sale?.deliveryEnd;
  if (!end || !(due > 0)) return null;
  const start = sale.deliveryStart && sale.deliveryStart > today ? sale.deliveryStart : today;
  if (end < start) return null;
  const n = daysBetween(start, end) + 1;
  const per = due / n;
  return Array.from({ length: n }, (_, i) => ({ date: addDays(start, i), tons: per }));
}

const price = (sale) => num(sale?.price) + num(sale?.premiumDiscount);

/**
 * The plan for the grain still to deliver.
 * @param {object[]} rows the contracts to deliver on, from deliveries() in outstanding.js
 * @param {string} today 'YYYY-MM-DD'
 * @param {'week'|'month'} grain
 * @returns {{
 *   periods: {key: string, label: string, even: number, ordered: number, total: number}[],
 *   overdue: {tons: number, contracts: number},
 *   unscheduled: {tons: number, contracts: number},
 *   perContract: Map<string, {pattern: string, perWeek: number|null, perMonth: number|null, spread: boolean}>
 * }}
 *   `overdue` is what was due before today (a window that has ended, or an order past its date); `unscheduled` is what
 *   has no date: not yet ordered on a buyer-calls contract, or an even contract with no end date.
 */
export function deliveryPlan(rows, today, grain = 'month') {
  const by = new Map();
  const slot = (key) => { if (!by.has(key)) by.set(key, { key, label: periodLabel(key, grain), even: 0, ordered: 0, total: 0 }); return by.get(key); };
  const overdue = { tons: 0, contracts: new Set() };
  const unscheduled = { tons: 0, contracts: new Set() };
  const perContract = new Map();

  for (const r of rows || []) {
    const id = r.sale.id;
    const pattern = r.sale.deliveryPattern || '';
    const days = pattern === 'even' ? evenDays(r.sale, r.due, today) : null;

    if (pattern === 'even') {
      if (days) {
        for (const d of days) { const p = slot(periodKey(d.date, grain)); p.even += d.tons; p.total += d.tons; }
        perContract.set(id, { pattern, spread: true, perWeek: round3((r.due / days.length) * 7), perMonth: round3((r.due / days.length) * 30.4) });
      } else if (r.sale.deliveryEnd && r.sale.deliveryEnd < today) {
        overdue.tons += r.due; overdue.contracts.add(id);
        perContract.set(id, { pattern, spread: false, perWeek: null, perMonth: null });
      } else {
        unscheduled.tons += r.due; unscheduled.contracts.add(id);
        perContract.set(id, { pattern, spread: false, perWeek: null, perMonth: null });
      }
      continue;
    }

    // a buyer-calls (or unset) contract: the open orders are dated, the rest is not
    perContract.set(id, { pattern, spread: false, perWeek: null, perMonth: null });
    let ordered = 0;
    for (const it of r.orders.items) {
      ordered += it.left;
      if (!it.by) { unscheduled.tons += it.left; unscheduled.contracts.add(id); continue; }
      if (it.by < today) { overdue.tons += it.left; overdue.contracts.add(id); continue; }
      const p = slot(periodKey(it.by, grain)); p.ordered += it.left; p.total += it.left;
    }
    const rest = Math.max(0, r.due - ordered);
    if (rest > 0.005) { unscheduled.tons += rest; unscheduled.contracts.add(id); }
  }

  const periods = [...by.values()].filter((p) => p.total > 0.005).sort((a, b) => a.key.localeCompare(b.key))
    .map((p) => ({ ...p, even: round3(p.even), ordered: round3(p.ordered), total: round3(p.total) }));
  return {
    periods,
    overdue: { tons: round3(overdue.tons), contracts: overdue.contracts.size },
    unscheduled: { tons: round3(unscheduled.tons), contracts: unscheduled.contracts.size },
    perContract,
  };
}

/**
 * The money expected from grain not yet invoiced, each piece with the day it should arrive (null: no date to give it).
 * Grain already delivered but not on an invoice is expected one set of payment terms from today. Grain still to deliver
 * is expected the terms after each day it is due to go: an even contract day by day across its window, a buyer-calls one
 * at each open order's date, and what is not yet ordered undated.
 *
 * @param {object[]} rows contracts to deliver on, from deliveries()
 * @param {object[]} notInvoiced rows from uninvoiced() in outstanding.js
 * @returns {{date: string|null, amount: number, kind: 'delivered'|'even'|'order'|'unscheduled', saleId: string}[]}
 */
export function expectedReceipts(rows, notInvoiced, today) {
  const out = [];
  const push = (date, tons, sale, kind) => {
    const amount = round2(tons * price(sale) * (1 + GST_RATE));
    if (amount > 0) out.push({ date, amount, kind, saleId: sale.id });
  };

  for (const r of notInvoiced || []) {
    const amount = round2(num(r.value) * (1 + GST_RATE));
    if (amount > 0) out.push({ date: payDate(today, r.sale), amount, kind: 'delivered', saleId: r.sale.id });
  }

  for (const r of rows || []) {
    if (!(price(r.sale) > 0)) continue;
    const pattern = r.sale.deliveryPattern || '';
    const days = pattern === 'even' ? evenDays(r.sale, r.due, today) : null;
    if (days) { for (const d of days) push(payDate(d.date, r.sale), d.tons, r.sale, 'even'); continue; }
    if (pattern === 'even') { push(null, r.due, r.sale, 'unscheduled'); continue; }

    let ordered = 0;
    for (const it of r.orders.items) {
      ordered += it.left;
      if (!it.by) push(null, it.left, r.sale, 'unscheduled');
      else push(payDate(it.by < today ? today : it.by, r.sale), it.left, r.sale, 'order');
    }
    const rest = Math.max(0, r.due - ordered);
    if (rest > 0.005) push(null, rest, r.sale, 'unscheduled');
  }
  return out;
}
