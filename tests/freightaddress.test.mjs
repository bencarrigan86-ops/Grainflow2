// Run with:
//   node tests/freightaddress.test.mjs
//
// A freight order's Deliver from and Deliver to addresses are full addresses (line 1, line 2, town, state, postcode),
// kept as one line plus parts, and the carrier's PDF says Deliver from / Deliver to and carries the contract number.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { freightOrderPdf } from '../docs/js/freight.js';
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
const base = { id: '22222222-2222-2222-2222-222222222222', saleId: null, orderId: null, freightNo: 'FO-001', carrier: 'Ace', carrierEmail: '', tons: 120, rate: 0.12, rateBasis: 'per_t', flatRate: '', distanceKm: '', loadFrom: '', loadBy: '', status: 'open', notes: '' };
const PICK = { line1: 'Lot 4 Smith Rd', line2: 'Gate 2', town: 'Wagin', state: 'WA', postcode: '6315' };
const DROP = { line1: '1 Port Rd', line2: '', town: 'Kwinana', state: 'WA', postcode: '6167' };

check('an order that has no address parts sends no such column, so saving works before the database has it', () => {
  const row = stateToRows(state({ ...base, pickup: 'Gate 2', deliverTo: 'Silo' }), FARM).freight_orders[0];
  assert.ok(!('pickup_parts' in row) && !('deliver_to_parts' in row));
});

check('both addresses go to the server in parts beside their lines, and come back whole', () => {
  const f = { ...base, pickup: 'Lot 4 Smith Rd, Gate 2, Wagin WA 6315', pickupParts: PICK, deliverTo: '1 Port Rd, Kwinana WA 6167', deliverToParts: DROP };
  const rows = stateToRows(state(f), FARM);
  assert.deepEqual(rows.freight_orders[0].pickup_parts, PICK);
  assert.equal(rows.freight_orders[0].deliver_to, '1 Port Rd, Kwinana WA 6167');
  const back = rowsToState(rows).years[2026].freightOrders[0];
  assert.deepEqual(back.pickupParts, PICK);
  assert.deepEqual(back.deliverToParts, DROP);
});

check('clearing an address after it had parts reaches the server as nothing', () => {
  const rows = stateToRows(state({ ...base, pickup: '', pickupParts: { line1: '', line2: '', town: '', state: '', postcode: '' }, __hasPickupParts: true }), FARM);
  assert.equal(rows.freight_orders[0].pickup_parts, null);
});

check('the carrier\'s PDF says Deliver from and Deliver to, and has the contract number and our reference', () => {
  const bytes = freightOrderPdf({
    fo: { ...base, pickup: 'Lot 4 Smith Rd, Gate 2, Wagin WA 6315', deliverTo: '1 Port Rd, Kwinana WA 6167' },
    sale: { buyer: 'Coastal Feeds', contractNo: 'CF-1094', ourRef: 'OUR-7' }, commodityName: 'Wheat', business: {}, issuedBy: 'Ben', date: '2026-11-14',
  });
  const s = latin1(bytes);
  for (const t of ['Deliver from:', 'Deliver to:', 'Contract no:', 'CF-1094 / OUR-7', 'Wagin WA 6315', 'Kwinana WA 6167']) assert.ok(s.includes(t), t);
  assert.ok(!s.includes('Pick up:'));
});

check('the form asks for each address in full, shows the contract number, and the SQL adds the columns', () => {
  const v = read('docs/js/views/freightorders.js');
  assert.ok(v.includes("addressFields('fo-pick'") && v.includes("addressFields('fo-drop'") && v.includes("readAddress(root, 'fo-pick')") && v.includes('Contract no.'));
  assert.ok(!v.includes('Pick up from'));
  assert.ok(read('supabase/paste-into-sql-editor.sql').includes('add column if not exists pickup_parts jsonb'));
  assert.ok(read('supabase/migrations/20261121000000_freight_address_parts.sql').includes('deliver_to_parts jsonb'));
  assert.ok(read('docs/js/storage.js').includes('__hasPickupParts'));
});

if (failures) { console.log(`\n${failures} FAILURES`); process.exit(1); }
console.log('\nall passed');
