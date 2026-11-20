// Run with:
//   node tests/silocarry.test.mjs
//
// Starting a new season: a silo or bunker still holding grain opens the new season with it (what the books say it holds at
// the end of the old one, shrink included), and an empty one opens at nothing.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_VERSION } from '../docs/js/version.js';

const stamp = APP_VERSION.split('.').pop();
const { storageLedgerStock } = await import(`../docs/js/derived.js?v=${stamp}`);
const { setShrinkSource } = await import(`../docs/js/shrink.js?v=${stamp}`);

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); } catch (e) { failures++; console.log(`  FAIL  ${name}\n        ${e.message}`); }
};
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

console.log('\n=== what a silo holds at the end of the season ===');
check('opening stock, plus loads in, less shrink and loads out', () => {
  setShrinkSource(() => [{ id: 'w', shrinkPct: 1 }]);
  const silo = { id: 's1', openingStock: 10 };
  const moves = [
    { id: 'a', commodityId: 'w', froms: [{ type: 'field', id: 'f', tons: 200 }], tos: [{ type: 'silo', id: 's1', tons: 200 }] },
    { id: 'b', commodityId: 'w', froms: [{ type: 'silo', id: 's1', tons: 60 }], tos: [{ type: 'sale', id: 'x', tons: 60 }] },
  ];
  assert.equal(Math.round(storageLedgerStock(silo, moves) * 100) / 100, 10 + 200 - 2 - 60);
  assert.equal(storageLedgerStock({ id: 's2', openingStock: 0 }, moves), 0);
});

console.log('\n=== the new season ===');
check('a new season opens a silo with what it holds, and the guide says so', () => {
  const st = read('docs/js/storage.js');
  assert.ok(/createYear\([\s\S]*?openingStock: isOffFarm\(s\) \? 0 : carriedStock\(s, src\.movements\)/.test(st));
  assert.ok(st.includes('storageLedgerStock(s, movements)'));
  assert.ok(read('docs/js/helpcontent.js').includes('a silo still holding grain opens with it'));
});

if (failures) { console.log(`\n${failures} failed`); process.exit(1); }
console.log('\nall passed');
