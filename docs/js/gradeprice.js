// Pricing a contract by the grade of each load.
//
// A contract can list several grades, each with a premium or discount in $/t on top of the price. Every
// load delivered to it is paid the price plus the adjustment for its own grade. A load whose grade is not
// listed, or has no grade, is paid the price as it stands.
//
// Pure, and with no imports: derived.js and mapping.js both use it.

const norm = (g) => String(g ?? '').trim().toLowerCase();
const round2 = (n) => Math.round(n * 100) / 100;

/**
 * The listed grades as they are saved: a trimmed grade, no blanks, no repeats (ignoring case, the first
 * one wins), and a number for each adjustment, negative for a discount.
 * @returns {{grade: string, adjust: number}[]}
 */
export function cleanGradeOptions(list) {
  const seen = new Set();
  const out = [];
  for (const o of Array.isArray(list) ? list : []) {
    const grade = String(o?.grade ?? '').trim().slice(0, 40);
    if (!grade || seen.has(norm(grade))) continue;
    seen.add(norm(grade));
    const adjust = Number(o?.adjust);
    out.push({ grade, adjust: Number.isFinite(adjust) ? round2(adjust) : 0 });
  }
  return out;
}

/** Tonnes of a load that went to this contract. */
const tonsToSale = (m, saleId) => (m.tos || [])
  .filter((t) => t.type === 'sale' && t.id === saleId)
  .reduce((s, t) => s + (Number(t.tons) || 0), 0);

/** The $/t a load earns on top of the price, for its grade: nothing if its grade is not listed. */
export function gradeRateFor(sale, movement) {
  const found = cleanGradeOptions(sale?.gradeOptions).find((o) => norm(o.grade) === norm(movement?.grade));
  return found ? found.adjust : 0;
}

/**
 * What the grades delivered so far add to (or take off) the contract.
 *
 * @returns {{
 *   total: number,                                        the dollars, all grades
 *   lines: {grade: string, adjust: number, tons: number, dollars: number}[],   one per listed grade
 *   otherTons: number,                                    delivered at a grade not listed, paid the price as it stands
 * }}
 */
export function gradeAdjustment(sale, movements) {
  const options = cleanGradeOptions(sale?.gradeOptions);
  if (!options.length) return { total: 0, lines: [], otherTons: 0 };
  const lines = options.map((o) => ({ grade: o.grade, adjust: o.adjust, tons: 0, dollars: 0 }));
  let otherTons = 0;
  for (const m of movements || []) {
    const t = tonsToSale(m, sale.id);
    if (!(t > 0)) continue;
    const line = lines.find((l) => norm(l.grade) === norm(m.grade));
    if (line) line.tons += t; else otherTons += t;
  }
  for (const l of lines) l.dollars = l.tons * l.adjust;
  return { total: lines.reduce((s, l) => s + l.dollars, 0), lines, otherTons };
}
