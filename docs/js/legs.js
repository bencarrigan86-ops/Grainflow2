// The legs of a load — where it came from, where it went — are rows of their own
// on the server, and a row needs an id that stays the same every time it is sent.
//
// A leg without one is given a new random id at every push, so the server keeps
// every earlier copy and the load comes back with two, three, four times the legs
// it had: a 30 t load "from A5 30 t, from A5 30 t, to A10 Silo 30 t, to A10 Silo
// 30 t", and every silo reading double. This file is the rule that stops that,
// and the repair for loads already carrying copies.
//
// Pure: it returns what to keep and which ids to retire; the caller records the
// retirements.

/**
 * Give every leg of `next` a stable id: the id of the matching leg in `prev`
 * when the same paddock/silo/contract is still there, a new one otherwise.
 *
 * @param {object[]} prev  the legs as they were (may be empty)
 * @param {object[]} next  the legs as they are now
 * @param {() => string} makeId
 * @returns {{legs: object[], retired: string[]}}  retired = ids of old legs no longer present
 */
export function settleLegs(prev, next, makeId) {
  const pool = (prev || []).filter((p) => p.__legId);
  const legs = (next || []).map((l) => {
    if (l.__legId) {
      const i = pool.findIndex((p) => p.__legId === l.__legId);
      if (i >= 0) pool.splice(i, 1);
      return l;
    }
    const i = pool.findIndex((p) => p.type === l.type && p.id === l.id);
    if (i >= 0) {
      const [p] = pool.splice(i, 1);
      return { ...l, __legId: p.__legId };
    }
    return { ...l, __legId: makeId() };
  });
  return { legs, retired: pool.map((p) => p.__legId) };
}

const sum = (legs) => legs.reduce((a, l) => a + (Number(l.tons) || 0), 0);

/**
 * Take the copies out of a load's legs. Only when the evidence is plain: one side
 * of the load adds up to more than the load itself, and removing exact copies
 * (same paddock/silo, same tonnes) brings it back to the load's weight. A genuine
 * load of two equal parts from one place adds up to its own weight and is left
 * alone.
 *
 * @returns {{froms: object[], tos: object[], retired: string[], changed: boolean}}
 */
export function dedupeLegs(m) {
  const retired = [];
  const tons = Number(m.tons) || 0;
  const side = (legs) => {
    legs = legs || [];
    if (legs.length < 2 || tons <= 0 || sum(legs) <= tons + 0.01) return legs;
    const seen = new Set();
    const keep = [];
    const dropped = [];
    for (const l of legs) {
      const key = `${l.type}|${l.id}|${Number(l.tons) || 0}`;
      if (seen.has(key)) { dropped.push(l); continue; }
      seen.add(key);
      keep.push(l);
    }
    // Believe it only if taking the copies out leaves the side no heavier than the load.
    if (sum(keep) > tons + 0.01) return legs;
    for (const l of dropped) if (l.__legId) retired.push(l.__legId);
    return keep;
  };
  const froms = side(m.froms);
  const tos = side(m.tos);
  return {
    froms, tos, retired,
    changed: froms.length !== (m.froms || []).length || tos.length !== (m.tos || []).length,
  };
}
