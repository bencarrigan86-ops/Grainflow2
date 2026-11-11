// Every script the app loads must at least parse. The other tests import single
// modules, so a typo in a screen nobody tests can sail through them and leave the
// app a blank page — this is the check that does not let that happen.
//
//   node tests/syntax.test.mjs
import { execFileSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('../docs/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const files = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (p.endsWith('.js')) files.push(p);
  }
};
walk(decodeURIComponent(root));

let failures = 0;
for (const f of files) {
  try { execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' }); }
  catch (e) { failures++; console.log(`  FAIL  ${f}\n        ${String(e.stderr).split('\n').slice(0, 4).join('\n        ')}`); }
}
console.log(`  ${files.length - failures} of ${files.length} scripts parse`);
if (failures) process.exit(1);
console.log('\nall passed');
