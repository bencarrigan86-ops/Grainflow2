// Run with:
//   node tests/carryover.test.mjs
//
// Contracts from last season that still have grain to go: offered, copied across, and
// counted into the opening stock without counting the income twice.
import assert from 'node:assert/strict';
import {
  previousYear, carryCandidates, buildCarriedSale, carriedNote, carriedIntoNote, openingEffect, appendNote, CARRY_MARK,
} from '../docs/js/carryover.js';
import { position } from '../docs/js/derived.js';

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); } catch (e) { failures++; console.log(`  FAIL  ${name}\n        ${e.message}`); }
};

const wheat25 = { id: 'w25', name: 'Wheat', mtmPrice: 420 };
const barley25 = { id: 'b25', name: 'Barley', mtmPrice: 300 };
const wheat26 = { id: 'w26', name: 'wheat ', mtmPrice: 0, openingStock: 0, retainedSeed: 0, grossMarginCost: 0 };
const northbound = {
  id: 's1', commodityId: 'w25', buyer: 'Northbound Commodities', contractNo: 'NBC-8820', grade: 'APW1',
  tons: 600, price: 400, freight: 20, tolerancePct: 5, deliveryPeriod: 'Jan–Feb', notes: 'Ring to book the trucks',
  documents: [{ id: 'd1', fileName: 'contract.pdf' }], __termsId: 'terms-1', tonsDelivered: 0,
};
const kurrajong = { id: 's2', commodityId: 'w25', buyer: 'Kurrajong Milling', contractNo: 'KM-2208', tons: 800, price: 380 };
const done = { id: 's3', commodityId: 'b25', buyer: 'Coastal Feeds', contractNo: 'CF-1', tons: 300, price: 300 };
// Kurrajong has had 500 t delivered; Coastal has had all 300 t
const trucks = [
  { id: 'm1', tos: [{ type: 'sale', id: 's2', tons: 500 }] },
  { id: 'm2', tos: [{ type: 'sale', id: 's3', tons: 300 }] },
];
const prev = { sales: [northbound, kurrajong, done], movements: trucks, commodities: [wheat25, barley25] };
const cur = { sales: [], commodities: [wheat26] };

console.log('\n=== which contracts are offered ===');

check('the previous season is the latest one before this one', () => {
  assert.equal(previousYear(['2024', '2025', '2026'], '2026'), '2025');
  assert.equal(previousYear(['2026'], '2026'), null);
  assert.equal(previousYear(['2025', '2026'], '2025'), null);
});
check('only contracts with grain still to go are offered, with what has been delivered', () => {
  const list = carryCandidates(prev, cur, '2025');
  assert.deepEqual(list.map((c) => c.sale.id), ['s1', 's2'], 'the fully delivered one is left out');
  assert.equal(list[0].toGo, 600);
  assert.equal(list[1].delivered, 500);
  assert.equal(list[1].toGo, 300);
});
check('the value is the tonnes to go at the price net of freight, as the contract is valued', () => {
  const c = carryCandidates(prev, cur, '2025')[0];
  assert.equal(c.priceExFarm, 380);        // 400 less 20 freight
  assert.equal(c.value, 600 * 380);
});
check('it is put under the new season\'s matching commodity, whatever the spelling', () => {
  assert.equal(carryCandidates(prev, cur, '2025')[0].targetCommodityId, 'w26');
});
check('a commodity the new season does not have is reported, not guessed', () => {
  const c = carryCandidates({ ...prev, sales: [{ ...northbound, commodityId: 'b25' }] }, cur, '2025')[0];
  assert.equal(c.targetCommodityId, null);
  assert.ok(c.problem);
});

console.log('\n=== the copy ===');

check('every term is copied, for the tonnes still to go, with nothing delivered', () => {
  const copy = buildCarriedSale(northbound, { commodityId: 'w26', tons: 400, prevLabel: '2025' });
  assert.equal(copy.buyer, 'Northbound Commodities');
  assert.equal(copy.contractNo, 'NBC-8820');
  assert.equal(copy.price, 400);
  assert.equal(copy.freight, 20);
  assert.equal(copy.tolerancePct, 5);
  assert.equal(copy.deliveryPeriod, 'Jan–Feb');
  assert.equal(copy.tons, 400);
  assert.equal(copy.tonsDelivered, 0);
  assert.equal(copy.commodityId, 'w26');
});
check('nothing that identifies the old record, and no documents, come with it', () => {
  const copy = buildCarriedSale(northbound, { commodityId: 'w26', tons: 400, prevLabel: '2025' });
  assert.ok(!('id' in copy));
  assert.ok(!('documents' in copy));
  assert.ok(!('__termsId' in copy));
});
check('the copy is its own record: changing it does not touch the original', () => {
  const copy = buildCarriedSale(northbound, { commodityId: 'w26', tons: 400, prevLabel: '2025' });
  copy.price = 1;
  assert.equal(northbound.price, 400);
});
check('the new contract says where it came from, and keeps the old notes', () => {
  const note = carriedNote('2025', northbound, 400);
  assert.ok(note.startsWith(`${CARRY_MARK} 2025: 400 t still to deliver of 600 t contracted.`));
  assert.ok(note.includes('Ring to book the trucks'));
  assert.equal(carriedIntoNote('2026', 400, '2026-11-12'), 'Carried into 2026: 400 t, on 2026-11-12.');
  assert.equal(appendNote('', 'x'), 'x');
  assert.equal(appendNote('a', 'b'), 'a\nb');
});

console.log('\n=== not offered twice ===');

check('a contract already brought across is marked, and no longer offered as new', () => {
  const brought = buildCarriedSale(northbound, { commodityId: 'w26', tons: 600, prevLabel: '2025' });
  const list = carryCandidates(prev, { sales: [{ ...brought, id: 'new1' }], commodities: [wheat26] }, '2025');
  assert.equal(list[0].alreadyBrought, true);
  assert.equal(list[1].alreadyBrought, false);
});
check('a 2026 contract with the same buyer and number that was not carried is flagged as a possible duplicate', () => {
  const typedIn = { id: 'x', commodityId: 'w26', buyer: 'northbound commodities', contractNo: 'nbc-8820', tons: 600, notes: '' };
  const c = carryCandidates(prev, { sales: [typedIn], commodities: [wheat26] }, '2025')[0];
  assert.equal(c.alreadyBrought, false);
  assert.equal(c.possibleDuplicate, true);
});

console.log('\n=== the opening stock ===');

check('what is added to each commodity is the tonnes and the value of the contracts picked', () => {
  const picks = [{ commodityId: 'w26', tons: 600, value: 228000 }, { commodityId: 'w26', tons: 300, value: 114000 }, { commodityId: 'b26', tons: 50, value: 15000 }];
  const effect = openingEffect(picks);
  assert.deepEqual(effect.get('w26'), { tons: 900, value: 342000 });
  assert.deepEqual(effect.get('b26'), { tons: 50, value: 15000 });
});
check('with the tonnes and value in the opening stock, bringing a contract across adds no income to the new season', () => {
  // 2026 before: nothing. After: the contract copied in, and its tonnes and value in the opening stock.
  const copy = { ...buildCarriedSale(northbound, { commodityId: 'w26', tons: 600, prevLabel: '2025' }), id: 'n1' };
  const commodity = { ...wheat26, name: 'Wheat', mtmPrice: 380, openingStock: 600, openingValue: 600 * 380 };
  const row = position([commodity], [], [copy], [])[0];
  assert.equal(row.soldValue, 600 * 380, 'the contract is a sale of 600 t');
  assert.equal(row.unsoldTons, 0, 'and the 600 t are spoken for');
  assert.equal(row.totalValue, 0, 'but the value is taken off again, so the new season shows no new income');
});
check('with the tonnes in the opening stock but no value, the contract would count its income a second time', () => {
  const copy = { ...buildCarriedSale(northbound, { commodityId: 'w26', tons: 600, prevLabel: '2025' }), id: 'n1' };
  const commodity = { ...wheat26, name: 'Wheat', mtmPrice: 380, openingStock: 600, openingValue: 0 };
  const row = position([commodity], [], [copy], [])[0];
  assert.equal(row.totalValue, 600 * 380, 'income of $228,000 that 2025 already counted, with nothing to take it off');
});

console.log('\n=== is the grain already in the opening stock? ===');

import { openingChange } from '../docs/js/carryover.js';

check('a candidate carries the closing MTM of its commodity from the season it came from', () => {
  assert.equal(carryCandidates(prev, cur, '2025')[0].closingMtm, 420);
});
check('"add": the tonnes and their value at the contract price', () => {
  assert.deepEqual(openingChange({ tons: 600, priceExFarm: 380, closingMtm: 372 }, 'add'), { tons: 600, value: 228000 });
});
check('"value": no tonnes, and the value moves by the contract price against the market price on those tonnes', () => {
  assert.deepEqual(openingChange({ tons: 600, priceExFarm: 380, closingMtm: 372 }, 'value'), { tons: 0, value: 4800 });
  // a contract below market lowers the value
  assert.deepEqual(openingChange({ tons: 600, priceExFarm: 360, closingMtm: 372 }, 'value'), { tons: 0, value: -7200 });
});
check('"none" changes nothing', () => {
  assert.deepEqual(openingChange({ tons: 600, priceExFarm: 380, closingMtm: 372 }, 'none'), { tons: 0, value: 0 });
  assert.deepEqual(openingChange({ tons: 600, priceExFarm: 380, closingMtm: 372 }, ''), { tons: 0, value: 0 });
});
check('a stocktake that already includes the committed grain: adjusting the value alone leaves 2026 with no new income', () => {
  // 1,000 t physically in the silos, of which 600 t is committed to a contract at $380 net. The stock was
  // valued at the 2025 closing market price of $372 — all 1,000 t at the same figure.
  const stocktake = 1000 * 372;
  const adjust = openingChange({ tons: 600, priceExFarm: 380, closingMtm: 372 }, 'value');
  const copy = { ...buildCarriedSale(northbound, { commodityId: 'w26', tons: 600, prevLabel: '2025' }), id: 'n1' };
  const commodity = { ...wheat26, name: 'Wheat', mtmPrice: 372, openingStock: 1000 + adjust.tons, openingValue: stocktake + adjust.value };
  const row = position([commodity], [], [copy], [])[0];
  assert.equal(row.unsoldTons, 400, '600 t of the 1,000 t is spoken for');
  assert.equal(commodity.openingValue, 400 * 372 + 600 * 380, 'worth 400 t at market and 600 t at the contract price');
  assert.equal(row.totalValue, 0, 'so the new season shows nothing new until prices move');
});
check('adding the tonnes as well would count them twice', () => {
  const copy = { ...buildCarriedSale(northbound, { commodityId: 'w26', tons: 600, prevLabel: '2025' }), id: 'n1' };
  const added = openingChange({ tons: 600, priceExFarm: 380, closingMtm: 372 }, 'add');
  const commodity = { ...wheat26, name: 'Wheat', mtmPrice: 372, openingStock: 1000 + added.tons, openingValue: 1000 * 372 + added.value };
  const row = position([commodity], [], [copy], [])[0];
  assert.equal(row.unsoldTons, 1000, 'the silos hold 1,000 t but the books now say 1,000 t is left after selling 600');
});

if (failures) { console.log(`\n${failures} failed`); process.exit(1); }
console.log('\nall passed');
