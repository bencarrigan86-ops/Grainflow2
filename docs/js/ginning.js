// Ginning cotton: round modules go in, lint bales and seed come out, and the gin sends an invoice for it.
//
// A ginning run is kept on an ordinary movement (modules out of the gin yard, lint and seed out to a storage or a contract),
// with the facts of the run in its `gin` record. Everything is priced on the STANDARD bale, 227 kg (500 lb): the lint
// weight divided by 227, not the count of bales on the pad. 90,273 kg of lint is 397.678 standard bales whether the gin
// pressed 393 bales or 400. The ginning rate, the levies and the seed credit are all per standard bale.
//
// Pure: no imports, no storage, so it can be tested.

export const STD_BALE_KG = 227;

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const round2 = (n) => Math.round(n * 100) / 100;

/** What a run is as saved: numbers as numbers, text trimmed, and a standard bale weight that is never zero. */
/** A bale number as the gin writes it, "BG027234": its letters, its digits and the number they make. */
export function parseBale(no) {
  const m = /^(.*?)([0-9]+)$/.exec(String(no ?? '').trim());
  return m ? { prefix: m[1].toUpperCase(), n: Number(m[2]), width: m[2].length } : null;
}

/** How many bales a first and last number cover, both ends counted: BG027234 to BG027626 is 393. Null when they cannot be a range. */
export function baleRangeCount(from, to) {
  const a = parseBale(from);
  const b = parseBale(to);
  if (!a || !b || a.prefix !== b.prefix || b.n < a.n) return null;
  return b.n - a.n + 1;
}

/**
 * The lint allocations as saved: where to (a contract or a storage), where in the storage, the first and last bale, how many
 * bales and how many kg; blank ones dropped.
 */
export function cleanAllocations(list) {
  if (!Array.isArray(list)) return [];
  return list
    .map((a) => ({
      to: String(a?.to ?? '').trim(),
      baleFrom: String(a?.baleFrom ?? '').trim(), baleTo: String(a?.baleTo ?? '').trim(),
      bales: Math.max(0, Math.round(Number(a?.bales) || 0)),
      location: String(a?.location ?? '').trim(),
      kg: Math.max(0, num(a?.kg)),
    }))
    .filter((a) => a.to || a.baleFrom || a.baleTo || a.bales || a.kg);
}

export function cleanGin(g) {
  if (!g || typeof g !== 'object') return null;
  const text = (v) => String(v ?? '').trim();
  return {
    ginName: text(g.ginName), invoiceNo: text(g.invoiceNo),
    modules: num(g.modules), moduleKg: num(g.moduleKg),
    physicalBales: num(g.physicalBales), lintKg: num(g.lintKg), seedKg: num(g.seedKg),
    stdBaleKg: num(g.stdBaleKg) > 0 ? num(g.stdBaleKg) : STD_BALE_KG,
    baleFrom: text(g.baleFrom), baleTo: text(g.baleTo),
    ginRate: num(g.ginRate), researchLevy: num(g.researchLevy), voluntaryLevy: num(g.voluntaryLevy),
    gstOnGin: g.gstOnGin !== false,
    // who pays the gin: 'us' (a bill), or 'buyer' (the buyer of the lint pays the gin and takes it off the lint payment)
    paidBy: g.paidBy === 'buyer' ? 'buyer' : 'us',
    // where the lint went, by bale range: [{ to: 'sale:<id>' | 'silo:<id>', baleFrom, baleTo, bales }]; and where the seed went
    allocations: cleanAllocations(g.allocations),
    seedTo: text(g.seedTo),
    // the contract with the gin this run was ginned under (gin for seed, or ginning only): the rates came from it
    ...(g.ginContract ? { ginContract: String(g.ginContract) } : {}),
    ...(g.payableId ? { payableId: String(g.payableId) } : {}),
    // which contract's lint payment the gin charges come off, and how much of them: [{ saleId, ginning, levies, gst }] (see splitGinCharge)
    ...(Array.isArray(g.ginSplit) ? { ginSplit: g.ginSplit.filter((s) => s && s.saleId).map((s) => ({ saleId: String(s.saleId), ginning: round2(num(s.ginning)), levies: round2(num(s.levies)), gst: round2(num(s.gst)) })) } : {}),
  };
}

export const hasGin = (m) => !!m?.gin && typeof m.gin === 'object';

/** The lint in standard bales (227 kg each), unrounded as the gin does it. */
export function stdBales(lintKg, stdBaleKg = STD_BALE_KG) {
  const kg = num(lintKg);
  const per = num(stdBaleKg) > 0 ? num(stdBaleKg) : STD_BALE_KG;
  return kg > 0 ? kg / per : 0;
}

/** Lint as a share of the modules ginned: the turnout, in percent. */
export const turnoutPct = (lintKg, moduleKg) => (num(moduleKg) > 0 ? (num(lintKg) / num(moduleKg)) * 100 : 0);

/** Seed in tonnes. */
export const seedTonnes = (seedKg) => num(seedKg) / 1000;

/** Seed per standard bale, in kg: what the run produced for each bale of lint. */
export function seedKgPerBale(lintKg, seedKg, stdBaleKg = STD_BALE_KG) {
  const b = stdBales(lintKg, stdBaleKg);
  return b > 0 ? num(seedKg) / b : 0;
}

/**
 * The gin's invoice for a run. The ginning charge carries GST; the levies (research, and the voluntary Cotton Australia one)
 * do not. `total` is what is paid.
 */
export function ginInvoice(gin) {
  const g = cleanGin(gin) || cleanGin({});
  const bales = stdBales(g.lintKg, g.stdBaleKg);
  const ginning = round2(bales * g.ginRate);
  const research = round2(bales * g.researchLevy);
  const voluntary = round2(bales * g.voluntaryLevy);
  const gst = g.gstOnGin ? round2(ginning * 0.1) : 0;
  const levies = round2(research + voluntary);
  return { bales, ginning, research, voluntary, levies, gst, exGst: round2(ginning + levies), total: round2(ginning + levies + gst) };
}

/** One line to say what a run was, for a list: "18 modules → 393 bales (397.68 std), 99.4 t seed". */
export function describeGin(gin) {
  const g = cleanGin(gin);
  if (!g) return '';
  const bits = [];
  if (g.modules) bits.push(`${g.modules} module${g.modules === 1 ? '' : 's'}`);
  const out = [];
  if (g.lintKg) out.push(`${g.physicalBales ? `${g.physicalBales} bales ` : ''}(${stdBales(g.lintKg, g.stdBaleKg).toFixed(2)} std)`.trim());
  if (g.seedKg) out.push(`${seedTonnes(g.seedKg).toFixed(1)} t seed`);
  return [bits.join(''), out.join(', ')].filter(Boolean).join(' → ');
}

/**
 * The lint of a run that went to a contract: its lots there, with their bale numbers. An older run (saved before lots) has
 * its lint leg first, so that is the whole run.
 */
export function lotsForSale(m, saleId) {
  const g = hasGin(m) ? cleanGin(m.gin) : null;
  if (!g) return [];
  if (g.allocations.length) return allocateLint(g).filter((a) => a.to === `sale:${saleId}`);
  const leg = (m.tos || [])[0];
  if (leg && leg.type === 'sale' && leg.id === saleId) return [{ to: `sale:${saleId}`, bales: g.physicalBales, baleFrom: g.baleFrom, baleTo: g.baleTo, std: num(leg.tons) }];
  return [];
}

/**
 * The gin invoices the buyer of the lint has paid for a contract, one per run whose invoice the buyer pays: the buyer takes
 * them off the payment at the foot of its invoice, GST included. A run delivered in part to this contract counts that share
 * of the gin invoice. A run the farm pays is a bill, not a prepayment, and is left out.
 *
 * @returns {{movementId: string, date: string, ginName: string, invoiceNo: string, std: number, share: number,
 *            ginning: number, levies: number, gst: number, exGst: number, total: number}[]}
 */
export function ginPrepaid(sale, movements) {
  const out = [];
  for (const m of movements || []) {
    const g = hasGin(m) ? cleanGin(m.gin) : null;
    if (!g || g.paidBy !== 'buyer') continue;
    const all = stdBales(g.lintKg, g.stdBaleKg);
    const std = lotsForSale(m, sale?.id).reduce((s, a) => s + a.std, 0);
    // legs are saved to three decimals, so compare at three decimals: a whole run delivered is a whole share
    const share = all > 0 ? Math.min(1, Math.round(std * 1000) / Math.round(all * 1000)) : 0;
    if (!(share > 0)) continue;
    const inv = ginInvoice(g);
    // a run saved with its split says which contract pays it, and how much: one that does not (an older run) is shared by bales
    const mine = Array.isArray(g.ginSplit) ? g.ginSplit.find((s) => s.saleId === sale?.id) : null;
    if (Array.isArray(g.ginSplit) && !mine) continue;
    const ginning = mine ? mine.ginning : round2(inv.ginning * share);
    const levies = mine ? mine.levies : round2(inv.levies * share);
    const gst = mine ? mine.gst : round2(inv.gst * share);
    out.push({ movementId: m.id, date: m.date || '', ginName: g.ginName, invoiceNo: g.invoiceNo, std, share, ginning, levies, gst, exGst: round2(ginning + levies), total: round2(ginning + levies + gst) });
  }
  return out;
}

/**
 * What the buyer of the lint takes off a contract for ginning, in total: ex GST (what comes off the value) and with GST
 * (what comes off the amount paid).
 *
 * @returns {{total: number, totalInclGst: number, bales: number, runs: number}}
 */
export function ginDeduction(sale, movements) {
  const list = ginPrepaid(sale, movements);
  return {
    total: round2(list.reduce((s, p) => s + p.exGst, 0)),
    totalInclGst: round2(list.reduce((s, p) => s + p.total, 0)),
    bales: list.reduce((s, p) => s + p.std, 0),
    runs: list.length,
  };
}

/** The bales in an allocation: what the range says when it is a range, else the count typed. */
export const allocationBales = (a) => baleRangeCount(a?.baleFrom, a?.baleTo) ?? num(a?.bales);

/**
 * Split a run's lint between its destinations. Each allocation's weight is the run's lint weight in proportion to its bales
 * (the gin weighs the run, not every bale; the classing file's own bale weights can replace this later). One allocation with no
 * range takes the whole run. A lot with its own weight typed in (the gin's weight for those bales) uses that instead.
 *
 * @returns {{to: string, bales: number, kg: number, std: number, baleFrom: string, baleTo: string, location: string, weighed: boolean}[]}
 */
export function allocateLint(gin) {
  const g = cleanGin(gin) || cleanGin({});
  const list = g.allocations.length ? g.allocations : [{ to: '', baleFrom: '', baleTo: '', bales: 0, location: '', kg: 0 }];
  const pressed = g.physicalBales || baleRangeCount(g.baleFrom, g.baleTo) || 0;
  return list.map((a) => {
    const whole = list.length === 1 && !allocationBales(a);
    const bales = whole ? pressed : allocationBales(a);
    const weighed = num(a.kg) > 0;
    const kg = weighed ? num(a.kg) : whole ? g.lintKg : pressed > 0 ? g.lintKg * (bales / pressed) : 0;
    return { to: a.to, location: a.location || '', baleFrom: whole ? g.baleFrom : a.baleFrom, baleTo: whole ? g.baleTo : a.baleTo, bales, kg, std: stdBales(kg, g.stdBaleKg), weighed };
  });
}

/**
 * The share of a run that goes to contracts, 0 to 1, by standard bales: what the lint buyer can take off its payment. The rest (the
 * bale shed, a store) is not on any buyer's invoice.
 */
export function contractShare(gin) {
  const lots = allocateLint(gin);
  const all = lots.reduce((s, a) => s + a.std, 0);
  const sold = lots.filter((a) => String(a.to).startsWith('sale:')).reduce((s, a) => s + a.std, 0);
  return all > 0 ? Math.min(1, Math.round((sold / all) * 1e6) / 1e6) : 0;
}

/**
 * Which lint contract pays the gin for a run the lint buyer pays. The first contract the lint goes to normally pays all of it, as
 * long as the lint it gets from this run is worth enough to cover it; what it cannot cover goes to the next contract, and so on.
 * Only the part of the run that goes to contracts is charged (the rest, in a store, is not on anyone's invoice). A contract with no
 * price on it is taken to cover whatever is left.
 *
 * @param {object} gin  the run's gin
 * @param {{id: string, price?: number}[]} sales  the contracts, to value the lint each gets
 * @returns {{saleId: string, ginning: number, levies: number, gst: number, std: number}[]}
 */
export function splitGinCharge(gin, sales = []) {
  const g = cleanGin(gin) || cleanGin({});
  const inv = ginInvoice(g);
  const part = contractShare(g);
  const std = new Map();
  for (const a of allocateLint(g)) {
    if (!String(a.to).startsWith('sale:') || !(a.std > 0)) continue;
    const id = String(a.to).slice(5);
    std.set(id, (std.get(id) || 0) + a.std);
  }
  let ginning = round2(inv.ginning * part);
  let levies = round2(inv.levies * part);
  let gst = round2(inv.gst * part);
  const out = [];
  for (const [id, bales] of std) {
    const left = round2(ginning + levies);
    if (!(left > 0)) break;
    const price = num((sales || []).find((s) => s.id === id)?.price);
    const cap = price > 0 ? round2(bales * price) : Infinity;
    const take = Math.min(left, cap);
    const f = take >= left ? 1 : take / left;
    const row = f === 1 ? { ginning, levies, gst } : { ginning: round2(ginning * f), levies: round2(levies * f), gst: round2(gst * f) };
    out.push({ saleId: id, ...row, std: bales });
    ginning = round2(ginning - row.ginning); levies = round2(levies - row.levies); gst = round2(gst - row.gst);
  }
  return out;
}

/** Things wrong with how a run's bales were allocated, in words; none when it adds up. */
export function allocationProblems(gin) {
  const g = cleanGin(gin) || cleanGin({});
  const out = [];
  const pressed = g.physicalBales;
  const runCount = baleRangeCount(g.baleFrom, g.baleTo);
  if (runCount !== null && pressed && runCount !== pressed) out.push(`The run's bale range is ${runCount} bales but ${pressed} were pressed.`);
  const runFrom = parseBale(g.baleFrom);
  const spans = [];
  for (const a of g.allocations) {
    if (a.baleFrom && a.baleTo) {
      const c = baleRangeCount(a.baleFrom, a.baleTo);
      if (c === null) { out.push(`${a.baleFrom} to ${a.baleTo} is not a bale range.`); continue; }
      if (a.bales && a.bales !== c) out.push(`${a.baleFrom} to ${a.baleTo} is ${c} bales, not ${a.bales}.`);
      const f = parseBale(a.baleFrom);
      const l = parseBale(a.baleTo);
      spans.push({ a: f.n, b: l.n, label: `${a.baleFrom} to ${a.baleTo}` });
      const runTo = parseBale(g.baleTo);
      if (runFrom && runTo && f.prefix === runFrom.prefix && (f.n < runFrom.n || l.n > runTo.n)) out.push(`${a.baleFrom} to ${a.baleTo} is outside this run (${g.baleFrom} to ${g.baleTo}).`);
    }
  }
  const sorted = [...spans].sort((x, y) => x.a - y.a);
  for (let i = 1; i < sorted.length; i += 1) if (sorted[i].a <= sorted[i - 1].b) out.push(`${sorted[i - 1].label} and ${sorted[i].label} overlap.`);
  const sum = allocateLint(g).reduce((s, a) => s + a.bales, 0);
  if (pressed && g.allocations.length && sum !== pressed) out.push(`${sum} of the ${pressed} bales are allocated.`);
  // when lots have their own weights, they should add up to the run's lint weight (a few kg either way is rounding)
  if (g.lintKg > 0 && g.allocations.some((a) => num(a.kg) > 0)) {
    const kg = allocateLint(g).reduce((s, a) => s + a.kg, 0);
    if (Math.abs(kg - g.lintKg) > 5) out.push(`${Math.round(kg).toLocaleString('en-AU')} kg of the ${Math.round(g.lintKg).toLocaleString('en-AU')} kg of lint is allocated.`);
  }
  return out;
}

/** Cotton comes off the gin pad within this many days of ginning. */
export const PAD_DAYS = 7;

/** The date (YYYY-MM-DD) the bales of a run should be off the gin pad by: seven days after it was ginned. '' when there is no date. */
export function padOffBy(date, days = PAD_DAYS) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(date ?? ''));
  if (!m) return '';
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// --- The cotton position: lint, seed and ginning as three values ---------------------------------------------------------
//
// A cotton commodity is valued as three separate components: the lint (bales at the contract prices and the MTM price, as
// for any commodity), the seed (tonnes at a seed MTM price) and the ginning (a cost, per standard bale, with the levies).
// Seed and ginning exist from the first bale, before any contract or gin invoice, so they are estimated from per-bale
// settings and replaced by the real figures (the seed weighed and the gin invoiced) as runs are logged.

/** About 0.245 t of seed for every 227 kg bale of lint, when no figure has been set. */
export const SEED_FACTOR_DEFAULT = 0.245;

/** The cotton settings on a commodity: seed price ($/t), seed per bale (t), ginning ($/bale), levies ($/bale), turnout (%) and the average module weight (kg). */
export function cleanCotton(x) {
  if (!x || typeof x !== 'object') return null;
  return { seedMtm: num(x.seedMtm), seedFactor: num(x.seedFactor), ginRate: num(x.ginRate), levies: num(x.levies), turnout: num(x.turnout), moduleKg: num(x.moduleKg) };
}

export const hasCotton = (x) => { const c = cleanCotton(x); return !!c && (c.seedMtm > 0 || c.seedFactor > 0 || c.ginRate > 0 || c.levies > 0 || c.turnout > 0 || c.moduleKg > 0); };

/** What the logged ginning runs of a commodity add up to: standard bales, seed tonnes and the gin invoices (ex GST). */
export function cottonRunTotals(movements, commodityId) {
  let bales = 0;
  let seedT = 0;
  let exGst = 0;
  let runs = 0;
  for (const m of movements || []) {
    if (!hasGin(m) || (commodityId && m.commodityId !== commodityId)) continue;
    const g = cleanGin(m.gin);
    bales += stdBales(g.lintKg, g.stdBaleKg);
    seedT += seedTonnes(g.seedKg);
    exGst += ginInvoice(g).exGst;
    runs += 1;
  }
  return { bales, seedT, exGst: round2(exGst), runs };
}

/**
 * The seed and the ginning for `bales` standard bales: what the ginned runs really came to, plus the bales not yet ginned at
 * the per-bale settings. Seed is valued at the seed MTM price; ginning is a cost (ginning plus levies, ex GST), and counts
 * whoever pays the gin, since it is real money out of the crop.
 */
export function cottonComponents(settings, bales, ginned = { bales: 0, seedT: 0, exGst: 0 }) {
  const c = cleanCotton(settings) || cleanCotton({});
  const total = Math.max(0, num(bales));
  const done = Math.min(total, num(ginned.bales));
  const left = Math.max(0, total - done);
  const factor = c.seedFactor > 0 ? c.seedFactor : SEED_FACTOR_DEFAULT;
  const seedT = num(ginned.seedT) + left * factor;
  return {
    bales: total, ginnedBales: done, unginnedBales: left, seedFactor: factor,
    seedT, seedMtm: c.seedMtm, seedValue: seedT * c.seedMtm,
    ginningCost: num(ginned.exGst) + left * (c.ginRate + c.levies),
    ginned: { bales: num(ginned.bales), seedT: num(ginned.seedT), exGst: num(ginned.exGst) },
  };
}

// --- Modules: cotton picked into round modules and carted from the paddock to the gin yard ----------------------------------
//
// A module move is an ordinary movement: out of a paddock, into the gin yard (a tally storage counting modules), with the
// facts of the move on its `modules` record. The paddock leg is in estimated standard bales (the paddock's production is
// in bales), worked out from the modules' weight and the turnout until the gin weighs the lint; the yard leg is in modules,
// which the ginning run later takes out of the yard.

/** Lint as a share of the picked cotton when no turnout has been set, in percent. */
export const DEFAULT_TURNOUT = 40;

/** What a module move is as saved: the modules, their weight, the turnout used, and the bales that gives. */
export function cleanModules(x) {
  if (!x || typeof x !== 'object') return null;
  // a load from more than one paddock says how many modules, how much weight and how many bales came from each
  const fields = Array.isArray(x.fields)
    ? x.fields.filter((f) => f && f.id && num(f.count) > 0).map((f) => ({ id: String(f.id), count: num(f.count), kg: num(f.kg), bales: num(f.bales) }))
    : [];
  return { count: num(x.count), kg: num(x.kg), turnoutPct: num(x.turnoutPct), estBales: num(x.estBales), ...(fields.length > 1 ? { fields } : {}) };
}

export const hasModules = (m) => !!m?.modules && typeof m.modules === 'object';

/**
 * The paddocks a load of modules came from, one entry each: modules, weight and estimated bales. A load from one paddock is the
 * whole load; a load from several says how it was shared (modules.fields). A load with no paddock leg is none.
 * @returns {{fieldId: string, count: number, kg: number, bales: number}[]}
 */
export function moduleLegs(m) {
  if (!hasModules(m)) return [];
  const list = Array.isArray(m.modules.fields) ? m.modules.fields.filter((f) => f && f.id && num(f.count) > 0) : [];
  if (list.length > 1) return list.map((f) => ({ fieldId: String(f.id), count: num(f.count), kg: num(f.kg), bales: num(f.bales) }));
  const from = (m.froms || []).find((l) => l.type === 'field')?.id;
  return from ? [{ fieldId: from, count: num(m.modules.count), kg: num(m.modules.kg), bales: num(m.modules.estBales) }] : [];
}

/**
 * Share a load's modules, weight and bales between the paddocks it came from. The weight goes by what each paddock's modules are
 * estimated to weigh (its kilograms a module), so a weighbridge weight typed for the whole load is split the way the estimate would
 * have been; where no module weights are known it goes by the number of modules. The shares add back to the load.
 * @param {{id: string, count: number}[]} rows one entry for each paddock
 * @param {(fieldId: string) => number} avgKgFor kilograms a module on that paddock, 0 when not known
 * @returns {{id: string, count: number, kg: number, bales: number}[]}
 */
export function shareLoad(rows, totalKg, totalBales, avgKgFor) {
  const merged = [];
  for (const r of rows) {
    const same = merged.find((m) => m.id === r.id);
    if (same) same.count += r.count; else merged.push({ id: r.id, count: r.count });
  }
  const est = merged.map((m) => m.count * (avgKgFor(m.id) || 0));
  const estTotal = est.reduce((s, v) => s + v, 0);
  const countTotal = merged.reduce((s, m) => s + m.count, 0);
  const shares = merged.map((m, i) => (estTotal > 0 ? est[i] / estTotal : countTotal > 0 ? m.count / countTotal : 0));
  return merged.map((m, i) => ({ id: m.id, count: m.count, kg: Math.round(totalKg * shares[i]), bales: Math.round(totalBales * shares[i] * 1000) / 1000 }));
}

/** Standard bales the picked cotton will gin out to: its weight, times the turnout, over the standard bale. */
export function estimateBales(kg, turnoutPct, stdBaleKg = STD_BALE_KG) {
  const per = num(stdBaleKg) > 0 ? num(stdBaleKg) : STD_BALE_KG;
  return num(kg) > 0 && num(turnoutPct) > 0 ? (num(kg) * num(turnoutPct)) / 100 / per : 0;
}

/** One line for a list: "18 modules, 222,230 kg, about 397.7 bales". */
export function describeModules(mod) {
  const x = cleanModules(mod);
  if (!x) return '';
  const bits = [];
  if (x.count) bits.push(`${x.count} module${x.count === 1 ? '' : 's'}`);
  if (x.kg) bits.push(`${Math.round(x.kg).toLocaleString('en-AU')} kg`);
  if (x.estBales) bits.push(`about ${x.estBales.toFixed(1)} bales`);
  return bits.join(', ');
}
