// Reading a farm out of Supabase and into the shape the app expects.
//
// Every table is fetched in parallel and scoped to farm_id. That scoping is
// belt-and-braces — row-level security already guarantees you cannot see
// another farm — but an explicit filter keeps the query fast and makes the
// intent obvious to anyone reading it later.
//
// A denied or missing table yields an empty array rather than an exception.
// That is deliberate and it is the whole point of the split tables: a driver's
// session genuinely cannot read sale_terms, field_agronomy or overheads, so
// hydration has to produce a working state object with those parts simply
// absent. Throwing there would mean the app only runs for owners.

import { supabase } from './supabase.js?v=68';
import { rowsToState } from './mapping.js?v=68';

// Scoped by farm_id; the child tables hang off their parents.
const FARM_SCOPED = [
  'farms', 'seasons', 'commodities', 'fields', 'field_agronomy',
  'storages', 'sales', 'sale_terms', 'movements', 'movement_legs',
  'invoices', 'overheads',
];

async function fetchTable(table, farmId) {
  const column = table === 'farms' ? 'id' : 'farm_id';
  const { data, error } = await supabase
    .from(table)
    .select('*')
    .eq(column, farmId)
    .is('deleted_at', null);

  if (error) {
    // Denied is an expected outcome for the restricted tables, not a fault.
    return { table, rows: [], denied: true, message: error.message };
  }
  return { table, rows: data ?? [], denied: false };
}

/**
 * Every row this user is allowed to see for one farm, keyed by table name.
 * Also returns which tables came back denied, which is useful diagnostically —
 * a driver seeing three denials is the security model working, not a bug.
 */
export async function fetchFarmRows(farmId) {
  const results = await Promise.all(FARM_SCOPED.map((t) => fetchTable(t, farmId)));

  const rows = {};
  const denied = [];
  for (const r of results) {
    rows[r.table] = r.rows;
    if (r.denied) denied.push({ table: r.table, message: r.message });
  }
  return { rows, denied };
}

/**
 * The farm as the app wants it: the same nested {years, businessDetails, …}
 * object storage.js has always held in memory.
 */
export async function hydrate(farmId) {
  const { rows, denied } = await fetchFarmRows(farmId);
  return { state: rowsToState(rows), rows, denied };
}

/** Row counts per table — for diagnostics, not for the app. */
export function summarise(rows) {
  return FARM_SCOPED.map((t) => ({ table: t, count: (rows[t] || []).length }));
}
