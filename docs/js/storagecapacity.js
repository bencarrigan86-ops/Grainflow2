// How much a storage can hold, in tonnes.
//
// A storage can be given a volume in cubic metres. The most it holds is then that volume times the test weight (tonnes per cubic
// metre) of what is in it: the storage's own test weight if one has been set on it, otherwise the commodity's. So the same silo holds
// less canola than wheat, and the room worked out for it follows the commodity put into it.
//
// A storage with no volume keeps the tonnes figure typed on it, as before. Nothing here touches the farm: it only reads.

import { harvestSeasonOf } from './harvestseason.js?v=377';

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

/**
 * The test weight in use for a storage, in tonnes per cubic metre, and where it came from.
 * @param {object} storage
 * @param {object|null|undefined} commodity   the commodity in it now
 * @returns {{value: number, source: 'storage'|'commodity'|'none'}}
 */
export function testWeightInUse(storage, commodity) {
  if (num(storage?.testWeight) > 0) return { value: num(storage.testWeight), source: 'storage' };
  if (num(commodity?.testWeight) > 0) return { value: num(commodity.testWeight), source: 'commodity' };
  return { value: 0, source: 'none' };
}

/**
 * What a storage holds when full.
 * @returns {{tons: number, source: 'volume'|'typed'|'none', testWeight: number, testWeightSource: string}}
 *   'volume': worked out from the volume; 'typed': the tonnes figure entered by hand; 'none': neither is known.
 */
export function capacityInfo(storage, commodity) {
  const tw = testWeightInUse(storage, commodity);
  const volume = num(storage?.volumeM3);
  if (volume > 0 && tw.value > 0) return { tons: volume * tw.value, source: 'volume', testWeight: tw.value, testWeightSource: tw.source };
  const typed = num(storage?.capacityTons);
  if (typed > 0) return { tons: typed, source: 'typed', testWeight: tw.value, testWeightSource: tw.source };
  return { tons: 0, source: 'none', testWeight: tw.value, testWeightSource: tw.source };
}

/** Just the tonnes. */
export function capacityTons(storage, commodity) {
  return capacityInfo(storage, commodity).tons;
}

/** The commodity of a storage, found in the list of commodities. */
export function commodityOf(storage, commodities) {
  return (commodities || []).find((c) => c.id === storage?.commodityId) || null;
}

/** Capacity of a storage when the whole commodity list is to hand. */
export function capacityFor(storage, commodities) {
  return capacityTons(storage, commodityOf(storage, commodities));
}

/**
 * The line shown under the volume field: what the volume comes to, or what is missing.
 * @param {object} storage       as it stands in the form (volumeM3, testWeight, capacityTons)
 * @param {object|null} commodity
 * @param {(n:number, dp?:number)=>string} fmt   number formatter
 */
export function capacityLine(storage, commodity, fmt = (n, dp = 0) => n.toFixed(dp)) {
  const volume = num(storage?.volumeM3);
  if (!(volume > 0)) return '';
  const tw = testWeightInUse(storage, commodity);
  if (!(tw.value > 0)) return 'Pick the commodity in it, or set a test weight below, to see how many tonnes that holds.';
  const what = tw.source === 'storage' ? 'this storage\'s test weight' : `${commodity.name}'s test weight`;
  return `${fmt(volume, 0)} m³ × ${fmt(tw.value, 3)} t/m³ (${what}) = ${fmt(volume * tw.value, 0)} t when full`;
}

/**
 * The commodity an empty silo with no commodity is worked out as: the one picked (by name, so the pick holds from season to season) if
 * it is still there and has a test weight, otherwise the first commodity that has one. Null when no commodity has a test weight.
 */
export function assumedCommodity(commodities, savedName = '', season = null) {
  const usable = assumableCommodities(commodities, season);
  return usable.find((c) => c.name === savedName) || usable[0] || null;
}

/**
 * The commodities with a test weight, which an empty silo can be worked out as. For a season (winter or summer) only that season's, so a
 * winter view does not offer sorghum, unless the farm has none of that season's with a test weight, when all of them are offered.
 */
export function assumableCommodities(commodities, season = null) {
  const usable = (commodities || []).filter((c) => num(c?.testWeight) > 0);
  if (season !== 'winter' && season !== 'summer') return usable;
  const ofSeason = usable.filter((c) => harvestSeasonOf(c) === season);
  return ofSeason.length ? ofSeason : usable;
}

/** Does this storage have a volume but nothing set to say which grain it will hold, and no test weight of its own? */
export function wantsCommodity(storage) {
  return !storage?.commodityId && num(storage?.volumeM3) > 0 && !(num(storage?.testWeight) > 0);
}
