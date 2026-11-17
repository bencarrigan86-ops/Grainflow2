// The wording of a confirmation of sale's terms that has some working in it: the quantity tolerance and what each grade of a
// multigrade contract is paid. Pure, so the confirmation (views/contract.js) and its tests share it.

import { num, money } from './fmt.js?v=362';
import { cleanGradeOptions } from './gradeprice.js?v=362';

/**
 * Tolerance in the words the trade uses.
 *
 * Every one of the six says this differently and they all mean the same thing:
 * whichever of the two is smaller. Saying "whichever is the lesser" out loud
 * matters — a reader who has to work out which limit binds is a reader who
 * will assume the one that suits them.
 */
export function toleranceText(sale, unit) {
  const pct = Number(sale.tolerancePct) || 0;
  const cap = Number(sale.toleranceCapTons) || 0;
  if (!pct && !cap) return '';
  if (pct && cap) return `+/- ${num(cap, 0)} ${unit} or ${+pct.toFixed(1)}%, whichever is the lesser`;
  if (pct) return `+/- ${+pct.toFixed(1)}%`;
  return `+/- ${num(cap, 0)} ${unit}`;
}


/**
 * What each grade of a multigrade contract is paid, a line to a grade: the price as it stands, plus a premium written
 * +$10.00 or a discount -$25.00. Empty when the contract lists no grades.
 */
export function gradeTermsLines(sale, perUnit) {
  return cleanGradeOptions(sale.gradeOptions).map((o) => {
    const a = Number(o.adjust) || 0;
    const what = a > 0 ? `+${money(a, 2)} per ${perUnit}` : a < 0 ? `-${money(-a, 2)} per ${perUnit}` : 'the price as above';
    return `${o.grade}: ${what}`;
  });
}


/** The grades a multigrade contract takes, as one line of names: the contract's own grade first, if it is not already listed. */
export function gradeNamesText(sale) {
  const names = cleanGradeOptions(sale.gradeOptions).map((o) => o.grade);
  const own = String(sale.grade || '').trim();
  if (own && names.length && !names.some((n) => n.toLowerCase() === own.toLowerCase())) names.unshift(own);
  return names.join(', ');
}
