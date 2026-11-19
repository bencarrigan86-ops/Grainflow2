// The Gross margin report: for each paddock, what it made per hectare against what it cost, so the good and the poor ones show.
//
//   Price      the crop's blended price: Position's total value for the crop over its tonnes (sold at the contract prices, unsold at
//              the MTM price). The same for every paddock of that crop.
//   Revenue    yield (t/ha) x price.
//   Cost       the crop's gross margin cost ($ in Settings) spread over the crop's area, unless the paddock has a cost of its own
//              ($/ha), which replaces it for that paddock only.
//   GM         revenue less cost, per hectare.
//
// Pure: it is given what the screen already holds and returns figures; nothing is saved here.

import { positionRows, fieldTons } from './derived.js?v=422';

const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** An override box left empty, or holding something that is not a number, is no override. */
export function costOverride(f) {
  if (f?.gmCostHa === null || f?.gmCostHa === undefined || f.gmCostHa === '') return null;
  const v = Number(f.gmCostHa);
  return Number.isFinite(v) && v >= 0 ? v : null;
}

/** What a group of paddocks adds up to: area-weighted, so a big paddock counts for more than a small one. */
function totalOf(rows, price = null) {
  const area = rows.reduce((s, r) => s + r.area, 0);
  const tonnes = rows.reduce((s, r) => s + r.tons, 0);
  const revenue = rows.reduce((s, r) => s + r.revenueHa * r.area, 0);
  const cost = rows.reduce((s, r) => s + r.costHa * r.area, 0);
  const per = (x) => (area > 0 ? x / area : 0);
  return { area, tons: tonnes, yieldTHa: per(tonnes), price, revenueHa: per(revenue), costHa: per(cost), gmHa: per(revenue - cost), revenue, cost, gm: revenue - cost };
}

/**
 * The report: one group per crop that has paddocks, biggest first (the order Position uses), and a whole-farm total.
 * `groups[].fields[]` are { id, name, area, yieldTHa, tons, price, revenueHa, costHa, costIsOverride, defaultCostHa, gmHa }.
 */
export function gmReport(commodities, fields, sales, movements = []) {
  const groups = [];
  for (const r of positionRows(commodities, fields, sales, movements)) {
    const own = fields.filter((f) => f.commodityId === r.commodity.id).sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
    if (!own.length) continue;
    const price = r.productionTons > 0 ? r.totalValue / r.productionTons : 0;
    const defaultCostHa = r.area > 0 ? n(r.grossMarginCost) / r.area : 0;
    const rows = own.map((f) => {
      const area = n(f.areaHa);
      const tons = fieldTons(f, movements);
      const yieldTHa = area > 0 ? tons / area : 0;
      const override = costOverride(f);
      const costHa = override ?? defaultCostHa;
      const revenueHa = yieldTHa * price;
      return { id: f.id, name: f.name, area, yieldTHa, tons, price, revenueHa, costHa, costIsOverride: override !== null, defaultCostHa, gmHa: revenueHa - costHa };
    });
    groups.push({ id: r.commodity.id, name: r.commodity.name, price, defaultCostHa, fields: rows, total: totalOf(rows, price) });
  }
  return { groups, total: totalOf(groups.flatMap((g) => g.fields)) };
}

/**
 * The crop's gross margin cost per hectare (Settings), spread over its paddocks: what a paddock with no cost of its own is charged.
 * `extraHa` is a paddock not yet saved, counted with the rest. Zero when the crop has no cost or no area.
 */
export function cropCostPerHa(commodity, fields, extraHa = 0) {
  if (!commodity) return 0;
  const area = fields.filter((f) => f.commodityId === commodity.id).reduce((s, f) => s + n(f.areaHa), 0) + n(extraHa);
  return area > 0 ? n(commodity.grossMarginCost) / area : 0;
}
