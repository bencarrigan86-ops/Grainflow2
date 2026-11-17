// Run with:
//   node tests/manualdocket.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stateToRows, rowsToState } from '../docs/js/mapping.js';

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); } catch (e) { failures++; console.log(`  FAIL  ${name}\n        ${(e.stack || e.message).split('\n').slice(0, 3).join('\n        ')}`); }
};
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

const stateWith = (m) => ({ currentYear: '2026', years: { 2026: { sales: [], commodities: [], fields: [], storages: [], movements: [m] } }, businessDetails: {} });

check('the manual docket number goes to the server and comes back', () => {
  const rows = stateToRows(stateWith({ id: 'm1', date: '2026-11-17', tons: 30, froms: [], tos: [], manualDocketNo: 'D-1042' }), 'farm1');
  assert.equal(rows.movements[0].manual_docket_no, 'D-1042');
  assert.equal(rowsToState(rows).years[2026].movements[0].manualDocketNo, 'D-1042');
});

check('a load that never had one sends no column, so a server without it is not refused', () => {
  const rows = stateToRows(stateWith({ id: 'm1', date: '2026-11-17', tons: 30, froms: [], tos: [] }), 'farm1');
  assert.ok(!('manual_docket_no' in rows.movements[0]));
});

check('clearing one reaches the server once it has been set', () => {
  const back = rowsToState(stateToRows(stateWith({ id: 'm1', date: '2026-11-17', tons: 30, froms: [], tos: [], manualDocketNo: 'D-1042' }), 'farm1')).years[2026].movements[0];
  const rows = stateToRows(stateWith({ ...back, manualDocketNo: '' }), 'farm1');
  assert.equal(rows.movements[0].manual_docket_no, null);
});

check('the ticket form has the box, saves it, searches by it and shows it on the load', () => {
  const m = read('docs/js/views/movements.js');
  assert.ok(m.includes("label: 'Manual docket no.', id: 'manualDocket'"));
  assert.ok(m.includes("manualDocketNo: getVal(root, 'manualDocket')?.trim() || ''"));
  assert.ok(m.includes('m.externalTicketNo, m.manualDocketNo, m.outloadNo'), 'searchable');
  assert.ok(m.includes('docket ${m.manualDocketNo}'), 'shown on the row');
  assert.ok(read('docs/js/storage.js').includes('rec.__hasManualDocket = true'));
});

check('the column is in a migration and in the paste-in file', () => {
  assert.ok(read('supabase/migrations/20261124000000_movement_manual_docket.sql').includes('add column if not exists manual_docket_no text'));
  assert.ok(read('supabase/paste-into-sql-editor.sql').includes('manual_docket_no'));
});

if (failures) { console.log(`\n${failures} FAILURES`); process.exit(1); }
console.log('\nall passed');
