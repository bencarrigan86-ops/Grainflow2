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
import { positionRows } from '../docs/js/derived.js';

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

if (failures) { console.log(`\n${failures} failed`); process.exit(1); }
console.log('\nposition: ALL PASS');
