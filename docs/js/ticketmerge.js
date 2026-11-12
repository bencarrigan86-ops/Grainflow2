// Two devices change the same ticket.
//
// A ticket goes through several hands: logged in the field, its quality taken at
// the weighbridge, its final weight entered after tipping. Each device saves the
// ticket as a whole. Left alone, a device that was behind would send its old copy of
// the ticket over the top of what another device had just added, and the other
// device's work would be gone without a word.
//
// So before a device sends a ticket it checks whether the server's copy has moved on
// since it last looked. If it has, the two are merged field by field against the copy
// they both started from (a three-way merge):
//
//   - changed on the other device only   -> take the other device's
//   - changed on this device only        -> keep this device's
//   - changed on both, to the same thing -> nothing to decide
//   - changed on both, differently       -> keep this device's, and SAY SO, with both values
//
// The person is always told when the other device's work was combined in, so a
// clash is something they see and check, never something that quietly resolves.
//
// Pure, except `reconcileTickets`, which is handed the means of asking the server.

import { movementFromRow } from './mapping.js';

/** The parts of a ticket that people edit, with the words used for them. */
export const TICKET_FIELDS = [
  ['date', 'Date'], ['commodityId', 'Commodity'], ['truckRego', 'Truck'], ['driver', 'Driver'],
  ['grossWeight', 'Gross weight'], ['tareWeight', 'Tare weight'], ['tons', 'Net load'],
  ['weightStatus', 'Weight status'], ['notes', 'Notes'],
  ['grade', 'Grade'], ['proteinPct', 'Protein'], ['moisturePct', 'Moisture'], ['screeningsPct', 'Screenings'],
  ['testWeightKgHl', 'Test weight'], ['fallingNumber', 'Falling number'],
  ['froms', 'Where it came from'], ['tos', 'Where it went'],
];

const KEYS = TICKET_FIELDS.map(([k]) => k);
const LABEL = Object.fromEntries(TICKET_FIELDS);
// what to call each part in a sentence ("the destination", not "the where it went")
const NOUN = { ...Object.fromEntries(TICKET_FIELDS.map(([k, l]) => [k, l.toLowerCase()])), froms: 'paddock', tos: 'destination' };
const isLegs = (k) => k === 'froms' || k === 'tos';

const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

/** What a field says, for comparing: blank is nothing, numbers are numbers, legs ignore their ids and their order. */
function normal(key, v) {
  if (isLegs(key)) {
    return (v || [])
      .map((l) => ({ type: l.type, id: l.id, tons: Math.round((Number(l.tons) || 0) * 1000) / 1000 }))
      .sort((a, b) => `${a.type}|${a.id}|${a.tons}`.localeCompare(`${b.type}|${b.id}|${b.tons}`));
  }
  if (v === undefined || v === null) return null;
  if (typeof v === 'string') {
    const t = v.trim();
    if (t === '') return null;
    return t !== '' && !Number.isNaN(Number(t)) && !/[a-z]/i.test(t) && !/^\d{4}-/.test(t) ? Number(t) : t;
  }
  if (typeof v === 'number') return Math.round(v * 1e6) / 1e6;
  return v;
}
const same = (key, a, b) => JSON.stringify(normal(key, a)) === JSON.stringify(normal(key, b));

/** A ticket's editable parts as plain values (legs keep their ids, so a merged ticket does not mint new ones). */
export function plainOf(m) {
  const out = {};
  for (const k of KEYS) out[k] = clone(m?.[k]);
  return out;
}

/** Remember what a ticket looked like when the server last agreed with it. */
export function stampBase(m) { m.__base = plainOf(m); return m; }

/**
 * Merge two changed copies of a ticket against the copy they started from.
 *
 * A load from one paddock into one silo has one weight: its paddock and silo figures
 * follow the net load. So for a ticket like that, WHERE it came from and went is merged
 * on its own, and the tonnes on those legs simply follow the merged net load — otherwise
 * a device that only corrected the weight would count as having changed the destination,
 * and would undo another device's choice of silo. A load split or blended across several
 * places is merged as a whole, because only the person knows how it divides.
 *
 * @returns {{values: object, fromTheirs: string[], conflicts: {key: string, ours: any, theirs: any}[], changed: boolean}}
 */
export function mergeTicket(base, ours, theirs) {
  const values = {};
  const fromTheirs = [];
  const conflicts = [];

  const scalar = (k) => {
    const oursChanged = !same(k, ours[k], base[k]);
    const theirsChanged = !same(k, theirs[k], base[k]);
    if (!theirsChanged) values[k] = clone(ours[k]);
    else if (!oursChanged) { values[k] = clone(theirs[k]); if (!same(k, theirs[k], ours[k])) fromTheirs.push(k); }
    else if (same(k, ours[k], theirs[k])) values[k] = clone(ours[k]);
    else { values[k] = clone(ours[k]); conflicts.push({ key: k, ours: clone(ours[k]), theirs: clone(theirs[k]) }); }
  };
  for (const k of KEYS) if (!isLegs(k)) scalar(k);

  const oneOrNone = (legs) => (legs || []).length <= 1;
  const where = (legs) => ((legs && legs[0]) ? `${legs[0].type}|${legs[0].id}` : '');
  for (const k of ['froms', 'tos']) {
    if (!(oneOrNone(base[k]) && oneOrNone(ours[k]) && oneOrNone(theirs[k]))) { scalar(k); continue; }
    const oursChanged = where(ours[k]) !== where(base[k]);
    const theirsChanged = where(theirs[k]) !== where(base[k]);
    let chosen = ours[k];
    if (theirsChanged && !oursChanged) {
      chosen = theirs[k];
      if (where(theirs[k]) !== where(ours[k])) fromTheirs.push(k);
    } else if (theirsChanged && oursChanged && where(ours[k]) !== where(theirs[k])) {
      conflicts.push({ key: k, ours: clone(ours[k]), theirs: clone(theirs[k]) });
    }
    const leg = chosen && chosen[0];
    const tons = values.tons !== undefined && values.tons !== null && values.tons !== '' ? Number(values.tons) : Number(leg?.tons) || 0;
    values[k] = leg ? [{ ...clone(leg), tons }] : [];
  }
  return { values, fromTheirs, conflicts, changed: fromTheirs.length > 0 || conflicts.length > 0 };
}

/** Put merged values onto a ticket. */
export function applyMerged(m, values) {
  for (const k of KEYS) m[k] = clone(values[k]);
  return m;
}

/**
 * Before a device sends tickets: find any whose server copy has moved on, merge them,
 * and report what was combined.
 *
 * Tickets without a remembered base or revision (new on this device, or from before this
 * was tracked) are sent as they always were.
 *
 * @param {object} state  the farm: { years: { <label>: { movements: [...] } } }
 * @param {Set<string>|string[]} ids  tickets this device is about to send
 * @param {{movements: (ids: string[]) => Promise<object[]>, legs: (ids: string[]) => Promise<object[]>}} server
 * @returns {Promise<{id: string, ticketNo: any, fromTheirs: string[], conflicts: object[]}[]>}
 */
export async function reconcileTickets(state, ids, server) {
  const want = new Set(ids);
  const mine = new Map();
  for (const year of Object.values(state?.years || {})) {
    for (const m of year.movements || []) if (want.has(m.id) && m.__rev && m.__base) mine.set(m.id, m);
  }
  if (mine.size === 0) return [];

  const rows = await server.movements([...mine.keys()]);
  const moved = rows.filter((r) => r.updated_at && r.updated_at !== mine.get(r.id)?.__rev);
  if (moved.length === 0) return [];
  const legRows = await server.legs(moved.map((r) => r.id));

  const notices = [];
  for (const row of moved) {
    const m = mine.get(row.id);
    const theirsMovement = movementFromRow(row, legRows.filter((l) => l.movement_id === row.id), null);
    const theirs = plainOf(theirsMovement);
    const merge = mergeTicket(m.__base, plainOf(m), theirs);
    applyMerged(m, merge.values);
    m.__rev = row.updated_at;       // we have now seen this version of the ticket
    m.__base = theirs;              // ...and it is what the two copies now agree on
    if (merge.changed) notices.push({ id: m.id, ticketNo: m.ticketNo, fromTheirs: merge.fromTheirs, conflicts: merge.conflicts });
  }
  return notices;
}

/** A value in words: names for ids, tonnes for weights. */
export function valueText(key, v, ctx = {}) {
  const nameOf = (list, id, fallback) => (list || []).find((x) => x.id === id)?.name ?? fallback;
  if (isLegs(key)) {
    const parts = (v || []).map((l) => {
      const where = l.type === 'field' ? nameOf(ctx.fields, l.id, 'a paddock')
        : l.type === 'sale' ? ((ctx.sales || []).find((s) => s.id === l.id)?.buyer || 'a contract')
          : nameOf(ctx.storages, l.id, 'a silo');
      return `${where} ${Math.round((Number(l.tons) || 0) * 10) / 10} t`;
    });
    return parts.length ? parts.join(' + ') : 'nowhere yet';
  }
  const n = normal(key, v);
  if (n === null) return 'nothing';
  if (key === 'commodityId') return nameOf(ctx.commodities, v, 'a commodity');
  if (key === 'weightStatus') return v === 'final' ? 'Final' : 'Estimate';
  if (['tons', 'grossWeight', 'tareWeight'].includes(key)) return `${n} t`;
  if (['proteinPct', 'moisturePct', 'screeningsPct'].includes(key)) return `${n}%`;
  if (key === 'testWeightKgHl') return `${n} kg/hL`;
  return String(n);
}

/** What to tell the person, in plain words. */
export function describeMerges(notices, ctx = {}) {
  return notices.map((n) => {
    const lines = [`Ticket #${n.ticketNo ?? '?'} was also changed on another device while this one was waiting to send.`];
    if (n.fromTheirs.length) {
      lines.push(`Combined: took the other device's ${n.fromTheirs.map((k) => NOUN[k]).join(', ')}, and kept your other changes.`);
    }
    for (const c of n.conflicts) {
      lines.push(`Both devices changed the ${NOUN[c.key]}. Kept this device's (${valueText(c.key, c.ours, ctx)}); the other device had ${valueText(c.key, c.theirs, ctx)}. Please check it is right.`);
    }
    return lines.join('\n');
  }).join('\n\n');
}
