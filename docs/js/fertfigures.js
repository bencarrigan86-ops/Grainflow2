// The fertiliser report's figures, worked out once for the screen and the PDF so the two cannot disagree.
//
// Urea: per paddock, the soil nitrogen and its urea equivalent, the target yield, urea required, applied and left (kg/ha and
// tonnes), the nitrogen available and the yield it can carry; then a total row (the kg/ha figures area-weighted, the soil
// and target figures a plain mean as on the screen). Starter fertiliser: required, applied and left. Pure.

import { fieldUrea, ureaAppliedKgHaFor, fieldSeed, fieldStarter, soilNUreaEquivalent, fieldUreaForTarget, maxYieldFromUrea, fieldTons } from './derived.js?v=387';

const n = (v) => Number(v) || 0;

/**
 * @param {{name: string, fields: object[]}} g  one commodity's group from groupFieldsByCommodity()
 * @param {object} [commodity]  the commodity, for its target yield and nitrogen per tonne
 */
export function ureaFigures(g, commodity) {
  const rows = g.fields.map((f) => {
    const u = fieldUrea(f);
    const target = fieldUreaForTarget(f, commodity);
    // What the nitrogen actually on the paddock will carry, as against what the plan called for.
    const max = maxYieldFromUrea({ nPerTonne: commodity?.nPerTonne, soilTestN: f.soilTestNKgHa, ureaAppliedKgHa: ureaAppliedKgHaFor(f) });
    const area = n(f.areaHa);
    return {
      name: f.name, area,
      soilN: n(f.soilTestNKgHa), soilEquiv: soilNUreaEquivalent(f.soilTestNKgHa),
      targetYield: target.targetYieldTHa,
      req: n(f.ureaRequiredKgHa), app: ureaAppliedKgHaFor(f), left: area > 0 ? (u.leftTons * 1000) / area : 0,
      reqT: u.requiredTons, appT: u.appliedTons, leftT: u.leftTons,
      nAvail: max.nAvailableKgHa, maxYield: max.maxYieldTHa,
    };
  });
  return { name: g.name, rows, total: ureaTotal(rows) };
}

/** The total row of a set of urea rows: the kg/ha figures area-weighted, the soil and target figures a plain mean. */
function ureaTotal(rows) {
  const area = rows.reduce((s, r) => s + r.area, 0);
  const sum = (key) => rows.reduce((s, r) => s + r[key], 0);
  const mean = (key) => (rows.length ? sum(key) / rows.length : 0);
  // area-weighted, not a plain mean: a 320 ha paddock and a 12 ha corner do not carry the same weight
  const weighted = (key) => (area > 0 ? rows.reduce((s, r) => s + r[key] * r.area, 0) / area : 0);
  const perHa = (tonnesKey) => (area > 0 ? (sum(tonnesKey) * 1000) / area : 0);
  return {
    name: 'Total', area,
    soilN: mean('soilN'), soilEquiv: mean('soilEquiv'), targetYield: mean('targetYield'),
    req: perHa('reqT'), app: perHa('appT'), left: perHa('leftT'),
    reqT: sum('reqT'), appT: sum('appT'), leftT: sum('leftT'),
    nAvail: weighted('nAvail'), maxYield: weighted('maxYield'),
  };
}

/**
 * Urea for the whole farm, one row per commodity (that commodity's own total) and a farm total worked from every paddock, so the
 * kg/ha figures are weighted by area across commodities and not an average of averages.
 * @param {{name: string, rows: object[], total: object}[]} figs  ureaFigures() for each commodity
 */
export function ureaSummary(figs) {
  return { name: 'All commodities', rows: figs.map((x) => ({ ...x.total, name: x.name })), total: ureaTotal(figs.flatMap((x) => x.rows)) };
}

/** @param {{name: string, fields: object[]}} g */
export function starterFigures(g) {
  const rows = g.fields.map((f) => {
    const s = fieldStarter(f);
    const area = n(f.areaHa);
    return {
      name: f.name, area, req: n(f.starterRequiredKgHa), app: n(f.starterAppliedKgHa), left: area > 0 ? (s.leftTons * 1000) / area : 0,
      reqT: s.requiredTons, appT: s.appliedTons, leftT: s.leftTons,
    };
  });
  return { name: g.name, rows, total: starterTotal(rows) };
}

function starterTotal(rows) {
  const area = rows.reduce((s, r) => s + r.area, 0);
  const sum = (key) => rows.reduce((s, r) => s + r[key], 0);
  const perHa = (key) => (area > 0 ? (sum(key) * 1000) / area : 0);
  return { name: 'Total', area, req: perHa('reqT'), app: perHa('appT'), left: perHa('leftT'), reqT: sum('reqT'), appT: sum('appT'), leftT: sum('leftT') };
}

/** Starter fertiliser for the whole farm, one row per commodity and a farm total, the same way as ureaSummary(). */
export function starterSummary(figs) {
  return { name: 'All commodities', rows: figs.map((x) => ({ ...x.total, name: x.name })), total: starterTotal(figs.flatMap((x) => x.rows)) };
}

/** Seed: per paddock the variety, area, rate and the tonnes needed (and with the buffer on top); the total's rate is tonnes over area. */
export function seedFigures(g) {
  const rows = g.fields.map((f) => {
    const s = fieldSeed(f);
    return { name: f.name, variety: f.seedVariety || '', area: n(f.areaHa), rate: n(f.seedRateKgHa), requiredT: s.requiredTons, bufferedT: s.bufferedTons };
  });
  const area = rows.reduce((a, r) => a + r.area, 0);
  const requiredT = rows.reduce((a, r) => a + r.requiredT, 0);
  const bufferedT = rows.reduce((a, r) => a + r.bufferedT, 0);
  return { name: g.name, rows, total: { name: 'Total', variety: '', area, rate: area > 0 ? (requiredT * 1000) / area : 0, requiredT, bufferedT } };
}

/** What a paddock with no variety written down is listed as in the seed summary. */
export const NO_VARIETY = 'No variety set';

/**
 * Seed ordered the way it is bought: for each commodity, each variety with the paddocks and hectares it goes on, the rate over that
 * area and the tonnes needed (and with the buffer on top); then the commodity's own total. Varieties are matched ignoring case and
 * spacing, so "Scepter" and "scepter " are one line. Paddocks with no variety come last, so they are easy to find and fill in.
 * @param {{name: string, rows: object[], total: object}[]} figs  seedFigures() for each commodity
 */
export function seedSummary(figs) {
  return figs.map((fig) => {
    const by = new Map();
    for (const r of fig.rows) {
      const label = String(r.variety || '').trim();
      const key = label.toLowerCase();
      if (!by.has(key)) by.set(key, { variety: label || NO_VARIETY, fields: 0, area: 0, requiredT: 0, bufferedT: 0 });
      const v = by.get(key);
      v.fields += 1; v.area += r.area; v.requiredT += r.requiredT; v.bufferedT += r.bufferedT;
    }
    const varieties = [...by.entries()]
      .sort(([ka, a], [kb, b]) => (ka === '') - (kb === '') || b.requiredT - a.requiredT || a.variety.localeCompare(b.variety))
      .map(([, v]) => ({ ...v, rate: v.area > 0 ? (v.requiredT * 1000) / v.area : 0 }));
    return { name: fig.name, varieties, total: { area: fig.total.area, fields: fig.rows.length, rate: fig.total.rate, requiredT: fig.total.requiredT, bufferedT: fig.total.bufferedT } };
  }).filter((c) => c.varieties.length > 0);
}

/**
 * Yield: per paddock the area, how the yield was reached (actual, recorded or estimate), the yield in t/ha and the tonnes;
 * the total row is the area, the yield over the whole area, and the tonnes.
 * @param {{name: string, fields: object[]}} g  one commodity's group from groupFieldsByCommodity()
 */
export function yieldFigures(g, movements) {
  const rows = g.fields.map((f) => {
    const tons = fieldTons(f, movements);
    const area = n(f.areaHa);
    return { name: f.name, area, mode: f.yieldMode === 'actual' ? 'Actual' : f.yieldMode === 'recorded' ? 'Recorded' : 'Estimate', yieldTHa: area > 0 ? tons / area : 0, tons };
  });
  const area = rows.reduce((a, r) => a + r.area, 0);
  const tons = rows.reduce((a, r) => a + r.tons, 0);
  return { name: g.name, rows, total: { name: 'Total', area, mode: '', yieldTHa: area > 0 ? tons / area : 0, tons } };
}
