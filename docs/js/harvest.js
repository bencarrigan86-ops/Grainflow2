// How harvest is going: what is in, and what is still to come.
//
// "In" is the tonnes carted off a field, which comes from the load tickets. "To come" is what the field is still
// expected to give: its estimate (area x estimated yield) less what is in, until the field is marked finished, when
// there is nothing more to come whatever the estimate said. A field that has already given more than its estimate
// has nothing more expected from it by the estimate, but it is not called finished until someone says so.
// A part-harvested field can be given the hectares still to cut: what is to come is then those hectares at the field's
// estimated yield (or at a yield of their own, when one is given for them), on top of what is already in, whatever the estimate for the
// whole field said.
//
// Pure apart from the two sums it borrows from derived.js.

import { estimateFieldTons, movementTonsFromField, storageLedgerStock, bigFirst } from './derived.js?v=387';
import { isTransit } from './transit.js?v=387';
import { capacityInfo, commodityOf } from './storagecapacity.js?v=387';
import { harvestSeasonOf, HARVEST_SEASONS } from './harvestseason.js?v=387';

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
  // The hectares left can be expected to yield differently from the rest (the best ground is often cut first), so they may be given a yield
  // of their own. Blank means the paddock's own estimate.
  const leftYield = Number(field?.harvestLeftYield) > 0 ? Number(field.harvestLeftYield) : (Number(field?.yieldTHa) || 0);
  const toComeT = done ? 0 : haLeft !== null ? haLeft * leftYield : Math.max(0, estimateT - inT);
  const expectedT = done ? inT : haLeft !== null ? inT + toComeT : Math.max(estimateT, inT);
  const pct = done ? 1 : (expectedT > 0 ? Math.min(1, inT / expectedT) : 0);
  return {
    areaHa, estimateT, inT, toComeT, expectedT, pct, done, haLeft, leftYield,
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
 * `seasons` reads the same fields by when they are harvested (see harvestseason.js): winter crops, summer crops, and any commodity the
 * list does not know as other. Only seasons that have a paddock are listed.
 * @returns {{groups: {id: string|null, name: string, rows: object[], totals: object}[], farm: object,
 *   seasons: {key: string, label: string, names: string[], totals: object}[]}}
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
  groups.sort(bigFirst((g) => g.totals.expectedT));   // the commodity with the most tonnes first; fields with no commodity stay last
  add(null, 'No commodity', (fields || []).filter((f) => !(commodities || []).some((c) => c.id === f.commodityId)));
  const all = groups.flatMap((g) => g.rows);
  const seasons = HARVEST_SEASONS.map(({ key, label }) => {
    const of = groups.filter((g) => (g.id ? harvestSeasonOf((commodities || []).find((c) => c.id === g.id) || g.name) : 'other') === key);
    return { key, label, names: of.map((g) => g.name), ids: of.map((g) => g.id), totals: totalsOf(of.flatMap((g) => g.rows)) };
  }).filter((s) => s.totals.fields > 0);
  return { groups, farm: totalsOf(all), seasons };
}

/** "62%" for a share of 0 to 1; a field that is finished says so. */
export const pctText = (p) => `${Math.round((Number(p) || 0) * 100)}%`;

// Under this many tonnes a silo counts as empty, as a rounding crumb is not grain.
const EMPTY_T = 0.05;

/**
 * The room in silos already holding a commodity, crop by crop, set against what is still to come of that crop. Room in a barley silo only
 * helps barley, so 100 t of it is no use when there is no barley left to cut, and the total is misleading if it is lumped in with the rest.
 *
 * Each row is a commodity with room in its silos, or with something still to come: `room` and `silos` (from siloSpace), `toComeT` and
 * `toGoHa` (from the harvest groups), `finished` (no hectares left to cut, so nothing more to come, whatever the estimate says),
 * `space` (its room less what is still to come, negative when short), `short` (what is still to come beyond the room it has, 0 if none) and `unusable` (room beyond what is still to come, which only that
 * commodity could take). Empty silos take any grain, so they are what covers a `short`.
 *
 *   shortfall = what the empty silos have to cover, `unusable` = room that cannot help, `margin` = empty room less shortfall
 *   (and equals totalRoom - unusable - still to come).
 *
 * Each row also lists its own silos (`list`, most room first), and `empty` lists the empty ones, so the report can show a crop's heading
 * with all the silos for it underneath.
 *
 * @returns {{rows: {id: string|null, name: string, room: number, silos: number, list: object[], toComeT: number, toGoHa: number,
 *   finished: boolean, short: number, unusable: number}[], empty: object[], shortfall: number, unusable: number, margin: number}}
 */
export function roomSplit(space, groups, nameOf = () => '') {
  const byId = new Map();
  for (const g of groups || []) byId.set(g.id || null, g);
  const rows = [];
  const seen = new Set();
  const addRow = (id, own) => {
    const g = byId.get(id);
    const toGoHa = g ? Math.max(0, g.totals.toGoHa) : 0;
    const finished = !g || toGoHa <= 0.05;
    // nothing more to come: every hectare is cut, or (with estimates to go by) the estimate is all in already
    const nothingToCome = finished || (g.totals.expectedT > 0 && g.totals.toComeT <= 0.5);
    const toComeT = nothingToCome ? 0 : Math.max(0, g.totals.toComeT);
    const room = own ? own.room : 0;
    rows.push({
      id, name: g ? g.name : nameOf(id), room, silos: own ? own.silos : 0,
      list: (space?.silos || []).filter((s) => !s.empty && s.commodityId === id), toComeT, toGoHa, finished, nothingToCome,
      short: Math.max(0, toComeT - room), unusable: Math.max(0, room - toComeT), space: room - toComeT,
    });
    seen.add(id);
  };
  for (const [id, own] of space?.byCommodity || []) addRow(id, own);
  // a crop still to come with no silo holding it, and a paddock with no commodity set, are all short until the empty silos are counted
  for (const g of groups || []) {
    if (seen.has(g.id || null) || g.totals.toGoHa <= 0.05 || !(g.totals.toComeT > 0.5)) continue;
    addRow(g.id || null, null);
  }
  rows.sort((a, b) => b.room - a.room || String(a.name).localeCompare(String(b.name), undefined, { numeric: true }));
  const shortfall = rows.reduce((a, r) => a + r.short, 0);
  const unusable = rows.reduce((a, r) => a + r.unusable, 0);
  const empty = (space?.silos || []).filter((s) => s.empty);
  return { rows, empty, shortfall, unusable, margin: (space?.emptyRoom || 0) - shortfall };
}

/**
 * The room left in the farm's silos and bunkers, against what is still to come.
 *
 * Room in a silo is its capacity less what is tracked in it now. A silo holding a commodity has room for that
 * commodity (and only that); an empty one, whatever it last held, has room for any grain, so it is counted once, on
 * its own, and not under each commodity. Third-party storage is not counted: its room is not the farm's to know.
 * Capacity is the silo's volume times the test weight of what is in it when it has a volume (see storagecapacity.js), otherwise the
 * tonnes typed on it. A silo with no capacity set has no room worked out, and neither does one holding grain with no commodity set; both are
 * named so they can be fixed.
 *
 * With `season` ('winter' or 'summer') only the room for that season's crops is counted: silos holding the other season's crop are left
 * out, and empty silos count in full (so in both seasons' views, and once in the whole-farm one).
 *
 * An empty silo with a volume but no commodity is worked out as the commodity given in `assume` (a commodity record, or null), and flagged
 * `assumed`; `needsCommodity` counts those silos so the report knows whether to offer the choice.
 *
 * @returns {{
 *   byCommodity: Map<string, {room: number, silos: number}>,   room in the silos holding that commodity
 *   emptyRoom: number, emptyCount: number,                       room in empty silos, for any grain
 *   totalRoom: number,                                           everything the farm has free
 *   silos: {id, name, commodityId, capacity, stock, room, empty, assumed, pct}[]   each silo counted, most room first
 *   tooSmall: {count, room}                                      silos with less than `minRoom` t free, left out of all of the above
 *   notCounted: string[]                                       silos left out, and why, so they can be fixed
 * }}
 */
export function siloSpace(storages, movements, { minRoom = 0, commodities = [], assume = null, season = null } = {}) {
  const out = { byCommodity: new Map(), emptyRoom: 0, emptyCount: 0, totalRoom: 0, notCounted: [], silos: [], tooSmall: { count: 0, room: 0 }, needsCommodity: 0, assumeName: assume?.name || '' };
  for (const s of storages || []) {
    if (s.offFarm || isTransit(s) || s.kind === 'tally') continue;
    const stock = Math.max(0, storageLedgerStock(s, movements));
    const empty = stock <= EMPTY_T;
    // Looking at one season: a silo holding a crop of the other season is not room for this one. An empty silo takes either.
    if ((season === 'winter' || season === 'summer') && s.commodityId && !empty) {
      const held = commodityOf(s, commodities);
      if (held && harvestSeasonOf(held) !== season) continue;
    }
    // An empty silo with nothing set to go in it has a volume but no test weight to turn it into tonnes. Rather than leave it out, it is
    // worked out as the commodity chosen in `assume` (the report lets the person pick), and counted as such.
    const open = !s.commodityId && empty;
    if (open && Number(s.volumeM3) > 0 && !(Number(s.testWeight) > 0)) out.needsCommodity += 1;
    // from its volume and what is in it when it has a volume, otherwise the tonnes typed on it
    const info = capacityInfo(s, commodityOf(s, commodities) || (open ? assume : null));
    const capacity = info.tons;
    if (!(capacity > 0)) {
      out.notCounted.push(`${s.name} (${open && Number(s.volumeM3) > 0 ? 'has a volume but no commodity to work the tonnes from' : 'no capacity set'})`);
      continue;
    }
    const assumed = open && !!assume && info.source === 'volume' && info.testWeightSource === 'commodity';
    const room = Math.max(0, capacity - stock);
    // a silo with only a little room left is not worth sending a load to, so it is not counted or listed
    if (minRoom > 0 && room < minRoom) { out.tooSmall.count += 1; out.tooSmall.room += room; continue; }
    if (s.commodityId || empty) {
      out.silos.push({ id: s.id, name: s.name, commodityId: s.commodityId || null, capacity, stock, room, empty, assumed, pct: Math.min(1, stock / capacity) });
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
