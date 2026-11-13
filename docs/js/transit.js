// Grain on a truck that has not been put in a silo yet, and what a ticket is still waiting for.
//
// A truck leaves the paddock with a ticket long before anyone knows which silo it
// will tip into. Rather than let those tonnes belong nowhere, they go to an
// "In transit" store — one per commodity — which is an ordinary tally storage with a
// marker. It keeps a running balance, so what is on trucks is always counted, and
// allocating a ticket is just changing its destination from In transit to a silo.
//
// The marker is the tally storage's own unit label rather than a new storage type:
// the database accepts it as it is, so nothing can be refused (and a device left
// unable to send) because a rule on the server has not been updated yet.
//
// Pure functions over plain records.

export const TRANSIT_LABEL = 'in transit';

/** Is this storage the in-transit store for some commodity? */
export const isTransit = (s) => !!s && s.kind === 'tally'
  && String(s.unitLabel ?? '').trim().toLowerCase() === TRANSIT_LABEL;

/** "In transit · Wheat", or just "In transit" for grain with no commodity. */
export const transitName = (commodityName) => (commodityName ? `In transit · ${commodityName}` : 'In transit');

/** The in-transit store for a commodity, if there is one yet. */
export const transitFor = (storages, commodityId) =>
  (storages || []).find((s) => isTransit(s) && (s.commodityId || null) === (commodityId || null)) || null;

/** Has a grade or any measurement been recorded on this ticket? */
export function hasQualityRecorded(m) {
  if (String(m?.grade ?? '').trim()) return true;
  return ['moisturePct', 'proteinPct', 'screeningsPct', 'testWeightKgHl', 'fallingNumber', 'oilPct']
    .some((k) => m?.[k] !== undefined && m?.[k] !== null && m?.[k] !== '');
}

export const STAGES = {
  destination: 'Destination needed',
  quality: 'Quality needed',
  weight: 'Weight needed',
};

/**
 * What a ticket is still waiting for, in the order it is usually done: a silo to go
 * into, its quality at the weighbridge, then the final weight after tipping. Null
 * when the ticket is complete.
 *
 * A ticket whose weight is final is complete whatever else is missing — it is the
 * last thing done, and a load brought in from a weighbridge file has its weight
 * final from the start. A ticket that has nowhere to go (no destination at all, or
 * the in-transit store) is waiting for a destination first.
 */
export function stageOf(m, storages) {
  const tos = m?.tos || [];
  const inTransit = tos.length === 0 || tos.some((t) => t.type === 'silo' && isTransit((storages || []).find((s) => s.id === t.id)));
  if (inTransit) return 'destination';
  if (m.weightStatus === 'final') return null;
  return hasQualityRecorded(m) ? 'weight' : 'quality';
}

/** Tickets that are not complete. */
export const toFinish = (movements, storages) => (movements || []).filter((m) => stageOf(m, storages));
