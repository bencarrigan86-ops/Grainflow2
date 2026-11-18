// Run with:
//   node tests/commodityorder.test.mjs
//
// The commodity tables and groups (Position, Production, Sales, Storage, the loads filter, the reports) run biggest volume
// first, and the same volume in name order, whatever order the commodities were saved in.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { bigFirst, position, groupFieldsByCommodity } from '../docs/js/derived.js';

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); } catch (e) { failures++; console.log(`  FAIL  ${name}\n        ${e.message}`); }
};
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

check('bigFirst puts the most tonnes at the top, and ties go by name', () => {
  const rows = [{ name: 'Oats', t: 10 }, { name: 'Wheat', t: 900 }, { name: 'Barley', t: 10 }, { name: 'Canola', t: 400 }, { name: 'Lupins', t: 0 }];
  assert.deepEqual(rows.sort(bigFirst((r) => r.t)).map((r) => r.name), ['Wheat', 'Canola', 'Barley', 'Oats', 'Lupins']);
  assert.deepEqual([{ name: 'B', t: undefined }, { name: 'A', t: null }].sort(bigFirst((r) => r.t)).map((r) => r.name), ['A', 'B'], 'no figure counts as nothing');
});

check('the position runs biggest first, whatever order the commodities are in', () => {
  const commodities = [{ id: 'o', name: 'Oats' }, { id: 'w', name: 'Wheat' }, { id: 'c', name: 'Canola' }];
  const sales = [
    { id: 's1', commodityId: 'o', tons: 50, price: 300 },
    { id: 's2', commodityId: 'w', tons: 900, price: 400 },
    { id: 's3', commodityId: 'c', tons: 300, price: 700 },
  ];
  const rows = position(commodities, [], sales, []);
  assert.deepEqual(rows.map((r) => r.commodity.name), ['Wheat', 'Canola', 'Oats']);
  const reversed = position([...commodities].reverse(), [], sales, []);
  assert.deepEqual(reversed.map((r) => r.commodity.name), ['Wheat', 'Canola', 'Oats'], 'the same either way');
});

check('paddocks grouped by commodity run biggest first', () => {
  const commodities = [{ id: 'o', name: 'Oats' }, { id: 'w', name: 'Wheat' }];
  const fields = [
    { id: 'f1', name: 'North', commodityId: 'o', areaHa: 10, estYieldTHa: 2 },
    { id: 'f2', name: 'South', commodityId: 'w', areaHa: 100, estYieldTHa: 4 },
  ];
  const groups = groupFieldsByCommodity(commodities, fields, []);
  assert.equal(groups.length, 2);
  assert.ok(groups[0].totalTons >= groups[1].totalTons, 'the bigger total first');
});

check('every screen that lists commodities sorts them that way', () => {
  assert.ok(read('docs/js/views/production.js').includes('productionSummary(commodities, fields, movements)') && read('docs/js/derived.js').includes('sort(bigFirst((r) => r.tons, (r) => r.commodity.name))'), 'production, and the summary at the top of the Yield report, use the same sorted rows');
  const sales = read('docs/js/views/sales.js');
  assert.ok(sales.includes('sort(bigFirst((r) => r.tons') && sales.includes('.sort(bigFirst((g) => g.tons))'), 'sales roll-up and groups');
  const st = read('docs/js/views/storage.js');
  assert.ok(st.includes('commoditiesByStock(commodities, storages, movements)') && st.includes('sort(bigFirst((r) => r.trackedTons'), 'storage groups, tabs and roll-up');
  assert.ok(read('docs/js/views/movements.js').includes('sort(bigFirst(movedOf'), 'the loads filter');
  const d = read('docs/js/derived.js');
  assert.ok(d.includes('sort(bigFirst((r) => Math.max(r.productionTons, r.soldTons)') && d.includes('.sort(bigFirst((g) => g.totalTons))'), 'position and the paddock groups');
});

if (failures) { console.log(`\n${failures} FAILURES`); process.exit(1); }
console.log('\nall passed');
