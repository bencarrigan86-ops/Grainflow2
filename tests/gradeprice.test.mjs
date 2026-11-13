// Run with:
//   node tests/gradeprice.test.mjs
//
// A contract that lists several grades, each with a $/t premium or discount: every load is paid the
// price plus the adjustment for its own grade.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanGradeOptions, gradeAdjustment, gradeRateFor } from '../docs/js/gradeprice.js';
import { saleEconomics, invoiceLineItems, invoiceTotals } from '../docs/js/derived.js';
import { stateToRows, rowsToState } from '../docs/js/mapping.js';

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); } catch (e) { failures++; console.log(`  FAIL  ${name}\n        ${e.message}`); }
};

// 600 t at $400 net of nothing: APW1 at the price, H2 $15 over, ASW1 $20 under
const sale = {
  id: 's1', tons: 600, price: 400, freight: 0, leviesPct: 0, premiumDiscount: 0, ginning: 0,
  gradeOptions: [{ grade: 'APW1', adjust: 0 }, { grade: 'H2', adjust: 15 }, { grade: 'ASW1', adjust: -20 }],
};
const load = (id, tons, grade, date = '2026-11-01') => ({ id, date, grade, tos: [{ type: 'sale', id: 's1', tons }] });
const loads = [load('m1', 100, 'H2'), load('m2', 50, 'ASW1'), load('m3', 30, ''), load('m4', 200, 'apw1')];

console.log('\n=== the list of grades ===');

check('trimmed, blanks dropped, repeats (ignoring case) dropped, adjustment a number', () => {
  const list = cleanGradeOptions([{ grade: ' H2 ', adjust: '15' }, { grade: 'h2', adjust: 99 }, { grade: '', adjust: 5 }, { grade: 'ASW1', adjust: 'x' }, null]);
  assert.deepEqual(list, [{ grade: 'H2', adjust: 15 }, { grade: 'ASW1', adjust: 0 }]);
});
check('nothing listed is nothing', () => {
  assert.deepEqual(cleanGradeOptions(undefined), []);
  assert.deepEqual(cleanGradeOptions('x'), []);
});

console.log('\n=== what the loads add ===');

check('each load is paid the adjustment for its own grade', () => {
  const a = gradeAdjustment(sale, loads);
  const by = Object.fromEntries(a.lines.map((l) => [l.grade, l]));
  assert.equal(by.H2.dollars, 100 * 15);
  assert.equal(by.ASW1.dollars, 50 * -20);
  assert.equal(by.APW1.dollars, 0);
  assert.equal(by.APW1.tons, 200, 'a grade is matched ignoring case');
  assert.equal(a.total, 1500 - 1000);
});
check('a load with no grade, or one not listed, is paid the price as it stands', () => {
  const a = gradeAdjustment(sale, [load('m5', 40, ''), load('m6', 25, 'FED1')]);
  assert.equal(a.total, 0);
  assert.equal(a.otherTons, 65);
});
check('loads to a different contract do not count', () => {
  const other = { id: 'm7', grade: 'H2', tos: [{ type: 'sale', id: 'someone-else', tons: 500 }] };
  assert.equal(gradeAdjustment(sale, [other]).total, 0);
});
check('a contract that lists no grades has no adjustment', () => {
  assert.deepEqual(gradeAdjustment({ id: 's1' }, loads), { total: 0, lines: [], otherTons: 0 });
});
check('the rate for one load', () => {
  assert.equal(gradeRateFor(sale, { grade: 'H2' }), 15);
  assert.equal(gradeRateFor(sale, { grade: 'ASW1' }), -20);
  assert.equal(gradeRateFor(sale, { grade: 'FED1' }), 0);
  assert.equal(gradeRateFor(sale, {}), 0);
});

console.log('\n=== the contract\'s value ===');

check('nothing delivered yet: the contract is worth the price on all of it', () => {
  assert.equal(saleEconomics(sale, []).totalValue, 600 * 400);
});
check('as loads are delivered the value moves by what their grades add', () => {
  const e = saleEconomics(sale, loads);
  assert.equal(e.totalValue, 600 * 400 + 500);
  assert.equal(e.gradeAdjustment, 500);
  assert.equal(e.gradeOtherTons, 30);
});
check('a contract that lists no grades is valued exactly as before', () => {
  const plain = { ...sale, gradeOptions: undefined };
  assert.equal(saleEconomics(plain, loads).totalValue, 600 * 400);
  assert.equal(saleEconomics(plain, loads).gradeAdjustment, 0);
});
check('it comes after levies and freight, like the flat premium: a premium is not levied', () => {
  const s = { ...sale, freight: 20, leviesPct: 0.01 };
  const e = saleEconomics(s, loads);
  assert.equal(e.totalValue, 600 * e.priceExFarm + 500);
});

console.log('\n=== invoices ===');

check('each load is invoiced at its own grade\'s rate', () => {
  const lines = invoiceLineItems(sale, loads);
  const rate = (id) => lines.find((l) => l.movementId === id).rate;
  assert.equal(rate('m1'), 415);
  assert.equal(rate('m2'), 380);
  assert.equal(rate('m3'), 400);
  assert.equal(rate('m4'), 400);
  assert.equal(invoiceTotals(sale, lines).subtotalExGST, 100 * 415 + 50 * 380 + 30 * 400 + 200 * 400);
});

console.log('\n=== saving and loading ===');

const FARM = '11111111-1111-1111-1111-111111111111';
const state = (extra) => ({
  currentYear: '2026', nextMovementNo: 1, businessDetails: {},
  years: { 2026: { commodities: [], fields: [], storages: [], movements: [], invoices: [], overheads: {},
    sales: [{ id: '44444444-4444-4444-4444-444444444444', tons: 100, price: 300, ...extra }] } },
});
check('the listed grades go to the server and come back', () => {
  const rows = stateToRows(state({ gradeOptions: sale.gradeOptions }), FARM);
  assert.deepEqual(rows.sale_terms[0].grade_options, sale.gradeOptions);
  assert.deepEqual(rowsToState(rows).years[2026].sales[0].gradeOptions, sale.gradeOptions);
});
check('with none listed, no column is sent, so contracts still save before the database has it', () => {
  assert.ok(!('grade_options' in stateToRows(state({}), FARM).sale_terms[0]));
});
check('having listed some and cleared them still sends an empty list, so the clearing reaches the server', () => {
  assert.deepEqual(stateToRows(state({ gradeOptions: [], __hasGradeOptions: true }), FARM).sale_terms[0].grade_options, []);
});

console.log('\n=== wired in ===');

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const salesView = readFileSync(join(ROOT, 'docs', 'js', 'views', 'sales.js'), 'utf8');
check('the contract form has the section, and saves what is listed', () => {
  assert.match(salesView, /id="grade-fold"/);
  assert.match(salesView, /gradeOptions: readGradeOptions\(\)/);
});
check('the database column is in the paste-in file', () => {
  assert.match(readFileSync(join(ROOT, 'supabase', 'paste-into-sql-editor.sql'), 'utf8'), /grade_options jsonb/);
});

if (failures) { console.log(`\n${failures} failed`); process.exit(1); }
console.log('\nall passed');
