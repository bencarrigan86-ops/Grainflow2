// Roll-up / position calculations shared across views.

export function saleEconomics(sale) {
  const price = Number(sale.price) || 0;
  const freight = Number(sale.freight) || 0;
  const premium = Number(sale.premiumDiscount) || 0;
  const leviesPct = Number(sale.leviesPct) || 0;
  const tons = Number(sale.tons) || 0;
  const tonsDelivered = Number(sale.tonsDelivered) || 0;

  const levies = -(price + freight) * leviesPct;
  const priceExFarm = price + freight + levies + premium;
  const totalValue = tons * priceExFarm;
  const tonsDue = tons - tonsDelivered;
  return { levies, priceExFarm, totalValue, tonsDue };
}

export function fieldTons(f) {
  return (Number(f.areaHa) || 0) * (Number(f.yieldTHa) || 0);
}

export function productionByCommodity(commodities, fields) {
  return commodities.map((c) => {
    const rows = fields.filter((f) => f.commodityId === c.id);
    const area = rows.reduce((s, f) => s + (Number(f.areaHa) || 0), 0);
    const tons = rows.reduce((s, f) => s + fieldTons(f), 0);
    const yieldTHa = area > 0 ? tons / area : 0;
    return { commodity: c, area, tons, yieldTHa, fieldCount: rows.length };
  });
}

export function salesByCommodity(commodities, sales) {
  return commodities.map((c) => {
    const rows = sales.filter((s) => s.commodityId === c.id);
    let tons = 0, tonsDelivered = 0, totalValue = 0;
    rows.forEach((s) => {
      const econ = saleEconomics(s);
      tons += Number(s.tons) || 0;
      tonsDelivered += Number(s.tonsDelivered) || 0;
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
export function position(commodities, fields, sales) {
  const prod = productionByCommodity(commodities, fields);
  const sold = salesByCommodity(commodities, sales);

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
