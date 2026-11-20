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

import { supabase } from './supabase.js?v=451';
import { rowsToState } from './mapping.js?v=451';
import { stampBase } from './ticketmerge.js?v=451';
import { readAllPages } from './pages.js?v=451';

// Scoped by farm_id; the child tables hang off their parents. Everything a push writes has to be read back
// here too (tests/hydrate.test.mjs checks it): movement_photos was missing, so photos were uploaded and then
// never loaded again, and vanished from a ticket the next time the app refreshed from the server.
const FARM_SCOPED = [
  'farms', 'seasons', 'commodities', 'fields', 'field_agronomy',
  'storages', 'sales', 'sale_terms', 'sale_documents', 'movements', 'movement_legs', 'movement_photos',
  'invoices', 'overheads', 'payables', 'orders', 'freight_orders', 'input_stock', 'spray_jobs', 'record_documents',
  'farm_bank',                                // bank details: only the owner and the bookkeeper are sent a row
];

async function fetchTable(table, farmId, role) {
  const column = table === 'farms' ? 'id' : 'farm_id';
  // A farm worker is not sent the prices: stock comes through a function that blanks them. Until the database has
  // that function the plain read is tried, which gives a worker only the entries with no price on them.
  if (table === 'input_stock' && role === 'farm_worker') {
    const viaFunction = await readAllPages(() => supabase.rpc('input_stock_for_worker', { p_farm_id: farmId }, { count: 'exact' }));
    if (!viaFunction.error) return { table, rows: viaFunction.data ?? [], denied: false };
  }
  const build = () => {
    const query = supabase.from(table).select('*', { count: 'exact' }).eq(column, farmId);
    return table !== 'farm_bank' ? query.is('deleted_at', null) : query;   // the bank row has no deleted_at
  };
  // The bank row is one row with no id column. Every other table is read a page at a time, because the server
  // stops at 1,000 rows without saying so, and a farm's loads and their legs are more than that.
  const { data, error } = table === 'farm_bank' ? await build() : await readAllPages(build);

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
export async function fetchFarmRows(farmId, role = null) {
  const results = await Promise.all(FARM_SCOPED.map((t) => fetchTable(t, farmId, role)));

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
export async function hydrate(farmId, role = null) {
  const { rows, denied } = await fetchFarmRows(farmId, role);
  const state = rowsToState(rows);
  // Each ticket remembers what it looked like when the server last agreed with it, so a
  // later send can tell which parts this device changed and which another device did.
  for (const year of Object.values(state.years || {})) for (const m of year.movements || []) stampBase(m);
  return { state, rows, denied };
}

/** Row counts per table — for diagnostics, not for the app. */
export function summarise(rows) {
  return FARM_SCOPED.map((t) => ({ table: t, count: (rows[t] || []).length }));
}
