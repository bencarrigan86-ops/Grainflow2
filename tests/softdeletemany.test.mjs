// Run with:
//   node tests/softdeletemany.test.mjs
//
// Deleting many records in one call: clearing a sample farm or a season sent hundreds of deletes, two requests each, one at a time.
// The server takes a table and a list; the app sends lists first and falls back to one at a time for any list that is refused.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); } catch (e) { failures++; console.log(`  FAIL  ${name}\n        ${e.message}`); }
};
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

check('the server function applies soft_delete_row to each, so every rule still applies, and is for signed-in people only', () => {
  const sql = read('supabase/migrations/20261218000000_soft_delete_many.sql');
  assert.ok(/security definer/.test(sql) && sql.includes('perform soft_delete_row(p_table, v_id)'));
  assert.ok(sql.includes("raise exception 'not authenticated'") && sql.includes('> 200'));
  assert.ok(sql.includes('revoke all on function soft_delete_rows(text, uuid[]) from public;') && sql.includes('grant execute on function soft_delete_rows(text, uuid[]) to authenticated;'));
  assert.ok(read('supabase/paste-into-sql-editor.sql').includes('function soft_delete_rows('));
});

check('the push sends lists per table first, and a list that is refused is left for the one-at-a-time path', () => {
  const sy = read('docs/js/sync.js');
  const a = sy.indexOf('const bulk = new Set();');
  const b = sy.indexOf('for (const d of deletes) {\n      if (bulk.has(d.seq)) continue;');
  assert.ok(a > 0 && b > a, 'bulk before the single deletes');
  const block = sy.slice(a, b);
  assert.ok(block.includes("rpc('soft_delete_rows', { p_table: table, p_ids: part.map((d) => d.id) })"));
  assert.ok(block.includes('chunk(list, DELETE_BATCH)') && block.includes('if (error) continue;') && block.includes('bulk.add(d.seq)'));
  assert.ok(sy.includes('const DELETE_BATCH = 100;'), 'under the 200 the server takes');
  assert.ok(sy.includes("soft_delete_row', { p_table: d.table, p_id: d.id }"), 'the single path is kept');
  assert.ok(sy.includes('clearOutboxItems(deletes.filter((d) => !stuck.has(d.seq))'), 'what went in a list is cleared like the rest');
});

if (failures) { console.log(`\n${failures} FAILURES`); process.exit(1); }
console.log('\nall passed');
