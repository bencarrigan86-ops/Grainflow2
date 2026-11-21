// Shrink in silos: grain put into a silo from the paddock weighs less than it did on the truck (moisture and dust lost in
// handling and storage). Each commodity has a set percentage (normally 0.7%, sometimes 0.5% or 1%). It comes off the tonnes
// of every load that goes from a paddock into a silo, so the silo's tracked stock is what it really holds, and the same tonnes
// come off the commodity's unsold on Position, shown as their own line.
//
// Only paddock-to-silo loads shrink. Silo to silo, silo to contract and paddock straight to contract do not, and nor does the
// opening stock. Third-party (off-farm) stores, bale and module stores and in-transit grain do not shrink either: their balances
// are kept another way. The percentage is read from the commodity as it is now, so changing it changes the whole season.
//
// The commodity of a load is the load's own, or else the one the paddock it came from is sown to, or else the one the silo it
// went into holds: a load recorded without the Commodity box set still shrinks.
//
// The silo and commodity code are in other modules that cannot see each other, so storage.js hands over the farm's commodities,
// paddocks and storages (the same way the commodity order is handed over) and the sums here read them.

let source = () => ({ commodities: [], fields: [], storages: [] });

/** Where the farm's records come from. storage.js sets this once; tests set their own (a bare list is the commodities). */
export function setShrinkSource(fn) { source = typeof fn === 'function' ? fn : () => ({ commodities: [], fields: [], storages: [] }); }

/**
 * Run `fn` with the records of another season as the source, then put the farm's own back. A season has its own paddock and silo
 * ids, so a load with no commodity set can only be matched to its paddock's or silo's commodity in the records of its own season.
 * (Synchronous on purpose: nothing else can run between the swap and the restore.)
 */
export function withShrinkSource(records, fn) {
  const before = source;
  source = () => ({ commodities: records?.commodities || [], fields: records?.fields || [], storages: records?.storages || [] });
  try { return fn(); } finally { source = before; }
}

/** The records as {commodities, fields, storages}, whatever the source gave. */
function context() {
  const s = source();
  return Array.isArray(s) ? { commodities: s, fields: [], storages: [] } : { commodities: s?.commodities || [], fields: s?.fields || [], storages: s?.storages || [] };
}

/** The commodity's shrink as a fraction (0.007 for 0.7%). Nothing set, or nonsense, is none; more than 25% is taken as 25%. */
export function shrinkFraction(c) {
  const pct = Number(c?.shrinkPct);
  return Number.isFinite(pct) && pct > 0 ? Math.min(pct, 25) / 100 : 0;
}

/** Shrink fractions by commodity id. */
export function shrinkMap(commodities = context().commodities) {
  const out = {};
  for (const c of commodities || []) { const f = shrinkFraction(c); if (f) out[c.id] = f; }
  return out;
}

/** A load shrinks when it comes out of paddocks only (every source is a paddock). */
export const isPaddockLoad = (m) => (m.froms || []).length > 0 && (m.froms || []).every((f) => f.type === 'field');

/** A store the books do not shrink: a third party's, one counted in bales or modules (tally, which includes in transit). */
const noShrinkStore = (s) => !!s && (!!s.offFarm || s.kind === 'tally');

/** The commodity of a load: its own, else its paddock's, else the silo's it went into. */
export function loadCommodityId(m, ctx = context()) {
  if (m.commodityId) return m.commodityId;
  const f = (m.froms || []).find((l) => l.type === 'field');
  const fromField = f ? ctx.fields.find((x) => x.id === f.id)?.commodityId : null;
  if (fromField) return fromField;
  const t = (m.tos || []).find((l) => l.type === 'silo');
  return (t ? ctx.storages.find((x) => x.id === t.id)?.commodityId : null) || null;
}

/** The silos of a load that shrink: every silo leg that is not a third party's or a tally store. */
const shrinkLegs = (m, ctx) => (m.tos || []).filter((t) => t.type === 'silo' && !noShrinkStore(ctx.storages.find((x) => x.id === t.id)));

/** The tonnes lost to shrink on a load going into one silo. */
export function shrinkIntoSilo(m, siloId, map = shrinkMap(), ctx = context()) {
  if (!isPaddockLoad(m)) return 0;
  const f = map[loadCommodityId(m, ctx)];
  if (!f) return 0;
  return shrinkLegs(m, ctx).filter((t) => t.id === siloId).reduce((s, t) => s + (Number(t.tons) || 0), 0) * f;
}

/** The tonnes lost to shrink across every silo a load goes into. */
export function shrinkOnLoad(m, map = shrinkMap(), ctx = context()) {
  if (!isPaddockLoad(m)) return 0;
  const f = map[loadCommodityId(m, ctx)];
  if (!f) return 0;
  return shrinkLegs(m, ctx).reduce((s, t) => s + (Number(t.tons) || 0), 0) * f;
}

/** Shrink so far in one silo. */
export function shrinkInSilo(siloId, movements, map = shrinkMap()) {
  const ctx = context();
  return (movements || []).reduce((s, m) => s + shrinkIntoSilo(m, siloId, map, ctx), 0);
}

/** Shrink so far on one commodity (the percentage comes from `commodity`, as the caller has it). */
export function shrinkForCommodity(commodity, movements) {
  const f = shrinkFraction(commodity);
  if (!f) return 0;
  const map = { [commodity.id]: f };
  const ctx = context();
  return (movements || []).reduce((s, m) => s + (loadCommodityId(m, ctx) === commodity.id ? shrinkOnLoad(m, map, ctx) : 0), 0);
}
