// Carry on a contract: a $/t/month the buyer pays for grain left on the farm. It is added to the price of each load by when it
// was delivered. From the month carry starts, a load carries one month's rate; every month after adds another. So with carry
// starting 1 Feb at $2/t/month, a load delivered in February is paid $2/t more, one in March $4/t more, and so on. A load
// delivered before the start date carries nothing, and a contract with no start date carries nothing (there is no month to count from).

const num = (v) => Number(v) || 0;
const ymd = (s) => /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ''));

/** Carry is on when the contract has a rate and a start date. */
export const carryOn = (sale) => num(sale?.carryRate) > 0 && !!ymd(sale?.carryFrom);

/**
 * How many months of carry a load delivered on `date` has earned on this contract: 0 before the start date, then 1 for the
 * calendar month the carry starts in, and one more for each month after.
 */
export function carryMonthsFor(sale, date) {
  if (!carryOn(sale)) return 0;
  const a = ymd(sale.carryFrom);
  const b = ymd(date);
  if (!b) return 0;
  if (`${b[1]}-${b[2]}-${b[3]}` < `${a[1]}-${a[2]}-${a[3]}`) return 0;
  return (Number(b[1]) - Number(a[1])) * 12 + (Number(b[2]) - Number(a[2])) + 1;
}

/** The $/t carry adds to a load's price. */
export const carryRateFor = (sale, movement) => carryMonthsFor(sale, movement?.date) * num(sale?.carryRate);

/** Tonnes of a load that went to this contract. */
const tonsToSale = (m, saleId) => (m.tos || [])
  .filter((t) => t.type === 'sale' && t.id === saleId)
  .reduce((s, t) => s + (Number(t.tons) || 0), 0);

/** What the carry on the loads delivered so far adds to the contract, in dollars. */
export function carryAdjustment(sale, movements) {
  let total = 0;
  let loads = 0;
  if (!carryOn(sale)) return { total, loads };
  for (const m of movements || []) {
    const rate = carryRateFor(sale, m);
    if (!rate) continue;
    const t = tonsToSale(m, sale.id);
    if (!(t > 0)) continue;
    total += t * rate;
    loads += 1;
  }
  return { total, loads };
}

