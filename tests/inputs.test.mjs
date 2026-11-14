// Run with:
//   node tests/inputs.test.mjs
//
// Inputs and stock: seed, fertiliser, fuel and chemical in and out, what is on hand, what this season's paddocks call
// for, and that it is saved with the farm.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  KINDS as INPUT_KINDS, normName, productKey, moveDelta, convert, stockLevels, productMoves, stockValue,
  plannedNeeds, planVsStock, inputProblems, adjustmentFor, qtyText,
} from '../docs/js/inputs.js';
import { stateToRows, rowsToState } from '../docs/js/mapping.js';
import { selectDirtyRows, KINDS } from '../docs/js/dirty.js';

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); } catch (e) { failures++; console.log(`  FAIL  ${name}\n        ${e.message}`); }
};

const mv = (o) => ({ id: `m${Math.random()}`, kind: 'fert', product: 'Urea', unit: 't', type: 'buy', qty: 10, unitCost: '', date: '2026-03-01', supplier: '', reference: '', notes: '', ...o });

console.log('\n=== stock on hand ===');

check('there are four kinds, and seed and fertiliser come first', () => {
  assert.deepEqual(INPUT_KINDS.map((k) => k.key), ['seed', 'fert', 'fuel', 'chem']);
});
check('what is bought comes in, what is used goes out, a count corrects', () => {
  assert.equal(moveDelta(mv({ type: 'buy', qty: 10 })), 10);
  assert.equal(moveDelta(mv({ type: 'use', qty: 4 })), -4);
  assert.equal(moveDelta(mv({ type: 'adjust', qty: -1.5 })), -1.5);
  const [urea] = stockLevels([mv({ qty: 40 }), mv({ type: 'use', qty: 12.5 }), mv({ type: 'adjust', qty: -0.5 })]);
  assert.equal(urea.onHand, 27);
  assert.equal(urea.bought, 40);
  assert.equal(urea.used, 12.5);
});
check('the same product spelt differently is one product', () => {
  assert.equal(normName('  Urea (46%) '), normName('UREA 46'));
  const levels = stockLevels([mv({ product: 'Urea' }), mv({ product: ' urea ', qty: 5 })]);
  assert.equal(levels.length, 1);
  assert.equal(levels[0].onHand, 15);
});
check('seed and fertiliser of the same name are different products', () => {
  assert.notEqual(productKey('seed', 'Scepter'), productKey('fert', 'Scepter'));
  assert.equal(stockLevels([mv({ kind: 'seed', product: 'Scepter' }), mv({ kind: 'fert', product: 'Scepter' })]).length, 2);
});
check('products are listed seed, fertiliser, fuel, chemical, then by name', () => {
  const levels = stockLevels([
    mv({ kind: 'chem', product: 'Glyphosate', unit: 'L' }), mv({ kind: 'fuel', product: 'Diesel', unit: 'L' }),
    mv({ kind: 'fert', product: 'MAP' }), mv({ kind: 'fert', product: 'Urea' }), mv({ kind: 'seed', product: 'Scepter wheat' }),
  ]);
  assert.deepEqual(levels.map((l) => l.product), ['Scepter wheat', 'MAP', 'Urea', 'Diesel', 'Glyphosate']);
});
check('the average cost is weighted by what each delivery was, and ignores deliveries with no price', () => {
  const [urea] = stockLevels([mv({ qty: 10, unitCost: 800 }), mv({ qty: 30, unitCost: 900 }), mv({ qty: 5 })]);
  assert.equal(urea.avgCost, 875);
  assert.equal(stockValue([{ onHand: 20, avgCost: 875 }, { onHand: -3, avgCost: 100 }]), 17500, 'a negative balance is not worth anything');
});
check('stock can go below nothing, so a wrong book shows rather than hides', () => {
  assert.equal(stockLevels([mv({ qty: 5 }), mv({ type: 'use', qty: 8 })])[0].onHand, -3);
});
check('litres and tonnes do not mix, kilos and tonnes do', () => {
  assert.equal(convert(2, 't', 'kg'), 2000);
  assert.equal(convert(500, 'kg', 't'), 0.5);
  assert.equal(convert(5, 'L', 'L'), 5);
  assert.equal(convert(5, 'L', 't'), null);
});
check('a product keeps the history of its own entries, newest first', () => {
  const moves = [mv({ id: 'a', date: '2026-03-01' }), mv({ id: 'b', date: '2026-05-01' }), mv({ id: 'c', product: 'MAP', date: '2026-06-01' })];
  assert.deepEqual(productMoves(moves, 'fert', 'urea').map((m) => m.id), ['b', 'a']);
});
check('a count is typed as what was counted and saved as the correction', () => {
  assert.equal(adjustmentFor(27, 24.5), -2.5);
  assert.equal(adjustmentFor(0, 8), 8);
  assert.equal(adjustmentFor(5, 5), 0);
});
check('what would stop an entry being saved is listed', () => {
  assert.deepEqual(inputProblems(mv({})), []);
  assert.ok(inputProblems(mv({ product: '' })).includes('Name the product.'));
  assert.ok(inputProblems(mv({ qty: 0 })).includes('Enter how much.'));
  assert.ok(inputProblems(mv({ type: 'use', qty: -2 })).includes('Enter how much.'));
  assert.deepEqual(inputProblems(mv({ type: 'adjust', qty: -2 })), []);
  assert.ok(inputProblems(mv({ type: 'adjust', qty: 0 })).some((p) => /nothing to correct/.test(p)));
  assert.ok(inputProblems(mv({ kind: 'diesel' })).length);
});
check('quantities read in the product\'s own unit', () => {
  assert.equal(qtyText(27, 't'), '27 t');
  assert.equal(qtyText(1250.5, 'L'), '1,250.5 L');
});

console.log('\n=== what the paddocks call for ===');

const FIELDS = [
  { id: 'f1', seedVariety: 'Scepter', areaHa: 100 },
  { id: 'f2', seedVariety: ' scepter ', areaHa: 50 },
  { id: 'f3', seedVariety: '', areaHa: 10 },
];
const needs = plannedNeeds(FIELDS, {
  seedTons: (f) => f.areaHa * 0.08,
  ureaTons: (f) => (f.id === 'f3' ? 0 : f.areaHa * 0.1),
  starterTons: (f) => (f.id === 'f1' ? 2 : 0),
});

check('seed is added up by variety, urea and starter across paddocks, and a paddock needing none adds none', () => {
  const by = Object.fromEntries(needs.map((n) => [n.product, n.tons]));
  assert.equal(by.Scepter, 12);
  assert.equal(by['Seed (no variety set)'], 0.8);
  assert.equal(by.Urea, 15);
  assert.equal(by['Starter fertiliser'], 2);
});
check('each need is set against the stock of the same name, in tonnes', () => {
  const levels = stockLevels([mv({ qty: 10 }), mv({ kind: 'seed', product: 'scepter', unit: 'kg', qty: 9000 })]);
  const plan = planVsStock(needs, levels);
  const urea = plan.find((p) => p.product === 'Urea');
  assert.equal(urea.onHandT, 10);
  assert.equal(urea.shortT, 5);
  const seed = plan.find((p) => /^scepter$/i.test(p.product));
  assert.equal(seed.onHandT, 9, 'kilos are read as tonnes');
  assert.equal(seed.shortT, 3);
  const starter = plan.find((p) => p.product === 'Starter fertiliser');
  assert.equal(starter.bought, false);
  assert.equal(starter.shortT, 2);
});

console.log('\n=== saved with the farm ===');

const FARM = '11111111-1111-1111-1111-111111111111';
const baseState = (extra) => ({
  currentYear: '2026', nextMovementNo: 1, businessDetails: {},
  years: { 2026: { commodities: [], storages: [], fields: [], sales: [], movements: [], overheads: {}, invoices: [], payables: [], orders: [], freightOrders: [], inputStock: [], ...extra } },
});
const ENTRY = { id: '22222222-2222-2222-2222-222222222222', kind: 'fert', product: 'Urea', unit: 't', type: 'buy', qty: 40, unitCost: 880, date: '2026-03-04', supplier: 'Elders', reference: 'INV-221', notes: 'Delivered to shed 2' };

check('an entry is stored, and comes back the same', () => {
  const rows = stateToRows(baseState({ inputStock: [ENTRY] }), FARM);
  assert.equal(rows.input_stock.length, 1);
  assert.equal(rows.input_stock[0].move_type, 'buy');
  assert.equal(rows.input_stock[0].unit_cost, 880);
  assert.equal(rows.input_stock[0].move_date, '2026-03-04');
  assert.deepEqual({ ...rowsToState(rows).years[2026].inputStock[0] }, ENTRY);
});
check('an entry with no price or detail comes back with them blank, and a correction keeps its sign', () => {
  const bare = { id: '33333333-3333-3333-3333-333333333333', kind: 'fuel', product: 'Diesel', unit: 'L', type: 'adjust', qty: -120.5, unitCost: '', date: '', supplier: '', reference: '', notes: '' };
  const rows = stateToRows(baseState({ inputStock: [bare] }), FARM);
  assert.equal(rows.input_stock[0].unit_cost, null);
  assert.equal(rows.input_stock[0].qty, -120.5);
  assert.deepEqual({ ...rowsToState(rows).years[2026].inputStock[0] }, bare);
});
check('only the entries a device changed are sent', () => {
  const a = { ...ENTRY };
  const b = { ...ENTRY, id: '44444444-4444-4444-4444-444444444444', product: 'MAP' };
  const state = baseState({ inputStock: [a, b] });
  const rows = stateToRows(state, FARM);
  assert.ok(KINDS.includes('inputmove'));
  assert.deepEqual(selectDirtyRows(rows, state, [{ kind: 'inputmove', id: b.id }]).input_stock.map((r) => r.id), [b.id]);
  assert.equal(selectDirtyRows(rows, state, [{ kind: 'year', id: '2026' }]).input_stock.length, 2);
});

console.log('\n=== wired in ===');

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

check('it is hydrated, pushed, and writable by owner, manager and bookkeeper only', () => {
  assert.match(read('docs/js/hydrate.js'), /'input_stock'/);
  const sync = read('docs/js/sync.js');
  assert.ok(sync.includes("'input_stock',"), 'in the push order');
  const w = sync.slice(sync.indexOf('const WRITABLE'));
  assert.match(w.slice(w.indexOf('manager:'), w.indexOf('bookkeeper:')), /input_stock/);
  assert.match(w.slice(w.indexOf('bookkeeper:'), w.indexOf('farm_worker:')), /input_stock/);
  assert.ok(!/input_stock/.test(w.slice(w.indexOf('farm_worker:'))), 'a farm worker and a driver cannot write them');
});
check('stock is summed across every season, and a new season starts with no entries of its own', () => {
  const s = read('docs/js/storage.js');
  assert.ok(s.includes('Object.values(data.years).flatMap((y) => y.inputStock || [])'));
  assert.ok(s.includes("tombstone('input_stock', m.id)"), 'deleting a season stamps them');
  assert.ok(s.includes("touch('inputmove'"));
});
check('the database has the table (owner, manager, bookkeeper only) and the delete rule', () => {
  const sql = read('supabase/paste-into-sql-editor.sql');
  assert.match(sql, /create table if not exists input_stock/);
  assert.match(sql, /input_stock_select on input_stock for select\s+using \(app_role\(farm_id\) in \('owner', 'manager', 'bookkeeper'\)/);
  assert.match(sql, /'freight_orders', 'input_stock'\s*\) then/);
  assert.equal(sql, sql.replace(/\r/g, ''), 'no stray carriage returns');
  assert.ok(read('supabase/migrations/20261114260000_input_stock.sql').includes('create table if not exists input_stock'));
});
check('Production has the Inputs and stock button for the roles that see money, and the screen records the three kinds of entry', () => {
  const p = read('docs/js/views/production.js');
  for (const t of ['open-inputs', 'openInputsSheet', "['owner', 'manager', 'bookkeeper'].includes(db.getRole())"]) assert.ok(p.includes(t), t);
  const v = read('docs/js/views/inputs.js');
  for (const t of ['data-new="buy"', 'data-new="use"', 'data-new="adjust"', 'upsertInputMove', 'deleteInputMove', 'adjustmentFor']) assert.ok(v.includes(t), t);
});

if (failures) { console.log(`\n${failures} failed`); process.exit(1); }
console.log('\nall passed');
