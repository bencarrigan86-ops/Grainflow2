// Run with:
//   node tests/paidsales.test.mjs
//
// Contracts marked paid: kept, counted, but off the main list and the pick lists.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { activeSales, paidSales } from '../docs/js/paidsales.js';
import { stateToRows, rowsToState } from '../docs/js/mapping.js';

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); } catch (e) { failures += 1; console.log(`  FAIL  ${name}\n        ${e.message}`); }
};

const SALES = [{ id: 'a', buyer: 'A' }, { id: 'b', buyer: 'B', paid: true }, { id: 'c', buyer: 'C', paid: false }];

console.log('=== the lists ===');
check('paid contracts are left off a pick list, unless a record already points at one', () => {
  assert.deepEqual(activeSales(SALES).map((s) => s.id), ['a', 'c']);
  assert.deepEqual(activeSales(SALES, ['b']).map((s) => s.id), ['a', 'b', 'c']);
  assert.deepEqual(activeSales(SALES, 'b').map((s) => s.id), ['a', 'b', 'c']);
  assert.deepEqual(activeSales(SALES, [undefined, '']).map((s) => s.id), ['a', 'c']);
  assert.deepEqual(activeSales(undefined), []);
});
check('the paid ones are found for their own list', () => {
  assert.deepEqual(paidSales(SALES).map((s) => s.id), ['b']);
});

console.log('\n=== saved with the contract ===');
const FARM = '11111111-1111-1111-1111-111111111111';
const state = (sales) => ({ currentYear: '2026', nextMovementNo: 1, businessDetails: {}, years: { 2026: { commodities: [], storages: [], fields: [], sales, movements: [], overheads: {}, invoices: [] } } });
const sale = (extra) => ({ id: '22222222-2222-2222-2222-222222222222', buyer: 'A', tons: 10, price: 400, ...extra });
check('it is sent once marked, kept so that un-marking reaches the server, and read back', () => {
  assert.ok(!('is_paid' in stateToRows(state([sale({})]), FARM).sales[0]), 'not sent until it is marked');
  assert.equal(stateToRows(state([sale({ paid: true })]), FARM).sales[0].is_paid, true);
  assert.equal(stateToRows(state([sale({ paid: false, __hasPaid: true })]), FARM).sales[0].is_paid, false);
  const back = rowsToState(stateToRows(state([sale({ paid: true })]), FARM)).years[2026].sales[0];
  assert.equal(back.paid, true);
  assert.ok(!('paid' in rowsToState(stateToRows(state([sale({})]), FARM)).years[2026].sales[0]), 'unmarked contracts read back as before');
});

console.log('\n=== wired in ===');
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
check('the sheet has the tick, the main list leaves paid contracts out, and a button opens them', () => {
  const s = read('docs/js/views/sales.js');
  for (const t of ['id="paid"', 'activeSales(sales)', 'id="open-paid"', 'openPaidSheet', 'Paid contracts']) assert.ok(s.includes(t), t);
});
check('every contract pick list leaves paid contracts out but keeps the one already chosen', () => {
  assert.ok(read('docs/js/views/movements.js').includes('activeSales(sales, keep)'));
  assert.ok(read('docs/js/views/orders.js').includes('activeSales(sales, [src.saleId])'));
  assert.ok(read('docs/js/views/freightorders.js').includes('activeSales(sales, [d.saleId])'));
  assert.ok(read('docs/js/views/payables.js').includes('activeSales(sales, [src.saleId])'));
  assert.ok(read('docs/js/views/vendordec.js').includes('activeSales(sales, [d.saleId])'));
});
check('the position still counts paid contracts: it reads every sale', () => {
  assert.ok(read('docs/js/views/position.js').includes('db.get()'));
  assert.ok(!read('docs/js/views/position.js').includes('activeSales'));
});
check('the column is in the paste-in file', () => {
  assert.ok(read('supabase/paste-into-sql-editor.sql').includes('add column if not exists is_paid boolean'));
});

console.log('\n=== searching movements ===');
check('the search also finds a date as it is written, the grade, the contract and buyer, and the freight order', () => {
  const m = read('docs/js/views/movements.js');
  for (const t of ['written[3]}-${written[2]}-${written[1]}', 'm.grade', 'm.tons', 's.contractNo', 's.buyer', 'fo?.carrier', 'fo?.freightNo']) assert.ok(m.includes(t), t);
});

if (failures) { console.log(`\n${failures} failed`); process.exit(1); }
console.log('\nall passed');
