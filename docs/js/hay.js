// Hay: sold in tonnes, but counted in physical bales as well.
//
// Each hay type (Lucerne, oaten hay, wheaten hay, barley straw, wheat straw ...) is its own commodity, so it has its own price,
// costs, yield and contracts. A commodity is hay when it has `hay` settings: the kind of bale and its average weight. The ledger,
// the contracts and the invoices stay in tonnes. A paddock logs the bales baled on it, a load carries the number of bales as well
// as its tonnes, and the weight is an estimate (bales times the average bale weight) until the weighbridge weight is typed in.
//
// Pure functions over plain records. The screens are in views/balesbaled.js and views/settings.js.

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

export const BALE_TYPES = [
  { value: 'round', label: 'Round bales' },
  { value: 'large', label: 'Large square bales' },
  { value: 'small', label: 'Small square bales' },
];

/** The hay settings on a commodity: the kind of bale and its average weight (kg). Null when there are none. */
export function cleanHay(x) {
  if (!x || typeof x !== 'object') return null;
  const baleType = BALE_TYPES.some((b) => b.value === x.baleType) ? x.baleType : '';
  return { baleType, baleKg: num(x.baleKg) };
}

/** Has this commodity been set up as hay? */
export const hasHay = (x) => { const h = cleanHay(x); return !!h && (h.baleType !== '' || h.baleKg > 0); };

/** Is this commodity hay? */
export const isHay = (commodity) => hasHay(commodity?.hay);

/** What a bale count is worth in tonnes at an average bale weight (kg). */
export const balesToTons = (bales, baleKg) => (num(bales) * num(baleKg)) / 1000;

/** "Round bales, about 500 kg": for a list or a hint. */
export function describeBaleSetting(x) {
  const h = cleanHay(x);
  if (!h) return '';
  const type = BALE_TYPES.find((b) => b.value === h.baleType)?.label || '';
  return [type, h.baleKg > 0 ? `about ${num(h.baleKg).toLocaleString('en-AU')} kg` : ''].filter(Boolean).join(', ');
}

/**
 * The records of bales baled on a paddock as saved: id, date, a label for the cut or run, bales and their estimated weight (kg).
 * `commodityId` says which hay type the bales are when it is not the paddock's own: straw baled behind the header on a wheat
 * paddock is its own commodity (wheat straw), on the same ground as the crop. Blank means the paddock's own commodity.
 */
export function cleanBaled(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((b) => b && typeof b === 'object' && num(b.bales) > 0)
    .map((b) => ({ id: String(b.id || ''), date: String(b.date || ''), label: String(b.label || '').trim(), bales: num(b.bales), kg: num(b.kg), ...(b.commodityId ? { commodityId: String(b.commodityId) } : {}) }));
}

/**
 * A load of hay carries its bales as `hayLoad`: { bales, kg }, and `use` when the hay was used on the farm rather than sold or
 * moved on ("Fed to cattle"): that load leaves the stock and goes nowhere.
 */
export function cleanHayLoad(x) {
  if (!x || typeof x !== 'object') return null;
  const use = String(x.use ?? '').trim();
  return { bales: num(x.bales), kg: num(x.kg), ...(use ? { use } : {}) };
}
/** Does this movement carry bales (or say it was used on the farm)? */
export const hasHayLoad = (m) => !!m?.hayLoad && typeof m.hayLoad === 'object' && (num(m.hayLoad.bales) > 0 || !!String(m.hayLoad.use ?? '').trim());
/** Was this hay used on the farm: out of the stock, to no contract and no other store? */
export const isUsedOnFarm = (m) => !!m?.hayLoad && typeof m.hayLoad === 'object' && !!String(m.hayLoad.use ?? '').trim();

/** Is this bale record, or load, of this hay type? A blank type is the paddock's own commodity. */
export const isOwnType = (field, id) => !id || id === field?.commodityId;

/**
 * Bales baled on a paddock, moved off it and still on it; and the weight those come to. With `commodityId` only that hay type
 * counts (the straw on a wheat paddock, apart from anything else baled there); without it, the paddock's own type.
 */
export function baledTotals(field, movements, commodityId = field?.commodityId) {
  const same = (id) => (commodityId === field?.commodityId ? isOwnType(field, id) : id === commodityId);
  const list = cleanBaled(field?.balesBaled).filter((b) => same(b.commodityId));
  const baled = list.reduce((s, b) => s + b.bales, 0);
  const kg = list.reduce((s, b) => s + b.kg, 0);
  let moved = 0;
  let movedKg = 0;
  for (const m of movements || []) {
    if (!hasHayLoad(m) || !same(m.commodityId)) continue;
    if ((m.froms || []).some((l) => l.type === 'field' && l.id === field?.id)) { moved += num(m.hayLoad.bales); movedKg += num(m.hayLoad.kg); }
  }
  const inField = Math.max(0, baled - moved);
  const share = baled > 0 ? Math.min(1, inField / baled) : 0;
  return { baled, moved, inField, kg, movedKg, inFieldKg: kg * share };
}

/** The average weight of a bale on a paddock (kg): what was baled on it, otherwise the commodity's setting, otherwise 0. */
export function avgBaleKg(field, commodity) {
  const t = baledTotals(field, [], commodity?.id ?? field?.commodityId);
  if (t.baled > 0 && t.kg > 0) return t.kg / t.baled;
  return num(commodity?.hay?.baleKg);
}

/** "120 bales, 62.4 t": one line for a list. */
export function describeBales(bales, kg) {
  const b = num(bales);
  if (!(b > 0)) return '';
  const bits = [`${b.toLocaleString('en-AU', { maximumFractionDigits: 0 })} bale${b === 1 ? '' : 's'}`];
  if (num(kg) > 0) bits.push(`${(num(kg) / 1000).toLocaleString('en-AU', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} t`);
  return bits.join(', ');
}

/**
 * Hay that is not the paddock's own crop: straw baled behind the header, kept as its own commodity. For one hay type, the tonnes
 * baled across the farm's other paddocks, the bales, and the ground it came off (borrowed from the crop, so it is shown for a
 * yield but never added to the farm's area again).
 *
 * @returns {{tons: number, bales: number, area: number, fieldCount: number}}
 */
export function secondaryHay(commodityId, fields) {
  let kg = 0;
  let bales = 0;
  let area = 0;
  let fieldCount = 0;
  for (const f of fields || []) {
    if (!commodityId || f.commodityId === commodityId) continue;
    const list = cleanBaled(f.balesBaled).filter((b) => b.commodityId === commodityId);
    if (!list.length) continue;
    fieldCount += 1;
    area += num(f.areaHa);
    list.forEach((b) => { bales += b.bales; kg += b.kg; });
  }
  return { tons: kg / 1000, bales, area, fieldCount };
}

/** The hay types baled on a paddock that are not its own commodity (ids). */
export const secondaryTypes = (field) => [...new Set(cleanBaled(field?.balesBaled).map((b) => b.commodityId).filter((id) => id && id !== field?.commodityId))];

/** Bales in a store: bales loaded in less bales loaded out, over every movement that carried a bale count. */
export function balesInStorage(storageId, movements) {
  let bales = 0;
  let kg = 0;
  for (const m of movements || []) {
    if (!hasHayLoad(m)) continue;
    const b = num(m.hayLoad.bales);
    const w = num(m.hayLoad.kg);
    if ((m.tos || []).some((l) => l.type === 'silo' && l.id === storageId)) { bales += b; kg += w; }
    if ((m.froms || []).some((l) => l.type === 'silo' && l.id === storageId)) { bales -= b; kg -= w; }
  }
  return { bales, kg };
}

/** Tonnes used on the farm for a commodity: loads that left the stock for no contract and no store. */
export const usedOnFarmTons = (commodityId, movements) => (movements || [])
  .filter((m) => isUsedOnFarm(m) && (!commodityId || m.commodityId === commodityId))
  .reduce((s, m) => s + num(m.tons), 0);
