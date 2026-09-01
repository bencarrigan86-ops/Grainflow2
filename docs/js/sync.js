// Pushing local changes to Supabase.
//
// Not a sync engine, and the distinction matters. There is no conflict
// resolution, no merge, no partial replication — this is one-way durability for
// a single operator: get what is on this device safely onto the server, and
// keep working when there is no signal. Two people editing the same farm
// offline is Phase 3 and PowerSync's problem, not this file's.
//
// The push is a full upsert of the farm rather than a diff. At one operator's
// scale that is a dozen requests of a few hundred rows, debounced — and it is
// far harder to get subtly wrong than a changelog, which is the beginning of
// exactly the machinery we are deferring.

import { supabase } from './supabase.js?v=87';
import { stateToRows } from './mapping.js?v=87';
import { markDirty, markDeleted, outboxItems, clearOutboxUpTo } from './local.js?v=87';
import { flushPendingPhotos } from './photos.js?v=87';

// Parents first — a movement_leg pointing at an absent movement is a foreign
// key violation, and Supabase will reject the whole batch rather than half of it.
//
// `farms` is deliberately absent. A farm row is created once, by create_farm(),
// and has no INSERT policy at all — which is correct, and which means it can
// never be upserted, because an upsert is INSERT ... ON CONFLICT UPDATE and
// Postgres tests the insert policy even when the row already exists. Business
// details are pushed as a plain UPDATE instead, further down.
const ORDER = [
  'seasons', 'commodities', 'fields', 'field_agronomy',
  'storages', 'sales', 'sale_terms', 'movements', 'movement_legs', 'movement_photos',
  'invoices', 'overheads',
];

// What each role is allowed to write, mirroring the RLS policies exactly.
//
// Without this a manager's push would try to insert sales rows, be refused, and
// abort the whole push — their own movements included. Sending only what the
// role can write is not an optimisation; it is the difference between the app
// working for four of the five roles and working for one.
const WRITABLE = {
  owner: ORDER,
  manager: ['seasons', 'commodities', 'fields', 'field_agronomy', 'storages',
            'movements', 'movement_legs', 'movement_photos'],
  bookkeeper: ['sales', 'sale_terms', 'invoices', 'overheads'],
  farm_worker: ['fields', 'field_agronomy', 'movements', 'movement_legs', 'movement_photos'],
  driver: ['movements', 'movement_legs', 'movement_photos'],
};

const CHUNK = 500;

function chunk(list, size = CHUNK) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

let inFlight = null;
let timer = null;

/** Queue a push. Debounced, because saving on every keystroke should not mean
 *  a request on every keystroke. */
export function schedulePush(getState, farmId, role, { delay = 1500 } = {}) {
  markDirty();
  clearTimeout(timer);
  timer = setTimeout(() => { push(getState(), farmId, role); }, delay);
}

export function noteDelete(table, id) {
  return markDeleted(table, id);
}

/**
 * Send everything owed. Safe to call at any time — concurrent calls share the
 * one in-flight promise rather than racing each other into the same tables.
 */
export async function push(state, farmId, role = 'owner') {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    const items = await outboxItems();
    if (items.length === 0) return { skipped: true };

    const maxSeq = Math.max(...items.map((i) => i.seq));
    const deletes = items.filter((i) => i.type === 'delete');
    // Photos first. A movement_photos row pointing at an object that does not
    // exist yet shows every viewer a broken image, so the file goes up before
    // the row that references it. Anything that fails to upload stays a data
    // URL and is retried next push — a photo is the one thing here that cannot
    // be reconstructed.
    if (['owner', 'manager', 'farm_worker', 'driver'].includes(role)) {
      try { await flushPendingPhotos(state, farmId); }
      catch (e) { console.warn('Photo flush deferred', e); }
    }

    const rows = stateToRows(state, farmId);
    const tables = WRITABLE[role] || [];
    const result = { tables: {}, deleted: 0, errors: [], role, skippedTables: [] };

    // Business details: an update, never an upsert. Owners only — for everyone
    // else the farms UPDATE policy refuses, and rightly.
    if (role === 'owner' && rows.farms?.[0]) {
      const { id, ...patch } = rows.farms[0];
      const { error } = await supabase.from('farms').update(patch).eq('id', id);
      if (error) {
        result.errors.push({ table: 'farms', message: error.message });
        return result;
      }
      result.tables.farms = 1;
    }

    for (const table of ORDER) {
      if (!tables.includes(table)) { result.skippedTables.push(table); continue; }
      const list = rows[table] || [];
      if (list.length === 0) continue;
      for (const part of chunk(list)) {
        const { error } = await supabase.from(table).upsert(part, { onConflict: 'id' });
        if (error) {
          // Stop at the first failure and leave the outbox intact. A partial
          // push that reports success is how you end up with a farm that is
          // half on the server and nobody knowing which half.
          //
          // Postgres puts the useful part in details/hint, not message —
          // "bad request" alone tells you nothing about which row or column.
          result.errors.push({
            table,
            message: error.message,
            details: error.details,
            hint: error.hint,
            code: error.code,
            sample: part[0],
          });
          return result;
        }
      }
      result.tables[table] = list.length;
    }

    for (const d of deletes) {
      const { error } = await supabase
        .from(d.table)
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', d.id);
      if (error) {
        result.errors.push({ table: d.table, message: error.message });
        return result;
      }
      result.deleted += 1;
    }

    await clearOutboxUpTo(maxSeq);
    result.ok = true;
    return result;
  })();

  try {
    const out = await inFlight;
    if (out?.errors?.length) {
      window.dispatchEvent(new CustomEvent('grainflow:push-failed', { detail: out }));
    }
    return out;
  } finally {
    inFlight = null;
  }
}

/** Push whenever the device comes back online, and once on load. */
export function pushOnReconnect(getState, farmId, role) {
  const attempt = () => { if (navigator.onLine) push(getState(), farmId, role); };
  window.addEventListener('online', attempt);
  return () => window.removeEventListener('online', attempt);
}

export { ORDER as PUSH_ORDER, WRITABLE, chunk };
