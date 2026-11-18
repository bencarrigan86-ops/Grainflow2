// The farm, in memory, backed by IndexedDB and pushed to Supabase.
//
// The exported `db` object is deliberately identical to the localStorage
// version it replaces. db.get() is still synchronous and still returns the
// current season; every upsert and delete has the same name and signature.
// That is the whole design: none of the eight views in js/views/ changed by a
// single character to get here, and none of them will change again at Phase 3
// when PowerSync replaces the layer underneath.
//
// What did change is where the bytes live:
//
//   memory      the working copy the views read, synchronously, always
//   IndexedDB   the durable local copy — survives a refresh, works with no
//               signal, and has none of localStorage's 5MB ceiling
//   Supabase    the server, reached by a debounced background push
//
// Boot order matters. db.init() hydrates from the server when there is signal
// and falls back to IndexedDB when there is not, so the app opens with real
// data in a paddock as readily as at a desk.

import { hydrate } from './hydrate.js?v=373';
import { setBrandLogo } from './brand.js?v=373';
import {
  saveState, loadState, markDeleted, markDirty, outboxItems, clearLegacyDirty,
  loadFarmStamp, setAsideState, clearOutbox, clearState,
} from './local.js?v=373';
import { chooseBootState, resolveLegacy, canOpenFromDevice } from './boot.js?v=373';
import { isLegacyDirty } from './dirty.js?v=373';
import { mergeFieldRecords, repointLoads } from './merge.js?v=373';
import { lineupGroups, lineupSeason, groupsForSeason, copyOutlines } from './lineup.js?v=373';
import { hasDeductions } from './deductions.js?v=373';
import { hasGin, hasCotton, hasModules } from './ginning.js?v=373';
import { hasHay, hasHayLoad } from './hay.js?v=373';
import { hasStorageQuality, hasStorageNote, hasLoadQuality, hasGradeBands, hasFumigations } from './mapping.js?v=373';
import { settleLegs, dedupeLegs } from './legs.js?v=373';
import { isTransit, transitFor, transitName, TRANSIT_LABEL } from './transit.js?v=373';
import { nextNoteNo, applyAdjustment, withoutAdjustment, isAdjustment } from './adjustment.js?v=373';
import { isOffFarm, carryOffFarm } from './offfarm.js?v=373';
import { setCommodityOrder } from './commodityorder.js?v=373';
import { seasonYY, nextOutloadNo } from './outloadno.js?v=373';
import { buildCarriedSale, carriedIntoNote, appendNote } from './carryover.js?v=373';
import { reconcileImport, adoptServerIds } from './reconcile.js?v=373';
import { schedulePush, pushOnReconnect } from './sync.js?v=373';
import { hasParts as hasAddressParts } from './address.js?v=373';
import { prepareImport, DEFAULT_OVERHEADS, DEFAULT_BUSINESS_DETAILS } from './import.js?v=373';

// Primary keys are UUIDs now, not the old short ids — a phone with no signal
// has to mint an id no server has ever seen, without risk of collision.
export function uid() {
  return crypto.randomUUID();
}

function defaultCommodities() {
  return [
    { name: 'Wheat', angleOfRepose: 24, testWeight: 0.82, nPerTonne: 44 },
    { name: 'Barley', angleOfRepose: 27, testWeight: 0.69, nPerTonne: 34 },
    { name: 'Chickpeas', angleOfRepose: 28, testWeight: 0.76, nPerTonne: 35 },
    { name: 'Faba Beans', angleOfRepose: 25, testWeight: 0.785, nPerTonne: 40 },
    { name: 'Canola', angleOfRepose: 26, testWeight: 0.67, nPerTonne: 0 },
    { name: 'Sorghum', angleOfRepose: 24, testWeight: 0.77, nPerTonne: 0 },
    { name: 'Fallow', angleOfRepose: 0, testWeight: 0, nPerTonne: 0 },
  ].map((c) => ({
    id: uid(), mtmPrice: 0, openingStock: 0, retainedSeed: 0, grossMarginCost: 0, ...c,
  }));
}

// Defined in import.js and imported here, not restated. Two copies of the same
// field list in two files is how the schema ended up accepting 'level' for a
// fill state the app has never written.
function defaultOverheads() {
  return { ...DEFAULT_OVERHEADS };
}

function defaultYear() {
  return {
    commodities: defaultCommodities(), fields: [], sales: [], storages: [],
    movements: [], overheads: defaultOverheads(), invoices: [], payables: [], orders: [], freightOrders: [], inputStock: [], sprayJobs: [],
  };
}

function defaultBusinessDetails() {
  return { ...DEFAULT_BUSINESS_DETAILS };
}

function defaultData() {
  const year = String(new Date().getFullYear());
  return {
    version: 2, currentYear: year, years: { [year]: defaultYear() },
    businessDetails: defaultBusinessDetails(),
    nextMovementNo: 1, nextInvoiceNo: 1,
  };
}

/**
 * Ticket and invoice numbers are derived from what already exists rather than
 * carried in a counter. A counter hydrated from the server can be stale or
 * missing; max()+1 cannot, and it is self-correcting if a number is ever
 * skipped. Proper block leasing across devices arrives at step 1.5.
 */
/**
 * A load whose legs were sent with a new id each time comes back with copies of
 * them, and every silo it touched reads double. Take the copies out, retire them
 * on the server, and make sure every leg that is left has an id it will keep.
 */
let legRepairs = 0;   // how many loads were mended since last counted; startup saves the mended copy
function repairLegs(m) {
  const fixed = dedupeLegs(m);
  if (fixed.changed) {
    legRepairs += 1;
    m.froms = fixed.froms;
    m.tos = fixed.tos;
    fixed.retired.forEach((id) => tombstone('movement_legs', id));
  }
  if ((m.froms || []).some((l) => !l.__legId)) { m.froms = settleLegs([], m.froms, uid).legs; legRepairs += 1; }
  if ((m.tos || []).some((l) => !l.__legId)) { m.tos = settleLegs([], m.tos, uid).legs; legRepairs += 1; }
}

function deriveCounters(state) {
  let maxTicket = 0;
  let maxInvoice = 0;
  for (const year of Object.values(state.years || {})) {
    for (const m of year.movements || []) {
      if (Number(m.ticketNo) > maxTicket) maxTicket = Number(m.ticketNo);
      repairLegs(m);
    }
    for (const inv of year.invoices || []) {
      if (Number(inv.invoiceNo) > maxInvoice) maxInvoice = Number(inv.invoiceNo);
    }
  }
  state.nextMovementNo = maxTicket + 1;
  state.nextInvoiceNo = maxInvoice + 1;
  return state;
}

// ---------------------------------------------------------------------------

let data = defaultData();
/** The farm's commodity order is read by the sorts in derived.js, so whenever the data is swapped or its details change it is handed over. */
const shareOrder = () => setCommodityOrder(data.businessDetails?.commodityOrder);
let farmId = null;
let role = 'owner';
let outloadSeries = null;   // this person's digit for outload numbers, as the server gave it (null until known)
let ready = false;

const listeners = new Set();

// What the save in progress has changed. Filled by the mutators just before they
// call persist(), which hands it to the push and empties it. This is what lets a
// push send only what this device edited — see dirty.js for why that matters.
let touched = [];

// Bumped by every save, synchronously. refreshFromServer() compares it before and
// after its network call: if it moved, somebody edited while it was away, and
// what it fetched is already out of date.
let localEdits = 0;
// Whether startup opened from this device's own copy without waiting for the server (so the server is still to be read).
let openedFromDevice = false;
let refreshing = false;
function touch(kind, id) { touched.push(id === undefined ? { kind } : { kind, id }); }

/** Once an oil figure has been recorded, keep sending the column, so clearing it reaches the server (see mapping.js). */
function markOil(rec) {
  if (rec.oilPct !== null && rec.oilPct !== undefined && rec.oilPct !== '' && Number.isFinite(Number(rec.oilPct))) rec.__hasOil = true;
  if (rec.retentionPct !== null && rec.retentionPct !== undefined && rec.retentionPct !== '' && Number.isFinite(Number(rec.retentionPct))) rec.__hasRetention = true;
  if (rec.ffaPct !== null && rec.ffaPct !== undefined && rec.ffaPct !== '' && Number.isFinite(Number(rec.ffaPct))) rec.__hasFfa = true;
  // the same for a ticket's own number from the receiving site
  if (rec.externalTicketNo) rec.__hasExtTicket = true;
  // and the number quoted at the site
  if (rec.outloadNo) rec.__hasOutloadNo = true;
  // and our own manual docket number
  if (rec.manualDocketNo) rec.__hasManualDocket = true;
  // and any deductions taken off its price
  if (hasDeductions(rec)) rec.__hasDeductions = true;
  // and a cotton ginning run
  if (hasGin(rec)) rec.__hasGin = true;
  if (hasModules(rec)) rec.__hasModules = true;
  // and the bales on a load of hay
  if (hasHayLoad(rec)) rec.__hasHayLoad = true;
  // and the time of day it was loaded
  if (rec.loadTime) rec.__hasLoadTime = true;
  // and where it is going, typed on the load
  if (rec.destination) rec.__hasDestination = true;
  // and the order it was delivered against, so taking a load off an order reaches the server
  if (rec.orderId) rec.__hasOrderId = true;
  // and the freight order it was carted on (a carrier's bill carries the same flag)
  if (rec.freightOrderId) rec.__hasFreightOrderId = true;
}

/** What this device owes the server, not counting pre-tracking markers (which
 *  cannot be sent, and are settled once at startup). */
async function owedCount() {
  const items = await outboxItems().catch(() => []);
  return items.filter((i) => !isLegacyDirty(i)).length;
}

function current() {
  return data.years[data.currentYear];
}

/**
 * Save. Memory first so the interface stays instant, then IndexedDB so it
 * survives the app closing, then a debounced push to the server.
 *
 * Note the ordering: the local write is awaited by nobody. A grower tapping
 * save should never wait on a disk or a network, and if the tab dies between
 * the memory write and the disk write they lose one edit, not the season.
 */
function persist() {
  localEdits += 1;
  const touches = touched;
  touched = [];
  // The local write is unconditional, and that is the fix for the worst bug
  // this app has had. It used to sit behind `if (ready)` — ready meaning
  // db.init() had finished, which needs the server — so before the app had
  // talked to Supabase, every save silently did nothing while the screen
  // redrew as though it had worked. An entire imported season was accepted,
  // counted back, displayed, and never written.
  //
  // Nothing about durability on this device should depend on a network. That
  // is the whole premise of the app: it has to work in a paddock.
  saveState(data, farmId).catch((e) => {
    console.error('LOCAL SAVE FAILED — this change exists only in this tab', e);
    window.dispatchEvent(new CustomEvent('grainflow:save-failed', { detail: { error: String(e) } }));
  });

  // The push is a different question, and it does need to know where the data
  // goes. With no farm yet, the work is still recorded as owed so it leaves on
  // the first push after signing in, rather than being forgotten.
  // Support looks and does not change: nothing a support login does on screen is ever queued for the server.
  if (role === 'support') { /* read only */ }
  else if (farmId) schedulePush(() => data, farmId, role, { touches });
  else markDirty(touches).catch((e) => console.error('Could not queue for the server', e));
  // A view that throws while re-rendering must not take the write down with
  // it. The save has already happened by this point; letting the exception out
  // makes the caller believe it failed and, worse, report a rendering fault as
  // whatever the caller was doing at the time. The import reported a missing
  // `overheads` key as "Import refused" for exactly this reason — the season
  // had in fact been written.
  listeners.forEach((fn) => {
    try {
      fn(data);
    } catch (e) {
      console.error('A view failed to re-render after a change', e);
    }
  });
}

// A push that fails quietly is worse than one that fails loudly: the app looks
// like it saved, the row is only on this device, and the first anyone knows is
// when a second device does not show it.
let lastPushError = null;

window.addEventListener('grainflow:push-ok', () => {
  lastPushError = null;
  // a send updates what each ticket remembers of the server's copy; keep that
  saveState(data, farmId).catch((e) => console.error('Local save failed', e));
});

// Tickets were combined with another device's changes: keep the result, and redraw.
window.addEventListener('grainflow:merged', () => {
  saveState(data, farmId).catch((e) => console.error('Local save failed', e));
  listeners.forEach((fn) => { try { fn(data); } catch (e) { console.error('A view failed to re-render after a merge', e); } });
});

window.addEventListener('grainflow:push-failed', (e) => {
  const { table, message, details, hint, code, sample, refused } = e.detail?.errors?.[0] || {};
  // Kept, not just logged. A console is not reachable on a phone, and this is
  // exactly the fault a phone hits: seven changes owed, every push refused, and
  // — because unsent work outranks the server — the device quietly ignoring
  // everything the farm has done since. It has to be visible in the app.
  lastPushError = { table, message, details, hint, code, refused, at: new Date().toISOString() };
  console.error(
    `PUSH FAILED on "${table}" [${code || 'no code'}]\n` +
    `  ${message}\n` +
    (details ? `  details: ${details}\n` : '') +
    (hint ? `  hint: ${hint}\n` : '') +
    '  example row:', sample);
});

/** Record that a row must be stamped deleted on the server. */
function tombstone(table, id) {
  // Not gated on `ready` either. A row deleted before the app has finished
  // starting up is still deleted, and the server has to be told — a tombstone
  // that is never recorded means the row quietly returns on the next hydrate.
  if (id) markDeleted(table, id).catch((e) => console.error('Tombstone failed', e));
}

// ---------------------------------------------------------------------------

export const db = {
  /**
   * Load the farm. Server first, local copy as the fallback — a phone out of
   * range still opens with everything it had.
   */
  async init({ farmId: fid, role: r = 'owner' } = {}) {
    farmId = fid;
    role = r;

    // Gather the facts, then decide. The decision itself lives in boot.js as a
    // pure function so it can be tested against every combination without a
    // browser or a server — see tests/boot.test.mjs. What used to be here was
    // three lines of implicit policy that quietly preferred the server.
    const localState = await loadState().catch(() => null);
    const localFarm = await loadFarmStamp().catch(() => null);
    const allItems = await outboxItems().catch(() => []);
    const legacyCount = allItems.filter(isLegacyDirty).length;
    const pending = allItems.length - legacyCount;

    // Reachable and reachable-but-empty are different answers, and boot.js
    // needs both: an account with no seasons is a real "this farm is new",
    // while no answer at all is "we are offline". Treating them the same is
    // how an old farm gets poured into a new account.
    let serverState = null;
    let serverReachable = false;
    // Opening waited for the whole farm to come down from the server every time, which gets slower as the farm grows. A device that
    // holds this farm and owes nothing opens from its own copy at once; main.js reads the server straight after and the screen catches up.
    const fromDevice = canOpenFromDevice({ farmId, localState, localFarm, pending, legacy: legacyCount, online: navigator.onLine });
    openedFromDevice = fromDevice;
    if (navigator.onLine && !fromDevice) {
      try {
        const { state } = await hydrate(farmId, role);
        serverState = state;
        serverReachable = true;
      } catch (e) {
        console.warn('Hydrate failed; the copy on this device stands', e);
      }
    }

    const decision = fromDevice
      ? { use: 'local', pushLocal: false, orphan: false, reason: 'this device holds this farm and owes nothing, so it opens at once and the server is read in the background' }
      : chooseBootState({ farmId, localState, localFarm, pending, serverState, serverReachable });
    console.info(`Grainflow start: using the ${decision.use} copy — ${decision.reason}.`);

    // Changes recorded before they were tracked row by row say only that
    // "something" is unsent, and nothing about what. They are settled here,
    // once, rather than sent as a whole-farm push — which is what let a device
    // holding an old copy overwrite a newer one.
    const hasServerCopy = !!serverState && Object.keys(serverState.years || {}).length > 0;
    const legacyPlan = resolveLegacy({ legacy: legacyCount, decision, serverReachable, hasServer: hasServerCopy });
    if (legacyPlan === 'set-aside-and-adopt') {
      // The server's copy is taken, and the device's own is kept beside it
      // rather than discarded: those edits never reached anyone.
      await setAsideState(localState, localFarm).catch(
        (e) => console.error('Could not set aside the old unsent changes', e));
      window.dispatchEvent(new CustomEvent('grainflow:legacy-set-aside', { detail: { count: legacyCount } }));
    }
    if (legacyPlan === 'set-aside-and-adopt' || legacyPlan === 'send-all' || legacyPlan === 'clear') {
      await clearLegacyDirty().catch((e) => console.error('Could not clear the old markers', e));
    }
    if (legacyPlan === 'send-all') touch('all');

    if (decision.orphan) {
      // Unsent changes for a different farm. Preserved rather than overwritten,
      // and said out loud — silence here is how work disappears.
      await setAsideState(localState, localFarm).catch(
        (e) => console.error('Could not set aside the other farm\'s changes', e));
      console.error(
        `This device is holding ${pending} unsent change(s) for a different farm ` +
        `(${localFarm}). They have been set aside, not deleted, and are visible on ` +
        `state.html. Sign in to that farm to send them.`);
      window.dispatchEvent(new CustomEvent('grainflow:orphaned-changes', {
        detail: { farmId: localFarm, pending },
      }));
    }

    if (decision.use === 'server') {
      data = deriveCounters(serverState);
      shareOrder();
      await saveState(data, farmId).catch((e) => console.error('Local save failed', e));
    } else if (decision.use === 'local') {
      // The local copy wins, but the server still owns row identity. A device
      // that imported a backup holds a season with no __seasonId, and every
      // push from it mints a new one and is rejected by the unique constraint
      // on (farm_id, label) — a queue that can never drain, with no way out
      // short of importing again. Take the server's ids for the seasons both
      // sides know about; nothing else about the local copy changes.
      const adopted = adoptServerIds(localState, serverState);
      if (adopted) {
        console.info(`Adopted ${adopted} server row id(s) so this device's changes can be sent.`);
      }
      data = deriveCounters(localState);
      shareOrder();
    } else {
      // Brand new farm: seed the default commodity list so Settings is not
      // an empty screen on day one.
      data = defaultData();
      data.businessDetails = { ...defaultBusinessDetails() };
      shareOrder();
      // A new farm's starting records (its season, the default commodities)
      // exist only here until sent, and everything created later refers to them.
      touch('all');
    }
    // This device holds the farm and the server has none of it yet: nothing was
    // ever sent, so nothing is "changed" — send it all.
    if (decision.use === 'local' && serverReachable && !hasServerCopy) touch('all');

    // The cleanup of doubled legs queued deletes for the copies it removed. Save the
    // mended copy now: if the app closed before the next edit, the next start would
    // find the same copies again and queue the same deletes a second time.
    if (legRepairs > 0) {
      console.info(`Mended ${legRepairs} load(s) with doubled or unnumbered legs.`);
      legRepairs = 0;
      await saveState(data, farmId).catch((e) => console.error('Local save failed', e));
    }

    ready = true;
    pushOnReconnect(() => data, farmId, role);

    // Anything this device owes goes now rather than waiting for the next edit.
    const startTouches = touched;
    touched = [];
    if (decision.pushLocal || startTouches.length) {
      schedulePush(() => data, farmId, role, { delay: 0, touches: startTouches });
    }

    listeners.forEach((fn) => {
      try { fn(data); } catch (e) { console.error('A view failed to render at startup', e); }
    });
    return data;
  },

  isReady() { return ready; },

  /** True when startup opened from this device's own copy and has not yet read the server. */
  openedFromDevice() { return openedFromDevice; },

  /**
   * Give up this device's own copy and the changes it has not sent, and start again
   * from the server's. For a device that has fallen behind and cannot catch up —
   * its queue contradicts what another device has since put right — when the
   * person has decided the other device is the one to believe.
   *
   * Nothing is thrown away: the copy and the list of unsent changes are set aside
   * under their own key first, the same way a farm's changes are when a different
   * farm is opened. The caller reloads the page; startup then finds nothing local
   * and nothing owed, and takes the server's copy.
   */
  async useServerCopy() {
    if (!farmId) throw new Error('not signed in to a farm');
    const owed = await outboxItems().catch(() => []);
    await setAsideState({ ...data, __discardedOutbox: owed }, farmId);
    await clearOutbox();
    await clearState();
    lastPushError = null;
    return { discarded: owed.filter((i) => !isLegacyDirty(i)).length };
  },

  /**
   * What this device still owes the server, and why it is stuck.
   *
   * Async because the count lives in IndexedDB. Anything above zero means this
   * device is on its own copy and is not taking updates from anyone else —
   * which is correct behaviour, and needs saying out loud rather than being
   * left for somebody to deduce.
   */
  async getSyncStatus() {
    const items = (await outboxItems().catch(() => [])).filter((i) => !isLegacyDirty(i));
    // What is owed, by kind: rows to upload per table, and deletes per table. A bare
    // number cannot say whether the queue is 286 edits or 286 edits and 758 clean-ups.
    const uploads = {};
    const deletes = {};
    for (const i of items) {
      if (i.type === 'delete') deletes[i.table] = (deletes[i.table] || 0) + 1;
      else uploads[i.kind] = (uploads[i.kind] || 0) + 1;
    }
    return { pending: items.length, uploads, deletes, lastError: lastPushError };
  },

  /**
   * Pick up what other devices have done, without waiting for a restart.
   *
   * The server's copy is taken only when this device owes nothing — the same
   * rule as startup, because it is the same question: unsent work outranks the
   * server, always. Beyond that it declines if anything was edited while it was
   * fetching, since by then what it holds is already out of date, and it never
   * replaces the copy on screen while the person is part way through one.
   *
   * Safe to call as often as is convenient; most calls do nothing.
   *
   * @returns {Promise<{refreshed: boolean, why?: string}>}
   */
  async refreshFromServer() {
    if (!ready || !farmId) return { refreshed: false, why: 'not started' };
    if (!navigator.onLine) return { refreshed: false, why: 'offline' };
    if (refreshing) return { refreshed: false, why: 'already refreshing' };
    refreshing = true;
    try {
      if (await owedCount() > 0) return { refreshed: false, why: 'this device has unsent changes' };
      const editsAtStart = localEdits;

      let serverState;
      try { ({ state: serverState } = await hydrate(farmId, role)); }
      catch { return { refreshed: false, why: 'could not reach the server' }; }
      if (!serverState || Object.keys(serverState.years || {}).length === 0) {
        return { refreshed: false, why: 'the server has nothing for this farm' };
      }
      if (localEdits !== editsAtStart) return { refreshed: false, why: 'edited while fetching' };

      // Old whole-farm markers: keep the device's copy to one side, then drop them.
      const legacyCount = (await outboxItems().catch(() => [])).filter(isLegacyDirty).length;
      if (legacyCount) {
        await setAsideState(data, farmId).catch((e) => console.error('Could not set aside the old unsent changes', e));
        await clearLegacyDirty().catch((e) => console.error('Could not clear the old markers', e));
        window.dispatchEvent(new CustomEvent('grainflow:legacy-set-aside', { detail: { count: legacyCount } }));
      }

      // Nothing awaited between this check and the swap, so nothing can slip in.
      if (localEdits !== editsAtStart) return { refreshed: false, why: 'edited while fetching' };
      const next = deriveCounters(serverState);
      if (data.currentYear && next.years[data.currentYear]) next.currentYear = data.currentYear;
      data = next;
      shareOrder();
      saveState(data, farmId).catch((e) => console.error('Local save failed', e));
      listeners.forEach((fn) => {
        try { fn(data); } catch (e) { console.error('A view failed to re-render after a refresh', e); }
      });
      return { refreshed: true };
    } finally {
      refreshing = false;
    }
  },

  /** Try now, rather than waiting for the next edit. */
  pushNow() {
    if (!farmId) return;
    schedulePush(() => data, farmId, role, { delay: 0 });
  },

  // Who is looking at this farm, and which farm. Both are already held here
  // because the push needs them; exposing them saves every view re-asking the
  // server a question the app answered at sign-in. Views use these to decide
  // what to *offer* — the server still decides what to allow.
  getFarmId() { return farmId; },
  getRole() { return role; },

  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },

  get() { return current(); },

  // --- seasons ---
  getYears() { return Object.keys(data.years).sort(); },
  /** One season's data, for reading across seasons (last season's closing stock). */
  getYearData(label) { return data.years[label] ?? null; },
  getCurrentYear() { return data.currentYear; },
  setCurrentYear(year) {
    if (!data.years[year]) return false;
    data.currentYear = year;
    Object.keys(data.years).forEach((l) => touch('season', l));   // which one is current
    persist();
    return true;
  },
  renameYear(oldYear, newYear) {
    const label = String(newYear || '').trim();
    if (!label || !data.years[oldYear]) return false;
    if (label === oldYear) return true;
    if (data.years[label]) return false;
    data.years[label] = data.years[oldYear];
    delete data.years[oldYear];
    if (data.currentYear === oldYear) data.currentYear = label;
    touch('season', label);
    persist();
    return true;
  },
  /**
   * Start a new season from the current one: fields and storages keep their
   * setup, commodities keep their physical properties, everything that is a
   * result of the season resets.
   */
  createYear(year) {
    const label = String(year || '').trim();
    if (!label || data.years[label]) return false;
    const src = current();

    const idMap = new Map();
    const commodities = src.commodities.map((c) => {
      const id = uid();
      idMap.set(c.id, id);
      return {
        id, name: c.name, angleOfRepose: c.angleOfRepose, testWeight: c.testWeight,
        nPerTonne: c.nPerTonne, mtmPrice: 0, openingStock: 0, retainedSeed: 0,
        grossMarginCost: 0,
        // the farm's own grades carry into the new season with the commodity
        ...(c.customGrades?.length ? { customGrades: [...c.customGrades], __hasCustomGrades: true } : {}),
        ...(c.harvestSeason ? { harvestSeason: c.harvestSeason, __hasHarvestSeason: true } : {}),
      };
    });
    const mapCommodity = (oldId) => (oldId && idMap.has(oldId) ? idMap.get(oldId) : null);

    const fields = src.fields.map((f) => ({
      id: uid(), name: f.name, areaHa: f.areaHa, commodityId: mapCommodity(f.commodityId),
      yieldTHa: 0, yieldMode: 'estimate', ureaRequiredKgHa: 0, ureaAppliedKgHa: 0,
      seedVariety: '', seedRateKgHa: 0,
      // the paddock's outline on the farm map goes with it into the new season
      ...(f.boundary ? { boundary: f.boundary, __hasBoundary: true } : {}),
      ...(f.property ? { property: f.property, __hasProperty: true } : {}),
    }));

    const storages = src.storages.filter((s) => !isTransit(s)).map((s) => ({
      id: uid(), kind: s.kind, name: s.name, commodityId: mapCommodity(s.commodityId),
      radius: s.radius, coneAngle: s.coneAngle, width: s.width,
      capacityTons: s.capacityTons, angleOfRepose: s.angleOfRepose,
      ...(Number(s.volumeM3) > 0 ? { volumeM3: s.volumeM3, __hasVolume: true } : {}),
      testWeight: s.testWeight, tarpOverhangM: s.tarpOverhangM,
      ...(Number(s.wallHeight) > 0 ? { wallHeight: s.wallHeight, __hasWallHeight: true } : {}),
      currentHeight: 0, length: 0, fillState: 'peak', openingStock: 0,
      // grain held by a third party is still held when the season turns: what it holds now is what it opens with
      ...(isOffFarm(s) ? { offFarm: carryOffFarm(s, src.movements, { fields: src.fields, storages: src.storages, sales: src.sales }, idMap), __hasOffFarm: true } : {}),
    }));

    data.years[label] = {
      __seasonId: uid(),   // the season's own id from the start: without it every send mints a new one, and the second is refused by the server
      commodities, fields, storages, sales: [], movements: [],
      overheads: defaultOverheads(), invoices: [], payables: [], orders: [], freightOrders: [], inputStock: [], sprayJobs: [],   // stock is not carried: it is summed across every season
    };
    data.currentYear = label;
    touch('year', label);
    persist();
    return true;
  },
  /**
   * Add an earlier season built from the farm's own records (see pastseasons.js): its commodities and paddocks, and
   * nothing else. The current season stays where it is. A label the farm already has is refused, never overwritten.
   */
  addPastSeason(year, { commodities, fields }) {
    const label = String(year || '').trim();
    if (!label || data.years[label]) return false;
    data.years[label] = {
      __seasonId: uid(),   // see createYear: a season must keep one id between sends
      commodities, fields, storages: [], sales: [], movements: [],
      overheads: defaultOverheads(), invoices: [], payables: [], orders: [], freightOrders: [], inputStock: [], sprayJobs: [],
    };
    touch('year', label);
    persist();
    return true;
  },
  /**
   * Add the sample's cotton and hay to a sample farm made before it had any (see demo.js sampleCottonHayFrom). The records keep
   * the ids they arrive with, so the invoice lines and the ginning run still point at their loads; the loads and invoices take
   * the next ticket and invoice numbers, and the straw goes onto the paddocks it names.
   * @returns {{paddocks: number, loads: number, invoices: number}|null} null when the season has these already
   */
  addSampleCottonHay(pack) {
    const c = current();
    if (!pack || c.sales.some((s) => pack.sales.some((p) => p.contractNo === s.contractNo))) return null;
    for (const x of pack.commodities) {
      c.commodities.push({ ...x, ...(hasCotton(x.cotton) ? { __hasCotton: true } : {}), ...(hasHay(x.hay) ? { __hasHay: true } : {}) });
      touch('commodity', x.id);
    }
    for (const f of pack.fields) { c.fields.push(f); touch('field', f.id); }
    for (const s of pack.strawBaled || []) {
      const f = c.fields.find((q) => q.id === s.fieldId);
      if (!f) continue;
      f.balesBaled = [...(f.balesBaled || []), ...s.baled];
      f.__hasBalesBaled = true;
      touch('field', f.id);
    }
    for (const s of pack.storages) { c.storages.push(s); touch('storage', s.id); }
    for (const s of pack.sales) { c.sales.push(s); touch('sale', s.id); }
    for (const m of pack.movements) {
      const made = { ...m, ticketNo: data.nextMovementNo };
      markOil(made);
      made.froms = settleLegs([], made.froms, uid).legs;
      made.tos = settleLegs([], made.tos, uid).legs;
      c.movements.push(made);
      data.nextMovementNo += 1;
      touch('movement', made.id);
    }
    for (const i of pack.invoices) {
      c.invoices.push({ ...i, invoiceNo: data.nextInvoiceNo });
      data.nextInvoiceNo += 1;
      touch('invoice', i.id);
    }
    c.payables = c.payables || [];
    for (const p of pack.payables || []) { c.payables.push(p); touch('payable', p.id); }
    c.inputStock = c.inputStock || [];
    for (const m of pack.inputStock || []) { c.inputStock.push(m); touch('inputmove', m.id); }
    c.sprayJobs = c.sprayJobs || [];
    for (const j of pack.sprayJobs || []) { c.sprayJobs.push(j); touch('sprayjob', j.id); }
    persist();
    return { paddocks: pack.fields.length, loads: pack.movements.length, invoices: pack.invoices.length };
  },
  /**
   * Add the sample farm's earlier seasons to a sample farm made before it had any (see demo.js sampleHistoryFrom).
   * A label the farm already has is left alone, and the season in use stays where it is.
   * @returns {number} how many seasons were added
   */
  addSampleSeasons(years) {
    let added = 0;
    for (const [label, y] of Object.entries(years || {})) {
      if (data.years[label]) continue;
      data.years[label] = { ...y, __seasonId: uid() };   // see createYear: a season must keep one id between sends
      touch('year', label);
      added += 1;
    }
    if (added) persist();
    return added;
  },
  /**
   * Add contracts to an earlier season (see pastsales.js), and any crops the season did not have. A season that is not
   * here, or that already has contracts, is refused: the import never doubles up and never touches what is there.
   */
  addPastSales(year, { sales, commodities = [] }) {
    const y = data.years[String(year || '').trim()];
    if (!y || (y.sales || []).length) return false;
    y.commodities = [...(y.commodities || []), ...commodities];
    y.sales = [...sales];
    touch('year', String(year).trim());
    persist();
    return true;
  },
  /**
   * Line paddock names up across seasons (see lineup.js): rename, split and join the paddocks of earlier seasons so they
   * match the names in use now. Loads from a joined paddock are pointed at the one that remains.
   * @returns {{seasons: number, renamed: number, split: number, joined: number}}
   */
  applyLineup(rules) {
    const labels = Object.keys(data.years);
    const { groups } = lineupGroups(rules, current().fields);
    const total = { seasons: 0, renamed: 0, split: 0, joined: 0 };
    for (const label of labels) {
      const y = data.years[label];
      const applies = groupsForSeason(groups, label, labels, data.currentYear);
      if (!applies.length) continue;
      const r = lineupSeason(y, applies, uid);
      if (!r.renamed.length && !r.split.length && !r.joined.length) continue;
      y.fields = r.fields;
      y.movements = r.movements;
      r.touched.forEach((id) => touch('field', id));
      r.movementsTouched.forEach((id) => touch('movement', id));
      r.removed.forEach((x) => { tombstone('fields', x.dropId); tombstone('field_agronomy', x.agronomyId); });
      total.seasons += 1;
      total.renamed += r.renamed.length;
      total.split += r.split.length;
      total.joined += r.joined.length;
    }
    if (total.seasons) persist();
    return total;
  },
  /**
   * Give the paddocks of every other season the outline (and farm) of the paddock of the same name in this season,
   * where they have none yet. Nothing that already has an outline is changed.
   * @returns {{seasons: number, paddocks: number}}
   */
  copyMapToOtherSeasons() {
    const now = current().fields;
    const total = { seasons: 0, paddocks: 0 };
    for (const [label, y] of Object.entries(data.years)) {
      if (label === data.currentYear) continue;
      const r = copyOutlines(y.fields, now);
      if (!r.touched.length) continue;
      y.fields = r.fields;
      r.touched.forEach((id) => touch('field', id));
      total.seasons += 1;
      total.paddocks += r.touched.length;
    }
    if (total.paddocks) persist();
    return total;
  },
  /**
   * A trial owner starts their own farm: a blank season goes in, then every other season is deleted the ordinary way (so the server
   * is told to drop each row). The name of the farm stays; the invented business details are cleared by the caller.
   * @returns {boolean} false when it is not the owner, or the season name is empty or already there
   */
  startOwnFarm({ season } = {}) {
    if (role !== 'owner') return false;
    const label = String(season || '').trim();
    if (!label || data.years[label]) return false;
    const old = Object.keys(data.years);
    data.years[label] = { ...defaultYear(), __seasonId: uid() };
    data.currentYear = label;
    touch('year', label);
    for (const y of old) db.deleteYear(y);
    persist();
    return true;
  },
  deleteYear(year) {
    // the owner only: the Settings button is not offered to anyone else, and the server refuses it too, but a
    // season takes everything in it, so the data layer says no as well rather than trust the screen
    if (role !== 'owner') return false;
    const years = Object.keys(data.years);
    if (years.length <= 1 || !data.years[year]) return false;

    // Soft deletes do not cascade, so every child has to be stamped too or it
    // lingers on the server, invisible but taking up room.
    const y = data.years[year];
    y.commodities?.forEach((c) => tombstone('commodities', c.id));
    y.fields?.forEach((f) => { tombstone('fields', f.id); tombstone('field_agronomy', f.__agronomyId); });
    y.storages?.forEach((s) => tombstone('storages', s.id));
    y.sales?.forEach((s) => { tombstone('sales', s.id); tombstone('sale_terms', s.__termsId); });
    y.movements?.forEach((m) => tombstone('movements', m.id));
    y.invoices?.forEach((i) => tombstone('invoices', i.id));
    y.payables?.forEach((p) => tombstone('payables', p.id));
    y.orders?.forEach((o) => tombstone('orders', o.id));
    y.freightOrders?.forEach((f) => tombstone('freight_orders', f.id));
    y.inputStock?.forEach((m) => tombstone('input_stock', m.id));
    y.sprayJobs?.forEach((j) => tombstone('spray_jobs', j.id));
    tombstone('overheads', y.__overheadsId);
    tombstone('seasons', y.__seasonId);

    delete data.years[year];
    if (data.currentYear === year) data.currentYear = Object.keys(data.years).sort().slice(-1)[0];
    touch('season', data.currentYear);
    persist();
    return true;
  },

  // --- commodities ---
  upsertCommodity(commodity) {
    const c = current();
    if (commodity.id) {
      const idx = c.commodities.findIndex((x) => x.id === commodity.id);
      if (idx >= 0) {
        const merged = { ...c.commodities[idx], ...commodity };
        if (Number(merged.openingValue)) merged.__hasOpeningValue = true;
        if (merged.customGrades?.length) merged.__hasCustomGrades = true;
        if (merged.harvestSeason) merged.__hasHarvestSeason = true;   // so going back to automatic still reaches the server
        if (hasCotton(merged.cotton)) merged.__hasCotton = true;      // and clearing the cotton settings does too
        if (hasHay(merged.hay)) merged.__hasHay = true;               // and the hay settings
        c.commodities[idx] = merged;
      }
      touch('commodity', commodity.id);
    } else {
      const id = uid();
      const made = { mtmPrice: 0, openingStock: 0, retainedSeed: 0, grossMarginCost: 0, ...commodity, id };
      if (Number(made.openingValue)) made.__hasOpeningValue = true;
      if (made.harvestSeason) made.__hasHarvestSeason = true;
      if (hasCotton(made.cotton)) made.__hasCotton = true;
      if (hasHay(made.hay)) made.__hasHay = true;
      c.commodities.push(made);
      touch('commodity', id);
      persist();
      return id;
    }
    persist();
    return commodity.id;
  },
  deleteCommodity(id) {
    tombstone('commodities', id);
    current().commodities = current().commodities.filter((c) => c.id !== id);
    persist();
  },

  // --- fields ---
  upsertField(field) {
    const c = current();
    if (field.id) {
      const idx = c.fields.findIndex((f) => f.id === field.id);
      if (idx >= 0) {
        const merged = { ...c.fields[idx], ...field };
        if (merged.boundary) merged.__hasBoundary = true;
        if (merged.property) merged.__hasProperty = true;   // keeps clearing the farm name reaching the server
        if (merged.harvestDone) merged.__hasHarvestDone = true;   // keeps un-ticking it reaching the server
        if (merged.harvestHaLeft != null) merged.__hasHarvestHaLeft = true;   // and so does clearing the hectares left
        if (merged.harvestLeftYield != null) merged.__hasHarvestLeftYield = true;   // and clearing their yield
        if (Array.isArray(merged.modulesPicked)) merged.__hasModulesPicked = true;   // and deleting the last modules picked
        if (Array.isArray(merged.balesBaled)) merged.__hasBalesBaled = true;   // and deleting the last bales baled
        c.fields[idx] = merged;
      }
      touch('field', field.id);
    } else {
      const id = uid();
      c.fields.push({ ...field, id, ...(field.harvestDone ? { __hasHarvestDone: true } : {}), ...(field.harvestHaLeft != null ? { __hasHarvestHaLeft: true } : {}), ...(field.harvestLeftYield != null ? { __hasHarvestLeftYield: true } : {}) });
      touch('field', id);
      persist();
      return id;
    }
    persist();
    return field.id;
  },
  /**
   * Saves the outlines from a farm map import in one go. `matched` gives each existing paddock its outline (and its area from
   * the map, when one is given); `added` makes new paddocks from outlines that matched none.
   */
  applyFieldBoundaries({ matched = [], added = [] } = {}) {
    const c = current();
    for (const m of matched) {
      const idx = c.fields.findIndex((f) => f.id === m.id);
      if (idx < 0) continue;
      c.fields[idx] = { ...c.fields[idx], boundary: m.boundary, __hasBoundary: true, ...(m.areaHa > 0 ? { areaHa: m.areaHa } : {}), ...(m.property ? { property: m.property, __hasProperty: true } : {}) };
      touch('field', m.id);
    }
    for (const a of added) {
      const id = uid();
      c.fields.push({ id, name: a.name, areaHa: a.areaHa || 0, commodityId: null, yieldTHa: 0, yieldMode: 'estimate', ureaRequiredKgHa: 0, ureaAppliedKgHa: 0, seedVariety: '', seedRateKgHa: 0, boundary: a.boundary, __hasBoundary: true, ...(a.property ? { property: a.property, __hasProperty: true } : {}) });
      touch('field', id);
    }
    persist();
  },
  /** Takes the farm map off every paddock. */
  clearFieldBoundaries() {
    const c = current();
    c.fields = c.fields.map((f) => {
      if (!f.boundary) return f;
      touch('field', f.id);
      return { ...f, boundary: null, __hasBoundary: true };
    });
    persist();
  },
  /**
   * Combine two paddocks into one: the kept paddock takes the name and the
   * summed area, every load from the other now says it came from the kept one,
   * and the other is deleted. See merge.js for what is kept from each.
   *
   * @returns {{loadsMoved: number} | null} null when either paddock is missing
   */
  mergeFields(keepId, dropId, name) {
    const c = current();
    const keep = c.fields.find((f) => f.id === keepId);
    const drop = c.fields.find((f) => f.id === dropId);
    if (!keep || !drop || keepId === dropId) return null;

    c.fields[c.fields.indexOf(keep)] = mergeFieldRecords(keep, drop, name);
    touch('field', keepId);

    const { movements, changed } = repointLoads(c.movements, dropId, keepId);
    c.movements = movements;
    changed.forEach((id) => touch('movement', id));

    tombstone('fields', dropId);
    tombstone('field_agronomy', drop.__agronomyId);
    c.fields = c.fields.filter((f) => f.id !== dropId);
    persist();
    return { loadsMoved: changed.length };
  },
  deleteField(id) {
    const f = current().fields.find((x) => x.id === id);
    tombstone('fields', id);
    tombstone('field_agronomy', f?.__agronomyId);
    current().fields = current().fields.filter((x) => x.id !== id);
    persist();
  },

  // --- sales ---
  upsertSale(sale) {
    const c = current();
    if (sale.id) {
      const idx = c.sales.findIndex((s) => s.id === sale.id);
      if (idx >= 0) {
        const merged = { ...c.sales[idx], ...sale };
        if (Number(merged.brokerageRate)) merged.__hasBrokerageRate = true;   // keeps clearing it reaching the server
        if (merged.freightPaidBy === 'buyer') merged.__hasFreightPaidBy = true;   // and a switch back to 'we' too
        if (merged.ourRef) merged.__hasOurRef = true;   // so clearing it reaches the server
        if (merged.paid) merged.__hasPaid = true;       // and so does marking it unpaid again
        if (merged.deliveryPattern) merged.__hasDeliveryPattern = true;   // and clearing how it is delivered
        if (merged.invoicing) merged.__hasInvoicing = true;               // and clearing who invoices
        if (hasAddressParts(merged.buyerAddressParts)) merged.__hasBuyerAddressParts = true;   // and clearing the buyer's address parts
        c.sales[idx] = merged;
      }
      touch('sale', sale.id);
    } else {
      const id = uid();
      c.sales.push({ ...sale, id, ...(Number(sale.brokerageRate) ? { __hasBrokerageRate: true } : {}), ...(sale.freightPaidBy === 'buyer' ? { __hasFreightPaidBy: true } : {}), ...(sale.ourRef ? { __hasOurRef: true } : {}), ...(sale.paid ? { __hasPaid: true } : {}), ...(sale.deliveryPattern ? { __hasDeliveryPattern: true } : {}), ...(sale.invoicing ? { __hasInvoicing: true } : {}), ...(hasAddressParts(sale.buyerAddressParts) ? { __hasBuyerAddressParts: true } : {}) });
      touch('sale', id);
    }
    persist();
  },
  /**
   * Bring contracts that still have grain to deliver from an earlier season into this one.
   * Each becomes a contract here for the tonnes still to go, on the same price and terms; the
   * earlier contract is left as it was apart from a note saying where its tonnes went. Each pick
   * says how much to add to the commodity's opening stock tonnes (`openingTons`) and value
   * (`openingValue`) — see openingChange() in carryover.js for what those are in each case —
   * so this season does not count the same income again.
   *
   * One save for the whole lot, so it is all there or none of it is.
   *
   * @param {{fromYear: string, picks: {saleId: string, tons: number, openingTons?: number, openingValue?: number}[]}} args
   * @returns {{made: {id: string, tons: number, commodityId: string}[], skipped: number}}
   */
  carryContracts({ fromYear, picks }) {
    const src = data.years[fromYear];
    const dst = current();
    if (!src || src === dst) return { made: [], skipped: picks.length };
    const made = [];
    let skipped = 0;
    const today = new Date().toISOString().slice(0, 10);
    for (const pick of picks) {
      const sale = (src.sales || []).find((s) => s.id === pick.saleId);
      const wasName = (src.commodities || []).find((c) => c.id === sale?.commodityId)?.name;
      const target = (dst.commodities || []).find((c) => String(c.name ?? '').trim().toLowerCase() === String(wasName ?? '').trim().toLowerCase());
      const tons = Number(pick.tons);
      if (!sale || !target || !(tons > 0)) { skipped += 1; continue; }

      const id = uid();
      dst.sales.push({ ...buildCarriedSale(sale, { commodityId: target.id, tons, prevLabel: fromYear }), id });
      touch('sale', id);
      sale.notes = appendNote(sale.notes, carriedIntoNote(data.currentYear, tons, today));
      touch('sale', sale.id);

      const addTons = Number(pick.openingTons) || 0;
      const addValue = Number(pick.openingValue) || 0;
      if (addTons || addValue) {
        target.openingStock = (Number(target.openingStock) || 0) + addTons;
        target.openingValue = (Number(target.openingValue) || 0) + addValue;
        target.__hasOpeningValue = true;
        touch('commodity', target.id);
      }
      made.push({ id, tons, commodityId: target.id });
    }
    if (made.length) persist();
    return { made, skipped };
  },
  deleteSale(id) {
    const s = current().sales.find((x) => x.id === id);
    tombstone('sales', id);
    tombstone('sale_terms', s?.__termsId);
    // the contract's orders go with it, and loads that were against them are no longer against anything
    const c = current();
    const gone = new Set((c.orders || []).filter((o) => o.saleId === id).map((o) => o.id));
    gone.forEach((oid) => tombstone('orders', oid));
    c.orders = (c.orders || []).filter((o) => !gone.has(o.id));
    for (const m of c.movements || []) if (m.orderId && gone.has(m.orderId)) { m.orderId = null; touch('movement', m.id); }
    // and so are its freight orders; loads and bills that named them are left, naming nothing
    const goneFreight = new Set((c.freightOrders || []).filter((f) => f.saleId === id).map((f) => f.id));
    goneFreight.forEach((fid) => tombstone('freight_orders', fid));
    c.freightOrders = (c.freightOrders || []).filter((f) => !goneFreight.has(f.id));
    for (const m of c.movements || []) if (m.freightOrderId && goneFreight.has(m.freightOrderId)) { m.freightOrderId = null; touch('movement', m.id); }
    for (const p of c.payables || []) if (p.freightOrderId && goneFreight.has(p.freightOrderId)) { p.freightOrderId = null; touch('payable', p.id); }
    c.sales = c.sales.filter((x) => x.id !== id);
    persist();
  },

  // --- storages ---
  upsertStorage(storage) {
    const c = current();
    if (storage.id) {
      const idx = c.storages.findIndex((s) => s.id === storage.id);
      if (idx >= 0) {
        const merged = { ...c.storages[idx], ...storage };
        if (hasStorageQuality(merged)) merged.__hasQuality = true;   // see mapping.js: keeps clearing a value reaching the server
        markOil(merged);
        if (hasStorageNote(merged)) merged.__hasNotes = true;
        if (hasGradeBands(merged)) merged.__hasBands = true;
        if (hasFumigations(merged)) merged.__hasFumigations = true;
        if (merged.outloadEnd) merged.__hasOutloadEnd = true;
        if (Number(merged.wallHeight) > 0) merged.__hasWallHeight = true;     // so clearing it later reaches the server
        if (Number(merged.volumeM3) > 0) merged.__hasVolume = true;           // likewise the volume
        if (merged.offFarm) merged.__hasOffFarm = true;
        c.storages[idx] = merged;
      }
      touch('storage', storage.id);
    } else {
      const id = uid();
      const made = { ...storage, id, createdAt: Date.now() };
      if (hasStorageQuality(made)) made.__hasQuality = true;
      markOil(made);
      if (hasStorageNote(made)) made.__hasNotes = true;
      if (hasGradeBands(made)) made.__hasBands = true;
      if (hasFumigations(made)) made.__hasFumigations = true;
      if (made.outloadEnd) made.__hasOutloadEnd = true;
      if (Number(made.wallHeight) > 0) made.__hasWallHeight = true;
      if (Number(made.volumeM3) > 0) made.__hasVolume = true;
      if (made.offFarm) made.__hasOffFarm = true;
      c.storages.push(made);
      touch('storage', id);
      persist();
      return id;
    }
    persist();
    return storage.id;
  },
  deleteStorage(id) {
    tombstone('storages', id);
    current().storages = current().storages.filter((s) => s.id !== id);
    persist();
  },
  /**
   * The id of the "In transit" store for a commodity, creating it if this is the first
   * ticket to need one. Grain on a truck that has no silo yet is counted there, so it
   * is never lost between the paddock and the silo.
   */
  ensureTransit(commodityId) {
    const c = current();
    const found = transitFor(c.storages, commodityId);
    if (found) return found.id;
    const name = transitName(c.commodities.find((x) => x.id === commodityId)?.name);
    return db.upsertStorage({ kind: 'tally', unitLabel: TRANSIT_LABEL, name, commodityId: commodityId || null, openingStock: 0 });
  },

  // --- movements ---
  upsertMovement(movement) {
    const c = current();
    if (movement.id) {
      const idx = c.movements.findIndex((m) => m.id === movement.id);
      if (idx >= 0) {
        const before = c.movements[idx];
        const merged = { ...before, ...movement };
        if (hasLoadQuality(merged)) merged.__hasQuality = true;
        markOil(merged);
        // Legs keep the id they had; a leg taken out is retired on the server.
        for (const side of ['froms', 'tos']) {
          const { legs, retired } = settleLegs(before[side], merged[side], uid);
          merged[side] = legs;
          retired.forEach((id) => tombstone('movement_legs', id));
        }
        c.movements[idx] = merged;
      }
      touch('movement', movement.id);
    } else {
      const id = uid();
      const made = { ...movement, id, ticketNo: data.nextMovementNo };
      if (hasLoadQuality(made)) made.__hasQuality = true;
      markOil(made);
      made.froms = settleLegs([], made.froms, uid).legs;
      made.tos = settleLegs([], made.tos, uid).legs;
      c.movements.push(made);
      data.nextMovementNo += 1;
      touch('movement', id);
    }
    persist();
  },
  /**
   * Add many loads at once — an import. One save, one repaint, one push, instead
   * of a few hundred of each. Tickets are numbered in the order given, so the
   * caller sends them oldest first.
   *
   * @returns {number} how many were added
   */
  addMovements(list) {
    const c = current();
    for (const m of list) {
      const id = uid();
      const made = { ...m, id, ticketNo: data.nextMovementNo };
      if (hasLoadQuality(made)) made.__hasQuality = true;
      markOil(made);
      made.froms = settleLegs([], made.froms, uid).legs;
      made.tos = settleLegs([], made.tos, uid).legs;
      c.movements.push(made);
      data.nextMovementNo += 1;
      touch('movement', id);
    }
    persist();
    return list.length;
  },
  deleteMovement(id) {
    const m = current().movements.find((x) => x.id === id);
    tombstone('movements', id);
    (m?.froms || []).forEach((l) => tombstone('movement_legs', l.__legId));
    (m?.tos || []).forEach((l) => tombstone('movement_legs', l.__legId));
    current().movements = current().movements.filter((x) => x.id !== id);
    persist();
  },

  // --- invoices ---
  getInvoicesForSale(saleId) {
    return current().invoices.filter((inv) => inv.saleId === saleId);
  },
  createInvoice(invoice) {
    const inv = {
      ...invoice, id: uid(), invoiceNo: data.nextInvoiceNo,
      status: 'outstanding', paidDate: null,
    };
    data.nextInvoiceNo += 1;
    current().invoices.push(inv);
    touch('invoice', inv.id);
    persist();
    return inv;
  },
  /** An adjustment note against an invoice: no invoice number (those stay unbroken), a note number of its own, in whichever season is open. */
  createAdjustment(note) {
    const all = Object.values(data.years).flatMap((y) => y.invoices || []);
    // applied to its invoice, the note is settled from the start: its amount is in the invoice's total, not owed on top of it
    const inv = { ...note, id: uid(), invoiceNo: null, noteNo: nextNoteNo(all), status: note.appliedToInvoice ? 'paid' : 'outstanding', paidDate: note.appliedToInvoice ? note.issueDate : null };
    current().invoices.push(inv);
    touch('invoice', inv.id);
    if (inv.appliedToInvoice) {
      const original = current().invoices.find((i) => i.id === inv.adjustsInvoiceId);
      if (original) { Object.assign(original, applyAdjustment(original, inv)); touch('invoice', original.id); }
    }
    persist();
    return inv;
  },
  setInvoiceStatus(id, status) {
    const c = current();
    const idx = c.invoices.findIndex((inv) => inv.id === id);
    if (idx < 0) return;
    c.invoices[idx] = {
      ...c.invoices[idx], status,
      paidDate: status === 'paid' ? new Date().toISOString().slice(0, 10) : null,
    };
    touch('invoice', id);
    persist();
  },
  updateInvoice(id, patch) {
    const c = current();
    const idx = c.invoices.findIndex((inv) => inv.id === id);
    if (idx < 0) return;
    c.invoices[idx] = { ...c.invoices[idx], ...patch };
    touch('invoice', id);
    persist();
  },
  /** A file taken off a contract, an order, an invoice or a bill: the row goes, so it does not come back on refresh. */
  deleteDocument(table, id) {
    if (table !== 'sale_documents' && table !== 'record_documents') return;
    tombstone(table, id);
  },
  deleteInvoice(id) {
    const gone = current().invoices.find((inv) => inv.id === id);
    // a note that was applied to its invoice takes its line and its amount back off it
    if (gone && isAdjustment(gone) && gone.appliedToInvoice) {
      const original = current().invoices.find((i) => i.id === gone.adjustsInvoiceId);
      const patch = original ? withoutAdjustment(original, gone) : null;
      if (patch && Object.keys(patch).length) { Object.assign(original, patch); touch('invoice', original.id); }
    }
    // an invoice takes its notes with it: a note with no invoice would be owed to nobody
    const notes = gone && !isAdjustment(gone) ? current().invoices.filter((i) => isAdjustment(i) && i.adjustsInvoiceId === id) : [];
    for (const n of notes) tombstone('invoices', n.id);
    tombstone('invoices', id);
    const drop = new Set([id, ...notes.map((n) => n.id)]);
    current().invoices = current().invoices.filter((inv) => !drop.has(inv.id));
    persist();
  },

  // --- payables: bills the farm owes ---
  getPayables() { return current().payables || []; },
  upsertPayable(bill) {
    const c = current();
    c.payables = c.payables || [];
    if (bill.freightOrderId) bill = { ...bill, __hasFreightOrderId: true };   // so taking it off a freight order later reaches the server
    if (bill.id) {
      const idx = c.payables.findIndex((p) => p.id === bill.id);
      if (idx >= 0) c.payables[idx] = { ...c.payables[idx], ...bill };
      else c.payables.push({ status: 'unpaid', ...bill });          // a new bill whose id was minted up front, so a file could be attached first
      touch('payable', bill.id);
    } else {
      const id = uid();
      c.payables.push({ status: 'unpaid', ...bill, id });
      touch('payable', id);
      persist();
      return id;
    }
    persist();
    return bill.id;
  },
  deletePayable(id) {
    tombstone('payables', id);
    const c = current();
    c.payables = (c.payables || []).filter((p) => p.id !== id);
    persist();
  },

  // --- orders: a buyer's request for grain against a contract ---
  getOrders() { return current().orders || []; },
  upsertOrder(order) {
    const c = current();
    c.orders = c.orders || [];
    if (order.id) {
      const idx = c.orders.findIndex((o) => o.id === order.id);
      if (idx >= 0) c.orders[idx] = { ...c.orders[idx], ...order };
      else c.orders.push({ status: 'open', ...order });             // a new order whose id was minted up front, so a file could be attached first
      touch('order', order.id);
    } else {
      const id = uid();
      c.orders.push({ status: 'open', ...order, id });
      touch('order', id);
      persist();
      return id;
    }
    persist();
    return order.id;
  },
  deleteOrder(id) {
    tombstone('orders', id);
    const c = current();
    c.orders = (c.orders || []).filter((o) => o.id !== id);
    // loads that were against it are no longer against anything
    for (const m of c.movements || []) {
      if (m.orderId === id) { m.orderId = null; touch('movement', m.id); }
    }
    for (const f of c.freightOrders || []) if (f.orderId === id) { f.orderId = null; touch('freightorder', f.id); }
    persist();
  },

  // --- freight orders: a job given to a carrier, linked to the buyer's order and contract ---
  getFreightOrders() { return current().freightOrders || []; },
  upsertFreightOrder(fo) {
    // the address parts beside the pick-up and drop-off lines: marked once there are any, so clearing them reaches the server
    fo = { ...fo, ...(hasAddressParts(fo.pickupParts) ? { __hasPickupParts: true } : {}), ...(hasAddressParts(fo.deliverToParts) ? { __hasDeliverToParts: true } : {}), ...(fo.buyerOrderNo ? { __hasBuyerOrderNo: true } : {}) };
    const c = current();
    c.freightOrders = c.freightOrders || [];
    if (fo.id) {
      const idx = c.freightOrders.findIndex((f) => f.id === fo.id);
      if (idx >= 0) c.freightOrders[idx] = { ...c.freightOrders[idx], ...fo };
      touch('freightorder', fo.id);
    } else {
      const id = uid();
      c.freightOrders.push({ status: 'open', ...fo, id });
      touch('freightorder', id);
      persist();
      return id;
    }
    persist();
    return fo.id;
  },
  deleteFreightOrder(id) {
    tombstone('freight_orders', id);
    const c = current();
    c.freightOrders = (c.freightOrders || []).filter((f) => f.id !== id);
    // loads carted on it, and bills for it, are left, naming nothing
    for (const m of c.movements || []) if (m.freightOrderId === id) { m.freightOrderId = null; touch('movement', m.id); }
    for (const p of c.payables || []) if (p.freightOrderId === id) { p.freightOrderId = null; touch('payable', p.id); }
    persist();
  },

  // --- input stock: seed, fertiliser, fuel and chemical in and out (see inputs.js) ---
  /** Every entry from every season: what is on hand does not stop at the end of a year. */
  getInputMoves() {
    return Object.values(data.years).flatMap((y) => y.inputStock || []);
  },
  upsertInputMove(m) {
    const c = current();
    c.inputStock = c.inputStock || [];
    if (m.location) m = { ...m, __hasLocation: true };   // so clearing it later reaches the server
    if (m.id) {
      // the entry may sit in an earlier season: change it where it is
      for (const y of Object.values(data.years)) {
        const idx = (y.inputStock || []).findIndex((x) => x.id === m.id);
        if (idx >= 0) { y.inputStock[idx] = { ...y.inputStock[idx], ...m }; touch('inputmove', m.id); persist(); return m.id; }
      }
    }
    const id = m.id || uid();
    c.inputStock.push({ ...m, id });
    touch('inputmove', id);
    persist();
    return id;
  },
  deleteInputMove(id) {
    for (const y of Object.values(data.years)) {
      if (!(y.inputStock || []).some((x) => x.id === id)) continue;
      tombstone('input_stock', id);
      y.inputStock = y.inputStock.filter((x) => x.id !== id);
    }
    persist();
  },

  // --- spray requests: a job for a spray contractor, with the paddocks to be sprayed (see spray.js) ---
  getSprayJobs() { return current().sprayJobs || []; },
  upsertSprayJob(job) {
    const c = current();
    c.sprayJobs = c.sprayJobs || [];
    if (job.id) {
      const idx = c.sprayJobs.findIndex((j) => j.id === job.id);
      if (idx >= 0) { c.sprayJobs[idx] = { ...c.sprayJobs[idx], ...job }; touch('sprayjob', job.id); persist(); return job.id; }
    }
    const id = job.id || uid();
    c.sprayJobs.push({ status: 'draft', ...job, id });
    touch('sprayjob', id);
    persist();
    return id;
  },
  deleteSprayJob(id) {
    tombstone('spray_jobs', id);
    const c = current();
    c.sprayJobs = (c.sprayJobs || []).filter((j) => j.id !== id);
    persist();
  },

  // --- overheads ---
  getOverheads() { return current().overheads; },
  updateOverheads(patch) {
    current().overheads = { ...current().overheads, ...patch };
    touch('overheads', data.currentYear);
    persist();
  },

  // --- outload numbers: the number a truck quotes at a third-party site (see outloadno.js) ---
  getOutloadSeries() { return outloadSeries; },
  setOutloadSeries(n) { outloadSeries = Number(n) >= 1 && Number(n) <= 9 ? Number(n) : null; },
  /**
   * The next outload number for this person, in the season being worked in, worked out from every load the phone holds.
   * Nothing is stored until the load is saved with it. Null when this person has no digit yet.
   */
  nextOutloadNo() {
    const yy = seasonYY(data.currentYear, new Date().toISOString().slice(0, 10));
    const all = Object.values(data.years || {}).flatMap((y) => y.movements || []);
    return nextOutloadNo({ series: outloadSeries, yy, movements: all });
  },

  // --- business details ---
  // every PDF reads the details just before it is made, so this is where the farm's logo is handed to the PDF writer
  getBusinessDetails() { setBrandLogo(data.businessDetails?.logoOff ? '' : data.businessDetails?.logo); return data.businessDetails; },
  updateBusinessDetails(patch) {
    data.businessDetails = { ...data.businessDetails, ...patch };
    if (data.businessDetails.qaProgram || data.businessDetails.qaNumber) data.businessDetails.__hasQa = true;   // so clearing them reaches the server
    if (data.businessDetails.pic) data.businessDetails.__hasPic = true;
    if (data.businessDetails.logoOff) data.businessDetails.__hasLogoOff = true;   // so turning it back on reaches the server
    if (data.businessDetails.logo) data.businessDetails.__hasLogo = true;   // so taking it off again reaches the server
    if (data.businessDetails.signers) data.businessDetails.__hasSigners = true;   // so clearing the list reaches the server
    if (data.businessDetails.importFormats?.length) data.businessDetails.__hasImportFormats = true;   // so deleting the last one reaches the server
    if (data.businessDetails.commodityOrder?.length) data.businessDetails.__hasCommodityOrder = true;   // so going back to automatic reaches the server
    shareOrder();
    if (data.businessDetails.showAircair) data.businessDetails.__hasAircair = true;   // so switching it off again reaches the server
    if (hasAddressParts(data.businessDetails.addressParts)) data.businessDetails.__hasAddressParts = true;   // so clearing the parts reaches the server
    touch('business');
    persist();
  },

  exportJSON() { return JSON.stringify(data, null, 2); },

  /**
   * Replace everything with an imported file.
   *
   * A backup from the localStorage era carries short ids like `msoad38fu5po5n`
   * where the database wants UUIDs, so every id is reissued and every reference
   * rewritten first. Then it is checked — and refused outright if anything
   * fails, rather than written and half-rejected later.
   *
   * That check is not belt-and-braces. A reference that survives remapping but
   * points nowhere does not error: the counts still look right, the position
   * still adds up, and a load has quietly detached from the paddock it came out
   * of. Better to refuse the file than to import a season that looks fine.
   */
  importJSON(json) {
    const { state, after, remapped, filled } = prepareImport(json);

    if (!after.ok) {
      const err = new Error(
        `${after.problems.length} problem(s) in that file:\n\n` +
        after.problems.slice(0, 8).join('\n') +
        (after.problems.length > 8 ? `\n… and ${after.problems.length - 8} more` : '')
      );
      err.problems = after.problems;
      throw err;
    }

    const retired = reconcileImport(data, state, tombstone);

    data = deriveCounters(state);
    shareOrder();
    touch('all');
    persist();
    return { remapped, filled, retired, stats: after.stats };
  },

  resetAll() {
    if (role !== 'owner') return;             // wipes every season: the owner only, as the Settings button is
    data = defaultData();
    shareOrder();
    touch('all');
    persist();
  },
};
