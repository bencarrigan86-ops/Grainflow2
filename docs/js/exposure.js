// What each buyer could cost the farm: the money they owe now, the grain still to go to them and what it is worth, and how far
// their contracts sit from the market.
//
// Three things, kept apart because they are different kinds of risk:
//   owing now      unpaid invoices, plus grain delivered to them that is not on an invoice yet (the credit already extended)
//   still to go    the tonnes left on their open contracts, and what those are worth at the contract price (the commitment)
//   against MTM    the contract price less the commodity's MTM price, over those tonnes. Above zero, the contracts are worth more than
//                  the market today, which is what the farm is out if the buyer does not take the grain; below zero the buyer holds
//                  the better side. Not added to the money owed: it is a market view, not a debt.
//
// Contracts are the current season's (the ones brought in from an earlier season are in it). A commodity with no MTM price set
// cannot be compared, so its tonnes are counted in "still to go" but left out of the gap, and the count of such contracts is kept.
// Pure.

import { buyerStatements } from './statement.js?v=385';
import { deliveries } from './outstanding.js?v=385';
import { saleEconomics } from './derived.js?v=385';

const round2 = (n) => Math.round(n * 100) / 100;
const round3 = (n) => Math.round(n * 1000) / 1000;
const keyOf = (name) => String(name || '').trim().toLowerCase() || '(no buyer name)';
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

/**
 * @param {string} today 'YYYY-MM-DD'
 * @returns {{
 *   buyers: {buyer: string, key: string, owing: number, unpaidTotal: number, overdueTotal: number, unpaidCount: number,
 *            notInvoicedValue: number, notInvoicedTons: number, dueTons: number, dueValue: number, contracts: number,
 *            mtmGap: number, noMtm: number, share: number}[],
 *   total: {owing: number, overdueTotal: number, dueTons: number, dueValue: number, mtmGap: number, noMtm: number, buyers: number}
 * }}  the buyer owing or owed most first
 */
export function buyerExposure(invoices, sales, movements, commodities, today) {
  const by = new Map();
  const slot = (name) => {
    const key = keyOf(name);
    if (!by.has(key)) {
      by.set(key, { buyer: String(name || '').trim() || 'No buyer name', key, owing: 0, unpaidTotal: 0, overdueTotal: 0, unpaidCount: 0,
        notInvoicedValue: 0, notInvoicedTons: 0, dueTons: 0, deliveredTons: 0, dueValue: 0, contracts: 0, mtmGap: 0, noMtm: 0, share: 0, list: [] });
    }
    return by.get(key);
  };

  const unpaidRows = [];
  for (const st of buyerStatements(invoices, sales, movements, today)) {
    const b = slot(st.buyer);
    b.owing = st.owing; b.unpaidTotal = st.unpaidTotal; b.overdueTotal = st.overdueTotal; b.unpaidCount = st.unpaid.length;
    b.notInvoicedValue = st.notInvoicedValue; b.notInvoicedTons = st.notInvoicedTons;
    unpaidRows.push(...st.unpaid);
    // the next payment due that is not already late: the earliest due date, and what falls due on it
    const coming = st.unpaid.filter((r) => !r.overdue && r.dueDate).sort((x, y) => String(x.dueDate).localeCompare(String(y.dueDate)));
    if (coming.length) b.nextDue = { date: coming[0].dueDate, amount: round2(coming.filter((r) => r.dueDate === coming[0].dueDate).reduce((s, r) => s + r.amount, 0)) };
  }

  for (const r of deliveries(sales, movements, [], today).rows) {
    const b = slot(r.sale.buyer);
    const price = saleEconomics(r.sale, movements).priceExFarm;
    const commodity = (commodities || []).find((c) => c.id === r.sale.commodityId);
    const mtm = num(commodity?.mtmPrice);
    // one line for each contract: what it is, what is left on it, and where it sits against MTM
    b.list.push({
      id: r.sale.id, commodity: commodity?.name || '', grade: String(r.sale.grade || '').trim(), contractNo: String(r.sale.contractNo || '').trim(),
      price: round2(price), mtm: mtm > 0 ? mtm : 0, tons: r.due, delivered: r.delivered, value: round2(r.due * price),
      gap: mtm > 0 ? round2((price - mtm) * r.due) : null, end: r.end || '',
    });
    b.contracts += 1;
    b.dueTons += r.due;
    b.deliveredTons += r.delivered;
    b.dueValue += r.due * price;
    if (mtm > 0) b.mtmGap += (price - mtm) * r.due; else b.noMtm += 1;
  }

  const buyers = [...by.values()].map((b) => ({
    ...b, dueTons: round3(b.dueTons), deliveredTons: round3(b.deliveredTons), dueValue: round2(b.dueValue), mtmGap: round2(b.mtmGap),
  }));
  const owingAll = buyers.reduce((s, b) => s + b.owing, 0);
  for (const b of buyers) b.share = owingAll > 0 ? b.owing / owingAll : 0;
  buyers.sort((a, b) => b.owing - a.owing || b.dueValue - a.dueValue || a.buyer.localeCompare(b.buyer));

  const sum = (key) => buyers.reduce((s, b) => s + b[key], 0);
  return {
    buyers,
    weeks: dueByWeek(unpaidRows, today),
    total: {
      owing: round2(owingAll), overdueTotal: round2(sum('overdueTotal')), unpaidTotal: round2(sum('unpaidTotal')),
      notInvoicedValue: round2(sum('notInvoicedValue')), notInvoicedTons: round3(sum('notInvoicedTons')),
      dueTons: round3(sum('dueTons')), deliveredTons: round3(sum('deliveredTons')), dueValue: round2(sum('dueValue')),
      mtmGap: round2(sum('mtmGap')), noMtm: sum('noMtm'), buyers: buyers.length,
    },
  };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dayNumber = (iso) => Math.floor(Date.parse(`${String(iso).slice(0, 10)}T00:00:00Z`) / 86400000);

/**
 * Unpaid invoices laid out by the week they fall due: what is already overdue first, then this week, next week, and each week after for
 * six weeks ("w/c 8 Dec", weeks start on Monday), then later, then invoices with no due date. A week with nothing due is left out.
 * @param {{amount: number, dueDate?: string, overdue?: boolean}[]} rows  unpaid invoices
 * @param {string} today 'YYYY-MM-DD'
 * @returns {{key: string, label: string, count: number, amount: number, late: boolean}[]}
 */
export function dueByWeek(rows, today) {
  const t = dayNumber(today);
  const monday = t - ((new Date(t * 86400000).getUTCDay() + 6) % 7);   // the Monday of this week
  const buckets = new Map();
  const add = (order, key, label, late, amount) => {
    if (!buckets.has(key)) buckets.set(key, { order, key, label, count: 0, amount: 0, late });
    const b = buckets.get(key); b.count += 1; b.amount += amount;
  };
  for (const r of rows || []) {
    const amount = num(r.amount);
    if (r.overdue) { add(-1, 'overdue', 'Overdue', true, amount); continue; }
    if (!r.dueDate) { add(1000, 'nodate', 'No due date', false, amount); continue; }
    const week = Math.floor((dayNumber(r.dueDate) - monday) / 7);
    if (week <= 0) add(0, 'w0', 'This week', false, amount);
    else if (week === 1) add(1, 'w1', 'Next week', false, amount);
    else if (week <= 6) {
      const d = new Date((monday + week * 7) * 86400000);
      add(week, `w${week}`, `w/c ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`, false, amount);
    } else add(999, 'later', 'Later', false, amount);
  }
  return [...buckets.values()].sort((a, b) => a.order - b.order).map(({ order, ...b }) => ({ ...b, amount: round2(b.amount) }));
}
