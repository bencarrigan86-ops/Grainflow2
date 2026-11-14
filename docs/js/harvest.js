// How harvest is going: what is in, and what is still to come.
//
// "In" is the tonnes carted off a field, which comes from the load tickets. "To come" is what the field is still
// expected to give: its estimate (area x estimated yield) less what is in, until the field is marked finished, when
// there is nothing more to come whatever the estimate said. A field that has already given more than its estimate
// has nothing more expected from it by the estimate, but it is not called finished until someone says so.
// A part-harvested field can be given the hectares still to cut: what is to come is then those hectares at the field's
// estimated yield, on top of what is already in, whatever the estimate for the whole field said.
//
// Pure apart from the two sums it borrows from derived.js.

import { estimateFieldTons, movementTonsFromField, storageLedgerStock } from './derived.js?v=236';
import { isTransit } from './transit.js?v=236';

/**
 * One field.
 * @returns {{
 *   areaHa: number, estimateT: number, inT: number, toComeT: number, expectedT: number,
 *   pct: number,          0 to 1 of what is expected, 1 when finished
 *   done: boolean, ahead: boolean,   ahead: more in than the estimate, and not finished
 *   yieldSoFar: number    t/ha on the area, from what is in
 * }}
 */
export function fieldHarvest(field, movements) {
  const areaHa = Number(field?.areaHa) || 0;
  const estimateT = estimateFieldTons(field || {});
  const inT = movementTonsFromField(field?.id, movements);
  const done = !!field?.harvestDone;
  // Hectares still to harvest, when the paddock is part done and someone has said how much is left. Blank means not said.
  const left = field?.harvestHaLeft;
  const haLeft = !done && left != null && left !== '' && Number.isFinite(Number(left)) ? Math.min(areaHa, Math.max(0, Number(left))) : null;
  const toComeT = done ? 0 : haLeft !== null ? haLeft * (Number(field?.yieldTHa) || 0) : Math.max(0, estimateT - inT);
  const expectedT = done ? inT : haLeft !== null ? inT + toComeT : Math.max(estimateT, inT);
  const pct = done ? 1 : (expectedT > 0 ? Math.min(1, inT / expectedT) : 0);
  return {
    areaHa, estimateT, inT, toComeT, expectedT, pct, done, haLeft,
    doneHa: done ? areaHa : haLeft !== null ? areaHa - haLeft : 0,
    ahead: !done && haLeft === null && inT > estimateT && estimateT > 0,
    yieldSoFar: areaHa > 0 ? inT / areaHa : 0,
  };
}

/** Totals over a list of {areaHa, estimateT, inT, toComeT, expectedT, done} rows. */
function totalsOf(rows) {
  const t = rows.reduce((a, r) => ({
    fields: a.fields + 1,
    areaHa: a.areaHa + r.areaHa,
    doneHa: a.doneHa + r.doneHa,
    estimateT: a.estimateT + r.estimateT,
    inT: a.inT + r.inT,
    toComeT: a.toComeT + r.toComeT,
    expectedT: a.expectedT + r.expectedT,
    doneFields: a.doneFields + (r.done ? 1 : 0),
  }), { fields: 0, areaHa: 0, doneHa: 0, estimateT: 0, inT: 0, toComeT: 0, expectedT: 0, doneFields: 0 });
  return { ...t, toGoHa: t.areaHa - t.doneHa, pct: t.expectedT > 0 ? Math.min(1, t.inT / t.expectedT) : 0 };
}

/**
 * The report: each commodity with its fields, then the whole farm. Fields with no commodity are grouped last.
 * @returns {{groups: {id: string|null, name: string, rows: object[], totals: object}[], farm: object}}
 */
export function harvestReport(commodities, fields, movements) {
  const groups = [];
  const add = (id, name, list) => {
    if (!list.length) return;
    const rows = list
      .map((f) => ({ field: f, ...fieldHarvest(f, movements) }))
      .sort((a, b) => String(a.field.name).localeCompare(String(b.field.name), undefined, { numeric: true }));
    groups.push({ id, name, rows, totals: totalsOf(rows) });
  };
  for (const c of commodities || []) add(c.id, c.name, (fields || []).filter((f) => f.commodityId === c.id));
  add(null, 'No commodity', (fields || []).filter((f) => !(commodities || []).some((c) => c.id === f.commodityId)));
  const all = groups.flatMap((g) => g.rows);
  return { groups, farm: totalsOf(all) };
}

/** "62%" for a share of 0 to 1; a field that is finished says so. */
export const pctText = (p) => `${Math.round((Number(p) || 0) * 100)}%`;

// Under this many tonnes a silo counts as empty, as a rounding crumb is not grain.
const EMPTY_T = 0.05;

/**
 * The room left in the farm's silos and bunkers, against what is still to come.
 *
 * Room in a silo is its capacity less what is tracked in it now. A silo holding a commodity has room for that
 * commodity (and only that); an empty one, whatever it last held, has room for any grain, so it is counted once, on
 * its own, and not under each commodity. Third-party storage is not counted: its room is not the farm's to know.
 * A silo with no capacity set has no room worked out, and neither does one holding grain with no commodity set; both are
 * named so they can be fixed.
 *
 * @returns {{
 *   byCommodity: Map<string, {room: number, silos: number}>,   room in the silos holding that commodity
 *   emptyRoom: number, emptyCount: number,                       room in empty silos, for any grain
 *   totalRoom: number,                                           everything the farm has free
 *   silos: {id, name, commodityId, capacity, stock, room, empty, pct}[]   each silo counted, most room first
 *   tooSmall: {count, room}                                      silos with less than `minRoom` t free, left out of all of the above
 *   notCounted: string[]                                       silos left out, and why, so they can be fixed
 * }}
 */
export function siloSpace(storages, movements, { minRoom = 0 } = {}) {
  const out = { byCommodity: new Map(), emptyRoom: 0, emptyCount: 0, totalRoom: 0, notCounted: [], silos: [], tooSmall: { count: 0, room: 0 } };
  for (const s of storages || []) {
    if (s.offFarm || isTransit(s) || s.kind === 'tally') continue;
    const capacity = Number(s.capacityTons) || 0;
    if (!(capacity > 0)) { out.notCounted.push(`${s.name} (no capacity set)`); continue; }
    const stock = Math.max(0, storageLedgerStock(s, movements));
    const room = Math.max(0, capacity - stock);
    // a silo with only a little room left is not worth sending a load to, so it is not counted or listed
    if (minRoom > 0 && room < minRoom) { out.tooSmall.count += 1; out.tooSmall.room += room; continue; }
    const empty = stock <= EMPTY_T;
    if (s.commodityId || empty) {
      out.silos.push({ id: s.id, name: s.name, commodityId: s.commodityId || null, capacity, stock, room, empty, pct: Math.min(1, stock / capacity) });
    }
    if (empty) { out.emptyRoom += room; out.emptyCount += 1; }
    else if (s.commodityId) {
      const cur = out.byCommodity.get(s.commodityId) || { room: 0, silos: 0 };
      cur.room += room;
      cur.silos += 1;
      out.byCommodity.set(s.commodityId, cur);
    } else {
      // grain in it with no commodity set: nothing says what may go in, so its room is not counted
      out.notCounted.push(`${s.name} (holds grain, no commodity set)`);
    }
  }
  out.totalRoom = out.emptyRoom + [...out.byCommodity.values()].reduce((a, v) => a + v.room, 0);
  out.silos.sort((a, b) => b.room - a.room || String(a.name).localeCompare(String(b.name), undefined, { numeric: true }));
  return out;
}
