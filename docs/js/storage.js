const KEY = 'grainflow.v1';

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

const DEFAULT_COMMODITIES = [
  { name: 'Wheat', angleOfRepose: 24, testWeight: 0.82 },
  { name: 'Barley', angleOfRepose: 27, testWeight: 0.69 },
  { name: 'Chickpeas', angleOfRepose: 28, testWeight: 0.76 },
  { name: 'Faba Beans', angleOfRepose: 25, testWeight: 0.785 },
  { name: 'Canola', angleOfRepose: 26, testWeight: 0.67 },
  { name: 'Sorghum', angleOfRepose: 24, testWeight: 0.77 },
].map((c) => ({
  id: uid(),
  mtmPrice: 0,
  openingStock: 0,
  retainedSeed: 0,
  ...c,
}));

function defaultData() {
  return {
    version: 1,
    commodities: DEFAULT_COMMODITIES,
    fields: [],
    sales: [],
    storages: [],
    movements: [],
  };
}

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultData();
    const parsed = JSON.parse(raw);
    return { ...defaultData(), ...parsed };
  } catch (e) {
    console.error('Failed to load data, resetting.', e);
    return defaultData();
  }
}

let data = load();
const listeners = new Set();

function persist() {
  localStorage.setItem(KEY, JSON.stringify(data));
  listeners.forEach((fn) => fn(data));
}

export const db = {
  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  get() {
    return data;
  },

  // --- commodities ---
  upsertCommodity(commodity) {
    if (commodity.id) {
      const idx = data.commodities.findIndex((c) => c.id === commodity.id);
      if (idx >= 0) data.commodities[idx] = { ...data.commodities[idx], ...commodity };
    } else {
      data.commodities.push({
        mtmPrice: 0, openingStock: 0, retainedSeed: 0, ...commodity, id: uid(),
      });
    }
    persist();
  },
  deleteCommodity(id) {
    data.commodities = data.commodities.filter((c) => c.id !== id);
    persist();
  },

  // --- fields (production) ---
  upsertField(field) {
    if (field.id) {
      const idx = data.fields.findIndex((f) => f.id === field.id);
      if (idx >= 0) data.fields[idx] = { ...data.fields[idx], ...field };
    } else {
      data.fields.push({ ...field, id: uid() });
    }
    persist();
  },
  deleteField(id) {
    data.fields = data.fields.filter((f) => f.id !== id);
    persist();
  },

  // --- sales ---
  upsertSale(sale) {
    if (sale.id) {
      const idx = data.sales.findIndex((s) => s.id === sale.id);
      if (idx >= 0) data.sales[idx] = { ...data.sales[idx], ...sale };
    } else {
      data.sales.push({ ...sale, id: uid() });
    }
    persist();
  },
  deleteSale(id) {
    data.sales = data.sales.filter((s) => s.id !== id);
    persist();
  },

  // --- storages (silos / bunkers) ---
  upsertStorage(storage) {
    if (storage.id) {
      const idx = data.storages.findIndex((s) => s.id === storage.id);
      if (idx >= 0) data.storages[idx] = { ...data.storages[idx], ...storage };
    } else {
      data.storages.push({ ...storage, id: uid() });
    }
    persist();
  },
  deleteStorage(id) {
    data.storages = data.storages.filter((s) => s.id !== id);
    persist();
  },

  // --- movements (truck tickets) ---
  upsertMovement(movement) {
    if (movement.id) {
      const idx = data.movements.findIndex((m) => m.id === movement.id);
      if (idx >= 0) data.movements[idx] = { ...data.movements[idx], ...movement };
    } else {
      data.movements.push({ ...movement, id: uid() });
    }
    persist();
  },
  deleteMovement(id) {
    data.movements = data.movements.filter((m) => m.id !== id);
    persist();
  },

  exportJSON() {
    return JSON.stringify(data, null, 2);
  },
  importJSON(json) {
    const parsed = JSON.parse(json);
    data = { ...defaultData(), ...parsed };
    persist();
  },
  resetAll() {
    data = defaultData();
    persist();
  },
};

export { uid };
