// Run with:
//   node tests/oilprice.test.mjs
//
// Canola priced for its oil: a base oil level, and a % of the price for every 1% of oil above or below it.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { oilAdjustment, oilRateFor, oilPricingOn, AOF_OIL_BASE_PCT, AOF_OIL_ADJUST_PCT } from '../docs/js/oilprice.js';
import { saleEconomics, invoiceLineItems } from '../docs/js/derived.js';
import { stateToRows, rowsToState, hasLoadQuality } from '../docs/js/mapping.js';
import { specOf, specText } from '../docs/js/outload.js';

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); } catch (e) { failures++; console.log(`  FAIL  ${name}\n        ${e.message}`); }
};

// 500 t of canola at $700, the AOF basis: 42% oil, 1.5% of the price per 1%
const sale = { id: 's1', tons: 500, price: 700, freight: 0, leviesPct: 0, premiumDiscount: 0, ginning: 0, oilBasePct: 42, oilAdjustPct: 1.5 };
const load = (id, tons, oilPct) => ({ id, date: '2026-12-01', oilPct, tos: [{ type: 'sale', id: 's1', tons }] });

console.log('\n=== the rate for one load ===');

check('the AOF basis is 42% and 1.5%', () => {
  assert.equal(AOF_OIL_BASE_PCT, 42);
  assert.equal(AOF_OIL_ADJUST_PCT, 1.5);
});
check('each 1% of oil is worth 1.5% of the price: 44% on $700 is $21/t over', () => {
  assert.equal(oilRateFor(sale, { oilPct: 44 }), 700 * 0.015 * 2);
});
check('below the base it is a deduction: 40% is $21/t under', () => {
  assert.equal(oilRateFor(sale, { oilPct: 40 }), -21);
});
check('at the base, nothing', () => {
  assert.equal(oilRateFor(sale, { oilPct: 42 }), 0);
});
check('a fraction of a point counts: 42.4% on $700 is $4.20/t over', () => {
  assert.ok(Math.abs(oilRateFor(sale, { oilPct: 42.4 }) - 4.2) < 1e-9);
});
check('no oil recorded on the load: paid the price as it stands', () => {
  assert.equal(oilRateFor(sale, {}), 0);
  assert.equal(oilRateFor(sale, { oilPct: null }), 0);
  assert.equal(oilRateFor(sale, { oilPct: '' }), 0);
});
check('a load at 0% oil that was really recorded is a deduction, not "nothing recorded"', () => {
  assert.equal(oilRateFor(sale, { oilPct: 0 }), -42 * 10.5);
});
check('a contract that is not priced for oil ignores it', () => {
  assert.equal(oilPricingOn({ price: 700 }), false);
  assert.equal(oilRateFor({ price: 700, oilBasePct: 42, oilAdjustPct: 0 }, { oilPct: 50 }), 0);
});

console.log('\n=== what the loads add ===');

check('load by load, on the tonnes of each', () => {
  const a = oilAdjustment(sale, [load('m1', 100, 44), load('m2', 50, 40), load('m3', 25, 42)]);
  assert.equal(a.total, 100 * 21 + 50 * -21);
  assert.equal(a.tons, 175);
});
check('it comes to the same as pricing the tonnes-weighted average oil of the delivery', () => {
  const loads = [load('m1', 100, 44), load('m2', 50, 40), load('m3', 25, 42)];
  const a = oilAdjustment(sale, loads);
  assert.ok(Math.abs(a.avgOil - (100 * 44 + 50 * 40 + 25 * 42) / 175) < 1e-9);
  assert.ok(Math.abs(a.total - a.tons * a.perPoint * (a.avgOil - 42)) < 1e-6);
});
check('loads with no oil recorded are counted apart, and paid the price as it stands', () => {
  const a = oilAdjustment(sale, [load('m1', 100, 44), load('m2', 60, null)]);
  assert.equal(a.total, 2100);
  assert.equal(a.missingTons, 60);
  assert.equal(a.tons, 100);
});
check('loads to another contract do not count', () => {
  assert.equal(oilAdjustment(sale, [{ id: 'x', oilPct: 50, tos: [{ type: 'sale', id: 'other', tons: 99 }] }]).total, 0);
});

console.log('\n=== the contract\'s value ===');

check('nothing delivered: worth the price on all of it', () => {
  assert.equal(saleEconomics(sale, []).totalValue, 500 * 700);
});
check('the value moves by what the oil of delivered loads adds', () => {
  const e = saleEconomics(sale, [load('m1', 100, 44), load('m2', 50, 40)]);
  assert.equal(e.totalValue, 500 * 700 + 2100 - 1050);
  assert.equal(e.oilAdjustment, 1050);
});
check('with grade adjustments as well, both are added', () => {
  const s = { ...sale, gradeOptions: [{ grade: 'CAN', adjust: 10 }] };
  const m = { ...load('m1', 100, 44), grade: 'CAN' };
  assert.equal(saleEconomics(s, [m]).totalValue, 500 * 700 + 100 * 10 + 100 * 21);
});
check('a contract not priced for oil is valued exactly as before', () => {
  const plain = { ...sale, oilAdjustPct: 0 };
  assert.equal(saleEconomics(plain, [load('m1', 100, 50)]).totalValue, 500 * 700);
});
check('each load is invoiced at its own oil', () => {
  const lines = invoiceLineItems(sale, [load('m1', 100, 44), load('m2', 50, 40)]);
  assert.equal(lines.find((l) => l.movementId === 'm1').rate, 721);
  assert.equal(lines.find((l) => l.movementId === 'm2').rate, 679);
});

console.log('\n=== the load\'s oil as a measurement ===');

check('oil is one of the measurements: kept, blank is null, and written out with the rest', () => {
  assert.equal(specOf({ oilPct: '43.5' }).oilPct, 43.5);
  assert.equal(specOf({}).oilPct, null);
  assert.match(specText({ grade: 'CAN', oilPct: 43.5 }), /43\.5% oil/);
  assert.equal(hasLoadQuality({ oilPct: 43.5 }), true);
});

console.log('\n=== saving and loading ===');

const FARM = '11111111-1111-1111-1111-111111111111';
const MOV = '55555555-5555-5555-5555-555555555555';
const state = (movement, sales = []) => ({
  currentYear: '2026', nextMovementNo: 2, businessDetails: {},
  years: { 2026: { commodities: [], fields: [], storages: [], invoices: [], overheads: {}, sales, movements: [{ id: MOV, ticketNo: 1, froms: [], tos: [], tons: 10, ...movement }] } },
});
check('a load\'s oil goes to the server and comes back', () => {
  const rows = stateToRows(state({ oilPct: 43.5 }), FARM);
  assert.equal(rows.movements[0].oil_pct, 43.5);
  assert.equal(rowsToState(rows).years[2026].movements[0].oilPct, 43.5);
});
check('a graded load with no oil does not send the oil column, so it still saves before the database has it', () => {
  const row = stateToRows(state({ grade: 'APH1', proteinPct: 11 }), FARM).movements[0];
  assert.ok(!('oil_pct' in row));
  assert.equal(row.grade, 'APH1');
});
check('a load with no quality at all sends none of it', () => {
  assert.ok(!('oil_pct' in stateToRows(state({}), FARM).movements[0]));
});
check('having had oil and cleared it still sends a null, so the clearing reaches the server', () => {
  const row = stateToRows(state({ oilPct: null, __hasOil: true }), FARM).movements[0];
  assert.ok('oil_pct' in row);
  assert.equal(row.oil_pct, null);
});
check('a contract\'s oil terms go to the server and come back', () => {
  const rows = stateToRows(state({}, [{ id: '66666666-6666-6666-6666-666666666666', tons: 5, price: 700, oilBasePct: 42, oilAdjustPct: 1.5 }]), FARM);
  assert.equal(rows.sale_terms[0].oil_base_pct, 42);
  assert.equal(rows.sale_terms[0].oil_adjust_pct, 1.5);
  const back = rowsToState(rows).years[2026].sales[0];
  assert.equal(back.oilBasePct, 42);
  assert.equal(back.oilAdjustPct, 1.5);
});
check('a contract not priced for oil sends no oil columns', () => {
  const row = stateToRows(state({}, [{ id: '66666666-6666-6666-6666-666666666666', tons: 5, price: 700 }]), FARM).sale_terms[0];
  assert.ok(!('oil_base_pct' in row) && !('oil_adjust_pct' in row));
});

console.log('\n=== wired in ===');

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
check('the load form, the silo form and the contract form have oil', () => {
  assert.match(read('docs/js/views/movements.js'), /id: 'lq-oil'/);
  assert.match(read('docs/js/views/movements.js'), /oilPct: n\('lq-oil'\)/);
  assert.match(read('docs/js/views/storage.js'), /id: 'q-oil'/);
  assert.match(read('docs/js/views/sales.js'), /id="oil-fold"/);
});
check('the database columns are in the paste-in file', () => {
  const sql = read('supabase/paste-into-sql-editor.sql');
  for (const col of ['oil_pct numeric', 'oil_base_pct numeric', 'oil_adjust_pct numeric']) assert.ok(sql.includes(col), col);
});

if (failures) { console.log(`\n${failures} failed`); process.exit(1); }
console.log('\nall passed');
