// Averages by commodity across seasons: what each crop yielded and what it sold for, season by season and over the lot.
//
// Yield is the tonnes a crop made divided by the hectares it was grown on, over the seasons picked (so a big paddock
// counts for more than a small one, and a season with no tonnes yet is left out rather than counted as a failure).
// Price is the tonnes sold weighted: the contract price, and what was left per tonne after freight and levies.
// Built from the seasons the farm already holds; nothing is entered. Pure.

import { fieldTons, saleEconomics } from './derived.js?v=408';

const key = (s) => String(s || '').trim().toLowerCase();
const isFallow = (name) => /^fallow\b/i.test(String(name || '').trim());
const round = (n, dp = 2) => { const f = 10 ** dp; return Math.round((Number(n) || 0) * f) / f; };

/**
 * The seasons that count as finished: every season up to and including the current one. A season after it (next year's
 * plan, with forecast yields) is left out until it is picked.
 * @param {string[]} labels
 * @param {string} currentLabel
 */
export function finishedSeasons(labels, currentLabel) {
  const sorted = [...labels].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const cur = /^\d{4}$/.test(currentLabel) ? Number(currentLabel) : null;
  if (cur === null) return sorted;
  return sorted.filter((l) => !/^\d{4}$/.test(l) || Number(l) <= cur);
}

/**
 * @param {Record<string, {commodities: object[], fields: object[], sales?: object[], movements?: object[]}>} years
 * @param {string[]} labels  the seasons to include, in the order to show them
 */
export function seasonAverages(years, labels) {
  const by = new Map();    // commodity key -> { name, seasons: {label: {...}} }
  const slot = (name, label) => {
    const k = key(name);
    if (!by.has(k)) by.set(k, { name: String(name).trim(), seasons: {} });
    const c = by.get(k);
    if (!c.seasons[label]) c.seasons[label] = { ha: 0, tons: 0, est: false, soldTons: 0, soldValue: 0, contractValue: 0 };
    return c.seasons[label];
  };

  for (const label of labels) {
    const y = years[label];
    if (!y) continue;
    const nameOf = new Map((y.commodities || []).map((c) => [c.id, c.name]));
    for (const f of y.fields || []) {
      const name = nameOf.get(f.commodityId);
      if (!name || isFallow(name)) continue;
      const s = slot(name, label);
      const ha = Number(f.areaHa) || 0;
      const t = fieldTons(f, y.movements || []);
      s.ha += ha;
      s.tons += t;
      if (!(f.yieldMode === 'actual' || f.yieldMode === 'recorded')) s.est = true;
    }
    for (const sale of y.sales || []) {
      const name = nameOf.get(sale.commodityId);
      if (!name) continue;
      const tons = Number(sale.tons) || 0;
      if (tons <= 0) continue;
      const s = slot(name, label);
      s.soldTons += tons;
      s.soldValue += saleEconomics(sale, y.movements || []).totalValue;
      s.contractValue += (Number(sale.price) || 0) * tons;
    }
  }

  const commodities = [...by.values()].map((c) => {
    const seasons = {};
    let ha = 0; let tons = 0; let grown = 0; let est = false;
    let soldTons = 0; let soldValue = 0; let contractValue = 0;
    for (const label of labels) {
      const s = c.seasons[label];
      if (!s) continue;
      const made = s.tons > 0 && s.ha > 0;
      seasons[label] = {
        ha: round(s.ha, 1), tons: round(s.tons, 0), yieldTHa: made ? round(s.tons / s.ha, 2) : 0, est: made && s.est,
        soldTons: round(s.soldTons, 0), netPrice: s.soldTons > 0 ? round(s.soldValue / s.soldTons, 0) : 0,
        contractPrice: s.soldTons > 0 ? round(s.contractValue / s.soldTons, 0) : 0,
      };
      if (made) { ha += s.ha; tons += s.tons; grown += 1; if (s.est) est = true; }
      soldTons += s.soldTons; soldValue += s.soldValue; contractValue += s.contractValue;
    }
    return {
      name: c.name, seasons,
      total: {
        seasonsGrown: grown, ha: round(ha, 1), tons: round(tons, 0), yieldTHa: ha > 0 ? round(tons / ha, 2) : 0, est,
        soldTons: round(soldTons, 0), netPrice: soldTons > 0 ? round(soldValue / soldTons, 0) : 0,
        contractPrice: soldTons > 0 ? round(contractValue / soldTons, 0) : 0, soldValue: round(soldValue, 0),
      },
    };
  });
  // the crops with the most ground first
  commodities.sort((a, b) => b.total.ha - a.total.ha || a.name.localeCompare(b.name));
  return { labels, commodities };
}

/** One row per commodity per season, then one per commodity for the whole span: for Excel. */
export function averagesRows(result, { showMoney = true } = {}) {
  const rows = [];
  for (const c of result.commodities) {
    for (const label of result.labels) {
      const s = c.seasons[label];
      if (!s) continue;
      rows.push({
        commodity: c.name, season: label, ha: s.ha || '', tons: s.tons || '', yieldTHa: s.yieldTHa || '', yieldIs: s.yieldTHa ? (s.est ? 'Estimate' : 'Actual') : '',
        soldTons: s.soldTons || '', contractPrice: showMoney && s.soldTons ? s.contractPrice : '', netPrice: showMoney && s.soldTons ? s.netPrice : '',
      });
    }
    const t = c.total;
    rows.push({
      commodity: c.name, season: `All ${t.seasonsGrown} seasons`, ha: t.ha || '', tons: t.tons || '', yieldTHa: t.yieldTHa || '', yieldIs: '',
      soldTons: t.soldTons || '', contractPrice: showMoney && t.soldTons ? t.contractPrice : '', netPrice: showMoney && t.soldTons ? t.netPrice : '',
    });
  }
  return rows;
}

export const AVERAGES_COLUMNS = (showMoney = true) => [
  { label: 'Commodity', get: (r) => r.commodity },
  { label: 'Season', get: (r) => r.season },
  { label: 'Area (ha)', get: (r) => r.ha },
  { label: 'Tonnes', get: (r) => r.tons },
  { label: 'Yield (t/ha)', get: (r) => r.yieldTHa },
  { label: 'Yield is', get: (r) => r.yieldIs },
  { label: 'Tonnes sold', get: (r) => r.soldTons },
  ...(showMoney ? [
    { label: 'Average contract price ($/t)', get: (r) => r.contractPrice },
    { label: 'Average net price after freight and levies ($/t)', get: (r) => r.netPrice },
  ] : []),
];
