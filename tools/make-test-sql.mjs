// Builds the SQL for a brand new test database: every migration, in date order, in a few files small enough to paste into the
// Supabase SQL editor one at a time. Run: node tools/make-test-sql.mjs   (writes supabase/test-copy/part-1.sql, part-2.sql, ...)
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'supabase', 'migrations');
const out = join(root, 'supabase', 'test-copy');
const LIMIT = 70000;   // characters in one file

mkdirSync(out, { recursive: true });
const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
const parts = [];
let cur = '', first = '', last = '';
for (const f of files) {
  const body = `-- ---------------------------------------------------------------------------\n-- ${f}\n-- ---------------------------------------------------------------------------\n${readFileSync(join(dir, f), 'utf8').trimEnd()}\n\n`;
  if (cur && cur.length + body.length > LIMIT) { parts.push({ text: cur, first, last }); cur = ''; first = ''; }
  if (!cur) first = f;
  cur += body; last = f;
}
if (cur) parts.push({ text: cur, first, last });
parts.forEach((p, i) => {
  const head = `-- Test database, part ${i + 1} of ${parts.length}: ${p.first} to ${p.last}.\n-- Paste ALL of this into the Supabase SQL editor of the TEST project and press Run. Run the parts in order.\n\n`;
  writeFileSync(join(out, `part-${i + 1}.sql`), head + p.text);
});
console.log(`${files.length} migrations in ${parts.length} files`);
