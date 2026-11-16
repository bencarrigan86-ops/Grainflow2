// Run with:
//   node tests/ffa.test.mjs
//
// Canola free fatty acid (FFA), beside oil: kept on loads and silos, sent to the server only once recorded (so a farm
// that has not run the SQL can still save), averaged like the other measurements, and on the forms.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stateToRows, rowsToState } from '../docs/js/mapping.js';
import { SPECS, specOf } from '../docs/js/outload.js';

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); } catch (e) { failures++; console.log(`  FAIL  ${name}\n        ${e.message}`); }
};
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

const FARM = '11111111-1111-1111-1111-111111111111';
const MID = '41414141-4141-4141-4141-414141414141';
const SID = '51515151-5151-5151-5151-515151515151';
const stateOf = (move, storage) => ({
  currentYear: '2026', nextMovementNo: 1, businessDetails: {},
  years: { 2026: { commodities: [], fields: [], sales: [], invoices: [], overheads: {}, storages: [{ id: SID, name: 'Silo 1', kind: 'silo', ...storage }], movements: [{ id: MID, date: '2026-11-01', tons: 30, ...move }] } },
});

check('FFA is a measurement that is averaged and written out like the others', () => {
  assert.ok(SPECS.some((s) => s.key === 'ffaPct' && s.unit === '%'));
  assert.equal(specOf({ ffaPct: 0.8 }).ffaPct, 0.8);
  assert.equal(specOf({}).ffaPct, null, 'a load with no FFA is blank, not zero');
});

check('a load with FFA sends it to the server and gets it back', () => {
  const rows = stateToRows(stateOf({ ffaPct: 0.85, __hasFfa: true }, {}), FARM);
  assert.equal(rows.movements[0].ffa_pct, 0.85);
  assert.equal(rowsToState(rows).years[2026].movements[0].ffaPct, 0.85);
});

check('a load without FFA sends no such column, so loads still save before the database has it', () => {
  assert.ok(!('ffa_pct' in stateToRows(stateOf({}, {}), FARM).movements[0]));
  assert.ok(!('ffa_pct' in stateToRows(stateOf({ proteinPct: 11, grade: 'APH1' }, {}), FARM).movements[0]));
});

check('an FFA that was recorded and then cleared still sends null, so the clearing reaches the server', () => {
  const row = stateToRows(stateOf({ ffaPct: null, __hasFfa: true }, {}), FARM).movements[0];
  assert.ok('ffa_pct' in row && row.ffa_pct === null);
});

check('a silo carries its FFA the same way', () => {
  const rows = stateToRows(stateOf({}, { ffaPct: 1.1, __hasFfa: true }), FARM);
  assert.equal(rows.storages[0].ffa_pct, 1.1);
  assert.equal(rowsToState(rows).years[2026].storages[0].ffaPct, 1.1);
});

check('recording FFA turns the flag on, in the data layer', () => {
  const st = read('docs/js/storage.js');
  assert.ok(/rec\.ffaPct !== null[\s\S]*?rec\.__hasFfa = true/.test(st));
});

check('the load sheet, the silo sheet and the silo layer rows all have an FFA box', () => {
  const m = read('docs/js/views/movements.js');
  assert.ok(m.includes("id: 'lq-ffa'") && m.includes("ffaPct: n('lq-ffa')") && m.includes("ffaPct: num('lq-ffa')"), 'load sheet');
  const s = read('docs/js/views/storage.js');
  assert.ok(s.includes("id: 'q-ffa'") && s.includes("ffaPct: n('q-ffa')"), 'silo sheet');
  assert.ok(s.includes("'lay-ffa', 'Free fatty acid %'") && s.includes("ffaPct: val(row, '.lay-ffa')"), 'layer rows');
  assert.ok(s.includes("'lay-oil', 'Oil %'") && s.includes("oilPct: val(row, '.lay-oil')"), 'oil on the layer rows');
  assert.ok(s.includes("'lay-ret', 'Retention %'") && s.includes("retentionPct: val(row, '.lay-ret')"), 'retention on the layer rows');
});

check('the column is in the paste-in file and a migration', () => {
  assert.ok(/alter table movements\s+add column if not exists ffa_pct/.test(read('supabase/paste-into-sql-editor.sql')));
  assert.ok(/alter table storages\s+add column if not exists ffa_pct/.test(read('supabase/migrations/20261118400000_ffa_pct.sql')));
});

if (failures) { console.log(`\n${failures} FAILURES`); process.exit(1); }
console.log('\nall passed');
