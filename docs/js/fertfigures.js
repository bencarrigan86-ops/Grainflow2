// The fertiliser report's figures, worked out once for the screen and the PDF so the two cannot disagree.
//
// Urea: per paddock, the soil nitrogen and its urea equivalent, the target yield, urea required, applied and left (kg/ha and
// tonnes), the nitrogen available and the yield it can carry; then a total row (the kg/ha figures area-weighted, the soil
// and target figures a plain mean as on the screen). Starter fertiliser: required, applied and left. Pure.

import { fieldUrea, ureaAppliedKgHaFor, fieldStarter, soilNUreaEquivalent, fieldUreaForTarget, maxYieldFromUrea } from './derived.js?v=299';

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
  const area = rows.reduce((s, r) => s + r.area, 0);
  const sum = (key) => rows.reduce((s, r) => s + r[key], 0);
  const mean = (key) => (rows.length ? sum(key) / rows.length : 0);
  // area-weighted, not a plain mean: a 320 ha paddock and a 12 ha corner do not carry the same weight
  const weighted = (key) => (area > 0 ? rows.reduce((s, r) => s + r[key] * r.area, 0) / area : 0);
  const perHa = (tonnesKey) => (area > 0 ? (sum(tonnesKey) * 1000) / area : 0);
  const total = {
    name: 'Total', area,
    soilN: mean('soilN'), soilEquiv: mean('soilEquiv'), targetYield: mean('targetYield'),
    req: perHa('reqT'), app: perHa('appT'), left: perHa('leftT'),
    reqT: sum('reqT'), appT: sum('appT'), leftT: sum('leftT'),
    nAvail: weighted('nAvail'), maxYield: weighted('maxYield'),
  };
  return { name: g.name, rows, total };
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
  const area = rows.reduce((s, r) => s + r.area, 0);
  const sum = (key) => rows.reduce((s, r) => s + r[key], 0);
  const perHa = (key) => (area > 0 ? (sum(key) * 1000) / area : 0);
  const total = { name: 'Total', area, req: perHa('reqT'), app: perHa('appT'), left: perHa('leftT'), reqT: sum('reqT'), appT: sum('appT'), leftT: sum('leftT') };
  return { name: g.name, rows, total };
}
