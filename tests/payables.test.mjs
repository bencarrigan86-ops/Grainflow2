// Run with:
//   node tests/payables.test.mjs
//
// What the farm owes: bills, the brokerage run up on contracts, and what it all takes off profit.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  KINDS, kindLabel, billTotal, gstOn, isOverdue, summarise, brokerageOwed, freightEffect, payablesCost,
} from '../docs/js/payables.js';
import { farmProfitLoss } from '../docs/js/derived.js';
import { stateToRows, rowsToState } from '../docs/js/mapping.js';

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); } catch (e) { failures++; console.log(`  FAIL  ${name}\n        ${e.message}`); }
};

// 600 t of wheat at $400, $20/t freight estimated, brokerage $3/t; 100 t delivered so far
const sale = { id: 's1', tons: 600, price: 400, freight: 20, brokerageRate: 3, broker: 'Knight' };
const load = (id, tons, saleId = 's1') => ({ id, tos: [{ type: 'sale', id: saleId, tons }] });
const delivered = [load('m1', 60), load('m2', 40)];
const bill = (o) => ({ id: `b${Math.random()}`, status: 'unpaid', amount: 0, gst: 0, ...o });

console.log('\n=== a bill ===');

check('the types of bill', () => {
  assert.deepEqual(KINDS.map((k) => k.key), ['brokerage', 'freight', 'storage', 'other']);
  assert.equal(kindLabel('freight'), 'Freight');
  assert.equal(kindLabel('nonsense'), 'Other');
});
check('what is paid is the amount and the GST', () => {
  assert.equal(billTotal({ amount: 1000, gst: 100 }), 1100);
  assert.equal(billTotal({}), 0);
});
check('GST at 10% of the amount', () => {
  assert.equal(gstOn(1234.56), 123.46);
  assert.equal(gstOn(''), 0);
});
check('overdue is unpaid and past its due date, and nothing else', () => {
  assert.equal(isOverdue({ status: 'unpaid', dueDate: '2026-11-01' }, '2026-11-13'), true);
  assert.equal(isOverdue({ status: 'paid', dueDate: '2026-11-01' }, '2026-11-13'), false);
  assert.equal(isOverdue({ status: 'unpaid', dueDate: '2026-11-20' }, '2026-11-13'), false);
  assert.equal(isOverdue({ status: 'unpaid', dueDate: '2026-11-13' }, '2026-11-13'), false, 'due today is not yet overdue');
  assert.equal(isOverdue({ status: 'unpaid' }, '2026-11-13'), false);
});
check('the totals: unpaid, of which overdue, and paid, as what is to be paid', () => {
  const s = summarise([
    bill({ amount: 1000, gst: 100, dueDate: '2026-11-01' }),
    bill({ amount: 500, gst: 50, dueDate: '2026-12-01' }),
    bill({ amount: 200, gst: 20, status: 'paid', dueDate: '2026-10-01' }),
  ], '2026-11-13');
  assert.deepEqual(s.unpaid, { count: 2, total: 1650 });
  assert.deepEqual(s.overdue, { count: 1, total: 1100 });
  assert.deepEqual(s.paid, { count: 1, total: 220 });
});

console.log('\n=== brokerage on a contract ===');

check('the rate on the tonnes delivered so far: $3/t on 100 t is $300', () => {
  const o = brokerageOwed(sale, delivered, []);
  assert.equal(o.tons, 100);
  assert.equal(o.accrued, 300);
  assert.equal(o.unbilled, 300);
  assert.equal(o.cost, 300);
});
check('nothing delivered, nothing owed', () => {
  assert.equal(brokerageOwed(sale, [], []).cost, 0);
});
check('a contract with no rate costs nothing', () => {
  assert.equal(brokerageOwed({ ...sale, brokerageRate: 0 }, delivered, []).cost, 0);
});
check('where the buyer pays the brokerage, the farm owes none', () => {
  assert.equal(brokerageOwed({ ...sale, brokeragePaidBy: 'buyer' }, delivered, []).cost, 0);
});
check('a bill is set against what has run up, not added to it', () => {
  const o = brokerageOwed(sale, delivered, [bill({ kind: 'brokerage', saleId: 's1', amount: 120, gst: 12 })]);
  assert.equal(o.billed, 120, 'ex GST');
  assert.equal(o.unbilled, 180);
  assert.equal(o.cost, 300, 'the accrual still counts once');
});
check('a bill for more than has run up counts in full', () => {
  const o = brokerageOwed(sale, delivered, [bill({ kind: 'brokerage', saleId: 's1', amount: 350 })]);
  assert.equal(o.cost, 350);
  assert.equal(o.unbilled, 0);
});
check('other kinds of bill, and other contracts\' bills, are not brokerage on this one', () => {
  const o = brokerageOwed(sale, delivered, [bill({ kind: 'freight', saleId: 's1', amount: 999 }), bill({ kind: 'brokerage', saleId: 'other', amount: 999 })]);
  assert.equal(o.billed, 0);
});

console.log('\n=== freight against the estimate ===');

check('a freight bill replaces the estimate for its tonnes: $2,400 for 100 t against $20/t is $400 more', () => {
  const f = freightEffect(sale, delivered, [bill({ kind: 'freight', saleId: 's1', amount: 2400, tons: 100 })]);
  assert.equal(f.estimate, 2000);
  assert.equal(f.extra, 400);
});
check('a cheaper bill is a saving, not a cost', () => {
  assert.equal(freightEffect(sale, delivered, [bill({ kind: 'freight', saleId: 's1', amount: 1500, tons: 100 })]).extra, -500);
});
check('a bill that does not say its tonnes covers what has been delivered', () => {
  const f = freightEffect(sale, delivered, [bill({ kind: 'freight', saleId: 's1', amount: 2100 })]);
  assert.equal(f.covered, 100);
  assert.equal(f.extra, 100);
});
check('several bills add up, with their tonnes', () => {
  const f = freightEffect(sale, delivered, [
    bill({ kind: 'freight', saleId: 's1', amount: 1000, tons: 50 }),
    bill({ kind: 'freight', saleId: 's1', amount: 1100, tons: 50 }),
  ]);
  assert.equal(f.billed, 2100);
  assert.equal(f.estimate, 2000);
  assert.equal(f.extra, 100);
});
check('no freight bill, no change: the estimate stands', () => {
  assert.equal(freightEffect(sale, delivered, []).extra, 0);
});

console.log('\n=== what comes off profit ===');

check('brokerage run up, with no bills yet', () => {
  const c = payablesCost([sale], delivered, []);
  assert.equal(c.brokerage, 300);
  assert.equal(c.total, 300);
});
check('every kind counts, at the amount before GST, paid or not', () => {
  const c = payablesCost([sale], delivered, [
    bill({ kind: 'brokerage', saleId: 's1', amount: 300, gst: 30 }),
    bill({ kind: 'freight', saleId: 's1', amount: 2400, gst: 240, tons: 100 }),
    bill({ kind: 'storage', amount: 800, gst: 80 }),
    bill({ kind: 'other', amount: 150, gst: 15, status: 'paid' }),
  ]);
  assert.deepEqual(c, { brokerage: 300, freight: 400, storage: 800, other: 150, total: 1650 });
});
check('a brokerage or freight bill with no contract counts in full', () => {
  const c = payablesCost([sale], [], [bill({ kind: 'brokerage', amount: 200 }), bill({ kind: 'freight', amount: 300 })]);
  assert.equal(c.brokerage, 200);
  assert.equal(c.freight, 300);
});
check('a bill for a contract that no longer exists still counts', () => {
  assert.equal(payablesCost([sale], [], [bill({ kind: 'brokerage', saleId: 'gone', amount: 250 })]).brokerage, 250);
});
check('with nothing owed, nothing comes off', () => {
  assert.equal(payablesCost([], [], []).total, 0);
  assert.equal(payablesCost(undefined, undefined, undefined).total, 0);
});
check('profit is gross margin, less overheads, less payables', () => {
  const pl = farmProfitLoss(100000, { wages: 20000 }, 0, 1650);
  assert.equal(pl.profitLoss, 100000 - 20000 - 1650);
  assert.equal(pl.payablesTotal, 1650);
});
check('without payables, profit is as it was', () => {
  assert.equal(farmProfitLoss(100000, { wages: 20000 }).profitLoss, 80000);
});

console.log('\n=== saving and loading ===');

const FARM = '11111111-1111-1111-1111-111111111111';
const PID = '99999999-9999-9999-9999-999999999999';
const stateWith = (payables, sales = []) => ({
  currentYear: '2026', nextMovementNo: 1, businessDetails: {},
  years: { 2026: { commodities: [], fields: [], storages: [], movements: [], invoices: [], overheads: {}, sales, payables } },
});
const full = { id: PID, kind: 'freight', supplier: 'Jones Haulage', reference: 'J-441', invoiceDate: '2026-11-10', dueDate: '2026-12-10', amount: 2400, gst: 240, saleId: null, storageId: null, tons: 100, rate: 24, status: 'unpaid', paidDate: '', notes: 'November runs' };
check('a bill goes to the server and comes back as it was', () => {
  const rows = stateToRows(stateWith([full]), FARM);
  assert.equal(rows.payables.length, 1);
  assert.equal(rows.payables[0].amount, 2400);
  assert.equal(rows.payables[0].kind, 'freight');
  const back = rowsToState(rows).years[2026].payables[0];
  assert.deepEqual({ ...back, saleId: null, storageId: null, paidDate: '' }, full);
});
check('a bill with no tonnes or rate keeps them empty, not zero', () => {
  const rows = stateToRows(stateWith([{ ...full, tons: '', rate: '' }]), FARM);
  assert.equal(rows.payables[0].tons, null);
  const back = rowsToState(rows).years[2026].payables[0];
  assert.equal(back.tons, '');
  assert.equal(back.rate, '');
});
check('a farm with no bills sends none, and loads with an empty list', () => {
  const rows = stateToRows(stateWith([]), FARM);
  assert.deepEqual(rows.payables, []);
  assert.deepEqual(rowsToState(rows).years[2026].payables, []);
});
check('a contract\'s brokerage rate goes to the server and comes back', () => {
  const rows = stateToRows(stateWith([], [{ id: '12121212-1212-1212-1212-121212121212', tons: 5, price: 400, brokerageRate: 3 }]), FARM);
  assert.equal(rows.sale_terms[0].brokerage_rate, 3);
  assert.equal(rowsToState(rows).years[2026].sales[0].brokerageRate, 3);
});
check('a contract with none sends no such column, so it still saves before the database has it', () => {
  const rows = stateToRows(stateWith([], [{ id: '12121212-1212-1212-1212-121212121212', tons: 5, price: 400 }]), FARM);
  assert.ok(!('brokerage_rate' in rows.sale_terms[0]));
});

console.log('\n=== wired in ===');

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
check('the push sends them, only for the roles that may write them', () => {
  const sync = read('docs/js/sync.js');
  assert.match(sync, /'invoices', 'overheads', 'payables',\n  'record_documents',[^\n]*\n\];/);
  assert.match(sync, /bookkeeper: \[[^\]]*'payables'/);
  assert.match(sync, /manager: \[[^\]]*'payables'/, 'a manager sees and records what the farm owes');
  assert.match(sync, /manager: \[[^\]]*'invoices'/);
  assert.ok(!/farm_worker: \[[^\]]*'payables'/.test(sync) && !/driver: \[[^\]]*'payables'/.test(sync), 'workers and drivers still do not');
});
check('a change to one is tracked as its own kind of edit', () => {
  const dirty = read('docs/js/dirty.js');
  assert.match(dirty, /payable: 'payables'/);
  assert.match(read('docs/js/storage.js'), /touch\('payable'/);
});
check('the Sales tab opens Receivables & payables, the contract has a brokerage rate, and Position takes the bills off profit', () => {
  assert.match(read('docs/js/views/sales.js'), /id="open-money"/);
  assert.match(read('docs/js/views/outstanding.js'), /renderPayables\(bills/);
  assert.match(read('docs/js/views/sales.js'), /brokerageRate: getNum\(root, 'brokerageRate'\)/);
  assert.match(read('docs/js/views/position.js'), /payablesCost\(sales, movements, db\.getPayables\(\)\)/);
});
check('the database table and column are in the paste-in file, and the delete function knows the table', () => {
  const sql = read('supabase/paste-into-sql-editor.sql');
  assert.match(sql, /create table if not exists payables/);
  assert.match(sql, /brokerage_rate numeric/);
  assert.match(sql, /'invoices', 'overheads', 'payables'/);
});

if (failures) { console.log(`\n${failures} failed`); process.exit(1); }
console.log('\nall passed');
