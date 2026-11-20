// Run with:
//   node tests/carry.test.mjs
//
// Carry on a contract: $/t/month added to each load's price by the month it was delivered. Carry starting 1 Feb at $2/t:
// February loads +$2, March +$4, and so on; nothing before the start date, or with no start date.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { carryOn, carryMonthsFor, carryRateFor, carryAdjustment } from '../docs/js/carry.js';
import { invoiceLineItems, saleEconomics } from '../docs/js/derived.js';

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); } catch (e) { failures++; console.log(`  FAIL  ${name}\n        ${e.message}`); }
};
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

const sale = { id: 's1', price: 300, tons: 100, carryRate: 2, carryFrom: '2027-02-01' };
const load = (id, date, tons) => ({ id, date, froms: [], tos: [{ type: 'sale', id: 's1', tons }] });

console.log('\n=== the months ===');
check('carry needs a rate and a start date', () => {
  assert.equal(carryOn(sale), true);
  assert.equal(carryOn({ ...sale, carryFrom: '' }), false);
  assert.equal(carryOn({ ...sale, carryRate: 0 }), false);
});
check('nothing before the start date, one month in the start month, one more each month after', () => {
  assert.equal(carryMonthsFor(sale, '2027-01-31'), 0);
  assert.equal(carryMonthsFor(sale, '2027-02-01'), 1);
  assert.equal(carryMonthsFor(sale, '2027-02-28'), 1);
  assert.equal(carryMonthsFor(sale, '2027-03-01'), 2);
  assert.equal(carryMonthsFor(sale, '2027-12-15'), 11);
  assert.equal(carryMonthsFor(sale, '2028-01-02'), 12, 'it runs across the new year');
});
check('a start part-way through a month: loads before it carry nothing, the rest of that month carry one', () => {
  const mid = { ...sale, carryFrom: '2027-02-15' };
  assert.equal(carryMonthsFor(mid, '2027-02-10'), 0);
  assert.equal(carryMonthsFor(mid, '2027-02-20'), 1);
  assert.equal(carryMonthsFor(mid, '2027-03-05'), 2);
});

console.log('\n=== the price ===');
check('the $/t added to a load is months times the rate', () => {
  assert.equal(carryRateFor(sale, load('a', '2027-02-10', 10)), 2);
  assert.equal(carryRateFor(sale, load('b', '2027-04-10', 10)), 6);
  assert.equal(carryRateFor({ ...sale, carryFrom: '' }, load('c', '2027-04-10', 10)), 0);
});
check('the invoice line is at the price plus carry, built into the rate with no extra line', () => {
  const lines = invoiceLineItems(sale, [load('a', '2027-02-10', 10), load('b', '2027-03-10', 20), load('c', '2027-01-20', 5)]);
  const by = Object.fromEntries(lines.map((l) => [l.movementId, l]));
  assert.equal(lines.length, 3, 'one line per load, none for carry');
  assert.equal(by.c.rate, 300);
  assert.equal(by.a.rate, 302); assert.equal(by.a.adjust, 2); assert.equal(by.a.subtotal, 3020);
  assert.equal(by.b.rate, 304); assert.equal(by.b.subtotal, 6080);
});
check('the contract value counts the carry on what has been delivered', () => {
  const moves = [load('a', '2027-02-10', 10), load('b', '2027-03-10', 20)];
  assert.equal(carryAdjustment(sale, moves).total, 10 * 2 + 20 * 4);
  const e = saleEconomics(sale, moves);
  const plain = saleEconomics({ ...sale, carryRate: 0 }, moves);
  assert.equal(Math.round((e.totalValue - plain.totalValue) * 100) / 100, 100);
  assert.equal(e.carryAdjustment, 100);
});

console.log('\n=== on the screens ===');
check('the form explains it, and the invoice has no separate carry line or note', () => {
  for (const f of ['docs/js/views/invoice.js', 'docs/js/invoicepdf.js', 'docs/js/xero.js']) assert.ok(!read(f).includes('carryNote'), f);
  assert.ok(read('docs/js/views/sales.js').includes('one month\'s carry for grain delivered in the start month'));
});

if (failures) { console.log(`\n${failures} failed`); process.exit(1); }
console.log('\nall passed');
