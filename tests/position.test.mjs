#!/usr/bin/env node
//
// The position screen only needs production to have something to say.
//
//   node tests/position.test.mjs
//
// A new farm — or the sample farm — has production but no contracts and no
// opening stock. That is a position (all of it unsold, at MTM), not an empty
// screen.

import assert from 'node:assert';
import { positionRows, positionAtYield, paddockAtYield, farmProfitLoss } from '../docs/js/derived.js';

const wheat = { id: 'w', name: 'Wheat', mtmPrice: 400, openingStock: 0, retainedSeed: 0, grossMarginCost: 0 };
const barley = { id: 'b', name: 'Barley', mtmPrice: 300, openingStock: 0, retainedSeed: 0, grossMarginCost: 0 };
const commodities = [wheat, barley];

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  ok  ${name}`); } catch (e) { failures++; console.log(`  FAIL ${name}\n       ${e.message}`); }
};

check('production alone, no sales or opening stock, is a position', () => {
  const fields = [{ id: 'f1', commodityId: 'w', areaHa: 100, yieldTHa: 4, yieldMode: 'estimate' }];
  const rows = positionRows(commodities, fields, [], []);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].unsoldTons, 400);
  assert.equal(rows[0].unsoldValue, 160000);
});

check('actual-yield production from movements counts even with no area entered', () => {
  const fields = [{ id: 'f1', commodityId: 'b', areaHa: 0, yieldTHa: 0, yieldMode: 'actual' }];
  const movements = [{ id: 'm1', commodityId: 'b', froms: [{ type: 'field', id: 'f1', tons: 250 }], tos: [{ type: 'storage', id: 's1', tons: 250 }] }];
  const rows = positionRows(commodities, fields, [], movements);
  assert.equal(rows.length, 1, 'barley should appear');
  assert.equal(rows[0].productionTons, 250);
});

check('a commodity with nothing at all is left out', () => {
  const fields = [{ id: 'f1', commodityId: 'w', areaHa: 100, yieldTHa: 4 }];
  assert.deepEqual(positionRows(commodities, fields, [], []).map((r) => r.commodity.id), ['w']);
});

const sensFarm = () => {
  const fields = [{ id: 'f1', commodityId: 'w', areaHa: 100, yieldTHa: 4, yieldMode: 'estimate' }]; // 400 t
  const sales = [{ id: 's1', commodityId: 'w', tons: 300, price: 350, tonsDelivered: 0, freight: 0, leviesPct: 0, premiumDiscount: 0, ginning: 0 }];
  return positionRows(commodities, fields, sales, []);
};

check('yield sensitivity at 0% reproduces the position exactly', () => {
  const base = sensFarm();
  const same = positionAtYield(base, 0);
  assert.equal(same[0].unsoldTons, base[0].unsoldTons);
  assert.equal(same[0].totalValue, base[0].totalValue);
  assert.equal(same[0].grossMargin, base[0].grossMargin);
});

check('a 10% shortfall comes off the unsold grain, not the contracts', () => {
  const base = sensFarm();
  const down = positionAtYield(base, -10)[0];
  assert.equal(down.productionTons, 360);
  assert.equal(down.soldTons, 300, 'contracts are signed tonnages');
  assert.equal(down.soldValue, base[0].soldValue);
  assert.equal(down.unsoldTons, 60);
  assert.equal(down.unsoldValue, 60 * 400);
});

check('a shortfall past what is sold shows as negative unsold, not zero', () => {
  const down = positionAtYield(sensFarm(), -40)[0]; // 240 t produced, 300 sold
  assert.equal(down.unsoldTons, -60);
  assert.ok(down.unsoldValue < 0);
});

check('a paddock at -10%: tons and yield fall, area does not, value follows MTM', () => {
  const f = { id: 'f1', name: 'Boundary', commodityId: 'w', areaHa: 100, yieldTHa: 4, yieldMode: 'estimate' };
  const r = paddockAtYield(f, [], 400, -10);
  assert.equal(r.baseTons, 400);
  assert.equal(r.tons, 360);
  assert.equal(r.areaHa, 100);
  assert.equal(r.yieldTHa, 3.6);
  assert.equal(r.value, 144000);
});

check('paddocks add up to the commodity: the field view and the position view agree', () => {
  const fields = [
    { id: 'a', commodityId: 'w', areaHa: 100, yieldTHa: 4, yieldMode: 'estimate' },
    { id: 'b', commodityId: 'w', areaHa: 50, yieldTHa: 3, yieldMode: 'estimate' },
  ];
  const rows = positionAtYield(positionRows(commodities, fields, [], []), -20);
  const sum = fields.reduce((t, f) => t + paddockAtYield(f, [], 400, -20).tons, 0);
  assert.ok(Math.abs(sum - rows[0].productionTons) < 1e-9, `paddocks ${sum} vs commodity ${rows[0].productionTons}`);
});

console.log('\n=== opening stock carried in from last season ===');

import { closingStock, positionTotals } from '../docs/js/derived.js';

const carry = { ...wheat, openingStock: 500, openingValue: 200000 };   // 500 t that last season closed at $400
const noFields = [];

check('with no opening value, nothing changes', () => {
  const r = positionRows([{ ...wheat, openingStock: 500 }], noFields, [], [])[0];
  assert.equal(r.unsoldTons, 500);
  assert.equal(r.totalValue, 200000);
  assert.equal(r.openingValue, 0);
});
check('the carry-in comes off total value, so income counted last season is not counted again', () => {
  const r = positionRows([carry], noFields, [], [])[0];
  assert.equal(r.unsoldTons, 500, 'the tonnes are still there to sell');
  assert.equal(r.unsoldValue, 200000);
  assert.equal(r.openingValue, 200000);
  assert.equal(r.totalValue, 0, 'unchanged since the close: no new value this season');
});
check('only the change since the close shows: a price rise is this season\'s gain', () => {
  const r = positionRows([{ ...carry, mtmPrice: 440 }], noFields, [], [])[0];
  assert.equal(r.totalValue, 20000);      // 500 t x $40
});
check('a price fall shows as a loss', () => {
  const r = positionRows([{ ...carry, mtmPrice: 380 }], noFields, [], [])[0];
  assert.equal(r.totalValue, -10000);
});
check('carry-in grain sold this season is its sale price less what it was carried at', () => {
  const sale = { id: 's1', commodityId: 'w', tons: 500, price: 450 };
  const r = positionRows([carry], noFields, [sale], [])[0];
  assert.equal(r.soldTons, 500);
  assert.equal(r.unsoldTons, 0);
  assert.equal(r.totalValue, 450 * 500 - 200000);   // $25,000 over what it was carried at
});
check('yield sensitivity keeps the carry-in off, and at 0% still matches the position', () => {
  const rows = positionRows([carry], [{ id: 'f', commodityId: 'w', areaHa: 100, yieldTHa: 4, yieldMode: 'estimate' }], [], []);
  const same = positionAtYield(rows, 0)[0];
  assert.equal(same.totalValue, rows[0].totalValue);
  assert.equal(positionAtYield(rows, -10)[0].totalValue, rows[0].totalValue - 40 * 400);
});
check('totals add the carry-in up across commodities', () => {
  const rows = positionRows([carry, { ...barley, openingStock: 100, openingValue: 30000 }], noFields, [], []);
  assert.equal(positionTotals(rows).openingValue, 230000);
  assert.equal(positionTotals(rows).totalValue, 0);
});
check('a commodity with only an opening value still appears', () => {
  assert.equal(positionRows([{ ...wheat, openingStock: 0, openingValue: 5000 }], noFields, [], []).length, 1);
});

console.log('\n=== last season\'s closing ===');

const lastYear = {
  commodities: [{ id: 'w', name: 'Wheat', mtmPrice: 420, openingStock: 0, retainedSeed: 0, grossMarginCost: 0 }],
  fields: [{ id: 'f', commodityId: 'w', areaHa: 100, yieldTHa: 5, yieldMode: 'estimate' }],   // 500 t grown
  sales: [{ id: 's', commodityId: 'w', tons: 200, price: 400 }],
  movements: [],
};
check('closing stock is what was grown less what was sold, at that season\'s MTM', () => {
  const c = closingStock(lastYear, 'wheat');
  assert.equal(c.tons, 300);
  assert.equal(c.mtm, 420);
  assert.equal(c.value, 126000);
});
check('a commodity the season never had has no closing', () => {
  assert.equal(closingStock(lastYear, 'Barley'), null);
  assert.equal(closingStock(null, 'Wheat'), null);
});

console.log('\n=== saving and loading ===');

import { stateToRows, rowsToState } from '../docs/js/mapping.js';

const FARM = '11111111-1111-4111-8111-111111111111';
const stateWith = (commodity) => ({
  currentYear: '2026',
  years: { 2026: { __seasonId: '22222222-2222-4222-8222-222222222222', commodities: [commodity], fields: [], storages: [], sales: [], movements: [], invoices: [], overheads: {} } },
});
const C = { id: '33333333-3333-4333-8333-333333333333', name: 'Wheat', mtmPrice: 400, openingStock: 500, retainedSeed: 0, grossMarginCost: 0 };
const rowOf = (c) => stateToRows(stateWith(c), FARM).commodities[0];
const backOf = (c) => rowsToState(stateToRows(stateWith(c), FARM)).years['2026'].commodities[0];

check('an opening value goes to its column and comes back', () => {
  assert.equal(rowOf({ ...C, openingValue: 200000 }).opening_stock_value, 200000);
  assert.equal(backOf({ ...C, openingValue: 200000 }).openingValue, 200000);
});
check('with none, no column is sent, so commodities still save before the migration', () => {
  assert.ok(!('opening_stock_value' in rowOf(C)));
  assert.ok(!('openingValue' in backOf(C)));
});
check('a value that was cleared still sends a null/zero, so the clearing reaches the server', () => {
  const r = rowOf({ ...C, openingValue: 0, __hasOpeningValue: true });
  assert.ok('opening_stock_value' in r);
});

check('profit is the season\'s own; with the opening stock put back it is everything the farm holds', () => {
  // 100 t opening stock worth $40,000, plus a 400 t crop at $400 MTM: the $40,000 comes off the crop's value
  const w = { ...wheat, openingStock: 100, openingValue: 40000, grossMarginCost: 30000 };
  const fields = [{ id: 'f1', commodityId: 'w', areaHa: 100, yieldTHa: 4, yieldMode: 'estimate' }];
  const totals = positionTotals(positionRows([w], fields, [], []));
  assert.equal(totals.openingValue, 40000);
  const pl = farmProfitLoss(totals.grossMargin, { wages: 20000 }, totals.openingValue);
  assert.equal(pl.profitLoss, totals.grossMargin - 20000, 'the season\'s profit is unchanged');
  assert.equal(pl.profitWithOpening, pl.profitLoss + 40000);
  assert.equal(pl.openingValue, 40000);
});
check('with no opening stock, the two profit figures are the same', () => {
  const pl = farmProfitLoss(100000, { wages: 20000 });
  assert.equal(pl.profitWithOpening, pl.profitLoss);
  assert.equal(pl.openingValue, 0);
});

if (failures) { console.log(`\n${failures} failed`); process.exit(1); }
console.log('\nposition: ALL PASS');
