// Inputs and stock: seed, fertiliser, fuel and chemical bought for the farm, and what is left.
//
// Every entry is one of three things:
//   buy     stock came in (a delivery, with what it cost)
//   use     stock went out (sown, spread, burnt, sprayed)
//   adjust  a correction, signed: what a count found against what the book said
//
// What is on hand is simply the sum of those, per product, across every season: stock does not stop at the end of
// the year. A product is a kind (seed, fert, fuel, chem) and a name, and keeps one unit, so tonnes and litres are
// never added together. Pure, so the arithmetic is tested without a screen.

export const KINDS = [
  { key: 'seed', label: 'Seed', plural: 'Seed', unit: 't', hint: 'e.g. Scepter wheat, Planet barley' },
  { key: 'fert', label: 'Fertiliser', plural: 'Fertiliser', unit: 't', hint: 'e.g. Urea, MAP, DAP' },
  { key: 'fuel', label: 'Fuel', plural: 'Fuel', unit: 'L', hint: 'e.g. Diesel' },
  { key: 'chem', label: 'Chemical', plural: 'Chemical', unit: 'L', hint: 'e.g. Glyphosate 450' },
];
export const UNITS = ['t', 'kg', 'L'];
export const MOVE_TYPES = [
  { key: 'buy', label: 'Bought' },
  { key: 'use', label: 'Used' },
  { key: 'adjust', label: 'Count' },
];

const round = (n, dp = 3) => { const k = 10 ** dp; return Math.round((Number(n) || 0) * k) / k; };

export const kindLabel = (key) => KINDS.find((k) => k.key === key)?.label || key;
export const defaultUnit = (key) => KINDS.find((k) => k.key === key)?.unit || 't';

/** Names that differ only by case, spacing or punctuation are the same product. */
export function normName(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}
export const productKey = (kind, product) => `${kind}|${normName(product)}`;

/** What one entry does to the stock: + in, - out. */
export function moveDelta(m) {
  const q = Number(m?.qty) || 0;
  if (m?.type === 'use') return -q;
  if (m?.type === 'adjust') return q;
  return q;
}

/** kg <-> t, and the same unit to itself. Litres only convert to litres; anything else is null. */
export function convert(qty, from, to) {
  if (from === to) return qty;
  if (from === 't' && to === 'kg') return qty * 1000;
  if (from === 'kg' && to === 't') return qty / 1000;
  return null;
}

/**
 * Every product with what is on hand. `moves` is every entry from every season.
 * onHand is in the product's own unit (the unit of its first entry). avgCost is the weighted average of what was
 * paid, per unit, over the deliveries that recorded a price.
 */
export function stockLevels(moves = []) {
  const map = new Map();
  const sorted = [...moves].sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
  for (const m of sorted) {
    if (!String(m.product || '').trim()) continue;
    const key = productKey(m.kind, m.product);
    let p = map.get(key);
    if (!p) {
      p = { key, kind: m.kind, product: String(m.product).trim(), unit: m.unit || defaultUnit(m.kind), onHand: 0, bought: 0, used: 0, adjusted: 0, lastDate: '', paidQty: 0, paid: 0, count: 0 };
      map.set(key, p);
    }
    const q = Number(m.qty) || 0;
    p.count += 1;
    if (m.type === 'buy') {
      p.bought += q;
      if (Number(m.unitCost) > 0) { p.paidQty += q; p.paid += q * Number(m.unitCost); }
    } else if (m.type === 'use') p.used += q;
    else p.adjusted += q;
    p.onHand += moveDelta(m);
    if (String(m.date || '') > p.lastDate) p.lastDate = String(m.date);
  }
  const order = KINDS.map((k) => k.key);
  return [...map.values()]
    .map((p) => ({ ...p, onHand: round(p.onHand), bought: round(p.bought), used: round(p.used), adjusted: round(p.adjusted), avgCost: p.paidQty > 0 ? p.paid / p.paidQty : 0 }))
    .sort((a, b) => (order.indexOf(a.kind) - order.indexOf(b.kind)) || a.product.localeCompare(b.product));
}

/** The entries for one product, newest first. */
export function productMoves(moves, kind, product) {
  const key = productKey(kind, product);
  return moves.filter((m) => productKey(m.kind, m.product) === key)
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
}

/** What the stock is worth, where prices were recorded. */
export function stockValue(levels) {
  return levels.reduce((s, p) => s + (p.onHand > 0 ? p.onHand * p.avgCost : 0), 0);
}

/**
 * What the paddocks call for this season: seed by variety (with the buffer), urea and starter fertiliser, in tonnes.
 * `seedOf(f)` and the like come in from derived.js so this file stays free of imports.
 */
export function plannedNeeds(fields = [], { seedTons, ureaTons, starterTons } = {}) {
  const need = new Map();
  const add = (kind, product, tons) => {
    if (!(tons > 0)) return;
    const key = productKey(kind, product);
    const cur = need.get(key) || { key, kind, product, tons: 0, unit: 't' };
    cur.tons += tons;
    need.set(key, cur);
  };
  for (const f of fields) {
    add('seed', String(f.seedVariety || '').trim() || 'Seed (no variety set)', seedTons ? seedTons(f) : 0);
    add('fert', 'Urea', ureaTons ? ureaTons(f) : 0);
    add('fert', 'Starter fertiliser', starterTons ? starterTons(f) : 0);
  }
  return [...need.values()].map((n) => ({ ...n, tons: round(n.tons) }));
}

/**
 * Each planned need against the stock of the same name: what is on hand (in tonnes), and what is short.
 * A need with no matching product has nothing bought yet.
 */
export function planVsStock(needs, levels) {
  return needs.map((n) => {
    const p = levels.find((l) => l.key === n.key);
    const onHandT = p ? convert(p.onHand, p.unit, 't') : 0;
    const known = p ? onHandT != null : true;
    const have = known ? Math.max(0, onHandT || 0) : 0;
    return { ...n, product: p?.product || n.product, bought: !!p, onHandT: have, shortT: round(Math.max(0, n.tons - have)), unitKnown: known };
  });
}

/** What is wrong with an entry that stops it being saved. */
export function inputProblems(m) {
  const out = [];
  if (!KINDS.some((k) => k.key === m.kind)) out.push('Choose what it is: seed, fertiliser, fuel or chemical.');
  if (!String(m.product || '').trim()) out.push('Name the product.');
  if (!UNITS.includes(m.unit)) out.push('Choose a unit.');
  if (m.type !== 'adjust' && !(Number(m.qty) > 0)) out.push('Enter how much.');
  if (m.type === 'adjust' && !(Number(m.qty) !== 0)) out.push('The count matches the book already: nothing to correct.');
  return out;
}

/** What a stock take of `counted` does against the book: the signed correction. */
export function adjustmentFor(onHand, counted) {
  return round((Number(counted) || 0) - (Number(onHand) || 0));
}

export const qtyText = (n, unit, dp = 1) => `${(Math.round(n * 10 ** dp) / 10 ** dp).toLocaleString('en-AU', { maximumFractionDigits: dp })} ${unit}`;
