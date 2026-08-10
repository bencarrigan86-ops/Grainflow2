// Roll-up / position calculations shared across views.

export const DEFAULT_TOLERANCE_PCT = 5;
export const DEFAULT_TOLERANCE_CAP_TONS = 20;

/**
 * Contract delivery tolerance: buyers typically accept delivery within
 * +/- the lesser of a percentage of the contract tons or a flat tonnage cap
 * (e.g. +/-5% or 20t, whichever is smaller) before the contract is
 * considered filled / over-delivered.
 */
export function contractTolerance(tons, tolerancePct = DEFAULT_TOLERANCE_PCT, toleranceCapTons = DEFAULT_TOLERANCE_CAP_TONS) {
  const t = Number(tons) || 0;
  const pctAmount = t * ((Number(tolerancePct) || 0) / 100);
  const capAmount = Number(toleranceCapTons) || 0;
  const toleranceTons = Math.min(pctAmount, capAmount);
  const minTons = Math.max(0, t - toleranceTons);
  const maxTons = t + toleranceTons;
  return { toleranceTons, minTons, maxTons };
}

/** Sum of movement tons that were carted to this sale (contract), i.e. delivered by truck. */
export function movementTonsToSale(saleId, movements) {
  return (movements || [])
    .filter((m) => m.toType === 'sale' && m.toId === saleId)
    .reduce((s, m) => s + (Number(m.tons) || 0), 0);
}

/** Net tons moved into (positive) or out of (negative) a storage unit via truck movements. */
export function movementNetForStorage(storageId, movements) {
  const into = (movements || [])
    .filter((m) => m.toType === 'silo' && m.toId === storageId)
    .reduce((s, m) => s + (Number(m.tons) || 0), 0);
  const outOf = (movements || [])
    .filter((m) => m.fromType === 'silo' && m.fromId === storageId)
    .reduce((s, m) => s + (Number(m.tons) || 0), 0);
  return into - outOf;
}

/**
 * Tracked stock ledger for a storage unit: the opening/current stock the
 * user last entered, plus everything moved in or out since. Independent of
 * the geometry-based estimate (siloResult/bunkerResult) — that's a physical
 * dip/measurement, this is paperwork.
 */
export function storageLedgerStock(storage, movements) {
  return (Number(storage.openingStock) || 0) + movementNetForStorage(storage.id, movements);
}

export function saleEconomics(sale, movements = []) {
  const price = Number(sale.price) || 0;
  const freight = Number(sale.freight) || 0;
  const premium = Number(sale.premiumDiscount) || 0;
  const leviesPct = Number(sale.leviesPct) || 0;
  const tons = Number(sale.tons) || 0;
  const manualDelivered = Number(sale.tonsDelivered) || 0;
  const movementDelivered = movementTonsToSale(sale.id, movements);
  const tonsDelivered = manualDelivered + movementDelivered;

  const netOfFreight = price - freight;
  const levies = -netOfFreight * leviesPct;
  const priceExFarm = netOfFreight + levies + premium;
  const totalValue = tons * priceExFarm;
  const tonsDue = tons - tonsDelivered;

  const { toleranceTons, minTons, maxTons } = contractTolerance(tons, sale.tolerancePct, sale.toleranceCapTons);
  const isFull = tonsDelivered >= minTons && tons > 0;
  const isOverDelivered = tonsDelivered > maxTons;
  const tonsToFill = Math.max(0, minTons - tonsDelivered);
  const tonsRemainingMax = Math.max(0, maxTons - tonsDelivered);

  return {
    netOfFreight, levies, priceExFarm, totalValue, tonsDue,
    manualDelivered, movementDelivered, tonsDelivered,
    toleranceTons, minTons, maxTons, isFull, isOverDelivered, tonsToFill, tonsRemainingMax,
  };
}

/** Sum of movement tons carted off this field (actual yield source). */
export function movementTonsFromField(fieldId, movements) {
  return (movements || [])
    .filter((m) => m.fromType === 'field' && m.fromId === fieldId)
    .reduce((s, m) => s + (Number(m.tons) || 0), 0);
}

export function estimateFieldTons(f) {
  return (Number(f.areaHa) || 0) * (Number(f.yieldTHa) || 0);
}

/** A field's urea: kg/ha figures converted to tonnes over its area. */
export function fieldUrea(f) {
  const area = Number(f.areaHa) || 0;
  const requiredTons = (area * (Number(f.ureaRequiredKgHa) || 0)) / 1000;
  const appliedTons = (area * (Number(f.ureaAppliedKgHa) || 0)) / 1000;
  return { requiredTons, appliedTons, leftTons: requiredTons - appliedTons };
}

export const SEED_BUFFER_PCT = 5;

/** A field's seed: rate (kg/ha) converted to tonnes over its area, plus a buffered figure. */
export function fieldSeed(f, bufferPct = SEED_BUFFER_PCT) {
  const area = Number(f.areaHa) || 0;
  const requiredTons = (area * (Number(f.seedRateKgHa) || 0)) / 1000;
  const bufferedTons = requiredTons * (1 + (Number(bufferPct) || 0) / 100);
  return { requiredTons, bufferedTons };
}

/**
 * A field's tons: either the manual estimate (area x yield), or — once
 * switched to "actual" — the real tons carted off it per Movement tickets.
 */
export function fieldTons(f, movements = []) {
  if (f.yieldMode === 'actual') return movementTonsFromField(f.id, movements);
  return estimateFieldTons(f);
}

export function productionByCommodity(commodities, fields, movements = []) {
  return commodities.map((c) => {
    const rows = fields.filter((f) => f.commodityId === c.id);
    const area = rows.reduce((s, f) => s + (Number(f.areaHa) || 0), 0);
    const tons = rows.reduce((s, f) => s + fieldTons(f, movements), 0);
    const yieldTHa = area > 0 ? tons / area : 0;
    return { commodity: c, area, tons, yieldTHa, fieldCount: rows.length };
  });
}

function byName(a, b) {
  return (a.name || '').localeCompare(b.name || '');
}

/** Fields grouped under each commodity (plus a trailing "No commodity" group), sorted by name. */
export function groupFieldsByCommodity(commodities, fields, movements = []) {
  const groups = commodities
    .map((c) => {
      const rows = fields.filter((f) => f.commodityId === c.id).sort(byName);
      return { id: c.id, name: c.name, fields: rows, totalTons: rows.reduce((s, f) => s + fieldTons(f, movements), 0) };
    })
    .filter((g) => g.fields.length > 0);

  const noCommodity = fields.filter((f) => !commodities.some((c) => c.id === f.commodityId)).sort(byName);
  if (noCommodity.length > 0) {
    groups.push({ id: null, name: 'No commodity', fields: noCommodity, totalTons: noCommodity.reduce((s, f) => s + fieldTons(f, movements), 0) });
  }
  return groups;
}

export function salesByCommodity(commodities, sales, movements = []) {
  return commodities.map((c) => {
    const rows = sales.filter((s) => s.commodityId === c.id);
    let tons = 0, tonsDelivered = 0, totalValue = 0;
    rows.forEach((s) => {
      const econ = saleEconomics(s, movements);
      tons += Number(s.tons) || 0;
      tonsDelivered += econ.tonsDelivered;
      totalValue += econ.totalValue;
    });
    const avgPrice = tons > 0 ? totalValue / tons : 0;
    return { commodity: c, tons, tonsDelivered, tonsDue: tons - tonsDelivered, totalValue, avgPrice, contractCount: rows.length };
  });
}

export function storageStockByCommodity(commodities, storageResults) {
  const map = new Map(commodities.map((c) => [c.id, 0]));
  storageResults.forEach((s) => {
    if (s.storage.commodityId && map.has(s.storage.commodityId)) {
      map.set(s.storage.commodityId, map.get(s.storage.commodityId) + s.tons);
    }
  });
  return map;
}

/**
 * Position per commodity: production, sold, and unsold-at-MTM — mirrors the
 * Summary ("ultimate report") tab: Opening Stock + Production − Sold − Retained
 * Seed = Unsold tons; Unsold × MTM price = unsold value.
 */
export function position(commodities, fields, sales, movements = []) {
  const prod = productionByCommodity(commodities, fields, movements);
  const sold = salesByCommodity(commodities, sales, movements);

  return commodities.map((c, i) => {
    const p = prod[i];
    const s = sold[i];
    const opening = Number(c.openingStock) || 0;
    const retainedSeed = Number(c.retainedSeed) || 0;
    const unsoldTons = opening + p.tons - s.tons - retainedSeed;
    const mtmPrice = Number(c.mtmPrice) || 0;
    const unsoldValue = unsoldTons * mtmPrice;
    const totalValue = s.totalValue + unsoldValue;
    const pctSold = (p.tons - retainedSeed) > 0 ? s.tons / (p.tons - retainedSeed) : 0;
    return {
      commodity: c,
      area: p.area,
      yieldTHa: p.yieldTHa,
      productionTons: p.tons,
      soldTons: s.tons,
      avgSoldPrice: s.avgPrice,
      soldValue: s.totalValue,
      pctSold,
      opening,
      retainedSeed,
      unsoldTons,
      mtmPrice,
      unsoldValue,
      totalValue,
    };
  });
}

export function positionTotals(rows) {
  return rows.reduce((acc, r) => ({
    area: acc.area + r.area,
    productionTons: acc.productionTons + r.productionTons,
    soldTons: acc.soldTons + r.soldTons,
    soldValue: acc.soldValue + r.soldValue,
    unsoldTons: acc.unsoldTons + r.unsoldTons,
    unsoldValue: acc.unsoldValue + r.unsoldValue,
    totalValue: acc.totalValue + r.totalValue,
  }), { area: 0, productionTons: 0, soldTons: 0, soldValue: 0, unsoldTons: 0, unsoldValue: 0, totalValue: 0 });
}
