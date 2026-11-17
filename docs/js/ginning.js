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

/** The lint allocations as saved: where to, the first and last bale, and how many; blank ones dropped. */
export function cleanAllocations(list) {
  if (!Array.isArray(list)) return [];
  return list
    .map((a) => ({
      to: String(a?.to ?? '').trim(),
      baleFrom: String(a?.baleFrom ?? '').trim(), baleTo: String(a?.baleTo ?? '').trim(),
      bales: Math.max(0, Math.round(Number(a?.bales) || 0)),
    }))
    .filter((a) => a.to || a.baleFrom || a.baleTo || a.bales);
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
    ...(g.payableId ? { payableId: String(g.payableId) } : {}),
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
 * What the buyer of the lint takes off a contract for ginning: for each run whose gin invoice the buyer pays, the ginning and
 * the levies (ex GST) in proportion to the bales of that run delivered to the contract. A run the farm pays is a bill, not
 * a deduction, and is left out. The lint leg is the run's first destination.
 *
 * @returns {{total: number, bales: number, runs: number}}
 */
export function ginDeduction(sale, movements) {
  let total = 0;
  let bales = 0;
  let runs = 0;
  for (const m of movements || []) {
    const g = hasGin(m) ? cleanGin(m.gin) : null;
    if (!g || g.paidBy !== 'buyer') continue;
    const all = stdBales(g.lintKg, g.stdBaleKg);
    // what went to this contract: the allocations that name it, or (a run saved before there were any) the first leg
    const legs = g.allocations.length
      ? allocateLint(g).filter((a) => a.to === `sale:${sale?.id}`).map((a) => a.std)
      : [(m.tos || [])[0]].filter((l) => l && l.type === 'sale' && l.id === sale?.id).map((l) => num(l.tons));
    const std = legs.reduce((s, x) => s + x, 0);
    // legs are saved to three decimals, so compare at three decimals: a whole run delivered is a whole share
    const share = all > 0 ? Math.min(1, Math.round(std * 1000) / Math.round(all * 1000)) : 0;
    if (!(share > 0)) continue;
    total += ginInvoice(g).exGst * share;
    bales += std;
    runs += 1;
  }
  return { total: round2(total), bales, runs };
}

/** The bales in an allocation: what the range says when it is a range, else the count typed. */
export const allocationBales = (a) => baleRangeCount(a?.baleFrom, a?.baleTo) ?? num(a?.bales);

/**
 * Split a run's lint between its destinations. Each allocation's weight is the run's lint weight in proportion to its bales
 * (the gin weighs the run, not every bale; the classing file's own bale weights can replace this later). One allocation with no
 * range takes the whole run.
 *
 * @returns {{to: string, bales: number, kg: number, std: number, baleFrom: string, baleTo: string}[]}
 */
export function allocateLint(gin) {
  const g = cleanGin(gin) || cleanGin({});
  const list = g.allocations.length ? g.allocations : [{ to: '', baleFrom: '', baleTo: '', bales: 0 }];
  const pressed = g.physicalBales || baleRangeCount(g.baleFrom, g.baleTo) || 0;
  return list.map((a) => {
    const whole = list.length === 1 && !allocationBales(a);
    const bales = whole ? pressed : allocationBales(a);
    const kg = pressed > 0 ? g.lintKg * (bales / pressed) : 0;
    return { to: a.to, baleFrom: whole ? g.baleFrom : a.baleFrom, baleTo: whole ? g.baleTo : a.baleTo, bales, kg, std: stdBales(kg, g.stdBaleKg) };
  });
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
  return out;
}

// --- The cotton position: lint, seed and ginning as three values ---------------------------------------------------------
//
// A cotton commodity is valued as three separate components: the lint (bales at the contract prices and the MTM price, as
// for any commodity), the seed (tonnes at a seed MTM price) and the ginning (a cost, per standard bale, with the levies).
// Seed and ginning exist from the first bale, before any contract or gin invoice, so they are estimated from per-bale
// settings and replaced by the real figures (the seed weighed and the gin invoiced) as runs are logged.

/** About 0.245 t of seed for every 227 kg bale of lint, when no figure has been set. */
export const SEED_FACTOR_DEFAULT = 0.245;

/** The cotton settings on a commodity: seed price ($/t), seed per bale (t), ginning ($/bale) and levies ($/bale). */
export function cleanCotton(x) {
  if (!x || typeof x !== 'object') return null;
  return { seedMtm: num(x.seedMtm), seedFactor: num(x.seedFactor), ginRate: num(x.ginRate), levies: num(x.levies) };
}

export const hasCotton = (x) => { const c = cleanCotton(x); return !!c && (c.seedMtm > 0 || c.seedFactor > 0 || c.ginRate > 0 || c.levies > 0); };

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
