// Reconciling an imported season with the one already on the server.
//
// Split out of storage.js so it can be tested without a browser, a login or a
// server — the same reason boot.js exists. The two most expensive faults in
// this app have both been decisions of this kind: a few lines of implicit
// policy, buried in a function that could not be run in isolation.

/**
 * Make an imported season replace the one already on the server, rather than
 * land beside it.
 *
 * Two things go wrong without this, and the second one is silent.
 *
 * The season row carries a unique constraint on (farm_id, label). A state that
 * came out of a backup file has no __seasonId, so mapping.js mints a fresh one
 * on every push — and the upsert conflicts on `id`, which does not see the
 * clash. Postgres rejects it with 23505, push() stops at the first table, and
 * because `seasons` is first in the order, NOTHING else is ever sent. The farm
 * looks imported, the queue never drains, and every value after that point —
 * paddocks, agronomy, contracts, the lot — has never left the device.
 *
 * And the entities: their ids are reissued by the importer, so without retiring
 * what they replace the farm ends up holding both sets. A hundred and twelve
 * paddocks becomes two hundred and twenty four.
 *
 * Tombstoning the parents is enough. A soft-deleted field never comes back from
 * hydrate, so its agronomy row is unreachable; likewise sale_terms, legs and
 * photos behind their sales and movements.
 */
export function reconcileImport(previous, next, retire) {
  const RETIRE = [
    ['commodities', 'commodities'], ['fields', 'fields'], ['storages', 'storages'],
    ['sales', 'sales'], ['movements', 'movements'], ['invoices', 'invoices'],
  ];
  let retired = 0;

  for (const [label, year] of Object.entries(next.years || {})) {
    const old = previous?.years?.[label];
    if (!old) continue;

    // Keep the ids of the rows that are being updated rather than replaced.
    if (old.__seasonId) year.__seasonId = old.__seasonId;
    if (old.__overheadsId) year.__overheadsId = old.__overheadsId;

    const keep = new Set();
    for (const [, list] of RETIRE) for (const r of year[list] || []) keep.add(r.id);

    for (const [table, list] of RETIRE) {
      for (const r of old[list] || []) {
        if (r?.id && !keep.has(r.id)) { retire(table, r.id); retired += 1; }
      }
    }
  }
  return retired;
}
