// Run with:
//   node tests/demoorders.test.mjs
//
// The sample farm has one grain order and one freight order carting it, and both keep their links to the contract
// when the sample is imported (every id is reissued on the way in).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { prepareImport, isUuid } from '../docs/js/import.js';

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); } catch (e) { failures++; console.log(`  FAIL  ${name}\n        ${e.message}`); }
};
const raw = readFileSync(new URL('../docs/demo/seed.json', import.meta.url), 'utf8');

check('the seed has one grain order and one freight order on the first contract', () => {
  const y = Object.values(JSON.parse(raw).years)[0];
  assert.equal(y.orders.length, 1);
  assert.equal(y.freightOrders.length, 1);
  assert.equal(y.orders[0].saleId, 'sale-1');
  assert.equal(y.freightOrders[0].orderId, y.orders[0].id);
  assert.equal(y.freightOrders[0].freightNo, 'RGT-4471-01', 'not numbered from the contract');
});

check('after the import the ids are reissued and the links still point at each other', () => {
  const { state, after } = prepareImport(raw);
  const y = state.years['Sample 2026'];
  const [o] = y.orders;
  const [f] = y.freightOrders;
  assert.ok(isUuid(o.id) && isUuid(f.id));
  assert.ok(y.sales.some((s) => s.id === o.saleId && s.contractNo === 'RGT-4471'), 'the order lost its contract');
  assert.equal(f.saleId, o.saleId);
  assert.equal(f.orderId, o.id);
  assert.equal(after.errors?.length ?? 0, 0, 'the import found a problem');
});

check('the freight order has both addresses in full', () => {
  const f = Object.values(JSON.parse(raw).years)[0].freightOrders[0];
  for (const k of ['pickupParts', 'deliverToParts']) assert.ok(f[k].line1 && f[k].town && f[k].state && f[k].postcode, k);
});

if (failures) { console.log(`\n${failures} FAILURES`); process.exit(1); }
console.log('\nall passed');
