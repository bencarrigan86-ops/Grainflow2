// Where a load came from, paddock by paddock.
//
// A truck leaving a silo carries grain that went in from several paddocks, and what is on it depends on the order the
// silo was filled and which end it is emptied from. This replays every movement of the season in the order it happened,
// keeping each silo as a stack of layers (the same replay outload.js uses for quality), and carries the paddocks along
// with the grain: a layer that came from a field remembers the field, a layer that came from another silo remembers
// that silo's own mix, and taking part of a layer takes the same share of each of its paddocks.
//
// The result is for an export, one line of words per load. It is a calculation off the records, so it is only as good
// as they are: opening stock has no paddock (it is called "Opening stock in <silo>"), grain an off-farm store holds is
// named for the store, and a load that took more than the silo was recorded as holding says "Not recorded" for the
// difference. Pure.

import { inOrder, outloadEndOf } from './outload.js?v=341';

const num = (v) => Number(v) || 0;
const EPS = 1e-9;
const round = (v, dp = 2) => { const f = 10 ** dp; return Math.round(v * f) / f; };

const add = (map, key, tons) => { if (tons > EPS) map.set(key, (map.get(key) || 0) + tons); };
const sum = (map) => [...map.values()].reduce((a, b) => a + b, 0);
const scaled = (map, to) => {
  const total = sum(map);
  const out = new Map();
  if (total <= EPS) return out;
  for (const [k, v] of map) out.set(k, (v * to) / total);
  return out;
};

/**
 * @param {object[]} storages
 * @param {object[]} movements  every movement of the season
 * @returns {Map<string, Map<string, number>>} movement id -> where its grain came from ('field:<id>', 'opening:<storage id>',
 *   'offfarm:<storage id>', 'unknown') and how many tonnes of the load came from each
 */
export function traceLoads(storages, movements) {
  const stacks = new Map();     // silo id -> layers, bottom first: { tons, from: Map }
  const byId = new Map((storages || []).map((s) => [s.id, s]));
  for (const s of storages || []) {
    if (s.offFarm) continue;
    const layers = [];
    if (num(s.openingStock) > EPS) layers.push({ tons: num(s.openingStock), from: new Map([[`opening:${s.id}`, num(s.openingStock)]]) });
    stacks.set(s.id, layers);
  }

  const result = new Map();
  for (const m of inOrder(movements || [])) {
    const pool = new Map();
    for (const leg of m.froms || []) {
      const tons = num(leg.tons);
      if (tons <= EPS) continue;
      if (leg.type === 'field') { add(pool, `field:${leg.id}`, tons); continue; }
      if (leg.type !== 'silo') continue;
      const store = byId.get(leg.id);
      if (!store || store.offFarm) { add(pool, `offfarm:${leg.id}`, tons); continue; }
      const layers = stacks.get(leg.id) || [];
      stacks.set(leg.id, layers);
      const fromBack = outloadEndOf(store) === 'first';
      let want = tons;
      while (want > EPS && layers.length) {
        const at = fromBack ? 0 : layers.length - 1;
        const layer = layers[at];
        const take = Math.min(layer.tons, want);
        for (const [k, v] of scaled(layer.from, take)) add(pool, k, v);
        for (const [k, v] of layer.from) layer.from.set(k, v * (1 - take / layer.tons));
        layer.tons -= take;
        want -= take;
        if (layer.tons <= EPS) layers.splice(at, 1);
      }
      add(pool, 'unknown', want);
    }

    const poolTotal = sum(pool);
    // what the grain arriving at each silo is made of: the load's pool, in proportion
    for (const leg of m.tos || []) {
      const tons = num(leg.tons);
      if (leg.type !== 'silo' || tons <= EPS) continue;
      const store = byId.get(leg.id);
      if (!store || store.offFarm) continue;
      const layers = stacks.get(leg.id) || [];
      stacks.set(leg.id, layers);
      layers.push({ tons, from: poolTotal > EPS ? scaled(pool, tons) : new Map([['unknown', tons]]) });
    }
    // a load's own tonnes is what its legs say; the pool is shown in proportion to that
    const loadTons = num(m.tons) || (m.tos || []).reduce((a, l) => a + num(l.tons), 0) || poolTotal;
    result.set(m.id, poolTotal > EPS ? scaled(pool, loadTons) : new Map());
  }
  return result;
}

/** The words for one load: "Aralu A 1 62.3 t; Opening stock in Silo 2 5 t", biggest first; '' when nothing is known. */
export function traceText(from, { fields = [], storages = [] } = {}) {
  if (!from || !from.size) return '';
  const nameOf = (key) => {
    const [kind, ...rest] = key.split(':');
    const id = rest.join(':');
    if (kind === 'field') {
      const f = fields.find((x) => x.id === id);
      return f ? [f.property, f.name].filter(Boolean).join(' ') : 'A paddock no longer on the list';
    }
    const s = storages.find((x) => x.id === id);
    if (kind === 'opening') return `Opening stock in ${s?.name || 'a silo'}`;
    if (kind === 'offfarm') return `${s?.name || 'An off-farm store'} (off-farm)`;
    return 'Not recorded';
  };
  return [...from.entries()]
    .filter(([, t]) => round(t) > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([k, t]) => `${nameOf(k)} ${round(t)} t`)
    .join('; ');
}
