// Run with:
//   node tests/invoicing.test.mjs
//
// Contract invoicing: seller invoicing or a buyer RCTI, chosen on the contract, printed on the confirmation, and kept
// as an optional column that is only sent once it has been set.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { INVOICING, INVOICING_ON_CONTRACT, INVOICING_VALUES } from '../docs/js/invoicing.js';
import { stateToRows, rowsToState } from '../docs/js/mapping.js';

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); } catch (e) { failures++; console.log(`  FAIL  ${name}\n        ${e.message}`); }
};
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

const FARM = 'f0000000-0000-4000-8000-000000000001';
const state = (sale) => ({
  businessDetails: {}, years: { 2026: { commodities: [], fields: [], storage: [], sales: [{ id: 's1', buyer: 'B', tons: 10, price: 100, ...sale }], movements: [], inputs: [], orders: [], invoices: [] } },
});

check('the choices are not set, seller invoicing and buyer RCTI, and the confirmation words them', () => {
  assert.deepEqual(INVOICING.map((o) => o.value), ['', 'seller', 'rcti']);
  assert.deepEqual(INVOICING_VALUES, ['seller', 'rcti']);
  assert.equal(INVOICING_ON_CONTRACT.seller, 'Seller invoicing');
  assert.equal(INVOICING_ON_CONTRACT.rcti, 'Buyer RCTI');
});

check('a contract with nothing set sends no invoicing column, so an unmigrated server is not hit', () => {
  assert.ok(!('invoicing' in stateToRows(state({}), FARM).sales[0]));
});

check('a set value goes to the server and comes back', () => {
  for (const v of ['seller', 'rcti']) {
    const rows = stateToRows(state({ invoicing: v }), FARM);
    assert.equal(rows.sales[0].invoicing, v);
    assert.equal(rowsToState(rows).years[2026].sales[0].invoicing, v);
  }
});

check('clearing it after it was set reaches the server as null, and a stray value is not kept', () => {
  assert.equal(stateToRows(state({ invoicing: '', __hasInvoicing: true }), FARM).sales[0].invoicing, null);
  assert.equal(stateToRows(state({ invoicing: 'sideways' }), FARM).sales[0].invoicing, null);
});

check('the form has the choice and saves it, the confirmation prints it, and the SQL adds the column', () => {
  const s = read('docs/js/views/sales.js');
  assert.ok(s.includes("id: 'invoicing'") && s.includes("invoicing: getVal(root, 'invoicing') || ''") && s.includes('options: INVOICING'));
  assert.ok(read('docs/js/views/contract.js').includes("term('Invoicing', INVOICING_ON_CONTRACT[sale.invoicing])"));
  const st = read('docs/js/storage.js');
  assert.ok(st.includes('merged.__hasInvoicing = true') && st.includes('__hasInvoicing: true'));
  assert.ok(read('supabase/paste-into-sql-editor.sql').includes('add column if not exists invoicing text'));
  assert.ok(read('supabase/migrations/20261120000000_sale_invoicing.sql').includes('alter table sales'));
});

if (failures) { console.log(`\n${failures} FAILURES`); process.exit(1); }
console.log('\nall passed');
