// Combining two paddocks into one.
//
// The weighbridge records "W3/4" as a single paddock and the app, until now,
// held W3 and W4 separately. Rather than make every load from there a guess
// about which half it came out of, the two are merged: the loads that were
// carted from either now say they came from the combined paddock, the area is
// the sum, and the second paddock goes.
//
// Pure functions over plain records, so what is kept and what is lost can be
// stated and tested. The save itself is db.mergeFields().
//
// What happens to each part of a paddock:
//
//   name          the one the person types
//   area          added together
//   yield         the area-weighted average of the two estimates, so the
//                 combined paddock produces what the two would have
//   urea          the applications from both are kept, in date order
//   everything    the kept paddock's own: soil test, urea required, seed,
//   else          starter, commodity, whether tonnes come from loads. The
//                 other paddock's values for these are dropped — two sets of
//                 rates cannot be averaged into something meaningful — and the
//                 confirmation says so before anything happens.

const num = (v) => Number(v) || 0;
const round = (n, dp) => Math.round(n * 10 ** dp) / 10 ** dp;

/**
 * @returns {object} the merged paddock: the kept one, updated
 */
export function mergeFieldRecords(keep, drop, name) {
  const a = num(keep.areaHa);
  const b = num(drop.areaHa);
  const area = a + b;
  const yieldTHa = area > 0 ? (a * num(keep.yieldTHa) + b * num(drop.yieldTHa)) / area : num(keep.yieldTHa);
  const applications = [...(keep.ureaApplications || []), ...(drop.ureaApplications || [])]
    .sort((x, y) => String(x.date || '').localeCompare(String(y.date || '')));
  const notes = [keep.notes, drop.notes].map((n) => String(n || '').trim()).filter(Boolean);
  return {
    ...keep,
    name: String(name ?? '').trim() || keep.name,
    areaHa: round(area, 4),
    yieldTHa: round(yieldTHa, 4),
    ureaApplications: applications,
    notes: [...new Set(notes)].join(' · '),
  };
}

/**
 * Point every load that was carted from `fromId` at `toId` instead.
 *
 * @returns {{movements: object[], changed: string[]}} every movement (changed
 *   ones as copies; the rest untouched) and the ids of those that changed
 */
export function repointLoads(movements, fromId, toId) {
  const changed = [];
  const out = movements.map((m) => {
    const hit = (m.froms || []).some((l) => l.type === 'field' && l.id === fromId);
    if (!hit) return m;
    changed.push(m.id);
    return { ...m, froms: m.froms.map((l) => (l.type === 'field' && l.id === fromId ? { ...l, id: toId } : l)) };
  });
  return { movements: out, changed };
}

/** What the confirmation shows before the merge happens. */
export function describeMerge(keep, drop, movements, name) {
  const merged = mergeFieldRecords(keep, drop, name);
  const { changed } = repointLoads(movements, drop.id, keep.id);
  return {
    name: merged.name,
    areaHa: merged.areaHa,
    yieldTHa: merged.yieldTHa,
    loadsMoved: changed.length,
    droppedName: drop.name,
    // Rates on the dropped paddock that will not carry across, so they can be named.
    losing: [
      num(drop.ureaRequiredKgHa) && num(drop.ureaRequiredKgHa) !== num(keep.ureaRequiredKgHa) ? 'urea required' : null,
      drop.seedVariety && drop.seedVariety !== keep.seedVariety ? 'seed variety' : null,
      num(drop.seedRateKgHa) && num(drop.seedRateKgHa) !== num(keep.seedRateKgHa) ? 'seed rate' : null,
      num(drop.soilTestNKgHa) && num(drop.soilTestNKgHa) !== num(keep.soilTestNKgHa) ? 'soil test N' : null,
      num(drop.starterRequiredKgHa) && num(drop.starterRequiredKgHa) !== num(keep.starterRequiredKgHa) ? 'starter rate' : null,
    ].filter(Boolean),
  };
}
