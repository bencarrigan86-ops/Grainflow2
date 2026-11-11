// What is in a silo, in what order, and what the next truck will take out.
//
// A silo's contents are not one thing. They are the loads that went in, one on
// top of another, and each can be a different grade, protein or moisture. When a
// silo is emptied last in, first out, the first trucks away carry whatever went
// in last, and the quality they carry follows the order the grain arrived in.
// With the quality recorded against each load that order can be replayed, and a
// truck-by-truck prediction made before anything is loaded.
//
// The replay is the whole idea: start with the opening stock as the bottom layer,
// then walk the movements in the order they happened. A load into the silo puts a
// layer on top; a load out of it takes grain off the top, whole layers first and
// then part of the next. What is left, top to bottom, is what is in the silo now.
//
// Pure functions over plain records. Nothing here touches the farm.

const num = (v) => Number(v) || 0;
const EPS = 1e-9;

/** The measurements that can be averaged across a stretch of grain. */
export const SPECS = [
  { key: 'proteinPct', label: 'Protein', unit: '%', dp: 1 },
  { key: 'moisturePct', label: 'Moisture', unit: '%', dp: 1 },
  { key: 'screeningsPct', label: 'Screenings', unit: '%', dp: 1 },
  { key: 'testWeightKgHl', label: 'Test weight', unit: 'kg/hL', dp: 1 },
  { key: 'fallingNumber', label: 'Falling no.', unit: 's', dp: 0 },
];

/** A record's quality as plain numbers and text; blank is null, never zero. */
export function specOf(rec) {
  const out = { grade: String(rec?.grade ?? '').trim() };
  for (const { key } of SPECS) {
    const v = rec?.[key];
    out[key] = v === undefined || v === null || v === '' ? null : Number(v);
    if (Number.isNaN(out[key])) out[key] = null;
  }
  return out;
}

/** Oldest first: by date, then by ticket number, then by the order given. */
function inOrder(movements) {
  return movements
    .map((m, i) => ({ m, i }))
    .sort((a, b) => String(a.m.date ?? '').localeCompare(String(b.m.date ?? ''))
      || (num(a.m.ticketNo) - num(b.m.ticketNo))
      || (a.i - b.i))
    .map((x) => x.m);
}

/**
 * Replay a storage's history into the layers it holds now.
 *
 * @param {object} storage   its openingStock and its own quality describe the grain
 *                           that was already there at the start of the season
 * @param {object[]} movements  every movement in the season
 * @returns {{
 *   layers: object[],      bottom to top; each { tons, source, spec, date?, ticketNo?, id?, rego? }
 *   shortfall: number,     tonnes the record says went out that it never says went in
 * }}
 */
export function layersForStorage(storage, movements) {
  const layers = [];
  const opening = num(storage.openingStock);
  if (opening > 0) layers.push({ tons: opening, source: 'opening', spec: specOf(storage) });

  let shortfall = 0;
  for (const m of inOrder(movements || [])) {
    const out = (m.froms || []).filter((l) => l.type === 'silo' && l.id === storage.id).reduce((a, l) => a + num(l.tons), 0);
    const into = (m.tos || []).filter((l) => l.type === 'silo' && l.id === storage.id).reduce((a, l) => a + num(l.tons), 0);

    // Out first: grain that leaves comes off what was already there, never off the load that is arriving.
    let remaining = out;
    while (remaining > EPS && layers.length) {
      const top = layers[layers.length - 1];
      const take = Math.min(top.tons, remaining);
      top.tons -= take;
      remaining -= take;
      if (top.tons <= EPS) layers.pop();
    }
    shortfall += Math.max(0, remaining);

    if (into > EPS) {
      layers.push({ tons: into, source: 'load', spec: specOf(m), date: m.date ?? '', ticketNo: m.ticketNo ?? null, id: m.id, rego: m.truckRego ?? '' });
    }
  }
  return {
    layers: applyBands(layers.filter((l) => l.tons > EPS), storage.gradeBands, storage.gradeBandsDate),
    shortfall,
  };
}

/** Does a band say anything — a grade or any measurement — or is it only a stretch of grain not sampled? */
export const bandHasSpec = (b) => !!String(b?.grade ?? '').trim()
  || SPECS.some(({ key }) => b?.[key] !== undefined && b?.[key] !== null && b?.[key] !== '');

/**
 * Lay running samples over a stack of layers: by tonnes from the bottom of the silo,
 * "this stretch is APH1, 11.5% protein; the next is AUH2, 10.2%". Samples are taken
 * of the grain in the silo, not of each truck, so a band replaces what the loads say
 * for the grain it covers — whichever loads or opening stock that grain came from. A
 * layer that straddles two bands is split at the boundary.
 *
 * Bands describe the grain that was there when they were taken. With an `asOf` date
 * they cover only grain that arrived by then, so loads tipped in afterwards keep
 * their own grade instead of being painted with an older sample. Grain beyond the
 * last band keeps its own grade too. Positions count from the bottom, so trucks
 * taking grain off the top never move the bands below.
 *
 * @param {object[]} layers  bottom to top
 * @param {object[]} bands   bottom first: { tons, grade?, proteinPct?, moisturePct?, … }
 * @param {string} [asOf]    'YYYY-MM-DD'
 */
export function applyBands(layers, bands, asOf = '') {
  const list = (Array.isArray(bands) ? bands : []).filter((b) => num(b.tons) > 0);
  if (!list.length) return layers;
  const eligible = (l) => !asOf || l.source === 'opening' || !l.date || String(l.date) <= String(asOf);
  let cut = 0;
  while (cut < layers.length && eligible(layers[cut])) cut += 1;
  const below = layers.slice(0, cut);
  const above = layers.slice(cut);

  const out = [];
  let bi = 0;
  let left = num(list[0].tons);
  for (const layer of below) {
    let remaining = layer.tons;
    while (remaining > EPS) {
      if (bi >= list.length) { out.push({ ...layer, tons: remaining }); break; }
      const take = Math.min(remaining, left);
      const band = list[bi];
      out.push(bandHasSpec(band)
        ? { ...layer, tons: take, spec: specOf(band), banded: bi + 1 }
        : { ...layer, tons: take });
      remaining -= take;
      left -= take;
      if (left <= EPS) { bi += 1; left = bi < list.length ? num(list[bi].tons) : 0; }
    }
  }
  return [...out, ...above];
}

/**
 * Take `tons` off the top of a stack of layers, last in first out.
 * Does not change the layers it is given.
 *
 * @returns {{ taken: {layer: object, tons: number}[], remaining: object[], short: number }}
 */
export function takeFromTop(layers, tons) {
  const remaining = layers.map((l) => ({ ...l }));
  const taken = [];
  let want = Math.max(0, num(tons));
  while (want > EPS && remaining.length) {
    const top = remaining[remaining.length - 1];
    const take = Math.min(top.tons, want);
    taken.push({ layer: { ...top }, tons: take });
    top.tons -= take;
    want -= take;
    if (top.tons <= EPS) remaining.pop();
  }
  return { taken, remaining, short: want > EPS ? want : 0 };
}

/**
 * What a stretch of grain is, on average.
 *
 * Each measurement is averaged by tonnes, over only the loads that have it — a
 * load with no protein recorded does not pull the average to zero, it is left
 * out of that figure and counted in `coverage`, so "11.8% protein from 60% of the
 * grain" is distinguishable from "11.8% protein from all of it". The lowest and
 * highest are kept too: an average of 10.5 and 14 looks like 12, and a truck that
 * is half one and half the other should say so.
 */
export function summarise(taken) {
  const total = taken.reduce((a, t) => a + t.tons, 0);
  const specs = {};
  for (const { key } of SPECS) {
    const have = taken.filter((t) => t.layer.spec?.[key] !== null && t.layer.spec?.[key] !== undefined);
    const covered = have.reduce((a, t) => a + t.tons, 0);
    specs[key] = covered > EPS ? {
      avg: have.reduce((a, t) => a + t.tons * t.layer.spec[key], 0) / covered,
      min: Math.min(...have.map((t) => t.layer.spec[key])),
      max: Math.max(...have.map((t) => t.layer.spec[key])),
      coverage: total > EPS ? covered / total : 0,
    } : null;
  }

  const byGrade = new Map();
  for (const t of taken) {
    const g = t.layer.spec?.grade || '';
    byGrade.set(g, (byGrade.get(g) || 0) + t.tons);
  }
  const grades = [...byGrade.entries()]
    .map(([grade, tons]) => ({ grade, tons, pct: total > EPS ? tons / total : 0 }))
    .sort((a, b) => b.tons - a.tons);

  return { total, specs, grades, loads: taken.length };
}

/** One outload: the next `tons` out of the silo. */
export function predictOutload(layers, tons) {
  const { taken, remaining, short } = takeFromTop(layers, tons);
  return { tons: num(tons), short, remaining, segments: taken, ...summarise(taken) };
}

/**
 * A plan of trucks: `total` tonnes in loads of `truckTons`, the last one smaller
 * if it does not divide. Each truck is predicted from what the one before left.
 */
export function predictPlan(layers, total, truckTons) {
  const size = Math.max(0.1, num(truckTons));
  const trucks = [];
  let left = Math.max(0, num(total));
  let stack = layers;
  while (left > EPS && stack.length && trucks.length < 200) {
    const t = Math.min(size, left);
    const p = predictOutload(stack, t);
    if (p.total <= EPS) break;
    trucks.push(p);
    stack = p.remaining;
    // By what was actually taken: the last truck may find less than it asked for.
    left -= p.total;
  }
  return {
    trucks,
    // Asked for more than is in the silo.
    short: Math.max(0, left),
  };
}

/**
 * "APH1 · 11.9% protein · 11.4% moisture · 79.2 kg/hL · FN 410" — only what is
 * recorded, nothing else. Takes a quality object or any record carrying the fields.
 */
export function specText(rec) {
  const sp = specOf(rec);
  const fmt = (v, dp) => (Math.round(v * 10 ** dp) / 10 ** dp).toString();
  return [
    sp.grade,
    sp.proteinPct !== null ? `${fmt(sp.proteinPct, 1)}% protein` : '',
    sp.moisturePct !== null ? `${fmt(sp.moisturePct, 1)}% moisture` : '',
    sp.screeningsPct !== null ? `${fmt(sp.screeningsPct, 1)}% screenings` : '',
    sp.testWeightKgHl !== null ? `${fmt(sp.testWeightKgHl, 1)} kg/hL` : '',
    sp.fallingNumber !== null ? `FN ${fmt(sp.fallingNumber, 0)}` : '',
  ].filter(Boolean).join(' · ');
}
