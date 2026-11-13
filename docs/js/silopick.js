// Which silos a movement offers, once a commodity has been chosen.
//
// Taking grain out of a silo, only a silo that holds that commodity makes sense. Putting grain
// into one, a silo that holds it or any silo that is empty, whatever it last held. A silo with
// no commodity set that still has grain tracked in it is neither: nothing says what it holds.
//
// Pure. The screen decides what to draw; this decides who is on the list.

import { storageLedgerStock } from './derived.js';

// Under this many tonnes a silo counts as empty, as a rounding crumb is not grain.
const EMPTY_T = 0.05;

/**
 * @param {object[]} storages
 * @param {string} commodityId   '' means no commodity chosen: every silo is offered
 * @param {{movements?: object[], to?: boolean, keep?: string[]}} opts
 *   to    - the silos a load can go into, which also include empty ones
 *   keep  - silos already on the ticket, which stay on the list so an old ticket does not lose them
 */
export function pickableSilos(storages, commodityId, { movements = [], to = false, keep = [] } = {}) {
  return (storages || []).filter((s) => {
    if (keep.includes(s.id)) return true;
    if (!commodityId) return true;
    // an empty silo can take any grain, whatever it last held
    if (to && storageLedgerStock(s, movements) <= EMPTY_T) return true;
    return !!s.commodityId && s.commodityId === commodityId;
  });
}
