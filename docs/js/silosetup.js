// Setting the silos up for a new season: which still hold last season's grain,
// and which are to be emptied.
//
// At the turn of a season most silos are empty and a few are not, and the app
// has to be told which is which — otherwise the empty ones carry last year's
// stock figure and the new season's loads are added on top of it. Doing that one
// silo at a time is thirty-odd sheets. This takes the list the way it is said
// out loud ("Wheat: Kot03, Kot04, Kot05 / Barley Kot01 / Faba Beans: 43, 42…"),
// works out which silo each name is, and proposes what to do with every silo,
// for the person to review before anything changes.
//
// Pure functions: text and records in, proposals out. The screen that applies
// them is views/silosetup.js.

import { matchSiloByNumber } from './loadimport.js?v=234';

/**
 * Read "Commodity: silo, silo, silo" lines.
 *
 * Forgiving about how it is written: the commodity may be followed by a colon,
 * a comma or just a space, and silos may be separated by commas, semicolons or
 * "and". A silo is found by what it is called ("Kot03" is "Kot 3") or, for a
 * numbered silo, by its number ("43" is "43 Silo").
 *
 * Nothing that cannot be matched is guessed at; it is returned so it can be
 * shown, because a silo left out by mistake keeps last season's stock.
 *
 * @returns {{
 *   entries: {commodityId: string, storageId: string, token: string}[],
 *   unmatched: string[],       names that matched no silo
 *   unknownLines: string[],    lines that did not start with a commodity
 * }}
 */
export function parseCarryOver(text, commodities, storages) {
  const entries = [];
  const unmatched = [];
  const unknownLines = [];
  // Longest name first, so "Faba Beans" is not read as a commodity called "Faba".
  const byLength = [...commodities].sort((a, b) => b.name.length - a.name.length);

  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const lower = line.toLowerCase();
    const commodity = byLength.find((c) => c.name && lower.startsWith(c.name.toLowerCase()));
    if (!commodity) { unknownLines.push(line); continue; }

    const rest = line.slice(commodity.name.length).replace(/^[\s:,\-–]+/, '');
    const tokens = rest.split(/\s*(?:,|;|&|\band\b)\s*/i).map((t) => t.trim()).filter(Boolean);
    for (const token of tokens) {
      const hit = matchSiloByNumber(token, storages);
      if (hit) { entries.push({ commodityId: commodity.id, storageId: hit.id, token }); continue; }
      // "Kot03 Kot04" with nothing between them: try each word, but only if all of them match.
      const words = token.split(/\s+/);
      const each = words.length > 1 ? words.map((w) => matchSiloByNumber(w, storages)) : [];
      if (each.length && each.every(Boolean)) {
        each.forEach((h, i) => entries.push({ commodityId: commodity.id, storageId: h.id, token: words[i] }));
      } else unmatched.push(token);
    }
  }
  return { entries, unmatched, unknownLines };
}

/** What a silo is left as once it has been emptied. */
const EMPTY_QUALITY = { cropYear: '', grade: '', moisturePct: null, proteinPct: null, screeningsPct: null, testWeightKgHl: null, fallingNumber: null };

/**
 * The change for one silo.
 *
 *   carry  keeps its stock and gets the commodity and the crop year. Nothing
 *          else about it is touched — its measurements and quality stay.
 *   clear  is emptied: no opening stock, no grain height (no filled length for a
 *          bunker), no quality recorded and, unless told otherwise, no commodity.
 *   leave  is not changed at all.
 *
 * @returns {object|null} fields to save, or null for "leave"
 */
export function patchFor(storage, decision, { cropYear = '', clearCommodity = true } = {}) {
  if (!decision || decision.action === 'leave') return null;
  if (decision.action === 'carry') {
    return { commodityId: decision.commodityId || storage.commodityId || null, cropYear: String(cropYear).trim() };
  }
  const patch = { openingStock: 0, ...EMPTY_QUALITY };
  if (storage.kind === 'silo') patch.currentHeight = 0;
  if (storage.kind === 'bunker') patch.length = 0;
  if (clearCommodity) patch.commodityId = null;
  return patch;
}

/**
 * Starting decisions after a list has been read: the silos named carry over with
 * the commodity they were named under, and — if asked — every other silo is
 * cleared. Without that, the others are left alone.
 *
 * @returns {Record<string, {action: 'carry'|'clear'|'leave', commodityId?: string}>}
 */
export function decisionsFromList(storages, entries, { clearOthers = true } = {}) {
  const out = {};
  for (const s of storages) out[s.id] = { action: clearOthers ? 'clear' : 'leave' };
  for (const e of entries) out[e.storageId] = { action: 'carry', commodityId: e.commodityId };
  return out;
}

/** A summary of what applying the decisions would do. */
export function summarise(storages, decisions, options) {
  const count = { carry: 0, clear: 0, leave: 0 };
  const stockCleared = [];
  for (const s of storages) {
    const d = decisions[s.id] || { action: 'leave' };
    count[d.action] += 1;
    if (d.action === 'clear' && Number(s.openingStock) > 0) stockCleared.push({ name: s.name, openingStock: Number(s.openingStock) });
  }
  return { ...count, stockCleared, changes: patchesFor(storages, decisions, options).length };
}

/** Every silo that will change, with the fields to save. */
export function patchesFor(storages, decisions, options) {
  return storages
    .map((s) => ({ storage: s, patch: patchFor(s, decisions[s.id], options) }))
    .filter((x) => x.patch);
}
