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
import { touchesToQueue } from './dirty.js?v=505';

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
    }).catch((e) => {
      // A failed open is not kept: it would answer every later save with the same failure until the app was closed.
      dbPromise = null;
      throw e;
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

/** Which signed-in person the saved copy was last used by (null for a copy saved before this was kept). */
export async function loadOwner() {
  const d = await db();
  return (await d.get('state', 'user')) ?? null;
}
export async function saveOwner(userId) {
  const d = await db();
  await d.put('state', userId ?? null, 'user');
}

/** Take the saved copy off the device, but only when nothing on it is still owed to the server. Returns whether it did. */
export async function clearStateIfSettled() {
  const d = await db();
  if ((await d.count('outbox')) > 0) return false;
  await d.delete('state', 'current');
  await d.delete('state', 'user');
  return true;
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
  // Never on top of an earlier one: the whole point is that nothing set aside
  // is lost, and a second set-aside would otherwise quietly replace the first.
  const key = (await d.get('state', 'set-aside')) ? `set-aside-${Date.now()}` : 'set-aside';
  await d.put('state', { state, farmId, at: Date.now() }, key);
}

export async function loadAsideState() {
  const d = await db();
  return (await d.get('state', 'set-aside')) ?? null;
}

// --- the outbox ------------------------------------------------------------

/**
 * Record what this device has changed and the server has not yet seen.
 *
 * One entry per thing touched — { kind: 'field', id } — and not one flag for
 * the farm. The whole-farm flag was the bug: it told the push to send
 * everything, so a device that was behind sent its stale copy of rows it had
 * never edited, over the top of newer ones. See dirty.js for the kinds.
 *
 * Touching the same thing twice queues it once, EXCEPT when the first entry is already being sent: the row that
 * went up is the copy from before this edit, and the push clears its entry when it finishes, so an edit made
 * meanwhile needs an entry of its own or it is never sent (and the next refresh swaps it away).
 */
let sending = new Set();
/** The outbox entries a running push has taken the rows for (an empty list when none is running). */
export function setSending(seqs = []) { sending = new Set(seqs); }

export async function markDirty(touches = []) {
  if (!touches.length) return;
  const d = await db();
  // read after the await: a push that took its rows while this was waiting must still be seen
  for (const t of touchesToQueue(await d.getAll('outbox'), sending, touches)) {
    await d.add('outbox', { type: 'dirty', kind: t.kind, id: t.id ?? null, at: Date.now() });
  }
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

/**
 * Clear exactly the entries that were sent, by sequence number.
 *
 * Not "everything up to the newest one I saw": entries this push could not act
 * on — the pre-tracking markers, which are resolved at startup, not here —
 * have to survive it, and so does anything queued while the request was in
 * flight.
 */
export async function clearOutboxItems(seqs) {
  const d = await db();
  const tx = d.transaction('outbox', 'readwrite');
  for (const seq of seqs) await tx.store.delete(seq);
  await tx.done;
}

/** Empty the outbox: every change this device owes. Only for "take the server's copy". */
export async function clearOutbox() {
  const d = await db();
  await d.clear('outbox');
}

/** Remove the pre-tracking markers once startup has dealt with them. */
export async function clearLegacyDirty() {
  const d = await db();
  const tx = d.transaction('outbox', 'readwrite');
  let cursor = await tx.store.openCursor();
  while (cursor) {
    if (cursor.value.type === 'dirty' && !cursor.value.kind) await cursor.delete();
    cursor = await cursor.continue();
  }
  await tx.done;
}
