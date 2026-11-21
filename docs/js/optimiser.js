// Outload optimiser: "I need 250 t of wheat at 11.5% protein or better, 12.5% moisture or less: where do I take it from?"
//
// Each silo, bunker or shed gives up its grain in a set order: top first for a silo, the front or the back of a bunker
// (whichever end is chosen on it). So the first tonnes out of a silo are not the silo's average, they are whatever sits
// at that end, and the next tonnes are different again. This looks at what every storage of the commodity would give
// up, truck by truck in that order, and tries single storages and blends of two or three, loading every truck in the
// same proportions. It reports the options that meet the spec, fewest storages first, and when none does, the closest.
//
// It changes nothing: it only reads storages and loads, and a storage still in a fumigation withholding period is left
// out. Pure functions over plain records, so it is tested without the app. The screen is views/optimiser.js, and the
// only other place that knows of it is the one button that opens it.

import { layersForStorage, outloadEndOf, SPECS } from './outload.js?v=507';
import { fumigationState } from './fumigation.js?v=507';
import { isTransit } from './transit.js?v=507';
import { isOffFarm } from './offfarm.js?v=507';

const EPS = 1e-9;
const num = (v) => Number(v) || 0;
const KNOWN = 0.95;          // a measurement counts as known when this share of the tonnes carries it
const MAX_TRUCKS = 60;       // a long outload is planned in bigger steps than the truck, not truck by truck

/** The grain a storage holds in the order it comes out: the top of a silo, or the chosen end of a bunker. */
export function inOutOrder(layers, end) {
  const out = layers.map((l) => ({ ...l }));
  return end === 'first' ? out : out.reverse();
}

/**
 * The storages of one commodity that can supply an outload, each with its grain in coming-out order, and the ones left
 * out with the reason.
 */
export function sourcesFor({ storages, movements, commodityId, today }) {
  const sources = [];
  const left = [];
  for (const s of storages || []) {
    if (s.commodityId !== commodityId) continue;
    if (s.kind === 'tally' || isTransit(s) || isOffFarm(s)) continue;
    const fum = fumigationState(s, today);
    const { layers } = layersForStorage(s, movements || []);
    const total = layers.reduce((a, l) => a + l.tons, 0);
    if (total <= 0.05) { left.push({ id: s.id, name: s.name, why: 'Empty on the books' }); continue; }
    if (fum.withheld) { left.push({ id: s.id, name: s.name, why: `Withholding after fumigation until ${fum.clearOn}`, withheldUntil: fum.clearOn }); continue; }
    const end = outloadEndOf(s);
    sources.push({ id: s.id, name: s.name, kind: s.kind, end, total, out: inOutOrder(layers, end) });
  }
  return { sources, left };
}

/** What the grain between `from` and `to` tonnes (counted in coming-out order) is: tonnes, spec sums and the grades in it. */
export function drawSpecs(out, from, to) {
  const res = { tons: 0, sum: {}, cov: {}, grades: {} };
  for (const { key } of SPECS) { res.sum[key] = 0; res.cov[key] = 0; }
  let at = 0;
  for (const layer of out) {
    const lo = Math.max(from, at);
    const hi = Math.min(to, at + layer.tons);
    at += layer.tons;
    if (hi - lo <= EPS) { if (at >= to) break; continue; }
    const t = hi - lo;
    res.tons += t;
    const g = layer.spec?.grade || '';
    res.grades[g] = (res.grades[g] || 0) + t;
    for (const { key } of SPECS) {
      const v = layer.spec?.[key];
      if (v !== null && v !== undefined) { res.sum[key] += v * t; res.cov[key] += t; }
    }
    if (at >= to) break;
  }
  return res;
}

const blank = () => { const r = { tons: 0, sum: {}, cov: {}, grades: {} }; for (const { key } of SPECS) { r.sum[key] = 0; r.cov[key] = 0; } return r; };
const add = (a, b) => {
  a.tons += b.tons;
  for (const { key } of SPECS) { a.sum[key] += b.sum[key]; a.cov[key] += b.cov[key]; }
  for (const [g, t] of Object.entries(b.grades)) a.grades[g] = (a.grades[g] || 0) + t;
};

/** The average of each measurement over a stretch of grain, or null where too little of it is recorded to say. */
export function averages(r) {
  const out = {};
  for (const { key } of SPECS) out[key] = r.tons > EPS && r.cov[key] / r.tons >= KNOWN ? r.sum[key] / r.cov[key] : null;
  return out;
}

/** The limits asked for, as a list: { key, kind: 'min' | 'max', value }. Blank means no limit. */
export function limitsOf(rules) {
  const list = [];
  for (const [key, v] of Object.entries(rules?.min || {})) if (v !== '' && v != null && Number.isFinite(Number(v))) list.push({ key, kind: 'min', value: Number(v) });
  for (const [key, v] of Object.entries(rules?.max || {})) if (v !== '' && v != null && Number.isFinite(Number(v))) list.push({ key, kind: 'max', value: Number(v) });
  return list;
}

/** Does one stretch of grain meet the rules? Lists what it fails, as { key, why, got, need, kind }. */
export function breaches(r, rules) {
  const fails = [];
  const allowed = (rules?.grades || []).filter(Boolean);
  if (allowed.length) {
    const bad = Object.entries(r.grades).filter(([g, t]) => t > EPS && !allowed.includes(g));
    if (bad.length) fails.push({ key: 'grade', why: `Grade ${bad.map(([g]) => g || 'not recorded').join(', ')}`, got: null, need: allowed.join(' or '), kind: 'grade' });
  }
  const avg = averages(r);
  for (const l of limitsOf(rules)) {
    const got = avg[l.key];
    if (got === null || got === undefined) { fails.push({ key: l.key, why: 'Not recorded on enough of the grain', got: null, need: l.value, kind: l.kind }); continue; }
    if (l.kind === 'min' ? got < l.value - 1e-9 : got > l.value + 1e-9) fails.push({ key: l.key, why: l.kind === 'min' ? 'Too low' : 'Too high', got, need: l.value, kind: l.kind });
  }
  return fails;
}

/** How far a set of failures is from meeting the spec, as a share of what was asked, so "closest" can be ranked. */
const distance = (fails) => fails.reduce((a, f) => a + (f.got === null || f.kind === 'grade' ? 1 : Math.abs(f.got - f.need) / Math.max(Math.abs(f.need), 1)), 0);

/** The truck plan: whole trucks of `size` and a smaller last one, in steps no smaller than total/MAX_TRUCKS. */
export function truckPlan(tons, size) {
  const total = Math.max(0, num(tons));
  const step = Math.max(num(size) > 0 ? num(size) : 36, total / MAX_TRUCKS, 0.1);
  const sizes = [];
  let left = total;
  while (left > EPS) { const t = Math.min(step, left); sizes.push(t); left -= t; }
  return { total, step, sizes };
}

/**
 * Try one blend: `shares` is [{ source, share }] adding to 1. Every truck is loaded in those proportions, each storage
 * giving up its grain in coming-out order. Returns null when a storage cannot supply its share of the whole outload.
 */
export function tryBlend(shares, plan, rules) {
  const used = shares.map(() => 0);
  const whole = blank();
  const trucks = [];
  for (const t of plan.sizes) {
    const truck = blank();
    for (let i = 0; i < shares.length; i += 1) {
      const take = shares[i].share * t;
      if (used[i] + take > shares[i].source.total + 1e-6) return null;
      add(truck, drawSpecs(shares[i].source.out, used[i], used[i] + take));
      used[i] += take;
    }
    trucks.push(truck);
    add(whole, truck);
  }
  const avg = averages(whole);
  const wholeFails = breaches(whole, rules);
  const truckFails = trucks.map((tr) => breaches(tr, rules));
  const worstTruck = truckFails.reduce((w, f) => (distance(f) > distance(w) ? f : w), []);
  // the worst figure each measured spec reaches on any single truck, for the report
  const worst = {};
  for (const l of limitsOf(rules)) {
    const vals = trucks.map((tr) => averages(tr)[l.key]).filter((v) => v !== null && v !== undefined);
    worst[l.key] = vals.length ? (l.kind === 'min' ? Math.min(...vals) : Math.max(...vals)) : null;
  }
  const giveaway = limitsOf(rules).reduce((a, l) => {
    const got = avg[l.key];
    if (got === null || got === undefined) return a;
    return a + (l.kind === 'min' ? (got - l.value) : (l.value - got)) / Math.max(Math.abs(l.value), 1);
  }, 0);
  const parts = shares.map((x, i) => ({
    id: x.source.id, name: x.source.name, share: x.share, tons: used[i],
    trucks: plan.sizes.length ? Math.round((used[i] / plan.step) * 10) / 10 : 0,
    from: x.source.out.length ? x.source.out[0].spec?.grade || '' : '',
  }));
  return {
    parts, avg, worst, total: whole.tons, grades: whole.grades,
    wholeFails, worstTruckFails: worstTruck,
    meetsAverage: wholeFails.length === 0,
    meetsEveryTruck: truckFails.every((f) => f.length === 0),
    giveaway,
    distanceAverage: distance(wholeFails),
    distanceEveryTruck: distance(worstTruck),
    silos: shares.length,
  };
}

/** Shares in whole tenths for one, two or three storages: [1], [.1,.9] ... [.8,.1,.1] ... */
function shareSets(count) {
  if (count === 1) return [[1]];
  const out = [];
  if (count === 2) { for (let a = 1; a <= 9; a += 1) out.push([a / 10, (10 - a) / 10]); return out; }
  for (let a = 1; a <= 8; a += 1) for (let b = 1; b <= 9 - a; b += 1) out.push([a / 10, b / 10, (10 - a - b) / 10]);
  return out;
}

function combos(list, k, from = 0, acc = [], out = []) {
  if (acc.length === k) { out.push(acc.slice()); return out; }
  for (let i = from; i < list.length; i += 1) { acc.push(list[i]); combos(list, k, i + 1, acc, out); acc.pop(); }
  return out;
}

/**
 * The options for an outload. `mode` is 'every-truck' (each truck must meet the spec on its own, the strict way) or
 * 'average' (the outload as a whole must). Returns the options that meet it, best of each size first, or, when none do,
 * the closest ones with what they miss.
 */
export function optimise({ sources, tons, truck = 36, rules = {}, mode = 'every-truck', maxStorages = 3 }) {
  const plan = truckPlan(tons, truck);
  if (!(plan.total > 0) || !sources.length) return { plan, options: [], closest: [], tried: 0, stock: sources.reduce((a, s) => a + s.total, 0) };
  const pool = [...sources].sort((a, b) => b.total - a.total).slice(0, 10);
  const meets = (r) => (mode === 'average' ? r.meetsAverage : r.meetsEveryTruck);
  const miss = (r) => (mode === 'average' ? r.distanceAverage : r.distanceEveryTruck);
  const all = [];
  let tried = 0;
  for (let k = 1; k <= Math.min(maxStorages, pool.length); k += 1) {
    for (const group of combos(pool, k)) {
      for (const shares of shareSets(k)) {
        tried += 1;
        const r = tryBlend(group.map((source, i) => ({ source, share: shares[i] })), plan, rules);
        if (r) all.push(r);
      }
    }
  }
  const good = all.filter(meets);
  // Best of each size (fewest storages first), tightest to the spec within it, and the tightest overall if it is another.
  const bySize = [];
  for (let k = 1; k <= maxStorages; k += 1) {
    const best = good.filter((r) => r.silos === k).sort((a, b) => a.giveaway - b.giveaway)[0];
    if (best) bySize.push(best);
  }
  const tightest = [...good].sort((a, b) => a.giveaway - b.giveaway)[0];
  const options = [...bySize];
  if (tightest && !options.includes(tightest)) options.push(tightest);
  options.sort((a, b) => a.silos - b.silos || a.giveaway - b.giveaway);
  const closest = good.length ? [] : [...all].sort((a, b) => miss(a) - miss(b) || a.silos - b.silos).slice(0, 3);
  return { plan, options, closest, tried, stock: sources.reduce((a, s) => a + s.total, 0) };
}
