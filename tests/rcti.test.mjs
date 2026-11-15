// Run with:
//   node tests/rcti.test.mjs
//
// Our invoice against the buyer's RCTI: the RCTI number and total are kept on the invoice, the difference is worked out, and
// both travel with the invoice to the server (inside its `totals`, so no new column is needed).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rctiCheck } from '../docs/js/derived.js';
import { stateToRows, rowsToState } from '../docs/js/mapping.js';

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); } catch (e) { failures++; console.log(`  FAIL  ${name}\n        ${e.message}`); }
};
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

console.log('\n=== the difference ===');
check('no RCTI total entered is no check', () => {
  assert.equal(rctiCheck({ totalPayable: 1000 }), null);
  assert.equal(rctiCheck({ totalPayable: 1000, rctiTotal: null }), null);
  assert.equal(rctiCheck({ totalPayable: 1000, rctiTotal: '' }), null);
});
check('the same total agrees', () => {
  const c = rctiCheck({ totalPayable: 12345.6, rctiTotal: 12345.6 });
  assert.equal(c.agrees, true); assert.equal(c.diff, 0);
});
check('a buyer paying less is a negative difference, paying more a positive one', () => {
  assert.equal(rctiCheck({ totalPayable: 10000, rctiTotal: 9880.5 }).diff, -119.5);
  assert.equal(rctiCheck({ totalPayable: 10000, rctiTotal: 10042 }).diff, 42);
  assert.equal(rctiCheck({ totalPayable: 10000, rctiTotal: 9880.5 }).agrees, false);
});
check('a total typed as 0 is a real total, not blank', () => {
  assert.equal(rctiCheck({ totalPayable: 500, rctiTotal: 0 }).diff, -500);
});
check('cents, not floating point dust, decide whether they agree', () => {
  assert.equal(rctiCheck({ totalPayable: 0.1 + 0.2, rctiTotal: 0.3 }).agrees, true);
});

console.log('\n=== saved with the farm ===');
const FARM = '99999999-9999-9999-9999-999999999999';
const state = (inv) => ({
  currentYear: '2026', nextMovementNo: 1, businessDetails: {},
  years: { 2026: { commodities: [], fields: [], storages: [], sales: [], movements: [], overheads: {}, payables: [],
    invoices: [{ id: '66666666-6666-6666-6666-666666666666', saleId: null, invoiceNo: 7, status: 'outstanding', lines: [], totalPayable: 1000, ...inv }] } },
});
check('the RCTI number and total go to the server and come back', () => {
  const rows = stateToRows(state({ rctiNo: 'R-5521', rctiTotal: 987.65 }), FARM);
  assert.equal(rows.invoices[0].totals.__invoice.rctiNo, 'R-5521');
  const back = rowsToState(rows).years[2026].invoices[0];
  assert.equal(back.rctiNo, 'R-5521'); assert.equal(back.rctiTotal, 987.65);
  assert.equal(rctiCheck(back).diff, -12.35);
});
check('clearing the total reaches the server too', () => {
  const rows = stateToRows(state({ rctiNo: '', rctiTotal: null }), FARM);
  assert.equal(rows.invoices[0].totals.__invoice.rctiTotal, null);
  assert.equal(rctiCheck(rowsToState(rows).years[2026].invoices[0]), null);
});

console.log('\n=== on the screen ===');
check('the invoice sheet has the RCTI card and says it is not printed; the list flags a difference', () => {
  const v = read('docs/js/views/invoice.js');
  assert.ok(v.includes("id: 'rcti-total'") && v.includes("id: 'rcti-no'") && v.includes("db.updateInvoice(invoice.id, patch)"));
  assert.ok(v.includes('not printed on the invoice'));
  assert.ok(v.includes("RCTI ${rcti.diff < 0 ? 'less' : 'more'} by"));
  assert.ok(!v.slice(v.indexOf('function invoiceDocHTML'), v.indexOf('function openInvoiceDocSheet')).includes('rcti'), 'nothing of it is in the printed document');
});

if (failures) { console.log(`\n${failures} failed`); process.exit(1); }
console.log('\nall passed');
