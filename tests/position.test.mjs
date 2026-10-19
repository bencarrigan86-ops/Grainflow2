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
import { positionRows, positionAtYield, paddockAtYield } from '../docs/js/derived.js';

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

if (failures) { console.log(`\n${failures} failed`); process.exit(1); }
console.log('\nposition: ALL PASS');
