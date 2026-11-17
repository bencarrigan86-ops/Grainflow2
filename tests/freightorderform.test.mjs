// Run with:
//   node tests/freightorderform.test.mjs
//
// The freight order form keeps its parts in folds, lets the buyer's order number be typed, offers the contract's own
// freight number to an order that has an older one, and the carrier's copy prints the typed buyer's order number.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { freightOrderPdf, freightDefaults } from '../docs/js/freight.js';
import { stateToRows, rowsToState } from '../docs/js/mapping.js';

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); } catch (e) { failures++; console.log(`  FAIL  ${name}\n        ${e.message}`); }
};
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const latin1 = (b) => Buffer.from(b).toString('latin1');

const FARM = '11111111-1111-1111-1111-111111111111';
const state = (f) => ({
  currentYear: '2026', nextMovementNo: 1, businessDetails: {},
  years: { 2026: { commodities: [], storages: [], fields: [], sales: [], movements: [], overheads: {}, invoices: [], payables: [], orders: [], freightOrders: [f] } },
});
const base = { id: '22222222-2222-2222-2222-222222222222', saleId: null, orderId: null, freightNo: 'CF-1094-01', carrier: 'Ace', carrierEmail: '', tons: 120, rate: 0.12, rateBasis: 'per_t', flatRate: '', distanceKm: '', loadFrom: '', loadBy: '', status: 'open', notes: '', pickup: '', deliverTo: '' };

check('an order with no buyer order number sends no such column, so saving works before the database has it', () => {
  assert.ok(!('buyer_order_no' in stateToRows(state(base), FARM).freight_orders[0]));
});

check('a typed buyer order number goes to the server and comes back', () => {
  const rows = stateToRows(state({ ...base, buyerOrderNo: 'BO-77' }), FARM);
  assert.equal(rows.freight_orders[0].buyer_order_no, 'BO-77');
  assert.equal(rowsToState(rows).years[2026].freightOrders[0].buyerOrderNo, 'BO-77');
});

check('clearing it after it was set reaches the server as nothing', () => {
  const rows = stateToRows(state({ ...base, buyerOrderNo: '', __hasBuyerOrderNo: true }), FARM);
  assert.equal(rows.freight_orders[0].buyer_order_no, null);
});

check('a new order starts with its grain order\'s number', () => {
  const d = freightDefaults({ sale: { id: 's', contractNo: 'CF-1094', tons: 100 }, order: { id: 'o', orderNo: 'PO-5', tons: 50 } });
  assert.equal(d.buyerOrderNo, 'PO-5');
  assert.equal(d.freightNo, 'CF-1094-01');
});

check('the carrier\'s copy prints the typed number, or the grain order\'s when none was typed', () => {
  const mk = (fo, order) => latin1(freightOrderPdf({ fo: { ...base, ...fo }, sale: { buyer: 'X', contractNo: 'CF-1094' }, order, commodityName: 'Wheat', business: {}, issuedBy: 'Ben', date: '2026-11-14' }));
  assert.ok(mk({ buyerOrderNo: 'BO-77' }, null).includes('BO-77'));
  assert.ok(mk({}, { orderNo: 'PO-5' }).includes('PO-5'));
});

check('the form has folds, a typeable buyer order no., and offers the contract number; the SQL adds the column', () => {
  const v = read('docs/js/views/freightorders.js');
  for (const k of ['rate', 'job', 'notes', 'loads', 'sign']) assert.ok(v.includes(`data-fold="${k}"`), k);
  assert.ok(v.includes("id: 'fo-boo'") && v.includes('fo-renumber') && v.includes('contractFreightNo'));
  assert.ok(read('supabase/paste-into-sql-editor.sql').includes('add column if not exists buyer_order_no text'));
  assert.ok(read('supabase/migrations/20261122000000_freight_buyer_order_no.sql').includes('buyer_order_no'));
  assert.ok(read('docs/js/storage.js').includes('__hasBuyerOrderNo'));
});

if (failures) { console.log(`\n${failures} FAILURES`); process.exit(1); }
console.log('\nall passed');
