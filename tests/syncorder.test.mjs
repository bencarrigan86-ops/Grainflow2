// Run with:
//   node tests/syncorder.test.mjs
//
// A farm that was reset, or had the sample loaded over it, brings in new tickets and invoices that reuse the numbers of the old ones.
// The old ones must be deleted before the new ones go up, and a deleted record must not hold its number on the server.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); } catch (e) { failures++; console.log(`  FAIL  ${name}\n        ${(e.stack || e.message).split('\n').slice(0, 3).join('\n        ')}`); }
};
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

check('the deletes are sent before the rows, so a reused number is free when the new row arrives', () => {
  const s = read('docs/js/sync.js');
  const del = s.indexOf("update({ deleted_at: new Date().toISOString() })");
  const up = s.indexOf('for (const table of ORDER) {');
  assert.ok(del > 0 && up > 0 && del < up, 'the delete loop comes before the table loop');
  assert.ok(s.includes('await clearOutboxItems(deletes.filter((d) => !stuck.has(d.seq))'), 'deletes already settled are not sent again if an upload stops the push');
});
check('a ticket or invoice number clash is named as one, not as a hidden row', () => {
  const s = read('docs/js/sync.js');
  assert.ok(s.includes('ticket_no|invoice_no') && s.includes('clash'));
  assert.ok(read('docs/js/views/settingssync.js').includes('its number is already used by another record on the server'));
});
check('a deleted ticket or invoice no longer holds its number on the server', () => {
  const m = read('supabase/migrations/20261206000000_numbers_free_when_deleted.sql');
  assert.ok(m.includes('drop constraint if exists movements_farm_id_ticket_no_key'));
  assert.ok(m.includes('on movements (farm_id, ticket_no) where deleted_at is null'));
  assert.ok(m.includes('drop constraint if exists invoices_farm_id_invoice_no_key'));
  assert.ok(m.includes('on invoices (farm_id, invoice_no) where deleted_at is null'));
});

check('the paste-everything SQL can be run again over a farm that has data: no constraint is narrowed on the way to its final list, and it carries the numbers-free migration', () => {
  const sql = read('supabase/paste-into-sql-editor.sql');
  const lists = [...sql.matchAll(/add constraint sale_documents_kind_check\s+check \(kind in \(([^)]*)\)\)/g)].map((m) => m[1].trim());
  assert.ok(lists.length >= 3);
  assert.ok(lists.every((l) => l === lists[lists.length - 1]), 'every version of the document kinds list is the full one');
  assert.ok(lists[0].includes("'confirmation'"));
  assert.ok(sql.includes('movements_farm_ticket_no_live') && sql.includes('invoices_farm_invoice_no_live'));
});

if (failures) { console.log(`\n${failures} FAILURES`); process.exit(1); }
console.log('\nall passed');
