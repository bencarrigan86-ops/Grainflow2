// The created_by fix: every table that has the column gets a default of the signed-in person.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const dir = new URL('../supabase/migrations/', import.meta.url);
const fix = readFileSync(new URL('20261225000000_created_by_default.sql', dir), 'utf8');
let n = 0;
const t = (name, fn) => { fn(); n += 1; console.log('PASS', name); };

t('it sets a default of the signed-in person, only where there is none, and never touches rows', () => {
  assert.ok(fix.includes('set default auth.uid()'));
  assert.ok(fix.includes('c.column_default is null'));
  assert.ok(!/\bupdate\s+public\./i.test(fix) && !/\bupdate\s+\w+\s+set\b/i.test(fix), 'it must not rewrite existing rows');
  assert.ok(fix.includes("notify pgrst, 'reload schema'"));
});
t('it only changes base tables with a uuid created_by, not views', () => {
  assert.ok(fix.includes("table_type = 'BASE TABLE'") && fix.includes("data_type = 'uuid'"));
});
t('the paste file and the test copy carry it', () => {
  assert.ok(readFileSync(new URL('../supabase/paste-into-sql-editor.sql', import.meta.url), 'utf8').includes('20261225000000_created_by_default.sql'));
  const copies = readdirSync(new URL('../supabase/test-copy/', import.meta.url)).map((f) => readFileSync(new URL(`../supabase/test-copy/${f}`, import.meta.url), 'utf8'));
  assert.ok(copies.some((c) => c.includes('20261225000000_created_by_default.sql')));
});
t('the tables the owner rules depend on are the ones that lacked it', () => {
  const schema = readFileSync(new URL('20260831120000_initial_schema.sql', dir), 'utf8');
  for (const table of ['movements', 'sales', 'sale_terms', 'invoices']) {
    const block = schema.slice(schema.indexOf(`create table ${table}`) >= 0 ? schema.indexOf(`create table ${table}`) : schema.indexOf(`create table if not exists ${table}`));
    assert.ok(/created_by\s+uuid,/.test(block.slice(0, 2500)), `${table}: no plain created_by column to give a default`);
  }
});
console.log(`${n} passed`);
