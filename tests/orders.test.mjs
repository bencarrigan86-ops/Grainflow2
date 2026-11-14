// Run with:
//   node tests/orders.test.mjs
//
// Orders: a buyer asks for grain against a contract; loads are put against the order; it fills, or is closed.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  deliveredAgainst, orderState, summarise, ordersForLoad, windowText, orderTitle, STATE_LABEL, SOON_DAYS,
} from '../docs/js/orders.js';
import { stateToRows, rowsToState } from '../docs/js/mapping.js';

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); } catch (e) { failures++; console.log(`  FAIL  ${name}\n        ${e.message}`); }
};

const TODAY = '2026-12-10';
const load = (id, tons, orderId, saleId = 's1') => ({ id, orderId, tos: [{ type: 'sale', id: saleId, tons }] });
const order = (o) => ({ id: 'o1', saleId: 's1', tons: 500, status: 'open', ...o });

console.log('\n=== what has been delivered ===');

check('loads that name the order, as what they put into its contract', () => {
  const moves = [load('m1', 100, 'o1'), load('m2', 60, 'o1'), load('m3', 999, 'o2'), load('m4', 40, null)];
  assert.equal(deliveredAgainst(order(), moves), 160);
});
check('a load to some other contract does not count, even if it names the order', () => {
  assert.equal(deliveredAgainst(order(), [load('m1', 100, 'o1', 'other')]), 0);
});
check('no loads, nothing delivered', () => {
  assert.equal(deliveredAgainst(order(), []), 0);
  assert.equal(deliveredAgainst(order(), undefined), 0);
});

console.log('\n=== where an order stands ===');

const st = (o, moves = [], today = TODAY) => orderState(order(o), moves, today);

check('tonnes left and the share delivered', () => {
  const s = st({}, [load('m1', 125, 'o1')]);
  assert.equal(s.ordered, 500);
  assert.equal(s.delivered, 125);
  assert.equal(s.left, 375);
  assert.equal(s.pct, 0.25);
  assert.equal(s.state, 'open');
  assert.equal(s.active, true);
});
check('all delivered: filled, and no longer taking loads', () => {
  const s = st({}, [load('m1', 300, 'o1'), load('m2', 200, 'o1')]);
  assert.equal(s.state, 'filled');
  assert.equal(s.active, false);
  assert.equal(s.left, 0);
});
check('more than ordered is filled, and says by how much', () => {
  const s = st({}, [load('m1', 520, 'o1')]);
  assert.equal(s.state, 'filled');
  assert.equal(s.over, 20);
  assert.equal(s.pct, 1);
});
check('closed by hand, whatever has been delivered', () => {
  const s = st({ status: 'closed' }, [load('m1', 100, 'o1')]);
  assert.equal(s.state, 'closed');
  assert.equal(s.active, false);
  assert.equal(s.left, 400, 'what was not delivered is still shown');
});
check('window ended and not filled: overdue', () => {
  assert.equal(st({ deliverBy: '2026-12-09' }).state, 'overdue');
});
check('the last day is not overdue yet', () => {
  assert.notEqual(st({ deliverBy: '2026-12-10' }).state, 'overdue');
});
check('window ends within a few days: due soon', () => {
  assert.equal(st({ deliverBy: '2026-12-10' }).state, 'soon');
  assert.equal(SOON_DAYS, 3);
  assert.equal(st({ deliverBy: '2026-12-13' }).state, 'soon');
  assert.equal(st({ deliverBy: '2026-12-14' }).state, 'open');
});
check('window not open yet: not yet', () => {
  assert.equal(st({ deliverFrom: '2026-12-20', deliverBy: '2027-01-10' }).state, 'upcoming');
});
check('no window at all is just open', () => {
  assert.equal(st({}).state, 'open');
});
check('a filled order past its window is filled, not overdue', () => {
  assert.equal(st({ deliverBy: '2026-12-01' }, [load('m1', 500, 'o1')]).state, 'filled');
});
check('every state has words', () => {
  for (const s of ['open', 'soon', 'overdue', 'upcoming', 'filled', 'closed']) assert.ok(STATE_LABEL[s], s);
});

console.log('\n=== across orders ===');

check('what is still to deliver, and what is overdue or due soon', () => {
  const orders = [
    order({ id: 'o1', tons: 500, deliverBy: '2026-12-01' }),                      // overdue, 100 in
    order({ id: 'o2', tons: 200, deliverBy: '2026-12-12' }),                      // due soon
    order({ id: 'o3', tons: 300 }),                                               // open
    order({ id: 'o4', tons: 100, status: 'closed' }),                             // not counted
    order({ id: 'o5', tons: 50 }),                                                // filled below
  ];
  const moves = [load('m1', 100, 'o1'), load('m2', 50, 'o5')];
  const sum = summarise(orders, moves, TODAY);
  assert.deepEqual(sum.open, { count: 3, left: 400 + 200 + 300 });
  assert.deepEqual(sum.overdue, { count: 1, left: 400 });
  assert.deepEqual(sum.soon, { count: 1, left: 200 });
});
check('no orders, nothing owed', () => {
  assert.deepEqual(summarise([], [], TODAY), { open: { count: 0, left: 0 }, overdue: { count: 0, left: 0 }, soon: { count: 0, left: 0 } });
});

console.log('\n=== the orders a load can fill ===');

check('only the contract\'s own, still taking loads, soonest deadline first, no deadline last', () => {
  const orders = [
    order({ id: 'a', deliverBy: '2026-12-30' }),
    order({ id: 'b' }),
    order({ id: 'c', deliverBy: '2026-12-15' }),
    order({ id: 'd', saleId: 'other' }),
    order({ id: 'e', status: 'closed' }),
  ];
  assert.deepEqual(ordersForLoad('s1', orders, [], TODAY).map((o) => o.id), ['c', 'a', 'b']);
});
check('a filled order is not offered', () => {
  assert.deepEqual(ordersForLoad('s1', [order({ id: 'a' })], [load('m1', 500, 'a')], TODAY), []);
});
check('the order a load is already against stays on the list, though it has since filled or closed', () => {
  const orders = [order({ id: 'a' }), order({ id: 'b', status: 'closed' })];
  assert.deepEqual(ordersForLoad('s1', orders, [load('m1', 500, 'a')], TODAY, 'a').map((o) => o.id), ['a']);
  assert.deepEqual(ordersForLoad('s1', orders, [], TODAY, 'b').map((o) => o.id), ['a', 'b']);
});

console.log('\n=== words ===');

const fmt = (d) => d.slice(5);
check('the window', () => {
  assert.equal(windowText({ deliverFrom: '2026-12-03', deliverBy: '2026-12-20' }, fmt), '12-03 to 12-20');
  assert.equal(windowText({ deliverFrom: '2026-12-03' }, fmt), 'from 12-03');
  assert.equal(windowText({ deliverBy: '2026-12-20' }, fmt), 'by 12-20');
  assert.equal(windowText({}, fmt), '');
});
check('the title is the buyer\'s number and the tonnes', () => {
  assert.equal(orderTitle({ orderNo: 'PO-77', tons: 250 }), '#PO-77 · 250 t');
  assert.equal(orderTitle({ tons: 250 }), 'Order · 250 t');
});

console.log('\n=== saving and loading ===');

const FARM = '11111111-1111-1111-1111-111111111111';
const SALE = '41414141-4141-4141-4141-414141414141';
const OID = '51515151-5151-5151-5151-515151515151';
const MID = '61616161-6161-6161-6161-616161616161';
const state = (extra = {}) => ({
  currentYear: '2026', nextMovementNo: 1, businessDetails: {},
  years: { 2026: {
    commodities: [], storages: [], fields: [], sales: [], invoices: [], overheads: {}, movements: [], ...extra,
  } },
});
const full = { id: OID, saleId: SALE, orderNo: 'PO-77', tons: 250, deliverFrom: '2026-12-03', deliverBy: '2026-12-20', freightCompany: 'Ace Haulage', status: 'closed', notes: 'Gate 2 only' };

check('an order goes to the server and comes back whole', () => {
  const rows = stateToRows(state({ orders: [full] }), FARM);
  assert.equal(rows.orders.length, 1);
  assert.equal(rows.orders[0].sale_id, SALE);
  assert.equal(rows.orders[0].freight_company, 'Ace Haulage');
  assert.equal(rows.orders[0].deliver_by, '2026-12-20');
  assert.deepEqual(rowsToState(rows).years[2026].orders, [full]);
});
check('no orders, none sent and none made up', () => {
  const rows = stateToRows(state(), FARM);
  assert.deepEqual(rows.orders, []);
  assert.deepEqual(rowsToState(rows).years[2026].orders, []);
});
check('rows from a server that has no orders table yet still load', () => {
  const rows = stateToRows(state({ orders: [full] }), FARM);
  delete rows.orders;
  assert.deepEqual(rowsToState(rows).years[2026].orders, []);
});
const loadRow = (extra) => stateToRows(state({ movements: [{ id: MID, ticketNo: 1, date: '2026-12-05', froms: [], tos: [], tons: 30, ...extra }] }), FARM).movements[0];
check('the order a load fills goes to the server and comes back', () => {
  const rows = stateToRows(state({ movements: [{ id: MID, ticketNo: 1, date: '2026-12-05', froms: [], tos: [], tons: 30, orderId: OID }] }), FARM);
  assert.equal(rows.movements[0].order_id, OID);
  assert.equal(rowsToState(rows).years[2026].movements[0].orderId, OID);
});
check('a load with no order sends no such column, so loads still save before the database has it', () => {
  assert.ok(!('order_id' in loadRow({})));
});
check('taking a load off its order still reaches the server', () => {
  assert.equal(loadRow({ orderId: null, __hasOrderId: true }).order_id, null);
});

console.log('\n=== wired in ===');

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
check('the database has the table, its policies and the load\'s column', () => {
  const sql = read('supabase/paste-into-sql-editor.sql');
  assert.match(sql, /create table if not exists orders/);
  assert.match(sql, /orders_select on orders/);
  assert.match(sql, /add column if not exists order_id uuid/);
  assert.match(sql, /'payables', 'orders'\s*\)/, 'the delete function knows the table');
});
check('orders are pushed before the loads that name them, and read back', () => {
  const sync = read('docs/js/sync.js');
  assert.ok(sync.indexOf("'orders',") < sync.indexOf("'movements', 'movement_legs'"));
  assert.match(read('docs/js/hydrate.js'), /'orders'/);
});
check('the Sales tab opens Orders, and a load into a contract can pick one', () => {
  assert.match(read('docs/js/views/sales.js'), /id="open-orders"/);
  assert.match(read('docs/js/views/movements.js'), /id="to-order-select"/);
  assert.match(read('docs/js/views/movements.js'), /orderId: toKind === 'sale'/);
});
check('a movement says which order it was against, an order lists its loads, a contract lists its orders', () => {
  assert.match(read('docs/js/views/movements.js'), /order #\$\{order\.orderNo\}/);
  assert.match(read('docs/js/views/orders.js'), /Loads against this order/);
  assert.match(read('docs/js/views/sales.js'), /renderContractOrders\(root\.querySelector\('#contract-orders'\)/);
});
check('deleting a contract takes its orders with it', () => {
  assert.match(read('docs/js/storage.js'), /gone\.forEach\(\(oid\) => tombstone\('orders', oid\)\)/);
});

if (failures) { console.log(`\n${failures} failed`); process.exit(1); }
console.log('\nall passed');
