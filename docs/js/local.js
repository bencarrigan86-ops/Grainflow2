// Local durability: the working copy of the farm, plus a queue of work owed to
// the server.
//
// IndexedDB rather than localStorage, and that is the point of the whole
// exercise — localStorage caps out around 5MB, holds strings only, and blocks
// the main thread. It is what produced the "device storage may be full" alert
// this app already carries.
//
// Two stores:
//
//   state   — one record, the entire farm as the app holds it in memory. This
//             is what the app reads at boot when there is no signal.
//   outbox  — what still has to reach Supabase. A save marks the state dirty; a
//             delete records a tombstone, because a row removed from an array
//             leaves no trace for a later upsert to find.

import { openDB } from 'https://esm.sh/idb@8';

const DB_NAME = 'grainflow';
const DB_VERSION = 1;

let dbPromise = null;

function db() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(d) {
        if (!d.objectStoreNames.contains('state')) d.createObjectStore('state');
        if (!d.objectStoreNames.contains('outbox')) {
          d.createObjectStore('outbox', { keyPath: 'seq', autoIncrement: true });
        }
      },
    });
  }
  return dbPromise;
}

// --- the working copy ------------------------------------------------------

/**
 * Save the farm, stamped with which farm it is.
 *
 * The stamp matters more than it looks. Without it, a device that has been
 * used for two farms — a contractor, a shared office laptop, or simply
 * somebody testing — holds one anonymous blob, and startup cannot tell whether
 * it belongs to the farm being opened. Get that wrong in one direction and the
 * server overwrites work it has never seen; get it wrong in the other and one
 * farm's records are pushed into another's. Both have happened here.
 */
export async function saveState(state, farmId) {
  const d = await db();
  const tx = d.transaction('state', 'readwrite');
  await tx.store.put(state, 'current');
  if (farmId !== undefined) await tx.store.put(farmId ?? null, 'farm');
  await tx.done;
}

export async function loadState() {
  const d = await db();
  return (await d.get('state', 'current')) ?? null;
}

/** Which farm the saved copy belongs to; null for copies written before this
 *  existed, which is not the same as "no farm" and must not be read as "mine". */
export async function loadFarmStamp() {
  const d = await db();
  return (await d.get('state', 'farm')) ?? null;
}

export async function clearState() {
  const d = await db();
  await d.delete('state', 'current');
}

/**
 * Move a state out of the way instead of overwriting it.
 *
 * Used when the device is holding unsent changes for a different farm than the
 * one being opened. Adopting them would push one farm's records into another;
 * overwriting them would destroy work that has never reached a server. So they
 * are set aside under their own key, and the app says so out loud.
 */
export async function setAsideState(state, farmId) {
  const d = await db();
  await d.put('state', { state, farmId, at: Date.now() }, 'set-aside');
}

export async function loadAsideState() {
  const d = await db();
  return (await d.get('state', 'set-aside')) ?? null;
}

// --- the outbox ------------------------------------------------------------

/**
 * Mark the farm as having unsent changes. Deliberately one flag rather than a
 * per-field changelog: at single-operator scale a full upsert of a farm is a
 * dozen requests, and a changelog is the beginning of a sync engine we have
 * good reasons not to build until Phase 3.
 */
export async function markDirty() {
  const d = await db();
  const existing = await d.getAll('outbox');
  if (existing.some((o) => o.type === 'dirty')) return;
  await d.add('outbox', { type: 'dirty', at: Date.now() });
}

/**
 * Record that a row was removed. Necessary because deletes are soft — the row
 * has to be found on the server and stamped, and once it is gone from the
 * in-memory arrays nothing else knows it ever existed.
 */
export async function markDeleted(table, id) {
  const d = await db();
  await d.add('outbox', { type: 'delete', table, id, at: Date.now() });
}

export async function outboxItems() {
  const d = await db();
  return d.getAll('outbox');
}

export async function outboxCount() {
  const d = await db();
  return d.count('outbox');
}

/** Clear only what we actually sent — anything queued mid-flight survives. */
export async function clearOutboxUpTo(maxSeq) {
  const d = await db();
  const tx = d.transaction('outbox', 'readwrite');
  let cursor = await tx.store.openCursor();
  while (cursor) {
    if (cursor.value.seq <= maxSeq) await cursor.delete();
    cursor = await cursor.continue();
  }
  await tx.done;
}
