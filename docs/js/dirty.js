// Which rows does this device actually owe the server?
//
// The first version of the push sent the whole farm every time. That was
// defensible for one person on one device, and it fails badly the moment there
// are two: a phone that has been in a pocket for a week holds last week's
// yields, and every time it sent, it wrote last week's yields over whatever the
// computer had saved since. Worse, a phone that could not finish — one row
// refused, the push abandoned part way — still overwrote every table it
// reached first, over and over, while never learning anything the other device
// had done.
//
// So a device now sends only what it changed. Every save records which thing
// was touched (a paddock, a contract, a load…) and the push is built from
// exactly those. A row nobody on this device edited is never sent, so a device
// that is behind cannot drag the server back to where it is.
//
// This is a selection over rows the mapping layer already produces, kept apart
// from the push itself so it can be tested without a server.
//
// What is a "kind"? One per thing a person edits, not one per table — a
// contract is a sales row and a terms row and its documents, and they travel
// together:
//
//   commodity  commodities
//   field      fields, field_agronomy
//   storage    storages
//   sale       sales, sale_terms, sale_documents
//   movement   movements, movement_legs, movement_photos
//   invoice    invoices
//   overheads  overheads                       (id = season label)
//   season     the season row itself           (id = season label)
//   year       everything in one season        (id = season label)
//   business   the farm's own details
//   all        everything                      (an import, a brand new farm)

export const KINDS = [
  'commodity', 'field', 'storage', 'sale', 'movement', 'invoice',
  'overheads', 'season', 'year', 'business', 'all',
];

const TABLES = [
  'farms', 'seasons', 'commodities', 'fields', 'field_agronomy', 'storages',
  'sales', 'sale_terms', 'sale_documents', 'movements', 'movement_legs',
  'movement_photos', 'invoices', 'overheads',
];

// child table -> [column holding the parent's id, parent table]
const CHILD_OF = {
  field_agronomy: ['field_id', 'fields'],
  sale_terms: ['sale_id', 'sales'],
  sale_documents: ['sale_id', 'sales'],
  movement_legs: ['movement_id', 'movements'],
  movement_photos: ['movement_id', 'movements'],
};

const OWN_TABLE = {
  commodity: 'commodities', field: 'fields', storage: 'storages', sale: 'sales',
  movement: 'movements', invoice: 'invoices',
};

/**
 * @param {object} rows   what stateToRows() produced: { table: row[] }
 * @param {object} state  the farm as the app holds it (needed to know which
 *                        season row a label stands for)
 * @param {{kind: string, id?: string}[]} dirty
 * @returns {object} the same shape as `rows`, holding only what is owed
 */
export function selectDirtyRows(rows, state, dirty) {
  const out = Object.fromEntries(TABLES.map((t) => [t, []]));
  const list = (dirty || []).filter((d) => d && KINDS.includes(d.kind));
  if (list.some((d) => d.kind === 'all')) {
    for (const t of TABLES) out[t] = [...(rows[t] || [])];
    return out;
  }

  const want = Object.fromEntries(TABLES.map((t) => [t, new Set()]));   // ids of rows to send
  const seasonIdOfLabel = (label) => (rows.seasons || []).find((s) => s.label === label)?.id;

  for (const d of list) {
    if (d.kind === 'business') { (rows.farms || []).forEach((r) => want.farms.add(r.id)); continue; }
    if (d.kind === 'season') {
      const id = seasonIdOfLabel(d.id);
      if (id) want.seasons.add(id);
      continue;
    }
    if (d.kind === 'overheads') {
      const sid = seasonIdOfLabel(d.id);
      (rows.overheads || []).filter((r) => r.season_id === sid).forEach((r) => want.overheads.add(r.id));
      continue;
    }
    if (d.kind === 'year') {
      const sid = seasonIdOfLabel(d.id);
      if (!sid) continue;
      want.seasons.add(sid);
      for (const t of ['commodities', 'fields', 'storages', 'sales', 'movements', 'invoices', 'overheads']) {
        (rows[t] || []).filter((r) => r.season_id === sid).forEach((r) => want[t].add(r.id));
      }
      continue;
    }
    const table = OWN_TABLE[d.kind];
    if (table && d.id) want[table].add(d.id);
  }

  // A parent travels with its children, and a child with its own parent's id.
  for (const [child, [col, parent]] of Object.entries(CHILD_OF)) {
    (rows[child] || []).filter((r) => want[parent].has(r[col])).forEach((r) => want[child].add(r.id));
  }

  for (const t of TABLES) out[t] = (rows[t] || []).filter((r) => want[t].has(r.id));

  // A row whose season the server has never heard of cannot be inserted. A
  // season only needs sending alongside its rows when the app has not yet been
  // told that season's real id (the app mints a fresh one on each pass until it
  // is) — otherwise the server already has it, and re-sending it from a device
  // that might hold an out-of-date label would be exactly the overwrite this
  // file exists to prevent.
  const seasonRows = rows.seasons || [];
  const referenced = new Set();
  for (const t of ['commodities', 'fields', 'storages', 'sales', 'movements', 'invoices', 'overheads']) {
    out[t].forEach((r) => referenced.add(r.season_id));
  }
  for (const s of seasonRows) {
    if (!referenced.has(s.id) || out.seasons.some((x) => x.id === s.id)) continue;
    if (!state?.years?.[s.label]?.__seasonId) out.seasons.push(s);
  }
  return out;
}

/** Anything queued: used to keep the queue from growing a line per keystroke. */
export function touchKey(t) { return `${t.kind}:${t.id ?? ''}`; }

/**
 * An outbox entry from before changes were tracked row by row: a bare "something
 * is dirty" with no record of what. It cannot be turned into rows, and sending
 * the whole farm in its place is the very thing this module replaces — so these
 * are never pushed. They are resolved once, at startup, by resolveLegacy().
 */
export function isLegacyDirty(item) {
  return item?.type === 'dirty' && !item.kind;
}
