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

import { hydrate } from './hydrate.js?v=74';
import {
  saveState, loadState, markDeleted, markDirty, outboxCount,
  loadFarmStamp, setAsideState,
} from './local.js?v=74';
import { chooseBootState } from './boot.js?v=74';
import { reconcileImport, adoptServerIds } from './reconcile.js?v=74';
import { schedulePush, pushOnReconnect } from './sync.js?v=74';
import { prepareImport, DEFAULT_OVERHEADS, DEFAULT_BUSINESS_DETAILS } from './import.js?v=74';

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
    movements: [], overheads: defaultOverheads(), invoices: [],
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
function deriveCounters(state) {
  let maxTicket = 0;
  let maxInvoice = 0;
  for (const year of Object.values(state.years || {})) {
    for (const m of year.movements || []) {
      if (Number(m.ticketNo) > maxTicket) maxTicket = Number(m.ticketNo);
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
let farmId = null;
let role = 'owner';
let ready = false;

const listeners = new Set();

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
  if (farmId) schedulePush(() => data, farmId, role);
  else markDirty().catch((e) => console.error('Could not queue for the server', e));
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
window.addEventListener('grainflow:push-failed', (e) => {
  const { table, message, details, hint, code, sample } = e.detail?.errors?.[0] || {};
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
    const pending = await outboxCount().catch(() => 0);

    // Reachable and reachable-but-empty are different answers, and boot.js
    // needs both: an account with no seasons is a real "this farm is new",
    // while no answer at all is "we are offline". Treating them the same is
    // how an old farm gets poured into a new account.
    let serverState = null;
    let serverReachable = false;
    if (navigator.onLine) {
      try {
        const { state } = await hydrate(farmId);
        serverState = state;
        serverReachable = true;
      } catch (e) {
        console.warn('Hydrate failed; the copy on this device stands', e);
      }
    }

    const decision = chooseBootState({
      farmId, localState, localFarm, pending, serverState, serverReachable,
    });
    console.info(`Grainflow start: using the ${decision.use} copy — ${decision.reason}.`);

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
    } else {
      // Brand new farm: seed the default commodity list so Settings is not
      // an empty screen on day one.
      data = defaultData();
      data.businessDetails = { ...defaultBusinessDetails() };
    }

    ready = true;
    pushOnReconnect(() => data, farmId, role);

    // Anything this device owes goes now rather than waiting for the next edit.
    if (decision.pushLocal) schedulePush(() => data, farmId, role, { delay: 0 });

    listeners.forEach((fn) => {
      try { fn(data); } catch (e) { console.error('A view failed to render at startup', e); }
    });
    return data;
  },

  isReady() { return ready; },

  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },

  get() { return current(); },

  // --- seasons ---
  getYears() { return Object.keys(data.years).sort(); },
  getCurrentYear() { return data.currentYear; },
  setCurrentYear(year) {
    if (!data.years[year]) return false;
    data.currentYear = year;
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
      };
    });
    const mapCommodity = (oldId) => (oldId && idMap.has(oldId) ? idMap.get(oldId) : null);

    const fields = src.fields.map((f) => ({
      id: uid(), name: f.name, areaHa: f.areaHa, commodityId: mapCommodity(f.commodityId),
      yieldTHa: 0, yieldMode: 'estimate', ureaRequiredKgHa: 0, ureaAppliedKgHa: 0,
      seedVariety: '', seedRateKgHa: 0,
    }));

    const storages = src.storages.map((s) => ({
      id: uid(), kind: s.kind, name: s.name, commodityId: mapCommodity(s.commodityId),
      radius: s.radius, coneAngle: s.coneAngle, width: s.width,
      capacityTons: s.capacityTons, angleOfRepose: s.angleOfRepose,
      testWeight: s.testWeight, tarpOverhangM: s.tarpOverhangM,
      currentHeight: 0, length: 0, fillState: 'peak', openingStock: 0,
    }));

    data.years[label] = {
      commodities, fields, storages, sales: [], movements: [],
      overheads: defaultOverheads(), invoices: [],
    };
    data.currentYear = label;
    persist();
    return true;
  },
  deleteYear(year) {
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
    tombstone('overheads', y.__overheadsId);
    tombstone('seasons', y.__seasonId);

    delete data.years[year];
    if (data.currentYear === year) data.currentYear = Object.keys(data.years).sort().slice(-1)[0];
    persist();
    return true;
  },

  // --- commodities ---
  upsertCommodity(commodity) {
    const c = current();
    if (commodity.id) {
      const idx = c.commodities.findIndex((x) => x.id === commodity.id);
      if (idx >= 0) c.commodities[idx] = { ...c.commodities[idx], ...commodity };
    } else {
      c.commodities.push({
        mtmPrice: 0, openingStock: 0, retainedSeed: 0, grossMarginCost: 0, ...commodity, id: uid(),
      });
    }
    persist();
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
      if (idx >= 0) c.fields[idx] = { ...c.fields[idx], ...field };
    } else {
      c.fields.push({ ...field, id: uid() });
    }
    persist();
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
      if (idx >= 0) c.sales[idx] = { ...c.sales[idx], ...sale };
    } else {
      c.sales.push({ ...sale, id: uid() });
    }
    persist();
  },
  deleteSale(id) {
    const s = current().sales.find((x) => x.id === id);
    tombstone('sales', id);
    tombstone('sale_terms', s?.__termsId);
    current().sales = current().sales.filter((x) => x.id !== id);
    persist();
  },

  // --- storages ---
  upsertStorage(storage) {
    const c = current();
    if (storage.id) {
      const idx = c.storages.findIndex((s) => s.id === storage.id);
      if (idx >= 0) c.storages[idx] = { ...c.storages[idx], ...storage };
    } else {
      c.storages.push({ ...storage, id: uid(), createdAt: Date.now() });
    }
    persist();
  },
  deleteStorage(id) {
    tombstone('storages', id);
    current().storages = current().storages.filter((s) => s.id !== id);
    persist();
  },

  // --- movements ---
  upsertMovement(movement) {
    const c = current();
    if (movement.id) {
      const idx = c.movements.findIndex((m) => m.id === movement.id);
      if (idx >= 0) c.movements[idx] = { ...c.movements[idx], ...movement };
    } else {
      c.movements.push({ ...movement, id: uid(), ticketNo: data.nextMovementNo });
      data.nextMovementNo += 1;
    }
    persist();
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
    persist();
  },
  updateInvoice(id, patch) {
    const c = current();
    const idx = c.invoices.findIndex((inv) => inv.id === id);
    if (idx < 0) return;
    c.invoices[idx] = { ...c.invoices[idx], ...patch };
    persist();
  },
  deleteInvoice(id) {
    tombstone('invoices', id);
    current().invoices = current().invoices.filter((inv) => inv.id !== id);
    persist();
  },

  // --- overheads ---
  getOverheads() { return current().overheads; },
  updateOverheads(patch) {
    current().overheads = { ...current().overheads, ...patch };
    persist();
  },

  // --- business details ---
  getBusinessDetails() { return data.businessDetails; },
  updateBusinessDetails(patch) {
    data.businessDetails = { ...data.businessDetails, ...patch };
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
    persist();
    return { remapped, filled, retired, stats: after.stats };
  },

  resetAll() {
    data = defaultData();
    persist();
  },
};
