// Run with:
//   node tests/band.test.mjs
//
// Alternating colours down a list: every second item in an unbroken run, restarting after a heading.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { altFlags } from '../docs/js/band.js';

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); } catch (e) { failures++; console.log(`  FAIL  ${name}\n        ${e.message}`); }
};

console.log('\n=== which items take the other colour ===');

check('every second item in a run', () => {
  assert.deepEqual(altFlags([true, true, true, true, true]), [false, true, false, true, false]);
});
check('a heading breaks the run, so the next group opens the same way as the first', () => {
  // heading, item, item, item, heading, item, item
  assert.deepEqual(altFlags([false, true, true, true, false, true, true]), [false, false, true, false, false, false, true]);
});
check('a lone item is the first colour', () => {
  assert.deepEqual(altFlags([true]), [false]);
});
check('nothing, or nothing but headings, is nothing', () => {
  assert.deepEqual(altFlags([]), []);
  assert.deepEqual(altFlags([false, false]), [false, false]);
});

console.log('\n=== folding sections ===');

import { foldBands } from '../docs/js/band.js';

check('two or more sections in a row alternate, from the first colour', () => {
  assert.deepEqual(foldBands([true, true, true]), [{ alt: false }, { alt: true }, { alt: false }]);
});
check('a section on its own is left plain', () => {
  assert.deepEqual(foldBands([true]), [null]);
  assert.deepEqual(foldBands([false, true, false]), [null, null, null]);
});
check('something that is not a section ends the run, and the next run starts again', () => {
  // two sections, a coloured panel between, then two more
  assert.deepEqual(foldBands([true, true, false, true, true]),
    [{ alt: false }, { alt: true }, null, { alt: false }, { alt: true }]);
});

console.log('\n=== wired in ===');

const main = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'js', 'main.js'), 'utf8');
check('the app starts banding lists, and keeps doing it as screens redraw', () => {
  assert.match(main, /import \{ watchLists \} from '\.\/band\.js/);
  assert.match(main, /\nwatchLists\(\);/);
});

if (failures) { console.log(`\n${failures} failed`); process.exit(1); }
console.log('\nall passed');
