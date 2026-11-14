// Run with:
//   node tests/deleted.test.mjs
//
// Recently deleted: the words on the screen, and that the server functions and the Settings button are in place.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { typeLabel, TYPES, whenText, restoreMessage, visibleDeleted } from '../docs/js/deleted.js';

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); } catch (e) { failures++; console.log(`  FAIL  ${name}\n        ${e.message}`); }
};

console.log('\n=== the words ===');

check('every kind that can be restored has a name', () => {
  assert.equal(typeLabel('sales'), 'Contract');
  assert.equal(typeLabel('payables'), 'Bill');
  assert.equal(typeLabel('fields'), 'Paddock');
  for (const t of TYPES) assert.notEqual(typeLabel(t), 'Record', t);
  assert.equal(typeLabel('mystery'), 'Record');
});
check('a timestamp reads as a day and time; rubbish reads as nothing', () => {
  assert.match(whenText('2026-11-12T15:40:00Z'), /^\d{2}-11-2026, \d{1,2}:\d{2}/);
  assert.equal(whenText('not a date'), '');
  assert.equal(whenText(undefined), '');
});
check('the server\'s own rules are shown as they are; anything else gets a plain line', () => {
  assert.equal(restoreMessage('Restore its contract first'), 'Restore its contract first');
  assert.equal(restoreMessage('It belongs to a season that was deleted'), 'It belongs to a season that was deleted');
  assert.match(restoreMessage('not allowed'), /not allowed to restore/);
  assert.match(restoreMessage('not found'), /no longer there/);
  assert.match(restoreMessage('duplicate key value violates unique constraint'), /Check your signal/);
  assert.match(restoreMessage(undefined), /Check your signal/);
});
check('the list is newest first, and can be narrowed to one kind', () => {
  const rows = [
    { tbl: 'fields', id: 'a', deleted_at: '2026-11-10T01:00:00Z' },
    { tbl: 'movements', id: 'b', deleted_at: '2026-11-12T01:00:00Z' },
    { tbl: 'fields', id: 'c', deleted_at: '2026-11-11T01:00:00Z' },
  ];
  assert.deepEqual(visibleDeleted(rows).map((r) => r.id), ['b', 'c', 'a']);
  assert.deepEqual(visibleDeleted(rows, 'fields').map((r) => r.id), ['c', 'a']);
  assert.deepEqual(visibleDeleted(null), []);
});

console.log('\n=== wired in ===');

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

check('the paste-in file has both server functions, limited to owners and managers', () => {
  const sql = read('supabase/paste-into-sql-editor.sql');
  assert.match(sql, /create or replace function list_deleted\(/);
  assert.match(sql, /create or replace function restore_row\(/);
  assert.match(sql, /grant execute on function list_deleted\(uuid, integer\) to authenticated/);
  assert.match(sql, /grant execute on function restore_row\(text, uuid\) to authenticated/);
  assert.match(sql, /v_role not in \('owner', 'manager'\)/);
});
check('contracts, invoices and bills are for the owner only, in the list and in the restore', () => {
  const sql = read('supabase/migrations/20261114130000_recently_deleted.sql');
  assert.match(sql, /from sales t where v_role = 'owner'/);
  assert.match(sql, /from invoices t where v_role = 'owner'/);
  assert.match(sql, /from payables t where v_role = 'owner'/);
  assert.match(sql, /p_table in \('sales', 'invoices', 'payables'\) and v_role <> 'owner'/);
});
check('everything that is deleted with its parent comes back with it', () => {
  const sql = read('supabase/migrations/20261114130000_recently_deleted.sql');
  for (const t of ['movement_legs', 'movement_photos', 'sale_terms', 'sale_documents', 'field_agronomy']) {
    assert.match(sql, new RegExp(`update ${t} set deleted_at = null`), t);
  }
  assert.match(sql, /update orders set deleted_at = null where sale_id = p_id/);
});
check('a number someone else has since taken is replaced, and an order is not restored under a deleted contract', () => {
  const sql = read('supabase/migrations/20261114130000_recently_deleted.sql');
  assert.match(sql, /exception when unique_violation/);
  assert.match(sql, /Restore its contract first/);
  assert.match(sql, /belongs to a season that was deleted/);
});
check('Settings has the button, for owners and managers, and it opens the screen', () => {
  const src = read('docs/js/views/settings.js');
  assert.match(src, /\['owner', 'manager'\]\.includes\(db\.getRole\(\)\) \? `<button class="btn secondary small" id="open-deleted"/);
  assert.match(src, /openDeletedSheet\(\)/);
  assert.match(read('docs/js/views/deleted.js'), /supabase\.rpc\('restore_row'/);
  assert.match(read('docs/js/views/deleted.js'), /supabase\.rpc\('list_deleted'/);
});

if (failures) { console.log(`\n${failures} failed`); process.exit(1); }
console.log('\nall passed');
