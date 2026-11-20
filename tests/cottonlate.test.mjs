// Run with:
//   node tests/cottonlate.test.mjs
//
// Cotton has no carry, but a bale delivered after the delivery finish takes a discount by the month it is late. The figures do
// not add up: month 1 $10, month 2 $25 means a bale two months late is discounted $25, not $35.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_VERSION } from '../docs/js/version.js';

const stamp = APP_VERSION.split('.').pop();
const { parseLate, lateText, lateOn, lateMonthsFor, lateDiscountFor, lateAdjustment } = await import(`../docs/js/cottonlate.js?v=${stamp}`);
const { invoiceLineItems, saleEconomics } = await import(`../docs/js/derived.js?v=${stamp}`);

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); } catch (e) { failures++; console.log(`  FAIL  ${name}\n        ${e.message}`); }
};
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

const sale = { id: 's1', price: 500, tons: 400, deliveryEnd: '2027-06-30', lateDiscounts: [10, 25, 40] };
const load = (id, date, bales) => ({ id, date, froms: [], tos: [{ type: 'sale', id: 's1', tons: bales }] });

console.log('\n=== the table ===');
check('typed figures become a table, junk is left out', () => {
  assert.deepEqual(parseLate('10, 25, 40'), [10, 25, 40]);
  assert.deepEqual(parseLate('10 25;abc,40'), [10, 25, 40]);
  assert.deepEqual(parseLate(''), []);
  assert.equal(lateText([10, 25, 40]), '10, 25, 40');
});
check('it needs a table and a delivery finish', () => {
  assert.equal(lateOn(sale), true);
  assert.equal(lateOn({ ...sale, deliveryEnd: '' }), false);
  assert.equal(lateOn({ ...sale, lateDiscounts: [] }), false);
});

console.log('\n=== the months late ===');
check('on time until the finish date; then month 1 is the next month, and so on', () => {
  assert.equal(lateMonthsFor(sale, '2027-06-30'), 0);
  assert.equal(lateMonthsFor(sale, '2027-05-10'), 0);
  assert.equal(lateMonthsFor(sale, '2027-07-01'), 1);
  assert.equal(lateMonthsFor(sale, '2027-07-31'), 1);
  assert.equal(lateMonthsFor(sale, '2027-08-02'), 2);
  assert.equal(lateMonthsFor(sale, '2027-09-02'), 3);
  assert.equal(lateMonthsFor({ ...sale, deliveryEnd: '2027-06-15' }, '2027-06-20'), 1, 'late within the finish month is month 1');
});

console.log('\n=== the discount ===');
check('each month has its own figure, they do not add, and the last one keeps applying', () => {
  assert.equal(lateDiscountFor(sale, load('a', '2027-06-20', 1)), 0);
  assert.equal(lateDiscountFor(sale, load('b', '2027-07-05', 1)), 10);
  assert.equal(lateDiscountFor(sale, load('c', '2027-08-05', 1)), 25);
  assert.equal(lateDiscountFor(sale, load('d', '2027-09-05', 1)), 40);
  assert.equal(lateDiscountFor(sale, load('e', '2027-12-05', 1)), 40);
});
check('the invoice rate has it taken off, in one line per load', () => {
  const lines = invoiceLineItems(sale, [load('a', '2027-06-20', 100), load('b', '2027-07-05', 100), load('c', '2027-08-05', 50)]);
  const by = Object.fromEntries(lines.map((l) => [l.movementId, l]));
  assert.equal(lines.length, 3);
  assert.equal(by.a.rate, 500); assert.equal(by.b.rate, 490); assert.equal(by.c.rate, 475);
  assert.equal(by.c.adjust, -25); assert.equal(by.c.subtotal, 50 * 475);
});
check('the contract value counts the discount on what has been delivered', () => {
  const moves = [load('b', '2027-07-05', 100), load('c', '2027-08-05', 50)];
  assert.equal(lateAdjustment(sale, moves).total, -(100 * 10 + 50 * 25));
  const e = saleEconomics(sale, moves);
  const plain = saleEconomics({ ...sale, lateDiscounts: [] }, moves);
  assert.equal(Math.round((e.totalValue - plain.totalValue) * 100) / 100, -(100 * 10 + 50 * 25));
});

console.log('\n=== cotton has no carry ===');
check('the form hides carry for bales and saves it empty, and shows the late discount instead', () => {
  const s = read('docs/js/views/sales.js');
  assert.ok(s.includes('id="carry-wrap"') && s.includes('id="late-wrap"'));
  assert.ok(s.includes('carryRate: isBalesNow() ? 0 : getNum(root'));
  assert.ok(s.includes('carryWrap.hidden = isBales') && s.includes("lateWrap.hidden = !(bales && kind === 'lint')"), 'the late discount is for lint only, not a gin contract');
  assert.ok(s.includes("lateDiscounts: isBalesNow() && kindEl.value === 'lint'"));
});
check('it is kept in the database and shown on the contract', () => {
  assert.ok(read('docs/js/mapping.js').includes('late_discounts'));
  assert.ok(read('docs/js/contractpdf.js').includes("['Late delivery', lateText(sale)]"));
  assert.ok(read('supabase/migrations/20261224100000_late_discounts.sql').includes('late_discounts jsonb'));
  assert.ok(read('supabase/paste-into-sql-editor.sql').includes('sale_terms add column if not exists late_discounts'));
});

if (failures) { console.log(`\n${failures} failed`); process.exit(1); }
console.log('\nall passed');
