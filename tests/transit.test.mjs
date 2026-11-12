// Run with:
//   node tests/transit.test.mjs
//
// Grain on a truck is counted in an "In transit" store until a ticket is given a silo,
// and each ticket says what it is still waiting for.
import assert from 'node:assert/strict';
import { isTransit, transitName, transitFor, hasQualityRecorded, stageOf, toFinish, STAGES, TRANSIT_LABEL } from '../docs/js/transit.js';
import { storageLedgerStock } from '../docs/js/derived.js';

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); } catch (e) { failures++; console.log(`  FAIL  ${name}\n        ${e.message}`); }
};

const transit = { id: 't-w', kind: 'tally', unitLabel: TRANSIT_LABEL, name: 'In transit · Wheat', commodityId: 'w', openingStock: 0 };
const silo = { id: 's1', kind: 'silo', name: '09 Silo', commodityId: 'w', openingStock: 0 };
const bales = { id: 'b1', kind: 'tally', unitLabel: 'round bales', name: 'SR1 round bales', openingStock: 12 };
const storages = [transit, silo, bales];
const ticket = (extra = {}) => ({ id: 'm', tons: 30, weightStatus: 'estimate', froms: [{ type: 'field', id: 'f', tons: 30 }], tos: [{ type: 'silo', id: 's1', tons: 30 }], ...extra });

console.log('\n=== the in-transit store ===');

check('only the marked tally storage is an in-transit store', () => {
  assert.equal(isTransit(transit), true);
  assert.equal(isTransit({ ...transit, unitLabel: ' In Transit ' }), true);
  assert.equal(isTransit(bales), false, 'an ordinary tally storage is not');
  assert.equal(isTransit(silo), false);
  assert.equal(isTransit(null), false);
});
check('there is one per commodity, found by commodity', () => {
  assert.equal(transitFor(storages, 'w'), transit);
  assert.equal(transitFor(storages, 'b'), null);
  assert.equal(transitFor([{ ...transit, commodityId: null }], null).id, 't-w');
});
check('it is named for the commodity', () => {
  assert.equal(transitName('Wheat'), 'In transit · Wheat');
  assert.equal(transitName(''), 'In transit');
});
check('tonnes sent to it are counted there, and move to the silo when the ticket is given one', () => {
  const m = ticket({ tos: [{ type: 'silo', id: 't-w', tons: 30 }] });
  assert.equal(storageLedgerStock(transit, [m]), 30);
  assert.equal(storageLedgerStock(silo, [m]), 0);
  const allocated = { ...m, tos: [{ type: 'silo', id: 's1', tons: 30 }] };
  assert.equal(storageLedgerStock(transit, [allocated]), 0);
  assert.equal(storageLedgerStock(silo, [allocated]), 30);
});

console.log('\n=== what a ticket is waiting for ===');

check('a ticket with no silo, or one sent to In transit, is waiting for a destination', () => {
  assert.equal(stageOf(ticket({ tos: [] }), storages), 'destination');
  assert.equal(stageOf(ticket({ tos: [{ type: 'silo', id: 't-w', tons: 30 }] }), storages), 'destination');
});
check('then its quality, then its final weight', () => {
  assert.equal(stageOf(ticket(), storages), 'quality');
  assert.equal(stageOf(ticket({ grade: 'APH1' }), storages), 'weight');
  assert.equal(stageOf(ticket({ proteinPct: 11.2 }), storages), 'weight');
  assert.equal(stageOf(ticket({ grade: 'APH1', weightStatus: 'final' }), storages), null);
});
check('a ticket with a final weight is complete, quality or not', () => {
  assert.equal(stageOf(ticket({ weightStatus: 'final' }), storages), null);
});
check('but a final weight does not put grain in a silo: it still needs a destination', () => {
  assert.equal(stageOf(ticket({ weightStatus: 'final', tos: [{ type: 'silo', id: 't-w', tons: 30 }] }), storages), 'destination');
});
check('a delivery straight to a contract has its destination', () => {
  assert.equal(stageOf(ticket({ tos: [{ type: 'sale', id: 'x', tons: 30 }] }), storages), 'quality');
});
check('zero is a measurement, and blanks are not', () => {
  assert.equal(hasQualityRecorded({ screeningsPct: 0 }), true);
  assert.equal(hasQualityRecorded({ grade: '  ', proteinPct: null, moisturePct: '' }), false);
});
check('"to finish" lists the unfinished tickets and nothing else', () => {
  const list = [ticket({ id: 'a' }), ticket({ id: 'b', weightStatus: 'final' }), ticket({ id: 'c', tos: [] })];
  assert.deepEqual(toFinish(list, storages).map((m) => m.id), ['a', 'c']);
});
check('every stage has words for the badge', () => {
  assert.deepEqual(Object.keys(STAGES).sort(), ['destination', 'quality', 'weight']);
});

if (failures) { console.log(`\n${failures} failed`); process.exit(1); }
console.log('\nall passed');
