// Run with:
//   node tests/fumigation.test.mjs
//
// Fumigation of a storage: a record of past fumigations, the date the withholding ends, whether the grain is clear
// today, the warning on a load out inside the withholding period, and that the record travels to the server and back.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { addDays, withholdingEnd, clearOn, cleanFumigation, fumigationLog, fumigationState, withholdingClash, fumigationLine } from '../docs/js/fumigation.js';
import { stateToRows, rowsToState } from '../docs/js/mapping.js';

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); } catch (e) { failures++; console.log(`  FAIL  ${name}\n        ${e.message}`); }
};
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

check('the withholding ends the fumigation date plus the days, across month and year ends', () => {
  assert.equal(withholdingEnd('2026-11-10', 14), '2026-11-24');
  assert.equal(addDays('2026-12-25', 10), '2027-01-04');
  assert.equal(withholdingEnd('2026-11-10', ''), '');
  assert.equal(withholdingEnd('', 14), '');
  assert.equal(clearOn({ date: '2026-11-10', days: 14, endsOn: '2026-11-30' }), '2026-11-30');   // typed over
});

check('a record keeps what was filled in, drops one with no date, and lists the newest first', () => {
  assert.equal(cleanFumigation({ product: 'X' }), null);
  const log = fumigationLog([{ id: 'a', date: '2026-02-01', days: 7 }, { id: 'b', date: '2026-11-10', product: ' Phosphine ', days: 14 }, { nope: 1 }]);
  assert.deepEqual(log.map((f) => f.id), ['b', 'a']);
  assert.equal(log[0].product, 'Phosphine');
  assert.equal(log[0].endsOn, '2026-11-24');
});

check('the grain is withheld until the clear-to date, and clear on it', () => {
  const st = { fumigations: [{ id: 'a', date: '2026-11-10', days: 14 }] };
  const on = (d) => fumigationState(st, d);
  assert.equal(on('2026-11-17').withheld, true);
  assert.equal(on('2026-11-17').daysLeft, 7);
  assert.equal(on('2026-11-24').withheld, false);
  assert.equal(on('2026-12-01').withheld, false);
  assert.equal(fumigationState({}, '2026-11-17').last, null);
  assert.match(fumigationLine(on('2026-11-17'), (d) => d), /Withholding until 2026-11-24 \(7 days left\)/);
});

check('only the newest fumigation decides today, and past ones stay on the record', () => {
  const st = { fumigations: [{ id: 'old', date: '2026-02-01', days: 10 }, { id: 'new', date: '2026-11-10', days: 14 }] };
  const s = fumigationState(st, '2026-11-17');
  assert.equal(s.last.id, 'new');
  assert.equal(s.count, 2);
});

check('a load out inside any withholding period is a clash; before it or after it is not', () => {
  const st = { fumigations: [{ id: 'a', date: '2026-11-10', days: 14 }] };
  assert.ok(withholdingClash(st, '2026-11-12'));
  assert.ok(withholdingClash(st, '2026-11-23'));
  assert.equal(withholdingClash(st, '2026-11-24'), null);
  assert.equal(withholdingClash(st, '2026-11-09'), null);
});

const FARM = '11111111-1111-1111-1111-111111111111';
const stateWith = (st) => ({
  currentYear: '2026', nextMovementNo: 1, businessDetails: {},
  years: { 2026: { commodities: [], storages: [st], fields: [], sales: [], movements: [], overheads: {}, invoices: [], payables: [], orders: [], freightOrders: [] } },
});
const base = { id: '22222222-2222-2222-2222-222222222222', kind: 'silo', name: 'Silo 1', openingStock: 0 };

check('a storage with no record sends no column, so saving works before the database has it', () => {
  assert.ok(!('fumigations' in stateToRows(stateWith(base), FARM).storages[0]));
});

check('the record goes to the server and comes back; deleting the last one reaches the server as nothing', () => {
  const list = [{ id: 'f1', date: '2026-11-10', product: 'Phosphine', days: 14, endsOn: '2026-11-24' }];
  const rows = stateToRows(stateWith({ ...base, fumigations: list }), FARM);
  assert.deepEqual(rows.storages[0].fumigations, list);
  assert.deepEqual(rowsToState(rows).years[2026].storages[0].fumigations, list);
  const cleared = stateToRows(stateWith({ ...base, fumigations: [], __hasFumigations: true }), FARM);
  assert.equal(cleared.storages[0].fumigations, null);
});

check('the form, the list badge, the load warning and the SQL are all there', () => {
  const v = read('docs/js/views/storage.js');
  assert.ok(v.includes('id="fumigation-fold"') && v.includes('fum-add') && v.includes('fumigationBadge(s)') && v.includes('fumigations: fumigationLog(fumigations)'));
  assert.ok(read('docs/js/views/movements.js').includes('withholdingClash') && read('docs/js/views/movements.js').includes('Save anyway'));
  assert.ok(read('supabase/paste-into-sql-editor.sql').includes('add column if not exists fumigations jsonb'));
  assert.ok(read('supabase/migrations/20261123000000_storage_fumigations.sql').includes('fumigations jsonb'));
  assert.ok(read('docs/js/storage.js').includes('__hasFumigations'));
});

if (failures) { console.log(`\n${failures} FAILURES`); process.exit(1); }
console.log('\nall passed');
