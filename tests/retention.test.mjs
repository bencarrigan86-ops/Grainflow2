// Run with:
//   node tests/retention.test.mjs
//
// Barley retention (the share kept above the 2.5 mm screen): recorded on a load and on a silo, it takes oil's place
// when the commodity is barley, and is saved with the farm without stopping a farm that has no such column saving.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extraSpecKey, specText, specOf, SPECS } from '../docs/js/outload.js';
import { hasQualityRecorded } from '../docs/js/transit.js';
import { stateToRows, rowsToState } from '../docs/js/mapping.js';

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); } catch (e) { failures++; console.log(`  FAIL  ${name}\n        ${e.message}`); }
};
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

console.log('\n=== which measurement a commodity has ===');
check('barley has retention where other grains have oil', () => {
  assert.equal(extraSpecKey('Barley'), 'retentionPct');
  assert.equal(extraSpecKey('Malt barley'), 'retentionPct');
  assert.equal(extraSpecKey('Canola'), 'oilPct');
  assert.equal(extraSpecKey('Wheat'), 'oilPct');
  assert.equal(extraSpecKey(''), 'oilPct');
  assert.equal(extraSpecKey(undefined), 'oilPct');
});
check('retention is one of the measurements, read as a number and blank when not recorded', () => {
  assert.ok(SPECS.some((s) => s.key === 'retentionPct'));
  assert.equal(specOf({ retentionPct: '82.4' }).retentionPct, 82.4);
  assert.equal(specOf({}).retentionPct, null);
});
check('it is written with the rest of a load\'s quality', () => {
  assert.ok(specText({ grade: 'MALT1', retentionPct: 82.4 }).includes('82.4% retention'));
  assert.equal(hasQualityRecorded({ retentionPct: 80 }), true);
  assert.equal(hasQualityRecorded({}), false);
});

console.log('\n=== saved with the farm ===');
const FARM = '99999999-9999-9999-9999-999999999999';
const SID = '88888888-8888-8888-8888-888888888888';
const state = (movement = {}, storage = {}) => ({
  currentYear: '2026', nextMovementNo: 2, businessDetails: {},
  years: { 2026: { commodities: [], fields: [], sales: [], invoices: [], overheads: {},
    storages: [{ id: SID, kind: 'silo', name: 'Silo 1', ...storage }],
    movements: [{ id: '77777777-7777-7777-7777-777777777777', ticketNo: 1, froms: [], tos: [], tons: 10, ...movement }] } },
});
check('a load\'s retention goes to the server and comes back', () => {
  const rows = stateToRows(state({ retentionPct: 82.4 }), FARM);
  assert.equal(rows.movements[0].retention_pct, 82.4);
  assert.equal(rowsToState(rows).years[2026].movements[0].retentionPct, 82.4);
});
check('so does a silo\'s', () => {
  const rows = stateToRows(state({}, { retentionPct: 79 }), FARM);
  assert.equal(rows.storages[0].retention_pct, 79);
  assert.equal(rowsToState(rows).years[2026].storages[0].retentionPct, 79);
});
check('no retention recorded sends no such column, so saving works before the database has it', () => {
  const rows = stateToRows(state({ grade: 'APH1', proteinPct: 11 }, { grade: 'APH1' }), FARM);
  assert.ok(!('retention_pct' in rows.movements[0]) && !('retention_pct' in rows.storages[0]));
});
check('an oil figure does not drag the retention column along, nor retention the oil column', () => {
  const oil = stateToRows(state({ oilPct: 43, __hasOil: true }), FARM).movements[0];
  assert.ok('oil_pct' in oil && !('retention_pct' in oil));
  const ret = stateToRows(state({ retentionPct: 80, __hasRetention: true }), FARM).movements[0];
  assert.ok('retention_pct' in ret && !('oil_pct' in ret));
});
check('having had a figure and cleared it still sends the column, so the clearing reaches the server', () => {
  const row = stateToRows(state({ retentionPct: null, __hasRetention: true }), FARM).movements[0];
  assert.ok('retention_pct' in row && row.retention_pct === null);
});
check('the column is in the paste-in file and the migration', () => {
  assert.ok(read('supabase/paste-into-sql-editor.sql').includes('add column if not exists retention_pct numeric(6,2)'));
  const m = read('supabase/migrations/20261115120000_barley_retention.sql');
  assert.ok(m.includes('alter table movements') && m.includes('alter table storages'));
});

console.log('\n=== on the sheets ===');
check('the load sheet and the silo sheet show retention for barley in oil\'s place, and save it', () => {
  const m = read('docs/js/views/movements.js');
  assert.ok(m.includes("id=\"lq-ret-wrap\" hidden") && m.includes("extraSpecKey(commodities.find((c) => c.id === ctx.commodityId)?.name)") && m.includes("retentionPct: n('lq-ret')"));
  assert.ok(m.includes('ctx.commodityId = e.target.value;\n      syncExtra();'), 'it follows the commodity when that is changed');
  const s = read('docs/js/views/storage.js');
  assert.ok(s.includes('id="q-ret-wrap"') && s.includes("retentionPct: n('q-ret')") && s.includes("pct(s.retentionPct, 'retention')"));
  assert.ok(read('docs/js/storage.js').includes('rec.__hasRetention = true'));
});

if (failures) { console.log(`\n${failures} failed`); process.exit(1); }
console.log('\nall passed');
