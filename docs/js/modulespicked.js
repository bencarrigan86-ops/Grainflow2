// Modules picked: what a cotton paddock has picked, before and while it is carted to the gin yard.
//
// A paddock is set up with the modules picked from it: how many, their estimated weight and the turnout. From those the bales,
// the seed and the ginning can be estimated before anything is carted. Moving the modules to the gin yard is then an ordinary
// movement with their actual weights, and the ginning run replaces the estimates with the real lint, seed and invoice.
//
// Pure functions, no screen: the sheets that use them are in views/modulespicked.js.

import { cleanCotton, hasModules, moduleLegs, SEED_FACTOR_DEFAULT } from './ginning.js?v=395';

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

/** The picking records of a paddock as saved: id, date, modules, estimated weight (kg), turnout (%) and the bales that gives. */
export function cleanPicked(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((p) => p && typeof p === 'object' && num(p.count) > 0)
    .map((p) => ({
      id: String(p.id || ''), date: String(p.date || ''), count: num(p.count), kg: num(p.kg),
      turnoutPct: num(p.turnoutPct), estBales: num(p.estBales),
    }));
}

/**
 * Modules picked, moved to the yard and still in the paddock; and the weight and bales those picked come to.
 * An entry logged with no weight is taken at `moduleKg` a module (the commodity's average module weight), so its modules are
 * not counted as weighing nothing.
 */
export function pickedTotals(field, movements, moduleKg = 0) {
  const list = cleanPicked(field?.modulesPicked);
  const picked = list.reduce((s, p) => s + p.count, 0);
  const kg = list.reduce((s, p) => s + (p.kg > 0 ? p.kg : p.count * num(moduleKg)), 0);
  const estBales = list.reduce((s, p) => s + p.estBales, 0);
  let moved = 0;
  for (const m of movements || []) {
    if (!hasModules(m)) continue;
    for (const leg of moduleLegs(m)) if (leg.fieldId === field?.id) moved += leg.count;
  }
  const inField = Math.max(0, picked - moved);
  const share = picked > 0 ? Math.min(1, inField / picked) : 0;
  return { picked, moved, inField, kg, estBales, inFieldKg: kg * share, inFieldBales: estBales * share };
}

/**
 * The average weight of a module on a paddock, in kg: what was picked on it when that is known, otherwise the commodity's
 * cotton setting (which every paddock starts from). 0 when neither is set.
 */
export function avgModuleKg(field, commodity) {
  const std = num(commodity?.cotton?.moduleKg);
  const t = pickedTotals(field, [], std);
  if (t.picked > 0 && t.kg > 0) return t.kg / t.picked;
  return std;
}

/** The seed and the ginning that `bales` standard bales will bring, at the commodity's cotton settings. */
export function moduleEstimate(settings, bales) {
  const c = cleanCotton(settings) || cleanCotton({});
  const b = Math.max(0, num(bales));
  const factor = c.seedFactor > 0 ? c.seedFactor : SEED_FACTOR_DEFAULT;
  const seedT = b * factor;
  return {
    bales: b, seedT, seedValue: seedT * c.seedMtm, ginning: b * (c.ginRate + c.levies),
    hasSeedPrice: c.seedMtm > 0, hasGinRate: c.ginRate + c.levies > 0,
  };
}

const money0 = (n) => `$${Math.round(n).toLocaleString('en-AU')}`;

/** "about 397.7 bales · 97.4 t seed ($48,700) · ginning $28,500": what the picked modules should come to. */
export function describeEstimate(est) {
  if (!est || !(est.bales > 0)) return '';
  const bits = [`about ${est.bales.toFixed(1)} bales`, `${est.seedT.toFixed(1)} t seed${est.hasSeedPrice ? ` (${money0(est.seedValue)})` : ''}`];
  if (est.hasGinRate) bits.push(`ginning ${money0(est.ginning)}`);
  return bits.join(' · ');
}
