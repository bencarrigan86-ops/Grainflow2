// Deductions on a single load: a quality fault the contract does not price (screenings 6% against 5% allowed, say) that the
// buyer takes off by the tonne. Each is a reason and a $/t, entered on the ticket; the invoice pays the load at the price less
// them and says why under the load.
//
// A positive $/t is taken off the price; a negative one adds to it. Pure, with no imports: derived.js and mapping.js both use it.

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** The deductions as saved: a reason and a $/t, leaving out any with neither. */
export function cleanDeductions(list) {
  if (!Array.isArray(list)) return [];
  return list
    .map((d) => ({ reason: String(d?.reason ?? '').trim(), perTon: Math.round(num(d?.perTon) * 100) / 100 }))
    .filter((d) => d.perTon !== 0 || d.reason);
}

/** Has this load a list of deductions worth keeping? */
export const hasDeductions = (m) => cleanDeductions(m?.deductions).length > 0;

/** The $/t taken off a load's price by all its deductions (negative when they add up to a credit). */
export function deductionPerTon(m) {
  return cleanDeductions(m?.deductions).reduce((s, d) => s + d.perTon, 0);
}

/** The $/t a load's deductions move the price by: the minus of the above, so it adds straight onto the rate. */
export const deductionRateFor = (m) => -deductionPerTon(m) || 0;

/** Tonnes of a load that went to this contract. */
const tonsToSale = (m, saleId) => (m.tos || [])
  .filter((t) => t.type === 'sale' && t.id === saleId)
  .reduce((s, t) => s + (Number(t.tons) || 0), 0);

/** What the deductions on the loads delivered so far take off the contract, as a (negative) dollar total. */
export function deductionAdjustment(sale, movements) {
  let total = 0;
  let loads = 0;
  for (const m of movements || []) {
    const rate = deductionRateFor(m);
    if (!rate) continue;
    const t = tonsToSale(m, sale.id);
    if (!(t > 0)) continue;
    total += t * rate;
    loads += 1;
  }
  return { total, loads };
}

const dollars = (n) => `$${Math.abs(n).toFixed(2)}`;

/**
 * The words under a load on the invoice, one per deduction: "-$10.00/t discount for screenings 6% vs contract 5% (-$300.00)".
 * `tons` (the load's tonnes on the invoice) adds the dollars for the load.
 */
export function deductionNotes(deductions, tons = 0) {
  return cleanDeductions(deductions).filter((d) => d.perTon !== 0).map((d) => {
    const sign = d.perTon > 0 ? '-' : '+';
    const what = d.perTon > 0 ? 'discount' : 'premium';
    const total = Number(tons) > 0 ? ` (${sign}${dollars(d.perTon * tons)})` : '';
    return `${sign}${dollars(d.perTon)}/t ${what}${d.reason ? ` for ${d.reason}` : ''}${total}`;
  });
}

/**
 * On the ticket the amount is written the way a price is: a premium is plus and a discount is minus, so a $10 discount is
 * typed -10. It is kept the other way round (`perTon` is what is taken off), so these two turn one into the other.
 */
export const amountOnTicket = (d) => (num(d?.perTon) === 0 ? '' : -num(d.perTon));
export const perTonFromTicket = (typed) => (String(typed ?? '').trim() === '' ? '' : -num(typed));
