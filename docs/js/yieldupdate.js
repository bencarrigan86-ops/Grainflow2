// Moving the paddocks that are still on an estimate to a new default yield.
//
// A commodity has a default yield estimate that new paddocks start from. When it is changed (a better season looks likely, a dry one
// does not), the paddocks already set up keep the old figure, one by one. This finds the ones that are still only an estimate (not
// an actual from the loads, not a figure from the farm's records, not a harvest that is finished) and works out what changing them
// would do, so the person is told before anything is touched. Pure: it reads paddocks and says what would change.

const round3 = (v) => Math.round(v * 1000) / 1000;

/** A paddock whose yield is still a guess: of this commodity, estimate mode, and not yet harvested in full. */
export function onEstimate(field, commodityId) {
  if (!field || field.commodityId !== commodityId) return false;
  const mode = field.yieldMode || 'estimate';
  return mode === 'estimate' && !field.harvestDone;
}

/**
 * What setting those paddocks to `newYield` t/ha would do.
 * @returns {{changes: {id: string, name: string, from: number, to: number}[], count: number, same: number, areaHa: number,
 *            tonsBefore: number, tonsAfter: number, finished: number}}
 *   `changes` are the paddocks that would move; `same` are on an estimate already at that figure; `finished` are paddocks of the
 *   commodity left alone because their harvest is finished or their yield is a real figure.
 */
export function planYieldUpdate(fields, commodityId, newYield) {
  const to = round3(Number(newYield) || 0);
  const ofCommodity = (fields || []).filter((f) => f.commodityId === commodityId);
  const mine = ofCommodity.filter((f) => onEstimate(f, commodityId));
  const changes = [];
  let same = 0;
  let areaHa = 0;
  let tonsBefore = 0;
  let tonsAfter = 0;
  for (const f of mine) {
    const area = Number(f.areaHa) || 0;
    const from = round3(Number(f.yieldTHa) || 0);
    if (from === to) { same += 1; continue; }
    changes.push({ id: f.id, name: f.name || 'Unnamed', from, to });
    areaHa += area;
    tonsBefore += area * from;
    tonsAfter += area * to;
  }
  return { changes, count: changes.length, same, areaHa, tonsBefore, tonsAfter, finished: ofCommodity.length - mine.length };
}
