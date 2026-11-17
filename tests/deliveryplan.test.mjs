// Run with:
//   node tests/deliveryplan.test.mjs
//
// How a contract is delivered (the buyer calls it, or spread evenly), the weekly and monthly tonnes that follow from it,
// and the money forecast from grain not yet invoiced.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PATTERNS, payDate, evenDays, deliveryPlan, expectedReceipts, periodKey, periodLabel, addDays } from '../docs/js/deliveryplan.js';
import { deliveries, uninvoiced } from '../docs/js/outstanding.js';
import { cashflow } from '../docs/js/cashflow.js';
import { stateToRows, rowsToState } from '../docs/js/mapping.js';

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); } catch (e) { failures++; console.log(`  FAIL  ${name}\n        ${e.message}`); }
};
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

const TODAY = '2026-11-16';   // a Monday
const sum = (a) => a.reduce((s, x) => s + x, 0);

console.log('\n=== dates and terms ===');
check('a week starts on Monday and a month is its calendar month, with labels', () => {
  assert.equal(periodKey('2026-11-19', 'week'), '2026-11-16');
  assert.equal(periodKey('2026-11-22', 'week'), '2026-11-16');
  assert.equal(periodKey('2026-11-23', 'week'), '2026-11-23');
  assert.equal(periodKey('2026-11-19', 'month'), '2026-11');
  assert.equal(periodLabel('2026-11-16', 'week'), 'Week of 16 Nov');
  assert.equal(periodLabel('2026-11', 'month'), 'Nov 2026');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
});
check('the money is due the contract\'s terms after delivery, from the end of the week for end-of-week terms, 14 days if none are set', () => {
  assert.equal(payDate('2026-11-16', { paymentTermsDays: 30, paymentTermsBasis: 'date of delivery' }), '2026-12-16');
  assert.equal(payDate('2026-11-18', { paymentTermsDays: 30, paymentTermsBasis: 'end of week of delivery' }), '2026-12-22', 'the Sunday of that week, then 30 days');
  assert.equal(payDate('2026-11-16', {}), '2026-11-30');
  assert.equal(payDate('2026-11-16', { paymentTermsDays: 0 }), '2026-11-16', 'cash on delivery');
});

console.log('\n=== spreading a contract evenly ===');
check('what is left is spread evenly from today to the end of the window, a day at a time', () => {
  const days = evenDays({ deliveryStart: '2026-11-01', deliveryEnd: '2026-12-15' }, 300, TODAY);
  assert.equal(days.length, 30); assert.equal(days[0].date, TODAY); assert.equal(days[29].date, '2026-12-15');
  assert.ok(days.every((d) => Math.abs(d.tons - 10) < 1e-9));
});
check('a window that has not started yet begins at its start', () => {
  const days = evenDays({ deliveryStart: '2026-12-01', deliveryEnd: '2026-12-10' }, 100, TODAY);
  assert.equal(days[0].date, '2026-12-01'); assert.equal(days.length, 10);
});
check('no end date, a window that has ended, or nothing to deliver cannot be spread', () => {
  assert.equal(evenDays({ deliveryStart: '2026-11-01' }, 300, TODAY), null);
  assert.equal(evenDays({ deliveryEnd: '2026-11-01' }, 300, TODAY), null);
  assert.equal(evenDays({ deliveryEnd: '2026-12-01' }, 0, TODAY), null);
});

console.log('\n=== the plan ===');
const sales = [
  { id: 'e', buyer: 'Even Buyer', contractNo: 'E1', tons: 300, price: 400, deliveryStart: '2026-11-01', deliveryEnd: '2026-12-15', deliveryPattern: 'even', paymentTermsDays: 30, paymentTermsBasis: 'date of delivery' },
  { id: 'c', buyer: 'Calls Buyer', contractNo: 'C1', tons: 200, price: 500, deliveryEnd: '2026-12-31', deliveryPattern: 'call' },
  { id: 'n', buyer: 'Ended Buyer', contractNo: 'N1', tons: 100, price: 300, deliveryEnd: '2026-11-01', deliveryPattern: 'even' },
  { id: 'd', buyer: 'Delivered Buyer', contractNo: 'D1', tons: 60, price: 200, deliveryEnd: '2027-06-30', paymentTermsDays: 7, paymentTermsBasis: 'date of delivery' },
];
const orders = [
  { id: 'o1', saleId: 'c', tons: 50, status: 'open', deliverBy: '2026-11-20' },
  { id: 'o2', saleId: 'c', tons: 30, status: 'open', deliverBy: '2026-11-10' },
  { id: 'o3', saleId: 'c', tons: 20, status: 'open' },
];
const movements = [{ id: 'md', date: '2026-11-10', tons: 60, tos: [{ type: 'sale', id: 'd', tons: 60 }], froms: [] }];
const rows = deliveries(sales, movements, orders, TODAY).rows;
check('only contracts with grain still to deliver are planned', () => {
  assert.deepEqual(rows.map((r) => r.sale.id).sort(), ['c', 'e', 'n']);
});
check('monthly: an even contract is split by the days in each month, and an order is dated by its deliver-by day', () => {
  const plan = deliveryPlan(rows, TODAY, 'month');
  assert.deepEqual(plan.periods.map((p) => [p.key, p.even, p.ordered, p.total]), [['2026-11', 150, 50, 200], ['2026-12', 150, 0, 150]]);
});
check('weekly: the same grain by the week, adding up to the same total', () => {
  const plan = deliveryPlan(rows, TODAY, 'week');
  assert.deepEqual(plan.periods.map((p) => [p.key, Math.round(p.even)]), [['2026-11-16', 70], ['2026-11-23', 70], ['2026-11-30', 70], ['2026-12-07', 70], ['2026-12-14', 20]]);
  assert.equal(plan.periods.find((p) => p.key === '2026-11-16').ordered, 50);
  assert.equal(Math.round(sum(plan.periods.map((p) => p.total))), 350);
});
check('what was due before today and what has no date are kept apart', () => {
  const plan = deliveryPlan(rows, TODAY, 'month');
  assert.equal(plan.overdue.tons, 130, 'the ended even contract (100) and the order past its date (30)');
  assert.equal(plan.unscheduled.tons, 120, 'the order with no date (20) and what is not yet ordered (100)');
  assert.equal(plan.overdue.contracts, 2); assert.equal(plan.unscheduled.contracts, 1);
});
check('each contract has its rate: about 70 t a week and 304 t a month for the even one', () => {
  const plan = deliveryPlan(rows, TODAY, 'month');
  assert.deepEqual(plan.perContract.get('e'), { pattern: 'even', spread: true, perWeek: 70, perMonth: 304 });
  assert.equal(plan.perContract.get('c').spread, false);
});
check('a contract with no pattern set is read as a buyer-calls one: nothing is dated that nobody dated', () => {
  const unset = [{ ...sales[0], deliveryPattern: '' }];
  const plan = deliveryPlan(deliveries(unset, [], [], TODAY).rows, TODAY, 'month');
  assert.deepEqual(plan.periods, []); assert.equal(plan.unscheduled.tons, 300);
});

console.log('\n=== the money expected ===');
const unb = uninvoiced(sales, movements, [], TODAY).rows;
const expected = expectedReceipts(rows, unb, TODAY);
const total = (kind) => Math.round(sum(expected.filter((e) => e.kind === kind).map((e) => e.amount)));
check('grain delivered but not invoiced is paid one set of terms from today, with GST', () => {
  const d = expected.find((e) => e.kind === 'delivered');
  assert.equal(d.date, '2026-11-23'); assert.equal(d.amount, 13200);
});
check('an even contract is paid the terms after each day it goes, adding to its tonnes at the price plus GST', () => {
  assert.equal(total('even'), 300 * 400 * 1.1);
  assert.equal(expected.filter((e) => e.kind === 'even')[0].date, '2026-12-16');
});
check('an order is paid the terms after its date (today if its date has gone), and the rest has no date', () => {
  const orderRows = expected.filter((e) => e.kind === 'order').map((e) => [e.date, e.amount]).sort();
  assert.deepEqual(orderRows, [['2026-11-30', 16500], ['2026-12-04', 27500]]);
  assert.equal(total('unscheduled'), 11000 + 55000 + 33000);
  assert.ok(expected.filter((e) => e.kind === 'unscheduled').every((e) => e.date === null));
});
check('a contract with no price adds nothing', () => {
  const free = [{ ...sales[0], price: 0 }];
  assert.deepEqual(expectedReceipts(deliveries(free, [], [], TODAY).rows, [], TODAY), []);
});

console.log('\n=== in the cash flow ===');
const cf = cashflow([], sales, [], TODAY, 3, expected);
check('the forecast sits in its own column by month, with the undated money on its own line', () => {
  const by = Object.fromEntries(cf.rows.map((r) => [r.key, r]));
  assert.equal(by['2026-11'].expected, 13200 + 16500);
  assert.equal(by['2026-12'].expected, 16 * 4400 + 27500);
  assert.equal(by['2027-01'].expected, 14 * 4400);
  assert.equal(by.unscheduled.expected, 99000);
  assert.equal(cf.totalExpected, 288200);
});
check('the running balance carries both, and what is already invoiced is untouched', () => {
  assert.equal(cf.totalIn, 0);
  assert.equal(cf.net, 288200);
  assert.equal(cf.rows[cf.rows.length - 1].balance, 288200);
  assert.deepEqual(cashflow([], sales, [], TODAY, 3).totalExpected, 0, 'with no forecast it is what it was');
});

console.log('\n=== saving and loading ===');
const FARM = '11111111-1111-1111-1111-111111111111';
const state = (sale) => ({
  currentYear: '2026', nextMovementNo: 1, businessDetails: {},
  years: { 2026: { commodities: [], fields: [], storages: [], movements: [], invoices: [], overheads: {}, sales: [{ id: '44444444-4444-4444-4444-444444444444', tons: 100, price: 300, ...sale }] } },
});
check('a contract that never set it sends no such column, so saving works before the database has it', () => {
  assert.ok(!('delivery_pattern' in stateToRows(state({}), FARM).sales[0]));
});
check('the pattern goes to the server and comes back', () => {
  const rows = stateToRows(state({ deliveryPattern: 'even' }), FARM);
  assert.equal(rows.sales[0].delivery_pattern, 'even');
  assert.equal(rowsToState(rows).years[2026].sales[0].deliveryPattern, 'even');
});
check('clearing it still reaches the server, and anything else is not stored', () => {
  assert.equal(stateToRows(state({ deliveryPattern: '', __hasDeliveryPattern: true }), FARM).sales[0].delivery_pattern, null);
  assert.equal(stateToRows(state({ deliveryPattern: 'sideways' }), FARM).sales[0].delivery_pattern, null);
});

console.log('\n=== on the screens ===');
check('the contract form asks how it is delivered, and saves the answer', () => {
  const s = read('docs/js/views/sales.js');
  assert.ok(s.includes("id: 'deliveryPattern'") && s.includes("deliveryPattern: getVal(root, 'deliveryPattern') || ''") && s.includes('options: PATTERNS'));
  assert.deepEqual(PATTERNS.map((p) => p.value), ['', 'call', 'sellers', 'even']);
});
check('Delivery timeline has the weekly and monthly schedule, and Receivables & payables feeds the forecast to the cash flow', () => {
  const o = read('docs/js/views/outstanding.js');
  assert.ok(o.includes('id="sched-grain"') && o.includes('data-grain="week"') && o.includes('data-grain="month"') && o.includes('scheduleHtml(plan, rep)'));
  assert.ok(o.includes('expectedReceipts(deliveries('));
});
check('the column is in the paste-in file and the migration', () => {
  assert.ok(read('supabase/paste-into-sql-editor.sql').includes('add column if not exists delivery_pattern text'));
  assert.ok(read('supabase/migrations/20261116140000_delivery_pattern.sql').includes('alter table sales'));
});

if (failures) { console.log(`\n${failures} failed`); process.exit(1); }
console.log('\nall passed');
