// Pricing canola by its oil content.
//
// Canola is paid on a base oil level, 42% under the AOF terms, with the price moving a set percentage for
// every 1% of oil above or below it: 1.5% of the price for each 1%. A load at 44% oil on a $700 contract is
// paid 700 x 1.5% x 2 = $21/t over; one at 40% is $21/t under.
//
// Each load carries its own oil, recorded off the weighbridge sample, so each is priced on its own. A load
// with no oil recorded is paid the price as it stands, as are tonnes not yet delivered. Because the
// adjustment is a straight line in the oil, adding up load by load comes to the same as pricing the
// tonnes-weighted average oil of the whole delivery.
//
// Pure, with no imports: derived.js and mapping.js both use it.

export const AOF_OIL_BASE_PCT = 42;
export const AOF_OIL_ADJUST_PCT = 1.5;

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Is this contract priced for oil? It is when it names an adjustment. */
export const oilPricingOn = (sale) => num(sale?.oilAdjustPct) > 0;

const hasOil = (m) => m?.oilPct !== undefined && m?.oilPct !== null && m?.oilPct !== '' && Number.isFinite(Number(m.oilPct));

/** The $/t a load earns on top of the price for its oil: nothing if the contract is not priced for oil or the load has none recorded. */
export function oilRateFor(sale, movement) {
  if (!oilPricingOn(sale) || !hasOil(movement)) return 0;
  const perPoint = num(sale.price) * (num(sale.oilAdjustPct) / 100);
  return perPoint * (Number(movement.oilPct) - num(sale.oilBasePct));
}

/** Tonnes of a load that went to this contract. */
const tonsToSale = (m, saleId) => (m.tos || [])
  .filter((t) => t.type === 'sale' && t.id === saleId)
  .reduce((s, t) => s + (Number(t.tons) || 0), 0);

/**
 * What the oil of the loads delivered so far adds to (or takes off) the contract.
 *
 * @returns {{
 *   on: boolean,
 *   total: number,         the dollars
 *   tons: number,          delivered with an oil figure
 *   avgOil: number|null,   the tonnes-weighted oil of those
 *   missingTons: number,   delivered with no oil recorded, paid the price as it stands
 *   perPoint: number,      the $/t that each 1% of oil is worth on this contract
 * }}
 */
export function oilAdjustment(sale, movements) {
  const perPoint = oilPricingOn(sale) ? num(sale.price) * (num(sale.oilAdjustPct) / 100) : 0;
  const out = { on: oilPricingOn(sale), total: 0, tons: 0, avgOil: null, missingTons: 0, perPoint };
  if (!out.on) return out;
  let oilTons = 0;
  for (const m of movements || []) {
    const t = tonsToSale(m, sale.id);
    if (!(t > 0)) continue;
    if (!hasOil(m)) { out.missingTons += t; continue; }
    out.tons += t;
    oilTons += t * Number(m.oilPct);
    out.total += t * oilRateFor(sale, m);
  }
  out.avgOil = out.tons > 0 ? oilTons / out.tons : null;
  return out;
}
