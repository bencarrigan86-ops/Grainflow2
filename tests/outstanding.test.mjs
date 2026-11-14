// Run with:
//   node tests/outstanding.test.mjs
//
// What is still outstanding: grain to deliver on contracts, and money owed to the farm and by it.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ageBucket, receivables, payablesDue, moneyPosition, deliveries, timeline, uninvoiced, endText, dueText, ENDING_SOON_DAYS,
} from '../docs/js/outstanding.js';
import { stateToRows, rowsToState } from '../docs/js/mapping.js';
import { invoiceLineItems, invoiceTotals, freightOnInvoice } from '../docs/js/derived.js';

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); } catch (e) { failures++; console.log(`  FAIL  ${name}\n        ${e.message}`); }
};

const TODAY = '2026-12-10';

console.log('\n=== ageing ===');

check('which age an invoice falls in', () => {
  assert.equal(ageBucket(null), 'nodate');
  assert.equal(ageBucket(-5), 'notdue');
  assert.equal(ageBucket(0), 'notdue');
  assert.equal(ageBucket(1), 'd30');
  assert.equal(ageBucket(30), 'd30');
  assert.equal(ageBucket(31), 'd60');
  assert.equal(ageBucket(60), 'd60');
  assert.equal(ageBucket(61), 'd60plus');
});
check('the words for a due date and an end date', () => {
  assert.equal(dueText(-5), 'Due in 5 days');
  assert.equal(dueText(-1), 'Due in 1 day');
  assert.equal(dueText(0), 'Due today');
  assert.equal(dueText(1), '1 day overdue');
  assert.equal(dueText(12), '12 days overdue');
  assert.equal(dueText(null), 'No due date');
  assert.equal(endText(12), 'Ends in 12 days');
  assert.equal(endText(0), 'Ends today');
  assert.equal(endText(-4), 'Ended 4 days ago');
  assert.equal(endText(null), 'No end date');
});

console.log('\n=== money owed to the farm ===');

const inv = (id, no, dueDate, totalPayable, status = 'outstanding') => ({ id, saleId: 's1', invoiceNo: no, status, dueDate, issueDate: '2026-10-01', totalPayable });
const invoices = [
  inv('a', 1, '2026-12-20', 10000),                 // due in 10 days
  inv('b', 2, '2026-12-01', 20000),                 // 9 days over
  inv('c', 3, '2026-10-01', 5000),                  // 70 days over
  inv('d', 4, '2026-11-20', 7000),                  // 20 days over
  inv('e', 5, '2026-11-01', 99999, 'paid'),         // paid: not counted
  inv('f', 6, '', 1000),                            // no due date
];
const sales = [{ id: 's1', buyer: 'Riverina' }];

check('only unpaid invoices, oldest due first, no due date last', () => {
  const r = receivables(invoices, sales, TODAY);
  assert.deepEqual(r.rows.map((x) => x.invoice.id), ['c', 'd', 'b', 'a', 'f']);
  assert.equal(r.rows[0].sale.buyer, 'Riverina');
});
check('what is outstanding and what is overdue', () => {
  const r = receivables(invoices, sales, TODAY);
  assert.deepEqual(r.outstanding, { count: 5, total: 43000 });
  assert.deepEqual(r.overdue, { count: 3, total: 32000 });
});
check('the money by age', () => {
  const b = receivables(invoices, sales, TODAY).buckets;
  assert.deepEqual(b.notdue, { count: 1, total: 10000 });
  assert.deepEqual(b.d30, { count: 2, total: 27000 });
  assert.deepEqual(b.d60, { count: 0, total: 0 });
  assert.deepEqual(b.d60plus, { count: 1, total: 5000 });
  assert.deepEqual(b.nodate, { count: 1, total: 1000 });
});
check('how many days overdue', () => {
  const r = receivables(invoices, sales, TODAY);
  assert.equal(r.rows.find((x) => x.invoice.id === 'b').daysOver, 9);
  assert.equal(r.rows.find((x) => x.invoice.id === 'a').daysOver, -10);
  assert.equal(r.rows.find((x) => x.invoice.id === 'f').daysOver, null);
  assert.equal(r.rows.find((x) => x.invoice.id === 'a').overdue, false);
});
check('an invoice that lost its amount counts as nothing rather than breaking the total', () => {
  assert.equal(receivables([{ id: 'x', status: 'outstanding', dueDate: '2026-12-01' }], [], TODAY).outstanding.total, 0);
});

console.log('\n=== money the farm owes ===');

const bill = (id, dueDate, amount, gst, status = 'unpaid') => ({ id, kind: 'freight', supplier: 'Ace', dueDate, amount, gst, status });
const bills = [
  bill('p1', '2026-12-05', 1000, 100),     // 5 days over, 1100
  bill('p2', '2026-12-30', 2000, 200),     // not due, 2200
  bill('p3', '2026-11-01', 500, 50, 'paid'),
];

check('unpaid bills, GST included, oldest due first', () => {
  const r = payablesDue(bills, TODAY);
  assert.deepEqual(r.rows.map((x) => x.bill.id), ['p1', 'p2']);
  assert.equal(r.rows[0].amount, 1100);
  assert.deepEqual(r.outstanding, { count: 2, total: 3300 });
  assert.deepEqual(r.overdue, { count: 1, total: 1100 });
  assert.deepEqual(r.buckets.d30, { count: 1, total: 1100 });
});
check('what is owed to the farm against what it owes, and the net', () => {
  const p = moneyPosition(invoices, sales, bills, TODAY);
  assert.equal(p.owedToYou.outstanding.total, 43000);
  assert.equal(p.youOwe.outstanding.total, 3300);
  assert.equal(p.net, 39700);
  assert.equal(p.netOverdue, 32000 - 1100);
});
check('nothing owed either way', () => {
  const p = moneyPosition([], [], [], TODAY);
  assert.equal(p.net, 0);
  assert.equal(p.owedToYou.rows.length, 0);
});

console.log('\n=== deliveries still to go ===');

const sale = (id, tons, extra = {}) => ({ id, buyer: id, tons, price: 400, ...extra });
const load = (saleId, tons) => ({ id: `m${Math.random()}`, tos: [{ type: 'sale', id: saleId, tons }], froms: [] });
const contracts = [
  sale('past', 500, { deliveryEnd: '2026-11-30' }),                 // ended 10 days ago
  sale('soon', 300, { deliveryEnd: '2026-12-25' }),                 // ends in 15 days
  sale('later', 400, { deliveryEnd: '2027-03-01' }),
  sale('open', 200),                                                // no end date
  sale('full', 100, { deliveryEnd: '2026-11-01' }),                 // filled: left out
  sale('empty', 0),                                                 // no tonnes: left out
];
const moves = [load('past', 120), load('soon', 50), load('full', 100)];
const orders = [
  { id: 'o1', saleId: 'past', tons: 200, deliverBy: '2026-12-01', status: 'open' },    // overdue
  { id: 'o2', saleId: 'past', tons: 100, deliverBy: '2026-12-20', status: 'open' },
  { id: 'o3', saleId: 'soon', tons: 80, status: 'closed' },                              // closed: not counted
];
const rep = deliveries(contracts, moves, orders, TODAY);

check('filled and empty contracts are left out', () => {
  assert.deepEqual(rep.rows.map((r) => r.sale.id).sort(), ['later', 'open', 'past', 'soon']);
});
check('past the end first, then ending soonest, then later, then no end date', () => {
  assert.deepEqual(rep.rows.map((r) => r.sale.id), ['past', 'soon', 'later', 'open']);
  assert.deepEqual(rep.rows.map((r) => r.state), ['ended', 'soon', 'ok', 'none']);
});
check('tonnes left, and days to the end', () => {
  const past = rep.rows[0];
  assert.equal(past.delivered, 120);
  assert.equal(past.due, 380);
  assert.equal(past.daysToEnd, -10);
  assert.equal(rep.rows[1].daysToEnd, 15);
  assert.equal(ENDING_SOON_DAYS, 30);
});
check('the open orders against a contract, what is not yet ordered, and overdue orders', () => {
  const past = rep.rows[0];
  assert.equal(past.orders.count, 2);
  assert.equal(past.orders.left, 300);
  assert.equal(past.orders.nextBy, '2026-12-01');
  assert.equal(past.orders.overdue, 1);
  assert.equal(past.unordered, 80);
  assert.equal(rep.rows[1].orders.count, 0, 'a closed order is not open');
  assert.equal(rep.rows[1].unordered, 250);
});
check('the totals: still to deliver, past the end, ending soon', () => {
  assert.deepEqual(rep.total, { count: 4, due: 380 + 250 + 400 + 200 });
  assert.deepEqual(rep.ended, { count: 1, due: 380 });
  assert.deepEqual(rep.soon, { count: 1, due: 250 });
  assert.equal(rep.ordersOverdue, 1);
});
check('loads outside the contract by hand-entered delivered tonnes count too', () => {
  const r = deliveries([sale('m', 100, { tonsDelivered: 40 })], [], [], TODAY);
  assert.equal(r.rows[0].due, 60);
});

console.log('\n=== delivered, not yet invoiced ===');

const uiLoad = (id, saleId, tonsIn, date, rego = 'ABC123') => ({ id, date, truckRego: rego, ticketNo: id, froms: [{ type: 'silo', id: 's1', tons: tonsIn }], tos: [{ type: 'sale', id: saleId, tons: tonsIn }] });
const UI_SALES = [{ id: 'u1', price: 400, tons: 500 }, { id: 'u2', price: 300, tons: 100 }, { id: 'u3', price: 300, tons: 100 }];
const UI_MOVES = [
  uiLoad('a', 'u1', 30, '2026-10-01'), uiLoad('b', 'u1', 20, '2026-11-10'),
  uiLoad('c', 'u2', 10, '2026-11-12'),
];
check('loads on no invoice are listed per contract, with tonnes, value and how long the oldest has waited', () => {
  const r = uninvoiced(UI_SALES, UI_MOVES, [], '2026-11-14');
  assert.equal(r.rows.length, 2, 'u3 has no loads');
  assert.equal(r.rows[0].sale.id, 'u1', 'the longest waiting first');
  assert.equal(r.rows[0].tons, 50);
  assert.equal(r.rows[0].value, 50 * 400);
  assert.equal(r.rows[0].days, 44);
  assert.equal(r.rows[0].loads[0].ticketNo, 'a');
  assert.deepEqual(r.total, { count: 2, tons: 60, value: 50 * 400 + 10 * 300 });
});
check('a load on an invoice drops off, and invoices for other contracts do not hide it', () => {
  const inv = [{ id: 'i1', saleId: 'u1', lines: [{ movementId: 'a' }] }];
  const r = uninvoiced(UI_SALES, UI_MOVES, inv, '2026-11-14');
  assert.equal(r.rows.find((x) => x.sale.id === 'u1').tons, 20);
  const other = [{ id: 'i2', saleId: 'u2', lines: [{ movementId: 'a' }] }];
  assert.equal(uninvoiced(UI_SALES, UI_MOVES, other, '2026-11-14').rows.find((x) => x.sale.id === 'u1').tons, 50);
  const all = [{ id: 'i3', saleId: 'u1', lines: [{ movementId: 'a' }, { movementId: 'b' }] }, { id: 'i4', saleId: 'u2', lines: [{ movementId: 'c' }] }];
  assert.equal(uninvoiced(UI_SALES, UI_MOVES, all, '2026-11-14').rows.length, 0);
});
check('invoice lines now carry the ticket, the base price and what premium or discount moved it', () => {
  const lines = invoiceLineItems({ id: 'u1', price: 400, premiumDiscount: -5 }, [uiLoad('a', 'u1', 30, '2026-10-01')]);
  assert.equal(lines[0].ticketNo, 'a');
  assert.equal(lines[0].basePrice, 400);
  assert.equal(lines[0].adjust, -5);
  assert.equal(lines[0].rate, 395);
});

check('each load carries a freight rate: the contract\'s unless the load has its own, and the total is the lines added up', () => {
  const sale = { id: 'u1', price: 400, freight: 20, leviesPct: 0, freightPaidBy: 'buyer' };
  const loads = [uiLoad('a', 'u1', 30, '2026-10-01'), uiLoad('b', 'u1', 20, '2026-10-02')];
  const lines = invoiceLineItems(sale, loads, { b: '35' });
  assert.equal(lines[0].freightRate, 20);
  assert.equal(lines[0].freight, 600);
  assert.equal(lines[1].freightRate, 35);
  assert.equal(lines[1].freight, 700);
  assert.equal(invoiceTotals(sale, lines).freightTotal, 1300);
  // a line from before this existed, with no freight on it, takes the contract's rate
  assert.equal(invoiceTotals(sale, [{ tons: 10, subtotal: 4000 }]).freightTotal, 200);
  // a blank box falls back to the contract rate
  assert.equal(invoiceLineItems(sale, [loads[0]], { a: '' })[0].freightRate, 20);
});

check('when we pay the carrier (the default), no freight is taken off the grain invoice', () => {
  const sale = { id: 'u1', price: 400, freight: 20, leviesPct: 0 };
  const loads = [uiLoad('a', 'u1', 30, '2026-10-01')];
  const lines = invoiceLineItems(sale, loads, { a: '35' });
  assert.equal(lines[0].freight, 0);
  assert.equal(invoiceTotals(sale, lines).freightTotal, 0);
  assert.equal(invoiceTotals({ ...sale, freightPaidBy: 'we' }, [{ tons: 10, subtotal: 4000 }]).freightTotal, 0);
  assert.equal(freightOnInvoice(sale), false);
  assert.equal(freightOnInvoice({ freightPaidBy: 'buyer' }), true);
});
check('who pays the freight is stored with the contract terms, and a contract never set reads as we pay', () => {
  const FARM = '11111111-1111-1111-1111-111111111111';
  const mk = (extra) => ({
    currentYear: '2026', nextMovementNo: 1, businessDetails: {},
    years: { 2026: { commodities: [], storages: [], fields: [], movements: [], overheads: {}, invoices: [], sales: [{ id: '41414141-4141-4141-4141-414141414141', buyer: 'B', tons: 10, price: 100, ...extra }] } },
  });
  const terms = (extra) => stateToRows(mk(extra), FARM).sale_terms[0];
  assert.ok(!('freight_paid_by' in terms({})), 'not sent until it is set');
  assert.equal(terms({ freightPaidBy: 'buyer' }).freight_paid_by, 'buyer');
  assert.equal(terms({ freightPaidBy: 'we', __hasFreightPaidBy: true }).freight_paid_by, 'we');
  const back = (extra) => rowsToState(stateToRows(mk(extra), FARM)).years[2026].sales[0];
  assert.equal(back({}).freightPaidBy, undefined, 'unset stays unset, and reads as we pay');
  assert.equal(freightOnInvoice(back({})), false);
  assert.equal(back({ freightPaidBy: 'we', __hasFreightPaidBy: true }).freightPaidBy, 'we');
  assert.equal(back({ freightPaidBy: 'buyer' }).freightPaidBy, 'buyer');
});

console.log('\n=== the timeline ===');

check('bars sit on one axis: the window, filled by what is delivered, with today and the order ticks', () => {
  const rows = [
    { sale: {}, tons: 100, delivered: 25, due: 75, start: '2026-11-01', end: '2026-12-01', state: 'ok', orders: { count: 1, items: [{ by: '2026-11-20', left: 50, overdue: false }] } },
    { sale: {}, tons: 100, delivered: 0, due: 100, start: '', end: '', state: 'none', orders: { count: 0, items: [] } },
  ];
  const tl = timeline(rows, '2026-11-14');
  assert.equal(tl.bars.length, 1, 'the contract with no dates is not drawn');
  assert.equal(tl.unplaced, 1);
  const b = tl.bars[0];
  assert.equal(b.fill, 25);
  assert.ok(b.left > 0 && b.left + b.width < 100);
  assert.ok(tl.todayPct > b.left && tl.todayPct < b.left + b.width, 'today falls inside the window');
  assert.ok(b.ticks[0].pct > tl.todayPct && b.ticks[0].pct < b.left + b.width);
  assert.ok(tl.months.length >= 1);
});
check('a contract past its end, or with no start or no end, still gets a bar', () => {
  const tl = timeline([
    { sale: {}, tons: 10, delivered: 0, due: 10, start: '', end: '2026-10-01', state: 'ended', orders: { items: [] } },
    { sale: {}, tons: 10, delivered: 0, due: 10, start: '2026-11-20', end: '', state: 'none', orders: { items: [] } },
  ], '2026-11-14');
  assert.equal(tl.bars.length, 2);
  assert.ok(tl.bars.every((b) => b.width >= 1.5 && b.left >= 0 && b.left + b.width <= 100.001));
  assert.equal(tl.bars[1].openEnded, true);
  assert.equal(timeline([], '2026-11-14'), null);
});

console.log('\n=== invoices keep their amounts and dates on the server ===');

const FARM = '11111111-1111-1111-1111-111111111111';
const SALE = '41414141-4141-4141-4141-414141414141';
const INV = '71717171-7171-7171-7171-717171717171';
const state = (invoicesIn) => ({
  currentYear: '2026', nextMovementNo: 1, businessDetails: {},
  years: { 2026: { commodities: [], storages: [], fields: [], sales: [], movements: [], overheads: {}, invoices: invoicesIn } },
});
const real = {
  id: INV, saleId: SALE, invoiceNo: 1, status: 'outstanding', paidDate: null,
  issueDate: '2026-11-01', dueDate: '2026-12-01', lines: [{ desc: 'Wheat' }],
  totalTons: 100, subtotalExGST: 40000, freightTotal: 500, levies: 120, gst: 4000, totalPayable: 43380,
};

check('an invoice as the app makes it comes back with its amount, dates and figures', () => {
  const back = rowsToState(stateToRows(state([real]), FARM)).years[2026].invoices[0];
  for (const k of ['issueDate', 'dueDate', 'totalTons', 'subtotalExGST', 'freightTotal', 'levies', 'gst', 'totalPayable']) {
    assert.equal(back[k], real[k], k);
  }
  assert.deepEqual(back.lines, real.lines);
});
check('the row stores them inside totals, so no new column is needed', () => {
  const row = stateToRows(state([real]), FARM).invoices[0];
  assert.equal(row.totals.__invoice.totalPayable, 43380);
  assert.ok(!('due_date' in row));
});
check('an invoice with its own totals keeps them, apart from the extras', () => {
  const withTotals = { ...real, totals: { subtotal: 1, total: 2 } };
  const back = rowsToState(stateToRows(state([withTotals]), FARM)).years[2026].invoices[0];
  assert.deepEqual(back.totals, { subtotal: 1, total: 2 });
  assert.equal(back.totalPayable, 43380);
});
check('an invoice already on the server with empty totals still loads, without the extras', () => {
  const rows = stateToRows(state([real]), FARM);
  rows.invoices[0].totals = {};
  const back = rowsToState(rows).years[2026].invoices[0];
  assert.equal(back.totalPayable, undefined);
  assert.equal(back.invoiceNo, 1);
});

console.log('\n=== wired in ===');

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
check('Sales has buttons for both reports, for the roles that may see them', () => {
  const src = read('docs/js/views/sales.js');
  assert.match(src, /\['owner', 'manager', 'bookkeeper'\]\.includes\(db\.getRole\(\)\) \? `<button type="button" class="btn secondary" id="open-deliveries"/);
  assert.match(src, /\['owner', 'manager', 'bookkeeper'\]\.includes\(db\.getRole\(\)\) \? `<button type="button" class="btn secondary" id="open-money"/);
  assert.match(src, /openDeliveriesSheet\(\)/);
  assert.match(src, /openMoneySheet\(\)/);
});
check('an invoice worked out again gets its dates back if it had lost them', () => {
  assert.match(read('docs/js/views/invoice.js'), /existingInvoice\.issueDate \? \{\} : \{ issueDate: today \}/);
});

if (failures) { console.log(`\n${failures} failed`); process.exit(1); }
console.log('\nall passed');
