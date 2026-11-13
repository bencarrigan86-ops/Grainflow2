// Grain held off the farm, by a third party such as GrainCorp.
//
// An off-farm location is not a silo: it has no shape to measure and no layers to empty from the top. What it
// has is a balance for each commodity and grade. Grain goes in under a grade, comes out under a grade, and the
// balance of that grade is what is left. A truck out of it says which grade it is drawing, and cannot draw more
// than is held.
//
// A location is kept as an ordinary storage record carrying an `offFarm` part: who runs it, and what it held at
// the start of the season by commodity and grade. Loads in and out are ordinary movements to and from it.
//
// Pure, with no imports.

const norm = (g) => String(g ?? '').trim().toLowerCase();
const round3 = (n) => Math.round(n * 1000) / 1000;
const EPS = 0.0005;

/** Is this storage an off-farm location? */
export const isOffFarm = (s) => !!s?.offFarm;

/**
 * An off-farm part as it is saved: the operator trimmed, and the opening holdings each with a commodity,
 * a grade and tonnes above zero, the same commodity and grade added together.
 * @returns {{operator: string, opening: {commodityId: string, grade: string, tons: number}[]}}
 */
export function cleanOffFarm(v) {
  const operator = String(v?.operator ?? '').trim().slice(0, 60);
  const by = new Map();
  for (const o of Array.isArray(v?.opening) ? v.opening : []) {
    const commodityId = String(o?.commodityId ?? '');
    const tons = Number(o?.tons);
    if (!commodityId || !(tons > 0)) continue;
    const key = `${commodityId}|${norm(o?.grade)}`;
    const cur = by.get(key);
    if (cur) cur.tons = round3(cur.tons + tons);
    else by.set(key, { commodityId, grade: String(o?.grade ?? '').trim().slice(0, 40), tons: round3(tons) });
  }
  return { operator, opening: [...by.values()] };
}

/**
 * The commodity a load was, when the ticket does not say: the contract it went to, else the paddock or silo
 * it came from.
 * @param {{fields?: object[], storages?: object[], sales?: object[]}} ctx
 */
export function commodityOfLoad(m, ctx = {}) {
  if (m?.commodityId) return m.commodityId;
  for (const t of m?.tos || []) {
    if (t.type === 'sale') { const s = (ctx.sales || []).find((x) => x.id === t.id); if (s?.commodityId) return s.commodityId; }
  }
  for (const f of m?.froms || []) {
    const pool = f.type === 'field' ? ctx.fields : f.type === 'silo' ? ctx.storages : null;
    const e = (pool || []).find((x) => x.id === f.id);
    if (e?.commodityId) return e.commodityId;
  }
  for (const t of m?.tos || []) {
    if (t.type === 'silo') { const e = (ctx.storages || []).find((x) => x.id === t.id); if (e?.commodityId && !isOffFarm(e)) return e.commodityId; }
  }
  return '';
}

const legTons = (legs, id) => (legs || []).filter((l) => l.type === 'silo' && l.id === id).reduce((a, l) => a + (Number(l.tons) || 0), 0);

/**
 * What a location holds: the opening holdings, plus every load in under its grade, less every load out under its
 * grade. A balance that has gone below zero is kept (it means more was drawn than was recorded going in), so it
 * can be shown rather than hidden.
 * @returns {{commodityId: string, grade: string, tons: number}[]}
 */
export function holdings(location, movements, ctx = {}, { except = '' } = {}) {
  const by = new Map();
  const add = (commodityId, grade, tons) => {
    const key = `${commodityId}|${norm(grade)}`;
    const cur = by.get(key);
    if (cur) cur.tons += tons;
    else by.set(key, { commodityId, grade: String(grade ?? '').trim(), tons });
  };
  for (const o of cleanOffFarm(location?.offFarm).opening) add(o.commodityId, o.grade, o.tons);
  for (const m of movements || []) {
    if (m.id && m.id === except) continue;
    const delta = legTons(m.tos, location.id) - legTons(m.froms, location.id);
    if (delta === 0) continue;
    add(commodityOfLoad(m, ctx), m.grade, delta);
  }
  return [...by.values()]
    .map((h) => ({ ...h, tons: round3(h.tons) }))
    .filter((h) => Math.abs(h.tons) > EPS)
    .sort((a, b) => String(a.commodityId).localeCompare(String(b.commodityId)) || a.grade.localeCompare(b.grade, undefined, { numeric: true }));
}

/** Tonnes of one commodity and grade held. `except` leaves one ticket out, for checking a ticket being edited. */
export function heldOf(location, movements, ctx, commodityId, grade, opts) {
  const key = norm(grade);
  return holdings(location, movements, ctx, opts)
    .filter((h) => h.commodityId === commodityId && norm(h.grade) === key)
    .reduce((a, h) => a + h.tons, 0);
}

/** Does the location hold any of this commodity? */
export const holdsCommodity = (location, movements, ctx, commodityId) =>
  holdings(location, movements, ctx).some((h) => h.commodityId === commodityId && h.tons > EPS);

/** All the tonnes held, every commodity and grade. */
export const totalHeld = (rows) => round3((rows || []).reduce((a, h) => a + h.tons, 0));

/**
 * The off-farm part for a new season: the same operator, and what is held now becomes what it opens with.
 * `idMap` takes last season's commodity ids to this season's; a commodity with no new id is dropped.
 */
export function carryOffFarm(location, movements, ctx, idMap) {
  const opening = holdings(location, movements, ctx)
    .filter((h) => h.tons > EPS && idMap.has(h.commodityId))
    .map((h) => ({ commodityId: idMap.get(h.commodityId), grade: h.grade, tons: h.tons }));
  return cleanOffFarm({ operator: location.offFarm.operator, opening });
}
