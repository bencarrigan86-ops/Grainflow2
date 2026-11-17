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
    const lint = (m.tos || [])[0];
    if (!lint || lint.type !== 'sale' || lint.id !== sale?.id) continue;
    const all = stdBales(g.lintKg, g.stdBaleKg);
    // the leg is saved to three decimals, so compare at three decimals: a whole run delivered is a whole share
    const share = all > 0 ? Math.min(1, Math.round(num(lint.tons) * 1000) / Math.round(all * 1000)) : 0;
    if (!(share > 0)) continue;
    total += ginInvoice(g).exGst * share;
    bales += num(lint.tons);
    runs += 1;
  }
  return { total: round2(total), bales, runs };
}
