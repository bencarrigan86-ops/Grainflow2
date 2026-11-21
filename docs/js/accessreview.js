// The access review: what a person will be able to open, said back to the owner before an invitation is made or a level is changed.
//
// It is read from the same table the how-to guide shows (helpcontent.js, as the farm's own switches and per-area levels have
// changed it: effectiveAccess), so what is listed here is what the app and the database will actually allow, and never a second
// copy that could drift. Pure, so it can be tested without a browser.

import { ACCESS, LEVELS, ROLE_INFO, effectiveAccess } from './helpcontent.js?v=513';
import { readSwitches, readLevels } from './farmswitches.js?v=513';

/**
 * @param {string} role   the role being given
 * @param {object} rawSwitches   the farm's saved switches (db.getBusinessDetails().switches)
 * @param {{canWriteProduction?: boolean}} [opts]
 * @returns {{role: string, label: string, summary: string, only: string, can: object[], cannot: object[], extras: string[]}}
 *   `can` holds every area they can open, in the order of the table, with the level in words; `cannot` the areas that are not theirs.
 */
export function accessReview(role, rawSwitches, { canWriteProduction = false } = {}) {
  const rows = effectiveAccess(readSwitches(rawSwitches), readLevels(rawSwitches));
  const info = ROLE_INFO.find((r) => r.role === role);
  const can = [];
  const cannot = [];
  for (const r of rows) {
    const level = r[role] || 'none';
    if (level === 'none' || !LEVELS[level]) { cannot.push({ key: r.key, area: r.area, hint: r.hint }); continue; }
    can.push({ key: r.key, area: r.area, hint: r.hint, level, levelLabel: LEVELS[level].label, short: LEVELS[level].short });
  }
  const extras = [];
  if (canWriteProduction && (role === 'farm_worker' || role === 'driver')) extras.push('They can also record production: yields and fertiliser, as well as their own loads.');
  return { role, label: info?.label || role, summary: info?.summary || '', only: info?.only || '', can, cannot, extras };
}

/** Every area of the app is either in `can` or in `cannot`: nothing is left unsaid. */
export const REVIEW_AREAS = ACCESS.length;
