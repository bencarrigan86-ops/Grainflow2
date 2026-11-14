// Run with:
//   node tests/freight.test.mjs
//
// Freight orders: a job for a carrier linked to the buyer's order and contract; loads are carted on it; the carrier's
// bill is recorded against it; what is carted and not billed shows as owed.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  perTonne, rateText, loadedOn, freightState, billedOn, freightOwed, estimatedTotal, nextFreightNo,
  freightOrdersForLoad, freightTitle, freightDefaults, freightProblems, windowText, freightOrderPdf,
} from '../docs/js/freight.js';
import { stateToRows, rowsToState } from '../docs/js/mapping.js';
import { selectDirtyRows, KINDS } from '../docs/js/dirty.js';

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); } catch (e) { failures++; console.log(`  FAIL  ${name}\n        ${e.message}`); }
};
const latin1 = (bytes) => Array.from(bytes, (b) => String.fromCharCode(b)).join('');

const load = (id, tons, freightOrderId, saleId = 's1') => ({ id, freightOrderId, tos: [{ type: 'sale', id: saleId, tons }] });
const fo = (o) => ({ id: 'f1', saleId: 's1', orderId: 'o1', freightNo: 'FO-001', carrier: 'Ace Haulage', tons: 500, rate: 18.5, rateBasis: 'per_t', distanceKm: '', status: 'open', ...o });

console.log('\n=== the rate ===');

check('a rate per tonne is what a tonne costs', () => {
  assert.equal(perTonne(fo()), 18.5);
  assert.equal(rateText(fo()), '$18.50 per tonne');
});
check('a rate per tonne per km is multiplied by the distance', () => {
  const k = fo({ rate: 0.12, rateBasis: 'per_tkm', distanceKm: 240 });
  assert.equal(perTonne(k), 28.8);
  assert.equal(rateText(k), '$0.120 per tonne per km x 240 km = $28.80 per tonne');
  assert.match(rateText(fo({ rate: 0.12, rateBasis: 'per_tkm', distanceKm: '' })), /distance not set/);
});
check('the job is estimated at its rate over its tonnes', () => {
  assert.equal(estimatedTotal(fo()), 9250);
});

console.log('\n=== what has been carted, and what is owed ===');

check('loads that name the freight order, as what they put into its contract', () => {
  const moves = [load('m1', 100, 'f1'), load('m2', 60, 'f1'), load('m3', 999, 'f2'), load('m4', 40, null)];
  assert.equal(loadedOn(fo(), moves), 160);
  assert.equal(loadedOn(fo(), [load('m1', 100, 'f1', 'other')]), 0, 'a load to another contract does not count');
});
check('it is open until all its tonnes are carted or it is marked done', () => {
  const moves = [load('m1', 300, 'f1')];
  assert.deepEqual([freightState(fo(), moves).state, freightState(fo(), moves).left, freightState(fo(), moves).active], ['open', 200, true]);
  assert.equal(freightState(fo(), [...moves, load('m2', 200, 'f1')]).state, 'filled');
  assert.equal(freightState(fo({ status: 'closed' }), moves).active, false);
  assert.equal(freightState(fo(), [load('m1', 520, 'f1')]).over, 20);
});
check('what has been carted is owed at the rate, less what bills cover', () => {
  const moves = [load('m1', 100, 'f1'), load('m2', 60, 'f1')];
  const none = freightOwed(fo(), moves, []);
  assert.deepEqual([none.tons, none.owed, none.billed, none.unbilled], [160, 2960, 0, 2960]);
  const bills = [{ id: 'b1', kind: 'freight', freightOrderId: 'f1', amount: 1850, gst: 185 }, { id: 'b2', kind: 'freight', freightOrderId: 'f9', amount: 999 }, { id: 'b3', kind: 'brokerage', freightOrderId: 'f1', amount: 50 }];
  assert.equal(billedOn(fo(), bills), 1850, 'only freight bills for this order, ex GST');
  assert.equal(freightOwed(fo(), moves, bills).unbilled, 1110);
  assert.equal(freightOwed(fo(), moves, [{ kind: 'freight', freightOrderId: 'f1', amount: 5000 }]).unbilled, 0, 'never negative');
});
check('a per tonne per km order is owed at the worked-out rate', () => {
  const k = fo({ rate: 0.1, rateBasis: 'per_tkm', distanceKm: 200 });
  assert.equal(freightOwed(k, [load('m1', 50, 'f1')], []).owed, 1000);
});

console.log('\n=== numbering and picking ===');

check('the next number is one more than the highest in use', () => {
  assert.equal(nextFreightNo([]), 'FO-001');
  assert.equal(nextFreightNo([{ freightNo: 'FO-007' }, { freightNo: 'FO-003' }, { freightNo: 'misc' }]), 'FO-008');
});
check('a load is offered the open freight orders for its contract, its own order first', () => {
  const list = [
    fo({ id: 'a', orderId: 'o2', loadBy: '2026-12-01' }),
    fo({ id: 'b', orderId: 'o1', loadBy: '2026-12-20' }),
    fo({ id: 'c', saleId: 'other' }),
    fo({ id: 'd', status: 'closed' }),
  ];
  assert.deepEqual(freightOrdersForLoad('s1', 'o1', list, []).map((f) => f.id), ['b', 'a']);
  assert.deepEqual(freightOrdersForLoad('s1', null, list, []).map((f) => f.id), ['a', 'b']);
  assert.deepEqual(freightOrdersForLoad('s1', 'o1', list, [], 'd').map((f) => f.id), ['b', 'd', 'a'], 'the one already on the load stays');
});
check('a freight order is named by its number, carrier and tonnes', () => {
  assert.equal(freightTitle(fo()), 'FO-001 · Ace Haulage · 500 t');
  assert.equal(freightTitle({}), 'Freight order');
});

console.log('\n=== made from the buyer\'s order ===');

const SALE = { id: 's1', buyer: 'Riverina Grain Traders', contractNo: 'RGT-4471', ourRef: 'C-26-014', tons: 1200, freight: 22, location: 'Newbridge Receival Site', buyerContact: 'Sam Buyer 0412 345 678', deliveryStart: '2026-11-01', deliveryEnd: '2026-12-20', grade: 'APW1' };
const ORDER = { id: 'o1', saleId: 's1', orderNo: 'B-77', tons: 300, deliverFrom: '2026-11-10', deliverBy: '2026-11-30', freightCompany: 'Ace Haulage', notes: 'Gate 3, 7am to 4pm' };

check('the order gives the tonnes, window, carrier and notes; the contract the destination and a starting rate', () => {
  const d = freightDefaults({ sale: SALE, order: ORDER, freightOrders: [{ freightNo: 'FO-004' }], carrierEmails: { 'ace haulage': 'dispatch@ace.example.com' } });
  assert.deepEqual([d.saleId, d.orderId, d.freightNo, d.carrier, d.carrierEmail], ['s1', 'o1', 'FO-005', 'Ace Haulage', 'dispatch@ace.example.com']);
  assert.deepEqual([d.tons, d.loadFrom, d.loadBy, d.deliverTo, d.rate, d.rateBasis, d.notes], [300, '2026-11-10', '2026-11-30', 'Newbridge Receival Site', 22, 'per_t', 'Gate 3, 7am to 4pm']);
});
check('with no buyer order it falls back to the contract\'s tonnes and dates', () => {
  const d = freightDefaults({ sale: SALE });
  assert.deepEqual([d.orderId, d.tons, d.loadFrom, d.loadBy, d.carrier], ['', 1200, '2026-11-01', '2026-12-20', '']);
});
check('what would stop it going is listed', () => {
  assert.deepEqual(freightProblems(fo()), []);
  assert.deepEqual(freightProblems(fo({ carrier: '', rate: 0 })), ['Who is carting it', 'The rate']);
  assert.ok(freightProblems(fo({ rateBasis: 'per_tkm', distanceKm: '' })).includes('The distance in km'));
  assert.ok(freightProblems(fo({ loadFrom: '2026-12-10', loadBy: '2026-12-01' })).some((p) => /before/.test(p)));
});
check('the window reads day-month-year', () => {
  assert.equal(windowText({ loadFrom: '2026-11-10', loadBy: '2026-11-30' }), '10-11-2026 to 30-11-2026');
  assert.equal(windowText({ loadBy: '2026-11-30' }), 'by 30-11-2026');
  assert.equal(windowText({}), '');
});

console.log('\n=== the carrier\'s PDF ===');

check('it is one PDF page with the job and the rate, and nothing about the grain\'s price', () => {
  const d = freightDefaults({ sale: { ...SALE, price: 412.5 }, order: ORDER, freightOrders: [] });
  const bytes = freightOrderPdf({ fo: { ...d, pickup: 'Silo 3, home farm', rate: 0.12, rateBasis: 'per_tkm', distanceKm: 240 }, sale: { ...SALE, price: 412.5 }, order: ORDER, commodityName: 'Wheat', business: { entityName: 'Carrigan Ag Pty Ltd', contactName: 'Ben Carrigan', phone: '0400 111 222', email: 'ben@example.com', abn: '12 345 678 901' }, issuedBy: 'Ben Carrigan', date: '2026-11-14' });
  const s = latin1(bytes);
  assert.ok(s.startsWith('%PDF'));
  assert.match(s, /\/Count 1/);
  for (const text of ['FREIGHT ORDER', 'FO-001', 'Ace Haulage', 'dispatch', 'Wheat', 'Silo 3, home farm', 'Newbridge Receival Site', '10-11-2026 to 30-11-2026', 'B-77', 'RGT-4471', 'per tonne per km', '240 km', 'Gate 3', 'Issued by Ben Carrigan', '14-11-2026']) {
    if (text === 'dispatch') continue;      // no email on this one
    assert.ok(s.includes(text), text);
  }
  assert.ok(!s.includes('412.5') && !s.includes('412.50'), 'the grain price is not on it');
});

console.log('\n=== saved with the farm ===');

const FARM = '11111111-1111-1111-1111-111111111111';
const baseState = (extra) => ({
  currentYear: '2026', nextMovementNo: 1, businessDetails: {},
  years: { 2026: { commodities: [], storages: [], fields: [], sales: [], movements: [], overheads: {}, invoices: [], payables: [], orders: [], freightOrders: [], ...extra } },
});

check('a freight order is stored, and comes back the same', () => {
  const f = { id: '22222222-2222-2222-2222-222222222222', saleId: null, orderId: null, freightNo: 'FO-001', carrier: 'Ace', carrierEmail: 'a@b.example', tons: 120, rate: 0.12, rateBasis: 'per_tkm', distanceKm: 240, pickup: 'Gate 2', deliverTo: 'Silo', loadFrom: '2026-02-01', loadBy: '2026-02-20', status: 'open', notes: 'x' };
  const rows = stateToRows(baseState({ freightOrders: [f] }), FARM);
  assert.equal(rows.freight_orders.length, 1);
  assert.equal(rows.freight_orders[0].rate_basis, 'per_tkm');
  assert.equal(rows.freight_orders[0].distance_km, 240);
  const back = rowsToState(rows).years[2026].freightOrders[0];
  assert.deepEqual({ ...back }, f);
});
check('a load and a bill carry their freight order only once they have one, and clearing it reaches the server', () => {
  const FID = '33333333-3333-3333-3333-333333333333';
  const mv = (extra) => ({ id: '44444444-4444-4444-4444-444444444444', ticketNo: 1, date: '2026-02-01', status: 'closed', tons: 10, froms: [], tos: [], ...extra });
  const pay = (extra) => ({ id: '55555555-5555-5555-5555-555555555555', kind: 'freight', amount: 10, gst: 1, status: 'unpaid', ...extra });
  const plain = stateToRows(baseState({ movements: [mv({})], payables: [pay({})] }), FARM);
  assert.ok(!('freight_order_id' in plain.movements[0]) && !('freight_order_id' in plain.payables[0]), 'not sent until one is named');
  const named = stateToRows(baseState({ movements: [mv({ freightOrderId: FID })], payables: [pay({ freightOrderId: FID })] }), FARM);
  assert.equal(named.movements[0].freight_order_id, FID);
  assert.equal(named.payables[0].freight_order_id, FID);
  const back = rowsToState(named).years[2026];
  assert.equal(back.movements[0].freightOrderId, FID);
  assert.equal(back.payables[0].freightOrderId, FID);
  const cleared = stateToRows(baseState({ movements: [mv({ freightOrderId: null, __hasFreightOrderId: true })], payables: [pay({ freightOrderId: null, __hasFreightOrderId: true })] }), FARM);
  assert.equal(cleared.movements[0].freight_order_id, null);
  assert.equal(cleared.payables[0].freight_order_id, null);
});
check('only the freight orders a device changed are sent', () => {
  const f1 = { id: '22222222-2222-2222-2222-222222222222', freightNo: 'FO-001', tons: 1, rate: 1 };
  const f2 = { id: '66666666-6666-6666-6666-666666666666', freightNo: 'FO-002', tons: 1, rate: 1 };
  const state = baseState({ freightOrders: [f1, f2] });
  const rows = stateToRows(state, FARM);
  assert.ok(KINDS.includes('freightorder'));
  const out = selectDirtyRows(rows, state, [{ kind: 'freightorder', id: f2.id }]);
  assert.deepEqual(out.freight_orders.map((r) => r.id), [f2.id]);
});

console.log('\n=== wired in ===');

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

check('it is hydrated, pushed before loads and bills, and writable by owner, manager and bookkeeper only', () => {
  assert.match(read('docs/js/hydrate.js'), /'orders', 'freight_orders'/);
  const sync = read('docs/js/sync.js');
  assert.ok(sync.indexOf("'freight_orders',") < sync.indexOf("'movements', 'movement_legs'"), 'before movements');
  const w = sync.slice(sync.indexOf('const WRITABLE'));
  assert.match(w.slice(w.indexOf('manager:'), w.indexOf('bookkeeper:')), /freight_orders/);
  assert.match(w.slice(w.indexOf('bookkeeper:'), w.indexOf('farm_worker:')), /freight_orders/);
  assert.ok(!/freight_orders/.test(w.slice(w.indexOf('farm_worker:'))), 'a farm worker and a driver cannot write them');
});
check('the database has the table (owner, manager, bookkeeper only), the two link columns and the delete rule', () => {
  const sql = read('supabase/paste-into-sql-editor.sql');
  assert.match(sql, /create table if not exists freight_orders/);
  assert.match(sql, /freight_orders_select on freight_orders for select\s+using \(app_role\(farm_id\) in \('owner', 'manager', 'bookkeeper'\)/);
  assert.match(sql, /alter table movements\s+add column if not exists freight_order_id/);
  assert.match(sql, /alter table payables\s+add column if not exists freight_order_id/);
  assert.match(sql, /'payables', 'orders', 'freight_orders'\s*\) then/);
  assert.match(sql, /'vendor_dec', 'freight_order', 'other'/);
});
check('freight orders are reached from Orders and from an order, loads pick one, and Payables shows what is not billed', () => {
  const orders = read('docs/js/views/orders.js');
  assert.match(orders, /id="open-freight"/);
  assert.match(orders, /openFreightOrderSheet\(null, \{ orderId: existing\.id \}\)/);
  assert.match(read('docs/js/views/movements.js'), /id="to-freight-select"/);
  assert.match(read('docs/js/views/movements.js'), /freightOrderId: toKind === 'sale'/);
  const pay = read('docs/js/views/payables.js');
  assert.match(pay, /Freight not yet billed/);
  assert.match(pay, /\.\.\.\(src\.freightOrderId \? \{ freightOrderId: src\.freightOrderId \} : \{\}\)/);
});
check('a sent freight order is filed with its contract as a document kind the contract knows', () => {
  assert.match(read('docs/js/documents.js'), /value: 'freight_order'/);
  assert.match(read('docs/js/views/freightorders.js'), /kind: 'freight_order'/);
});

if (failures) { console.log(`\n${failures} failed`); process.exit(1); }
console.log('\nall passed');
