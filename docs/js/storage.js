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

import { hydrate } from './hydrate.js?v=63';
import { saveState, loadState, markDeleted } from './local.js?v=63';
import { schedulePush, pushOnReconnect } from './sync.js?v=63';

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

function defaultOverheads() {
  return {
    finance: 0, equipmentRepayments: 0, depreciation: 0, wages: 0, drawings: 0,
    admin: 0, energy: 0, insurance: 0, repairsMaintenance: 0, other: 0,
  };
}

function defaultYear() {
  return {
    commodities: defaultCommodities(), fields: [], sales: [], storages: [],
    movements: [], overheads: defaultOverheads(), invoices: [],
  };
}

function defaultBusinessDetails() {
  return {
    entityName: '', abn: '', ngr: '', contactName: '', phone: '', email: '', address: '',
    paymentTermsDays: 14,
    bankName: '', accountName: '', bsb: '', accountNumber: '',
  };
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
  if (ready) {
    saveState(data).catch((e) => console.error('Local save failed', e));
    schedulePush(() => data, farmId, role);
  }
  listeners.forEach((fn) => fn(data));
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
  if (ready && id) markDeleted(table, id).catch((e) => console.error('Tombstone failed', e));
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

    let loaded = null;
    if (navigator.onLine) {
      try {
        const { state } = await hydrate(farmId);
        // A farm with no seasons yet is a new account, not a failed read.
        loaded = Object.keys(state.years).length ? state : null;
        if (loaded) await saveState(loaded);
      } catch (e) {
        console.warn('Hydrate failed, falling back to the local copy', e);
      }
    }

    if (!loaded) loaded = await loadState();

    if (loaded) {
      data = deriveCounters(loaded);
    } else {
      // Brand new farm: seed the default commodity list so Settings is not
      // an empty screen on day one.
      data = defaultData();
      data.businessDetails = { ...defaultBusinessDetails() };
    }

    ready = true;
    pushOnReconnect(() => data, farmId, role);
    listeners.forEach((fn) => fn(data));
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
   * Replace everything with an imported file. Used by the migration path at
   * step 1.7 — note it goes through persist(), so an import is pushed to the
   * server like any other change rather than needing its own route.
   */
  importJSON(json) {
    data = deriveCounters(JSON.parse(json));
    persist();
  },

  resetAll() {
    data = defaultData();
    persist();
  },
};
