// What the farm owes, and what it costs.
//
// A bill (a payable) is brokerage, a freight invoice, a storage fee at a third-party site, or anything else. This
// is the arithmetic around them, kept apart from the screens so it can be tested:
//
//  - which bills are unpaid, and which are overdue;
//  - the brokerage a contract has run up so far, which is a rate in $/t on the tonnes delivered, whether or not the
//    broker has billed it yet;
//  - what freight really cost against the estimate already taken off the contract's price;
//  - the total that comes off profit, with none of it counted twice.
//
// Bills count at their amount ex GST: the GST on a bill is claimed back, so it is owed but is not a cost.

import { saleEconomics } from './derived.js?v=228';

export const KINDS = [
  { key: 'brokerage', label: 'Brokerage' },
  { key: 'freight', label: 'Freight' },
  { key: 'storage', label: 'Storage' },
  { key: 'other', label: 'Other' },
];
export const kindLabel = (k) => KINDS.find((x) => x.key === k)?.label || 'Other';

export const GST_RATE = 0.1;

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const round2 = (n) => Math.round(n * 100) / 100;

/** What a bill comes to, GST included: what is paid. */
export const billTotal = (p) => round2(num(p?.amount) + num(p?.gst));

/** The GST on an amount at the usual rate, for a form to offer. */
export const gstOn = (amount) => round2(num(amount) * GST_RATE);

/** Is a bill unpaid and past its due date? `today` is a 'YYYY-MM-DD' string. */
export const isOverdue = (p, today) => p?.status !== 'paid' && !!p?.dueDate && String(p.dueDate) < String(today);

/**
 * The bills in a list, gathered: how much is unpaid and how much of that is overdue, as what is to be paid.
 * @returns {{unpaid: {count: number, total: number}, overdue: {count: number, total: number}, paid: {count: number, total: number}}}
 */
export function summarise(payables, today) {
  const out = { unpaid: { count: 0, total: 0 }, overdue: { count: 0, total: 0 }, paid: { count: 0, total: 0 } };
  for (const p of payables || []) {
    const bucket = p.status === 'paid' ? out.paid : out.unpaid;
    bucket.count += 1;
    bucket.total += billTotal(p);
    if (isOverdue(p, today)) { out.overdue.count += 1; out.overdue.total += billTotal(p); }
  }
  for (const b of Object.values(out)) b.total = round2(b.total);
  return out;
}

const billsFor = (payables, kind, saleId) => (payables || []).filter((p) => p.kind === kind && p.saleId === saleId);
const exGst = (list) => round2(list.reduce((s, p) => s + num(p.amount), 0));

/**
 * The brokerage on a contract: its rate in $/t on the tonnes delivered so far.
 *
 * A contract where the buyer pays the brokerage costs the farm none. Otherwise what has accrued is owed whether or
 * not the broker has sent a bill, and the bills recorded against the contract are set against it:
 *
 *  - `cost`     what counts against profit: the larger of what has accrued and what has been billed, so a bill
 *               is never counted on top of the accrual it is for, and a bill bigger than the accrual still counts;
 *  - `unbilled` accrued and not yet billed.
 */
export function brokerageOwed(sale, movements, payables) {
  const rate = num(sale?.brokerageRate);
  const tons = rate > 0 && sale?.brokeragePaidBy !== 'buyer' ? num(saleEconomics(sale, movements).tonsDelivered) : 0;
  const accrued = round2(rate * tons);
  const billed = exGst(billsFor(payables, 'brokerage', sale?.id));
  return { rate, tons, accrued, billed, cost: Math.max(accrued, billed), unbilled: Math.max(0, round2(accrued - billed)) };
}

/**
 * Freight on a contract against the estimate. The contract's Freight ($/t) is already taken off its price for
 * every tonne, so a freight bill linked to the contract does not add a second cost: it replaces the estimate for
 * the tonnes it covers. Only the difference is a cost (or a saving, when the carrier charged less).
 *
 * The tonnes a bill covers are its own tonnes; if any bill does not say, the tonnes delivered so far are used.
 */
export function freightEffect(sale, movements, payables) {
  const bills = billsFor(payables, 'freight', sale?.id);
  if (!bills.length) return { billed: 0, covered: 0, estimate: 0, extra: 0 };
  const delivered = num(saleEconomics(sale, movements).tonsDelivered);
  const covered = bills.every((b) => num(b.tons) > 0) ? bills.reduce((s, b) => s + num(b.tons), 0) : delivered;
  const billed = exGst(bills);
  const estimate = round2(num(sale?.freight) * covered);
  return { billed, covered, estimate, extra: round2(billed - estimate) };
}

/**
 * Everything that comes off profit because of bills.
 *  - brokerage: each contract's cost as above, plus brokerage bills not linked to a contract;
 *  - freight: the difference to the estimate on each contract with freight bills, plus freight bills not linked to one;
 *  - storage and other: the bills.
 * @returns {{brokerage: number, freight: number, storage: number, other: number, total: number}}
 */
export function payablesCost(sales, movements, payables) {
  const linked = new Set((sales || []).map((s) => s.id));
  let brokerage = 0;
  let freight = 0;
  for (const s of sales || []) {
    brokerage += brokerageOwed(s, movements, payables).cost;
    freight += freightEffect(s, movements, payables).extra;
  }
  let storage = 0;
  let other = 0;
  for (const p of payables || []) {
    const amount = num(p.amount);
    const onAContract = linked.has(p.saleId);
    if (p.kind === 'brokerage' && !onAContract) brokerage += amount;
    else if (p.kind === 'freight' && !onAContract) freight += amount;
    else if (p.kind === 'storage') storage += amount;
    else if (p.kind === 'other' || !KINDS.some((k) => k.key === p.kind)) other += amount;
  }
  const out = { brokerage: round2(brokerage), freight: round2(freight), storage: round2(storage), other: round2(other) };
  return { ...out, total: round2(out.brokerage + out.freight + out.storage + out.other) };
}
