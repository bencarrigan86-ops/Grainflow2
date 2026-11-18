// The four cotton contracts. A lint sale and a seed sale outright are ordinary contracts (lint on the bale commodity, seed on
// the cottonseed commodity in tonnes). The other two are with the gin, and are measured in standard bales ginned:
//   'ginforseed': the seed is sold to the gin and the ginning is charged on the same contract. The price is the seed value per
//                 bale; the ginning is a cost per bale, so the two net out to an amount per bale. The gin pays the farmer the seed
//                 value, and the gin invoice is paid by the lint buyer out of the lint payment (see the gin run).
//   'ginning':    ginning only: a place to mark the gin's rates and what the ginning cost. The seed is kept or sold on its own.

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

export const COTTON_KINDS = [
  { value: 'lint', label: 'Lint sale' },
  { value: 'ginforseed', label: 'Gin for seed (seed sold, ginning netted)' },
  { value: 'ginning', label: 'Ginning only' },
];

/** The kind of a contract: 'lint' unless it says it is one of the two with the gin. */
export const cottonKind = (sale) => (sale?.cottonKind === 'ginforseed' || sale?.cottonKind === 'ginning' ? sale.cottonKind : 'lint');

/** A contract with the gin (gin for seed, or ginning only) rather than a sale of lint. */
export const isGinContract = (sale) => cottonKind(sale) !== 'lint';

/** The gin's charges on a contract: ginning and the two levies, per standard bale, and whether the ginning carries GST. */
export function cleanCottonTerms(t) {
  if (!t || typeof t !== 'object') return null;
  const out = { ginRate: Math.max(0, num(t.ginRate)), researchLevy: Math.max(0, num(t.researchLevy)), voluntaryLevy: Math.max(0, num(t.voluntaryLevy)), gstOnGin: t.gstOnGin !== false };
  return out.ginRate || out.researchLevy || out.voluntaryLevy ? out : null;
}

/** Ginning plus levies for one standard bale, ex GST. */
export const ginCostPerBale = (sale) => { const t = cleanCottonTerms(sale?.cottonTerms); return t ? round2(t.ginRate + t.researchLevy + t.voluntaryLevy) : 0; };

/**
 * What a gin-for-seed contract nets per bale: the seed value less the ginning and levies. The gin pays the seed value, the
 * lint buyer pays the ginning, so this is what the bale is worth to the farm after the gin has been paid.
 */
export const netPerBale = (sale) => round2(num(sale?.price) - ginCostPerBale(sale));

/** The cost of ginning `bales` standard bales on this contract, ex GST and with it. */
export function ginCostFor(sale, bales) {
  const t = cleanCottonTerms(sale?.cottonTerms);
  if (!t) return { exGst: 0, gst: 0, total: 0 };
  const b = num(bales);
  const ginning = round2(b * t.ginRate);
  const levies = round2(b * (t.researchLevy + t.voluntaryLevy));
  const gst = t.gstOnGin ? round2(ginning * 0.1) : 0;
  return { exGst: round2(ginning + levies), gst, total: round2(ginning + levies + gst) };
}

/** The gin contracts of a farm, for choosing one on a ginning run. */
export const ginContracts = (sales) => (sales || []).filter((s) => isGinContract(s) && !s.paid);

/** One line for a card or a list: what kind of contract it is and what it nets or costs a bale. */
export function kindSummary(sale) {
  const k = cottonKind(sale);
  if (k === 'lint') return '';
  if (k === 'ginning') return `Ginning ${ginCostPerBale(sale) > 0 ? `$${ginCostPerBale(sale).toFixed(2)}` : ''} a bale`.replace('  ', ' ').trim();
  return `Seed $${num(sale.price).toFixed(2)} less ginning $${ginCostPerBale(sale).toFixed(2)} = $${netPerBale(sale).toFixed(2)} a bale`;
}
