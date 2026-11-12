// A silo that has had loads delivered into it, none of which it has been told the
// commodity of, can say so itself: the loads know what they were. This works out
// which silos can be filled in that way — nothing is changed here.
//
// A silo is filled only when every load that went into it agrees. One that took
// wheat and then barley is reported as mixed and left for the person to choose;
// a guess there would put its stock under the wrong crop.

/** The commodity a load was: its own, or else that of the paddock it came from. */
function commodityOfLoad(m, fieldsById) {
  if (m.commodityId) return m.commodityId;
  for (const f of m.froms || []) {
    if (f.type !== 'field') continue;
    const c = fieldsById.get(f.id)?.commodityId;
    if (c) return c;
  }
  return null;
}

/**
 * @returns {{fills: {storage: object, commodityId: string, loads: number}[],
 *            mixed: {storage: object, commodityIds: string[]}[]}}
 */
import { isTransit } from './transit.js?v=193';

export function commodityFills(storages, movements, fields = []) {
  const fieldsById = new Map(fields.map((f) => [f.id, f]));
  const seen = new Map();   // storage id -> Map(commodity id -> loads)
  for (const m of movements) {
    const c = commodityOfLoad(m, fieldsById);
    if (!c) continue;
    for (const t of m.tos || []) {
      if (t.type !== 'silo') continue;
      if (!seen.has(t.id)) seen.set(t.id, new Map());
      const by = seen.get(t.id);
      by.set(c, (by.get(c) || 0) + 1);
    }
  }
  const fills = [];
  const mixed = [];
  for (const s of storages) {
    if (s.commodityId || isTransit(s)) continue;
    const by = seen.get(s.id);
    if (!by || by.size === 0) continue;
    if (by.size === 1) {
      const [[commodityId, loads]] = [...by.entries()];
      fills.push({ storage: s, commodityId, loads });
    } else {
      mixed.push({ storage: s, commodityIds: [...by.keys()] });
    }
  }
  return { fills, mixed };
}
