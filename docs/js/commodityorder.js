// The order the farm's commodities are listed in, on every screen that lists them (Position, Production, Storage, Sales, the
// Harvest and Yield reports, the loads filter). One list for the whole farm, kept by commodity name so wheat is wheat in every
// season. With no list set the order is automatic: the most tonnes first. With one, a commodity on the list goes where the list
// puts it, and one that is not on it (a new one) follows the listed ones, the most tonnes first.
//
// The list is a setting of the farm. storage.js hands it over whenever the farm's data is loaded or changed, so the sorts in the
// pure modules (derived.js, harvest.js) need no extra argument. Pure apart from that one remembered list.

let order = [];

/** A commodity's name as the list knows it: case and stray spaces do not matter. */
export const orderKey = (name) => String(name ?? '').trim().toLowerCase();

/** The farm's list, as saved: names, in order. Anything else (nothing saved yet) means automatic. */
export function setCommodityOrder(names) {
  const seen = new Set();
  order = (Array.isArray(names) ? names : []).map(orderKey).filter((k) => k && !seen.has(k) && seen.add(k));
}

export const hasCommodityOrder = () => order.length > 0;

/** Where a name stands: its place on the list, or after every listed one when it is not on it. */
export const rankOf = (name) => {
  const i = order.indexOf(orderKey(name));
  return i < 0 ? order.length : i;
};

/**
 * A sort for commodity lists. On the farm's own list it follows that; otherwise (and among any not on it) the most tonnes
 * first, the same tonnes in name order, so the order is the same every time and does not depend on the order the commodities
 * were saved in. `volume` and `name` say how to read a row.
 */
export const commoditySort = (volume, name = (r) => r.name) => (a, b) => (
  rankOf(name(a)) - rankOf(name(b))
  || (Number(volume(b)) || 0) - (Number(volume(a)) || 0)
  || String(name(a) || '').localeCompare(String(name(b) || ''))
);

/**
 * The names to show in the settings list: the saved order first (those that still exist), then the rest the way the automatic
 * order would have them.
 * @param {string[]} saved  the saved list
 * @param {string[]} names  the farm's commodity names, already in automatic order
 */
export function orderedNames(saved, names) {
  const byKey = new Map(names.map((n) => [orderKey(n), n]));
  const out = [];
  const used = new Set();
  for (const s of Array.isArray(saved) ? saved : []) {
    const k = orderKey(s);
    if (byKey.has(k) && !used.has(k)) { out.push(byKey.get(k)); used.add(k); }
  }
  for (const n of names) if (!used.has(orderKey(n))) { out.push(n); used.add(orderKey(n)); }
  return out;
}

/** Moves the item at `index` one place up (-1) or down (+1). Returns a new list; off either end it is unchanged. */
export function moveName(list, index, by) {
  const to = index + by;
  if (index < 0 || index >= list.length || to < 0 || to >= list.length) return [...list];
  const out = [...list];
  [out[index], out[to]] = [out[to], out[index]];
  return out;
}
