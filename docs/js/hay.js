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

/** The records of bales baled on a paddock as saved: id, date, a label for the cut or run, bales and their estimated weight (kg). */
export function cleanBaled(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((b) => b && typeof b === 'object' && num(b.bales) > 0)
    .map((b) => ({ id: String(b.id || ''), date: String(b.date || ''), label: String(b.label || '').trim(), bales: num(b.bales), kg: num(b.kg) }));
}

/** A load, or a move out of a paddock, carries its bales as `hay`: { bales, kg }. */
export function cleanHayLoad(x) {
  if (!x || typeof x !== 'object') return null;
  return { bales: num(x.bales), kg: num(x.kg) };
}
export const hasHayLoad = (m) => !!m?.hay && typeof m.hay === 'object' && num(m.hay.bales) > 0;

/** Bales baled on a paddock, moved off it and still on it; and the weight those come to. */
export function baledTotals(field, movements) {
  const list = cleanBaled(field?.balesBaled);
  const baled = list.reduce((s, b) => s + b.bales, 0);
  const kg = list.reduce((s, b) => s + b.kg, 0);
  let moved = 0;
  let movedKg = 0;
  for (const m of movements || []) {
    if (!hasHayLoad(m)) continue;
    if ((m.froms || []).some((l) => l.type === 'field' && l.id === field?.id)) { moved += num(m.hay.bales); movedKg += num(m.hay.kg); }
  }
  const inField = Math.max(0, baled - moved);
  const share = baled > 0 ? Math.min(1, inField / baled) : 0;
  return { baled, moved, inField, kg, movedKg, inFieldKg: kg * share };
}

/** The average weight of a bale on a paddock (kg): what was baled on it, otherwise the commodity's setting, otherwise 0. */
export function avgBaleKg(field, commodity) {
  const t = baledTotals(field, []);
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
