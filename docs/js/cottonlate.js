// Cotton delivered late: a bale delivered after the contract's delivery finish can take a discount, and it is not carry (cotton has
// no carry). The discount is a table, one figure per month late, and the months do not add up: month 1 late might be $10 a bale,
// month 2 $25, month 3 $40 (each is the whole discount for a bale delivered that month, not an extra on the one before).
//
// Month 1 is the calendar month after the delivery finish's month; a bale delivered later in the finish's own month, after the
// finish date, is also month 1. Past the end of the table the last figure keeps applying. Delivered on or before the finish: no
// discount. No finish date, or no table: no discount.

const num = (v) => Number(v) || 0;
const ymd = (s) => /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ''));

/** The table as saved: non-negative dollars per bale, in month order. */
export function cleanLate(list) {
  return (Array.isArray(list) ? list : []).map((v) => Math.round(Math.max(0, num(v)) * 100) / 100);
}

/** "10, 25, 40" typed in the contract form to [10, 25, 40]. Anything that is not a number is left out. */
export function parseLate(text) {
  return cleanLate(String(text ?? '').split(/[\s,;]+/).filter((x) => x !== '' && Number.isFinite(Number(x))).map(Number));
}

/** [10, 25, 40] to "10, 25, 40" for the form. */
export const lateText = (list) => cleanLate(list).join(', ');

/** The discount is on when the contract has a table and a delivery finish. */
export const lateOn = (sale) => cleanLate(sale?.lateDiscounts).some((v) => v > 0) && !!ymd(sale?.deliveryEnd);

/** How many months late a load delivered on `date` is: 0 if on time, else 1 for the first month, and so on. */
export function lateMonthsFor(sale, date) {
  if (!lateOn(sale)) return 0;
  const e = ymd(sale.deliveryEnd);
  const d = ymd(date);
  if (!d) return 0;
  if (`${d[1]}-${d[2]}-${d[3]}` <= `${e[1]}-${e[2]}-${e[3]}`) return 0;
  return Math.max(1, (Number(d[1]) - Number(e[1])) * 12 + (Number(d[2]) - Number(e[2])));
}

/** The $/bale taken off a load delivered on this movement's date (a positive number; the price goes down by it). */
export function lateDiscountFor(sale, movement) {
  const months = lateMonthsFor(sale, movement?.date);
  if (!months) return 0;
  const list = cleanLate(sale.lateDiscounts);
  return list[Math.min(months, list.length) - 1] || 0;
}

/** Bales of a load that went to this contract. */
const tonsToSale = (m, saleId) => (m.tos || [])
  .filter((t) => t.type === 'sale' && t.id === saleId)
  .reduce((s, t) => s + (Number(t.tons) || 0), 0);

/** What the late discount takes off the contract on the loads delivered so far: a negative dollar total. */
export function lateAdjustment(sale, movements) {
  let total = 0;
  let loads = 0;
  if (!lateOn(sale)) return { total, loads };
  for (const m of movements || []) {
    const rate = lateDiscountFor(sale, m);
    if (!rate) continue;
    const t = tonsToSale(m, sale.id);
    if (!(t > 0)) continue;
    total -= t * rate;
    loads += 1;
  }
  return { total, loads };
}
